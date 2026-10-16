import {
  Button,
  PageHeader,
  Panel,
  ProgressBar,
  Select,
  Stat,
  Table,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@offerpath/ui';
import { useMemo, useState } from 'react';

import { useActivity, useLogFeed } from '../activity';
import { ActivityFeed } from '../components/ActivityFeed';
import { ErrorBanner } from '../components/common';
import { QueuePanel } from '../components/QueuePanel';
import { AGENT_STATE_LABELS, formatDateTime, isAgentRunning } from '../logic';
import {
  useAgentStatus,
  useClearLogs,
  useExportLogs,
  useLogs,
  usePauseAgent,
  useResumeAgent,
  useRunEvents,
  useRuns,
  useStartJobHunt,
  useStopJobHunt,
} from '../queries';
import type { LogLevel } from '../types';

/** The agent: live activity, its queue, past runs and logs. */
export function AgentPage() {
  const status = useAgentStatus();
  const runs = useRuns(30);
  const start = useStartJobHunt();
  const stop = useStopJobHunt();
  const pause = usePauseAgent();
  const resume = useResumeAgent();
  const activity = useActivity();
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const runEvents = useRunEvents(selectedRun);
  const s = status.data;
  const running = s ? isAgentRunning(s.state) : false;
  const liveEvents = useMemo(
    () => (s?.runId ? activity.filter((e) => e.runId === s.runId) : activity),
    [activity, s?.runId],
  );

  return (
    <div>
      <PageHeader
        title="Agent"
        subtitle={
          s
            ? `${s.paused ? 'Paused' : AGENT_STATE_LABELS[s.state]}${s.currentActivity ? ` · ${s.currentActivity}` : ''}`
            : ''
        }
        actions={
          running ? (
            <>
              {s?.paused ? (
                <Button
                  variant="subtle"
                  icon="play"
                  onClick={() => resume.mutate()}
                  loading={resume.isPending}
                >
                  Resume
                </Button>
              ) : (
                <Button
                  variant="subtle"
                  icon="pause"
                  onClick={() => pause.mutate()}
                  loading={pause.isPending}
                >
                  Pause
                </Button>
              )}
              <Button
                variant="danger"
                icon="stop"
                onClick={() => stop.mutate()}
                loading={stop.isPending}
              >
                Stop
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              icon="play"
              onClick={() => start.mutate({})}
              loading={start.isPending}
            >
              Start Job Hunt
            </Button>
          )
        }
      />
      <ErrorBanner error={start.error ?? stop.error ?? pause.error ?? resume.error} />
      <div className="grid grid-6 g3 mb6">
        <Stat label="Discovered" value={s?.stats.jobsDiscovered ?? 0} />
        <Stat label="New" value={s?.stats.jobsNew ?? 0} />
        <Stat label="Relevant" value={s?.stats.relevant ?? 0} tone="info" />
        <Stat label="Awaiting approval" value={s?.stats.awaitingApproval ?? 0} tone="primary" />
        <Stat
          label="Errors"
          value={s?.stats.errors ?? 0}
          tone={s?.stats.errors ? 'error' : 'default'}
        />
        <Stat label="Claude cost" value={`$${(s?.stats.claudeCostUsd ?? 0).toFixed(2)}`} />
      </div>
      <div className="mb6">
        <QueuePanel />
      </div>

      <Tabs defaultValue="activity">
        <TabsList label="Agent">
          <TabsTrigger value="activity">Live activity</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>
        <TabsContent value="activity">
          <Panel>
            {running && s && s.progress !== null ? (
              <div className="mb4">
                <div className="row justify-between mb1 t-small">
                  <strong style={{ color: 'var(--text-primary)' }}>
                    {AGENT_STATE_LABELS[s.state]}
                  </strong>
                  <span className="tabular">{s.progress}%</span>
                </div>
                <ProgressBar pct={s.progress} label="Agent progress" />
              </div>
            ) : null}
            <ActivityFeed events={liveEvents} maxHeight="60vh" />
          </Panel>
        </TabsContent>
        <TabsContent value="runs">
          <div className="grid grid-halves g4">
            <Panel flush>
              <Table interactive bare>
                <thead>
                  <tr>
                    <th>Started</th>
                    <th>Kind</th>
                    <th>State</th>
                    <th>Jobs</th>
                    <th>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {(runs.data ?? []).map((r) => (
                    <tr
                      key={r.id}
                      className={selectedRun === r.id ? 'selected' : undefined}
                      aria-selected={selectedRun === r.id}
                      onClick={() => setSelectedRun(r.id)}
                    >
                      <td>
                        <div>{formatDateTime(r.startedAt)}</div>
                        {r.mock ? <div className="t-caption text-warning">mock</div> : null}
                      </td>
                      <td>
                        <div>{r.kind.replace('_', ' ').toLowerCase()}</div>
                        {r.discoverOnly ? (
                          <div className="t-caption">search only, no applications</div>
                        ) : null}
                        {r.prepareOnly ? (
                          <div className="t-caption">prepared jobs found earlier</div>
                        ) : null}
                      </td>
                      <td>
                        <div className={r.state === 'FAILED' ? 'text-error' : undefined}>
                          {AGENT_STATE_LABELS[r.state]}
                        </div>
                        {r.error ? (
                          <div className="t-caption text-error truncate" style={{ maxWidth: 240 }}>
                            {r.error}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        {r.stats.jobsDiscovered} / {r.stats.relevant} relevant
                      </td>
                      <td>${r.stats.claudeCostUsd.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {runs.data?.length === 0 ? (
                <p className="t-small text-muted p4" style={{ margin: 0 }}>
                  No runs yet.
                </p>
              ) : null}
            </Panel>
            <Panel title={selectedRun ? 'Run events' : 'Select a run'}>
              <ActivityFeed
                events={runEvents.data ?? []}
                maxHeight="60vh"
                compact
                autoScroll={false}
              />
            </Panel>
          </div>
        </TabsContent>
        <TabsContent value="logs">
          <LogViewer />
        </TabsContent>
      </Tabs>
    </div>
  );
}

const LEVEL_ORDER: LogLevel[] = ['DEBUG', 'INFO', 'WARN', 'ERROR'];

const LEVEL_COLOR: Record<LogLevel, string> = {
  ERROR: 'var(--error)',
  WARN: 'var(--warning)',
  INFO: 'var(--text-muted)',
  DEBUG: 'var(--text-muted)',
};

/** The desktop's log, filtered by level, with copy, export and clear. */
export function LogViewer() {
  const [level, setLevel] = useState<LogLevel>('INFO');
  const logs = useLogs(level);
  const live = useLogFeed();
  const clear = useClearLogs();
  const exportLogs = useExportLogs();
  const [copied, setCopied] = useState(false);
  const entries = useMemo(() => {
    const seen = new Set<string>();
    const all = [...(logs.data ?? []), ...live].filter(
      (e) => LEVEL_ORDER.indexOf(e.level) >= LEVEL_ORDER.indexOf(level),
    );
    return all.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true))).slice(-1500);
  }, [logs.data, live, level]);
  const copy = async () => {
    await navigator.clipboard.writeText(
      entries.map((e) => `${e.at} ${e.level} [${e.target}] ${e.message}`).join('\n'),
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <Panel
      title="Logs"
      action={
        <div className="row g2 items-center">
          <Select
            size="sm"
            aria-label="Minimum level"
            value={level}
            onChange={(e) => setLevel(e.target.value as LogLevel)}
          >
            {LEVEL_ORDER.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </Select>
          <Button size="xs" variant="ghost" icon="copy" onClick={() => void copy()}>
            {copied ? 'Copied' : 'Copy Logs'}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            icon="download"
            onClick={() => exportLogs.mutate()}
            loading={exportLogs.isPending}
          >
            Export Logs
          </Button>
          <Button size="xs" variant="danger" icon="trash" onClick={() => clear.mutate()}>
            Clear Logs
          </Button>
        </div>
      }
    >
      {exportLogs.data ? (
        <p className="t-caption text-success mb2" style={{ marginTop: 0 }}>
          Exported to {exportLogs.data}
        </p>
      ) : null}
      <div className="mono scroll-y selectable" style={{ fontSize: 11.5, maxHeight: '60vh' }}>
        {entries.map((e) => (
          <div
            key={e.id}
            className="row g3 items-start"
            style={{ padding: '2px 0', borderBottom: '1px solid var(--border)' }}
          >
            <span className="text-muted shrink-0">{new Date(e.at).toLocaleTimeString()}</span>
            <span
              className="shrink-0"
              style={{ width: 44, fontWeight: 700, color: LEVEL_COLOR[e.level] }}
            >
              {e.level}
            </span>
            <span className="text-muted shrink-0 truncate" style={{ maxWidth: 160 }}>
              {e.target}
            </span>
            <span className="pre-wrap">{e.message}</span>
          </div>
        ))}
        {entries.length === 0 ? (
          <p className="text-muted" style={{ margin: 0 }}>
            No log entries at this level.
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
