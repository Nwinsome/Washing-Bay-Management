const { createHash } = require('node:crypto');
const methods=['cash','mobile_money','bank_transfer','card','other'];
const categories=['water','electricity','fuel','cleaning_materials','maintenance','miscellaneous'];
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function cents(value,minimum=0){if(!Number.isSafeInteger(value)||value<minimum)throw Error('Enter a valid amount in integer pesewas.');return value;}
function text(value,max=500,required=false){if(value==null&&!required)return '';if(typeof value!=='string'||value.trim().length>max||/[\u0000-\u001f]/.test(value)||(required&&!value.trim()))throw Error('Enter a valid description, reference or explanation.');return value.trim();}
function registerFinanceHandlers({ipcMain,getDatabase,administrator,now=Date.now}){
 const today=()=>new Date(now()).toISOString().slice(0,10);
 function date(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value||value>today())throw Error('Select a valid business date that is not in the future.');return value;}
 function handle(name,fn){ipcMain.handle(name,(event,input)=>{const user=administrator(event);if(!user)throw Error('SESSION_EXPIRED: Administrator authentication is required.');const db=getDatabase();if(db.prepare('SELECT currency FROM business_settings WHERE id=1').get()?.currency!=='GHS')throw Error('Financial operations require GHS business currency.');return db.transaction(()=>fn(db,input??{},user)).immediate();});}
 function unlocked(db,day){if(db.prepare('SELECT id FROM confirmed_financial_closings WHERE business_date>=?').get(day))throw Error('Reopen affected closing days, latest first, before recording backdated activity.');}
 function create(db,input,user){
 const day=date(input.businessDate),amount=cents(input.amountPesewas,1),category=input.category,method=input.method;
 if(!categories.includes(category)||!methods.includes(method))throw Error('Select a valid expense category and payment method.');
 const description=text(input.description,500,true),reference=text(input.reference,120),key=text(input.requestKey,80,true);
 if(!/^[a-zA-Z0-9-]{16,80}$/.test(key))throw Error('A valid submission key is required.');
 const payload=hash({day,amount,category,method,description,reference});
 const existing=db.prepare('SELECT id,payload FROM expense_events WHERE request_key=?').get(key);
 if(existing){if(existing.payload!==payload)throw Error('Submission key already used for different details.');return {id:existing.id};}
 unlocked(db,day);
 const id=Number(db.prepare('INSERT INTO expense_events(category,description,amount_pesewas,method,business_date,reference,recorded_by,recorded_at,request_key,payload) VALUES(?,?,?,?,?,?,?,?,?,?)').run(category,description,amount,method,day,reference,user.id,new Date(now()).toISOString(),key,payload).lastInsertRowid);
 return {id};
 }
 handle('finance:expense-create',create);
 handle('finance:expense-reverse',(db,input,user)=>{
 const id=cents(input.id,1),day=date(input.businessDate),reason=text(input.reason,500,true);
 const original=db.prepare('SELECT * FROM expense_events WHERE id=? AND reverses_id IS NULL').get(id);if(!original)throw Error('Expense not found.');
 const previous=db.prepare('SELECT id,business_date,reason FROM expense_events WHERE reverses_id=?').get(id);
 if(previous){if(previous.business_date!==day||previous.reason!==reason)throw Error('Expense already reversed.');return {id:previous.id};}
 if(day<original.business_date)throw Error('Reversal cannot precede the expense date.');unlocked(db,day);
 const reversal=Number(db.prepare('INSERT INTO expense_events(category,description,amount_pesewas,method,business_date,reference,reverses_id,reason,recorded_by,recorded_at,request_key,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(original.category,original.description,-original.amount_pesewas,original.method,day,original.reference,id,reason,user.id,new Date(now()).toISOString(),`reversal-${id}`,hash({id,day,reason})).lastInsertRowid);
 return {id:reversal};
 });
 handle('finance:expenses',(db,input)=>{
 const search=text(input.search,120),from=input.from?date(input.from):'0000-01-01',to=input.to?date(input.to):today();
 if(from>to)throw Error('Start date must precede end date.');if(input.category&&!categories.includes(input.category))throw Error('Invalid category.');if(input.method&&!methods.includes(input.method))throw Error('Invalid payment method.');
 const offset=cents(input.offset??0),args=[from,to,`%${search}%`,`%${search}%`,input.category||'',input.category||'',input.method||'',input.method||''];
 const where='business_date BETWEEN ? AND ? AND (description LIKE ? OR reference LIKE ?) AND (?=\'\' OR category=?) AND (?=\'\' OR method=?)';
 return {rows:db.prepare(`SELECT e.*,u.full_name AS administrator,(SELECT id FROM expense_events WHERE reverses_id=e.id) AS reversed_by FROM expense_events e JOIN users u ON u.id=e.recorded_by WHERE ${where} ORDER BY business_date DESC,e.id DESC LIMIT 50 OFFSET ?`).all(...args,offset),total:db.prepare(`SELECT count(*) AS n FROM expense_events WHERE ${where}`).get(...args).n,offset};
 });
 function preview(db,day){
 const payments=db.prepare(`SELECT p.id,p.transaction_id AS visitId,p.method,p.paid_at AS date,coalesce(r.amount_pesewas,cast(round(p.amount*100) AS INTEGER)) AS amountPesewas FROM payments p LEFT JOIN payment_receipts r ON r.payment_id=p.id WHERE p.status='completed' AND substr(p.paid_at,1,10)=? ORDER BY p.id`).all(day);
 const payouts=db.prepare(`SELECT p.id,p.worker_id AS workerId,p.payment_date AS date,r.method,r.amount_pesewas AS amountPesewas FROM worker_payments p JOIN worker_payout_receipts r ON r.worker_payment_id=p.id WHERE substr(p.payment_date,1,10)=? ORDER BY p.id`).all(day);
 const expenses=db.prepare('SELECT id,method,business_date AS date,amount_pesewas AS amountPesewas,reverses_id AS reversesId FROM expense_events WHERE business_date=? ORDER BY id').all(day);
 const services=db.prepare(`SELECT t.id,coalesce(d.total_pesewas,cast(round(t.total*100) AS INTEGER)) AS chargePesewas,(SELECT count(*) FROM transaction_services WHERE transaction_id=t.id) AS services FROM transactions t LEFT JOIN visit_details d ON d.transaction_id=t.id WHERE t.status='completed' AND substr(coalesce(d.completed_at,t.created_at),1,10)=? ORDER BY t.id`).all(day);
 const balances=db.prepare(`SELECT t.id, max(0,coalesce(d.total_pesewas,cast(round(t.total*100) AS INTEGER))-coalesce((SELECT sum(coalesce(r.amount_pesewas,cast(round(p.amount*100) AS INTEGER))) FROM payments p LEFT JOIN payment_receipts r ON r.payment_id=p.id WHERE p.transaction_id=t.id AND p.status='completed' AND substr(p.paid_at,1,10)<=?),0)) AS outstandingPesewas FROM transactions t LEFT JOIN visit_details d ON d.transaction_id=t.id WHERE substr(t.created_at,1,10)<=? AND (t.status!='cancelled' OR substr(d.cancelled_at,1,10)>?) ORDER BY t.id`).all(day,day,day);
 function sum(rows,field='amountPesewas'){const n=rows.reduce((a,r)=>a+BigInt(r[field]),0n);const v=Number(n);if(!Number.isSafeInteger(v))throw Error('Financial total exceeds supported range.');return v;}
 const collections=Object.fromEntries(methods.map(m=>[m,sum(payments.filter(p=>p.method===m))]));
 const cashExpenses=sum(expenses.filter(e=>e.method==='cash')),cashPayouts=sum(payouts.filter(p=>p.method==='cash'));
 const legacyExpenses=db.prepare('SELECT id FROM expenses WHERE substr(expense_date,1,10)<=?').all(day);
 const legacyPayouts=db.prepare('SELECT p.id FROM worker_payments p LEFT JOIN worker_payout_receipts r ON r.worker_payment_id=p.id WHERE r.worker_payment_id IS NULL AND substr(p.payment_date,1,10)<=?').all(day);
 const legacyClosings=db.prepare('SELECT id FROM daily_closings WHERE closing_date<=?').all(day);
 const result={businessDate:day,completedServices:sum(services,'services'),serviceCharges:sum(services,'chargePesewas'),received:sum(payments),outstanding:sum(balances,'outstandingPesewas'),payoutsPaid:sum(payouts),expensesPaid:sum(expenses),collections,cashExpenses,cashPayouts,netCash:sum([{amountPesewas:collections.cash},{amountPesewas:-cashExpenses},{amountPesewas:-cashPayouts}]),payments,payouts,expenses,services,balances,legacyExpenses,legacyPayouts,legacyClosings};
 return {...result,token:hash(result)};
 }
 function history(db,day){return db.prepare('SELECT c.*,u.full_name AS administrator,r.reason AS reopen_reason,r.reopened_at FROM financial_closings c JOIN users u ON u.id=c.closed_by LEFT JOIN closing_reopenings r ON r.closing_id=c.id WHERE c.business_date=? ORDER BY c.id DESC').all(day).map(c=>({...c,snapshot:JSON.parse(c.snapshot)}));}
 handle('finance:closing-preview',(db,input)=>{const day=date(input.businessDate);const previousDay=new Date(Date.parse(day)-86400000).toISOString().slice(0,10);return {preview:preview(db,day),history:history(db,day),carry:db.prepare('SELECT id,actual_pesewas FROM confirmed_financial_closings WHERE business_date=?').get(previousDay)??null};});
 handle('finance:closing-confirm',(db,input,user)=>{
 const day=date(input.businessDate);unlocked(db,day);const p=preview(db,day);
 if(p.token!==input.token)throw Error('Activity changed. Refresh and review totals before confirming.');
 if(p.legacyExpenses.length||p.legacyPayouts.length||p.legacyClosings.length)throw Error('Historical expenses, unclassified payouts or legacy closings require reconciliation before closing.');
 let opening=cents(input.openingPesewas),reason=text(input.openingReason,500,true),carry=null;
 if(input.carryFrom!=null){carry=cents(input.carryFrom,1);const c=db.prepare('SELECT * FROM confirmed_financial_closings WHERE id=?').get(carry);if(!c||Date.parse(day)-Date.parse(c.business_date)!==86400000||opening!==c.actual_pesewas)throw Error('Carry-forward must match the previous confirmed day.');}
 const actual=cents(input.actualPesewas),expected=opening+p.netCash;if(!Number.isSafeInteger(expected))throw Error('Balance exceeds supported range.');
 const variance=actual-expected;if(!Number.isSafeInteger(variance))throw Error('Variance exceeds supported range.');const explanation=text(input.explanation,500,variance!==0);
 const snapshot={...p,openingPesewas:opening,expectedPesewas:expected};
 const id=Number(db.prepare('INSERT INTO financial_closings(business_date,snapshot,opening_pesewas,opening_reason,carry_from,actual_pesewas,variance_pesewas,explanation,closed_by,closed_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(day,JSON.stringify(snapshot),opening,reason,carry,actual,variance,explanation,user.id,new Date(now()).toISOString()).lastInsertRowid);return {id};
 });
 handle('finance:closing-reopen',(db,input,user)=>{const id=cents(input.id,1),reason=text(input.reason,500,true);const c=db.prepare('SELECT * FROM confirmed_financial_closings WHERE id=?').get(id);if(!c)throw Error('Confirmed closing not found.');if(db.prepare('SELECT id FROM confirmed_financial_closings WHERE business_date>?').get(c.business_date))throw Error('Reopen later closing days first to protect carry-forward and historical balances.');db.prepare('INSERT INTO closing_reopenings VALUES(?,?,?,?)').run(id,reason,user.id,new Date(now()).toISOString());return {success:true};});
}
module.exports={registerFinanceHandlers};
