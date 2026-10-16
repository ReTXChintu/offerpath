import type { ApplicationListItem, JobListItem } from '@offerpath/hunt';
import { describe, expect, it, vi } from 'vitest';

import { apiBaseUrl, apiOrigin } from './config';
import { asSubmission, desktopErrorMessage, httpHuntClient, toDesktopRequest } from './hunt-client';
import { funnelFromSynced } from './pages/Progress';
import { Auth, loadSession, type Session } from './session';

type Call = { url: string; init?: RequestInit };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const BASE = '/api/v1';
const SESSION: Session = {
  email: 'a@example.com',
  userId: 'u1',
  accessToken: 'old-access',
  refreshToken: 'old-refresh-token-long-enough',
};
const UNAUTHORIZED = {
  type: 'urn:offerpath:error:unauthorized',
  title: 'Unauthorized',
  status: 401,
};

describe('Auth (ported from Job Hunter web)', () => {
  it('refreshes an expired access token once and retries the request', async () => {
    const calls: Call[] = [];
    const sessions: (Session | null)[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === `${BASE}/auth/refresh`) {
        return json(200, { userId: 'u1', accessToken: 'new-access', refreshToken: 'new-refresh' });
      }
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
      return auth === 'Bearer new-access' ? json(200, []) : json(401, UNAUTHORIZED);
    };
    const auth = new Auth(BASE, SESSION, (s) => sessions.push(s), fetchImpl);

    await expect(auth.client.request('/applications')).resolves.toEqual([]);
    expect(calls.map((c) => c.url)).toEqual([
      `${BASE}/applications`,
      `${BASE}/auth/refresh`,
      `${BASE}/applications`,
    ]);
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual({
      refreshToken: 'old-refresh-token-long-enough',
    });
    expect(sessions.at(-1)).toMatchObject({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
    });
    // And it survives a reload.
    expect(loadSession()).toMatchObject({ accessToken: 'new-access' });
  });

  it('shares one refresh between concurrent requests', async () => {
    let refreshes = 0;
    const fetchImpl = async (url: string, init?: RequestInit) => {
      if (url === `${BASE}/auth/refresh`) {
        refreshes += 1;
        return json(200, { userId: 'u1', accessToken: 'new-access', refreshToken: 'new-refresh' });
      }
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
      return auth === 'Bearer new-access' ? json(200, { documents: [] }) : json(401, UNAUTHORIZED);
    };
    const auth = new Auth(BASE, SESSION, () => undefined, fetchImpl);
    await Promise.all([
      auth.client.request('/data/jobs'),
      auth.client.request('/data/job_analyses'),
      auth.client.request('/today'),
    ]);
    expect(refreshes).toBe(1);
  });

  it('ends the session when the refresh token is rejected too', async () => {
    const sessions: (Session | null)[] = [];
    const fetchImpl = async () => json(401, UNAUTHORIZED);
    const auth = new Auth(BASE, SESSION, (s) => sessions.push(s), fetchImpl);
    await expect(auth.client.request('/applications')).rejects.toMatchObject({ status: 401 });
    expect(sessions.at(-1)).toBeNull();
    expect(auth.current).toBeNull();
    expect(loadSession()).toBeNull();
  });

  it('creates an account through /auth/register and signs straight in', async () => {
    const calls: Call[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return json(201, {
        userId: 'u9',
        accessToken: 'a',
        refreshToken: 'r',
        expiresInSeconds: 900,
      });
    };
    const auth = new Auth(BASE, null, () => undefined, fetchImpl);
    await auth.register(' New@Example.com ', 'longenoughpassword', 'New');
    expect(calls[0]!.url).toBe(`${BASE}/auth/register`);
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      email: ' New@Example.com ',
      password: 'longenoughpassword',
      displayName: 'New',
    });
    expect(auth.current).toEqual({
      email: 'new@example.com',
      userId: 'u9',
      accessToken: 'a',
      refreshToken: 'r',
    });
  });

  it("surfaces the API's problem details on a failed sign-in", async () => {
    const fetchImpl = async () =>
      json(401, {
        type: 'urn:offerpath:error:invalid-credentials',
        title: 'Invalid credentials',
        status: 401,
        detail: 'Wrong email or password.',
      });
    const auth = new Auth(BASE, null, () => undefined, fetchImpl);
    await expect(auth.login('a@example.com', 'bad')).rejects.toMatchObject({
      kind: 'invalid-credentials',
      message: 'Wrong email or password.',
    });
  });

  it('revokes the refresh token on sign-out', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const auth = new Auth(BASE, SESSION, () => undefined, fetchImpl);
    await auth.logout();
    expect(auth.current).toBeNull();
    expect(fetchImpl).toHaveBeenCalledWith(
      `${BASE}/auth/logout`,
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

describe('the hunt remote control', () => {
  it('maps the desktop commands onto the request types the phone uses', () => {
    expect(toDesktopRequest('approve_application', { id: 'a1', applyNow: true })).toEqual({
      type: 'approve_application',
      payload: { id: 'a1', applyNow: true },
    });
    expect(
      toDesktopRequest('start_job_hunt', { options: { sources: ['Company careers'] } }),
    ).toEqual({
      type: 'start_job_hunt',
      payload: { sources: ['Company careers'] },
    });
    expect(toDesktopRequest('start_job_hunt', {})).toEqual({ type: 'start_job_hunt', payload: {} });
    expect(
      toDesktopRequest('record_interview', {
        id: 'a1',
        interview: { round: 'HR', scheduledAt: null },
      }),
    ).toEqual({
      type: 'record_interview',
      payload: { id: 'a1', round: 'HR', scheduledAt: null },
    });
    expect(
      toDesktopRequest('answer_application_questions', {
        id: 'a1',
        answers: [{ question: 'Notice?', answer: '30 days', source: 'USER' }],
        saveForReuse: true,
      }),
    ).toEqual({
      type: 'answer_application_questions',
      payload: { id: 'a1', answers: [{ question: 'Notice?', answer: '30 days' }] },
    });
    expect(toDesktopRequest('discover_jobs', { sources: undefined })).toEqual({
      type: 'start_job_hunt',
      payload: { discoverOnly: true },
    });
    // Things that need the desktop's files or Chrome have no request type.
    expect(toDesktopRequest('update_resume_content', { id: 'r1' })).toBeNull();
    expect(toDesktopRequest('read_text_file', { path: 'C:/x' })).toBeNull();
  });

  it('sends actions through POST /desktop/request and reads the reply', async () => {
    const request = vi.fn(async () => ({ data: { id: 'a1', status: 'APPROVED' } }));
    const client = httpHuntClient({ request: request as never });
    await expect(client.invoke('approve_application', { id: 'a1' })).resolves.toEqual({
      id: 'a1',
      status: 'APPROVED',
    });
    expect(request).toHaveBeenCalledWith('/desktop/request', {
      method: 'POST',
      body: { type: 'approve_application', payload: { id: 'a1' } },
    });
  });

  it('reads applications from the server, so they show with the desktop offline', async () => {
    const items = [{ application: { id: 'a1' }, job: { id: 'j1' }, analysis: null }];
    const request = vi.fn(async () => items);
    const client = httpHuntClient({ request: request as never });
    await expect(client.invoke('list_applications')).resolves.toBe(items);
    expect(request).toHaveBeenCalledWith('/applications');
  });

  it('joins jobs with their analyses and application status', async () => {
    const request = vi.fn(async (path: string) => {
      if (path === '/jobs') return { jobs: [{ id: 'j1' }, { id: 'j2' }] };
      if (path === '/data/job_analyses') return { documents: [{ jobId: 'j1', relevant: true }] };
      if (path === '/data/applications') return { documents: [{ jobId: 'j2', status: 'APPLIED' }] };
      return null;
    });
    const client = httpHuntClient({ request: request as never });
    await expect(client.invoke('list_jobs')).resolves.toEqual([
      { job: { id: 'j1' }, analysis: { jobId: 'j1', relevant: true }, applicationStatus: null },
      { job: { id: 'j2' }, analysis: null, applicationStatus: 'APPLIED' },
    ]);
  });

  it('refuses desktop-only commands with a sentence that says so', async () => {
    const client = httpHuntClient({ request: vi.fn() as never });
    await expect(
      client.invoke('update_resume_content', { id: 'r1' } as never),
    ).rejects.toMatchObject({
      code: 'DESKTOP_ONLY',
      message: 'That can only be done in the Offerpath desktop app.',
    });
  });

  it('turns the relay error into a sentence for the user', async () => {
    const { ApiError } = await import('@offerpath/learn');
    const request = vi.fn(async () => {
      throw new ApiError(
        { type: 'urn:offerpath:error:unknown', title: 'Request failed', status: 503 },
        { error: { code: 'DESKTOP_OFFLINE', message: 'No desktop' } },
      );
    });
    const client = httpHuntClient({ request: request as never });
    await expect(client.invoke('stop_job_hunt')).rejects.toMatchObject({
      code: 'DESKTOP_OFFLINE',
      message: desktopErrorMessage('DESKTOP_OFFLINE', ''),
    });
    // The agent's status is simply idle while the desktop is away.
    await expect(client.invoke('get_agent_status')).resolves.toMatchObject({ state: 'IDLE' });
  });

  it('reads a queued task the way the desktop reports it', () => {
    expect(asSubmission({ queued: true, queuedId: 'q1', position: 2, title: 'Job hunt' })).toEqual({
      run: null,
      queued: { id: 'q1', title: 'Job hunt' },
      position: 2,
    });
    expect(asSubmission({ runId: 'r1', queued: false })).toEqual({
      run: { id: 'r1' },
      queued: null,
      position: 0,
    });
    expect(asSubmission({ id: 'a1' })).toEqual({ id: 'a1' });
  });

  it('counts the funnel from what the desktop synced', () => {
    const jobs = [
      { job: { id: 'j1' }, analysis: { relevant: true } },
      { job: { id: 'j2' }, analysis: { relevant: false } },
      { job: { id: 'j3' }, analysis: null },
    ] as unknown as JobListItem[];
    const apps = [
      { application: { status: 'APPLIED' } },
      { application: { status: 'INTERVIEW' } },
      { application: { status: 'OFFER' } },
      { application: { status: 'READY_FOR_REVIEW' } },
    ] as unknown as ApplicationListItem[];
    expect(funnelFromSynced(jobs, apps)).toEqual({
      found: 3,
      relevant: 1,
      applied: 3,
      interviews: 2,
      offers: 1,
    });
  });
});

describe('where the API is', () => {
  it('uses VITE_OFFERPATH_API_URL when set, the Vite proxy in development, port 50005 otherwise', () => {
    const page = { protocol: 'http:', hostname: '10.0.0.5' };
    expect(apiBaseUrl({ VITE_OFFERPATH_API_URL: 'http://api.example:50005/api/v1/' }, page)).toBe(
      'http://api.example:50005/api/v1',
    );
    expect(apiBaseUrl({ DEV: true }, page)).toBe('/api/v1');
    expect(apiBaseUrl({ DEV: false }, page)).toBe('http://10.0.0.5:50005/api/v1');
    expect(apiOrigin('/api/v1', 'http://localhost:50004')).toBe('http://localhost:50004');
    expect(apiOrigin('http://10.0.0.5:50005/api/v1')).toBe('http://10.0.0.5:50005');
  });
});
