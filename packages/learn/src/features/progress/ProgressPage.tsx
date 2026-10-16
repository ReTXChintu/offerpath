import type { IndependentCodingScore } from '@offerpath/types';
import type { ReactNode } from 'react';

import { Icon } from '../../components/Icon';
import {
  Badge,
  Button,
  Card,
  SectionHead,
  SkillMeter,
  Spinner,
  StatRow,
  StateBlock,
  metricColor,
} from '../../components/ui';
import { useOverview, useRecallDue } from '../../lib/queries';
import { exercisePath, learnPaths, useLearnNavigate } from '../../context';

/**
 * Progress: ForgeRoutine's dashboard, without the routine (Today has it).
 *
 * A four-metric strip, then focus and the weakest skills, then what to do
 * next. The host adds the hunt's funnel beside it (`hunt`), since the hunt
 * lives on the desktop and is read differently on the web.
 *
 * Every number here can be absent, and absent renders as a dash with a
 * reason rather than as zero. A score the user has not earned is a lie they
 * will act on.
 */

export function ProgressPage({ hunt }: { hunt?: ReactNode }) {
  const { data, isLoading, error } = useOverview();
  const { data: due } = useRecallDue();
  const navigate = useLearnNavigate();

  if (isLoading) return <Spinner label="Loading your progress" />;

  if (error || !data) {
    return (
      <StateBlock
        icon="alert"
        title="Could not load your progress"
        body={error instanceof Error ? error.message : 'Something went wrong.'}
      />
    );
  }

  return (
    <>
      <SectionHead
        title="Progress"
        description="Your skills, your coding score, and the hunt from found jobs to offers."
      />

      <div className="grid grid-4 g4 mb6 cq-grid-4">
        <Card>
          <div className="t-caption mb2">Today&apos;s progress</div>
          <div className="row items-end g2 mb2">
            <span className="t-metric">{data.todayMinutesDone}</span>
            <span className="t-caption" style={{ paddingBottom: 4 }}>
              / {data.todayMinutesTarget} min
            </span>
          </div>
          <SkillMeter
            pct={
              data.todayMinutesTarget > 0
                ? (data.todayMinutesDone / data.todayMinutesTarget) * 100
                : 0
            }
          />
        </Card>

        <IndependenceCard score={data.independence} />

        <Card>
          <div className="t-caption mb2">Interview readiness</div>
          {data.interviewReadiness === null ? (
            <>
              <div className="t-metric" style={{ color: 'var(--text-muted)' }}>
                —
              </div>
              <div className="t-caption mt1">Not enough practice yet</div>
            </>
          ) : (
            <>
              <div
                className="t-metric"
                style={{ color: metricColor(data.interviewReadiness * 100) }}
              >
                {Math.round(data.interviewReadiness * 100)}%
              </div>
              <div className="t-caption mt1">Across your active technologies</div>
            </>
          )}
        </Card>

        <Card>
          <div className="t-caption mb2">Due for review</div>
          <div className="row items-center g2">
            <span
              className="t-metric"
              style={{ color: (due?.length ?? 0) > 0 ? 'var(--warning)' : 'var(--text-primary)' }}
            >
              {due?.length ?? 0}
            </span>
            <Icon name="refresh" size={20} />
          </div>
          <div className="t-caption mt1">
            {(due?.length ?? 0) === 0 ? 'Nothing fading today' : 'concepts starting to fade'}
          </div>
        </Card>
      </div>

      <div className="grid grid-2 g5 mb6 cq-stack">
        {hunt ?? (
          <Card>
            <div className="t-h3 mb3">The hunt</div>
            <div className="t-small">The hunt&apos;s numbers appear here once it has run.</div>
          </Card>
        )}
        <div className="col g5">
          <Card>
            <div className="t-h3 mb3">Current focus</div>
            {data.currentFocus.length === 0 ? (
              <div className="t-small">Nothing in progress yet.</div>
            ) : (
              <div className="row g2 wrap">
                {data.currentFocus.map((name) => (
                  <Badge key={name} variant="primary">
                    {name}
                  </Badge>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <div className="t-h3 mb3">Weakest skills</div>
            {data.weakestSkills.length === 0 ? (
              <div className="t-small">
                Not enough evidence yet. This fills in once you have practised a few concepts.
              </div>
            ) : (
              <div className="col g3">
                {data.weakestSkills.map((skill) => (
                  <StatRow
                    key={skill.conceptId}
                    label={`${skill.conceptName} · ${skill.technologyName}`}
                    pct={skill.value * 100}
                  />
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {data.nextAction && (
        <Card>
          <div className="t-h3 mb3">Recommended next</div>
          <div className="row items-center justify-between g4 wrap">
            <div>
              <div className="t-h4">{data.nextAction.title}</div>
              {/* The reason is always shown. An opaque recommendation is not
                  a trusted one. */}
              <div className="t-small mt1">{data.nextAction.rationale}</div>
            </div>
            <div className="row items-center g3">
              <span className="t-caption">~{data.nextAction.estimatedMinutes} min</span>
              <Button
                variant="secondary"
                icon="arrowRight"
                onClick={() => {
                  const action = data.nextAction!;
                  if (action.exerciseId) navigate(exercisePath(action.kind, action.exerciseId));
                  else if (action.conceptId) navigate(learnPaths.concept(action.conceptId));
                  else navigate(learnPaths.today);
                }}
              >
                Open
              </Button>
            </div>
          </div>
        </Card>
      )}
    </>
  );
}

/**
 * `INSUFFICIENT_DATA` renders as a dash and a reason, never as 0%.
 *
 * The oldest rule in this product: a score we have not earned the right to
 * show is a number the user will act on.
 */
function IndependenceCard({ score }: { score: IndependentCodingScore }) {
  const ready = score.status === 'OK' && score.score !== null;
  const delta = score.deltaFromPreviousWindow;

  return (
    <Card>
      <div className="t-caption mb2">Independent coding score</div>

      {ready ? (
        <>
          <div className="t-metric" style={{ color: metricColor(score.score! * 100) }}>
            {Math.round(score.score! * 100)}%
          </div>
          {delta !== null && delta !== undefined ? (
            <div
              className="t-caption mt1"
              style={{ color: delta >= 0 ? 'var(--success)' : 'var(--warning)' }}
            >
              <Icon name="trend" size={11} /> {delta >= 0 ? '+' : ''}
              {Math.round(delta * 100)}% this window
            </div>
          ) : (
            <div className="t-caption mt1">From {score.attemptsConsidered} attempts</div>
          )}
        </>
      ) : (
        <>
          <div className="t-metric" style={{ color: 'var(--text-muted)' }}>
            —
          </div>
          <div className="t-caption mt1">
            {score.attemptsConsidered} attempts so far — too few to mean anything
          </div>
        </>
      )}
    </Card>
  );
}
