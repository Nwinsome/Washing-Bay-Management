function registerWorkerHandlers({ ipcMain, getDatabase, administrator }) {
  const columns = 'id,full_name AS fullName,phone,email,job_title AS jobTitle,hire_date AS hireDate,is_active AS isActive,created_at AS createdAt,updated_at AS updatedAt';
  function handle(channel, action) {
    ipcMain.handle(channel, (event, input) => {
      const user = administrator(event);
      if (!user) throw new Error('SESSION_EXPIRED: Please sign in to manage workers.');
      return action(getDatabase(), input, user);
    });
  }
  function recordId(value) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid worker ID.');
    return value;
  }
  function text(value, label, max, required = false) {
    if ((value === undefined || value === null) && !required) return null;
    if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`Enter a valid ${label} (up to ${max} characters).`);
    const clean = value.trim();
    if (required && !clean) throw new Error(`Please enter the worker's ${label}.`);
    return clean || null;
  }
  function details(input) {
    const fullName = text(input?.fullName, 'full name', 120, true);
    const phone = text(input?.phone, 'phone number', 40, true);
    const digits = phone.replace(/\D/g, '');
    if (!/^[+\d\s().-]+$/.test(phone) || digits.length < 7 || digits.length > 15) throw new Error('Enter a phone number with 7 to 15 digits.');
    const email = text(input?.email, 'email address', 254);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
    const jobTitle = text(input?.jobTitle, 'job title', 120);
    const hireDate = text(input?.hireDate, 'hire date', 10);
    if (hireDate && (!/^\d{4}-\d{2}-\d{2}$/.test(hireDate) || !Number.isFinite(Date.parse(hireDate)) || new Date(hireDate).toISOString().slice(0, 10) !== hireDate)) throw new Error('Enter a valid hire date.');
    return [fullName, phone, email, jobTitle, hireDate];
  }
  function get(db, workerId) {
    const worker = db.prepare(`SELECT ${columns} FROM workers WHERE id=?`).get(workerId);
    if (!worker) throw new Error('Worker does not exist.');
    return worker;
  }
  function audit(db, user, action, workerId) {
    db.prepare('INSERT INTO audit_logs(user_id,action,entity_type,entity_id) VALUES(?,?,?,?)').run(user.id, action, 'worker', workerId);
  }
  handle('workers:list', (db, input = {}) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid worker search.');
    const search = text(input.search, 'search', 120) ?? '';
    const status = input.status ?? 'all', offset = input.offset ?? 0;
    if (!['all', 'active', 'inactive'].includes(status) || !Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid worker filter or page.');
    const statusValue = status === 'all' ? null : status === 'active' ? 1 : 0;
    const where = `WHERE (? IS NULL OR is_active=?) AND (?='' OR instr(lower(full_name),lower(?))>0 OR instr(coalesce(phone,''),?)>0 OR instr(lower(coalesce(email,'')),lower(?))>0 OR instr(lower(coalesce(job_title,'')),lower(?))>0)`;
    const args = [statusValue, statusValue, search, search, search, search, search];
    return db.transaction(() => ({
      workers: db.prepare(`SELECT ${columns} FROM workers ${where} ORDER BY full_name COLLATE NOCASE,id LIMIT 50 OFFSET ?`).all(...args, offset),
      total: db.prepare(`SELECT count(*) AS n FROM workers ${where}`).get(...args).n,
      counts: db.prepare('SELECT count(*) AS total,coalesce(sum(is_active=1),0) AS active,coalesce(sum(is_active=0),0) AS inactive FROM workers').get(),
      offset, limit: 50,
    }))();
  });
  handle('workers:create', (db, input, user) => {
    const values = details(input);
    return db.transaction(() => {
      const workerId = Number(db.prepare('INSERT INTO workers(full_name,phone,email,job_title,hire_date) VALUES(?,?,?,?,?)').run(...values).lastInsertRowid);
      audit(db, user, 'worker_created', workerId);
      return get(db, workerId);
    })();
  });
  handle('workers:update', (db, input, user) => {
    const workerId = recordId(input?.id), values = details(input);
    return db.transaction(() => {
      get(db, workerId);
      db.prepare('UPDATE workers SET full_name=?,phone=?,email=?,job_title=?,hire_date=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(...values, workerId);
      audit(db, user, 'worker_updated', workerId);
      return get(db, workerId);
    })();
  });
  handle('workers:status', (db, input, user) => {
    const workerId = recordId(input?.id);
    if (typeof input?.isActive !== 'boolean') throw new Error('Worker status must be active or inactive.');
    return db.transaction(() => {
      get(db, workerId);
      db.prepare('UPDATE workers SET is_active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(input.isActive ? 1 : 0, workerId);
      audit(db, user, input.isActive ? 'worker_activated' : 'worker_deactivated', workerId);
      return get(db, workerId);
    })();
  });
}
module.exports = { registerWorkerHandlers };
