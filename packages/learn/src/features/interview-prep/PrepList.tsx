import { Alert, Badge, Button, EmptyState, Icon, PageHeader, ProgressBar } from '@offerpath/ui';

import { describeError } from '../../components/AiOffline';
import { Spinner } from '../../components/ui';
import { learnPaths, LearnLink, useLearnNavigate } from '../../context';
import { useInterviewPreps, type PrepView } from '../../lib/interview-prep';
import { countdown, formatWhen, isPast } from '../../lib/when';

import { formatScore, PrepStatusBadge, prepTitle, scoreVariant, VerdictBadge } from './shared';

/**
 * Interview prep: every interview being prepared for, soonest first, with
 * how far the practice has got. Past interviews sink below.
 */
export function InterviewPrepList() {
  const navigate = useLearnNavigate();
  const preps = useInterviewPreps();

  const newButton = (
    <Button variant="primary" icon="plus" onClick={() => navigate(learnPaths.interviewPrepNew)}>
      Prepare for an interview
    </Button>
  );

  if (preps.isLoading) return <Spinner label="Loading your interview preps" />;

  const all = preps.data ?? [];
  const now = Date.now();
  const upcoming = all.filter((p) => !isPast(p.scheduledAt, now));
  const past = all.filter((p) => isPast(p.scheduledAt, now)).reverse();

  return (
    <div>
      <PageHeader
        eyebrow="Grow"
        title="Interview prep"
        subtitle="A real interview coming up? Get a plan up to the day and the questions you are likely to be asked, then practise them."
        actions={newButton}
      />

      {preps.error ? (
        <Alert
          status="error"
          title="Your interview preps did not load"
          actions={
            <Button size="sm" onClick={() => void preps.refetch()}>
              Try again
            </Button>
          }
        >
          {describeError(preps.error)}
        </Alert>
      ) : all.length === 0 ? (
        <EmptyState
          icon="calendarPlus"
          title="No interviews to prepare for yet"
          description="Add the job description or the technologies and when the interview is. AI writes the plan and the questions."
          action={newButton}
        />
      ) : (
        <div className="col g6">
          <section aria-label="Upcoming">
            <h2 className="t-h3 mb3">Upcoming</h2>
            {upcoming.length === 0 ? (
              <div className="t-small">Nothing coming up. Add the next one when you get it.</div>
            ) : (
              <div className="prep-cards">
                {upcoming.map((prep) => (
                  <PrepCard key={prep.id} prep={prep} now={now} />
                ))}
              </div>
            )}
          </section>
          {past.length > 0 ? (
            <section aria-label="Past">
              <h2 className="t-h3 mb3">Past</h2>
              <div className="prep-cards">
                {past.map((prep) => (
                  <PrepCard key={prep.id} prep={prep} now={now} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}

function PrepCard({ prep, now }: { prep: PrepView; now: number }) {
  const { answered, total, averageScore } = prep.progress;
  const passed = isPast(prep.scheduledAt, now);
  const lastMock = prep.mockInterviews?.[0];
  return (
    <LearnLink to={learnPaths.interviewPrep(prep.id)} className="card card-hover prep-card">
      <div className="row items-start justify-between g3">
        <div style={{ minWidth: 0 }}>
          <div className="t-h4 truncate">{prepTitle(prep)}</div>
          <div className="t-caption row items-center g1 mt1">
            <Icon name="clock" size={12} /> {formatWhen(prep.scheduledAt)}
          </div>
        </div>
        <PrepStatusBadge status={prep.status} />
      </div>

      <div className="row items-center g2 wrap mt3">
        <Badge variant={passed ? 'neutral' : 'primary'} size="sm">
          {passed ? 'Passed' : countdown(prep.scheduledAt, now)}
        </Badge>
        {prep.technologies.slice(0, 4).map((t) => (
          <span key={t} className="chip chip-sm">
            {t}
          </span>
        ))}
      </div>

      {lastMock ? (
        <div className="t-caption row items-center g2 wrap mt3">
          <Icon name="mic" size={12} />
          {lastMock.status === 'IN_PROGRESS'
            ? 'Mock interview in progress'
            : lastMock.overallScore !== null
              ? `Last mock interview: ${formatScore(lastMock.overallScore)}`
              : 'Mock interview done'}
          {lastMock.verdict ? <VerdictBadge verdict={lastMock.verdict} size="sm" /> : null}
        </div>
      ) : null}

      {prep.status === 'READY' && total > 0 ? (
        <div className="mt4">
          <div className="row items-center justify-between t-caption mb1">
            <span>
              {answered}/{total} answered
            </span>
            {averageScore !== null ? (
              <Badge variant={scoreVariant(averageScore)} size="sm">
                Average {formatScore(averageScore)}
              </Badge>
            ) : null}
          </div>
          <ProgressBar
            thin
            pct={(answered / total) * 100}
            label={`${answered} of ${total} questions answered`}
          />
        </div>
      ) : prep.status === 'GENERATING' ? (
        <div className="t-caption mt4">Writing the plan and questions…</div>
      ) : prep.status === 'FAILED' ? (
        <div className="t-caption text-error mt4">It did not finish. Open it to try again.</div>
      ) : null}
    </LearnLink>
  );
}
