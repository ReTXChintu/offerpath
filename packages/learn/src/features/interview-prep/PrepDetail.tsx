import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  Field,
  Input,
  PageHeader,
  Panel,
  ProgressBar,
  Spinner as UiSpinner,
  Stat,
  type BadgeVariant,
} from '@offerpath/ui';
import { useState } from 'react';

import { describeError } from '../../components/AiOffline';
import { Spinner } from '../../components/ui';
import { learnPaths, useLearnNavigate } from '../../context';
import {
  useDeletePrep,
  useInterviewPrep,
  usePrepAiSource,
  useRegeneratePrep,
  useUpdatePrep,
  type PrepPlan,
  type PrepView,
} from '../../lib/interview-prep';
import {
  countdown,
  formatDay,
  formatWhen,
  isoToLocalInputs,
  isPast,
  localDateTimeToIso,
  sameDay,
  startOfDay,
} from '../../lib/when';

import { PrepQuestionCard } from './PrepQuestion';
import {
  AiSourceNotice,
  formatScore,
  generatedByLabel,
  KIND_ORDER,
  kindLabel,
  PrepStatusBadge,
  prepTitle,
  scoreVariant,
} from './shared';

/**
 * One interview's prep: while AI writes it, a progress state that polls;
 * then the plan (summary, focus areas, a day-by-day schedule) beside the
 * questions to practise, grouped by kind.
 */
export function PrepDetail({ prepId }: { prepId: string }) {
  const navigate = useLearnNavigate();
  const { data: prep, isLoading, error, refetch } = useInterviewPrep(prepId);
  const regenerate = useRegeneratePrep(prepId);
  const remove = useDeletePrep();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);

  if (isLoading) return <Spinner label="Loading the interview prep" />;
  if (!prep) {
    return (
      <div>
        <PageHeader title="Interview prep" />
        <Alert
          status="error"
          title="This prep did not load"
          actions={
            <>
              <Button size="sm" onClick={() => void refetch()}>
                Try again
              </Button>
              <Button size="sm" variant="ghost" onClick={() => navigate(learnPaths.interviewPreps)}>
                All preps
              </Button>
            </>
          }
        >
          {describeError(error)}
        </Alert>
      </div>
    );
  }

  const passed = isPast(prep.scheduledAt);
  const by = generatedByLabel(prep.generatedBy);

  return (
    <div>
      <PageHeader
        eyebrow="Interview prep"
        title={prepTitle(prep)}
        subtitle={
          <span className="row items-center g2 wrap">
            <span>{formatWhen(prep.scheduledAt)}</span>
            <Badge variant={passed ? 'neutral' : 'primary'} size="sm">
              {passed ? 'Passed' : countdown(prep.scheduledAt)}
            </Badge>
            <PrepStatusBadge status={prep.status} />
            {by && prep.status !== 'GENERATING' ? (
              <Badge variant="neutral" size="sm" icon="sparkles">
                {by}
              </Badge>
            ) : null}
          </span>
        }
        actions={
          <>
            <Button
              variant="ghost"
              icon="arrowLeft"
              onClick={() => navigate(learnPaths.interviewPreps)}
            >
              All preps
            </Button>
            <Button icon="pencil" onClick={() => setEditing(true)}>
              Edit
            </Button>
            {prep.status === 'READY' ? (
              <Button icon="refresh" onClick={() => setConfirmRegenerate(true)}>
                Write it again
              </Button>
            ) : null}
            <Button variant="danger" icon="trash" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          </>
        }
      />

      {regenerate.error ? (
        <Alert status="error" className="mb4">
          {describeError(regenerate.error)}
        </Alert>
      ) : null}
      {remove.error ? (
        <Alert status="error" className="mb4">
          {describeError(remove.error)}
        </Alert>
      ) : null}

      {prep.status === 'GENERATING' ? (
        <Generating />
      ) : prep.status === 'FAILED' ? (
        <Alert
          status="error"
          title="The prep did not finish"
          actions={
            <Button
              size="sm"
              variant="primary"
              icon="refresh"
              loading={regenerate.isPending}
              onClick={() => regenerate.mutate()}
            >
              Try again
            </Button>
          }
        >
          {prep.error ?? 'Something went wrong while writing it.'}
        </Alert>
      ) : (
        <Ready prep={prep} />
      )}

      {editing ? <EditDialog prep={prep} onClose={() => setEditing(false)} /> : null}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this interview prep?"
        description="Its plan, questions and your practice answers go with it."
        confirmLabel="Delete"
        destructive
        loading={remove.isPending}
        onConfirm={() =>
          remove.mutate(prep.id, {
            onSuccess: () => navigate(learnPaths.interviewPreps, { replace: true }),
            onSettled: () => setConfirmDelete(false),
          })
        }
      />
      <ConfirmDialog
        open={confirmRegenerate}
        onOpenChange={setConfirmRegenerate}
        title="Write the plan and questions again?"
        description="AI writes a fresh plan and new questions for the time left. Your practice answers here are replaced."
        confirmLabel="Write it again"
        loading={regenerate.isPending}
        onConfirm={() =>
          regenerate.mutate(undefined, { onSettled: () => setConfirmRegenerate(false) })
        }
      />
    </div>
  );
}

