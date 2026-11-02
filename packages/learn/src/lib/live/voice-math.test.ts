import { describe, expect, it } from 'vitest';

import { PcmRingBuffer } from './pcm-ring-buffer';
import {
  averageVoiceprint,
  checkTake,
  cosineSimilarity,
  floatToPcm16,
  isUsersTurn,
  l2Normalize,
  pcm16ToFloat,
  pcmLevel,
  resampleLinear,
  rms,
  speakerSamples,
  speechWindows,
  toBase64,
  trimSilence,
} from './voice-math';

describe('voice math (the phone voice_math.dart, ported)', () => {
  it('reads little-endian PCM16 and ignores an odd byte', () => {
    const bytes = new Uint8Array([0x00, 0x80, 0xff, 0x7f, 0x00, 0x00, 0x01]);
    expect(Array.from(pcm16ToFloat(bytes))).toEqual([-1, 32767 / 32768, 0]);
  });

  it('round-trips float to PCM16', () => {
    const back = pcm16ToFloat(floatToPcm16(Float32Array.from([0, 0.5, -0.5, 1, -1, 2])));
    expect(back[1]).toBeCloseTo(0.5, 3);
    expect(back[2]).toBeCloseTo(-0.5, 3);
    expect(back[5]).toBeCloseTo(1, 3);
  });

  it('resamples 24 kHz to 16 kHz by linear interpolation', () => {
    const input = Float32Array.from([0, 3, 6, 9, 12, 15]);
    // Output i sits at input position 1.5 i.
    expect(Array.from(resampleLinear(input, 24_000, 16_000))).toEqual([0, 4.5, 9, 13.5]);
    expect(resampleLinear(input, 16_000, 16_000)).not.toBe(input);
    expect(() => resampleLinear(input, 0, 1)).toThrow();
  });

  it('turns 24 kHz PCM16 into 16 kHz samples for the speaker model', () => {
    expect(speakerSamples(new Uint8Array(4800), 24_000)).toHaveLength(1600);
  });

  it('trims silence, keeping 100 ms around the sound', () => {
    const rate = 16_000;
    const s = new Float32Array(rate * 2);
    for (let i = rate / 2; i < rate; i++) s[i] = Math.sin(i / 5) * 0.5;
    const trimmed = trimSilence(s);
    expect(trimmed.length).toBeGreaterThanOrEqual(rate / 2);
    expect(trimmed.length).toBeLessThanOrEqual(rate / 2 + rate / 5 + 320);
    expect(trimSilence(new Float32Array(rate))).toHaveLength(0);
  });

  it('normalises, compares and averages embeddings', () => {
    expect(Array.from(l2Normalize([3, 4]))).toEqual([expect.closeTo(0.6), expect.closeTo(0.8)]);
    expect(Array.from(l2Normalize([0, 0]))).toEqual([0, 0]);
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0);
    const avg = averageVoiceprint([
      [2, 0],
      [0, 5],
    ]);
    expect(avg[0]).toBeCloseTo(Math.SQRT1_2);
    expect(avg[1]).toBeCloseTo(Math.SQRT1_2);
    expect(() => averageVoiceprint([])).toThrow();
    expect(() => averageVoiceprint([[1], [1, 2]])).toThrow();
  });

  it('checks a take is loud and long enough', () => {
    expect(checkTake(new Float32Array(0))).toBe('tooQuiet');
    expect(checkTake(new Float32Array(40_000).fill(0.001))).toBe('tooQuiet');
    expect(checkTake(new Float32Array(16_000).fill(0.1))).toBe('tooShort');
    expect(checkTake(new Float32Array(16_000).fill(0.1), { minSeconds: 1 })).toBeNull();
  });

  it('measures a level from -60 dBFS (0) to full scale (1)', () => {
    expect(pcmLevel(new Uint8Array(0))).toBe(0);
    expect(pcmLevel(new Uint8Array(200))).toBe(0);
    expect(pcmLevel(floatToPcm16(new Float32Array(100).fill(1)))).toBeCloseTo(1, 2);
  });

  it('encodes base64', () => {
    expect(toBase64(new Uint8Array([104, 105]))).toBe('aGk=');
  });
});

