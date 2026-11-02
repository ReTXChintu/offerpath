import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { problem, renderLearn, type RequestMock } from '../../__tests__/harness';
import type { RequestOptions } from '../../lib/api';
import {
  takeAutoStart,
  type LivePracticeSummary,
  type LivePracticeView,
  type SpeakerModelStore,
} from '../../lib/live-practice';
import { FakeMic, fakeConnector, signEmbedder } from '../../lib/live/fakes';

import { LiveDepsProvider, type LiveDeps } from './deps';
import { LivePracticeList } from './LivePracticeList';
import { LivePracticeSession } from './LivePracticeSession';
import { VoiceSetupPage } from './VoiceSetup';

const ended: LivePracticeView = {
  id: 'old',
  prepId: 'prep-1',
  title: 'Backend loop',
  technologies: ['Go', 'Postgres'],
  answerFor: 'neutral',
  status: 'ENDED',
  exchanges: [
    {
      id: 'x1',
      order: 0,
      question: 'What is an index?',
      answer: 'A B-tree I add for hot lookups.',
      answerFor: 'me',
      createdAt: '2026-11-01T10:01:00.000Z',
    },
  ],
  createdAt: '2026-11-01T10:00:00.000Z',
  endedAt: '2026-11-01T10:30:00.000Z',
};

const active: LivePracticeView = {
  ...ended,
  id: 'new',
  answerFor: 'me',
  status: 'ACTIVE',
  exchanges: [],
  endedAt: null,
};

const summaries: LivePracticeSummary[] = [
  {
    id: 'live',
    prepId: null,
    title: 'Monday practice',
    status: 'ACTIVE',
    exchanges: 0,
    createdAt: '2026-11-02T10:00:00.000Z',
    endedAt: null,
  },
  {
    id: 'old',
    prepId: 'prep-1',
    title: 'Backend loop',
    status: 'ENDED',
    exchanges: 1,
    createdAt: '2026-11-01T10:00:00.000Z',
    endedAt: '2026-11-01T10:30:00.000Z',
  },
];

const voiceProfile = {
  model: 'wespeaker_en_voxceleb_resnet34_LM.onnx',
  embedding: [1, 0],
  threshold: 0.5,
  updatedAt: '2026-10-30T10:00:00.000Z',
};

const modelInfo = {
  fileName: 'wespeaker_en_voxceleb_resnet34_LM.onnx',
  sizeBytes: 26_530_550,
  sha256: 'e9848563da86f263117134dfd7ad63c92355b37de492b55e325400c9d9c39012',
  url: '/api/v1/downloads/speaker-model/file',
};

/** Routes the fake client's requests like the API would. */
function api(overrides: Record<string, (options?: RequestOptions) => unknown> = {}): RequestMock {
  return vi.fn(async (path: string, options?: RequestOptions) => {
    const key = `${options?.method ?? 'GET'} ${path}`;
    const handler = overrides[key];
    if (handler) return handler(options);
    switch (key) {
      case 'GET /live-practice':
        return { sessions: summaries };
      case 'GET /live-practice/ready':
        return { ready: true, reason: null };
      case 'GET /live-practice/voice':
        return voiceProfile;
      case 'GET /downloads/speaker-model':
        return modelInfo;
      case 'GET /live-practice/old':
        return ended;
      case 'GET /live-practice/new':
        return active;
      case 'POST /live-practice':
        return active;
      case 'POST /live-practice/new/realtime':
        return {
          clientSecret: 'ek_test',
          expiresAt: '2026-11-03T10:10:00.000Z',
          model: 'gpt-realtime-2.1',
          url: 'wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1',
        };
      case 'POST /live-practice/new/exchanges': {
        const body = options?.body as { question: string; answer: string };
        return { id: 'saved1', order: 0, answerFor: 'me', createdAt: '', ...body };
      }
      default:
        throw problem('not-found', 404);
    }
  });
}

function fakeDeps(over: Partial<LiveDeps> = {}) {
  const mic = new FakeMic();
  const connect = fakeConnector();
  const models: SpeakerModelStore = {
    local: async () => new Uint8Array([1]),
    download: async () => new Uint8Array([1]),
  };
  const deps: Partial<LiveDeps> = {
    createMic: () => mic,
    connect,
    createEmbedder: () => signEmbedder(),
    models,
    canListen: () => true,
    ...over,
  };
  return { deps, mic, connect };
}

