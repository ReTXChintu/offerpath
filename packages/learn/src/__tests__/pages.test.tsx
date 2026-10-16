import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AI_OFFLINE_MESSAGE } from '../components/AiOffline';
import { ConceptExplainer } from '../features/concepts/ConceptExplainer';
import { ExerciseWorkspace } from '../features/exercise/ExerciseWorkspace';
import { RecallPage } from '../features/recall/RecallPage';
import { LearningSettings } from '../features/settings/Settings';
import { DesktopOfflineStrip } from '../features/today/DesktopOfflineStrip';
import { TodayPage } from '../features/today/TodayPage';
import type { TodayPlanView } from '../lib/plan';

import { problem, renderLearn, type RequestMock } from './harness';

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

const ROUTINE = {
  id: 'r1',
  date: '2026-10-16T00:00:00.000Z',
  totalMinutes: 45,
  completedMinutes: 15,
  recallDue: 2,
  carriedCount: 0,
  items: [
    {
      id: 'i1',
      kind: 'LEARN',
      status: 'DONE',
      minutes: 15,
      title: 'Closures',
      rationale: 'Next on your roadmap',
      conceptId: 'c1',
      exerciseId: null,
      questionCount: 0,
      carriedFrom: null,
    },
    {
      id: 'i2',
      kind: 'INTERVIEW',
      status: 'PENDING',
      minutes: 30,
      title: 'Mock interview',
      rationale: 'Interview in 5 days',
      conceptId: null,
      exerciseId: null,
      questionCount: 0,
      carriedFrom: null,
    },
  ],
};

const PLAN: TodayPlanView = {
  date: '2026-10-16',
  startedAt: null,
  streak: 4,
  goal: {
    targetRoles: ['Frontend engineer'],
    targetCompanies: ['Acme'],
    locations: ['Remote'],
    targetDate: '2026-12-31',
    daysLeft: 76,
  },
  learning: ROUTINE,
  hunt: {
    todos: [
      {
        applicationId: 'a1',
        company: 'Acme',
        title: 'Frontend engineer',
        action: 'APPROVE',
        questions: 0,
      },
      {
        applicationId: 'a2',
        company: 'Globex',
        title: 'React developer',
        action: 'ANSWER',
        questions: 3,
      },
    ],
    approvals: 1,
    questions: 1,
  },
  interviews: [
    {
      interview: { round: 'Technical round', scheduledAt: '2026-10-21T10:00:00Z' },
      applicationId: 'a3',
      company: 'Initech',
      title: 'Full-stack engineer',
      daysLeft: 5,
      technologies: [
        { id: 't-react', name: 'React', onRoadmap: true },
        { id: 't-next', name: 'Next.js', onRoadmap: false },
      ],
    },
  ],
  skillGaps: [
    {
      skill: 'Next.js',
      jobs: 12,
      technology: { id: 't-next', name: 'Next.js', slug: 'nextjs' },
      onRoadmap: false,
    },
    { skill: 'GraphQL', jobs: 4, technology: null, onRoadmap: false },
  ],
  desktopOnline: true,
};

