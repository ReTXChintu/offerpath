import {
  Alert,
  Badge,
  Button,
  Field,
  Icon,
  Input,
  PageHeader,
  Panel,
  TagInput,
} from '@offerpath/ui';
import { useState } from 'react';

import { Spinner } from '../../components/ui';
import { learnPaths, LearnLink, useLearnNavigate } from '../../context';
import {
  liveErrorMessage,
  markAutoStart,
  useLivePractices,
  useLiveReady,
  useRestartLivePractice,
  useStartLivePractice,
  useVoiceProfile,
  type LivePracticeSummary,
  type LivePracticeView,
} from '../../lib/live-practice';
import { formatWhen } from '../../lib/when';

import { useLiveDeps } from './deps';
import { LiveStatusBadge, NeedsOpenAiKey, NoMicNotice, questionsLabel } from './shared';
import { setVoiceSetupNext } from './voice-next';

/**
 * Opens a session that was just started or restarted, listening at once.
 * Before the first one, the voice setup comes first when there's no
 * voiceprint and it hasn't been offered in this browser yet.
 */
export function useOpenNewSession() {
  const navigate = useLearnNavigate();
  const deps = useLiveDeps();
  return async (view: LivePracticeView, options?: { replace?: boolean }) => {
    if (!deps.canListen()) {
      navigate(learnPaths.livePracticeSession(view.id), options);
      return;
    }
    markAutoStart(view.id);
    if (await deps.voice.offerSetup()) {
      setVoiceSetupNext(view.id);
      navigate(learnPaths.livePracticeVoice, options);
      return;
    }
    navigate(learnPaths.livePracticeSession(view.id), options);
  };
}

/**
 * Learn → Live practice: "Your voice", "New live practice", and the
 * sessions, newest first, each ended one with Restart.
 */
export function LivePracticeList() {
  const sessions = useLivePractices();
  const deps = useLiveDeps();
  const listening = deps.canListen();

  return (
    <div>
      <PageHeader
        eyebrow="Grow"
        title="Live practice"
        subtitle="Practise with a partner: you're the interviewee and they're the interviewer. Offerpath listens and, whenever the interviewer asks a question, shows a direct answer from your CV within seconds. For practice only, never for a real interview."
      />
      {listening ? null : <NoMicNotice className="mb4" />}
      <div className="live-layout">
        <div className="col g4">
          <VoiceCard />
          <NewLivePractice />
        </div>
        <Panel title="Sessions">
          {sessions.isLoading ? (
            <Spinner label="Loading your sessions" />
          ) : sessions.error ? (
            <Alert
              status="error"
              title="Your sessions did not load"
              actions={
                <Button size="sm" onClick={() => void sessions.refetch()}>
                  Try again
                </Button>
              }
            >
              {liveErrorMessage(sessions.error)}
            </Alert>
          ) : (sessions.data ?? []).length === 0 ? (
            <div className="t-small">
              No sessions yet. Put the laptop between you and your partner and start one: every
              question the interviewer asks gets an answer from your CV, and each one is saved here.
              It uses your own OpenAI key.
            </div>
          ) : (
            <ul className="live-list" aria-label="Sessions">
              {(sessions.data ?? []).map((s) => (
                <SessionRow key={s.id} session={s} />
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function SessionRow({ session }: { session: LivePracticeSummary }) {
  const restart = useRestartLivePractice();
  const openNew = useOpenNewSession();
  return (
    <li>
      <div className="live-row">
        <LearnLink to={learnPaths.livePracticeSession(session.id)} className="live-row-main">
          <div className="row items-center g2">
            <span className="t-h4 truncate">{session.title}</span>
            <LiveStatusBadge status={session.status} />
          </div>
          <div className="t-caption mt1">
            {formatWhen(session.createdAt)} · {questionsLabel(session.exchanges)}
          </div>
        </LearnLink>
        {session.status === 'ENDED' ? (
          <Button
            size="sm"
            icon="refresh"
            loading={restart.isPending}
            aria-label={`Restart ${session.title}`}
            onClick={() => restart.mutate(session.id, { onSuccess: (view) => void openNew(view) })}
          >
            Restart
          </Button>
        ) : null}
        {restart.error ? (
          <span className="t-caption text-error" role="alert">
            {liveErrorMessage(restart.error)}
          </span>
        ) : null}
      </div>
    </li>
  );
}

/** "Your voice": set up or not; opens the voice setup. */
function VoiceCard() {
  const voice = useVoiceProfile();
  const on = voice.data !== undefined && voice.data !== null;
  return (
    <LearnLink to={learnPaths.livePracticeVoice} className="card card-hover live-row-main">
      <div className="row items-center g3">
        <Icon name="user" size={20} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row items-center g2">
            <span className="t-h4">Your voice</span>
            {voice.isLoading || voice.error ? null : (
              <Badge variant={on ? 'success' : 'warning'} size="sm">
                {on ? 'Set up' : 'Not set up'}
              </Badge>
            )}
          </div>
          <div className="t-caption mt1">
            {on
              ? "Only the interviewer's questions get answers. Test it or record it again."
              : 'Set it up so only the interviewer gets answers.'}
          </div>
        </div>
        <Icon name="chevronRight" size={16} />
      </div>
    </LearnLink>
  );
}

/** Starts a session: optional technologies and title. Says so up front when no OpenAI key is saved. */
function NewLivePractice() {
  const ready = useLiveReady();
  const start = useStartLivePractice();
  const openNew = useOpenNewSession();
  const [technologies, setTechnologies] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const notReady = ready.data !== undefined && !ready.data.ready;

  return (
    <Panel title="New live practice">
      <div className="t-small mb3">
        Both optional: the technologies steer the answers, the title names the session.
      </div>
      {notReady ? <NeedsOpenAiKey reason={ready.data?.reason} className="mb3" /> : null}
      {ready.error ? (
        <Alert status="error" className="mb3">
          {liveErrorMessage(ready.error)}
        </Alert>
      ) : null}
      <form
        className="col g3"
        onSubmit={(e) => {
          e.preventDefault();
          start.mutate(
            { technologies, title },
            {
              onSuccess: (view) => {
                setTechnologies([]);
                setTitle('');
                void openNew(view);
              },
            },
          );
        }}
      >
        <Field label="Technologies">
          <TagInput
            value={technologies}
            onChange={setTechnologies}
            placeholder="React, Node.js, SQL"
            aria-label="Technologies"
          />
        </Field>
        <Field label="Title">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Live practice"
          />
        </Field>
        {start.error ? <Alert status="error">{liveErrorMessage(start.error)}</Alert> : null}
        <div>
          <Button
            type="submit"
            variant="primary"
            icon="mic"
            loading={start.isPending}
            disabled={notReady || ready.isLoading}
          >
            Start
          </Button>
        </div>
      </form>
    </Panel>
  );
}
