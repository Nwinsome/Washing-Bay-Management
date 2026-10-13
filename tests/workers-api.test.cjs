const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { registerApplicationHandlers } = require('../app-api.cjs');
const { completedVisitFixture } = require('./visit-fixtures.cjs');

const schema = fs.readFileSync(path.join(__dirname, '../src/database/schema.sql'), 'utf8');
const hash = bcrypt.hashSync('worker-test-password', 12);
const details = { fullName: 'Test Worker', phone: '+233 20 123 4567', email: 'worker@example.test', jobTitle: 'Team member', hireDate: '2026-10-13' };
function harness() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys=ON'); db.exec(schema);
  db.prepare("INSERT INTO business_settings(id,business_name,currency) VALUES(1,'Test Bay','GHS')").run();
  db.prepare("INSERT INTO users(username,password_hash,full_name,role) VALUES('admin',?,'Test Admin','admin')").run(hash);
  const sender = {}, handlers = {};
  let time = Date.parse('2026-10-13T12:00:00Z');
  registerApplicationHandlers({ ipcMain: { handle: (channel, handler) => { handlers[channel] = handler; } }, getDatabase: () => db,
    validateSender: event => { if (event.sender !== sender) throw Error('Untrusted sender'); }, now: () => time });
  const rawCall = (channel, input) => handlers[channel]({ sender }, input);
  const call = (channel, input) => channel === 'transactions:create' ? completedVisitFixture(db,rawCall,input) : rawCall(channel,input);
  return { db, handlers, call, advance: ms => { time += ms; }, login: () => call('auth:login', { username: 'admin', password: 'worker-test-password' }) };
}

test('registers workers with trimmed details, active status and no login or service restriction', async () => {
  const h = harness();
  try {
    await h.login();
    assert.equal(h.call('workers:list').total, 0);
    const worker = h.call('workers:create', { ...details, fullName: ' Test Worker ', phone: ' +233 20 123 4567 ', role: 'admin', serviceId: 99 });
    assert.equal(worker.fullName, details.fullName); assert.equal(worker.phone, details.phone);
    assert.equal(worker.email, details.email); assert.equal(worker.jobTitle, details.jobTitle); assert.equal(worker.hireDate, details.hireDate);
    assert.equal(worker.isActive, 1); assert.ok(worker.createdAt); assert.ok(worker.updatedAt);
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM users').get().n, 1);
    assert.equal(h.db.prepare('SELECT pay_rate FROM workers WHERE id=?').get(worker.id).pay_rate, 0);
    assert.deepEqual(h.call('workers:list').counts, { total: 1, active: 1, inactive: 0 });
    const minimal = h.call('workers:create', { fullName: 'Minimal Worker', phone: '0201234567' });
    assert.equal(minimal.email, null); assert.equal(minimal.jobTitle, null); assert.equal(minimal.hireDate, null);
    assert.deepEqual(h.db.prepare('SELECT action,entity_type,entity_id FROM audit_logs ORDER BY id LIMIT 1').get(), { action: 'worker_created', entity_type: 'worker', entity_id: worker.id });
  } finally { h.db.close(); }
});

test('edits details without changing worker ID, status, pay rate or administrator credentials', async () => {
  const h = harness();
  try {
    await h.login();
    const worker = h.call('workers:create', details);
    h.db.prepare('UPDATE workers SET pay_rate=123.45 WHERE id=?').run(worker.id);
    const originalUser = h.db.prepare('SELECT * FROM users').get();
    h.call('workers:status', { id: worker.id, isActive: false });
    const updated = h.call('workers:update', { id: worker.id, fullName: "O'Brien Updated", phone: '0301234567', email: '', jobTitle: 'Supervisor', hireDate: '2024-02-29', isActive: true, payRate: 999 });
    assert.equal(updated.id, worker.id); assert.equal(updated.fullName, "O'Brien Updated"); assert.equal(updated.phone, '0301234567');
    assert.equal(updated.email, null); assert.equal(updated.jobTitle, 'Supervisor'); assert.equal(updated.isActive, 0);
    assert.equal(updated.createdAt, worker.createdAt);
    assert.equal(h.db.prepare('SELECT pay_rate FROM workers WHERE id=?').get(worker.id).pay_rate, 123.45);
    assert.deepEqual(h.db.prepare('SELECT * FROM users').get(), originalUser);
    assert.throws(() => h.call('workers:update', { ...details, id: 999 }), /does not exist/);
    assert.equal(h.call('workers:list').total, 1);
  } finally { h.db.close(); }
});

