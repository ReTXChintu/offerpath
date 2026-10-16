import { Icon } from '../../components/Icon';
import { Badge, Button, Card, SectionHead, StatRow } from '../../components/ui';
import { exercisePath, learnPaths, useLearnNavigate } from '../../context';
import { useTodayRoutine, useWeakestSkills } from '../../lib/queries';
import { ChallengeList } from '../challenges/ChallengeList';

const CODING_KINDS = new Set(['CODE', 'BLIND_CODE', 'DEBUG', 'PROJECT']);

const KIND_LABEL: Record<string, string> = {
  CODE: 'Exercise',
  BLIND_CODE: 'Blind coding',
  DEBUG: 'Debugging',
  PROJECT: 'Project',
};

/**
 * Practice: everything done at the keyboard.
 *
 * Today's coding items (exercises, blind coding, debugging, projects) first,
 * then the weakest skills to drill, then the engineering challenges. Running
 * and testing code needs no AI, so all of it works with the desktop offline;
 * only hints and reviews wait for it.
 */
export function PracticePage() {
  const { data: routine } = useTodayRoutine();
  const { data: weakest } = useWeakestSkills();
  const navigate = useLearnNavigate();

  const coding = (routine?.items ?? []).filter(
    (item) => CODING_KINDS.has(item.kind) && item.exerciseId,
  );

  return (
    <>
      <SectionHead
        eyebrow="Grow"
        title="Practice"
        description="Exercises, blind coding, projects and engineering challenges."
      />

      <div className="grid grid-2 g5 mb7 cq-stack">
        <Card>
          <div className="t-h3 mb3">Coding today</div>
          {coding.length === 0 ? (
            <div className="t-small">
              Nothing to code in today&apos;s plan. Open a concept from Learn to practise it, or
              take on a challenge below.
            </div>
          ) : (
            <div className="col g2">
              {coding.map((item) => (
                <div key={item.id} className="row items-center justify-between g3">
                  <div style={{ minWidth: 0 }}>
                    <div className="t-h4" style={{ fontSize: 13.5 }}>
                      {item.title}
                    </div>
                    <div className="t-caption">
                      {KIND_LABEL[item.kind] ?? item.kind} · {item.minutes} min
                    </div>
                  </div>
                  <div className="row items-center g2" style={{ flexShrink: 0 }}>
                    {item.status === 'DONE' && <Badge variant="success">Done</Badge>}
                    <Button
                      size="sm"
                      variant={item.status === 'DONE' ? 'ghost' : 'secondary'}
                      onClick={() => navigate(exercisePath(item.kind, item.exerciseId!))}
                    >
                      {item.status === 'DONE' ? 'Revisit' : 'Open'}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <div className="t-h3 mb3">Weakest skills</div>
          {!weakest || weakest.length === 0 ? (
            <div className="t-small">
              Not enough evidence yet. This fills in once you have practised a few concepts.
            </div>
          ) : (
            <div className="col g2">
              {weakest.slice(0, 5).map((skill) => (
                <button
                  key={`${skill.conceptId}-${skill.dimension}`}
                  type="button"
                  className="row items-center g3"
                  onClick={() => navigate(learnPaths.concept(skill.conceptId))}
                  style={{
                    all: 'unset',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <div className="flex-1" style={{ minWidth: 0 }}>
                    <StatRow
                      label={`${skill.conceptName} · ${skill.technologyName}`}
                      pct={skill.value * 100}
                    />
                  </div>
                  <Icon name="chevronRight" size={14} />
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>

      <ChallengeList embedded />
    </>
  );
}
