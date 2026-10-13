const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { registerApplicationHandlers } = require('../app-api.cjs');
const schema = fs.readFileSync(path.join(__dirname,'../src/database/schema.sql'),'utf8');
const hash = bcrypt.hashSync('visit-test-password',12);
function harness() {
  const db = new Database(':memory:'); db.pragma('foreign_keys=ON'); db.exec(schema);
  db.prepare("INSERT INTO business_settings(id,business_name,currency) VALUES(1,'Test Bay','GHS')").run();
  db.prepare("INSERT INTO users(username,password_hash,full_name,role) VALUES('admin',?,'Test Admin','admin')").run(hash);
  const type = Number(db.prepare("INSERT INTO vehicle_types(name) VALUES('Test car')").run().lastInsertRowid);
  const worker = Number(db.prepare("INSERT INTO workers(full_name) VALUES('Test Worker')").run().lastInsertRowid);
  const other = Number(db.prepare("INSERT INTO workers(full_name) VALUES('Other Worker')").run().lastInsertRowid);
  const sender = {}, handlers = {}; let time = Date.parse('2026-10-13T12:00:00Z');
  registerApplicationHandlers({ ipcMain: { handle: (channel,fn) => { handlers[channel]=fn; } }, getDatabase:()=>db,
    validateSender:event=>{ if (event.sender!==sender) throw Error('Untrusted sender'); }, now:()=>time });
  const call=(channel,input)=>handlers[channel]({ sender },input);
  const wash=Number(db.prepare("INSERT INTO services(name) VALUES('Washing')").run().lastInsertRowid);
  const blow=Number(db.prepare("INSERT INTO services(name) VALUES('Blowing')").run().lastInsertRowid);
  const carpet=Number(db.prepare("INSERT INTO services(name) VALUES('Carpet cleaning')").run().lastInsertRowid);
  db.prepare('INSERT INTO service_prices(service_id,vehicle_type_id,price) VALUES(?,?,12.25),(?,?,3.50)').run(wash,type,blow,type);
  db.prepare('INSERT INTO service_default_prices(service_id,price) VALUES(?,8.75)').run(carpet);
  const vehicle=Number(db.prepare('INSERT INTO vehicles(registration_number,vehicle_type_id) VALUES(?,?)').run('GT 1234-26',type).lastInsertRowid);
  const selection=(serviceIds=[wash])=>({ mode:'vehicle', vehicleId:vehicle, vehicleTypeId:type,serviceIds,assignments:serviceIds.map(serviceId=>({ serviceId,workerId:worker })) });
  const request=input=>{ const quote=call('visits:quote',input); return { ...input,expectedTotalPesewas:quote.totalPesewas,expectedLines:quote.lines,requestKey:randomUUID() }; };
  const create=(input=selection())=>call('visits:create',request(input));
  const payment=(visitId,amountPesewas,extra={})=>call('visits:payment',{ id:visitId,amountPesewas,method:'cash',requestKey:randomUUID(),...extra });
  return { db,handlers,call,type,worker,other,wash,blow,carpet,vehicle,selection,request,create,payment,advance:ms=>{ time+=ms; },login:()=>call('auth:login',{ username:'admin',password:'visit-test-password' }) };
}

test('existing-vehicle visits start waiting and unpaid with assigned active workers and automatic prices', async()=>{
  const h=harness(); try {
    await h.login(); const visit=h.create();
    assert.equal(visit.vehicleId,h.vehicle); assert.equal(visit.status,'waiting'); assert.equal(visit.paymentStatus,'unpaid');
    assert.equal(visit.arrivalAt,'2026-10-13T12:00:00.000Z'); assert.equal(visit.totalPesewas,1225); assert.equal(visit.paidPesewas,0); assert.equal(visit.outstandingPesewas,1225);
    assert.equal(visit.lines[0].workerAssignment.workerId,h.worker); assert.equal(visit.lines[0].workerAssignment.earnings,null);
    assert.equal(visit.history.length,1); assert.equal(visit.history[0].toStatus,'waiting'); assert.equal(visit.payments.length,0);
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM transactions').get().n,1);
    assert.throws(()=>h.call('transactions:create',{ vehicleTypeId:h.type,serviceIds:[h.wash],expectedTotal:12.25 }),/Use the Visits workflow/);
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM customers').get().n,0);
  } finally { h.db.close(); }
});

