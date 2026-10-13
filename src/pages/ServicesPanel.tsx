import { useEffect,useState } from 'react';
import type { PriceStatus,ServiceCatalog,ServiceCode,VehicleCategory } from '../app-api';
import CategorySelect from './CategorySelect';
import CategoriesPanel from './CategoriesPanel';
import './ServicesPanel.css';
export default function ServicesPanel({ money,onChanged,onSignedOut }: { money:(value:number)=>string; onChanged:()=>Promise<void>; onSignedOut:(notice?:string)=>void }) {
  const [catalog,setCatalog]=useState<ServiceCatalog|null>(null);
  const [categories,setCategories]=useState<VehicleCategory[]>([]);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const [serviceName,setServiceName]=useState('');
  const [serviceCode,setServiceCode]=useState<ServiceCode>('other');
  const [priceService,setPriceService]=useState('');
  const [priceCategory,setPriceCategory]=useState<number|null>(null);
  const [priceStatus,setPriceStatus]=useState<PriceStatus>('unconfigured');
  const [price,setPrice]=useState('');
  const [matrixSearch,setMatrixSearch]=useState('');
  const [showInactive,setShowInactive]=useState(false);
  const selectedService=catalog?.services.find(service=>service.id===Number(priceService));
  const generalAllowed=selectedService?.role==='independent';
  function failure(reason:unknown) {
    const message=reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'') : 'Unable to save. Please try again.';
    if(message.includes('SESSION_EXPIRED')) onSignedOut('Your session ended. Please sign in again.'); else setError(message);
  }
  async function load() { const [next,all]=await Promise.all([window.appApi.getServices(),window.appApi.getVehicleTypes()]); setCatalog(next); setCategories(all); }
  useEffect(()=>{ let active=true; Promise.all([window.appApi.getServices(),window.appApi.getVehicleTypes()]).then(([next,all])=>{ if(active){ setCatalog(next); setCategories(all); } }).catch(reason=>{ if(active) failure(reason); }); return()=>{ active=false; }; },[]);
  useEffect(()=>{
    const current=catalog?.prices.find(row=>row.serviceId===Number(priceService) && row.vehicleTypeId===priceCategory);
    const option=catalog?.categoryOptions.find(row=>row.serviceId===Number(priceService) && row.vehicleTypeId===priceCategory);
    setPrice(current ? String(current.price) : ''); setPriceStatus(option?.status ?? (current ? 'available' : 'unconfigured'));
  },[catalog,priceService,priceCategory]);
  async function run(action:()=>Promise<void>) { setBusy(true); setError(''); setNotice(''); try{ await action(); } catch(reason){ failure(reason); } finally{ setBusy(false); } }
  const vehicleServices=catalog?.services.filter(service=>service.isActive && service.role!=='independent') ?? [];
  const matrixCategories=categories.filter(category=>(showInactive || category.isActive) && category.name.toLowerCase().includes(matrixSearch.trim().toLowerCase()));
  function cell(serviceId:number,categoryId:number) {
    const configured=catalog?.prices.find(row=>row.serviceId===serviceId && row.vehicleTypeId===categoryId);
    const option=catalog?.categoryOptions.find(row=>row.serviceId===serviceId && row.vehicleTypeId===categoryId);
    if(option?.status==='unavailable') return 'Unavailable';
    if(option?.status==='unconfigured' || !configured) return 'Not configured';
    return money(configured.price);
  }
  const codeOptions=<><option value="washing">Wash (main)</option><option value="blowing">Blow (main)</option><option value="engine_wash">Engine Wash (extra)</option><option value="under_wash">Under Wash (extra)</option><option value="carpet_cleaning">Carpet cleaning (independent)</option><option value="other">Other independent service</option></>;
  return <section className="dashboard-panel service-panel"><h2>Services, categories and pricing</h2><p>Wash or Blow is the main vehicle service. Engine Wash and Under Wash are optional extras. Each service has its own GHS price and worker assignment. No prices are copied or supplied automatically.</p>
    {error && <div className="error-banner" role="alert">{error}<button className="text-button" onClick={()=>void run(load)}>Retry</button></div>}{notice && <p role="status">{notice}</p>}
    {!catalog ? <p role="status">Loading pricing configuration…</p> : <><fieldset disabled={busy}><legend className="sr-only">Service and price configuration</legend>
      <form className="service-forms" onSubmit={event=>{ event.preventDefault(); void run(async()=>{ await window.appApi.addService({ name:serviceName,kind:serviceCode==='other'?undefined:serviceCode }); setServiceName(''); await load(); await onChanged(); }); }}><label>New service<input required maxLength={120} value={serviceName} onChange={event=>setServiceName(event.target.value)} /></label><label>Service role<select value={serviceCode} onChange={event=>setServiceCode(event.target.value as ServiceCode)}>{codeOptions}</select></label><button className="secondary-button">Add service</button></form>
      <form className="service-price-editor" onSubmit={event=>{ event.preventDefault(); void run(async()=>{
        if(!selectedService || (!generalAllowed && priceCategory===null)) throw new Error('Select a vehicle category for this vehicle service.');
        await window.appApi.setServicePrice({ serviceId:Number(priceService),vehicleTypeId:priceCategory,status:priceCategory===null?'available':priceStatus,...((priceCategory===null || priceStatus==='available')?{ price:Number(price) }:{}) });
        await load(); setNotice('Pricing saved. Recorded visit prices and worker assignments remain unchanged.');
      }); }}><h3>Configure a service price</h3><div className="service-forms"><label>Service<select required value={priceService} onChange={event=>setPriceService(event.target.value)}><option value="">Select service</option>{catalog.services.map(service=><option key={service.id} value={service.id}>{service.name}</option>)}</select></label><label>Vehicle category<CategorySelect id="price-vehicle-category" categories={categories} value={priceCategory} allowGeneral={generalAllowed} required={!generalAllowed} onChange={setPriceCategory} /></label><label>Availability<select value={priceCategory===null ? 'available' : priceStatus} disabled={priceCategory===null} onChange={event=>setPriceStatus(event.target.value as PriceStatus)}><option value="available">Available — configure price</option><option value="unavailable">Unavailable for this category</option><option value="unconfigured">Price not configured</option></select></label><label>Price (GHS)<input type="number" min="0" step="0.01" required={priceCategory===null || priceStatus==='available'} disabled={priceCategory!==null && priceStatus!=='available'} value={price} onChange={event=>setPrice(event.target.value)} placeholder="Enter administrator price" /></label><button className="primary-button" disabled={!priceService || (!generalAllowed && priceCategory===null)}>Save pricing</button></div><p>GHS 0 is a configured free service. Unavailable and not configured cannot be charged. Changing availability keeps previously stored prices for history.</p></form>
      <h3>Vehicle service price matrix</h3><div className="service-forms"><label>Search categories<input type="search" maxLength={120} value={matrixSearch} onChange={event=>setMatrixSearch(event.target.value)} /></label><label className="category-inline-check"><input type="checkbox" checked={showInactive} onChange={event=>setShowInactive(event.target.checked)} /> Include inactive categories</label></div>
      <div className="table-scroll price-matrix"><table><caption>Independent prices per vehicle category. Select a cell to edit.</caption><thead><tr><th>Vehicle category</th>{vehicleServices.map(service=><th key={service.id}>{service.name}</th>)}</tr></thead><tbody>{matrixCategories.map(category=><tr key={category.id}><th scope="row">{category.name}{!category.isActive && <small>Inactive</small>}</th>{vehicleServices.map(service=><td key={service.id}><button type="button" className={`price-cell ${cell(service.id,category.id)==='Unavailable' ? 'price-unavailable' : ''}`} aria-label={`Edit ${service.name} for ${category.name}: ${cell(service.id,category.id)}`} onClick={()=>{ setPriceService(String(service.id)); setPriceCategory(category.id); document.getElementById('price-vehicle-category')?.scrollIntoView({ block:'center',behavior:'smooth' }); }}>{cell(service.id,category.id)}</button></td>)}</tr>)}</tbody></table>{!matrixCategories.length && <p>No matching categories.</p>}</div>
      <details><summary>Previously configured general and independent-service prices</summary><p>Existing general vehicle-service prices are retained, but new vehicle visits require explicit category prices.</p><div className="table-scroll"><table><thead><tr><th>Service</th><th>Category</th><th>Stored price</th></tr></thead><tbody>{catalog.prices.filter(row=>row.vehicleTypeId===null || catalog.services.find(service=>service.id===row.serviceId)?.role==='independent').map(row=><tr key={`${row.serviceId}-${row.vehicleTypeId}`}><td>{catalog.services.find(service=>service.id===row.serviceId)?.name}</td><td>{categories.find(category=>category.id===row.vehicleTypeId)?.name ?? 'General'}</td><td>{money(row.price)}</td></tr>)}</tbody></table></div></details>
      <details><summary>Classify custom services</summary><p>Assign the correct role to previously unclassified services.</p>{catalog.services.filter(service=>service.code==='other').map(service=><label key={service.id}>{service.name}<select value="other" onChange={event=>{ const kind=event.target.value as ServiceCode; void run(async()=>{ await window.appApi.setServiceKind({ serviceId:service.id,kind }); await load(); }); }}>{codeOptions}</select></label>)}</details>
    </fieldset><CategoriesPanel onChanged={async()=>{ await load(); await onChanged(); }} onError={failure} /></>}
  </section>;
}
