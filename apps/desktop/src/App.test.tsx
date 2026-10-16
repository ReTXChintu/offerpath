import type { AgentStatus, CommandName, HuntClient, SetupStatus } from '@offerpath/hunt';
import { createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { App } from './App';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(() => Promise.resolve(null)) }));

function setupStatus(setupCompleted: boolean): SetupStatus {
  return {
    claude: {
      installed: true,
      path: 'claude',
      version: '2.1.0',
      authenticated: true,
      authMethod: null,
      account: null,
      subscription: null,
      error: null,
    },
    chrome: {
      installed: true,
      path: 'chrome',
      version: '140',
      extensionInstalled: true,
      extensionVersion: '1.0',
      profilesChecked: [],
      error: null,
    },
    backend: {
      configured: false,
      connected: false,
      pending: 0,
      lastSyncAt: null,
      lastError: null,
      target: null,
      syncing: false,
    },
    profile: { ready: true, missing: [], hasMasterResume: true },
    mockMode: false,
    setupCompleted,
    dataDir: 'C:/Offerpath',
  };
}

function agentStatus(over: Partial<AgentStatus> = {}): AgentStatus {
  return {
    state: 'IDLE',
    runId: null,
    runKind: null,
    currentActivity: null,
    progress: null,
    stats: {
      jobsDiscovered: 0,
      jobsNew: 0,
      duplicatesRemoved: 0,
      jobsAnalyzed: 0,
      relevant: 0,
      awaitingApproval: 0,
      approved: 0,
      applied: 0,
      manualAction: 0,
      errors: 0,
      claudeCostUsd: 0,
    },
    startedAt: null,
    error: null,
    mock: false,
    paused: false,
    queued: 0,
    ...over,
  };
}

function fakeClient(answers: Partial<Record<CommandName, unknown>>) {
  const invoke = vi.fn(async (command: CommandName) => answers[command] ?? null);
  const client: HuntClient = {
    invoke: invoke as unknown as HuntClient['invoke'],
    listen: vi.fn(async () => () => undefined) as unknown as HuntClient['listen'],
  };
  return { client, invoke };
}

function renderApp(path: string, answers: Partial<Record<CommandName, unknown>> = {}) {
  const { client, invoke } = fakeClient({
    get_setup_status: setupStatus(true),
    get_agent_status: agentStatus(),
    list_notifications: [],
    ...answers,
  });
  const history = createMemoryHistory({ initialEntries: [path] });
  render(<App client={client} history={history} requireTauri={false} />);
  return { history, invoke };
}

describe('desktop shell', () => {
  it('has the sidebar of plan section 5.2', async () => {
    renderApp('/');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    for (const label of ['Today', 'Roadmap', 'Learn', 'Practice', 'Recall', 'Interviews']) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument();
    }
    for (const label of ['Jobs', 'Applications', 'Job sites', 'Progress']) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument();
    }
    expect(within(nav).getByRole('group', { name: 'Grow' })).toBeInTheDocument();
    expect(within(nav).getByRole('group', { name: 'Hunt' })).toBeInTheDocument();
    // Agent and Settings sit at the bottom, outside the groups.
    expect(screen.getByRole('link', { name: 'Agent' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Today' })).toHaveAttribute('aria-current', 'page');
  });

  it('shows Today, Grow and Progress as phase 3 placeholders', async () => {
    const user = userEvent.setup();
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Recall' }));
    expect(await screen.findByRole('heading', { name: 'Recall' })).toBeInTheDocument();
    expect(screen.getByText('Coming in phase 3')).toBeInTheDocument();
  });

  it('renders the hunt pages through the client', async () => {
    const user = userEvent.setup();
    const { invoke } = renderApp('/');
    await user.click(await screen.findByRole('link', { name: 'Jobs' }));
    expect(await screen.findByRole('heading', { name: 'Jobs' })).toBeInTheDocument();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('list_jobs', undefined));
    expect(screen.getByRole('link', { name: 'Jobs' })).toHaveAttribute('aria-current', 'page');
  });

  it('opens the first-run screen, which says the desktop is the AI and stays in the tray', async () => {
    const { history } = renderApp('/', {
      get_setup_status: setupStatus(false),
      get_legacy_import: null,
    });
    await waitFor(() => expect(history.location.pathname).toBe('/setup'));
    expect(await screen.findByText('This desktop is your AI.')).toBeInTheDocument();
    expect(screen.getByText(/hides Offerpath to the system tray/)).toBeInTheDocument();
  });

  it('opens the command palette with Ctrl+K and jumps to a page', async () => {
    const user = userEvent.setup();
    const { history } = renderApp('/');
    await screen.findByRole('heading', { name: 'Today' });
    await user.keyboard('{Control>}k{/Control}');
    const input = await screen.findByRole('combobox', { name: 'Search pages and actions' });
    await user.type(input, 'applications');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(history.location.pathname).toBe('/applications'));
  });

  it('shows what the agent is doing and its queue in the status bar', async () => {
    renderApp('/', {
      get_agent_status: agentStatus({
        state: 'APPLYING',
        currentActivity: 'Filling the Acme form',
        queued: 2,
      }),
    });
    const bar = await screen.findByRole('status', { name: 'Agent status' });
    expect(await within(bar).findByText('Applying')).toBeInTheDocument();
    expect(within(bar).getByText('· 2 queued')).toBeInTheDocument();
    expect(within(bar).getByText('Filling the Acme form')).toBeInTheDocument();
  });
});

describe('outside Tauri', () => {
  it('explains that Offerpath runs as a desktop app', () => {
    render(<App history={createMemoryHistory({ initialEntries: ['/'] })} />);
    expect(screen.getByText('Offerpath runs as a desktop app')).toBeInTheDocument();
  });
});
