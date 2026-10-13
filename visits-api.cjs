const { randomUUID, createHash } = require('node:crypto');

function registerVisitHandlers({ ipcMain, getDatabase, administrator, now, pricing, vehicles, earnings }) {
  function handle(channel, action) {
    ipcMain.handle(channel, (event, input) => {
      const user = administrator(event);
      if (!user) throw new Error('SESSION_EXPIRED: Please sign in to manage visits and payments.');
      return action(getDatabase(), input, user);
    });
  }
  function id(value) { if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid visit or vehicle ID.'); return value; }
  function cents(value, positive = false) {
    if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) throw new Error('Enter an amount in whole pesewas within the supported range.');
    return value;
  }
  function key(value) {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(value)) throw new Error('A valid submission key is required.');
    return value;
  }
  function stamp(value, label) {
    if (value === undefined || value === null || value === '') return new Date(now()).toISOString();
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value.slice(0,10) || Date.parse(value) > now() + 60000) throw new Error(`Enter a valid ${label} in UTC, no later than the current time.`);
    return new Date(value).toISOString();
  }
  function ghs(db) {
    if (db.prepare('SELECT currency FROM business_settings WHERE id=1').get()?.currency !== 'GHS') throw new Error('This workflow requires GHS business pricing. Existing currency and records have been preserved; conversion must be configured separately.');
  }
  function audit(db, user, action, visitId) {
    db.prepare('INSERT INTO audit_logs(user_id,action,entity_type,entity_id) VALUES(?,?,?,?)').run(user.id,action,'visit',visitId);
  }
  const statusMap = { waiting: 'pending', in_progress: 'in_progress', completed: 'completed', cancelled: 'cancelled' };
  const displayStatus = value => value === 'pending' ? 'waiting' : value;
  function base(db, visitId) {
    const result = db.prepare(`SELECT t.id,t.transaction_number AS number,t.status,t.vehicle_id AS vehicleId,t.created_at AS createdAt,
      coalesce(d.arrival_at,t.created_at) AS arrivalAt,d.started_at AS startedAt,d.completed_at AS completedAt,d.cancelled_at AS cancelledAt,
      coalesce(d.currency,b.currency) AS currency,v.registration_number AS registrationNumber,v.customer_name AS customerName,v.customer_phone AS customerPhone,
      bal.total_pesewas AS totalPesewas,bal.paid_pesewas AS paidPesewas,bal.outstanding_pesewas AS outstandingPesewas,
      CASE WHEN d.creation_key IS NULL THEN 1 ELSE 0 END AS legacy
      FROM transactions t LEFT JOIN visit_details d ON d.transaction_id=t.id JOIN business_settings b ON b.id=1
      JOIN visit_balances bal ON bal.id=t.id LEFT JOIN transaction_vehicle_snapshots v ON v.transaction_id=t.id WHERE t.id=?`).get(visitId);
    if (!result) throw new Error('Visit does not exist.');
    result.status = displayStatus(result.status);
    result.paymentStatus = result.status === 'cancelled' ? 'cancelled' : result.outstandingPesewas === 0 ? 'paid' : result.paidPesewas === 0 ? 'unpaid' : 'partial';
    return result;
  }
  function read(db, visitId) {
    return db.transaction(() => ({ ...base(db,visitId),
      lines: pricing.readTransaction(db,{ id: visitId }).lines,
      payments: db.prepare(`SELECT p.id,p.method,p.reference,p.status,p.paid_at AS paidAt,
        coalesce(r.amount_pesewas,cast(round(p.amount*100) AS INTEGER)) AS amountPesewas
        FROM payments p LEFT JOIN payment_receipts r ON r.payment_id=p.id WHERE p.transaction_id=? ORDER BY p.paid_at,p.id`).all(visitId),
      history: db.prepare('SELECT id,from_status AS fromStatus,to_status AS toStatus,changed_at AS changedAt FROM visit_status_events WHERE transaction_id=? ORDER BY id').all(visitId),
    }))();
  }
  function preview(db, input, requireWorkers = false) {
    ghs(db);
    if (!input || !['vehicle','non_vehicle'].includes(input.mode)) throw new Error('Choose a vehicle visit or a non-vehicle service.');
    if (!Array.isArray(input.serviceIds) || !input.serviceIds.length) throw new Error('Select the requested service.');
    let vehicleId = null, vehicleTypeId = input.vehicleTypeId ?? null;
    if (input.mode === 'vehicle') {
      if (input.newVehicle && input.vehicleId != null) throw new Error('Select an existing vehicle or register a new vehicle, not both.');
      if (input.newVehicle) vehicleTypeId = vehicles.validateDetails(db,input.newVehicle).vehicleTypeId;
      else {
        vehicleId = id(input.vehicleId);
        const vehicle = db.prepare('SELECT vehicle_type_id,is_active FROM vehicle_registry WHERE id=?').get(vehicleId);
        if (!vehicle || !vehicle.is_active) throw new Error('Select an active registered vehicle.');
        vehicleTypeId = vehicle.vehicle_type_id;
        if (input.vehicleTypeId !== vehicleTypeId) throw new Error('The vehicle type changed. Select the vehicle again before pricing.');
      }
      if (vehicleTypeId === null) throw new Error('Select a vehicle type before saving the visit.');
    } else if (input.vehicleId != null || input.newVehicle) throw new Error('A non-vehicle service does not use a vehicle registration.');
    const priced = pricing.quote(db,{ vehicleId, vehicleTypeId, serviceIds: input.serviceIds, assignments: input.assignments });
    const primary = priced.lines.filter(line => ['washing','blowing'].includes(line.serviceKind));
    if (input.mode === 'vehicle' && primary.length !== 1) throw new Error('A vehicle visit requires exactly one washing or blowing service.');
    if (input.mode === 'non_vehicle' && primary.length) throw new Error('Washing and blowing visits require a registered vehicle.');
    if (input.mode==='non_vehicle' && priced.lines.some(line=>line.serviceRole==='vehicle_extra')) throw new Error('Engine Wash and Under Wash require a vehicle visit with a main service.');
    if (requireWorkers) for (const line of priced.lines) if (line.serviceKind !== 'carpet_cleaning' && !line.workerAssignment) throw new Error(`Assign an active worker for ${line.serviceName}.`);
    return { ...priced, vehicleId, vehicleTypeId, totalPesewas: cents(Math.round(priced.total*100)) };
  }
  const fingerprint = input => createHash('sha256').update(JSON.stringify(input)).digest('hex');
  handle('visits:quote', (db,input) => db.transaction(() => preview(db,input))());
  handle('visits:create', (db,input,user) => db.transaction(() => {
    const submissionKey = key(input?.requestKey);
    const payload = fingerprint({ ...input, requestKey: undefined });
    const existing = db.prepare('SELECT transaction_id,creation_payload FROM visit_details WHERE creation_key=?').get(submissionKey);
    if (existing) {
      if (existing.creation_payload !== payload) throw new Error('This submission key was already used for different visit details.');
      return read(db,existing.transaction_id);
    }
    const priced = preview(db,input,true), arrival = stamp(input.arrivalAt,'arrival time');
    if (cents(input.expectedTotalPesewas) !== priced.totalPesewas || JSON.stringify(input.expectedLines) !== JSON.stringify(priced.lines)) throw new Error('Prices changed or service details/worker compensation changed. Review the updated price before saving.');
    let vehicleId = priced.vehicleId;
    if (input.newVehicle) vehicleId = vehicles.createVehicle(db,input.newVehicle,user).id;
    const time = new Date(now()).toISOString(), number = `WB-${randomUUID()}`;
    const visitId = Number(db.prepare("INSERT INTO transactions(transaction_number,vehicle_id,status,subtotal,total,created_by,created_at,updated_at) VALUES(?,?,'pending',?,?,?,?,?)").run(number,vehicleId,priced.totalPesewas/100,priced.totalPesewas/100,user.id,time,time).lastInsertRowid);
    pricing.writeLines(db,visitId,priced.lines);
    db.prepare("INSERT INTO visit_details(transaction_id,arrival_at,currency,total_pesewas,creation_key,creation_payload) VALUES(?,?,'GHS',?,?,?)").run(visitId,arrival,priced.totalPesewas,submissionKey,payload);
    db.prepare("INSERT INTO visit_status_events(transaction_id,to_status,changed_at,changed_by) VALUES(?,'waiting',?,?)").run(visitId,time,user.id);
    audit(db,user,'visit_created',visitId);
    return read(db,visitId);
  }).immediate());
  handle('visits:get', (db,input) => read(db,id(input?.id)));
  handle('visits:list', (db,input = {}) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid visit search.');
    const search = input.search ?? '', status = input.status ?? 'all', payment = input.paymentStatus ?? 'all', offset = input.offset ?? 0;
    if (typeof search !== 'string' || search.length > 120 || /[\u0000-\u001f]/.test(search) || !['all',...Object.keys(statusMap)].includes(status) || !['all','paid','partial','unpaid'].includes(payment) || !Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid visit filter or search.');
    const plateSearch = search.trim().toUpperCase().replace(/[ -]/g,''), query = search.trim();
    const where = `WHERE (?='all' OR t.status=?) AND (?='all' OR (t.status!='cancelled' AND ((?='paid' AND b.outstanding_pesewas=0) OR (?='unpaid' AND b.outstanding_pesewas>0 AND b.paid_pesewas=0) OR (?='partial' AND b.outstanding_pesewas>0 AND b.paid_pesewas>0))))
      AND (?='' OR instr(lower(t.transaction_number),lower(?))>0 OR (?!='' AND instr(upper(replace(replace(coalesce(v.registration_number,''),' ',''),'-','')),?)>0)
        OR instr(lower(coalesce(v.customer_name,'')),lower(?))>0 OR instr(coalesce(v.customer_phone,''),?)>0
        OR EXISTS(SELECT 1 FROM transaction_services l LEFT JOIN transaction_service_workers w ON w.transaction_service_id=l.id WHERE l.transaction_id=t.id AND (instr(lower(l.service_name),lower(?))>0 OR instr(lower(coalesce(w.worker_name,'')),lower(?))>0)))`;
    const args = [status,statusMap[status] ?? '',payment,payment,payment,payment,query,query,plateSearch,plateSearch,query,query,query,query];
    const from = 'FROM transactions t JOIN visit_balances b ON b.id=t.id LEFT JOIN transaction_vehicle_snapshots v ON v.transaction_id=t.id';
    return db.transaction(() => {
      const rows = db.prepare(`SELECT t.id ${from} ${where} ORDER BY coalesce((SELECT arrival_at FROM visit_details WHERE transaction_id=t.id),t.created_at) DESC,t.id DESC LIMIT 50 OFFSET ?`).all(...args,offset);
      return { visits: rows.map(row => base(db,row.id)), total: db.prepare(`SELECT count(*) AS n ${from} ${where}`).get(...args).n, offset, limit: 50 };
    })();
  });
  handle('visits:status', (db,input,user) => db.transaction(() => {
    const visitId = id(input?.id), visit = base(db,visitId), requested = input?.status;
    if (!Object.hasOwn(statusMap,requested)) throw new Error('Select a valid visit status.');
    if (visit.status === requested) return read(db,visitId);
    const allowed = { waiting: ['in_progress','completed','cancelled'], in_progress: ['completed','cancelled'], completed: [], cancelled: [] };
    if (!allowed[visit.status]?.includes(requested)) throw new Error('This visit status cannot be changed to the selected status.');
    const time = new Date(now()).toISOString();
    db.prepare('INSERT OR IGNORE INTO visit_details(transaction_id,arrival_at,currency,total_pesewas) VALUES(?,?,?,?)').run(visitId,visit.arrivalAt,visit.currency,visit.totalPesewas);
    db.prepare('UPDATE transactions SET status=?,updated_at=? WHERE id=?').run(statusMap[requested],time,visitId);
    if (requested === 'in_progress') db.prepare('UPDATE visit_details SET started_at=? WHERE transaction_id=?').run(time,visitId);
    if (requested === 'completed') {
      db.prepare('UPDATE visit_details SET completed_at=? WHERE transaction_id=?').run(time,visitId);
      earnings.finalize(db,visitId,time);
    }
    if (requested === 'cancelled') db.prepare('UPDATE visit_details SET cancelled_at=? WHERE transaction_id=?').run(time,visitId);
    db.prepare('INSERT INTO visit_status_events(transaction_id,from_status,to_status,changed_at,changed_by) VALUES(?,?,?,?,?)').run(visitId,visit.status,requested,time,user.id);
    audit(db,user,`visit_${requested}`,visitId);
    return read(db,visitId);
  }).immediate());
  handle('visits:payment', (db,input,user) => db.transaction(() => {
    const visitId = id(input?.id), amount = cents(input?.amountPesewas,true), submissionKey = key(input?.requestKey);
    const method = input?.method;
    if (input.reference != null && typeof input.reference !== 'string') throw new Error('Enter a valid payment reference.');
    const reference = input?.reference?.trim() || null;
    if (!['cash','card','mobile_money','bank_transfer','other'].includes(method) || (input.reference != null && (typeof input.reference !== 'string' || input.reference.length>120 || /[\u0000-\u001f]/.test(input.reference)))) throw new Error('Select a valid payment method and reference.');
    const payload = fingerprint({ visitId, amount, method, reference, paidAt: input.paidAt ?? null });
    const existing = db.prepare('SELECT submission_payload FROM payment_receipts WHERE submission_key=?').get(submissionKey);
    if (existing) { if (existing.submission_payload !== payload) throw new Error('This payment submission key was already used for different payment details.'); return read(db,visitId); }
    const visit = base(db,visitId);
    if (visit.currency !== 'GHS') throw new Error('This payment workflow supports GHS visits only.');
    if (visit.status === 'cancelled') throw new Error('Payments cannot be recorded on a cancelled visit.');
    if (amount > visit.outstandingPesewas) throw new Error('Payment exceeds the outstanding balance.');
    const paidAt = stamp(input.paidAt,'payment date');
    const paymentId = Number(db.prepare("INSERT INTO payments(transaction_id,amount,method,reference,status,received_by,paid_at) VALUES(?,?,?,?,'completed',?,?)").run(visitId,amount/100,method,reference,user.id,paidAt).lastInsertRowid);
    db.prepare('INSERT INTO payment_receipts(payment_id,submission_key,submission_payload,amount_pesewas) VALUES(?,?,?,?)').run(paymentId,submissionKey,payload,amount);
    audit(db,user,'visit_payment_recorded',visitId);
    return read(db,visitId);
  }).immediate());
}
module.exports = { registerVisitHandlers };