test('searches name, phone, email and title, treats SQL and wildcard text literally, filters and paginates', async () => {
  const h = harness();
  try {
    await h.login();
    const first = h.call('workers:create', details);
    const second = h.call('workers:create', { fullName: 'Another Worker', phone: '0301234567', jobTitle: 'Shift lead' });
    h.call('workers:status', { id: second.id, isActive: false });
    for (const search of ['TEST WORKER', '20 123', 'EXAMPLE.TEST', 'TEAM MEMBER']) assert.equal(h.call('workers:list', { search }).workers[0].id, first.id);
    for (const search of ["' OR 1=1 --", '%', '_', 'no-match']) assert.equal(h.call('workers:list', { search }).total, 0);
    assert.equal(h.call('workers:list', { status: 'active' }).workers[0].id, first.id);
    assert.equal(h.call('workers:list', { status: 'inactive' }).workers[0].id, second.id);
    const add = h.db.prepare('INSERT INTO workers(full_name,phone) VALUES(?,?)');
    for (let i = 0; i < 51; i++) add.run(`Page Worker ${String(i).padStart(2, '0')}`, '0201234567');
    const page1 = h.call('workers:list', { search: 'Page Worker' });
    const page2 = h.call('workers:list', { search: 'Page Worker', offset: 50 });
    assert.equal(page1.workers.length, 50); assert.equal(page2.workers.length, 1); assert.equal(page1.total, 51);
    assert.equal(page1.workers[0].fullName, 'Page Worker 00'); assert.equal(page2.workers[0].fullName, 'Page Worker 50');
    assert.equal(new Set([...page1.workers, ...page2.workers].map(w => w.id)).size, 51);
  } finally { h.db.close(); }
});

test('activation and deactivation preserve service assignments, payments and existing business data', async () => {
  const h = harness();
  try {
    await h.login();
    const worker = h.call('workers:create', details);
    const other = h.call('workers:create', { ...details, fullName: 'Other Worker' });
    const wash = h.call('services:add', { name: 'Washing' }).id;
    const blow = h.call('services:add', { name: 'Blowing' }).id;
    const carpet = h.call('services:add', { name: 'Carpet cleaning' }).id;
    for (const serviceId of [wash, blow, carpet]) h.call('services:price', { serviceId, vehicleTypeId: null, price: 10 });
    const visit = h.call('transactions:create', { vehicleTypeId: null, serviceIds: [wash, carpet], assignments: [{ serviceId: wash, workerId: worker.id }, { serviceId: carpet, workerId: other.id }], expectedTotal: 20 });
    const historical = h.call('transactions:get', { id: visit.id });
    h.db.prepare('INSERT INTO transaction_workers(transaction_id,worker_id) VALUES(?,?)').run(visit.id, worker.id);
    h.db.prepare('INSERT INTO worker_payments(worker_id,amount) VALUES(?,5)').run(worker.id);
    const settings = h.db.prepare('SELECT * FROM business_settings').get();
    const inactive = h.call('workers:status', { id: worker.id, isActive: false });
    assert.equal(inactive.isActive, 0);
    assert.equal(h.call('services:get').workers.some(w => w.id === worker.id), false);
    assert.equal(h.call('dashboard:get').summary.activeWorkers, 1);
    assert.throws(() => h.call('transactions:create', { vehicleTypeId: null, serviceIds: [blow], assignments: [{ serviceId: blow, workerId: worker.id }], expectedTotal: 10 }), /unavailable/);
    h.call('workers:update', { ...details, id: worker.id, fullName: 'Changed Name' });
    assert.deepEqual(h.call('transactions:get', { id: visit.id }), historical);
    assert.equal(h.db.prepare('SELECT worker_id FROM transaction_workers').get().worker_id, worker.id);
    assert.equal(h.db.prepare('SELECT amount FROM worker_payments').get().amount, 5);
    h.call('workers:status', { id: worker.id, isActive: true });
    const nextVisit = h.call('transactions:create', { vehicleTypeId: null, serviceIds: [blow], assignments: [{ serviceId: blow, workerId: worker.id }], expectedTotal: 10 });
    assert.equal(nextVisit.lines[0].workerAssignment.workerName, 'Changed Name');
    assert.equal(h.call('dashboard:get').summary.activeWorkers, 2);
    const prices = h.call('services:get').prices;
    const workers = h.db.prepare('SELECT * FROM workers ORDER BY id').all();
    h.db.exec(schema);
    assert.deepEqual(h.db.prepare('SELECT * FROM workers ORDER BY id').all(), workers);
    assert.deepEqual(h.db.prepare('SELECT * FROM business_settings').get(), settings);
    assert.deepEqual(h.call('services:get').prices, prices);
    assert.deepEqual(h.call('transactions:get', { id: visit.id }), historical);
    assert.equal(h.handlers['workers:delete'], undefined);
  } finally { h.db.close(); }
});

