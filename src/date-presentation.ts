import {createContext,useContext} from 'react';
import type {BusinessPreferences} from './settings-api';
export const DatePresentation=createContext<BusinessPreferences['dateFormat']>('long');
export function formatBusinessDate(value:string,format:BusinessPreferences['dateFormat']){const day=value.slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return value;if(format==='iso')return day;if(format==='day_first')return `${day.slice(8,10)}/${day.slice(5,7)}/${day.slice(0,4)}`;return new Intl.DateTimeFormat('en-GH',{dateStyle:'full',timeZone:'Africa/Accra'}).format(new Date(`${day}T00:00:00Z`));}
export const useDatePresentation=()=>useContext(DatePresentation);
