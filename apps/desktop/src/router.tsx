import {
  AboutPage,
  AgentPage,
  ApplicationsPage,
  CandidatePage,
  DashboardPage,
  JobSitesPage,
  JobsPage,
  ResumesPage,
} from '@offerpath/hunt';
import {
  InterviewGuide,
  InterviewPrepList,
  Onboarding,
  PracticePage,
  PrepCreate,
  RecallPage,
  RoadmapPage,
  Technologies,
} from '@offerpath/learn';
import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
} from '@tanstack/react-router';
import type { ComponentType, ReactNode } from 'react';

import {
  ChallengeRoute,
  ConceptRoute,
  DesktopProgress,
  ExerciseRoute,
  InterviewPrepRoute,
  InterviewRoute,
  MockInterviewRoute,
  ProjectRoute,
  RequireAccount,
  TechnologyRoute,
} from './learn';
import { DesktopToday } from './pages/Today';
import { ApplicationReviewRoute, JobDetailRoute, SettingsRoute, SetupRoute } from './routes';
import { Shell } from './shell/Shell';

const rootRoute = createRootRoute({ component: Shell });

const page = (path: string, component: () => ReactNode) =>
  createRoute({ getParentRoute: () => rootRoute, path, component });

/** A learning page: it needs this desktop signed in to an account. */
const learn = (path: string, Component: ComponentType) =>
  page(path, () => (
    <RequireAccount>
      <Component />
    </RequireAccount>
  ));

const routeTree = rootRoute.addChildren([
  page('/', DesktopToday),
  // Grow and Progress: @offerpath/learn's pages over the desktop's API client.
  learn('/roadmap', RoadmapPage),
  learn('/learn', Technologies),
  learn('/learn/$technologyId', TechnologyRoute),
  learn('/concept/$conceptId', ConceptRoute),
  learn('/practice', PracticePage),
  learn('/exercise/$exerciseId', ExerciseRoute),
  learn('/project/$exerciseId', ProjectRoute),
  learn('/challenge/$exerciseId', ChallengeRoute),
  learn('/recall', RecallPage),
  learn('/interviews', InterviewGuide),
  learn('/interviews/$interviewId', InterviewRoute),
  learn('/interview-prep', InterviewPrepList),
  learn('/interview-prep/new', PrepCreate),
  learn('/interview-prep/$prepId', InterviewPrepRoute),
  learn('/mock-interview/$interviewId', MockInterviewRoute),
  learn('/progress', DesktopProgress),
  learn('/onboarding', Onboarding),
  // Hunt: @offerpath/hunt's pages over the Tauri client.
  page('/hunt', DashboardPage),
  page('/jobs', JobsPage),
  createRoute({ getParentRoute: () => rootRoute, path: '/jobs/$jobId', component: JobDetailRoute }),
  page('/applications', ApplicationsPage),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/applications/$applicationId',
    component: ApplicationReviewRoute,
  }),
  page('/job-sites', JobSitesPage),
  page('/candidate', CandidatePage),
  page('/resumes', ResumesPage),
  page('/agent', AgentPage),
  page('/settings', SettingsRoute),
  page('/setup', SetupRoute),
  page('/about', AboutPage),
]);

/** Hash history in the app (Tauri serves files); tests pass a memory history. */
export function createAppRouter(history: RouterHistory = createHashHistory()) {
  return createRouter({ routeTree, history, defaultPreload: 'intent' });
}

export type AppRouter = ReturnType<typeof createAppRouter>;
