import { ApplicationReviewPage, ApplicationsPage, JobDetailPage, JobsPage } from '@offerpath/hunt';
import {
  ChallengeWorkspace,
  ConceptView,
  ExerciseWorkspace,
  InterviewGuide,
  InterviewPrepList,
  InterviewSession,
  Onboarding,
  PracticePage,
  PrepCreate,
  PrepDetail,
  ProjectWorkspace,
  RecallPage,
  RoadmapPage,
  Technologies,
  TechnologyView,
  TodayPage,
} from '@offerpath/learn';
import {
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useParams,
  type RouterHistory,
} from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { NeedsYouPage } from './pages/NeedsYou';
import { WebProgress } from './pages/Progress';
import { SettingsPage } from './pages/Settings';
import { Shell } from './shell/Shell';

const rootRoute = createRootRoute({ component: Shell });

const page = (path: string, component: () => ReactNode) =>
  createRoute({ getParentRoute: () => rootRoute, path, component });

/** A page that takes one route param as a prop of the same name. */
function withParam(name: string, render: (value: string) => ReactNode) {
  return function ParamRoute() {
    const params = useParams({ strict: false }) as Record<string, string | undefined>;
    return <>{render(params[name] ?? '')}</>;
  };
}

const routeTree = rootRoute.addChildren([
  page('/', () => <TodayPage />),
  // The learning side: the same @offerpath/learn pages as the desktop.
  page('/roadmap', RoadmapPage),
  page('/learn', Technologies),
  page(
    '/learn/$technologyId',
    withParam('technologyId', (id) => <TechnologyView technologyId={id} />),
  ),
  page(
    '/concept/$conceptId',
    withParam('conceptId', (id) => <ConceptView key={id} conceptId={id} />),
  ),
  page('/practice', PracticePage),
  page(
    '/exercise/$exerciseId',
    withParam('exerciseId', (id) => <ExerciseWorkspace key={id} exerciseId={id} />),
  ),
  page(
    '/project/$exerciseId',
    withParam('exerciseId', (id) => <ProjectWorkspace key={id} exerciseId={id} />),
  ),
  page(
    '/challenge/$exerciseId',
    withParam('exerciseId', (id) => <ChallengeWorkspace key={id} exerciseId={id} />),
  ),
  page('/recall', RecallPage),
  page('/interviews', InterviewGuide),
  page(
    '/interviews/$interviewId',
    withParam('interviewId', (id) => <InterviewSession key={id} interviewId={id} />),
  ),
  page('/interview-prep', InterviewPrepList),
  page('/interview-prep/new', PrepCreate),
  page(
    '/interview-prep/$prepId',
    withParam('prepId', (id) => <PrepDetail key={id} prepId={id} />),
  ),
  page('/progress', WebProgress),
  page('/onboarding', Onboarding),
  // The hunt, as a remote control for the desktop.
  page('/hunt', NeedsYouPage),
  page('/applications', ApplicationsPage),
  page(
    '/applications/$applicationId',
    withParam('applicationId', (id) => <ApplicationReviewPage key={id} applicationId={id} />),
  ),
  page('/jobs', JobsPage),
  page(
    '/jobs/$jobId',
    withParam('jobId', (id) => <JobDetailPage key={id} jobId={id} />),
  ),
  page('/settings', SettingsPage),
]);

export function createAppRouter(history: RouterHistory = createBrowserHistory()) {
  return createRouter({ routeTree, history, defaultPreload: 'intent' });
}

export type AppRouter = ReturnType<typeof createAppRouter>;
