import { ApiError } from '../api';
import { liveErrorMessage, type LiveApi, type LivePracticeView } from '../live-practice';

import { MicDeniedError, type LiveMic } from './mic';
import { PcmRingBuffer } from './pcm-ring-buffer';
import {
  appendAudioEvent,
  LIVE_QUESTION_NOT_CAPTURED,
  LiveConversation,
  RESPONSE_CREATE_EVENT,
  typedQuestionItem,
  type LiveCard,
  type LiveRole,
  type LiveTurn,
  type RealtimeConnector,
  type RealtimeSocket,
} from './realtime';
import type { LiveVoice } from './speaker-embedder';
import { pcmLevel, REALTIME_CHUNK_BYTES, REALTIME_SAMPLE_RATE, speakerSamples } from './voice-math';

/** What the page says when the microphone permission is refused. */
export const LIVE_MIC_DENIED_MESSAGE =
  "Offerpath can't use the microphone. Allow it for this app (Windows: Settings → Privacy & security → Microphone), or type a question below.";

/** What the page says when the app can't tell the user's voice apart. */
export const LIVE_VOICE_HINT = 'Set up your voice so only the interviewer gets answers';

/** A turn shorter than this (ms) is too short to tell whose voice it is: the interviewer's. */
export const LIVE_MIN_CHECKED_TURN_MS = 1000;

/** The connection to OpenAI Realtime. */
export type LiveConnection = 'offline' | 'connecting' | 'connected' | 'reconnecting';

/** Loads what a session needs to recognise the user's voice; null when it can't. */
export type LiveVoiceLoader = () => Promise<LiveVoice | null>;

/** The calls a session makes. */
export type LiveSessionApi = Pick<LiveApi, 'get' | 'realtime' | 'saveExchange' | 'end' | 'remove'>;

/** One spoken turn's voice check, by OpenAI's item id. */
interface TurnCheck {
  startMs: number | null;
  endMs: number | null;
  committed: boolean;
  role: LiveRole | null;
  asked: boolean;
}

export interface LiveControllerOptions {
  api: LiveSessionApi;
  sessionId: string;
  initial?: LivePracticeView | null;
  mic: LiveMic;
  connect: RealtimeConnector;
  loadVoice?: LiveVoiceLoader;
  /** Waits (ms) between reconnect attempts (the first one is immediate). */
  reconnectDelays?: number[];
  /** Waits (ms) between attempts to save an exchange. */
  saveRetryDelays?: number[];
  transcriptWait?: number;
}

const intOf = (v: unknown): number | null => (typeof v === 'number' ? Math.trunc(v) : null);

/**
 * One live-practice session on screen; the phone's `LivePracticeController`.
 * Listening gets a realtime pass from the API, connects to OpenAI and
 * streams the microphone ~100 ms at a time, keeping the last minute of it.
 * When OpenAI's voice detection ends a turn, the turn's audio is compared
 * with the user's voiceprint: the user's own turns (the interviewee's) are
 * only captioned, and an answer is asked for each of the interviewer's.
 * Each finished card is saved as an exchange. A dropped connection is
 * reconnected with a new pass while listening. Also: typed questions,
 * ending and deleting.
 *
 * React reads it through `subscribe` / `version` (useSyncExternalStore).
 */
export class LivePracticeController {
  readonly sessionId: string;
  readonly conversation: LiveConversation;
  view: LivePracticeView | null;
  /** Why the first load failed (nothing to show yet). */
  loadError: unknown = null;
  connection: LiveConnection = 'offline';
  /** The mic is on. */
  listening = false;
  /** Asking for the permission / connecting / starting the recorder. */
  startingMic = false;
  /** Why listening couldn't start (permission refused, ...). */
  micError: string | null = null;
  /** OpenAI's (or the server's) last error, word for word, until dismissed. */
  banner: string | null = null;
  ending = false;
  /** The user's voiceprint and model; null when it isn't set up (every turn is answered). */
  voice: LiveVoice | null = null;
  /** The voice has been looked for. */
  voiceChecked = false;
  /** Typed questions being sent. */
  asking = 0;
  /** The input level, 0 to 1, for a meter. */
  level = 0;
  /** Bumped on every change. */
  version = 0;
  /** The last failed action's sentence (end, delete, a too-long question), for a toast. */
  lastActionError: string | null = null;
  /** Counts failed actions, so the same sentence twice still shows twice. */
  actionErrors = 0;

