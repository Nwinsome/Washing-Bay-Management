// Build a separate Electron dependency tree. Never rebuild the Node test binding.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const target = path.join(root, '.desktop-app');
const sourcePackage = require('../package.json');
fs.mkdirSync(target, { recursive: true });
const runtime = { ...sourcePackage, scripts: undefined, devDependencies: undefined,
  dependencies: { bcryptjs: sourcePackage.dependencies.bcryptjs, 'better-sqlite3': sourcePackage.dependencies['better-sqlite3'] },
};
fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify(runtime, null, 2));
const sources = ['main.js', 'preload.js', 'database-storage.cjs', 'logo-assets.cjs',
  ...fs.readdirSync(root).filter(name => name.endsWith('-api.cjs'))];
for (const name of sources) fs.copyFileSync(path.join(root, name), path.join(target, name));
fs.mkdirSync(path.join(target, 'assets'), { recursive: true });
fs.copyFileSync(path.join(root, 'assets/washing-bay-logo.ico'), path.join(target, 'assets/washing-bay-logo.ico'));
for (const directory of ['dist', 'src/database']) {
  const destination = path.join(target, directory);
  // Clear only this known build-output directory so old hashed bundles cannot ship.
  if(directory==='dist'){
    const resolved=path.resolve(destination);
    if(resolved!==path.join(root,'.desktop-app','dist')||fs.lstatSync(target).isSymbolicLink())throw Error('Unsafe renderer staging directory.');
    fs.rmSync(resolved,{recursive:true,force:true});
  }
  fs.mkdirSync(destination, { recursive: true });
  fs.cpSync(path.join(root, directory), destination, { recursive: true,
    filter: filename => !filename.endsWith('.ts') });
}
const copied = new Set();
function copyDependency(name) {
  if (copied.has(name)) return;
  copied.add(name);
  const metadata = path.join(root, 'node_modules', name, 'package.json');
  const source = path.dirname(metadata);
  const destination = path.join(target, 'node_modules', name);
  // Only runtime packages, never the repository or personal assets.
  fs.cpSync(source, destination, { recursive: true });
  const pkg = JSON.parse(fs.readFileSync(metadata, 'utf8'));
  for (const dependency of Object.keys(pkg.dependencies ?? {})) copyDependency(dependency);
}
for (const name of Object.keys(runtime.dependencies)) copyDependency(name);
const result = spawnSync(require('electron'), [path.join(__dirname, 'check-sqlite.cjs'), target],
  { cwd: root, stdio: 'inherit', windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
