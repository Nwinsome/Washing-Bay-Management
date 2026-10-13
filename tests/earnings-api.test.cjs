const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {randomUUID}=require('node:crypto');
const Database=require('better-sqlite3');
const bcrypt=require('bcryptjs');
const {registerApplicationHandlers}=require('../app-api.cjs');
const schema=fs.readFileSync(require('node:path').join(__dirname,'../src/database/schema.sql'),'utf8');
const hash=bcrypt.hashSync('earnings-test-password',4);
// All amounts and names below are isolated in-memory test fixtures.
function harness() {
  const db=new Database(':memory:'); db.pragma('foreign_keys=ON'); db.exec(schema);
  db.prepare("INSERT INTO business_settings(id,business_name,currency) VALUES(1,'Test bay','GHS')").run();
  db.prepare("INSERT INTO users(username,password_hash,full_name,role) VALUES('admin',?,'Test administrator','admin')").run(hash);
  const worker=Number(db.prepare("INSERT INTO workers(full_name) VALUES('Test worker')").run().lastInsertRowid);
  const other=Number(db.prepare("INSERT INTO workers(full_name) VALUES('Other worker')").run().lastInsertRowid);
  const category=Number(db.prepare("INSERT INTO vehicle_types(name) VALUES('Test category')").run().lastInsertRowid);
  const vehicle=Number(db.prepare("INSERT INTO vehicles(registration_number,vehicle_type_id) VALUES('TEST 1',?)").run(category).lastInsertRowid);
  const services={}; for(const name of ['Wash','Blow','Engine Wash','Under Wash','Carpet cleaning']) {
    services[name]=Number(db.prepare('INSERT INTO services(name) VALUES(?)').run(name).lastInsertRowid);
    db.prepare('INSERT INTO service_prices(service_id,vehicle_type_id,price) VALUES(?,?,12.25)').run(services[name],category);
    if(name==='Carpet cleaning') db.prepare('INSERT INTO service_default_prices(service_id,price) VALUES(?,12.25)').run(services[name]);
  }
  let clock=Date.parse('2026-10-13T12:00:00Z'); const sender={},handlers={};
  registerApplicationHandlers({ipcMain:{handle:(name,fn)=>handlers[name]=fn},getDatabase:()=>db,validateSender:event=>{if(event.sender!==sender)throw Error('Untrusted sender');},now:()=>clock});
  const call=(name,input)=>handlers[name]({sender},input);
  function create(names=['Wash'],assigned=worker) {
    const serviceIds=names.map(name=>services[name]); const input={mode:names.includes('Wash')||names.includes('Blow')?'vehicle':'non_vehicle',vehicleTypeId:null,serviceIds,assignments:serviceIds.map(serviceId=>({serviceId,workerId:assigned}))};
    if(input.mode==='vehicle') {input.vehicleId=vehicle;input.vehicleTypeId=category;}
    const quote=call('visits:quote',input);return call('visits:create',{...input,expectedTotalPesewas:quote.totalPesewas,expectedLines:quote.lines,requestKey:randomUUID()});
  }
  const complete=visit=>call('visits:status',{id:visit.id,status:'completed'});
  const rule=(name,method,rateUnits,vehicleTypeId=null)=>call('earnings:rule',{serviceId:services[name],vehicleTypeId,method,rateUnits});
  const detail=()=>call('earnings:worker',{workerId:worker});
  const payout=(amountPesewas,extra={})=>call('earnings:payout',{workerId:worker,amountPesewas,paymentDate:'2026-10-13',method:'cash',requestKey:randomUUID(),...extra});
  return {db,call,handlers,sender,worker,other,category,vehicle,services,create,complete,rule,detail,payout,advance:ms=>clock+=ms,login:()=>call('auth:login',{username:'admin',password:'earnings-test-password'})};
}
test('fixed earnings accrue only at completion; changed arrival estimates are not payable and completion is idempotent',async()=>{
  const h=harness();try { await h.login();h.rule('Wash','fixed',250);const v=h.create();
    assert.equal(v.lines[0].workerAssignment.earnings,2.5);assert.equal(h.detail().account.earnedPesewas,0);
    h.rule('Wash','fixed',375);h.complete(v);assert.equal(h.detail().account.earnedPesewas,375);
    h.complete(v);assert.equal(h.db.prepare('SELECT count(*) AS n FROM worker_service_earnings').get().n,1);
    h.rule('Wash','percentage',9000);h.db.prepare("UPDATE workers SET full_name='Renamed worker' WHERE id=?").run(h.worker);
    const d=h.detail();assert.equal(d.lines[0].earnedPesewas,375);assert.equal(d.lines[0].rateUnits,375);assert.equal(d.lines[0].workerName,'Test worker');
    assert.throws(()=>h.db.prepare('UPDATE worker_service_earnings SET earned_pesewas=1').run(),/immutable/);
    assert.throws(()=>h.db.prepare('DELETE FROM worker_service_earnings').run(),/preserved/);
    assert.throws(()=>h.db.prepare("UPDATE transactions SET status='cancelled' WHERE id=?").run(v.id),/cannot be reopened/);
    assert.throws(()=>h.db.prepare('UPDATE transaction_services SET line_total=99 WHERE transaction_id=?').run(v.id),/immutable/);
  }finally{h.db.close();}
});
test('percentage uses recorded service charge with exact half-up pesewa rounding, independently of collections',async()=>{
  const h=harness();try {await h.login();h.rule('Wash','percentage',1000);const v=h.create();
    h.db.prepare('UPDATE service_prices SET price=200 WHERE service_id=?').run(h.services.Wash);h.complete(v);
    assert.equal(h.detail().lines[0].chargePesewas,1225);assert.equal(h.detail().lines[0].earnedPesewas,123);
    assert.equal(h.call('visits:get',{id:v.id}).paidPesewas,0);
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM payments').get().n,0);
    h.rule('Blow','percentage',10000);h.complete(h.create(['Blow']));assert.equal(h.detail().account.earnedPesewas,1348);
  }finally{h.db.close();}
});
test('category overrides use the original visit category even after vehicle/category changes; explicit missing and zero remain distinct',async()=>{
  const h=harness();try {await h.login();h.rule('Wash','fixed',100);h.rule('Wash','fixed',333,h.category);const v=h.create();
    const next=Number(h.db.prepare("INSERT INTO vehicle_types(name) VALUES('Another category')").run().lastInsertRowid);
    h.db.prepare('UPDATE vehicles SET vehicle_type_id=? WHERE id=?').run(next,h.vehicle);h.db.prepare("UPDATE vehicle_types SET name='Renamed category' WHERE id=?").run(h.category);
    h.complete(v);assert.equal(h.detail().lines[0].earnedPesewas,333);assert.equal(h.detail().lines[0].categoryName,'Test category');
    h.db.prepare('UPDATE vehicles SET vehicle_type_id=? WHERE id=?').run(h.category,h.vehicle);
    h.rule('Wash','unconfigured',undefined,h.category);h.complete(h.create());assert.equal(h.detail().period.unconfigured,1);
    h.rule('Wash','fixed',0,h.category);h.complete(h.create());assert.equal(h.detail().lines[0].earnedPesewas,0);assert.equal(h.detail().lines[0].state,'confirmed');
    h.rule('Wash','inherit',undefined,h.category);h.complete(h.create());assert.equal(h.detail().lines[0].earnedPesewas,100);
  }finally{h.db.close();}
});
test('all five services support flexible assignments and extra-service earnings; no rule remains unconfigured',async()=>{
  const h=harness();try {await h.login();h.rule('Wash','fixed',100);h.rule('Engine Wash','percentage',2000);h.rule('Under Wash','fixed',50);
    h.complete(h.create(['Wash','Engine Wash','Under Wash']));h.complete(h.create(['Carpet cleaning']));
    assert.equal(h.detail().account.earnedPesewas,395);assert.equal(h.detail().period.completedServices,4);assert.equal(h.detail().period.unconfigured,1);
    h.rule('Carpet cleaning','fixed',80);h.complete(h.create(['Carpet cleaning'],h.other));h.rule('Blow','fixed',200);h.complete(h.create(['Blow']));
    assert.equal(h.call('earnings:worker',{workerId:h.other}).account.earnedPesewas,80);
    assert.equal(h.detail().account.earnedPesewas,595);assert.equal(h.detail().period.unconfigured,1);
    const cancelled=h.create();h.call('visits:status',{id:cancelled.id,status:'cancelled'});assert.equal(h.detail().period.completedServices,5);
  }finally{h.db.close();}
});
test('daily and monthly salary agreements exclude service accrual, retain salary snapshots and do not invent obligations',async()=>{
  const h=harness();try {await h.login();h.rule('Wash','fixed',250);
    h.call('earnings:arrangement',{workerId:h.worker,arrangement:'daily_salary',amountPesewas:1000});h.complete(h.create());
    assert.equal(h.detail().lines[0].state,'salary');assert.equal(h.detail().lines[0].salaryPesewas,1000);assert.equal(h.detail().account.earnedPesewas,0);
    h.call('earnings:arrangement',{workerId:h.worker,arrangement:'monthly_salary',amountPesewas:20000});h.complete(h.create());assert.equal(h.detail().period.salaryServices,2);
    assert.throws(()=>h.payout(1),/exceeds confirmed/);
    h.call('earnings:arrangement',{workerId:h.worker,arrangement:'service'});h.complete(h.create());assert.equal(h.detail().account.earnedPesewas,250);
    assert.equal(h.detail().lines.find(x=>x.arrangement==='daily_salary').salaryPesewas,1000);
  }finally{h.db.close();}
});
test('payout recording uses exact receipts, updates balances, retains methods/dates, and blocks overpayment',async()=>{
  const h=harness();try {await h.login();h.rule('Wash','fixed',333);h.complete(h.create());
    h.payout(101,{method:'mobile_money',reference:'Reference',note:'Partial payout'});const d=h.detail();
    assert.equal(d.account.paidPesewas,101);assert.equal(d.account.outstandingPesewas,232);assert.equal(d.payments[0].method,'mobile_money');assert.equal(d.payments[0].notes,'Partial payout');
    assert.throws(()=>h.payout(233),/exceeds confirmed/);h.payout(232);assert.equal(h.detail().account.outstandingPesewas,0);
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM payments').get().n,0);assert.equal(h.db.prepare('SELECT count(*) AS n FROM expenses').get().n,0);
    assert.throws(()=>h.db.prepare('UPDATE worker_payments SET amount=1').run(),/immutable/);
  }finally{h.db.close();}
});
test('duplicate payout retries return one receipt; reused keys with different financial details fail',async()=>{
  const h=harness();try {await h.login();h.rule('Wash','fixed',100);h.complete(h.create());const key=randomUUID();
    const first=h.payout(100,{requestKey:key}),second=h.payout(100,{requestKey:key});assert.equal(first.id,second.id);
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM worker_payments').get().n,1);
    assert.throws(()=>h.payout(99,{requestKey:key}),/already used/);assert.throws(()=>h.payout(100,{requestKey:key,workerId:h.other}),/already used/);
  }finally{h.db.close();}
});
test('financial audit failures roll back payouts and completion with no duplicate or partially confirmed work',async()=>{
  const h=harness();try {await h.login();h.rule('Wash','fixed',100);const v=h.create();
    h.db.exec("CREATE TRIGGER fail_completion BEFORE INSERT ON worker_service_earnings BEGIN SELECT RAISE(ABORT,'completion failure'); END");
    assert.throws(()=>h.complete(v),/completion failure/);assert.equal(h.call('visits:get',{id:v.id}).status,'waiting');assert.equal(h.detail().account.earnedPesewas,0);
    h.db.exec('DROP TRIGGER fail_completion');h.complete(v);
    h.db.exec("CREATE TRIGGER fail_payout BEFORE INSERT ON audit_logs WHEN NEW.action='worker_payout_recorded' BEGIN SELECT RAISE(ABORT,'audit failure'); END");
    assert.throws(()=>h.payout(100),/audit failure/);assert.equal(h.db.prepare('SELECT count(*) AS n FROM worker_payments').get().n,0);assert.equal(h.detail().account.outstandingPesewas,100);
  }finally{h.db.close();}
});
test('search and date filters use persisted completed work while payable balances remain all-time',async()=>{
  const h=harness();try {await h.login();h.rule('Wash','fixed',100);h.complete(h.create());h.advance(86400000);await h.login();h.complete(h.create());h.payout(50,{paymentDate:'2026-10-14'});
    const d=h.call('earnings:worker',{workerId:h.worker,from:'2026-10-14',to:'2026-10-14'});assert.equal(d.period.earnedPesewas,100);assert.equal(d.period.paidPesewas,50);assert.equal(d.account.outstandingPesewas,150);
    assert.equal(h.call('earnings:list',{search:'test WORKER'}).total,1);assert.equal(h.call('earnings:list',{search:"%' OR 1=1 --"}).total,0);
    assert.throws(()=>h.call('earnings:list',{from:'2026-10-15',to:'2026-10-14'}),/start date/);
  }finally{h.db.close();}
});
test('legacy completed work, estimates and unclassified payouts survive idempotent migration and are not guessed into payable balances',async()=>{
  const h=harness();try {await h.login();h.rule('Wash','fixed',100);const old=h.create();
    h.db.prepare("UPDATE transactions SET status='completed' WHERE id=?").run(old.id); // Emulate a pre-ledger completed visit.
    h.db.prepare('INSERT INTO worker_payments(worker_id,amount,notes) VALUES(?,2.75,?)').run(h.worker,'Historical payment');
    const before=h.db.prepare('SELECT * FROM worker_payments').all();h.db.exec(schema);h.db.exec(schema);
    assert.deepEqual(h.db.prepare('SELECT * FROM worker_payments').all(),before);assert.equal(h.detail().legacyCompletedServices,1);assert.equal(h.detail().account.earnedPesewas,0);
    assert.equal(h.call('visits:get',{id:old.id}).lines[0].workerAssignment.earnings,1);
    h.complete(h.create());assert.equal(h.detail().account.payoutBlocked,true);assert.throws(()=>h.payout(1),/reconciliation/);
    assert.equal(h.db.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{h.db.close();}
});
test('invalid rates, amounts, dates and references leave financial records unchanged',async()=>{
  const h=harness();try {await h.login();for(const rate of [-1,1.1,Infinity,'100',Number.MAX_SAFE_INTEGER+1]) assert.throws(()=>h.rule('Wash','fixed',rate),/valid whole/);
    assert.throws(()=>h.rule('Wash','percentage',10001),/Percentage/);assert.throws(()=>h.rule('Wash','fixed',100,9999),/category/);
    for(const arrangement of ['daily_salary','monthly_salary']) assert.throws(()=>h.call('earnings:arrangement',{workerId:h.worker,arrangement,amountPesewas:0}),/valid whole/);
    h.rule('Wash','fixed',100);h.complete(h.create());for(const value of [0,-1,1.5,NaN]) assert.throws(()=>h.payout(value),/valid whole/);
    assert.throws(()=>h.payout(1,{paymentDate:'2026-02-30'}),/calendar date/);assert.throws(()=>h.payout(1,{paymentDate:'2026-10-14'}),/future/);assert.throws(()=>h.payout(1,{method:'invalid'}),/method/);
    assert.throws(()=>h.payout(1,{paymentDate:'2026-10-12'}),/available by/);
    assert.throws(()=>h.payout(1,{reference:'x'.repeat(121)}),/reference/);assert.throws(()=>h.payout(1,{requestKey:'short'}),/submission key/);
    assert.equal(h.detail().account.paidPesewas,0);
  }finally{h.db.close();}
});
test('deactivated workers can receive existing earned balances and financial history remains paginated',async()=>{
  const h=harness();try {await h.login();h.rule('Wash','fixed',100);const v=h.create();h.complete(v);
    h.db.prepare('UPDATE workers SET is_active=0 WHERE id=?').run(h.worker);h.payout(50);
    assert.equal(h.detail().account.outstandingPesewas,50);assert.equal(h.detail().worker.isActive,0);
    const first=h.call('earnings:list',{offset:0}),empty=h.call('earnings:list',{offset:50});assert.equal(first.total,2);assert.equal(empty.workers.length,0);
    assert.equal(h.call('earnings:worker',{workerId:h.worker,offset:50}).lines.length,0);
  }finally{h.db.close();}
});
test('SQLite payout validation rejects unmatched overpayments without deleting or resetting financial history',async()=>{
  const h=harness();try {await h.login();h.rule('Wash','fixed',100);h.complete(h.create());
    const id=Number(h.db.prepare('INSERT INTO worker_payments(worker_id,amount) VALUES(?,2)').run(h.worker).lastInsertRowid);
    assert.throws(()=>h.db.prepare("INSERT INTO worker_payout_receipts(worker_payment_id,submission_key,submission_payload,amount_pesewas,method,currency) VALUES(?,?,?,200,'cash','GHS')").run(id,randomUUID(),'test'),/exceeds confirmed/);
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM worker_payments').get().n,1);assert.equal(h.detail().account.payoutBlocked,true);
  }finally{h.db.close();}
});
test('all earnings IPCs require trusted authenticated active administrators, including read operations',async()=>{
  const h=harness();try {
    const channels=['earnings:configuration','earnings:rule','earnings:arrangement','earnings:list','earnings:worker','earnings:payout'];
    for(const channel of channels){assert.throws(()=>h.call(channel,{}),/SESSION_EXPIRED/);assert.throws(()=>h.handlers[channel]({sender:{}},{}),/Untrusted/);}
    await h.login();h.db.exec("UPDATE users SET is_active=0 WHERE username='admin'");for(const channel of channels)assert.throws(()=>h.call(channel,{}),/SESSION_EXPIRED/);
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM worker_payout_receipts').get().n,0);
  }finally{h.db.close();}
});