test('registration during visit creation is atomic and duplicate visit retries reuse both records', async()=>{
  const h=harness(); try {
    await h.login();
    const input={ mode:'vehicle',newVehicle:{ registrationNumber:'as 10-26',vehicleTypeId:h.type,customerPhone:'0201234567' },vehicleTypeId:h.type,serviceIds:[h.blow],assignments:[{ serviceId:h.blow,workerId:h.worker }] };
    const request=h.request(input), visit=h.call('visits:create',request), replay=h.call('visits:create',request);
    assert.equal(visit.id,replay.id); assert.equal(visit.registrationNumber,'AS 10-26'); assert.equal(visit.totalPesewas,350);
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM vehicles').get().n,2); assert.equal(h.db.prepare('SELECT count(*) AS n FROM transactions').get().n,1);
    assert.throws(()=>h.call('visits:create',{ ...request,arrivalAt:'2026-10-13T11:59:00Z' }),/already used/);
    const failing=h.request({ ...input,newVehicle:{ ...input.newVehicle,registrationNumber:'AS 11-26' } });
    h.db.exec("CREATE TRIGGER fail_new_visit BEFORE INSERT ON transactions BEGIN SELECT RAISE(ABORT,'visit unavailable'); END");
    assert.throws(()=>h.call('visits:create',failing),/visit unavailable/);
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM vehicles').get().n,2);
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM customers').get().n,0);
  } finally { h.db.close(); }
});

test('exactly one washing or blowing is required for vehicles; carpet cleaning works without registration', async()=>{
  const h=harness(); try {
    await h.login();
    assert.equal(h.create(h.selection([h.wash])).lines[0].serviceKind,'washing');
    assert.equal(h.create(h.selection([h.blow])).lines[0].serviceKind,'blowing');
    assert.throws(()=>h.call('visits:quote',h.selection([h.wash,h.blow])),/either washing or blowing/);
    assert.throws(()=>h.call('visits:quote',h.selection([h.carpet])),/exactly one/);
    const nonVehicle={ mode:'non_vehicle',vehicleTypeId:null,serviceIds:[h.carpet],assignments:[{ serviceId:h.carpet,workerId:h.other }] };
    const carpet=h.create(nonVehicle); assert.equal(carpet.vehicleId,null); assert.equal(carpet.totalPesewas,875); assert.equal(carpet.lines[0].workerAssignment.workerId,h.other);
    assert.throws(()=>h.call('visits:quote',{ ...nonVehicle,vehicleId:h.vehicle }),/does not use/);
    assert.throws(()=>h.call('visits:quote',{ ...nonVehicle,vehicleTypeId:h.type,serviceIds:[h.wash],assignments:[{ serviceId:h.wash,workerId:h.worker }] }),/require a registered vehicle/);
    const combined=h.create({ ...h.selection([h.wash,h.carpet]),assignments:[{ serviceId:h.wash,workerId:h.worker },{ serviceId:h.carpet,workerId:h.other }] });
    assert.equal(combined.totalPesewas,2100); assert.equal(combined.lines.length,2);
  } finally { h.db.close(); }
});

test('worker flexibility, inactive worker rejection and required primary assignment', async()=>{
  const h=harness(); try {
    await h.login(); const input={ ...h.selection(),assignments:[] };
    assert.equal(h.call('visits:quote',input).totalPesewas,1225);
    assert.throws(()=>h.call('visits:create',h.request(input)),/Assign an active worker/);
    const washing=h.create(), blowing=h.create(h.selection([h.blow]));
    assert.equal(washing.lines[0].workerAssignment.workerId,blowing.lines[0].workerAssignment.workerId);
    h.call('workers:status',{ id:h.worker,isActive:false });
    assert.throws(()=>h.call('visits:quote',h.selection()),/unavailable/);
    assert.equal(h.call('visits:get',{ id:washing.id }).lines[0].workerAssignment.workerName,'Test Worker');
  } finally { h.db.close(); }
});

test('status transitions retain timestamps/history and completion stays independent of payments', async()=>{
  const h=harness(); try {
    await h.login(); const visit=h.create(); h.advance(60000);
    const started=h.call('visits:status',{ id:visit.id,status:'in_progress' }); assert.equal(started.startedAt,'2026-10-13T12:01:00.000Z');
    h.advance(60000); const completed=h.call('visits:status',{ id:visit.id,status:'completed' });
    assert.equal(completed.completedAt,'2026-10-13T12:02:00.000Z'); assert.equal(completed.paymentStatus,'unpaid'); assert.equal(completed.outstandingPesewas,1225);
    assert.deepEqual(completed.history.map(e=>e.toStatus),['waiting','in_progress','completed']);
    assert.equal(h.call('visits:status',{ id:visit.id,status:'completed' }).history.length,3);
    assert.throws(()=>h.call('visits:status',{ id:visit.id,status:'waiting' }),/cannot be changed/);
    assert.throws(()=>h.call('visits:status',{ id:visit.id,status:'bad' }),/valid visit status/);
    const another=h.create(); const cancelled=h.call('visits:status',{ id:another.id,status:'cancelled' });
    assert.equal(cancelled.outstandingPesewas,0); assert.ok(cancelled.cancelledAt); assert.equal(cancelled.paymentStatus,'cancelled');
    assert.throws(()=>h.payment(another.id,10),/cancelled visit/);
    assert.equal(h.call('dashboard:get').summary.completedToday,1);
  } finally { h.db.close(); }
});

