const bcrypt = require('bcryptjs');

function registerApplicationHandlers({ ipcMain, getDatabase, validateSender, now = Date.now, settingsEnvironment = {} }) {
  const states = new WeakMap();
  let sessionEpoch=0;
  let settingsHandlers;
  let recoveryHandlers;
  const dummyHash = bcrypt.hashSync('unused-account-verification', 12);
  const idleLimit = 30 * 60 * 1000;
  function state(sender) {
    if (!states.has(sender)) states.set(sender, { userId: null, lastUsed: 0, failures: 0, blockedUntil: 0, busy: false, securityBusy:false, revision: 0, epoch:sessionEpoch });
    return states.get(sender);
  }
  function revoke(sender) {
    const current = state(sender);
    current.userId = null;
    current.revision++;
    settingsHandlers?.discardForSender(sender);
    recoveryHandlers?.discard(sender);
  }
  function administrator(event) {
    validateSender(event);
    const current = state(event.sender);
    if (!current.userId || current.epoch!==sessionEpoch || now() - current.lastUsed >= idleLimit) { revoke(event.sender); return null; }
    const user = getDatabase().prepare("SELECT id, username, full_name AS fullName, role FROM users WHERE id = ? AND is_active = 1 AND role = 'admin'").get(current.userId);
    if (!user) { revoke(event.sender); return null; }
    current.lastUsed = now();
    return user;
  }
  function revokeAll(){sessionEpoch++;settingsHandlers?.discardAll();}
  function sessionIdentity(event){const user=administrator(event);if(!user)throw Error('SESSION_EXPIRED: Please sign in again.');const current=state(event.sender);return sessionEpoch+':'+current.revision+':'+current.userId;}
  function isSessionCurrent(event,identity){validateSender(event);const current=state(event.sender);return Boolean(current.userId && current.epoch===sessionEpoch && now()-current.lastUsed<idleLimit && identity===sessionEpoch+':'+current.revision+':'+current.userId);}
  async function verifyCurrentPassword(event,password){
    const user=administrator(event);if(!user)throw Error('SESSION_EXPIRED: Administrator authentication is required.');
    const current=state(event.sender);if(current.busy||current.securityBusy)throw Error('A security verification is already in progress.');
    if(now()<current.blockedUntil)throw Error('Too many unsuccessful attempts. Please wait one minute.');
    if(typeof password!=='string'||!password||Buffer.byteLength(password,'utf8')>72)throw Error('Enter your current password.');
    const identity=sessionIdentity(event),hash=getDatabase().prepare('SELECT password_hash FROM users WHERE id=?').get(user.id).password_hash;
    current.securityBusy=true;
    try{
      const matches=await bcrypt.compare(password,hash);
      if(!isSessionCurrent(event,identity))throw Error('SESSION_EXPIRED: Security verification was cancelled. Sign in again.');
      const refreshed=administrator(event);
      if(!refreshed||getDatabase().prepare('SELECT password_hash FROM users WHERE id=?').get(user.id)?.password_hash!==hash)throw Error('SESSION_EXPIRED: Credentials changed. Sign in again.');
      if(!matches){current.failures++;if(current.failures>=5){current.failures=0;current.blockedUntil=now()+60000;}throw Error('The current password is incorrect.');}
      current.failures=0;return {user:refreshed,passwordHash:hash,identity};
    }finally{current.securityBusy=false;}
  }
  settingsHandlers=require('./settings-api.cjs').registerSettingsHandlers({ipcMain,getDatabase,administrator,verifyCurrentPassword,sessionIdentity,isSessionCurrent,revokeAll,now,...settingsEnvironment});
  recoveryHandlers=require('./recovery-api.cjs').registerRecoveryHandlers({ipcMain,getDatabase,validateSender,verifyCurrentPassword,isSessionCurrent,revokeAll,now,getEpoch:()=>sessionEpoch});
  ipcMain.handle('auth:session', event => administrator(event));
  ipcMain.handle('auth:login', async (event, input) => {
    validateSender(event);
    const current = state(event.sender);
    const failure = { ok: false, message: 'The username or password is incorrect, or this administrator account is unavailable.' };
    if (current.busy) return { ok: false, message: 'A sign-in request is already being checked.' };
    if (now() < current.blockedUntil) return { ok: false, message: 'Too many unsuccessful attempts. Please wait one minute before trying again.' };
    if (typeof input?.username !== 'string' || !input.username.trim() || input.username.trim().length > 64 || typeof input?.password !== 'string' || !input.password || Buffer.byteLength(input.password, 'utf8') > 72) return failure;
    revoke(event.sender);
    const revision = current.revision, loginEpoch=sessionEpoch;
    current.busy = true;
    try {
      const db = getDatabase();
      if (!db.prepare('SELECT id FROM business_settings LIMIT 1').get()) return { ok: false, message: 'Complete business setup before signing in.' };
      const account = db.prepare('SELECT id, password_hash FROM users WHERE username = ?').get(input.username.trim());
      const matches = await bcrypt.compare(input.password, account?.password_hash ?? dummyHash);
      validateSender(event);
      if (revision !== current.revision || loginEpoch!==sessionEpoch) return { ok: false, message: 'Sign-in was cancelled. Please try again.' };
      const user = account && db.prepare("SELECT id, username, full_name AS fullName, role FROM users WHERE id = ? AND is_active = 1 AND role = 'admin' AND password_hash = ?").get(account.id, account.password_hash);
      if (!matches || !user) {
        current.failures++;
        if (current.failures >= 5) { current.failures = 0; current.blockedUntil = now() + 60000; }
        return failure;
      }
      current.userId = user.id;
      current.epoch=sessionEpoch;
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
      preferences: db.prepare('SELECT date_format AS dateFormat,start_page AS startPage FROM business_preferences WHERE business_id=1').get() ?? {dateFormat:'long',startPage:'overview'},
      companySummary: db.prepare('SELECT coalesce(sum(b.outstanding_pesewas),0) AS outstandingPesewas,coalesce(sum(CASE WHEN s.due_date<? THEN b.outstanding_pesewas ELSE 0 END),0) AS overduePesewas FROM visit_company_snapshots s JOIN visit_balances b ON b.id=s.transaction_id').get(today),
      summary: {
        completedToday: db.prepare("SELECT count(*) AS value FROM transactions t LEFT JOIN visit_details d ON d.transaction_id=t.id WHERE t.status='completed' AND coalesce(d.completed_at,t.created_at)>=? AND coalesce(d.completed_at,t.created_at)<?").get(today,nextDay).value,
        activeWashes: db.prepare("SELECT count(*) AS value FROM transactions WHERE status IN ('pending', 'in_progress')").get().value,
        collectedToday: db.prepare("SELECT coalesce(sum(coalesce(r.amount_pesewas,cast(round(p.amount*100) AS INTEGER))),0)/100.0 AS value FROM payments p LEFT JOIN payment_receipts r ON r.payment_id=p.id WHERE p.status='completed' AND p.paid_at>=? AND p.paid_at<?").get(today,nextDay).value,
        outstandingBalance: db.prepare('SELECT coalesce(sum(outstanding_pesewas),0)/100.0 AS value FROM visit_balances').get().value,
        waitingVehicles: db.prepare("SELECT count(*) AS value FROM transactions WHERE vehicle_id IS NOT NULL AND status='pending'").get().value,
        inProgressVehicles: db.prepare("SELECT count(*) AS value FROM transactions WHERE vehicle_id IS NOT NULL AND status='in_progress'").get().value,
        expensesToday: db.prepare('SELECT coalesce((SELECT sum(amount_pesewas)/100.0 FROM expense_events WHERE business_date >= ? AND business_date < ?),0)+coalesce((SELECT sum(amount) FROM expenses WHERE expense_date >= ? AND expense_date < ?),0) AS value').get(today, nextDay, today, nextDay).value,
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
  require('./reports-api.cjs').registerReportHandlers({ ipcMain, getDatabase, administrator, now });
  require('./finance-api.cjs').registerFinanceHandlers({ ipcMain, getDatabase, administrator, now });
  const pricing = require('./pricing-api.cjs').registerPricingHandlers({ ipcMain, getDatabase, administrator });
  require('./categories-api.cjs').registerCategoryHandlers({ ipcMain, getDatabase, administrator });
  require('./workers-api.cjs').registerWorkerHandlers({ ipcMain, getDatabase, administrator });
  const vehicles = require('./vehicles-api.cjs').registerVehicleHandlers({ ipcMain, getDatabase, administrator });
  const companies = require('./companies-api.cjs').registerCompanyHandlers({ ipcMain, getDatabase, administrator, now });
  const earnings = require('./earnings-api.cjs').registerEarningsHandlers({ ipcMain, getDatabase, administrator, now });
  require('./visits-api.cjs').registerVisitHandlers({ ipcMain, getDatabase, administrator, now, pricing, vehicles, earnings, companies });
  return { revoke, revokeAll, recoveryHandlers };
}

module.exports = { registerApplicationHandlers };
