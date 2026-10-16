import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import type {
  Concept,
  DashboardOverview,
  ExerciseView,
  HintKind,
  HintResponse,
  IndependentCodingScore,
  LearningSession,
  StartAttemptResponse,
  SubmissionResponse,
  Technology,
  UserTechnology,
  WeakSkill,
} from '@offerpath/types';

import { useApi } from '../context';

import { randomId } from './browser';

/**
 * One place for every server interaction, so cache invalidation is decided here
 * rather than scattered through components (§45.4).
 */

export const queryKeys = {
  me: ['me'] as const,
  catalogue: (search?: string) => ['technologies', 'catalogue', search ?? ''] as const,
  myTechnologies: ['technologies', 'mine'] as const,
  concepts: (technologyId: string) => ['concepts', technologyId] as const,
  conceptDetail: (id: string) => ['concepts', 'detail', id] as const,
  exercises: (conceptId: string) => ['exercises', conceptId] as const,
  exercise: (id: string) => ['exercises', 'detail', id] as const,
  onboardingStatus: ['onboarding', 'status'] as const,
  roadmap: ['roadmap'] as const,
  generation: ['generation', 'status'] as const,
  overview: ['progress', 'overview'] as const,
  independence: ['progress', 'independence'] as const,
  weakest: ['skills', 'weakest'] as const,
  project: (exerciseId: string) => ['projects', exerciseId] as const,
  recallDue: ['recall', 'due'] as const,
  routineToday: ['routines', 'today'] as const,
  interviewGuide: ['interviews', 'guide'] as const,
  interviews: ['interviews', 'history'] as const,
  interview: (id: string) => ['interviews', 'detail', id] as const,
  interviewReport: (id: string) => ['interviews', 'report', id] as const,
  challenges: ['challenges'] as const,
  challenge: (id: string) => ['challenges', id] as const,
};

// -- Onboarding and roadmap ---------------------------------------------------

export interface OnboardingStatus {
  completed: boolean;
  technologyCount: number;
  awaitingContent: boolean;
  hasRoadmap: boolean;
}

export interface RoadmapItemView {
  id: string;
  kind: string;
  status: string;
  title: string;
  rationale: string;
  estimatedMinutes: number;
  conceptId: string | null;
  exerciseId: string | null;
}

export interface RoadmapPhaseView {
  id: string;
  orderIndex: number;
  title: string;
  goal: string;
  estimatedMinutes: number;
  items: RoadmapItemView[];
  doneCount: number;
}

export interface RoadmapView {
  id: string;
  version: number;
  status: string;
  generatedBy: string;
  totalMinutes: number;
  completedMinutes: number;
  phases: RoadmapPhaseView[];
  currentItemId: string | null;
}

export interface CompleteOnboardingBody {
  technologies: {
    technologyId?: string;
    name?: string;
    existingKnowledge?: number | null;
    interviewImportance?: number;
  }[];
  dailyMinutes: number;
  primaryGoal: string;
  interviewTarget: string;
  interviewDate: string | null;
}

export function useOnboardingStatus(): UseQueryResult<OnboardingStatus> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.onboardingStatus,
    queryFn: () => api<OnboardingStatus>('/onboarding/status'),
    // The first-run redirect depends on this, so a stale answer would bounce
    // the user back into onboarding they have already finished.
    staleTime: 0,
  });
}

export function useCompleteOnboarding() {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CompleteOnboardingBody) =>
      api<{ roadmap: RoadmapView; awaitingTechnologies: string[] }>('/onboarding/complete', {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      // Onboarding writes technologies, preferences and a roadmap in one go.
      void queryClient.invalidateQueries();
    },
  });
}

export function useRoadmap(): UseQueryResult<RoadmapView | null> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.roadmap,
    queryFn: async () => {
      const result = await api<RoadmapView | null>('/roadmap');
      // An empty body means no roadmap yet, not an empty roadmap.
      return result && Object.keys(result).length > 0 ? result : null;
    },
  });
}

