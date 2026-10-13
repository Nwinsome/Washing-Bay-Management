import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Search } from 'lucide-react';
import type { Company, ServiceCatalog, Vehicle, VehicleDetails, Visit, VisitQuote, VisitSelection } from '../app-api';
import CategorySelect from './CategorySelect';

export const ghs = (pesewas: number) => new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS', currencyDisplay: 'code' }).format(pesewas / 100);
export default function VisitForm({ catalog, onSaved, onClose, onActivity, onError }: {
  catalog: ServiceCatalog; onSaved: (visit: Visit) => void; onClose: () => void; onActivity: () => void; onError: (reason: unknown) => string;
}) {
  const [companyOptions,setCompanyOptions]=useState<Company[]>([]);
  const [companyId,setCompanyId]=useState('vehicle');
  const [dueDate,setDueDate]=useState('');
  useEffect(()=>{let active=true;window.appApi.getCompanyOptions().then(r=>{if(active)setCompanyOptions(r.companies);}).catch(e=>{if(active)setError(onError(e));});return()=>{active=false;};},[onError]);
  const [mode, setMode] = useState<'vehicle' | 'non_vehicle'>('vehicle');
  const [register, setRegister] = useState(false);
  const [plate, setPlate] = useState('');
  const [matches, setMatches] = useState<Vehicle[]>([]);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [newVehicle, setNewVehicle] = useState<VehicleDetails>({ registrationNumber: '', vehicleTypeId: 0, make: '', model: '', color: '', customerName: '', customerPhone: '' });
  const [primary, setPrimary] = useState('');
  const [additional, setAdditional] = useState<number[]>([]);
  const [workers, setWorkers] = useState<Record<number,string>>({});
  const [arrival, setArrival] = useState(new Date().toISOString().slice(0,16));
  const [quote, setQuote] = useState<VisitQuote | null>(null);
  const [pricing, setPricing] = useState(false);
  const [priceRevision, setPriceRevision] = useState(0);
  const [error, setError] = useState('');
  const [lookupError, setLookupError] = useState('');
  const [busy, setBusy] = useState(false);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [retryInput, setRetryInput] = useState<Parameters<Window['appApi']['createVisit']>[0] | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; heading.current?.focus(); return () => { alive.current = false; }; }, []);
  const vehicleServices = catalog.services.filter(service => service.isActive && service.role==='main');
  const independent = catalog.services.filter(service => service.isActive && service.role!=='main' && (mode==='vehicle' || service.role==='independent'));
  const selection = useMemo<VisitSelection>(() => {
    const serviceIds = [...(mode === 'vehicle' && primary ? [Number(primary)] : []), ...additional];
    return { mode, companyId: companyId==='vehicle'?undefined:companyId===''?null:Number(companyId), dueDate:dueDate||undefined, vehicleId: mode === 'vehicle' && !register ? vehicle?.id ?? null : null,
      newVehicle: mode === 'vehicle' && register ? newVehicle : null,
      vehicleTypeId: mode === 'vehicle' ? register ? newVehicle.vehicleTypeId : vehicle?.vehicleTypeId ?? null : null,
      serviceIds, assignments: serviceIds.filter(id => workers[id]).map(serviceId => ({ serviceId, workerId: Number(workers[serviceId]) })) };
  }, [mode,register,vehicle,newVehicle,primary,additional,workers,companyId,dueDate]);
  useEffect(() => {
    let active = true; setMatches([]); setLookupError('');
    if (mode !== 'vehicle' || register || !plate.trim() || vehicle) return;
    const timer = setTimeout(() => { window.appApi.lookupVehicle({ registrationNumber: plate }).then(result => {
      if (active) { setMatches(result.vehicles); onActivity(); }
    }).catch(reason => { if (active) setLookupError(onError(reason)); }); },350);
    return () => { active = false; clearTimeout(timer); };
  }, [plate,mode,register,vehicle,onActivity,onError]);
  useEffect(() => {
    let active = true; setQuote(null); setError('');
    if (!selection.serviceIds.length || (mode === 'vehicle' && !register && !vehicle)) { setPricing(false); return; }
    setPricing(true);
    const timer = setTimeout(() => { window.appApi.quoteVisit(selection).then(next => {
      if (active) { setQuote(next); onActivity(); }
    }).catch(reason => { if (active) setError(onError(reason)); }).finally(() => { if (active) setPricing(false); }); },250);
    return () => { active = false; clearTimeout(timer); };
  }, [selection,mode,register,vehicle,onActivity,onError,priceRevision]);
  function resetSubmission() { setRetryInput(null); setRequestKey(crypto.randomUUID()); }
  async function save() {
    if ((!quote && !retryInput) || busy) return;
    setBusy(true); setError('');
    const payload = retryInput ?? { ...selection, arrivalAt: `${arrival}:00.000Z`, expectedCompanyId: quote!.company?.id ?? null, expectedTotalPesewas: quote!.totalPesewas, expectedLines: quote!.lines, requestKey };
    setRetryInput(payload);
    try { const result = await window.appApi.createVisit(payload); if (alive.current) { onActivity(); onSaved(result); } }
    catch (reason) { if (alive.current) setError(onError(reason)); }
    finally { if (alive.current) setBusy(false); }
  }
  const missingWorker = selection.serviceIds.some(id => catalog.services.find(service => service.id === id)?.kind !== 'carpet_cleaning' && !workers[id]);
  function availablePrice(service:ServiceCatalog['services'][number]) {
    if(service.role!=='independent' && !selection.vehicleTypeId) return { available:false,label:'Choose a vehicle category first' };
    const option=catalog.categoryOptions.find(row=>row.serviceId===service.id && row.vehicleTypeId===selection.vehicleTypeId);
    if(option?.status==='unavailable') return { available:false,label:'Unavailable for this category' };
    if(option?.status==='unconfigured') return { available:false,label:'Price not configured' };
    const configured=catalog.prices.find(row=>row.serviceId===service.id && row.vehicleTypeId===selection.vehicleTypeId)
      ?? (service.role==='independent' ? catalog.prices.find(row=>row.serviceId===service.id && row.vehicleTypeId===null) : undefined);
    return configured ? { available:true,label:ghs(Math.round(configured.price*100)) } : { available:false,label:'Price not configured' };
  }
  return <section className="dashboard-panel worker-editor visit-editor" aria-labelledby="new-visit-heading"><div className="panel-heading"><div><h2 id="new-visit-heading" tabIndex={-1} ref={heading}>New customer visit</h2><p>Save arrival and services first. Completion and payment are managed separately.</p></div><button className="secondary-button" disabled={busy} aria-label="Close visit form" onClick={onClose}><X size={17} aria-hidden="true" /></button></div>
    <form onSubmit={event => { event.preventDefault(); void save(); }} onChange={resetSubmission}><fieldset disabled={busy}>
      {error && <div className="error-banner" role="alert">{error}<button type="button" className="text-button" onClick={() => { resetSubmission(); setPriceRevision(value => value + 1); }}>Review updated price</button></div>}
      <fieldset className="visit-choice"><legend>Visit type</legend><label><input type="radio" name="visit-mode" checked={mode === 'vehicle'} onChange={() => { setMode('vehicle'); setAdditional([]); }} /> Vehicle visit</label><label><input type="radio" name="visit-mode" checked={mode === 'non_vehicle'} onChange={() => { setMode('non_vehicle'); setPrimary(''); setAdditional([]); }} /> Carpet cleaning / non-vehicle service</label></fieldset>
      {mode === 'vehicle' && <><fieldset className="visit-choice"><legend>Vehicle</legend><label><input type="radio" name="vehicle-source" checked={!register} onChange={() => setRegister(false)} /> Existing vehicle</label><label><input type="radio" name="vehicle-source" checked={register} onChange={() => setRegister(true)} /> Register a new vehicle with this visit</label></fieldset>
        {!register ? <div className="field"><label htmlFor="visit-plate">Find number plate</label><div className="visit-plate-search"><Search size={17} aria-hidden="true" /><input id="visit-plate" maxLength={32} value={plate} onChange={event => { setPlate(event.target.value); setVehicle(null); }} /></div>{lookupError && <p role="alert" className="field-error">{lookupError}</p>}{!vehicle && matches.map(match => <div className="visit-vehicle-match" key={match.id}><span>{match.registrationNumber} · {match.vehicleTypeName ?? 'No vehicle type'} · {match.isActive ? 'Active' : 'Archived'}</span><button type="button" className="secondary-button" disabled={!match.isActive || match.vehicleTypeId === null} onClick={() => { setVehicle(match); resetSubmission(); }}>Select vehicle</button></div>)}{vehicle && <p className="worker-notice">Selected: {vehicle.registrationNumber} · {vehicle.vehicleTypeName}</p>}{!vehicle && plate && !matches.length && !lookupError && <p className="field-hint">Enter the full plate to find an existing vehicle, or choose registration above.</p>}</div> : <div className="worker-form-grid">
          <div className="field"><label htmlFor="visit-new-plate">Number plate *</label><input id="visit-new-plate" required maxLength={32} value={newVehicle.registrationNumber} onChange={event => setNewVehicle(current => ({ ...current, registrationNumber: event.target.value }))} /></div>
          <div className="field"><label htmlFor="visit-new-type">Vehicle category *</label><CategorySelect id="visit-new-type" required categories={catalog.vehicleTypes} value={newVehicle.vehicleTypeId || null} onChange={value=>setNewVehicle(current=>({ ...current,vehicleTypeId:value ?? 0 }))} /></div>
          {(['make','model','color','customerName','customerPhone'] as const).map(field => <div className="field" key={field}><label htmlFor={`visit-new-${field}`}>{({ make: 'Make', model: 'Model', color: 'Colour', customerName: 'Customer name', customerPhone: 'Customer phone' })[field]} <span className="optional">Optional</span></label><input id={`visit-new-${field}`} type={field === 'customerPhone' ? 'tel' : 'text'} maxLength={field === 'customerPhone' ? 40 : field === 'customerName' ? 120 : field === 'color' ? 60 : 80} value={newVehicle[field] ?? ''} onChange={event => setNewVehicle(current => ({ ...current, [field]: event.target.value }))} /></div>)}
        </div>}
        {!register && vehicle && <div className="field"><label htmlFor="visit-existing-type">Vehicle type</label><select id="visit-existing-type" value={vehicle.vehicleTypeId ?? ''} disabled><option value={vehicle.vehicleTypeId ?? ''}>{vehicle.vehicleTypeName ?? 'Select type in Vehicles first'}</option></select><p className="field-hint">Uses the registered type. Update vehicle details on the Vehicles page if needed.</p></div>}
        <fieldset className="visit-choice"><legend>Choose exactly one main service: Wash or Blow *</legend>{vehicleServices.map(service => <label key={service.id}><input type="radio" required name="visit-primary" disabled={!availablePrice(service).available} value={service.id} checked={primary === String(service.id)} onChange={() => setPrimary(String(service.id))} />{service.name} · {availablePrice(service).label}</label>)}</fieldset>{!vehicleServices.length && <p className="field-error">Configure a Wash or Blow service in Services and Pricing first.</p>}
      </>}
      <fieldset className="visit-choice"><legend>{mode === 'vehicle' ? 'Optional extras and independent services' : 'Select the independent service'}</legend>{independent.map(service => <label key={service.id}><input type="checkbox" disabled={!availablePrice(service).available && !additional.includes(service.id)} checked={additional.includes(service.id)} onChange={event => setAdditional(event.target.checked ? [...additional,service.id] : additional.filter(id => id !== service.id))} />{service.name}{service.role==='vehicle_extra' ? ' (vehicle extra)' : ' (independent)'} · {availablePrice(service).label}</label>)}</fieldset>
      <div className="worker-form-grid">{selection.serviceIds.map(id => <div className="field" key={id}><label htmlFor={`visit-worker-${id}`}>Worker for {catalog.services.find(service => service.id === id)?.name}{catalog.services.find(service => service.id === id)?.kind === 'carpet_cleaning' ? ' (where applicable)' : ' *'}</label><select id={`visit-worker-${id}`} required={catalog.services.find(service => service.id === id)?.kind !== 'carpet_cleaning'} value={workers[id] ?? ''} onChange={event => setWorkers(current => ({ ...current,[id]: event.target.value }))}><option value="">Select active worker</option>{catalog.workers.map(worker => <option key={worker.id} value={worker.id}>{worker.name}</option>)}</select></div>)}</div>
      <div className="worker-form-grid"><div className="field"><label htmlFor="visit-company">Company account</label><select id="visit-company" value={companyId} onChange={e=>setCompanyId(e.target.value)}><option value="vehicle">Use vehicle's company assignment, if present</option><option value="">Individual customer / no company</option>{companyOptions.map(c=><option key={c.id} value={c.id} disabled={!c.is_active}>{c.name} | {c.credit_enabled?'Credit approved':'Credit disabled'}{!c.is_active?' | Inactive':''}</option>)}</select><p className="field-hint">Company visits require approved credit because saving a visit records no payment.</p></div><div className="field"><label htmlFor="visit-company-due">Company due date (optional)</label><input id="visit-company-due" type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)} /><p className="field-hint">Leave blank to use configured terms, if present.</p></div></div>
      <div className="field"><label htmlFor="visit-arrival">Arrival time (Ghana time) *</label><input id="visit-arrival" required type="datetime-local" value={arrival} onChange={event => setArrival(event.target.value)} /></div>
      <div className="visit-price" aria-live="polite">{pricing ? <span>Checking configured prices…</span> : quote ? <><ul>{quote.lines.map(line => <li key={line.serviceId}>{line.serviceName}<strong>{ghs(Math.round(line.unitPrice*100))}</strong></li>)}</ul><div><span>Total charge</span><strong>{ghs(quote.totalPesewas)}</strong></div><p>No payment will be recorded when saving this visit.</p>{quote.company && <p>Company charge: {quote.company.name}. Credit eligibility and limit are checked again when saving.</p>}</> : <p>Select the vehicle and services to see the configured price.</p>}</div>
      <div className="worker-form-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={!quote || pricing || missingWorker || (mode === 'vehicle' && !primary)}>{busy ? 'Saving…' : 'Save waiting visit'}</button></div>
    </fieldset></form>
  </section>;
}
