import { AI_OFFLINE_MESSAGE } from '@offerpath/learn';
import { createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { storeSession } from './session';

vi.mock('@monaco-editor/react', () => ({
  default: () => null,
  loader: { config: () => undefined },
}));

const BASE = '/api/v1';

function json(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const TODAY = {
  date: '2026-10-16',
  startedAt: null,
  streak: 2,
  goal: null,
  learning: {
    id: 'r1',
    date: '2026-10-16T00:00:00.000Z',
    totalMinutes: 30,
    completedMinutes: 0,
    recallDue: 0,
    carriedCount: 0,
    items: [],
  },
  hunt: { todos: [], approvals: 0, questions: 0 },
  interviews: [],
  skillGaps: [],
  desktopOnline: false,
};

const READY = {
  application: {
    id: 'a1',
    jobId: 'j1',
    status: 'READY_FOR_REVIEW',
    pendingQuestions: [],
    updatedAt: '2026-10-16T08:00:00Z',
  },
  job: { id: 'j1', title: 'Frontend engineer', company: 'Acme' },
  analysis: null,
};

type Route = (path: string, init?: RequestInit) => Response | undefined;

function fetchFor(route: Route) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.startsWith(BASE) ? url.slice(BASE.length) : url;
    const answer = route(path, init);
    if (answer) return answer;
    if (path === '/onboarding/status') {
      return json(200, {
        completed: true,
        technologyCount: 1,
        awaitingContent: false,
        hasRoadmap: true,
      });
    }
    if (path === '/today') return json(200, TODAY);
    if (path === '/desktop/status') return json(200, { online: false, desktop: null });
    if (path === '/applications') return json(200, [READY]);
    if (path === '/recall/due') return json(200, []);
    return json(404, { type: 'urn:offerpath:error:not-found', title: 'Not found', status: 404 });
  });
}

function signedIn() {
  storeSession({
    email: 'me@example.com',
    userId: 'u1',
    accessToken: 'access',
    refreshToken: 'refresh-token-long-enough',
  });
}

function renderApp(path: string, route: Route = () => undefined) {
  const fetchImpl = fetchFor(route);
  const history = createMemoryHistory({ initialEntries: [path] });
  render(<App baseUrl={BASE} fetchImpl={fetchImpl} history={history} />);
  return { fetchImpl, history };
}

describe('signing in', () => {
  it('has a password field with a show/hide eye button', async () => {
    const user = userEvent.setup();
    renderApp('/');
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    const password = screen.getByLabelText(/^Password/);
    expect(password).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(password).toHaveAttribute('type', 'password');
  });

  it('signs in and opens Today', async () => {
    const user = userEvent.setup();
    const { fetchImpl } = renderApp('/', (path) =>
      path === '/auth/login'
        ? json(200, { userId: 'u1', accessToken: 'a', refreshToken: 'r', expiresInSeconds: 900 })
        : undefined,
    );
    await user.type(screen.getByLabelText(/^Email/), 'me@example.com');
    await user.type(screen.getByLabelText(/^Password/), 'correct horse');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument();
    const login = fetchImpl.mock.calls.find(([url]) => url === `${BASE}/auth/login`)!;
    expect(JSON.parse(String(login[1]?.body))).toEqual({
      email: 'me@example.com',
      password: 'correct horse',
    });
  });

  it('creates an account with a name', async () => {
    const user = userEvent.setup();
    const { fetchImpl } = renderApp('/', (path) =>
      path === '/auth/register'
        ? json(201, { userId: 'u2', accessToken: 'a', refreshToken: 'r', expiresInSeconds: 900 })
        : undefined,
    );
    await user.click(screen.getByRole('radio', { name: 'Create account' }));
    await user.type(screen.getByLabelText('Your name'), 'Alex');
    await user.type(screen.getByLabelText(/^Email/), 'new@example.com');
    await user.type(screen.getByLabelText(/^Password/), 'longenough');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await screen.findByRole('heading', { name: 'Today' });
    const register = fetchImpl.mock.calls.find(([url]) => url === `${BASE}/auth/register`)!;
    expect(JSON.parse(String(register[1]?.body))).toMatchObject({ displayName: 'Alex' });
  });

  it('shows why a sign-in failed', async () => {
    const user = userEvent.setup();
    renderApp('/', (path) =>
      path === '/auth/login'
        ? json(401, {
            type: 'urn:offerpath:error:invalid-credentials',
            title: 'Invalid credentials',
            status: 401,
            detail: 'Wrong email or password.',
          })
        : undefined,
    );
    await user.type(screen.getByLabelText(/^Email/), 'me@example.com');
    await user.type(screen.getByLabelText(/^Password/), 'nope');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Wrong email or password.')).toBeInTheDocument();
  });
});