describe('Today', () => {
  function todayRoutes(overrides: Partial<TodayPlanView> = {}) {
    return router((path, options) => {
      if (path === '/today') return { ...PLAN, ...overrides };
      if (path === '/today/start')
        return { ...PLAN, ...overrides, startedAt: '2026-10-16T07:00:00Z' };
      if (path === '/goal/skill-gaps/add') return undefined;
      if (path === '/recall/due') return [];
      if (path === '/interviews' && options?.method === 'POST') {
        return {
          id: 'iv1',
          mode: 'TECHNICAL',
          targetLevel: 'MID',
          status: 'IN_PROGRESS',
          turns: [],
        };
      }
      return null;
    });
  }

  it('shows the goal, the routine, the hunt to-dos, interviews ahead and skill gaps', async () => {
    renderLearn(<TodayPage />, { request: todayRoutes() });

    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument();
    // Goal with days left, and the streak.
    const goal = screen.getByRole('heading', { name: 'Your goal' }).closest('section')!;
    expect(within(goal).getByText('Frontend engineer')).toBeInTheDocument();
    expect(screen.getByText('76')).toBeInTheDocument();
    expect(screen.getByText('4 days')).toBeInTheDocument();
    // The learning routine.
    expect(screen.getByText('15 of 45 minutes · 2 due for review')).toBeInTheDocument();
    expect(screen.getByText('Mock interview')).toBeInTheDocument();
    // Hunt to-dos.
    expect(screen.getByText('Acme · Ready to approve')).toBeInTheDocument();
    expect(screen.getByText('Globex · Questions to answer (3)')).toBeInTheDocument();
    // Interviews ahead, with what to practise.
    expect(screen.getByText('Initech · Full-stack engineer')).toBeInTheDocument();
    expect(screen.getByText('Technical round · in 5 days')).toBeInTheDocument();
    // Skill gaps.
    expect(screen.getByText('12 jobs')).toBeInTheDocument();
    expect(screen.getByText('4 jobs · not in the catalogue yet')).toBeInTheDocument();
  });

  it('starts the day', async () => {
    const user = userEvent.setup();
    const { request } = renderLearn(<TodayPage />, { request: todayRoutes() });
    await user.click(await screen.findByRole('button', { name: 'Start my day' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('/today/start', { method: 'POST' }));
    expect(await screen.findByText('Day started')).toBeInTheDocument();
  });

  it('puts a skill gap on the roadmap', async () => {
    const user = userEvent.setup();
    const { request } = renderLearn(<TodayPage />, { request: todayRoutes() });
    await user.click(await screen.findByRole('button', { name: 'Add to roadmap' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('/goal/skill-gaps/add', {
        method: 'POST',
        body: { technologyId: 't-next' },
      }),
    );
  });

  it('opens an application from a hunt to-do and starts a mock interview for a call', async () => {
    const user = userEvent.setup();
    const { navigator } = renderLearn(<TodayPage />, { request: todayRoutes() });
    await user.click(await screen.findByRole('button', { name: 'Review' }));
    expect(navigator.navigate).toHaveBeenCalledWith('/applications/a1', undefined);

    await user.click(screen.getByRole('button', { name: 'Start a mock interview' }));
    await waitFor(() =>
      expect(navigator.navigate).toHaveBeenCalledWith('/interviews/iv1', undefined),
    );
  });

  it('shows the desktop slot and says when the hunt waits for the desktop', async () => {
    renderLearn(<TodayPage agent={<div>Agent is idle</div>} />, {
      request: todayRoutes({ desktopOnline: false }),
    });
    expect(await screen.findByText('Agent is idle')).toBeInTheDocument();
    expect(screen.getByText(/Your desktop is offline: the hunt waits for it/)).toBeInTheDocument();
  });
});

describe('learning settings', () => {
  const SETTINGS = {
    models: { fast: 'haiku', reasoning: 'opus', tutor: null },
    options: [
      { id: 'haiku', label: 'Claude Haiku' },
      { id: 'sonnet', label: 'Claude Sonnet' },
      { id: 'opus', label: 'Claude Opus' },
    ],
    desktop: { online: false, claudeAvailable: false, detail: null, version: null },
  };

  it('chooses Claude models per kind of work, with no vendors or keys', async () => {
    const user = userEvent.setup();
    const request = router((_path, options) =>
      options?.method === 'PUT'
        ? { ...SETTINGS, models: { ...SETTINGS.models, ...(options.body as object) } }
        : SETTINGS,
    );
    renderLearn(<LearningSettings />, { request });

    expect(await screen.findByText('Desktop offline')).toBeInTheDocument();
    expect(screen.getByText(AI_OFFLINE_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText(/api key|openai|gemini|vendor/i)).toBeNull();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Quick work' }), 'sonnet');
    await user.click(screen.getByRole('button', { name: 'Save models' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('/settings/ai', {
        method: 'PUT',
        body: { fast: 'sonnet', reasoning: 'opus', tutor: null },
      }),
    );
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });
});

describe('offline desktop', () => {
  it('shows the strip only when the desktop is offline', async () => {
    renderLearn(<DesktopOfflineStrip />, {
      request: router(() => ({ online: false, desktop: null })),
    });
    expect(await screen.findByText(AI_OFFLINE_MESSAGE)).toBeInTheDocument();
  });

  it('says nothing when the desktop is online', async () => {
    const { request } = renderLearn(<DesktopOfflineStrip />, {
      request: router(() => ({ online: true, desktop: { version: '0.1.0' } })),
    });
    await waitFor(() => expect(request).toHaveBeenCalled());
    expect(screen.queryByText(AI_OFFLINE_MESSAGE)).toBeNull();
  });

  it('explains an explainer that waits for the desktop, and offers to try again', async () => {
    renderLearn(
      <ConceptExplainer
        conceptId="c1"
        concept={{ name: 'Closures', description: 'Functions and scope.', commonMistakes: [] }}
      />,
      { request: router(() => problem('ai-unavailable', 503, 'No desktop is connected.')) },
    );
    expect(await screen.findByText(AI_OFFLINE_MESSAGE)).toBeInTheDocument();
    expect(screen.getByText('Functions and scope.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('runs recall with no AI at all', async () => {
    const user = userEvent.setup();
    const request = router((path) => {
      if (path === '/recall/due') {
        return [
          {
            id: 'q1',
            conceptId: 'c1',
            conceptName: 'Closures',
            technologyName: 'JavaScript',
            prompt: 'What does a closure keep?',
            options: ['A copy of the values', 'A reference to its scope'],
          },
        ];
      }
      if (path === '/recall/answer') {
        return {
          correct: true,
          correctIndex: 1,
          explanation: 'It keeps the scope itself.',
          nextDueAt: '2026-10-20T00:00:00Z',
        };
      }
      return null;
    });
    renderLearn(<RecallPage />, { request });
    await user.click(await screen.findByRole('button', { name: 'A reference to its scope' }));
    expect(await screen.findByText('It keeps the scope itself.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Reviews done')).toBeInTheDocument();
    expect(screen.getByText(/1 of 1 right/)).toBeInTheDocument();
  });
});

describe('the exercise workspace', () => {
  const EXERCISE = {
    id: 'e1',
    conceptId: 'c1',
    slug: 'sum',
    title: 'Sum an array',
    kind: 'CODE',
    difficulty: 1,
    language: 'javascript',
    assistanceLevel: 2,
    objective: 'Return the sum of the numbers.',
    requirements: null,
    functionSignature: 'function sum(xs)',
    starterCode: 'function sum(xs) {\n}\n',
    examples: [],
    visibleTestNames: ['sums'],
    estimatedMinutes: 10,
    aiAssistanceEnabled: true,
    brokenCode: null,
    requiresDiagnosis: false,
  };

  function routes(hint: () => unknown) {
    return router((path, options) => {
      if (path === '/exercises/e1') return EXERCISE;
      if (path === '/exercises/e1/attempts') {
        return {
          attemptId: 'at1',
          exercise: EXERCISE,
          openedAt: '2026-10-16T08:00:00Z',
          draftCode: null,
          draftSavedAt: null,
          solvedAt: null,
        };
      }
      if (path === '/ai/hint') return hint();
      if (path === '/sessions' && options?.method === 'POST') return { id: 's1', durationMs: 0 };
      return undefined;
    });
  }

  it('keeps the editor working and explains hints that wait for the desktop', async () => {
    const user = userEvent.setup();
    renderLearn(<ExerciseWorkspace exerciseId="e1" />, {
      request: routes(() => problem('ai-unavailable', 503)),
    });
    await user.click(await screen.findByRole('button', { name: 'Start' }));
    const editor = await screen.findByRole('textbox', { name: 'Code editor' });
    await waitFor(() => expect(editor).toHaveValue('function sum(xs) {\n}\n'));

    fireEvent.click(screen.getByText('Small hint'));
    expect(await screen.findByText(AI_OFFLINE_MESSAGE)).toBeInTheDocument();
    // Not presented as the assistance gate.
    expect(screen.queryByText('Show it anyway')).toBeNull();
  });

  it('shows a hint as plain text, never as a code block', async () => {
    const user = userEvent.setup();
    renderLearn(<ExerciseWorkspace exerciseId="e1" />, {
      request: routes(() => ({
        hint: { response: 'Which value does the loop start from?' },
        intervention: null,
      })),
    });
    await user.click(await screen.findByRole('button', { name: 'Start' }));
    fireEvent.click(await screen.findByText('Small hint'));
    const hint = await screen.findByText('Which value does the loop start from?');
    expect(hint.closest('.card')!.querySelector('pre, code, .code-block')).toBeNull();
  });
});
