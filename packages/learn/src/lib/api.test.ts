import { describe, expect, it, vi } from 'vitest';

import { ApiError, createFetchClient, isAiUnavailable } from './api';

function json(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('createFetchClient', () => {
  it('sends the bearer token, the JSON body and the idempotency key', async () => {
    const fetchMock = vi.fn(async () => json(200, { ok: true }));
    const client = createFetchClient({
      baseUrl: 'http://api.test/api/v1/',
      getToken: () => 'tok',
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(
      client.request('/submissions', { method: 'POST', body: { a: 1 }, idempotencyKey: 'k1' }),
    ).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/v1/submissions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'k1',
        Authorization: 'Bearer tok',
      },
      body: '{"a":1}',
    });
  });

  it('refreshes once on a 401 and retries', async () => {
    let token = 'old';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json(401, { type: 'urn:offerpath:error:unauthorized', title: 'x', status: 401 }),
      )
      .mockResolvedValueOnce(json(200, { done: true }));
    const refresh = vi.fn(async () => {
      token = 'new';
      return true;
    });
    const client = createFetchClient({
      baseUrl: '/api/v1',
      getToken: () => token,
      refresh,
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(client.request('/today')).resolves.toEqual({ done: true });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[1]![1].headers.Authorization).toBe('Bearer new');
  });

  it('reports an unrecoverable 401 and throws the problem', async () => {
    const onUnauthorized = vi.fn();
    const client = createFetchClient({
      baseUrl: '/api/v1',
      getToken: () => 'tok',
      refresh: async () => false,
      onUnauthorized,
      fetch: (async () =>
        json(401, {
          type: 'urn:offerpath:error:unauthorized',
          title: 'Unauthorized',
          status: 401,
        })) as unknown as typeof fetch,
    });
    await expect(client.request('/today')).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalled();
  });

  it('turns ai-unavailable problem details into an offline-desktop state', async () => {
    const client = createFetchClient({
      baseUrl: '/api/v1',
      getToken: () => 'tok',
      fetch: (async () =>
        json(503, {
          type: 'urn:offerpath:error:ai-unavailable',
          title: 'AI assistance unavailable',
          status: 503,
          detail: 'No desktop is connected.',
        })) as unknown as typeof fetch,
    });
    const error = await client.request('/ai/hint', { method: 'POST' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).kind).toBe('ai-unavailable');
    expect((error as ApiError).status).toBe(503);
    expect(isAiUnavailable(error)).toBe(true);
  });

  it('answers 204 and empty bodies with nothing', async () => {
    const client = createFetchClient({
      baseUrl: '/api/v1',
      getToken: () => null,
      fetch: (async () => new Response(null, { status: 204 })) as unknown as typeof fetch,
    });
    await expect(
      client.request('/goal/skill-gaps/add', { method: 'POST' }),
    ).resolves.toBeUndefined();
  });

  it('says the server cannot be reached when fetch itself fails', async () => {
    const client = createFetchClient({
      baseUrl: '/api/v1',
      getToken: () => null,
      fetch: (async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof fetch,
    });
    const error = (await client.request('/today').catch((e: unknown) => e)) as ApiError;
    expect(error.kind).toBe('network');
    expect(error.message).toMatch(/Cannot reach the Offerpath server/);
  });
});
