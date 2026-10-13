

function registerPricingHandlers({ ipcMain, getDatabase, administrator }) {
  function handle(name, action) {
    ipcMain.handle(name, (event, input) => {
      const user = administrator(event);
      if (!user) throw new Error('SESSION_EXPIRED: Please sign in to manage services.');
      return action(getDatabase(), input, user);
    });
  }
  function id(value) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid record ID.');
    return value;
  }
  function name(value) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 120) throw new Error('Enter a name up to 120 characters.');
    return value.trim();
  }
  function money(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER / 100 || Math.abs(value * 100 - Math.round(value * 100)) > 0.00001) throw new Error('Enter a non-negative price with at most two decimal places.');
    return Math.round(value * 100) / 100;
  }
  handle('services:get', db => ({
    services: db.prepare('SELECT s.id,s.name,s.is_active AS isActive,d.kind,r.role,r.code FROM services s JOIN service_definitions d ON d.service_id=s.id JOIN service_roles r ON r.service_id=s.id ORDER BY s.name').all(),
    vehicleTypes: db.prepare('SELECT id,name,is_active AS isActive FROM vehicle_category_catalog WHERE is_active=1 ORDER BY name').all(),
    workers: db.prepare('SELECT id, full_name AS name FROM workers WHERE is_active=1 ORDER BY full_name,id').all(),
    prices: db.prepare('SELECT service_id AS serviceId, vehicle_type_id AS vehicleTypeId, price FROM service_prices UNION ALL SELECT service_id, NULL, price FROM service_default_prices').all(),
    categoryOptions: db.prepare('SELECT service_id AS serviceId,vehicle_type_id AS vehicleTypeId,status FROM service_category_options').all(),
  }));
  function kind(value) {
    if (!['washing', 'blowing', 'engine_wash', 'under_wash', 'carpet_cleaning', 'other'].includes(value)) throw new Error('Select a valid service classification.');
    return value;
  }
  handle('services:add', (db, input) => db.transaction(() => {
    const serviceId = Number(db.prepare('INSERT INTO services(name) VALUES(?)').run(name(input?.name)).lastInsertRowid);
    if (input.kind !== undefined) {
      const inferred = db.prepare('SELECT code FROM service_roles WHERE service_id=?').get(serviceId).code;
      const requested = kind(input.kind);
      if (inferred !== 'other' && requested !== inferred) throw new Error('Service classification must match washing, blowing or carpet cleaning.');
      db.prepare('UPDATE service_definitions SET kind=? WHERE service_id=?').run(['engine_wash','under_wash'].includes(requested)?'other':requested,serviceId);
      db.prepare('UPDATE service_roles SET role=?,code=? WHERE service_id=?').run(['washing','blowing'].includes(requested)?'main':['engine_wash','under_wash'].includes(requested)?'vehicle_extra':'independent',requested,serviceId);
    }
    return { id: serviceId };
  })());
  handle('services:kind', (db, input) => {
    const serviceId = id(input?.serviceId), requested = kind(input?.kind);
    const definition = db.prepare('SELECT code FROM service_roles WHERE service_id=?').get(serviceId);
    if (!definition) throw new Error('Service does not exist.');
    if (definition.code !== 'other' && definition.code !== requested) throw new Error('An established service classification cannot be changed.');
    db.transaction(() => {
      db.prepare('UPDATE service_definitions SET kind=? WHERE service_id=?').run(['engine_wash','under_wash'].includes(requested)?'other':requested,serviceId);
      db.prepare('UPDATE service_roles SET role=?,code=? WHERE service_id=?').run(['washing','blowing'].includes(requested)?'main':['engine_wash','under_wash'].includes(requested)?'vehicle_extra':'independent',requested,serviceId);
    })();
    return { success: true };
  });
  handle('services:price', (db, input) => db.transaction(() => {
    if (db.prepare('SELECT currency FROM business_settings WHERE id=1').get()?.currency!=='GHS') throw new Error('Configure prices in a GHS business; existing currency and prices are preserved.');
    const serviceId = id(input?.serviceId), status=input?.status ?? 'available';
    if (!['available','unavailable','unconfigured'].includes(status)) throw new Error('Select a valid price status.');
    if (!db.prepare('SELECT id FROM services WHERE id=?').get(serviceId)) throw new Error('Service does not exist.');
    if (input.vehicleTypeId === null) {
      if (status!=='available') throw new Error('Select a vehicle category to mark a service unavailable or unconfigured.');
      const price=money(input.price);
      db.prepare('INSERT INTO service_default_prices(service_id,price) VALUES(?,?) ON CONFLICT(service_id) DO UPDATE SET price=excluded.price,updated_at=CURRENT_TIMESTAMP').run(serviceId, price);
    } else {
      const vehicleTypeId = id(input.vehicleTypeId);
      if (!db.prepare('SELECT id FROM vehicle_types WHERE id=?').get(vehicleTypeId)) throw new Error('Vehicle type does not exist.');
      if (status==='available') {
        const price=money(input.price);
        db.prepare('INSERT INTO service_prices(service_id,vehicle_type_id,price) VALUES(?,?,?) ON CONFLICT(service_id,vehicle_type_id) DO UPDATE SET price=excluded.price,updated_at=CURRENT_TIMESTAMP').run(serviceId,vehicleTypeId,price);
      } else if (input.price!=null) throw new Error('Unavailable or unconfigured services do not use a price.');
      db.prepare('INSERT INTO service_category_options(service_id,vehicle_type_id,status) VALUES(?,?,?) ON CONFLICT(service_id,vehicle_type_id) DO UPDATE SET status=excluded.status,updated_at=CURRENT_TIMESTAMP').run(serviceId,vehicleTypeId,status);
    }
    return { success: true };
  })());
  function quote(db, input) {
    if (input?.vehicleId != null) {
      const vehicle = db.prepare('SELECT vehicle_type_id,is_active FROM vehicle_registry WHERE id=?').get(id(input.vehicleId));
      if (!vehicle || !vehicle.is_active) throw new Error('Select an active registered vehicle.');
      if (vehicle.vehicle_type_id !== input.vehicleTypeId) throw new Error('Use the registered vehicle type to calculate the visit price.');
    }
    const vehicleTypeId = input?.vehicleTypeId === null ? null : id(input?.vehicleTypeId);
    if (vehicleTypeId !== null && !db.prepare('SELECT id FROM vehicle_category_catalog WHERE id=? AND is_active=1').get(vehicleTypeId)) throw new Error('Select an active vehicle category.');
    if (!Array.isArray(input?.serviceIds) || !input.serviceIds.length || input.serviceIds.length > 100 || new Set(input.serviceIds).size !== input.serviceIds.length) throw new Error('Select one or more distinct services.');
    const assignments = input.assignments ?? [];
    if (!Array.isArray(assignments) || assignments.length > input.serviceIds.length) throw new Error('Invalid service assignments.');
    const assigned = new Map();
    for (const assignment of assignments) {
      const serviceId = id(assignment?.serviceId), workerId = id(assignment?.workerId);
      if (!input.serviceIds.includes(serviceId) || assigned.has(serviceId)) throw new Error('Assign a worker only once to each selected service.');
      const worker = db.prepare('SELECT id,full_name AS name FROM workers WHERE id=? AND is_active=1').get(workerId);
      if (!worker) throw new Error('Selected worker is unavailable.');
      assigned.set(serviceId, worker);
    }
    const lines = input.serviceIds.map(serviceId => {
      id(serviceId);
      const service = db.prepare('SELECT s.name,d.kind,r.role,r.code FROM services s JOIN service_definitions d ON d.service_id=s.id JOIN service_roles r ON r.service_id=s.id WHERE s.id=? AND s.is_active=1').get(serviceId);
      if (!service) throw new Error('Selected service is unavailable.');
      const specific = db.prepare('SELECT price FROM service_prices WHERE service_id=? AND vehicle_type_id=?').get(serviceId, vehicleTypeId);
      const option=db.prepare('SELECT status FROM service_category_options WHERE service_id=? AND vehicle_type_id=?').get(serviceId,vehicleTypeId);
      if (option?.status==='unavailable') throw new Error(`${service.name} is unavailable for this vehicle category.`);
      if (option?.status==='unconfigured') throw new Error(`Configure a price for ${service.name} in this vehicle category.`);
      const configured = specific ?? (vehicleTypeId!==null && service.role!=='independent' ? null : db.prepare('SELECT price FROM service_default_prices WHERE service_id=?').get(serviceId));
      if (!configured) throw new Error(`Configure a price for ${service.name} before recording this service.`);
      const price = money(configured.price);
      const worker = assigned.get(serviceId);
      let workerAssignment = null;
      if (worker) {
        const rule = db.prepare('SELECT method,rate FROM service_compensation_rules WHERE service_id=?').get(serviceId);
        const earnings = rule ? money(Math.round((rule.method === 'fixed' ? rule.rate : price * rule.rate / 100) * 100) / 100) : null;
        workerAssignment = { workerId: worker.id, workerName: worker.name, compensationMethod: rule?.method ?? null, compensationRate: rule?.rate ?? null, earnings };
      }
      return { serviceId,serviceName:service.name,serviceKind:service.kind,serviceRole:service.role,serviceCode:service.code,quantity:1,unitPrice:price,lineTotal:price,workerAssignment };
    });
    if (lines.filter(line => ['washing', 'blowing'].includes(line.serviceKind)).length > 1) throw new Error('Choose either washing or blowing for one vehicle visit, never both.');
    const subtotal = money(lines.reduce((sum, line) => sum + Math.round(line.lineTotal * 100), 0) / 100);
    return { lines, subtotal, total: subtotal };
  }
  handle('transactions:quote', (db, input) => db.transaction(() => quote(db, input))());
  handle('transactions:create', () => { throw new Error('Use the Visits workflow to record arrivals, assignments and payments.'); });
  function readTransaction(db, input) {
    const transactionId = id(input?.id);
    const transaction = db.prepare('SELECT id,transaction_number AS number,status,subtotal,discount,tax,total FROM transactions WHERE id=?').get(transactionId);
    if (!transaction) throw new Error('Transaction does not exist.');
    const lines = db.prepare(`SELECT l.id,l.service_id AS serviceId,l.service_name AS serviceName,l.service_kind AS serviceKind,
      coalesce(r.role,CASE WHEN l.service_kind IN ('washing','blowing') THEN 'main' WHEN lower(trim(l.service_name)) IN ('engine wash','under wash','engine washing','under washing') THEN 'vehicle_extra' ELSE 'independent' END) AS serviceRole,
      coalesce(r.code,CASE WHEN l.service_kind!='other' THEN l.service_kind WHEN lower(trim(l.service_name)) IN ('engine wash','engine washing') THEN 'engine_wash' WHEN lower(trim(l.service_name)) IN ('under wash','under washing') THEN 'under_wash' ELSE 'other' END) AS serviceCode,
      l.quantity,l.unit_price AS unitPrice,l.line_total AS lineTotal FROM visit_service_records l LEFT JOIN transaction_service_roles r ON r.transaction_service_id=l.id WHERE l.transaction_id=? ORDER BY l.id`).all(transactionId).map(({ id: lineId, ...line }) => ({ ...line,
      workerAssignment: db.prepare('SELECT worker_id AS workerId,worker_name AS workerName,compensation_method AS compensationMethod,compensation_rate AS compensationRate,earnings FROM transaction_service_workers WHERE transaction_service_id=? ORDER BY id').get(lineId) ?? null,
    }));
    const vehicle = db.prepare('SELECT registration_number AS registrationNumber,vehicle_type_name AS vehicleTypeName,make,model,color,customer_name AS customerName,customer_phone AS customerPhone,provenance FROM transaction_vehicle_snapshots WHERE transaction_id=?').get(transactionId) ?? null;
    return { ...transaction, lines, vehicle };
  }
  handle('transactions:get', readTransaction);
  function writeLines(db, transactionId, lines) {
    const insert = db.prepare('INSERT INTO transaction_services(transaction_id,service_id,service_name,quantity,unit_price,line_total) VALUES(?,?,?,?,?,?)');
    const assign = db.prepare('INSERT INTO transaction_service_workers(transaction_service_id,worker_id,worker_name,compensation_method,compensation_rate,earnings) VALUES(?,?,?,?,?,?)');
    for (const line of lines) {
      const lineId = insert.run(transactionId, line.serviceId, line.serviceName, line.quantity, line.unitPrice, line.lineTotal).lastInsertRowid;
      const worker = line.workerAssignment;
      if (worker) assign.run(lineId,worker.workerId,worker.workerName,worker.compensationMethod,worker.compensationRate,worker.earnings);
    }
  }
  return { quote, writeLines, readTransaction };
}
module.exports = { registerPricingHandlers };
