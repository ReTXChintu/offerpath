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
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
} from '@tanstack/react-router';
import type { ReactNode } from 'react';

import {
  InterviewsPage,
  LearnPage,
  PracticePage,
  ProgressPage,
  RecallPage,
  RoadmapPage,
  TodayPage,
} from './pages/Placeholders';
import { ApplicationReviewRoute, JobDetailRoute, SettingsRoute, SetupRoute } from './routes';
import { Shell } from './shell/Shell';

const rootRoute = createRootRoute({ component: Shell });

const page = (path: string, component: () => ReactNode) =>
  createRoute({ getParentRoute: () => rootRoute, path, component });

const routeTree = rootRoute.addChildren([
  page('/', TodayPage),
  // Grow and Progress: the learning side arrives in phase 3.
  page('/roadmap', RoadmapPage),
  page('/learn', LearnPage),
  page('/practice', PracticePage),
  page('/recall', RecallPage),
  page('/interviews', InterviewsPage),
  page('/progress', ProgressPage),
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
