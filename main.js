const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const isDevelopment = !app.isPackaged && process.argv.includes('--dev');
let database;

function getDatabase() {
  if (!database) {
    const databasePath =
      process.env.WASH_BAY_DATABASE_PATH ??
      path.join(app.getPath('userData'), 'wash-bay-manager.sqlite');
    database = new Database(databasePath);
    database.pragma('foreign_keys = ON');
    database.pragma('journal_mode = WAL');
    database.exec(
      fs.readFileSync(
        path.join(__dirname, 'src', 'database', 'schema.sql'),
        'utf8',
      ),
    );
  }

  return database;
}

function registerSetupHandlers() {
  ipcMain.handle('setup:status', () => {
    const settings = getDatabase()
      .prepare('SELECT id FROM business_settings LIMIT 1')
      .get();
    return { isComplete: Boolean(settings) };
  });

  ipcMain.handle('setup:complete', async (_event, input) => {
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
    if (
      logo &&
      (!['image/png', 'image/jpeg', 'image/webp'].includes(logo.mimeType) ||
        !(logo.bytes instanceof Uint8Array) ||
        logo.bytes.byteLength > 5 * 1024 * 1024)
    ) {
      throw new Error('Logo must be a PNG, JPEG, or WebP image under 5 MB.');
    }

    const db = getDatabase();
    const completedSetup = db.transaction((logoPath, passwordHash) => {
      if (db.prepare('SELECT id FROM business_settings LIMIT 1').get()) {
        throw new Error('Setup has already been completed.');
      }

      db.prepare(`
        INSERT INTO business_settings (id, business_name, phone, address, logo_path)
        VALUES (1, ?, ?, ?, ?)
      `).run(businessName, phone, address, logoPath);

      db.prepare(`
        INSERT INTO users (username, password_hash, full_name, role)
        VALUES (?, ?, ?, 'admin')
      `).run(username, passwordHash, fullName);
    });

    let savedLogoPath;
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

    try {
      completedSetup(savedLogoPath ?? null, await bcrypt.hash(password, 12));
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
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
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
        : 'Run npm.cmd run build, then npm.cmd start.'}`,
    );
  }
  window.webContents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) reportLoadFailure(`${description} (${code})`);
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    reportLoadFailure(`Renderer stopped: ${details.reason} (exit ${details.exitCode}).`);
  });
  const loading = isDevelopment
    ? window.loadURL(rendererTarget)
    : window.loadFile(rendererTarget);
  loading.catch((error) => reportLoadFailure(error.message));
}

app.whenReady().then(() => {
  registerSetupHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
