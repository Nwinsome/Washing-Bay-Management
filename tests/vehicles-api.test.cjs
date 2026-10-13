const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { registerApplicationHandlers } = require('../app-api.cjs');
const { completedVisitFixture } = require('./visit-fixtures.cjs');
const schema = fs.readFileSync(path.join(__dirname, '../src/database/schema.sql'), 'utf8');
const hash = bcrypt.hashSync('vehicle-test-password', 12);
function harness() {
  const db = new Database(':memory:'); db.pragma('foreign_keys=ON'); db.exec(schema);
  db.prepare("INSERT INTO business_settings(id,business_name,currency) VALUES(1,'Test Bay','GHS')").run();
  db.prepare("INSERT INTO users(username,password_hash,full_name,role) VALUES('admin',?,'Admin','admin')").run(hash);
  const type = Number(db.prepare("INSERT INTO vehicle_types(name) VALUES('Test category')").run().lastInsertRowid);
  const sender = {}, handlers = {}; let time = Date.parse('2026-10-13T12:00:00Z');
  registerApplicationHandlers({ ipcMain: { handle: (channel, fn) => { handlers[channel] = fn; } }, getDatabase: () => db,
    validateSender: event => { if (event.sender !== sender) throw Error('Untrusted sender'); }, now: () => time });
  const rawCall = (channel, input) => handlers[channel]({ sender }, input);
  const call = (channel, input) => channel === 'transactions:create' ? completedVisitFixture(db,rawCall,input) : rawCall(channel,input);
  return { db, type, handlers, call, advance: ms => { time += ms; }, login: () => call('auth:login', { username: 'admin', password: 'vehicle-test-password' }) };
}
const details = (h, plate = 'GT 1234-26') => ({ registrationNumber: plate, vehicleTypeId: h.type });

test('vehicle registration normalizes display, allows missing and partial contacts and creates no visits/customers', async () => {
  const h = harness();
  try {
    await h.login(); assert.equal(h.call('vehicles:list').total, 0);
    const vehicle = h.call('vehicles:create', { ...details(h, ' gt   1234-26 '), make: ' Test make ', model: 'Test model', color: 'Blue' });
    assert.equal(vehicle.registrationNumber, 'GT 1234-26'); assert.equal(vehicle.make, 'Test make');
    assert.equal(vehicle.customerName, null); assert.equal(vehicle.customerPhone, null); assert.equal(vehicle.isActive, 1); assert.equal(vehicle.visitCount, 0);
    const phoneOnly = h.call('vehicles:create', { ...details(h, 'AS 20-26'), customerPhone: '+233 20 123 4567' });
    assert.equal(phoneOnly.customerName, null); assert.equal(phoneOnly.customerPhone, '+233 20 123 4567');
    const named = h.call('vehicles:create', { ...details(h, 'AS 21-26'), customerName: ' Test Contact ' });
    assert.equal(named.customerName, 'Test Contact'); assert.equal(named.customerPhone, null);
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM customers').get().n, 0);
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM transactions').get().n, 0);
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM users').get().n, 1);
  } finally { h.db.close(); }
});

test('duplicate plates are rejected by API and SQLite, including archived records, and lookup identifies returning vehicles', async () => {
  const h = harness();
  try {
    await h.login(); const vehicle = h.call('vehicles:create', details(h));
    for (const registrationNumber of ['gt123426', 'GT-1234 26', ' GT 1234-26 ']) {
      assert.throws(() => h.call('vehicles:create', details(h, registrationNumber)), /already registered/);
      const lookup = h.call('vehicles:lookup', { registrationNumber });
      assert.equal(lookup.returning, true); assert.equal(lookup.ambiguous, false); assert.equal(lookup.vehicles[0].id, vehicle.id);
    }
    assert.throws(() => h.db.prepare('INSERT INTO vehicles(registration_number) VALUES(?)').run('gt123426'), /already registered/);
    h.call('vehicles:status', { id: vehicle.id, isActive: false });
    assert.throws(() => h.call('vehicles:create', details(h, 'GT123426')), /already registered/);
    assert.equal(h.call('vehicles:lookup', { registrationNumber: 'gt123426' }).vehicles[0].isActive, 0);
    h.call('vehicles:status', { id: vehicle.id, isActive: true });
    assert.equal(h.call('vehicles:list', { status: 'active' }).total, 1);
    assert.equal(h.call('vehicles:lookup', { registrationNumber: 'XX 9999' }).returning, false);
  } finally { h.db.close(); }
});

