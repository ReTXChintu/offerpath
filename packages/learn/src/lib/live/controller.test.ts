import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api';
import type { LiveExchange, LivePracticeView, RealtimePass } from '../live-practice';

import { LivePracticeController, LIVE_MIC_DENIED_MESSAGE, type LiveSessionApi } from './controller';
import { FakeMic, fakeConnector, signEmbedder, type FakeSocket } from './fakes';
import { LiveVoice } from './speaker-embedder';

const view = (over: Partial<LivePracticeView> = {}): LivePracticeView => ({
  id: 's1',
  prepId: null,
  title: 'Live practice',
  technologies: [],
  answerFor: 'me',
  status: 'ACTIVE',
  exchanges: [],
  createdAt: '2026-11-01T10:00:00.000Z',
  endedAt: null,
  ...over,
});

const pass = (n = 1): RealtimePass => ({
  clientSecret: `ek_test_${n}`,
  expiresAt: '2026-11-01T10:10:00.000Z',
  model: 'gpt-realtime-2.1',
  url: 'wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1',
});

function setUp({ voice = true }: { voice?: boolean } = {}) {
  let passes = 0;
  const saved: { question: string; answer: string }[] = [];
  const api = {
    get: vi.fn(async () => view()),
    realtime: vi.fn(async () => pass(++passes)),
    saveExchange: vi.fn(async (_id: string, question: string, answer: string) => {
      saved.push({ question, answer });
      return {
        id: `x${saved.length}`,
        order: saved.length - 1,
        question,
        answer,
        answerFor: 'me',
        createdAt: '2026-11-01T10:01:00.000Z',
      } satisfies LiveExchange;
    }),
    end: vi.fn(async () => view({ status: 'ENDED' })),
    remove: vi.fn(async () => undefined),
  } satisfies LiveSessionApi;
  const mic = new FakeMic();
  const connect = fakeConnector();
  const embedder = signEmbedder();
  const c = new LivePracticeController({
    api,
    sessionId: 's1',
    initial: view(),
    mic,
    connect,
    loadVoice: async () => (voice ? new LiveVoice(embedder, [1, 0], 0.5) : null),
    reconnectDelays: [1, 1],
    saveRetryDelays: [1],
    transcriptWait: 20,
  });
  return { c, api, mic, connect, embedder, saved };
}

/** One spoken turn: OpenAI's voice detection around `ms` of audio at `level`. */
function turn(
  socket: FakeSocket,
  mic: FakeMic,
  id: string,
  startMs: number,
  ms: number,
  level: number,
) {
  socket.emit({ type: 'input_audio_buffer.speech_started', item_id: id, audio_start_ms: startMs });
  mic.speak(ms, level);
  socket.emit({
    type: 'input_audio_buffer.speech_stopped',
    item_id: id,
    audio_end_ms: startMs + ms,
  });
  socket.emit({ type: 'input_audio_buffer.committed', item_id: id });
}

/** OpenAI answering, in deltas. */
function answer(socket: FakeSocket, id: string, text: string) {
  socket.emit({ type: 'response.created', response: { id } });
  for (const part of text.split(/(?<= )/)) {
    socket.emit({ type: 'response.output_text.delta', response_id: id, delta: part });
  }
  socket.emit({ type: 'response.output_text.done', response_id: id, text });
  socket.emit({ type: 'response.done', response: { id, status: 'completed' } });
}

const disposers: LivePracticeController[] = [];
afterEach(() => {
  for (const c of disposers.splice(0)) c.dispose();
});