/** `n` samples of a sine at `freq` Hz, 16 kHz. */
function sine(n: number, freq: number, amplitude = 0.5): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / 16_000);
  return out;
}

describe('speech windows (the phone speechWindows / isUsersTurn)', () => {
  it('splits a turn into 1.5 s windows every 0.75 s, plus one ending at the end', () => {
    const windows = speechWindows(sine(41_600, 220));
    expect(windows).toHaveLength(3);
    expect(windows.every((w) => w.length === 24_000)).toBe(true);
    expect(windows[2]?.byteOffset).toBe((41_600 - 24_000) * 4);
  });

  it('a short turn is one window; silence is none', () => {
    expect(speechWindows(sine(16_000, 220))).toHaveLength(1);
    expect(speechWindows(new Float32Array(16_000))).toHaveLength(0);
    expect(speechWindows(new Float32Array(48_000))).toHaveLength(0);
  });

  it('pauses are skipped, but a quieter voice is kept', () => {
    const samples = new Float32Array(16_000 * 6);
    // A loud voice, a pause, then a voice a third as loud.
    samples.set(sine(24_000, 220), 0);
    samples.set(sine(32_000, 220, 0.15), 16_000 * 4);
    const windows = speechWindows(samples);
    expect(windows.filter((w) => rms(w) < 0.15).length).toBeGreaterThan(0);
    expect(windows.some((w) => rms(w) === 0)).toBe(false);
  });

  it('a long turn is checked in at most 16 windows, first and last included', () => {
    const samples = sine(16_000 * 60, 220);
    const windows = speechWindows(samples);
    expect(windows).toHaveLength(16);
    expect(windows[0]?.byteOffset).toBe(0);
    const last = windows[15];
    expect((last?.byteOffset ?? 0) / 4 + (last?.length ?? 0)).toBe(samples.length);
  });

  it("a turn is the user's only when every window sounds like them", () => {
    expect(isUsersTurn([0.8, 0.75, 0.7], 0.64)).toBe(true);
    // One clearly different stretch: the partner spoke.
    expect(isUsersTurn([0.8, 0.8, 0.1], 0.64)).toBe(false);
    // A little under the threshold is still them, when the rest is.
    expect(isUsersTurn([0.8, 0.55, 0.75], 0.64)).toBe(true);
    expect(isUsersTurn([0.6, 0.6], 0.64)).toBe(false);
    expect(isUsersTurn([], 0.64)).toBe(false);
  });
});

describe('PcmRingBuffer', () => {
  const ms = (n: number, value: number) => new Uint8Array(n * 48).fill(value);

  it('slices by milliseconds since the connection started', () => {
    const b = new PcmRingBuffer(1000);
    b.add(ms(100, 1));
    b.add(ms(100, 2));
    expect(b.totalMs).toBe(200);
    const s = b.slice(50, 150);
    expect(s).toHaveLength(100 * 48);
    expect(s?.[0]).toBe(1);
    expect(s?.[s.length - 1]).toBe(2);
    // An end past what was written is cut to it.
    expect(b.slice(150, 500)).toHaveLength(50 * 48);
    expect(b.slice(300, 400)).toBeNull();
    expect(b.slice(10, 10)).toBeNull();
  });

  it('forgets what was overwritten and starts again on reset', () => {
    const b = new PcmRingBuffer(100);
    b.add(ms(80, 1));
    b.add(ms(80, 2));
    expect(b.slice(0, 50)).toBeNull();
    expect(b.slice(80, 160)?.every((v) => v === 2)).toBe(true);
    b.add(ms(300, 3));
    expect(b.slice(400, 460)?.every((v) => v === 3)).toBe(true);
    b.reset();
    expect(b.totalBytes).toBe(0);
    expect(b.slice(0, 10)).toBeNull();
  });
});
