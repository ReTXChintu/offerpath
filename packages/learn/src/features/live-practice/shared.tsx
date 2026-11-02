import { Alert, Badge, Button, Spinner as UiSpinner } from '@offerpath/ui';

import { Markdown } from '../../components/Markdown';
import { learnPaths, LearnLink, useSurface } from '../../context';
import type { AnswerFor, LiveStatus } from '../../lib/live-practice';
import { LIVE_QUESTION_NOT_CAPTURED } from '../../lib/live/realtime';

export function LiveStatusBadge({ status }: { status: LiveStatus }) {
  return status === 'ACTIVE' ? (
    <Badge variant="primary" size="sm" icon="mic">
      Live
    </Badge>
  ) : (
    <Badge variant="neutral" size="sm">
      Ended
    </Badge>
  );
}

export const questionsLabel = (n: number) => (n === 1 ? '1 question' : `${n} questions`);

/**
 * Why this page can't listen: the browser keeps the microphone from pages
 * served over plain http. The list, past sessions, Restart and typed
 * questions still work.
 */
export function NoMicNotice({ className }: { className?: string }) {
  const surface = useSurface();
  return (
    <Alert status="info" title="Live listening isn't available here" className={className}>
      {surface === 'web'
        ? 'Browsers only let a page use the microphone over HTTPS, and this address is plain http. Listen with the Offerpath desktop app or the phone, or open Offerpath at an HTTPS address. You can still type questions here, and see and restart your sessions.'
        : "This window can't use the microphone. You can still type questions, and see and restart your sessions."}
    </Alert>
  );
}

/** The no-OpenAI-key state, pointing at Settings → AI. */
export function NeedsOpenAiKey({
  reason,
  className,
}: {
  reason?: string | null;
  className?: string;
}) {
  return (
    <Alert status="warning" title="Live practice needs your OpenAI key" className={className}>
      {reason ? <>{reason} </> : null}
      Live practice runs on your own OpenAI key, never Claude.{' '}
      <LearnLink to={learnPaths.aiSettings}>Open Settings → AI</LearnLink>
    </Alert>
  );
}

/** One question and its answer (still being written while `writing`). */
export function LiveAnswerCard({
  question,
  answer,
  answerFor = 'me',
  writing = false,
  waitingForQuestion = false,
  saveError = null,
  onRetrySave,
}: {
  question: string;
  answer: string;
  answerFor?: AnswerFor;
  writing?: boolean;
  /** The question's transcript isn't in yet. */
  waitingForQuestion?: boolean;
  /** Why saving it failed; null when it's fine. */
  saveError?: string | null;
  onRetrySave?: () => void;
}) {
  const q = question.trim();
  return (
    <article className="card" aria-label={q || 'Question'}>
      <div
        className={`t-h4 ${q ? '' : 'text-muted'}`}
        style={q ? undefined : { fontStyle: 'italic' }}
      >
        {q || (waitingForQuestion ? 'Catching the question…' : LIVE_QUESTION_NOT_CAPTURED)}
      </div>
      <div className="mt3">
        <Markdown content={answer.trim()} />
      </div>
      {writing || answerFor === 'neutral' || saveError ? (
        <div className="row items-center g2 wrap mt3 t-caption">
          {writing ? (
            <span className="row items-center g1">
              <UiSpinner size="sm" label="Writing" /> Writing…
            </span>
          ) : null}
          {answerFor === 'neutral' ? (
            <Badge variant="neutral" size="sm">
              Neutral
            </Badge>
          ) : null}
          {saveError ? (
            <span className="row items-center g2 text-error" role="alert">
              Not saved: {saveError}
              {onRetrySave ? (
                <Button size="xs" onClick={onRetrySave}>
                  Retry
                </Button>
              ) : null}
            </span>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
