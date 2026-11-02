import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  PageHeader,
  Panel,
  ProgressBar,
  Spinner as UiSpinner,
  toast,
} from '@offerpath/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, useSyncExternalStore } from 'react';

import { Spinner } from '../../components/ui';
import { learnPaths, useLearnNavigate } from '../../context';
import { liveKeys, VOICE_THRESHOLD_MAX, VOICE_THRESHOLD_MIN } from '../../lib/live-practice';
import { VOICE_SENTENCES, VoiceSetupController } from '../../lib/live/voice';
import { formatWhen } from '../../lib/when';

import { useLiveDeps } from './deps';
import { NoMicNotice } from './shared';
import { setVoiceSetupNext, voiceSetupNext } from './voice-next';

const noSubscribe = () => () => undefined;
const zero = () => 0;

/** 26214400 → "25 MB". */
function megabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

/**
 * "Your voice": the app learns the user's voice so that, in live practice,
 * only the interviewer's questions get answers. Downloads the speaker model
 * once, records three sentences, and then tests the voiceprint and tunes its
 * threshold. The voiceprint is the account's, shared with the phone.
 */
export function VoiceSetupPage() {
  const deps = useLiveDeps();
  const navigate = useLearnNavigate();
  const queryClient = useQueryClient();
  const [c, setC] = useState<VoiceSetupController | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const next = voiceSetupNext();

  useEffect(() => {
    const controller = new VoiceSetupController(deps.voice);
    setC(controller);
    void controller.load();
    return () => controller.dispose();
  }, [deps]);

  useSyncExternalStore(c?.subscribe ?? noSubscribe, c?.getVersion ?? zero);

  const actionErrors = c?.actionErrors ?? 0;
  useEffect(() => {
    if (actionErrors > 0 && c?.lastActionError) {
      toast.show({ type: 'error', title: c.lastActionError });
    }
  }, [actionErrors, c]);

  // The list's "Your voice" card follows what's saved.
  const profile = c?.profile;
  useEffect(() => {
    if (profile !== undefined) queryClient.setQueryData(liveKeys.voice, profile);
  }, [profile, queryClient]);

  const goOn = () => {
    setVoiceSetupNext(null);
    navigate(next ? learnPaths.livePracticeSession(next) : learnPaths.livePractice, {
      replace: !!next,
    });
  };

  const canListen = deps.canListen();

  return (
    <div>
      <PageHeader
        eyebrow="Live practice"
        title="Your voice"
        subtitle="In live practice you're the interviewee and every other voice is the interviewer. Once Offerpath knows your voice, only the interviewer's questions get answers. The recordings stay on this device; only a voiceprint (a list of numbers) is saved to your account, and the phone uses the same one."
        actions={
          next ? (
            <Button variant="primary" icon="arrowRight" onClick={goOn}>
              {c?.step === 'ready' ? 'Go to the session' : 'Not now'}
            </Button>
          ) : (
            <Button variant="ghost" icon="arrowLeft" onClick={goOn}>
              Live practice
            </Button>
          )
        }
      />
      {!canListen ? (
        <NoMicNotice />
      ) : !c || c.step === 'loading' ? (
        <Spinner label="Loading your voice" />
      ) : c.step === 'failed' ? (
        <Alert
          status="error"
          title="Couldn't set up your voice"
          actions={
            <Button size="sm" onClick={() => void c.load()}>
              Try again
            </Button>
          }
        >
          {c.error}
        </Alert>
      ) : c.step === 'model' ? (
        <ModelStep c={c} />
      ) : c.step === 'ready' ? (
        <ReadyStep c={c} onDelete={() => setConfirmDelete(true)} />
      ) : (
        <EnrolStep c={c} />
      )}
      {c ? (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title="Delete your voice?"
          description="Live practice will answer every voice until you set it up again, here or on the phone."
          confirmLabel="Delete"
          destructive
          loading={c.deleting}
          onConfirm={() => void c.deleteVoice().then(() => setConfirmDelete(false))}
        />
      ) : null}
    </div>
  );
}

/** Step 1: the speaker model. */
function ModelStep({ c }: { c: VoiceSetupController }) {
  const size = c.model?.sizeBytes ?? 0;
  return (
    <Panel title="Step 1 of 2: the voice model">
      <div className="t-small">
        Offerpath recognises your voice with a small model it downloads once
        {size > 0 ? ` (${megabytes(size)})` : ''} and keeps in this app.
      </div>
      <div className="mt4">
        {c.downloading ? (
          <>
            <ProgressBar
              pct={c.progress === null ? null : c.progress * 100}
              label="Download progress"
            />
            <div className="t-caption mt2">
              {c.progress === null
                ? 'Downloading…'
                : `Downloading… ${Math.round(c.progress * 100)}%`}
            </div>
          </>
        ) : (
          <Button variant="primary" icon="download" onClick={() => void c.downloadModel()}>
            {size > 0 ? `Download (${megabytes(size)})` : 'Download'}
          </Button>
        )}
      </div>
      {c.error ? (
        <div className="t-small text-error mt3" role="alert">
          {c.error}
        </div>
      ) : null}
    </Panel>
  );
}

/** A level meter and how long it's been recording. */
function Meter({ c, maxMs }: { c: VoiceSetupController; maxMs: number }) {
  return (
    <div>
      <ProgressBar thin pct={c.recording ? Math.round(c.level * 100) : 0} label="Input level" />
      <div className="t-caption mt2" role="status">
        {c.recording
          ? `Recording… ${(c.elapsedMs / 1000).toFixed(1)} s of ${Math.round(maxMs / 1000)} s`
          : c.processing
            ? 'Checking…'
            : ' '}
      </div>
    </div>
  );
}

