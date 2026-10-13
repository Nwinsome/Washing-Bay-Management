module.exports = {
  appId: 'com.washbay.manager',
  productName: 'Washing Bay Management System',
  directories: { app: '.desktop-app', output: 'release' },
  files: ['main.js', 'preload.js', '*-api.cjs', 'database-storage.cjs', 'logo-assets.cjs', 'dist/**', 'src/database/*.sql', 'package.json',
    '!node_modules/better-sqlite3/{src,deps,build}/**',
    '!node_modules/better-sqlite3/prebuilds/{darwin-*,linux*,win32-arm64}.node'],
  asar: true,
  asarUnpack: ['node_modules/better-sqlite3/**'],
  // better-sqlite3 13 ships Node-API binaries. prepare-desktop verifies the
  // exact Windows binary in the installed Electron runtime before packaging.
  npmRebuild: false,
  win: { target: [{ target: 'nsis', arch: ['x64'] }], executableName: 'Washing Bay Management System', signExecutable: false },
  nsis: {
    oneClick: false, perMachine: false, allowElevation: false,
    allowToChangeInstallationDirectory: true, createDesktopShortcut: true,
    createStartMenuShortcut: true, shortcutName: 'Washing Bay Management System',
    deleteAppDataOnUninstall: false,
    runAfterFinish: false,
    artifactName: 'Washing-Bay-Management-System-${version}-Setup-${arch}.${ext}',
  },
  publish: null,
};
