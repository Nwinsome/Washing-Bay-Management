import { useCallback, useEffect, useRef, useState } from 'react';
import type { CompensationArrangement, CompensationMethod, EarningsConfiguration, EarningsDetail, EarningsList, ServiceCatalog } from '../app-api';
import './WorkersPage.css';
import './EarningsPage.css';
function decimal(value: number) {
  const amount = BigInt(value);
  return `${amount / 100n}.${(amount % 100n).toString().padStart(2, '0')}`;
}
const money = (value: number) => `GHS ${decimal(value)}`;
function units(value: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) throw Error('Enter a non-negative amount or percentage with at most two decimal places.');
  const [whole, fraction = ''] = value.split('.');
  const parsed = Number(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')));
  if (!Number.isSafeInteger(parsed)) throw Error('Amount is outside the supported range.');
  return parsed;
}
type Props = { refreshKey: number; onChanged: () => Promise<void>; onActivity: () => void; onSignedOut: (notice?: string) => void };
export default function EarningsPage({ refreshKey, onChanged, onActivity, onSignedOut }: Props) {
  const [data, setData] = useState<EarningsList | null>(null);
  const [catalog, setCatalog] = useState<ServiceCatalog | null>(null);
  const [config, setConfig] = useState<EarningsConfiguration | null>(null);
  const [detail, setDetail] = useState<EarningsDetail | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [search, setSearch] = useState(''), [from, setFrom] = useState(''), [to, setTo] = useState('');
  const [offset, setOffset] = useState(0), [detailOffset, setDetailOffset] = useState(0);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [service, setService] = useState(''), [category, setCategory] = useState('');
  const [method, setMethod] = useState<CompensationMethod>('unconfigured'), [rate, setRate] = useState('');
  const [arrangement, setArrangement] = useState<CompensationArrangement>('service'), [salary, setSalary] = useState('');
  const [amount, setAmount] = useState(''), [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'mobile_money' | 'bank_transfer' | 'other'>('cash');
  const [reference, setReference] = useState(''), [note, setNote] = useState('');
  const payout = useRef<{ fingerprint: string; key: string } | null>(null);
  const sequence = useRef(0);
  const saving = useRef(false);
  const fail = useCallback((reason: unknown) => {
    if (reason instanceof Error && reason.message.includes('SESSION_EXPIRED')) onSignedOut('Your session ended. Please sign in again.');
    else setError(reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : 'Unable to load worker earnings.');
  }, [onSignedOut]);
  const load = useCallback(async () => {
    const request = ++sequence.current; setLoading(true); setError('');
    try {
      const results = await Promise.allSettled([window.appApi.getWorkerEarnings({ search, from, to, offset }), window.appApi.getServices(), window.appApi.getEarningsConfiguration(), selected == null ? Promise.resolve(null) : window.appApi.getWorkerEarningsDetail({ workerId: selected, from, to, offset: detailOffset })]);
      if (request !== sequence.current) return;
      for (const result of results) if (result.status === 'rejected') throw result.reason;
      if (results[0].status === 'fulfilled') setData(results[0].value);
      if (results[1].status === 'fulfilled') setCatalog(results[1].value);
      if (results[2].status === 'fulfilled') setConfig(results[2].value);
      if (results[3].status === 'fulfilled') setDetail(results[3].value);
    } catch (reason) { if (request === sequence.current) fail(reason); }
    finally { if (request === sequence.current) setLoading(false); }
  }, [search, from, to, offset, selected, detailOffset, fail]);
  useEffect(() => { const timer = setTimeout(() => void load(), 200); return () => { clearTimeout(timer); sequence.current++; }; }, [load, refreshKey]);
  useEffect(() => {
    const current = config?.rules.find(rule => rule.serviceId === Number(service) && rule.vehicleTypeId === (category ? Number(category) : null));
    setMethod(current?.method ?? (category ? 'inherit' : 'unconfigured')); setRate(current?.rateUnits == null ? '' : decimal(current.rateUnits));
  }, [service, category, config]);
  useEffect(() => {
    const current = config?.agreements.find(item => item.workerId === selected);
    setArrangement(current?.arrangement ?? 'service'); setSalary(current?.amountPesewas == null ? '' : decimal(current.amountPesewas));
  }, [selected, config]);
  useEffect(() => { setAmount(''); setReference(''); setNote(''); payout.current = null; }, [selected]);
  async function change(action: () => Promise<unknown>, message: string) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true); setError(''); setNotice(''); onActivity();
    try { await action(); setNotice(message); await load(); await onChanged(); }
    catch (reason) { fail(reason); }
    finally { saving.current = false; setBusy(false); }
  }
  const locked = busy || loading;
  return <div className="earnings-page" onInput={onActivity} onClick={onActivity} aria-busy={loading}>
    <div className="workers-intro"><p>Confirmed earnings from completed services, separate from customer collections and business expenses.</p></div>
    {error && <div className="error-banner" role="alert">{error}<button className="text-button" onClick={() => void load()} disabled={busy}>Retry</button></div>}
    {notice && <p className="worker-notice" role="status">{notice}</p>}
    {loading && <p role="status">Loading worker earnings…</p>}
    <section className="dashboard-panel"><div className="panel-heading"><div><h2>Worker earnings</h2><p>Date filters apply to activity. Payable balances always include all confirmed work and payouts.</p></div></div>
      <div className="worker-toolbar"><label className="field worker-search">Search workers<input value={search} maxLength={120} onChange={event => { setSearch(event.target.value); setOffset(0); }} placeholder="Name or phone" /></label><label className="field">From<input type="date" value={from} onChange={event => { setFrom(event.target.value); setOffset(0); setDetailOffset(0); }} /></label><label className="field">To<input type="date" value={to} onChange={event => { setTo(event.target.value); setOffset(0); setDetailOffset(0); }} /></label></div>
      {data?.workers.length ? <div className="table-scroll"><table><caption className="sr-only">Worker earnings and confirmed payable balances</caption><thead><tr><th>Worker</th><th>Completed services</th><th>Confirmed earned in period</th><th>Verified paid in period</th><th>Payable balance · all time</th><th>Details</th></tr></thead><tbody>{data.workers.map(worker => <tr key={worker.id}><th scope="row">{worker.name}<small>{worker.isActive ? 'Active' : 'Inactive'}</small></th><td>{worker.period.completedServices}<small>{worker.period.unconfigured > 0 && `${worker.period.unconfigured} unconfigured / review`}{worker.period.salaryServices > 0 && ` · ${worker.period.salaryServices} salary work`}{worker.legacyCompletedServices > 0 && ` · ${worker.legacyCompletedServices} historical work requires review`}</small></td><td>{worker.period.completedServices > 0 && worker.period.unconfigured === worker.period.completedServices ? 'Unconfigured' : money(worker.period.earnedPesewas)}</td><td>{money(worker.period.paidPesewas)}</td><td>{worker.account.payoutBlocked ? 'Reconciliation required' : money(worker.account.outstandingPesewas)}</td><td><button className="secondary-button" disabled={busy} onClick={() => { setSelected(worker.id); setDetail(null); setDetailOffset(0); }}>View</button></td></tr>)}</tbody></table></div> : !loading && <div className="worker-empty">No workers match your search. Register workers in Workers to get started.</div>}
      {data && <div className="worker-pagination"><span>{data.total} workers</span><button className="secondary-button" disabled={locked || offset === 0} onClick={() => setOffset(offset - 50)}>Previous</button><button className="secondary-button" disabled={locked || offset + 50 >= data.total} onClick={() => setOffset(offset + 50)}>Next</button></div>}
    </section>
    <section className="dashboard-panel"><div className="panel-heading"><div><h2>Compensation rules</h2><p>Rules are captured at completion. A category rule overrides the general service rule. Explicitly unconfigured category rules prevent fallback.</p></div></div>
      <form className="worker-form-grid" onSubmit={event => { event.preventDefault(); void change(() => window.appApi.setCompensationRule({ serviceId: Number(service), vehicleTypeId: category ? Number(category) : null, method, ...(['fixed', 'percentage'].includes(method) ? { rateUnits: units(rate) } : {}) }), 'Compensation rule saved. Completed earnings remain unchanged.'); }}>
        <label className="field">Service<select required value={service} disabled={locked} onChange={event => setService(event.target.value)}><option value="">Choose service</option>{catalog?.services.map(item => <option key={item.id} value={item.id}>{item.name}{item.isActive ? '' : ' (inactive)'}</option>)}</select></label>
        <label className="field">Vehicle category<select value={category} disabled={locked} onChange={event => setCategory(event.target.value)}><option value="">General rule · all categories</option>{catalog?.vehicleTypes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="field">Compensation method<select value={method} disabled={locked} onChange={event => setMethod(event.target.value as CompensationMethod)}>{category && <option value="inherit">Use general rule</option>}<option value="unconfigured">Unconfigured</option><option value="fixed">Fixed per service</option><option value="percentage">Percentage of service charge</option></select></label>
        {['fixed', 'percentage'].includes(method) && <label className="field">{method === 'fixed' ? 'Amount (GHS)' : 'Percentage (%)'}<input required type="number" min="0" max={method === 'percentage' ? '100' : undefined} step="0.01" value={rate} disabled={locked} onChange={event => setRate(event.target.value)} /></label>}
        <button className="primary-button" disabled={locked || !service}>Save rule</button>
      </form>
    </section>
    {detail && detail.worker.id === selected && <section className="dashboard-panel"><div className="panel-heading"><div><h2>{detail.worker.name}</h2><p>Confirmed service earnings and worker payments</p></div><button className="secondary-button" disabled={busy} onClick={() => { setSelected(null); setDetail(null); }}>Close</button></div>
      <div className="worker-metrics"><article className="metric-card"><span>Confirmed earned · all time</span><strong>{money(detail.account.earnedPesewas)}</strong></article><article className="metric-card"><span>Confirmed payouts · all time</span><strong>{money(detail.account.paidPesewas)}</strong></article><article className="metric-card"><span>Outstanding · all time</span><strong>{detail.account.payoutBlocked ? 'Requires review' : money(detail.account.outstandingPesewas)}</strong></article></div>
      {detail.account.legacyPayments > 0 && <p className="worker-notice">{detail.account.legacyPayments} historical payment(s) have no verified earnings allocation. Payouts are blocked until these records can be reconciled.</p>}
      {detail.legacyCompletedServices > 0 && <p className="worker-notice">{detail.legacyCompletedServices} older completed service(s) have no completion-time earnings snapshot. Existing estimates are preserved and excluded from confirmed payable earnings.</p>}
      <h3>Payment arrangement</h3><form className="worker-form-grid" onSubmit={event => { event.preventDefault(); void change(() => window.appApi.setWorkerArrangement({ workerId: detail.worker.id, arrangement, ...(arrangement !== 'service' ? { amountPesewas: units(salary) } : {}) }), 'Payment arrangement saved for future completions.'); }}>
        <label className="field">Arrangement<select value={arrangement} disabled={locked} onChange={event => setArrangement(event.target.value as CompensationArrangement)}><option value="service">Service compensation</option><option value="daily_salary">Daily salary</option><option value="monthly_salary">Monthly salary</option></select></label>{arrangement !== 'service' && <label className="field">Salary amount (GHS)<input required type="number" min="0.01" step="0.01" value={salary} disabled={locked} onChange={event => setSalary(event.target.value)} /></label>}<button className="primary-button" disabled={locked}>Save arrangement</button>
      </form><p className="overview-note">Salary agreements exclude per-service accrual. Attendance, salary periods, proration and salary payouts require a separate policy; no salary obligation is generated automatically.</p>
      <h3>Completed service breakdown</h3>{detail.lines.length ? <div className="table-scroll"><table><thead><tr><th>Completed / visit</th><th>Service</th><th>Charge</th><th>Captured rule</th><th>Earnings</th></tr></thead><tbody>{detail.lines.map(line => <tr key={line.id}><th scope="row">{line.completedAt.slice(0, 10)}<small>{line.visitNumber}</small></th><td>{line.serviceName}<small>{line.categoryName ?? 'Independent / historical category'}</small></td><td>{line.chargePesewas == null ? 'Requires review' : money(line.chargePesewas)}</td><td>{line.state === 'salary' ? `${line.arrangement.replace('_', ' ')} · ${money(line.salaryPesewas ?? 0)}` : line.method === 'percentage' ? `${((line.rateUnits ?? 0) / 100).toFixed(2)}%` : line.method === 'fixed' ? `${money(line.rateUnits ?? 0)} per service` : 'Unconfigured'}</td><td>{line.earnedPesewas == null ? line.state === 'salary' ? 'Salary work' : 'Unconfigured / review' : money(line.earnedPesewas)}<small>{line.reason}</small></td></tr>)}</tbody></table></div> : <p className="worker-empty">No completion-time earnings in this period.</p>}
      <h3>Record worker payout</h3><form className="worker-form-grid" onSubmit={event => { event.preventDefault(); void change(async () => {
        const input = { workerId: detail.worker.id, amountPesewas: units(amount), paymentDate, method: paymentMethod, reference, note };
        const fingerprint = JSON.stringify(input); if (payout.current?.fingerprint !== fingerprint) payout.current = { fingerprint, key: crypto.randomUUID() };
        await window.appApi.recordWorkerPayout({ ...input, requestKey: payout.current.key }); setAmount(''); setReference(''); setNote(''); payout.current = null;
      }, 'Worker payout recorded.'); }}>
        <label className="field">Amount (GHS)<input required type="number" min="0.01" step="0.01" max={decimal(detail.account.outstandingPesewas)} value={amount} disabled={locked || detail.account.payoutBlocked} onChange={event => setAmount(event.target.value)} /></label><label className="field">Payment date<input required type="date" max={new Date().toISOString().slice(0, 10)} value={paymentDate} disabled={locked} onChange={event => setPaymentDate(event.target.value)} /></label><label className="field">Method<select value={paymentMethod} disabled={locked} onChange={event => setPaymentMethod(event.target.value as typeof paymentMethod)}>{['cash', 'card', 'mobile_money', 'bank_transfer', 'other'].map(item => <option key={item} value={item}>{item.replace('_', ' ')}</option>)}</select></label><label className="field">Reference (optional)<input maxLength={120} value={reference} disabled={locked} onChange={event => setReference(event.target.value)} /></label><label className="field">Note (optional)<input maxLength={500} value={note} disabled={locked} onChange={event => setNote(event.target.value)} /></label><button className="primary-button" disabled={locked || detail.account.payoutBlocked || detail.account.outstandingPesewas === 0}>Record payout</button>
      </form>
      <h3>Payment history</h3>{detail.payments.length ? <div className="table-scroll"><table><thead><tr><th>Date</th><th>Amount</th><th>Method / reference</th><th>Note</th></tr></thead><tbody>{detail.payments.map(payment => <tr key={payment.id}><th scope="row">{payment.paidAt.slice(0, 10)}</th><td>{payment.amountPesewas == null ? `${payment.amount.toFixed(2)} (legacy amount; currency unverified)` : money(payment.amountPesewas)}</td><td>{payment.legacy ? 'Historical payment · allocation unverified' : payment.method?.replace('_', ' ')}<small>{payment.reference}</small></td><td>{payment.notes ?? '—'}</td></tr>)}</tbody></table></div> : <p className="worker-empty">No worker payments in this period.</p>}
      <div className="worker-pagination"><span>Service and payment history · 50 records per page</span><button className="secondary-button" disabled={locked || detailOffset === 0} onClick={() => setDetailOffset(detailOffset - 50)}>Previous</button><button className="secondary-button" disabled={locked || detailOffset + 50 >= Math.max(detail.period.completedServices, detail.paymentCount)} onClick={() => setDetailOffset(detailOffset + 50)}>Next</button></div>
    </section>}
  </div>;
}
