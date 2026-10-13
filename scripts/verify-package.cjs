const fs = require('node:fs');
const path = require('node:path');
async function verify() {
  const { listPackage, extractFile } = await import('@electron/asar');
  const archive = path.resolve(__dirname, '../release/win-unpacked/resources/app.asar');
  const files = listPackage(archive).map(name => name.replaceAll('\\', '/').replace(/^\//, ''));
  const forbidden = files.filter(name => /(^|\/)(tests|desktop-tests|\.git|\.codex|\.aws|Washing-Bay-Management)(\/|$)|(^|\/)\.env(?:\.|$)|\.(sqlite(?:-wal|-shm)?|db|wbbak)$/i.test(name));
  if (forbidden.length) throw Error('Forbidden package files: ' + forbidden.join(', '));
  const pkg = JSON.parse(extractFile(archive, 'package.json'));
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
}
verify().catch(error => { console.error(error.message); process.exitCode = 1; });
