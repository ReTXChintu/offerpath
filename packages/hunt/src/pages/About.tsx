import { Button, Logo, PageHeader, Panel, Spinner } from '@offerpath/ui';
import type { ReactNode } from 'react';

import { useAppName } from '../client';
import { ErrorBanner, InfoBanner } from '../components/common';
import { UpdateActions } from '../components/UpdateNotifier';
import { formatDateTime } from '../logic';
import { useAboutInfo, useUpdateCheck } from '../queries';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="t-caption">{label}</div>
      <div className="mono" style={{ fontSize: 12.5, wordBreak: 'break-all' }}>
        {children}
      </div>
    </div>
  );
}

export function AboutPage() {
  const appName = useAppName();
  const about = useAboutInfo();
  const check = useUpdateCheck();
  const a = about.data;
  const c = check.data;

  return (
    <div style={{ maxWidth: 760 }}>
      <PageHeader title="About" />
      <div className="col g4">
        <Panel>
          <div className="row g4 items-center">
            <Logo size={52} title={null} />
            <div>
              <div className="t-h2">{appName}</div>
              <div className="text-muted">
                {a ? `Version ${a.version}` : <Spinner size="sm" label="Loading version" />}
              </div>
            </div>
          </div>
        </Panel>

        <Panel
          title="Updates"
          action={
            <Button
              size="xs"
              icon="refresh"
              onClick={() => void check.refetch()}
              loading={check.isFetching}
            >
              Check for updates
            </Button>
          }
        >
          {check.error ? (
            <ErrorBanner
              error={check.error}
              title="Couldn't check for updates"
              onRetry={() => void check.refetch()}
            />
          ) : null}
          {c ? (
            c.available ? (
              <div className="col g3">
                <p className="t-small" style={{ margin: 0 }}>
                  <strong>Version {c.latestVersion} is available.</strong> You have{' '}
                  {c.currentVersion}.
                  {c.publishedAt ? ` Published ${formatDateTime(c.publishedAt)}.` : ''}
                </p>
                <UpdateActions check={c} />
                {!c.canInstallInApp ? (
                  <p className="t-caption" style={{ margin: 0 }}>
                    Run the downloaded installer to update. It keeps all your data.
                  </p>
                ) : null}
              </div>
            ) : (
              <InfoBanner status="success">
                You&apos;re up to date{c.latestVersion ? ` (latest is ${c.latestVersion})` : ''}.
              </InfoBanner>
            )
          ) : check.isPending ? (
            <Spinner size="sm" label="Checking for updates" />
          ) : null}
        </Panel>

        <Panel title="Details">
          {a ? (
            <div className="grid grid-halves g4">
              <Row label="Version">{a.version}</Row>
              <Row label="Platform">{a.platform}</Row>
              <Row label="Server">
                {a.serverUrl}
                {a.serverBuiltIn ? '' : ' (development default)'}
              </Row>
              <Row label="In-app updates">
                {a.updaterEnabled ? 'Enabled' : 'Not available in this build'}
              </Row>
              <div style={{ gridColumn: '1 / -1' }}>
                <Row label="Data folder">{a.dataDir}</Row>
              </div>
            </div>
          ) : (
            <Spinner size="sm" label="Loading details" />
          )}
        </Panel>
      </div>
    </div>
  );
}
