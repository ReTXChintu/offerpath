import { toast } from '@offerpath/ui';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PortfolioPage } from '../features/PortfolioPage';

import { VIEW } from './fixtures';
import { callsTo, problem, renderPortfolio, router } from './harness';

afterEach(() => vi.restoreAllMocks());

describe('Setup: before there is a portfolio', () => {
  it('explains it, validates the handle and creates the portfolio', async () => {
    const user = userEvent.setup();
    let created = false;
    const request = router((path, o) => {
      if (path === '/portfolio' && o.method === 'POST') {
        created = true;
        return { ...VIEW, handle: 'my-site', publicUrl: '/api/v1/public/portfolio/my-site/site' };
      }
      if (path === '/portfolio') {
        return created
          ? { ...VIEW, handle: 'my-site', publicUrl: '/api/v1/public/portfolio/my-site/site' }
          : problem('not-found', 404, 'No portfolio yet');
      }
      return { items: [] };
    });
    renderPortfolio(<PortfolioPage />, { request });

    expect(await screen.findByText(/serves it from a public address/)).toBeInTheDocument();
    const handle = screen.getByLabelText(/Handle/);
    expect(handle).toHaveValue('portfolio');

    await user.clear(handle);
    await user.type(handle, 'ab');
    await user.click(screen.getByRole('button', { name: 'Create portfolio' }));
    expect(await screen.findByText('Use at least 3 characters.')).toBeInTheDocument();
    expect(callsTo(request, 'POST', '/portfolio')).toHaveLength(0);

    await user.clear(handle);
    await user.type(handle, 'my site');
    await user.click(screen.getByRole('button', { name: 'Create portfolio' }));
    expect(
      await screen.findByText('Use lowercase letters, digits and dashes only.'),
    ).toBeInTheDocument();

    await user.clear(handle);
    await user.type(handle, 'my-site');
    await user.click(screen.getByRole('button', { name: 'Create portfolio' }));

    await waitFor(() => expect(callsTo(request, 'POST', '/portfolio')).toHaveLength(1));
    expect(callsTo(request, 'POST', '/portfolio')[0]![1]?.body).toEqual({ handle: 'my-site' });
    // Then the overview, with the absolute public URL.
    expect(await screen.findByLabelText('Public API URL')).toHaveValue(
      'http://203.0.113.10:50005/api/v1/public/portfolio/my-site/site',
    );
  });

  it('shows the server’s reason when the handle is taken', async () => {
    const user = userEvent.setup();
    const request = router((path, o) => {
      if (path === '/portfolio' && o.method === 'POST') {
        return problem('conflict', 409, 'That handle is taken.');
      }
      return problem('not-found', 404);
    });
    renderPortfolio(<PortfolioPage />, { request });
    await user.click(await screen.findByRole('button', { name: 'Create portfolio' }));
    expect(await screen.findByText('That handle is taken.')).toBeInTheDocument();
  });
});

describe('Overview', () => {
  it('shows the public URL, the counts and the Netlify snippet with the real address', async () => {
    renderPortfolio(<PortfolioPage tab="overview" />, { request: router(() => VIEW) });

    const url = 'http://203.0.113.10:50005/api/v1/public/portfolio/biswajit/site';
    expect(await screen.findByLabelText('Public API URL')).toHaveValue(url);
    expect(screen.getByRole('button', { name: 'Copy URL' })).toBeInTheDocument();
    const snippet = screen.getByLabelText('Netlify proxy snippet');
    expect(snippet.textContent).toContain(`to = "${url}"`);
    expect(snippet.textContent).toContain(
      'to = "http://203.0.113.10:50005/api/v1/public/portfolio/biswajit/contact"',
    );
    // 3 + 2 + 1 + 1 items, 2 of them drafts.
    const published = screen.getByText('Published').closest('.stat') as HTMLElement;
    expect(within(published).getByText('5')).toBeInTheDocument();
    expect(screen.getByText('Configured · key …1234')).toBeInTheDocument();
    // The unread count on the Messages tab.
    expect(screen.getByRole('tab', { name: /Messages/ })).toHaveTextContent('1');
  });

  it('imports from the profile and says what came in', async () => {
    const user = userEvent.setup();
    const show = vi.spyOn(toast, 'show');
    const request = router((path, o) => {
      if (path === '/portfolio/import-profile' && o.method === 'POST') {
        return { created: 2, updated: 1 };
      }
      return VIEW;
    });
    renderPortfolio(<PortfolioPage />, { request });
    await user.click(await screen.findByRole('button', { name: 'Import from profile now' }));
    await waitFor(() =>
      expect(show).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'success',
          description: '2 new drafts, 1 updated.',
        }),
      ),
    );
  });

  it('renames the handle', async () => {
    const user = userEvent.setup();
    const request = router((_path, o) => {
      if (o.method === 'PATCH') return { ...VIEW, handle: 'new-name' };
      return VIEW;
    });
    renderPortfolio(<PortfolioPage />, { request });
    const handle = await screen.findByLabelText(/^Handle/);
    await user.clear(handle);
    await user.type(handle, 'new-name');
    await user.click(screen.getByRole('button', { name: 'Save handle' }));
    await waitFor(() => expect(callsTo(request, 'PATCH', '/portfolio')).toHaveLength(1));
    expect(callsTo(request, 'PATCH', '/portfolio')[0]![1]?.body).toEqual({ handle: 'new-name' });
  });

  it('switches tabs through the host navigator', async () => {
    const user = userEvent.setup();
    const { navigator } = renderPortfolio(<PortfolioPage />, { request: router(() => VIEW) });
    await user.click(await screen.findByRole('tab', { name: 'Projects' }));
    expect(navigator.navigate).toHaveBeenCalledWith('/portfolio/projects');
  });
});

