import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { problem, renderLearn, type RequestMock } from '../../__tests__/harness';
import type { PrepQuestionView, PrepView } from '../../lib/interview-prep';
import { countdown, localDateTimeToIso } from '../../lib/when';
import { UpcomingPreps } from './UpcomingPreps';
import { PrepCreate, validatePrepDraft, type PrepDraft } from './PrepCreate';
import { PrepDetail } from './PrepDetail';
import { InterviewPrepList } from './PrepList';
import { GRADING_UNAVAILABLE } from './PrepQuestion';
import { AI_SOURCE_MESSAGE } from './shared';

type Route = (path: string, options?: { method?: string; body?: unknown }) => unknown;

function router(route: Route): RequestMock {
  return vi.fn(async (path: string, options?: { method?: string; body?: unknown }) => {
    const out = route(path, options);
    if (out instanceof Error) throw out;
    return out;
  }) as RequestMock;
}

const DAY = 24 * 60 * 60 * 1000;
const inDays = (days: number) => new Date(Date.now() + days * DAY).toISOString();

function question(over: Partial<PrepQuestionView> = {}): PrepQuestionView {
  return {
    id: 'q1',
    order: 0,
    kind: 'TECHNICAL',
    topic: 'PostgreSQL',
    question: 'How would you find and fix a slow query in PostgreSQL?',
    difficulty: 3,
    keyPoints: null,
    answer: null,
    score: null,
    feedback: null,
    answeredAt: null,
    ...over,
  };
}

function prep(over: Partial<PrepView> = {}): PrepView {
  return {
    id: 'p1',
    company: 'Acme',
    role: 'Backend engineer',
    jobDescription: 'Node.js and PostgreSQL.',
    technologies: ['Node.js', 'PostgreSQL'],
    scheduledAt: inDays(3),
    status: 'READY',
    error: null,
    generatedBy: 'desktop',
    plan: {
      summary: 'A backend role on Node.js and PostgreSQL; expect depth on both.',
      focusAreas: [
        { topic: 'Event loop', why: 'Async correctness comes up every time.', priority: 2 },
        { topic: 'Query planning', why: 'The JD names performance work.', priority: 1 },
      ],
      schedule: [
        { day: 1, focus: 'Indexes and EXPLAIN' },
        { day: 2, focus: 'Event loop and streams' },
      ],
    },
    questions: [
      question(),
      question({
        id: 'q2',
        order: 1,
        kind: 'BEHAVIORAL',
        topic: 'Ownership',
        question: 'Tell me about a production incident you owned end to end.',
      }),
    ],
    progress: { answered: 0, total: 2, averageScore: null },
    createdAt: new Date().toISOString(),
    ...over,
  };
}

const FILLED: PrepDraft = {
  company: 'Acme',
  role: '',
  jobDescription: '',
  technologies: ['React'],
  date: '2099-11-03',
  time: '10:30',
};

describe('validatePrepDraft', () => {
  it('needs a job description or at least one technology', () => {
    const { errors, input } = validatePrepDraft({ ...FILLED, technologies: [] });
    expect(input).toBeNull();
    expect(errors.jobDescription).toMatch(/job description, or add at least one technology/);

    expect(
      validatePrepDraft({ ...FILLED, technologies: [], jobDescription: 'A JD' }).input,
    ).not.toBeNull();
    expect(validatePrepDraft(FILLED).input).not.toBeNull();
  });

  it('needs a date and time that are still ahead', () => {
    expect(validatePrepDraft({ ...FILLED, time: '' }).errors.when).toMatch(/date and time/);
    expect(validatePrepDraft({ ...FILLED, date: '2001-01-01' }).errors.when).toMatch(/passed/);
  });

  it('sends the local time as ISO with the offset', () => {
    const { input } = validatePrepDraft(FILLED);
    expect(input?.scheduledAt).toMatch(/^2099-11-03T10:30:00[+-]\d{2}:\d{2}$/);
    // The same moment as the local date and time.
    expect(new Date(input!.scheduledAt).getTime()).toBe(new Date('2099-11-03T10:30:00').getTime());
    expect(input).toMatchObject({ company: 'Acme', role: null, technologies: ['React'] });
    expect(localDateTimeToIso('2099-11-03', 'nope')).toBeNull();
  });

  it('counts down to the interview', () => {
    const now = Date.parse('2026-10-19T10:00:00Z');
    expect(countdown('2026-10-19T10:40:00Z', now)).toBe('in 40 minutes');
    expect(countdown('2026-10-19T15:00:00Z', now)).toBe('in 5 hours');
    expect(countdown('2026-10-20T14:00:00Z', now)).toBe('in 1 day, 4 hours');
    expect(countdown('2026-10-29T10:00:00Z', now)).toBe('in 10 days');
    expect(countdown('2026-10-18T10:00:00Z', now)).toBe('passed');
  });
});