function RecordButton({
  recording,
  busy,
  label,
  onRecord,
  onStop,
}: {
  recording: boolean;
  busy: boolean;
  label: string;
  onRecord: () => void;
  onStop: () => void;
}) {
  return recording ? (
    <Button variant="primary" icon="stop" onClick={onStop}>
      Stop
    </Button>
  ) : (
    <Button variant="primary" icon="mic" loading={busy} onClick={onRecord}>
      {label}
    </Button>
  );
}

/** Step 2: three sentences. */
function EnrolStep({ c }: { c: VoiceSetupController }) {
  return (
    <Panel title="Step 2 of 2: read three sentences">
      {c.profileOutdated ? (
        <Alert status="warning" title="Record your voice again" className="mb3">
          The voice model changed, so your old voiceprint no longer matches.
        </Alert>
      ) : null}
      <div className="t-small">
        Read each one out loud in your normal voice, from about where you&apos;ll sit in the
        practice.
      </div>
      <div className="t-caption mt3">
        {c.takesDone ? 'All three recorded' : `Sentence ${c.take + 1} of ${VOICE_SENTENCES.length}`}
      </div>
      {c.takesDone ? null : (
        <div className="live-sentence mt2" data-testid="voice-sentence">
          “{c.sentence}”
        </div>
      )}
      <div className="mt3">
        <Meter c={c} maxMs={c.maxTakeMs} />
      </div>
      {c.takeProblem ? (
        <div className="t-small text-error mt2" role="alert">
          {c.takeProblem}
        </div>
      ) : null}
      {c.error ? (
        <div className="t-small text-error mt2" role="alert">
          {c.error}
        </div>
      ) : null}
      <div className="row items-center g2 wrap mt3">
        {c.takesDone ? (
          <Button
            variant="primary"
            icon="save"
            loading={c.saving}
            onClick={() => void c.saveVoiceprint()}
          >
            {c.saving ? 'Saving…' : 'Save my voice'}
          </Button>
        ) : (
          <RecordButton
            recording={c.recordingTake}
            busy={c.processing}
            label={c.take === 0 ? 'Record' : 'Record the next one'}
            onRecord={() => void c.recordTake()}
            onStop={() => void c.stopRecording()}
          />
        )}
        {c.profile && !c.profileOutdated && !c.recording ? (
          <Button variant="ghost" onClick={() => c.cancelRecordAgain()}>
            Keep my saved voice
          </Button>
        ) : null}
      </div>
    </Panel>
  );
}

/** The voiceprint is saved: test it, tune the threshold, record again or delete it. */
function ReadyStep({ c, onDelete }: { c: VoiceSetupController; onDelete: () => void }) {
  const similarity = c.testSimilarity;
  const recognised = c.testRecognised;
  const commit = (value: number) => void c.saveThreshold(value);
  return (
    <div className="live-layout">
      <div className="col g4">
        <Panel>
          <div className="row items-center g2">
            <span className="t-h4">Your voice is set up</span>
            <Badge variant="success" size="sm">
              Set up
            </Badge>
          </div>
          {c.profile?.updatedAt ? (
            <div className="t-caption mt1">Recorded {formatWhen(c.profile.updatedAt)}</div>
          ) : null}
          <div className="row items-center g2 wrap mt3">
            <Button
              icon="refresh"
              disabled={c.recording || c.processing}
              onClick={() => c.recordAgain()}
            >
              Record again
            </Button>
            <Button
              variant="danger"
              icon="trash"
              disabled={c.deleting || c.recording}
              onClick={onDelete}
            >
              Delete
            </Button>
          </div>
        </Panel>
        <Panel
          title="Match threshold"
          action={
            <span className="row items-center g2">
              {c.savingThreshold ? <UiSpinner size="sm" label="Saving" /> : null}
              <strong>{c.threshold.toFixed(2)}</strong>
            </span>
          }
        >
          <input
            type="range"
            aria-label="Match threshold"
            min={VOICE_THRESHOLD_MIN}
            max={VOICE_THRESHOLD_MAX}
            step={0.01}
            value={c.threshold}
            style={{ width: '100%' }}
            onChange={(e) => c.previewThreshold(Number(e.target.value))}
            onPointerUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
            onKeyUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
          />
          <div className="t-caption mt2">
            A turn at least this similar to your voice counts as yours and gets no answer. Raise it
            if your partner is taken for you; lower it if you get answers to your own words.
          </div>
        </Panel>
      </div>
      <Panel title="Test it">
        <div className="t-small">
          Say a phrase, or ask your partner to, and see whether it sounds like you.
        </div>
        <div className="mt3">
          <Meter c={c} maxMs={c.maxTestMs} />
        </div>
        {c.takeProblem ? (
          <div className="t-small text-error mt2" role="alert">
            {c.takeProblem}
          </div>
        ) : null}
        {similarity !== null && recognised !== null ? (
          <Alert
            status={recognised ? 'success' : 'info'}
            title={recognised ? 'Recognised as you' : 'Another voice'}
            className="mt3"
          >
            <span data-testid="voice-verdict">
              Similarity {similarity.toFixed(2)} · threshold {c.threshold.toFixed(2)}
            </span>
          </Alert>
        ) : null}
        <div className="mt3">
          <RecordButton
            recording={c.recordingTest}
            busy={c.processing}
            label="Test"
            onRecord={() => void c.recordTest()}
            onStop={() => void c.stopRecording()}
          />
        </div>
      </Panel>
    </div>
  );
}
