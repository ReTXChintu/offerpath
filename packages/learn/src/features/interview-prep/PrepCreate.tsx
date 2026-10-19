import {
  Alert,
  Button,
  Field,
  Input,
  PageHeader,
  Panel,
  TagInput,
  Textarea,
  BulletList,
} from '@offerpath/ui';
import { useState, type FormEvent } from 'react';

import { describeError } from '../../components/AiOffline';
import { learnPaths, useLearnNavigate } from '../../context';
import { ApiError } from '../../lib/api';
import { useCreatePrep, usePrepAiSource, type PrepInput } from '../../lib/interview-prep';
import { localDateTimeToIso } from '../../lib/when';

import { AiSourceNotice } from './shared';

export interface PrepDraft {
  company: string;
  role: string;
  jobDescription: string;
  technologies: string[];
  date: string;
  time: string;
}

export type PrepErrors = Partial<Record<'jobDescription' | 'when', string>>;

/**
 * What a prep needs before it is sent: a job description or at least one
 * technology, and a date and time still ahead.
 */
export function validatePrepDraft(
  draft: PrepDraft,
  now: number = Date.now(),
): { errors: PrepErrors; input: PrepInput | null } {
  const errors: PrepErrors = {};
  const jobDescription = draft.jobDescription.trim();
  const technologies = draft.technologies.map((t) => t.trim()).filter(Boolean);
  if (!jobDescription && technologies.length === 0) {
    errors.jobDescription = 'Paste the job description, or add at least one technology.';
  }
  const scheduledAt = localDateTimeToIso(draft.date, draft.time);
  if (!scheduledAt) errors.when = "Pick the interview's date and time.";
  else if (new Date(scheduledAt).getTime() <= now) {
    errors.when = 'That time has passed. Pick when the interview is.';
  }
  if (Object.keys(errors).length > 0 || !scheduledAt) return { errors, input: null };
  return {
    errors,
    input: {
      company: draft.company.trim() || null,
      role: draft.role.trim() || null,
      jobDescription: jobDescription || null,
      technologies,
      scheduledAt,
    },
  };
}

const EMPTY: PrepDraft = {
  company: '',
  role: '',
  jobDescription: '',
  technologies: [],
  date: '',
  time: '',
};

/** "Prepare for an interview": the job, the technologies and when it is. */
export function PrepCreate() {
  const navigate = useLearnNavigate();
  const create = useCreatePrep();
  const ai = usePrepAiSource();
  const [draft, setDraft] = useState<PrepDraft>(EMPTY);
  const [errors, setErrors] = useState<PrepErrors>({});

  const set = <K extends keyof PrepDraft>(key: K, value: PrepDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const serverField = (name: string): string | undefined =>
    create.error instanceof ApiError ? create.error.fieldErrors[name]?.[0] : undefined;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const { errors: found, input } = validatePrepDraft(draft);
    setErrors(found);
    if (!input) return;
    create.mutate(input, {
      onSuccess: (prep) => navigate(learnPaths.interviewPrep(prep.id), { replace: true }),
    });
  };

  // Field errors show under their fields; anything else shows as one alert.
  const shownUnderFields = ['jobDescription', 'technologies', 'scheduledAt'].some(
    (name) => serverField(name) !== undefined,
  );

  return (
    <div>
      <PageHeader
        eyebrow="Interview prep"
        title="Prepare for an interview"
        subtitle="Paste the job description or list the technologies, and say when the interview is. AI writes a plan up to the day and the questions you are likely to get."
        actions={
          <Button
            variant="ghost"
            icon="arrowLeft"
            onClick={() => navigate(learnPaths.interviewPreps)}
          >
            All preps
          </Button>
        }
      />

      <form
        className="prep-create-grid"
        onSubmit={submit}
        noValidate
        aria-label="New interview prep"
      >
        <Panel>
          <div className="col g4">
            <div className="grid grid-halves g4">
              <Field label="Company">
                <Input
                  value={draft.company}
                  onChange={(e) => set('company', e.target.value)}
                  placeholder="Acme"
                  maxLength={120}
                />
              </Field>
              <Field label="Role">
                <Input
                  value={draft.role}
                  onChange={(e) => set('role', e.target.value)}
                  placeholder="Backend engineer"
                  maxLength={120}
                />
              </Field>
            </div>

            <Field
              label="Job description"
              hint="Paste the whole posting: responsibilities and requirements are what the plan is built from."
              error={errors.jobDescription ?? serverField('jobDescription')}
            >
              <Textarea
                className="prep-jd"
                rows={14}
                value={draft.jobDescription}
                onChange={(e) => set('jobDescription', e.target.value)}
                placeholder="Paste the job description here"
                maxLength={20_000}
              />
            </Field>

            <Field
              label="Technologies"
              hint="Press Enter or a comma after each. Enough on its own when there's no job description."
              error={errors.jobDescription ? true : serverField('technologies')}
            >
              <TagInput
                value={draft.technologies}
                onChange={(next) => set('technologies', next.slice(0, 20))}
                placeholder="React, PostgreSQL, System design"
              />
            </Field>

            <div className="grid grid-halves g4">
              <Field
                label="Interview date"
                required
                error={errors.when ?? serverField('scheduledAt')}
              >
                <Input
                  type="date"
                  value={draft.date}
                  onChange={(e) => set('date', e.target.value)}
                />
              </Field>
              <Field
                label="Time"
                required
                hint="Your local time."
                error={errors.when ? true : undefined}
              >
                <Input
                  type="time"
                  value={draft.time}
                  onChange={(e) => set('time', e.target.value)}
                />
              </Field>
            </div>

            {create.error && !shownUnderFields ? (
              <Alert status="error">{describeError(create.error)}</Alert>
            ) : null}

            <div className="row items-center g3 wrap">
              <Button type="submit" variant="primary" icon="sparkles" loading={create.isPending}>
                Prepare
              </Button>
              <Button variant="ghost" onClick={() => navigate(learnPaths.interviewPreps)}>
                Cancel
              </Button>
            </div>
          </div>
        </Panel>

        <div className="col g4" style={{ minWidth: 0 }}>
          <AiSourceNotice source={ai.data} loading={ai.isLoading} />
          <Panel title="What you get">
            <BulletList
              items={[
                'A short read on what this interview will most likely test, and why.',
                'Focus areas, most important first.',
                'A day-by-day plan up to the interview.',
                'Likely questions to practise: answer each one and get a score, what you covered and what you missed.',
              ]}
            />
          </Panel>
        </div>
      </form>
    </div>
  );
}
