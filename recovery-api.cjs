const {randomBytes,createHash,randomUUID}=require('node:crypto');
const bcrypt=require('bcryptjs');
// Codes have 256 random bits, so a SHA-256 digest resists offline guessing.
const digest=code=>createHash('sha256').update(code).digest('hex');
function registerRecoveryHandlers({ipcMain,getDatabase,validateSender,verifyCurrentPassword,isSessionCurrent,revokeAll,getEpoch=()=>0,now=Date.now}) {
 const pending=new WeakMap();
 function discard(sender){pending.delete(sender);}
 function setupHash(event,input){
  validateSender(event);const p=pending.get(event.sender);
  if(!p||p.kind!=='setup'||p.id!==input?.recoveryId||input?.savedRecovery!==true||p.expires<now())throw Error('Generate a recovery code and confirm that you saved it.');
  return p.hash;
 }
 ipcMain.handle('recovery:prepare',async(event,input)=>{
  validateSender(event);pending.delete(event.sender);
  const epoch=getEpoch(),database=getDatabase();
  const kind=input?.kind;let extra={};
  if(kind==='setup'){
   if(getDatabase().prepare('SELECT id FROM business_settings LIMIT 1').get())throw Error('Setup has already been completed.');
  }else if(kind==='replace'){
   const v=await verifyCurrentPassword(event,input?.password);
   extra={userId:v.user.id,passwordHash:v.passwordHash,identity:v.identity};
  }else if(kind==='reset'){
   const db=getDatabase();
   // Reserve attempts before asynchronous work, including requests interrupted by exit.
   db.transaction(()=>{
    const limit=db.prepare('SELECT * FROM recovery_attempts WHERE id=1').get();
    if(now()<limit.blocked_until)throw Error('Too many recovery attempts. Wait 15 minutes before trying again.');
    const failures=limit.failures+1;
    db.prepare('UPDATE recovery_attempts SET failures=?,blocked_until=? WHERE id=1').run(failures>=5?0:failures,failures>=5?now()+900000:0);
   })();
   if(typeof input?.code!=='string'||!/^[A-Fa-f0-9-]{64,79}$/.test(input.code))throw Error('Invalid or unavailable recovery code.');
   const codeHash=digest(input.code.replace(/-/g,'').toUpperCase());
   const user=db.prepare("SELECT u.id,u.password_hash FROM administrator_recovery r JOIN users u ON u.id=r.user_id WHERE r.code_hash=? AND u.is_active=1 AND u.role='admin'").get(codeHash);
   if(!user)throw Error('Invalid or unavailable recovery code.');
   if(typeof input.newPassword!=='string'||input.newPassword.length<8||Buffer.byteLength(input.newPassword,'utf8')>72||input.newPassword!==input.confirmPassword)throw Error('New passwords must match and contain at least 8 characters, up to 72 UTF-8 bytes.');
   extra={userId:user.id,passwordHash:user.password_hash,oldCodeHash:codeHash,newPasswordHash:await bcrypt.hash(input.newPassword,12)};
   validateSender(event);
   if(getDatabase()!==db)throw Error('Database changed. Start recovery again.');
  }else throw Error('Invalid recovery request.');
  if(epoch!==getEpoch()||database!==getDatabase())throw Error('Security state changed. Start again.');
  const code=randomBytes(32).toString('hex').toUpperCase(),id=randomUUID();
  pending.set(event.sender,{kind,id,epoch,database,hash:digest(code),expires:now()+600000,...extra});
  return {id,code:code.match(/.{8}/g).join('-')};
 });
 ipcMain.handle('recovery:confirm',(event,input)=>{
  validateSender(event);const p=pending.get(event.sender);
  if(!p||p.id!==input?.id||input?.saved!==true||p.expires<now()||p.kind==='setup')throw Error('Recovery confirmation expired. Start again and save the new code.');
  pending.delete(event.sender);
  if(p.epoch!==getEpoch()||p.database!==getDatabase())throw Error('Security state changed. Start again.');
  if(p.kind==='replace'&&!isSessionCurrent(event,p.identity))throw Error('SESSION_EXPIRED: Sign in again.');
  const db=getDatabase();
  const result=db.transaction(()=>{
   const user=db.prepare("SELECT id,username,password_hash FROM users WHERE id=? AND role='admin' AND is_active=1").get(p.userId);
   if(!user||user.password_hash!==p.passwordHash)throw Error('Credentials changed. Start again.');
   if(p.kind==='reset'){
    if(db.prepare('SELECT code_hash FROM administrator_recovery WHERE user_id=?').get(user.id)?.code_hash!==p.oldCodeHash)throw Error('Recovery code is no longer valid.');
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(p.newPasswordHash,user.id);
   }
   db.prepare('INSERT INTO administrator_recovery(user_id,code_hash) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET code_hash=excluded.code_hash').run(user.id,p.hash);
   if(p.kind==='reset')db.prepare('UPDATE recovery_attempts SET failures=0,blocked_until=0 WHERE id=1').run();
   return {username:user.username};
  })();
  revokeAll();return result;
 });
 return {setupHash,discard};
}
module.exports={registerRecoveryHandlers};
