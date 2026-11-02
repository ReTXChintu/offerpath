import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useApi, type ApiRequest } from '../context';

import { ApiError, type LearnClient } from './api';

/**
 * Live practice with a partner (`docs/live-practice.md`): the API's types
 * and calls. The session itself (the microphone, OpenAI Realtime, the voice
 * check) is in `lib/live/`.
 */

export type AnswerFor = 'me' | 'neutral';
export type LiveStatus = 'ACTIVE' | 'ENDED';

export interface LiveExchange {
  id: string;
  /** 0-based. */
  order: number;
  question: string;
  answer: string;
  /** Always 'me' now; 'neutral' only on exchanges saved before. */
  answerFor: AnswerFor;
  createdAt: string;
}

export interface LivePracticeView {
  id: string;
  prepId: string | null;
  title: string;
  technologies: string[];
  answerFor: AnswerFor;
  status: LiveStatus;
  exchanges: LiveExchange[];
  createdAt: string;
  endedAt: string | null;
}

export interface LivePracticeSummary {
  id: string;
  prepId: string | null;
  title: string;
  status: LiveStatus;
  exchanges: number;
  createdAt: string;
  endedAt: string | null;
}

export interface RealtimePass {
  /** `ek_...`: a short-lived OpenAI client secret, never the user's key. */
  clientSecret: string;
  expiresAt: string;
  model: string;
  /** `wss://api.openai.com/v1/realtime?model=<model>` */
  url: string;
}

export interface VoiceProfile {
  /** The speaker model's file name, e.g. 'wespeaker_en_voxceleb_resnet34_LM.onnx'. */
  model: string;
  embedding: number[];
  /** 0-1: at or above it, a turn is the interviewee's. */
  threshold: number;
  updatedAt: string;
}

export interface SpeakerModelInfo {
  fileName: string;
  sizeBytes: number;
  /** Hex. */
  sha256: string;
  /** `/api/v1/downloads/speaker-model/file` */
  url: string;
}

export interface LiveReady {
  ready: boolean;
  reason: string | null;
}

export interface LivePracticeInput {
  prepId?: string | null;
  technologies?: string[];
  title?: string;
}

/** The threshold a new voiceprint starts with (the API's default). */
export const DEFAULT_VOICE_THRESHOLD = 0.5;
export const VOICE_THRESHOLD_MIN = 0.2;
export const VOICE_THRESHOLD_MAX = 0.8;

/** Where to add the OpenAI key. */
export const LIVE_OPENAI_KEY_HINT = 'Add your OpenAI key in Settings → AI.';

/**
 * The sentence for a failed live-practice call. A 503 here means OpenAI
 * refused (never the desktop), so it shows OpenAI's own message, which the
 * API passes on as the detail, not the desktop-offline wording.
 */
export function liveErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return error.message;
    if (error.status === 503 || error.kind === 'ai-unavailable') {
      const detail = error.problem.detail?.trim() ?? '';
      return detail.length > 0 ? detail : "OpenAI didn't answer.";
    }
    return error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return "Couldn't reach the Offerpath server. Check your connection.";
}

const livePath = (id: string) => `/live-practice/${encodeURIComponent(id)}`;

