import { useState } from 'react';

import { Icon } from '../../components/Icon';
import { Badge, Button, Card, ProgressBar, Spinner, StateBlock } from '../../components/ui';
import { RecallPrompt } from '../recall/RecallPrompt';
import {
  useGenerateRoutine,
  useRecallDue,
  useTodayRoutine,
  useUpdateRoutineItem,
  type RoutineItemView,
  type RoutineView,
} from '../../lib/queries';
import { exercisePath, learnPaths, useLearnNavigate } from '../../context';

const KIND_ICON: Record<string, string> = {
  LEARN: 'learn',
  RECALL: 'brain',
  CODE: 'practice',
  BLIND_CODE: 'eye',
  DEBUG: 'bug',
  EXPLAIN: 'interview',
  PROJECT: 'layers',
  CHECKPOINT: 'target',
  REVIEW: 'refresh',
  INTERVIEW: 'interview',
};

/**
 * Today's learning routine, as a section of the Today page.
 *
 * ForgeRoutine's routine screen without its week strip (Today shows the
 * streak instead): the items with their minutes, recall prompts between
 * them, carried work, and the "done for today" note.
 */
export function RoutineSection({ routine: given }: { routine?: RoutineView | null }) {
  const { data: fetched, isLoading } = useTodayRoutine(given === undefined);
  const routine = given ?? fetched;
  const generate = useGenerateRoutine();
  const updateItem = useUpdateRoutineItem();
  const navigate = useLearnNavigate();

  const { data: duePrompts } = useRecallDue();
  const [promptIndex, setPromptIndex] = useState(0);
  const [showPrompt, setShowPrompt] = useState(false);

  if (given === undefined && isLoading) return <Spinner label="Loading today" />;

  // No "plan today" button. The budget is in preferences, the order is in
  // the roadmap and the due dates are in the schedule — there was nothing
  // left for the user to decide, so the server decides it on first look.
  if (!routine) return <Spinner label="Planning today" />;

  if (routine.items.length === 0) {
    return (
      <StateBlock
        icon="routine"
        title="Nothing to learn today"
        body="Add a technology, or finish onboarding, and tomorrow's plan will have something in it."
      />
    );
  }

  const percent =
    routine.totalMinutes > 0 ? (routine.completedMinutes / routine.totalMinutes) * 100 : 0;

  const remaining = routine.items.filter((item) => item.status === 'PENDING');
  const finished = routine.items.length > 0 && remaining.length === 0;

  // Taken from the plan's own date rather than the browser's clock: a
  // learning day runs 06:00 to 06:00.
  const planDate = new Date(routine.date);

  const open = (item: RoutineItemView) => {
    if (item.exerciseId) {
      navigate(exercisePath(item.kind, item.exerciseId));
    } else if (item.conceptId) {
      navigate(learnPaths.concept(item.conceptId));
    }
  };

  /** Completing an item is the boundary — the one safe moment to ask. */
  const complete = (item: RoutineItemView) => {
    updateItem.mutate({ id: item.id, status: 'DONE' });
    if (duePrompts && promptIndex < duePrompts.length) setShowPrompt(true);
  };

  const currentPrompt = showPrompt ? duePrompts?.[promptIndex] : undefined;

  return (
    <section aria-label="Learning today">
      <div className="row items-center justify-between mb3 g4 wrap">
        <div>
          <div className="t-h3">Learning today</div>
          <div className="t-caption mt1">
            {routine.completedMinutes} of {routine.totalMinutes} minutes
            {routine.recallDue > 0 ? ` · ${routine.recallDue} due for review` : ''}
          </div>
        </div>
        <div className="row items-center g3" style={{ flex: 1, maxWidth: 420 }}>
          <div style={{ flex: 1 }}>
            <ProgressBar pct={percent} thin label="Today's learning" />
          </div>
          <Button
            variant="secondary"
            size="sm"
            icon="refresh"
            onClick={() => generate.mutate(true)}
            disabled={generate.isPending}
          >
            Replan
          </Button>
        </div>
      </div>

      {currentPrompt && (
        <div className="mb5" style={{ maxWidth: 620 }}>
          <RecallPrompt
            prompt={currentPrompt}
            onDone={() => {
              setPromptIndex((index) => index + 1);
              setShowPrompt(false);
            }}
            onSkip={() => setShowPrompt(false)}
          />
        </div>
      )}

      {routine.carriedCount > 0 && (
        <Card className="mb4" style={{ borderLeft: '2px solid var(--warning)' }}>
          <div className="row items-start g3">
            <span style={{ color: 'var(--warning)', marginTop: 2 }}>
              <Icon name="clock" size={16} />
            </span>
            <div>
              <div className="t-h4">
                {routine.carriedCount} {routine.carriedCount === 1 ? 'item' : 'items'} carried
                forward
              </div>
              {/* Not an admonishment. The plan simply does not forget. */}
              <div className="t-small mt1">
                Nothing is ever dropped, so unfinished work moves to today and new material waits
                until it is cleared. Finishing ahead is fine; skipping is not a thing.
              </div>
            </div>
          </div>
        </Card>
      )}

      <div className="col g2 mb4">
        {routine.items.map((item) => (
          <RoutineRow
            key={item.id}
            item={item}
            planDate={planDate}
            onOpen={() => open(item)}
            onComplete={() => complete(item)}
          />
        ))}
      </div>

      {finished && (
        <Card>
          <div className="t-h4">That is today&apos;s learning done.</div>
          {/* No confetti. Finishing is the reward. */}
          <div className="t-small mt1">
            Stopping here is the right call — tomorrow&apos;s spacing depends on it.
          </div>
        </Card>
      )}
    </section>
  );
}

