const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { registerApplicationHandlers } = require('../app-api.cjs');
const { completedVisitFixture } = require('./visit-fixtures.cjs');
const hash = bcrypt.hashSync('test-password', 12);
// Prices below are test fixtures only, never application defaults.
function harness() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys=ON');
  db.exec(fs.readFileSync(path.join(__dirname,'../src/database/schema.sql'),'utf8'));
  db.prepare("INSERT INTO business_settings(id,business_name,currency) VALUES(1,'Test Bay','GHS')").run();
  db.prepare("INSERT INTO users(username,password_hash,full_name,role) VALUES('admin',?,'Test Admin','admin')").run(hash);
  const sender={}, handlers={};let time=Date.parse('2026-10-12T12:00:00Z');
  const controller=registerApplicationHandlers({ipcMain:{handle:(name,fn)=>handlers[name]=fn},getDatabase:()=>db,validateSender:event=>{if(event.sender!==sender)throw Error('Untrusted sender');},now:()=>time});
  const rawCall=(name,input)=>handlers[name]({sender},input);
  const call=(name,input)=>name==='transactions:create' ? completedVisitFixture(db,rawCall,input) : rawCall(name,input);
  return {db,handlers,sender,controller,call,advance:ms=>time+=ms,login:(input={username:'admin',password:'test-password'})=>call('auth:login',input)};
}

test('washing and blowing are exclusive in the API and database, even after renaming', async () => {
  const h = harness();
  try {
    await h.login();
    const wash = h.call('services:add', { name: ' WASH ' }).id;
    const blow = h.call('services:add', { name: 'Blowing' }).id;
    const custom = h.call('services:add', { name: 'Air treatment', kind: 'blowing' }).id;
    for (const serviceId of [wash, blow, custom]) h.call('services:price', { serviceId, vehicleTypeId: null, price: 10 });
    assert.throws(() => h.call('services:add', { name: 'Washing', kind: 'other' }), /classification must match/);
    assert.throws(() => h.call('services:kind', { serviceId: wash, kind: 'other' }), /cannot be changed/);
    h.db.prepare("UPDATE services SET name='Renamed washing' WHERE id=?").run(wash);
    for (const serviceIds of [[wash, blow], [wash, custom], [blow, custom]]) {
      const input = { vehicleTypeId: null, serviceIds, expectedTotal: 20 };
      assert.throws(() => h.call('transactions:quote', input), /either washing or blowing/);
      assert.throws(() => h.call('transactions:create', input), /either washing or blowing/);
    }
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM transactions').get().n, 0);
    const saved = h.call('transactions:create', { vehicleTypeId: null, serviceIds: [wash], expectedTotal: 10 });
    const insert = h.db.prepare('INSERT INTO transaction_services(transaction_id,service_id,service_name,unit_price,line_total) VALUES(?,?,?,?,?)');
    assert.throws(() => insert.run(saved.id, blow, 'Blowing', 10, 10), /either washing or blowing/);
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM transaction_services').get().n, 1);
    assert.equal(h.call('transactions:get', { id: saved.id }).lines[0].serviceKind, 'washing');
    const other = h.call('services:add', { name: 'Unclassified custom service' }).id;
    h.call('services:kind', { serviceId: other, kind: 'carpet_cleaning' });
    assert.equal(h.call('services:get').services.find(s => s.id === other).kind, 'carpet_cleaning');
  } finally { h.db.close(); }
});

