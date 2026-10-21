const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const day = () => new Date().toISOString().slice(0, 10); // Ghana = UTC
const password = 'desktop-test-' + randomUUID();
const api = (page, method, input) => page.evaluate(({ method, input }) => window.appApi[method](input), { method, input });
let app, page, temporary;
async function launch() {
  const env = { ...process.env, WASH_BAY_USER_DATA_PATH: temporary,
    WASH_BAY_DATABASE_PATH: path.join(temporary, 'test.sqlite') };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: process.env.WASH_BAY_PACKAGED_EXE || require('electron'),
    args: process.env.WASH_BAY_PACKAGED_EXE ? [] : [root], env });
  page = await app.firstWindow();
}
test.beforeEach(async () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wash-bay-desktop-test-'));
  await launch();
  await expect(page.locator('#businessName')).toBeVisible();
});
test.afterEach(async () => {
  if (app) await app.close();
  if (temporary) {
    const relative = path.relative(os.tmpdir(), temporary);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Unsafe test cleanup');
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  app = page = temporary = undefined;
});
async function setup() {
  await page.locator('#businessName').fill('Isolated Desktop Test Bay');
  await page.locator('#phone').fill('0241234567');
  await page.locator('#address').fill('Test address');
  const bytes = await app.evaluate(({ nativeImage }) => nativeImage.createFromBitmap(Buffer.from([0, 128, 128, 255]), { width: 1, height: 1 }).toPNG());
  const logo = path.join(temporary, 'test-logo.png');
  fs.writeFileSync(logo, Buffer.from(bytes));
  await page.locator('#logo').setInputFiles(logo);
  await expect(page.getByAltText('Selected business logo preview')).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.locator('#fullName').fill('Test Administrator');
  await page.locator('#username').fill('qa-admin');
  await page.locator('#password').fill(password);
  await page.locator('#confirmPassword').fill(password);
  await page.getByRole('button', { name: 'Generate recovery code' }).click();
  await page.getByRole('checkbox', { name: 'I have saved this recovery code securely.' }).check();
  await page.getByRole('button', { name: 'Confirm saved code and finish' }).click();
  await expect(page.locator('#login-username')).toBeVisible();
  await page.locator('#login-username').fill('qa-admin');
  await page.locator('#login-password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
}
async function nativeSelection(folder, confirmation = 0) {
  // Exercise the real authenticated workflow, with deterministic native choices.
  await app.evaluate(({ dialog }, { folder, confirmation }) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    dialog.showMessageBox = async () => ({ response: confirmation });
  }, { folder, confirmation });
}
test('complete persisted financial workflow, backup, isolated restore and late receipt integrity', async () => {
  await setup();
  const category = await api(page, 'addVehicleType', { name: 'QA Category ' + randomUUID() });
  const services = (await api(page, 'getServices')).services;
  const byCode = code => services.find(s => s.code === code).id;
  const wash = byCode('washing'), blow = byCode('blowing'), engine = byCode('engine_wash'), under = byCode('under_wash');
  for (const [serviceId, price] of [[wash, 30.01], [blow, 20.02], [engine, 10.03], [under, 5.04]]) {
    await api(page, 'setServicePrice', { serviceId, vehicleTypeId: category.id, price });
    await api(page, 'setCompensationRule', { serviceId, vehicleTypeId: category.id, method: 'fixed', rateUnits: 200 });
  }
  const worker = await api(page, 'createWorker', { fullName: 'QA Worker', phone: '0241111111', jobTitle: 'Washer', hireDate: day() });
  const vehicle = await api(page, 'createVehicle', { registrationNumber: 'QA 123', vehicleTypeId: category.id, customerName: 'QA Customer', customerPhone: '0242222222' });
  async function visit(serviceIds, companyId = null) {
    const input = { mode: 'vehicle', vehicleId: vehicle.id, vehicleTypeId: category.id, serviceIds,
      assignments: serviceIds.map(serviceId => ({ serviceId, workerId: worker.id })), companyId };
    const quote = await api(page, 'quoteVisit', input);
    const submission = { ...input, expectedCompanyId: companyId, expectedTotalPesewas: quote.totalPesewas, expectedLines: quote.lines, requestKey: randomUUID() };
    const saved = await api(page, 'createVisit', submission);
    expect((await api(page, 'createVisit', submission)).id).toBe(saved.id);
    await api(page, 'setVisitStatus', { id: saved.id, status: 'completed' });
    return saved;
  }
  const partial = await visit([wash, engine, under]); // 4,508 pesewas
  const full = await visit([blow]); // 2,002 pesewas
  const receipt = { id: partial.id, amountPesewas: 1000, method: 'cash', requestKey: randomUUID() };
  await api(page, 'recordVisitPayment', receipt);
  await api(page, 'recordVisitPayment', receipt); // retries must not double count
  await api(page, 'recordVisitPayment', { id: full.id, amountPesewas: 2002, method: 'mobile_money', requestKey: randomUUID() });
  const company = await api(page, 'createCompany', { name: 'QA Fleet', contactPerson: 'QA Contact', phone: '0243333333' });
  await api(page, 'configureCompany', { id: company.id, isActive: true, creditEnabled: true, creditLimitPesewas: 10000, termsDays: 0 });
  const credit = await visit([wash], company.id);
  const allocation = { companyId: company.id, allocations: [{ visitId: credit.id, amountPesewas: 1500 }],
    amountPesewas: 1500, method: 'bank_transfer', paymentDate: day(), allocationReason: 'Customer instruction', requestKey: randomUUID() };
  await api(page, 'recordCompanyPayment', allocation);
  await api(page, 'recordCompanyPayment', allocation);
  const payout = { workerId: worker.id, amountPesewas: 500, method: 'cash', paymentDate: day(), requestKey: randomUUID() };
  await api(page, 'recordWorkerPayout', payout);
  await api(page, 'recordWorkerPayout', payout);
  const expense = { category: 'water', description: 'QA water paid', amountPesewas: 200, method: 'cash', businessDate: day(), requestKey: randomUUID() };
  const incorrect = await api(page, 'createExpense', expense);
  await api(page, 'createExpense', expense);
  await api(page, 'reverseExpense', { id: incorrect.id, businessDate: day(), reason: 'QA amount correction' });
  await api(page, 'createExpense', { ...expense, amountPesewas: 150, requestKey: randomUUID() });
  const preview = (await api(page, 'getClosingPreview', { businessDate: day() })).preview;
  expect(preview.serviceCharges).toBe(9511);
  expect(preview.received).toBe(4502);
  expect(preview.outstanding).toBe(5009);
  expect(preview.cashPayouts).toBe(500);
  expect(preview.cashExpenses).toBe(150);
  const closing = { businessDate: day(), token: preview.token, openingPesewas: 1000,
    openingReason: 'QA explicitly counted float', actualPesewas: 1350, explanation: '' };
  await api(page, 'confirmClosing', closing);
  await expect(api(page, 'confirmClosing', closing)).rejects.toThrow(/Reopen/);
  const report = await api(page, 'getReport', { preset: 'today' });
  expect(report.summary).toMatchObject({ serviceChargesPesewas: 9511, collectedPesewas: 4502,
    outstandingPesewas: 5009, expensesPesewas: 150, confirmedEarningsPesewas: 1000,
    verifiedPayoutsPesewas: 500, companyOutstandingPesewas: 1501, closingVariancePesewas: 0 });
  expect((await api(page, 'getWorkerEarningsDetail', { workerId: worker.id })).account).toMatchObject({ earnedPesewas: 1000, paidPesewas: 500, outstandingPesewas: 500 });
  const dashboard = await api(page, 'getDashboard');
  expect(Math.round(dashboard.summary.collectedToday * 100)).toBe(report.summary.collectedPesewas);
  expect(Math.round(dashboard.summary.outstandingBalance * 100)).toBe(report.summary.outstandingPesewas);
  const history = await api(page, 'getClosingPreview', { businessDate: day() });
  expect(history.history[0].snapshot.expectedPesewas).toBe(1350);
  await nativeSelection(temporary);
  const backup = await api(page, 'createDatabaseBackup');
  expect(backup.verified).toBe(true);
  await nativeSelection(backup.folder);
  expect((await api(page, 'verifyDatabaseBackup')).verified).toBe(true);
  // A harmless later settings edit proves restoration actually replaces data.
  const settings = await api(page, 'getSettings');
  await api(page, 'updateBusinessSettings', { ...settings.business, businessName: 'QA changed after backup',
    dateFormat: 'iso', startPage: 'overview', logoAction: 'keep' });
  await nativeSelection(backup.folder, 1);
  const selection = await api(page, 'selectDatabaseRestore');
  await expect(api(page, 'restoreDatabase', { token: selection.token, confirmation: 'WRONG', currentPassword: password })).rejects.toThrow();
  const restored = await api(page, 'restoreDatabase', { token: selection.token, confirmation: 'RESTORE', currentPassword: password });
  expect(restored.success).toBe(true);
  expect(fs.existsSync(path.join(restored.safetyBackup, 'manifest.json'))).toBe(true);
  expect(await api(page, 'getSession')).toBeNull();
  await api(page, 'login', { username: 'qa-admin', password });
  expect((await api(page, 'getSettings')).business.businessName).toBe('Isolated Desktop Test Bay');
  expect((await api(page, 'getReport', { preset: 'today' })).summary).toEqual(report.summary);
  expect((await api(page, 'getClosingPreview', { businessDate: day() })).history[0].snapshot).toEqual(history.history[0].snapshot);
  await expect(api(page, 'recordVisitPayment', { ...receipt, amountPesewas: 1, requestKey: randomUUID() })).rejects.toThrow(/Reopen/);
  await app.close();
  if (process.env.WASH_BAY_TEST_INSTALLER) {
    // Only the explicit installation QA command enables this same-version update.
    const { spawnSync } = require('node:child_process');
    const installation = path.dirname(process.env.WASH_BAY_PACKAGED_EXE);
    const result = spawnSync('powershell.exe', ['-NoProfile', '-File', path.join(root, 'scripts/reinstall-test.ps1'),
      '-Installer', process.env.WASH_BAY_TEST_INSTALLER, '-Destination', installation],
    { windowsHide: true, timeout: 120000, env: { ...process.env,
      WASH_BAY_USER_DATA_PATH: temporary, WASH_BAY_DATABASE_PATH: path.join(temporary, 'test.sqlite') } });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr?.toString()).toBe(0);
  }
  await launch();
  await expect(page.locator('#login-username')).toBeVisible();
  await page.locator('#login-username').fill('qa-admin');
  await page.locator('#login-password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  expect((await api(page, 'getReport', { preset: 'today' })).summary).toEqual(report.summary);
});
test('desktop navigation, searchable category, CSV download, print PDF, resize, logo and logout', async () => {
  await setup();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  for (const name of ['Workers', 'Vehicles', 'Visits', 'Worker Earnings', 'Expenses', 'Daily Closing', 'Company Accounts', 'Reports and Analytics', 'Settings and Security']) {
    await nav.getByRole('button', { name, exact: true }).click();
    await expect(page.locator('.dashboard-heading h1')).toContainText(name === 'Visits' ? 'Visits and payments' : name);
    await expect(page.locator('.error-banner')).toHaveCount(0);
  }
  await expect(page.locator('.settings-page img')).toBeVisible();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 600));
  await expect(nav.getByRole('button', { name: 'Overview', exact: true })).toBeVisible();
  await nav.getByRole('button', { name: 'Overview', exact: true }).click();
  const search = page.getByRole('searchbox', { name: 'Search vehicle categories' }).first();
  await expect(search).toBeVisible();
  await search.fill('no-such-category');
  await expect(page.getByText('No matching categories.').first()).toBeVisible();
  await nav.getByRole('button', { name: 'Reports and Analytics', exact: true }).click();
  const downloadPromise = app.evaluate(({ BrowserWindow }, destination) => new Promise(resolve => {
    BrowserWindow.getAllWindows()[0].webContents.session.once('will-download', (_event, item) => {
      item.setSavePath(destination);
      item.once('done', (_e, state) => resolve({ state, filename: item.getFilename() }));
    });
  }), path.join(temporary, 'report.csv'));
  await page.getByRole('button', { name: 'Export full CSV', exact: true }).click();
  expect((await downloadPromise).state).toBe('completed');
  expect(fs.readFileSync(path.join(temporary, 'report.csv'), 'utf8')).toContain('Financial and operational report');
  const pdf = await app.evaluate(async ({ BrowserWindow }) => [...await BrowserWindow.getAllWindows()[0].webContents.printToPDF({ printBackground: true })]);
  expect(Buffer.from(pdf).subarray(0, 4).toString()).toBe('%PDF');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.locator('#login-username')).toBeVisible();
  await expect(api(page, 'getReport', { preset: 'today' })).rejects.toThrow(/SESSION_EXPIRED/);
  expect(errors).toEqual([]);
});
test('offline recovery UI confirms replacement code and returns username for sign-in',async()=>{
 await setup();
 const initial=await api(page,'prepareRecovery',{kind:'replace',password});
 await api(page,'confirmRecovery',{id:initial.id,saved:true});
 await page.reload();
 await page.getByRole('button',{name:'Forgot password?'}).click();
 await page.getByLabel('Recovery code',{exact:true}).fill(initial.code);
 await page.getByLabel('New password',{exact:true}).fill('recovered-desktop-password');
 await page.getByLabel('Confirm new password',{exact:true}).fill('recovered-desktop-password');
 await page.getByRole('button',{name:'Generate recovery code',exact:true}).click();
 await page.getByRole('checkbox',{name:'I have saved this recovery code securely.'}).check();
 await page.getByRole('button',{name:'Confirm saved code and finish'}).click();
 await expect(page.getByRole('status')).toContainText('Your username is qa-admin');
 await page.locator('#login-password').fill('recovered-desktop-password');
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page.getByRole('navigation',{name:'Main navigation'})).toBeVisible();
});