describe('the create form', () => {
  it('refuses to send without a job description or a technology', async () => {
    const user = userEvent.setup();
    const request = router((path) => (path === '/interview-preps/ai' ? { source: 'desktop' } : {}));
    renderLearn(<PrepCreate />, { request });

    fireEvent.change(screen.getByLabelText(/^Interview date/), { target: { value: '2099-11-03' } });
    fireEvent.change(screen.getByLabelText(/^Time/), { target: { value: '10:30' } });
    await user.click(screen.getByRole('button', { name: 'Prepare' }));

    expect(
      await screen.findByText('Paste the job description, or add at least one technology.'),
    ).toBeInTheDocument();
    expect(request.mock.calls.some(([, o]) => o?.method === 'POST')).toBe(false);
  });

  it('asks for the date and time', async () => {
    const user = userEvent.setup();
    const request = router(() => ({ source: 'desktop' }));
    renderLearn(<PrepCreate />, { request });

    await user.type(screen.getByLabelText('Job description'), 'Senior React engineer');
    await user.click(screen.getByRole('button', { name: 'Prepare' }));

    expect(await screen.findByText("Pick the interview's date and time.")).toBeInTheDocument();
    expect(request.mock.calls.some(([, o]) => o?.method === 'POST')).toBe(false);
  });

  it('sends the technologies and the time with its offset, then opens the prep', async () => {
    const user = userEvent.setup();
    const request = router((path, options) => {
      if (path === '/interview-preps/ai') return { source: 'desktop' };
      if (path === '/interview-preps' && options?.method === 'POST') {
        return prep({ id: 'new1', status: 'GENERATING', plan: null, questions: [] });
      }
      return {};
    });
    const { navigator } = renderLearn(<PrepCreate />, { request });

    await user.type(screen.getByLabelText('Company'), 'Acme');
    await user.type(screen.getByLabelText('Technologies'), 'React{enter}TypeScript{enter}');
    fireEvent.change(screen.getByLabelText(/^Interview date/), { target: { value: '2099-11-03' } });
    fireEvent.change(screen.getByLabelText(/^Time/), { target: { value: '09:15' } });
    await user.click(screen.getByRole('button', { name: 'Prepare' }));

    await waitFor(() =>
      expect(navigator.navigate).toHaveBeenCalledWith('/interview-prep/new1', { replace: true }),
    );
    const post = request.mock.calls.find(([, o]) => o?.method === 'POST');
    const body = post?.[1]?.body as Record<string, unknown>;
    expect(body).toMatchObject({
      company: 'Acme',
      role: null,
      jobDescription: null,
      technologies: ['React', 'TypeScript'],
    });
    expect(body.scheduledAt).toMatch(/^2099-11-03T09:15:00[+-]\d{2}:\d{2}$/);
  });

  it.each([
    ['desktop', AI_SOURCE_MESSAGE.desktop],
    ['openai', AI_SOURCE_MESSAGE.openai],
    [null, AI_SOURCE_MESSAGE.none],
  ] as const)('says where AI will run when it is %s', async (source, message) => {
    const request = router(() => ({ source }));
    renderLearn(<PrepCreate />, { request });
    expect(await screen.findByTestId('ai-source')).toHaveTextContent(message);
  });

  it('words each place AI can run', () => {
    expect(AI_SOURCE_MESSAGE.desktop).toBe("Your laptop's Claude will prepare this");
    expect(AI_SOURCE_MESSAGE.openai).toBe(
      'Your laptop is offline: your OpenAI key will prepare this',
    );
    expect(AI_SOURCE_MESSAGE.none).toBe(
      'Your laptop is offline and no OpenAI key is saved: it will start when your laptop comes online (or add a key in Settings → AI)',
    );
  });

  it('links to Settings → AI when nothing can run', async () => {
    renderLearn(<PrepCreate />, { request: router(() => ({ source: null })) });
    expect(await screen.findByRole('link', { name: 'Open Settings → AI' })).toHaveAttribute(
      'href',
      '#/settings?tab=ai',
    );
  });
});

