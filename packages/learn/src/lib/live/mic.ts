/**
 * The microphone as raw audio for OpenAI Realtime: PCM16 little-endian,
 * 24 kHz, mono, about 100 ms per chunk. Behind an interface so tests use a
 * fake (`docs/live-practice.md`, "Desktop and web").
 */
export interface LiveMic {
  /**
   * Asks for the microphone (the browser's prompt, the first time) and starts
   * recording; `onAudio` gets each chunk. Rejects with `MicDeniedError` when
   * the user or the system refuses it.
   */
  start(onAudio: (pcm: Uint8Array) => void): Promise<void>;
  /** Stops recording; no more chunks arrive. */
  stop(): Promise<void>;
  dispose(): Promise<void>;
}

/** The microphone permission was refused (or there's no microphone). */
export class MicDeniedError extends Error {
  constructor(message = 'The microphone permission was refused.') {
    super(message);
    this.name = 'MicDeniedError';
  }
}

/**
 * Whether this page can listen at all. `navigator.mediaDevices` exists only
 * in a secure context: HTTPS, localhost, or the desktop app's own origin
 * (`http://tauri.localhost` counts as localhost). The web app served over
 * plain `http://<ip>:50004` can't, by the browser's rules.
 */
export function canListen(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.isSecureContext === true &&
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof window.AudioContext === 'function' &&
    typeof AudioWorkletNode === 'function'
  );
}

/**
 * The capture constraints. Echo cancellation, noise suppression and automatic
 * gain are all off, deliberately, like the phone's recorder: nothing is
 * played back (answers are text), so there is no echo to cancel; OpenAI's
 * far-field noise reduction runs on its side; and the browser's processing
 * changes the voice the speaker model compares with a voiceprint recorded
 * raw on the phone.
 */
export const MIC_CONSTRAINTS: MediaTrackConstraints = {
  channelCount: 1,
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
};

/** Where the worklet is: `dist/pcm-capture.worklet.js`, next to this module once built. */
function workletUrl(): string {
  return new URL('./pcm-capture.worklet.js', import.meta.url).href;
}

/** `LiveMic` on getUserMedia and an AudioWorklet. */
export class BrowserLiveMic implements LiveMic {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;

  async start(onAudio: (pcm: Uint8Array) => void): Promise<void> {
    if (!canListen()) {
      throw new Error('This page cannot use the microphone (it needs a secure context).');
    }
    await this.stop();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS, video: false });
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'NotFoundError') {
        throw new MicDeniedError(name === 'NotFoundError' ? 'No microphone was found.' : undefined);
      }
      throw error;
    }
    this.stream = stream;
    try {
      // A 24 kHz context lets the browser resample the microphone well;
      // where that isn't allowed, the worklet resamples from the device rate.
      let context: AudioContext;
      try {
        context = new AudioContext({ sampleRate: 24_000, latencyHint: 'interactive' });
      } catch {
        context = new AudioContext({ latencyHint: 'interactive' });
      }
      this.context = context;
      await context.audioWorklet.addModule(workletUrl());
      let source: MediaStreamAudioSourceNode;
      try {
        source = context.createMediaStreamSource(stream);
      } catch {
        // Firefox: a microphone can't feed a context at another rate.
        await context.close();
        const fallback = new AudioContext({ latencyHint: 'interactive' });
        this.context = fallback;
        await fallback.audioWorklet.addModule(workletUrl());
        source = fallback.createMediaStreamSource(stream);
      }
      const ctx = this.context;
      const node = new AudioWorkletNode(ctx, 'offerpath-pcm-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
        channelCountMode: 'explicit',
      });
      node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        onAudio(new Uint8Array(event.data));
      };
      source.connect(node);
      this.node = node;
      if (ctx.state === 'suspended') await ctx.resume();
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    const { node, context, stream } = this;
    this.node = null;
    this.context = null;
    this.stream = null;
    if (node) {
      node.port.onmessage = null;
      node.disconnect();
    }
    for (const track of stream?.getTracks() ?? []) track.stop();
    if (context && context.state !== 'closed') {
      try {
        await context.close();
      } catch {
        // Already closing.
      }
    }
  }

  dispose(): Promise<void> {
    return this.stop();
  }
}
