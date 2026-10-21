const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const { stripTypeScriptTypes } = require('node:module');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const root = path.join(__dirname, '..');
const source = stripTypeScriptTypes(fs.readFileSync(path.join(root, 'src/pages/setupValidation.ts'), 'utf8')).replace(/export /g, '');
const validation = vm.runInNewContext(source + '\n({initialValues,validateStep})', { TextEncoder });
const input = {businessName:' Sparkle Wash ',phone:'+233 24 123 4567',address:'Accra',fullName:'Admin',username:'admin',password:'a-safe-password'};
function harness(development = false, options = {}) {
  const db = new Database(':memory:');
  const handlers = {}, files = new Map(), removed = [];
  let ready, opened = 0, enrollment = {};
  const paths = [];
  const frame = {url: development ? 'http://localhost:5173/' : pathToFileURL(path.join(root, 'dist/index.html')).href};
  const sender = {mainFrame:frame};
  const event = {sender,senderFrame:frame};
  class Window {
    constructor(){this.webContents=new EventEmitter();this.webContents.setWindowOpenHandler=()=>{};}
    loadURL(){return Promise.resolve();} loadFile(){return Promise.resolve();}
    static fromWebContents(candidate){return candidate === sender ? {} : null;}
  }
  const mockFs = {...fs,mkdirSync:()=>{},writeFileSync:(name,bytes)=>files.set(name,bytes),rmSync:name=>{removed.push(name);files.delete(name);}};
  const mockRequire = name => name === 'electron' ? {
    app:{isPackaged:Boolean(options.packaged),getPath:()=>path.join(root,'isolated-test-data'),setPath:(...args)=>paths.push(args),whenReady:()=>({then:fn=>ready=fn}),on:()=>{}},
    BrowserWindow:Window,ipcMain:{handle:(name,fn)=>handlers[name]=fn},dialog:{showErrorBox:()=>{}},
    nativeImage: options.nativeImage,
  } : name === './app-api.cjs' ? require(path.join(root,'app-api.cjs')) : name === 'better-sqlite3' ? function(){opened++;return db;} : name === 'node:fs' ? mockFs : name.startsWith('./') ? require(path.join(root,name)) : require(name);
  vm.runInNewContext(fs.readFileSync(path.join(root,'main.js'),'utf8'),{require:mockRequire,process:{argv:development?['--dev']:[],env:options.env??{},platform:'win32'},__dirname:root,Buffer,Uint8Array,console:{...console,error:()=>{}}});
  ready();
  return {db,event,files,removed,paths,status:()=>handlers['setup:status'](event),complete:value=>handlers['setup:complete'](event,{...value,...enrollment}),enroll:async()=>{const p=await handlers['recovery:prepare'](event,{kind:'setup'});enrollment={recoveryId:p.id,savedRecovery:true};},handlers,get opened(){return opened;}};
}