  private readonly api: LiveSessionApi;
  private readonly mic: LiveMic;
  private readonly connector: RealtimeConnector;
  private readonly loadVoiceFn: LiveVoiceLoader | undefined;
  private readonly reconnectDelays: number[];
  private readonly saveRetryDelays: number[];
  private readonly listeners = new Set<() => void>();
  private voiceLoading: Promise<void> | null = null;
  private socket: RealtimeSocket | null = null;
  private connecting: Promise<boolean> | null = null;
  private reconnecting = false;
  private reconnectDone: Promise<void> | null = null;
  private pending: Uint8Array[] = [];
  private pendingBytes = 0;
  /** What was sent on this connection, by milliseconds since its first byte. */
  private readonly sentAudio = new PcmRingBuffer();
  /** Counts connections, so a voice check that finishes after a reconnect is dropped. */
  private connectionNo = 0;
  private readonly checks = new Map<string, TurnCheck>();
  /** Turns waiting for an answer to be asked for (one answer at a time). */
  private readonly toAnswer: LiveTurn[] = [];
  /** An answer was asked for and isn't done yet. */
  private answerActive = false;
  /** ... and hasn't started either. */
  private answerRequested = false;
  private readonly saves = new Set<Promise<void>>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private disposed = false;
  private loading = false;

  constructor(options: LiveControllerOptions) {
    this.api = options.api;
    this.sessionId = options.sessionId;
    this.view = options.initial ?? null;
    this.mic = options.mic;
    this.connector = options.connect;
    this.loadVoiceFn = options.loadVoice;
    this.reconnectDelays = options.reconnectDelays ?? [1000, 2000, 4000];
    this.saveRetryDelays = options.saveRetryDelays ?? [1000, 3000];
    this.conversation = new LiveConversation({
      onChanged: () => this.notify(),
      onFinished: (card) => void this.save(card),
      onError: (message, code) => this.onRealtimeError(message, code),
      checksSpeakers: true,
      transcriptWait: options.transcriptWait ?? 3000,
    });
  }

  // -- For React ----------------------------------------------------------------

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

  get isEnded(): boolean {
    return this.view?.status === 'ENDED';
  }

  /** Show "set up your voice": it's been looked for and isn't there. */
  get showVoiceHint(): boolean {
    return this.voiceChecked && this.voice === null;
  }

  /** Cards to show while the session runs, newest first. */
  get cards(): LiveCard[] {
    return this.conversation.visibleCards.reverse();
  }

  /** Saved exchanges that aren't on screen as a card already, newest first. */
  get earlierExchanges() {
    const shown = new Set(this.conversation.cards.map((c) => c.exchangeId).filter(Boolean));
    return (this.view?.exchanges ?? []).filter((e) => !shown.has(e.id)).reverse();
  }

  private fail(error: unknown): void {
    this.actionFailed(liveErrorMessage(error));
  }

  private actionFailed(message: string): void {
    this.lastActionError = message;
    this.actionErrors++;
    this.notify();
  }

  dismissBanner(): void {
    if (this.banner === null) return;
    this.banner = null;
    this.notify();
  }

  private apply(next: LivePracticeView): void {
    if (this.disposed) return;
    this.view = next;
    this.loadError = null;
    this.notify();
  }

  async load(): Promise<void> {
    if (this.loading || this.disposed) return;
    this.loading = true;
    try {
      this.apply(await this.api.get(this.sessionId));
    } catch (error) {
      if (!this.view) this.loadError = error;
      this.notify();
    } finally {
      this.loading = false;
    }
  }

  // -- Your voice -------------------------------------------------------------

