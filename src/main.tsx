import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import SetupPage from './pages/SetupPage';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import type { Administrator } from './app-api';

function App() {
  const [screen, setScreen] = useState<'loading' | 'error' | 'setup' | 'login' | 'dashboard'>('loading');
  const [user, setUser] = useState<Administrator | null>(null);
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setScreen('loading');
    Promise.resolve().then(async () => {
      if (!window.setupApi || !window.appApi) throw new Error('Open Wash Bay Manager in Electron to connect to your business database.');
      const status = await window.setupApi.getStatus();
      if (!status.isComplete) { if (active) setScreen('setup'); return; }
      const session = await window.appApi.getSession();
      if (active) { setUser(session); setScreen(session ? 'dashboard' : 'login'); }
    }).catch((error: unknown) => {
      if (active) { setNotice(error instanceof Error ? error.message : 'Unable to open your business workspace.'); setScreen('error'); }
    });
    return () => { active = false; };
  }, [retry]);
  const signedOut = useCallback((message = '') => { setUser(null); setNotice(message); setScreen('login'); }, []);
  if (screen === 'setup') return <SetupPage onComplete={() => { setNotice('Business setup is complete. Sign in with your administrator account.'); setScreen('login'); }} />;
  if (screen === 'login') return <LoginPage notice={notice} onLogin={administrator => { setUser(administrator); setNotice(''); setScreen('dashboard'); }} />;
  if (screen === 'dashboard' && user) return <DashboardPage user={user} onSignedOut={signedOut} />;
  return <main className="status-panel" aria-live="polite"><h1>Wash Bay Manager</h1>{screen === 'error' ? <><p role="alert">{notice}</p><button className="primary-button" onClick={() => setRetry(value => value + 1)}>Try again</button></> : <><span className="spinner" /><p>Opening your workspace…</p></>}</main>;
}

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element #root was not found');
}

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
