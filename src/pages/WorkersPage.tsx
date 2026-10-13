import { useCallback, useEffect, useRef, useState } from 'react';
import { Users, UserPlus, Search, Pencil, UserCheck, UserX, X } from 'lucide-react';
import type { Worker, WorkerDetails, WorkersData } from '../app-api';
import './WorkersPage.css';

const emptyForm: WorkerDetails = { fullName: '', phone: '', email: '', jobTitle: '', hireDate: '' };

export default function WorkersPage({ refreshKey, onChanged, onActivity, onSignedOut }: {
  refreshKey: number; onChanged: () => Promise<void>; onActivity: () => void; onSignedOut: (notice?: string) => void;
}) {
  const [data, setData] = useState<WorkersData | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [editor, setEditor] = useState<'new' | Worker | null>(null);
  const [form, setForm] = useState<WorkerDetails>(emptyForm);
  const alive = useRef(true);
  const formHeading = useRef<HTMLHeadingElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const failure = useCallback((reason: unknown) => {
    const message = reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : 'Unable to save. Please try again.';
    if (message.includes('SESSION_EXPIRED')) onSignedOut('Your session ended. Please sign in again.');
    return message;
  }, [onSignedOut]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    const timer = setTimeout(() => {
      window.appApi.getWorkers({ search, status, offset }).then(next => {
        if (!active) return;
        onActivity();
        if (offset > 0 && offset >= next.total) { setOffset(Math.max(0, Math.floor((next.total - 1) / next.limit) * next.limit)); return; }
        setData(next);
      }).catch(reason => { if (active) { setData(null); setError(failure(reason)); } })
        .finally(() => { if (active) setLoading(false); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [search, status, offset, revision, refreshKey, failure, onActivity]);
  useEffect(() => { if (editor) formHeading.current?.focus(); }, [editor]);
  function openEditor(worker?: Worker) {
    setEditor(worker ?? 'new'); setFormError(''); setNotice('');
    setForm(worker ? { fullName: worker.fullName, phone: worker.phone ?? '', email: worker.email ?? '', jobTitle: worker.jobTitle ?? '', hireDate: worker.hireDate ?? '' } : { ...emptyForm });
  }
  function closeEditor() { setEditor(null); setFormError(''); addButton.current?.focus(); }
  async function save() {
    if (!editor || busy) return;
    setBusy(true); setFormError(''); setNotice('');
    try {
      const saved = editor === 'new' ? await window.appApi.createWorker(form) : await window.appApi.updateWorker({ ...form, id: editor.id });
      if (!alive.current) return;
      onActivity(); setNotice(`${saved.fullName} ${editor === 'new' ? 'registered' : 'updated'} successfully.`);
      closeEditor(); setRevision(value => value + 1); await onChanged();
    } catch (reason) { if (alive.current) setFormError(failure(reason)); }
    finally { if (alive.current) setBusy(false); }
  }
  async function changeStatus(worker: Worker) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const saved = await window.appApi.setWorkerStatus({ id: worker.id, isActive: !worker.isActive });
      if (!alive.current) return;
      onActivity(); setNotice(`${saved.fullName} is now ${saved.isActive ? 'active' : 'inactive'}.`);
      setRevision(value => value + 1); await onChanged();
    } catch (reason) { if (alive.current) setError(failure(reason)); }
    finally { if (alive.current) setBusy(false); }
  }
  function field(key: keyof WorkerDetails, value: string) { setForm(current => ({ ...current, [key]: value })); }
  return <div className="workers-page">
    <div className="workers-intro"><div><h2>Your team</h2><p>Manage worker details and availability for customer visits.</p></div><button ref={addButton} className="primary-button" disabled={busy} onClick={() => openEditor()}><UserPlus size={17} aria-hidden="true" /> Register worker</button></div>
    {notice && <div className="worker-notice" role="status">{notice}</div>}
    {error && <div className="error-banner" role="alert">{error}<button className="text-button" disabled={loading} onClick={() => setRevision(value => value + 1)}>Try again</button></div>}
    <div className="worker-metrics" aria-label="Team summary">{[
      { label: 'Registered workers', value: data?.counts.total, Icon: Users },
      { label: 'Active workers', value: data?.counts.active, Icon: UserCheck },
      { label: 'Inactive workers', value: data?.counts.inactive, Icon: UserX },
    ].map(({ label, value, Icon }) => <article className="metric-card" key={label}><div><span>{label}</span><Icon size={19} aria-hidden="true" /></div><strong>{value ?? '—'}</strong></article>)}</div>
    {editor && <section className="dashboard-panel worker-editor" aria-labelledby="worker-form-heading"><div className="panel-heading"><div><h2 id="worker-form-heading" tabIndex={-1} ref={formHeading}>{editor === 'new' ? 'Register a worker' : 'Edit worker details'}</h2><p>Workers can perform any service. Job titles do not limit their assignments.</p></div><button className="secondary-button" aria-label="Close worker form" disabled={busy} onClick={closeEditor}><X size={17} aria-hidden="true" /></button></div>
      <form onSubmit={event => { event.preventDefault(); void save(); }}><fieldset disabled={busy}>
        {formError && <div className="error-banner" role="alert">{formError}</div>}
        <div className="worker-form-grid">
          <div className="field"><label htmlFor="worker-name">Full name <span>*</span></label><input id="worker-name" required maxLength={120} autoComplete="name" value={form.fullName} onChange={event => field('fullName', event.target.value)} /></div>
          <div className="field"><label htmlFor="worker-phone">Phone number <span>*</span></label><input id="worker-phone" required type="tel" maxLength={40} autoComplete="tel" aria-describedby="worker-phone-hint" value={form.phone} onChange={event => field('phone', event.target.value)} /><p className="field-hint" id="worker-phone-hint">Enter 7 to 15 digits, including country code if needed.</p></div>
          <div className="field"><label htmlFor="worker-email">Email <span className="optional">Optional</span></label><input id="worker-email" type="email" maxLength={254} autoComplete="email" value={form.email ?? ''} onChange={event => field('email', event.target.value)} /></div>
          <div className="field"><label htmlFor="worker-title">Job title <span className="optional">Optional</span></label><input id="worker-title" maxLength={120} value={form.jobTitle ?? ''} onChange={event => field('jobTitle', event.target.value)} /></div>
          <div className="field"><label htmlFor="worker-date">Hire date <span className="optional">Optional</span></label><input id="worker-date" type="date" value={form.hireDate ?? ''} onChange={event => field('hireDate', event.target.value)} /></div>
        </div><div className="worker-form-actions"><span>* Required fields</span><button type="button" className="secondary-button" onClick={closeEditor}>Cancel</button><button className="primary-button">{busy ? 'Saving…' : editor === 'new' ? 'Register worker' : 'Save changes'}</button></div>
      </fieldset></form></section>}
    <section className="dashboard-panel" aria-labelledby="worker-list-heading"><div className="panel-heading"><div><h2 id="worker-list-heading">Worker directory</h2><p>Deactivate workers to keep their historical records.</p></div></div>
      <div className="worker-toolbar"><label className="worker-search"><span className="sr-only">Search workers by name, phone, email or job title</span><Search size={17} aria-hidden="true" /><input type="search" maxLength={120} placeholder="Search name, phone, email or job title" value={search} onChange={event => { setSearch(event.target.value); setOffset(0); }} /></label><label className="worker-filter">Status<select value={status} onChange={event => { setStatus(event.target.value as typeof status); setOffset(0); }}><option value="all">All workers</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label></div>
      {loading ? <div className="worker-empty" role="status"><span className="spinner" /> Loading workers…</div> : data?.workers.length ? <div className="table-scroll"><table><caption className="sr-only">Registered workers and their current status</caption><thead><tr><th scope="col">Worker</th><th scope="col">Contact</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead><tbody>{data.workers.map(worker => <tr key={worker.id}><th scope="row"><span className="worker-name">{worker.fullName}</span><small>{worker.jobTitle || 'No job title'}{worker.hireDate && ` · Joined ${worker.hireDate}`}</small></th><td>{worker.phone || 'No phone recorded'}{worker.email && <small>{worker.email}</small>}</td><td><span className={`worker-status ${worker.isActive ? 'worker-active' : 'worker-inactive'}`}>{worker.isActive ? 'Active' : 'Inactive'}</span></td><td><div className="worker-row-actions"><button className="secondary-button" disabled={busy} aria-label={`Edit ${worker.fullName}`} onClick={() => openEditor(worker)}><Pencil size={14} aria-hidden="true" /> Edit</button><button className="secondary-button" disabled={busy} aria-label={`${worker.isActive ? 'Deactivate' : 'Activate'} ${worker.fullName}`} onClick={() => void changeStatus(worker)}>{worker.isActive ? <UserX size={14} aria-hidden="true" /> : <UserCheck size={14} aria-hidden="true" />}{worker.isActive ? 'Deactivate' : 'Activate'}</button></div></td></tr>)}</tbody></table></div> : <div className="worker-empty"><Users size={30} aria-hidden="true" /><h3>{search || status !== 'all' ? 'No matching workers' : 'Build your team'}</h3><p>{search || status !== 'all' ? 'Try another search or status filter.' : 'Register your first worker to make them available for service assignments.'}</p></div>}
      {data && !loading && data.total > 0 && <div className="worker-pagination"><span>{offset + 1}–{offset + data.workers.length} of {data.total} workers</span><button className="secondary-button" disabled={offset === 0 || busy} onClick={() => setOffset(value => Math.max(0, value - data.limit))}>Previous</button><button className="secondary-button" disabled={offset + data.limit >= data.total || busy} onClick={() => setOffset(value => value + data.limit)}>Next</button></div>}
    </section><p className="overview-note">Worker registration does not create a login account. Washing and blowing remain alternative choices for each vehicle visit; workers can perform either service across different visits.</p>
  </div>;
}
