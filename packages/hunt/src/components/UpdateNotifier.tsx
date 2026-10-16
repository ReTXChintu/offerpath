import { Button, IconButton, ProgressBar } from '@offerpath/ui';
import { useEffect, useState } from 'react';

import { errorMessage, useAppName, useHuntClient } from '../client';
import type { UpdateCheck, UpdateProgress } from '../protocol';
import { useInstallUpdate, useOpenUrl, useUpdateCheck } from '../queries';
import { ErrorBanner } from './common';

const DISMISSED_KEY = 'offerpath.update-dismissed';
/** "Remind me later" hides the banner for this long, then it comes back. */
const REMIND_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

interface Dismissal {
  version: string;
  until: number;
}

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * "Install & restart" when this build can verify and install the update
 * itself; otherwise "Download" opens the installer from the server.
 */
export function UpdateActions({
  check,
  size = 'sm',
  compactError = false,
}: {
  check: UpdateCheck;
  size?: 'xs' | 'sm';
  compactError?: boolean;
}) {
  const install = useInstallUpdate();
  const openUrl = useOpenUrl();
  const client = useHuntClient();
  const [progress, setProgress] = useState<UpdateProgress | null>(null);

  useEffect(() => {
    if (!install.isPending) return;
    const unlisten = client.listen('update:progress', setProgress);
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [install.isPending, client]);

  if (!check.available) return null;

  if (install.isPending) {
    const pct = progress?.total
      ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
      : null;
    return (
      <div style={{ minWidth: 220 }}>
        <div className="t-caption mb1">
          {progress?.finished
            ? 'Installing… the app will restart.'
            : pct !== null
              ? `Downloading ${pct}%`
              : 'Downloading…'}
        </div>
        <ProgressBar pct={progress?.finished ? null : pct} thin label="Update download" />
      </div>
    );
  }

  return (
    <div>
      <div className="row g2">
        {check.canInstallInApp ? (
          <Button size={size} variant="primary" icon="refresh" onClick={() => install.mutate()}>
            Install &amp; restart
          </Button>
        ) : null}
        {check.downloadUrl ? (
          <Button
            size={size}
            variant={check.canInstallInApp ? 'ghost' : 'primary'}
            icon="download"
            onClick={() => {
              if (check.downloadUrl) openUrl.mutate(check.downloadUrl);
            }}
          >
            Download{check.sizeBytes ? ` (${formatMb(check.sizeBytes)})` : ''}
          </Button>
        ) : null}
      </div>
      {install.error ? (
        compactError ? (
          <div
            className="t-caption text-error mt1 truncate"
            style={{ maxWidth: 420 }}
            title={errorMessage(install.error)}
          >
            Update failed: {errorMessage(install.error)}
          </div>
        ) : (
          <div className="mt2">
            <ErrorBanner error={install.error} title="Update failed" />
          </div>
        )
      ) : null}
    </div>
  );
}

function readDismissal(): Dismissal | null {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(DISMISSED_KEY) ?? 'null',
    ) as Partial<Dismissal> | null;
    return parsed && typeof parsed.version === 'string' && typeof parsed.until === 'number'
      ? (parsed as Dismissal)
      : null;
  } catch {
    return null;
  }
}

/** A dismissible strip at the top of every page when a newer build is on the server. */
export function UpdateBanner() {
  const appName = useAppName();
  const check = useUpdateCheck();
  const [dismissal, setDismissal] = useState(readDismissal);
  const data = check.data;
  const latest = data?.latestVersion;
  const snoozed =
    dismissal !== null && dismissal.version === latest && Date.now() < dismissal.until;
  if (!data?.available || !latest || snoozed) return null;

  const dismiss = () => {
    const next = { version: latest, until: Date.now() + REMIND_AFTER_MS };
    try {
      window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable: dismissal lasts for this session only.
    }
    setDismissal(next);
  };

  return (
    <div className="banner" role="status">
      <div className="flex-1" style={{ minWidth: 240, fontSize: 13.5 }}>
        <strong>
          {appName} {latest} is available.
        </strong>{' '}
        <span className="text-muted">You have {data.currentVersion}.</span>
      </div>
      <UpdateActions check={data} compactError />
      <IconButton icon="x" size="sm" label="Remind me later" onClick={dismiss} />
    </div>
  );
}