test('invalid worker details, IDs, status and filters fail without mutations', async () => {
  const h = harness();
  try {
    await h.login();
    const worker = h.call('workers:create', details);
    const invalid = [null, {}, { ...details, fullName: '' }, { ...details, fullName: '   ' }, { ...details, fullName: 7 }, { ...details, fullName: 'x'.repeat(121) }, { ...details, fullName: 'bad\u0000name' }, { ...details, phone: '' }, { ...details, phone: '123' }, { ...details, phone: '1'.repeat(16) }, { ...details, phone: 'not a phone' }, { ...details, email: 'bad-email' }, { ...details, email: 9 }, { ...details, jobTitle: 'x'.repeat(121) }, { ...details, hireDate: '2025-02-29' }, { ...details, hireDate: '2026-13-01' }, { ...details, hireDate: '13/10/2026' }];
    for (const input of invalid) {
      assert.throws(() => h.call('workers:create', input));
      assert.throws(() => h.call('workers:update', { ...input, id: worker.id }));
    }
    for (const id of [0, -1, 1.5, '1', null, 999]) {
      assert.throws(() => h.call('workers:update', { ...details, id }));
      assert.throws(() => h.call('workers:status', { id, isActive: false }));
    }
    for (const isActive of [1, 0, 'false', null, undefined]) assert.throws(() => h.call('workers:status', { id: worker.id, isActive }));
    for (const input of [null, [], { search: 1 }, { search: 'x'.repeat(121) }, { status: 'unknown' }, { offset: -1 }, { offset: 1.5 }, { offset: '0' }]) assert.throws(() => h.call('workers:list', input));
    assert.deepEqual(h.call('workers:list').workers, [worker]);
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM audit_logs').get().n, 1);
  } finally { h.db.close(); }
});

test('all worker IPC operations require a trusted window and a current active administrator', async () => {
  const h = harness();
  const channels = ['workers:list', 'workers:create', 'workers:update', 'workers:status'];
  try {
    for (const channel of channels) assert.throws(() => h.call(channel, {}), /SESSION_EXPIRED/);
    await h.login();
    for (const channel of channels) assert.throws(() => h.handlers[channel]({ sender: {} }, {}), /Untrusted/);
    h.advance(30 * 60000);
    for (const channel of channels) assert.throws(() => h.call(channel, {}), /SESSION_EXPIRED/);
    await h.login(); h.db.prepare("UPDATE users SET role='cashier'").run();
    for (const channel of channels) assert.throws(() => h.call(channel, {}), /SESSION_EXPIRED/);
    h.db.prepare("UPDATE users SET role='admin'").run(); await h.login();
    h.db.prepare('UPDATE users SET is_active=0').run();
    for (const channel of channels) assert.throws(() => h.call(channel, {}), /SESSION_EXPIRED/);
    h.db.prepare('UPDATE users SET is_active=1').run(); await h.login(); h.call('auth:logout');
    for (const channel of channels) assert.throws(() => h.call(channel, {}), /SESSION_EXPIRED/);
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM workers').get().n, 0);
  } finally { h.db.close(); }
});
