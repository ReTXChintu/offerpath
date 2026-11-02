import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  Icon,
  PageHeader,
  Panel,
  ProgressBar,
  Spinner as UiSpinner,
  Textarea,
  toast,
} from '@offerpath/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, useSyncExternalStore, type FormEvent } from 'react';

import { Spinner } from '../../components/ui';
import { learnPaths, useLearnNavigate } from '../../context';
import {
  liveErrorMessage,
  liveKeys,
  takeAutoStart,
  useLiveApi,
  useRestartLivePractice,
  type LivePracticeView,
} from '../../lib/live-practice';
import {
  LIVE_VOICE_HINT,
  LivePracticeController,
  type LiveConnection,
} from '../../lib/live/controller';
import type { LiveTurn } from '../../lib/live/realtime';

import { useLiveDeps } from './deps';
import { useOpenNewSession } from './LivePracticeList';
import { LiveAnswerCard, LiveStatusBadge, NoMicNotice } from './shared';

const noSubscribe = () => () => undefined;
const zero = () => 0;

/**
 * One live-practice session: the laptop on the table between two people.
 * The mic button starts and pauses listening. What's said shows as captions
 * labelled "Interviewer" or "You"; when the interviewer asks a question, a
 * card shows it with a direct answer that fills in as it's written (newest
 * first). Listening pauses when the window is hidden. An ended session shows
 * its saved questions and answers, and Restart.
 */
export function LivePracticeSession({ sessionId }: { sessionId: string }) {
  const deps = useLiveDeps();
  const api = useLiveApi();
  const queryClient = useQueryClient();
  const [c, setC] = useState<LivePracticeController | null>(null);

  useEffect(() => {
    const initial = queryClient.getQueryData<LivePracticeView>(liveKeys.detail(sessionId)) ?? null;
    const controller = new LivePracticeController({
      api,
      sessionId,
      initial,
      mic: deps.createMic(),
      connect: deps.connect,
      loadVoice: () => deps.voice.sessionVoice(),
    });
    setC(controller);
    if (!initial) void controller.load();
    if (initial?.status !== 'ENDED') void controller.loadVoice();
    // A new or restarted session listens at once. Deferred, so React's
    // development double mount doesn't spend the flag on a discarded one.
    const timer = setTimeout(() => {
      if (!takeAutoStart(sessionId)) return;
      if (deps.canListen() && controller.view?.status === 'ACTIVE') {
        void controller.startListening();
      }
    }, 0);
    // Never record while the window is hidden (minimised, or closed to the tray).
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void controller.pauseListening();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      controller.dispose();
    };
  }, [sessionId, api, deps, queryClient]);

  useSyncExternalStore(c?.subscribe ?? noSubscribe, c?.getVersion ?? zero);

  // Toasts for failed actions (end, delete, a too-long question).
  const actionErrors = c?.actionErrors ?? 0;
  useEffect(() => {
    if (actionErrors > 0 && c?.lastActionError) {
      toast.show({ type: 'error', title: c.lastActionError });
    }
  }, [actionErrors, c]);

  const view = c?.view ?? null;
  // Keep the cache in step, so the list and a return visit see the same session.
  useEffect(() => {
    if (view) queryClient.setQueryData(liveKeys.detail(view.id), view);
  }, [view, queryClient]);

  if (!c || (!view && !c.loadError)) return <Spinner label="Loading the session" />;
  if (!view) {
    return (
      <Alert
        status="error"
        title="Could not load this session"
        actions={
          <Button size="sm" onClick={() => void c.load()}>
            Try again
          </Button>
        }
      >
        {liveErrorMessage(c.loadError)}
      </Alert>
    );
  }
  return <SessionBody c={c} view={view} canListen={deps.canListen()} />;
}

