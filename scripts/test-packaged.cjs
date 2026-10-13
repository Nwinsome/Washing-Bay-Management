const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const executable = process.env.WASH_BAY_PACKAGED_EXE ?? path.resolve(__dirname, '../release/win-unpacked/Washing Bay Management System.exe');
if (!fs.existsSync(executable)) throw Error('Build the Windows package first with npm run dist:win.');
const result = spawnSync(process.execPath, [require.resolve('@playwright/test/cli'), 'test'], {
  cwd: path.resolve(__dirname, '..'), stdio: 'inherit', windowsHide: true,
  env: { ...process.env, WASH_BAY_PACKAGED_EXE: executable },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
