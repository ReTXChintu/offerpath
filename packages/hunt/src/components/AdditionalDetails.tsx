import { Button, IconButton, Input, Panel } from '@offerpath/ui';
import { useState } from 'react';

import { COMMON_QUESTIONS, normalizeQuestion } from '../logic';
import { useAnswers, useDeleteAnswer, useSaveAnswer } from '../queries';
import type { AnswerRecord } from '../types';
import { ErrorBanner } from './common';

function blankRecord(question: string, answer: string): AnswerRecord {
  const now = new Date().toISOString();
  return {
    id: '',
    userId: '',
    question,
    normalizedQuestion: '',
    answer,
    category: 'profile',
    timesUsed: 0,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Details job sites and application forms ask for that the rest of the
 * profile doesn't cover (CTC, date of birth, joining date, ...). Answered
 * once here, Claude uses them for every profile update and application
 * instead of stopping to ask.
 */
export function AdditionalDetails() {
  const answers = useAnswers();
  const save = useSaveAnswer();
  const del = useDeleteAnswer();
  const [newQuestion, setNewQuestion] = useState('');
  const [newAnswer, setNewAnswer] = useState('');

  const saved = answers.data ?? [];
  const known = new Set(saved.map((a) => normalizeQuestion(a.question)));
  const suggested = COMMON_QUESTIONS.filter((q) => !known.has(normalizeQuestion(q)));

  return (
    <div className="col g4">
      <p className="t-small text-muted" style={{ margin: 0 }}>
        Job sites and application forms ask for details that aren&apos;t part of a resume. Answer
        them once here and Claude uses them everywhere, so profile updates and applications
        don&apos;t stop to ask you. Answers you give in the app are saved here too.
      </p>
      <ErrorBanner error={save.error ?? del.error ?? answers.error} />

      {suggested.length ? (
        <Panel title={`Often asked (${suggested.length} unanswered)`}>
          <div className="col g2">
            {suggested.map((q) => (
              <AnswerRow
                key={q}
                question={q}
                initial=""
                onSave={(answer) => save.mutate(blankRecord(q, answer))}
                saving={save.isPending}
              />
            ))}
          </div>
        </Panel>
      ) : null}

      <Panel title={`Your answers (${saved.length})`}>
        {saved.length === 0 ? (
          <p className="t-small text-muted">None saved yet.</p>
        ) : (
          <div className="col g2">
            {saved.map((a) => (
              <AnswerRow
                key={a.id}
                question={a.question}
                initial={a.answer}
                usedTimes={a.timesUsed}
                onSave={(answer) => save.mutate({ ...a, answer })}
                onDelete={() => del.mutate(a.id)}
                saving={save.isPending}
              />
            ))}
          </div>
        )}
        <div className="row g2 items-end mt4">
          <Input
            size="sm"
            style={{ flex: 3 }}
            aria-label="Another question"
            placeholder="Another question a site asks"
            value={newQuestion}
            onChange={(e) => setNewQuestion(e.target.value)}
          />
          <Input
            size="sm"
            style={{ flex: 2 }}
            aria-label="Your answer"
            placeholder="Your answer"
            value={newAnswer}
            onChange={(e) => setNewAnswer(e.target.value)}
          />
          <Button
            size="sm"
            variant="subtle"
            icon="plus"
            disabled={!newQuestion.trim() || !newAnswer.trim()}
            loading={save.isPending}
            onClick={() =>
              save.mutate(blankRecord(newQuestion.trim(), newAnswer.trim()), {
                onSuccess: () => {
                  setNewQuestion('');
                  setNewAnswer('');
                },
              })
            }
          >
            Add
          </Button>
        </div>
      </Panel>
    </div>
  );
}

function AnswerRow({
  question,
  initial,
  usedTimes,
  onSave,
  onDelete,
  saving,
}: {
  question: string;
  initial: string;
  usedTimes?: number;
  onSave: (answer: string) => void;
  onDelete?: () => void;
  saving: boolean;
}) {
  const [value, setValue] = useState(initial);
  const changed = value.trim() !== initial.trim() && value.trim().length > 0;
  return (
    <div className="row g3 items-center">
      <div style={{ flex: 3, minWidth: 0 }}>
        <div style={{ fontSize: 13.5 }}>{question}</div>
        {usedTimes ? (
          <div className="t-caption">
            Used {usedTimes} time{usedTimes === 1 ? '' : 's'}
          </div>
        ) : null}
      </div>
      <Input
        size="sm"
        style={{ flex: 2 }}
        aria-label={`Answer: ${question}`}
        value={value}
        placeholder="Your answer"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && changed) onSave(value.trim());
        }}
      />
      <IconButton
        icon="check"
        size="sm"
        label="Save answer"
        active={changed}
        disabled={!changed}
        loading={saving && changed}
        onClick={() => onSave(value.trim())}
      />
      {onDelete ? (
        <IconButton
          icon="trash"
          size="sm"
          variant="danger"
          label="Delete answer"
          onClick={onDelete}
        />
      ) : null}
    </div>
  );
}
