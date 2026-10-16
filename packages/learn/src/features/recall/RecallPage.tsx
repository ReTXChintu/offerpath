import { useState } from 'react';

import { Button, SectionHead, Spinner, StateBlock } from '../../components/ui';
import { learnPaths, useLearnNavigate } from '../../context';
import { useRecallDue } from '../../lib/queries';

import { RecallPrompt } from './RecallPrompt';

/**
 * Recall: the spaced-review prompts that are due, one at a time.
 *
 * A page of its own, so review is something to sit down and do. The rule
 * about where prompts may appear still holds: this is a boundary (nothing
 * else is open), never the middle of a coding problem. No AI is involved,
 * so it works with the desktop offline.
 */
export function RecallPage() {
  const { data: due, isLoading, error, refetch } = useRecallDue();
  const navigate = useLearnNavigate();
  // The list is fixed for the sitting: answering refetches `due`, and a
  // prompt just answered dropping out would skip the one after it.
  const [sitting, setSitting] = useState<typeof due>(undefined);
  const [index, setIndex] = useState(0);
  const [correct, setCorrect] = useState(0);

  // Frozen on first sight (state set during render: the derived-state pattern).
  if (sitting === undefined && due && due.length > 0) setSitting(due);

  if (isLoading) return <Spinner label="Loading your reviews" />;

  const prompts = sitting ?? due ?? [];
  const current = prompts[index];

  return (
    <>
      <SectionHead
        eyebrow="Grow"
        title="Recall"
        description="Short questions on what you have already learnt, timed so it sticks."
        right={
          prompts.length > 0 ? (
            <span className="t-caption">
              {Math.min(index + 1, prompts.length)} of {prompts.length}
            </span>
          ) : undefined
        }
      />

      {error ? (
        <StateBlock
          icon="alert"
          title="Could not load your reviews"
          body={error instanceof Error ? error.message : undefined}
          action={
            <Button variant="secondary" onClick={() => void refetch()}>
              Try again
            </Button>
          }
        />
      ) : prompts.length === 0 ? (
        <StateBlock
          icon="brain"
          title="Nothing due for review"
          body="Concepts come back here as they start to fade. Learn something new in the meantime."
          action={
            <Button
              variant="secondary"
              icon="arrowRight"
              onClick={() => navigate(learnPaths.learn)}
            >
              Go to Learn
            </Button>
          }
        />
      ) : current ? (
        <div style={{ maxWidth: 680 }}>
          <RecallPrompt
            key={current.id}
            prompt={current}
            onDone={(result) => {
              if (result.correct) setCorrect((n) => n + 1);
              setIndex((i) => i + 1);
            }}
          />
        </div>
      ) : (
        <StateBlock
          icon="check"
          title="Reviews done"
          body={`${correct} of ${prompts.length} right. The ones you missed come back sooner.`}
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setSitting(undefined);
                setIndex(0);
                setCorrect(0);
                void refetch();
              }}
            >
              Check for more
            </Button>
          }
        />
      )}
    </>
  );
}
