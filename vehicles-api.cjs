function registerVehicleHandlers({ ipcMain, getDatabase, administrator }) {
  const columns = `v.id,v.registration_number AS registrationNumber,v.vehicle_type_id AS vehicleTypeId,v.vehicle_type_name AS vehicleTypeName,
    v.make,v.model,v.color,v.customer_name AS customerName,v.customer_phone AS customerPhone,v.is_active AS isActive,v.created_at AS createdAt,v.updated_at AS updatedAt,
    (SELECT count(*) FROM transactions t WHERE t.vehicle_id=v.id) AS visitCount`;
  function handle(channel, action) {
    ipcMain.handle(channel, (event, input) => {
      const user = administrator(event);
      if (!user) throw new Error('SESSION_EXPIRED: Please sign in to manage vehicles.');
      return action(getDatabase(), input, user);
    });
  }
  function id(value) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid vehicle or vehicle type ID.');
    return value;
  }
  function text(value, label, max, required = false) {
    if ((value === null || value === undefined) && !required) return null;
    if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`Enter a valid ${label} (up to ${max} characters).`);
    const clean = value.trim();
    if (required && !clean) throw new Error(`Enter the ${label}.`);
    return clean || null;
  }
  function plate(value) {
    const display = text(value, 'number plate', 32, true).toUpperCase().replace(/ +/g, ' ');
    if (!/^[A-Z0-9 -]+$/.test(display) || !/[A-Z0-9]/.test(display)) throw new Error('Enter a number plate using letters or digits; spaces and hyphens are allowed.');
    return { display, key: display.replace(/[ -]/g, '') };
  }
  function get(db, vehicleId) {
    const vehicle = db.prepare(`SELECT ${columns} FROM vehicle_registry v WHERE v.id=?`).get(vehicleId);
    if (!vehicle) throw new Error('Vehicle does not exist.');
    return vehicle;
  }
  function matches(db, key) { return db.prepare(`SELECT ${columns} FROM vehicle_registry v WHERE v.plate_key=? ORDER BY v.is_active DESC,v.id`).all(key); }
  function details(db, input, existingVehicleId = null) {
    const registration = plate(input?.registrationNumber), vehicleTypeId = id(input?.vehicleTypeId);
    const category=db.prepare('SELECT id,is_active FROM vehicle_category_catalog WHERE id=?').get(vehicleTypeId);
    if (!category) throw new Error('Select an existing vehicle type.');
    if (!category.is_active && (!existingVehicleId || db.prepare('SELECT vehicle_type_id FROM vehicles WHERE id=?').get(existingVehicleId)?.vehicle_type_id!==vehicleTypeId)) throw new Error('Select an active vehicle category.');
    const make = text(input?.make, 'make', 80), model = text(input?.model, 'model', 80), color = text(input?.color, 'colour', 60);
    const customerName = text(input?.customerName, 'customer name', 120), customerPhone = text(input?.customerPhone, 'customer phone', 40);
    if (customerPhone) {
      const digits = customerPhone.replace(/\D/g, '');
      if (!/^[+\d\s().-]+$/.test(customerPhone) || digits.length < 7 || digits.length > 15) throw new Error('Enter a customer phone number with 7 to 15 digits.');
    }
    return { registration, vehicleTypeId, make, model, color, customerName, customerPhone };
  }
  function audit(db, user, action, vehicleId) {
    db.prepare('INSERT INTO audit_logs(user_id,action,entity_type,entity_id) VALUES(?,?,?,?)').run(user.id, action, 'vehicle', vehicleId);
  }
  function contact(db, vehicleId, data) {
    db.prepare('UPDATE vehicle_record_state SET contact_override=1,customer_name=?,customer_phone=?,updated_at=CURRENT_TIMESTAMP WHERE vehicle_id=?').run(data.customerName, data.customerPhone, vehicleId);
  }
  handle('vehicles:lookup', (db, input) => {
    const registered = matches(db, plate(input?.registrationNumber).key);
    return { vehicles: registered, returning: registered.length > 0, ambiguous: registered.length > 1 };
  });
  handle('vehicles:list', (db, input = {}) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid vehicle search.');
    const search = text(input.search, 'search', 120) ?? '';
    const status = input.status ?? 'all', offset = input.offset ?? 0;
    if (!['all', 'active', 'archived'].includes(status) || !Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid vehicle filter or page.');
    const vehicleTypeId = input.vehicleTypeId == null ? null : id(input.vehicleTypeId);
    const statusValue = status === 'all' ? null : status === 'active' ? 1 : 0;
    const plateSearch = search.toUpperCase().replace(/[ -]/g, '');
    const phoneSearch = search.replace(/[ +().-]/g, '');
    const where = `WHERE (? IS NULL OR v.is_active=?) AND (? IS NULL OR v.vehicle_type_id=?) AND (?='' OR (?!='' AND instr(v.plate_key,?)>0) OR instr(lower(coalesce(v.customer_name,'')),lower(?))>0 OR instr(coalesce(v.customer_phone,''),?)>0 OR (?!='' AND instr(replace(replace(replace(replace(replace(replace(coalesce(v.customer_phone,''),' ',''),'+',''),'-',''),'(',''),')',''),'.',''),?)>0))`;
    const args = [statusValue,statusValue,vehicleTypeId,vehicleTypeId,search,plateSearch,plateSearch,search,search,phoneSearch,phoneSearch];
    return db.transaction(() => ({
      vehicles: db.prepare(`SELECT ${columns} FROM vehicle_registry v ${where} ORDER BY v.registration_number COLLATE NOCASE,v.id LIMIT 50 OFFSET ?`).all(...args, offset),
      total: db.prepare(`SELECT count(*) AS n FROM vehicle_registry v ${where}`).get(...args).n,
      counts: db.prepare('SELECT count(*) AS total,coalesce(sum(is_active=1),0) AS active,coalesce(sum(is_active=0),0) AS archived FROM vehicle_registry').get(),
      vehicleTypes: db.prepare('SELECT id,name,is_active AS isActive FROM vehicle_category_catalog ORDER BY name').all(), offset, limit: 50,
    }))();
  });
  function createVehicle(db, input, user) {
    const data = details(db, input);
    if (matches(db, data.registration.key).length) throw new Error('This number plate is already registered. Reuse or activate the existing vehicle.');
    const vehicleId = Number(db.prepare('INSERT INTO vehicles(registration_number,vehicle_type_id,make,model,color) VALUES(?,?,?,?,?)').run(data.registration.display,data.vehicleTypeId,data.make,data.model,data.color).lastInsertRowid);
    contact(db, vehicleId, data); audit(db, user, 'vehicle_registered', vehicleId);
    return get(db, vehicleId);
  }
  handle('vehicles:create', (db, input, user) => db.transaction(() => createVehicle(db, input, user))());
  handle('vehicles:update', (db, input, user) => db.transaction(() => {
    const vehicleId = id(input?.id), data = details(db, input, vehicleId);
    get(db, vehicleId);
    if (matches(db, data.registration.key).some(vehicle => vehicle.id !== vehicleId)) throw new Error('Another vehicle already has this number plate. Resolve the matching records before changing its plate.');
    db.prepare('UPDATE vehicles SET registration_number=?,vehicle_type_id=?,make=?,model=?,color=? WHERE id=?').run(data.registration.display,data.vehicleTypeId,data.make,data.model,data.color,vehicleId);
    contact(db, vehicleId, data); audit(db, user, 'vehicle_updated', vehicleId);
    return get(db, vehicleId);
  })());
  handle('vehicles:status', (db, input, user) => db.transaction(() => {
    const vehicleId = id(input?.id);
    if (typeof input?.isActive !== 'boolean') throw new Error('Vehicle status must be active or archived.');
    const vehicle = get(db, vehicleId);
    if (input.isActive && matches(db, plate(vehicle.registrationNumber).key).some(other => other.id !== vehicleId && other.isActive)) throw new Error('Another active vehicle already has this number plate.');
    db.prepare('UPDATE vehicle_record_state SET is_active=?,updated_at=CURRENT_TIMESTAMP WHERE vehicle_id=?').run(input.isActive ? 1 : 0, vehicleId);
    audit(db, user, input.isActive ? 'vehicle_activated' : 'vehicle_archived', vehicleId);
    return get(db, vehicleId);
  })());
  return { createVehicle, validateDetails: details };
}
module.exports = { registerVehicleHandlers };
