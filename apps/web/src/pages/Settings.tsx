import { formatBytes } from '@offerpath/hunt';
import {
  AiFallbackSettings,
  GoalEditor,
  LearningSettings,
  describeError,
  useApi,
} from '@offerpath/learn';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  Icon,
  PageHeader,
  Panel,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  ThemeSelect,
  type IconName,
} from '@offerpath/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { useState } from 'react';

import { useAuth } from '../auth-context';
import { apiOrigin } from '../config';

export interface DeviceView {
  id: string;
  name: string;
  kind: 'desktop' | 'mobile';
  platform: string;
  createdAt: string;
  lastSeenAt: string | null;
  online: boolean;
}

export interface DownloadInfo {
  fileName: string;
  version: string | null;
  build: number | null;
  sizeBytes: number;
  updatedAt: string;
  url: string;
}

const TABS = ['account', 'goal', 'ai', 'devices', 'downloads'] as const;
type Tab = (typeof TABS)[number];

/**
 * Settings on the web (plan 5.3): account, the goal, AI (the Claude models and
 * the OpenAI fallback for interview prep), devices, downloads.
 */
export function SettingsPage() {
  const { tab } = useSearch({ strict: false }) as { tab?: string };
  const initial: Tab = TABS.includes(tab as Tab) ? (tab as Tab) : 'account';
  return (
    <div>
      <PageHeader title="Settings" />
      {/* Keyed by the link's tab, so "Get the apps" switches tabs even from within Settings. */}
      <Tabs key={initial} defaultValue={initial}>
        <TabsList label="Settings">
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="goal">Goal &amp; learning</TabsTrigger>
          <TabsTrigger value="ai">AI</TabsTrigger>
          <TabsTrigger value="devices">Devices</TabsTrigger>
          <TabsTrigger value="downloads">Downloads</TabsTrigger>
        </TabsList>
        <TabsContent value="account">
          <AccountPanel />
        </TabsContent>
        <TabsContent value="goal">
          <GoalEditor />
        </TabsContent>
        <TabsContent value="ai">
          <div className="col g4">
            <LearningSettings />
            <AiFallbackSettings />
          </div>
        </TabsContent>
        <TabsContent value="devices">
          <DevicesPanel />
        </TabsContent>
        <TabsContent value="downloads">
          <DownloadsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AccountPanel() {
  const { session, auth } = useAuth();
  return (
    <div className="col g4">
      <Panel title="Account">
        <div className="t-small mb4">
          Signed in as <strong>{session.email}</strong>. The desktop app and your phone sign in to
          the same account.
        </div>
        <Button icon="logout" onClick={() => void auth.logout()}>
          Sign out
        </Button>
      </Panel>
      <Panel title="Appearance">
        <Field label="Theme" hint="System follows your device's light or dark setting.">
          <div>
            <ThemeSelect />
          </div>
        </Field>
      </Panel>
    </div>
  );
}

const DEVICE_ICON: Record<DeviceView['kind'], IconName> = {
  desktop: 'monitor',
  mobile: 'smartphone',
};

function DevicesPanel() {
  const api = useApi();
  const queryClient = useQueryClient();
  const devices = useQuery({
    queryKey: ['devices'],
    queryFn: async () => (await api<{ devices: DeviceView[] }>('/devices')).devices,
    refetchInterval: 30_000,
  });
  const revoke = useMutation({
    mutationFn: (id: string) =>
      api<void>(`/devices/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['devices'] }),
  });
  const [confirming, setConfirming] = useState<DeviceView | null>(null);

  return (
    <Panel title="Devices">
      <div className="t-small mb4">
        The desktops and phones signed in to this account. Signing one out stops it syncing and
        reaching your account until it signs in again.
      </div>
      {devices.error ? (
        <Alert status="error">{describeError(devices.error, 'The devices did not load.')}</Alert>
      ) : devices.data && devices.data.length === 0 ? (
        <EmptyState
          dashed={false}
          icon="monitor"
          title="No devices yet"
          description="Sign in on the desktop app, then pair your phone from the desktop's Settings."
        />
      ) : (
        <div>
          {(devices.data ?? []).map((device) => (
            <div key={device.id} className="today-row">
              <div className="row items-center g3" style={{ minWidth: 0 }}>
                <Icon name={DEVICE_ICON[device.kind]} size={18} />
                <div style={{ minWidth: 0 }}>
                  <div className="t-h4" style={{ fontSize: 13.5 }}>
                    {device.name}
                  </div>
                  <div className="t-caption">
                    {device.kind === 'desktop' ? 'Desktop' : 'Phone'}
                    {device.platform ? ` · ${device.platform}` : ''}
                    {device.lastSeenAt
                      ? ` · last seen ${new Date(device.lastSeenAt).toLocaleString()}`
                      : ''}
                  </div>
                </div>
              </div>
              <div className="row items-center g2">
                <Badge variant={device.online ? 'success' : 'neutral'} size="sm">
                  {device.online ? 'Online' : 'Offline'}
                </Badge>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(device)}>
                  Sign out
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {revoke.error ? (
        <Alert status="error" className="mt3">
          {describeError(revoke.error)}
        </Alert>
      ) : null}
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={`Sign out ${confirming?.name ?? 'this device'}?`}
        description="It stops syncing with this account until it signs in again."
        confirmLabel="Sign out"
        destructive
        onConfirm={() => {
          if (confirming) revoke.mutate(confirming.id);
          setConfirming(null);
        }}
      />
    </Panel>
  );
}

function DownloadsPanel() {
  const api = useApi();
  const { baseUrl } = useAuth();
  const downloads = useQuery({
    queryKey: ['downloads'],
    queryFn: () =>
      api<{ android: DownloadInfo | null; windows: DownloadInfo | null }>('/downloads'),
  });
  const origin = apiOrigin(baseUrl);
  const items: { key: 'windows' | 'android'; label: string; icon: IconName; hint: string }[] = [
    {
      key: 'windows',
      label: 'Offerpath for Windows',
      icon: 'monitor',
      hint: 'The desktop app: it runs the hunt and the AI, with your own Claude.',
    },
    {
      key: 'android',
      label: 'Offerpath for Android',
      icon: 'smartphone',
      hint: 'Approve, answer and learn on your phone. Pair it from the desktop.',
    },
  ];

  return (
    <Panel title="Downloads">
      {downloads.error ? (
        <Alert status="error">
          {describeError(downloads.error, 'The downloads did not load.')}
        </Alert>
      ) : (
        <div>
          {items.map((item) => {
            const info = downloads.data?.[item.key] ?? null;
            return (
              <div key={item.key} className="today-row">
                <div className="row items-center g3" style={{ minWidth: 0 }}>
                  <Icon name={item.icon} size={18} />
                  <div style={{ minWidth: 0 }}>
                    <div className="t-h4" style={{ fontSize: 13.5 }}>
                      {item.label}
                    </div>
                    <div className="t-caption">
                      {info
                        ? `${info.version ? `Version ${info.version} · ` : ''}${formatBytes(info.sizeBytes)}`
                        : downloads.isLoading
                          ? 'Checking…'
                          : 'Not published yet'}
                    </div>
                    <div className="t-caption">{item.hint}</div>
                  </div>
                </div>
                {info ? (
                  <a className="btn btn-secondary btn-sm" href={`${origin}${info.url}`} download>
                    <Icon name="download" size={14} /> Download
                  </a>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