  /** Looks for the user's voiceprint (once; `reloadVoice` looks again). */
  loadVoice(): Promise<void> {
    return (this.voiceLoading ??= this.loadVoiceNow());
  }

  private async loadVoiceNow(): Promise<void> {
    let found: LiveVoice | null = null;
    try {
      found = (await this.loadVoiceFn?.()) ?? null;
    } catch {
      found = null;
    }
    if (this.disposed) {
      void found?.dispose().catch(() => undefined);
      return;
    }
    const old = this.voice;
    this.voice = found;
    this.voiceChecked = true;
    if (old && old !== found) void old.dispose().catch(() => undefined);
    this.notify();
  }

  /** Looks for the voiceprint again (after the voice setup). */
  reloadVoice(): Promise<void> {
    this.voiceLoading = null;
    return this.loadVoice();
  }

  /** Who spoke each turn, from OpenAI's voice detection events. */
  private route(e: Record<string, unknown>): void {
    const itemId = typeof e.item_id === 'string' ? e.item_id : null;
    switch (e.type) {
      case 'input_audio_buffer.speech_started':
        if (itemId) this.checkFor(itemId).startMs = intOf(e.audio_start_ms);
        break;
      case 'input_audio_buffer.speech_stopped':
        if (itemId) {
          const check = this.checkFor(itemId);
          check.endMs = intOf(e.audio_end_ms);
          this.classify(itemId, check);
        }
        break;
      case 'input_audio_buffer.committed':
        if (itemId) {
          const check = this.checkFor(itemId);
          check.committed = true;
          if (check.role === null && check.endMs === null) {
            // No end of speech was seen: nothing to check.
            this.decide(itemId, check, 'interviewer');
          } else {
            this.askIfReady(itemId, check);
          }
        }
        break;
      case 'response.created':
        this.answerRequested = false;
        break;
      case 'response.done':
        this.answerActive = false;
        this.answerRequested = false;
        this.askNext();
        break;
      case 'error': {
        const err = typeof e.error === 'object' && e.error !== null ? e.error : {};
        const code = (err as { code?: unknown }).code;
        if (code === 'conversation_already_has_active_response') {
          // Ours was refused: ask again when that one is done.
          this.toAnswer.unshift(...this.conversation.withdrawExpected());
          this.answerActive = true;
          this.answerRequested = false;
        } else if (this.answerRequested) {
          // The request itself failed; don't wait for it.
          this.conversation.withdrawExpected();
          this.answerActive = false;
          this.answerRequested = false;
          this.askNext();
        }
        break;
      }
    }
  }

  private checkFor(itemId: string): TurnCheck {
    const known = this.checks.get(itemId);
    if (known) return known;
    if (this.checks.size > 200) {
      const first = this.checks.keys().next().value;
      if (first !== undefined) this.checks.delete(first);
    }
    const check: TurnCheck = {
      startMs: null,
      endMs: null,
      committed: false,
      role: null,
      asked: false,
    };
    this.checks.set(itemId, check);
    return check;
  }

  /** Compares the turn's audio with the voiceprint. Too short, not in the buffer, or no voice: the interviewer's. */
  private classify(itemId: string, check: TurnCheck): void {
    if (check.role !== null) return;
    const voice = this.voice;
    const { startMs: start, endMs: end } = check;
    if (!voice || start === null || end === null || end - start < LIVE_MIN_CHECKED_TURN_MS) {
      this.decide(itemId, check, 'interviewer');
      return;
    }
    const pcm = this.sentAudio.slice(start, end);
    if (!pcm) {
      this.decide(itemId, check, 'interviewer');
      return;
    }
    const connectionNo = this.connectionNo;
    void (async () => {
      let role: LiveRole = 'interviewer';
      try {
        // Window by window, so a turn where both spoke is the interviewer's.
        if (await voice.isUsers(speakerSamples(pcm, REALTIME_SAMPLE_RATE))) role = 'interviewee';
      } catch {
        // Can't tell: answer it.
      }
      if (this.disposed || connectionNo !== this.connectionNo) return;
      this.decide(itemId, check, role);
    })();
  }