describe('Live practice list', () => {
  it('lists sessions newest first with Live/Ended tags, and Restart on ended ones only', async () => {
    const { deps } = fakeDeps();
    renderLearn(
      <LiveDepsProvider deps={deps}>
        <LivePracticeList />
      </LiveDepsProvider>,
      { request: api() },
    );
    const list = await screen.findByRole('list', { name: 'Sessions' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Monday practice');
    expect(rows[0]).toHaveTextContent('Live');
    expect(rows[1]).toHaveTextContent('Backend loop');
    expect(rows[1]).toHaveTextContent('Ended');
    expect(within(rows[0] as HTMLElement).queryByRole('button', { name: /Restart/ })).toBeNull();
    expect(within(rows[1] as HTMLElement).getByRole('button', { name: /Restart/ })).toBeVisible();
    expect(await screen.findByText('Set up')).toBeVisible();
  });

  it('restarts an ended session with its prep, technologies and title, and opens it listening', async () => {
    const { deps } = fakeDeps();
    const request = api();
    const { navigator } = renderLearn(
      <LiveDepsProvider deps={deps}>
        <LivePracticeList />
      </LiveDepsProvider>,
      { request },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Restart Backend loop' }));
    await waitFor(() => expect(navigator.navigate).toHaveBeenCalled());
    const post = request.mock.calls.find(
      ([path, o]) => path === '/live-practice' && o?.method === 'POST',
    );
    // Never answerFor: answers are always the user's now.
    expect(post?.[1]?.body).toEqual({
      prepId: 'prep-1',
      technologies: ['Go', 'Postgres'],
      title: 'Backend loop',
    });
    expect(navigator.navigate).toHaveBeenCalledWith('/live-practice/new', undefined);
    expect(takeAutoStart('new')).toBe(true);
  });

  it('says where to add the OpenAI key when none is saved', async () => {
    const { deps } = fakeDeps();
    renderLearn(
      <LiveDepsProvider deps={deps}>
        <LivePracticeList />
      </LiveDepsProvider>,
      {
        request: api({
          'GET /live-practice/ready': () => ({ ready: false, reason: 'No OpenAI key is saved.' }),
        }),
      },
    );
    expect(await screen.findByText('Live practice needs your OpenAI key')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open Settings → AI' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
  });

  it('explains on plain http that listening needs the desktop app, the phone or HTTPS', async () => {
    const { deps } = fakeDeps({ canListen: () => false });
    renderLearn(
      <LiveDepsProvider deps={deps}>
        <LivePracticeList />
      </LiveDepsProvider>,
      { request: api() },
    );
    expect(await screen.findByText("Live listening isn't available here")).toBeVisible();
    expect(screen.getByText(/desktop app or the phone/)).toBeVisible();
    // The list and Restart still work.
    expect(await screen.findByRole('button', { name: 'Restart Backend loop' })).toBeEnabled();
  });
});

describe('Live practice session', () => {
  it('shows an ended session with its saved questions and Restart', async () => {
    const { deps } = fakeDeps();
    renderLearn(
      <LiveDepsProvider deps={deps}>
        <LivePracticeSession sessionId="old" />
      </LiveDepsProvider>,
      { request: api() },
    );
    expect(await screen.findByText('Session ended')).toBeVisible();
    expect(screen.getByText('What is an index?')).toBeVisible();
    expect(screen.getByText('A B-tree I add for hot lookups.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Start listening' })).toBeNull();
    expect(screen.getAllByRole('button', { name: /Restart/ }).length).toBeGreaterThan(0);
  });

  it("listens, answers the interviewer's question as it streams, and hides '-' replies", async () => {
    const { deps, mic, connect } = fakeDeps();
    const request = api();
    renderLearn(
      <LiveDepsProvider deps={deps}>
        <LivePracticeSession sessionId="new" />
      </LiveDepsProvider>,
      { request },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Start listening' }));
    expect(await screen.findByRole('button', { name: 'Pause listening' })).toBeVisible();
    const socket = connect.last();
    expect(socket.clientSecret).toBe('ek_test');

    // The interviewer (negative audio for the fake embedder) asks.
    socket.emit({ type: 'input_audio_buffer.speech_started', item_id: 'i1', audio_start_ms: 0 });
    mic.speak(1500, -0.2);
    socket.emit({ type: 'input_audio_buffer.speech_stopped', item_id: 'i1', audio_end_ms: 1500 });
    socket.emit({ type: 'input_audio_buffer.committed', item_id: 'i1' });
    await waitFor(() => expect(socket.responseCreates()).toBe(1));
    socket.emit({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'i1',
      transcript: 'Why Go?',
    });
    socket.emit({ type: 'response.created', response: { id: 'r1' } });
    socket.emit({ type: 'response.output_text.delta', response_id: 'r1', delta: 'Because ' });
    expect(await screen.findByText('Because')).toBeVisible();
    socket.emit({ type: 'response.output_text.delta', response_id: 'r1', delta: 'it is simple.' });
    socket.emit({
      type: 'response.output_text.done',
      response_id: 'r1',
      text: 'Because it is simple.',
    });
    socket.emit({ type: 'response.done', response: { id: 'r1' } });
    expect(await screen.findByText('Because it is simple.')).toBeVisible();
    expect(screen.getByRole('article', { name: 'Why Go?' })).toBeVisible();
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('/live-practice/new/exchanges', {
        method: 'POST',
        body: { question: 'Why Go?', answer: 'Because it is simple.' },
      }),
    );
    // The caption is labelled with who spoke.
    expect(screen.getByLabelText('What was said')).toHaveTextContent('Interviewer');

    // The user (positive audio) speaks: captioned as "You", never answered.
    socket.emit({ type: 'input_audio_buffer.speech_started', item_id: 'i2', audio_start_ms: 1500 });
    mic.speak(1500, 0.2);
    socket.emit({ type: 'input_audio_buffer.speech_stopped', item_id: 'i2', audio_end_ms: 3000 });
    socket.emit({ type: 'input_audio_buffer.committed', item_id: 'i2' });
    socket.emit({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'i2',
      transcript: 'Let me think about that.',
    });
    await waitFor(() => expect(screen.getByLabelText('What was said')).toHaveTextContent('You'));
    expect(socket.responseCreates()).toBe(1);

    // A typed question; the model says it isn't one: no card.
    await userEvent.type(screen.getByLabelText('Type a question'), 'ok thanks{Enter}');
    await waitFor(() => expect(socket.responseCreates()).toBe(2));
    socket.emit({ type: 'response.created', response: { id: 'r2' } });
    socket.emit({ type: 'response.output_text.done', response_id: 'r2', text: '-' });
    socket.emit({ type: 'response.done', response: { id: 'r2' } });
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(1));
    expect(screen.getByText('Questions · 1')).toBeVisible();
  });

  it('on plain http shows why it cannot listen, and the typed question still works', async () => {
    const { deps, connect, mic } = fakeDeps({ canListen: () => false });
    renderLearn(
      <LiveDepsProvider deps={deps}>
        <LivePracticeSession sessionId="new" />
      </LiveDepsProvider>,
      { request: api() },
    );
    expect(await screen.findByText("Live listening isn't available here")).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Start listening' })).toBeNull();
    await userEvent.type(screen.getByLabelText('Type a question'), 'What is CAP?{Enter}');
    await waitFor(() => expect(connect.last().responseCreates()).toBe(1));
    expect(mic.starts).toBe(0);
  });
});

describe('Your voice', () => {
  it('tests the voiceprint and shows the similarity and the verdict', async () => {
    const { deps, mic } = fakeDeps();
    renderLearn(
      <LiveDepsProvider deps={deps}>
        <VoiceSetupPage />
      </LiveDepsProvider>,
      { request: api() },
    );
    expect(await screen.findByText('Your voice is set up')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Test' }));
    mic.speak(2000, 0.3);
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(await screen.findByText('Recognised as you')).toBeVisible();
    expect(screen.getByTestId('voice-verdict')).toHaveTextContent(
      'Similarity 1.00 · threshold 0.50',
    );
  });

  it('records three sentences and saves their average with the model name', async () => {
    const { deps, mic } = fakeDeps();
    const request = api({
      'GET /live-practice/voice': () => {
        throw problem('not-found', 404);
      },
      'PUT /live-practice/voice': (o) => ({ ...(o?.body as object), updatedAt: '' }),
    });
    renderLearn(
      <LiveDepsProvider deps={deps}>
        <VoiceSetupPage />
      </LiveDepsProvider>,
      { request },
    );
    expect(await screen.findByText('Step 2 of 2: read three sentences')).toBeVisible();
    for (let i = 0; i < 3; i++) {
      await userEvent.click(screen.getByRole('button', { name: /^Record/ }));
      mic.speak(3000, 0.3);
      await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
      await waitFor(() => expect(screen.queryByText('Checking…')).toBeNull());
    }
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('/live-practice/voice', {
        method: 'PUT',
        body: { model: modelInfo.fileName, embedding: [1, 0], threshold: 0.5 },
      }),
    );
    expect(await screen.findByText('Your voice is set up')).toBeVisible();
  });
});
