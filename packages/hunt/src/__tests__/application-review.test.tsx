import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ApplicationReviewPage } from '../pages/ApplicationReview';
import type { ApplicationDetail } from '../types';
import { agentStatus, applicationDetail, renderHunt, settings, type Handlers } from './harness';

function renderReview(detail: ApplicationDetail, extra: Handlers = {}) {
  return renderHunt(<ApplicationReviewPage applicationId={detail.application.id} />, {
    get_application: () => detail,
    get_agent_status: () => agentStatus(),
    get_settings: () => settings(),
    approve_application: () => detail.application,
    reject_application: () => detail.application,
    mark_manual_application_complete: () => detail.application,
    answer_application_questions: () => detail.application,
    apply_application: () => ({ started: true, queued: null, position: 0 }) as never,
    ...extra,
  });
}

describe('ApplicationReview: approval', () => {
  it('never approves without the confirm step', async () => {
    const user = userEvent.setup();
    const { callsTo } = renderReview(applicationDetail());

    const [topApprove] = await screen.findAllByRole('button', { name: 'Approve & Apply' });
    expect(topApprove).toBeDefined();
    await user.click(topApprove!);

    const dialog = screen.getByRole('dialog', { name: 'Approve and apply?' });
    expect(dialog).toHaveTextContent(
      "Offerpath will open Acme's application in Chrome and fill it with this resume",
    );
    expect(callsTo('approve_application')).toHaveLength(0);

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(callsTo('approve_application')).toHaveLength(0);
    expect(callsTo('apply_application')).toHaveLength(0);
  });

  it('approves with applyNow once confirmed, and never calls apply directly', async () => {
    const user = userEvent.setup();
    const { callsTo } = renderReview(applicationDetail());

    const buttons = await screen.findAllByRole('button', { name: 'Approve & Apply' });
    // The big button at the bottom of the card opens the same confirmation.
    await user.click(buttons[buttons.length - 1]!);
    const dialog = screen.getByRole('dialog', { name: 'Approve and apply?' });
    await user.click(within(dialog).getByRole('button', { name: 'Approve & Apply' }));

    await waitFor(() => expect(callsTo('approve_application')).toHaveLength(1));
    expect(callsTo('approve_application')[0]).toEqual({ id: 'app-1', applyNow: true });
    expect(callsTo('apply_application')).toHaveLength(0);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('says it will send an email when the job applies by email', async () => {
    const user = userEvent.setup();
    renderReview(
      applicationDetail({ job: { applyEmail: 'hiring@acme.test', contactName: 'Priya' } }),
    );

    expect(await screen.findByText(/Applies by email/)).toBeInTheDocument();
    const [approve] = screen.getAllByRole('button', { name: 'Approve & Send email' });
    await user.click(approve!);
    const dialog = screen.getByRole('dialog', { name: 'Approve and send the email?' });
    expect(dialog).toHaveTextContent('send one email to hiring@acme.test');
    expect(dialog).toHaveTextContent('never emails anyone else');
  });

  it('warns that nothing is submitted in mock mode', async () => {
    renderReview(applicationDetail(), { get_settings: () => settings({ mockMode: true }) });
    expect(await screen.findByText('Mock mode: nothing will be submitted')).toBeInTheDocument();
  });

  it('offers no approve or apply on an application that was already sent', async () => {
    renderReview(
      applicationDetail({ application: { status: 'APPLIED', appliedAt: '2026-10-10T10:00:00Z' } }),
    );
    expect(
      await screen.findByRole('button', { name: 'Got an interview call' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Approve/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply now' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
  });
});

describe('ApplicationReview: after approval', () => {
  it('"Apply now" on an approved application calls apply_application', async () => {
    const user = userEvent.setup();
    const { callsTo } = renderReview(
      applicationDetail({
        application: { status: 'APPROVED', approvedAt: '2026-10-15T10:00:00Z' },
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'Apply now' }));
    await waitFor(() => expect(callsTo('apply_application')).toEqual([{ id: 'app-1' }]));
    expect(screen.queryByRole('button', { name: /Approve &/ })).not.toBeInTheDocument();
  });

  it('marks a manual application as applied only after confirming', async () => {
    const user = userEvent.setup();
    const { callsTo } = renderReview(
      applicationDetail({
        application: { status: 'MANUAL_ACTION_REQUIRED', failureReason: 'CAPTCHA on the form' },
      }),
    );
    expect(await screen.findByText('CAPTCHA on the form')).toBeInTheDocument();
    const [markApplied] = screen.getAllByRole('button', { name: 'Mark as Applied' });
    await user.click(markApplied!);
    const dialog = screen.getByRole('dialog', { name: 'Mark as applied?' });
    expect(dialog).toHaveTextContent(
      'Only confirm this after you submitted the application yourself.',
    );
    expect(callsTo('mark_manual_application_complete')).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Mark as Applied' }));
    await waitFor(() =>
      expect(callsTo('mark_manual_application_complete')).toEqual([{ id: 'app-1' }]),
    );
  });

  it('rejects with the reason given', async () => {
    const user = userEvent.setup();
    const { callsTo } = renderReview(applicationDetail());
    const [reject] = await screen.findAllByRole('button', { name: 'Reject' });
    await user.click(reject!);
    const dialog = screen.getByRole('dialog', { name: 'Reject this application?' });
    await user.type(within(dialog).getByLabelText('Reason (optional)'), 'Too far away');
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));
    await waitFor(() =>
      expect(callsTo('reject_application')).toEqual([{ id: 'app-1', reason: 'Too far away' }]),
    );
  });
});

describe('ApplicationReview: questions only the user can answer', () => {
  const waiting = () =>
    applicationDetail({
      application: {
        status: 'WAITING_FOR_USER',
        pendingQuestions: [
          {
            id: 'q1',
            question: 'Expected CTC?',
            fieldType: 'text',
            options: [],
            required: true,
            context: 'in INR',
          },
          {
            id: 'q2',
            question: 'Notice period',
            fieldType: 'select',
            options: ['Immediate', '30 days'],
            required: false,
            context: '',
          },
        ],
      },
    });

  it('does not continue while a required answer is empty', async () => {
    const user = userEvent.setup();
    const { callsTo } = renderReview(waiting());
    await user.click(await screen.findByRole('button', { name: 'Continue application' }));
    expect(callsTo('answer_application_questions')).toHaveLength(0);
  });

  it('sends the answers, remembered for reuse by default', async () => {
    const user = userEvent.setup();
    const { callsTo } = renderReview(waiting());
    expect(await screen.findByText('Human input required')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Expected CTC\?/), '18 LPA');
    await user.selectOptions(screen.getByLabelText(/Notice period/), '30 days');
    await user.click(screen.getByRole('button', { name: 'Continue application' }));
    await waitFor(() =>
      expect(callsTo('answer_application_questions')).toEqual([
        {
          id: 'app-1',
          answers: [
            { question: 'Expected CTC?', answer: '18 LPA', source: 'USER' },
            { question: 'Notice period', answer: '30 days', source: 'USER' },
          ],
          saveForReuse: true,
        },
      ]),
    );
  });

  it('can skip remembering the answers', async () => {
    const user = userEvent.setup();
    const { callsTo } = renderReview(waiting());
    await user.type(await screen.findByLabelText(/Expected CTC\?/), '18 LPA');
    await user.click(screen.getByRole('checkbox', { name: /Remember these answers/ }));
    await user.click(screen.getByRole('button', { name: 'Continue application' }));
    await waitFor(() => expect(callsTo('answer_application_questions')).toHaveLength(1));
    expect(callsTo('answer_application_questions')[0]).toMatchObject({ saveForReuse: false });
  });
});

describe('ApplicationReview: errors', () => {
  it('shows a failed command as an error with its message', async () => {
    const user = userEvent.setup();
    renderReview(applicationDetail(), {
      approve_application: () => {
        throw {
          code: 'CHROME',
          message: 'Chrome is not running',
          details: 'pid 0',
          recoverable: true,
        };
      },
    });
    const [approve] = await screen.findAllByRole('button', { name: 'Approve & Apply' });
    await user.click(approve!);
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve & Apply' }),
    );
    expect(await screen.findByText('Chrome is not running')).toBeInTheDocument();
  });
});
