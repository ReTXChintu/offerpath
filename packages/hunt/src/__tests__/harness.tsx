/**
 * Test harness for hunt pages: a fake HuntClient answering commands from
 * handlers, a recording navigator, and the providers the pages need.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@offerpath/ui';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { vi } from 'vitest';

import { defaultHuntPath, HuntProvider, type HuntClient, type HuntTarget } from '../client';
import type { CommandArgs, CommandName, CommandResult } from '../protocol';
import type {
  AgentStatus,
  AppSettings,
  Application,
  ApplicationDetail,
  Job,
  JobAnalysis,
  Resume,
  SetupStatus,
} from '../types';

export type Handlers = {
  [N in CommandName]?: (args: CommandArgs<N>) => CommandResult<N> | Promise<CommandResult<N>>;
};

export function fakeClient(handlers: Handlers = {}) {
  const invoke = vi.fn(async (command: CommandName, args?: unknown) => {
    const handler = handlers[command] as ((a: unknown) => unknown) | undefined;
    // Anything a test didn't script resolves to null, like an empty store.
    return handler ? handler(args ?? {}) : null;
  });
  const client: HuntClient = {
    invoke: invoke as unknown as HuntClient['invoke'],
    listen: vi.fn(async () => () => undefined) as unknown as HuntClient['listen'],
    pickFiles: vi.fn(async () => []),
  };
  /** The arguments of every call to `command`, in order. */
  const callsTo = (command: CommandName) =>
    invoke.mock.calls.filter(([c]) => c === command).map(([, args]) => args);
  return { client, invoke, callsTo };
}

export type RenderHuntResult = RenderResult &
  ReturnType<typeof fakeClient> & {
    navigator: { href: (t: HuntTarget) => string; navigate: (t: HuntTarget) => void };
    navigated: HuntTarget[];
    queryClient: QueryClient;
  };

export function renderHunt(ui: ReactElement, handlers: Handlers = {}): RenderHuntResult {
  const { client, invoke, callsTo } = fakeClient(handlers);
  const navigated: HuntTarget[] = [];
  const navigator = {
    href: (t: HuntTarget) => `#${defaultHuntPath(t)}`,
    navigate: vi.fn((t: HuntTarget) => {
      navigated.push(t);
    }),
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <HuntProvider client={client} navigator={navigator}>
        {ui}
        <Toaster />
      </HuntProvider>
    </QueryClientProvider>,
  );
  return { ...result, client, invoke, callsTo, navigator, navigated, queryClient };
}

// ---- fixtures -------------------------------------------------------------------------

const NOW = '2026-10-16T09:00:00Z';

export function job(over: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    userId: 'u',
    discoveredAt: NOW,
    postedAt: null,
    source: 'LinkedIn',
    sourceJobId: null,
    url: 'https://jobs.example.com/1',
    canonicalUrl: null,
    company: 'Acme',
    title: 'Senior Frontend Engineer',
    location: 'Mumbai',
    employmentType: null,
    remote: null,
    salary: null,
    seniority: null,
    description: 'Build the web app.',
    requirements: [],
    responsibilities: [],
    skills: ['React'],
    sources: [],
    status: 'READY_FOR_REVIEW',
    runId: null,
    analysisId: null,
    applicationId: 'app-1',
    saved: false,
    detailsComplete: true,
    applyEmail: null,
    contactName: null,
    dedupKey: '',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

export function analysis(over: Partial<JobAnalysis> = {}): JobAnalysis {
  return {
    id: 'an-1',
    jobId: 'job-1',
    userId: 'u',
    relevant: true,
    matchScore: 82,
    matchedSkills: ['React', 'TypeScript'],
    missingSkills: [],
    requiredExperienceMet: true,
    seniorityMatch: true,
    locationMatch: true,
    employmentTypeMatch: true,
    salaryAssessment: '',
    requiredQualifications: [],
    niceToHave: [],
    concerns: [],
    importantKeywords: [],
    summary: 'A strong match.',
    runId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

export function application(over: Partial<Application> = {}): Application {
  return {
    id: 'app-1',
    userId: 'u',
    jobId: 'job-1',
    status: 'READY_FOR_REVIEW',
    resumeId: 'res-1',
    coverLetterId: null,
    applicationUrl: '',
    source: 'LinkedIn',
    notes: '',
    answers: [],
    pendingQuestions: [],
    statusHistory: [],
    potentialIssues: [],
    approvedAt: null,
    appliedAt: null,
    failureReason: null,
    evidence: null,
    claudeSessionId: null,
    runId: null,
    manualCompleted: false,
    replies: [],
    emailDraftedAt: null,
    interviews: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

export function resume(over: Partial<Resume> = {}): Resume {
  return {
    id: 'res-1',
    userId: 'u',
    kind: 'GENERATED',
    jobId: 'job-1',
    company: 'Acme',
    jobTitle: 'Senior Frontend Engineer',
    version: 1,
    label: 'Acme v1',
    docxPath: null,
    pdfPath: null,
    htmlPath: null,
    jsonPath: null,
    content: null,
    validation: null,
    runId: null,
    userEdited: false,
    filesDeletedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

export function applicationDetail(
  over: { application?: Partial<Application>; job?: Partial<Job> } = {},
): ApplicationDetail {
  return {
    application: application(over.application),
    job: job(over.job),
    analysis: analysis(),
    resume: resume(),
    coverLetter: null,
  };
}

export function agentStatus(over: Partial<AgentStatus> = {}): AgentStatus {
  return {
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
    ...over,
  };
}

/** Only the fields the pages under test read. */
export function settings(over: Partial<AppSettings> = {}): AppSettings {
  return { mockMode: false, setupCompleted: false, ...over } as AppSettings;
}

export function setupStatus(over: Partial<SetupStatus> = {}): SetupStatus {
  return {
    claude: {
      installed: true,
      path: 'C:/claude.cmd',
      version: '2.1.0',
      authenticated: true,
      authMethod: 'oauth',
      account: 'me@example.com',
      subscription: 'Max',
      error: null,
    },
    chrome: {
      installed: true,
      path: 'C:/chrome.exe',
      version: '140',
      extensionInstalled: true,
      extensionVersion: '1.0',
      profilesChecked: [],
      error: null,
    },
    backend: {
      configured: false,
      connected: false,
      pending: 0,
      lastSyncAt: null,
      lastError: null,
      target: null,
      syncing: false,
    },
    profile: { ready: false, missing: ['name'], hasMasterResume: false },
    mockMode: false,
    setupCompleted: false,
    dataDir: 'C:/Offerpath',
    ...over,
  };
}
