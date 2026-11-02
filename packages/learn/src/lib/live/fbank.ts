/**
 * Kaldi filterbank features exactly as sherpa-onnx computes them for its
 * speaker embedding extractor, so a voiceprint the phone made (sherpa-onnx)
 * and an embedding this app makes (onnxruntime-web) match.
 *
 * sherpa-onnx's `FeatureExtractorConfig` defaults, into kaldi-native-fbank's
 * `OnlineFbank` (`sherpa-onnx/csrc/features.{h,cc}`):
 * - 16 kHz, 80 mel bins, 25 ms frames every 10 ms (400 / 160 samples), padded
 *   to a 512-point FFT;
 * - `dither` 0, `snip_edges` false (frame i is centred on `160 i + 80`, and
 *   the edges are reflected), `remove_dc_offset` on, pre-emphasis 0.97, the
 *   "povey" window;
 * - power spectrum, mel bins from 20 Hz to Nyquist - 400 Hz (Kaldi's HTK mel
 *   scale), `log(max(energy, FLT_EPSILON))`, no energy column.
 *
 * WeSpeaker's models carry `normalize_samples = 0` in their metadata, so the
 * samples are scaled by 32768 first, and no `feature_normalize_type`, so no
 * mean is subtracted afterwards. `fbank.test.ts` checks this against
 * kaldi-native-fbank's own output.
 */

export const FBANK_BINS = 80;
const SAMPLE_RATE = 16_000;
const FRAME_SHIFT = 160;
const FRAME_LENGTH = 400;
const FFT_SIZE = 512;
const PREEMPH = 0.97;
const LOW_FREQ = 20;
const HIGH_FREQ = -400;
const FLT_EPSILON = 1.1920928955078125e-7;

export interface Fbank {
  /** Row-major, `frames` x `bins`. */
  data: Float32Array;
  frames: number;
  bins: number;
}

/** How many frames `numSamples` give (snip_edges false, input finished). */
export function fbankFrames(numSamples: number): number {
  return Math.floor((numSamples + FRAME_SHIFT / 2) / FRAME_SHIFT);
}

let tables: {
  window: Float64Array;
  cos: Float64Array;
  sin: Float64Array;
  bitrev: Uint16Array;
  mel: { first: number; weights: Float64Array }[];
} | null = null;

function melScale(freq: number): number {
  return 1127 * Math.log(1 + freq / 700);
}

function setUp() {
  if (tables) return tables;
  const window = new Float64Array(FRAME_LENGTH);
  const a = (2 * Math.PI) / (FRAME_LENGTH - 1);
  for (let i = 0; i < FRAME_LENGTH; i++) window[i] = Math.pow(0.5 - 0.5 * Math.cos(a * i), 0.85);

  const cos = new Float64Array(FFT_SIZE / 2);
  const sin = new Float64Array(FFT_SIZE / 2);
  for (let i = 0; i < FFT_SIZE / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / FFT_SIZE);
    sin[i] = Math.sin((2 * Math.PI * i) / FFT_SIZE);
  }
  const bits = Math.log2(FFT_SIZE);
  const bitrev = new Uint16Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    bitrev[i] = r;
  }

  // kaldi-native-fbank's InitKaldiMelBanks (no VTLN, htk_mode off).
  const nyquist = SAMPLE_RATE / 2;
  const highFreq = nyquist + HIGH_FREQ;
  const numFftBins = FFT_SIZE / 2;
  const binWidth = SAMPLE_RATE / FFT_SIZE;
  const melLow = melScale(LOW_FREQ);
  const melHigh = melScale(highFreq);
  const delta = (melHigh - melLow) / (FBANK_BINS + 1);
  const mel: { first: number; weights: Float64Array }[] = [];
  for (let bin = 0; bin < FBANK_BINS; bin++) {
    const left = melLow + bin * delta;
    const center = melLow + (bin + 1) * delta;
    const right = melLow + (bin + 2) * delta;
    const weights: number[] = [];
    let first = -1;
    for (let i = 0; i < numFftBins; i++) {
      const m = melScale(binWidth * i);
      if (m > left && m < right) {
        if (first === -1) first = i;
        const w = m <= center ? (m - left) / (center - left) : (right - m) / (right - center);
        // Bins between first and last are contiguous: the triangle has no holes.
        weights[i - first] = w;
      }
    }
    mel.push({ first, weights: Float64Array.from(weights, (w) => w ?? 0) });
  }
  tables = { window, cos, sin, bitrev, mel };
  return tables;
}