describe('LivePracticeController', () => {
  it('connects with the pass and streams the microphone as 24 kHz PCM16 appends', async () => {
    const { c, api, mic, connect } = setUp();
    disposers.push(c);
    expect(await c.startListening()).toBe(true);
    expect(api.realtime).toHaveBeenCalledWith('s1');
    const socket = connect.last();
    expect(socket.url).toBe(pass().url);
    expect(socket.clientSecret).toBe('ek_test_1');
    expect(c.connection).toBe('connected');
    mic.speak(300, 0.1);
    const appends = socket.sent.filter((e) => e.type === 'input_audio_buffer.append');
    expect(appends).toHaveLength(3);
    // 100 ms of PCM16 at 24 kHz is 4,800 bytes: 6,400 base64 characters.
    expect(String(appends[0]?.audio)).toHaveLength(6400);
    expect(c.level).toBeGreaterThan(0);
  });

  it("asks for an answer to the interviewer's question and saves it", async () => {
    const { c, mic, connect, saved } = setUp();
    disposers.push(c);
    await c.startListening();
    const socket = connect.last();
    turn(socket, mic, 'item_1', 0, 1500, -0.2);
    await vi.waitFor(() => expect(socket.responseCreates()).toBe(1));
    socket.emit({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'item_1',
      transcript: 'Tell me about yourself.',
    });
    answer(socket, 'resp_1', 'I am a backend engineer with five years of Go.');
    expect(c.cards).toHaveLength(1);
    expect(c.cards[0]?.question).toBe('Tell me about yourself.');
    await vi.waitFor(() =>
      expect(saved).toEqual([
        {
          question: 'Tell me about yourself.',
          answer: 'I am a backend engineer with five years of Go.',
        },
      ]),
    );
    expect(c.cards[0]?.save).toBe('saved');
    expect(c.conversation.transcript[0]?.role).toBe('interviewer');
  });

  it("never asks for an answer to the interviewee's own words", async () => {
    const { c, mic, connect, embedder } = setUp();
    disposers.push(c);
    await c.startListening();
    const socket = connect.last();
    turn(socket, mic, 'item_me', 0, 1500, 0.2);
    await vi.waitFor(() => expect(embedder.calls).toBe(1));
    await vi.waitFor(() => expect(c.conversation.turn('item_me')?.role).toBe('interviewee'));
    expect(socket.responseCreates()).toBe(0);
  });

  it('answers a turn where the partner spoke after the user without a pause', async () => {
    const { c, mic, connect, embedder } = setUp();
    disposers.push(c);
    await c.startListening();
    const socket = connect.last();
    socket.emit({ type: 'input_audio_buffer.speech_started', item_id: 'both', audio_start_ms: 0 });
    mic.speak(2000, 0.2); // the user
    mic.speak(2000, -0.2); // the partner, straight after
    socket.emit({ type: 'input_audio_buffer.speech_stopped', item_id: 'both', audio_end_ms: 4000 });
    socket.emit({ type: 'input_audio_buffer.committed', item_id: 'both' });
    await vi.waitFor(() => expect(socket.responseCreates()).toBe(1));
    // Checked window by window (1.5 s every 0.75 s, plus one at the end).
    expect(embedder.calls).toBe(5);
    expect(c.conversation.turn('both')?.role).toBe('interviewer');
  });

  it('answers a turn too short to check, and every turn without a voiceprint', async () => {
    const short = setUp();
    disposers.push(short.c);
    await short.c.startListening();
    turn(short.connect.last(), short.mic, 'item_s', 0, 500, 0.2);
    await vi.waitFor(() => expect(short.connect.last().responseCreates()).toBe(1));
    expect(short.embedder.calls).toBe(0);

    const none = setUp({ voice: false });
    disposers.push(none.c);
    await none.c.startListening();
    turn(none.connect.last(), none.mic, 'item_n', 0, 1500, 0.2);
    await vi.waitFor(() => expect(none.connect.last().responseCreates()).toBe(1));
    expect(none.c.showVoiceHint).toBe(true);
  });

  it('shows no card and saves nothing for a "-" reply', async () => {
    const { c, mic, connect, saved } = setUp();
    disposers.push(c);
    await c.startListening();
    const socket = connect.last();
    turn(socket, mic, 'item_1', 0, 1500, -0.2);
    await vi.waitFor(() => expect(socket.responseCreates()).toBe(1));
    answer(socket, 'resp_1', '-');
    socket.emit({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'item_1',
      transcript: 'Okay, sounds good.',
    });
    await new Promise((r) => setTimeout(r, 40));
    expect(c.cards).toHaveLength(0);
    expect(saved).toHaveLength(0);
  });

  it('asks one answer at a time and queues the next', async () => {
    const { c, mic, connect } = setUp();
    disposers.push(c);
    await c.startListening();
    const socket = connect.last();
    turn(socket, mic, 'a', 0, 1200, -0.2);
    await vi.waitFor(() => expect(socket.responseCreates()).toBe(1));
    turn(socket, mic, 'b', 1200, 1200, -0.2);
    await new Promise((r) => setTimeout(r, 10));
    expect(socket.responseCreates()).toBe(1);
    answer(socket, 'r1', 'First answer.');
    expect(socket.responseCreates()).toBe(2);
  });

  it('sends a typed question as a user item, then response.create', async () => {
    const { c, connect } = setUp();
    disposers.push(c);
    expect(await c.ask('  How do you scale Postgres?  ')).toBe(true);
    const socket = connect.last();
    expect(socket.sent).toEqual([
      {
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'How do you scale Postgres?' }],
        },
      },
      { type: 'response.create' },
    ]);
    expect(await c.ask('x'.repeat(2001))).toBe(false);
    expect(c.lastActionError).toMatch(/2,000/);
  });

  it('reconnects with a new pass when the connection drops while listening', async () => {
    const { c, api, mic, connect } = setUp();
    disposers.push(c);
    await c.startListening();
    connect.last().drop();
    await vi.waitFor(() => expect(connect.sockets).toHaveLength(2));
    await vi.waitFor(() => expect(c.connection).toBe('connected'));
    expect(api.realtime).toHaveBeenCalledTimes(2);
    expect(connect.last().clientSecret).toBe('ek_test_2');
    expect(c.listening).toBe(true);
    // Audio goes to the new socket, from millisecond zero again.
    mic.speak(100, 0.1);
    expect(connect.last().types()).toContain('input_audio_buffer.append');
  });

  it('stops listening and shows why when reconnecting is refused', async () => {
    const { c, api, connect } = setUp();
    disposers.push(c);
    await c.startListening();
    api.realtime.mockRejectedValue(
      new ApiError({
        type: 'urn:offerpath:error:conflict',
        title: 'Conflict',
        status: 409,
        detail: 'This session has ended. Start a new one to practise again.',
      }),
    );
    connect.last().drop();
    await vi.waitFor(() => expect(c.listening).toBe(false));
    expect(c.banner).toMatch(/session has ended/);
  });

  it("shows OpenAI's error and the refused microphone", async () => {
    const { c, mic, connect } = setUp();
    disposers.push(c);
    mic.denied = true;
    expect(await c.startListening()).toBe(false);
    expect(c.micError).toBe(LIVE_MIC_DENIED_MESSAGE);
    connect.last().emit({ type: 'error', error: { message: 'Your key has no credit.' } });
    expect(c.banner).toBe('Your key has no credit.');
    c.dismissBanner();
    expect(c.banner).toBeNull();
  });

  it('ends the session: stops the mic, closes the socket and saves what is on screen', async () => {
    const { c, api, mic, connect } = setUp();
    disposers.push(c);
    await c.startListening();
    expect(await c.end()).toBe(true);
    expect(mic.on).toBe(false);
    expect(connect.last().closed).toBe(true);
    expect(api.end).toHaveBeenCalledWith('s1');
    expect(c.isEnded).toBe(true);
  });
});