describe('Site settings', () => {
  it('saves every field, with roles per line and paragraphs split on blank lines', async () => {
    const user = userEvent.setup();
    const request = router(() => VIEW);
    renderPortfolio(<PortfolioPage tab="settings" />, { request });

    const roles = await screen.findByLabelText(/Roles/);
    expect(roles).toHaveValue('Full-stack developer\nMobile developer');
    expect(screen.getByLabelText(/Paragraphs/)).toHaveValue(
      'First paragraph.\n\nSecond paragraph.',
    );

    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'B. Panda');
    await user.clear(roles);
    await user.type(roles, 'Engineer{Enter}{Enter}Mentor');
    await user.clear(screen.getByLabelText(/Paragraphs/));
    await user.type(screen.getByLabelText(/Paragraphs/), 'One.{Enter}Still one.{Enter}{Enter}Two.');
    await user.type(screen.getByLabelText('Twitter'), 'https://x.com/me');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    await waitFor(() => expect(callsTo(request, 'PATCH', '/portfolio')).toHaveLength(1));
    expect(callsTo(request, 'PATCH', '/portfolio')[0]![1]?.body).toEqual({
      settings: {
        ...VIEW.settings,
        heroName: 'B. Panda',
        roles: ['Engineer', 'Mentor'],
        aboutParagraphs: ['One.\nStill one.', 'Two.'],
        socials: { ...VIEW.settings.socials, twitter: 'https://x.com/me' },
      },
    });
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });
});

describe('Cloudinary', () => {
  const NOT_CONFIGURED = {
    ...VIEW,
    cloudinary: { configured: false, cloudName: null, apiKeyLast4: null },
  };

  it('hides and shows the API secret with a labelled eye button', async () => {
    const user = userEvent.setup();
    renderPortfolio(<PortfolioPage />, { request: router(() => NOT_CONFIGURED) });
    const secret = await screen.findByLabelText('API secret');
    expect(secret).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(secret).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(secret).toHaveAttribute('type', 'password');
  });

  it('saves the credentials and shows the server’s refusal', async () => {
    const user = userEvent.setup();
    let attempt = 0;
    const request = router((path, o) => {
      if (path === '/portfolio/cloudinary' && o.method === 'PUT') {
        attempt += 1;
        return attempt === 1
          ? problem('validation', 400, 'Cloudinary refused these credentials.')
          : { ...VIEW, cloudinary: { configured: true, cloudName: 'mine', apiKeyLast4: '9876' } };
      }
      return NOT_CONFIGURED;
    });
    renderPortfolio(<PortfolioPage />, { request });

    await user.type(await screen.findByLabelText('Cloud name'), 'mine');
    await user.type(screen.getByLabelText(/^API key/), 'key-9876');
    await user.type(screen.getByLabelText('API secret'), 's3cret');
    await user.click(screen.getByRole('button', { name: 'Check and save' }));

    expect(await screen.findByText('Cloudinary refused these credentials.')).toBeInTheDocument();
    expect(callsTo(request, 'PUT', '/portfolio/cloudinary')[0]![1]?.body).toEqual({
      cloudName: 'mine',
      apiKey: 'key-9876',
      apiSecret: 's3cret',
    });

    await user.click(screen.getByRole('button', { name: 'Check and save' }));
    expect(await screen.findByText('Configured · key …9876')).toBeInTheDocument();
  });

  it('asks before removing the account', async () => {
    const user = userEvent.setup();
    const request = router((path, o) => {
      if (path === '/portfolio/cloudinary' && o.method === 'DELETE') return NOT_CONFIGURED;
      return VIEW;
    });
    renderPortfolio(<PortfolioPage />, { request });
    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('dialog', { name: 'Disconnect Cloudinary?' });
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(callsTo(request, 'DELETE', '/portfolio/cloudinary')).toHaveLength(1),
    );
    expect(await screen.findByText('Not connected')).toBeInTheDocument();
  });
});