/**
 * One row of the plan.
 *
 * A row is a thing to open, never a step inside one. Question batches and
 * individual exercises used to get their own rows, which made the plan a list
 * of the insides of tasks; a concept is now a single row covering both
 * reading it and practising it.
 *
 * Two rules about finishing, and both come from work being lost:
 *
 *   A finished row still opens. It used to grey out with no way back in, so
 *   revisiting something you had completed was impossible — and reviewing
 *   what you have learned is the entire point of the schedule.
 *
 *   A concept row has no Done button. It ticks itself off when every question
 *   is answered and every exercise passes. A button that can finish a concept
 *   without the work makes the completion state a claim rather than a fact.
 *   Rows with no such signal — a project, an interview — keep theirs.
 */
function RoutineRow({
  item,
  planDate,
  onOpen,
  onComplete,
}: {
  item: RoutineItemView;
  /** The learning day this plan is for, so lateness is measured against it. */
  planDate: Date;
  onOpen: () => void;
  onComplete: () => void;
}) {
  const done = item.status === 'DONE';
  // No skipped state any more. Unfinished work moves to tomorrow, so the
  // only settled state is done.
  const settled = done;
  const lateBy = item.carriedFrom ? daysLate(item.carriedFrom, planDate) : 0;
  const openable = Boolean(item.exerciseId || item.conceptId);
  const finishesItself = item.conceptId !== null || item.exerciseId !== null;

  const desk =
    item.kind === 'CODE' ||
    item.kind === 'BLIND_CODE' ||
    item.kind === 'DEBUG' ||
    item.kind === 'PROJECT';

  return (
    <Card
      hover
      className="row justify-between items-center g4"
      // Dimmed, not disabled: finished work steps back without becoming
      // unreachable.
      style={{ opacity: settled ? 0.7 : 1 }}
    >
      <div className="row items-center g3" style={{ minWidth: 0 }}>
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 9,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: done ? 'var(--success-subtle)' : 'var(--surface-2)',
            color: done ? 'var(--success)' : 'var(--text-secondary)',
          }}
        >
          <Icon name={done ? 'check' : (KIND_ICON[item.kind] ?? 'practice')} size={16} />
        </div>

        <div style={{ minWidth: 0 }}>
          <div className="t-h4" style={{ textDecoration: settled ? 'line-through' : undefined }}>
            {item.title}
          </div>
          {/* The reason is always shown. An opaque routine is not a trusted one. */}
          <div className="t-caption">
            {item.kind} · {item.minutes} min · {item.rationale}
          </div>
          {lateBy > 0 && (
            // Stated, not hidden. A backlog you cannot see is one you
            // never clear, and this is the whole point of carrying work.
            <div className="t-caption mt1" style={{ color: 'var(--warning)' }}>
              Carried from {lateBy} {lateBy === 1 ? 'day' : 'days'} ago
            </div>
          )}
        </div>
      </div>

      <div className="row items-center g2" style={{ flexShrink: 0 }}>
        {desk && !settled && (
          <span className="t-caption row items-center g1">
            <Icon name="monitor" size={12} /> desk work
          </span>
        )}

        {done && <Badge variant="success">Done</Badge>}

        {/* Always offered, finished or not. A completed row that cannot be
            reopened means you cannot revisit what you learned. */}
        {openable && (
          <Button variant={settled ? 'ghost' : 'secondary'} size="sm" onClick={onOpen}>
            {settled ? 'Revisit' : 'Open'}
          </Button>
        )}

        {!settled && !finishesItself && (
          <Button size="sm" onClick={onComplete}>
            Done
          </Button>
        )}
      </div>
    </Card>
  );
}

/**
 * Whole learning days between a carried item's original day and this plan's.
 *
 * Both dates arrive as midnight UTC of a logical date, so this is plain
 * subtraction. Reading the browser's clock instead would call an item carried
 * overnight "1 day late" at 01:00, before the day it was carried to had even
 * begun.
 */
function daysLate(carriedFrom: string, planDate: Date): number {
  const then = new Date(carriedFrom);

  return Math.max(0, Math.round((planDate.getTime() - then.getTime()) / 86_400_000));
}
