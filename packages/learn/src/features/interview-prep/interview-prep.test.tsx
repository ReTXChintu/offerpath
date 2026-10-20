import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { problem, renderLearn, type RequestMock } from '../../__tests__/harness';
import type {
  MockInterviewView,
  MockReport,
  MockTurnView,
  PrepQuestionView,
  PrepView,
} from '../../lib/interview-prep';
import { countdown, localDateTimeToIso } from '../../lib/when';
import { UpcomingPreps } from './UpcomingPreps';
import { PrepCreate, validatePrepDraft, type PrepDraft } from './PrepCreate';
import { INTERVIEWER_UNAVAILABLE, MockInterviewPage } from './MockInterview';
import { PrepDetail } from './PrepDetail';
import { InterviewPrepList } from './PrepList';
import { GRADING_UNAVAILABLE } from './PrepQuestion';
import { AI_SOURCE_MESSAGE } from './shared';

// Monaco needs a real browser; a textarea stands in for it.
vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea aria-label="Code editor" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

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
    includeDsa: false,
    resume: null,
    mockInterviews: [],
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
  includeDsa: false,
  cv: { mode: 'none', text: '', fileName: null },
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

describe('the CV and DSA on the create form', () => {
  it('sends DSA and a pasted CV with the prep', async () => {
    const user = userEvent.setup();
    const request = router((path, options) => {
      if (path === '/interview-preps/ai') return { source: 'desktop' };
      if (path === '/interview-preps/cv/profile') return { text: null };
      if (path === '/interview-preps' && options?.method === 'POST') {
        return prep({ id: 'new2', status: 'GENERATING', plan: null, questions: [] });
      }
      return {};
    });
    const { navigator } = renderLearn(<PrepCreate />, { request });

    await user.type(screen.getByLabelText('Technologies'), 'Node.js{enter}');
    await user.click(screen.getByLabelText('Include DSA questions'));
    await user.click(screen.getByRole('radio', { name: /Paste text/ }));
    await user.type(screen.getByLabelText('CV text'), 'Five years of Node.js at Initech.');
    fireEvent.change(screen.getByLabelText(/^Interview date/), { target: { value: '2099-11-03' } });
    fireEvent.change(screen.getByLabelText(/^Time/), { target: { value: '09:15' } });
    await user.click(screen.getByRole('button', { name: 'Prepare' }));

    await waitFor(() =>
      expect(navigator.navigate).toHaveBeenCalledWith('/interview-prep/new2', { replace: true }),
    );
    const post = request.mock.calls.find(([p, o]) => p === '/interview-preps' && o?.method);
    expect(post?.[1]?.body).toMatchObject({
      technologies: ['Node.js'],
      includeDsa: true,
      resume: { text: 'Five years of Node.js at Initech.', source: 'pasted' },
    });
  });

  it('sends no CV by default, and offers the profile only when there is one', async () => {
    const user = userEvent.setup();
    const request = router((path, options) => {
      if (path === '/interview-preps/ai') return { source: 'desktop' };
      if (path === '/interview-preps/cv/profile') return { text: null };
      if (options?.method === 'POST') return prep({ id: 'new3' });
      return {};
    });
    renderLearn(<PrepCreate />, { request });

    const profile = await screen.findByRole('radio', { name: /Use my Offerpath profile/ });
    await waitFor(() => expect(profile).toBeDisabled());
    expect(screen.getByText(/Your Offerpath profile is empty/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /No CV/ })).toBeChecked();

    await user.type(screen.getByLabelText('Technologies'), 'Go{enter}');
    fireEvent.change(screen.getByLabelText(/^Interview date/), { target: { value: '2099-11-03' } });
    fireEvent.change(screen.getByLabelText(/^Time/), { target: { value: '09:15' } });
    await user.click(screen.getByRole('button', { name: 'Prepare' }));
    await waitFor(() =>
      expect(request.mock.calls.some(([, o]) => o?.method === 'POST')).toBe(true),
    );
    const post = request.mock.calls.find(([, o]) => o?.method === 'POST');
    expect(post?.[1]?.body).toMatchObject({ includeDsa: false, resume: null });
  });

  it('uses the profile CV when there is one', async () => {
    const user = userEvent.setup();
    const request = router((path) =>
      path === '/interview-preps/cv/profile'
        ? { text: 'Jane Doe. Backend engineer.' }
        : { source: 'desktop' },
    );
    renderLearn(<PrepCreate />, { request });

    const profile = await screen.findByRole('radio', { name: /Use my Offerpath profile/ });
    await waitFor(() => expect(profile).toBeEnabled());
    await user.click(profile);
    expect(screen.getByLabelText('CV text')).toHaveValue('Jane Doe. Backend engineer.');
  });

  it('reads an uploaded CV file and shows its text to check', async () => {
    const user = userEvent.setup();
    const request = router((path) => {
      if (path === '/interview-preps/cv/extract') {
        return { text: 'Extracted: Jane Doe', fileName: 'cv.txt', chars: 19 };
      }
      if (path === '/interview-preps/cv/profile') return { text: null };
      return { source: 'desktop' };
    });
    renderLearn(<PrepCreate />, { request });

    await user.click(screen.getByRole('radio', { name: /Upload a file/ }));
    await user.upload(
      screen.getByLabelText('CV file'),
      new File(['hello'], 'cv.txt', { type: 'text/plain' }),
    );

    expect(await screen.findByLabelText('CV text')).toHaveValue('Extracted: Jane Doe');
    expect(request).toHaveBeenCalledWith('/interview-preps/cv/extract', {
      method: 'POST',
      body: { fileName: 'cv.txt', contentBase64: btoa('hello') },
    });
    expect(screen.getByText('cv.txt')).toBeInTheDocument();
  });

  it('refuses a file that is not a CV format', async () => {
    const user = userEvent.setup({ applyAccept: false });
    const request = router(() => ({ source: 'desktop' }));
    renderLearn(<PrepCreate />, { request });

    await user.click(screen.getByRole('radio', { name: /Upload a file/ }));
    await user.upload(screen.getByLabelText('CV file'), new File(['x'], 'cv.png'));
    expect(await screen.findByText(/That file type is not supported/)).toBeInTheDocument();
    expect(request.mock.calls.some(([p]) => p === '/interview-preps/cv/extract')).toBe(false);
  });
});

