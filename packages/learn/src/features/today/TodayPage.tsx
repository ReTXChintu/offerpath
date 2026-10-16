import {
  Alert,
  Badge,
  Button,
  Chips,
  EmptyState,
  Icon,
  PageHeader,
  Panel,
  Stat,
} from '@offerpath/ui';
import type { ReactNode } from 'react';

import { describeError, RequestError } from '../../components/AiOffline';
import { Spinner } from '../../components/ui';
import { learnPaths, useLearnNavigate } from '../../context';
import {
  useAddSkillGap,
  useStartDay,
  useTodayPlan,
  type GoalView,
  type HuntTodo,
  type InterviewPrepView,
  type SkillGapView,
  type TodayPlanView,
} from '../../lib/plan';
import { useStartInterview } from '../../lib/queries';
import { RoutineSection } from '../routine/RoutineSection';

/**
 * Today: the home screen (plan sections 3 and 5.2).
 *
 * One goal, one day: today's learning routine, what the hunt needs from the
 * user, the interviews ahead with their prep, the skills the best-match jobs
 * keep asking for, and the streak. "Start my day" records the day as begun.
 *
 * `agent` is the desktop's slot for the local agent's status.
 */
export function TodayPage({ agent }: { agent?: ReactNode }) {
  const { data: plan, isLoading, error, refetch } = useTodayPlan();
  const start = useStartDay();

  if (isLoading) return <Spinner label="Planning your day" />;

  if (!plan) {
    return (
      <>
        <PageHeader title="Today" />
        <Alert
          status="error"
          title="Today's plan did not load"
          actions={
            <Button size="sm" onClick={() => void refetch()}>
              Try again
            </Button>
          }
        >
          {describeError(error, 'Something went wrong. Try again.')}
        </Alert>
      </>
    );
  }

  const started = plan.startedAt !== null;

  return (
    <div>
      <PageHeader
        eyebrow={formatDate(plan.date)}
        title="Today"
        subtitle="What to learn, what the hunt needs from you, and what's coming."
        actions={
          started ? (
            <Badge variant="success" icon="check">
              Day started
            </Badge>
          ) : (
            <Button
              variant="primary"
              size="lg"
              icon="play"
              loading={start.isPending}
              onClick={() => start.mutate()}
            >
              Start my day
            </Button>
          )
        }
      />
      <RequestError error={start.error} className="mb4" />

      <div className="today-grid">
        <div className="col g5" style={{ minWidth: 0 }}>
          <Panel>
            <RoutineSection routine={plan.learning} />
          </Panel>
          <HuntTodos plan={plan} />
          <Interviews interviews={plan.interviews} />
        </div>

        <div className="col g5" style={{ minWidth: 0 }}>
          <GoalCard goal={plan.goal} streak={plan.streak} />
          {agent}
          <SkillGaps gaps={plan.skillGaps} />
        </div>
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  // The plan's own learning day (midnight UTC of a logical date).
  return new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function GoalCard({ goal, streak }: { goal: GoalView | null; streak: number }) {
  const navigate = useLearnNavigate();
  const hasGoal =
    goal !== null &&
    (goal.targetRoles.length > 0 || goal.targetCompanies.length > 0 || goal.targetDate !== null);

  return (
    <Panel
      title="Your goal"
      action={
        <Button variant="ghost" size="sm" onClick={() => navigate(learnPaths.settings)}>
          {hasGoal ? 'Edit' : 'Set it'}
        </Button>
      }
    >
      {hasGoal && goal ? (
        <div className="col g3">
          {goal.targetRoles.length > 0 ? (
            <div className="t-h4">{goal.targetRoles.join(' · ')}</div>
          ) : null}
          {goal.targetCompanies.length > 0 ? (
            <div>
              <div className="kv-label mb1">Companies</div>
              <Chips items={goal.targetCompanies} max={6} />
            </div>
          ) : null}
          {goal.locations.length > 0 ? (
            <div className="t-small row items-center g1">
              <Icon name="mapPin" size={13} /> {goal.locations.join(', ')}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="t-small">
          Set the roles, companies and date you are aiming for, and every day plans toward them.
        </div>
      )}
      <div className="grid grid-2 g3 mt4">
        <Stat
          label="Days left"
          value={goal?.daysLeft ?? '—'}
          tone={
            goal?.daysLeft !== null && goal?.daysLeft !== undefined && goal.daysLeft < 14
              ? 'warning'
              : 'default'
          }
        />
        <Stat
          label="Streak"
          value={`${streak} ${streak === 1 ? 'day' : 'days'}`}
          tone={streak > 0 ? 'success' : 'default'}
        />
      </div>
    </Panel>
  );
}

const TODO_LABEL: Record<HuntTodo['action'], string> = {
  APPROVE: 'Ready to approve',
  ANSWER: 'Questions to answer',
  ACT: 'A step for you',
};

function HuntTodos({ plan }: { plan: TodayPlanView }) {
  const navigate = useLearnNavigate();
  const { todos } = plan.hunt;

  return (
    <Panel
      title="The hunt needs you"
      action={
        <Button variant="ghost" size="sm" onClick={() => navigate(learnPaths.applications)}>
          All applications
        </Button>
      }
    >
      {!plan.desktopOnline ? (
        <div className="t-caption mb2">
          Your desktop is offline: the hunt waits for it. What it last synced is below.
        </div>
      ) : null}
      {todos.length === 0 ? (
        <div className="t-small">Nothing waiting for you. The hunt carries on by itself.</div>
      ) : (
        <div>
          {todos.map((todo) => (
            <div key={todo.applicationId} className="today-row">
              <div style={{ minWidth: 0 }}>
                <div className="t-h4" style={{ fontSize: 13.5 }}>
                  {todo.title}
                </div>
                <div className="t-caption">
                  {todo.company} · {TODO_LABEL[todo.action]}
                  {todo.action === 'ANSWER' && todo.questions > 0 ? ` (${todo.questions})` : ''}
                </div>
              </div>
              <Button
                size="sm"
                variant={todo.action === 'APPROVE' ? 'primary' : 'secondary'}
                onClick={() => navigate(learnPaths.application(todo.applicationId))}
              >
                {todo.action === 'APPROVE'
                  ? 'Review'
                  : todo.action === 'ANSWER'
                    ? 'Answer'
                    : 'Open'}
              </Button>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function Interviews({ interviews }: { interviews: InterviewPrepView[] }) {
  if (interviews.length === 0) return null;
  return (
    <Panel title="Interviews ahead">
      <div className="col g4">
        {interviews.map((prep, index) => (
          <InterviewPrep key={`${prep.applicationId}-${index}`} prep={prep} />
        ))}
      </div>
    </Panel>
  );
}

function InterviewPrep({ prep }: { prep: InterviewPrepView }) {
  const navigate = useLearnNavigate();
  const start = useStartInterview();
  const add = useAddSkillGap();
  const round = typeof prep.interview.round === 'string' ? prep.interview.round : '';

  const mock = async () => {
    try {
      const interview = await start.mutateAsync({ mode: 'TECHNICAL', targetLevel: 'MID' });
      navigate(learnPaths.interview(interview.id));
    } catch {
      // Shown below.
    }
  };

  return (
    <div>
      <div className="row items-start justify-between g3 wrap">
        <div style={{ minWidth: 0 }}>
          <div className="t-h4">
            {prep.company} · {prep.title}
          </div>
          <div className="t-caption">
            {round ? `${round} · ` : ''}
            {prep.daysLeft === 0
              ? 'today'
              : prep.daysLeft === 1
                ? 'tomorrow'
                : `in ${prep.daysLeft} days`}
          </div>
        </div>
        <Button size="sm" icon="mic" loading={start.isPending} onClick={() => void mock()}>
          Start a mock interview
        </Button>
      </div>
      {prep.technologies.length > 0 ? (
        <div className="mt3">
          <div className="kv-label mb1">Practise before the day</div>
          <div className="row g2 wrap">
            {prep.technologies.map((tech) =>
              tech.onRoadmap ? (
                <button
                  key={tech.id}
                  type="button"
                  className="chip chip-sm"
                  onClick={() => navigate(learnPaths.technology(tech.id))}
                >
                  {tech.name}
                </button>
              ) : (
                <button
                  key={tech.id}
                  type="button"
                  className="chip chip-sm chip-warning"
                  disabled={add.isPending}
                  onClick={() => add.mutate(tech.id)}
                  title="Not on your roadmap yet"
                >
                  <Icon name="plus" size={11} /> {tech.name}
                </button>
              ),
            )}
          </div>
        </div>
      ) : null}
      <RequestError error={start.error ?? add.error} className="mt3" />
    </div>
  );
}

function SkillGaps({ gaps }: { gaps: SkillGapView[] }) {
  const add = useAddSkillGap();

  return (
    <Panel title="Skill gaps">
      {gaps.length === 0 ? (
        <EmptyState
          dashed={false}
          icon="target"
          title="No gaps found yet"
          description="Skills your best-match jobs ask for, and you don't have yet, appear here."
        />
      ) : (
        <div>
          <div className="t-caption mb2">What your best-match jobs keep asking for.</div>
          {gaps.map((gap) => (
            <div key={gap.skill} className="today-row">
              <div style={{ minWidth: 0 }}>
                <div className="t-h4" style={{ fontSize: 13.5 }}>
                  {gap.skill}
                </div>
                <div className="t-caption">
                  {gap.jobs} {gap.jobs === 1 ? 'job' : 'jobs'}
                  {gap.technology ? '' : ' · not in the catalogue yet'}
                </div>
              </div>
              {gap.onRoadmap ? (
                <Badge variant="success" size="sm">
                  On your roadmap
                </Badge>
              ) : gap.technology ? (
                <Button
                  size="sm"
                  variant="secondary"
                  icon="plus"
                  loading={add.isPending && add.variables === gap.technology.id}
                  onClick={() => add.mutate(gap.technology!.id)}
                >
                  Add to roadmap
                </Button>
              ) : null}
            </div>
          ))}
          <RequestError error={add.error} className="mt3" />
        </div>
      )}
    </Panel>
  );
}