test('schema upgrade keeps old combined visits and rejects new conflicting inserts and updates', () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys=ON');
    const schema = fs.readFileSync(path.join(__dirname, '../src/database/schema.sql'), 'utf8');
    db.exec(schema);
    // Emulate a database from before the new visit validation/snapshot triggers existed.
    db.exec('DROP TRIGGER snapshot_service_kind; DROP TRIGGER exclusive_vehicle_service_update;');
    db.prepare("INSERT INTO transactions(transaction_number,total) VALUES('legacy',30),('separate',5)").run();
    const insert = db.prepare('INSERT INTO transaction_services(transaction_id,service_name,unit_price,line_total) VALUES(?,?,?,?)');
    insert.run(1, 'Washing', 20, 20); insert.run(1, 'Blowing', 10, 10); insert.run(2, 'Carpet cleaning', 5, 5);
    const original = db.prepare('SELECT * FROM transaction_services ORDER BY id').all();
    db.exec(schema); db.exec(schema);
    assert.deepEqual(db.prepare('SELECT * FROM transaction_services ORDER BY id').all(), original);
    assert.deepEqual(db.prepare('SELECT service_kind,legacy_record FROM visit_service_records WHERE transaction_id=1 ORDER BY id').all(), [{ service_kind: 'washing', legacy_record: 1 }, { service_kind: 'blowing', legacy_record: 1 }]);
    assert.throws(() => insert.run(1, 'Washing', 20, 20), /either washing or blowing/);
    assert.throws(() => db.prepare("UPDATE transaction_services SET transaction_id=1,service_name='Washing' WHERE transaction_id=2").run(), /either washing or blowing/);
    assert.deepEqual(db.prepare('SELECT * FROM transaction_services ORDER BY id').all(), original);
  } finally { db.close(); }
});

test('workers can wash one visit and blow another while preserving historical earnings', async () => {
  const h = harness();
  try {
    await h.login();
    const wash = h.call('services:add', { name: 'Washing' }).id;
    const blow = h.call('services:add', { name: 'Blowing' }).id;
    const carpet = h.call('services:add', { name: 'Carpet cleaning' }).id;
    const worker = Number(h.db.prepare("INSERT INTO workers(full_name,pay_rate) VALUES('Worker A',999)").run().lastInsertRowid);
    const other = Number(h.db.prepare("INSERT INTO workers(full_name) VALUES('Worker B')").run().lastInsertRowid);
    for (const [serviceId, price] of [[wash, 20], [blow, 10], [carpet, 15]]) h.call('services:price', { serviceId, vehicleTypeId: null, price });
    h.db.prepare("INSERT INTO service_compensation_rules(service_id,method,rate) VALUES(?,'fixed',3),(?,'percentage',25)").run(wash, blow);
    const selection = { vehicleTypeId: null, serviceIds: [wash, carpet], assignments: [{ serviceId: wash, workerId: worker }, { serviceId: carpet, workerId: other }] };
    const quote = h.call('transactions:quote', selection);
    assert.equal(quote.total, 35);
    assert.deepEqual(quote.lines.map(line => line.workerAssignment.earnings), [3, null]);
    const completed = h.call('transactions:create', { ...selection, expectedTotal: quote.total, expectedLines: quote.lines });
    const saved = h.call('transactions:get', { id: completed.id });
    assert.deepEqual(saved.lines, quote.lines);
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM transactions').get().n, 1);
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM transaction_service_workers').get().n, 2);
    const blowing = h.call('transactions:create', { vehicleTypeId: null, serviceIds: [blow], assignments: [{ serviceId: blow, workerId: worker }], expectedTotal: 10 });
    assert.equal(blowing.lines[0].workerAssignment.earnings, 2.5);
    assert.equal(blowing.lines[0].workerAssignment.workerId, worker);
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM transactions').get().n, 2);
    h.db.prepare("UPDATE workers SET full_name='Changed',is_active=0 WHERE id=?").run(worker);
    h.db.prepare('UPDATE service_compensation_rules SET rate=50').run();
    h.call('services:price', { serviceId: wash, vehicleTypeId: null, price: 30 });
    assert.deepEqual(h.call('transactions:get', { id: saved.id }), saved);
    // Legacy visit-level assignments remain distinct and are never guessed into lines.
    h.db.prepare('INSERT INTO transaction_workers(transaction_id,worker_id) VALUES(?,?)').run(saved.id, other);
    h.db.exec(fs.readFileSync(path.join(__dirname, '../src/database/schema.sql'), 'utf8'));
    assert.deepEqual(h.call('transactions:get', { id: saved.id }), saved);
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM transaction_workers').get().n, 1);
    // An assigned worker's deletion preserves the recorded name, rule and earnings.
    h.db.prepare('DELETE FROM workers WHERE id=?').run(worker);
    const deleted = h.call('transactions:get', { id: saved.id });
    assert.equal(deleted.lines[0].workerAssignment.workerId, null);
    assert.equal(deleted.lines[0].workerAssignment.workerName, 'Worker A');
    assert.equal(deleted.lines[0].workerAssignment.earnings, 3);
  } finally { h.db.close(); }
});

