import {
  BackendError,
  type AgentRun,
  type AgentStatus,
  type Application,
  type ApplicationDetail,
  type ApplicationListItem,
  type CoverLetter,
  type HuntClient,
  type Job,
  type JobAnalysis,
  type JobDetail,
  type JobListItem,
  type Notification,
  type QueuedTask,
  type Resume,
  type Submission,
} from '@offerpath/hunt';
import { ApiError, type LearnClient } from '@offerpath/learn';

/**
 * The hunt pages' client on the web: a remote control for the desktop.
 *
 * Reads come from what the desktop synced to the server
 * (`GET /applications`, `/jobs`, `/data/:collection`), so they work while
 * the desktop is offline. Actions go through `POST /desktop/request`, the
 * same request types the phone sends over the hub; the desktop runs each one
 * through the same approval-gated code as its own buttons. Anything that
 * needs the desktop's own files or Chrome is refused with a sentence saying
 * so.
 */

/** Request types the desktop answers (offerpath-core's remote dispatch). */
const DESKTOP_REQUESTS = new Set([
  'approve_application',
  'reject_application',
  'apply_application',
  'answer_application_questions',
  'mark_manual_application_complete',
  'set_application_status',
  'record_interview',
  'get_agent_status',
  'start_job_hunt',
  'stop_job_hunt',
  'check_inbox',
  'generate_resume',
  'reject_job',
  'list_platform_profiles',
  'sync_platform_profile',
  'apply_from_link',
  'add_shared_job',
  'list_queue',
  'remove_queued_task',
  'clear_queue',
  'queue_profile_updates',
  'answer_platform_questions',
  'list_answers',
  'save_answer',
]);

/** What to say when the desktop can't do something. */
const DESKTOP_ERROR_MESSAGES: Record<string, string> = {
  DESKTOP_OFFLINE:
    'Your desktop is offline: AI and job hunting wait for it. Open Offerpath on your computer and try again.',
  DESKTOP_TIMEOUT:
    "Your desktop didn't answer in time. Make sure Offerpath is running on your computer and try again.",
  AGENT_BUSY: 'The agent on your desktop is busy with another task. Try again once it finishes.',
  INVALID_TRANSITION:
    "This application changed since the page loaded, so that's no longer possible. Refresh to see where it stands.",
  NOT_FOUND: "Your desktop couldn't find this item. It may have been removed.",
  DESKTOP_ONLY: 'That can only be done in the Offerpath desktop app.',
};

export function desktopErrorMessage(code: string, fallback: string): string {
  return DESKTOP_ERROR_MESSAGES[code] ?? (fallback.trim() || "Your desktop couldn't do that.");
}

function desktopOnly(): BackendError {
  return new BackendError({
    code: 'DESKTOP_ONLY',
    message: DESKTOP_ERROR_MESSAGES.DESKTOP_ONLY!,
    details: null,
    recoverable: false,
  });
}

/** The payload a command's Tauri arguments become as a desktop request. */
export function toDesktopRequest(
  command: string,
  args: Record<string, unknown> = {},
): { type: string; payload: Record<string, unknown> } | null {
  switch (command) {
    case 'start_job_hunt':
      return { type: 'start_job_hunt', payload: (args.options as Record<string, unknown>) ?? {} };
    case 'discover_jobs':
      return {
        type: 'start_job_hunt',
        payload: { discoverOnly: true, ...(args.sources ? { sources: args.sources } : {}) },
      };
    case 'prepare_applications':
      return { type: 'start_job_hunt', payload: { prepareOnly: true } };
    case 'check_inbox_now':
      return { type: 'check_inbox', payload: {} };
    case 'record_interview': {
      const { id, interview } = args as { id: string; interview?: Record<string, unknown> };
      return { type: 'record_interview', payload: { id, ...(interview ?? {}) } };
    }
    case 'save_answer': {
      const record = (args.record ?? {}) as { id?: string; question?: string; answer?: string };
      return {
        type: 'save_answer',
        payload: { id: record.id ?? '', question: record.question, answer: record.answer },
      };
    }
    case 'answer_application_questions': {
      const { id, answers } = args as {
        id: string;
        answers: { question: string; answer: string }[];
      };
      return {
        type: 'answer_application_questions',
        payload: { id, answers: answers.map((a) => ({ question: a.question, answer: a.answer })) },
      };
    }
    default:
      return DESKTOP_REQUESTS.has(command) ? { type: command, payload: args } : null;
  }
}

const IDLE_AGENT: AgentStatus = {
  state: 'IDLE',
  runId: null,
  runKind: null,
  currentActivity: null,
  progress: null,
  stats: {
    jobsDiscovered: 0,
    jobsNew: 0,
    duplicatesRemoved: 0,
    jobsAnalyzed: 0,
    relevant: 0,
    awaitingApproval: 0,
    approved: 0,
    applied: 0,
    manualAction: 0,
    errors: 0,
    claudeCostUsd: 0,
  },
  startedAt: null,
  error: null,
  mock: false,
  paused: false,
  queued: 0,
};

type Docs<T> = { documents: T[] };

/**
 * The relay answers a started or queued task as `{ runId, queued, queuedId,
 * position, title }`; the hunt pages read the desktop's `Submission`.
 */
