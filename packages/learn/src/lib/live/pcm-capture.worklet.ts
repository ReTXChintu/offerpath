/**
 * The microphone's AudioWorklet (`mic.ts`): takes the input's float samples
 * at the AudioContext's rate, resamples them to 24 kHz when the context runs
 * at another rate (Firefox won't open a 24 kHz context on a microphone), and
 * posts PCM16 mono, about 100 ms (2,400 samples) at a time, to the page.
 *
 * Built on its own (`dist/pcm-capture.worklet.js`) and loaded by URL, from
 * the app's own origin, so it needs no `blob:` in the desktop's CSP.
 */

// The AudioWorkletGlobalScope's names, which the DOM lib doesn't declare.
declare const sampleRate: number;
declare function registerProcessor(name: string, processor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

const TARGET_RATE = 24_000;
const CHUNK = 2_400;

class PcmCaptureProcessor extends AudioWorkletProcessor {
  private readonly ratio = sampleRate / TARGET_RATE;
  private readonly out = new Int16Array(CHUNK);
  private filled = 0;
  /** Where the next output sample sits, in input samples from the current block's start. */
  private pos = 0;
  /** The previous block's last sample, for interpolating across blocks. */
  private last = 0;

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (!channel || channel.length === 0) return true;
    if (this.ratio === 1) {
      for (let i = 0; i < channel.length; i++) this.push(channel[i] ?? 0);
      return true;
    }
    // Linear interpolation; position -1 is the previous block's last sample.
    const n = channel.length;
    while (this.pos < n - 1) {
      const i0 = Math.floor(this.pos);
      const frac = this.pos - i0;
      const a = i0 < 0 ? this.last : (channel[i0] ?? 0);
      const b = channel[i0 + 1] ?? 0;
      this.push(a + (b - a) * frac);
      this.pos += this.ratio;
    }
    this.pos -= n;
    this.last = channel[n - 1] ?? 0;
    return true;
  }

  private push(sample: number) {
    const s = Math.max(-1, Math.min(1, sample));
    this.out[this.filled++] = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
    if (this.filled === CHUNK) {
      const chunk = this.out.slice(0, CHUNK);
      this.port.postMessage(chunk.buffer, [chunk.buffer]);
      this.filled = 0;
    }
  }
}

registerProcessor('offerpath-pcm-capture', PcmCaptureProcessor);