test('vehicle edits retain IDs and untouched fields and searches cover plates, names, phones, status and type', async () => {
  const h = harness();
  try {
    await h.login(); const vehicle = h.call('vehicles:create', details(h));
    const another = h.call('vehicles:create', details(h, 'AS 55-26'));
    h.db.prepare("UPDATE vehicles SET year=2020,notes='Existing note' WHERE id=?").run(vehicle.id);
    const updated = h.call('vehicles:update', { ...details(h, 'GT 8888-26'), id: vehicle.id, customerName: "O'Brien Contact", customerPhone: '+233 20 123 4567', make: 'Make', model: 'Model', color: 'White' });
    assert.equal(updated.id, vehicle.id); assert.equal(updated.color, 'White'); assert.equal(updated.createdAt, vehicle.createdAt);
    assert.deepEqual(h.db.prepare('SELECT year,notes FROM vehicles WHERE id=?').get(vehicle.id), { year: 2020, notes: 'Existing note' });
    for (const search of ['gt888826', "o'brien", '233201234567', '20 123']) assert.equal(h.call('vehicles:list', { search }).vehicles[0].id, vehicle.id);
    for (const search of ["' OR 1=1 --", '%', '_', 'no-match']) assert.equal(h.call('vehicles:list', { search }).total, 0);
    assert.throws(() => h.call('vehicles:update', { ...details(h, 'AS55 26'), id: vehicle.id }), /already has/);
    h.call('vehicles:status', { id: another.id, isActive: false });
    assert.equal(h.call('vehicles:list', { status: 'archived' }).vehicles[0].id, another.id);
    assert.equal(h.call('vehicles:list', { status: 'active', vehicleTypeId: h.type }).total, 1);
    const newType = h.call('vehicle-types:add', { name: 'Second category' }).id;
    assert.equal(h.call('vehicles:list', { vehicleTypeId: newType }).total, 0);
  } finally { h.db.close(); }
});

test('vehicle search pagination returns stable distinct pages', async () => {
  const h = harness();
  try {
    await h.login();
    const insert = h.db.prepare('INSERT INTO vehicles(registration_number,vehicle_type_id) VALUES(?,?)');
    for (let i = 0; i < 51; i++) insert.run(`TEST ${String(i).padStart(4, '0')}`, h.type);
    const first = h.call('vehicles:list', { search: 'TEST', offset: 0 });
    const second = h.call('vehicles:list', { search: 'TEST', offset: 50 });
    assert.equal(first.total, 51); assert.equal(first.vehicles.length, 50); assert.equal(second.vehicles.length, 1);
    assert.equal(first.vehicles[0].registrationNumber, 'TEST 0000'); assert.equal(second.vehicles[0].registrationNumber, 'TEST 0050');
    assert.equal(new Set([...first.vehicles, ...second.vehicles].map(v => v.id)).size, 51);
  } finally { h.db.close(); }
});

