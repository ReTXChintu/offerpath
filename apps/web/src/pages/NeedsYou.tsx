import {
  AGENT_STATE_LABELS,
  ErrorBanner,
  isAgentRunning,
  useAgentStatus,
  useApplications,
  useHuntNavigator,
  useStartJobHunt,
  useStopJobHunt,
  type ApplicationListItem,
  type ApplicationStatus,
} from '@offerpath/hunt';
import { Button, EmptyState, PageHeader, Panel, StatusPill } from '@offerpath/ui';

const GROUPS: { status: ApplicationStatus; title: string; action: string; hint: string }[] = [
  {
    status: 'READY_FOR_REVIEW',
    title: 'Ready to approve',
    action: 'Review',
    hint: 'Prepared and waiting for your yes. Nothing is sent without it.',
  },
  {
    status: 'WAITING_FOR_USER',
    title: 'Questions to answer',
    action: 'Answer',
    hint: 'The form asked something only you can answer.',
  },
  {
    status: 'MANUAL_ACTION_REQUIRED',
    title: 'A step for you',
    action: 'Open',
    hint: 'A login, a CAPTCHA or an email the agent could not do itself.',
  },
];

/**
 * The hunt's "Needs you" (plan 5.3): approvals and questions, and the
 * desktop's agent started or stopped from here. Every action is a request to
 * the desktop, which runs it through the same approval-gated code as its own
 * buttons.
 */
export function NeedsYouPage() {
  const applications = useApplications();
  const nav = useHuntNavigator();
  const items = applications.data ?? [];

  const groups = GROUPS.map((g) => ({
    ...g,
    items: items
      .filter((i) => i.application.status === g.status)
      .sort((a, b) => b.application.updatedAt.localeCompare(a.application.updatedAt)),
  }));
  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div>
      <PageHeader
        eyebrow="Hunt"
        title="Needs you"
        subtitle="Approvals and questions from the hunt your desktop runs."
      />
      <ErrorBanner error={applications.error} onRetry={() => void applications.refetch()} />
      <div className="today-grid">
        <div className="col g5" style={{ minWidth: 0 }}>
          {applications.isLoading ? null : total === 0 ? (
            <EmptyState
              icon="checkCircle"
              title="Nothing needs you"
              description="When the hunt prepares an application or hits a question, it waits here."
            />
          ) : (
            groups
              .filter((g) => g.items.length > 0)
              .map((g) => (
                <Panel key={g.status} title={`${g.title} · ${g.items.length}`}>
                  <div className="t-caption mb2">{g.hint}</div>
                  {g.items.map((item) => (
                    <Row
                      key={item.application.id}
                      item={item}
                      action={g.action}
                      onOpen={() =>
                        nav.navigate({ to: 'application', applicationId: item.application.id })
                      }
                    />
                  ))}
                </Panel>
              ))
          )}
        </div>
        <DesktopActions />
      </div>
    </div>
  );
}

function Row({
  item,
  action,
  onOpen,
}: {
  item: ApplicationListItem;
  action: string;
  onOpen: () => void;
}) {
  const questions = item.application.pendingQuestions?.length ?? 0;
  return (
    <div className="today-row">
      <div style={{ minWidth: 0 }}>
        <div className="t-h4" style={{ fontSize: 13.5 }}>
          {item.job.title}
        </div>
        <div className="t-caption">
          {item.job.company}
          {questions > 0 ? ` · ${questions} ${questions === 1 ? 'question' : 'questions'}` : ''}
        </div>
      </div>
      <Button size="sm" variant={action === 'Review' ? 'primary' : 'secondary'} onClick={onOpen}>
        {action}
      </Button>
    </div>
  );
}

/** Start a job hunt / Company careers / Stop, on the desktop. */
export function DesktopActions() {
  const status = useAgentStatus();
  const start = useStartJobHunt();
  const stop = useStopJobHunt();
  const s = status.data;
  const running = s ? isAgentRunning(s.state) : false;
  const source = start.isPending ? (start.variables?.sources?.[0] ?? 'all') : null;

  return (
    <Panel
      title="Your desktop's agent"
      action={
        <StatusPill tone={running ? 'success' : 'neutral'}>
          {s ? (s.paused ? 'Paused' : AGENT_STATE_LABELS[s.state]) : 'Checking'}
        </StatusPill>
      }
    >
      <div className="t-small mb3">
        The hunt runs on your desktop, in your own Chrome. Start or stop it from here; it keeps
        going with this page closed.
        {s && s.queued > 0 ? ` ${s.queued} queued.` : ''}
      </div>
      <ErrorBanner error={start.error ?? stop.error} />
      <div className="col g2">
        <Button
          variant="primary"
          icon="play"
          loading={source === 'all'}
          disabled={start.isPending}
          onClick={() => start.mutate({})}
        >
          Start a job hunt
        </Button>
        <Button
          icon="building"
          loading={source === 'Company careers'}
          disabled={start.isPending}
          onClick={() => start.mutate({ sources: ['Company careers'] })}
        >
          Company careers
        </Button>
        <Button
          variant="danger"
          icon="stop"
          loading={stop.isPending}
          disabled={!running}
          onClick={() => stop.mutate()}
        >
          Stop
        </Button>
      </div>
      {start.isSuccess ? (
        <div className="t-caption mt3" role="status">
          {start.data?.queued
            ? 'Queued on your desktop. It starts when the agent is free.'
            : 'Started on your desktop.'}
        </div>
      ) : null}
    </Panel>
  );
}