describe('the prep list', () => {
  it('shows upcoming preps with their time, status and progress', async () => {
    const request = router(() => ({
      preps: [
        prep({ progress: { answered: 1, total: 2, averageScore: 7 } }),
        prep({ id: 'p2', company: 'Globex', status: 'GENERATING', plan: null, questions: [] }),
      ],
    }));
    renderLearn(<InterviewPrepList />, { request });

    const card = (await screen.findByText('Acme · Backend engineer')).closest('a')!;
    expect(card).toHaveAttribute('href', '#/interview-prep/p1');
    expect(within(card).getByText('1/2 answered')).toBeInTheDocument();
    expect(within(card).getByText('Average 7/10')).toBeInTheDocument();
    expect(within(card).getByText(/^in 2 days|^in 3 days/)).toBeInTheDocument();
    expect(screen.getByText('Preparing')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Prepare for an interview' })).toBeInTheDocument();
  });

  it('starts empty with a way in', async () => {
    const { navigator } = renderLearn(<InterviewPrepList />, {
      request: router(() => ({ preps: [] })),
    });
    expect(await screen.findByText('No interviews to prepare for yet')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Prepare for an interview' })[0]!);
    expect(navigator.navigate).toHaveBeenCalledWith('/interview-prep/new', undefined);
  });
});

describe('a prep', () => {
  it('shows the plan beside the questions, grouped by kind, and who prepared it', async () => {
    renderLearn(<PrepDetail prepId="p1" />, { request: router(() => prep()) });

    expect(await screen.findByText(/expect depth on both/)).toBeInTheDocument();
    expect(screen.getByText("Prepared by your laptop's Claude")).toBeInTheDocument();
    // Focus areas by priority: priority 1 first.
    const focus = screen.getAllByText(/Query planning|Event loop$/).map((n) => n.textContent);
    expect(focus).toEqual(['Query planning', 'Event loop']);
    expect(screen.getByText('Top priority')).toBeInTheDocument();
    expect(screen.getByText('Indexes and EXPLAIN')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Question 1' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Technical' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Behavioral' })).toBeInTheDocument();
  });

  it('practises a question: answer, then score, covered, missed and key points', async () => {
    const user = userEvent.setup();
    const graded = question({
      answer: 'EXPLAIN ANALYZE, then an index.',
      score: 6,
      answeredAt: new Date().toISOString(),
      keyPoints: ['Run EXPLAIN ANALYZE', 'Check the indexes', 'Watch for N+1 queries'],
      feedback: {
        covered: ['Run EXPLAIN ANALYZE', 'Check the indexes'],
        missed: ['Watch for N+1 queries'],
        feedback: 'Solid start; name the N+1 trap.',
      },
    });
    let answered = false;
    const request = router((path, options) => {
      if (path === '/interview-preps/p1/questions/q1/answer') {
        answered = true;
        return graded;
      }
      if (options?.method) return {};
      return answered
        ? prep({
            questions: [graded, prep().questions[1]!],
            progress: { answered: 1, total: 2, averageScore: 6 },
          })
        : prep();
    });
    renderLearn(<PrepDetail prepId="p1" />, { request });

    const card = await screen.findByRole('group', { name: 'Question 1' });
    // The key points stay hidden until the question is answered.
    expect(within(card).queryByText('Watch for N+1 queries')).not.toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Answer' }));
    const submit = within(card).getByRole('button', { name: 'Submit answer' });
    expect(submit).toBeDisabled();
    await user.type(within(card).getByLabelText('Your answer'), 'EXPLAIN ANALYZE, then an index.');
    await user.click(submit);

    expect(await within(card).findByText('Score 6/10')).toBeInTheDocument();
    const call = request.mock.calls.find(([p]) => p.endsWith('/answer'));
    expect(call?.[1]).toMatchObject({
      method: 'POST',
      body: { answer: 'EXPLAIN ANALYZE, then an index.' },
    });
    expect(within(card).getByText('Solid start; name the N+1 trap.')).toBeInTheDocument();
    const covered = within(card).getByRole('list', { name: 'Covered' });
    expect(within(covered).getAllByRole('listitem')).toHaveLength(2);
    const missed = within(card).getByRole('list', { name: 'Missed' });
    expect(within(missed).getByText('Watch for N+1 queries')).toBeInTheDocument();
    const keyPoints = within(card).getByRole('list', { name: 'Key points' });
    expect(within(keyPoints).getAllByRole('listitem')).toHaveLength(3);

    // And again: the previous answer is there to improve on.
    await user.click(within(card).getByRole('button', { name: 'Answer again' }));
    expect(within(card).getByLabelText('Your answer')).toHaveValue(
      'EXPLAIN ANALYZE, then an index.',
    );
    expect(await screen.findByText('1/2')).toBeInTheDocument();
  });

  it('explains when no AI can grade the answer', async () => {
    const user = userEvent.setup();
    const request = router((path) =>
      path.endsWith('/answer')
        ? problem(
            'ai-unavailable',
            503,
            'AI runs on your desktop. Open Offerpath on your computer.',
          )
        : prep(),
    );
    renderLearn(<PrepDetail prepId="p1" />, { request });

    const card = await screen.findByRole('group', { name: 'Question 1' });
    await user.click(within(card).getByRole('button', { name: 'Answer' }));
    await user.type(within(card).getByLabelText('Your answer'), 'My answer');
    await user.click(within(card).getByRole('button', { name: 'Submit answer' }));
    expect(await within(card).findByText(GRADING_UNAVAILABLE)).toBeInTheDocument();
  });

  it('shows progress while it is being written, and polls until it is ready', async () => {
    let calls = 0;
    const request = router((path) => {
      if (path === '/interview-preps/ai') return { source: 'openai' };
      calls += 1;
      return calls === 1 ? prep({ status: 'GENERATING', plan: null, questions: [] }) : prep();
    });
    renderLearn(<PrepDetail prepId="p1" />, { request });

    expect(await screen.findByText('Writing your plan and questions…')).toBeInTheDocument();
    expect(await screen.findByTestId('ai-source')).toHaveTextContent(AI_SOURCE_MESSAGE.openai);
    expect(await screen.findByText(/expect depth on both/, {}, { timeout: 10_000 })).toBeVisible();
  });

  it('shows why it failed and tries again', async () => {
    const user = userEvent.setup();
    const request = router((path, options) =>
      path === '/interview-preps/p1/regenerate' && options?.method === 'POST'
        ? prep({ status: 'GENERATING', plan: null, questions: [] })
        : path === '/interview-preps/ai'
          ? { source: 'desktop' }
          : prep({ status: 'FAILED', error: 'Your laptop is offline.', plan: null, questions: [] }),
    );
    renderLearn(<PrepDetail prepId="p1" />, { request });

    expect(await screen.findByText('Your laptop is offline.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Writing your plan and questions…')).toBeInTheDocument();
  });

  it('moves the interview to a new date and time', async () => {
    const user = userEvent.setup();
    const request = router((_path, options) =>
      options?.method === 'PATCH' ? prep({ scheduledAt: '2099-11-05T08:00:00Z' }) : prep(),
    );
    renderLearn(<PrepDetail prepId="p1" />, { request });

    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Interview date/), {
      target: { value: '2099-11-05' },
    });
    fireEvent.change(within(dialog).getByLabelText(/^Time/), { target: { value: '14:00' } });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const patch = request.mock.calls.find(([, o]) => o?.method === 'PATCH');
    expect(patch?.[0]).toBe('/interview-preps/p1');
    expect((patch?.[1]?.body as { scheduledAt: string }).scheduledAt).toMatch(
      /^2099-11-05T14:00:00[+-]\d{2}:\d{2}$/,
    );
  });

  it('deletes it and goes back to the list', async () => {
    const user = userEvent.setup();
    const request = router((_path, options) => (options?.method === 'DELETE' ? undefined : prep()));
    const { navigator } = renderLearn(<PrepDetail prepId="p1" />, { request });

    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(navigator.navigate).toHaveBeenCalledWith('/interview-prep', { replace: true }),
    );
    expect(request).toHaveBeenCalledWith('/interview-preps/p1', { method: 'DELETE' });
  });
});

describe('Today', () => {
  it('lists the preps in the next 14 days, each linking to its prep', async () => {
    const request = router(() => ({
      preps: [
        prep({ id: 'soon', company: 'Acme', scheduledAt: inDays(2) }),
        prep({ id: 'later', company: 'Initech', scheduledAt: inDays(30) }),
        prep({ id: 'past', company: 'Hooli', scheduledAt: inDays(-1) }),
      ],
    }));
    renderLearn(<UpcomingPreps />, { request });

    expect(await screen.findByRole('link', { name: 'Acme · Backend engineer' })).toHaveAttribute(
      'href',
      '#/interview-prep/soon',
    );
    expect(screen.queryByText(/Initech/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Hooli/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All preps' })).toHaveAttribute(
      'href',
      '#/interview-prep',
    );
  });
});
