import {
  Button,
  ConfirmDialog,
  Dot,
  Field,
  Icon,
  Input,
  Panel,
  PasswordInput,
  SegmentedControl,
  Spinner,
  Table,
} from '@offerpath/ui';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

import { useAppName } from '../client';
import { formatDateTime, timeAgo } from '../logic';
import {
  useRemoteCreatePairingCode,
  useRemoteDevices,
  useRemoteLogin,
  useRemoteLogout,
  useRemoteRegister,
  useRemoteRevokeDevice,
  useRemoteStatus,
} from '../queries';
import type { RemoteDevice, RemoteStatus } from '../types';
import { ErrorBanner, InfoBanner } from './common';

type Mode = 'register' | 'login';
const MODES = [
  { value: 'register', label: 'Create account' },
  { value: 'login', label: 'Sign in' },
] as const;

/**
 * Settings → Mobile app. Sign up or sign in once, then pair phones with a
 * one-time code (no password ever typed on the phone). The server only
 * routes messages between this computer and the phone; it never runs AI.
 */
export function MobileAppSettings() {
  const status = useRemoteStatus();
  if (!status.data)
    return status.error ? <ErrorBanner error={status.error} /> : <Spinner size="sm" />;
  return status.data.configured ? (
    <ConnectedView status={status.data} />
  ) : (
    <SignInForm defaultDeviceName={status.data.deviceName} />
  );
}

