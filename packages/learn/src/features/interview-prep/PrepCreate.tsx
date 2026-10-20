import {
  Alert,
  Button,
  Checkbox,
  Field,
  Input,
  PageHeader,
  Panel,
  Spinner as UiSpinner,
  TagInput,
  Textarea,
  BulletList,
} from '@offerpath/ui';
import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';

import { describeError } from '../../components/AiOffline';
import { learnPaths, useLearnNavigate } from '../../context';
import { ApiError } from '../../lib/api';
import {
  CV_EXTENSIONS,
  CV_MAX_BYTES,
  useCreatePrep,
  useExtractCv,
  usePrepAiSource,
  useProfileCv,
  type PrepInput,
  type PrepResumeInput,
  type PrepResumeView,
  type ResumeSource,
} from '../../lib/interview-prep';
import { localDateTimeToIso } from '../../lib/when';

import { AiSourceNotice } from './shared';

/** Where the prep's CV comes from, or `none` for no CV. */
export type CvMode = 'none' | ResumeSource;

export interface CvDraft {
  mode: CvMode;
  /** The CV's text: from the profile, read out of the file, or pasted; editable. */
  text: string;
  /** The uploaded file's name. */
  fileName: string | null;
}

export interface PrepDraft {
  company: string;
  role: string;
  jobDescription: string;
  technologies: string[];
  date: string;
  time: string;
  includeDsa: boolean;
  cv: CvDraft;
}

export type PrepErrors = Partial<Record<'jobDescription' | 'when' | 'cv', string>>;

export const NO_CV: CvDraft = { mode: 'none', text: '', fileName: null };

/** The CV as the API takes it; null when there is none (or nothing in it). */
export function resumeFromDraft(cv: CvDraft): PrepResumeInput | null {
  const text = cv.text.trim();
  if (cv.mode === 'none' || !text) return null;
  return cv.mode === 'upload'
    ? { text, source: 'upload', fileName: cv.fileName }
    : { text, source: cv.mode };
}

/** A saved CV, back into the form. */
export function cvDraftFrom(resume: PrepResumeView | null | undefined): CvDraft {
  if (!resume) return NO_CV;
  return { mode: resume.source, text: resume.text, fileName: resume.fileName };
}

/**
 * What a prep needs before it is sent: a job description or at least one
 * technology, and a date and time still ahead (an edit may keep a past one).
 */
export function validatePrepDraft(
  draft: PrepDraft,
  now: number = Date.now(),
  { allowPast = false }: { allowPast?: boolean } = {},
): { errors: PrepErrors; input: PrepInput | null } {
  const errors: PrepErrors = {};
  const jobDescription = draft.jobDescription.trim();
  const technologies = draft.technologies.map((t) => t.trim()).filter(Boolean);
  if (!jobDescription && technologies.length === 0) {
    errors.jobDescription = 'Paste the job description, or add at least one technology.';
  }
  const scheduledAt = localDateTimeToIso(draft.date, draft.time);
  if (!scheduledAt) errors.when = "Pick the interview's date and time.";
  else if (!allowPast && new Date(scheduledAt).getTime() <= now) {
    errors.when = 'That time has passed. Pick when the interview is.';
  }
  const cv = draft.cv ?? NO_CV;
  if (cv.mode !== 'none' && !cv.text.trim()) {
    errors.cv =
      cv.mode === 'upload'
        ? 'Choose a CV file, or pick "No CV".'
        : cv.mode === 'profile'
          ? 'Your profile has nothing to build a CV from yet. Pick another option.'
          : 'Paste your CV, or pick "No CV".';
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
      includeDsa: draft.includeDsa,
      resume: resumeFromDraft(cv),
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
  includeDsa: false,
  cv: NO_CV,
};

/** "Prepare for an interview": the job, the technologies, the CV and when it is. */
export function PrepCreate() {
  const navigate = useLearnNavigate();
  const create = useCreatePrep();
  const ai = usePrepAiSource();
  const [draft, setDraft] = useState<PrepDraft>(EMPTY);
  const [errors, setErrors] = useState<PrepErrors>({});

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const { errors: found, input } = validatePrepDraft(draft);
    setErrors(found);
    if (!input) return;
    create.mutate(input, {
      onSuccess: (prep) => navigate(learnPaths.interviewPrep(prep.id), { replace: true }),
    });
  };

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
            <PrepFields
              draft={draft}
              onChange={setDraft}
              errors={errors}
              serverError={create.error}
            />
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
                'Mock interviews with an AI interviewer that reads your CV, then a report on how you did.',
              ]}
            />
          </Panel>
        </div>
      </form>
    </div>
  );
}

