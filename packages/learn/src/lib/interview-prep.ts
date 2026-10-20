import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { useApi } from '../context';

import { ApiError } from './api';
import { todayKey, type ModelOption } from './plan';

/**
 * Interview prep: the user adds a job description and/or technologies and
 * when the interview is; AI writes a plan and likely questions, then grades
 * practice answers. Claude on the user's laptop runs it when it is online;
 * otherwise the user's own OpenAI key (Settings → AI), when one is saved.
 */

export type PrepStatus = 'GENERATING' | 'READY' | 'FAILED';
export type PrepAiSource = 'desktop' | 'openai';
export type PrepQuestionKind =
  'TECHNICAL' | 'SYSTEM_DESIGN' | 'CODING' | 'DSA' | 'BEHAVIORAL' | 'COMPANY';

/** Where a prep's CV came from: a file, the synced Offerpath profile, or pasted text. */
export type ResumeSource = 'upload' | 'profile' | 'pasted';

/** A CV as it is sent with a prep. */
export interface PrepResumeInput {
  text: string;
  source: ResumeSource;
  fileName?: string | null;
}

/** A prep's CV as it comes back. */
export interface PrepResumeView {
  source: ResumeSource;
  fileName: string | null;
  chars: number;
  text: string;
}

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
  /** Whether DSA questions are in the prep and DSA problems in its mock interviews. */
  includeDsa: boolean;
  resume: PrepResumeView | null;
  /** Newest first. */
  mockInterviews: MockInterviewSummary[];
  createdAt: string;
}

export interface PrepInput {
  company?: string | null;
  role?: string | null;
  jobDescription?: string | null;
  technologies?: string[];
  /** ISO date-time with an offset. */
  scheduledAt: string;
  includeDsa?: boolean;
  resume?: PrepResumeInput | null;
}

/**
 * Changing the job description, technologies, DSA or the CV rewrites the
 * plan and questions (practice answers are lost); company, role and date
 * alone don't.
 */
export interface PrepUpdate {
  company?: string | null;
  role?: string | null;
  scheduledAt?: string;
  jobDescription?: string | null;
  technologies?: string[];
  includeDsa?: boolean;
  /** null removes the CV. */
  resume?: PrepResumeInput | null;
}

/** What `POST /interview-preps/cv/extract` answers. */
export interface CvExtractResult {
  text: string;
  fileName: string;
  chars: number;
}

// -- Mock interviews: the contract (docs/mock-interview.md) -------------------

export type MockStage = 'INTRO' | 'TECHNICAL' | 'CODING' | 'WRAP_UP';
export type MockStatus = 'IN_PROGRESS' | 'REPORTING' | 'COMPLETED' | 'FAILED' | 'ABANDONED';
export type MockTurnKind =
  'OPENING' | 'FOLLOW_UP' | 'CROSS_QUESTION' | 'NEW_QUESTION' | 'CODING' | 'CLOSING' | 'ANSWER';
export type MockVerdict = 'STRONG_HIRE' | 'HIRE' | 'LEAN_HIRE' | 'LEAN_NO_HIRE' | 'NO_HIRE';
export type MockAssessmentVerdict = 'STRONG' | 'CORRECT' | 'PARTIAL' | 'WRONG' | 'NO_ANSWER';
export type MockDimension =
  | 'SELF_PRESENTATION'
  | 'TECHNICAL_DEPTH'
  | 'PROBLEM_SOLVING'
  | 'CODING'
  | 'COMMUNICATION'
  | 'LANGUAGE';

export interface LanguageFix {
  original: string;
  corrected: string;
  note: string;
}

export interface CodingProblem {
  title: string;
  /** Markdown. */
  statement: string;
  examples: { input: string; output: string; explanation: string | null }[];
  constraints: string[];
}

