import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { PortfolioPage } from '../features/PortfolioPage';

import { VIEW, experience, message, skillGroup, tool } from './fixtures';
import { callsTo, renderPortfolio, router } from './harness';

function api(kind: string, items: unknown[], extra?: Parameters<typeof router>[0]) {
  return router((path, o) => {
    const out = extra?.(path, o);
    if (out !== undefined) return out;
    if (path === '/portfolio') return VIEW;
    if (path === `/portfolio/${kind}` && (o.method ?? 'GET') === 'GET') return { items };
    return undefined;
  });
}

describe('Skills', () => {
  it('creates, edits, publishes, reorders and deletes skill groups', async () => {
    const user = userEvent.setup();
    const backend = skillGroup({ id: 's2', cat: 'Backend', items: ['Node.js'], source: null });
    const request = api('skills', [skillGroup(), backend], (path, o) => {
      if (path === '/portfolio/skills' && o.method === 'POST') return skillGroup({ id: 's3' });
      if (path === '/portfolio/skills/reorder') return { items: [backend, skillGroup()] };
      if (o.method === 'PATCH') return skillGroup({ published: true });
      if (o.method === 'DELETE') return null;
      return undefined;
    });
    renderPortfolio(<PortfolioPage tab="skills" />, { request });

    // The profile's group follows it.
    const list = await screen.findByRole('list', { name: 'Skill groups' });
    expect(within(list).getByText('From profile')).toBeInTheDocument();
    expect(within(list).getByText('Following profile')).toBeInTheDocument();

    // Create.
    await user.click(screen.getByRole('button', { name: 'Add skill group' }));
    let d = within(await screen.findByRole('dialog', { name: 'Add skill group' }));
    await user.click(d.getByRole('button', { name: 'Save' }));
    expect(await d.findByText('Name the category (at least 2 characters).')).toBeInTheDocument();
    await user.type(d.getByLabelText(/^Category/), 'Cloud');
    await user.type(d.getByLabelText('Skills'), 'AWS, GCP{Enter}');
    await user.click(d.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(callsTo(request, 'POST', '/portfolio/skills')).toHaveLength(1));
    expect(callsTo(request, 'POST', '/portfolio/skills')[0]![1]?.body).toEqual({
      cat: 'Cloud',
      items: ['AWS', 'GCP'],
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // Edit: only the changed field.
    await user.click(screen.getByRole('button', { name: 'Edit Frontend' }));
    d = within(await screen.findByRole('dialog', { name: 'Edit skill group' }));
    await user.click(d.getByRole('button', { name: 'Remove TypeScript' }));
    await user.click(d.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(callsTo(request, 'PATCH', '/portfolio/skills/s1')).toHaveLength(1));
    expect(callsTo(request, 'PATCH', '/portfolio/skills/s1')[0]![1]?.body).toEqual({
      items: ['React'],
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // Publish.
    await user.click(screen.getByRole('switch', { name: 'Publish Frontend' }));
    await waitFor(() => expect(callsTo(request, 'PATCH', '/portfolio/skills/s1')).toHaveLength(2));
    expect(callsTo(request, 'PATCH', '/portfolio/skills/s1')[1]![1]?.body).toEqual({
      published: true,
    });

    // Reorder.
    await user.click(screen.getByRole('button', { name: 'Move Backend up' }));
    await waitFor(() =>
      expect(callsTo(request, 'POST', '/portfolio/skills/reorder')[0]![1]?.body).toEqual({
        ids: ['s2', 's1'],
      }),
    );

    // Delete.
    await user.click(screen.getByRole('button', { name: 'Edit Backend' }));
    d = within(await screen.findByRole('dialog', { name: 'Edit skill group' }));
    await user.click(d.getByRole('button', { name: 'Delete' }));
    const confirm = await screen.findByRole('dialog', { name: 'Delete “Backend”?' });
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(callsTo(request, 'DELETE', '/portfolio/skills/s2')).toHaveLength(1));
  });
});

describe('Experience', () => {
  it('creates and edits experience, with bullets one per line', async () => {
    const user = userEvent.setup();
    const request = api('experience', [experience()], (path, o) => {
      if (path === '/portfolio/experience' && o.method === 'POST') return experience({ id: 'e2' });
      if (o.method === 'PATCH') return experience({ period: '2021 – 2023' });
      return undefined;
    });
    renderPortfolio(<PortfolioPage tab="experience" />, { request });

    await user.click(await screen.findByRole('button', { name: 'Add experience' }));
    let d = within(await screen.findByRole('dialog', { name: 'Add experience' }));
    await user.type(d.getByLabelText(/^Title/), 'Engineer');
    await user.type(d.getByLabelText(/^Company/), 'Acme');
    await user.type(d.getByLabelText(/^Period/), '2019 – 2021');
    await user.type(d.getByLabelText(/^Bullets/), 'Shipped A{Enter}{Enter}Shipped B');
    await user.click(d.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(callsTo(request, 'POST', '/portfolio/experience')).toHaveLength(1));
    expect(callsTo(request, 'POST', '/portfolio/experience')[0]![1]?.body).toEqual({
      title: 'Engineer',
      company: 'Acme',
      period: '2019 – 2021',
      bullets: ['Shipped A', 'Shipped B'],
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Edit Senior engineer at iBoon' }));
    d = within(await screen.findByRole('dialog', { name: 'Edit experience' }));
    await user.clear(d.getByLabelText(/^Period/));
    await user.type(d.getByLabelText(/^Period/), '2021 – 2023');
    await user.click(d.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(callsTo(request, 'PATCH', '/portfolio/experience/e1')[0]![1]?.body).toEqual({
        period: '2021 – 2023',
      }),
    );
  });
});

describe('Developer tools', () => {
  it('creates a tool with every field and toggles featured and published', async () => {
    const user = userEvent.setup();
    const fill = async (el: HTMLElement, text: string) => {
      await user.click(el);
      await user.paste(text);
    };
    const request = api('developer-tools', [tool()], (path, o) => {
      if (path === '/portfolio/developer-tools' && o.method === 'POST') return tool({ id: 't2' });
      if (o.method === 'PATCH') return tool({ featured: true });
      return undefined;
    });
    renderPortfolio(<PortfolioPage tab="tools" />, { request });

    await user.click(await screen.findByRole('switch', { name: 'Feature Env guard' }));
    await waitFor(() =>
      expect(callsTo(request, 'PATCH', '/portfolio/developer-tools/t1')[0]![1]?.body).toEqual({
        featured: true,
      }),
    );
    await user.click(screen.getByRole('switch', { name: 'Publish Env guard' }));
    await waitFor(() =>
      expect(callsTo(request, 'PATCH', '/portfolio/developer-tools/t1')[1]![1]?.body).toEqual({
        published: true,
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Add developer tool' }));
    const d = within(await screen.findByRole('dialog', { name: 'Add developer tool' }));
    await fill(d.getByLabelText(/^Title/), 'Log lens');
    await fill(d.getByLabelText(/^Short description/), 'Reads logs.');
    await fill(d.getByLabelText('Full description'), 'A longer story.');
    await fill(d.getByLabelText('Domain'), 'Observability');
    await user.type(d.getByLabelText('Tech stack'), 'Rust{Enter}');
    await fill(d.getByLabelText('Package name'), 'log-lens');
    await fill(d.getByLabelText('Version'), '0.1.0');
    await fill(d.getByLabelText('Install command'), 'cargo install log-lens');
    await fill(d.getByLabelText('GitHub URL'), 'https://github.com/me/log-lens');
    await fill(d.getByLabelText('npm URL'), ' ');
    await fill(d.getByLabelText('Docs URL'), 'https://docs.example.com');
    await fill(d.getByLabelText('Demo URL'), 'https://demo.example.com');
    await user.clear(d.getByLabelText('Gradient from'));
    await fill(d.getByLabelText('Gradient from'), 'nope');
    await user.clear(d.getByLabelText(/^Sort order/));
    await fill(d.getByLabelText(/^Sort order/), '3');
    await user.click(d.getByRole('switch', { name: 'Featured' }));
    await user.click(d.getByRole('button', { name: 'Save' }));
    expect(await d.findAllByText('Use a colour like #1a2b3c.')).not.toHaveLength(0);
    expect(callsTo(request, 'POST', '/portfolio/developer-tools')).toHaveLength(0);

    await user.clear(d.getByLabelText('Gradient from'));
    await fill(d.getByLabelText('Gradient from'), '#ABCDEF');
    await user.click(d.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(callsTo(request, 'POST', '/portfolio/developer-tools')).toHaveLength(1),
    );
    expect(callsTo(request, 'POST', '/portfolio/developer-tools')[0]![1]?.body).toEqual({
      title: 'Log lens',
      shortDescription: 'Reads logs.',
      fullDescription: 'A longer story.',
      domain: 'Observability',
      techStacks: ['Rust'],
      accent: '#10b981',
      gradientFrom: '#abcdef',
      gradientTo: '#047857',
      githubUrl: 'https://github.com/me/log-lens',
      npmUrl: '',
      docsUrl: 'https://docs.example.com',
      demoUrl: 'https://demo.example.com',
      installCommand: 'cargo install log-lens',
      packageName: 'log-lens',
      version: '0.1.0',
      featured: true,
      published: false,
      sortOrder: 3,
    });
  });
});

describe('Messages', () => {
  const OLD = message({ id: 'm0', name: 'Old', read: true, createdAt: '2026-10-01T10:00:00.000Z' });
  const NEW = message();

  it('lists newest first, marks read on open, can mark unread and delete', async () => {
    const user = userEvent.setup();
    const request = router((path, o) => {
      if (path === '/portfolio') return VIEW;
      if (path === '/portfolio/messages') return { items: [OLD, NEW] };
      if (path === '/portfolio/messages/m1' && o.method === 'PATCH') {
        return { ...NEW, read: (o.body as { read: boolean }).read };
      }
      if (o.method === 'DELETE') return null;
      return undefined;
    });
    renderPortfolio(<PortfolioPage tab="messages" />, { request });

    const list = await screen.findByRole('list', { name: 'Messages' });
    const rows = within(list).getAllByRole('button');
    expect(rows[0]).toHaveAccessibleName('Unread: message from Asha');
    expect(rows[0]).toHaveClass('pf-message-unread');
    expect(rows[1]).toHaveAccessibleName('message from Old');
    expect(screen.getByText('1 unread of 2')).toBeInTheDocument();

    await user.click(rows[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'From Asha' });
    expect(within(dialog).getByText(NEW.message)).toBeInTheDocument();
    await waitFor(() =>
      expect(callsTo(request, 'PATCH', '/portfolio/messages/m1')[0]![1]?.body).toEqual({
        read: true,
      }),
    );
    expect(await screen.findByText('2 messages, all read')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Mark unread' }));
    await waitFor(() =>
      expect(callsTo(request, 'PATCH', '/portfolio/messages/m1')[1]![1]?.body).toEqual({
        read: false,
      }),
    );
    expect(await screen.findByText('1 unread of 2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'message from Old' }));
    const old = await screen.findByRole('dialog', { name: 'From Old' });
    // Already read: opening it doesn't PATCH again.
    expect(callsTo(request, 'PATCH', '/portfolio/messages/m0')).toHaveLength(0);
    await user.click(within(old).getByRole('button', { name: 'Delete' }));
    const confirm = await screen.findByRole('dialog', { name: 'Delete this message?' });
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(callsTo(request, 'DELETE', '/portfolio/messages/m0')).toHaveLength(1),
    );
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'message from Old' })).not.toBeInTheDocument(),
    );
  });
});