export function useRegenerateRoadmap() {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api<RoadmapView>('/roadmap/regenerate', { method: 'POST' }),
    onSuccess: (roadmap) => {
      queryClient.setQueryData(queryKeys.roadmap, roadmap);
      void queryClient.invalidateQueries({ queryKey: queryKeys.overview });
    },
  });
}

export function useUpdateRoadmapItem() {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api<RoadmapItemView>(`/roadmap/items/${id}`, { method: 'PATCH', body: { status } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.roadmap });
      void queryClient.invalidateQueries({ queryKey: queryKeys.overview });
    },
  });
}

export interface GenerationJobView {
  id: string;
  kind: string;
  target: string;
  technologyName: string | null;
  status: string;
  progress: number;
  step: string;
  error: string | null;
}

export interface GenerationStatusView {
  active: boolean;
  partial: boolean;
  /** In the plan but not started. Costs nothing; never counts as active. */
  waiting: number;
  jobs: GenerationJobView[];
}

/**
 * Polls while curriculum is generating, and stops as soon as it is not.
 *
 * The roadmap changes underneath the user when a technology finishes, so this
 * also drives the invalidation — otherwise they would sit looking at a
 * "preparing" placeholder that is already ready.
 */
export function useGenerationStatus(enabled = true): UseQueryResult<GenerationStatusView> {
  const api = useApi();
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: queryKeys.generation,
    queryFn: async () => {
      const status = await api<GenerationStatusView>('/generation/status');

      // A job that just finished means new concepts and exercises exist.
      if (!status.active && status.jobs.some((j) => j.status === 'READY')) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.roadmap });
        void queryClient.invalidateQueries({ queryKey: queryKeys.overview });
      }

      return status;
    },
    enabled,
    // Generation takes minutes, so a tight poll is pure noise. Stops entirely
    // once nothing is running.
    refetchInterval: (query) => (query.state.data?.active ? 5_000 : false),
    staleTime: 0,
  });
}

export function useRetryGeneration() {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api<GenerationJobView[]>('/generation/retry', { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.generation });
    },
  });
}

// -- Technologies ------------------------------------------------------------

export function useCatalogue(search?: string): UseQueryResult<Technology[]> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.catalogue(search),
    queryFn: () =>
      api<Technology[]>(`/technologies${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  });
}

export function useMyTechnologies(): UseQueryResult<UserTechnology[]> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.myTechnologies,
    queryFn: () => api<UserTechnology[]>('/technologies/mine'),
  });
}

export function useAddTechnology() {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { technologyId?: string; name?: string }) =>
      api<UserTechnology>('/technologies/mine', { method: 'POST', body: input }),
    onSuccess: () => {
      // Adding a technology imports its curriculum, so concepts and the
      // dashboard's next action both change.
      void queryClient.invalidateQueries({ queryKey: queryKeys.myTechnologies });
      void queryClient.invalidateQueries({ queryKey: queryKeys.overview });
    },
  });
}

export function useArchiveTechnology() {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api<void>(`/technologies/mine/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.myTechnologies });
    },
  });
}

// -- Concepts ----------------------------------------------------------------

export function useConcepts(technologyId: string | undefined): UseQueryResult<Concept[]> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.concepts(technologyId ?? ''),
    queryFn: () => api<Concept[]>(`/concepts?technologyId=${technologyId}`),
    enabled: Boolean(technologyId),
  });
}

export interface ConceptDetail extends Concept {
  technologyName: string;
  prerequisites: { conceptId: string; name: string; strength: 'HARD' | 'SOFT' }[];
  readiness: {
    unlocked: boolean;
    score: number;
    blockingConceptIds: string[];
    advisoryConceptIds: string[];
  };
  skill: Record<string, number> | null;
  exerciseCount: number;
}

export function useConceptDetail(id: string | undefined): UseQueryResult<ConceptDetail> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.conceptDetail(id ?? ''),
    queryFn: () => api<ConceptDetail>(`/concepts/${id}`),
    enabled: Boolean(id),
  });
}

// -- Exercises ---------------------------------------------------------------

