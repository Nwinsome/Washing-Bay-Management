const { randomUUID } = require('node:crypto');

// Earlier phase tests still exercise pricing/worker history. Build their completed
// fixtures through the current visit lifecycle, with real test-only vehicle/worker
// records rather than keep an obsolete production route that bypasses visit rules.
function completedVisitFixture(db, rawCall, input) {
  rawCall('transactions:quote',input); // Retain authorization/input checks before fixtures.
  const definitions = input.serviceIds.map(serviceId => db.prepare('SELECT kind FROM service_definitions WHERE service_id=?').get(serviceId));
  const vehicleMode = definitions.some(def => ['washing','blowing'].includes(def.kind));
  let vehicleTypeId = input.vehicleTypeId, vehicleId = input.vehicleId ?? null;
  if (vehicleMode && !vehicleId) {
    if (vehicleTypeId === null) vehicleTypeId = Number(db.prepare("INSERT INTO vehicle_types(name) VALUES(?)").run(`Fixture type ${randomUUID()}`).lastInsertRowid);
    vehicleId = Number(db.prepare('INSERT INTO vehicles(registration_number,vehicle_type_id) VALUES(?,?)').run(`TEST-${randomUUID()}`,vehicleTypeId).lastInsertRowid);
  }
  // General legacy test prices are explicitly configured in the fixture's
  // category; production visits never inherit a general vehicle-service price.
  if (vehicleMode) for (const serviceId of input.serviceIds) {
    const role=db.prepare('SELECT role FROM service_roles WHERE service_id=?').get(serviceId).role;
    const general=db.prepare('SELECT price FROM service_default_prices WHERE service_id=?').get(serviceId);
    if (role!=='independent' && general && !db.prepare('SELECT id FROM service_prices WHERE service_id=? AND vehicle_type_id=?').get(serviceId,vehicleTypeId)) {
      db.prepare('INSERT INTO service_prices(service_id,vehicle_type_id,price) VALUES(?,?,?)').run(serviceId,vehicleTypeId,general.price);
    }
  }
  const assignments = [...(input.assignments ?? [])];
  for (let i=0;i<input.serviceIds.length;i++) {
    const serviceId=input.serviceIds[i];
    if (definitions[i].kind!=='carpet_cleaning' && !assignments.some(item=>item.serviceId===serviceId)) {
      const workerId=Number(db.prepare("INSERT INTO workers(full_name) VALUES('Fixture worker')").run().lastInsertRowid);
      assignments.push({ serviceId,workerId });
    }
  }
  const selection={ mode:vehicleMode?'vehicle':'non_vehicle',vehicleId,vehicleTypeId,serviceIds:input.serviceIds,assignments };
  const quote=rawCall('visits:quote',selection);
  const visit=rawCall('visits:create',{ ...selection,requestKey:randomUUID(),expectedTotalPesewas:Math.round(input.expectedTotal*100),expectedLines:input.expectedLines ?? quote.lines });
  rawCall('visits:status',{ id:visit.id,status:'completed' });
  return { ...visit,total:visit.totalPesewas/100,subtotal:visit.totalPesewas/100 };
}
module.exports = { completedVisitFixture };
