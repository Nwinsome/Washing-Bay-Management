const fs = require('node:fs');
const path = require('node:path');
const {verifyWindowsIcons}=require('./verify-windows-icons.cjs');
const PE=require('pe-library');
const {Resource}=require('resedit');
function verifyVersion(filename,version){
 const entries=PE.NtExecutableResource.from(PE.NtExecutable.from(fs.readFileSync(filename),{ignoreCert:true})).entries;
 const parts=version.split('.').map(Number);
 const ms=(parts[0]*65536+parts[1])>>>0,ls=(parts[2]*65536)>>>0;
 const info=Resource.VersionInfo.fromEntries(entries);
 if(!info.length||info.some(v=>v.fixedInfo.fileVersionMS!==ms||v.fixedInfo.fileVersionLS!==ls||v.fixedInfo.productVersionMS!==ms||v.fixedInfo.productVersionLS!==ls))throw Error('Wrong Windows version resources: '+filename);
}
async function verify() {
  const { listPackage, extractFile: extractAsarFile } = await import('@electron/asar');
  const extractFile=(archive,filename)=>extractAsarFile(archive,filename.split('/').join(path.sep));
  const archive = path.resolve(__dirname, '../release/win-unpacked/resources/app.asar');
  const files = listPackage(archive).map(name => name.replaceAll('\\', '/').replace(/^\//, ''));
  const forbidden = files.filter(name => /(^|\/)(tests|desktop-tests|\.git|\.codex|\.aws|Washing-Bay-Management)(\/|$)|(^|\/)\.env(?:\.|$)|\.(sqlite(?:-wal|-shm)?|db|wbbak)$/i.test(name));
  if (forbidden.length) throw Error('Forbidden package files: ' + forbidden.join(', '));
  const pkg = JSON.parse(extractFile(archive, 'package.json'));
  const sourcePackage = require('../package.json');
  if (pkg.version !== sourcePackage.version) throw Error('Packaged version does not match source metadata.');
  const icon = fs.readFileSync(path.resolve(__dirname, '../assets/washing-bay-logo.ico'));
  if (!extractFile(archive, 'assets/washing-bay-logo.ico').equals(icon)) throw Error('Packaged window icon does not match the custom icon.');
  const expectedSizes = [16, 24, 32, 48, 64, 128, 256];
  if (icon.readUInt16LE(0) !== 0 || icon.readUInt16LE(2) !== 1 || icon.readUInt16LE(4) !== expectedSizes.length) throw Error('Invalid multi-size ICO header.');
  const frames = expectedSizes.map((size, index) => {
    const entry = 6 + index * 16;
    if ((icon[entry] || 256) !== size || (icon[entry + 1] || 256) !== size) throw Error('Unexpected ICO frame size.');
    const length = icon.readUInt32LE(entry + 8), offset = icon.readUInt32LE(entry + 12);
    if (offset + length > icon.length) throw Error('Truncated ICO frame.');
    return icon.subarray(offset, offset + length);
  });
  for (const executable of [
    path.resolve(__dirname, '../release/win-unpacked/Washing Bay Management System.exe'),
    path.resolve(__dirname, `../release/Washing-Bay-Management-System-${pkg.version}-Setup-x64.exe`),
  ]) {
    verifyWindowsIcons(executable);
    verifyVersion(executable,pkg.version);
    const bytes = fs.readFileSync(executable);
    for (let index = 0; index < frames.length; index++) {
      if (bytes.indexOf(frames[index]) < 0) throw Error(`Missing custom ${expectedSizes[index]}px icon in ${executable}`);
    }
    console.log(`Verified all custom ICO frames embedded in ${path.basename(executable)}.`);
  }
  const verificationFolder=path.resolve(__dirname,'../release-verification',pkg.version);
  const uninstaller=path.join(verificationFolder,'generated-uninstaller.exe');
  const uninstallerReport=verifyWindowsIcons(uninstaller);
  verifyVersion(uninstaller,pkg.version);
  const captured=JSON.parse(fs.readFileSync(path.join(verificationFolder,'uninstaller-icons.json'),'utf8'));
  if(captured.version!==pkg.version||captured.sha256!==uninstallerReport.sha256)throw Error('Generated uninstaller verification evidence does not match this release.');
  console.log('Verified all Washing Bay icon resources in the generated uninstaller embedded by NSIS.');
  for(const filename of ['main.js','preload.js','app-api.cjs','recovery-api.cjs','database-storage.cjs','src/database/schema.sql']){
    if(!extractFile(archive,filename).equals(fs.readFileSync(path.resolve(__dirname,'..',filename))))throw Error('Packaged security/migration source is stale: '+filename);
  }
  const sourceDist=path.resolve(__dirname,'../dist');
  const walk=(directory)=>fs.readdirSync(directory,{withFileTypes:true}).flatMap(item=>item.isDirectory()?walk(path.join(directory,item.name)):[path.relative(sourceDist,path.join(directory,item.name)).replaceAll('\\','/')]);
  const expectedDist=walk(sourceDist).map(name=>'dist/'+name).sort();
  const packagedDist=files.filter(name=>name.startsWith('dist/')&&!files.some(other=>other.startsWith(name+'/'))).sort();
  if(JSON.stringify(packagedDist)!==JSON.stringify(expectedDist))throw Error('Packaged renderer contains stale or missing assets.');
  for(const filename of expectedDist)if(!extractFile(archive,filename).equals(fs.readFileSync(path.resolve(__dirname,'..',filename))))throw Error('Packaged renderer is stale: '+filename);
  const renderer=files.filter(name=>/^dist\/assets\/.*\.js$/.test(name)).map(name=>extractFile(archive,name).toString('utf8')).join('\n');
  if(!renderer.includes('Forgot password?')||!renderer.includes('Confirm saved code and finish'))throw Error('Packaged recovery interface is missing.');
  const main=extractFile(archive,'main.js').toString('utf8');
  const config=require('../electron-builder.cjs');
  if(!main.includes("setAppUserModelId?.('"+config.appId+"')")||!main.includes("icon: path.join(__dirname, 'assets', 'washing-bay-logo.ico')"))throw Error('Window/taskbar branding configuration mismatch.');
  if(config.win.icon!=='assets/washing-bay-logo.ico'||config.nsis.installerIcon!==config.win.icon||config.nsis.uninstallerIcon!==config.win.icon||config.nsis.createDesktopShortcut!==true||config.nsis.createStartMenuShortcut!==true||config.win.signAndEditExecutable!==true)throw Error('Windows branding or shortcut configuration mismatch.');
  console.log('Verified current recovery/main/preload/migration sources and recovery UI in ASAR; window/taskbar identity and branded shortcut targets configured.');
  if (pkg.devDependencies || pkg.scripts) throw Error('Development configuration was packaged.');
  for (const required of ['main.js', 'preload.js', 'dist/index.html', 'src/database/schema.sql', 'src/database/catalog.sql']) {
    if (!files.includes(required)) throw Error('Missing runtime file: ' + required);
  }
  const allowed = new Set(['bcryptjs', 'better-sqlite3', 'node-addon-api']);
  for (const file of files) {
    const match = /^node_modules\/([^/]+)/.exec(file);
    if (match && !allowed.has(match[1]) && match[1] !== '.package-lock.json') throw Error('Unexpected runtime dependency: ' + match[1]);
  }
  const native = path.join(path.dirname(archive), 'app.asar.unpacked/node_modules/better-sqlite3/prebuilds/win32-x64.node');
  if (!fs.existsSync(native)) throw Error('Windows SQLite binary is missing from the unpacked assets.');
  console.log(`Verified ${files.length} package entries: production assets and SQLite present; no databases, test fixtures or development dependencies.`);
  console.log(`Verified version ${pkg.version} and packaged window icon (${expectedSizes.join(', ')}px).`);
}
verify().catch(error => { console.error(error.message); process.exitCode = 1; });
