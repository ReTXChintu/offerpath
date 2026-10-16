import { describeError } from '@offerpath/learn';
import {
  Alert,
  Button,
  Field,
  Input,
  Logo,
  PasswordInput,
  SegmentedControl,
  ThemeToggle,
} from '@offerpath/ui';
import { useState, type FormEvent } from 'react';

import { GetTheApps } from '../components/GetTheApps';
import type { Auth } from '../session';

type Mode = 'login' | 'register';

/**
 * Sign in or create an account: the same account as the desktop app and
 * the phone. Signing up opens onboarding next.
 */
export function AuthPage({ auth }: { auth: Auth }) {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      if (mode === 'login') await auth.login(email, password);
      else await auth.register(email, password, name.trim() || email.split('@')[0] || 'Me');
    } catch (e) {
      setError(e);
      setPending(false);
    }
  };

  const fieldErrors =
    error && typeof error === 'object' && 'fieldErrors' in error
      ? (error as { fieldErrors: Record<string, string[]> }).fieldErrors
      : {};

  return (
    <div className="auth-page">
      <div className="auth-card card">
        <div className="row items-center justify-between mb5">
          <span className="row items-center g2">
            <Logo size={32} />
            <span style={{ fontWeight: 800, fontSize: 17 }}>Offerpath</span>
          </span>
          <ThemeToggle />
        </div>
        <h1 className="t-h2 mb1">{mode === 'login' ? 'Sign in' : 'Create your account'}</h1>
        <p className="t-small mb4" style={{ marginTop: 0 }}>
          Finds the jobs, gets you ready for the interviews, and moves you one step closer to the
          offer every day.
        </p>
        <div className="mb4">
          <SegmentedControl<Mode>
            label="Sign in or sign up"
            value={mode}
            onChange={(next) => {
              setMode(next);
              setError(null);
            }}
            options={[
              { value: 'login', label: 'Sign in' },
              { value: 'register', label: 'Create account' },
            ]}
          />
        </div>
        <form className="col g4" onSubmit={(e) => void submit(e)} noValidate>
          {mode === 'register' ? (
            <Field label="Your name" error={fieldErrors.displayName?.[0]}>
              <Input
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Alex"
              />
            </Field>
          ) : null}
          <Field label="Email" error={fieldErrors.email?.[0]} required>
            <Input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Field
            label="Password"
            hint={mode === 'register' ? 'At least 8 characters.' : undefined}
            error={fieldErrors.password?.[0]}
            required
          >
            <PasswordInput
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          {error ? (
            <Alert status="error">{describeError(error, 'That did not work. Try again.')}</Alert>
          ) : null}
          <Button
            type="submit"
            variant="primary"
            size="lg"
            block
            loading={pending}
            disabled={!email || !password}
          >
            {mode === 'login' ? 'Sign in' : 'Create account'}
          </Button>
        </form>
        <div className="auth-apps">
          <GetTheApps />
        </div>
      </div>
    </div>
  );
}
