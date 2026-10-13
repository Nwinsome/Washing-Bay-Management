import { useCallback, useEffect, useRef, useState } from 'react';
import { Droplets, LayoutDashboard, LogOut, RefreshCw, Users, CheckCircle2, Wallet, Clock, Receipt, Car, ClipboardList } from 'lucide-react';
import type { Administrator, DashboardData } from '../app-api';
import './DashboardPage.css';
import ServicesPanel from './ServicesPanel';
import WorkersPage from './WorkersPage';
import VehiclesPage from './VehiclesPage';
import VisitsPage from './VisitsPage';
import EarningsPage from './EarningsPage';
import FinancePage from './FinancePage';
import CompanyAccountsPage from './CompanyAccountsPage';
import ReportsPage from './ReportsPage';
import SettingsPage from './SettingsPage';
import {DatePresentation,formatBusinessDate} from '../date-presentation';
export default function DashboardPage({ user, onSignedOut }: { user: Administrator; onSignedOut: (notice?: string) => void }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [view, setView] = useState<'overview' | 'workers' | 'vehicles' | 'visits' | 'earnings' | 'expenses' | 'closing' | 'companies' | 'reports' | 'settings'>('overview');
  const preferencesApplied=useRef(false);
  useEffect(()=>{if(data&&!preferencesApplied.current){preferencesApplied.current=true;setView(data.preferences?.startPage??'overview');}},[data]);
  const [workersRefresh, setWorkersRefresh] = useState(0);
  const [vehiclesRefresh, setVehiclesRefresh] = useState(0);
  const [visitsRefresh, setVisitsRefresh] = useState(0);
  const [earningsRefresh, setEarningsRefresh] = useState(0);
  const [lastActivity, setLastActivity] = useState(0);
  const workerActivity = useCallback(() => setLastActivity(Date.now()), []);
  const alive = useRef(true);
  const requestNumber = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++requestNumber.current; setLoading(true); setError('');
    try { const next = await window.appApi.getDashboard(); if (alive.current && request === requestNumber.current) setData(next); }
    catch (reason: unknown) { if (alive.current && request === requestNumber.current) {
      if (reason instanceof Error && reason.message.includes('SESSION_EXPIRED')) onSignedOut('Your session ended. Please sign in again.');
      else setError('Unable to load your business overview. Please try again.');
    } }
    finally { if (alive.current && request === requestNumber.current) setLoading(false); }
  }, [onSignedOut]);
  useEffect(() => { alive.current = true; void refresh(); return () => { alive.current = false; requestNumber.current++; }; }, [refresh]);
  useEffect(() => {
    if (!data) return;
    const timer = setTimeout(() => { void window.appApi.logout().catch(() => {}); onSignedOut('Your session ended after 30 minutes of inactivity. Please sign in again.'); }, 30 * 60 * 1000);
    return () => clearTimeout(timer);
  }, [data, lastActivity, onSignedOut]);
  async function logout() {
    setSigningOut(true); requestNumber.current++;
    try { await window.appApi.logout(); onSignedOut('You have signed out.'); }
    catch { setError('Unable to sign out. Please retry or close the application.'); setLoading(false); }
    finally { if (alive.current) setSigningOut(false); }
  }
  const currency = data?.business.currency || 'GHS';
  function money(value: number) {
    try { return new Intl.NumberFormat('en-GH', { style: 'currency', currency, currencyDisplay: 'code' }).format(value); }
    catch { return `${currency} ${value.toFixed(2)}`; }
  }
  const date = data ? formatBusinessDate(data.date,data.preferences?.dateFormat??'long') : '';
  return <DatePresentation.Provider value={data?.preferences?.dateFormat??'long'}><main className="dashboard-shell"><aside className="dashboard-sidebar"><div className="brand-mark"><Droplets aria-hidden="true" /><span>Wash Bay<span className="brand-subtitle">MANAGER</span></span></div><div className="business-identity"><span>YOUR WORKSPACE</span><strong>{data?.business.name ?? 'Business overview'}</strong></div><nav aria-label="Main navigation"><button className="dashboard-nav dashboard-nav-button" aria-current={view === 'overview' ? 'page' : undefined} disabled={signingOut} onClick={() => { setView('overview'); void refresh(); }}><LayoutDashboard size={19} aria-hidden="true" /> Overview</button><button className="dashboard-nav dashboard-nav-button" aria-current={view === 'workers' ? 'page' : undefined} disabled={signingOut} onClick={() => setView('workers')}><Users size={19} aria-hidden="true" /> Workers</button><button className="dashboard-nav dashboard-nav-button" aria-current={view === 'vehicles' ? 'page' : undefined} disabled={signingOut} onClick={() => setView('vehicles')}><Car size={19} aria-hidden="true" /> Vehicles</button><button className="dashboard-nav dashboard-nav-button" aria-current={view === 'visits' ? 'page' : undefined} disabled={signingOut} onClick={() => setView('visits')}><ClipboardList size={19} aria-hidden="true" /> Visits</button><button className="dashboard-nav dashboard-nav-button" aria-current={view === 'earnings' ? 'page' : undefined} disabled={signingOut} onClick={() => setView('earnings')}><Wallet size={19} aria-hidden="true" /> Worker Earnings</button><button className="dashboard-nav dashboard-nav-button" aria-current={view === 'expenses' ? 'page' : undefined} onClick={() => setView('expenses')}><Receipt size={19} /> Expenses</button><button className="dashboard-nav dashboard-nav-button" aria-current={view === 'closing' ? 'page' : undefined} onClick={() => setView('closing')}><CheckCircle2 size={19} /> Daily Closing</button><button className="dashboard-nav dashboard-nav-button" disabled={signingOut} aria-current={view === 'companies' ? 'page' : undefined} onClick={() => setView('companies')}><Users size={19} aria-hidden="true" /> Company Accounts</button><button className="dashboard-nav dashboard-nav-button" disabled={signingOut} aria-current={view === 'reports' ? 'page' : undefined} onClick={() => setView('reports')}><LayoutDashboard size={19} aria-hidden="true" /> Reports and Analytics</button><button className="dashboard-nav dashboard-nav-button" disabled={signingOut} aria-current={view === 'settings' ? 'page' : undefined} onClick={() => setView('settings')}><Users size={19} aria-hidden="true" /> Settings and Security</button></nav><div className="sidebar-account"><div className="account-avatar">{user.fullName.slice(0, 1).toUpperCase()}</div><div><strong>{user.fullName}</strong><span>Administrator</span></div></div><button className="logout-button" disabled={signingOut} onClick={() => void logout()}><LogOut size={17} aria-hidden="true" />{signingOut ? 'Signing out…' : 'Sign out'}</button></aside>
    <section className="dashboard-content"><header className="dashboard-heading"><div><span className="eyebrow">{view === 'settings' ? 'BUSINESS SETTINGS AND SECURITY' : view === 'reports' ? 'FINANCIAL REPORTING' : view === 'companies' ? 'COMPANY CREDIT AND PAYMENTS' : view === 'expenses' || view === 'closing' ? 'BUSINESS FINANCE' : view === 'earnings' ? 'WORKER COMPENSATION' : view === 'workers' ? 'TEAM MANAGEMENT' : view === 'vehicles' ? 'VEHICLE MANAGEMENT' : view === 'visits' ? 'VISIT OPERATIONS' : 'BUSINESS OVERVIEW'}</span><h1>{view === 'settings' ? 'Settings and Security' : view === 'reports' ? 'Reports and Analytics' : view === 'companies' ? 'Company Accounts' : view === 'expenses' ? 'Expenses' : view === 'closing' ? 'Daily Closing' : view === 'earnings' ? 'Worker Earnings' : view === 'workers' ? 'Workers' : view === 'vehicles' ? 'Vehicles' : view === 'visits' ? 'Visits and payments' : `Welcome, ${user.fullName.split(' ')[0]}`}</h1><p>{date || 'Your local business overview'}</p></div><button className="secondary-button" disabled={loading || signingOut} onClick={() => { if (view === 'settings' || view === 'reports' || view === 'companies' || view === 'earnings' || view === 'expenses' || view === 'closing') setEarningsRefresh(value => value + 1); if (view === 'workers') setWorkersRefresh(value => value + 1); if (view === 'vehicles') setVehiclesRefresh(value => value + 1); if (view === 'visits') setVisitsRefresh(value => value + 1); void refresh(); }}><RefreshCw size={16} aria-hidden="true" />{loading ? 'Refreshing…' : 'Refresh'}</button></header>
      {error && <div className="error-banner" role="alert">{error}<button className="text-button" disabled={loading || signingOut} onClick={() => void refresh()}>Try again</button></div>}
      {view === 'settings' ? <SettingsPage refreshKey={earningsRefresh} onActivity={workerActivity} onChanged={refresh} onSignedOut={onSignedOut} /> : view === 'reports' ? <ReportsPage refreshKey={earningsRefresh} onActivity={workerActivity} onSignedOut={onSignedOut} /> : view === 'companies' ? <CompanyAccountsPage refreshKey={earningsRefresh} onChanged={refresh} onActivity={workerActivity} onSignedOut={onSignedOut} /> : view === 'expenses' || view === 'closing' ? <FinancePage key={view} mode={view} refreshKey={earningsRefresh} onChanged={refresh} onActivity={workerActivity} onSignedOut={onSignedOut} /> : view === 'earnings' ? <EarningsPage refreshKey={earningsRefresh} onChanged={refresh} onActivity={workerActivity} onSignedOut={onSignedOut} /> : view === 'visits' ? <VisitsPage refreshKey={visitsRefresh} onChanged={refresh} onActivity={workerActivity} onSignedOut={onSignedOut} /> : view === 'vehicles' ? <VehiclesPage refreshKey={vehiclesRefresh} onChanged={refresh} onActivity={workerActivity} onSignedOut={onSignedOut} /> : view === 'workers' ? <WorkersPage refreshKey={workersRefresh} onChanged={refresh} onActivity={workerActivity} onSignedOut={onSignedOut} /> : !data ? <div className="dashboard-panel status-panel" role="status">{loading ? <><span className="spinner" /><h2>Loading your overview</h2></> : <p>Your overview could not be loaded.</p>}</div> : <div aria-busy={loading}>
        <div className="metric-grid">{[
          {label:'Collected today',value:money(data.summary.collectedToday),hint:'Recorded completed payments received today',Icon:Wallet},
          {label:'Completed today',value:data.summary.completedToday,hint:'Work completed today',Icon:CheckCircle2},
          {label:'Outstanding balances',value:money(data.summary.outstandingBalance),hint:'Unpaid and partially paid · excluding cancelled work',Icon:Receipt},
          {label:'Expenses today',value:money(data.summary.expensesToday),hint:'Recorded business expenses',Icon:Receipt},
          {label:'Company outstanding',value:money((data.companySummary?.outstandingPesewas ?? 0)/100),hint:'Included in total outstanding balances',Icon:Users},
          {label:'Company overdue',value:money((data.companySummary?.overduePesewas ?? 0)/100),hint:'Past configured due dates',Icon:Clock},
          {label:'Vehicles waiting',value:data.summary.waitingVehicles,hint:'Registered vehicle visits awaiting work',Icon:Car},
          {label:'Vehicles in progress',value:data.summary.inProgressVehicles,hint:'Registered vehicle visits currently in progress',Icon:Clock},
        ].map(({label,value,hint,Icon}) => <article className="metric-card" key={label}><div><span>{label}</span><Icon size={19} aria-hidden="true" /></div><strong>{value}</strong><p>{hint}</p></article>)}</div>
        <section className="dashboard-panel"><div className="panel-heading"><div><h2>Recent visits</h2><p>The latest transactions in your business database.</p></div><span className="small-badge">Latest {data.recent.length}</span></div>{data.recent.length ? <div className="table-scroll"><table><caption className="sr-only">Eight most recent visit transactions</caption><thead><tr><th scope="col">Transaction</th><th scope="col">Customer / vehicle</th><th scope="col">Status</th><th scope="col" className="amount">Total</th></tr></thead><tbody>{data.recent.map(row => <tr key={row.id}><th scope="row">{row.number}<small>{row.createdAt.slice(0,10)}</small></th><td>{row.customer ?? 'Walk-in customer'}<small>{row.vehicle ?? 'No vehicle recorded'}</small></td><td><span className={`wash-status status-${row.status}`}>{row.status.replace('_',' ')}</span></td><td className="amount">{money(row.total)}</td></tr>)}</tbody></table></div> : <div className="empty-washes"><Droplets size={30} aria-hidden="true" /><h3>A clean slate</h3><p>No visits have been recorded yet. Your real transactions will appear here.</p></div>}</section>
        <section className="dashboard-panel resources"><div><Users size={20} aria-hidden="true" /><h2>Your business at a glance</h2></div><dl><div><dt>Customers</dt><dd>{data.summary.customers}</dd></div><div><dt>Active workers</dt><dd>{data.summary.activeWorkers}</dd></div><div><dt>Active services</dt><dd>{data.summary.activeServices}</dd></div></dl></section>
        <ServicesPanel money={money} onChanged={refresh} onSignedOut={onSignedOut} />
        <p className="overview-note">Today is based on Ghana time.</p>
      </div>}
    </section></main></DatePresentation.Provider>;
}