export function useExercises(conceptId: string | undefined): UseQueryResult<ExerciseView[]> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.exercises(conceptId ?? ''),
    queryFn: () => api<ExerciseView[]>(`/exercises?conceptId=${conceptId}`),
    enabled: Boolean(conceptId),
  });
}

export function useExercise(id: string | undefined): UseQueryResult<ExerciseView> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.exercise(id ?? ''),
    queryFn: () => api<ExerciseView>(`/exercises/${id}`),
    enabled: Boolean(id),
  });
}

export function useStartAttempt() {
  const api = useApi();
  return useMutation({
    mutationFn: ({ exerciseId, blindMode }: { exerciseId: string; blindMode: boolean }) =>
      api<StartAttemptResponse>(`/exercises/${exerciseId}/attempts`, {
        method: 'POST',
        body: { blindMode },
      }),
  });
}

export function useMarkFirstCode() {
  const api = useApi();
  return useMutation({
    mutationFn: (attemptId: string) =>
      api<void>(`/exercises/attempts/${attemptId}/first-code`, { method: 'POST' }),
  });
}

// -- Submissions -------------------------------------------------------------

export function useSubmitCode() {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      attemptId: string;
      code: string;
      language: 'javascript' | 'typescript';
      /** DEBUGGING exercises only: graded separately from the fix (§13). */
      diagnosis?: string;
      clientSignals?: { keystrokeCount?: number; largePasteEvents?: number };
    }) =>
      api<SubmissionResponse>('/submissions', {
        method: 'POST',
        body: input,
        // A double-clicked submit must not create two attempts.
        idempotencyKey: randomId(),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.overview });
      void queryClient.invalidateQueries({ queryKey: queryKeys.independence });
      void queryClient.invalidateQueries({ queryKey: queryKeys.weakest });
      // A passing run ticks off the routine item server-side, so today's
      // plan is stale the moment this returns.
      void queryClient.invalidateQueries({ queryKey: queryKeys.routineToday });
      void queryClient.invalidateQueries({ queryKey: ['today'] });
    },
  });
}

// -- AI assistance -----------------------------------------------------------

export function useRequestHint() {
  const api = useApi();
  return useMutation({
    mutationFn: (input: {
      attemptId: string;
      kind: HintKind;
      code?: string;
      lastError?: string;
      overrideGate?: boolean;
    }) => api<HintResponse>('/ai/hint', { method: 'POST', body: input }),
  });
}

// -- Sessions ----------------------------------------------------------------

export function useStartSession() {
  const api = useApi();
  return useMutation({
    mutationFn: (input: { conceptId?: string }) =>
      api<LearningSession>('/sessions', { method: 'POST', body: input }),
  });
}

// -- Progress ----------------------------------------------------------------

export function useOverview(): UseQueryResult<DashboardOverview> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.overview,
    queryFn: () => api<DashboardOverview>('/progress/overview'),
  });
}

export function useIndependence(): UseQueryResult<IndependentCodingScore> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.independence,
    queryFn: () => api<IndependentCodingScore>('/progress/independence'),
  });
}

export function useWeakestSkills(): UseQueryResult<WeakSkill[]> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.weakest,
    queryFn: () => api<WeakSkill[]>('/skills/weakest'),
  });
}

// -- Projects ----------------------------------------------------------------

export interface ProjectStepView {
  index: number;
  title: string;
  requirements: string;
  estimatedMinutes: number;
  status: 'LOCKED' | 'CURRENT' | 'DONE';
  starterCode: string | null;
  visibleTestNames: string[];
}

export interface ProjectView {
  exerciseId: string;
  /** What this project practises. Attributes a timed session to a concept. */
  conceptId: string;
  attemptId: string | null;
  title: string;
  objective: string;
  requirements: string;
  language: string;
  currentStep: number;
  steps: ProjectStepView[];
}

export interface ReviewIssue {
  severity: 'critical' | 'major' | 'minor' | 'nit';
  category: string;
  title: string;
  explanation: string;
  line: number | null;
}

