import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type CSSProperties,
  type ReactNode,
} from 'react';

import type { LearnClient, RequestOptions } from './lib/api';

/**
 * The learning side's own places. Hosts (the desktop's and the web app's
 * routers) register a route for each of these paths and hand the pages a
 * navigator; the pages never import a router.
 */
export const learnPaths = {
  today: '/',
  roadmap: '/roadmap',
  learn: '/learn',
  technology: (technologyId: string) => `/learn/${encodeURIComponent(technologyId)}`,
  concept: (conceptId: string) => `/concept/${encodeURIComponent(conceptId)}`,
  exercise: (exerciseId: string) => `/exercise/${encodeURIComponent(exerciseId)}`,
  project: (exerciseId: string) => `/project/${encodeURIComponent(exerciseId)}`,
  practice: '/practice',
  challenge: (exerciseId: string) => `/challenge/${encodeURIComponent(exerciseId)}`,
  recall: '/recall',
  interviews: '/interviews',
  interview: (interviewId: string) => `/interviews/${encodeURIComponent(interviewId)}`,
  // Interview prep: a real interview's plan and likely questions.
  interviewPreps: '/interview-prep',
  interviewPrepNew: '/interview-prep/new',
  interviewPrep: (prepId: string) => `/interview-prep/${encodeURIComponent(prepId)}`,
  progress: '/progress',
  onboarding: '/onboarding',
  settings: '/settings?tab=goal',
  aiSettings: '/settings?tab=ai',
  // The hunt's pages, which Today links to (both hosts serve them here).
  applications: '/applications',
  application: (applicationId: string) => `/applications/${encodeURIComponent(applicationId)}`,
} as const;

/** Where an exercise-shaped item opens: projects have their own workspace. */
export function exercisePath(kind: string, exerciseId: string): string {
  return kind === 'PROJECT' ? learnPaths.project(exerciseId) : learnPaths.exercise(exerciseId);
}

/** How the learning pages move between places, injected by the host's router. */
export interface LearnNavigator {
  /** The href to put on an anchor for an app path. */
  href(path: string): string;
  navigate(path: string, options?: { replace?: boolean }): void;
  back(): void;
}

interface LearnContextValue {
  client: LearnClient;
  navigator: LearnNavigator;
  /** Which app is showing the pages; a few sentences differ. */
  surface: 'desktop' | 'web';
}

const LearnContext = createContext<LearnContextValue | null>(null);

/**
 * Gives the learning pages their API client and navigation. Mount it inside a
 * TanStack Query `QueryClientProvider`.
 */
export function LearnProvider({
  client,
  navigator,
  surface = 'web',
  children,
}: {
  client: LearnClient;
  navigator: LearnNavigator;
  surface?: 'desktop' | 'web';
  children: ReactNode;
}) {
  const value = useMemo(() => ({ client, navigator, surface }), [client, navigator, surface]);
  return <LearnContext.Provider value={value}>{children}</LearnContext.Provider>;
}

function useLearnContext(): LearnContextValue {
  const ctx = useContext(LearnContext);
  if (!ctx) throw new Error('Learning pages must be rendered inside <LearnProvider>.');
  return ctx;
}

export type ApiRequest = <T>(path: string, options?: RequestOptions) => Promise<T>;

/** The client's request function. Stable for as long as the client is. */
export function useApi(): ApiRequest {
  const { client } = useLearnContext();
  return useMemo<ApiRequest>(
    () =>
      <T,>(path: string, options?: RequestOptions) =>
        client.request<T>(path, options),
    [client],
  );
}

export function useLearnNavigator(): LearnNavigator {
  return useLearnContext().navigator;
}

export function useSurface(): 'desktop' | 'web' {
  return useLearnContext().surface;
}

/**
 * react-router's `useNavigate`, in the shape ForgeRoutine's pages used:
 * `navigate(path)`, `navigate(path, { replace })`, `navigate(-1)`.
 */
export function useLearnNavigate(): (to: string | -1, options?: { replace?: boolean }) => void {
  const navigator = useLearnNavigator();
  return useCallback(
    (to: string | -1, options?: { replace?: boolean }) => {
      if (to === -1) navigator.back();
      else navigator.navigate(to, options);
    },
    [navigator],
  );
}

/** An anchor to an app path, navigating through the host's router. */
export function LearnLink({
  to,
  className,
  style,
  children,
  'aria-label': ariaLabel,
}: {
  to: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  'aria-label'?: string;
}) {
  const navigator = useLearnNavigator();
  return (
    <a
      href={navigator.href(to)}
      className={className}
      style={style}
      aria-label={ariaLabel}
      onClick={(e) => {
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigator.navigate(to);
      }}
    >
      {children}
    </a>
  );
}