function Generating() {
  const ai = usePrepAiSource();
  return (
    <div className="prep-layout">
      <Panel>
        <div className="row items-center g3" role="status" aria-live="polite">
          <UiSpinner label="Preparing" />
          <div>
            <div className="t-h4">Writing your plan and questions…</div>
            <div className="t-small">
              This usually takes a minute or two. The page updates by itself; you can leave and come
              back.
            </div>
          </div>
        </div>
        <ProgressBar pct={null} thin label="Preparing" />
      </Panel>
      <AiSourceNotice source={ai.data} loading={ai.isLoading} />
    </div>
  );
}

function Ready({ prep }: { prep: PrepView }) {
  const { answered, total, averageScore } = prep.progress;
  return (
    <div className="prep-layout">
      <div className="col g4" style={{ minWidth: 0 }}>
        <Panel title="Your practice">
          <div className="grid grid-2 g3">
            <Stat label="Answered" value={`${answered}/${total}`} />
            <Stat
              label="Average score"
              value={formatScore(averageScore)}
              tone={
                averageScore === null
                  ? 'default'
                  : averageScore >= 7
                    ? 'success'
                    : averageScore >= 4
                      ? 'warning'
                      : 'error'
              }
            />
          </div>
          <div className="mt3">
            <ProgressBar
              pct={total > 0 ? (answered / total) * 100 : 0}
              thin
              label={`${answered} of ${total} questions answered`}
            />
          </div>
        </Panel>
        {prep.plan ? <PlanPanels plan={prep.plan} scheduledAt={prep.scheduledAt} /> : null}
        {prep.technologies.length > 0 ? (
          <Panel title="Technologies">
            <div className="row g2 wrap">
              {prep.technologies.map((t) => (
                <span key={t} className="chip chip-sm">
                  {t}
                </span>
              ))}
            </div>
          </Panel>
        ) : null}
      </div>
      <Questions prep={prep} />
    </div>
  );
}

const PRIORITY: Record<number, { label: string; variant: BadgeVariant }> = {
  1: { label: 'Top priority', variant: 'error' },
  2: { label: 'High', variant: 'warning' },
  3: { label: 'Worth a look', variant: 'neutral' },
};