export interface StepSubmissionResult {
  passed: boolean;
  testsPassed: number;
  testsTotal: number;
  cases: { name: string; passed: boolean; error?: string }[];
  review: { summary: string; issues: ReviewIssue[] } | null;
  advanced: boolean;
  projectComplete: boolean;
  checkpointFailed: boolean;
}

export function useProject(exerciseId: string | undefined): UseQueryResult<ProjectView> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.project(exerciseId ?? ''),
    queryFn: () => api<ProjectView>(`/projects/${exerciseId}`),
    enabled: Boolean(exerciseId),
  });
}

export function useStartProject() {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (exerciseId: string) =>
      api<ProjectView>(`/projects/${exerciseId}/start`, { method: 'POST' }),
    onSuccess: (project) => {
      queryClient.setQueryData(queryKeys.project(project.exerciseId), project);
    },
  });
}

export function useSubmitProjectStep() {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { exerciseId: string; attemptId: string; code: string }) =>
      api<StepSubmissionResult>('/projects/steps/submit', {
        method: 'POST',
        body: { attemptId: input.attemptId, code: input.code },
        idempotencyKey: randomId(),
      }),
    onSuccess: (_result, input) => {
      // The step may have unlocked, which changes what the workspace shows.
      void queryClient.invalidateQueries({ queryKey: queryKeys.project(input.exerciseId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.overview });
      void queryClient.invalidateQueries({ queryKey: queryKeys.routineToday });
      void queryClient.invalidateQueries({ queryKey: ['today'] });
    },
  });
}

// -- Recall ------------------------------------------------------------------

export interface RecallPromptView {
  id: string;
  conceptId: string;
  conceptName: string;
  technologyName: string;
  prompt: string;
  options: string[];
}

export interface RecallAnswerResult {
  correct: boolean;
  correctIndex: number;
  explanation: string;
  nextDueAt: string;
}

/**
 * Prompts that are due.
 *
 * Fetched eagerly so a boundary can surface one without a spinner, but never
 * rendered during coding — that is the caller's responsibility and the whole
 * reason this is a separate hook rather than a global popup.
 */
export function useRecallDue(enabled = true): UseQueryResult<RecallPromptView[]> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.recallDue,
    queryFn: () => api<RecallPromptView[]>('/recall/due'),
    enabled,
    staleTime: 60_000,
  });
}

export function useAnswerRecall() {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { questionId: string; selectedIndex: number }) =>
      api<RecallAnswerResult>('/recall/answer', { method: 'POST', body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.recallDue });
      void queryClient.invalidateQueries({ queryKey: queryKeys.routineToday });
      void queryClient.invalidateQueries({ queryKey: ['today'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.weakest });
    },
  });
}

// -- Routines ----------------------------------------------------------------

export interface RoutineItemView {
  id: string;
  kind: string;
  status: string;
  minutes: number;
  title: string;
  rationale: string;
  conceptId: string | null;
  exerciseId: string | null;
  /** RECALL items: how many questions this item covers. */
  questionCount: number;
  /** Set when this is unfinished work moved forward from an earlier day. */
  carriedFrom: string | null;
}

export interface RoutineView {
  id: string;
  date: string;
  totalMinutes: number;
  completedMinutes: number;
  items: RoutineItemView[];
  recallDue: number;
  /** How many of today's items were carried from an earlier day. */
  carriedCount: number;
}

export function useTodayRoutine(enabled = true): UseQueryResult<RoutineView | null> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.routineToday,
    enabled,
    // The server plans the day on first look, so this no longer comes back
    // empty. The null is kept only for the moment before the first fetch.
    queryFn: () => api<RoutineView>('/routines/today'),
  });
}

export function useGenerateRoutine() {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    // Typed explicitly: a defaulted parameter infers TVariables as void, and
    // callers could then no longer pass the flag at all.
    mutationFn: (force: boolean) =>
      api<RoutineView>(force ? '/routines/regenerate' : '/routines/generate', {
        method: 'POST',
      }),
    onSuccess: (routine) => {
      queryClient.setQueryData(queryKeys.routineToday, routine);
      void queryClient.invalidateQueries({ queryKey: ['today'] });
    },
  });
}