test('main-process setup rejects damaged images even with a valid PNG signature',async()=>{
  const h=harness(false,{nativeImage:{createFromBuffer:()=>({isEmpty:()=>true})}});
  try {
    await assert.rejects(h.complete({...input,logo:{mimeType:'image/png',bytes:new Uint8Array([137,80,78,71,13,10,26,10])}}),/damaged/);
    assert.equal(h.opened,0);assert.equal(h.files.size,0);
  }finally{h.db.close();}
});
test('setup revalidates its originating frame after asynchronous password hashing',async()=>{
  const h=harness();try {
    const pending=h.complete(input);h.event.senderFrame.url='https://untrusted.example/';
    await assert.rejects(pending,/application window/);
    assert.equal(h.db.prepare('SELECT count(*) n FROM business_settings').get().n,0);
    assert.equal(h.db.prepare('SELECT count(*) n FROM users').get().n,0);
  }finally{h.db.close();}
});
test('packaged product naming retains the historical user-data directory',()=>{
  const h=harness(false,{packaged:true});try {
    assert.deepEqual(h.paths[0],['userData',path.join(root,'isolated-test-data','wash-bay-manager')]);
  }finally{h.db.close();}
});
test('desktop test data isolation can explicitly override the user-data directory',()=>{
  const directory=path.join(root,'isolated-test-data');
  const h=harness(false,{env:{WASH_BAY_USER_DATA_PATH:directory}});try {
    assert.deepEqual(h.paths[0],['userData',directory]);assert.equal(h.opened,0);
  }finally{h.db.close();}
});
test('validation catches empty, whitespace, phone, mismatch and bcrypt byte limits',()=>{
  const {initialValues,validateStep}=validation;
  assert.equal(Object.keys(validateStep(initialValues,1)).length,3);
  assert.ok(validateStep({...initialValues,businessName:'  '},1).businessName);
  assert.equal(Object.keys(validateStep({...input,confirmPassword:input.password},1)).length,0);
  assert.ok(validateStep({...input,phone:'abc'},1).phone);
  assert.ok(validateStep({...input,confirmPassword:'wrong'},2).confirmPassword);
  assert.ok(validateStep({...input,password:'é'.repeat(37),confirmPassword:'é'.repeat(37)},2).password);
  assert.equal(Object.keys(validateStep({...input,confirmPassword:input.password},2)).length,0);
});
test('setup persists GHS and hashed admin atomically; duplicate preserves records',async()=>{
  const h=harness();try{
    assert.equal(h.opened,0);assert.equal(h.status().isComplete,false);
    await h.enroll();
    await h.complete(input);
    const settings=h.db.prepare('SELECT * FROM business_settings').get();
    assert.equal(settings.currency,'GHS');assert.equal(settings.business_name,'Sparkle Wash');
    const user=h.db.prepare('SELECT * FROM users').get();assert.equal(user.role,'admin');
    assert.notEqual(user.password_hash,input.password);assert.ok(await bcrypt.compare(input.password,user.password_hash));
    assert.equal(h.status().isComplete,true);
    await assert.rejects(h.complete(input),/already been completed/);
    assert.deepEqual(h.db.prepare('SELECT * FROM business_settings').get(),settings);
  }finally{h.db.close();}
});
test('rejects untrusted senders, malformed fields, unsafe passwords and invalid logo data',async()=>{
  const h=harness(true);try{
    assert.throws(()=>h.handlers['setup:status']({sender:{},senderFrame:{}}),/application window/);
    await assert.rejects(h.handlers['setup:complete']({sender:h.event.sender,senderFrame:{url:'http://localhost:5173/'}},input),/application window/);
    assert.equal(h.opened,0);
    for(const invalid of [{businessName:3},{phone:'123'},{password:'short'},{password:'é'.repeat(37)},{logo:{mimeType:'image/png',bytes:new Uint8Array([1,2])}},{logo:{mimeType:'image/png',bytes:new Uint8Array(0)}}]) await assert.rejects(h.complete({...input,...invalid}));
    assert.equal(h.opened,0);assert.equal(h.files.size,0);
  }finally{h.db.close();}
});
test('user insert failure rolls back business settings and removes only new logo',async()=>{
  const h=harness();try{
    await h.enroll();h.status();h.db.prepare("INSERT INTO users(username,password_hash,full_name,role) VALUES ('admin','existing-hash','Existing','admin')").run();
    await assert.rejects(h.complete({...input,logo:{mimeType:'image/png',bytes:new Uint8Array([137,80,78,71,13,10,26,10])}}),/records have been preserved/);
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM business_settings').get().n,0);
    assert.equal(h.db.prepare('SELECT password_hash FROM users').get().password_hash,'existing-hash');
    assert.equal(h.files.size,0);assert.equal(h.removed.length,1);
  }finally{h.db.close();}
});
test('simultaneous setup submissions create exactly one business and admin',async()=>{
  const h=harness();try{
    await h.enroll();
    const results=await Promise.allSettled([h.complete(input),h.complete(input)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM users').get().n,1);
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM business_settings').get().n,1);
  }finally{h.db.close();}
});
test('existing currency is not changed by setup status or a repeated submission',async()=>{
  const h=harness();try{
    h.status();h.db.prepare("INSERT INTO business_settings(id,business_name,currency) VALUES (1,'Existing','USD')").run();
    assert.equal(h.status().isComplete,true);await assert.rejects(h.complete(input));
    assert.equal(h.db.prepare('SELECT currency FROM business_settings').get().currency,'USD');
  }finally{h.db.close();}
});
test('setup requires a generated code and explicit saved confirmation in the main process',async()=>{
 const h=harness();try{
  await assert.rejects(h.complete(input),/confirm that you saved/);
  assert.equal(h.db.prepare('SELECT count(*) n FROM business_settings').get().n,0);
  const p=await h.handlers['recovery:prepare'](h.event,{kind:'setup'});
  await assert.rejects(h.handlers['setup:complete'](h.event,{...input,recoveryId:p.id,savedRecovery:false}),/confirm that you saved/);
  await h.handlers['setup:complete'](h.event,{...input,recoveryId:p.id,savedRecovery:true});
  assert.match(h.db.prepare('SELECT code_hash FROM administrator_recovery').get().code_hash,/^[a-f0-9]{64}$/);
  await assert.rejects(h.handlers['recovery:prepare'](h.event,{kind:'setup'}),/already been completed/);
 }finally{h.db.close();}
});
