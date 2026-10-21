const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');

// Keep the original data directory even when the installer product name changes.
if (app.setPath) app.setPath('userData', process.env.WASH_BAY_USER_DATA_PATH ?? path.join(app.getPath('appData'), 'wash-bay-manager'));
const safeIpcMain = { handle(channel, handler) {
  function failure(error) {
      console.error(`Operation ${channel} failed:`, error);
      if (error?.name === 'TypeError' || (error?.code && error.code !== 'SQLITE_CONSTRAINT_TRIGGER')) {
        throw new Error(error?.code === 'ERR_DLOPEN_FAILED'
          ? 'The database component could not load. Reinstall the application; keep your business data and backups.'
          : 'The operation could not be completed. Your records have been preserved. Check the input, available disk space and database location, then retry.');
      }
      throw new Error(typeof error?.message === 'string' ? error.message : 'The operation could not be completed. Please retry.');
  }
  ipcMain.handle(channel, (...args) => {
    try {
      const result = handler(...args);
      return result?.then ? result.catch(failure) : result;
    } catch (error) { return failure(error); }
  });
} };

const isDevelopment = !app.isPackaged && process.argv.includes('--dev');
if (process.platform === 'win32') app.setAppUserModelId?.('com.washbay.manager');
let applicationHandlers;
const storage = require('./database-storage.cjs').createDatabaseStorage({
  Database, fs,
  databasePath: process.env.WASH_BAY_DATABASE_PATH ?? path.join(app.getPath('userData'), 'wash-bay-manager.sqlite'),
  userData: app.getPath('userData'), appVersion: app.getVersion?.() ?? require('./package.json').version,
  schemaDirectory: path.join(__dirname,'src','database'),
  onIdle:()=>{if(process.platform!=='darwin'&&BrowserWindow.getAllWindows?.()?.length===0)app.quit();},
});
function getDatabase() { return storage.getDatabase(); }

