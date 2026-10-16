import { Button, Panel, Select } from '@offerpath/ui';

import { useQueueProfileUpdates, useSaveSettings, useSettings } from '../queries';
import type { PlatformProfileView, ProfileSyncMode, ProfileSyncSettings } from '../types';
import { ErrorBanner } from './common';

const MODES: { value: ProfileSyncMode; label: string }[] = [
  { value: 'NIGHTLY', label: 'Every night' },
  { value: 'ASK', label: 'Ask me first' },
  { value: 'IMMEDIATE', label: 'Right away' },
  { value: 'OFF', label: 'Off' },
];

const hourLabel = (h: number) => `${((h + 11) % 12) + 1}:00 ${h < 12 ? 'AM' : 'PM'}`;

/**
 * When profiles that fell behind your desktop profile get updated. Updates
 * take Chrome over for a while, so by default they wait for the night
 * instead of getting in the way of applications.
 */
export function AutoUpdatePanel({ views, busy }: { views: PlatformProfileView[]; busy: boolean }) {
  const settings = useSettings();
  const save = useSaveSettings();
  const queue = useQueueProfileUpdates();
  const behind = views.filter(
    (v) => v.outOfDate && v.profile.autoSync && v.profile.status === 'SYNCED',
  );
  const queued = views.filter((v) => v.profile.queuedAt).length;
  const current: ProfileSyncSettings = settings.data?.profileSync ?? {
    mode: 'NIGHTLY',
    nightlyHour: 0,
  };

  const update = (patch: Partial<ProfileSyncSettings>) => {
    if (!settings.data) return;
    save.mutate({ ...settings.data, profileSync: { ...current, ...patch } });
  };

  const explanation: Record<ProfileSyncMode, string> = {
    NIGHTLY: `Profiles that fell behind are updated one by one from ${hourLabel(current.nightlyHour)} (local time), when the agent is free, so they never interrupt applications during the day.`,
    ASK: 'You get a notification when profiles fall behind; nothing runs until you click Update all now.',
    IMMEDIATE:
      'Profiles are updated as soon as you change your desktop profile and the agent is free.',
    OFF: 'Profiles are only updated when you click Update on a site or Update all now.',
  };

  return (
    <Panel title="Automatic updates" className="mb4">
      <ErrorBanner error={save.error ?? queue.error} />
      <div className="row g3 wrap mb2 items-center">
        <Select
          size="sm"
          value={current.mode}
          onChange={(e) => update({ mode: e.target.value as ProfileSyncMode })}
          aria-label="When to update profiles automatically"
        >
          {MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </Select>
        {current.mode === 'NIGHTLY' ? (
          <Select
            size="sm"
            value={current.nightlyHour}
            onChange={(e) => update({ nightlyHour: Number(e.target.value) })}
            aria-label="Start time"
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                from {hourLabel(h)}
              </option>
            ))}
          </Select>
        ) : null}
        <Button
          size="sm"
          variant={behind.length ? 'primary' : 'secondary'}
          icon="refresh"
          onClick={() => queue.mutate()}
          loading={queue.isPending}
          disabled={behind.length === 0}
          title={busy ? "They'll start one by one as soon as the agent is free" : undefined}
        >
          Update all now{behind.length ? ` (${behind.length})` : ''}
        </Button>
      </div>
      <p className="t-small text-muted" style={{ margin: 0 }}>
        {explanation[current.mode]}
        {queued
          ? ` ${queued} queued: they start as soon as the agent is free.`
          : behind.length
            ? ` ${behind.length} behind your profile now.`
            : ' All profiles are up to date.'}
      </p>
    </Panel>
  );
}