function SignInForm({ defaultDeviceName }: { defaultDeviceName: string }) {
  const appName = useAppName();
  const [mode, setMode] = useState<Mode>('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [deviceName, setDeviceName] = useState(defaultDeviceName);
  const register = useRemoteRegister();
  const login = useRemoteLogin();
  const active = mode === 'register' ? register : login;

  const submit = () =>
    active.mutate({ email: email.trim(), password, deviceName: deviceName.trim() || undefined });

  return (
    <Panel title="Mobile app">
      <p className="t-small text-muted mb4" style={{ marginTop: 0 }}>
        Review and approve applications from your phone, wherever you are. This connects to your own{' '}
        {appName} server, which only routes messages between this computer and your phone. Nothing
        here runs any AI. Use the same account as the backend account above.
      </p>
      <ErrorBanner error={register.error ?? login.error} />
      <form
        className="col g3"
        style={{ maxWidth: 480 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (email.trim() && password.length >= 8) submit();
        }}
      >
        <SegmentedControl<Mode> label="Account" value={mode} onChange={setMode} options={MODES} />
        <Field label="Email">
          <Input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Password">
          <PasswordInput
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === 'register' ? 'At least 8 characters' : undefined}
          />
        </Field>
        <Field
          label="This computer's name"
          hint="Shown to your phone and in the paired-devices list below."
        >
          <Input
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            placeholder="e.g. Work Laptop"
          />
        </Field>
        <div className="row">
          <Button
            type="submit"
            variant="primary"
            icon={mode === 'register' ? 'userPlus' : 'login'}
            loading={active.isPending}
            disabled={!email.trim() || password.length < 8}
          >
            {mode === 'register' ? 'Create account & connect' : 'Sign in & connect'}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function ConnectedView({ status }: { status: RemoteStatus }) {
  const logout = useRemoteLogout();
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  return (
    <div className="col g4">
      <Panel
        title="Mobile app"
        action={
          <Button size="xs" variant="danger" icon="logout" onClick={() => setConfirmSignOut(true)}>
            Sign out
          </Button>
        }
      >
        <ErrorBanner error={logout.error} />
        <div className="row g6 wrap items-center t-small">
          <span className="row g2 items-center">
            <Dot tone={status.connected ? 'success' : 'warning'} />
            <strong>{status.connected ? 'Connected' : 'Not connected'}</strong>
          </span>
          <span className="text-muted">
            Account: <span style={{ color: 'var(--text-primary)' }}>{status.accountEmail}</span>
          </span>
          <span className="text-muted">
            This computer: <span style={{ color: 'var(--text-primary)' }}>{status.deviceName}</span>
          </span>
          <span className="mono t-caption">{status.relayUrl}</span>
        </div>
        {status.lastError ? (
          <div className="mt3">
            <InfoBanner status="warning" title="Last connection error">
              {status.lastError}
            </InfoBanner>
          </div>
        ) : null}
      </Panel>

      <PairingPanel />
      <DevicesPanel />

      <ConfirmDialog
        open={confirmSignOut}
        onOpenChange={setConfirmSignOut}
        title="Sign out of the mobile app?"
        description="This forgets your account on this computer. Your phones stay paired until you revoke them below or sign in again and remove them."
        confirmLabel="Sign out"
        destructive
        loading={logout.isPending}
        onConfirm={() => logout.mutate(undefined, { onSuccess: () => setConfirmSignOut(false) })}
      />
    </div>
  );
}

function PairingPanel() {
  const appName = useAppName();
  const create = useRemoteCreatePairingCode();
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const pairing = create.data;

  useEffect(() => {
    if (!pairing) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(JSON.stringify({ code: pairing.code }), { width: 200, margin: 1 })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pairing]);

  useEffect(() => {
    if (!pairing) return;
    const tick = () =>
      setSecondsLeft(
        Math.max(0, Math.round((new Date(pairing.expiresAt).getTime() - Date.now()) / 1000)),
      );
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [pairing]);

  const expired = !!pairing && secondsLeft <= 0;

  return (
    <Panel title="Add a phone">
      <ErrorBanner error={create.error} />
      <p className="t-small text-muted mb4" style={{ marginTop: 0 }}>
        Open {appName} on your phone, choose &quot;Pair with a code&quot;, and either scan the QR
        code or type the 6-character code. No password needed on the phone.
      </p>
      {!pairing || expired ? (
        <Button
          variant="subtle"
          icon="smartphone"
          onClick={() => create.mutate()}
          loading={create.isPending}
        >
          {expired ? 'Generate a new code' : 'Generate pairing code'}
        </Button>
      ) : (
        <div className="row g6 wrap items-start">
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt="Pairing QR code"
              width={200}
              height={200}
              style={{ borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}
            />
          ) : null}
          <div className="col g2 items-start">
            <span className="kv-label">Pairing code</span>
            <span
              className="mono"
              style={{ fontSize: 30, fontWeight: 700, letterSpacing: '0.2em' }}
              aria-live="polite"
            >
              {pairing.code}
            </span>
            <span className="t-caption">Expires in {secondsLeft}s · one-time use</span>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => create.mutate()}
              loading={create.isPending}
            >
              Generate a different code
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}

function DevicesPanel() {
  const devices = useRemoteDevices(true);
  const revoke = useRemoteRevokeDevice();
  const [pendingRevoke, setPendingRevoke] = useState<RemoteDevice | null>(null);

  return (
    <Panel title="Paired devices">
      <ErrorBanner error={devices.error ?? revoke.error} />
      {!devices.data ? (
        <Spinner size="sm" />
      ) : devices.data.length === 0 ? (
        <p className="t-small text-muted">No devices yet.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Device</th>
              <th>Kind</th>
              <th>Platform</th>
              <th>Status</th>
              <th>Last seen</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {devices.data.map((d) => (
              <tr key={d.id}>
                <td>
                  <span className="row g2 items-center cell-title">
                    {d.kind === 'mobile' ? <Icon name="smartphone" size={14} /> : null}
                    {d.name}
                  </span>
                </td>
                <td style={{ textTransform: 'capitalize' }}>{d.kind}</td>
                <td>{d.platform || '—'}</td>
                <td>
                  <span className="row g1 items-center">
                    <Dot tone={d.online ? 'success' : 'neutral'} size="sm" />
                    <span className={d.online ? 'text-success' : 'text-muted'}>
                      {d.online ? 'Online' : 'Offline'}
                    </span>
                  </span>
                </td>
                <td>
                  <span
                    className="t-caption"
                    title={d.lastSeenAt ? formatDateTime(d.lastSeenAt) : undefined}
                  >
                    {d.lastSeenAt ? timeAgo(d.lastSeenAt) : 'Never'}
                  </span>
                </td>
                <td>
                  <Button size="xs" variant="danger" onClick={() => setPendingRevoke(d)}>
                    Revoke
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <ConfirmDialog
        open={!!pendingRevoke}
        onOpenChange={(open) => {
          if (!open) setPendingRevoke(null);
        }}
        title={`Revoke "${pendingRevoke?.name}"?`}
        description={
          pendingRevoke?.kind === 'desktop'
            ? "This is this computer's own device entry — revoking it will sign you out of the mobile app here."
            : 'This phone will be disconnected immediately and will need a new pairing code to reconnect.'
        }
        confirmLabel="Revoke"
        destructive
        loading={revoke.isPending}
        onConfirm={() => {
          if (pendingRevoke)
            revoke.mutate(pendingRevoke.id, { onSuccess: () => setPendingRevoke(null) });
        }}
      />
    </Panel>
  );
}
