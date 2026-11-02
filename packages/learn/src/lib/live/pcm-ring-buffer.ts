/**
 * The last `capacityMs` of the audio sent on one realtime connection,
 * indexed by milliseconds since its first byte. OpenAI's voice detection
 * gives each turn's start and end in those milliseconds
 * (`input_audio_buffer.speech_started` / `speech_stopped`), and `slice` cuts
 * the turn out to check whose voice it is. The phone's `PcmRingBuffer`.
 */
export class PcmRingBuffer {
  private readonly data: Uint8Array;
  /** Bytes written since the last `reset`. */
  private written = 0;

  constructor(
    /** How much audio is kept. */
    readonly capacityMs = 60_000,
    /** PCM16 mono at 24 kHz: 48 bytes per millisecond. */
    readonly bytesPerMs = 48,
  ) {
    this.data = new Uint8Array(capacityMs * bytesPerMs);
  }

  get totalBytes(): number {
    return this.written;
  }

  /** Milliseconds of audio written since the last `reset`. */
  get totalMs(): number {
    return Math.floor(this.written / this.bytesPerMs);
  }

  /** The first byte still held. */
  private get oldest(): number {
    return Math.max(0, this.written - this.data.length);
  }

  /** A new connection: the milliseconds start again from zero. */
  reset(): void {
    this.written = 0;
  }

  add(bytes: Uint8Array): void {
    let src = bytes;
    // More than fits: only the newest part matters.
    if (src.length > this.data.length) {
      this.written += src.length - this.data.length;
      src = src.subarray(src.length - this.data.length);
    }
    let pos = this.written % this.data.length;
    let offset = 0;
    while (offset < src.length) {
      const n = Math.min(src.length - offset, this.data.length - pos);
      this.data.set(src.subarray(offset, offset + n), pos);
      offset += n;
      pos = (pos + n) % this.data.length;
    }
    this.written += src.length;
  }

  /**
   * The audio from `startMs` to `endMs` (an end past what was written is cut
   * to it). Null when the start has already been overwritten, or there's
   * nothing in the range.
   */
  slice(startMs: number, endMs: number): Uint8Array | null {
    if (startMs < 0 || endMs <= startMs) return null;
    const start = startMs * this.bytesPerMs;
    const end = Math.min(endMs * this.bytesPerMs, this.written);
    if (start < this.oldest || end <= start) return null;
    const out = new Uint8Array(end - start);
    let pos = start % this.data.length;
    let offset = 0;
    while (offset < out.length) {
      const n = Math.min(out.length - offset, this.data.length - pos);
      out.set(this.data.subarray(pos, pos + n), offset);
      offset += n;
      pos = (pos + n) % this.data.length;
    }
    return out;
  }
}
