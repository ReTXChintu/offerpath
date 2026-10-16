import {
  Badge,
  Button,
  MatchScore,
  PageHeader,
  Panel,
  ProgressBar,
  Stat,
  Table,
} from '@offerpath/ui';

import { useActivity } from '../activity';
import { useHuntNavigator } from '../client';
import { ActivityFeed } from '../components/ActivityFeed';
import { ErrorBanner, HuntLink, HuntStatusBadge, InfoBanner, Loading } from '../components/common';
import {
  AGENT_STATE_LABELS,
  formatDateTime,
  greeting,
  interviewLine,
  isAgentRunning,
  timeAgo,
} from '../logic';
import {
  useDashboard,
  usePauseAgent,
  useProfile,
  useResumeAgent,
  useSetupStatus,
  useStartJobHunt,
  useStopJobHunt,
} from '../queries';

/** The hunt at a glance: today's numbers, what needs you, the agent's activity. */
export function DashboardPage() {
  const dashboard = useDashboard();
  const setup = useSetupStatus();
  const profile = useProfile();
  const start = useStartJobHunt();
  const stop = useStopJobHunt();
  const pause = usePauseAgent();
  const resume = useResumeAgent();
  const activity = useActivity();
  const nav = useHuntNavigator();

  const d = dashboard.data;
  const agent = d?.agent;
  const running = agent ? isAgentRunning(agent.state) : false;
  const name = profile.data?.personal.name?.split(' ')[0];
  const ready = setup.data
    ? (setup.data.mockMode || (setup.data.claude.authenticated && setup.data.chrome.installed)) &&
      setup.data.profile.ready
    : false;

  return (
    <div>
      <PageHeader
        eyebrow="Hunt"
        title={`${greeting()}${name ? `, ${name}` : ''}`}
        subtitle={
          running && agent
            ? `Job hunt running: ${agent.currentActivity ?? AGENT_STATE_LABELS[agent.state]}`
            : d?.lastRun
              ? `Last run ${timeAgo(d.lastRun.startedAt)} · ${AGENT_STATE_LABELS[d.lastRun.state]}`
              : "Your job hunt hasn't started yet."
        }
        actions={
          running ? (
            <>
              {agent?.paused ? (
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
              size="lg"
              icon="play"
              onClick={() => start.mutate({})}
              loading={start.isPending}
              disabled={!ready}
            >
              Start Job Hunt
            </Button>
          )
        }
      />
      <ErrorBanner error={start.error} title="Could not start the job hunt" />
      <ErrorBanner
        error={dashboard.error}
        title="Could not load the dashboard"
        onRetry={() => void dashboard.refetch()}
      />
      {setup.data && !ready ? (
        <InfoBanner status="warning" title="Almost ready">
          {!setup.data.profile.ready
            ? 'Complete your candidate profile (name, email, target roles and skills). '
            : ''}
          {!setup.data.mockMode && !setup.data.claude.authenticated
            ? 'Claude CLI is not signed in. '
            : ''}
          {!setup.data.mockMode && !setup.data.chrome.installed ? 'Chrome was not found. ' : ''}
          <HuntLink to={{ to: 'setup' }}>Open setup</HuntLink>
        </InfoBanner>
      ) : null}
      {agent?.error ? (
        <InfoBanner status="error" title="The last run failed">
          {agent.error}
        </InfoBanner>
      ) : null}

      {!d ? (
        dashboard.isLoading ? (
          <Loading label="Loading the dashboard" />
        ) : null
      ) : (
        <div className="grid grid-main-side g6">
          <div style={{ minWidth: 0 }}>
            <h2 className="t-eyebrow mb3">Today&apos;s job hunt</h2>
            <div className="grid grid-4 g3 mb6">
              <Stat label="Jobs discovered" value={d.today.jobsDiscovered} />
              <Stat label="Relevant" value={d.today.relevant} tone="info" />
              <Stat label="Awaiting approval" value={d.total.awaitingApproval} tone="primary" />
              <Stat label="Applied" value={d.today.applied} tone="success" />
              <Stat
                label="Manual action"
                value={d.total.manualAction + d.total.waitingForUser}
                tone="warning"
              />
              <Stat label="Interviews" value={d.total.interviews} tone="success" />
              <Stat label="Rejected" value={d.total.rejected} tone="error" />
              <Stat label="All jobs" value={d.total.jobsDiscovered} />
            </div>

            {d.upcomingInterviews.length > 0 ? (
              <Panel
                className="mb6"
                title={`${d.upcomingInterviews.length} upcoming interview${d.upcomingInterviews.length === 1 ? '' : 's'}`}
                action={<HuntLink to={{ to: 'applications' }}>All applications</HuntLink>}
              >
                <div className="col g2">
                  {d.upcomingInterviews.map((u) => (
                    <button
                      key={u.interview.id}
                      type="button"
                      className="list-row list-row-success"
                      onClick={() =>
                        nav.navigate({ to: 'application', applicationId: u.applicationId })
                      }
                    >
                      <span style={{ minWidth: 0 }}>
                        <span className="truncate" style={{ display: 'block', fontWeight: 650 }}>
                          {formatDateTime(u.interview.scheduledAt)} · {u.company}
                        </span>
                        <span className="t-small text-muted truncate" style={{ display: 'block' }}>
                          {u.jobTitle}
                          {interviewLine(u.interview) ? ` · ${interviewLine(u.interview)}` : ''}
                        </span>
                      </span>
                      <Badge variant="success">
                        {timeAgo(u.interview.scheduledAt).startsWith('in ')
                          ? timeAgo(u.interview.scheduledAt)
                          : 'Interview'}
                      </Badge>
                    </button>
                  ))}
                </div>
              </Panel>
            ) : null}

            {d.pendingActions.length > 0 ? (
              <Panel
                className="mb6"
                title={`${d.pendingActions.length} pending action${d.pendingActions.length === 1 ? '' : 's'}`}
                action={<HuntLink to={{ to: 'applications' }}>View all</HuntLink>}
              >
                <div className="col g2">
                  {d.pendingActions.slice(0, 6).map((item) => (
                    <div
                      key={item.application.id}
                      className="list-row clickable"
                      onClick={() =>
                        nav.navigate({ to: 'application', applicationId: item.application.id })
                      }
                    >
                      <span style={{ minWidth: 0 }}>
                        <span className="truncate" style={{ display: 'block', fontWeight: 650 }}>
                          {item.job.title}
                        </span>
                        <span className="t-small text-muted truncate" style={{ display: 'block' }}>
                          {item.job.company} · {item.job.location || item.job.source}
                        </span>
                      </span>
                      <span className="row g3 items-center shrink-0">
                        <MatchScore
                          score={item.analysis?.matchScore}
                          relevant={item.analysis?.relevant}
                          compact
                        />
                        <HuntStatusBadge status={item.application.status} />
                        <Button
                          size="xs"
                          variant={
                            item.application.status === 'READY_FOR_REVIEW' ? 'primary' : 'subtle'
                          }
                          onClick={(e) => {
                            e.stopPropagation();
                            nav.navigate({
                              to: 'application',
                              applicationId: item.application.id,
                            });
                          }}
                        >
                          {item.application.status === 'READY_FOR_REVIEW'
                            ? 'Review'
                            : item.application.status === 'WAITING_FOR_USER'
                              ? 'Answer'
                              : 'Continue'}
                        </Button>
                      </span>
                    </div>
                  ))}
                </div>
              </Panel>
            ) : null}

            <Panel
              flush
              title="Latest jobs"
              action={<HuntLink to={{ to: 'jobs' }}>All jobs</HuntLink>}
            >
              {d.latestJobs.length === 0 ? (
                <p className="t-small text-muted p5" style={{ margin: 0 }}>
                  No jobs yet. Start a job hunt to discover recent postings.
                </p>
              ) : (
                <Table interactive bare>
                  <thead>
                    <tr>
                      <th>Job</th>
                      <th>Source</th>
                      <th>Match</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.latestJobs.map((item) => (
                      <tr
                        key={item.job.id}
                        onClick={() => nav.navigate({ to: 'job', jobId: item.job.id })}
                      >
                        <td>
                          <div className="cell-title">{item.job.title}</div>
                          <div className="t-caption">
                            {item.job.company} · {item.job.location}
                          </div>
                        </td>
                        <td>{item.job.source}</td>
                        <td>
                          <MatchScore
                            score={item.analysis?.matchScore}
                            relevant={item.analysis?.relevant}
                            compact
                          />
                        </td>
                        <td>
                          <HuntStatusBadge status={item.job.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Panel>
          </div>

          <div className="col g6" style={{ minWidth: 0 }}>
            <Panel
              title="Agent activity"
              action={<HuntLink to={{ to: 'agent' }}>Details</HuntLink>}
            >
              {running && agent ? (
                <div className="mb3">
                  <div className="row justify-between mb1">
                    <strong style={{ fontSize: 13.5 }}>{AGENT_STATE_LABELS[agent.state]}</strong>
                    <span className="t-caption tabular">
                      {agent.progress !== null ? `${agent.progress}%` : ''}
                    </span>
                  </div>
                  <ProgressBar
                    pct={agent.progress ?? (agent.paused ? 0 : 5)}
                    label="Job hunt progress"
                  />
                  <div className="grid grid-3 g2 mt3 t-small">
                    <div>
                      <div className="text-muted">Discovered</div>
                      <strong>{agent.stats.jobsDiscovered}</strong>
                    </div>
                    <div>
                      <div className="text-muted">Relevant</div>
                      <strong>{agent.stats.relevant}</strong>
                    </div>
                    <div>
                      <div className="text-muted">Awaiting approval</div>
                      <strong>{agent.stats.awaitingApproval}</strong>
                    </div>
                  </div>
                </div>
              ) : null}
              <ActivityFeed events={activity.slice(-40)} maxHeight="360px" compact />
            </Panel>
            <Panel
              title="Recent applications"
              action={<HuntLink to={{ to: 'applications' }}>All</HuntLink>}
            >
              {d.recentApplications.length === 0 ? (
                <p className="t-small text-muted" style={{ margin: 0 }}>
                  No applications yet.
                </p>
              ) : (
                <div className="col g2">
                  {d.recentApplications.slice(0, 6).map((item) => (
                    <div
                      key={item.application.id}
                      className="row justify-between items-center g2"
                      style={{ cursor: 'pointer' }}
                      onClick={() =>
                        nav.navigate({ to: 'application', applicationId: item.application.id })
                      }
                    >
                      <span style={{ minWidth: 0 }}>
                        <span className="truncate" style={{ display: 'block', fontWeight: 550 }}>
                          {item.job.title}
                        </span>
                        <span className="t-caption truncate" style={{ display: 'block' }}>
                          {item.job.company} · {timeAgo(item.application.updatedAt)}
                        </span>
                      </span>
                      <HuntStatusBadge status={item.application.status} size="sm" />
                    </div>
                  ))}
                </div>
              )}
            </Panel>
            <Panel title="Your materials">
              <div className="col g2 t-small">
                <HuntLink to={{ to: 'candidate' }}>Candidate profile</HuntLink>
                <HuntLink to={{ to: 'resumes' }}>Resumes</HuntLink>
                <HuntLink to={{ to: 'job-sites' }}>Job-site profiles</HuntLink>
              </div>
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
