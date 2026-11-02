import { describe, expect, it } from 'vitest';

import { PcmRingBuffer } from './pcm-ring-buffer';
import {
  averageVoiceprint,
  checkTake,
  cosineSimilarity,
  floatToPcm16,
  l2Normalize,
  pcm16ToFloat,
  pcmLevel,
  resampleLinear,
  speakerSamples,
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
