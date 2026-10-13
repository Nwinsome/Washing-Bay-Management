import { useCallback, useEffect, useRef, useState } from 'react';
import { Car, Plus, Search, Pencil, Archive, RotateCcw, X } from 'lucide-react';
import type { Vehicle, VehicleDetails, VehiclesData } from '../app-api';
import './VehiclesPage.css';
import CategorySelect from './CategorySelect';

const blank: VehicleDetails = { registrationNumber: '', vehicleTypeId: 0, make: '', model: '', color: '', customerName: '', customerPhone: '' };
export default function VehiclesPage({ refreshKey, onChanged, onActivity, onSignedOut }: {
  refreshKey: number; onChanged: () => Promise<void>; onActivity: () => void; onSignedOut: (notice?: string) => void;
}) {
  const [data, setData] = useState<VehiclesData | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'archived'>('all');
  const [typeFilter, setTypeFilter] = useState('');
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [editor, setEditor] = useState<'new' | Vehicle | null>(null);
  const [form, setForm] = useState<VehicleDetails>({ ...blank });
  const [matches, setMatches] = useState<Vehicle[]>([]);
  const [checkingPlate, setCheckingPlate] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const [typeName, setTypeName] = useState('');
  const alive = useRef(true);
  const heading = useRef<HTMLHeadingElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const failure = useCallback((reason: unknown) => {
    const message = reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : 'Unable to complete the request. Please try again.';
    if (message.includes('SESSION_EXPIRED')) onSignedOut('Your session ended. Please sign in again.');
    return message;
  }, [onSignedOut]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    const timer = setTimeout(() => {
      window.appApi.getVehicles({ search, status, vehicleTypeId: typeFilter ? Number(typeFilter) : null, offset }).then(next => {
        if (!active) return;
        onActivity();
        if (offset > 0 && offset >= next.total) { setOffset(Math.max(0, Math.floor((next.total - 1) / next.limit) * next.limit)); return; }
        setData(next);
      }).catch(reason => { if (active) setError(failure(reason)); }).finally(() => { if (active) setLoading(false); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [search, status, typeFilter, offset, revision, refreshKey, failure, onActivity]);
  useEffect(() => { if (editor) heading.current?.focus(); }, [editor]);
  useEffect(() => {
    let active = true;
    setMatches([]); setLookupError('');
    if (!editor || !form.registrationNumber.trim()) { setCheckingPlate(false); return; }
    setCheckingPlate(true);
    const timer = setTimeout(() => {
      window.appApi.lookupVehicle({ registrationNumber: form.registrationNumber }).then(result => {
        if (active) { setMatches(result.vehicles.filter(vehicle => editor === 'new' || vehicle.id !== editor.id)); onActivity(); }
      }).catch(reason => { if (active) setLookupError(failure(reason)); }).finally(() => { if (active) setCheckingPlate(false); });
    }, 350);
    return () => { active = false; clearTimeout(timer); };
  }, [form.registrationNumber, editor, failure, onActivity, revision]);
  function open(vehicle?: Vehicle) {
    setEditor(vehicle ?? 'new'); setFormError(''); setNotice(''); setMatches([]);
    setForm(vehicle ? { registrationNumber: vehicle.registrationNumber, vehicleTypeId: vehicle.vehicleTypeId ?? 0,
      make: vehicle.make ?? '', model: vehicle.model ?? '', color: vehicle.color ?? '', customerName: vehicle.customerName ?? '', customerPhone: vehicle.customerPhone ?? '' } : { ...blank });
  }
  function close() { setEditor(null); setFormError(''); addButton.current?.focus(); }
  async function save() {
    if (!editor || busy) return;
    setBusy(true); setFormError(''); setNotice('');
    try {
      const saved = editor === 'new' ? await window.appApi.createVehicle(form) : await window.appApi.updateVehicle({ ...form, id: editor.id });
      if (!alive.current) return;
      onActivity(); setNotice(`${saved.registrationNumber} ${editor === 'new' ? 'registered' : 'updated'}.`); close(); setRevision(value => value + 1); await onChanged();
    } catch (reason) { if (alive.current) { setFormError(failure(reason)); setRevision(value => value + 1); } }
    finally { if (alive.current) setBusy(false); }
  }
  async function changeStatus(vehicle: Vehicle) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const saved = await window.appApi.setVehicleStatus({ id: vehicle.id, isActive: !vehicle.isActive });
      if (!alive.current) return;
      onActivity(); setNotice(`${saved.registrationNumber} is now ${saved.isActive ? 'active' : 'archived'}.`); setRevision(value => value + 1); await onChanged();
    } catch (reason) { if (alive.current) setError(failure(reason)); }
    finally { if (alive.current) setBusy(false); }
  }
  async function addType() {
    if (busy) return;
    setBusy(true); setFormError('');
    try {
      const added = await window.appApi.addVehicleType({ name: typeName });
      if (!alive.current) return;
      onActivity(); setForm(current => ({ ...current, vehicleTypeId: added.id })); setTypeName(''); setRevision(value => value + 1);
    } catch (reason) { if (alive.current) setFormError(failure(reason)); }
    finally { if (alive.current) setBusy(false); }
  }
  function field(key: keyof VehicleDetails, value: string) { setForm(current => ({ ...current, [key]: value })); }
  return <div className="vehicles-page">
    <div className="workers-intro"><div><h2>Your vehicle register</h2><p>Register once, recognize returning vehicles, and reuse their records for future visits.</p></div><button ref={addButton} className="primary-button" disabled={busy || !data} onClick={() => open()}><Plus size={17} aria-hidden="true" /> Add Vehicle</button></div>
    {notice && <div className="worker-notice" role="status">{notice}</div>}
    {error && <div className="error-banner" role="alert">{error}<button className="text-button" disabled={loading} onClick={() => setRevision(value => value + 1)}>Try again</button></div>}
    <div className="worker-metrics">{[{ label: 'Registered vehicles', count: data?.counts.total }, { label: 'Active vehicles', count: data?.counts.active }, { label: 'Archived vehicles', count: data?.counts.archived }].map(item => <article className="metric-card" key={item.label}><div><span>{item.label}</span><Car size={19} aria-hidden="true" /></div><strong>{item.count ?? '—'}</strong></article>)}</div>
    {editor && <section className="dashboard-panel worker-editor" aria-labelledby="vehicle-form-heading"><div className="panel-heading"><div><h2 id="vehicle-form-heading" ref={heading} tabIndex={-1}>{editor === 'new' ? 'Register a vehicle' : `Edit ${editor.registrationNumber}`}</h2><p>Customer details are optional. Registration does not create a service visit.</p></div><button className="secondary-button" disabled={busy} aria-label="Close vehicle form" onClick={close}><X size={17} aria-hidden="true" /></button></div>
      <form onSubmit={event => { event.preventDefault(); void save(); }}><fieldset disabled={busy}>
        {formError && <div className="error-banner" role="alert">{formError}</div>}
        <div className="worker-form-grid"><div className="field"><label htmlFor="vehicle-plate">Number plate <span>*</span></label><input id="vehicle-plate" required maxLength={32} value={form.registrationNumber} onChange={event => field('registrationNumber', event.target.value)} aria-describedby="plate-help" /><p className="field-hint" id="plate-help">Matching ignores letter case, spaces and hyphens.</p></div>
          <div className="field"><label htmlFor="vehicle-type">Vehicle category <span>*</span></label><CategorySelect id="vehicle-type" required value={form.vehicleTypeId || null} categories={(data?.vehicleTypes ?? []).filter(type=>type.isActive || (editor!=='new' && type.id===editor.vehicleTypeId))} onChange={value=>setForm(current=>({ ...current,vehicleTypeId:value ?? 0 }))} /></div>
          <div className="field"><label htmlFor="vehicle-color">Colour <span className="optional">Optional</span></label><input id="vehicle-color" maxLength={60} value={form.color ?? ''} onChange={event => field('color', event.target.value)} /></div>
          <div className="field"><label htmlFor="vehicle-make">Make <span className="optional">Optional</span></label><input id="vehicle-make" maxLength={80} value={form.make ?? ''} onChange={event => field('make', event.target.value)} /></div>
          <div className="field"><label htmlFor="vehicle-model">Model <span className="optional">Optional</span></label><input id="vehicle-model" maxLength={80} value={form.model ?? ''} onChange={event => field('model', event.target.value)} /></div>
          <div className="field"><label htmlFor="vehicle-customer">Customer name <span className="optional">Optional</span></label><input id="vehicle-customer" maxLength={120} value={form.customerName ?? ''} onChange={event => field('customerName', event.target.value)} /></div>
          <div className="field"><label htmlFor="vehicle-phone">Customer phone <span className="optional">Optional</span></label><input id="vehicle-phone" type="tel" maxLength={40} value={form.customerPhone ?? ''} onChange={event => field('customerPhone', event.target.value)} /></div></div>
        {checkingPlate && <p className="field-hint" role="status">Checking for a registered vehicle…</p>}{lookupError && <p className="field-error" role="alert">{lookupError}</p>}
        {matches.length > 0 && <div className="returning-vehicle" role="status"><strong>{matches.length > 1 ? 'Multiple existing records match this plate' : 'Returning vehicle identified'}</strong><p>Reuse the existing record. Archived vehicles can be activated. Registration has not created a visit.</p>{matches.map(vehicle => <div key={vehicle.id}><span>{vehicle.registrationNumber} · {vehicle.vehicleTypeName ?? 'No type'} · {vehicle.isActive ? 'Active' : 'Archived'} · {vehicle.visitCount} visits</span><button type="button" className="secondary-button" onClick={() => open(vehicle)}>Open existing record</button></div>)}</div>}
        <details className="vehicle-type-config"><summary>Add a vehicle category</summary><p>Create the categories your business uses. No categories or prices are assumed.</p><label htmlFor="new-vehicle-category" className="sr-only">New vehicle category</label><input id="new-vehicle-category" maxLength={120} value={typeName} onChange={event => setTypeName(event.target.value)} placeholder="Category name" /><button type="button" className="secondary-button" disabled={!typeName.trim()} onClick={() => void addType()}>Add category</button></details>
        <div className="worker-form-actions"><span>* Required fields</span><button type="button" className="secondary-button" onClick={close}>Cancel</button><button className="primary-button" disabled={checkingPlate || !!lookupError || matches.length > 0}>{busy ? 'Saving…' : editor === 'new' ? 'Register vehicle' : 'Save changes'}</button></div>
      </fieldset></form></section>}
    <section className="dashboard-panel"><div className="panel-heading"><div><h2>Vehicle directory</h2><p>Archive records to retain their visits and financial history.</p></div></div>
      <div className="worker-toolbar"><label className="worker-search"><span className="sr-only">Search by number plate, customer name or phone</span><Search size={17} aria-hidden="true" /><input type="search" maxLength={120} value={search} placeholder="Search plate, customer name or phone" onChange={event => { setSearch(event.target.value); setOffset(0); }} /></label><label className="worker-filter">Status<select value={status} onChange={event => { setStatus(event.target.value as typeof status); setOffset(0); }}><option value="all">All vehicles</option><option value="active">Active</option><option value="archived">Archived</option></select></label><label className="worker-filter">Type<select value={typeFilter} onChange={event => { setTypeFilter(event.target.value); setOffset(0); }}><option value="">All types</option>{data?.vehicleTypes.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label></div>
      {loading ? <div className="worker-empty" role="status"><span className="spinner" /> Loading vehicles…</div> : data?.vehicles.length ? <div className="table-scroll"><table><caption className="sr-only">Registered vehicles, customer contacts and current status</caption><thead><tr><th scope="col">Number plate / type</th><th scope="col">Vehicle details</th><th scope="col">Customer</th><th scope="col">Status / visits</th><th scope="col">Actions</th></tr></thead><tbody>{data.vehicles.map(vehicle => <tr key={vehicle.id}><th scope="row">{vehicle.registrationNumber}<small>{vehicle.vehicleTypeName ?? 'No type recorded'}</small></th><td>{[vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'No make/model'}<small>{vehicle.color || 'No colour recorded'}</small></td><td>{vehicle.customerName || 'No name recorded'}<small>{vehicle.customerPhone || 'No phone recorded'}</small></td><td><span className={`worker-status ${vehicle.isActive ? 'worker-active' : 'worker-inactive'}`}>{vehicle.isActive ? 'Active' : 'Archived'}</span><small>{vehicle.visitCount} {vehicle.visitCount === 1 ? 'visit' : 'visits'}</small></td><td><div className="worker-row-actions"><button className="secondary-button" disabled={busy} aria-label={`Edit ${vehicle.registrationNumber}`} onClick={() => open(vehicle)}><Pencil size={14} aria-hidden="true" /> Edit</button><button className="secondary-button" disabled={busy} aria-label={`${vehicle.isActive ? 'Archive' : 'Activate'} ${vehicle.registrationNumber}`} onClick={() => void changeStatus(vehicle)}>{vehicle.isActive ? <Archive size={14} aria-hidden="true" /> : <RotateCcw size={14} aria-hidden="true" />}{vehicle.isActive ? 'Archive' : 'Activate'}</button></div></td></tr>)}</tbody></table></div> : <div className="worker-empty"><Car size={30} aria-hidden="true" /><h3>{search || status !== 'all' || typeFilter ? 'No matching vehicles' : 'Start your vehicle register'}</h3><p>{search || status !== 'all' || typeFilter ? 'Try another search or filter.' : 'Add your first vehicle. Customer details can be entered later.'}</p></div>}
      {data && !loading && data.total > 0 && <div className="worker-pagination"><span>{offset + 1}–{offset + data.vehicles.length} of {data.total} vehicles</span><button className="secondary-button" disabled={offset === 0 || busy} onClick={() => setOffset(value => Math.max(0, value - data.limit))}>Previous</button><button className="secondary-button" disabled={offset + data.limit >= data.total || busy} onClick={() => setOffset(value => value + data.limit)}>Next</button></div>}
    </section><p className="overview-note">Vehicle registration and service visits are separate. Archiving preserves the vehicle record and all linked visits.</p>
  </div>;
}
