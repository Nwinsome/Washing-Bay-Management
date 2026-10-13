const { createHash } = require('node:crypto');
const MAX = Number.MAX_SAFE_INTEGER;
function integer(value, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw Error('Enter a valid whole-pesewa amount or rate within the supported range.');
  return value;
}
function legacyUnits(value) {
  const units = Math.round(value * 100);
  return Number.isFinite(value) && value >= 0 && Number.isSafeInteger(units) && Math.abs(value * 100 - units) < 0.000001 ? units : null;
}
function safeBig(value) { if (value < 0n || value > BigInt(MAX)) throw Error('The financial total exceeds the supported range.'); return Number(value); }
function sum(values) { return safeBig(values.reduce((total, value) => total + BigInt(integer(value)), 0n)); }
function text(value, max = 500) {
  if (value == null) return null;
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f]/.test(value)) throw Error('Enter a valid reference, note or search.');
  return value.trim() || null;
}
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value) throw Error('Enter a valid calendar date.');
  return value;
}
function registerEarningsHandlers({ ipcMain, getDatabase, administrator, now }) {
  function handle(channel, action) {
    ipcMain.handle(channel, (event, input) => {
      const user = administrator(event);
      if (!user) throw Error('SESSION_EXPIRED: Please sign in to manage worker earnings.');
      return action(getDatabase(), input, user);
    });
  }
  const time = () => new Date(now()).toISOString();
  function ghs(db) { if (db.prepare('SELECT currency FROM business_settings WHERE id=1').get()?.currency !== 'GHS') throw Error('Worker compensation supports GHS only. Existing currency records are preserved.'); }
  function worker(db, value) { const row = db.prepare('SELECT id,full_name AS name,is_active AS isActive FROM workers WHERE id=?').get(integer(value,1)); if (!row) throw Error('Worker does not exist.'); return row; }
  function audit(db, user, action, entity, id, details) { db.prepare('INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details) VALUES(?,?,?,?,?)').run(user.id,action,entity,id,JSON.stringify(details)); }
  function rule(db, serviceId, categoryId, unknownCategory) {
    if (categoryId != null) {
      const specific = db.prepare('SELECT method,rate_units AS rateUnits FROM category_compensation_rules WHERE service_id=? AND vehicle_type_id=?').get(serviceId,categoryId);
      if (specific) return { ...specific, source: 'category' };
    }
    if (unknownCategory && db.prepare('SELECT 1 FROM category_compensation_rules WHERE service_id=? LIMIT 1').get(serviceId)) return { method:'unconfigured', rateUnits:null, source:'unknown_category' };
    const general = db.prepare('SELECT method,rate FROM service_compensation_rules WHERE service_id=?').get(serviceId);
    const units = general && legacyUnits(general.rate);
    return general && units != null ? { method:general.method,rateUnits:units,source:'general' } : { method:'unconfigured',rateUnits:null,source:'missing' };
  }
  function finalize(db, visitId, completedAt) {
    // Called inside the same IMMEDIATE transaction as the visit completion.
    const visit = db.prepare('SELECT t.vehicle_id,d.currency,c.vehicle_type_id,c.category_name FROM transactions t JOIN visit_details d ON d.transaction_id=t.id LEFT JOIN visit_category_snapshots c ON c.transaction_id=t.id WHERE t.id=?').get(visitId);
    const lines = db.prepare(`SELECT l.id,l.service_id,l.service_name,l.line_total,l.quantity,a.worker_id,a.worker_name
      FROM transaction_services l JOIN transaction_service_workers a ON a.transaction_service_id=l.id WHERE l.transaction_id=?`).all(visitId);
    for (const line of lines) {
      if (db.prepare('SELECT 1 FROM worker_service_earnings WHERE transaction_service_id=?').get(line.id)) continue;
      const agreement = db.prepare('SELECT arrangement,amount_pesewas FROM worker_salary_agreements WHERE worker_id=?').get(line.worker_id);
      const arrangement = agreement?.arrangement ?? 'service';
      const selected = rule(db,line.service_id,visit.vehicle_type_id,visit.vehicle_id != null && visit.vehicle_type_id == null);
      const charge = legacyUnits(line.line_total), quantity = line.quantity;
      let state = 'unconfigured', earned = null, reason = 'No applicable compensation rule configured.';
      if (visit.currency !== 'GHS' || charge == null || !Number.isSafeInteger(quantity) || quantity < 1 || line.worker_id == null) {
        state='review'; reason='Currency, historical monetary precision, quantity or worker identity requires review.';
      } else if (arrangement !== 'service') { state='salary'; reason='Salary agreement: service earnings excluded. Salary obligations require a separate accrual policy.'; }
      else if (selected.method !== 'unconfigured') {
        state='confirmed'; reason=null;
        earned=safeBig(selected.method==='fixed' ? BigInt(selected.rateUnits)*BigInt(quantity) : (BigInt(charge)*BigInt(selected.rateUnits)+5000n)/10000n);
      } else if (selected.source==='unknown_category') reason='Historical vehicle category is unknown; category compensation requires review.';
      db.prepare(`INSERT INTO worker_service_earnings(transaction_service_id,worker_id,worker_name,service_name,category_name,state,method,rate_units,charge_pesewas,quantity,earned_pesewas,arrangement,salary_pesewas,rule_source,reason,completed_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(line.id,line.worker_id,line.worker_name,line.service_name,visit.category_name ?? null,state,
        selected.method==='unconfigured' ? null : selected.method,selected.rateUnits,charge,Number.isSafeInteger(quantity) ? quantity : null,earned,arrangement,agreement?.amount_pesewas ?? null,selected.source,reason,completedAt);
    }
    for (const workerId of new Set(lines.map(line=>line.worker_id).filter(value=>value!=null))) account(db,workerId);
  }
  function account(db, workerId) {
    const earned = sum(db.prepare("SELECT earned_pesewas AS amount FROM worker_service_earnings WHERE worker_id=? AND state='confirmed'").all(workerId).map(x=>x.amount));
    const paid = sum(db.prepare('SELECT r.amount_pesewas AS amount FROM worker_payments p JOIN worker_payout_receipts r ON r.worker_payment_id=p.id WHERE p.worker_id=?').all(workerId).map(x=>x.amount));
    const legacyPayments = db.prepare('SELECT count(*) AS count FROM worker_payments p LEFT JOIN worker_payout_receipts r ON r.worker_payment_id=p.id WHERE p.worker_id=? AND r.worker_payment_id IS NULL').get(workerId).count;
    return { earnedPesewas:earned,paidPesewas:paid,outstandingPesewas:Math.max(0,earned-paid),payoutBlocked:legacyPayments>0 || paid>earned,legacyPayments };
  }
  handle('earnings:configuration', db => ({
    rules: [...db.prepare('SELECT service_id AS serviceId,NULL AS vehicleTypeId,method,rate FROM service_compensation_rules').all().map(row=>{
      const rateUnits=legacyUnits(row.rate); return {serviceId:row.serviceId,vehicleTypeId:null,method:rateUnits==null?'unconfigured':row.method,rateUnits};
    }),...db.prepare('SELECT service_id AS serviceId,vehicle_type_id AS vehicleTypeId,method,rate_units AS rateUnits FROM category_compensation_rules').all()],
    agreements: db.prepare('SELECT worker_id AS workerId,arrangement,amount_pesewas AS amountPesewas FROM worker_salary_agreements').all(),
  }));
  handle('earnings:rule', (db,input,user) => db.transaction(() => {
    ghs(db);
    const serviceId=integer(input?.serviceId,1), categoryId=input.vehicleTypeId == null ? null : integer(input.vehicleTypeId,1), method=input.method;
    if (!db.prepare('SELECT 1 FROM services WHERE id=?').get(serviceId)) throw Error('Service does not exist.');
    if (categoryId != null && !db.prepare('SELECT 1 FROM vehicle_types WHERE id=?').get(categoryId)) throw Error('Vehicle category does not exist.');
    if (!['fixed','percentage','unconfigured','inherit'].includes(method) || (method==='inherit' && categoryId==null)) throw Error('Select a valid compensation method.');
    const rate = ['fixed','percentage'].includes(method) ? integer(input.rateUnits) : null;
    if (method==='percentage' && rate>10000) throw Error('Percentage must be between 0 and 100 percent.');
    if (categoryId==null && rate!=null && legacyUnits(rate/100)!==rate) throw Error('This amount cannot be represented precisely by the existing compensation table.');
    if (categoryId==null) {
      if (method==='unconfigured') db.prepare('DELETE FROM service_compensation_rules WHERE service_id=?').run(serviceId);
      else db.prepare('INSERT INTO service_compensation_rules(service_id,method,rate,updated_at) VALUES(?,?,?,?) ON CONFLICT(service_id) DO UPDATE SET method=excluded.method,rate=excluded.rate,updated_at=excluded.updated_at').run(serviceId,method,rate/100,time());
    } else if (method==='inherit') db.prepare('DELETE FROM category_compensation_rules WHERE service_id=? AND vehicle_type_id=?').run(serviceId,categoryId);
    else db.prepare('INSERT INTO category_compensation_rules(service_id,vehicle_type_id,method,rate_units,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(service_id,vehicle_type_id) DO UPDATE SET method=excluded.method,rate_units=excluded.rate_units,updated_at=excluded.updated_at').run(serviceId,categoryId,method,rate,time());
    audit(db,user,'compensation_rule_changed','service',serviceId,{categoryId,method,rateUnits:rate}); return { success:true };
  }).immediate());
  handle('earnings:arrangement', (db,input,user) => db.transaction(() => {
    ghs(db); const person=worker(db,input?.workerId), arrangement=input.arrangement;
    if (!['service','daily_salary','monthly_salary'].includes(arrangement)) throw Error('Select a valid payment arrangement.');
    const amount=arrangement==='service' ? null : integer(input.amountPesewas,1);
    db.prepare('INSERT INTO worker_salary_agreements(worker_id,arrangement,amount_pesewas,updated_at) VALUES(?,?,?,?) ON CONFLICT(worker_id) DO UPDATE SET arrangement=excluded.arrangement,amount_pesewas=excluded.amount_pesewas,updated_at=excluded.updated_at').run(person.id,arrangement,amount,time());
    audit(db,user,'worker_arrangement_changed','worker',person.id,{arrangement,amountPesewas:amount}); return { success:true };
  }).immediate());
  function filters(input={}) {
    const search=text(input.search,120) ?? '', from=input.from ? date(input.from) : '0000-01-01', to=input.to ? date(input.to) : '9999-12-31', offset=input.offset ?? 0;
    if (from>to) throw Error('The start date must not follow the end date.');
    integer(offset); return {search,from,to,offset};
  }
  function detail(db, input) {
    const person=worker(db,input?.workerId), f=filters(input);
    const range=[person.id,f.from,f.to];
    const totals = db.prepare(`SELECT state,earned_pesewas AS amount FROM worker_service_earnings WHERE worker_id=? AND substr(completed_at,1,10) BETWEEN ? AND ?`).all(...range);
    const payments = db.prepare(`SELECT p.id,p.amount,p.payment_date AS paidAt,p.notes,r.amount_pesewas AS amountPesewas,r.method,r.reference,
      CASE WHEN r.worker_payment_id IS NULL THEN 1 ELSE 0 END AS legacy FROM worker_payments p LEFT JOIN worker_payout_receipts r ON r.worker_payment_id=p.id
      WHERE p.worker_id=? AND substr(p.payment_date,1,10) BETWEEN ? AND ? ORDER BY p.payment_date DESC,p.id DESC LIMIT 50 OFFSET ?`).all(...range,f.offset);
    const periodPaid=sum(db.prepare(`SELECT r.amount_pesewas AS amount FROM worker_payments p JOIN worker_payout_receipts r ON r.worker_payment_id=p.id WHERE p.worker_id=? AND substr(p.payment_date,1,10) BETWEEN ? AND ?`).all(...range).map(x=>x.amount));
    return { worker:person,account:account(db,person.id),period:{earnedPesewas:sum(totals.filter(x=>x.state==='confirmed').map(x=>x.amount)),paidPesewas:periodPaid,completedServices:totals.length,unconfigured:totals.filter(x=>x.state==='unconfigured'||x.state==='review').length,salaryServices:totals.filter(x=>x.state==='salary').length},
      lines:db.prepare(`SELECT e.transaction_service_id AS id,e.worker_name AS workerName,e.service_name AS serviceName,e.category_name AS categoryName,e.state,e.method,e.rate_units AS rateUnits,e.charge_pesewas AS chargePesewas,e.earned_pesewas AS earnedPesewas,e.completed_at AS completedAt,e.reason,e.arrangement,e.salary_pesewas AS salaryPesewas,t.transaction_number AS visitNumber
        FROM worker_service_earnings e JOIN transaction_services l ON l.id=e.transaction_service_id JOIN transactions t ON t.id=l.transaction_id WHERE e.worker_id=? AND substr(e.completed_at,1,10) BETWEEN ? AND ? ORDER BY e.completed_at DESC,e.transaction_service_id DESC LIMIT 50 OFFSET ?`).all(...range,f.offset),
      payments,offset:f.offset,limit:50,
      paymentCount:db.prepare('SELECT count(*) AS n FROM worker_payments WHERE worker_id=? AND substr(payment_date,1,10) BETWEEN ? AND ?').get(...range).n,
      legacyCompletedServices:db.prepare(`SELECT count(*) AS n FROM transaction_service_workers a JOIN transaction_services l ON l.id=a.transaction_service_id JOIN transactions t ON t.id=l.transaction_id LEFT JOIN worker_service_earnings e ON e.transaction_service_id=l.id WHERE a.worker_id=? AND t.status='completed' AND e.transaction_service_id IS NULL`).get(person.id).n,
    };
  }
  handle('earnings:worker', (db,input) => db.transaction(()=>detail(db,input))());
  handle('earnings:list', (db,input={}) => db.transaction(() => {
    const f=filters(input);
    const rows=db.prepare("SELECT id,full_name AS name,is_active AS isActive FROM workers WHERE instr(lower(full_name),lower(?))>0 OR instr(coalesce(phone,''),?)>0 ORDER BY full_name,id LIMIT 50 OFFSET ?").all(f.search,f.search,f.offset);
    return { workers:rows.map(w=>{ const d=detail(db,{workerId:w.id,from:input.from,to:input.to});return {...w,account:d.account,period:d.period,legacyCompletedServices:d.legacyCompletedServices}; }),
      total:db.prepare("SELECT count(*) AS n FROM workers WHERE instr(lower(full_name),lower(?))>0 OR instr(coalesce(phone,''),?)>0").get(f.search,f.search).n,offset:f.offset,limit:50 };
  })());
  handle('earnings:payout', (db,input,user) => db.transaction(() => {
    ghs(db); const person=worker(db,input?.workerId), amount=integer(input.amountPesewas,1), method=input.method;
    const paidDate=date(input.paymentDate), reference=text(input.reference,120), note=text(input.note), key=input.requestKey;
    if (paidDate>time().slice(0,10)) throw Error('A payout date cannot be in the future.');
    if (!['cash','card','mobile_money','bank_transfer','other'].includes(method)) throw Error('Select a valid payment method.');
    if (typeof key!=='string' || !/^[a-zA-Z0-9-]{16,80}$/.test(key)) throw Error('A valid payout submission key is required.');
    const payload=createHash('sha256').update(JSON.stringify({workerId:person.id,amount,method,paidDate,reference,note})).digest('hex');
    const existing=db.prepare('SELECT worker_payment_id AS id,submission_payload FROM worker_payout_receipts WHERE submission_key=?').get(key);
    if (existing) { if(existing.submission_payload!==payload) throw Error('This payout key was already used for different details.'); return {id:existing.id,account:account(db,person.id)}; }
    const balance=account(db,person.id);
    if (balance.payoutBlocked) throw Error('Unclassified historical worker payments require reconciliation before new payouts.');
    if (amount>balance.outstandingPesewas) throw Error('Payout exceeds confirmed payable earnings. Advances and automatic salary payouts are not supported.');
    const earnedByDate=sum(db.prepare("SELECT earned_pesewas AS amount FROM worker_service_earnings WHERE worker_id=? AND state='confirmed' AND substr(completed_at,1,10)<=?").all(person.id,paidDate).map(row=>row.amount));
    if (amount>earnedByDate-balance.paidPesewas) throw Error('Payout exceeds confirmed earnings available by the recorded payment date.');
    const paymentId=Number(db.prepare('INSERT INTO worker_payments(worker_id,amount,payment_date,notes,paid_by) VALUES(?,?,?,?,?)').run(person.id,amount/100,paidDate,note,user.id).lastInsertRowid);
    db.prepare('INSERT INTO worker_payout_receipts(worker_payment_id,submission_key,submission_payload,amount_pesewas,method,reference,currency) VALUES(?,?,?,?,?,?,\'GHS\')').run(paymentId,key,payload,amount,method,reference);
    audit(db,user,'worker_payout_recorded','worker_payment',paymentId,{workerId:person.id,amountPesewas:amount,method,paidDate});
    return { id:paymentId,account:account(db,person.id) };
  }).immediate());
  return { finalize };
}
module.exports={ registerEarningsHandlers };
