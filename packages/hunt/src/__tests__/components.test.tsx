import { MatchScore } from '@offerpath/ui';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ActivityFeed } from '../components/ActivityFeed';
import { HuntStatusBadge } from '../components/common';
import { NotificationBell, notificationTarget } from '../components/NotificationBell';
import { QueuePanel } from '../components/QueuePanel';
import type { AgentEvent, Notification } from '../types';
import { renderHunt } from './harness';

// The first three are ported from Job Hunter's apps/desktop/src/__tests__/ui.test.tsx.
describe('HuntStatusBadge', () => {
  it('renders human labels for statuses', () => {
    render(<HuntStatusBadge status="READY_FOR_REVIEW" />);
    expect(screen.getByText('Awaiting approval')).toBeInTheDocument();
  });
});

describe('MatchScore', () => {
  it('shows the percentage or a placeholder', () => {
    render(<MatchScore score={87} relevant />);
    expect(screen.getByText('87%')).toBeInTheDocument();
    render(<MatchScore score={null} />);
    expect(screen.getByText('Not analyzed')).toBeInTheDocument();
  });
});

describe('ActivityFeed', () => {
  it('lists events and an empty state', () => {
    const events: AgentEvent[] = [
      {
        id: '1',
        runId: 'r',
        at: new Date().toISOString(),
        level: 'SUCCESS',
        kind: 'STEP_DONE',
        message: 'Found 18 jobs on LinkedIn',
        data: null,
      },
      {
        id: '2',
        runId: 'r',
        at: new Date().toISOString(),
        level: 'WARN',
        kind: 'MESSAGE',
        message: 'CAPTCHA detected',
        data: null,
      },
    ];
    render(<ActivityFeed events={events} />);
    expect(screen.getByText('Found 18 jobs on LinkedIn')).toBeInTheDocument();
    expect(screen.getByText('CAPTCHA detected')).toBeInTheDocument();
    render(<ActivityFeed events={[]} />);
    expect(screen.getByText('No activity yet.')).toBeInTheDocument();
  });
});

function notification(over: Partial<Notification>): Notification {
  return {
    id: 'n1',
    userId: 'u',
    level: 'WARN',
    kind: 'APPLICATION_NEEDS_INPUT',
    title: 'Acme needs your answers',
    body: 'Two questions on the form.',
    linkPage: 'application',
    linkId: 'app-9',
    read: false,
    createdAt: '2026-10-16T09:00:00Z',
    updatedAt: '2026-10-16T09:00:00Z',
    ...over,
  };
}

describe('notifications', () => {
  it('maps each link to a hunt place', () => {
    expect(notificationTarget({ linkPage: 'application', linkId: 'a1' })).toEqual({
      to: 'application',
      applicationId: 'a1',
    });
    expect(notificationTarget({ linkPage: 'application', linkId: null })).toEqual({
      to: 'applications',
    });
    expect(notificationTarget({ linkPage: 'job-sites', linkId: null })).toEqual({
      to: 'job-sites',
    });
    expect(notificationTarget({ linkPage: 'whatever', linkId: null })).toEqual({ to: 'agent' });
  });

  it('shows the unread count, marks an item read and opens it', async () => {
    const user = userEvent.setup();
    const { callsTo, navigated } = renderHunt(<NotificationBell />, {
      list_notifications: () => [notification({})],
      mark_notifications_read: () => null,
    });
    const bell = await screen.findByRole('button', { name: '1 unread notifications' });
    await user.click(bell);
    await user.click(await screen.findByRole('button', { name: /Acme needs your answers/ }));
    await waitFor(() => expect(callsTo('mark_notifications_read')).toEqual([{ ids: ['n1'] }]));
    expect(navigated).toEqual([{ to: 'application', applicationId: 'app-9' }]);
  });
});

describe('QueuePanel', () => {
  it('lists queued tasks and removes one', async () => {
    const user = userEvent.setup();
    const { callsTo } = renderHunt(<QueuePanel />, {
      list_queue: () => [
        {
          id: 't1',
          title: 'Apply to Acme',
          requestedAt: new Date().toISOString(),
        } as never,
      ],
      remove_queued_task: () => true,
    });
    expect(await screen.findByText(/1\. Apply to Acme/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove Apply to Acme from the queue' }));
    await waitFor(() => expect(callsTo('remove_queued_task')).toEqual([{ id: 't1' }]));
  });
});
