import type * as Ort from 'onnxruntime-web';

import { computeFbank } from './fbank';
import { cosineSimilarity, l2Normalize } from './voice-math';

/**
 * Turns speech into a speaker embedding: a vector that is close (cosine) for
 * the same voice and far for different ones. In the apps it's the WeSpeaker
 * model the phone uses, run with onnxruntime-web over the same fbank
 * features sherpa-onnx computes (`fbank.ts`), so a voiceprint made on either
 * device works on the other. Tests use a fake.
 */
export interface SpeakerEmbedder {
  /** The embedding of `samples16k`: mono, 16 kHz, in [-1, 1]. */
  embed(samples16k: Float32Array): Promise<Float32Array>;
  dispose(): Promise<void>;
}

/** Makes an embedder for the model's bytes. */
export type SpeakerEmbedderFactory = (model: Uint8Array) => SpeakerEmbedder;

/** The parts of onnxruntime-web the embedder uses. */
export type OrtModule = Pick<typeof Ort, 'InferenceSession' | 'Tensor' | 'env'>;

/**
 * onnxruntime-web's WebAssembly build, loaded the first time a voice is
 * recognised (never on the other pages). One thread: a webview served
 * without cross-origin isolation has no SharedArrayBuffer.
 */
export async function loadOrt(): Promise<OrtModule> {
  const ort = await import('onnxruntime-web/wasm');
  ort.env.wasm.numThreads = 1;
  return ort;
}

type Session = Awaited<ReturnType<OrtModule['InferenceSession']['create']>>;

/** [SpeakerEmbedder] on onnxruntime-web; the session starts on the first `embed`. */
export class OrtSpeakerEmbedder implements SpeakerEmbedder {
  private session: Promise<Session> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;
  private ort: OrtModule | null = null;

  constructor(
    private readonly model: Uint8Array,
    private readonly load: () => Promise<OrtModule> = loadOrt,
  ) {}

  private start(): Promise<Session> {
    this.session ??= (async () => {
      const ort = (this.ort = await this.load());
      return ort.InferenceSession.create(this.model, { executionProviders: ['wasm'] });
    })().catch((error: unknown) => {
      // Let the next call try again.
      this.session = null;
      throw error;
    });
    return this.session;
  }

  embed(samples16k: Float32Array): Promise<Float32Array> {
    // One at a time: a turn's work never overlaps the next one's.
    const run = this.queue.then(() => this.embedNow(samples16k));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async embedNow(samples16k: Float32Array): Promise<Float32Array> {
    if (this.disposed) throw new Error('The voice model was closed.');
    const session = await this.start();
    const ort = this.ort;
    if (!ort || this.disposed) throw new Error('The voice model was closed.');
    const feats = computeFbank(samples16k);
    if (feats.frames < 1) throw new Error('Too short to recognise.');
    const input = new ort.Tensor('float32', feats.data, [1, feats.frames, feats.bins]);
    const inputName = session.inputNames[0] ?? 'feats';
    const outputName = session.outputNames[0] ?? 'embs';
    const out = await session.run({ [inputName]: input });
    const embedding = out[outputName];
    if (!embedding) throw new Error('No embedding.');
    return Float32Array.from(embedding.data as Float32Array);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const session = this.session;
    this.session = null;
    if (!session) return;
    try {
      await (await session).release();
    } catch {
      // Closing is best effort.
    }
  }
}

/** The default factory. */
export const ortSpeakerEmbedder: SpeakerEmbedderFactory = (model) => new OrtSpeakerEmbedder(model);

/** The user's voiceprint and how to compare a turn with it, for one session. */
export class LiveVoice {
  /** Normalised. */
  readonly voiceprint: Float32Array;

  constructor(
    readonly embedder: SpeakerEmbedder,
    voiceprint: ArrayLike<number>,
    /** At or above it, a turn is the user's. */
    readonly threshold: number,
  ) {
    this.voiceprint = l2Normalize(voiceprint);
  }

  /** How similar `samples16k` is to the user's voice (cosine, -1 to 1). */
  async similarity(samples16k: Float32Array): Promise<number> {
    return cosineSimilarity(await this.embedder.embed(samples16k), this.voiceprint);
  }

  dispose(): Promise<void> {
    return this.embedder.dispose();
  }
}
