import { useCallback, useEffect, useRef, useState } from 'react';
import { ClipboardList, Plus, Search, X, Wallet } from 'lucide-react';
import type { ServiceCatalog, Visit, VisitList, VisitStatus } from '../app-api';
import VisitForm, { ghs } from './VisitForm';
import './VisitsPage.css';

type PaymentMethod = Parameters<Window['appApi']['recordVisitPayment']>[0]['method'];
const visitMoney = (pesewas: number, currency: string) => {
  try { return new Intl.NumberFormat('en-GH',{ style:'currency',currency,currencyDisplay:'code' }).format(pesewas/100); }
  catch { return `${currency} ${(pesewas/100).toFixed(2)}`; }
};
export default function VisitsPage({ refreshKey, onChanged, onActivity, onSignedOut }: {
  refreshKey: number; onChanged: () => Promise<void>; onActivity: () => void; onSignedOut: (notice?: string) => void;
}) {
  const [list, setList] = useState<VisitList | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | VisitStatus>('all');
  const [paymentFilter, setPaymentFilter] = useState<'all' | 'unpaid' | 'partial' | 'paid'>('all');
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [cancelConfirmation, setCancelConfirmation] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [creating, setCreating] = useState(false);
  const [catalog, setCatalog] = useState<ServiceCatalog | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Visit | null>(null);
  const [detailError, setDetailError] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0,16));
  const [reference, setReference] = useState('');
  const [paymentKey, setPaymentKey] = useState(() => crypto.randomUUID());
  const [retryPayment, setRetryPayment] = useState<Parameters<Window['appApi']['recordVisitPayment']>[0] | null>(null);
  const alive = useRef(true);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const failure = useCallback((reason: unknown) => {
    const message = reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : 'Unable to complete the request. Please try again.';
    if (message.includes('SESSION_EXPIRED')) onSignedOut('Your session ended. Please sign in again.');
    return message;
  }, [onSignedOut]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    const timer = setTimeout(() => { window.appApi.getVisits({ search,status,paymentStatus: paymentFilter,offset }).then(next => {
      if (!active) return; onActivity();
      if (offset>0 && offset>=next.total) { setOffset(Math.max(0,Math.floor((next.total-1)/next.limit)*next.limit)); return; }
      setList(next);
    }).catch(reason => { if (active) { setList(null); setError(failure(reason)); } }).finally(() => { if (active) setLoading(false); }); },250);
    return () => { active = false; clearTimeout(timer); };
  }, [search,status,paymentFilter,offset,revision,refreshKey,onActivity,failure]);
  useEffect(() => {
    let active = true;
    if (!creating) return;
    setCatalog(null);
    window.appApi.getServices().then(next => { if (active) { setCatalog(next); onActivity(); } }).catch(reason => { if (active) setError(failure(reason)); });
    return () => { active = false; };
  }, [creating,refreshKey,revision,onActivity,failure]);
  useEffect(() => {
    let active = true;
    if (selectedId === null) { setDetail(null); return; }
    setDetailError('');
    window.appApi.getVisit({ id: selectedId }).then(next => { if (active) { setDetail(next); onActivity(); } }).catch(reason => { if (active) setDetailError(failure(reason)); });
    return () => { active = false; };
  }, [selectedId,revision,refreshKey,onActivity,failure]);
  useEffect(() => { if (detail) detailHeading.current?.focus(); }, [selectedId,!!detail]);
  function resetPayment() { setPaymentKey(crypto.randomUUID()); setRetryPayment(null); }
  function openVisit(id: number) { setCancelConfirmation(false); setSelectedId(id); setDetail(null); setAmount(''); setReference(''); setPaidAt(new Date().toISOString().slice(0,16)); resetPayment(); setCreating(false); }
  function closeDetail() { setSelectedId(null); setDetail(null); addButton.current?.focus(); }
  function saved(visit: Visit) { setCreating(false); setSelectedId(visit.id); setDetail(visit); setAmount(''); setReference(''); resetPayment(); setNotice(`Visit saved as waiting: ${visit.number}`); setRevision(value => value+1); void onChanged(); }
  async function changeStatus(next: VisitStatus) {
    if (!detail || busy) return;
    setBusy(true); setDetailError(''); setNotice('');
    try { const updated = await window.appApi.setVisitStatus({ id: detail.id,status: next }); if (alive.current) { setCancelConfirmation(false); setDetail(updated); onActivity(); setNotice(`Visit is now ${next.replace('_',' ')}. Payment records are unchanged.`); setRevision(value=>value+1); await onChanged(); } }
    catch (reason) { if (alive.current) setDetailError(failure(reason)); }
    finally { if (alive.current) setBusy(false); }
  }
  async function pay() {
    if (!detail || busy) return;
    setDetailError('');
    if (!/^\d+(?:\.\d{1,2})?$/.test(amount)) { setDetailError('Enter a positive GHS amount with at most two decimal places.'); return; }
    const [whole,fraction=''] = amount.split('.');
    const amountPesewas = Number(whole)*100 + Number(fraction.padEnd(2,'0'));
    if (!Number.isSafeInteger(amountPesewas) || amountPesewas<=0) { setDetailError('Enter a valid payment amount.'); return; }
    const payload = retryPayment ?? { id: detail.id,amountPesewas,method,paidAt: `${paidAt}:00.000Z`,reference,requestKey: paymentKey };
    setRetryPayment(payload); setBusy(true); setNotice('');
    try { const updated = await window.appApi.recordVisitPayment(payload); if (alive.current) { setDetail(updated); onActivity(); setAmount(''); setReference(''); resetPayment(); setNotice(`Payment recorded. Outstanding: ${ghs(updated.outstandingPesewas)}.`); setRevision(value=>value+1); await onChanged(); } }
    catch (reason) { if (alive.current) setDetailError(failure(reason)); }
    finally { if (alive.current) setBusy(false); }
  }
  const canChange = detail?.status === 'waiting' || detail?.status === 'in_progress';
  return <div className="visits-page"><div className="workers-intro"><div><h2>Customer visits</h2><p>Manage arrival, service work and payments independently.</p></div><button ref={addButton} className="primary-button" disabled={busy} onClick={() => { setCreating(true); closeDetail(); setNotice(''); }}><Plus size={17} aria-hidden="true" /> New Visit</button></div>
    {notice && <div className="worker-notice" role="status">{notice}</div>}{error && <div className="error-banner" role="alert">{error}<button className="text-button" onClick={() => setRevision(value=>value+1)}>Try again</button></div>}
    {creating && (catalog ? <VisitForm catalog={catalog} onSaved={saved} onClose={() => { setCreating(false); addButton.current?.focus(); }} onActivity={onActivity} onError={failure} /> : <div className="dashboard-panel worker-empty" role="status">Loading services, prices and active workers…</div>)}
    {selectedId !== null && <section className="dashboard-panel visit-detail" aria-labelledby="visit-detail-heading"><div className="panel-heading"><div><h2 id="visit-detail-heading" ref={detailHeading} tabIndex={-1}>Visit details</h2>{detail && <p>{detail.number}{detail.company && ` | ${detail.company.name} | Due: ${detail.company.dueDate ?? 'Not configured'}`}</p>}</div><button className="secondary-button" disabled={busy} aria-label="Close visit details" onClick={closeDetail}><X size={17} aria-hidden="true" /></button></div>
      {detailError && <div className="error-banner" role="alert">{detailError}<button className="text-button" disabled={busy} onClick={() => setRevision(value=>value+1)}>Refresh visit</button></div>}
      {!detail ? <p role="status">Loading visit…</p> : <><div className="visit-details-grid"><div><span>Vehicle / service</span><strong>{detail.registrationNumber ?? 'Non-vehicle / unlinked service'}</strong><p>{detail.customerName ?? 'No customer name recorded'}{detail.customerPhone && ` · ${detail.customerPhone}`}</p></div><div><span>Work status</span><strong>{detail.status.replace('_',' ')}</strong><p>Arrival: {detail.arrivalAt.replace('T',' ').slice(0,16)} · Ghana time</p></div></div>
        <div className="visit-money-grid"><div><span>Charge</span><strong>{visitMoney(detail.totalPesewas,detail.currency)}</strong></div><div><span>Paid</span><strong>{visitMoney(detail.paidPesewas,detail.currency)}</strong></div><div><span>Outstanding</span><strong>{visitMoney(detail.outstandingPesewas,detail.currency)}</strong></div></div>
        <div className="table-scroll"><table><caption>Recorded services and worker assignments ? confirmed earnings are shown in Worker Earnings</caption><thead><tr><th>Service</th><th>Worker</th><th>Service price</th><th>Assignment-time estimate</th></tr></thead><tbody>{detail.lines.map((line,index) => <tr key={index}><th scope="row">{line.serviceName}</th><td>{line.workerAssignment?.workerName ?? 'Unassigned'}</td><td>{visitMoney(Math.round(line.lineTotal*100),detail.currency)}</td><td>{line.workerAssignment?.earnings == null ? 'Not configured' : visitMoney(Math.round(line.workerAssignment.earnings*100),detail.currency)}</td></tr>)}</tbody></table></div>
        {canChange && <div className="visit-status-actions"><span>Update work status</span>{detail.status === 'waiting' && <button className="secondary-button" disabled={busy} onClick={() => void changeStatus('in_progress')}>Start work</button>}<button className="primary-button" disabled={busy} onClick={() => void changeStatus('completed')}>Mark completed</button><button className="secondary-button" disabled={busy} onClick={() => setCancelConfirmation(true)}>Cancel visit</button></div>}
        {canChange && cancelConfirmation && <div className="worker-notice" role="alert"><strong>Cancel this visit?</strong><p>This ends the visit and removes its collectible balance. Recorded payments remain in history; no refund is issued.</p><button className="secondary-button" disabled={busy} onClick={() => setCancelConfirmation(false)}>Keep visit</button> <button className="primary-button" disabled={busy} onClick={() => void changeStatus('cancelled')}>Confirm cancellation</button></div>}
        {detail.status === 'cancelled' && <p className="field-hint">Cancelled work has no collectible outstanding balance. Existing payments remain recorded; cancellation does not issue a refund.</p>}
        {detail.status !== 'cancelled' && detail.outstandingPesewas > 0 && detail.currency === 'GHS' && <form className="visit-payment-form" onSubmit={event => { event.preventDefault(); void pay(); }} onChange={resetPayment}><fieldset disabled={busy}><h3><Wallet size={18} aria-hidden="true" /> Record payment</h3><p>Payment does not complete the visit. Record only money actually received.</p><div className="worker-form-grid"><div className="field"><label htmlFor="visit-payment-amount">Amount received (GHS) *</label><input id="visit-payment-amount" required type="number" min="0.01" step="0.01" max={detail.outstandingPesewas/100} value={amount} onChange={event=>setAmount(event.target.value)} /><button type="button" className="text-button" onClick={() => { setAmount((detail.outstandingPesewas/100).toFixed(2)); resetPayment(); }}>Use full outstanding balance</button></div><div className="field"><label htmlFor="visit-payment-method">Method *</label><select id="visit-payment-method" value={method} onChange={event=>setMethod(event.target.value as PaymentMethod)}><option value="cash">Cash</option><option value="mobile_money">Mobile money</option><option value="card">Card</option><option value="bank_transfer">Bank transfer</option><option value="other">Other</option></select></div><div className="field"><label htmlFor="visit-payment-date">Payment date (Ghana time) *</label><input id="visit-payment-date" required type="datetime-local" value={paidAt} onChange={event=>setPaidAt(event.target.value)} /></div><div className="field"><label htmlFor="visit-payment-reference">Reference (optional)</label><input id="visit-payment-reference" maxLength={120} value={reference} onChange={event=>setReference(event.target.value)} /></div></div><button className="primary-button">{busy ? 'Recording…' : 'Record received payment'}</button></fieldset></form>}
        <div className="table-scroll"><table><caption>Payment history</caption><thead><tr><th>Date (Ghana time)</th><th>Method / reference</th><th>Status</th><th>Amount</th></tr></thead><tbody>{detail.payments.map(payment => <tr key={payment.id}><td>{payment.paidAt.replace('T',' ').slice(0,16)}</td><td>{payment.method.replace('_',' ')}<small>{payment.reference}</small></td><td>{payment.status}</td><td>{visitMoney(payment.amountPesewas,detail.currency)}</td></tr>)}</tbody></table>{!detail.payments.length && <p className="visit-no-history">No payments recorded. This visit is {detail.totalPesewas ? 'unpaid' : 'free of charge'}.</p>}</div>
        <div className="visit-history"><h3>Status history</h3>{detail.history.length ? <ol>{detail.history.map(event=><li key={event.id}>{event.changedAt.replace('T',' ').slice(0,16)} · {event.fromStatus ? `${event.fromStatus.replace('_',' ')} → ` : ''}{event.toStatus.replace('_',' ')}</li>)}</ol> : <p>Detailed status history was not recorded for this legacy visit.</p>}{detail.legacy === 1 && <p>Legacy record: original amounts and assignments are retained. Historical timestamps that were never recorded remain unavailable.</p>}</div>
      </>}
    </section>}
    <section className="dashboard-panel"><div className="panel-heading"><div><h2>Visit history</h2><p>Recorded work and payment balances from your business database.</p></div></div><div className="worker-toolbar"><label className="worker-search"><span className="sr-only">Search visit number, plate, customer, service or worker</span><Search size={17} aria-hidden="true" /><input type="search" maxLength={120} value={search} placeholder="Search plate, visit, customer, service or worker" onChange={event=>{ setSearch(event.target.value); setOffset(0); }} /></label><label className="worker-filter">Work status<select value={status} onChange={event=>{ setStatus(event.target.value as typeof status); setOffset(0); }}><option value="all">All visits</option><option value="waiting">Waiting</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></label><label className="worker-filter">Payment<select value={paymentFilter} onChange={event=>{ setPaymentFilter(event.target.value as typeof paymentFilter); setOffset(0); }}><option value="all">All payments</option><option value="unpaid">Unpaid</option><option value="partial">Partial</option><option value="paid">Paid</option></select></label></div>
      {loading ? <div className="worker-empty" role="status"><span className="spinner" /> Loading visits…</div> : list?.visits.length ? <div className="table-scroll"><table><caption className="sr-only">Customer visits with work status and payment balances</caption><thead><tr><th>Visit / arrival</th><th>Vehicle / customer</th><th>Work status</th><th>Payment</th><th>Charge</th><th>Outstanding</th><th>Actions</th></tr></thead><tbody>{list.visits.map(visit=><tr key={visit.id}><th scope="row"><span className="visit-number">{visit.number}</span><small>{visit.arrivalAt.replace('T',' ').slice(0,16)}</small></th><td>{visit.registrationNumber ?? 'Non-vehicle / unlinked'}<small>{visit.customerName ?? 'No customer name'}</small></td><td><span className={`wash-status status-${visit.status === 'waiting' ? 'pending' : visit.status}`}>{visit.status.replace('_',' ')}</span></td><td>{visit.paymentStatus}</td><td>{visit.currency} {(visit.totalPesewas/100).toFixed(2)}</td><td>{visit.currency} {(visit.outstandingPesewas/100).toFixed(2)}</td><td><button className="secondary-button" disabled={busy} onClick={()=>openVisit(visit.id)}>View / manage</button></td></tr>)}</tbody></table></div> : <div className="worker-empty"><ClipboardList size={30} aria-hidden="true" /><h3>{search || status !== 'all' || paymentFilter !== 'all' ? 'No matching visits' : 'Ready for your first visit'}</h3><p>{search || status !== 'all' || paymentFilter !== 'all' ? 'Try another search or filter.' : 'Record an arriving vehicle or an independent service when a customer comes in.'}</p></div>}
      {list && !loading && list.total>0 && <div className="worker-pagination"><span>{offset+1}–{offset+list.visits.length} of {list.total} visits</span><button className="secondary-button" disabled={!offset || busy} onClick={()=>setOffset(value=>Math.max(0,value-list.limit))}>Previous</button><button className="secondary-button" disabled={offset+list.limit>=list.total || busy} onClick={()=>setOffset(value=>value+list.limit)}>Next</button></div>}
    </section>
  </div>;
}
