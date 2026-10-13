const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const { randomUUID }=require('node:crypto');
const Database=require('better-sqlite3');
const bcrypt=require('bcryptjs');
const { registerApplicationHandlers }=require('../app-api.cjs');
const schema=fs.readFileSync(path.join(__dirname,'../src/database/schema.sql'),'utf8');
const catalog=fs.readFileSync(path.join(__dirname,'../src/database/catalog.sql'),'utf8');
const expectedNames=['Private Sln / Taxi','4x4 / Pickup','CRV - RAV4 - HRV','Motor','Motor King','Okada','Urvan','Sprinter','Coaster Bus','VIP - OA (Bus)','Bullion Van','Towing Car','Kia Sm','Kia Mini','Kia Rhino','Truck Head','Timber','Dump / Tipper Truck 1','Dump / Tipper Truck 2','Dump / Tipper Truck 3','Dump / Tipper Truck 4','Back Hoe','Loader','Long Vehicle (Flat)','Long Vehicle (H/B)','Long Vehicle (F/B)','Low Bed 1','Low Bed 2','Grader','Dozer 1','Dozer 2','Excavator 1','Excavator 2','Tanker 1','Tanker 2','Tanker 3','Paver Machine Truck','Close Body Container Truck 1','Close Body Container Truck 2','Close Body Container Truck 3','Close Body Container Truck 4','Close Body Container Truck 5','Close Body Container Truck 6'];
const hash=bcrypt.hashSync('catalog-test-password',12);
const initialize=db=>db.transaction(()=>{ db.exec(schema); db.exec(catalog); })();
function harness() {
  const db=new Database(':memory:'); db.pragma('foreign_keys=ON'); initialize(db);
  db.prepare("INSERT INTO business_settings(id,business_name,currency) VALUES(1,'Test Bay','GHS')").run();
  db.prepare("INSERT INTO users(username,password_hash,full_name,role) VALUES('admin',?,'Test Admin','admin')").run(hash);
  const sender={},handlers={};
  registerApplicationHandlers({ ipcMain:{ handle:(channel,fn)=>{ handlers[channel]=fn; } },getDatabase:()=>db,now:()=>Date.parse('2026-10-13T12:00:00Z'),validateSender:event=>{ if(event.sender!==sender) throw Error('Untrusted sender'); } });
  const call=(channel,input)=>handlers[channel]({ sender },input);
  const category=Number(db.prepare("SELECT id FROM vehicle_types WHERE name='Private Sln / Taxi'").get().id);
  const suv=Number(db.prepare("SELECT id FROM vehicle_types WHERE name='4x4 / Pickup'").get().id);
  const service=code=>db.prepare('SELECT service_id AS id FROM service_roles WHERE code=?').get(code).id;
  const worker=Number(db.prepare("INSERT INTO workers(full_name) VALUES('Fixture Worker')").run().lastInsertRowid);
  const other=Number(db.prepare("INSERT INTO workers(full_name) VALUES('Other Fixture Worker')").run().lastInsertRowid);
  const vehicle=Number(db.prepare('INSERT INTO vehicles(registration_number,vehicle_type_id) VALUES(?,?)').run('TEST 1234',category).lastInsertRowid);
  const set=(code,vehicleTypeId,price)=>call('services:price',{ serviceId:service(code),vehicleTypeId,price });
  const selection=(codes=['washing'])=>({ mode:'vehicle',vehicleId:vehicle,vehicleTypeId:category,serviceIds:codes.map(service),assignments:codes.map(code=>({ serviceId:service(code),workerId:worker })) });
  const save=input=>{ const quoted=call('visits:quote',input); return call('visits:create',{ ...input,expectedTotalPesewas:quoted.totalPesewas,expectedLines:quoted.lines,requestKey:randomUUID() }); };
  return { db,call,handlers,category,suv,service,worker,other,vehicle,set,selection,save,login:()=>call('auth:login',{ username:'admin',password:'catalog-test-password' }) };
}