export interface MockTurnView {
  id: string;
  /** 0-based, interviewer and candidate interleaved. */
  order: number;
  speaker: 'INTERVIEWER' | 'CANDIDATE';
  stage: MockStage;
  kind: MockTurnKind | string;
  /** What was said; markdown for the interviewer. */
  text: string;
  code: string | null;
  codeLanguage: string | null;
  /** Interviewer CODING turns. */
  problem: CodingProblem | null;
  /** Candidate turns, once the interviewer has replied. ok = nothing to fix. */
  language: { ok: boolean; corrections: LanguageFix[] } | null;
  /** Candidate turns, once the interview is COMPLETED. */
  assessment: { verdict: MockAssessmentVerdict | string; note: string } | null;
  createdAt: string;
}

export interface MockReportQuestion {
  /** The interviewer turn's `order`; the answer is the next candidate turn. */
  turnOrder: number;
  question: string;
  answerSummary: string;
  /** 0-10. */
  score: number;
  wentWell: string;
  couldBeBetter: string;
  strongerAnswer: string;
}

export interface MockReport {
  /** 0-10, one decimal. */
  overallScore: number;
  verdict: MockVerdict;
  summary: string;
  dimensions: { name: MockDimension | string; score: number; comment: string }[];
  questions: MockReportQuestion[];
  language: { score: number; patterns: string[]; note: string };
  strengths: string[];
  improvements: string[];
  nextSteps: string[];
}

export interface MockInterviewView {
  id: string;
  prepId: string;
  status: MockStatus;
  stage: MockStage;
  /** The order shown in the progress bar. */
  stages: MockStage[];
  /** The last turn is the candidate's: the interviewer is replying, or the reply failed. */
  awaitingReply: boolean;
  replying: boolean;
  aiSource: PrepAiSource | null;
  turns: MockTurnView[];
  /** Candidate turns so far. */
  answered: number;
  /** When COMPLETED. */
  report: MockReport | null;
  overallScore: number | null;
  /** Why the report or the last reply failed. */
  error: string | null;
  startedAt: string;
  endedAt: string | null;
}

export interface MockInterviewSummary {
  id: string;
  status: MockStatus;
  stage: MockStage;
  overallScore: number | null;
  verdict: MockVerdict | null;
  answered: number;
  startedAt: string;
  endedAt: string | null;
}

/** At least one of text and code. */
export interface MockAnswerInput {
  text?: string;
  code?: string | null;
  codeLanguage?: string | null;
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
  profileCv: ['interview-preps', 'cv', 'profile'] as const,
  // Under interview-preps, so refreshing every prep refreshes these too.
  mock: (id: string) => ['interview-preps', 'mock', id] as const,
  fallback: ['settings', 'ai', 'fallback'] as const,
  fallbackModels: ['settings', 'ai', 'fallback', 'models'] as const,
};

/** How often a prep being written, or a mock interview's reply or report, is checked. */
export const PREP_POLL_MS = 4_000;

/** The CV files `cv/extract` reads, and how big they may be. */
export const CV_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md'] as const;
export const CV_MAX_BYTES = 4 * 1024 * 1024;

const prepPath = (id: string) => `/interview-preps/${encodeURIComponent(id)}`;
const mockPath = (id: string) => `/mock-interviews/${encodeURIComponent(id)}`;

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

// -- The CV -------------------------------------------------------------------

/** A file's bytes as base64 (no `data:` prefix), for `cv/extract`. */
export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'));
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : '';
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
}

/** Reads the text out of a CV file (PDF, DOCX, TXT or MD, 4 MB at most). */
export function useExtractCv() {
  const api = useApi();
  return useMutation({
    mutationFn: async (file: File) =>
      api<CvExtractResult>('/interview-preps/cv/extract', {
        method: 'POST',
        body: { fileName: file.name, contentBase64: await fileToBase64(file) },
      }),
  });
}

/** A CV written from the user's synced Offerpath profile; null when there is none. */
export function useProfileCv(enabled = true): UseQueryResult<string | null> {
  const api = useApi();
  return useQuery({
    queryKey: prepKeys.profileCv,
    queryFn: async () =>
      (await api<{ text: string | null } | null>('/interview-preps/cv/profile'))?.text ?? null,
    enabled,
    staleTime: 60_000,
  });
}

// -- Mock interviews ------------------------------------------------------------

