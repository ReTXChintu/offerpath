import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PortfolioPage } from '../features/PortfolioPage';
import type { ProjectItem } from '../types';

import { VIEW, project } from './fixtures';
import { callsTo, problem, renderPortfolio, router } from './harness';

function api(projects: ProjectItem[], extra?: Parameters<typeof router>[0]) {
  return router((path, o) => {
    const out = extra?.(path, o);
    if (out !== undefined) return out;
    if (path === '/portfolio') return VIEW;
    if (path === '/portfolio/projects' && (o.method ?? 'GET') === 'GET') return { items: projects };
    return undefined;
  });
}

const DRAFT_NO_IMAGE = project({
  id: 'p2',
  title: 'Job Hunter',
  imageUrl: null,
  published: false,
  source: { collection: 'projects', id: 'prof-1' },
  followsSource: true,
});
const EDITED = project({
  id: 'p3',
  title: 'ForgeRoutine',
  published: false,
  source: { collection: 'projects', id: 'prof-2' },
  followsSource: false,
});

describe('Projects', () => {
  it('lists drafts and published projects, and filters them', async () => {
    const user = userEvent.setup();
    renderPortfolio(<PortfolioPage tab="projects" />, {
      request: api([project(), DRAFT_NO_IMAGE, EDITED]),
    });
    const list = await screen.findByRole('list', { name: 'Projects' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(within(list).getAllByText('Draft')).toHaveLength(2);
    expect(within(list).getAllByText('From profile')).toHaveLength(2);
    expect(within(list).getByText('Following profile')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Published' }));
    expect(
      within(screen.getByRole('list', { name: 'Projects' })).getAllByRole('listitem'),
    ).toHaveLength(1);
    await user.click(screen.getByRole('radio', { name: 'Drafts' }));
    expect(
      within(screen.getByRole('list', { name: 'Projects' })).getAllByRole('listitem'),
    ).toHaveLength(2);
  });

  it('can’t publish a project without an image, and says why', async () => {
    const user = userEvent.setup();
    const request = api([project(), DRAFT_NO_IMAGE], (_path, o) =>
      o.method === 'PATCH' ? { ...project(), published: false } : undefined,
    );
    renderPortfolio(<PortfolioPage tab="projects" />, { request });

    const noImage = await screen.findByRole('switch', { name: 'Publish Job Hunter' });
    expect(noImage).toBeDisabled();
    expect(screen.getByText('Add an image to publish')).toBeInTheDocument();

    const withImage = screen.getByRole('switch', { name: 'Publish Offerpath' });
    expect(withImage).toBeEnabled();
    await user.click(withImage);
    await waitFor(() =>
      expect(callsTo(request, 'PATCH', '/portfolio/projects/p1')).toHaveLength(1),
    );
    expect(callsTo(request, 'PATCH', '/portfolio/projects/p1')[0]![1]?.body).toEqual({
      published: false,
    });
  });

  it('reorders with the move buttons and sends every id in the new order', async () => {
    const user = userEvent.setup();
    const a = project({ id: 'a', title: 'Alpha' });
    const b = project({ id: 'b', title: 'Beta' });
    const c = project({ id: 'c', title: 'Gamma' });
    const request = api([a, b, c], (path) =>
      path === '/portfolio/projects/reorder' ? { items: [a, c, b] } : undefined,
    );
    renderPortfolio(<PortfolioPage tab="projects" />, { request });

    expect(await screen.findByRole('button', { name: 'Move Alpha up' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Move Gamma up' }));
    await waitFor(() =>
      expect(callsTo(request, 'POST', '/portfolio/projects/reorder')).toHaveLength(1),
    );
    expect(callsTo(request, 'POST', '/portfolio/projects/reorder')[0]![1]?.body).toEqual({
      ids: ['a', 'c', 'b'],
    });
    const titles = within(screen.getByRole('list', { name: 'Projects' }))
      .getAllByRole('listitem')
      .map((li) => li.querySelector('.t-h4')?.textContent);
    expect(titles).toEqual(['Alpha', 'Gamma', 'Beta']);
  });

  it('re-links an edited profile project', async () => {
    const user = userEvent.setup();
    const items = [EDITED];
    const request = api(items, (_path, o) => {
      if (o.method !== 'PATCH') return undefined;
      items[0] = { ...EDITED, followsSource: true };
      return items[0];
    });
    renderPortfolio(<PortfolioPage tab="projects" />, { request });
    await user.click(await screen.findByRole('button', { name: 'Re-link' }));
    await waitFor(() =>
      expect(callsTo(request, 'PATCH', '/portfolio/projects/p3')).toHaveLength(1),
    );
    expect(callsTo(request, 'PATCH', '/portfolio/projects/p3')[0]![1]?.body).toEqual({
      followsSource: true,
    });
    expect(await screen.findByText('Following profile')).toBeInTheDocument();
  });

  it('creates a project with every field, and checks the colours first', async () => {
    const user = userEvent.setup();
    const request = api([], (path, o) =>
      path === '/portfolio/projects' && o.method === 'POST' ? project({ id: 'new' }) : undefined,
    );
    renderPortfolio(<PortfolioPage tab="projects" />, { request });

    await user.click(await screen.findByRole('button', { name: 'Add project' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add project' });
    const d = within(dialog);
    await user.type(d.getByLabelText(/^Title/), 'Mock studio');
    await user.type(d.getByLabelText('Domain'), 'Design');
    await user.type(d.getByLabelText(/^Description/), 'Generates product mockups.');
    await user.type(d.getByLabelText('Tags'), 'Rust, Tauri{Enter}');
    await user.type(d.getByLabelText('Live URL'), 'https://mock.example.com');
    await user.clear(d.getByLabelText('Accent'));
    await user.type(d.getByLabelText('Accent'), '#12345');
    await user.click(d.getByRole('button', { name: 'Save' }));

    expect(await d.findAllByText('Use a colour like #1a2b3c.')).not.toHaveLength(0);
    expect(callsTo(request, 'POST', '/portfolio/projects')).toHaveLength(0);

    await user.type(d.getByLabelText('Accent'), 'F');
    // The live preview follows the colours.
    expect(d.getByTestId('gradient-preview').style.background).toContain('linear-gradient');
    await user.click(d.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(callsTo(request, 'POST', '/portfolio/projects')).toHaveLength(1));
    expect(callsTo(request, 'POST', '/portfolio/projects')[0]![1]?.body).toEqual({
      title: 'Mock studio',
      desc: 'Generates product mockups.',
      tags: ['Rust', 'Tauri'],
      accent: '#12345f',
      gradientFrom: '#1e1b4b',
      gradientTo: '#4338ca',
      imageUrl: null,
      liveUrl: 'https://mock.example.com',
      githubUrl: '',
      domain: 'Design',
      localPath: null,
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('asks for a title and a description long enough', async () => {
    const user = userEvent.setup();
    const request = api([]);
    renderPortfolio(<PortfolioPage tab="projects" />, { request });
    await user.click(await screen.findByRole('button', { name: 'Add project' }));
    const d = within(await screen.findByRole('dialog'));
    await user.type(d.getByLabelText(/^Title/), 'X');
    await user.type(d.getByLabelText(/^Description/), 'Short');
    await user.click(d.getByRole('button', { name: 'Save' }));
    expect(await d.findAllByText('Use at least 2 characters.')).toHaveLength(1);
    expect(d.getByText('Use at least 10 characters.')).toBeInTheDocument();
    expect(callsTo(request, 'POST', '/portfolio/projects')).toHaveLength(0);
  });

  it('edits a project and sends only what changed', async () => {
    const user = userEvent.setup();
    const request = api([project()], (_path, o) =>
      o.method === 'PATCH' ? project({ domain: 'Hiring', gradientTo: '#000000' }) : undefined,
    );
    renderPortfolio(<PortfolioPage tab="projects" />, { request });
    await user.click(await screen.findByRole('button', { name: 'Edit Offerpath' }));
    const d = within(await screen.findByRole('dialog', { name: 'Edit project' }));
    await user.clear(d.getByLabelText('Domain'));
    await user.type(d.getByLabelText('Domain'), 'Hiring');
    await user.clear(d.getByLabelText('Gradient to'));
    await user.type(d.getByLabelText('Gradient to'), '#000000');
    await user.click(d.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(callsTo(request, 'PATCH', '/portfolio/projects/p1')).toHaveLength(1),
    );
    expect(callsTo(request, 'PATCH', '/portfolio/projects/p1')[0]![1]?.body).toEqual({
      domain: 'Hiring',
      gradientTo: '#000000',
    });
  });

  it('uploads an image to Cloudinary and sets its URL', async () => {
    const user = userEvent.setup();
    const request = api([DRAFT_NO_IMAGE], (path, o) => {
      if (path === '/portfolio/uploads') return { url: 'https://res.cloudinary.com/demo/new.png' };
      if (o.method === 'PATCH') {
        return { ...DRAFT_NO_IMAGE, imageUrl: 'https://res.cloudinary.com/demo/new.png' };
      }
      return undefined;
    });
    renderPortfolio(<PortfolioPage tab="projects" />, { request });
    await user.click(await screen.findByRole('button', { name: 'Edit Job Hunter' }));
    const d = within(await screen.findByRole('dialog'));

    const file = new File(['png-bytes'], 'shot.png', { type: 'image/png' });
    await user.upload(d.getByLabelText('Image file'), file);

    await waitFor(() => expect(callsTo(request, 'POST', '/portfolio/uploads')).toHaveLength(1));
    expect(callsTo(request, 'POST', '/portfolio/uploads')[0]![1]?.body).toEqual({
      fileName: 'shot.png',
      contentBase64: btoa('png-bytes'),
    });
    expect(await d.findByAltText('Project image preview')).toHaveAttribute(
      'src',
      'https://res.cloudinary.com/demo/new.png',
    );
    await user.click(d.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(callsTo(request, 'PATCH', '/portfolio/projects/p2')).toHaveLength(1),
    );
    expect(callsTo(request, 'PATCH', '/portfolio/projects/p2')[0]![1]?.body).toEqual({
      imageUrl: 'https://res.cloudinary.com/demo/new.png',
    });
  });

  it('refuses a file that isn’t an image, and shows the server’s upload error', async () => {
    const user = userEvent.setup({ applyAccept: false });
    const request = api([DRAFT_NO_IMAGE], (path) =>
      path === '/portfolio/uploads'
        ? problem('validation', 400, 'Connect Cloudinary before uploading.')
        : undefined,
    );
    renderPortfolio(<PortfolioPage tab="projects" />, { request });
    await user.click(await screen.findByRole('button', { name: 'Edit Job Hunter' }));
    const d = within(await screen.findByRole('dialog'));

    await user.upload(
      d.getByLabelText('Image file'),
      new File(['x'], 'a.txt', { type: 'text/plain' }),
    );
    expect(await d.findByText('Choose a PNG, JPG, WebP or GIF image.')).toBeInTheDocument();
    expect(callsTo(request, 'POST', '/portfolio/uploads')).toHaveLength(0);

    await user.upload(
      d.getByLabelText('Image file'),
      new File(['x'], 'a.png', { type: 'image/png' }),
    );
    expect(await d.findByText('Connect Cloudinary before uploading.')).toBeInTheDocument();
  });

  it('deletes a project after confirming', async () => {
    const user = userEvent.setup();
    const request = api([project()], (_path, o) => (o.method === 'DELETE' ? null : undefined));
    renderPortfolio(<PortfolioPage tab="projects" />, { request });
    await user.click(await screen.findByRole('button', { name: 'Edit Offerpath' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }),
    );
    const confirm = await screen.findByRole('dialog', { name: 'Delete “Offerpath”?' });
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(callsTo(request, 'DELETE', '/portfolio/projects/p1')).toHaveLength(1),
    );
  });

  it('has a plain folder field on the web, and the laptop’s picker and tools when given', async () => {
    const user = userEvent.setup();
    const request = api([project()], (_path, o) =>
      o.method === 'PATCH' ? project({ localPath: 'D:\\code\\offerpath' }) : undefined,
    );
    const pickProjectFolder = vi.fn(async () => 'D:\\code\\offerpath');
    const renderProjectTools = vi.fn(({ update }: { update: (p: { accent: string }) => void }) => (
      <button type="button" onClick={() => update({ accent: '#ff0000' })}>
        Generate mockup
      </button>
    ));
    renderPortfolio(<PortfolioPage tab="projects" />, {
      request,
      host: { apiOrigin: null, pickProjectFolder, renderProjectTools },
    });
    await user.click(await screen.findByRole('button', { name: 'Edit Offerpath' }));
    const d = within(await screen.findByRole('dialog'));
    expect(d.getByLabelText('Project folder')).toHaveAttribute('readonly');
    await user.click(d.getByRole('button', { name: 'Change…' }));
    await waitFor(() =>
      expect(d.getByLabelText('Project folder')).toHaveValue('D:\\code\\offerpath'),
    );

    await user.click(d.getByRole('button', { name: 'Generate mockup' }));
    expect(d.getByLabelText('Accent')).toHaveValue('#ff0000');
    await user.click(d.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(callsTo(request, 'PATCH', '/portfolio/projects/p1')).toHaveLength(1),
    );
    expect(callsTo(request, 'PATCH', '/portfolio/projects/p1')[0]![1]?.body).toEqual({
      accent: '#ff0000',
      localPath: 'D:\\code\\offerpath',
    });
  });

  it('has no picker or tools slot on the web', async () => {
    const user = userEvent.setup();
    renderPortfolio(<PortfolioPage tab="projects" />, { request: api([project()]) });
    await user.click(await screen.findByRole('button', { name: 'Edit Offerpath' }));
    const d = within(await screen.findByRole('dialog'));
    expect(d.getByLabelText('Project folder')).not.toHaveAttribute('readonly');
    expect(d.queryByRole('button', { name: 'Change…' })).not.toBeInTheDocument();
    expect(d.queryByTestId('project-tools-slot')).not.toBeInTheDocument();
  });
});
