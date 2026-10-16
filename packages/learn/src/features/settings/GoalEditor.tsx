import { Alert, Button, Field, Input, Panel, TagInput } from '@offerpath/ui';
import { useEffect, useState } from 'react';

import { describeError } from '../../components/AiOffline';
import { useGoal, useSetGoal, type GoalInput, type GoalView } from '../../lib/plan';

/** The goal as the form edits it: every field present. */
export interface GoalDraft {
  targetRoles: string[];
  targetCompanies: string[];
  locations: string[];
  targetDate: string;
}

export const EMPTY_GOAL: GoalDraft = {
  targetRoles: [],
  targetCompanies: [],
  locations: [],
  targetDate: '',
};

export function goalDraft(goal: GoalView | null | undefined): GoalDraft {
  if (!goal) return EMPTY_GOAL;
  return {
    targetRoles: goal.targetRoles,
    targetCompanies: goal.targetCompanies,
    locations: goal.locations,
    targetDate: goal.targetDate ?? '',
  };
}

export function goalInput(draft: GoalDraft): GoalInput {
  return {
    targetRoles: draft.targetRoles,
    targetCompanies: draft.targetCompanies,
    locations: draft.locations,
    targetDate: draft.targetDate || null,
  };
}

/**
 * What the user is working toward: target roles, companies, locations and
 * a date. Shared by onboarding and Settings.
 */
export function GoalFields({
  value,
  onChange,
}: {
  value: GoalDraft;
  onChange: (next: GoalDraft) => void;
}) {
  return (
    <div className="col g4">
      <Field label="Target roles" hint="Press Enter after each, e.g. Frontend engineer.">
        <TagInput
          aria-label="Target roles"
          value={value.targetRoles}
          onChange={(targetRoles) => onChange({ ...value, targetRoles })}
          placeholder="Frontend engineer"
        />
      </Field>
      <Field
        label="Target companies"
        hint="Optional. The companies you would most like an offer from."
      >
        <TagInput
          aria-label="Target companies"
          value={value.targetCompanies}
          onChange={(targetCompanies) => onChange({ ...value, targetCompanies })}
          placeholder="Acme"
        />
      </Field>
      <Field label="Locations" hint="Cities, or Remote.">
        <TagInput
          aria-label="Locations"
          value={value.locations}
          onChange={(locations) => onChange({ ...value, locations })}
          placeholder="Remote"
        />
      </Field>
      <Field label="Target date" hint="When you want the offer by. Interview prep plans toward it.">
        <Input
          type="date"
          aria-label="Target date"
          value={value.targetDate}
          onChange={(event) => onChange({ ...value, targetDate: event.target.value })}
          style={{ maxWidth: 220 }}
        />
      </Field>
    </div>
  );
}

/** The goal, editable, in Settings. */
export function GoalEditor() {
  const goal = useGoal();
  const save = useSetGoal();
  const [draft, setDraft] = useState<GoalDraft>(EMPTY_GOAL);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (goal.data !== undefined) setDraft(goalDraft(goal.data));
  }, [goal.data]);

  return (
    <Panel
      title="Your goal"
      action={
        goal.data?.daysLeft !== null && goal.data?.daysLeft !== undefined ? (
          <span className="t-caption">{goal.data.daysLeft} days left</span>
        ) : null
      }
    >
      <div className="t-small mb4">
        Today&apos;s plan, the roadmap and interview prep all work toward this.
      </div>
      <GoalFields
        value={draft}
        onChange={(next) => {
          setSaved(false);
          setDraft(next);
        }}
      />
      {save.error ? (
        <Alert status="error" className="mt4">
          {describeError(save.error)}
        </Alert>
      ) : null}
      <div className="row items-center g3 mt5">
        <Button
          variant="primary"
          loading={save.isPending}
          onClick={() => save.mutate(goalInput(draft), { onSuccess: () => setSaved(true) })}
        >
          Save goal
        </Button>
        {saved ? <span className="t-caption">Saved</span> : null}
      </div>
    </Panel>
  );
}