/** In-place radix-2 FFT of (re, im), length FFT_SIZE. */
function fft(re: Float64Array, im: Float64Array) {
  const t = setUp();
  for (let i = 0; i < FFT_SIZE; i++) {
    const j = t.bitrev[i] ?? 0;
    if (j > i) {
      const r = re[i] ?? 0;
      re[i] = re[j] ?? 0;
      re[j] = r;
      const m = im[i] ?? 0;
      im[i] = im[j] ?? 0;
      im[j] = m;
    }
  }
  for (let size = 2; size <= FFT_SIZE; size *= 2) {
    const half = size / 2;
    const step = FFT_SIZE / size;
    for (let start = 0; start < FFT_SIZE; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = t.cos[k * step] ?? 0;
        const wi = -(t.sin[k * step] ?? 0);
        const a = start + k;
        const b = a + half;
        const br = re[b] ?? 0;
        const bi = im[b] ?? 0;
        const xr = br * wr - bi * wi;
        const xi = br * wi + bi * wr;
        re[b] = (re[a] ?? 0) - xr;
        im[b] = (im[a] ?? 0) - xi;
        re[a] = (re[a] ?? 0) + xr;
        im[a] = (im[a] ?? 0) + xi;
      }
    }
  }
}

/**
 * The fbank features of `samples` (mono, 16 kHz, in [-1, 1]), as
 * sherpa-onnx's speaker extractor makes them after `acceptWaveform` and
 * `inputFinished`.
 */
export function computeFbank(samples: Float32Array): Fbank {
  const t = setUp();
  const n = samples.length;
  const frames = n === 0 ? 0 : fbankFrames(n);
  const data = new Float32Array(frames * FBANK_BINS);
  const frame = new Float64Array(FRAME_LENGTH);
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  const power = new Float64Array(FFT_SIZE / 2 + 1);
  for (let f = 0; f < frames; f++) {
    // Frame f's first sample (snip_edges false): centred on 160 f + 80.
    const start = FRAME_SHIFT * f + FRAME_SHIFT / 2 - FRAME_LENGTH / 2;
    let sum = 0;
    for (let s = 0; s < FRAME_LENGTH; s++) {
      let i = start + s;
      // Reflect around either end: -1 -> 0, n -> n - 1.
      while (i < 0 || i >= n) i = i < 0 ? -i - 1 : 2 * n - 1 - i;
      const v = (samples[i] ?? 0) * 32768;
      frame[s] = v;
      sum += v;
    }
    const mean = sum / FRAME_LENGTH;
    for (let s = 0; s < FRAME_LENGTH; s++) frame[s] = (frame[s] ?? 0) - mean;
    for (let s = FRAME_LENGTH - 1; s > 0; s--) {
      frame[s] = (frame[s] ?? 0) - PREEMPH * (frame[s - 1] ?? 0);
    }
    frame[0] = (frame[0] ?? 0) - PREEMPH * (frame[0] ?? 0);
    re.fill(0);
    im.fill(0);
    for (let s = 0; s < FRAME_LENGTH; s++) re[s] = (frame[s] ?? 0) * (t.window[s] ?? 0);
    fft(re, im);
    for (let k = 0; k <= FFT_SIZE / 2; k++) power[k] = (re[k] ?? 0) ** 2 + (im[k] ?? 0) ** 2;
    const row = f * FBANK_BINS;
    for (let b = 0; b < FBANK_BINS; b++) {
      const bank = t.mel[b];
      let energy = 0;
      if (bank) {
        for (let k = 0; k < bank.weights.length; k++) {
          energy += (bank.weights[k] ?? 0) * (power[bank.first + k] ?? 0);
        }
      }
      data[row + b] = Math.log(Math.max(energy, FLT_EPSILON));
    }
  }
  return { data, frames, bins: FBANK_BINS };
}
