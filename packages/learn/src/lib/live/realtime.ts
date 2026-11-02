import { toBase64 } from './voice-math';

/**
 * Live practice talks to OpenAI Realtime directly (`docs/live-practice.md`):
 * the app streams the microphone up a WebSocket and OpenAI streams the
 * answers back. This file has the socket behind an interface (tests use a
 * fake), the events the app sends, and `LiveConversation`, which turns
 * OpenAI's events into captions and question-and-answer cards. A port of
 * the phone's `realtime_client.dart`.
 */

/** One open connection to OpenAI Realtime. */
export interface RealtimeSocket {
  /** Sends one JSON event. */
  send(data: string): void;
  /** Closes the connection (from this side). */
  close(): void;
}

/** What a socket reports: each server event (JSON text), and its closing. */
export interface RealtimeHandlers {
  onMessage(data: string): void;
  onClose(): void;
}

/** Opens a socket to `url` with the client secret; rejects when the handshake fails. */
export type RealtimeConnector = (
  url: string,
  clientSecret: string,
  handlers: RealtimeHandlers,
) => Promise<RealtimeSocket>;

/**
 * The WebSocket subprotocols a browser authenticates with. A browser can't
 * set an `Authorization` header on a WebSocket, so OpenAI takes the key as a
 * subprotocol, `openai-insecure-api-key.<key>`, next to `realtime` (what
 * openai-node's `OpenAIRealtimeWebSocket` sends for GA sessions). The key is
 * the short-lived `ek_` client secret the API minted for this session, never
 * the user's OpenAI key. No `openai-beta.realtime-v1`: the session is GA.
 */
export function realtimeProtocols(clientSecret: string): string[] {
  return ['realtime', `openai-insecure-api-key.${clientSecret}`];
}

