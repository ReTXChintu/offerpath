import { Button, Icon, Input, Panel, PasswordInput, Spinner, Table } from '@offerpath/ui';
import { useState, type ReactNode } from 'react';

import { useAppName, useHuntClient, useHuntNavigator } from '../client';
import { ErrorBanner, HuntLink, InfoBanner, Loading } from '../components/common';
import type { LegacyData } from '../protocol';
import {
  useBackendRegister,
  useImportLegacyData,
  useImportMasterResume,
  useLegacyImport,
  useOpenUrl,
  useParseMasterResume,
  useSaveSettings,
  useSettings,
  useSetupStatus,
  useStartJobHunt,
} from '../queries';

const LEGACY_DISMISSED_KEY = 'offerpath.legacy-import-dismissed';

function readLegacyDismissed(): string | null {
  try {
    return window.localStorage.getItem(LEGACY_DISMISSED_KEY);
  } catch {
    return null;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** "agent_runs" → "Agent runs". */
function collectionLabel(name: string): string {
  const words = name.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Old Job Hunter data found on this computer: what's there, "Import" to
 * bring it in (the app restarts with it), or "Start fresh".
 */
export function LegacyImportPanel({
  data,
  onStartFresh,
}: {
  data: LegacyData;
  onStartFresh: () => void;
}) {
  const appName = useAppName();
  const importData = useImportLegacyData();
  const total = data.collections.reduce((n, [, count]) => n + count, 0);
  return (
    <Panel className="mb6" title="Your Job Hunter data is on this computer">
      <p className="t-small text-muted mb3" style={{ marginTop: 0 }}>
        {appName} found a Job Hunter install with {total.toLocaleString()} saved item
        {total === 1 ? '' : 's'} ({formatBytes(data.bytes)}) in{' '}
        <span className="mono">{data.path}</span>. Import it to keep your profile, jobs,
        applications, resumes and settings. Job Hunter&apos;s own folder is left as it is.
      </p>
      {data.collections.length ? (
        <div className="mb4" style={{ maxWidth: 420 }}>
          <Table aria-label="What was found">
            <thead>
              <tr>
                <th>What</th>
                <th style={{ textAlign: 'right' }}>Items</th>
              </tr>
            </thead>
            <tbody>
              {data.collections.map(([name, count]) => (
                <tr key={name}>
                  <td>{collectionLabel(name)}</td>
                  <td className="tabular" style={{ textAlign: 'right' }}>
                    {count.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      ) : null}
      <ErrorBanner error={importData.error} title="Couldn't import" />
      {importData.isPending ? (
        <div className="row g2 items-center t-small text-muted mb3">
          <Spinner size="sm" />
          Copying your data. {appName} restarts by itself when it&apos;s done.
        </div>
      ) : null}
      <div className="row g2 wrap">
        <Button
          variant="primary"
          icon="download"
          onClick={() => importData.mutate()}
          loading={importData.isPending}
        >
          Import
        </Button>
        <Button variant="ghost" onClick={onStartFresh} disabled={importData.isPending}>
          Start fresh
        </Button>
      </div>
    </Panel>
  );
}

function Step({
  n,
  title,
  ok,
  warn,
  children,
}: {
  n: number;
  title: string;
  ok: boolean;
  warn?: boolean;
  children: ReactNode;
}) {
  const bg = ok ? 'var(--success)' : warn ? 'var(--warning)' : 'var(--surface-2)';
  return (
    <section
      className="row items-start g4"
      style={{ padding: '16px 0', borderBottom: '1px solid var(--border)' }}
      aria-label={`Step ${n}: ${title}${ok ? ' (done)' : ''}`}
    >
      <span
        className="shrink-0"
        style={{
          width: 32,
          height: 32,
          borderRadius: 99,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: bg,
          color: ok || warn ? '#fff' : 'var(--text-muted)',
          fontWeight: 700,
          fontSize: 13,
        }}
      >
        {ok ? <Icon name="check" size={16} /> : warn ? <Icon name="alert" size={16} /> : n}
      </span>
      <div className="flex-1">
        <h3 className="t-h4 mb1">
          Step {n} · {title}
        </h3>
        {children}
      </div>
    </section>
  );
}

/**
 * First run: offers the old Job Hunter data, then checks Claude, Chrome, the
 * account, the master resume and the profile. `intro` is the host's own
 * welcome text.
 */
export function SetupPage({ intro }: { intro?: ReactNode }) {
  const appName = useAppName();
  const setup = useSetupStatus();
  const legacy = useLegacyImport();
  const settings = useSettings();
  const saveSettings = useSaveSettings();
  const register = useBackendRegister();
  const importResume = useImportMasterResume();
  const parse = useParseMasterResume();
  const start = useStartJobHunt();
  const openUrl = useOpenUrl();
  const client = useHuntClient();
  const nav = useHuntNavigator();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [backendSkipped, setBackendSkipped] = useState(false);
  const [legacyDismissed, setLegacyDismissed] = useState(readLegacyDismissed);
  const s = setup.data;
  if (!s)
    return setup.error ? (
      <ErrorBanner error={setup.error} onRetry={() => void setup.refetch()} />
    ) : (
      <Loading label="Checking this computer" />
    );

  const mock = s.mockMode;
  const claudeOk = mock || (s.claude.installed && s.claude.authenticated);
  const chromeOk = mock || (s.chrome.installed && s.chrome.extensionInstalled);
  const backendOk = s.backend.configured;
  const resumeOk = s.profile.hasMasterResume;
  const profileOk = s.profile.ready;
  const allReady = claudeOk && chromeOk && profileOk;
  const legacyData = legacy.data && legacy.data.path !== legacyDismissed ? legacy.data : null;

  const startFresh = () => {
    if (!legacy.data) return;
    try {
      window.localStorage.setItem(LEGACY_DISMISSED_KEY, legacy.data.path);
    } catch {
      // Storage unavailable: the offer comes back next time.
    }
    setLegacyDismissed(legacy.data.path);
  };

  const finish = async (thenStart: boolean) => {
    if (settings.data) await saveSettings.mutateAsync({ ...settings.data, setupCompleted: true });
    if (thenStart) start.mutate({});
    nav.navigate({ to: 'overview' });
  };

  const pick = async () => {
    if (!client.pickFiles) return;
    const [selected] = await client.pickFiles({
      multiple: false,
      filters: [{ name: 'Resume', extensions: ['pdf', 'docx'] }],
    });
    if (selected) importResume.mutate(selected);
  };

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', paddingTop: 8 }}>
      <h1 className="t-display mb2">Welcome to {appName}</h1>
      {intro ?? (
        <p className="t-body mb6" style={{ marginTop: 0 }}>
          It uses your own Claude Code login and your own Chrome, and never submits an application
          without your approval.
        </p>
      )}
      {legacyData ? <LegacyImportPanel data={legacyData} onStartFresh={startFresh} /> : null}
      {mock ? (
        <InfoBanner status="warning" title="Mock mode is on">
          Claude and Chrome are simulated with fixture data. Turn it off in Settings → Agent for
          real job hunts.
        </InfoBanner>
      ) : null}
      <ErrorBanner
        error={
          register.error ?? importResume.error ?? parse.error ?? saveSettings.error ?? start.error
        }
      />

      <Step
        n={1}
        title="Check Claude CLI"
        ok={s.claude.installed || mock}
        warn={!s.claude.installed && !mock}
      >
        {s.claude.installed ? (
          <p className="t-small text-muted" style={{ margin: 0 }}>
            Claude CLI {s.claude.version} found at {s.claude.path}
          </p>
        ) : (
          <div className="col items-start g2">
            <p className="t-small text-muted" style={{ margin: 0 }}>
              Claude Code was not found. Install it, then click re-check.
            </p>
            <div className="row g2">
              <Button
                size="xs"
                onClick={() => openUrl.mutate('https://code.claude.com/docs/en/overview')}
              >
                Install instructions
              </Button>
              <Button size="xs" variant="ghost" icon="refresh" onClick={() => void setup.refetch()}>
                Re-check
              </Button>
            </div>
          </div>
        )}
      </Step>

      <Step
        n={2}
        title="Check Claude authentication"
        ok={s.claude.authenticated || mock}
        warn={s.claude.installed && !s.claude.authenticated && !mock}
      >
        {s.claude.authenticated ? (
          <p className="t-small text-muted" style={{ margin: 0 }}>
            Signed in{s.claude.account ? ` as ${s.claude.account}` : ''}
            {s.claude.subscription ? ` (${s.claude.subscription})` : ''}. {appName} reuses this
            login; no API key is needed.
          </p>
        ) : (
          <div className="col items-start g2">
            <p className="t-small text-muted" style={{ margin: 0 }}>
              Open a terminal, run <b>claude</b> and complete the sign-in (or{' '}
              <b>claude auth login</b>), then re-check.
            </p>
            <Button size="xs" variant="ghost" icon="refresh" onClick={() => void setup.refetch()}>
              Re-check
            </Button>
          </div>
        )}
      </Step>

      <Step n={3} title="Check Chrome and Claude in Chrome" ok={chromeOk} warn={!chromeOk}>
        <p className="t-small text-muted" style={{ margin: 0 }}>
          {s.chrome.installed ? `Chrome ${s.chrome.version ?? ''} found. ` : 'Chrome not found. '}
          {s.chrome.extensionInstalled
            ? `Claude in Chrome extension ${s.chrome.extensionVersion} is installed.`
            : 'Claude in Chrome extension not detected in your Chrome profiles.'}
        </p>
        {!chromeOk ? (
          <div className="row g2 mt2">
            {!s.chrome.installed ? (
              <Button size="xs" onClick={() => openUrl.mutate('https://www.google.com/chrome/')}>
                Get Chrome
              </Button>
            ) : null}
            {!s.chrome.extensionInstalled ? (
              <Button
                size="xs"
                onClick={() =>
                  openUrl.mutate(
                    'https://chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn',
                  )
                }
              >
                Install Claude in Chrome
              </Button>
            ) : null}
            <Button size="xs" variant="ghost" icon="refresh" onClick={() => void setup.refetch()}>
              Re-check
            </Button>
          </div>
        ) : null}
      </Step>

      <Step
        n={4}
        title="Sign in to your account (optional)"
        ok={backendOk}
        warn={!backendOk && backendSkipped}
      >
        {backendOk ? (
          <p className="t-small text-muted" style={{ margin: 0 }}>
            Connected as {s.backend.target}. Everything is stored locally and synced to your
            account.
          </p>
        ) : (
          <div className="col g2" style={{ maxWidth: 560 }}>
            <p className="t-small text-muted" style={{ margin: 0 }}>
              Create an account so the mobile and web apps can see your data even when this computer
              is off. Your password is never stored; only a device token, in the OS credential
              store. You can skip this and stay local-only for now, and set it up later in Settings.
            </p>
            <div className="row g2">
              <Input
                size="sm"
                type="email"
                autoComplete="email"
                aria-label="Email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <PasswordInput
                size="sm"
                autoComplete="new-password"
                aria-label="Password"
                placeholder="Password (min 8 characters)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="row g2">
              <Button
                size="sm"
                variant="primary"
                onClick={() => register.mutate({ email: email.trim(), password })}
                loading={register.isPending}
                disabled={!email.trim() || password.length < 8}
              >
                Create account &amp; connect
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setBackendSkipped(true)}>
                Skip for now
              </Button>
            </div>
            <span className="t-caption">
              Already have an account? Sign in from{' '}
              <HuntLink to={{ to: 'settings' }}>Settings → Account</HuntLink> instead.
            </span>
          </div>
        )}
      </Step>

      <Step n={5} title="Import master resume" ok={resumeOk}>
        <div className="row g2 items-center wrap">
          <p className="t-small text-muted flex-1" style={{ margin: 0 }}>
            {resumeOk
              ? 'Master resume imported.'
              : 'Import your current PDF or DOCX resume. Claude can then pre-fill your profile from it.'}
          </p>
          {client.pickFiles ? (
            <Button
              size="sm"
              variant={resumeOk ? 'secondary' : 'primary'}
              onClick={() => void pick()}
              loading={importResume.isPending}
            >
              {resumeOk ? 'Replace' : 'Import Resume'}
            </Button>
          ) : null}
          {resumeOk ? (
            <Button
              size="sm"
              variant="subtle"
              onClick={() => parse.mutate()}
              loading={parse.isPending}
            >
              Fill profile with Claude
            </Button>
          ) : null}
        </div>
      </Step>

      <Step n={6} title="Configure candidate profile" ok={profileOk} warn={!profileOk && resumeOk}>
        <div className="row g2 items-center wrap">
          <p className="t-small text-muted flex-1" style={{ margin: 0 }}>
            {profileOk ? 'Profile is ready.' : `Still needed: ${s.profile.missing.join(', ')}.`}
          </p>
          <Button size="sm" onClick={() => nav.navigate({ to: 'candidate' })}>
            Open profile <Icon name="chevronRight" size={14} />
          </Button>
        </div>
      </Step>

      <div style={{ paddingTop: 24 }}>
        {allReady ? (
          <div className="col items-start g3">
            <h2 className="t-h2">You&apos;re ready.</h2>
            <div className="row g2">
              <Button
                variant="primary"
                size="lg"
                onClick={() => void finish(true)}
                loading={saveSettings.isPending || start.isPending}
              >
                Start First Job Hunt
              </Button>
              <Button variant="ghost" onClick={() => void finish(false)}>
                Go to the hunt overview
              </Button>
            </div>
          </div>
        ) : (
          <div className="row g2 items-center wrap">
            <p className="t-small text-muted flex-1" style={{ margin: 0 }}>
              Finish the highlighted steps to start a job hunt. You can always come back here from
              Settings.
            </p>
            <Button
              variant="ghost"
              onClick={() => void finish(false)}
              disabled={saveSettings.isPending}
            >
              Continue anyway
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
