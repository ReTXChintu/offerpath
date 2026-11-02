import { ApiError } from '../api';
import {
  DEFAULT_VOICE_THRESHOLD,
  liveErrorMessage,
  SpeakerModelError,
  VOICE_THRESHOLD_MAX,
  VOICE_THRESHOLD_MIN,
  type LiveApi,
  type SpeakerModelInfo,
  type SpeakerModelStore,
  type VoiceProfile,
} from '../live-practice';

import { MicDeniedError, type LiveMic } from './mic';
import { LiveVoice, type SpeakerEmbedder, type SpeakerEmbedderFactory } from './speaker-embedder';
import {
  averageVoiceprint,
  checkTake,
  cosineSimilarity,
  l2Normalize,
  pcmLevel,
  REALTIME_SAMPLE_RATE,
  speakerSamples,
  trimSilence,
} from './voice-math';

/**
 * Everything about the user's voice for live practice: the voiceprint on
 * the server (one per account, shared with the phone), the speaker model in
 * this browser, the embedder and the microphone. The phone's
 * `VoiceRepository`; pages take one so tests can swap every piece.
 */
export class VoiceRepository {
  constructor(
    readonly api: Pick<
      LiveApi,
      'voice' | 'saveVoice' | 'setThreshold' | 'deleteVoice' | 'modelInfo'
    >,
    readonly models: SpeakerModelStore,
    readonly createEmbedder: SpeakerEmbedderFactory,
    readonly createMic: () => LiveMic,
  ) {}

  profile(): Promise<VoiceProfile | null> {
    return this.api.voice();
  }

  /** The speaker model the server hosts; null when it has none. */
  modelInfo(): Promise<SpeakerModelInfo | null> {
    return this.api.modelInfo();
  }

  save(model: string, embedding: number[], threshold = DEFAULT_VOICE_THRESHOLD) {
    return this.api.saveVoice(model, embedding, threshold);
  }

  setThreshold(threshold: number) {
    return this.api.setThreshold(threshold);
  }

  delete() {
    return this.api.deleteVoice();
  }

  /**
   * What a session needs to tell the user's voice from the interviewer's.
   * Null when anything is missing (no voiceprint, it was made with another
   * model, the model isn't in this browser) or fails: then every turn is
   * answered.
   */
  async sessionVoice(): Promise<LiveVoice | null> {
    try {
      const profile = await this.profile();
      if (!profile || profile.embedding.length === 0) return null;
      const info = await this.modelInfo();
      if (!info || info.fileName !== profile.model) return null;
      const bytes = await this.models.local(info);
      if (!bytes) return null;
      return new LiveVoice(this.createEmbedder(bytes), profile.embedding, profile.threshold);
    } catch {
      return null;
    }
  }

