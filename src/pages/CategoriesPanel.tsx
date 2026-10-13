import { useEffect,useState } from 'react';
import type { VehicleCategory } from '../app-api';
export default function CategoriesPanel({ onChanged,onError }: { onChanged:()=>Promise<void>; onError:(reason:unknown)=>void }) {
  const [categories,setCategories]=useState<VehicleCategory[]>([]);
  const [search,setSearch]=useState('');
  const [filter,setFilter]=useState<'all'|'active'|'inactive'>('all');
  const [editing,setEditing]=useState<number|null>(null);
  const [name,setName]=useState('');
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [notice,setNotice]=useState('');
  async function load() { setCategories(await window.appApi.getVehicleTypes()); }
  useEffect(()=>{ let active=true; window.appApi.getVehicleTypes().then(next=>{ if(active) setCategories(next); }).catch(reason=>{ if(active) onError(reason); }).finally(()=>{ if(active) setLoading(false); }); return()=>{ active=false; }; },[]);
  async function run(action:()=>Promise<void>) { setBusy(true); setNotice(''); try { await action(); await load(); await onChanged(); } catch(reason) { onError(reason); } finally { setBusy(false); } }
  const filtered=categories.filter(category=>category.name.toLowerCase().includes(search.trim().toLowerCase()) && (filter==='all' || (filter==='active' ? category.isActive===1 : category.isActive===0)));
  return <section className="category-management"><h3>Manage vehicle categories</h3><p>Renaming keeps the same category ID and prices. Deactivation keeps vehicles and historical visits, and removes the category from new registrations and visits.</p>{notice && <p role="status">{notice}</p>}
    <form className="service-forms" onSubmit={event=>{ event.preventDefault(); void run(async()=>{ if(editing) { await window.appApi.updateVehicleType({ id:editing,name }); setNotice('Category renamed. Historical visit names are unchanged.'); } else { await window.appApi.addVehicleType({ name }); setNotice('Category added without any prices.'); } setName(''); setEditing(null); }); }}><label>{editing ? 'Rename category' : 'New category'}<input required maxLength={120} disabled={busy} value={name} onChange={event=>setName(event.target.value)} /></label><button className="secondary-button" disabled={busy}>{editing ? 'Save category name' : 'Add category'}</button>{editing && <button type="button" className="secondary-button" disabled={busy} onClick={()=>{ setEditing(null); setName(''); }}>Cancel edit</button>}</form>
    <div className="service-forms"><label>Search categories<input type="search" maxLength={120} value={search} onChange={event=>setSearch(event.target.value)} /></label><label>Category status<select value={filter} onChange={event=>setFilter(event.target.value as typeof filter)}><option value="all">All categories</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label></div>
    {loading ? <p role="status">Loading categories…</p> : <div className="table-scroll category-table"><table><caption>Vehicle categories ({filtered.length})</caption><thead><tr><th>Category</th><th>Status</th><th>Actions</th></tr></thead><tbody>{filtered.map(category=><tr key={category.id}><th scope="row">{category.name}</th><td>{category.isActive ? 'Active' : 'Inactive'}</td><td><div className="worker-row-actions"><button type="button" className="secondary-button" disabled={busy} onClick={()=>{ setEditing(category.id); setName(category.name); }}>Rename</button><button type="button" className="secondary-button" disabled={busy} onClick={()=>void run(async()=>{ await window.appApi.setVehicleTypeStatus({ id:category.id,isActive:!category.isActive }); setNotice(`Category ${category.isActive ? 'deactivated' : 'activated'}.`); })}>{category.isActive ? 'Deactivate' : 'Activate'}</button></div></td></tr>)}</tbody></table>{!filtered.length && <p>No categories match this search.</p>}</div>}
  </section>;
}