test('initializes all 43 supplied categories and four vehicle services idempotently, without prices',()=>{
  const db=new Database(':memory:'); try {
    db.pragma('foreign_keys=ON'); initialize(db); initialize(db);
    assert.deepEqual(db.prepare('SELECT name FROM vehicle_types ORDER BY name').all().map(r=>r.name),[...expectedNames].sort());
    assert.equal(db.prepare('SELECT count(*) AS n FROM vehicle_category_presets').get().n,43);
    assert.deepEqual(db.prepare('SELECT name FROM services ORDER BY name').all().map(r=>r.name),['Blow','Engine Wash','Under Wash','Wash']);
    for(const table of ['service_prices','service_default_prices','customers','transactions','payments','users','workers']) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n,0);
    assert.deepEqual(db.pragma('foreign_key_check'),[]);
  } finally { db.close(); }
});

test('reuses matching legacy categories/services and preserves renamed, deactivated and financial records across initialization',()=>{
  const db=new Database(':memory:'); try {
    db.pragma('foreign_keys=ON'); db.exec(schema.slice(0,schema.indexOf('    CREATE TABLE IF NOT EXISTS vehicle_type_state')));
    db.prepare("INSERT INTO business_settings(id,business_name,currency) VALUES(1,'Existing Bay','GHS')").run();
    db.prepare("INSERT INTO users(username,password_hash,full_name,role) VALUES('existing',?,'Existing Admin','admin')").run(hash);
    db.prepare("INSERT INTO vehicle_types(name) VALUES('  private sln/taxi  ')").run();
    db.prepare("INSERT INTO services(name) VALUES('Washing')").run();
    db.prepare('INSERT INTO service_prices(service_id,vehicle_type_id,price) VALUES(1,1,27.99)').run();
    db.prepare("INSERT INTO workers(full_name) VALUES('Existing Worker')").run();
    db.prepare("INSERT INTO vehicles(registration_number,vehicle_type_id) VALUES('OLD 123',1)").run();
    db.prepare("INSERT INTO transactions(transaction_number,vehicle_id,total) VALUES('old-visit',1,27.99)").run();
    db.prepare("INSERT INTO transaction_services(transaction_id,service_id,service_name,unit_price,line_total) VALUES(1,1,'Washing',27.99,27.99)").run();
    db.prepare("INSERT INTO payments(transaction_id,amount,method) VALUES(1,27.99,'cash')").run();
    const original={}; for(const table of ['business_settings','users','vehicles','workers','service_prices','transactions','transaction_services','payments']) original[table]=db.prepare(`SELECT * FROM ${table}`).all();
    initialize(db); initialize(db);
    for(const table of Object.keys(original)) assert.deepEqual(db.prepare(`SELECT * FROM ${table}`).all(),original[table]);
    assert.equal(db.prepare('SELECT count(*) AS n FROM vehicle_types').get().n,43);
    assert.equal(db.prepare("SELECT count(*) AS n FROM service_definitions WHERE kind='washing'").get().n,1);
    assert.equal(db.prepare('SELECT vehicle_type_id FROM vehicle_category_presets WHERE preset_name=?').get('Private Sln / Taxi').vehicle_type_id,1);
    db.prepare("UPDATE vehicle_types SET name='Renamed category' WHERE id=1").run(); db.prepare('UPDATE vehicle_type_state SET is_active=0 WHERE vehicle_type_id=1').run();
    initialize(db);
    assert.equal(db.prepare('SELECT count(*) AS n FROM vehicle_types').get().n,43);
    assert.equal(db.prepare('SELECT name,is_active FROM vehicle_category_catalog WHERE id=1').get().name,'Renamed category');
    assert.equal(db.prepare('SELECT is_active FROM vehicle_category_catalog WHERE id=1').get().is_active,0);
    assert.equal(db.prepare('SELECT vehicle_type_name FROM transaction_vehicle_snapshots WHERE transaction_id=1').get().vehicle_type_name,'  private sln/taxi  ');
  } finally { db.close(); }
});

