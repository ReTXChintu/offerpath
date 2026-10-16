import {
  AGENT_STATE_LABELS,
  isAgentRunning,
  useAgentStatus,
  useStartJobHunt,
  useStopJobHunt,
} from '@offerpath/hunt';
import { TodayPage } from '@offerpath/learn';
import { Button, Panel, StatusPill } from '@offerpath/ui';

import { RequireAccount } from '../learn';
import { NavLink } from '../shell/NavLink';

/** The local agent on Today: what it is doing, and start / stop. */
function AgentPanel() {
  const status = useAgentStatus();
  const start = useStartJobHunt();
  const stop = useStopJobHunt();
  const s = status.data;
  const running = s ? isAgentRunning(s.state) : false;

  return (
    <Panel
      title="Agent on this desktop"
      action={
        <StatusPill tone={running ? 'success' : 'neutral'}>
          {s ? (s.paused ? 'Paused' : AGENT_STATE_LABELS[s.state]) : 'Connecting'}
        </StatusPill>
      }
    >
      {s?.currentActivity ? <div className="t-small mb2">{s.currentActivity}</div> : null}
      <div className="t-caption mb3">
        {s ? `${s.queued} queued` : ' '}
        {s && s.stats.applied > 0 ? ` · ${s.stats.applied} applied this run` : ''}
      </div>
      <div className="row g2 wrap">
        {running ? (
          <Button
            size="sm"
            variant="secondary"
            loading={stop.isPending}
            onClick={() => stop.mutate()}
          >
            Stop the hunt
          </Button>
        ) : (
          <Button
            size="sm"
            variant="primary"
            icon="play"
            loading={start.isPending}
            onClick={() => start.mutate({})}
          >
            Start a job hunt
          </Button>
        )}
        <NavLink href="/agent" className="btn btn-ghost btn-sm">
          Activity
        </NavLink>
      </div>
    </Panel>
  );
}

export function DesktopToday() {
  return (
    <RequireAccount>
      <TodayPage agent={<AgentPanel />} />
    </RequireAccount>
  );
}
