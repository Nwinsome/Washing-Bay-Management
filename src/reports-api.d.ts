export type ReportFilters = { preset:'today'|'yesterday'|'week'|'month'|'custom'; from?:string; to?:string };
export type ReportTable = 'workers'|'companies'|'expenseEvents'|'companyServices'|'outstanding'|'closings'|'closingRevisions';
export type ReportRow = Record<string,string|number|null>;
export type ReportBreakdown = {label:string;amountPesewas:number;count:number;serviceType?:string};
export type ReportDaily = {day:string;chargesPesewas:number;collectedPesewas:number;expensesPesewas:number;payoutsPesewas:number};
export type FinancialReport = {
 filters:{preset:ReportFilters['preset'];from:string;to:string};currency:'GHS';business:{name:string};generatedAt:string;
 summary:{serviceChargesPesewas:number;serviceLineValuePesewas:number;visitAdjustmentPesewas:number;completedServices:number;completedVisits:number;collectedPesewas:number;
 outstandingPesewas:number|null;knownOutstandingPesewas:number;individualOutstandingPesewas:number;companyOutstandingPesewas:number;companyOverduePesewas:number;
 expensesPesewas:number;legacyExpensesPesewas:number;payoutsPesewas:number;verifiedPayoutsPesewas:number;earningsPesewas:number|null;confirmedEarningsPesewas:number;
 unresolvedCompensationServices:number;salaryServices:number;salaryAgreementCount:number;unconfiguredServices:number;reviewServices:number;unknownWorkerServices:number;
 cashReceivedPesewas:number;verifiedCashExpensesPesewas:number;verifiedCashPayoutsPesewas:number;legacyExpenseCount:number;legacyPayoutCount:number;legacyReceiptCount:number;
 legacyCompletionCount:number;undatedCancellations:number;confirmedClosingCount:number;closingVariancePesewas:number;shortagesPesewas:number;overagesPesewas:number;
 receiptOutflowDifferencePesewas:number;recordedCashMovementPesewas:number;};
 daily:ReportDaily[];categories:ReportBreakdown[];services:ReportBreakdown[];customers:ReportBreakdown[];payments:ReportBreakdown[];
 expenses:ReportBreakdown[];weeklyExpenses:ReportBreakdown[];monthlyExpenses:ReportBreakdown[];aging:ReportBreakdown[];workerChart:ReportBreakdown[];notices:string[];
};
export type ReportRows = {table:ReportTable;rows:ReportRow[];total:number;offset:number;limit:number;from:string;to:string};