test('repeat visits use registered vehicles, reject archived/type mismatch, and preserve historical snapshots after edits', async () => {
  const h = harness();
  try {
    await h.login();
    const vehicle = h.call('vehicles:create', { ...details(h), customerName: 'Original Contact', customerPhone: '0201234567', color: 'Blue' });
    const wash = h.call('services:add', { name: 'Washing' }).id;
    h.call('services:price', { serviceId: wash, vehicleTypeId: h.type, price: 10 });
    const workerId = Number(h.db.prepare("INSERT INTO workers(full_name) VALUES('Test Worker')").run().lastInsertRowid);
    const selection = { vehicleId: vehicle.id, vehicleTypeId: h.type, serviceIds: [wash], assignments: [{ serviceId: wash, workerId }] };
    const first = h.call('transactions:create', { ...selection, expectedTotal: 10 });
    const original = h.call('transactions:get', { id: first.id });
    h.call('transactions:create', { ...selection, expectedTotal: 10 });
    assert.equal(h.call('vehicles:lookup', { registrationNumber: vehicle.registrationNumber }).vehicles[0].visitCount, 2);
    assert.equal(original.vehicle.registrationNumber, vehicle.registrationNumber); assert.equal(original.vehicle.provenance, 'recorded');
    assert.throws(() => h.call('transactions:quote', { ...selection, vehicleTypeId: null }), /registered vehicle type/);
    h.call('vehicles:update', { ...details(h, 'GT 9999-26'), id: vehicle.id, color: 'Red', customerName: 'Changed Contact' });
    h.call('vehicles:status', { id: vehicle.id, isActive: false });
    assert.throws(() => h.call('transactions:create', { ...selection, expectedTotal: 10 }), /active registered vehicle/);
    assert.deepEqual(h.call('transactions:get', { id: first.id }), original);
    assert.throws(() => h.db.prepare("UPDATE transaction_vehicle_snapshots SET color='Changed' WHERE transaction_id=?").run(first.id), /immutable/);
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM transactions WHERE vehicle_id=?').get(vehicle.id).n, 2);
    const dashboardVisit = h.call('dashboard:get').recent.find(row => row.id === first.id);
    assert.equal(dashboardVisit.vehicle, vehicle.registrationNumber); assert.equal(dashboardVisit.customer, 'Original Contact');
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM payments').get().n, 0);
  } finally { h.db.close(); }
});

test('invalid vehicle inputs and failed audit writes leave data unchanged', async () => {
  const h = harness();
  try {
    await h.login(); const vehicle = h.call('vehicles:create', details(h));
    const invalid = [null, {}, { ...details(h), registrationNumber: '' }, { ...details(h), registrationNumber: '---' }, { ...details(h), registrationNumber: 'GT@1' }, { ...details(h), registrationNumber: 'GT\u00001' }, { ...details(h), registrationNumber: 'G'.repeat(33) }, { ...details(h), vehicleTypeId: 999 }, { ...details(h), vehicleTypeId: '1' }, { ...details(h), vehicleTypeId: 0 }, { ...details(h), customerPhone: '123' }, { ...details(h), customerName: 5 }, { ...details(h), make: 'x'.repeat(81) }, { ...details(h), model: false }, { ...details(h), color: 'x'.repeat(61) }];
    for (const input of invalid) { assert.throws(() => h.call('vehicles:create', input)); assert.throws(() => h.call('vehicles:update', { ...input, id: vehicle.id })); }
    for (const id of [0, -1, 1.5, '1', 999]) { assert.throws(() => h.call('vehicles:update', { ...details(h), id })); assert.throws(() => h.call('vehicles:status', { id, isActive: false })); }
    for (const isActive of [1, 'false', null]) assert.throws(() => h.call('vehicles:status', { id: vehicle.id, isActive }));
    for (const input of [null, [], { search: 2 }, { offset: -1 }, { offset: 0.1 }, { status: 'bad' }, { vehicleTypeId: '1' }]) assert.throws(() => h.call('vehicles:list', input));
    assert.deepEqual(h.call('vehicles:list').vehicles, [vehicle]);
    h.db.exec("CREATE TRIGGER fail_vehicle_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'audit unavailable'); END");
    assert.throws(() => h.call('vehicles:create', details(h, 'AS 12-26')), /audit unavailable/);
    assert.throws(() => h.call('vehicles:update', { ...details(h, 'GT 1111'), id: vehicle.id }), /audit unavailable/);
    assert.throws(() => h.call('vehicles:status', { id: vehicle.id, isActive: false }), /audit unavailable/);
    assert.deepEqual(h.call('vehicles:list').vehicles, [vehicle]);
  } finally { h.db.close(); }
});

