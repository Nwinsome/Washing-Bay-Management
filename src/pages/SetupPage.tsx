import { useEffect, useState, type FormEvent } from 'react';

type SetupPageProps = {
  onComplete?: () => void;
};

type SetupValues = {
  businessName: string;
  phone: string;
  address: string;
  fullName: string;
  username: string;
  password: string;
  confirmPassword: string;
};

const initialValues: SetupValues = {
  businessName: '',
  phone: '',
  address: '',
  fullName: '',
  username: '',
  password: '',
  confirmPassword: '',
};

export default function SetupPage({ onComplete }: SetupPageProps) {
  const [values, setValues] = useState(initialValues);
  const [step, setStep] = useState(1);
  const [logo, setLogo] = useState<File | null>(null);
  const [isComplete, setIsComplete] = useState<boolean | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;

    window.setupApi
      .getStatus()
      .then(({ isComplete: setupComplete }) => {
        if (mounted) setIsComplete(setupComplete);
      })
      .catch((statusError: unknown) => {
        if (mounted) {
          setError(
            statusError instanceof Error
              ? statusError.message
              : 'Unable to check setup status.',
          );
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  function updateValue(field: keyof SetupValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    if (step === 1) {
      setStep(2);
      return;
    }
    if (values.password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (values.password !== values.confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setIsSaving(true);
    try {
      const logoPayload = logo
        ? {
            mimeType: logo.type,
            bytes: new Uint8Array(await logo.arrayBuffer()),
          }
        : undefined;

      await window.setupApi.complete({
        businessName: values.businessName,
        phone: values.phone,
        address: values.address,
        fullName: values.fullName,
        username: values.username,
        password: values.password,
        logo: logoPayload,
      });
      setIsComplete(true);
      onComplete?.();
    } catch (submitError: unknown) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Unable to save setup. Please try again.',
      );
    } finally {
      setIsSaving(false);
    }
  }

  if (isComplete === null) {
    return <main aria-live="polite">Checking business setup…</main>;
  }

  if (isComplete) {
    return (
      <main>
        <h1>Setup complete</h1>
        <p>Your business and admin account are ready.</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Set up your wash bay</h1>
      <p>Step {step} of 2</p>
      {error && <p role="alert">{error}</p>}

      <form onSubmit={submit}>
        {step === 1 ? (
          <section aria-labelledby="business-details-heading">
            <h2 id="business-details-heading">Business details</h2>

            <label>
              Business Name
              <input
                autoComplete="organization"
                required
                value={values.businessName}
                onChange={(event) =>
                  updateValue('businessName', event.target.value)
                }
              />
            </label>

            <label>
              Phone
              <input
                autoComplete="tel"
                type="tel"
                required
                value={values.phone}
                onChange={(event) => updateValue('phone', event.target.value)}
              />
            </label>

            <label>
              Address
              <textarea
                autoComplete="street-address"
                required
                value={values.address}
                onChange={(event) => updateValue('address', event.target.value)}
              />
            </label>

            <label>
              Logo
              <input
                accept="image/png,image/jpeg,image/webp"
                type="file"
                onChange={(event) => {
                  const selectedFile = event.target.files?.[0] ?? null;
                  if (selectedFile && selectedFile.size > 5 * 1024 * 1024) {
                    setError('Logo must be smaller than 5 MB.');
                    event.target.value = '';
                    setLogo(null);
                    return;
                  }
                  setError('');
                  setLogo(selectedFile);
                }}
              />
            </label>
          </section>
        ) : (
          <section aria-labelledby="admin-account-heading">
            <h2 id="admin-account-heading">Admin account</h2>

            <label>
              Full Name
              <input
                autoComplete="name"
                required
                value={values.fullName}
                onChange={(event) => updateValue('fullName', event.target.value)}
              />
            </label>

            <label>
              Username
              <input
                autoComplete="username"
                required
                value={values.username}
                onChange={(event) => updateValue('username', event.target.value)}
              />
            </label>

            <label>
              Password
              <input
                autoComplete="new-password"
                minLength={8}
                required
                type="password"
                value={values.password}
                onChange={(event) => updateValue('password', event.target.value)}
              />
            </label>

            <label>
              Confirm Password
              <input
                autoComplete="new-password"
                minLength={8}
                required
                type="password"
                value={values.confirmPassword}
                onChange={(event) =>
                  updateValue('confirmPassword', event.target.value)
                }
              />
            </label>
          </section>
        )}

        {step === 2 && (
          <button type="button" onClick={() => setStep(1)}>
            Back
          </button>
        )}
        <button disabled={isSaving} type="submit">
          {isSaving ? 'Saving…' : step === 1 ? 'Continue' : 'Finish setup'}
        </button>
      </form>
    </main>
  );
}
