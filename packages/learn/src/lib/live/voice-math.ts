/**
 * The audio arithmetic behind recognising the user's voice
 * (`docs/live-practice.md`, "Your voice"): PCM16 to float samples,
 * resampling the microphone's 24 kHz to the speaker model's 16 kHz, trimming
 * silence, and comparing embeddings. A port of the phone's
 * `voice_math.dart`, step for step, so a voiceprint recorded on the phone and
 * a turn heard on the laptop are measured alike.
 */

/** The speaker model's sample rate. */
export const SPEAKER_SAMPLE_RATE = 16_000;

/** What OpenAI Realtime takes: PCM16 mono at 24 kHz. */
export const REALTIME_SAMPLE_RATE = 24_000;

/** 100 ms of PCM16 mono at 24 kHz. */
export const REALTIME_CHUNK_BYTES = (REALTIME_SAMPLE_RATE * 2) / 10;

/** Little-endian PCM16 as samples in [-1, 1]. An odd last byte is ignored. */
export function pcm16ToFloat(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = Math.floor(bytes.byteLength / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}

/** Samples in [-1, 1] as little-endian PCM16 (clamped). */
export function floatToPcm16(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(i * 2, s < 0 ? Math.round(s * 32768) : Math.round(s * 32767), true);
  }
  return out;
}

/**
 * `input` at `fromRate` resampled to `toRate` by linear interpolation.
 * Output sample i sits at input position `i * fromRate / toRate`.
 */
export function resampleLinear(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate <= 0 || toRate <= 0) throw new RangeError('Sample rates must be positive');
  if (fromRate === toRate || input.length === 0) return Float32Array.from(input);
  const outLength = Math.floor((input.length * toRate) / fromRate);
  const out = new Float32Array(outLength);
  const last = input.length - 1;
  for (let i = 0; i < outLength; i++) {
    // Integer arithmetic for the position keeps it exact for 24k -> 16k.
    const pos = i * fromRate;
    const i0 = Math.floor(pos / toRate);
    const frac = (pos - i0 * toRate) / toRate;
    const a = input[i0 > last ? last : i0] ?? 0;
    const b = input[i0 + 1 > last ? last : i0 + 1] ?? 0;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/** The root mean square of `samples`, 0 for none. */
export function rms(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i] ?? 0;
    sum += s * s;
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * `samples` without the quiet at either end. A 20 ms frame counts as sound
 * when its RMS is at least a tenth of the loudest frame's (and above a
 * floor); 100 ms either side of the sound is kept. Empty when nothing is
 * above the floor.
 */
export function trimSilence(
  samples: Float32Array,
  { sampleRate = SPEAKER_SAMPLE_RATE, floor = 0.003 }: { sampleRate?: number; floor?: number } = {},
): Float32Array {
  const frame = Math.floor(sampleRate / 50);
  if (frame <= 0 || samples.length < frame) return new Float32Array(0);
  const frames = Math.floor(samples.length / frame);
  const levels: number[] = [];
  for (let f = 0; f < frames; f++) levels.push(rms(samples.subarray(f * frame, (f + 1) * frame)));
  const loudest = Math.max(...levels);
  const threshold = Math.max(floor, loudest * 0.1);
  const first = levels.findIndex((l) => l >= threshold);
  if (first < 0) return new Float32Array(0);
  let lastFrame = levels.length - 1;
  while (lastFrame >= 0 && (levels[lastFrame] ?? 0) < threshold) lastFrame--;
  const pad = Math.floor(sampleRate / 10);
  const start = Math.max(0, first * frame - pad);
  const end = Math.min(samples.length, (lastFrame + 1) * frame + pad);
  return samples.slice(start, end);
}

/** `v` scaled to length 1 (all zeros stays all zeros). */
export function l2Normalize(v: ArrayLike<number>): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += (v[i] ?? 0) ** 2;
  const norm = Math.sqrt(sum);
  const out = new Float32Array(v.length);
  if (norm === 0) return out;
  for (let i = 0; i < v.length; i++) out[i] = (v[i] ?? 0) / norm;
  return out;
}

/** The cosine similarity of a and b, -1 to 1; 0 when either is all zeros or their lengths differ. */
export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** The voiceprint of several embeddings: each normalised, averaged, and the average normalised. */
export function averageVoiceprint(embeddings: ArrayLike<number>[]): Float32Array {
  const first = embeddings[0];
  if (!first) throw new RangeError('No embeddings');
  const dim = first.length;
  if (embeddings.some((e) => e.length !== dim)) throw new RangeError('Embeddings differ in length');
  const sum = new Float64Array(dim);
  for (const e of embeddings) {
    const n = l2Normalize(e);
    for (let i = 0; i < dim; i++) sum[i] = (sum[i] ?? 0) + (n[i] ?? 0);
  }
  for (let i = 0; i < dim; i++) sum[i] = (sum[i] ?? 0) / embeddings.length;
  return l2Normalize(sum);
}

/** Why a recording can't be used. */
export type TakeProblem = 'tooShort' | 'tooQuiet';

/**
 * Checks speech that `trimSilence` kept: at least `minSeconds` long and loud
 * enough (RMS of at least `minRms`, about -40 dBFS). Null when it's fine.
 */
export function checkTake(
  speech: Float32Array,
  {
    sampleRate = SPEAKER_SAMPLE_RATE,
    minSeconds = 2,
    minRms = 0.01,
  }: { sampleRate?: number; minSeconds?: number; minRms?: number } = {},
): TakeProblem | null {
  if (speech.length === 0) return 'tooQuiet';
  if (rms(speech) < minRms) return 'tooQuiet';
  if (speech.length < minSeconds * sampleRate) return 'tooShort';
  return null;
}

/** Microphone audio (PCM16 at `fromRate`) ready for the speaker model: float samples at 16 kHz. */
export function speakerSamples(pcm16: Uint8Array, fromRate: number): Float32Array {
  return resampleLinear(pcm16ToFloat(pcm16), fromRate, SPEAKER_SAMPLE_RATE);
}

/**
 * The loudness of a stretch of PCM16 audio, 0 (silence, -60 dBFS and below)
 * to 1 (full scale), for a level meter.
 */
export function pcmLevel(pcm: Uint8Array): number {
  const samples = Math.floor(pcm.byteLength / 2);
  if (samples === 0) return 0;
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const s = view.getInt16(i * 2, true) / 32768;
    sum += s * s;
  }
  const level = Math.sqrt(sum / samples);
  if (level <= 0) return 0;
  const db = 20 * Math.log10(level);
  return Math.min(1, Math.max(0, (db + 60) / 60));
}

/** Little-endian PCM16 bytes as base64, for `input_audio_buffer.append`. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}
