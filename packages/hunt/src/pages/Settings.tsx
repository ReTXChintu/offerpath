import {
  Button,
  Field,
  Input,
  LinesInput,
  PageHeader,
  Panel,
  PasswordInput,
  SegmentedControl,
  Spinner,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@offerpath/ui';
import { useEffect, useState, type ReactNode } from 'react';

import { useAppName } from '../client';
import { CompaniesEditor } from '../components/CompaniesEditor';
import { ErrorBanner, InfoBanner, Loading } from '../components/common';
import { MobileAppSettings } from '../components/MobileAppSettings';
import { formatDateTime } from '../logic';
import {
  useBackendLogin,
  useBackendLogout,
  useBackendRegister,
  useSaveSettings,
  useServerInfo,
  useSettings,
  useSetupStatus,
  useSyncStatus,
  useTestBackend,
} from '../queries';
import type { AppSettings, SyncStatus } from '../types';
import { LogViewer } from './Agent';

/** A tab the host adds to Settings (e.g. Appearance). */
export interface SettingsTab {
  value: string;
  label: string;
  content: ReactNode;
}

/**
 * The hunt's settings: account sign-in, job sources, agent behaviour,
 * resume generation, Claude and Chrome, mobile pairing and logs. `extraTabs`
 * go first (the host's own settings).
 */
export function SettingsPage({ extraTabs = [] }: { extraTabs?: SettingsTab[] }) {
  const settingsQ = useSettings();
  const save = useSaveSettings();
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (settingsQ.data && !dirty) setDraft(structuredClone(settingsQ.data));
  }, [settingsQ.data, dirty]);
  if (!draft)
    return settingsQ.error ? (
      <ErrorBanner error={settingsQ.error} />
    ) : (
      <Loading label="Loading settings" />
    );
  const update = (fn: (s: AppSettings) => void) => {
    setDraft((d) => {
      if (!d) return d;
      const n = structuredClone(d);
      fn(n);
      return n;
    });
    setDirty(true);
  };
  const num = (v: string, fallback: number) =>
    v === '' || Number.isNaN(Number(v)) ? fallback : Number(v);

  return (
    <div>
      <PageHeader
        title="Settings"
        actions={
          <Button
            variant="primary"
            icon="save"
            onClick={() => save.mutate(draft, { onSuccess: () => setDirty(false) })}
            loading={save.isPending}
            disabled={!dirty}
          >
            Save settings
          </Button>
        }
      />
      <ErrorBanner error={save.error} />
      <Tabs defaultValue={extraTabs[0]?.value ?? 'backend'}>
        <TabsList label="Settings">
          {extraTabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
          <TabsTrigger value="backend">Account</TabsTrigger>
          <TabsTrigger value="sources">Job sources</TabsTrigger>
          <TabsTrigger value="agent">Agent</TabsTrigger>
          <TabsTrigger value="resume">Resume</TabsTrigger>
          <TabsTrigger value="integrations">Claude &amp; Chrome</TabsTrigger>
          <TabsTrigger value="mobile">Mobile app</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>

        {extraTabs.map((t) => (
          <TabsContent key={t.value} value={t.value}>
            {t.content}
          </TabsContent>
        ))}

        <TabsContent value="backend">
          <BackendSettingsPanel />
        </TabsContent>

        <TabsContent value="sources">
          <Panel title="Job sources">
            <p className="t-small text-muted mb4" style={{ marginTop: 0 }}>
              Each enabled source is searched through Claude in Chrome using your own logged-in
              browser session. Start with one or two sources; each search is a separate Claude run.
            </p>
            <div className="col g3">
              {draft.jobSources.map((src, i) => (
                <Switch
                  key={src.platform}
                  checked={src.enabled}
                  onCheckedChange={(enabled) =>
                    update((s) => {
                      const source = s.jobSources[i];
                      if (source) source.enabled = enabled;
                    })
                  }
                >
                  {src.platform}
                </Switch>
              ))}
            </div>
            <Field
              label="Telegram channels and groups"
              className="mt6"
              hint="Read in Telegram Web: sign in once at web.telegram.org in Chrome. Each scan reads only the messages posted since the last one and keeps the job posts, with their apply links or email addresses."
            >
              <LinesInput
                rows={4}
                value={draft.telegramChannels}
                placeholder="One per line, e.g. @techjobsindia or https://t.me/remotejobs"
                onChange={(v) =>
                  update((s) => {
                    s.telegramChannels = v;
                  })
                }
              />
            </Field>
            <div className="field mt6">
              <span className="field-label">Company careers sites</span>
              <CompaniesEditor
                value={draft.targetCompanies}
                onChange={(v) =>
                  update((s) => {
                    s.targetCompanies = v;
                  })
                }
              />
              <div className="field-hint">
                Searched by the &quot;Company careers&quot; source, straight on each company&apos;s
                own site (no job boards). If a link moved, Claude finds the official careers site
                from the company&apos;s homepage.
              </div>
            </div>
            <div className="grid grid-3 g4 mt6">
              <Field
                label="Max jobs per source"
                hint="Postings collected from each site per hunt (for Company careers, from each company). More takes longer and costs more Claude usage."
              >
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={draft.maxJobsPerSource}
                  onChange={(e) =>
                    update((s) => {
                      s.maxJobsPerSource = num(e.target.value, 10);
                    })
                  }
                />
              </Field>
              <Field label="Only jobs posted in the last (days)">
                <Input
                  type="number"
                  value={draft.recencyDays}
                  onChange={(e) =>
                    update((s) => {
                      s.recencyDays = num(e.target.value, 7);
                    })
                  }
                />
              </Field>
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="agent">
          <Panel title="Agent behaviour">
            <div className="grid grid-3 g4">
              <Field
                label="Max applications prepared per run"
                hint="Of the jobs a hunt finds, the best matches above the minimum score get a tailored resume and an application for your review, up to this many. The rest stay in Jobs."
              >
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={draft.maxApplicationsPerRun}
                  onChange={(e) =>
                    update((s) => {
                      s.maxApplicationsPerRun = num(e.target.value, 10);
                    })
                  }
                />
              </Field>
              <Field label="Minimum match score to prepare (0-100)">
                <Input
                  type="number"
                  value={draft.minimumMatchScore}
                  onChange={(e) =>
                    update((s) => {
                      s.minimumMatchScore = Math.min(100, Math.max(0, num(e.target.value, 60)));
                    })
                  }
                />
              </Field>
              <Field
                label="Approval mode"
                hint="Automatic submission is intentionally not available."
              >
                <Input value="Review required (every submission needs your approval)" readOnly />
              </Field>
            </div>
            <div className="mt6">
              <Switch
                checked={draft.mockMode}
                onCheckedChange={(on) =>
                  update((s) => {
                    s.mockMode = on;
                  })
                }
              >
                Mock mode (development only: simulate Claude and Chrome with fixture data, never
                submit anything)
              </Switch>
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="resume">
          <Panel title="Resume generation">
            <div className="col g4">
              <Switch
                checked={draft.resume.generateCoverLetter}
                onCheckedChange={(on) =>
                  update((s) => {
                    s.resume.generateCoverLetter = on;
                  })
                }
              >
                Generate a cover letter with each resume
              </Switch>
              <Switch
                checked={draft.resume.generatePdf}
                onCheckedChange={(on) =>
                  update((s) => {
                    s.resume.generatePdf = on;
                  })
                }
              >
                Produce PDF
              </Switch>
              <Switch
                checked={draft.resume.generateDocx}
                onCheckedChange={(on) =>
                  update((s) => {
                    s.resume.generateDocx = on;
                  })
                }
              >
                Produce DOCX
              </Switch>
              <Switch
                checked={draft.resume.deleteFilesAfterApplied}
                onCheckedChange={(on) =>
                  update((s) => {
                    s.resume.deleteFilesAfterApplied = on;
                  })
                }
              >
                Delete an application&apos;s files once it&apos;s sent (they can be re-created from
                the application)
              </Switch>
              <div className="grid grid-halves g4">
                <Field
                  label="Check Gmail for replies every (hours, 0 = off)"
                  hint="Reads your inbox and spam for employers' replies to sent applications. It never replies or moves mail."
                >
                  <Input
                    type="number"
                    value={draft.inboxCheckHours}
                    onChange={(e) =>
                      update((s) => {
                        s.inboxCheckHours = Math.min(48, Math.max(0, num(e.target.value, 3)));
                      })
                    }
                  />
                </Field>
              </div>
              <div className="grid grid-halves g4">
                <Field label="ATS validation iterations (max 3)">
                  <Input
                    type="number"
                    value={draft.resume.atsMaxIterations}
                    onChange={(e) =>
                      update((s) => {
                        s.resume.atsMaxIterations = Math.min(
                          3,
                          Math.max(1, num(e.target.value, 3)),
                        );
                      })
                    }
                  />
                </Field>
                <Field label="Target keyword coverage (%)">
                  <Input
                    type="number"
                    value={draft.resume.minimumKeywordCoverage}
                    onChange={(e) =>
                      update((s) => {
                        s.resume.minimumKeywordCoverage = Math.min(
                          100,
                          Math.max(0, num(e.target.value, 70)),
                        );
                      })
                    }
                  />
                </Field>
              </div>
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="integrations">
          <IntegrationSettings draft={draft} update={update} />
        </TabsContent>

        <TabsContent value="mobile">
          <MobileAppSettings />
        </TabsContent>

        <TabsContent value="logs">
          <LogViewer />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function BackendSettingsPanel() {
  const sync = useSyncStatus();
  const settings = useSettings();
  if (!sync.data || !settings.data)
    return sync.error ? <ErrorBanner error={sync.error} /> : <Spinner size="sm" />;
  return sync.data.configured ? (
    <BackendConnectedView status={sync.data} />
  ) : (
    <BackendSignInForm defaultDeviceName={settings.data.backend.deviceName} />
  );
}

type Mode = 'register' | 'login';
const MODES = [
  { value: 'register', label: 'Create account' },
  { value: 'login', label: 'Sign in' },
] as const;

/** Sign this desktop in to the user's account (the same account on web and phone). */
export function BackendSignInForm({ defaultDeviceName }: { defaultDeviceName: string }) {
  const appName = useAppName();
  const [mode, setMode] = useState<Mode>('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [deviceName, setDeviceName] = useState(defaultDeviceName);
  const register = useBackendRegister();
  const login = useBackendLogin();
  const test = useTestBackend();
  const server = useServerInfo();
  const active = mode === 'register' ? register : login;

  const submit = () =>
    active.mutate({ email: email.trim(), password, deviceName: deviceName.trim() || undefined });

  return (
    <Panel title="Account">
      <p className="t-small text-muted mb4" style={{ marginTop: 0 }}>
        Sign in to your {appName} account so the mobile and web apps can see your jobs and
        applications even when this computer is off. Data is always kept locally first and synced
        when the server is reachable. You can skip this entirely and stay local-only.
      </p>
      <ErrorBanner error={register.error ?? login.error ?? test.error} />
      {test.isSuccess ? <InfoBanner status="success">Server reachable.</InfoBanner> : null}
      <form
        className="col g3"
        style={{ maxWidth: 480 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (email.trim() && password.length >= 8) submit();
        }}
      >
        <span className="t-caption">
          Server: <span className="mono">{server.data?.url ?? '…'}</span>
        </span>
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
        <Field label="This computer's name">
          <Input
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            placeholder="e.g. Work Laptop"
          />
        </Field>
        <div className="row g2">
          <Button onClick={() => test.mutate()} loading={test.isPending}>
            Test connection
          </Button>
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

function BackendConnectedView({ status: s }: { status: SyncStatus }) {
  const logout = useBackendLogout();
  return (
    <Panel
      title="Account"
      action={
        <Button
          size="xs"
          variant="danger"
          icon="logout"
          onClick={() => logout.mutate()}
          loading={logout.isPending}
        >
          Sign out
        </Button>
      }
    >
      <ErrorBanner error={logout.error} />
      <div className="grid grid-4 g3 t-small">
        <div>
          <div className="text-muted">Connected</div>
          <strong className={s.connected ? 'text-success' : 'text-warning'}>
            {s.connected ? 'Yes' : 'Offline'}
          </strong>
        </div>
        <div>
          <div className="text-muted">Pending changes</div>
          <strong>{s.pending}</strong>
        </div>
        <div>
          <div className="text-muted">Last sync</div>
          <strong>{s.lastSyncAt ? formatDateTime(s.lastSyncAt) : 'Never'}</strong>
        </div>
        {s.target ? (
          <div style={{ gridColumn: 'span 2' }}>
            <div className="text-muted">Account</div>
            <div className="mono t-caption">{s.target}</div>
          </div>
        ) : null}
        {s.lastError ? (
          <div style={{ gridColumn: 'span 2' }}>
            <div className="text-muted">Last error</div>
            <div className="text-warning">{s.lastError}</div>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

function IntegrationSettings({
  draft,
  update,
}: {
  draft: AppSettings;
  update: (fn: (s: AppSettings) => void) => void;
}) {
  const appName = useAppName();
  const setup = useSetupStatus();
  const c = setup.data?.claude;
  const ch = setup.data?.chrome;
  return (
    <div className="col g4">
      <Panel title="Claude Code">
        {c ? (
          <div className="grid grid-4 g3 t-small mb4">
            <div>
              <div className="text-muted">Installed</div>
              <strong className={c.installed ? 'text-success' : 'text-error'}>
                {c.installed ? `Yes (${c.version})` : 'No'}
              </strong>
            </div>
            <div>
              <div className="text-muted">Signed in</div>
              <strong className={c.authenticated ? 'text-success' : 'text-error'}>
                {c.authenticated ? `Yes${c.account ? ` · ${c.account}` : ''}` : 'No'}
              </strong>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <div className="text-muted">Executable</div>
              <div className="mono t-caption">{c.path ?? 'not found'}</div>
            </div>
            {c.error ? (
              <div className="text-warning" style={{ gridColumn: 'span 4' }}>
                {c.error}
              </div>
            ) : null}
          </div>
        ) : (
          <Spinner size="sm" />
        )}
        <div className="grid grid-halves g4">
          <Field label="Claude CLI path (optional override)">
            <Input
              value={draft.claude.cliPath ?? ''}
              placeholder="auto-detect"
              onChange={(e) =>
                update((s) => {
                  s.claude.cliPath = e.target.value || null;
                })
              }
            />
          </Field>
          <Field label="Model (optional, e.g. sonnet, opus)">
            <Input
              value={draft.claude.model ?? ''}
              placeholder="Claude Code default"
              onChange={(e) =>
                update((s) => {
                  s.claude.model = e.target.value || null;
                })
              }
            />
          </Field>
          <Field label="Max spend per Claude call (USD, 0 = unlimited)">
            <Input
              type="number"
              step="0.5"
              value={draft.claude.maxBudgetUsdPerCall}
              onChange={(e) =>
                update((s) => {
                  s.claude.maxBudgetUsdPerCall = Number(e.target.value) || 0;
                })
              }
            />
          </Field>
          <Field label="Max browser turns per task">
            <Input
              type="number"
              value={draft.claude.maxTurnsBrowser}
              onChange={(e) =>
                update((s) => {
                  s.claude.maxTurnsBrowser = Number(e.target.value) || 80;
                })
              }
            />
          </Field>
          <Field label="Timeout per Claude call (seconds)">
            <Input
              type="number"
              value={draft.claude.timeoutSeconds}
              onChange={(e) =>
                update((s) => {
                  s.claude.timeoutSeconds = Number(e.target.value) || 900;
                })
              }
            />
          </Field>
        </div>
        <p className="t-caption mt3" style={{ marginBottom: 0 }}>
          {appName} never uses an Anthropic API key. All AI work runs through your signed-in Claude
          Code installation.
        </p>
      </Panel>
      <Panel title="Google Chrome & Claude in Chrome">
        {ch ? (
          <div className="grid grid-4 g3 t-small mb4">
            <div>
              <div className="text-muted">Chrome</div>
              <strong className={ch.installed ? 'text-success' : 'text-error'}>
                {ch.installed ? `Found${ch.version ? ` (${ch.version})` : ''}` : 'Not found'}
              </strong>
            </div>
            <div>
              <div className="text-muted">Claude in Chrome extension</div>
              <strong className={ch.extensionInstalled ? 'text-success' : 'text-warning'}>
                {ch.extensionInstalled ? `Installed (${ch.extensionVersion})` : 'Not detected'}
              </strong>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <div className="text-muted">Executable</div>
              <div className="mono t-caption">{ch.path ?? '—'}</div>
            </div>
          </div>
        ) : (
          <Spinner size="sm" />
        )}
        <Field label="Chrome path (optional override)" className="mb4">
          <Input
            style={{ maxWidth: 560 }}
            value={draft.browser.chromePath ?? ''}
            placeholder="auto-detect"
            onChange={(e) =>
              update((s) => {
                s.browser.chromePath = e.target.value || null;
              })
            }
          />
        </Field>
        <h4 className="t-h4 mb1">How it works</h4>
        <p className="t-small text-muted" style={{ margin: 0 }}>
          Claude Code drives your real Chrome window through the Claude in Chrome extension, so job
          sites see your normal logged-in session. {appName} never reads cookies or passwords and
          never bypasses CAPTCHAs.
        </p>
      </Panel>
    </div>
  );
}