function SessionBody({
  c,
  view,
  canListen,
}: {
  c: LivePracticeController;
  view: LivePracticeView;
  canListen: boolean;
}) {
  const navigate = useLearnNavigate();
  const queryClient = useQueryClient();
  const restart = useRestartLivePractice();
  const openNew = useOpenNewSession();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const active = view.status === 'ACTIVE';
  const cards = active ? c.cards : [];
  const saved = active ? c.earlierExchanges : [...view.exchanges].reverse();

  const onRestart = () =>
    restart.mutate(view, {
      onSuccess: (next) => void openNew(next, { replace: true }),
      onError: (error) => toast.show({ type: 'error', title: liveErrorMessage(error) }),
    });

  return (
    <div>
      <PageHeader
        eyebrow="Live practice"
        title={view.title}
        subtitle={
          <span className="row items-center g2 wrap">
            <LiveStatusBadge status={view.status} />
            {view.technologies.map((t) => (
              <span key={t} className="chip chip-sm">
                {t}
              </span>
            ))}
          </span>
        }
        actions={
          <>
            <Button
              variant="ghost"
              icon="arrowLeft"
              onClick={() => navigate(learnPaths.livePractice)}
            >
              All sessions
            </Button>
            {active ? (
              <Button icon="stop" loading={c.ending} onClick={() => setConfirmEnd(true)}>
                End session
              </Button>
            ) : (
              <Button
                variant="primary"
                icon="refresh"
                loading={restart.isPending}
                onClick={onRestart}
              >
                Restart
              </Button>
            )}
            <Button variant="danger" icon="trash" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          </>
        }
      />

      {c.banner ? (
        <Alert
          status="error"
          className="mb4"
          actions={
            <Button
              size="sm"
              variant="ghost"
              onClick={() => c.dismissBanner()}
              aria-label="Dismiss"
            >
              Dismiss
            </Button>
          }
        >
          <span data-testid="live-banner">{c.banner}</span>
        </Alert>
      ) : null}

      <div className="live-session">
        <div className="col g4">
          {active && c.showVoiceHint && canListen ? (
            <Alert
              status="warning"
              actions={
                <Button size="sm" onClick={() => navigate(learnPaths.livePracticeVoice)}>
                  Set up
                </Button>
              }
            >
              {LIVE_VOICE_HINT}
            </Alert>
          ) : null}
          {active ? (
            <>
              {canListen ? <MicPanel c={c} /> : <NoMicNotice />}
              <AskBox c={c} />
            </>
          ) : (
            <Panel title="Session ended">
              <div className="t-small">
                {view.exchanges.length === 1
                  ? '1 question answered'
                  : `${view.exchanges.length} questions answered`}
              </div>
              <div className="mt3">
                <Button
                  variant="primary"
                  icon="refresh"
                  loading={restart.isPending}
                  onClick={onRestart}
                >
                  Restart
                </Button>
              </div>
              <div className="t-caption mt2">
                {view.technologies.length === 0
                  ? 'A new session with the same title starts listening at once.'
                  : `A new session with ${view.technologies.join(', ')} starts listening at once.`}
              </div>
            </Panel>
          )}
        </div>

        <section aria-label="Questions">
          <h2 className="t-h3 mb3">Questions · {cards.length + saved.length}</h2>
          {cards.length === 0 && saved.length === 0 ? (
            <div className="t-small">
              {active
                ? 'No questions yet. When the interviewer asks one out loud, the answer shows up here.'
                : 'No questions were answered in this session.'}
            </div>
          ) : (
            <div className="live-answers">
              {cards.map((card) => (
                <LiveAnswerCard
                  key={card.id}
                  question={card.question}
                  answer={card.answer}
                  writing={!card.answerDone}
                  waitingForQuestion={!card.questionDone}
                  saveError={
                    card.save === 'failed' ? (card.saveError ?? "Couldn't save it.") : null
                  }
                  onRetrySave={() => void c.retrySave(card)}
                />
              ))}
              {saved.map((e) => (
                <LiveAnswerCard
                  key={`x-${e.id}`}
                  question={e.question}
                  answer={e.answer}
                  answerFor={e.answerFor}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={confirmEnd}
        onOpenChange={setConfirmEnd}
        title="End this session?"
        description="The microphone stops. The questions and answers so far stay saved."
        confirmLabel="End session"
        loading={c.ending}
        onConfirm={() => {
          void c.end().then((ok) => {
            setConfirmEnd(false);
            if (ok) void queryClient.invalidateQueries({ queryKey: liveKeys.list });
          });
        }}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this session?"
        description="Its questions and answers go with it."
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          void c.delete().then((ok) => {
            setConfirmDelete(false);
            if (!ok) return;
            queryClient.removeQueries({ queryKey: liveKeys.detail(view.id) });
            void queryClient.invalidateQueries({ queryKey: liveKeys.list });
            navigate(learnPaths.livePractice, { replace: true });
          });
        }}
      />
    </div>
  );
}

function statusLine(c: LivePracticeController): string {
  const connection: LiveConnection = c.connection;
  if (connection === 'connecting') return 'Connecting…';
  if (connection === 'reconnecting') return 'Reconnecting…';
  if (!c.listening) return 'Click the mic to listen.';
  switch (c.conversation.speech) {
    case 'hearing':
      return 'Listening…';
    case 'thinking':
      return 'Thinking…';
    default:
      return c.conversation.answering ? 'Thinking…' : 'Ask any question.';
  }
}

/** The mic button, the level meter, what's happening, and the live caption. */
function MicPanel({ c }: { c: LivePracticeController }) {
  const on = c.listening;
  const title = c.startingMic ? 'Starting…' : on ? 'Listening' : 'Paused';
  const busy = c.connection === 'connecting' || c.connection === 'reconnecting';
  const lines = c.conversation.transcript;
  const recent = lines.slice(-4);
  return (
    <Panel>
      <div className="row items-center g4">
        <button
          type="button"
          className={`live-mic ${on ? 'is-on' : ''}`}
          aria-label={on ? 'Pause listening' : 'Start listening'}
          aria-pressed={on}
          disabled={c.startingMic || c.ending}
          onClick={() => void c.toggleListening()}
        >
          <Icon name={on ? 'mic' : 'pause'} size={32} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className={`t-h3 ${on ? 'text-primary-c' : ''}`}>{title}</div>
          <div className="mt2">
            <ProgressBar thin pct={on ? Math.round(c.level * 100) : 0} label="Input level" />
          </div>
          <div className="row items-center g2 mt2 t-caption" role="status">
            {busy ? <UiSpinner size="sm" label="Connecting" /> : null}
            {statusLine(c)}
          </div>
        </div>
      </div>
      {c.micError ? (
        <div className="t-small text-error mt3" role="alert">
          {c.micError}
        </div>
      ) : null}
      {recent.length > 0 ? (
        <div className="live-captions mt3" aria-label="What was said" aria-live="polite">
          {recent.map((line, i) => (
            <CaptionLine key={line.itemId ?? `t${i}`} turn={line} knowsVoices={c.voice !== null} />
          ))}
        </div>
      ) : null}
      <div className="t-caption mt3">
        Put the laptop between you. You&apos;re the interviewee: only the interviewer&apos;s
        questions get answers. For practice with a partner only.
      </div>
    </Panel>
  );
}

/** One caption: who said it, and what. */
function CaptionLine({ turn, knowsVoices }: { turn: LiveTurn; knowsVoices: boolean }) {
  const [label, variant] =
    turn.role === 'interviewee'
      ? (['You', 'success'] as const)
      : turn.role === 'interviewer'
        ? knowsVoices
          ? (['Interviewer', 'primary'] as const)
          : (['Heard', 'neutral'] as const)
        : (['…', 'neutral'] as const);
  return (
    <div className="live-caption">
      <span>
        <Badge variant={variant} size="sm">
          {label}
        </Badge>
      </span>
      <span className="live-caption-text">{turn.text.trim()}</span>
    </div>
  );
}

/** A typed question: always the interviewer's. */
function AskBox({ c }: { c: LivePracticeController }) {
  const [text, setText] = useState('');
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (text.trim().length === 0) return;
    if (await c.ask(text)) setText('');
  };
  const id = useMemo(() => `live-ask-${Math.random().toString(36).slice(2)}`, []);
  return (
    <Panel title="Type a question">
      <form className="col g2" onSubmit={(e) => void submit(e)}>
        <label htmlFor={id} className="sr-only">
          Type a question
        </label>
        <Textarea
          id={id}
          rows={2}
          maxLength={2000}
          value={text}
          placeholder="Type a question the interviewer would ask"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <div>
          <Button type="submit" icon="send" loading={c.asking > 0}>
            Ask
          </Button>
        </div>
      </form>
    </Panel>
  );
}