function registerSetupHandlers() {
  function validateSender(event) {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    const expectedURL = isDevelopment
      ? 'http://localhost:5173/'
      : pathToFileURL(path.join(__dirname, 'dist', 'index.html')).href;
    if (!senderWindow || event.senderFrame !== event.sender.mainFrame ||
        event.senderFrame?.url !== expectedURL) {
      throw new Error('Setup is only available from the application window.');
    }
  }
  applicationHandlers = require('./app-api.cjs').registerApplicationHandlers({ ipcMain: safeIpcMain, getDatabase, validateSender, settingsEnvironment: { storage, dialog, BrowserWindow, appVersion:app.getVersion?.() ?? require('./package.json').version, nativeImage:require('electron').nativeImage } });
  safeIpcMain.handle('setup:status', (event) => {
    validateSender(event);
    const settings = getDatabase()
      .prepare('SELECT id FROM business_settings LIMIT 1')
      .get();
    return { isComplete: Boolean(settings) };
  });

  safeIpcMain.handle('setup:complete', async (event, input) => {
    validateSender(event);
    for (const [field, limit] of [['businessName', 120], ['phone', 40], ['address', 500], ['fullName', 120], ['username', 64]]) {
      if (typeof input?.[field] !== 'string' || !input[field].trim() || input[field].trim().length > limit) {
        throw new Error(`Please provide a valid ${field} (up to ${limit} characters).`);
      }
    }
    const businessName = input?.businessName?.trim();
    const phone = input?.phone?.trim();
    const address = input?.address?.trim();
    const fullName = input?.fullName?.trim();
    const username = input?.username?.trim();
    const password = input?.password;
    const logo = input?.logo;

    if (!businessName || !phone || !address || !fullName || !username) {
      throw new Error('Please complete all required fields.');
    }
    if (typeof password !== 'string' || password.length < 8) {
      throw new Error('Password must be at least 8 characters.');
    }
    if (Buffer.byteLength(password, 'utf8') > 72) {
      throw new Error('Password must not exceed 72 UTF-8 bytes.');
    }
    const phoneDigits = phone.replace(/\D/g, '');
    if (!/^[+\d\s().-]+$/.test(phone) || phoneDigits.length < 7 || phoneDigits.length > 15) {
      throw new Error('Enter a phone number with 7 to 15 digits.');
    }
    if (
      logo &&
      (!['image/png', 'image/jpeg', 'image/webp'].includes(logo.mimeType) ||
        !(logo.bytes instanceof Uint8Array) ||
        logo.bytes.byteLength === 0 || logo.bytes.byteLength > 5 * 1024 * 1024)
    ) {
      throw new Error('Logo must be a PNG, JPEG, or WebP image under 5 MB.');
    }
    if (logo) {
      const bytes = Buffer.from(logo.bytes);
      const validHeader = logo.mimeType === 'image/png'
        ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : logo.mimeType === 'image/jpeg'
          ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
      if (!validHeader) throw new Error('The logo file does not match its image format.');
      const image = require('electron').nativeImage?.createFromBuffer(bytes);
      if (image?.isEmpty()) throw new Error('The logo image is damaged or cannot be decoded. Choose another image.');
    }

    const db = getDatabase();
    const completedSetup = db.transaction((logoPath, passwordHash) => {
      if (db.prepare('SELECT id FROM business_settings LIMIT 1').get()) {
        throw new Error('Setup has already been completed.');
      }

      db.prepare(`
        INSERT INTO business_settings (id, business_name, phone, address, logo_path, currency)
        VALUES (1, ?, ?, ?, ?, 'GHS')
      `).run(businessName, phone, address, logoPath);

      const recoveryHash = applicationHandlers.recoveryHandlers.setupHash(event,input);
      db.prepare(`
        INSERT INTO users (username, password_hash, full_name, role)
        VALUES (?, ?, ?, 'admin')
      `).run(username, passwordHash, fullName);
      db.prepare('INSERT INTO administrator_recovery(user_id,code_hash) SELECT id,? FROM users WHERE username=?').run(recoveryHash,username);
    });

    let savedLogoPath;
    try {
      const passwordHash = await bcrypt.hash(password, 12);
      validateSender(event);
      if (db.prepare('SELECT id FROM business_settings LIMIT 1').get()) {
        throw new Error('Setup has already been completed.');
      }
      if (logo) {
        const extension = logo.mimeType === 'image/jpeg'
        ? '.jpg'
        : logo.mimeType === 'image/webp'
          ? '.webp'
          : '.png';
      const logoDirectory = path.join(app.getPath('userData'), 'logos');
      fs.mkdirSync(logoDirectory, { recursive: true });
      savedLogoPath = path.join(logoDirectory, `${randomUUID()}${extension}`);
      fs.writeFileSync(savedLogoPath, Buffer.from(logo.bytes));
      }
      completedSetup(savedLogoPath ?? null, passwordHash);
      applicationHandlers.recoveryHandlers.discard(event.sender);
    } catch (error) {
      if (savedLogoPath) fs.rmSync(savedLogoPath, { force: true });
      throw error;
    }

    return { success: true };
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Washing Bay Management System',
    icon: path.join(__dirname, 'assets', 'washing-bay-logo.ico'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  const webContents = window.webContents;
  webContents.on('destroyed', () => applicationHandlers.revoke(webContents));
  window.webContents.on('did-start-navigation', (_event, _url, inPlace, isMainFrame) => {
    if (isMainFrame && !inPlace) applicationHandlers.revoke(window.webContents);
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    const expected = isDevelopment ? 'http://localhost:5173/' : pathToFileURL(path.join(__dirname, 'dist', 'index.html')).href;
    if (url !== expected) event.preventDefault();
  });

  const rendererTarget = isDevelopment
    ? 'http://localhost:5173'
    : path.join(__dirname, 'dist', 'index.html');
  let reportedFailure = false;
  function reportLoadFailure(message) {
    if (reportedFailure) return;
    reportedFailure = true;
    console.error(`Renderer failed to load ${rendererTarget}: ${message}`);
    dialog.showErrorBox(
      'Wash Bay Manager could not open',
      `Could not load ${rendererTarget}.\n\n${message}\n\n${isDevelopment
        ? 'Run npm.cmd run dev to start Vite and Electron together.'
        : app.isPackaged ? 'Reinstall the application. Keep your business data and backups.' : 'Run npm.cmd run build, then npm.cmd start.'}`,
    );
  }
  window.webContents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) reportLoadFailure(`${description} (${code})`);
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    applicationHandlers.revoke(window.webContents);
    reportLoadFailure(`Renderer stopped: ${details.reason} (exit ${details.exitCode}).`);
  });
  const loading = isDevelopment
    ? window.loadURL(rendererTarget)
    : window.loadFile(rendererTarget);
  loading.catch((error) => reportLoadFailure(error.message));
}

if (app.requestSingleInstanceLock && !app.requestSingleInstanceLock()) {
  app.quit();
} else app.whenReady().then(() => {
  try { storage.recover(); registerSetupHandlers(); createWindow(); }
  catch (error) { dialog.showErrorBox('Database recovery requires attention', error.message + '\n\nKeep all database and safety backup files. The application has stopped to protect operational data.'); app.quit(); return; }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('second-instance', ()=>{const window=BrowserWindow.getAllWindows?.()?.[0];if(window){if(window.isMinimized())window.restore();window.show();window.focus();}});

app.on('before-quit', event => { if (storage.busy) { event.preventDefault(); dialog.showErrorBox('Database maintenance in progress', 'Wait for the backup or restore to finish before quitting.'); } else storage.close(); });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