export function useUpdateRoutineItem() {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    // No SKIPPED. Every routine item is compulsory, and an unfinished one
    // carries to the next day rather than being dropped.
    mutationFn: ({ id, status }: { id: string; status: 'IN_PROGRESS' | 'DONE' }) =>
      api<RoutineItemView>(`/routines/items/${id}`, { method: 'PATCH', body: { status } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.routineToday });
      // Today's plan carries the routine too.
      void queryClient.invalidateQueries({ queryKey: ['today'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.overview });
    },
  });
}

// -- Interviews --------------------------------------------------------------

export interface InterviewTurnView {
  questionId: string;
  orderIndex: number;
  prompt: string;
  conceptName: string | null;
  answer: string | null;
}

export interface InterviewView {
  id: string;
  mode: string;
  targetLevel: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  turns: InterviewTurnView[];
  currentQuestion: { id: string; prompt: string } | null;
  turnsRemaining: number;
}

export interface InterviewReportView {
  overallScore: number | null;
  dimensions: Record<string, number | null>;
  strongAreas: string[];
  weakAreas: string[];
  recommendedTopics: string[];
  summary: string | null;
  degraded: boolean;
}

export interface InterviewSummaryView {
  id: string;
  mode: string;
  targetLevel: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  questionCount: number;
  overallScore: number | null;
}

export interface GuideTopic {
  conceptId: string;
  name: string;
  description: string;
  readiness: number | null;
  weakestDimension: string | null;
  likelyProbes: string[];
  commonMistakes: string[];
  status: 'STRONG' | 'SHAKY' | 'WEAK' | 'UNPRACTISED';
}

export interface GuideTechnology {
  technologyId: string;
  name: string;
  slug: string;
  interviewImportance: number;
  readiness: number | null;
  topics: GuideTopic[];
}

export interface InterviewGuideView {
  overallReadiness: number | null;
  technologies: GuideTechnology[];
  priorities: { title: string; reason: string; conceptId: string | null }[];
  recurringWeaknesses: string[];
  interviewsTaken: number;
  lastInterviewAt: string | null;
}

export function useInterviewGuide(): UseQueryResult<InterviewGuideView> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.interviewGuide,
    queryFn: () => api<InterviewGuideView>('/interviews/guide'),
  });
}

export function useInterviewHistory(): UseQueryResult<InterviewSummaryView[]> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.interviews,
    queryFn: () => api<InterviewSummaryView[]>('/interviews'),
  });
}

export function useInterview(id: string | undefined): UseQueryResult<InterviewView> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.interview(id ?? ''),
    queryFn: () => api<InterviewView>(`/interviews/${id}`),
    enabled: Boolean(id),
  });
}

export function useStartInterview() {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { mode: string; targetLevel: string }) =>
      api<InterviewView>('/interviews', { method: 'POST', body: input }),
    onSuccess: (interview) => {
      queryClient.setQueryData(queryKeys.interview(interview.id), interview);
      void queryClient.invalidateQueries({ queryKey: queryKeys.interviews });
    },
  });
}

export function useAnswerInterview() {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { interviewId: string; questionId: string; text: string }) =>
      api<InterviewView>(`/interviews/${input.interviewId}/answer`, {
        method: 'POST',
        body: { questionId: input.questionId, text: input.text },
        // The next question costs a model call; a double submit must not
        // burn two of them or desynchronise the transcript.
        idempotencyKey: randomId(),
      }),
    onSuccess: (interview) => {
      queryClient.setQueryData(queryKeys.interview(interview.id), interview);
    },
  });
}

export function useEndInterview() {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (interviewId: string) =>
      api<InterviewReportView>(`/interviews/${interviewId}/end`, { method: 'POST' }),
    onSuccess: (report, interviewId) => {
      queryClient.setQueryData(queryKeys.interviewReport(interviewId), report);
      void queryClient.invalidateQueries({ queryKey: queryKeys.interview(interviewId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.interviewGuide });
      void queryClient.invalidateQueries({ queryKey: queryKeys.interviews });
      void queryClient.invalidateQueries({ queryKey: queryKeys.weakest });
    },
  });
}

