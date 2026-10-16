import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import { useApi } from '../context';

import { queryKeys, type RoutineView } from './queries';

/**
 * Offerpath's additions to ForgeRoutine's queries: the Claude model
 * settings, the desktop's status, the goal and the daily plan.
 */

// -- Settings: Claude models -------------------------------------------------

export interface ModelOption {
  id: string;
  label: string;
}

export interface ClaudeModels {
  /** Grading, hints, short answers. */
  fast: string;
  /** Curriculum, roadmaps, interview reports. */
  reasoning: string;
  /** The tutor chat. Null follows `fast`. */
  tutor: string | null;
}

export interface AISettingsView {
  models: ClaudeModels;
  options: ModelOption[];
  /** The desktop that runs this account's AI, if it is online. */
  desktop: {
    online: boolean;
    claudeAvailable: boolean;
    detail: string | null;
    version: string | null;
  };
}

export const aiSettingsKey = ['settings', 'ai'] as const;

/**
 * Which Claude model each kind of work uses, and whether the desktop that
 * runs them is online. Claude runs on the user's own desktop with their own
 * sign-in: there is no vendor to choose and no key to store.
 */
export function useAISettings(
  options: { poll?: boolean; enabled?: boolean } = {},
): UseQueryResult<AISettingsView> {
  const api = useApi();
  return useQuery({
    queryKey: aiSettingsKey,
    queryFn: () => api<AISettingsView>('/settings/ai'),
    enabled: options.enabled ?? true,
    refetchInterval: options.poll ? 10_000 : false,
  });
}

export function useUpdateAISettings() {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (change: Partial<ClaudeModels>) =>
      api<AISettingsView>('/settings/ai', { method: 'PUT', body: change }),
    // The whole view comes back, so the cache is replaced, not invalidated.
    onSuccess: (view) => queryClient.setQueryData(aiSettingsKey, view),
  });
}

// -- Desktop status ----------------------------------------------------------

export interface DesktopStatusView {
  online: boolean;
  desktop: {
    version?: string | null;
    claude?: { available: boolean; detail: string | null };
  } | null;
}

export const desktopStatusKey = ['desktop', 'status'] as const;

/** Whether this account's desktop is connected to the server. Polled. */
export function useDesktopStatus(enabled = true): UseQueryResult<DesktopStatusView> {
  const api = useApi();
  return useQuery({
    queryKey: desktopStatusKey,
    queryFn: () => api<DesktopStatusView>('/desktop/status'),
    enabled,
    refetchInterval: 15_000,
  });
}

// -- Goal and the daily plan -------------------------------------------------

export interface GoalView {
  targetRoles: string[];
  targetCompanies: string[];
  locations: string[];
  targetDate: string | null;
  /** Whole days left until the target date, when there is one. */
  daysLeft: number | null;
}

export interface GoalInput {
  targetRoles?: string[];
  targetCompanies?: string[];
  locations?: string[];
  targetDate?: string | null;
}

export interface HuntTodo {
  applicationId: string;
  company: string;
  title: string;
  /** APPROVE: ready to approve. ANSWER: questions to answer. ACT: a manual step. */
  action: 'APPROVE' | 'ANSWER' | 'ACT';
  questions: number;
}

export interface InterviewPrepView {
  interview: Record<string, unknown>;
  applicationId: string;
  company: string;
  title: string;
  daysLeft: number;
  /** Catalogue technologies the job asks for, to practise before the day. */
  technologies: { id: string; name: string; onRoadmap: boolean }[];
}

export interface SkillGapView {
  skill: string;
  /** How many best-match jobs ask for it. */
  jobs: number;
  technology: { id: string; name: string; slug: string } | null;
  onRoadmap: boolean;
}

export interface TodayPlanView {
  date: string;
  startedAt: string | null;
  streak: number;
  goal: GoalView | null;
  learning: RoutineView;
  hunt: { todos: HuntTodo[]; approvals: number; questions: number };
  interviews: InterviewPrepView[];
  skillGaps: SkillGapView[];
  desktopOnline: boolean;
}

export const todayKey = ['today'] as const;
export const goalKey = ['goal'] as const;

export function useTodayPlan(): UseQueryResult<TodayPlanView> {
  const api = useApi();
  return useQuery({
    queryKey: todayKey,
    queryFn: () => api<TodayPlanView>('/today'),
  });
}

export function useStartDay() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<TodayPlanView>('/today/start', { method: 'POST' }),
    onSuccess: (view) => {
      queryClient.setQueryData(todayKey, view);
      queryClient.setQueryData(queryKeys.routineToday, view.learning);
    },
  });
}

export function useGoal(): UseQueryResult<GoalView | null> {
  const api = useApi();
  return useQuery({
    queryKey: goalKey,
    queryFn: async () => (await api<{ goal: GoalView | null }>('/goal')).goal,
  });
}

export function useSetGoal() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: GoalInput) => api<GoalView>('/goal', { method: 'PUT', body: input }),
    onSuccess: (goal) => {
      queryClient.setQueryData(goalKey, goal);
      void queryClient.invalidateQueries({ queryKey: todayKey });
    },
  });
}

export function useAddSkillGap() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (technologyId: string) =>
      api<void>('/goal/skill-gaps/add', { method: 'POST', body: { technologyId } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: todayKey });
      void queryClient.invalidateQueries({ queryKey: queryKeys.roadmap });
      void queryClient.invalidateQueries({ queryKey: queryKeys.myTechnologies });
      void queryClient.invalidateQueries({ queryKey: queryKeys.generation });
    },
  });
}