  /**
   * Whether to show the voice setup before a new session: there's no
   * voiceprint and it hasn't been offered in this browser yet. It counts as
   * offered from now on.
   */
  async offerSetup(storage: Storage | null = safeStorage()): Promise<boolean> {
    const key = 'offerpath.live.voiceOffered';
    try {
      if (storage?.getItem(key) === '1') return false;
      if ((await this.profile()) !== null) return false;
      storage?.setItem(key, '1');
      return true;
    } catch {
      return false;
    }
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** What the user reads to make their voiceprint, one per take (the phone's sentences). */
export const VOICE_SENTENCES = [
  "I'm practising for my interview, and this is how my voice sounds.",
  "I've worked on backend systems and I enjoy solving hard problems.",
  "Let me tell you about a project I'm proud of.",
] as const;

export const VOICE_MIC_DENIED_MESSAGE =
  "Offerpath can't use the microphone. Allow it for this app (Windows: Settings → Privacy & security → Microphone).";

/** Where the voice setup is. */
export type VoiceStep = 'loading' | 'failed' | 'model' | 'enrol' | 'ready';

type Recording = 'none' | 'take' | 'test';

const clampThreshold = (t: number) =>
  Math.min(VOICE_THRESHOLD_MAX, Math.max(VOICE_THRESHOLD_MIN, t));

/**
 * "Your voice": downloads the speaker model, records the three sentences,
 * saves their averaged embedding as the user's voiceprint, and tests it.
 * The phone's `VoiceSetupController`.
 */
export class VoiceSetupController {
  step: VoiceStep = 'loading';
  error: string | null = null;
  model: SpeakerModelInfo | null = null;
  downloading = false;
  /** 0 to 1, null when the size isn't known. */
  progress: number | null = null;
  profile: VoiceProfile | null = null;
  processing = false;
  /** Why the last recording can't be used; read the sentence again. */
  takeProblem: string | null = null;
  saving = false;
  level = 0;
  /** How long the current recording is, in ms. */
  elapsedMs = 0;
  /** The last test's cosine similarity with the voiceprint. */
  testSimilarity: number | null = null;
  threshold = DEFAULT_VOICE_THRESHOLD;
  savingThreshold = false;
  deleting = false;
  version = 0;
  /** The last failed action's sentence (threshold, delete), for a toast. */
  lastActionError: string | null = null;
  actionErrors = 0;

  private readonly mic: LiveMic;
  private modelBytes: Uint8Array | null = null;
  private readonly takes: Float32Array[] = [];
  private recordingKind: Recording = 'none';
  private embedder: SpeakerEmbedder | null = null;
  private audio: Uint8Array[] = [];
  private audioBytes = 0;
  private limit: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private readonly listeners = new Set<() => void>();

  constructor(
    readonly repo: VoiceRepository,
    /** A recording stops by itself after this (ms). */
    readonly maxTakeMs = 6000,
    readonly maxTestMs = 6000,
  ) {
    this.mic = repo.createMic();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  private notify(): void {
    if (this.disposed) return;
    this.version++;
    for (const l of [...this.listeners]) l();
  }

  /** The voiceprint was made with another model: record again. */
  get profileOutdated(): boolean {
    return (
      this.profile !== null && this.model !== null && this.profile.model !== this.model.fileName
    );
  }

  /** Which sentence to read (0-based). */
  get take(): number {
    return this.takes.length;
  }

  get sentence(): string {
    return VOICE_SENTENCES[Math.min(this.take, VOICE_SENTENCES.length - 1)] ?? '';
  }

  get recording(): boolean {
    return this.recordingKind !== 'none';
  }

  get recordingTake(): boolean {
    return this.recordingKind === 'take';
  }

  get recordingTest(): boolean {
    return this.recordingKind === 'test';
  }

  /** Every take is in and only saving is left (it failed). */
  get takesDone(): boolean {
    return this.takes.length >= VOICE_SENTENCES.length;
  }

  /** Whether the last test sounded like the user, at `threshold`. */
  get testRecognised(): boolean | null {
    return this.testSimilarity === null ? null : this.testSimilarity >= this.threshold;
  }

  async load(): Promise<void> {
    this.step = 'loading';
    this.error = null;
    this.notify();
    try {
      const info = await this.repo.modelInfo();
      const saved = await this.repo.profile();
      if (this.disposed) return;
      this.model = info;
      this.profile = saved;
      this.threshold = clampThreshold(saved?.threshold ?? DEFAULT_VOICE_THRESHOLD);
      if (!info) {
        this.step = 'failed';
        this.error =
          "The Offerpath server doesn't have the voice model yet. Ask whoever runs it to add it.";
        return;
      }
      this.modelBytes = await this.repo.models.local(info);
      this.step = this.modelBytes ? this.afterModel() : 'model';
    } catch (e) {
      this.step = 'failed';
      this.error = liveErrorMessage(e);
    } finally {
      this.notify();
    }
  }

  private afterModel(): VoiceStep {
    return this.profile === null || this.profileOutdated ? 'enrol' : 'ready';
  }

  async downloadModel(): Promise<void> {
    const info = this.model;
    if (!info || this.downloading) return;
    this.downloading = true;
    this.progress = 0;
    this.error = null;
    this.notify();
    try {
      this.modelBytes = await this.repo.models.download(info, (p) => {
        this.progress = p;
        this.notify();
      });
      if (this.disposed) return;
      this.step = this.afterModel();
    } catch (e) {
      this.error =
        e instanceof ApiError
          ? liveErrorMessage(e)
          : e instanceof SpeakerModelError
            ? e.message
            : `Couldn't download the voice model: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      this.downloading = false;
      this.notify();
    }
  }

  private embedderNow(): SpeakerEmbedder {
    if (!this.modelBytes) throw new Error('The voice model is not here yet.');
    this.embedder ??= this.repo.createEmbedder(this.modelBytes);
    return this.embedder;
  }

  // -- Recording --------------------------------------------------------------

  /** Records the current sentence; it stops by itself after `maxTakeMs`, or with `stopRecording`. */
  recordTake(): Promise<void> {
    return this.start('take', this.maxTakeMs);
  }

  /** Records a phrase to compare with the voiceprint. */
  recordTest(): Promise<void> {
    return this.start('test', this.maxTestMs);
  }

  private async start(kind: Recording, max: number): Promise<void> {
    if (this.recording || this.processing || this.saving || !this.modelBytes) return;
    this.takeProblem = null;
    if (kind === 'test') this.testSimilarity = null;
    this.audio = [];
    this.audioBytes = 0;
    this.elapsedMs = 0;
    try {
      this.recordingKind = kind;
      this.notify();
      await this.mic.start((chunk) => {
        if (this.recordingKind === 'none') return;
        this.audio.push(chunk);
        this.audioBytes += chunk.byteLength;
        this.level = pcmLevel(chunk);
        this.elapsedMs = Math.floor(this.audioBytes / ((REALTIME_SAMPLE_RATE * 2) / 1000));
        this.notify();
      });
      if (this.disposed) return;
      this.limit = setTimeout(() => void this.stopRecording(), max);
    } catch (e) {
      this.recordingKind = 'none';
      this.takeProblem =
        e instanceof MicDeniedError
          ? VOICE_MIC_DENIED_MESSAGE
          : `Couldn't start the microphone: ${e instanceof Error ? e.message : String(e)}`;
    }
    this.notify();
  }

  /** Stops recording and uses what was recorded. */
  async stopRecording(): Promise<void> {
    const kind = this.recordingKind;
    if (kind === 'none') return;
    this.recordingKind = 'none';
    if (this.limit !== null) clearTimeout(this.limit);
    this.limit = null;
    this.processing = true;
    this.notify();
    try {
      await this.mic.stop();
    } catch {
      // Stopping is best effort.
    }
    if (this.disposed) return;
    this.level = 0;
    const pcm = new Uint8Array(this.audioBytes);
    let offset = 0;
    for (const part of this.audio) {
      pcm.set(part, offset);
      offset += part.byteLength;
    }
    this.audio = [];
    this.audioBytes = 0;
    try {
      if (kind === 'take') await this.useTake(pcm);
      else await this.useTest(pcm);
    } finally {
      this.processing = false;
      this.notify();
    }
  }

  /** The speech in `pcm` (24 kHz PCM16) at 16 kHz, or null with `takeProblem` set. */
  private speech(pcm: Uint8Array, minSeconds: number): Float32Array | null {
    const speech = trimSilence(speakerSamples(pcm, REALTIME_SAMPLE_RATE));
    switch (checkTake(speech, { minSeconds })) {
      case 'tooQuiet':
        this.takeProblem =
          'That was too quiet. Move a little closer to the microphone and try again.';
        return null;
      case 'tooShort':
        this.takeProblem = 'That was too short. Read the whole sentence again.';
        return null;
      default:
        return speech;
    }
  }

  private async useTake(pcm: Uint8Array): Promise<void> {
    const speech = this.speech(pcm, 2);
    if (!speech) return;
    try {
      const embedding = await this.embedderNow().embed(speech);
      if (this.disposed) return;
      this.takes.push(l2Normalize(embedding));
    } catch (e) {
      this.takeProblem = `Couldn't recognise that recording: ${e instanceof Error ? e.message : String(e)}`;
      return;
    }
    if (this.takesDone) await this.saveVoiceprint();
  }

  /** Saves the three takes' average as the voiceprint (again, after a failure). */
  async saveVoiceprint(): Promise<void> {
    const info = this.model;
    if (!info || !this.takesDone || this.saving) return;
    this.saving = true;
    this.error = null;
    this.notify();
    try {
      const saved = await this.repo.save(
        info.fileName,
        Array.from(averageVoiceprint(this.takes)),
        DEFAULT_VOICE_THRESHOLD,
      );
      if (this.disposed) return;
      this.profile = saved;
      this.threshold = clampThreshold(saved.threshold);
      this.testSimilarity = null;
      this.takes.length = 0;
      this.step = 'ready';
    } catch (e) {
      this.error = liveErrorMessage(e);
    } finally {
      this.saving = false;
      this.notify();
    }
  }

  private async useTest(pcm: Uint8Array): Promise<void> {
    const current = this.profile;
    if (!current) return;
    const speech = this.speech(pcm, 1);
    if (!speech) return;
    try {
      const embedding = await this.embedderNow().embed(speech);
      this.testSimilarity = cosineSimilarity(embedding, current.embedding);
    } catch (e) {
      this.takeProblem = `Couldn't recognise that recording: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  // -- The voiceprint ---------------------------------------------------------

  /** The slider moved (not saved yet). */
  previewThreshold(value: number): void {
    this.threshold = clampThreshold(value);
    this.notify();
  }

  /** The slider was let go: saves the threshold. */
  async saveThreshold(value: number): Promise<void> {
    const before = this.profile?.threshold ?? DEFAULT_VOICE_THRESHOLD;
    this.threshold = clampThreshold(value);
    this.savingThreshold = true;
    this.notify();
    try {
      const saved = await this.repo.setThreshold(Number(this.threshold.toFixed(2)));
      if (this.disposed) return;
      this.profile = saved;
      this.threshold = clampThreshold(saved.threshold);
    } catch (e) {
      this.threshold = clampThreshold(before);
      this.lastActionError = liveErrorMessage(e);
      this.actionErrors++;
    } finally {
      this.savingThreshold = false;
      this.notify();
    }
  }

  /** Records the three sentences again (the voiceprint is replaced once they're in). */
  recordAgain(): void {
    if (this.recording || this.processing || this.saving) return;
    this.takes.length = 0;
    this.takeProblem = null;
    this.error = null;
    this.testSimilarity = null;
    this.step = 'enrol';
    this.notify();
  }

  /** Back to the saved voiceprint without recording again. */
  cancelRecordAgain(): void {
    if (!this.profile || this.profileOutdated || this.recording || this.processing) return;
    this.takes.length = 0;
    this.takeProblem = null;
    this.step = 'ready';
    this.notify();
  }

  async deleteVoice(): Promise<boolean> {
    if (this.deleting) return false;
    this.deleting = true;
    this.notify();
    try {
      await this.repo.delete();
      if (this.disposed) return true;
      this.profile = null;
      this.testSimilarity = null;
      this.threshold = DEFAULT_VOICE_THRESHOLD;
      this.takes.length = 0;
      this.step = 'enrol';
      return true;
    } catch (e) {
      this.lastActionError = liveErrorMessage(e);
      this.actionErrors++;
      return false;
    } finally {
      this.deleting = false;
      this.notify();
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.limit !== null) clearTimeout(this.limit);
    void this.mic.dispose().catch(() => undefined);
    void this.embedder?.dispose().catch(() => undefined);
    this.listeners.clear();
  }
}
