import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { problem, renderLearn, type RequestMock } from '../../__tests__/harness';
import type { FallbackKeyView } from '../../lib/interview-prep';

import { AiFallbackSettings } from './AiFallback';

type Route = (path: string, options?: { method?: string; body?: unknown }) => unknown;

function router(route: Route): RequestMock {
  return vi.fn(async (path: string, options?: { method?: string; body?: unknown }) => {
    const out = route(path, options);
    if (out instanceof Error) throw out;
    return out;
  }) as RequestMock;
}

const EMPTY: FallbackKeyView = {
  configured: false,
  last4: null,
  modelFast: 'gpt-4.1-mini',
  modelReasoning: 'gpt-4.1',
  available: true,
};

const SAVED: FallbackKeyView = { ...EMPTY, configured: true, last4: 'a1B2' };

const MODELS = {
  models: [
    { id: 'gpt-4.1-mini', label: 'gpt-4.1-mini' },
    { id: 'gpt-4.1', label: 'gpt-4.1' },
    { id: 'o4-mini', label: 'o4-mini' },
  ],
};

describe('Settings → AI: the OpenAI fallback for interview prep', () => {
  it('hides and shows the key with a labelled eye button', async () => {
    const user = userEvent.setup();
    renderLearn(<AiFallbackSettings />, { request: router(() => EMPTY) });

    const input = await screen.findByLabelText('OpenAI API key');
    expect(input).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(input).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('explains it is only used when the laptop is offline', async () => {
    renderLearn(<AiFallbackSettings />, { request: router(() => EMPTY) });
    expect(
      await screen.findByText(/Only when your laptop is offline does it use your own OpenAI key/),
    ).toBeInTheDocument();
    // No key yet: the models are typed, not picked.
    expect(screen.getByLabelText('Quick model')).toHaveValue('gpt-4.1-mini');
    expect(screen.getByLabelText('Quick model').tagName).toBe('INPUT');
  });

  it('asks for a key before saving the first time', async () => {
    const user = userEvent.setup();
    const request = router(() => EMPTY);
    renderLearn(<AiFallbackSettings />, { request });

    await user.clear(await screen.findByLabelText('Planning model'));
    await user.type(screen.getByLabelText('Planning model'), 'o3');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter your OpenAI API key.')).toBeInTheDocument();
    expect(request.mock.calls.some(([, o]) => o?.method === 'PUT')).toBe(false);
  });

  it('saves a key and shows only its last four characters', async () => {
    const user = userEvent.setup();
    let saved = false;
    const request = router((path, options) => {
      if (path === '/settings/ai/fallback/models') return MODELS;
      if (options?.method === 'PUT') {
        saved = true;
        return SAVED;
      }
      return saved ? SAVED : EMPTY;
    });
    renderLearn(<AiFallbackSettings />, { request });

    await user.type(await screen.findByLabelText('OpenAI API key'), 'sk-test-0123456789abcdefa1B2');
    await user.click(screen.getByRole('button', { name: 'Check and save' }));

    expect(await screen.findByText('••••a1B2')).toBeInTheDocument();
    const put = request.mock.calls.find(([, o]) => o?.method === 'PUT');
    expect(put?.[0]).toBe('/settings/ai/fallback');
    expect(put?.[1]?.body).toEqual({ apiKey: 'sk-test-0123456789abcdefa1B2' });
    expect(screen.getByLabelText('OpenAI API key')).toHaveValue('');
    // With a key saved, the models come from OpenAI as pickers.
    await waitFor(() => expect(screen.getByLabelText('Quick model').tagName).toBe('SELECT'));
    expect(
      within(screen.getByLabelText('Planning model')).getByRole('option', { name: 'o4-mini' }),
    ).toBeInTheDocument();
  });

  it('shows why OpenAI refused the key', async () => {
    const user = userEvent.setup();
    const request = router((_path, options) =>
      options?.method === 'PUT'
        ? problem('bad-request', 400, 'OpenAI refused this key: Incorrect API key provided.')
        : EMPTY,
    );
    renderLearn(<AiFallbackSettings />, { request });

    await user.type(await screen.findByLabelText('OpenAI API key'), 'sk-wrong-0123456789abcdef');
    await user.click(screen.getByRole('button', { name: 'Check and save' }));
    expect(
      await screen.findByText('OpenAI refused this key: Incorrect API key provided.'),
    ).toBeInTheDocument();
  });

  it('changes only the models of a saved key, and removes the key', async () => {
    const user = userEvent.setup();
    let removed = false;
    const request = router((path, options) => {
      if (path === '/settings/ai/fallback/models') return MODELS;
      if (options?.method === 'DELETE') {
        removed = true;
        return EMPTY;
      }
      if (options?.method === 'PUT') return { ...SAVED, modelReasoning: 'o4-mini' };
      return removed ? EMPTY : SAVED;
    });
    renderLearn(<AiFallbackSettings />, { request });

    await waitFor(() => expect(screen.getByLabelText('Planning model').tagName).toBe('SELECT'));
    await user.selectOptions(screen.getByLabelText('Planning model'), 'o4-mini');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(request.mock.calls.find(([, o]) => o?.method === 'PUT')?.[1]?.body).toEqual({
        modelReasoning: 'o4-mini',
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Remove key' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('No key')).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith('/settings/ai/fallback', { method: 'DELETE' });
  });

  it('says the server owner must set ENCRYPTION_KEY when keys cannot be stored', async () => {
    renderLearn(<AiFallbackSettings />, {
      request: router(() => ({ ...EMPTY, available: false })),
    });
    expect(await screen.findByText(/must set ENCRYPTION_KEY/)).toBeInTheDocument();
    expect(screen.getByLabelText('OpenAI API key')).toBeDisabled();
  });
});