test('full and partial multiple payments use exact pesewas, reject overpayment and do not complete work', async()=>{
  const h=harness(); try {
    await h.login(); const visit=h.create();
    const partial=h.payment(visit.id,225,{ method:'mobile_money',reference:'Test receipt' });
    assert.equal(partial.paidPesewas,225); assert.equal(partial.outstandingPesewas,1000); assert.equal(partial.paymentStatus,'partial'); assert.equal(partial.status,'waiting');
    assert.equal(partial.payments[0].method,'mobile_money'); assert.equal(partial.payments[0].reference,'Test receipt');
    assert.throws(()=>h.payment(visit.id,1001),/exceeds the outstanding/);
    const paid=h.payment(visit.id,1000,{ method:'card' }); assert.equal(paid.paidPesewas,1225); assert.equal(paid.outstandingPesewas,0); assert.equal(paid.paymentStatus,'paid'); assert.equal(paid.status,'waiting');
    assert.equal(paid.payments.length,2); assert.throws(()=>h.payment(visit.id,1),/exceeds/);
    assert.equal(h.call('dashboard:get').summary.collectedToday,12.25);
    assert.equal(h.call('dashboard:get').summary.waitingVehicles,1);
    const completed=h.call('visits:status',{ id:visit.id,status:'completed' });
    assert.equal(completed.paymentStatus,'paid'); assert.equal(completed.status,'completed');
  } finally { h.db.close(); }
});

test('duplicate payment keys are idempotent and cannot be reused for changed data or another visit', async()=>{
  const h=harness(); try {
    await h.login(); const visit=h.create(); const request={ id:visit.id,amountPesewas:100,method:'cash',requestKey:randomUUID() };
    const first=h.call('visits:payment',request); h.advance(60000); const repeat=h.call('visits:payment',request);
    assert.deepEqual(repeat,first); assert.equal(h.db.prepare('SELECT count(*) AS n FROM payments').get().n,1);
    assert.throws(()=>h.call('visits:payment',{ ...request,amountPesewas:101 }),/already used/);
    const other=h.create(); assert.throws(()=>h.call('visits:payment',{ ...request,id:other.id }),/already used/);
    const retry={ id:other.id,amountPesewas:1225,method:'cash',requestKey:randomUUID() };
    const responses=await Promise.all([Promise.resolve().then(()=>h.call('visits:payment',retry)),Promise.resolve().then(()=>h.call('visits:payment',retry))]);
    assert.equal(responses[0].paidPesewas,1225); assert.equal(responses[1].payments.length,1);
  } finally { h.db.close(); }
});

test('historical prices, worker names and earnings survive configuration edits and cancelled receipts stay collected', async()=>{
  const h=harness(); try {
    await h.login(); const visit=h.create(); const original=h.call('visits:get',{ id:visit.id });
    h.call('services:price',{ serviceId:h.wash,vehicleTypeId:h.type,price:30 });
    h.call('workers:update',{ id:h.worker,fullName:'Changed Worker',phone:'0201234567' });
    assert.deepEqual(h.call('visits:get',{ id:visit.id }),original);
    h.payment(visit.id,100); const cancelled=h.call('visits:status',{ id:visit.id,status:'cancelled' });
    assert.equal(cancelled.paidPesewas,100); assert.equal(cancelled.outstandingPesewas,0);
    const dash=h.call('dashboard:get'); assert.equal(dash.summary.collectedToday,1); assert.equal(dash.summary.completedToday,0); assert.equal(dash.summary.waitingVehicles,0); assert.equal(dash.summary.outstandingBalance,0);
  } finally { h.db.close(); }
});