test('vehicle operations require trusted current administrator sessions', async () => {
  const h = harness(); const channels = ['vehicles:list', 'vehicles:lookup', 'vehicles:create', 'vehicles:update', 'vehicles:status'];
  try {
    for (const channel of channels) assert.throws(() => h.call(channel, {}), /SESSION_EXPIRED/);
    await h.login(); for (const channel of channels) assert.throws(() => h.handlers[channel]({ sender: {} }, {}), /Untrusted/);
    h.advance(30 * 60000); for (const channel of channels) assert.throws(() => h.call(channel, {}), /SESSION_EXPIRED/);
    await h.login(); h.db.prepare("UPDATE users SET role='cashier'").run();
    for (const channel of channels) assert.throws(() => h.call(channel, {}), /SESSION_EXPIRED/);
    h.db.prepare("UPDATE users SET role='admin'").run(); await h.login(); h.call('auth:logout');
    for (const channel of channels) assert.throws(() => h.call(channel, {}), /SESSION_EXPIRED/);
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM vehicles').get().n, 0);
  } finally { h.db.close(); }
});

test('additive upgrade preserves legacy vehicles, shared contacts, colliding plates and migration snapshots', () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys=ON');
    // Actual pre-vehicle-module schema, before metadata/normalization/snapshot additions.
    db.exec(schema.slice(0, schema.indexOf('    -- Additive vehicle metadata')));
    db.prepare("INSERT INTO business_settings(id,business_name) VALUES(1,'Existing Bay')").run();
    db.prepare("INSERT INTO users(username,password_hash,full_name,role) VALUES('existing',?,'Admin','admin')").run(hash);
    db.prepare("INSERT INTO customers(full_name,phone) VALUES('Existing Contact','0201234567')").run();
    db.prepare("INSERT INTO vehicles(registration_number,customer_id,color) VALUES('GT 1234-26',1,'Blue'),('gt123426',1,'Red')").run();
    db.prepare("INSERT INTO transactions(transaction_number,vehicle_id,customer_id,total) VALUES('old-visit',1,1,50)").run();
    db.prepare("INSERT INTO workers(full_name,pay_rate) VALUES('Existing Worker',15)").run();
    db.prepare("INSERT INTO services(name) VALUES('Washing')").run();
    db.prepare('INSERT INTO service_default_prices(service_id,price) VALUES(1,50)').run();
    db.prepare("INSERT INTO transaction_services(transaction_id,service_id,service_name,unit_price,line_total) VALUES(1,1,'Washing',50,50)").run();
    db.prepare('INSERT INTO transaction_workers(transaction_id,worker_id) VALUES(1,1)').run();
    db.prepare("INSERT INTO payments(transaction_id,amount,method) VALUES(1,50,'cash')").run();
    const original = {};
    for (const table of ['business_settings', 'users', 'customers', 'vehicles', 'transactions', 'workers', 'services', 'service_default_prices', 'transaction_services', 'payments']) original[table] = db.prepare(`SELECT * FROM ${table}`).all();
    db.transaction(() => db.exec(schema))(); db.transaction(() => db.exec(schema))();
    for (const table of Object.keys(original)) assert.deepEqual(db.prepare(`SELECT * FROM ${table}`).all(), original[table]);
    assert.equal(db.prepare('SELECT count(*) AS n FROM vehicle_registry WHERE is_active=1').get().n, 2);
    const snap = db.prepare('SELECT * FROM transaction_vehicle_snapshots').get();
    assert.equal(snap.provenance, 'migration'); assert.equal(snap.customer_name, 'Existing Contact');
    db.prepare("UPDATE vehicles SET color='Black' WHERE id=1").run();
    db.exec(schema); assert.deepEqual(db.prepare('SELECT * FROM transaction_vehicle_snapshots').get(), snap);
    db.prepare('UPDATE vehicle_record_state SET is_active=0 WHERE vehicle_id=2').run();
    assert.throws(() => db.prepare('UPDATE vehicle_record_state SET is_active=1 WHERE vehicle_id=2').run(), /Another active/);
    assert.throws(() => db.prepare("INSERT INTO vehicles(registration_number) VALUES('GT-123426')").run(), /already registered/);
  } finally { db.close(); }
});