export function asSubmission(data: unknown): unknown {
  if (
    !data ||
    typeof data !== 'object' ||
    typeof (data as { queued?: unknown }).queued !== 'boolean'
  ) {
    return data;
  }
  const d = data as {
    runId?: string;
    queued: boolean;
    queuedId?: string;
    position?: number;
    title?: string;
  };
  const submission: Submission = {
    run: d.runId ? ({ id: d.runId } as AgentRun) : null,
    queued: d.queued
      ? ({ id: d.queuedId ?? '', title: d.title ?? 'The task' } as QueuedTask)
      : null,
    position: d.position ?? 0,
  };
  return submission;
}

export function httpHuntClient(api: LearnClient): HuntClient {
  const get = <T>(path: string) => api.request<T>(path);
  const collection = async <T>(name: string) =>
    (await get<Docs<T>>(`/data/${encodeURIComponent(name)}`)).documents;

  async function desktop<T>(type: string, payload: Record<string, unknown>): Promise<T> {
    try {
      const reply = await api.request<{ data: T }>('/desktop/request', {
        method: 'POST',
        body: { type, payload },
      });
      return asSubmission(reply.data) as T;
    } catch (e) {
      // The relay answers `{ error: { code, message } }`; the API's own
      // failures are problem details.
      if (e instanceof ApiError) {
        const relayed = (e.body as { error?: { code?: string; message?: string } } | null)?.error;
        const code =
          relayed?.code ??
          (e.status === 503
            ? 'DESKTOP_OFFLINE'
            : e.status === 504
              ? 'DESKTOP_TIMEOUT'
              : e.kind.toUpperCase());
        throw new BackendError({
          code,
          message: desktopErrorMessage(code, relayed?.message ?? e.message),
          details: null,
          recoverable: true,
        });
      }
      throw e;
    }
  }

  async function jobItems(): Promise<JobListItem[]> {
    const [{ jobs }, analyses, applications] = await Promise.all([
      get<{ jobs: Job[] }>('/jobs'),
      collection<JobAnalysis>('job_analyses'),
      collection<Application>('applications'),
    ]);
    const analysisByJob = new Map(analyses.map((a) => [a.jobId, a]));
    const statusByJob = new Map(applications.map((a) => [a.jobId, a.status]));
    return jobs.map((job) => ({
      job,
      analysis: analysisByJob.get(job.id) ?? null,
      applicationStatus: statusByJob.get(job.id) ?? null,
    }));
  }

  async function documents(): Promise<{ resumes: Resume[]; coverLetters: CoverLetter[] }> {
    const [resumes, coverLetters] = await Promise.all([
      collection<Resume>('resumes').catch(() => []),
      collection<CoverLetter>('cover_letters').catch(() => []),
    ]);
    return { resumes, coverLetters };
  }

  const reads: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    list_applications: () => get<ApplicationListItem[]>('/applications'),
    get_application: async ({ id }) => {
      const [item, docs] = await Promise.all([
        get<ApplicationListItem>(`/applications/${encodeURIComponent(String(id))}`),
        documents(),
      ]);
      const detail: ApplicationDetail = {
        ...item,
        resume: docs.resumes.find((r) => r.id === item.application.resumeId) ?? null,
        coverLetter: docs.coverLetters.find((c) => c.id === item.application.coverLetterId) ?? null,
      };
      return detail;
    },
    list_jobs: () => jobItems(),
    get_job: async ({ id }) => {
      const [items, applications, docs] = await Promise.all([
        jobItems(),
        collection<Application>('applications'),
        documents(),
      ]);
      const item = items.find((i) => i.job.id === id);
      if (!item) {
        throw new BackendError({
          code: 'NOT_FOUND',
          message: 'This job is not in what your desktop has synced.',
          details: null,
          recoverable: false,
        });
      }
      const application = applications.find((a) => a.jobId === id) ?? null;
      const resumes = docs.resumes.filter((r) => r.jobId === id);
      const detail: JobDetail = {
        job: item.job,
        analysis: item.analysis,
        application,
        resume: resumes.find((r) => r.id === application?.resumeId) ?? resumes[0] ?? null,
        coverLetter: docs.coverLetters.find((c) => c.id === application?.coverLetterId) ?? null,
        resumes,
      };
      return detail;
    },
    list_notifications: async ({ limit }) =>
      (await collection<Notification>('notifications'))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, typeof limit === 'number' ? limit : 50),
    get_agent_status: async () => {
      try {
        const summary = await desktop<Partial<AgentStatus>>('get_agent_status', {});
        return { ...IDLE_AGENT, ...summary };
      } catch (e) {
        // Offline is a state, not an error, for the status pill.
        if (e instanceof BackendError && e.code === 'DESKTOP_OFFLINE') return IDLE_AGENT;
        throw e;
      }
    },
  };

  return {
    invoke: (async (command: string, args?: Record<string, unknown>) => {
      if (command === 'open_url') {
        const url = String(args?.url ?? '');
        if (/^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener,noreferrer');
        return null;
      }
      const read = reads[command];
      if (read) return read(args ?? {});
      const request = toDesktopRequest(command, args ?? {});
      if (request) return desktop(request.type, request.payload);
      throw desktopOnly();
    }) as HuntClient['invoke'],
    // No live events on the web: the pages refetch on focus and after actions.
    listen: (async () => () => undefined) as HuntClient['listen'],
  };
}
