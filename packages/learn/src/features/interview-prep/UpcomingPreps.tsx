import { Badge, Button, Panel } from '@offerpath/ui';

import { learnPaths, LearnLink, useLearnNavigate } from '../../context';
import { useInterviewPreps } from '../../lib/interview-prep';
import { countdown, formatWhen } from '../../lib/when';

import { MockInterviewButton } from './PrepDetail';
import { formatScore, PrepStatusBadge, prepTitle } from './shared';

const WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/** Today: the interview preps in the next 14 days, each linking to its prep. */
export function UpcomingPreps() {
  const navigate = useLearnNavigate();
  const { data, error } = useInterviewPreps();
  // Today stays useful without it; the prep page explains a failure.
  if (error || !data) return null;

  const now = Date.now();
  const soon = data.filter((p) => {
    const t = new Date(p.scheduledAt).getTime();
    return t > now && t - now <= WINDOW_MS;
  });

  return (
    <Panel
      title="Interview prep"
      action={
        <LearnLink to={learnPaths.interviewPreps} className="btn btn-ghost btn-sm">
          All preps
        </LearnLink>
      }
    >
      {soon.length === 0 ? (
        <div className="row items-center justify-between g3 wrap">
          <div className="t-small">No interviews in the next two weeks.</div>
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            onClick={() => navigate(learnPaths.interviewPrepNew)}
          >
            Prepare for an interview
          </Button>
        </div>
      ) : (
        <div>
          {soon.map((prep) => (
            <div key={prep.id} className="today-row">
              <div style={{ minWidth: 0 }}>
                <LearnLink to={learnPaths.interviewPrep(prep.id)} className="t-h4">
                  {prepTitle(prep)}
                </LearnLink>
                <div className="t-caption">
                  {formatWhen(prep.scheduledAt)}
                  {prep.status === 'READY' && prep.progress.total > 0
                    ? ` · ${prep.progress.answered}/${prep.progress.total} answered`
                    : ''}
                  {prep.progress.averageScore !== null
                    ? ` · average ${formatScore(prep.progress.averageScore)}`
                    : ''}
                </div>
              </div>
              <div className="row items-center g2 wrap" style={{ justifyContent: 'flex-end' }}>
                {prep.status === 'READY' ? (
                  <MockInterviewButton prep={prep} size="sm" variant="secondary" />
                ) : (
                  <PrepStatusBadge status={prep.status} />
                )}
                <Badge variant="primary" size="sm">
                  {countdown(prep.scheduledAt, now)}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
