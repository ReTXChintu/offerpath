import { formatBytes } from '@offerpath/hunt';
import { Icon, type IconName } from '@offerpath/ui';
import { useEffect, useState } from 'react';

import { apiBaseUrl, apiOrigin } from '../config';

interface DownloadInfo {
  fileName: string;
  version: string | null;
  sizeBytes: number;
  url: string;
}

interface Downloads {
  android: DownloadInfo | null;
  windows: DownloadInfo | null;
}

const APPS: { key: keyof Downloads; label: string; icon: IconName }[] = [
  { key: 'windows', label: 'Windows', icon: 'monitor' },
  { key: 'android', label: 'Android', icon: 'smartphone' },
];

/**
 * Download buttons for the desktop installer and the Android app.
 *
 * `/downloads` needs no sign-in, so this works on the sign-in page too: the
 * desktop is where Offerpath does its work, and getting it should not be
 * hidden behind an account. Renders nothing until there is a build to offer.
 */
export function GetTheApps({ base = apiBaseUrl() }: { base?: string }) {
  const [downloads, setDownloads] = useState<Downloads | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${base}/downloads`)
      .then((r) => (r.ok ? (r.json() as Promise<Downloads>) : null))
      .then((d) => {
        if (!cancelled) setDownloads(d);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [base]);

  const origin = apiOrigin(base);
  const available = APPS.filter((app) => downloads?.[app.key]);
  if (available.length === 0) return null;

  return (
    <div className="get-the-apps">
      <div className="t-caption mb2">Get the apps</div>
      <div className="row g2" style={{ flexWrap: 'wrap' }}>
        {available.map((app) => {
          const info = downloads![app.key]!;
          return (
            <a
              key={app.key}
              className="btn btn-secondary"
              href={`${origin}${info.url}`}
              download
              aria-label={`Download Offerpath for ${app.label}`}
            >
              <Icon name={app.icon} size={16} />
              <span>
                {app.label}
                <span className="t-caption" style={{ marginLeft: 6 }}>
                  {info.version ? `v${info.version} · ` : ''}
                  {formatBytes(info.sizeBytes)}
                </span>
              </span>
              <Icon name="download" size={14} />
            </a>
          );
        })}
      </div>
    </div>
  );
}
