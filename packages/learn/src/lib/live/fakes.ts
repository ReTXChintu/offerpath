/**
 * Test doubles for live practice: a socket to OpenAI, a microphone and a
 * speaker embedder. Nothing here touches the network, a microphone or a model.
 */
import type { LiveMic } from './mic';
import type { RealtimeConnector, RealtimeHandlers, RealtimeSocket } from './realtime';
import type { SpeakerEmbedder } from './speaker-embedder';
import { floatToPcm16 } from './voice-math';

export class FakeSocket implements RealtimeSocket {
  readonly sent: Record<string, unknown>[] = [];
  closed = false;

  constructor(
    readonly url: string,
    readonly clientSecret: string,
    private readonly handlers: RealtimeHandlers,
  ) {}

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(): void {
    this.closed = true;
  }

  /** A server event. */
  emit(event: Record<string, unknown>): void {
    this.handlers.onMessage(JSON.stringify(event));
  }

  /** The server dropped the connection. */
  drop(): void {
    this.closed = true;
    this.handlers.onClose();
  }

  /** The types of the events sent, in order. */
  types(): string[] {
    return this.sent.map((e) => String(e.type));
  }

  /** How many `response.create` were sent. */
  responseCreates(): number {
    return this.types().filter((t) => t === 'response.create').length;
  }
}

/** A connector that hands out FakeSockets and remembers them. */
export function fakeConnector(): RealtimeConnector & { sockets: FakeSocket[]; last(): FakeSocket } {
  const sockets: FakeSocket[] = [];
  const connect: RealtimeConnector = async (url, secret, handlers) => {
    const s = new FakeSocket(url, secret, handlers);
    sockets.push(s);
    return s;
  };
  return Object.assign(connect, {
    sockets,
    last: () => {
      const s = sockets[sockets.length - 1];
      if (!s) throw new Error('No socket was opened');
      return s;
    },
  });
}

export class FakeMic implements LiveMic {
  onAudio: ((pcm: Uint8Array) => void) | null = null;
  starts = 0;
  denied = false;

  async start(onAudio: (pcm: Uint8Array) => void): Promise<void> {
    if (this.denied) {
      const { MicDeniedError } = await import('./mic');
      throw new MicDeniedError();
    }
    this.starts++;
    this.onAudio = onAudio;
  }

  async stop(): Promise<void> {
    this.onAudio = null;
  }

  async dispose(): Promise<void> {
    this.onAudio = null;
  }

  get on(): boolean {
    return this.onAudio !== null;
  }

  /**
   * `ms` of 24 kHz audio in 100 ms chunks, at a constant level: positive for
   * the user's voice, negative for anyone else's (see `signEmbedder`).
   */
  speak(ms: number, level: number): void {
    for (let t = 0; t < ms; t += 100) {
      this.onAudio?.(floatToPcm16(new Float32Array(2400).fill(level)));
    }
  }
}

/**
 * An embedder that tells voices apart by the sign of the audio: positive is
 * [1, 0] (the user, with a voiceprint of [1, 0]), negative is [0, 1].
 */
export function signEmbedder(): SpeakerEmbedder & { calls: number } {
  const e = {
    calls: 0,
    async embed(samples: Float32Array) {
      e.calls++;
      let sum = 0;
      for (const s of samples) sum += s;
      return Float32Array.from(sum >= 0 ? [1, 0] : [0, 1]);
    },
    async dispose() {},
  };
  return e;
}
