import { Alert, Badge, Button, Card, Field, Icon, Textarea } from '@offerpath/ui';
import { useState } from 'react';

import { describeError } from '../../components/AiOffline';
import { ApiError, isAiUnavailable } from '../../lib/api';
import { useAnswerPrepQuestion, type PrepQuestionView } from '../../lib/interview-prep';

import { formatScore, kindLabel, scoreVariant } from './shared';

/** When nothing can grade an answer right now: the laptop is off and no key is saved. */
export const GRADING_UNAVAILABLE =
  'Your laptop is offline and no OpenAI key is saved, so this answer cannot be graded right now. Try again when your laptop is online, or add a key in Settings → AI.';

function answerError(error: unknown): string {
  if (isAiUnavailable(error)) {
    // The server says why (offline, or the OpenAI key was refused).
    const detail = error instanceof ApiError ? error.problem.detail : undefined;
    return detail && !detail.startsWith('AI runs on your desktop') ? detail : GRADING_UNAVAILABLE;
  }
  return describeError(error);
}

/**
 * One practice question: answer it, then see the score, what was covered
 * and missed, the feedback and the key points. Can be answered again.
 */
export function PrepQuestionCard({
  prepId,
  question,
  number,
}: {
  prepId: string;
  question: PrepQuestionView;
  number: number;
}) {
  const answer = useAnswerPrepQuestion(prepId);
  const answered = question.answeredAt !== null && question.score !== null;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    answer.mutate(
      { questionId: question.id, answer: text },
      {
        onSuccess: () => {
          setOpen(false);
          setDraft('');
        },
      },
    );
  };

  return (
    <Card className="prep-question" role="group" aria-label={`Question ${number}`}>
      <div className="row items-start justify-between g3">
        <div className="row items-center g2 wrap">
          <span className="t-caption">Q{number}</span>
          <Badge size="sm">{kindLabel(question.kind)}</Badge>
          {question.topic ? (
            <span className="chip chip-sm" title="Topic">
              {question.topic}
            </span>
          ) : null}
          <span className="t-caption" title="Difficulty, 1 to 5">
            Difficulty {question.difficulty}/5
          </span>
        </div>
        {answered ? (
          <Badge variant={scoreVariant(question.score!)} title="Score out of 10">
            Score {formatScore(question.score)}
          </Badge>
        ) : null}
      </div>

      <div className="t-body mt3 prep-question-text">{question.question}</div>

      {answered && !open ? <Graded question={question} /> : null}

      {open ? (
        <div className="col g3 mt4">
          <Field label="Your answer" hint="Write it as you would say it in the interview.">
            <Textarea
              rows={7}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={6_000}
              autoFocus
            />
          </Field>
          {answer.error ? (
            <Alert status={isAiUnavailable(answer.error) ? 'warning' : 'error'}>
              {answerError(answer.error)}
            </Alert>
          ) : null}
          <div className="row items-center g2 wrap">
            <Button
              variant="primary"
              icon="send"
              loading={answer.isPending}
              disabled={draft.trim().length === 0}
              onClick={submit}
            >
              {answer.isPending ? 'Grading…' : 'Submit answer'}
            </Button>
            <Button
              variant="ghost"
              disabled={answer.isPending}
              onClick={() => {
                setOpen(false);
                answer.reset();
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="row g2 mt4">
          <Button
            size="sm"
            variant={answered ? 'secondary' : 'primary'}
            icon={answered ? 'refresh' : 'pencil'}
            onClick={() => {
              setDraft(answered ? (question.answer ?? '') : '');
              setOpen(true);
            }}
          >
            {answered ? 'Answer again' : 'Answer'}
          </Button>
        </div>
      )}
    </Card>
  );
}

function Graded({ question }: { question: PrepQuestionView }) {
  const feedback = question.feedback;
  return (
    <div className="col g3 mt4">
      {question.answer ? (
        <div>
          <div className="kv-label mb1">Your answer</div>
          <div className="t-small prep-answer">{question.answer}</div>
        </div>
      ) : null}
      {feedback?.feedback ? (
        <div>
          <div className="kv-label mb1">Feedback</div>
          <div className="t-small">{feedback.feedback}</div>
        </div>
      ) : null}
      <div className="grid grid-halves g3">
        <div>
          <div className="kv-label mb1">Covered</div>
          {feedback && feedback.covered.length > 0 ? (
            <ul className="prep-points" aria-label="Covered">
              {feedback.covered.map((point) => (
                <li key={point} className="t-small">
                  <Icon name="check" size={13} className="text-success" /> {point}
                </li>
              ))}
            </ul>
          ) : (
            <div className="t-caption">Nothing yet.</div>
          )}
        </div>
        <div>
          <div className="kv-label mb1">Missed</div>
          {feedback && feedback.missed.length > 0 ? (
            <ul className="prep-points" aria-label="Missed">
              {feedback.missed.map((point) => (
                <li key={point} className="t-small">
                  <Icon name="x" size={13} className="text-error" /> {point}
                </li>
              ))}
            </ul>
          ) : (
            <div className="t-caption">Nothing missed.</div>
          )}
        </div>
      </div>
      {question.keyPoints && question.keyPoints.length > 0 ? (
        <div>
          <div className="kv-label mb1">What a strong answer covers</div>
          <ul className="bullets" aria-label="Key points">
            {question.keyPoints.map((point) => (
              <li key={point} className="t-small">
                {point}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
