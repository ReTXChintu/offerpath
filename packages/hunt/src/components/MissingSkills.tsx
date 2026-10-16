import { Button, Icon, Select } from '@offerpath/ui';
import { useEffect, useState } from 'react';

import { guessSkillGroup, SKILL_GROUPS, type SkillGroupKey } from '../logic';
import { useMarkSkillsKnown } from '../queries';
import { ErrorBanner } from './common';

/**
 * Skills (or keywords) a job asks for that your profile doesn't list. Click the
 * ones you actually know to add them to your skills: every analysis then
 * counts them as matched, and the next resume can use them.
 */
export function MissingSkills({
  skills,
  max = 20,
  onMarked,
}: {
  skills: string[];
  max?: number;
  onMarked?: (skills: string[]) => void;
}) {
  const mark = useMarkSkillsKnown();
  const [selected, setSelected] = useState<string[]>([]);
  const [group, setGroup] = useState<SkillGroupKey>('other');

  // Drop selections that are no longer missing (e.g. after marking them).
  useEffect(() => setSelected((sel) => sel.filter((s) => skills.includes(s))), [skills]);

  if (!skills.length) return <span className="t-small text-muted">None</span>;

  const toggle = (skill: string) => {
    const next = selected.includes(skill)
      ? selected.filter((s) => s !== skill)
      : [...selected, skill];
    if (!selected.length && next.length) setGroup(guessSkillGroup(skill));
    setSelected(next);
  };
  const submit = () =>
    mark.mutate(
      { skills: selected, group },
      {
        onSuccess: () => {
          onMarked?.(selected);
          setSelected([]);
        },
      },
    );

  return (
    <div className="col g2">
      <div className="tag-list">
        {skills.slice(0, max).map((skill) => {
          const on = selected.includes(skill);
          return (
            <button
              key={skill}
              type="button"
              className={on ? 'chip chip-sm chip-warning selected' : 'chip chip-sm chip-warning'}
              aria-pressed={on}
              title={on ? 'Selected: you know this' : 'I know this'}
              onClick={() => toggle(skill)}
            >
              {on ? <Icon name="check" size={11} /> : null}
              {skill}
            </button>
          );
        })}
        {skills.length > max ? (
          <span className="t-caption">+{skills.length - max} more</span>
        ) : null}
      </div>
      <ErrorBanner error={mark.error} title="Couldn't update your skills" />
      {selected.length ? (
        <div className="row g2 wrap items-center">
          <span className="t-caption">
            Add {selected.length === 1 ? selected[0] : `${selected.length} skills`} to your skills
            under
          </span>
          <Select
            size="sm"
            aria-label="Skill group"
            value={group}
            onChange={(e) => setGroup(e.target.value as SkillGroupKey)}
            style={{ textTransform: 'capitalize' }}
          >
            {SKILL_GROUPS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </Select>
          <Button
            size="xs"
            variant="primary"
            icon="check"
            onClick={submit}
            loading={mark.isPending}
          >
            I know {selected.length === 1 ? 'this' : 'these'}
          </Button>
        </div>
      ) : (
        <span className="t-caption">Know one of these? Click it to add it to your skills.</span>
      )}
    </div>
  );
}
