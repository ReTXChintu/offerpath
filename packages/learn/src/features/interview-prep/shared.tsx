import { Alert, Badge, Spinner, type AlertStatus, type BadgeVariant } from '@offerpath/ui';

import { learnPaths, LearnLink } from '../../context';
import type {
  PrepAiSource,
  PrepQuestionKind,
  PrepStatus,
  PrepView,
} from '../../lib/interview-prep';

export const KIND_ORDER: PrepQuestionKind[] = [
  'TECHNICAL',
  'SYSTEM_DESIGN',
  'CODING',
  'BEHAVIORAL',
  'COMPANY',
];

export const KIND_LABEL: Record<string, string> = {
  TECHNICAL: 'Technical',
  SYSTEM_DESIGN: 'System design',
  CODING: 'Coding',
  BEHAVIORAL: 'Behavioral',
  COMPANY: 'About the company',
};

export const kindLabel = (kind: string) => KIND_LABEL[kind] ?? kind;

/** "Acme · Backend engineer", or whichever of the two is known. */
export function prepTitle(prep: Pick<PrepView, 'company' | 'role'>): string {
  const parts = [prep.company, prep.role].filter((p): p is string => !!p && p.trim().length > 0);
  return parts.length > 0 ? parts.join(' · ') : 'Interview';
}

const STATUS: Record<PrepStatus, { label: string; variant: BadgeVariant }> = {
  GENERATING: { label: 'Preparing', variant: 'info' },
  READY: { label: 'Ready', variant: 'success' },
  FAILED: { label: 'Failed', variant: 'error' },
};

export function PrepStatusBadge({ status }: { status: PrepStatus }) {
  const s = STATUS[status] ?? STATUS.READY;
  return (
    <Badge variant={s.variant} size="sm" icon={status === 'GENERATING' ? 'sparkles' : undefined}>
      {s.label}
    </Badge>
  );
}

/** Which AI wrote a prep. */
export function generatedByLabel(source: PrepAiSource | null): string | null {
  if (source === 'desktop') return "Prepared by your laptop's Claude";
  if (source === 'openai') return 'Prepared by your OpenAI key';
  return null;
}

/** Where AI will run for a new prep, in the user's words. */
export const AI_SOURCE_MESSAGE: Record<'desktop' | 'openai' | 'none', string> = {
  desktop: "Your laptop's Claude will prepare this",
  openai: 'Your laptop is offline: your OpenAI key will prepare this',
  none: 'Your laptop is offline and no OpenAI key is saved: it will start when your laptop comes online (or add a key in Settings → AI)',
};

/** The answer to `GET /interview-preps/ai`, as a notice. */
export function AiSourceNotice({
  source,
  loading,
  className,
}: {
  source: PrepAiSource | null | undefined;
  loading?: boolean;
  className?: string;
}) {
  if (loading) {
    return (
      <div className={`row items-center g2 t-small ${className ?? ''}`}>
        <Spinner size="sm" label="Checking where AI will run" /> Checking where AI will run…
      </div>
    );
  }
  const key = source === 'desktop' ? 'desktop' : source === 'openai' ? 'openai' : 'none';
  const status: AlertStatus = key === 'desktop' ? 'success' : key === 'openai' ? 'info' : 'warning';
  return (
    <Alert status={status} title="Where AI will run" className={className}>
      <span data-testid="ai-source">{AI_SOURCE_MESSAGE[key]}</span>
      {key === 'none' ? (
        <>
          {' '}
          <LearnLink to={learnPaths.aiSettings}>Open Settings → AI</LearnLink>
        </>
      ) : null}
    </Alert>
  );
}

/** Green from 7, amber from 4, red below: a score out of ten. */
export function scoreVariant(score: number): BadgeVariant {
  if (score >= 7) return 'success';
  if (score >= 4) return 'warning';
  return 'error';
}

export function formatScore(score: number | null): string {
  return score === null ? '—' : `${Math.round(score * 10) / 10}/10`;
}