describe('editing a prep', () => {
  it('asks before a change that rewrites the plan, then sends it', async () => {
    const user = userEvent.setup();
    const request = router((path, options) => {
      if (options?.method === 'PATCH') return prep({ status: 'GENERATING', plan: null });
      if (path === '/interview-preps/cv/profile') return { text: null };
      if (path === '/interview-preps/ai') return { source: 'desktop' };
      return prep({
        includeDsa: false,
        resume: { source: 'pasted', fileName: null, chars: 9, text: 'My old CV' },
      });
    });
    renderLearn(<PrepDetail prepId="p1" />, { request });

    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit the interview' });
    // Prefilled with what the prep has.
    expect(within(dialog).getByLabelText('Company')).toHaveValue('Acme');
    expect(within(dialog).getByLabelText('CV text')).toHaveValue('My old CV');
    await user.click(within(dialog).getByLabelText('Include DSA questions'));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    const confirm = await screen.findByRole('dialog', { name: 'Rewrite the plan and questions?' });
    expect(
      within(confirm).getByText(/practice answers on the current questions are lost/),
    ).toBeVisible();
    expect(request.mock.calls.some(([, o]) => o?.method === 'PATCH')).toBe(false);
    await user.click(within(confirm).getByRole('button', { name: 'Save and rewrite' }));

    await waitFor(() =>
      expect(request.mock.calls.some(([, o]) => o?.method === 'PATCH')).toBe(true),
    );
    const body = request.mock.calls.find(([, o]) => o?.method === 'PATCH')?.[1]?.body as Record<
      string,
      unknown
    >;
    expect(body).toMatchObject({ company: 'Acme', includeDsa: true });
    // Unchanged fields that would rewrite the plan are left out.
    expect(body).not.toHaveProperty('jobDescription');
    expect(body).not.toHaveProperty('resume');
  });
});

