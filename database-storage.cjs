const fsDefault=require('node:fs');const path=require('node:path');const {randomUUID,createHash}=require('node:crypto');
const {validateLogo,readLegacyLogo}=require('./logo-assets.cjs');
const PRODUCT='wash-bay-manager',SCHEMA=12,FORMAT=1;

function createDatabaseStorage({Database,databasePath,userData,appVersion,schemaDirectory,fs=fsDefault,now=Date.now,fault=()=>{},onIdle=()=>{}}){
 const active=path.resolve(databasePath),parent=path.dirname(active),logoRoot=path.join(userData,'logos'),backupRoot=path.join(userData,'backups'),journalPath=active+'.restore-journal.json',historyPath=path.join(userData,'backup-history.json');
 let db=null,busy=false;const expectedSchemas=new Map();
 function hashFile(filename){const hash=createHash('sha256'),fd=fs.openSync(filename,'r'),buffer=Buffer.alloc(65536);try{let count;while((count=fs.readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,count));return hash.digest('hex');}finally{fs.closeSync(fd);}}
 function schemaObjects(connection){return connection.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT GLOB 'sqlite_*' AND sql IS NOT NULL ORDER BY type,name").all().map(o=>({...o,sql:o.sql.replace(/\s+/g,' ').trim()}));}
 function referenceSchema(version=SCHEMA){
  if(!expectedSchemas.has(version)){
   const reference=new Database(':memory:');try{
    reference.exec(fs.readFileSync(path.join(schemaDirectory,'schema.sql'),'utf8'));
    // Schema 12 only added these two tables to schema 11. Keep this explicit
    // allowlist: never accept an arbitrary old schema and run its triggers.
    if(version===11)reference.exec('DROP TABLE administrator_recovery; DROP TABLE recovery_attempts;');
    expectedSchemas.set(version,JSON.stringify(schemaObjects(reference)));
   }finally{reference.close();}
  }
  return expectedSchemas.get(version);
 }
 function durableJSON(filename,value){const temp=filename+'.tmp-'+randomUUID();const fd=fs.openSync(temp,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value,null,2),'utf8');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}try{fs.renameSync(temp,filename);}catch(error){try{fs.unlinkSync(temp);}catch{}throw error;}}
 function ownedSibling(filename,prefix){const resolved=path.resolve(filename);if(path.dirname(resolved)!==parent||!path.basename(resolved).startsWith(path.basename(active)+prefix))throw Error('Invalid restore recovery path.');if(fs.existsSync(resolved)&&(fs.lstatSync(resolved).isSymbolicLink()||!fs.statSync(resolved).isFile()))throw Error('Restore recovery paths must be regular database files.');return resolved;}
 function moveSidecars(from,to){for(const suffix of ['-wal','-shm'])if(fs.existsSync(from+suffix))fs.renameSync(from+suffix,to+suffix);}
 function validateDatabase(filename,{portable=true,schemaVersion=SCHEMA}={}){
 if(![11,SCHEMA].includes(schemaVersion))throw Error('Backup schema is incompatible with this application.');
 const connection=new Database(filename,{readonly:true,fileMustExist:true});
 try{
  const integrity=connection.pragma('integrity_check');if(integrity.length!==1||Object.values(integrity[0])[0]!=='ok')throw Error('SQLite integrity check failed.');
  if(connection.pragma('foreign_key_check').length)throw Error('Backup contains broken financial or application references.');
  const metadata=connection.prepare('SELECT product_id,schema_version FROM application_metadata WHERE id=1').get();if(metadata?.product_id!==PRODUCT||metadata.schema_version!==schemaVersion)throw Error('Backup schema is incompatible with this application.');
  if(JSON.stringify(schemaObjects(connection))!==referenceSchema(schemaVersion))throw Error('Backup is incomplete, customized or has an incompatible application schema.');
  const business=connection.prepare('SELECT business_name,logo_path FROM business_settings WHERE id=1').get();if(!business?.business_name?.trim())throw Error('Backup must contain a registered business.');
  const users=connection.prepare('SELECT password_hash FROM users').all();if(!users.length||users.some(u=>!/^\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}$/.test(u.password_hash)))throw Error('Backup contains invalid administrator password hashes.');
  if(schemaVersion>=12&&connection.prepare('SELECT code_hash FROM administrator_recovery').all().some(r=>!/^[a-f0-9]{64}$/.test(r.code_hash)))throw Error('Backup contains invalid recovery-code hashes.');
  if(!connection.prepare("SELECT id FROM users WHERE is_active=1 AND role='admin' LIMIT 1").get())throw Error('Backup has no active administrator account.');
  if(portable&&business.logo_path)throw Error('Backup has an external logo reference instead of a portable embedded asset.');
  const asset=connection.prepare('SELECT mime_type,bytes FROM business_logo_assets WHERE business_id=1').get();if(asset)validateLogo(asset.bytes,asset.mime_type);
  return {businessName:business.business_name,hasLogo:Boolean(asset)};
 }catch(error){if(error.message?.includes('no such table'))throw Error('Backup is missing required application tables.');throw error;}finally{connection.close();}
 }
 function recover(){
  if(!fs.existsSync(journalPath))return;
  let record;try{record=JSON.parse(fs.readFileSync(journalPath,'utf8'));}catch{throw Error(`Restore recovery journal cannot be read. Keep the database files intact and recover from a verified safety backup. Journal: ${journalPath}`);}
  if(record.active!==active||!['prepared','committed'].includes(record.phase))throw Error('Restore recovery journal is invalid; automatic recovery stopped.');
  const rollback=ownedSibling(record.rollback,'.before-restore-'),stage=ownedSibling(record.stage,'.restore-stage-');
  if(record.phase==='prepared'){
   if(fs.existsSync(rollback)){
    if(fs.existsSync(active)){const rejected=active+'.failed-restore-'+randomUUID();fs.renameSync(active,rejected);moveSidecars(active,rejected);}
    fs.renameSync(rollback,active);moveSidecars(rollback,active);
   }else if(!fs.existsSync(active))throw Error(`Restore recovery cannot find the previous database. Safety backup: ${record.safetyBackup}`);
   // Stage and failed replacement files are deliberately retained for diagnosis.
  }else{if(!fs.existsSync(active))throw Error(`Restored database is missing. Safety backup: ${record.safetyBackup}`);validateDatabase(active);}
  fs.unlinkSync(journalPath);
  return {recovered:true,phase:record.phase,stage,safetyBackup:record.safetyBackup};
 }
 function open(){
  recover();
  fs.mkdirSync(parent,{recursive:true});
  const connection=new Database(active);try{
   const metadataExists=connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='application_metadata'").get();
   if(metadataExists){const metadata=connection.prepare('SELECT product_id,schema_version FROM application_metadata WHERE id=1').get();if(metadata&&(metadata.product_id!==PRODUCT||metadata.schema_version>SCHEMA))throw Error('The active database belongs to an incompatible application version.');}
   connection.pragma('foreign_keys=ON');connection.pragma('journal_mode=WAL');
   connection.transaction(()=>{for(const file of ['schema.sql','catalog.sql'])connection.exec(fs.readFileSync(path.join(schemaDirectory,file),'utf8'));})();
   return connection;
  }catch(error){connection.close();throw error;}
 }
 function getDatabase(){if(busy)throw Error('DATABASE_BUSY: Database maintenance is in progress. Please retry after it finishes.');if(!db)db=open();return db;}
 async function exclusive(action){if(busy)throw Error('DATABASE_BUSY: Another backup or restore is already running.');const current=getDatabase();busy=true;try{return await action(current);}finally{busy=false;try{onIdle();}catch{}}}
 function history(){try{if(!fs.existsSync(historyPath))return [];const stat=fs.statSync(historyPath);if(stat.size>1024*1024)throw Error('Backup history is too large.');const rows=JSON.parse(fs.readFileSync(historyPath,'utf8'));if(!Array.isArray(rows))throw Error('Backup history is invalid.');return rows.slice(-100);}catch(error){throw Error('Backup history could not be read: '+error.message);}}
 function record(info){fs.mkdirSync(userData,{recursive:true});durableJSON(historyPath,[...history(),info].slice(-100));}
 function inspect(folder){
  const resolved=path.resolve(folder),manifestPath=path.join(resolved,'manifest.json'),filename=path.join(resolved,'database.sqlite');
  if(fs.lstatSync(resolved).isSymbolicLink()||!fs.statSync(resolved).isDirectory())throw Error('Choose a regular application backup folder.');
  for(const file of [manifestPath,filename])if(fs.lstatSync(file).isSymbolicLink()||!fs.statSync(file).isFile())throw Error('Backup files must be regular files, not links.');
  if(fs.statSync(manifestPath).size>16384)throw Error('Backup manifest is invalid or too large.');
  let manifest;try{manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));}catch{throw Error('Backup manifest could not be read.');}
  if(manifest.productId!==PRODUCT||manifest.formatVersion!==FORMAT||![11,SCHEMA].includes(manifest.schemaVersion)||typeof manifest.appVersion!=='string'||!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(manifest.appVersion)||manifest.appVersion.split('.')[0]!==appVersion.split('.')[0]||manifest.databaseFile!=='database.sqlite'||!/^\d{4}-\d{2}-\d{2}T/.test(manifest.createdAt??'')||!Number.isFinite(Date.parse(manifest.createdAt))||!/^[a-f0-9]{64}$/.test(manifest.databaseSha256??''))throw Error('Backup format or application version is incompatible.');
  for(const suffix of ['-wal','-shm'])if(fs.existsSync(filename+suffix))throw Error('Backup contains SQLite sidecar files; choose a complete verified application backup.');
  const fd=fs.openSync(filename,'r');const header=Buffer.alloc(16);try{fs.readSync(fd,header,0,16,0);}finally{fs.closeSync(fd);}if(header.toString('ascii')!=='SQLite format 3\u0000')throw Error('Backup is not a valid SQLite database.');
  if(hashFile(filename)!==manifest.databaseSha256)throw Error('Backup checksum does not match; the backup is corrupt or incomplete.');
  const details=validateDatabase(filename,{schemaVersion:manifest.schemaVersion});return {...details,folder:resolved,filename,createdAt:manifest.createdAt,appVersion:manifest.appVersion,databaseSha256:manifest.databaseSha256,schemaVersion:manifest.schemaVersion};
 }
 async function createCopy(current,destination,kind='manual'){
  const root=path.resolve(destination);fs.mkdirSync(root,{recursive:true});const folder=path.join(root,`wash-bay-${kind}-${new Date(now()).toISOString().replace(/[:.]/g,'-')}-${randomUUID()}.wbbak`);
  fs.mkdirSync(folder,{mode:0o700});const filename=path.join(folder,'database.sqlite');
  try{
   await current.backup(filename);fault('after-backup');
   const copy=new Database(filename);try{
    const business=copy.prepare('SELECT logo_path FROM business_settings WHERE id=1').get();
    if(business?.logo_path){const asset=readLegacyLogo(business.logo_path,logoRoot,fs);copy.transaction(()=>{copy.prepare('INSERT INTO business_logo_assets VALUES(1,?,?) ON CONFLICT(business_id) DO UPDATE SET mime_type=excluded.mime_type,bytes=excluded.bytes').run(asset.mimeType,asset.bytes);copy.prepare('UPDATE business_settings SET logo_path=NULL WHERE id=1').run();})();}
    copy.pragma('wal_checkpoint(TRUNCATE)');copy.pragma('journal_mode=DELETE');
   }finally{copy.close();}
   const details=validateDatabase(filename);fault('after-validation');
   const manifest={productId:PRODUCT,formatVersion:FORMAT,schemaVersion:SCHEMA,appVersion,createdAt:new Date(now()).toISOString(),databaseFile:'database.sqlite',databaseSha256:hashFile(filename),logoEmbedded:details.hasLogo};
   durableJSON(path.join(folder,'manifest.json'),manifest);const verified=inspect(folder);const result={kind,folder,filename:'database.sqlite',createdAt:manifest.createdAt,businessName:verified.businessName,verified:true};
   try{record(result);}catch(error){result.warning=error.message;}
   return result;
  }catch(error){throw Error(`Backup creation or validation failed. This folder is incomplete and must not be restored: ${folder}. ${error.message}`);}
 }
 function createBackup(destination){return exclusive(current=>createCopy(current,destination));}
 function stageRestore(folder){
  const verified=inspect(folder),stage=active+'.restore-stage-'+randomUUID()+'.sqlite';
  fs.copyFileSync(verified.filename,stage,fs.constants.COPYFILE_EXCL);
  try{
   if(hashFile(stage)!==verified.databaseSha256)throw Error('Backup changed while it was being staged.');
   validateDatabase(stage,{schemaVersion:verified.schemaVersion});
   if(verified.schemaVersion===11){
    fault('before-stage-migration');
    const copy=new Database(stage,{fileMustExist:true});try{
     copy.pragma('foreign_keys=ON');copy.pragma('journal_mode=DELETE');
     copy.transaction(()=>copy.exec(fs.readFileSync(path.join(schemaDirectory,'schema.sql'),'utf8')))();
    }finally{copy.close();}
    fault('after-stage-migration');
   }
   validateDatabase(stage);
   // Retain the original checksum for provenance; bind restore to the migrated bytes.
   return {...verified,stage,stageDatabaseSha256:hashFile(stage)};
  }catch(error){fs.unlinkSync(stage);throw error;}
 }
 function discardStage(stage){ownedSibling(stage,'.restore-stage-');if(fs.existsSync(stage))fs.unlinkSync(stage);}
 async function restore(staged,actor){return exclusive(async current=>{
  const stage=ownedSibling(staged.stage,'.restore-stage-');if(!fs.existsSync(stage))throw Error('Restore selection no longer exists. Select and validate the backup again.');if(hashFile(stage)!==(staged.stageDatabaseSha256??staged.databaseSha256))throw Error('Selected restore data changed; select and validate the backup again.');validateDatabase(stage);
  const safety=await createCopy(current,backupRoot,'safety');fault('after-safety-backup');
  const checkpoint=current.pragma('wal_checkpoint(TRUNCATE)');if(checkpoint.some(r=>r.busy!==0))throw Error('SQLite could not checkpoint because another connection is using the database. Close other database tools and retry.');
  if(fs.existsSync(active+'-wal')&&fs.statSync(active+'-wal').size>0)throw Error('SQLite WAL still contains data; restore was cancelled.');
  const rollback=active+'.before-restore-'+randomUUID()+'.sqlite',journal={active,stage,rollback,phase:'prepared',safetyBackup:safety.folder};
  durableJSON(journalPath,journal);let replacement;
  try{
   current.close();db=null;fault('after-close');
   if(fs.existsSync(active+'-wal')||fs.existsSync(active+'-shm'))throw Error('Another SQLite connection is still open. Close database tools and retry the restore.');
   fs.renameSync(active,rollback);moveSidecars(active,rollback);fault('after-old-rename');
   fs.renameSync(stage,active);fault('after-new-rename');
   validateDatabase(active);replacement=new Database(active);replacement.pragma('foreign_keys=ON');replacement.pragma('journal_mode=WAL');
   replacement.prepare("INSERT INTO audit_logs(user_id,action,entity_type,details) VALUES(NULL,'database_restored','database',?)").run(JSON.stringify({restoringAdministrator:{id:actor.id,username:actor.username},backupDate:staged.createdAt,safetyBackup:safety.folder}));
   fault('before-commit');durableJSON(journalPath,{...journal,phase:'committed'});db=replacement;replacement=null;
   try{fs.unlinkSync(journalPath);}catch{}const result={success:true,businessName:staged.businessName,safetyBackup:safety.folder,rollbackFile:rollback,restoredAt:new Date(now()).toISOString()};
   try{record({kind:'restore',folder:staged.folder,createdAt:result.restoredAt,safetyBackup:safety.folder,verified:true});}catch(error){result.warning=error.message;}
   return result;
  }catch(error){
   if(replacement?.open)replacement.close();db=null;
   try{recover();db=open();}catch(recoveryError){throw Error(`Restore failed and automatic recovery needs assistance. Keep all database files. Safety backup: ${safety.folder}. Journal: ${journalPath}. ${recoveryError.message}`);}
   throw Error(`Restore failed; the previous database was recovered. Safety backup: ${safety.folder}. ${error.message}`);
  }
 });}
 function close(){if(busy)throw Error('Database maintenance is in progress.');if(db?.open)db.close();db=null;}
 return {getDatabase,createBackup,inspect,stageRestore,discardStage,restore,history,recover,close,get busy(){return busy;},databasePath:active,backupRoot,logoRoot,journalPath,validateDatabase};
}
module.exports={createDatabaseStorage};