/** Puts a mock interview in the cache and refreshes the prep that lists it. */
function useStoreMock() {
  const queryClient = useQueryClient();
  return (view: MockInterviewView) => {
    queryClient.setQueryData(prepKeys.mock(view.id), view);
    void queryClient.invalidateQueries({ queryKey: prepKeys.detail(view.prepId) });
    void queryClient.invalidateQueries({ queryKey: prepKeys.list });
  };
}

/**
 * The prep's mock interview still in progress, or a new one; `restart`
 * abandons the one in progress first. The opening question is there at once.
 */
export function useStartMockInterview(prepId: string) {
  const api = useApi();
  const store = useStoreMock();
  return useMutation({
    mutationFn: (options: { restart?: boolean } = {}) =>
      api<MockInterviewView>(`${prepPath(prepId)}/mock-interviews`, {
        method: 'POST',
        body: options.restart ? { restart: true } : {},
      }),
    onSuccess: store,
  });
}

/**
 * One mock interview. Polls while the interviewer is replying in the
 * background or the report is being written, and refreshes its prep when
 * the status moves on (the prep lists its interviews' scores).
 */
export function useMockInterview(id: string): UseQueryResult<MockInterviewView> {
  const api = useApi();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: prepKeys.mock(id),
    queryFn: () => api<MockInterviewView>(mockPath(id)),
    enabled: id.length > 0,
    refetchInterval: (q) =>
      q.state.data?.status === 'REPORTING' || q.state.data?.replying ? PREP_POLL_MS : false,
  });
  const status = query.data?.status;
  const prepId = query.data?.prepId;
  const seen = useRef(status);
  useEffect(() => {
    if (seen.current !== undefined && status !== seen.current && prepId) {
      void queryClient.invalidateQueries({ queryKey: prepKeys.detail(prepId) });
      void queryClient.invalidateQueries({ queryKey: prepKeys.list });
    }
    seen.current = status;
  }, [status, prepId, queryClient]);
  return query;
}

/** Whether a failure was a 503: no AI could run it (an answer is still saved). */
export function isServiceUnavailable(error: unknown): boolean {
  return error instanceof ApiError && error.status === 503;
}

/**
 * A request that runs the interviewer. Its view replaces the cached one; on
 * a failure the interview is fetched again, because an answer is saved even
 * when no AI could reply (the page then offers a retry).
 */
function useMockTurn<TInput>(id: string, run: (input: TInput) => Promise<MockInterviewView>) {
  const queryClient = useQueryClient();
  const store = useStoreMock();
  return useMutation({
    mutationFn: run,
    onSuccess: store,
    onError: () => void queryClient.invalidateQueries({ queryKey: prepKeys.mock(id) }),
  });
}

/** Answer the interviewer; resolves with its next turn (5 to 60 seconds). */
export function useAnswerMockInterview(id: string) {
  const api = useApi();
  return useMockTurn(id, (input: MockAnswerInput) =>
    api<MockInterviewView>(`${mockPath(id)}/answer`, { method: 'POST', body: input }),
  );
}

/** Asks the interviewer again to reply to the last answer. */
export function useRetryMockReply(id: string) {
  const api = useApi();
  return useMockTurn(id, () => api<MockInterviewView>(`${mockPath(id)}/reply`, { method: 'POST' }));
}

/** Ends the interview now; the report is written in the background. */
export function useFinishMockInterview(id: string) {
  const api = useApi();
  return useMockTurn(id, () =>
    api<MockInterviewView>(`${mockPath(id)}/finish`, { method: 'POST' }),
  );
}

/** Writes a FAILED report again. */
export function useRetryMockReport(id: string) {
  const api = useApi();
  return useMockTurn(id, () =>
    api<MockInterviewView>(`${mockPath(id)}/report`, { method: 'POST' }),
  );
}

export function useDeleteMockInterview(prepId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(mockPath(id), { method: 'DELETE' }),
    onSuccess: (_void, id) => {
      queryClient.removeQueries({ queryKey: prepKeys.mock(id) });
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
