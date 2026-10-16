import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { SetupPage, formatBytes } from '../pages/Setup';
import type { LegacyData } from '../protocol';
import { renderHunt, settings, setupStatus, type Handlers } from './harness';

const legacy: LegacyData = {
  path: 'C:/Users/me/AppData/Roaming/job-hunter',
  collections: [
    ['jobs', 412],
    ['applications', 37],
    ['candidate_profiles', 1],
  ],
  bytes: 5 * 1024 * 1024,
};

function renderSetup(extra: Handlers = {}) {
  return renderHunt(<SetupPage />, {
    get_setup_status: () => setupStatus(),
    get_settings: () => settings(),
    get_legacy_import: () => legacy,
    import_legacy_data: () => null,
    ...extra,
  });
}

describe('Setup: old Job Hunter data', () => {
  it('shows what was found, with counts', async () => {
    renderSetup();
    expect(
      await screen.findByRole('heading', { name: 'Your Job Hunter data is on this computer' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/450 saved items \(5\.0 MB\)/)).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'What was found' });
    expect(table).toHaveTextContent('Jobs412');
    expect(table).toHaveTextContent('Applications37');
    expect(table).toHaveTextContent('Candidate profiles1');
  });

  it('imports when asked', async () => {
    const user = userEvent.setup();
    const { callsTo } = renderSetup();
    await user.click(await screen.findByRole('button', { name: 'Import' }));
    await waitFor(() => expect(callsTo('import_legacy_data')).toHaveLength(1));
  });

  it('"Start fresh" hides the offer without importing', async () => {
    const user = userEvent.setup();
    const { callsTo } = renderSetup();
    await user.click(await screen.findByRole('button', { name: 'Start fresh' }));
    expect(
      screen.queryByRole('heading', { name: 'Your Job Hunter data is on this computer' }),
    ).not.toBeInTheDocument();
    expect(callsTo('import_legacy_data')).toHaveLength(0);
  });

  it('offers nothing when there is no old data', async () => {
    renderSetup({ get_legacy_import: () => null });
    expect(await screen.findByText(/Step 1 · Check Claude CLI/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import' })).not.toBeInTheDocument();
  });
});

describe('Setup: account step', () => {
  it('hides the password behind a show/hide eye button', async () => {
    const user = userEvent.setup();
    renderSetup({ get_legacy_import: () => null });
    const password = await screen.findByLabelText('Password');
    expect(password).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toBeInTheDocument();
  });

  it('creates the account with the email and password typed', async () => {
    const user = userEvent.setup();
    const { callsTo } = renderSetup({
      get_legacy_import: () => null,
      backend_register: () => setupStatus().backend,
    });
    await user.type(await screen.findByLabelText('Email'), 'me@example.com');
    await user.type(screen.getByLabelText('Password'), 'longenough');
    await user.click(screen.getByRole('button', { name: 'Create account & connect' }));
    await waitFor(() =>
      expect(callsTo('backend_register')).toEqual([
        { email: 'me@example.com', password: 'longenough' },
      ]),
    );
  });
});

describe('formatBytes', () => {
  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
