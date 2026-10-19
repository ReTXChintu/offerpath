import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import { useApi } from '../context';

import { todayKey, type ModelOption } from './plan';

/**
 * Interview prep: the user adds a job description and/or technologies and
 * when the interview is; AI writes a plan and likely questions, then grades
 * practice answers. Claude on the user's laptop runs it when it is online;
 * otherwise the user's own OpenAI key (Settings → AI), when one is saved.
 */

export type PrepStatus = 'GENERATING' | 'READY' | 'FAILED';
export type PrepAiSource = 'desktop' | 'openai';
export type PrepQuestionKind = 'TECHNICAL' | 'SYSTEM_DESIGN' | 'CODING' | 'BEHAVIORAL' | 'COMPANY';

export interface PrepFeedback {
  covered: string[];
  missed: string[];
  feedback: string;
}

export interface PrepQuestionView {
  id: string;
  order: number;
  kind: PrepQuestionKind | string;
  topic: string;
  question: string;
  /** 1 (warm-up) to 5 (hard). */
  difficulty: number;
  /** What a strong answer covers; null until the question has been answered. */
  keyPoints: string[] | null;
  answer: string | null;
  /** 0-10. */
  score: number | null;
  feedback: PrepFeedback | null;
  answeredAt: string | null;
}

export interface PrepFocusArea {
  topic: string;
  why: string;
  /** 1 = highest. */
  priority: number;
}

export interface PrepPlan {
  summary: string;
  focusAreas: PrepFocusArea[];
  /** One entry per day until the interview; the last is the day before. */
  schedule: { day: number; focus: string }[];
}

export interface PrepView {
  id: string;
  company: string | null;
  role: string | null;
  jobDescription: string | null;
  technologies: string[];
  scheduledAt: string;
  status: PrepStatus;
  error: string | null;
  generatedBy: PrepAiSource | null;
  plan: PrepPlan | null;
  questions: PrepQuestionView[];
  progress: { answered: number; total: number; averageScore: number | null };
  createdAt: string;
}

export interface PrepInput {
  company?: string | null;
  role?: string | null;
  jobDescription?: string | null;
  technologies?: string[];
  /** ISO date-time with an offset. */
  scheduledAt: string;
}

export interface PrepUpdate {
  company?: string | null;
  role?: string | null;
  scheduledAt?: string;
}

export interface FallbackKeyView {
  /** Whether a key is saved. The key itself never comes back. */
  configured: boolean;
  last4: string | null;
  modelFast: string;
  modelReasoning: string;
  /** False when the server has no ENCRYPTION_KEY, so it can't store a key. */
  available: boolean;
}

export interface FallbackKeyInput {
  /** Omit to keep the saved key and change only the models. */
  apiKey?: string;
  modelFast?: string | null;
  modelReasoning?: string | null;
}

export const prepKeys = {
  all: ['interview-preps'] as const,
  list: ['interview-preps', 'list'] as const,
  detail: (id: string) => ['interview-preps', 'detail', id] as const,
  ai: ['interview-preps', 'ai'] as const,
  fallback: ['settings', 'ai', 'fallback'] as const,
  fallbackModels: ['settings', 'ai', 'fallback', 'models'] as const,
};

/** How often a prep being written is checked. */
export const PREP_POLL_MS = 4_000;

const prepPath = (id: string) => `/interview-preps/${encodeURIComponent(id)}`;

/** Every prep, soonest first. Polls while one is still being written. */
export function useInterviewPreps(): UseQueryResult<PrepView[]> {
  const api = useApi();
  return useQuery({
    queryKey: prepKeys.list,
    queryFn: async () => (await api<{ preps: PrepView[] }>('/interview-preps')).preps,
    refetchInterval: (query) =>
      query.state.data?.some((p) => p.status === 'GENERATING') ? PREP_POLL_MS : false,
  });
}

/** One prep. Polls every few seconds while it is GENERATING. */
export function useInterviewPrep(id: string): UseQueryResult<PrepView> {
  const api = useApi();
  return useQuery({
    queryKey: prepKeys.detail(id),
    queryFn: () => api<PrepView>(prepPath(id)),
    enabled: id.length > 0,
    refetchInterval: (query) => (query.state.data?.status === 'GENERATING' ? PREP_POLL_MS : false),
  });
}