  private decide(itemId: string, check: TurnCheck, role: LiveRole): void {
    if (check.role !== null) return;
    check.role = role;
    this.conversation.setRole(itemId, role);
    this.askIfReady(itemId, check);
  }

  /** The interviewer's turn is in the conversation: ask for its answer. */
  private askIfReady(itemId: string, check: TurnCheck): void {
    if (check.asked || !check.committed || check.role !== 'interviewer') return;
    check.asked = true;
    const turn = this.conversation.turn(itemId);
    if (turn) this.requestAnswer(turn);
  }

  /** Asks for an answer to `turn`, or queues it while one is being written. */
  private requestAnswer(turn: LiveTurn): void {
    this.toAnswer.push(turn);
    this.askNext();
  }

  private askNext(): void {
    if (this.answerActive || this.toAnswer.length === 0 || !this.socket) return;
    this.conversation.expectAnswer([...this.toAnswer]);
    this.toAnswer.length = 0;
    this.answerActive = true;
    this.answerRequested = true;
    this.send(RESPONSE_CREATE_EVENT);
  }

  /** A new connection: new milliseconds, nothing pending. */
  private resetTurns(): void {
    this.connectionNo++;
    this.sentAudio.reset();
    this.checks.clear();
    this.toAnswer.length = 0;
    this.answerActive = false;
    this.answerRequested = false;
  }

