import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Check, Droplets, ImagePlus, ShieldCheck } from 'lucide-react';
import { initialValues, validateStep, type SetupValues, type FieldErrors } from './setupValidation';
import './SetupPage.css';

export default function SetupPage({ onComplete }: { onComplete?: () => void }) {
  const [values, setValues] = useState<SetupValues>(initialValues);
  const [step, setStep] = useState<1 | 2>(1);
  const [logo, setLogo] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [logoError, setLogoError] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<'loading' | 'ready' | 'complete' | 'error'>('loading');
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const completedCallback = useRef(false);

  useEffect(() => {
    let active = true;
    setStatus('loading'); setError('');
    Promise.resolve().then(() => {
      if (!window.setupApi) throw new Error('Open this application in Electron to connect to your local business database.');
      return window.setupApi.getStatus();
    }).then(result => { if (active) setStatus(result.isComplete ? 'complete' : 'ready'); })
      .catch((reason: unknown) => { if (active) { setError(reason instanceof Error ? reason.message : 'Unable to check setup. Please try again.'); setStatus('error'); } });
    return () => { active = false; };
  }, [retry]);
  useEffect(() => {
    if (!logo) { setPreview(''); return; }
    const url = URL.createObjectURL(logo); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [logo]);
  useEffect(() => { if (status === 'ready') heading.current?.focus(); }, [step, status]);
  useEffect(() => {
    if (status === 'complete' && !completedCallback.current) { completedCallback.current = true; onComplete?.(); }
  }, [status, onComplete]);

  function update(field: keyof SetupValues, value: string) {
    const next = { ...values, [field]: value }; setValues(next); setError('');
    setErrors(current => {
      const validated = validateStep(next, step), result = { ...current };
      if (current[field]) result[field] = validated[field];
      if (field === 'password' && current.confirmPassword) result.confirmPassword = validated.confirmPassword;
      return result;
    });
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (submitting.current) return;
    const nextErrors = validateStep(values, step); setErrors(nextErrors); setError('');
    if (Object.keys(nextErrors).length) { requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()); return; }
    if (step === 1 && logoError) { fileInput.current?.focus(); return; }
    if (step === 1) { setStep(2); return; }
    submitting.current = true; setSaving(true);
    try {
      await window.setupApi.complete({ businessName: values.businessName.trim(), phone: values.phone.trim(), address: values.address.trim(), fullName: values.fullName.trim(), username: values.username.trim(), password: values.password,
        logo: logo ? { mimeType: logo.type, bytes: new Uint8Array(await logo.arrayBuffer()) } : undefined });
      setValues(initialValues); setLogo(null); setStatus('complete');
    } catch (reason: unknown) { setError(reason instanceof Error ? reason.message : 'Unable to save setup. Your details are still here; please try again.'); }
    finally { submitting.current = false; setSaving(false); }
  }
  function field(name: keyof SetupValues, label: string, options: { type?: string; autoComplete?: string; placeholder?: string; maxLength?: number; hint?: string } = {}) {
    return <div className="field"><label htmlFor={name}>{label} <span aria-hidden="true">*</span></label>
      <input id={name} name={name} type={options.type ?? 'text'} autoComplete={options.autoComplete} placeholder={options.placeholder} maxLength={options.maxLength} required value={values[name]}
        aria-invalid={Boolean(errors[name])} aria-describedby={errors[name] ? `${name}-error` : options.hint ? `${name}-hint` : undefined}
        onChange={event => update(name, event.target.value)} onBlur={() => setErrors(current => ({ ...current, [name]: validateStep(values, step)[name] }))} />
      {errors[name] ? <p aria-live="polite" className="field-error" id={`${name}-error`}>{errors[name]}</p> : options.hint && <p className="field-hint" id={`${name}-hint`}>{options.hint}</p>}</div>;
  }
  return <main className="setup-shell">
    <aside className="setup-brand"><div className="brand-mark"><Droplets aria-hidden="true" /><span>Wash Bay<span className="brand-subtitle">MANAGER</span></span></div>
      <div className="brand-story"><span className="eyebrow">A FRESH START</span><h1>Your business.<br />Ready for a<br /><span>clean start.</span></h1><p>Make it yours with your business details and an administrator account.</p><div className="brand-benefit"><ShieldCheck size={19} aria-hidden="true" /> Saved locally on this computer</div></div>
      <div className="brand-footer">Built for the everyday business of a better wash.</div></aside>
    <div className="setup-workspace"><header className="workspace-header"><span>BUSINESS SETUP</span><span className="local-badge">● Local workspace</span></header>
      <div className="setup-card">
        {status === 'loading' ? <div className="status-panel" role="status"><span className="spinner" /><h2>Getting things ready</h2><p>Checking your business setup…</p></div>
          : status === 'error' ? <div className="status-panel"><ShieldCheck aria-hidden="true" /><h2>Couldn’t connect to setup</h2><p role="alert">{error}</p><button className="primary-button" onClick={() => setRetry(value => value + 1)}>Try again</button></div>
          : status === 'complete' ? <div className="status-panel" role="status"><div className="success-icon"><Check aria-hidden="true" /></div><span className="eyebrow">ALL SET</span><h2>Your business is ready</h2><p>Your business details and administrator account have been saved on this computer.</p><p className="field-hint">Your administrator account is ready. Sign in to continue.</p></div>
          : <><nav aria-label="Setup progress"><ol className="stepper">{['Business details', 'Administrator'].map((label, index) => <li key={label} className={step >= index + 1 ? 'active' : ''} aria-current={step === index + 1 ? 'step' : undefined}><span className="step-number">{step > index + 1 ? <Check size={16} aria-hidden="true" /> : index + 1}</span>{label}</li>)}</ol></nav>
            <div className="form-heading"><span className="eyebrow">STEP {step} OF 2</span><h2 ref={heading} tabIndex={-1}>{step === 1 ? 'Let’s meet your business' : 'Create your administrator'}</h2><p>{step === 1 ? 'These details make your wash bay workspace your own.' : 'Set up the account that will manage your business.'}</p></div>
            {error && <div className="error-banner" role="alert">{error}</div>}
            <form ref={form} noValidate onSubmit={submit} aria-busy={saving}><fieldset disabled={saving}><legend className="sr-only">{step === 1 ? 'Business details' : 'Administrator account'}</legend>
              {step === 1 ? <>
                {field('businessName', 'Business name', { autoComplete: 'organization', placeholder: 'e.g. Sparkle Auto Wash', maxLength: 120 })}
                {field('phone', 'Business phone', { type: 'tel', autoComplete: 'tel', placeholder: 'e.g. +233 24 123 4567', maxLength: 40 })}
                <div className="field"><label htmlFor="address">Business address <span aria-hidden="true">*</span></label><textarea id="address" name="address" required rows={3} maxLength={500} autoComplete="street-address" placeholder="Street, area and city" value={values.address} aria-invalid={Boolean(errors.address)} aria-describedby={errors.address ? 'address-error' : undefined} onChange={event => update('address', event.target.value)} onBlur={() => setErrors(current => ({ ...current, address: validateStep(values, 1).address }))} />{errors.address && <p id="address-error" className="field-error">{errors.address}</p>}</div>
                <div className="field"><label htmlFor="logo">Business logo <span className="optional">Optional</span></label><div className="logo-upload">{preview ? <img src={preview} alt="Selected business logo preview" onError={() => { setLogo(null); setLogoError('This image could not be opened. Choose another logo.'); if (fileInput.current) fileInput.current.value = ''; }} /> : <div className="logo-placeholder"><ImagePlus aria-hidden="true" /></div>}<div className="logo-controls"><p>{logo ? logo.name : 'Add a personal touch'}</p><p className="field-hint" id="logo-hint">PNG, JPG or WebP · Up to 5 MB</p><input ref={fileInput} id="logo" type="file" accept="image/png,image/jpeg,image/webp" aria-invalid={Boolean(logoError)} aria-describedby={logoError ? 'logo-error' : 'logo-hint'} onChange={event => {
                  const selected = event.target.files?.[0]; if (!selected) return;
                  if (!['image/png', 'image/jpeg', 'image/webp'].includes(selected.type) || selected.size === 0 || selected.size > 5 * 1024 * 1024) { setLogoError('Choose a PNG, JPG or WebP image between 1 byte and 5 MB.'); event.target.value = ''; return; }
                  setLogoError(''); setLogo(selected);
                }} />{(logo || logoError) && <button type="button" className="text-button" onClick={() => { setLogo(null); setLogoError(''); if (fileInput.current) fileInput.current.value = ''; }}>Remove logo</button>}</div></div>{logoError && <p id="logo-error" className="field-error" role="alert">{logoError}</p>}</div>
                <div className="currency-note"><span>Workspace currency</span><strong>GHS · Ghana cedi</strong></div>
              </> : <><div className="business-summary"><Droplets aria-hidden="true" /><div><strong>{values.businessName}</strong><span>{values.phone}</span></div><Check aria-hidden="true" /></div>
                {field('fullName', 'Full name', { autoComplete: 'name', placeholder: 'Administrator’s full name', maxLength: 120 })}
                {field('username', 'Username', { autoComplete: 'username', placeholder: 'Choose a username', maxLength: 64 })}
                <div className="password-grid">{field('password', 'Password', { type: 'password', autoComplete: 'new-password', hint: 'At least 8 characters. Maximum 72 UTF-8 bytes.' })}{field('confirmPassword', 'Confirm password', { type: 'password', autoComplete: 'new-password', placeholder: 'Repeat your password' })}</div>
                <div className="security-note"><ShieldCheck size={18} aria-hidden="true" /><p>Your password is securely hashed before it is saved. Keep your administrator credentials safe.</p></div>
              </>}
              <div className="form-actions">{step === 2 ? <button className="secondary-button" type="button" onClick={() => { setError(''); setErrors({}); setStep(1); }}><ArrowLeft size={17} aria-hidden="true" /> Back</button> : <span className="required-note">* Required fields</span>}<button className="primary-button" type="submit">{saving ? <><span className="spinner" /> Saving setup…</> : <>{step === 1 ? 'Continue' : 'Finish setup'}<ArrowRight size={17} aria-hidden="true" /></>}</button></div>
            </fieldset></form></>}
      </div><footer className="workspace-footer"><ShieldCheck size={15} aria-hidden="true" /> Your setup stays on this computer.</footer>
    </div></main>;
}