/**
 * The prep's fields, for creating one and for editing it: company, role, the
 * job description, technologies, DSA, the CV and when the interview is.
 * Errors the server sends for a field show under it; anything else shows as
 * one alert at the end.
 */
export function PrepFields({
  draft,
  onChange,
  errors,
  serverError,
  compact = false,
}: {
  draft: PrepDraft;
  onChange: (next: PrepDraft) => void;
  errors: PrepErrors;
  serverError: unknown;
  /** Shorter text boxes (inside a dialog). */
  compact?: boolean;
}) {
  const set = <K extends keyof PrepDraft>(key: K, value: PrepDraft[K]) =>
    onChange({ ...draft, [key]: value });

  const serverField = (...names: string[]): string | undefined => {
    if (!(serverError instanceof ApiError)) return undefined;
    for (const name of names) {
      const found = serverError.fieldErrors[name]?.[0];
      if (found) return found;
    }
    return undefined;
  };
  const cvServerError = serverField('resume', 'resume.text', 'resume.source', 'resume.fileName');
  const shownUnderFields =
    ['jobDescription', 'technologies', 'scheduledAt'].some((n) => serverField(n) !== undefined) ||
    cvServerError !== undefined;

  return (
    <>
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
          rows={compact ? 8 : 14}
          style={compact ? { minHeight: 160 } : undefined}
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

      <div className="field">
        <Checkbox checked={draft.includeDsa} onCheckedChange={(v) => set('includeDsa', v)}>
          Include DSA questions
        </Checkbox>
        <div className="field-hint">
          Adds data-structures and algorithms questions to the prep, and DSA coding problems to its
          mock interviews.
        </div>
      </div>

      <CvSection
        value={draft.cv}
        onChange={(cv) => set('cv', cv)}
        error={errors.cv ?? cvServerError}
        compact={compact}
      />

      <div className="grid grid-halves g4">
        <Field label="Interview date" required error={errors.when ?? serverField('scheduledAt')}>
          <Input type="date" value={draft.date} onChange={(e) => set('date', e.target.value)} />
        </Field>
        <Field label="Time" required hint="Your local time." error={errors.when ? true : undefined}>
          <Input type="time" value={draft.time} onChange={(e) => set('time', e.target.value)} />
        </Field>
      </div>

      {serverError && !shownUnderFields ? (
        <Alert status="error">{describeError(serverError)}</Alert>
      ) : null}
    </>
  );
}

const CV_OPTIONS: { mode: CvMode; label: string; hint: string }[] = [
  {
    mode: 'none',
    label: 'No CV',
    hint: 'Questions come from the job description and technologies only.',
  },
  {
    mode: 'profile',
    label: 'Use my Offerpath profile',
    hint: 'A CV written from your profile, experience and projects.',
  },
  { mode: 'upload', label: 'Upload a file', hint: 'PDF, DOCX, TXT or MD, up to 4 MB.' },
  { mode: 'pasted', label: 'Paste text', hint: 'Paste your CV as plain text.' },
];

const NO_PROFILE_HINT = 'Your Offerpath profile is empty, so there is no CV to build from it yet.';

/**
 * The CV, optional: from the profile, read out of a file, or pasted. The
 * text always shows, so it can be checked and corrected before it is sent.
 */
