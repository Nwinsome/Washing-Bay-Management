import { useState } from 'react';
import type { VehicleCategory } from '../app-api';
export default function CategorySelect({ id,value,categories,onChange,required=false,disabled=false,allowGeneral=false }: {
  id:string; value:number|null; categories:VehicleCategory[]; onChange:(value:number|null)=>void; required?:boolean; disabled?:boolean; allowGeneral?:boolean;
}) {
  const [search,setSearch]=useState('');
  const visible=categories.filter(category=>category.id===value || category.name.toLowerCase().includes(search.trim().toLowerCase()));
  return <div className="category-picker"><input id={`${id}-search`} aria-label="Search vehicle categories" type="search" maxLength={120} placeholder="Search categories…" value={search} disabled={disabled} onChange={event=>setSearch(event.target.value)} /><select id={id} aria-label="Vehicle category" required={required} disabled={disabled} value={value ?? ''} onChange={event=>onChange(event.target.value ? Number(event.target.value):null)}><option value="">{allowGeneral ? 'General price (independent service)' : 'Select vehicle category'}</option>{visible.map(category=><option key={category.id} value={category.id}>{category.name}{category.isActive ? '' : ' (inactive)'}</option>)}</select>{!visible.length && <span className="field-hint">No matching categories.</span>}</div>;
}