test('category management prevents normalized duplicates, keeps IDs and blocks new use of deactivated categories',async()=>{
  const h=harness(); try {
    await h.login();
    for(const name of [' private sln/taxi ','4×4/pickup','Private   Sln / Taxi']) assert.throws(()=>h.call('vehicle-types:add',{ name }),/already exists/);
    const added=h.call('vehicle-types:add',{ name:' Special Vehicle ' }); assert.equal(added.name,'Special Vehicle');
    const renamed=h.call('vehicle-types:update',{ id:added.id,name:'Special Vehicle 2' }); assert.equal(renamed.id,added.id);
    assert.throws(()=>h.call('vehicle-types:update',{ id:added.id,name:'Motor' }),/already exists/);
    h.set('washing',h.category,10);
    const historical=h.save(h.selection());
    h.call('vehicle-types:update',{ id:h.category,name:'Private Vehicles' });
    h.call('vehicle-types:status',{ id:h.category,isActive:false });
    assert.equal(h.call('services:get').vehicleTypes.some(r=>r.id===h.category),false);
    assert.throws(()=>h.call('vehicles:create',{ registrationNumber:'TEST 5678',vehicleTypeId:h.category }),/active vehicle category/);
    assert.throws(()=>h.call('visits:quote',h.selection()),/active vehicle category/);
    const edited=h.call('vehicles:update',{ id:h.vehicle,registrationNumber:'TEST 1234',vehicleTypeId:h.category,color:'Blue' }); assert.equal(edited.color,'Blue');
    assert.equal(h.call('visits:get',{ id:historical.id }).totalPesewas,1000);
    assert.equal(h.call('transactions:get',{ id:historical.id }).vehicle.vehicleTypeName,'Private Sln / Taxi');
    h.call('vehicle-types:status',{ id:h.category,isActive:true }); assert.equal(h.call('visits:quote',h.selection()).totalPesewas,1000);
    for(const input of [{ name:'' },{ name:7 },{ name:'x'.repeat(121) },{ name:'Bad\u0000category' }]) assert.throws(()=>h.call('vehicle-types:add',input));
    assert.throws(()=>h.call('vehicle-types:status',{ id:h.category,isActive:1 }));
  } finally { h.db.close(); }
});

test('missing, unavailable, unconfigured and explicit zero prices are separate and cannot use general vehicle prices',async()=>{
  const h=harness(); try {
    await h.login(); assert.throws(()=>h.call('visits:quote',h.selection()),/Configure a price/);
    h.set('washing',null,99); assert.throws(()=>h.call('visits:quote',h.selection()),/Configure a price/);
    h.set('washing',h.category,0); assert.equal(h.call('visits:quote',h.selection()).totalPesewas,0);
    const free=h.save(h.selection()); assert.equal(free.paymentStatus,'paid'); assert.equal(free.payments.length,0);
    h.call('services:price',{ serviceId:h.service('washing'),vehicleTypeId:h.category,status:'unavailable' });
    assert.throws(()=>h.call('visits:quote',h.selection()),/unavailable for this vehicle category/);
    assert.equal(h.db.prepare('SELECT price FROM service_prices WHERE service_id=? AND vehicle_type_id=?').get(h.service('washing'),h.category).price,0);
    h.call('services:price',{ serviceId:h.service('washing'),vehicleTypeId:h.category,status:'unconfigured' }); assert.throws(()=>h.call('visits:quote',h.selection()),/Configure a price/);
    h.set('washing',h.category,10); assert.equal(h.call('visits:quote',h.selection()).totalPesewas,1000);
    assert.equal(h.call('visits:get',{ id:free.id }).totalPesewas,0);
    assert.throws(()=>h.call('services:price',{ serviceId:h.service('washing'),vehicleTypeId:h.category,status:'unavailable',price:0 }),/do not use a price/);
    assert.throws(()=>h.call('services:price',{ serviceId:h.service('washing'),vehicleTypeId:h.category,status:'available' }),/price/);
  } finally { h.db.close(); }
});

