import { Button, ConfirmDialog } from '@offerpath/ui';
import { useState } from 'react';

import { learnPaths, useLearnNavigate } from '../../context';
import {
  LIVE_OPENAI_KEY_HINT,
  liveErrorMessage,
  useLiveApi,
  useStartLivePractice,
} from '../../lib/live-practice';

import { useOpenNewSession } from './LivePracticeList';

/**
 * "Practise live with a partner" on a prep: a live-practice session for
 * this prep (its CV, job description and technologies steer the answers),
 * opened listening. Without an OpenAI key it says where to add one.
 */
export function PractiseLiveButton({ prepId }: { prepId: string }) {
  const api = useLiveApi();
  const start = useStartLivePractice();
  const openNew = useOpenNewSession();
  const navigate = useLearnNavigate();
  const [checking, setChecking] = useState(false);
  const [notReady, setNotReady] = useState<{ reason: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    setError(null);
    setNotReady(null);
    setChecking(true);
    try {
      const ready = await api.ready();
      if (!ready.ready) {
        setNotReady({ reason: ready.reason });
        return;
      }
      const view = await start.mutateAsync({ prepId });
      await openNew(view);
    } catch (e) {
      setError(liveErrorMessage(e));
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <Button icon="user" loading={checking || start.isPending} onClick={() => void onClick()}>
        Practise live with a partner
      </Button>
      {error ? (
        <span className="t-caption text-error" role="alert">
          {error}
        </span>
      ) : null}
      <ConfirmDialog
        open={notReady !== null}
        onOpenChange={(open) => {
          if (!open) setNotReady(null);
        }}
        title="Live practice needs your OpenAI key"
        description={[
          notReady?.reason,
          `Live practice runs on your own OpenAI key, never Claude. ${LIVE_OPENAI_KEY_HINT}`,
        ]
          .filter(Boolean)
          .join(' ')}
        confirmLabel="Open Settings → AI"
        onConfirm={() => {
          setNotReady(null);
          navigate(learnPaths.aiSettings);
        }}
      />
    </>
  );
}