export function useInterviewReport(id: string | undefined): UseQueryResult<InterviewReportView> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.interviewReport(id ?? ''),
    queryFn: () => api<InterviewReportView>(`/interviews/${id}/report`),
    enabled: Boolean(id),
  });
}

// -- Engineering challenges --------------------------------------------------

export type ChallengeKind = 'SYSTEM_DESIGN' | 'INCIDENT' | 'TERMINAL';

export interface ChallengeSummary {
  exerciseId: string;
  slug: string;
  kind: ChallengeKind;
  title: string;
  objective: string;
  difficulty: number;
  estimatedMinutes: number;
  /** What this challenge practises. Attributes a timed session to a concept. */
  conceptId: string;
  conceptName: string;
  technologyName: string;
  completed: boolean;
}

export interface ChallengeView extends ChallengeSummary {
  attemptId: string | null;
  brief: {
    body: string;
    constraints: string[];
    sections: string[];
    terminal?: { task: string; goals: string[] };
    telemetry?: string;
  };
}

export interface TerminalRunResult {
  transcript: { command: string; stdout: string; stderr: string; exitCode: number }[];
  checks: { description: string; passed: boolean; detail: string }[];
  passed: boolean;
}

export interface WrittenReviewResult {
  passed: boolean;
  scores: Record<string, number | null>;
  strengths: string[];
  issues: { severity: string; title: string; explanation: string }[];
  followUpQuestions: string[];
  summary: string;
  rootCause?: string;
  missedSignals?: string[];
  degraded: boolean;
}

export function useChallenges(): UseQueryResult<ChallengeSummary[]> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.challenges,
    queryFn: () => api<ChallengeSummary[]>('/challenges'),
  });
}

export function useChallenge(id: string | undefined): UseQueryResult<ChallengeView> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.challenge(id ?? ''),
    queryFn: () => api<ChallengeView>(`/challenges/${id}`),
    enabled: Boolean(id),
  });
}

export function useStartChallenge() {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (exerciseId: string) =>
      api<ChallengeView>(`/challenges/${exerciseId}/start`, { method: 'POST' }),
    onSuccess: (challenge) => {
      queryClient.setQueryData(queryKeys.challenge(challenge.exerciseId), challenge);
    },
  });
}

/**
 * A dry run: replays the commands and reports, but records nothing.
 *
 * The terminal is meant to be explored. Charging every `ls` against the
 * attempt would make people plan in their head and paste one answer, which
 * is the opposite of learning to use a shell.
 */
export function useRunTerminal() {
  const api = useApi();
  return useMutation({
    mutationFn: (input: { exerciseId: string; commands: string[] }) =>
      api<TerminalRunResult>(`/challenges/${input.exerciseId}/terminal/run`, {
        method: 'POST',
        body: { commands: input.commands },
      }),
  });
}

export function useSubmitTerminal() {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { exerciseId: string; attemptId: string; commands: string[] }) =>
      api<TerminalRunResult>('/challenges/terminal/submit', {
        method: 'POST',
        body: { attemptId: input.attemptId, commands: input.commands },
        idempotencyKey: randomId(),
      }),
    onSuccess: (_result, input) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.challenge(input.exerciseId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.challenges });
      void queryClient.invalidateQueries({ queryKey: queryKeys.overview });
    },
  });
}

export function useSubmitWritten() {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { exerciseId: string; attemptId: string; text: string }) =>
      api<WrittenReviewResult>('/challenges/written/submit', {
        method: 'POST',
        body: { attemptId: input.attemptId, text: input.text },
        idempotencyKey: randomId(),
      }),
    onSuccess: (_result, input) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.challenge(input.exerciseId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.challenges });
      void queryClient.invalidateQueries({ queryKey: queryKeys.overview });
      void queryClient.invalidateQueries({ queryKey: queryKeys.weakest });
    },
  });
}

