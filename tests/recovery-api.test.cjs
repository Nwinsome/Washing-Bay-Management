const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Database=require('better-sqlite3'),bcrypt=require('bcryptjs');
const {registerApplicationHandlers}=require('../app-api.cjs');
const schema=fs.readFileSync(path.join(__dirname,'../src/database/schema.sql'),'utf8');
function harness(){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'wash-recovery-')),filename=path.join(folder,'db.sqlite');let db=new Database(filename),time=1000000,handlers,controller;
 db.exec(schema);db.prepare("INSERT INTO business_settings(id,business_name) VALUES(1,'Preserved Bay')").run();db.prepare("INSERT INTO users(username,password_hash,full_name,role) VALUES('owner',?,'Owner','admin')").run(bcrypt.hashSync('old-password',4));db.prepare("INSERT INTO customers(full_name) VALUES('Preserved customer')").run();
 const sender={},second={},event={sender};
 function register(){handlers={};controller=registerApplicationHandlers({ipcMain:{handle:(n,f)=>handlers[n]=f},getDatabase:()=>db,validateSender:e=>{if(e.sender!==sender&&e.sender!==second)throw Error('Untrusted');},now:()=>time});}register();
 const call=(n,input,e=event)=>handlers[n](e,input);
 return {get db(){return db;},call,event,second,advance:ms=>time+=ms,restart(){db.close();db=new Database(filename);register();},cleanup(){db.close();fs.rmSync(folder,{recursive:true,force:true});},login:(e=event,password='old-password')=>call('auth:login',{username:'owner',password},e)};
}
async function enroll(h){await h.login();const p=await h.call('recovery:prepare',{kind:'replace',password:'old-password'});h.call('recovery:confirm',{id:p.id,saved:true});return p.code;}
const reset=(h,code)=>h.call('recovery:prepare',{kind:'reset',code,newPassword:'new-password',confirmPassword:'new-password'});
test('additive existing-installation migration preserves accounts and business records and is repeatable',()=>{
 const h=harness();try{const before=h.db.prepare('SELECT * FROM users').all(),records=h.db.prepare('SELECT * FROM customers').all();h.db.exec('DROP TABLE administrator_recovery; DROP TABLE recovery_attempts; UPDATE application_metadata SET schema_version=11');h.db.transaction(()=>h.db.exec(schema))();h.db.exec(schema);assert.deepEqual(h.db.prepare('SELECT * FROM users').all(),before);assert.deepEqual(h.db.prepare('SELECT * FROM customers').all(),records);assert.equal(h.db.prepare('SELECT count(*) n FROM administrator_recovery').get().n,0);assert.equal(h.db.prepare('SELECT schema_version FROM application_metadata').get().schema_version,12);}finally{h.cleanup();}
});
test('invalid codes and malformed requests count toward cooldown across process/database restarts',async()=>{
 const h=harness();try{const code=await enroll(h);for(let i=0;i<5;i++)await assert.rejects(reset(h,'invalid'),/Invalid/);h.restart();await assert.rejects(reset(h,code),/15 minutes/);h.advance(900001);assert.ok((await reset(h,code)).code);}finally{h.cleanup();}
});
test('successful username-free recovery rotates codes, revokes every session and preserves business records',async()=>{
 const h=harness();try{const code=await enroll(h);await h.login();await h.login({sender:h.second});const before=h.db.prepare('SELECT * FROM customers').all();const p=await reset(h,code);assert.equal(h.call('auth:session').username,'owner');assert.throws(()=>h.call('recovery:confirm',{id:p.id,saved:false}),/confirmation/);const result=h.call('recovery:confirm',{id:p.id,saved:true});assert.equal(result.username,'owner');assert.equal(h.call('auth:session'),null);assert.equal(h.call('auth:session',undefined,{sender:h.second}),null);assert.equal((await h.login()).ok,false);assert.equal((await h.login(h.event,'new-password')).ok,true);await assert.rejects(reset(h,code),/Invalid/);assert.ok((await reset(h,p.code)).id);assert.deepEqual(h.db.prepare('SELECT * FROM customers').all(),before);assert.equal(h.db.prepare('SELECT business_name FROM business_settings').get().business_name,'Preserved Bay');const stored=h.db.prepare('SELECT code_hash FROM administrator_recovery').get().code_hash;assert.match(stored,/^[a-f0-9]{64}$/);assert.notEqual(stored,p.code.replaceAll('-','').toLowerCase());assert.equal(h.db.prepare('SELECT count(*) n FROM audit_logs').get().n,0);}finally{h.cleanup();}
});
test('replacement requires administrator password and invalidates previous code',async()=>{
 const h=harness();try{const old=await enroll(h);await assert.rejects(h.call('recovery:prepare',{kind:'replace',password:'old-password'}),/SESSION_EXPIRED/);await h.login();await assert.rejects(h.call('recovery:prepare',{kind:'replace',password:'wrong'}),/incorrect/);const p=await h.call('recovery:prepare',{kind:'replace',password:'old-password'});h.call('recovery:confirm',{id:p.id,saved:true});await assert.rejects(reset(h,old),/Invalid/);assert.ok(await reset(h,p.code));}finally{h.cleanup();}
});
test('failed atomic update retains both original password and original recovery code',async()=>{
 const h=harness();try{const code=await enroll(h),before=h.db.prepare('SELECT password_hash FROM users').get().password_hash,p=await reset(h,code);h.db.exec("CREATE TRIGGER fail_recovery BEFORE UPDATE ON administrator_recovery BEGIN SELECT RAISE(ABORT,'injected failure'); END;");assert.throws(()=>h.call('recovery:confirm',{id:p.id,saved:true}),/injected failure/);assert.equal(h.db.prepare('SELECT password_hash FROM users').get().password_hash,before);h.db.exec('DROP TRIGGER fail_recovery');assert.ok(await reset(h,code));}finally{h.cleanup();}
});
test('expired, untrusted and stale recovery confirmations cannot mutate credentials',async()=>{
 const h=harness();try{const code=await enroll(h),p=await reset(h,code);assert.throws(()=>h.call('recovery:confirm',{id:p.id,saved:true},{sender:{}}),/Untrusted/);h.advance(600001);assert.throws(()=>h.call('recovery:confirm',{id:p.id,saved:true}),/expired/);const a=await reset(h,code),b=await reset(h,code);assert.throws(()=>h.call('recovery:confirm',{id:a.id,saved:true}),/expired/);h.call('recovery:confirm',{id:b.id,saved:true});}finally{h.cleanup();}
});