/** The live-practice calls, over the learning pages' client. */
export function liveApi(api: ApiRequest) {
  return {
    ready: () => api<LiveReady>('/live-practice/ready'),
    list: async () =>
      (await api<{ sessions: LivePracticeSummary[] }>('/live-practice')).sessions ?? [],
    start: (input: LivePracticeInput) => {
      const technologies = (input.technologies ?? []).map((t) => t.trim()).filter(Boolean);
      const title = input.title?.trim() ?? '';
      return api<LivePracticeView>('/live-practice', {
        method: 'POST',
        body: {
          ...(input.prepId ? { prepId: input.prepId } : {}),
          ...(technologies.length > 0 ? { technologies } : {}),
          ...(title.length > 0 ? { title } : {}),
        },
      });
    },
    get: (id: string) => api<LivePracticeView>(livePath(id)),
    realtime: (id: string) => api<RealtimePass>(`${livePath(id)}/realtime`, { method: 'POST' }),
    saveExchange: (id: string, question: string, answer: string) =>
      api<LiveExchange>(`${livePath(id)}/exchanges`, {
        method: 'POST',
        body: { question: question.trim().slice(0, 2000), answer: answer.trim().slice(0, 8000) },
      }),
    end: (id: string) => api<LivePracticeView>(`${livePath(id)}/end`, { method: 'POST' }),
    remove: (id: string) => api<void>(livePath(id), { method: 'DELETE' }),
    // Your voice.
    voice: async (): Promise<VoiceProfile | null> => {
      try {
        return await api<VoiceProfile>('/live-practice/voice');
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    saveVoice: (model: string, embedding: number[], threshold = DEFAULT_VOICE_THRESHOLD) =>
      api<VoiceProfile>('/live-practice/voice', {
        method: 'PUT',
        body: { model, embedding, threshold },
      }),
    setThreshold: (threshold: number) =>
      api<VoiceProfile>('/live-practice/voice', { method: 'PATCH', body: { threshold } }),
    deleteVoice: () => api<void>('/live-practice/voice', { method: 'DELETE' }),
    modelInfo: async (): Promise<SpeakerModelInfo | null> => {
      try {
        return await api<SpeakerModelInfo>('/downloads/speaker-model');
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
  };
}

export type LiveApi = ReturnType<typeof liveApi>;

/**
 * A new session like `old`: the same prep, technologies and title (never
 * its answerFor: answers are always the user's now).
 */
export function restartInput(old: LivePracticeView): LivePracticeInput {
  return { prepId: old.prepId, technologies: old.technologies, title: old.title };
}

export const liveKeys = {
  all: ['live-practice'] as const,
  list: ['live-practice', 'list'] as const,
  ready: ['live-practice', 'ready'] as const,
  voice: ['live-practice', 'voice'] as const,
  detail: (id: string) => ['live-practice', 'detail', id] as const,
};

/** The calls, stable for as long as the client is. */
export function useLiveApi(): LiveApi {
  const api = useApi();
  return useMemo(() => liveApi(api), [api]);
}

/** Every session, newest first. */
export function useLivePractices(): UseQueryResult<LivePracticeSummary[]> {
  const api = useLiveApi();
  return useQuery({ queryKey: liveKeys.list, queryFn: api.list });
}

export function useLiveReady(enabled = true): UseQueryResult<LiveReady> {
  const api = useLiveApi();
  return useQuery({ queryKey: liveKeys.ready, queryFn: api.ready, enabled });
}

/** The user's voiceprint; null before one is saved. */
export function useVoiceProfile(): UseQueryResult<VoiceProfile | null> {
  const api = useLiveApi();
  return useQuery({ queryKey: liveKeys.voice, queryFn: api.voice });
}

/**
 * Starts a session. Resolves with the new session; it's put in the cache so
 * its page opens without loading it again.
 */
export function useStartLivePractice() {
  const api = useLiveApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LivePracticeInput) => api.start(input),
    onSuccess: (view) => {
      queryClient.setQueryData(liveKeys.detail(view.id), view);
      void queryClient.invalidateQueries({ queryKey: liveKeys.list });
    },
  });
}

/**
 * Restarts an ended session: loads it (for its prep, technologies and
 * title) and starts a new one like it.
 */
export function useRestartLivePractice() {
  const api = useLiveApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (old: LivePracticeView | string) => {
      const view = typeof old === 'string' ? await api.get(old) : old;
      return api.start(restartInput(view));
    },
    onSuccess: (view) => {
      queryClient.setQueryData(liveKeys.detail(view.id), view);
      void queryClient.invalidateQueries({ queryKey: liveKeys.list });
    },
  });
}

// -- Starting a page listening ------------------------------------------------

const autoStart = new Set<string>();

/** The session page opened next for `id` starts listening at once (a new or restarted session). */
export function markAutoStart(id: string): void {
  autoStart.add(id);
}

/** Whether `id`'s page should start listening; it's asked once. */
export function takeAutoStart(id: string): boolean {
  return autoStart.delete(id);
}

// -- The speaker model ----------------------------------------------------------

/**
 * The speaker model in this browser: downloaded once from the server,
 * checked against its sha256, and kept in the Cache API under its hash.
 */
export interface SpeakerModelStore {
  /** The model's bytes when they're here and check out; null otherwise. */
  local(info: SpeakerModelInfo): Promise<Uint8Array | null>;
  /** Downloads it, checks its sha256 and keeps it. `onProgress` gets 0-1, or null when unknown. */
  download(
    info: SpeakerModelInfo,
    onProgress?: (progress: number | null) => void,
  ): Promise<Uint8Array>;
}

/** A download that arrived damaged (its sha256 doesn't match). */
export class SpeakerModelError extends Error {}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

const MODEL_CACHE = 'offerpath-speaker-model';
const modelKey = (sha: string) => `/__offerpath/speaker-model/${sha}`;

/** The API path of the model's file (`url` is under `/api/v1`, the client's base). */
export function modelPath(info: SpeakerModelInfo): string {
  const url = info.url || '/api/v1/downloads/speaker-model/file';
  const i = url.indexOf('/downloads/');
  return i >= 0 ? url.slice(i) : '/downloads/speaker-model/file';
}

/** `SpeakerModelStore` on the client's `download` and the Cache API. */
export function browserModelStore(client: LearnClient): SpeakerModelStore {
  const cache = async () =>
    typeof caches === 'undefined' ? null : await caches.open(MODEL_CACHE).catch(() => null);
  return {
    async local(info) {
      const store = await cache();
      const hit = await store?.match(modelKey(info.sha256));
      if (!store || !hit) return null;
      const bytes = new Uint8Array(await hit.arrayBuffer());
      if ((await sha256Hex(bytes)) === info.sha256.toLowerCase()) return bytes;
      await store.delete(modelKey(info.sha256));
      return null;
    },
    async download(info, onProgress) {
      if (!client.download) {
        throw new SpeakerModelError("This app can't download the voice model.");
      }
      const buffer = await client.download(modelPath(info), {
        onProgress: (received, total) => {
          const size = total && total > 0 ? total : info.sizeBytes;
          onProgress?.(size > 0 ? Math.min(1, received / size) : null);
        },
      });
      const bytes = new Uint8Array(buffer);
      if ((await sha256Hex(bytes)) !== info.sha256.toLowerCase()) {
        throw new SpeakerModelError(
          "The voice model didn't download properly (its checksum doesn't match). Try again.",
        );
      }
      const store = await cache();
      if (store) {
        // Older models are of no use any more.
        for (const key of await store.keys()) await store.delete(key);
        await store
          .put(
            modelKey(info.sha256),
            new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } }),
          )
          .catch(() => undefined);
      }
      return bytes;
    },
  };
}