// -- Mock interviews -------------------------------------------------------------

function turn(over: Partial<MockTurnView> = {}): MockTurnView {
  return {
    id: 't0',
    order: 0,
    speaker: 'INTERVIEWER',
    stage: 'INTRO',
    kind: 'OPENING',
    text: 'Tell me about yourself.',
    code: null,
    codeLanguage: null,
    problem: null,
    language: null,
    assessment: null,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

function mock(over: Partial<MockInterviewView> = {}): MockInterviewView {
  return {
    id: 'm1',
    prepId: 'p1',
    status: 'IN_PROGRESS',
    stage: 'INTRO',
    stages: ['INTRO', 'TECHNICAL', 'CODING', 'WRAP_UP'],
    awaitingReply: false,
    replying: false,
    aiSource: 'desktop',
    turns: [turn()],
    answered: 0,
    report: null,
    overallScore: null,
    error: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    ...over,
  };
}

const ANSWER = turn({
  id: 't1',
  order: 1,
  speaker: 'CANDIDATE',
  kind: 'ANSWER',
  text: 'I has worked on payment APIs for four years.',
});

const FOLLOW_UP = turn({
  id: 't2',
  order: 2,
  kind: 'FOLLOW_UP',
  text: 'Which of those APIs are you proudest of?',
});

/** Routes the prep, the AI source and the interview; `extra` answers the rest. */
function mockRouter(get: () => MockInterviewView, extra: Route = () => undefined) {
  return router((path, options) => {
    const out = extra(path, options);
    if (out !== undefined) return out;
    if (path === '/interview-preps/ai') return { source: 'desktop' };
    if (path === '/interview-preps/p1') return prep();
    if (path === '/mock-interviews/m1') return get();
    return {};
  });
}

describe('a mock interview', () => {
  it('shows the conversation: turns, language corrections and the coding problem', async () => {
    const view = mock({
      stage: 'CODING',
      answered: 2,
      turns: [
        turn(),
        {
          ...ANSWER,
          language: {
            ok: false,
            corrections: [
              {
                original: 'I has worked',
                corrected: 'I have worked',
                note: 'Use "have" with "I".',
              },
            ],
          },
        },
        { ...FOLLOW_UP, stage: 'TECHNICAL' },
        turn({
          id: 't3',
          order: 3,
          speaker: 'CANDIDATE',
          kind: 'ANSWER',
          stage: 'TECHNICAL',
          text: 'The refunds service.',
          language: { ok: true, corrections: [] },
        }),
        turn({
          id: 't4',
          order: 4,
          kind: 'CODING',
          stage: 'CODING',
          text: "Let's write some code.",
          problem: {
            title: 'Two sum',
            statement: 'Return the indices of the two numbers that add up to the target.',
            examples: [{ input: '[2,7,11,15], 9', output: '[0,1]', explanation: '2 + 7 = 9' }],
            constraints: ['2 <= n <= 10^4'],
          },
        }),
      ],
    });
    renderLearn(<MockInterviewPage interviewId="m1" />, { request: mockRouter(() => view) });

    expect(await screen.findByText('Tell me about yourself.')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Acme · Backend engineer' })).toBeVisible();
    expect(screen.getByText("Interviewer: your laptop's Claude")).toBeInTheDocument();

    const fixes = screen.getByRole('list', { name: 'Language corrections' });
    expect(within(fixes).getByText('I has worked')).toBeInTheDocument();
    expect(within(fixes).getByText('I have worked')).toBeInTheDocument();
    expect(within(fixes).getByText('Use "have" with "I".')).toBeInTheDocument();
    expect(screen.getByText('Language looks good')).toBeInTheDocument();

    const problemCard = screen.getByRole('region', { name: 'Coding problem: Two sum' });
    expect(within(problemCard).getByText(/indices of the two numbers/)).toBeInTheDocument();
    expect(within(problemCard).getByText('[0,1]')).toBeInTheDocument();
    expect(within(problemCard).getByText('2 <= n <= 10^4')).toBeInTheDocument();

    const stages = screen.getByRole('list', { name: 'Interview stages' });
    expect(within(stages).getByText('Coding').closest('li')).toHaveAttribute(
      'aria-current',
      'step',
    );
    // A coding question opens the editor, in a language from the prep's technologies.
    expect(screen.getByLabelText('Code editor')).toBeInTheDocument();
    expect(screen.getByLabelText('Code language')).toHaveValue('javascript');
  });

  it('sends an answer and shows the reply', async () => {
    const user = userEvent.setup();
    let answered = false;
    const after = mock({ turns: [turn(), ANSWER, FOLLOW_UP], answered: 1 });
    const request = mockRouter(
      () => (answered ? after : mock()),
      (path) => {
        if (path === '/mock-interviews/m1/answer') {
          answered = true;
          return after;
        }
        return undefined;
      },
    );
    renderLearn(<MockInterviewPage interviewId="m1" />, { request });

    const box = await screen.findByLabelText('Your answer');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await user.type(box, 'I has worked on payment APIs for four years.');
    await user.keyboard('{Control>}{Enter}{/Control}');

    expect(await screen.findByText('Which of those APIs are you proudest of?')).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith('/mock-interviews/m1/answer', {
      method: 'POST',
      body: {
        text: 'I has worked on payment APIs for four years.',
        code: null,
        codeLanguage: null,
      },
    });
    expect(screen.getByLabelText('Your answer')).toHaveValue('');
  });

  it('sends code with a coding answer', async () => {
    const user = userEvent.setup();
    const coding = mock({
      stage: 'CODING',
      turns: [
        turn({
          id: 't4',
          order: 4,
          kind: 'CODING',
          stage: 'CODING',
          text: 'Over to you.',
          problem: { title: 'Two sum', statement: 'Find them.', examples: [], constraints: [] },
        }),
      ],
    });
    const request = mockRouter(
      () => coding,
      (path) => (path === '/mock-interviews/m1/answer' ? coding : undefined),
    );
    renderLearn(<MockInterviewPage interviewId="m1" />, { request });

    await user.selectOptions(await screen.findByLabelText('Code language'), 'python');
    fireEvent.change(screen.getByLabelText('Code editor'), {
      target: { value: 'def two_sum(nums, target):\n    pass' },
    });
    await user.type(screen.getByLabelText('Your answer'), 'A hash map, one pass.');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('/mock-interviews/m1/answer', {
        method: 'POST',
        body: {
          text: 'A hash map, one pass.',
          code: 'def two_sum(nums, target):\n    pass',
          codeLanguage: 'python',
        },
      }),
    );
  });

  it('keeps the answer when no AI can reply, and retries the reply', async () => {
    const user = userEvent.setup();
    let stage: 'start' | 'saved' | 'replied' = 'start';
    const saved = mock({ turns: [turn(), ANSWER], answered: 1, awaitingReply: true });
    const replied = mock({ turns: [turn(), ANSWER, FOLLOW_UP], answered: 1 });
    const request = mockRouter(
      () => (stage === 'start' ? mock() : stage === 'saved' ? saved : replied),
      (path) => {
        if (path === '/mock-interviews/m1/answer') {
          stage = 'saved';
          return problem(
            'ai-unavailable',
            503,
            'AI runs on your desktop. Open Offerpath on your computer.',
          );
        }
        if (path === '/mock-interviews/m1/reply') {
          stage = 'replied';
          return replied;
        }
        return undefined;
      },
    );
    renderLearn(<MockInterviewPage interviewId="m1" />, { request });

    await user.type(
      await screen.findByLabelText('Your answer'),
      'I has worked on payment APIs for four years.',
    );
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('The interviewer did not reply')).toBeInTheDocument();
    expect(screen.getByText(INTERVIEWER_UNAVAILABLE)).toBeInTheDocument();
    // The answer was saved: it is in the transcript, and the box waits for the reply.
    expect(screen.getByText('I has worked on payment APIs for four years.')).toBeInTheDocument();
    expect(screen.getByLabelText('Your answer')).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Which of those APIs are you proudest of?')).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith('/mock-interviews/m1/reply', { method: 'POST' });
    expect(screen.queryByText('The interviewer did not reply')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Your answer')).toBeEnabled();
  });

  it('ends the interview after asking, then waits for the report', async () => {
    const user = userEvent.setup();
    const request = mockRouter(
      () => mock(),
      (path) =>
        path === '/mock-interviews/m1/finish'
          ? mock({ status: 'REPORTING', endedAt: new Date().toISOString() })
          : undefined,
    );
    renderLearn(<MockInterviewPage interviewId="m1" />, { request });

    await user.click(await screen.findByRole('button', { name: 'End interview' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'End interview' }));
    expect(await screen.findByText('Writing your report…')).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith('/mock-interviews/m1/finish', { method: 'POST' });
    expect(screen.queryByLabelText('Your answer')).not.toBeInTheDocument();
  });

  it('shows why the report failed and writes it again', async () => {
    const user = userEvent.setup();
    const request = mockRouter(
      () => mock({ status: 'FAILED', error: 'The report timed out.' }),
      (path) => (path === '/mock-interviews/m1/report' ? mock({ status: 'REPORTING' }) : undefined),
    );
    renderLearn(<MockInterviewPage interviewId="m1" />, { request });

    expect(await screen.findByText('The report timed out.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Writing your report…')).toBeInTheDocument();
  });

  it('shows the report: score, verdict, dimensions and each question with a stronger answer', async () => {
    const user = userEvent.setup();
    const report: MockReport = {
      overallScore: 6.5,
      verdict: 'LEAN_HIRE',
      summary: 'Solid basics; go deeper on databases.',
      dimensions: [
        { name: 'COMMUNICATION', score: 7, comment: 'Clear and calm.' },
        { name: 'TECHNICAL_DEPTH', score: 5, comment: 'Stayed on the surface.' },
      ],
      questions: [
        {
          turnOrder: 0,
          question: 'Introduce yourself',
          answerSummary: 'Four years on payment APIs.',
          score: 5,
          wentWell: 'Named your stack.',
          couldBeBetter: 'Give one concrete project.',
          strongerAnswer: 'I have spent four years building payment APIs at Initech.',
        },
      ],
      language: { score: 8, patterns: ['Subject-verb agreement'], note: 'Mostly fluent.' },
      strengths: ['Clear structure'],
      improvements: ['Depth on databases'],
      nextSteps: ['Practise indexing questions'],
    };
    const done = mock({
      status: 'COMPLETED',
      stage: 'WRAP_UP',
      answered: 1,
      overallScore: 6.5,
      endedAt: new Date().toISOString(),
      turns: [
        turn(),
        {
          ...ANSWER,
          assessment: { verdict: 'PARTIAL', note: 'Too general.' },
          language: { ok: true, corrections: [] },
        },
      ],
      report,
    });
    const request = mockRouter(
      () => done,
      (path, options) =>
        path === '/interview-preps/p1/mock-interviews' && options?.method === 'POST'
          ? mock({ id: 'm2' })
          : undefined,
    );
    const { navigator } = renderLearn(<MockInterviewPage interviewId="m1" />, { request });

    expect(await screen.findByLabelText('Overall score 6.5/10')).toBeInTheDocument();
    expect(screen.getByText('Lean hire')).toBeInTheDocument();
    expect(screen.getByText('Solid basics; go deeper on databases.')).toBeInTheDocument();
    const dims = screen.getByRole('list', { name: 'Scores by dimension' });
    expect(within(dims).getByText('Communication')).toBeInTheDocument();
    expect(within(dims).getByText('Stayed on the surface.')).toBeInTheDocument();
    expect(screen.getByText('Depth on databases')).toBeInTheDocument();
    expect(screen.getByText('Practise indexing questions')).toBeInTheDocument();
    expect(screen.getByText('Subject-verb agreement')).toBeInTheDocument();

    const q1 = screen.getByRole('group', { name: 'Question 1' });
    expect(within(q1).getByText('Tell me about yourself.')).toBeInTheDocument();
    expect(
      within(q1).getByText('I has worked on payment APIs for four years.'),
    ).toBeInTheDocument();
    expect(within(q1).getByText('Partly right')).toBeInTheDocument();
    expect(within(q1).getByText('Too general.')).toBeInTheDocument();
    expect(within(q1).getByText('Score 5/10')).toBeInTheDocument();
    expect(within(q1).getByText('Named your stack.')).toBeInTheDocument();
    expect(within(q1).getByText('Give one concrete project.')).toBeInTheDocument();
    expect(within(q1).getByText('A stronger answer')).toBeInTheDocument();
    expect(
      within(q1).getByText('I have spent four years building payment APIs at Initech.'),
    ).toBeInTheDocument();

    // The full transcript is a tab away.
    await user.click(screen.getByRole('tab', { name: 'Transcript' }));
    expect(screen.getByRole('list', { name: 'Transcript' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Question 1' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Start a new mock interview' }));
    await waitFor(() =>
      expect(navigator.navigate).toHaveBeenCalledWith('/mock-interview/m2', undefined),
    );
    expect(request).toHaveBeenCalledWith('/interview-preps/p1/mock-interviews', {
      method: 'POST',
      body: { restart: true },
    });
  });
});

describe('mock interviews on a prep', () => {
  it('starts one and opens it', async () => {
    const user = userEvent.setup();
    const request = router((path, options) =>
      path === '/interview-preps/p1/mock-interviews' && options?.method === 'POST'
        ? mock({ id: 'm9' })
        : prep(),
    );
    const { navigator } = renderLearn(<PrepDetail prepId="p1" />, { request });

    await user.click(await screen.findByRole('button', { name: 'Start mock interview' }));
    await waitFor(() =>
      expect(navigator.navigate).toHaveBeenCalledWith('/mock-interview/m9', undefined),
    );
    expect(request).toHaveBeenCalledWith('/interview-preps/p1/mock-interviews', {
      method: 'POST',
      body: {},
    });
  });

  it('continues the one in progress and lists past ones with their scores', async () => {
    const user = userEvent.setup();
    const at = new Date().toISOString();
    const request = router(() =>
      prep({
        mockInterviews: [
          {
            id: 'm3',
            status: 'IN_PROGRESS',
            stage: 'TECHNICAL',
            overallScore: null,
            verdict: null,
            answered: 3,
            startedAt: at,
            endedAt: null,
          },
          {
            id: 'm2',
            status: 'COMPLETED',
            stage: 'WRAP_UP',
            overallScore: 7.5,
            verdict: 'HIRE',
            answered: 12,
            startedAt: at,
            endedAt: at,
          },
        ],
      }),
    );
    const { navigator } = renderLearn(<PrepDetail prepId="p1" />, { request });

    const list = await screen.findByRole('list', { name: 'Past mock interviews' });
    const links = within(list).getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '#/mock-interview/m3',
      '#/mock-interview/m2',
    ]);
    expect(within(links[1]!).getByText('7.5/10')).toBeInTheDocument();
    expect(within(links[1]!).getByText('Hire')).toBeInTheDocument();
    expect(within(links[0]!).getByText('In progress')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Continue mock interview' }));
    expect(navigator.navigate).toHaveBeenCalledWith('/mock-interview/m3', undefined);
    expect(request.mock.calls.some(([, o]) => o?.method === 'POST')).toBe(false);
  });
});