describe('the signed-in web app', () => {
  it('has the sidebar of plan section 5.3', async () => {
    signedIn();
    renderApp('/');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    for (const label of [
      'Today',
      'Roadmap',
      'Learn',
      'Practice',
      'Recall',
      'Interviews',
      'Interview prep',
      'Progress',
    ]) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument();
    }
    for (const label of ['Needs you', 'Applications', 'Jobs']) {
      expect(within(nav).getByRole('link', { name: new RegExp(`^${label}`) })).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
  });

  it('says the desktop is offline in a strip at the top', async () => {
    signedIn();
    renderApp('/');
    expect(await screen.findByText(AI_OFFLINE_MESSAGE)).toBeInTheDocument();
  });

  it('lists what needs you and approves through the desktop', async () => {
    signedIn();
    const user = userEvent.setup();
    const { history } = renderApp('/hunt');
    expect(await screen.findByText('Frontend engineer')).toBeInTheDocument();
    expect(screen.getByText('Ready to approve · 1')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Review' }));
    await waitFor(() => expect(history.location.pathname).toBe('/applications/a1'));
  });

  it('starts a job hunt on the desktop and explains when it is offline', async () => {
    signedIn();
    const user = userEvent.setup();
    const { fetchImpl } = renderApp('/hunt', (path, init) => {
      if (path !== '/desktop/request') return undefined;
      const body = JSON.parse(String(init?.body)) as { type: string };
      if (body.type === 'get_agent_status') {
        return json(503, { error: { code: 'DESKTOP_OFFLINE', message: 'offline' } });
      }
      return json(503, { error: { code: 'DESKTOP_OFFLINE', message: 'offline' } });
    });
    await user.click(await screen.findByRole('button', { name: 'Company careers' }));
    await waitFor(() => {
      const sent = fetchImpl.mock.calls
        .filter(([url]) => url === `${BASE}/desktop/request`)
        .map(([, init]) => JSON.parse(String(init?.body)));
      expect(sent).toContainEqual({
        type: 'start_job_hunt',
        payload: { sources: ['Company careers'] },
      });
    });
    expect((await screen.findAllByText(/Your desktop is offline/)).length).toBeGreaterThan(0);
    expect(await screen.findByText(/Open Offerpath on your computer/)).toBeInTheDocument();
  });

  it('lists devices and signs one out', async () => {
    signedIn();
    const user = userEvent.setup();
    const { fetchImpl } = renderApp('/settings?tab=devices', (path, init) => {
      if (path === '/devices') {
        return json(200, {
          devices: [
            {
              id: 'd1',
              name: 'Home PC',
              kind: 'desktop',
              platform: 'windows',
              createdAt: '2026-10-01T00:00:00Z',
              lastSeenAt: null,
              online: true,
            },
          ],
        });
      }
      if (path === '/devices/d1' && init?.method === 'DELETE')
        return new Response(null, { status: 204 });
      return undefined;
    });
    const row = (await screen.findByText('Home PC')).closest('.today-row') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Sign out' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Sign out' }));
    await waitFor(() =>
      expect(fetchImpl).toHaveBeenCalledWith(
        `${BASE}/devices/d1`,
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
  });

  it('offers the downloads from the API', async () => {
    signedIn();
    renderApp('/settings?tab=downloads', (path) =>
      path === '/downloads'
        ? json(200, {
            windows: {
              fileName: 'Offerpath_0.1.0_x64-setup.exe',
              version: '0.1.0',
              build: null,
              sizeBytes: 5_000_000,
              updatedAt: '2026-10-16T00:00:00Z',
              url: '/api/v1/downloads/windows',
            },
            android: null,
          })
        : undefined,
    );
    const link = await screen.findByRole('link', { name: /Download/ });
    expect(link.getAttribute('href')).toMatch(/\/api\/v1\/downloads\/windows$/);
    expect(screen.getByText('Not published yet')).toBeInTheDocument();
  });

  it('signs out back to the sign-in page', async () => {
    signedIn();
    const user = userEvent.setup();
    renderApp('/');
    await screen.findByRole('heading', { name: 'Today' });
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});