  private onMessage(raw: string): void {
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) return;
    const event = decoded as Record<string, unknown>;
    this.conversation.handleEvent(event);
    if (!this.disposed) this.route(event);
  }

  // -- Connection -------------------------------------------------------------

  /** A pass from the API, then the socket. Throws when either fails. */
  private async open(): Promise<void> {
    const pass = await this.api.realtime(this.sessionId);
    if (this.disposed) return;
    const socketRef: { current: RealtimeSocket | null } = { current: null };
    const handlers = {
      onMessage: (data: string) => {
        if (socketRef.current !== null && this.socket === socketRef.current) this.onMessage(data);
      },
      onClose: () => this.onClosed(socketRef.current),
    };
    const socket = await this.connector(pass.url, pass.clientSecret, handlers);
    socketRef.current = socket;
    if (this.disposed) {
      socket.close();
      return;
    }
    this.resetTurns();
    this.socket = socket;
    this.connection = 'connected';
    this.notify();
  }

  private async ensureConnected(): Promise<boolean> {
    // A reconnect is running: wait for it rather than open a second socket.
    if (this.reconnectDone) await this.reconnectDone;
    if (this.socket) return true;
    this.connecting ??= this.connectFirst().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async connectFirst(): Promise<boolean> {
    this.connection = 'connecting';
    this.notify();
    try {
      await this.open();
      return this.socket !== null;
    } catch (error) {
      this.connectFailed(error);
      return false;
    }
  }

  private connectFailed(error: unknown): void {
    this.connection = 'offline';
    this.banner =
      error instanceof ApiError
        ? liveErrorMessage(error)
        : `Couldn't connect to OpenAI: ${error instanceof Error ? error.message : String(error)}`;
    // The session ended elsewhere: show it as ended.
    if (error instanceof ApiError && error.status === 409) void this.load();
    this.notify();
  }

  /** Retrying won't help: no key, ended, not found, ... */
  private static fatal(error: unknown): boolean {
    return error instanceof ApiError && error.status >= 400 && error.status < 500;
  }

  /** The socket closed. Expected when this side closed it; otherwise reconnect while listening. */
  private onClosed(socket: RealtimeSocket | null): void {
    if (socket === null || socket !== this.socket || this.disposed) return;
    this.socket = null;
    if (this.listening) {
      void this.reconnect();
    } else {
      this.conversation.interrupt();
      this.connection = 'offline';
      this.notify();
    }
  }

  private closeSocket(): void {
    const socket = this.socket;
    this.socket = null;
    this.resetTurns();
    socket?.close();
    this.connection = 'offline';
  }

  /** A new pass and a new socket, a few times with a growing wait. The cards stay. */
  private async reconnect(): Promise<void> {
    if (this.reconnecting || this.disposed) return;
    this.reconnecting = true;
    let finish: () => void = () => undefined;
    this.reconnectDone = new Promise<void>((resolve) => (finish = resolve));
    this.closeSocket();
    this.conversation.interrupt();
    this.connection = 'reconnecting';
    this.notify();
    let failure: unknown = null;
    for (let attempt = 0; attempt <= this.reconnectDelays.length; attempt++) {
      if (attempt > 0) await this.sleep(this.reconnectDelays[attempt - 1] ?? 1000);
      if (this.disposed || !this.listening || this.isEnded) {
        failure = null;
        break;
      }
      try {
        await this.open();
        failure = null;
        break;
      } catch (error) {
        failure = error;
        if (LivePracticeController.fatal(error)) break;
      }
    }
    this.reconnecting = false;
    this.reconnectDone = null;
    finish();
    if (this.disposed) return;
    if (!this.socket) this.connection = 'offline';
    if (failure !== null) {
      this.connectFailed(failure);
      await this.pauseListening();
    }
    this.notify();
  }

  private send(event: Record<string, unknown>): void {
    this.socket?.send(JSON.stringify(event));
  }

  private onRealtimeError(message: string, code: string | null): void {
    // An answer was asked for while one was being written: it's asked again.
    if (code === 'conversation_already_has_active_response') return;
    const expired =
      code === 'session_expired' || message.toLowerCase().includes('maximum duration');
    if (expired) {
      if (this.listening) {
        void this.reconnect();
      } else {
        this.closeSocket();
        this.conversation.interrupt();
      }
      return;
    }
    this.banner = message;
  }

  // -- Microphone -------------------------------------------------------------

  /** Turns the mic on: a connection, the permission, then the audio. Returns whether it's listening. */
  async startListening(): Promise<boolean> {
    if (this.listening || this.startingMic || this.isEnded || this.disposed) return this.listening;
    this.startingMic = true;
    this.micError = null;
    this.notify();
    try {
      if (!(await this.ensureConnected()) || this.disposed) return false;
      // Turns are checked against the voiceprint from the first one.
      await this.loadVoice();
      if (this.disposed) return false;
      await this.mic.start((chunk) => this.onAudio(chunk));
      if (this.disposed) {
        void this.mic.stop();
        return false;
      }
      this.listening = true;
      return true;
    } catch (error) {
      this.micError =
        error instanceof MicDeniedError
          ? LIVE_MIC_DENIED_MESSAGE
          : `Couldn't start the microphone: ${error instanceof Error ? error.message : String(error)}`;
      return false;
    } finally {
      this.startingMic = false;
      this.notify();
    }
  }

  private onAudio(chunk: Uint8Array): void {
    if (!this.listening && !this.startingMic) return;
    this.pending.push(chunk);
    this.pendingBytes += chunk.byteLength;
    if (this.pendingBytes >= REALTIME_CHUNK_BYTES) this.flushAudio();
  }

  /** Sends what's been recorded (whole samples only; an odd byte waits). */
  private flushAudio(): void {
    if (this.pendingBytes === 0) return;
    const all = new Uint8Array(this.pendingBytes);
    let offset = 0;
    for (const p of this.pending) {
      all.set(p, offset);
      offset += p.byteLength;
    }
    const even = all.byteLength - (all.byteLength % 2);
    this.pending = even < all.byteLength ? [all.slice(even)] : [];
    this.pendingBytes = all.byteLength - even;
    const bytes = all.subarray(0, even);
    if (bytes.byteLength === 0) return;
    this.level = pcmLevel(bytes);
    this.notify();
    // Not connected (reconnecting): the audio is dropped.
    if (this.socket) this.sendAudio(bytes);
  }

  /** Sends audio and keeps it, so a turn can be cut out of it. */
  private sendAudio(bytes: Uint8Array): void {
    this.sentAudio.add(bytes);
    this.send(appendAudioEvent(bytes));
  }

  /** Turns the mic off. Speech cut off midway is still answered: a second of silence lets OpenAI see its end. */
  async pauseListening(): Promise<void> {
    if (!this.listening) return;
    this.listening = false;
    this.notify();
    try {
      await this.mic.stop();
    } catch {
      // Stopping is best effort.
    }
    this.flushAudio();
    this.pending = [];
    this.pendingBytes = 0;
    if (this.conversation.speech === 'hearing' && this.socket) {
      this.sendAudio(new Uint8Array(REALTIME_SAMPLE_RATE * 2));
    }
    if (!this.disposed) {
      this.level = 0;
      this.notify();
    }
  }

  toggleListening(): Promise<unknown> {
    return this.listening ? this.pauseListening() : this.startListening();
  }

  // -- Questions and answers --------------------------------------------------

  /** A typed question, answered like the interviewer's spoken ones. Returns whether it was sent. */
  async ask(text: string): Promise<boolean> {
    const t = text.trim();
    if (t.length === 0 || this.isEnded || this.disposed) return false;
    if (t.length > 2000) {
      this.actionFailed('Keep it under 2,000 characters.');
      return false;
    }
    this.asking++;
    this.notify();
    try {
      if (!(await this.ensureConnected()) || this.disposed) return false;
      const turn = this.conversation.addTyped(t);
      this.send(typedQuestionItem(t));
      this.requestAnswer(turn);
      return true;
    } finally {
      this.asking--;
      this.notify();
    }
  }

  private save(card: LiveCard): Promise<void> {
    const future = this.saveNow(card);
    this.saves.add(future);
    return future.finally(() => this.saves.delete(future));
  }

  private async saveNow(card: LiveCard): Promise<void> {
    if (card.save === 'saving' || card.save === 'saved') return;
    card.save = 'saving';
    card.saveError = null;
    this.notify();
    const question = card.question.length === 0 ? LIVE_QUESTION_NOT_CAPTURED : card.question;
    for (let attempt = 0; ; attempt++) {
      try {
        const exchange = await this.api.saveExchange(this.sessionId, question, card.answer);
        card.exchangeId = exchange.id;
        card.save = 'saved';
        break;
      } catch (error) {
        const ended = error instanceof ApiError && error.status === 409;
        if (ended || this.disposed || attempt >= this.saveRetryDelays.length) {
          card.save = 'failed';
          card.saveError = liveErrorMessage(error);
          break;
        }
        await this.sleep(this.saveRetryDelays[attempt] ?? 1000);
      }
    }
    this.notify();
  }

  /** Tries a failed save again. */
  retrySave(card: LiveCard): Promise<void> {
    if (card.save !== 'failed') return Promise.resolve();
    return this.save(card);
  }

  /** Stops listening, saves the answers on screen, closes the connection and ends the session. */
  async end(): Promise<boolean> {
    if (this.ending || this.isEnded) return false;
    this.ending = true;
    this.notify();
    try {
      await this.pauseListening();
      this.conversation.finishAll();
      this.closeSocket();
      if (this.saves.size > 0) {
        await Promise.race([
          Promise.allSettled([...this.saves]),
          new Promise((resolve) => setTimeout(resolve, 15_000)),
        ]);
      }
      this.apply(await this.api.end(this.sessionId));
      return true;
    } catch (error) {
      this.fail(error);
      return false;
    } finally {
      this.ending = false;
      this.notify();
    }
  }

  async delete(): Promise<boolean> {
    try {
      await this.pauseListening();
      this.closeSocket();
      await this.api.remove(this.sessionId);
      return true;
    } catch (error) {
      this.fail(error);
      return false;
    }
  }

  /** A wait that `dispose` cancels. */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        resolve();
      }, ms);
      this.timers.add(timer);
    });
  }

  dispose(): void {
    this.disposed = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.listening = false;
    void this.mic.dispose().catch(() => undefined);
    this.closeSocket();
    void this.voice?.dispose().catch(() => undefined);
    this.voice = null;
    this.conversation.dispose();
    this.listeners.clear();
  }
}