test('search/filter visits, completion date boundaries, and precise fractional price addition', async()=>{
  const h=harness(); try {
    await h.login(); h.call('services:price',{ serviceId:h.wash,vehicleTypeId:h.type,price:0.1 }); h.call('services:price',{ serviceId:h.carpet,vehicleTypeId:null,price:0.2 });
    const visit=h.create(h.selection([h.wash,h.carpet])); assert.equal(visit.totalPesewas,30);
    h.payment(visit.id,10); assert.equal(h.call('visits:list',{ paymentStatus:'partial' }).total,1);
    assert.equal(h.call('visits:list',{ search:'gt123426',status:'waiting' }).visits[0].id,visit.id);
    assert.equal(h.call('visits:list',{ search:'Test Worker' }).total,1); assert.equal(h.call('visits:list',{ search:'Washing' }).total,1);
    assert.equal(h.call('visits:list',{ search:"' OR 1=1 --" }).total,0);
    assert.equal(h.call('visits:list',{ paymentStatus:'unpaid' }).total,0);
    h.advance(86400000); await h.login(); h.call('visits:status',{ id:visit.id,status:'completed' });
    assert.equal(h.call('dashboard:get').summary.completedToday,1); assert.equal(h.call('dashboard:get').summary.collectedToday,0);
    assert.equal(h.call('dashboard:get').summary.outstandingBalance,0.2);
  } finally { h.db.close(); }
});

test('invalid inputs, stale quotes and failed financial writes leave integrity intact', async()=>{
  const h=harness(); try {
    await h.login(); const request=h.request(h.selection());
    h.call('services:price',{ serviceId:h.wash,vehicleTypeId:h.type,price:20 });
    assert.throws(()=>h.call('visits:create',request),/Review the updated price/);
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM transactions').get().n,0);
    assert.throws(()=>h.call('visits:create',{ ...h.request(h.selection()),arrivalAt:'2099-01-01T00:00:00Z' }),/arrival time/);
    const visit=h.create();
    for (const amount of [-1,0,1.5,'100',NaN,Number.MAX_SAFE_INTEGER+1]) assert.throws(()=>h.payment(visit.id,amount));
    assert.throws(()=>h.payment(visit.id,1,{ method:'credit' }),/valid payment method/);
    assert.throws(()=>h.payment(visit.id,1,{ reference:7 }),/reference/);
    assert.throws(()=>h.payment(visit.id,1,{ paidAt:'bad-date' }),/payment date/);
    assert.throws(()=>h.call('visits:list',{ status:'bad' }),/filter/);
    assert.throws(()=>h.call('visits:get',{ id:'1' }),/Invalid/);
    h.db.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON payment_receipts BEGIN SELECT RAISE(ABORT,'receipt unavailable'); END");
    assert.throws(()=>h.payment(visit.id,100),/receipt unavailable/);
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM payments').get().n,0); assert.equal(h.call('visits:get',{ id:visit.id }).paidPesewas,0);
    assert.deepEqual(h.db.pragma('foreign_key_check'),[]);
  } finally { h.db.close(); }
});

test('new visit database validation requires a vehicle service and active assigned worker', async()=>{
  const h=harness(); try {
    await h.login();
    const tx=Number(h.db.prepare("INSERT INTO transactions(transaction_number,vehicle_id,total) VALUES('invalid-direct',?,8.75)").run(h.vehicle).lastInsertRowid);
    h.db.prepare("INSERT INTO transaction_services(transaction_id,service_id,service_name,unit_price,line_total) VALUES(?,?,'Carpet cleaning',8.75,8.75)").run(tx,h.carpet);
    assert.throws(()=>h.db.prepare("INSERT INTO visit_details(transaction_id,arrival_at,currency,total_pesewas,creation_key) VALUES(?,'2026-10-13T12:00:00Z','GHS',875,?)").run(tx,randomUUID()),/exactly one/);
    const originalPayments=h.db.prepare('SELECT * FROM payments').all(); h.db.exec(schema); h.db.exec(schema);
    assert.deepEqual(h.db.prepare('SELECT * FROM payments').all(),originalPayments);
    assert.deepEqual(h.db.pragma('foreign_key_check'),[]);
  } finally { h.db.close(); }
});

test('all visit and payment handlers require a trusted active administrator', async()=>{
  const h=harness(), channels=['visits:quote','visits:create','visits:get','visits:list','visits:status','visits:payment'];
  try {
    for (const channel of channels) assert.throws(()=>h.call(channel,{}),/SESSION_EXPIRED/);
    await h.login(); for (const channel of channels) assert.throws(()=>h.handlers[channel]({ sender:{} },{}),/Untrusted/);
    h.advance(30*60000); for (const channel of channels) assert.throws(()=>h.call(channel,{}),/SESSION_EXPIRED/);
    await h.login(); h.db.prepare('UPDATE users SET is_active=0').run(); for (const channel of channels) assert.throws(()=>h.call(channel,{}),/SESSION_EXPIRED/);
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM transactions').get().n,0);
  } finally { h.db.close(); }
});