/** `RealtimeConnector` on the browser's WebSocket. */
export const connectBrowserRealtime: RealtimeConnector = (url, clientSecret, handlers) =>
  new Promise((resolve, reject) => {
    let socket: WebSocket;
    try {
      socket = new WebSocket(url, realtimeProtocols(clientSecret));
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    let open = false;
    const timer = setTimeout(() => {
      if (open) return;
      socket.close();
      reject(new Error('OpenAI took too long to answer.'));
    }, 15_000);
    socket.onopen = () => {
      open = true;
      clearTimeout(timer);
      resolve({
        send: (data) => {
          if (socket.readyState === WebSocket.OPEN) socket.send(data);
        },
        close: () => socket.close(1000),
      });
    };
    socket.onmessage = (event: MessageEvent) => {
      if (typeof event.data === 'string') handlers.onMessage(event.data);
    };
    socket.onerror = () => {
      if (!open) {
        clearTimeout(timer);
        reject(new Error('The connection to OpenAI failed.'));
      }
    };
    socket.onclose = () => {
      clearTimeout(timer);
      if (open) handlers.onClose();
      else reject(new Error('OpenAI closed the connection.'));
    };
  });

/** `input_audio_buffer.append` with `pcm` as base64. */
export function appendAudioEvent(pcm: Uint8Array): Record<string, unknown> {
  return { type: 'input_audio_buffer.append', audio: toBase64(pcm) };
}

/**
 * Asks for an answer. The session never answers by itself
 * (`create_response: false`): the app sends this for the interviewer's turns only.
 */
export const RESPONSE_CREATE_EVENT = { type: 'response.create' } as const;

/** A typed question as a user item. */
export function typedQuestionItem(text: string): Record<string, unknown> {
  return {
    type: 'conversation.item.create',
    item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
  };
}

/** The model's reply when what was said isn't a question (`LIVE_SKIP`). */
export function isNotAQuestion(answer: string): boolean {
  const t = answer.trim();
  return t.length === 0 || t === '-';
}

/** What a saved exchange says when the question's words weren't caught. */
export const LIVE_QUESTION_NOT_CAPTURED = '(question not captured)';

/** What's being heard: nobody, someone ("Listening…"), or they stopped ("Thinking…"). */
export type LiveSpeech = 'quiet' | 'hearing' | 'thinking';

export type LiveSaveState = 'none' | 'saving' | 'saved' | 'failed';

/** Who spoke a turn. The account owner is the interviewee for the whole session. */
export type LiveRole = 'interviewer' | 'interviewee';

/** One spoken (or typed) turn: a user item in OpenAI's conversation. */
export class LiveTurn {
  constructor(
    readonly itemId: string | null = null,
    /** The transcript so far. */
    public text = '',
    /** The transcript is complete (or failed: nothing more is coming). */
    public done = false,
    /** Null while it isn't known yet (the voice check is running). */
    public role: LiveRole | null = null,
  ) {}
}

/** One answer on screen, and the turns it answers. */
export class LiveCard {
  readonly turns: LiveTurn[] = [];
  answer = '';
  /** The model finished (or the connection dropped mid-answer). */
  answerDone = false;
  /** Handed over to be saved. */
  finished = false;
  save: LiveSaveState = 'none';
  saveError: string | null = null;
  /** The saved exchange's id. */
  exchangeId: string | null = null;

  constructor(
    /** Local; unique on this screen. */
    readonly id: string,
    readonly responseId: string | null = null,
  ) {}

  /** The question as heard so far (several turns when they were answered together). */
  get question(): string {
    return this.turns
      .map((t) => t.text.trim())
      .filter((t) => t.length > 0)
      .join(' ');
  }

  /** Every turn's transcript is in. */
  get questionDone(): boolean {
    return this.turns.every((t) => t.done);
  }

  /** There's something to show: not empty and not the "not a question" reply. */
  get hasAnswer(): boolean {
    return !isNotAQuestion(this.answer);
  }
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/**
 * Turns OpenAI Realtime's server events into captions and cards. Every
 * answer becomes a card once it has real text; a reply of exactly `-` (not
 * a question) never shows. A card's question is the turns its answer was
 * asked for (`expectAnswer`), else the interviewer's turns nobody answered
 * yet. A finished card goes to `onFinished` (to be saved) when its
 * question's transcript is in, or after `transcriptWait` ms with what was
 * heard so far.
 */
export class LiveConversation {
  /** Oldest first, including cards with nothing to show yet. */
  readonly cards: LiveCard[] = [];
  /** The live caption: the newest turn's transcript. */
  caption = '';
  speech: LiveSpeech = 'quiet';

  private readonly turns = new Map<string, LiveTurn>();
  /** Spoken turns, oldest first (the last 100). */
  private readonly lines: LiveTurn[] = [];
  /** Turns that no response has picked up yet. */
  private readonly waiting: LiveTurn[] = [];
  /** The turns of each answer asked for and not started yet, in order. */
  private readonly expected: LiveTurn[][] = [];
  private readonly byResponse = new Map<string, LiveCard>();
  private readonly waits = new Map<LiveCard, ReturnType<typeof setTimeout>>();
  private current: LiveCard | null = null;
  private n = 0;
  private disposed = false;

  constructor(
    private readonly options: {
      onChanged: () => void;
      onFinished: (card: LiveCard) => void;
      /** An `error` event (or a failed response): OpenAI's message as it is, and its code. */
      onError: (message: string, code: string | null) => void;
      /**
       * Whose voice each spoken turn is gets decided outside (`setRole`);
       * until then a turn's role is unknown. Without it every turn is the
       * interviewer's.
       */
      checksSpeakers?: boolean;
      transcriptWait?: number;
    },
  ) {}

  /** The cards worth showing, oldest first. */
  get visibleCards(): LiveCard[] {
    return this.cards.filter((c) => c.hasAnswer);
  }

  /** An answer is being written now. */
  get answering(): boolean {
    return this.current !== null;
  }

  /** What's been said, oldest first: spoken turns with words. */
  get transcript(): LiveTurn[] {
    return this.lines.filter((t) => t.text.trim().length > 0);
  }

  /** The spoken turn `itemId` (created when it's new). */
  turn(itemId: unknown): LiveTurn | null {
    return this.turnFor(itemId);
  }

  /** Who spoke `itemId`. The interviewee's turns are never answered. */
  setRole(itemId: unknown, role: LiveRole): void {
    const turn = this.turnFor(itemId);
    if (!turn || turn.role === role) return;
    turn.role = role;
    if (role === 'interviewee') {
      remove(this.waiting, turn);
      if (this.speech === 'thinking' && !this.current) this.speech = 'quiet';
    }
    this.options.onChanged();
  }

  /** An answer was asked for `turns`: the next response is theirs. */
  expectAnswer(turns: LiveTurn[]): void {
    this.expected.push(turns);
    for (const t of turns) remove(this.waiting, t);
  }

  /** The last answer asked for was refused: its turns, to ask again. */
  withdrawExpected(): LiveTurn[] {
    return this.expected.pop() ?? [];
  }

  handleEvent(e: Json): void {
    if (this.disposed) return;
    switch (e.type) {
      case 'input_audio_buffer.speech_started':
        this.speech = 'hearing';
        break;
      case 'input_audio_buffer.speech_stopped':
        this.speech = 'thinking';
        break;
      case 'input_audio_buffer.committed':
        this.turnFor(e.item_id);
        if (this.speech === 'hearing') this.speech = 'thinking';
        break;
      case 'conversation.item.created':
      case 'conversation.item.added':
      case 'conversation.item.done':
        this.onItem(e.item);
        break;
      case 'conversation.item.input_audio_transcription.delta': {
        const turn = this.turnFor(e.item_id);
        const delta = str(e.delta);
        if (turn && !turn.done && delta !== null) {
          turn.text += delta;
          this.caption = turn.text;
        }
        break;
      }
      case 'conversation.item.input_audio_transcription.completed': {
        const turn = this.turnFor(e.item_id);
        if (turn) {
          const transcript = str(e.transcript);
          if (transcript !== null) turn.text = transcript.trim();
          turn.done = true;
          if (turn.text.length > 0) this.caption = turn.text;
          this.transcriptIn(turn);
        }
        break;
      }
      case 'conversation.item.input_audio_transcription.failed': {
        const turn = this.turnFor(e.item_id);
        if (turn) {
          turn.done = true;
          this.transcriptIn(turn);
        }
        break;
      }
      case 'response.created':
        this.onResponseCreated(e.response);
        break;
      case 'response.output_text.delta':
      case 'response.text.delta':
      case 'response.output_audio_transcript.delta':
      case 'response.audio_transcript.delta': {
        const card = this.cardFor(e.response_id);
        const delta = str(e.delta);
        if (card && !card.answerDone && delta !== null) card.answer += delta;
        break;
      }
      case 'response.output_text.done':
      case 'response.text.done':
      case 'response.output_audio_transcript.done':
      case 'response.audio_transcript.done': {
        const card = this.cardFor(e.response_id);
        if (card) {
          const text = str(e.text) ?? str(e.transcript);
          if (text !== null && text.trim().length > 0) card.answer = text;
          this.complete(card);
        }
        break;
      }
      case 'response.done':
        this.onResponseDone(e.response);
        break;
      case 'error': {
        const err = isObject(e.error) ? e.error : {};
        const message = str(err.message);
        this.options.onError(
          message && message.trim().length > 0 ? message : 'OpenAI reported an error.',
          err.code === undefined || err.code === null ? null : String(err.code),
        );
        break;
      }
      default:
        return;
    }
    this.options.onChanged();
  }

  /** A typed question (always the interviewer's); answered by the next response unless expected. */
  addTyped(text: string): LiveTurn {
    const turn = new LiveTurn(null, text, true, 'interviewer');
    this.waiting.push(turn);
    return turn;
  }

  /**
   * The connection dropped: an answer being written is kept as it is (and
   * saved), and turns nobody answered are forgotten.
   */
  interrupt(): void {
    if (this.current) this.complete(this.current);
    for (const card of [...this.byResponse.values()]) {
      if (!card.answerDone) this.complete(card);
    }
    this.waiting.length = 0;
    this.expected.length = 0;
    this.speech = 'quiet';
    this.options.onChanged();
  }

  /** Hands over every finished card now, without waiting for transcripts (the session is ending). */
  finishAll(): void {
    this.interrupt();
    for (const card of [...this.cards]) {
      if (card.answerDone && card.hasAnswer) this.finish(card);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const t of this.waits.values()) clearTimeout(t);
    this.waits.clear();
  }

  private turnFor(itemId: unknown): LiveTurn | null {
    if (typeof itemId !== 'string' || itemId.length === 0) return null;
    const known = this.turns.get(itemId);
    if (known) return known;
    const turn = new LiveTurn(
      itemId,
      '',
      false,
      this.options.checksSpeakers ? null : 'interviewer',
    );
    this.turns.set(itemId, turn);
    this.waiting.push(turn);
    this.lines.push(turn);
    if (this.lines.length > 100) this.lines.shift();
    return turn;
  }

  /** A user audio item (beta `conversation.item.created`, GA `.added` / `.done`) is a turn. */
  private onItem(item: unknown): void {
    if (!isObject(item) || item.role !== 'user' || !Array.isArray(item.content)) return;
    const audio = item.content.filter(isObject).find((c) => c.type === 'input_audio');
    if (!audio) return;
    const turn = this.turnFor(item.id);
    const transcript = str(audio.transcript);
    if (turn && !turn.done && transcript !== null && transcript.trim().length > 0) {
      turn.text = transcript.trim();
      turn.done = true;
      this.transcriptIn(turn);
    }
  }

  private onResponseCreated(response: unknown): void {
    const id = isObject(response) ? codeOf(response.id) : null;
    if (id !== null && this.byResponse.has(id)) return;
    const card = new LiveCard(`c${this.n++}`, id);
    const expected = this.expected.shift();
    if (expected) {
      card.turns.push(...expected);
    } else {
      const turns = this.waiting.filter((t) => t.role === 'interviewer');
      card.turns.push(...turns);
      for (const t of turns) remove(this.waiting, t);
    }
    if (id !== null) this.byResponse.set(id, card);
    this.current = card;
    this.cards.push(card);
    this.speech = this.speech === 'hearing' ? 'hearing' : 'thinking';
  }

  private onResponseDone(response: unknown): void {
    const r = isObject(response) ? response : {};
    const card = this.cardFor(r.id);
    if (r.status === 'failed') {
      const details = isObject(r.status_details) ? r.status_details : {};
      const error = isObject(details.error) ? details.error : null;
      const message = error ? str(error.message) : null;
      if (message && message.trim().length > 0) {
        this.options.onError(message, codeOf(error?.code));
      }
    }
    if (card) {
      if (card.answer.trim().length === 0) card.answer = outputText(r.output);
      this.complete(card);
    }
    if (this.speech === 'thinking') this.speech = 'quiet';
  }

  private cardFor(responseId: unknown): LiveCard | null {
    if (typeof responseId === 'string') {
      const card = this.byResponse.get(responseId);
      if (card) return card;
    }
    return this.current;
  }

  private complete(card: LiveCard): void {
    if (card.answerDone) return;
    card.answerDone = true;
    if (this.current === card) this.current = null;
    if (!card.hasAnswer) {
      remove(this.cards, card);
      if (card.responseId !== null) this.byResponse.delete(card.responseId);
      return;
    }
    if (card.questionDone) {
      this.finish(card);
    } else {
      this.waits.set(
        card,
        setTimeout(() => {
          this.waits.delete(card);
          if (this.disposed) return;
          this.finish(card);
          this.options.onChanged();
        }, this.options.transcriptWait ?? 3000),
      );
    }
  }

  private transcriptIn(turn: LiveTurn): void {
    for (const card of this.cards) {
      if (card.turns.includes(turn) && card.answerDone && !card.finished && card.questionDone) {
        this.finish(card);
      }
    }
  }

  private finish(card: LiveCard): void {
    if (card.finished) return;
    card.finished = true;
    const wait = this.waits.get(card);
    if (wait !== undefined) clearTimeout(wait);
    this.waits.delete(card);
    this.options.onFinished(card);
  }
}

/** The text in a finished response's output items. */
function outputText(output: unknown): string {
  if (!Array.isArray(output)) return '';
  const parts: string[] = [];
  for (const item of output.filter(isObject)) {
    if (!Array.isArray(item.content)) continue;
    for (const c of item.content.filter(isObject)) {
      const text = str(c.text) ?? str(c.transcript);
      if (text !== null) parts.push(text);
    }
  }
  return parts.join('');
}

/** An id or a code as a string; null when it's missing. */
function codeOf(value: unknown): string | null {
  return value === undefined || value === null ? null : String(value);
}

function remove<T>(list: T[], item: T): void {
  const i = list.indexOf(item);
  if (i >= 0) list.splice(i, 1);
}