test('assignment validation, optional assignment, and stale compensation review', async () => {
  const h = harness();
  try {
    await h.login();
    const serviceId = h.call('services:add', { name: 'Service' }).id;
    h.call('services:price', { serviceId, vehicleTypeId: null, price: 10 });
    const workerId = Number(h.db.prepare("INSERT INTO workers(full_name) VALUES('Worker')").run().lastInsertRowid);
    const selection = { vehicleTypeId: null, serviceIds: [serviceId] };
    assert.equal(h.call('transactions:quote', selection).lines[0].workerAssignment, null);
    for (const assignments of [{}, [{ serviceId, workerId: 999 }], [{ serviceId: 999, workerId }], [{ serviceId, workerId }, { serviceId, workerId }]]) assert.throws(() => h.call('transactions:quote', { ...selection, assignments }));
    const assigned = { ...selection, assignments: [{ serviceId, workerId }] };
    const quote = h.call('transactions:quote', assigned);
    assert.equal(quote.lines[0].workerAssignment.earnings, null);
    h.db.prepare("INSERT INTO service_compensation_rules(service_id,method,rate) VALUES(?,'fixed',0)").run(serviceId);
    assert.throws(() => h.call('transactions:create', { ...assigned, expectedTotal: quote.total, expectedLines: quote.lines }), /compensation changed/);
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM transactions').get().n, 0);
    const fresh = h.call('transactions:quote', assigned);
    assert.equal(fresh.lines[0].workerAssignment.earnings, 0);
    h.db.prepare('UPDATE workers SET is_active=0 WHERE id=?').run(workerId);
    assert.throws(() => h.call('transactions:create', { ...assigned, expectedTotal: 10 }), /worker is unavailable/);
    assert.equal(h.call('services:get').workers.length, 0);
  } finally { h.db.close(); }
});

test('independent services, vehicle pricing, general carpet price and immutable completed lines', async () => {
  const h = harness();
  try {
    assert.throws(() => h.call('services:get'), /SESSION_EXPIRED/);
    await h.login();
    const car = h.call('vehicle-types:add', { name: 'Test car' }).id;
    const van = h.call('vehicle-types:add', { name: 'Test van' }).id;
    const wash = h.call('services:add', { name: 'Washing' }).id;
    const blow = h.call('services:add', { name: 'Blowing' }).id;
    const carpet = h.call('services:add', { name: 'Carpet cleaning' }).id;
    const set = (serviceId, vehicleTypeId, price) => h.call('services:price', { serviceId, vehicleTypeId, price });
    const quote = serviceIds => h.call('transactions:quote', { vehicleTypeId: car, serviceIds });
    assert.equal(h.call('services:get').prices.length, 0);
    assert.throws(() => quote([wash]), /Configure a price/);
    set(wash, car, 12.25); set(blow, car, 3.5); set(carpet, null, 8.75);
    set(wash, van, 20); set(blow, van, 6);
    assert.equal(quote([wash]).total, 12.25);
    assert.equal(quote([blow]).total, 3.5);
    assert.throws(() => quote([wash, blow]), /either washing or blowing/);
    assert.equal(quote([carpet]).total, 8.75);
    assert.equal(h.call('transactions:quote', { vehicleTypeId: van, serviceIds: [wash] }).total, 20);
    assert.equal(h.call('transactions:quote', { vehicleTypeId: van, serviceIds: [blow] }).total, 6);
    const completed = h.call('transactions:create', { vehicleTypeId: car, serviceIds: [wash, carpet], expectedTotal: 21 });
    const original = h.call('transactions:get', { id: completed.id });
    set(wash, car, 13); set(blow, car, 4); set(carpet, null, 9);
    assert.equal(quote([wash, carpet]).total, 22);
    assert.deepEqual(h.call('transactions:get', { id: completed.id }), original);
    h.db.prepare("UPDATE services SET name='Renamed service' WHERE id=?").run(wash);
    assert.deepEqual(h.call('transactions:get', { id: completed.id }), original);
    assert.equal(original.lines[0].serviceName, 'Washing');
    assert.equal(original.status, 'completed');
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM payments').get().n, 0);
    // Reapplying the additive schema leaves business data and snapshots intact.
    h.db.exec(fs.readFileSync(path.join(__dirname, '../src/database/schema.sql'), 'utf8'));
    assert.deepEqual(h.call('transactions:get', { id: completed.id }), original);
    assert.equal(h.call('services:get').prices.length, 5);
  } finally { h.db.close(); }
});