function PlanPanels({ plan, scheduledAt }: { plan: PrepPlan; scheduledAt: string }) {
  const focus = [...plan.focusAreas].sort((a, b) => a.priority - b.priority);
  const schedule = [...plan.schedule].sort((a, b) => a.day - b.day);
  // The last day is the day before the interview; count back from there.
  const interviewDay = startOfDay(new Date(scheduledAt));
  const lastDay = schedule.length > 0 ? schedule[schedule.length - 1]!.day : 0;
  const today = new Date();

  return (
    <>
      <Panel title="What to expect">
        <p className="t-body" style={{ margin: 0 }}>
          {plan.summary}
        </p>
      </Panel>

      <Panel title="Focus areas">
        <ol className="prep-focus">
          {focus.map((area) => {
            const p = PRIORITY[area.priority] ?? PRIORITY[3]!;
            return (
              <li key={area.topic} className="today-row" style={{ alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <div className="t-h4" style={{ fontSize: 13.5 }}>
                    {area.topic}
                  </div>
                  <div className="t-small">{area.why}</div>
                </div>
                <Badge variant={p.variant} size="sm">
                  {p.label}
                </Badge>
              </li>
            );
          })}
        </ol>
      </Panel>

      <Panel title="Day by day">
        <ol className="prep-schedule">
          {schedule.map((entry) => {
            const date = new Date(interviewDay);
            date.setDate(date.getDate() - (lastDay - entry.day + 1));
            const isToday = sameDay(date, today);
            const done = startOfDay(date).getTime() < startOfDay(today).getTime();
            return (
              <li
                key={entry.day}
                className={`prep-day${isToday ? ' is-today' : ''}${done ? ' is-done' : ''}`}
                aria-current={isToday ? 'date' : undefined}
              >
                <div className="prep-day-when">
                  <div className="t-caption">Day {entry.day}</div>
                  <div className="t-small" style={{ fontWeight: 600 }}>
                    {formatDay(date)}
                  </div>
                  {isToday ? (
                    <Badge variant="primary" size="sm">
                      Today
                    </Badge>
                  ) : null}
                </div>
                <div className="t-small">{entry.focus}</div>
              </li>
            );
          })}
          <li className="prep-day is-interview">
            <div className="prep-day-when">
              <div className="t-caption">Interview</div>
              <div className="t-small" style={{ fontWeight: 600 }}>
                {formatDay(interviewDay)}
              </div>
            </div>
            <div className="t-small">{formatWhen(scheduledAt)}. Rest well the night before.</div>
          </li>
        </ol>
      </Panel>
    </>
  );
}

function Questions({ prep }: { prep: PrepView }) {
  const known = new Set<string>(KIND_ORDER);
  const kinds = [
    ...KIND_ORDER,
    ...new Set(prep.questions.map((q) => q.kind).filter((k) => !known.has(k))),
  ];
  const groups = kinds
    .map((kind) => ({
      kind,
      questions: prep.questions.filter((q) => q.kind === kind).sort((a, b) => a.order - b.order),
    }))
    .filter((g) => g.questions.length > 0);

  return (
    <div className="col g5" style={{ minWidth: 0 }}>
      <div>
        <h2 className="t-h3">Practise the questions</h2>
        <div className="t-small mt1">
          Answer as you would out loud. AI scores it out of 10 and shows what you covered and what
          you missed; the key points appear once you have tried.
        </div>
      </div>
      {groups.map((group) => {
        const answered = group.questions.filter((q) => q.answeredAt !== null);
        const avg =
          answered.length > 0
            ? answered.reduce((sum, q) => sum + (q.score ?? 0), 0) / answered.length
            : null;
        return (
          <section key={group.kind} aria-label={kindLabel(group.kind)} className="col g3">
            <div className="row items-center justify-between g2">
              <h3 className="t-h4">
                {kindLabel(group.kind)}{' '}
                <span className="t-caption">
                  {answered.length}/{group.questions.length}
                </span>
              </h3>
              {avg !== null ? (
                <Badge variant={scoreVariant(avg)} size="sm">
                  Average {formatScore(avg)}
                </Badge>
              ) : null}
            </div>
            {group.questions.map((question) => (
              <PrepQuestionCard
                key={question.id}
                prepId={prep.id}
                question={question}
                number={prep.questions.indexOf(question) + 1}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}

function EditDialog({ prep, onClose }: { prep: PrepView; onClose: () => void }) {
  const update = useUpdatePrep(prep.id);
  const initial = isoToLocalInputs(prep.scheduledAt);
  const [company, setCompany] = useState(prep.company ?? '');
  const [role, setRole] = useState(prep.role ?? '');
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const scheduledAt = localDateTimeToIso(date, time);
    if (!scheduledAt) {
      setError("Pick the interview's date and time.");
      return;
    }
    setError(null);
    update.mutate(
      { company: company.trim() || null, role: role.trim() || null, scheduledAt },
      { onSuccess: onClose },
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Edit the interview"
      size="md"
      dismissable={false}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={update.isPending}>
            Cancel
          </Button>
          <Button variant="primary" loading={update.isPending} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="col g4">
        <div className="grid grid-halves g3">
          <Field label="Company">
            <Input value={company} onChange={(e) => setCompany(e.target.value)} maxLength={120} />
          </Field>
          <Field label="Role">
            <Input value={role} onChange={(e) => setRole(e.target.value)} maxLength={120} />
          </Field>
        </div>
        <div className="grid grid-halves g3">
          <Field label="Interview date" required error={error ?? undefined}>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Time" required hint="Your local time.">
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>
        {update.error ? <Alert status="error">{describeError(update.error)}</Alert> : null}
      </div>
    </Dialog>
  );
}