export interface ExplainerView {
  summary: string;
  realWorld: string;
  examples: string[];
  codeExample: string | null;
  codeLanguage: string | null;
  pitfalls: string[];
  docsUrl: string | null;
  available: boolean;
  unavailableReason: string | null;
}

export interface ChatMessageView {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}

/**
 * The written explanation for a concept.
 *
 * Generated on the server the first time anyone opens it and shared from
 * then on, so this is a slow first call and instant afterwards. No retry:
 * a failure here already degrades to a readable message, and retrying
 * would be a second generation.
 */
export function useConceptExplainer(conceptId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: ['concepts', conceptId, 'explainer'] as const,
    queryFn: () => api<ExplainerView>(`/concepts/${conceptId}/explainer`),
    enabled: Boolean(conceptId),
    staleTime: Infinity,
    retry: false,
  });
}

export function useConceptChat(conceptId: string | undefined, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: ['concepts', conceptId, 'chat'] as const,
    queryFn: () => api<ChatMessageView[]>(`/concepts/${conceptId}/chat`),
    enabled: enabled && Boolean(conceptId),
  });
}

export function useAskConcept(conceptId: string | undefined) {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    // `screen` is whatever the open tab can describe of itself. Sent per
    // question rather than stored: it describes a moment, and a transcript
    // replaying last week's editor contents would be worse than none.
    mutationFn: ({ question, screen }: { question: string; screen?: string }) =>
      api<ChatMessageView[]>(`/concepts/${conceptId}/chat`, {
        method: 'POST',
        body: screen ? { question, screen } : { question },
      }),
    onSuccess: (turns) => {
      // Appended rather than refetched: the answer is already here, and a
      // refetch would blank the thread while it reloads.
      queryClient.setQueryData<ChatMessageView[]>(['concepts', conceptId, 'chat'], (existing) => [
        ...(existing ?? []),
        ...turns,
      ]);
    },
  });
}

// -- Practice ----------------------------------------------------------------

export interface WrittenGrade {
  /** Out of five. */
  score: number;
  correct: string[];
  wrong: string[];
  improve: string[];
}

export interface GivenAnswer {
  selectedIndex: number | null;
  correct: boolean | null;
  /** Which option was right. Null until one is picked, and for written questions. */
  correctIndex: number | null;
  answer: string | null;
  selfRating: number | null;
  explanation: string | null;
  modelAnswer: string | null;
  keyPoints: string[];
  /** The mark, where one was produced. Null when self-rated or unjudged. */
  grade: WrittenGrade | null;
}

export interface PracticeQuestionView {
  id: string;
  kind: 'MCQ' | 'THEORY';
  prompt: string;
  /** MCQ only, and never the answer: the client cannot mark its own homework. */
  options: string[];
  difficulty: number;
  batch: number;
  given: GivenAnswer | null;
}

export interface PracticeExerciseView {
  id: string;
  title: string;
  kind: string;
  difficulty: number;
  estimatedMinutes: number;
  batch: number;
  passed: boolean;
}

export interface CompletionState {
  complete: boolean;
  questionsAnswered: number;
  questionsServed: number;
  exercisesPassed: number;
  exercisesServed: number;
  outstanding: { questions: number; exercises: number };
}

export interface PracticeView {
  questions: PracticeQuestionView[];
  exercises: PracticeExerciseView[];
  completion: CompletionState;
  routineDone: boolean;
  problem: string | null;
}

const practiceKey = (conceptId: string | undefined) => ['concepts', conceptId, 'practice'] as const;

/**
 * The questions and exercises this user was handed on a concept.
 *
 * `staleTime: Infinity` because the first visit generates: a background
 * refetch would be a second model call, and nothing about a served batch
 * changes except through the mutations below, which write the cache directly.
 */
export function usePractice(conceptId: string | undefined, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: practiceKey(conceptId),
    queryFn: () => api<PracticeView>(`/concepts/${conceptId}/practice`),
    enabled: enabled && Boolean(conceptId),
    staleTime: Infinity,
    retry: false,
  });
}

