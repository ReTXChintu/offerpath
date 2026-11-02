// @vitest-environment node
/**
 * The JS speaker embedding matches the phone's (sherpa-onnx), so one
 * voiceprint works on every device (`docs/live-practice.md`, "Desktop and
 * web").
 *
 * The fixtures are three 1.2 s clips (16 kHz PCM16) and what sherpa-onnx
 * 2.0.1 and kaldi-native-fbank made of them (`__fixtures__/reference.json`,
 * `david-1.fbank.f32`); `docs/live-practice.md` says how they were made.
 *
 * - The fbank features are checked against kaldi-native-fbank's always.
 * - The embeddings are checked against sherpa-onnx's when the model is on
 *   this machine: set OFFERPATH_SPEAKER_MODEL to
 *   `wespeaker_en_voxceleb_resnet34_LM.onnx` (26 MB, not in git).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { computeFbank } from './fbank';
import { OrtSpeakerEmbedder, type OrtModule } from './speaker-embedder';
import { cosineSimilarity, pcm16ToFloat } from './voice-math';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(here, '__fixtures__', name));

interface Reference {
  model: string;
  clips: Record<string, { samples: number; frames: number; embedding: number[] }>;
}
const reference = JSON.parse(fixture('reference.json').toString('utf8')) as Reference;

/** A 16 kHz mono PCM16 WAV's samples in [-1, 1] (the 44-byte header skipped). */
function wavSamples(name: string): Float32Array {
  const bytes = new Uint8Array(fixture(`${name}.wav`));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(view.getUint32(24, true)).toBe(16_000);
  expect(view.getUint16(22, true)).toBe(1);
  return pcm16ToFloat(bytes.subarray(44));
}

describe('fbank features', () => {
  it('match kaldi-native-fbank with sherpa-onnx speaker settings', () => {
    const samples = wavSamples('david-1');
    const ours = computeFbank(samples);
    const raw = fixture('david-1.fbank.f32');
    const theirs = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
    expect(ours.frames).toBe(reference.clips['david-1']?.frames);
    expect(ours.data.length).toBe(theirs.length);
    let maxDiff = 0;
    for (let i = 0; i < theirs.length; i++) {
      maxDiff = Math.max(maxDiff, Math.abs((ours.data[i] ?? 0) - (theirs[i] ?? 0)));
    }
    console.warn(`fbank parity: max abs difference ${maxDiff.toExponential(2)}`);
    // log-mel energies are ~5..25; float32 rounding in the reference is ~1e-5.
    expect(maxDiff).toBeLessThan(1e-3);
  });

  it('counts frames like snip_edges=false', () => {
    for (const clip of Object.values(reference.clips)) {
      expect(computeFbank(new Float32Array(clip.samples)).frames).toBe(clip.frames);
    }
    expect(computeFbank(new Float32Array(0)).frames).toBe(0);
  });
});

const modelPath = process.env.OFFERPATH_SPEAKER_MODEL ?? '';
const haveModel = modelPath.length > 0 && existsSync(modelPath);

describe.skipIf(!haveModel)('speaker embeddings (needs OFFERPATH_SPEAKER_MODEL)', () => {
  it('match sherpa-onnx: cosine at least 0.99 for every clip', async () => {
    const ort = (await import('onnxruntime-web')) as unknown as OrtModule;
    const embedder = new OrtSpeakerEmbedder(new Uint8Array(readFileSync(modelPath)), async () => {
      ort.env.wasm.numThreads = 1;
      return ort;
    });
    const results: Record<string, number> = {};
    for (const [name, clip] of Object.entries(reference.clips)) {
      const ours = await embedder.embed(wavSamples(name));
      expect(ours.length).toBe(clip.embedding.length);
      results[name] = cosineSimilarity(ours, clip.embedding);
    }
    await embedder.dispose();
    console.warn(`speaker embedding parity (cosine vs sherpa-onnx): ${JSON.stringify(results)}`);
    for (const cos of Object.values(results)) expect(cos).toBeGreaterThanOrEqual(0.99);
  }, 120_000);
});
