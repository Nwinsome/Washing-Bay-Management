const DAY=86400000;
const TABLES=['workers','companies','expenseEvents','companyServices','outstanding','closings','closingRevisions'];
function date(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)throw Error('Enter valid report dates.');return value;}
function filters(input,now){
 if(input==null)input={};if(typeof input!=='object'||Array.isArray(input))throw Error('Invalid report filters.');
 const today=new Date(now).toISOString().slice(0,10),preset=input.preset??'today';let from=today,to=today;
 if(preset==='yesterday')from=to=new Date(Date.parse(today)-DAY).toISOString().slice(0,10);
 else if(preset==='week'){const weekday=new Date(today).getUTCDay();from=new Date(Date.parse(today)-((weekday+6)%7)*DAY).toISOString().slice(0,10);}
 else if(preset==='month')from=today.slice(0,7)+'-01';
 else if(preset==='custom'){from=date(input.from);to=date(input.to);}
 else if(preset!=='today')throw Error('Select a supported report period.');
 if(from>to||to>today||(Date.parse(to)-Date.parse(from))/DAY>=366)throw Error('Choose an ordered report range of at most 366 days ending no later than today.');
 return {preset,from,to};
}
function safe(value){if(typeof value==='bigint'){const n=Number(value);if(!Number.isSafeInteger(n))throw Error('Report amount exceeds the supported integer range.');return n;}if(Array.isArray(value))return value.map(safe);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,safe(v)]));return value;}
function sum(values){return safe(values.reduce((a,v)=>a+BigInt(v),0n));}
function decimal(value){const n=BigInt(value),a=n<0n?-n:n;return `${n<0n?'-':''}${a/100n}.${(a%100n).toString().padStart(2,'0')}`;}
const CTE=`WITH RECURSIVE
 range AS (SELECT @from AS start,@to AS finish),
 days(day) AS (SELECT @from UNION ALL SELECT date(day,'+1 day') FROM days WHERE day<@to),
 visits AS (
 SELECT t.id,t.transaction_number AS number,t.vehicle_id AS vehicleId,t.status,substr(t.created_at,1,10) AS chargeDay,
 substr(coalesce(d.completed_at,t.created_at),1,10) AS completionDay,substr(d.cancelled_at,1,10) AS cancelDay,
 coalesce(d.total_pesewas,cast(round(t.total*100) AS INTEGER)) AS totalPesewas,
 CASE WHEN d.completed_at IS NULL AND t.status='completed' THEN 1 ELSE 0 END AS legacyCompletion,
 coalesce(c.category_name,v.vehicle_type_name,CASE WHEN t.vehicle_id IS NULL THEN 'Independent / no vehicle' ELSE 'Unknown historical category' END) AS category,
 v.registration_number AS vehicle,coalesce(v.customer_name,cust.full_name,'Unnamed individual') AS customer,
 s.company_id AS companyId,s.company_name AS companyName,s.due_date AS dueDate,
 CASE WHEN s.company_id IS NULL THEN 'Individual' ELSE 'Company' END AS customerType
 FROM transactions t LEFT JOIN visit_details d ON d.transaction_id=t.id LEFT JOIN visit_category_snapshots c ON c.transaction_id=t.id
 LEFT JOIN transaction_vehicle_snapshots v ON v.transaction_id=t.id LEFT JOIN customers cust ON cust.id=t.customer_id
 LEFT JOIN visit_company_snapshots s ON s.transaction_id=t.id),
 receipts AS (SELECT p.id,p.transaction_id AS visitId,p.method,substr(p.paid_at,1,10) AS day,p.reference,
 coalesce(r.amount_pesewas,cast(round(p.amount*100) AS INTEGER)) AS amountPesewas,
 CASE WHEN r.payment_id IS NULL THEN 1 ELSE 0 END AS legacy,a.batch_id AS batchId
 FROM payments p LEFT JOIN payment_receipts r ON r.payment_id=p.id LEFT JOIN company_payment_allocations a ON a.payment_id=p.id WHERE p.status='completed'),
 periodVisits AS (SELECT * FROM visits WHERE status='completed' AND completionDay BETWEEN @from AND @to),
 periodReceipts AS (SELECT * FROM receipts WHERE day BETWEEN @from AND @to),
 paidAsOf AS (SELECT visitId,sum(amountPesewas) AS paidPesewas FROM receipts WHERE day<=@to GROUP BY visitId),
 balances AS (SELECT v.*,coalesce(p.paidPesewas,0) AS paidPesewas,
 CASE WHEN status='cancelled' AND (cancelDay IS NULL OR cancelDay<=@to) THEN 0 ELSE max(0,totalPesewas-coalesce(p.paidPesewas,0)) END AS outstandingPesewas
 FROM visits v LEFT JOIN paidAsOf p ON p.visitId=v.id WHERE chargeDay<=@to),
 expensesAll AS (SELECT 'event' AS source,id,category,description,business_date AS day,amount_pesewas AS amountPesewas,method,
 reverses_id AS reversesId,reason,recorded_by AS userId,recorded_at AS recordedAt FROM expense_events
 UNION ALL SELECT 'legacy',id,category,description,substr(expense_date,1,10),cast(round(amount*100) AS INTEGER),coalesce(payment_method,'unclassified'),NULL,NULL,recorded_by,created_at FROM expenses),
 periodExpenses AS (SELECT * FROM expensesAll WHERE day BETWEEN @from AND @to),
 payouts AS (SELECT p.id,p.worker_id AS workerId,substr(p.payment_date,1,10) AS day,
 coalesce(r.amount_pesewas,cast(round(p.amount*100) AS INTEGER)) AS amountPesewas,r.method,
 CASE WHEN r.worker_payment_id IS NULL THEN 1 ELSE 0 END AS legacy FROM worker_payments p LEFT JOIN worker_payout_receipts r ON r.worker_payment_id=p.id),
 periodPayouts AS (SELECT * FROM payouts WHERE day BETWEEN @from AND @to),
 work AS (SELECT l.id AS lineId,v.id AS visitId,v.companyId,v.companyName,v.number,v.vehicle,v.completionDay AS day,v.category,
 l.service_name AS serviceName,coalesce(role.code,k.service_kind,'unclassified') AS serviceType,l.quantity,
 coalesce(e.charge_pesewas,cast(round(l.line_total*100) AS INTEGER)) AS valuePesewas,
 coalesce(e.worker_id,a.worker_id) AS workerId,coalesce(e.worker_name,a.worker_name,'Unassigned / historical worker unknown') AS workerName,
 coalesce(e.state,'missing') AS state,e.earned_pesewas AS earnedPesewas
 FROM visits v JOIN transaction_services l ON l.transaction_id=v.id
 LEFT JOIN transaction_service_roles role ON role.transaction_service_id=l.id LEFT JOIN transaction_service_details k ON k.transaction_service_id=l.id
 LEFT JOIN worker_service_earnings e ON e.transaction_service_id=l.id LEFT JOIN transaction_service_workers a ON a.transaction_service_id=l.id
 WHERE v.status='completed'),
 periodWork AS (SELECT * FROM work WHERE day BETWEEN @from AND @to),
 confirmedClosings AS (SELECT c.*,json_extract(c.snapshot,'$.collections.cash') AS cashReceivedPesewas,
 json_extract(c.snapshot,'$.cashExpenses') AS cashExpensesPesewas,json_extract(c.snapshot,'$.cashPayouts') AS cashPayoutsPesewas,
 json_extract(c.snapshot,'$.expectedPesewas') AS expectedPesewas FROM confirmed_financial_closings c WHERE business_date BETWEEN @from AND @to)
`;
function all(db,sql,f,extra={}){return safe(db.prepare(CTE+sql).safeIntegers(true).all({...f,...extra}));}
function one(db,sql,f,extra={}){return safe(db.prepare(CTE+sql).safeIntegers(true).get({...f,...extra}));}
const queries={
 workers:`SELECT w.id,w.full_name AS name,
 coalesce(p.completedServices,0) AS completedServices,coalesce(p.categories,'') AS categories,coalesce(p.serviceValuePesewas,0) AS serviceValuePesewas,
 coalesce(p.confirmedEarningsPesewas,0) AS confirmedEarningsPesewas,coalesce(p.unresolvedServices,0) AS unresolvedServices,
 (SELECT count(*) FROM transaction_workers old JOIN periodVisits v ON v.id=old.transaction_id WHERE old.worker_id=w.id AND NOT EXISTS(SELECT 1 FROM transaction_service_workers a JOIN transaction_services l ON l.id=a.transaction_service_id WHERE l.transaction_id=v.id AND a.worker_id=w.id)) AS legacyUnallocatedVisits,
 CASE WHEN coalesce(p.unresolvedServices,0)>0 OR salary.arrangement IN ('daily_salary','monthly_salary') OR EXISTS(SELECT 1 FROM transaction_workers old JOIN periodVisits v ON v.id=old.transaction_id WHERE old.worker_id=w.id AND NOT EXISTS(SELECT 1 FROM transaction_service_workers a JOIN transaction_services l ON l.id=a.transaction_service_id WHERE l.transaction_id=v.id AND a.worker_id=w.id)) THEN NULL ELSE coalesce(p.confirmedEarningsPesewas,0) END AS earningsPesewas,
 coalesce(paid.amountPesewas,0) AS payoutsPesewas,coalesce(paid.legacyCount,0) AS legacyPayouts,
 max(0,coalesce(life.earnedPesewas,0)-coalesce(lifePaid.verifiedPesewas,0)) AS confirmedOutstandingPesewas,
 CASE WHEN salary.arrangement IN ('daily_salary','monthly_salary') OR coalesce(life.unresolved,0)>0 OR coalesce(lifePaid.legacyCount,0)>0 OR coalesce(lifePaid.verifiedPesewas,0)>coalesce(life.earnedPesewas,0)
 OR EXISTS(SELECT 1 FROM transaction_workers old JOIN visits v ON v.id=old.transaction_id WHERE old.worker_id=w.id AND v.status='completed' AND v.completionDay<=@to AND NOT EXISTS(SELECT 1 FROM transaction_service_workers a JOIN transaction_services l ON l.id=a.transaction_service_id WHERE l.transaction_id=v.id AND a.worker_id=w.id))
 THEN NULL ELSE max(0,coalesce(life.earnedPesewas,0)-coalesce(lifePaid.verifiedPesewas,0)) END AS payablePesewas
 FROM workers w LEFT JOIN worker_salary_agreements salary ON salary.worker_id=w.id LEFT JOIN (SELECT workerId,sum(quantity) AS completedServices,group_concat(DISTINCT category) AS categories,
 sum(valuePesewas) AS serviceValuePesewas,sum(CASE WHEN state='confirmed' THEN earnedPesewas ELSE 0 END) AS confirmedEarningsPesewas,
 sum(CASE WHEN state!='confirmed' THEN quantity ELSE 0 END) AS unresolvedServices FROM periodWork GROUP BY workerId) p ON p.workerId=w.id
 LEFT JOIN (SELECT workerId,sum(amountPesewas) AS amountPesewas,sum(legacy) AS legacyCount FROM periodPayouts GROUP BY workerId) paid ON paid.workerId=w.id
 LEFT JOIN (SELECT workerId,sum(CASE WHEN state='confirmed' THEN earnedPesewas ELSE 0 END) AS earnedPesewas,sum(CASE WHEN state!='confirmed' THEN quantity ELSE 0 END) AS unresolved FROM work WHERE day<=@to GROUP BY workerId) life ON life.workerId=w.id
 LEFT JOIN (SELECT workerId,sum(CASE WHEN legacy=0 THEN amountPesewas ELSE 0 END) AS verifiedPesewas,sum(legacy) AS legacyCount FROM payouts WHERE day<=@to GROUP BY workerId) lifePaid ON lifePaid.workerId=w.id
 ORDER BY completedServices DESC,w.id`,
 companies:`SELECT c.id,c.name,c.is_active AS active,c.credit_enabled AS creditEnabled,c.credit_limit_pesewas AS creditLimitPesewas,
 coalesce(b.outstandingPesewas,0) AS outstandingPesewas,coalesce(b.overduePesewas,0) AS overduePesewas,coalesce(p.amountPesewas,0) AS receivedPesewas,
 coalesce(service.visits,0) AS completedVisits,coalesce(service.amountPesewas,0) AS serviceChargesPesewas
 FROM company_accounts c LEFT JOIN (SELECT companyId,sum(outstandingPesewas) AS outstandingPesewas,sum(CASE WHEN dueDate<@to THEN outstandingPesewas ELSE 0 END) AS overduePesewas FROM balances GROUP BY companyId) b ON b.companyId=c.id
 LEFT JOIN (SELECT v.companyId,sum(r.amountPesewas) AS amountPesewas FROM periodReceipts r JOIN visits v ON v.id=r.visitId GROUP BY v.companyId) p ON p.companyId=c.id
 LEFT JOIN (SELECT companyId,count(*) AS visits,sum(totalPesewas) AS amountPesewas FROM periodVisits GROUP BY companyId) service ON service.companyId=c.id
 ORDER BY outstandingPesewas DESC,c.id`,
 expenseEvents:`SELECT e.source,e.id,e.day,e.category,e.description,e.method,e.amountPesewas,e.reversesId,e.reason,u.full_name AS administrator,e.recordedAt FROM periodExpenses e LEFT JOIN users u ON u.id=e.userId ORDER BY e.day DESC,e.source,e.id DESC`,
 companyServices:`SELECT p.lineId,p.visitId,p.number,p.companyName,p.day,p.vehicle,p.category,p.serviceName,p.serviceType,p.quantity,p.valuePesewas FROM periodWork p WHERE p.companyId IS NOT NULL ORDER BY p.day DESC,p.visitId DESC,p.lineId`,
 outstanding:`SELECT id,number,customerType,coalesce(companyName,customer) AS account,vehicle,chargeDay,dueDate,totalPesewas,paidPesewas,outstandingPesewas FROM balances WHERE outstandingPesewas>0 ORDER BY chargeDay,id`,
 closings:`SELECT days.day,c.id,CASE WHEN c.id IS NOT NULL THEN CASE WHEN r.closing_id IS NULL THEN 'confirmed' ELSE 'reopened' END WHEN old.id IS NOT NULL THEN 'legacy / unverified' ELSE 'open' END AS status,
 CASE WHEN c.id IS NOT NULL THEN c.opening_pesewas WHEN old.id IS NOT NULL THEN cast(round(old.opening_balance*100) AS INTEGER) END AS openingPesewas,
 json_extract(c.snapshot,'$.collections.cash') AS cashReceivedPesewas,json_extract(c.snapshot,'$.cashExpenses') AS cashExpensesPesewas,json_extract(c.snapshot,'$.cashPayouts') AS cashPayoutsPesewas,
 CASE WHEN c.id IS NOT NULL THEN json_extract(c.snapshot,'$.expectedPesewas') WHEN old.id IS NOT NULL THEN cast(round(old.expected_cash*100) AS INTEGER) END AS expectedPesewas,
 CASE WHEN c.id IS NOT NULL THEN c.actual_pesewas WHEN old.id IS NOT NULL THEN cast(round(old.actual_cash*100) AS INTEGER) END AS actualPesewas,
 CASE WHEN c.id IS NOT NULL THEN c.variance_pesewas WHEN old.id IS NOT NULL THEN cast(round(old.variance*100) AS INTEGER) END AS variancePesewas,
 coalesce(c.explanation,old.notes) AS explanation,u.full_name AS administrator,c.closed_at AS closedAt,r.reason AS reopeningReason
 FROM days LEFT JOIN financial_closings c ON c.id=(SELECT max(id) FROM financial_closings WHERE business_date=days.day)
 LEFT JOIN closing_reopenings r ON r.closing_id=c.id LEFT JOIN daily_closings old ON old.id=(SELECT max(id) FROM daily_closings WHERE substr(closing_date,1,10)=days.day) LEFT JOIN users u ON u.id=c.closed_by ORDER BY days.day DESC`,
 closingRevisions:`SELECT c.id,c.business_date AS day,CASE WHEN r.closing_id IS NULL THEN 'confirmed' ELSE 'reopened' END AS status,c.opening_pesewas AS openingPesewas,
 json_extract(c.snapshot,'$.collections.cash') AS cashReceivedPesewas,json_extract(c.snapshot,'$.cashExpenses') AS cashExpensesPesewas,json_extract(c.snapshot,'$.cashPayouts') AS cashPayoutsPesewas,
 json_extract(c.snapshot,'$.expectedPesewas') AS expectedPesewas,c.actual_pesewas AS actualPesewas,c.variance_pesewas AS variancePesewas,c.explanation,u.full_name AS administrator,c.closed_at AS closedAt,r.reason AS reopeningReason
 FROM financial_closings c LEFT JOIN closing_reopenings r ON r.closing_id=c.id LEFT JOIN users u ON u.id=c.closed_by WHERE c.business_date BETWEEN @from AND @to ORDER BY c.business_date DESC,c.id DESC`
};
function rowData(db,f,table,offset=0,exporting=false){
 if(!TABLES.includes(table))throw Error('Select a supported report table.');
 if(!Number.isSafeInteger(offset)||offset<0)throw Error('Invalid report page.');
 const limit=exporting?50001:50;
 const rows=all(db,queries[table]+' LIMIT @limit OFFSET @offset',f,{limit,offset});
 if(exporting&&rows.length>50000)throw Error('Export exceeds 50,000 rows in a section; choose a narrower report period.');
 if(table==='companies')for(const row of rows){row.utilizationBasisPoints=row.creditLimitPesewas>0?sum([(BigInt(row.outstandingPesewas)*10000n)/BigInt(row.creditLimitPesewas)]):null;}
 const total=exporting?rows.length:one(db,`SELECT count(*) AS count FROM (${queries[table]})`,f).count;
 return {table,rows,total,offset,limit:exporting?50000:50,from:f.from,to:f.to};
}
function reportData(db,f,now){
 const summary=one(db,`SELECT
 (SELECT coalesce(sum(totalPesewas),0) FROM periodVisits) AS serviceChargesPesewas,
 (SELECT coalesce(sum(valuePesewas),0) FROM periodWork) AS serviceLineValuePesewas,
 (SELECT coalesce(sum(quantity),0) FROM periodWork) AS completedServices,
 (SELECT count(*) FROM periodVisits) AS completedVisits,
 (SELECT coalesce(sum(amountPesewas),0) FROM periodReceipts) AS collectedPesewas,
 (SELECT coalesce(sum(outstandingPesewas),0) FROM balances) AS knownOutstandingPesewas,
 (SELECT coalesce(sum(outstandingPesewas),0) FROM balances WHERE companyId IS NULL) AS individualOutstandingPesewas,
 (SELECT coalesce(sum(outstandingPesewas),0) FROM balances WHERE companyId IS NOT NULL) AS companyOutstandingPesewas,
 (SELECT coalesce(sum(outstandingPesewas),0) FROM balances WHERE companyId IS NOT NULL AND dueDate<@to) AS companyOverduePesewas,
 (SELECT coalesce(sum(amountPesewas),0) FROM periodExpenses) AS expensesPesewas,
 (SELECT coalesce(sum(amountPesewas),0) FROM periodExpenses WHERE source='legacy') AS legacyExpensesPesewas,
 (SELECT coalesce(sum(amountPesewas),0) FROM periodPayouts) AS payoutsPesewas,
 (SELECT coalesce(sum(amountPesewas),0) FROM periodPayouts WHERE legacy=0) AS verifiedPayoutsPesewas,
 (SELECT coalesce(sum(earnedPesewas),0) FROM periodWork WHERE state='confirmed') AS confirmedEarningsPesewas,
 (SELECT coalesce(sum(quantity),0) FROM periodWork WHERE state!='confirmed') AS unresolvedCompensationServices,
 (SELECT coalesce(sum(quantity),0) FROM periodWork WHERE state='salary') AS salaryServices,
 (SELECT count(*) FROM worker_salary_agreements WHERE arrangement!='service') AS salaryAgreementCount,
 (SELECT coalesce(sum(quantity),0) FROM periodWork WHERE state='unconfigured') AS unconfiguredServices,
 (SELECT coalesce(sum(quantity),0) FROM periodWork WHERE state IN ('missing','review')) AS reviewServices,
 (SELECT coalesce(sum(quantity),0) FROM periodWork WHERE workerId IS NULL) AS unknownWorkerServices,
 (SELECT coalesce(sum(amountPesewas),0) FROM periodReceipts WHERE method='cash') AS cashReceivedPesewas,
 (SELECT coalesce(sum(amountPesewas),0) FROM periodExpenses WHERE source='event' AND method='cash') AS verifiedCashExpensesPesewas,
 (SELECT coalesce(sum(amountPesewas),0) FROM periodPayouts WHERE legacy=0 AND method='cash') AS verifiedCashPayoutsPesewas,
 (SELECT count(*) FROM periodExpenses WHERE source='legacy') AS legacyExpenseCount,
 (SELECT count(*) FROM periodPayouts WHERE legacy=1) AS legacyPayoutCount,
 (SELECT count(*) FROM periodReceipts WHERE legacy=1) AS legacyReceiptCount,
 (SELECT coalesce(sum(legacyCompletion),0) FROM periodVisits) AS legacyCompletionCount,
 (SELECT count(*) FROM balances WHERE status='cancelled' AND cancelDay IS NULL) AS undatedCancellations,
 (SELECT count(*) FROM confirmedClosings) AS confirmedClosingCount,
 (SELECT coalesce(sum(variance_pesewas),0) FROM confirmedClosings) AS closingVariancePesewas,
 (SELECT coalesce(sum(-variance_pesewas),0) FROM confirmedClosings WHERE variance_pesewas<0) AS shortagesPesewas,
 (SELECT coalesce(sum(variance_pesewas),0) FROM confirmedClosings WHERE variance_pesewas>0) AS overagesPesewas`,f);
 summary.outstandingPesewas=summary.undatedCancellations?null:summary.knownOutstandingPesewas;
 summary.earningsPesewas=summary.unresolvedCompensationServices||summary.salaryAgreementCount?null:summary.confirmedEarningsPesewas;
 summary.receiptOutflowDifferencePesewas=sum([summary.collectedPesewas,-summary.expensesPesewas,-summary.payoutsPesewas]);
 summary.recordedCashMovementPesewas=sum([summary.cashReceivedPesewas,-summary.verifiedCashExpensesPesewas,-summary.verifiedCashPayoutsPesewas]);
 summary.visitAdjustmentPesewas=sum([summary.serviceChargesPesewas,-summary.serviceLineValuePesewas]);
 const daily=all(db,`SELECT days.day,coalesce(v.amountPesewas,0) AS chargesPesewas,coalesce(p.amountPesewas,0) AS collectedPesewas,coalesce(e.amountPesewas,0) AS expensesPesewas,coalesce(w.amountPesewas,0) AS payoutsPesewas
 FROM days LEFT JOIN (SELECT completionDay AS day,sum(totalPesewas) AS amountPesewas FROM periodVisits GROUP BY completionDay) v ON v.day=days.day
 LEFT JOIN (SELECT day,sum(amountPesewas) AS amountPesewas FROM periodReceipts GROUP BY day) p ON p.day=days.day
 LEFT JOIN (SELECT day,sum(amountPesewas) AS amountPesewas FROM periodExpenses GROUP BY day) e ON e.day=days.day
 LEFT JOIN (SELECT day,sum(amountPesewas) AS amountPesewas FROM periodPayouts GROUP BY day) w ON w.day=days.day ORDER BY days.day`,f);
 const categories=all(db,'SELECT category AS label,sum(totalPesewas) AS amountPesewas,count(*) AS count FROM periodVisits GROUP BY category ORDER BY amountPesewas DESC,label',f);
 const services=all(db,"SELECT serviceName AS label,serviceType,sum(valuePesewas) AS amountPesewas,sum(quantity) AS count FROM periodWork GROUP BY serviceName,serviceType ORDER BY count DESC,label",f);
 const customers=all(db,'SELECT customerType AS label,sum(totalPesewas) AS amountPesewas,count(*) AS count FROM periodVisits GROUP BY customerType ORDER BY label',f);
 const payments=all(db,'SELECT method AS label,sum(amountPesewas) AS amountPesewas,count(*) AS count FROM periodReceipts GROUP BY method ORDER BY amountPesewas DESC,label',f);
 const expenses=all(db,'SELECT category AS label,sum(amountPesewas) AS amountPesewas,count(*) AS count FROM periodExpenses GROUP BY category ORDER BY amountPesewas DESC,label',f);
 const weeklyExpenses=all(db,"SELECT date(day,'-'||((cast(strftime('%w',day) AS INTEGER)+6)%7)||' days') AS label,sum(amountPesewas) AS amountPesewas,count(*) AS count FROM periodExpenses GROUP BY label ORDER BY label",f);
 const monthlyExpenses=all(db,"SELECT substr(day,1,7) AS label,sum(amountPesewas) AS amountPesewas,count(*) AS count FROM periodExpenses GROUP BY label ORDER BY label",f);
 const aging=all(db,`SELECT CASE WHEN dueDate IS NULL THEN 'No due date' WHEN dueDate>=@to THEN 'Not yet overdue'
 WHEN julianday(@to)-julianday(dueDate)<=30 THEN 'Overdue 1-30 days' WHEN julianday(@to)-julianday(dueDate)<=60 THEN 'Overdue 31-60 days'
 WHEN julianday(@to)-julianday(dueDate)<=90 THEN 'Overdue 61-90 days' ELSE 'Overdue 91+ days' END AS label,sum(outstandingPesewas) AS amountPesewas,count(*) AS count FROM balances WHERE companyId IS NOT NULL AND outstandingPesewas>0 GROUP BY label ORDER BY label`,f);
 const workerChart=all(db,"SELECT workerName AS label,sum(quantity) AS count,sum(valuePesewas) AS amountPesewas FROM periodWork GROUP BY workerId,workerName ORDER BY count DESC,label LIMIT 15",f);
 const notices=['Service charges use completion dates; receipts, expenses and payouts use their recorded payment dates. Balances and aging include all visits created through the period end, including unfinished work.',
 'Receipt/outflow difference = collections minus recorded paid expenses minus actual recorded worker payouts. It is not net profit. Cash movement excludes opening cash, bankings, withdrawals and unclassified legacy outflows.',
 'Profit is unavailable: accrual expenses, salary obligations, tax, inventory and depreciation are not fully modeled. Confirmed earnings are compensation obligations, not business revenue.',
 'Credit utilization compares end-date balances with current configured credit limits. Closing status reflects the current revision; cash totals come from the saved snapshot.',
 'Historical balances use currently persisted completed receipts; a dated customer refund ledger is not yet implemented.'];
 if(summary.salaryAgreementCount)notices.push('Current salary agreements exist, but salary accrual is not implemented. Complete compensation totals remain unavailable; current agreements do not reconstruct historical salary obligations.');
 if(summary.unresolvedCompensationServices)notices.push(`${summary.unresolvedCompensationServices} completed services have unconfigured, salary, missing or review compensation. Earnings total is incomplete; confirmed subtotal is shown separately.`);
 if(summary.legacyExpenseCount||summary.legacyPayoutCount)notices.push('Legacy expenses/payouts are included in recorded outflow totals using stored amounts rounded to pesewas, but excluded from verified cash movement. Reconciliation is required.');
 if(summary.legacyReceiptCount||summary.legacyCompletionCount)notices.push('Legacy receipts use recorded amounts rounded to pesewas; missing completion dates fall back to visit creation dates.');
 if(summary.undatedCancellations)notices.push('Undated historical cancellations prevent an exact historical outstanding total. The known subtotal excludes those cancelled visits.');
 return {filters:f,currency:'GHS',business:db.prepare('SELECT business_name AS name FROM business_settings WHERE id=1').get(),generatedAt:new Date(now).toISOString(),summary,daily,categories,services,customers,payments,expenses,weeklyExpenses,monthlyExpenses,aging,workerChart,notices};
}
function csvCell(value){if(value==null)return '""';let s=String(value);if(typeof value==='string'&&/^\s*[=+@-]/.test(s)&&!/^[-]?\d+(?:\.\d+)?$/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
function reportCSV(report,sections){const rows=[['Financial and operational report',report.business.name],['Currency','GHS'],['From',report.filters.from],['To',report.filters.to],['Generated',report.generatedAt],[],['Summary metric','Value']];for(const [key,value] of Object.entries(report.summary))rows.push([key.endsWith('Pesewas')?key.replace(/Pesewas$/,' (GHS)'):key,value==null?'Incomplete / unknown':key.endsWith('Pesewas')?decimal(value):value]);for(const [title,data] of Object.entries(sections)){rows.push([], [title]);if(!data.length){rows.push(['No recorded activity']);continue;}const keys=Object.keys(data[0]);rows.push(keys.map(k=>k.endsWith('Pesewas')?k.replace(/Pesewas$/,' (GHS)'):k));for(const row of data)rows.push(keys.map(k=>row[k]==null?'':k.endsWith('Pesewas')?decimal(row[k]):row[k]));}rows.push([],['Calculation notes'],...report.notices.map(n=>[n]));return '\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n');}
function registerReportHandlers({ipcMain,getDatabase,administrator,now=Date.now}){
 function handle(name,action){ipcMain.handle(`reports:${name}`,(event,input)=>{const user=administrator(event);if(!user)throw Error('SESSION_EXPIRED: Administrator authentication is required for reports.');const f=filters(input,now()),db=getDatabase();return db.transaction(()=>{
 if(db.prepare('SELECT currency FROM business_settings WHERE id=1').get()?.currency!=='GHS')throw Error('Reports require GHS records; no currency conversion has been assumed.');
 if(db.prepare("SELECT t.id FROM transactions t LEFT JOIN visit_details d ON d.transaction_id=t.id WHERE (substr(t.created_at,1,10)<=? OR EXISTS(SELECT 1 FROM payments p WHERE p.transaction_id=t.id AND p.status='completed' AND substr(p.paid_at,1,10)<=?)) AND d.currency!='GHS' LIMIT 1").get(f.to,f.to))throw Error('Historical non-GHS visits require reconciliation before combining financial totals.');
 return action(db,f,input??{});
 })();});}
 handle('summary',(db,f)=>reportData(db,f,now()));
 handle('rows',(db,f,input)=>rowData(db,f,input.table,input.offset??0));
 handle('export',(db,f)=>{const report=reportData(db,f,now());const sections={daily:report.daily,'Vehicle category charges':report.categories,'Service line values and popularity':report.services,'Customer type charges':report.customers,'Payment methods':report.payments,'Expense categories':report.expenses,'Weekly expenses':report.weeklyExpenses,'Monthly expenses':report.monthlyExpenses,'Company aging':report.aging,'Worker chart (top 15 recorded names)':report.workerChart};for(const table of TABLES)sections[table]=rowData(db,f,table,0,true).rows;return {filename:`financial-report-${f.from}-${f.to}.csv`,csv:reportCSV(report,sections),from:f.from,to:f.to};});
}
module.exports={registerReportHandlers,filters,reportCSV};
