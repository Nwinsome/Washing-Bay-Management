import { useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Droplets, ShieldCheck } from 'lucide-react';
import type { Administrator } from '../app-api';
import './SetupPage.css';
export default function LoginPage({ onLogin, notice }: { onLogin: (user: Administrator) => void; notice?: string }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (locked.current) return;
    if (!username.trim() || !password) { setError('Enter your username and password.'); return; }
    locked.current = true; setBusy(true); setError('');
    try {
      const result = await window.appApi.login({ username: username.trim(), password });
      setPassword('');
      if (result.ok) onLogin(result.user); else setError(result.message);
    } catch { setPassword(''); setError('Unable to sign in. Check the application connection and try again.'); }
    finally { locked.current = false; setBusy(false); }
  }
  return <main className="setup-shell"><aside className="setup-brand"><div className="brand-mark"><Droplets aria-hidden="true" /><span>Wash Bay<span className="brand-subtitle">MANAGER</span></span></div><div className="brand-story"><span className="eyebrow">WELCOME BACK</span><h1>A fresh day.<br /><span>A clear view.</span></h1><p>Sign in to see how your business is doing, all in one place.</p><div className="brand-benefit"><ShieldCheck size={19} aria-hidden="true" /> Your workspace stays local</div></div></aside>
    <div className="setup-workspace"><header className="workspace-header"><span>ADMINISTRATOR ACCESS</span><span className="local-badge">● Local workspace</span></header><section className="setup-card login-card"><div className="form-heading"><span className="eyebrow">YOUR BUSINESS WORKSPACE</span><h2>Welcome back</h2><p>Sign in with the administrator account created during setup.</p></div>{notice && <p className="login-notice" role="status">{notice}</p>}{error && <p className="error-banner" role="alert">{error}</p>}
      <form onSubmit={submit} aria-busy={busy}><fieldset disabled={busy}><legend className="sr-only">Administrator sign in</legend><div className="field"><label htmlFor="login-username">Username</label><input autoFocus id="login-username" name="username" autoComplete="username" maxLength={64} required value={username} onChange={event => { setUsername(event.target.value); setError(''); }} /></div><div className="field"><label htmlFor="login-password">Password</label><input id="login-password" name="password" type="password" autoComplete="current-password" required value={password} onChange={event => { setPassword(event.target.value); setError(''); }} /></div><button className="primary-button login-submit" type="submit">{busy ? <><span className="spinner" /> Signing in…</> : <>Sign in <ArrowRight size={17} aria-hidden="true" /></>}</button></fieldset></form><p className="field-hint login-help">Access is available to active administrator accounts. If you cannot sign in, contact the person who set up this business.</p></section><footer className="workspace-footer"><ShieldCheck size={15} aria-hidden="true" /> Sign-in ends when you close the app.</footer></div></main>;
}