test('pricing validation, missing prices, stale totals and extensible service selection', async () => {
  const h = harness();
  try {
    await h.login();
    const serviceId = h.call('services:add', { name: 'Future service' }).id;
    for (const price of [-1, NaN, Infinity, '10', 1.001]) assert.throws(() => h.call('services:price', { serviceId, vehicleTypeId: null, price }), /price/);
    h.call('services:price', { serviceId, vehicleTypeId: null, price: 0.1 });
    const selection = { vehicleTypeId: null, serviceIds: [serviceId] };
    assert.equal(h.call('transactions:quote', selection).total, 0.1);
    for (const serviceIds of [[], [serviceId, serviceId], [999], ['1']]) assert.throws(() => h.call('transactions:quote', { ...selection, serviceIds }));
    assert.throws(() => h.call('transactions:quote', { ...selection, vehicleTypeId: 999 }));
    assert.throws(() => h.call('transactions:create', { ...selection, expectedTotal: 0 }), /Prices changed/);
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM transactions').get().n, 0);
    h.call('services:price', { serviceId, vehicleTypeId: null, price: 0 });
    assert.equal(h.call('transactions:create', { ...selection, expectedTotal: 0 }).total, 0);
    h.db.prepare('UPDATE services SET is_active=0 WHERE id=?').run(serviceId);
    assert.throws(() => h.call('transactions:quote', selection), /unavailable/);
    h.call('auth:logout');
    for (const channel of ['services:add', 'vehicle-types:add', 'services:price', 'transactions:quote', 'transactions:create', 'transactions:get']) assert.throws(() => h.call(channel, {}), /SESSION_EXPIRED/);
  } finally { h.db.close(); }
});
test('real bcrypt login, safe user fields, protected dashboard, logout and per-window isolation',async()=>{
  const h=harness();try{
    assert.equal(h.call('auth:session'),null);
    assert.throws(()=>h.call('dashboard:get'),/SESSION_EXPIRED/);
    const result=await h.login();assert.equal(result.ok,true);assert.deepEqual(Object.keys(result.user).sort(),['fullName','id','role','username']);
    assert.equal(h.call('dashboard:get').business.name,'Test Bay');
    assert.throws(()=>h.handlers['dashboard:get']({sender:{}}),/Untrusted/);
    h.call('auth:logout');assert.equal(h.call('auth:session'),null);assert.throws(()=>h.call('dashboard:get'),/SESSION_EXPIRED/);
  }finally{h.db.close();}
});
test('bad credentials, inactive and non-admin users receive the same generic failure',async()=>{
  const h=harness();try{
    const bad=await h.login({username:'admin',password:'wrong'});
    const unknown=await h.login({username:'unknown',password:'wrong'});assert.deepEqual(bad,unknown);
    h.db.prepare("UPDATE users SET role='cashier'").run();assert.deepEqual(await h.login(),bad);
    h.db.prepare("UPDATE users SET role='admin',is_active=0").run();assert.deepEqual(await h.login(),bad);
    assert.equal(h.call('auth:session'),null);
  }finally{h.db.close();}
});
test('session expires after inactivity and is revoked when the user loses admin access',async()=>{
  const h=harness();try{
    await h.login();h.advance(29*60000);assert.ok(h.call('auth:session'));
    h.advance(30*60000);assert.throws(()=>h.call('dashboard:get'),/SESSION_EXPIRED/);
    await h.login();h.db.prepare('UPDATE users SET is_active=0').run();assert.throws(()=>h.call('dashboard:get'),/SESSION_EXPIRED/);
  }finally{h.db.close();}
});
test('five failed logins trigger a one-minute throttle',async()=>{
  const h=harness();try{
    for(let i=0;i<5;i++)assert.equal((await h.login({username:'admin',password:'wrong'})).ok,false);
    const blocked=await h.login();assert.equal(blocked.ok,false);assert.match(blocked.message,/one minute/);
    h.advance(60000);assert.equal((await h.login()).ok,true);
  }finally{h.db.close();}
});
test('logout or window revocation cancels pending login; parallel login is rejected',async()=>{
  const h=harness();try{
    let pending=h.login();assert.match((await h.login()).message,/already being checked/);
    h.call('auth:logout');assert.equal((await pending).ok,false);assert.equal(h.call('auth:session'),null);
    pending=h.login();h.controller.revoke(h.sender);assert.equal((await pending).ok,false);
  }finally{h.db.close();}
});
test('setup is required and malformed IPC credentials cannot sign in',async()=>{
  const h=harness();try{
    for(const input of [null,{username:7,password:'test-password'},{username:'admin',password:'x'.repeat(73)}])assert.equal((await h.login(input)).ok,false);
    h.db.prepare('DELETE FROM business_settings').run();assert.match((await h.login()).message,/setup/);
  }finally{h.db.close();}
});
test('dashboard reports database facts with Accra day boundaries and eight recent washes',async()=>{
  const h=harness();try{
    await h.login();
    const insert=h.db.prepare('INSERT INTO transactions(transaction_number,status,total,created_at) VALUES(?,?,?,?)');
    insert.run('completed','completed',100,'2026-10-12 00:00:00');
    insert.run('old','completed',200,'2026-10-11 23:59:59');
    insert.run('tomorrow','completed',300,'2026-10-13 00:00:00');
    insert.run('cancelled','cancelled',400,'2026-10-12 10:00:00');
    insert.run('active','in_progress',500,'2026-10-11 12:00:00');
    const payment=h.db.prepare('INSERT INTO payments(transaction_id,amount,method,status,paid_at) VALUES(?,?,?,?,?)');
    payment.run(1,40,'cash','completed','2026-10-12 00:00:00');payment.run(1,30,'card','completed','2026-10-12 12:00:00');
    payment.run(1,20,'cash','refunded','2026-10-12 12:00:00');payment.run(4,400,'cash','completed','2026-10-12 12:00:00');
    payment.run(1,10,'cash','pending','2026-10-12 12:00:00');payment.run(1,10,'cash','completed','2026-10-13 00:00:00');
    h.db.prepare("INSERT INTO expenses(category,description,amount,expense_date) VALUES('Supplies','Soap',15,'2026-10-12')").run();
    h.db.prepare("INSERT INTO customers(full_name) VALUES('Customer')").run();
    h.db.prepare("INSERT INTO workers(full_name,is_active) VALUES('Worker',1),('Former',0)").run();
    h.db.prepare("INSERT INTO services(name,is_active) VALUES('Wash',1),('Retired',0)").run();
    let data=h.call('dashboard:get');assert.equal(data.date,'2026-10-12');
    assert.deepEqual(data.summary,{completedToday:1,activeWashes:1,collectedToday:470,expensesToday:15,customers:1,activeWorkers:1,activeServices:1,outstandingBalance:1020,waitingVehicles:0,inProgressVehicles:0});
    for(let i=0;i<8;i++)insert.run('extra-'+i,'pending',0,'2026-10-12 11:00:00');
    data=h.call('dashboard:get');assert.equal(data.recent.length,8);assert.equal(data.recent[0].number,'tomorrow');
    assert.equal(data.business.currency,'GHS');
  }finally{h.db.close();}
});