/** Where prep AI would run right now: the laptop, the OpenAI key, or nowhere (null). */
export function usePrepAiSource(): UseQueryResult<PrepAiSource | null> {
  const api = useApi();
  return useQuery({
    queryKey: prepKeys.ai,
    queryFn: async () =>
      (await api<{ source: PrepAiSource | null }>('/interview-preps/ai')).source ?? null,
    refetchInterval: 15_000,
  });
}

function useStorePrep() {
  const queryClient = useQueryClient();
  return (prep: PrepView) => {
    queryClient.setQueryData(prepKeys.detail(prep.id), prep);
    void queryClient.invalidateQueries({ queryKey: prepKeys.list });
    void queryClient.invalidateQueries({ queryKey: todayKey });
  };
}

export function useCreatePrep() {
  const api = useApi();
  const store = useStorePrep();
  return useMutation({
    mutationFn: (input: PrepInput) =>
      api<PrepView>('/interview-preps', { method: 'POST', body: input }),
    onSuccess: store,
  });
}

export function useUpdatePrep(id: string) {
  const api = useApi();
  const store = useStorePrep();
  return useMutation({
    mutationFn: (change: PrepUpdate) =>
      api<PrepView>(prepPath(id), { method: 'PATCH', body: change }),
    onSuccess: store,
  });
}

export function useRegeneratePrep(id: string) {
  const api = useApi();
  const store = useStorePrep();
  return useMutation({
    mutationFn: () => api<PrepView>(`${prepPath(id)}/regenerate`, { method: 'POST' }),
    onSuccess: store,
  });
}

export function useDeletePrep() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(prepPath(id), { method: 'DELETE' }),
    onSuccess: (_void, id) => {
      queryClient.removeQueries({ queryKey: prepKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: prepKeys.list });
      void queryClient.invalidateQueries({ queryKey: todayKey });
    },
  });
}

/** Answer a practice question; AI grades it and the key points become visible. */
export function useAnswerPrepQuestion(prepId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ questionId, answer }: { questionId: string; answer: string }) =>
      api<PrepQuestionView>(
        `${prepPath(prepId)}/questions/${encodeURIComponent(questionId)}/answer`,
        { method: 'POST', body: { answer } },
      ),
    onSuccess: (question) => {
      queryClient.setQueryData<PrepView>(prepKeys.detail(prepId), (prep) =>
        prep
          ? {
              ...prep,
              questions: prep.questions.map((q) => (q.id === question.id ? question : q)),
            }
          : prep,
      );
      // The progress figures are the server's to work out.
      void queryClient.invalidateQueries({ queryKey: prepKeys.detail(prepId) });
      void queryClient.invalidateQueries({ queryKey: prepKeys.list });
    },
  });
}

// -- Settings → AI: the OpenAI fallback key -----------------------------------

export function useFallbackKey(): UseQueryResult<FallbackKeyView> {
  const api = useApi();
  return useQuery({
    queryKey: prepKeys.fallback,
    queryFn: () => api<FallbackKeyView>('/settings/ai/fallback'),
  });
}

/** The models the saved key can use, straight from OpenAI. Only with a saved key. */
export function useFallbackModels(enabled: boolean): UseQueryResult<ModelOption[]> {
  const api = useApi();
  return useQuery({
    queryKey: prepKeys.fallbackModels,
    queryFn: async () =>
      (await api<{ models: ModelOption[] }>('/settings/ai/fallback/models')).models,
    enabled,
    staleTime: 5 * 60_000,
  });
}

function useStoreFallback() {
  const queryClient = useQueryClient();
  return (view: FallbackKeyView) => {
    queryClient.setQueryData(prepKeys.fallback, view);
    void queryClient.invalidateQueries({ queryKey: prepKeys.fallbackModels });
    void queryClient.invalidateQueries({ queryKey: prepKeys.ai });
  };
}

export function useSaveFallbackKey() {
  const api = useApi();
  const store = useStoreFallback();
  return useMutation({
    mutationFn: (input: FallbackKeyInput) =>
      api<FallbackKeyView>('/settings/ai/fallback', { method: 'PUT', body: input }),
    onSuccess: store,
  });
}

export function useRemoveFallbackKey() {
  const api = useApi();
  const store = useStoreFallback();
  return useMutation({
    mutationFn: () => api<FallbackKeyView>('/settings/ai/fallback', { method: 'DELETE' }),
    onSuccess: store,
  });
}
