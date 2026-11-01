import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { BULK_REJECT_REASON } from '../components/RejectAllButton';
import { ApplicationsPage } from '../pages/Applications';
import { JobsPage } from '../pages/Jobs';
import type { ApplicationListItem, ApplicationStatus, JobListItem } from '../types';
import { agentStatus, application, job, renderHunt, settings, type Handlers } from './harness';

function item(
  n: number,
  status: ApplicationStatus,
  company: string,
  title = 'Frontend Engineer',
): ApplicationListItem {
  return {
    application: application({ id: `app-${n}`, jobId: `job-${n}`, status }),
    job: job({ id: `job-${n}`, applicationId: `app-${n}`, company, title, status }),
    analysis: null,
  };
}

// Three wait on the user, one is approved (shown, left alone), one applied (hidden).
const APPS = [
  item(1, 'READY_FOR_REVIEW', 'Acme'),
  item(2, 'READY_FOR_REVIEW', 'Beta', 'Backend Engineer'),
  item(3, 'WAITING_FOR_USER', 'Gamma'),
  item(4, 'APPROVED', 'Delta'),
  item(5, 'APPLIED', 'Epsilon'),
];

function renderApplications(extra: Handlers = {}) {
  return renderHunt(<ApplicationsPage />, {
    list_applications: () => APPS,
    get_agent_status: () => agentStatus(),
    get_settings: () => settings(),
    reject_application: ({ id }) => APPS.find((a) => a.application.id === id)!.application,
    ...extra,
  });
}

async function openRejectAll(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Reject all' }));
  return screen.getByRole('dialog');
}

describe('Applications: Reject all', () => {
  it('asks first, saying how many will be rejected', async () => {
    const user = userEvent.setup();
    const { callsTo } = renderApplications();
    const dialog = await openRejectAll(user);

    expect(dialog).toHaveAccessibleName('Reject 3 applications?');
    expect(dialog).toHaveTextContent('You can reopen any of them later.');
    expect(dialog).toHaveTextContent('2 awaiting your approval, 1 waiting for your answers');
    expect(dialog).toHaveTextContent("1 other shown application doesn't wait on you");
    expect(within(dialog).getByRole('button', { name: 'Reject 3' })).toBeInTheDocument();
    expect(callsTo('reject_application')).toHaveLength(0);
  });

  it('rejects each shown waiting application once, then refreshes the list', async () => {
    const user = userEvent.setup();
    const { callsTo } = renderApplications();
    const dialog = await openRejectAll(user);
    const loadsBefore = callsTo('list_applications').length;

    await user.click(within(dialog).getByRole('button', { name: 'Reject 3' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const calls = callsTo('reject_application') as { id: string; reason?: string }[];
    expect(calls.map((c) => c.id).sort()).toEqual(['app-1', 'app-2', 'app-3']);
    expect(calls.every((c) => c.reason === BULK_REJECT_REASON)).toBe(true);
    expect(callsTo('reject_job')).toHaveLength(0);
    expect(await screen.findByText('Rejected 3 applications')).toBeInTheDocument();
    await waitFor(() => expect(callsTo('list_applications').length).toBeGreaterThan(loadsBefore));
  });

  it('leaves out applications the search hides', async () => {
    const user = userEvent.setup();
    const { callsTo } = renderApplications();
    await user.type(await screen.findByLabelText('Search applications'), 'Backend');
    const dialog = await openRejectAll(user);
    expect(dialog).toHaveAccessibleName('Reject 1 application?');

    await user.click(within(dialog).getByRole('button', { name: 'Reject 1' }));
    await waitFor(() =>
      expect(callsTo('reject_application')).toEqual([{ id: 'app-2', reason: BULK_REJECT_REASON }]),
    );
  });

  it('rejects nothing when cancelled', async () => {
    const user = userEvent.setup();
    const { callsTo } = renderApplications();
    const dialog = await openRejectAll(user);

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(callsTo('reject_application')).toHaveLength(0);
    expect(callsTo('reject_job')).toHaveLength(0);
  });

  it('names a failed one and still rejects the rest', async () => {
    const user = userEvent.setup();
    const { callsTo } = renderApplications({
      reject_application: ({ id }) => {
        if (id === 'app-2') {
          throw {
            code: 'INVALID_TRANSITION',
            message: 'Cannot move from APPLYING to REJECTED',
            recoverable: true,
          };
        }
        return APPS.find((a) => a.application.id === id)!.application;
      },
    });
    const dialog = await openRejectAll(user);

    await user.click(within(dialog).getByRole('button', { name: 'Reject 3' }));

    expect(
      await screen.findByRole('dialog', { name: 'Rejected 2 of 3 applications' }),
    ).toBeInTheDocument();
    const failed = screen.getByRole('alert');
    expect(failed).toHaveTextContent('1 application could not be rejected');
    expect(failed).toHaveTextContent(
      'Backend Engineer at Beta: Cannot move from APPLYING to REJECTED',
    );
    expect(failed).not.toHaveTextContent('Acme');
    expect((callsTo('reject_application') as { id: string }[]).map((c) => c.id).sort()).toEqual([
      'app-1',
      'app-2',
      'app-3',
    ]);

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('is only offered on the applications that need attention', async () => {
    const user = userEvent.setup();
    renderApplications();
    expect(await screen.findByRole('button', { name: 'Reject all' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /^Applied/ }));
    expect(screen.queryByRole('button', { name: 'Reject all' })).not.toBeInTheDocument();
  });
});

describe('Jobs: Reject all', () => {
  const JOBS: JobListItem[] = APPS.map((a) => ({
    job: a.job,
    analysis: null,
    applicationStatus: a.application.status,
  }));

  it('rejects each shown job awaiting approval with reject_job', async () => {
    const user = userEvent.setup();
    const { callsTo } = renderHunt(<JobsPage />, {
      list_jobs: () => JOBS,
      reject_job: ({ id }) => JOBS.find((j) => j.job.id === id)!.job,
    });
    await screen.findByText('Backend Engineer');
    expect(screen.queryByRole('button', { name: 'Reject all' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /^Awaiting Approval/ }));
    const dialog = await openRejectAll(user);
    expect(dialog).toHaveAccessibleName('Reject 2 jobs?');

    await user.click(within(dialog).getByRole('button', { name: 'Reject 2' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect((callsTo('reject_job') as { id: string }[]).map((c) => c.id).sort()).toEqual([
      'job-1',
      'job-2',
    ]);
    expect(callsTo('reject_application')).toHaveLength(0);
  });
});
