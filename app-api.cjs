const bcrypt = require('bcryptjs');

function registerApplicationHandlers({ ipcMain, getDatabase, validateSender, now = Date.now }) {
  const states = new WeakMap();
  const dummyHash = bcrypt.hashSync('unused-account-verification', 12);
  const idleLimit = 30 * 60 * 1000;
  function state(sender) {
    if (!states.has(sender)) states.set(sender, { userId: null, lastUsed: 0, failures: 0, blockedUntil: 0, busy: false, revision: 0 });
    return states.get(sender);
  }
  function revoke(sender) {
    const current = state(sender);
    current.userId = null;
    current.revision++;
  }
  function administrator(event) {
    validateSender(event);
    const current = state(event.sender);
    if (!current.userId || now() - current.lastUsed >= idleLimit) { revoke(event.sender); return null; }
    const user = getDatabase().prepare("SELECT id, username, full_name AS fullName, role FROM users WHERE id = ? AND is_active = 1 AND role = 'admin'").get(current.userId);
    if (!user) { revoke(event.sender); return null; }
    current.lastUsed = now();
    return user;
  }
  ipcMain.handle('auth:session', event => administrator(event));
  ipcMain.handle('auth:login', async (event, input) => {
    validateSender(event);
    const current = state(event.sender);
    const failure = { ok: false, message: 'The username or password is incorrect, or this administrator account is unavailable.' };
    if (current.busy) return { ok: false, message: 'A sign-in request is already being checked.' };
    if (now() < current.blockedUntil) return { ok: false, message: 'Too many unsuccessful attempts. Please wait one minute before trying again.' };
    if (typeof input?.username !== 'string' || !input.username.trim() || input.username.trim().length > 64 || typeof input?.password !== 'string' || !input.password || Buffer.byteLength(input.password, 'utf8') > 72) return failure;
    revoke(event.sender);
    const revision = current.revision;
    current.busy = true;
    try {
      const db = getDatabase();
      if (!db.prepare('SELECT id FROM business_settings LIMIT 1').get()) return { ok: false, message: 'Complete business setup before signing in.' };
      const account = db.prepare('SELECT id, password_hash FROM users WHERE username = ?').get(input.username.trim());
      const matches = await bcrypt.compare(input.password, account?.password_hash ?? dummyHash);
      validateSender(event);
      if (revision !== current.revision) return { ok: false, message: 'Sign-in was cancelled. Please try again.' };
      const user = account && db.prepare("SELECT id, username, full_name AS fullName, role FROM users WHERE id = ? AND is_active = 1 AND role = 'admin' AND password_hash = ?").get(account.id, account.password_hash);
      if (!matches || !user) {
        current.failures++;
        if (current.failures >= 5) { current.failures = 0; current.blockedUntil = now() + 60000; }
        return failure;
      }
      current.userId = user.id;
      current.lastUsed = now();
      current.failures = 0;
      return { ok: true, user };
    } finally { current.busy = false; }
  });
  ipcMain.handle('auth:logout', event => { validateSender(event); revoke(event.sender); return { success: true }; });
  ipcMain.handle('dashboard:get', event => {
    const user = administrator(event);
    if (!user) throw new Error('SESSION_EXPIRED: Please sign in to view the dashboard.');
    const db = getDatabase();
    // Accra uses UTC year-round. Use the same date for every query in this snapshot.
    const today = new Date(now()).toISOString().slice(0, 10);
    const nextDay = new Date(new Date(`${today}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
    return db.transaction(() => ({
      user, date: today,
      business: db.prepare('SELECT business_name AS name, phone, address, currency FROM business_settings WHERE id = 1').get(),
      summary: {
        completedToday: db.prepare("SELECT count(*) AS value FROM transactions t LEFT JOIN visit_details d ON d.transaction_id=t.id WHERE t.status='completed' AND coalesce(d.completed_at,t.created_at)>=? AND coalesce(d.completed_at,t.created_at)<?").get(today,nextDay).value,
        activeWashes: db.prepare("SELECT count(*) AS value FROM transactions WHERE status IN ('pending', 'in_progress')").get().value,
        collectedToday: db.prepare("SELECT coalesce(sum(coalesce(r.amount_pesewas,cast(round(p.amount*100) AS INTEGER))),0)/100.0 AS value FROM payments p LEFT JOIN payment_receipts r ON r.payment_id=p.id WHERE p.status='completed' AND p.paid_at>=? AND p.paid_at<?").get(today,nextDay).value,
        outstandingBalance: db.prepare('SELECT coalesce(sum(outstanding_pesewas),0)/100.0 AS value FROM visit_balances').get().value,
        waitingVehicles: db.prepare("SELECT count(*) AS value FROM transactions WHERE vehicle_id IS NOT NULL AND status='pending'").get().value,
        inProgressVehicles: db.prepare("SELECT count(*) AS value FROM transactions WHERE vehicle_id IS NOT NULL AND status='in_progress'").get().value,
        expensesToday: db.prepare('SELECT coalesce(sum(amount),0) AS value FROM expenses WHERE expense_date >= ? AND expense_date < ?').get(today, nextDay).value,
        customers: db.prepare('SELECT count(*) AS value FROM customers').get().value,
        activeWorkers: db.prepare('SELECT count(*) AS value FROM workers WHERE is_active=1').get().value,
        activeServices: db.prepare('SELECT count(*) AS value FROM services WHERE is_active=1').get().value,
      },
      recent: db.prepare(`SELECT t.id, t.transaction_number AS number, t.status, t.total, t.created_at AS createdAt,
        CASE WHEN snap.transaction_id IS NOT NULL THEN snap.customer_name ELSE c.full_name END AS customer,
        coalesce(snap.registration_number,v.registration_number) AS vehicle FROM transactions t
        LEFT JOIN customers c ON c.id=t.customer_id LEFT JOIN vehicles v ON v.id=t.vehicle_id
        LEFT JOIN transaction_vehicle_snapshots snap ON snap.transaction_id=t.id
        ORDER BY t.created_at DESC, t.id DESC LIMIT 8`).all(),
    }))();
  });
  const pricing = require('./pricing-api.cjs').registerPricingHandlers({ ipcMain, getDatabase, administrator });
  require('./categories-api.cjs').registerCategoryHandlers({ ipcMain, getDatabase, administrator });
  require('./workers-api.cjs').registerWorkerHandlers({ ipcMain, getDatabase, administrator });
  const vehicles = require('./vehicles-api.cjs').registerVehicleHandlers({ ipcMain, getDatabase, administrator });
  const earnings = require('./earnings-api.cjs').registerEarningsHandlers({ ipcMain, getDatabase, administrator, now });
  require('./visits-api.cjs').registerVisitHandlers({ ipcMain, getDatabase, administrator, now, pricing, vehicles, earnings });
  return { revoke };
}

module.exports = { registerApplicationHandlers };