/** Five more questions, or one more exercise. Both return the whole view. */
export function useGeneratePractice(conceptId: string | undefined) {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (what: 'questions' | 'code') =>
      api<PracticeView>(`/concepts/${conceptId}/practice/${what}`, { method: 'POST' }),
    onSuccess: (view) => {
      queryClient.setQueryData(practiceKey(conceptId), view);
      void queryClient.invalidateQueries({ queryKey: queryKeys.routineToday });
      void queryClient.invalidateQueries({ queryKey: ['today'] });
    },
  });
}

export interface McqAnswerResult {
  correct: boolean;
  correctIndex: number;
  explanation: string;
  completion: CompletionState;
}

/**
 * Answers a question of either kind.
 *
 * All three mutations refresh the practice view rather than patching it: the
 * server decides whether that answer finished the concept, and a client that
 * worked it out for itself would be a second copy of the rule.
 */
export function useAnswerMcq(conceptId: string | undefined) {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ questionId, selectedIndex }: { questionId: string; selectedIndex: number }) =>
      api<McqAnswerResult>(`/concepts/questions/${questionId}/choice`, {
        method: 'POST',
        body: { selectedIndex },
      }),
    onSuccess: () => refreshAfterAnswer(queryClient, conceptId),
  });
}

export interface TheoryAnswerResult {
  modelAnswer: string;
  keyPoints: string[];
  /** Null when there was no AI to mark it, which falls back to self-rating. */
  grade: WrittenGrade | null;
}

export function useAnswerTheory(conceptId: string | undefined) {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ questionId, answer }: { questionId: string; answer: string }) =>
      api<TheoryAnswerResult>(`/concepts/questions/${questionId}/answer`, {
        method: 'POST',
        body: { answer },
      }),
    onSuccess: () => refreshAfterAnswer(queryClient, conceptId),
  });
}

export function useRateTheory(conceptId: string | undefined) {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ questionId, selfRating }: { questionId: string; selfRating: number }) =>
      api<{ completion: CompletionState }>(`/concepts/questions/${questionId}/rating`, {
        method: 'POST',
        body: { selfRating },
      }),
    onSuccess: () => refreshAfterAnswer(queryClient, conceptId),
  });
}

function refreshAfterAnswer(
  queryClient: ReturnType<typeof useQueryClient>,
  conceptId: string | undefined,
) {
  void queryClient.invalidateQueries({ queryKey: practiceKey(conceptId) });
  // An answer can be the one that finishes the concept, which ticks off a
  // routine row server-side.
  void queryClient.invalidateQueries({ queryKey: queryKeys.routineToday });
  void queryClient.invalidateQueries({ queryKey: ['today'] });
  void queryClient.invalidateQueries({ queryKey: queryKeys.weakest });
}

// -- What comes next ---------------------------------------------------------

export interface NextUpView {
  source: 'routine' | 'course';
  title: string;
  rationale: string;
  conceptId: string | null;
  exerciseId: string | null;
  kind: string;
}

/**
 * What to do after this concept.
 *
 * Fetched only once the concept is finished, so a half-done page does not
 * spend a query asking what comes after it.
 */
export function useNextUp(conceptId: string | undefined, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: ['routines', 'next', conceptId] as const,
    queryFn: () => api<NextUpView | null>(`/routines/next?after=${encodeURIComponent(conceptId!)}`),
    enabled: enabled && Boolean(conceptId),
    staleTime: 30_000,
  });
}

// -- Scratchpad --------------------------------------------------------------

export interface ScratchRunResult {
  status: string;
  stdout: string;
  stderr: string;
  durationMs: number;
  truncated: boolean;
}

/**
 * Runs a snippet for what it prints.
 *
 * No cache and no invalidation, because nothing is stored: trying an example
 * out records nothing, scores nothing, and cannot change whether a concept
 * counts as finished. Ignoring the button has to stay free.
 */
export function useRunScratch() {
  const api = useApi();
  return useMutation({
    mutationFn: ({ code, language }: { code: string; language: 'javascript' | 'typescript' }) =>
      api<ScratchRunResult>('/playground/run', { method: 'POST', body: { code, language } }),
  });
}