function CvSection({
  value,
  onChange,
  error,
  compact,
}: {
  value: CvDraft;
  onChange: (cv: CvDraft) => void;
  error?: string;
  compact: boolean;
}) {
  const name = useId();
  // Picked before the profile CV had loaded: fill it in once it has (once).
  const waitingForProfile = useRef(false);
  const profile = useProfileCv();
  const extract = useExtractCv();
  const [fileError, setFileError] = useState<string | null>(null);
  const profileText = profile.data ?? null;
  const noProfile = profile.isSuccess && !profileText;

  useEffect(() => {
    if (!waitingForProfile.current || !profileText) return;
    waitingForProfile.current = false;
    if (value.mode === 'profile' && !value.text) {
      onChange({ mode: 'profile', text: profileText, fileName: null });
    }
  }, [value.mode, value.text, profileText, onChange]);

  const choose = (mode: CvMode) => {
    if (mode === value.mode) return;
    setFileError(null);
    extract.reset();
    waitingForProfile.current = mode === 'profile' && !profileText;
    onChange({ mode, text: mode === 'profile' ? (profileText ?? '') : '', fileName: null });
  };

  const pickFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (!CV_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
      setFileError('That file type is not supported. Use a PDF, DOCX, TXT or MD file.');
      return;
    }
    if (file.size > CV_MAX_BYTES) {
      setFileError('That file is over 4 MB. Use a smaller one, or paste the text.');
      return;
    }
    setFileError(null);
    extract.mutate(file, {
      onSuccess: (result) =>
        onChange({ mode: 'upload', text: result.text, fileName: result.fileName }),
    });
  };

  const showText = value.mode === 'pasted' || value.text.length > 0;

  return (
    <fieldset className="prep-cv">
      <legend className="field-label">
        CV <span className="t-caption">(optional)</span>
      </legend>
      <div className="field-hint mb2">
        The plan, the questions and the mock interviewer read it, and ask about what you have done.
      </div>
      <div className="prep-cv-options">
        {CV_OPTIONS.map((option) => {
          const disabled = option.mode === 'profile' && noProfile;
          const checked = value.mode === option.mode;
          return (
            <label
              key={option.mode}
              className={`prep-cv-option${checked ? ' is-checked' : ''}${disabled ? ' is-disabled' : ''}`}
            >
              <input
                type="radio"
                name={name}
                value={option.mode}
                checked={checked}
                disabled={disabled}
                onChange={() => choose(option.mode)}
              />
              <span className="col" style={{ minWidth: 0 }}>
                <span className="prep-cv-option-label">{option.label}</span>
                <span className="t-caption">
                  {disabled
                    ? NO_PROFILE_HINT
                    : option.mode === 'profile' && profile.isLoading
                      ? 'Checking your profile…'
                      : option.hint}
                </span>
              </span>
            </label>
          );
        })}
      </div>

      {value.mode === 'upload' ? (
        <div className="col g2 mt3">
          <div className="row items-center g3 wrap">
            <label className="btn btn-secondary btn-sm prep-cv-file">
              <input
                type="file"
                accept={CV_EXTENSIONS.join(',')}
                aria-label="CV file"
                onChange={pickFile}
                disabled={extract.isPending}
              />
              {value.fileName ? 'Choose another file' : 'Choose a file'}
            </label>
            {extract.isPending ? (
              <span className="row items-center g2 t-small">
                <UiSpinner size="sm" label="Reading the file" /> Reading the file…
              </span>
            ) : value.fileName ? (
              <span className="t-small truncate">{value.fileName}</span>
            ) : null}
          </div>
          {fileError ? <Alert status="error">{fileError}</Alert> : null}
          {extract.error ? (
            <Alert status="error">
              {describeError(
                extract.error,
                'The text could not be read out of that file. Try another, or paste the text.',
              )}
            </Alert>
          ) : null}
        </div>
      ) : null}

      {value.mode === 'profile' && profile.error ? (
        <Alert status="error" className="mt3">
          {describeError(profile.error)}
        </Alert>
      ) : null}

      {showText ? (
        <Field
          className="mt3"
          label="CV text"
          hint={
            value.mode === 'pasted'
              ? `${value.text.length.toLocaleString()} characters.`
              : `Check it and correct anything that came out wrong. ${value.text.length.toLocaleString()} characters.`
          }
          error={error}
        >
          <Textarea
            rows={compact ? 7 : 10}
            value={value.text}
            onChange={(e) => onChange({ ...value, text: e.target.value })}
            placeholder="Paste your CV here"
            maxLength={50_000}
          />
        </Field>
      ) : error ? (
        <div className="field-error mt2">{error}</div>
      ) : null}
    </fieldset>
  );
}
