import { Button, Dot, ProgressBar, StatusBar, type DotTone } from '@offerpath/ui';
import type { ReactNode } from 'react';

import { useActivity } from '../activity';
import { AGENT_STATE_LABELS, isAgentRunning } from '../logic';
import {
  useAgentStatus,
  usePauseAgent,
  useResumeAgent,
  useStopJobHunt,
  useSyncStatus,
} from '../queries';
import type { AgentStatus, SyncStatus } from '../types';
import { HuntLink } from './common';

function agentTone(s: AgentStatus | undefined, running: boolean): DotTone {
  if (!s) return 'neutral';
  if (s.state === 'FAILED') return 'error';
  if (running) return s.paused ? 'warning' : 'success';
  if (['WAITING_FOR_APPROVAL', 'WAITING_FOR_USER', 'MANUAL_ACTION_REQUIRED'].includes(s.state))
    return 'warning';
  return 'neutral';
}

/** "Backend synced" / "Backend offline · 3 pending" / "Local only". */
export function syncLabel(sync: SyncStatus | undefined): { text: string; tone: DotTone } {
  if (sync?.connected) return { text: 'Backend synced', tone: 'success' };
  if (sync?.configured)
    return { text: `Backend offline · ${sync.pending} pending`, tone: 'warning' };
  return { text: 'Local only', tone: 'neutral' };
}

/**
 * The bottom strip: what the agent is doing, how many tasks wait in its
 * queue, pause / resume / stop while it runs, and the sync state.
 * `children` adds items (e.g. "Tutor running" from the learning side).
 */
export function AgentStatusBar({ children }: { children?: ReactNode }) {
  const status = useAgentStatus();
  const sync = useSyncStatus();
  const stop = useStopJobHunt();
  const pause = usePauseAgent();
  const resume = useResumeAgent();
  const activity = useActivity();
  const s = status.data;
  const running = s ? isAgentRunning(s.state) : false;
  const last = activity[activity.length - 1];
  const syncState = syncLabel(sync.data);

  return (
    <StatusBar label="Agent status">
      <div className="row items-center g2 shrink-0" style={{ minWidth: 200 }}>
        <Dot tone={agentTone(s, running)} />
        <strong style={{ color: 'var(--text-primary)', fontWeight: 650 }}>
          {s ? (s.paused ? 'Paused' : AGENT_STATE_LABELS[s.state]) : 'Connecting'}
        </strong>
        {s?.queued ? (
          <HuntLink
            to={{ to: 'agent' }}
            className="text-muted"
            title="Waiting for the agent; runs next"
          >
            · {s.queued} queued
          </HuntLink>
        ) : null}
        {s?.mock ? (
          <span className="badge badge-warning badge-sm" title="Claude and Chrome are simulated">
            MOCK
          </span>
        ) : null}
      </div>
      <div className="flex-1 truncate text-muted">
        {running
          ? (s?.currentActivity ?? last?.message ?? '')
          : s?.error
            ? s.error
            : (last?.message ?? '')}
      </div>
      {running && s && s.progress !== null ? (
        <div className="row items-center g2" style={{ minWidth: 140 }}>
          <div className="flex-1">
            <ProgressBar pct={s.progress} thin label="Agent progress" />
          </div>
          <span className="tabular">{s.progress}%</span>
        </div>
      ) : null}
      {running ? (
        <div className="row g1">
          {s?.paused ? (
            <Button
              size="xs"
              variant="subtle"
              icon="play"
              onClick={() => resume.mutate()}
              loading={resume.isPending}
            >
              Resume
            </Button>
          ) : (
            <Button
              size="xs"
              variant="subtle"
              icon="pause"
              onClick={() => pause.mutate()}
              loading={pause.isPending}
              disabled={s?.state === 'STOPPING'}
            >
              Pause
            </Button>
          )}
          <Button
            size="xs"
            variant="danger"
            icon="stop"
            onClick={() => stop.mutate()}
            loading={stop.isPending}
            disabled={s?.state === 'STOPPING'}
          >
            Stop
          </Button>
        </div>
      ) : null}
      {children}
      <HuntLink to={{ to: 'settings' }} className="row items-center g1 text-muted">
        <Dot tone={syncState.tone} size="sm" />
        <span>{syncState.text}</span>
      </HuntLink>
    </StatusBar>
  );
}
