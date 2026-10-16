import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { problem, renderLearn, type RequestMock } from '../__tests__/harness';

import { AI_OFFLINE_MESSAGE } from './AiOffline';
import { Assistant } from './Assistant';

/**
 * The assistant, driven the way a user drives it.
 *
 * Written because of a report that reads exactly like a passing API and a
 * broken screen: the request returns 200 in the network tab, the spinner
 * appears and goes, and nothing on the panel changes. Everything between the
 * response arriving and the reply being on screen is in here — the cache key
 * the mutation writes to, the key the panel reads from, and whether a reply
 * full of fenced code renders at all.
 */

const apiRequest: RequestMock = vi.fn();

const HISTORY = [
  {
    id: 'old-1',
    role: 'user',
    content: 'What is a closure?',
    createdAt: '2026-09-20T10:00:00.000Z',
  },
  {
    id: 'old-2',
    role: 'assistant',
    content: 'A function together with the environment it was created in.',
    createdAt: '2026-09-20T10:00:01.000Z',
  },
];

/** A real reply, fences and all — the shape that prompted the report. */
const NEW_TURNS = [
  { id: 'new-1', role: 'user', content: 'Show me the var loop problem', createdAt: 'x' },
  {
    id: 'new-2',
    role: 'assistant',
    content:
      '`var` is function-scoped, so every callback sees the final value.\n\n' +
      '```js\nfor (var i = 0; i < 3; i++) {\n  setTimeout(() => console.log(i), 0);\n}\n```',
    createdAt: 'y',
  },
];

/** GET /settings/ai: the models per kind of work, and the desktop. */
const AI_SETTINGS = {
  models: { fast: 'haiku', reasoning: 'opus', tutor: null },
  options: [
    { id: 'haiku', label: 'Claude Haiku' },
    { id: 'sonnet', label: 'Claude Sonnet' },
    { id: 'opus', label: 'Claude Opus' },
  ],
  desktop: { online: true, claudeAvailable: true, detail: null, version: '0.1.0' },
};

/**
 * One router for every call the panel makes, so a test that cares about the
 * chat does not have to know the panel also asks which model it is using.
 */
function route({ askFails = false, offline = false } = {}) {
  return (path: string, options?: { method?: string }): Promise<unknown> => {
    if (path === '/settings/ai') {
      return Promise.resolve(
        options?.method === 'PUT'
          ? { ...AI_SETTINGS, models: { ...AI_SETTINGS.models, tutor: 'opus' } }
          : AI_SETTINGS,
      );
    }
    if (options?.method === 'POST') {
      if (offline) return Promise.reject(problem('ai-unavailable', 503, 'No desktop'));
      return askFails ? Promise.reject(new Error('model is busy')) : Promise.resolve(NEW_TURNS);
    }
    return Promise.resolve(HISTORY);
  };
}

function mount() {
  // Retries off (in the harness): a failing call surfaces immediately.
  return renderLearn(
    <Assistant conceptId="concept-1" conceptName="Closures" screen="They are reading Closures." />,
    { request: apiRequest },
  );
}

/** Opens the panel and waits for the thread it was already carrying. */
async function openPanel() {
  mount();
  fireEvent.click(screen.getByRole('button', { name: /ask about closures/i }));

  // Chat is stored per concept and does not expire, so a returning user opens
  // onto their old conversation rather than a blank panel.
  await waitFor(() => expect(screen.getByText(/together with the environment/i)).toBeTruthy());
}

/** Types a question and presses Ask. */
function ask(text: string) {
  fireEvent.change(screen.getByPlaceholderText(/why is my answer wrong/i), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));
}

beforeEach(() => {
  apiRequest.mockReset();
});

describe('asking the assistant', () => {
  it('shows the reply without needing a refetch', async () => {
    apiRequest.mockImplementation(route());

    await openPanel();
    ask('Show me');

    // The reported failure: the request succeeds and the panel does not change.
    await waitFor(() =>
      expect(screen.getByText(/every callback sees the final value/i)).toBeTruthy(),
    );

    // And the fenced block became code rather than literal backticks.
    expect(screen.queryByText(/```js/)).toBeNull();
    expect(screen.getByText(/setTimeout/)).toBeTruthy();
  });

  it('keeps the question in the box when the model fails', async () => {
    apiRequest.mockImplementation(route({ askFails: true }));

    await openPanel();
    const box = screen.getByPlaceholderText(/why is my answer wrong/i);
    ask('Why is this wrong');

    // A transient failure must not cost them what they typed.
    await waitFor(() =>
      expect(screen.getByText(/did not get through|model is busy/i)).toBeTruthy(),
    );
    expect((box as HTMLTextAreaElement).value).toBe('Why is this wrong');
  });

  it('sends what is on screen along with the question', async () => {
    apiRequest.mockImplementation(route());

    await openPanel();
    ask('Explain');

    await waitFor(() => {
      const post = apiRequest.mock.calls.find(
        (call) => (call[1] as { method?: string } | undefined)?.method === 'POST',
      );
      expect(post).toBeDefined();
      expect((post![1] as { body: { screen?: string } }).body.screen).toContain('reading Closures');
    });
  });

  it('lets the model be switched without leaving the conversation', async () => {
    apiRequest.mockImplementation(route());

    await openPanel();

    const picker = (await screen.findByRole('combobox')) as HTMLSelectElement;
    // Following the tier is an option, not a blank.
    expect(picker.value).toBe('');
    expect(screen.getByText(/Default \(haiku\)/)).toBeTruthy();

    fireEvent.change(picker, { target: { value: 'opus' } });

    await waitFor(() => {
      const put = apiRequest.mock.calls.find(
        (call) => (call[1] as { method?: string } | undefined)?.method === 'PUT',
      );
      expect(put).toBeDefined();
      expect(put![0]).toBe('/settings/ai');
      expect((put![1] as { body: { tutor: string } }).body.tutor).toBe('opus');
    });
  });

  it('says the desktop is offline instead of showing an error', async () => {
    apiRequest.mockImplementation(route({ offline: true }));

    await openPanel();
    const box = screen.getByPlaceholderText(/why is my answer wrong/i);
    ask('Why?');

    await waitFor(() => expect(screen.getByText(AI_OFFLINE_MESSAGE)).toBeTruthy());
    expect((box as HTMLTextAreaElement).value).toBe('Why?');
  });

  it('does not fetch the thread until it is opened', () => {
    apiRequest.mockImplementation(route());

    mount();

    // The panel is closed, so nothing has been asked for yet.
    expect(apiRequest).not.toHaveBeenCalled();
  });
});