test('main and extra prices vary independently by category and totals retain every line and worker',async()=>{
  const h=harness(); try {
    await h.login(); h.set('washing',h.category,12.25); h.set('blowing',h.category,3.5); h.set('engine_wash',h.category,2.1); h.set('under_wash',h.category,4.65); h.set('washing',h.suv,20);
    assert.equal(h.call('visits:quote',h.selection(['washing'])).totalPesewas,1225);
    assert.equal(h.call('visits:quote',h.selection(['blowing'])).totalPesewas,350);
    assert.equal(h.call('transactions:quote',{ vehicleTypeId:h.suv,serviceIds:[h.service('washing')] }).total,20);
    const selection={ ...h.selection(['washing','engine_wash','under_wash']),assignments:[{ serviceId:h.service('washing'),workerId:h.worker },{ serviceId:h.service('engine_wash'),workerId:h.other },{ serviceId:h.service('under_wash'),workerId:h.worker }] };
    const visit=h.save(selection); assert.equal(visit.totalPesewas,1900); assert.equal(visit.lines.length,3);
    assert.deepEqual(visit.lines.map(l=>l.serviceCode),['washing','engine_wash','under_wash']);
    assert.deepEqual(visit.lines.map(l=>l.workerAssignment.workerId),[h.worker,h.other,h.worker]);
    const payment=h.call('visits:payment',{ id:visit.id,amountPesewas:1900,method:'cash',requestKey:randomUUID() }); assert.equal(payment.outstandingPesewas,0); assert.equal(payment.lines.length,3);
    h.set('engine_wash',h.category,8); assert.equal(h.call('visits:quote',selection).totalPesewas,2490);
    assert.equal(h.call('visits:get',{ id:visit.id }).lines[1].unitPrice,2.1); assert.equal(h.call('visits:get',{ id:visit.id }).paidPesewas,1900);
    assert.throws(()=>h.call('visits:quote',h.selection(['washing','blowing'])),/either washing or blowing/);
    assert.throws(()=>h.call('visits:quote',h.selection(['engine_wash'])),/exactly one/);
    h.set('engine_wash',null,8); assert.throws(()=>h.call('visits:quote',{ mode:'non_vehicle',vehicleTypeId:null,serviceIds:[h.service('engine_wash')],assignments:[] }),/require a vehicle visit/);
  } finally { h.db.close(); }
});

test('extra role classification remains stable and carpet cleaning remains independent without registration',async()=>{
  const h=harness(); try {
    await h.login(); const custom=h.call('services:add',{ name:'Custom engine treatment',kind:'engine_wash' }).id;
    assert.equal(h.call('services:get').services.find(s=>s.id===custom).role,'vehicle_extra');
    assert.throws(()=>h.call('services:kind',{ serviceId:custom,kind:'other' }),/cannot be changed/);
    const carpet=h.call('services:add',{ name:'Carpet cleaning',kind:'carpet_cleaning' }).id;
    h.call('services:price',{ serviceId:carpet,vehicleTypeId:null,price:7.75 });
    const visit=h.save({ mode:'non_vehicle',vehicleTypeId:null,serviceIds:[carpet],assignments:[{ serviceId:carpet,workerId:h.worker }] });
    assert.equal(visit.totalPesewas,775); assert.equal(visit.vehicleId,null); assert.equal(visit.lines[0].serviceRole,'independent');
    h.db.prepare("UPDATE services SET name='Renamed engine service' WHERE id=?").run(h.service('engine_wash'));
    initialize(h.db); assert.equal(h.db.prepare("SELECT count(*) AS n FROM service_roles WHERE code='engine_wash'").get().n,2);
    assert.equal(h.db.prepare("SELECT count(*) AS n FROM services WHERE name='Engine Wash'").get().n,0);
  } finally { h.db.close(); }
});

test('category and pricing operations require trusted active administrator authentication',async()=>{
  const h=harness(),channels=['vehicle-types:get','vehicle-types:add','vehicle-types:update','vehicle-types:status','services:price','services:kind']; try {
    for(const channel of channels) assert.throws(()=>h.call(channel,{}),/SESSION_EXPIRED/);
    await h.login(); for(const channel of channels) assert.throws(()=>h.handlers[channel]({ sender:{} },{}),/Untrusted/);
    h.db.prepare("UPDATE users SET role='cashier'").run(); for(const channel of channels) assert.throws(()=>h.call(channel,{}),/SESSION_EXPIRED/);
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM service_prices').get().n,0);
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM vehicle_types').get().n,43);
  } finally { h.db.close(); }
});
