/**
 * TanStack Query hooks over the hunt commands, ported from Job Hunter's
 * `apps/desktop/src/lib/queries.ts`. Command names, arguments, query keys
 * and invalidations are unchanged; only the transport is injected.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@offerpath/ui';

import { useInvoke } from './client';
import { isAgentRunning } from './logic';
import type { SkillGroup } from './protocol';
import type {
  AgentStatus,
  AnswerRecord,
  AppSettings,
  ApplicationAnswer,
  ApplicationStatus,
  CandidateProfile,
  Experience,
  InterviewInput,
  JobHuntOptions,
  LogLevel,
  Project,
  ProjectPick,
  ResumeDocument,
  Submission,
} from './types';

interface AuthArgs {
  email: string;
  password: string;
  deviceName?: string;
}

export const keys = {
  setup: ['setup'] as const,
  legacyImport: ['legacyImport'] as const,
  settings: ['settings'] as const,
  sync: ['sync'] as const,
  profile: ['profile'] as const,
  experiences: ['experiences'] as const,
  projects: ['projects'] as const,
  masterResumeText: ['masterResumeText'] as const,
  jobs: ['jobs'] as const,
  job: (id: string) => ['job', id] as const,
  applications: ['applications'] as const,
  application: (id: string) => ['application', id] as const,
  resumes: ['resumes'] as const,
  answers: ['answers'] as const,
  agentStatus: ['agentStatus'] as const,
  runs: ['runs'] as const,
  runEvents: (id: string) => ['runEvents', id] as const,
  logs: (level: LogLevel) => ['logs', level] as const,
  dashboard: ['dashboard'] as const,
  file: (path: string) => ['file', path] as const,
  remoteStatus: ['remoteStatus'] as const,
  remoteDevices: ['remoteDevices'] as const,
  platformProfiles: ['platformProfiles'] as const,
  notifications: ['notifications'] as const,
  publishingPlan: ['publishingPlan'] as const,
  queue: ['queue'] as const,
};

/** Collections → query keys to invalidate when the backend reports a change. */
export const COLLECTION_KEYS: Record<string, readonly (readonly string[])[]> = {
  jobs: [keys.jobs, keys.dashboard, ['job']],
  job_analyses: [keys.jobs, keys.dashboard, ['job'], ['application']],
  applications: [keys.applications, keys.jobs, keys.dashboard, ['application'], ['job']],
  resumes: [keys.resumes, ['job'], ['application']],
  cover_letters: [['job'], ['application']],
  candidate_profiles: [keys.profile, keys.setup, keys.platformProfiles],
  experiences: [keys.experiences, keys.platformProfiles],
  projects: [keys.projects, keys.platformProfiles],
  platform_profiles: [keys.platformProfiles],
  publishing_plans: [keys.publishingPlan, keys.platformProfiles],
  notifications: [keys.notifications],
  application_answers: [keys.answers],
  agent_runs: [keys.runs, keys.dashboard],
  agent_queue: [keys.queue],
  agent_events: [['runEvents']],
  settings: [keys.settings],
  users: [],
};

// ---- queued work ------------------------------------------------------------------------

/** Tell the user when a start request had to wait its turn. */
export function announce(s: Submission) {
  if (!s.queued) return;
  toast.show({
    type: 'info',
    title: `Queued (#${s.position})`,
    description: `${s.queued.title} starts when the agent is free.`,
  });
}

/** Wrap a mutation's onSuccess so queued requests are announced first. */
export function announcing(then: () => void) {
  return (s: Submission) => {
    announce(s);
    then();
  };
}

function useInvalidate() {
  const qc = useQueryClient();
  return (...groups: (readonly (readonly string[])[])[]) => {
    for (const group of groups)
      for (const key of group) void qc.invalidateQueries({ queryKey: key });
  };
}

// ---- reads ------------------------------------------------------------------------------

export const useSetupStatus = () => {
  const invoke = useInvoke();
  return useQuery({
    queryKey: keys.setup,
    queryFn: () => invoke('get_setup_status'),
    staleTime: 30_000,
  });
};
/** Old Job Hunter data on this computer, offered once on the first-run screen. */
export const useLegacyImport = () => {
  const invoke = useInvoke();
  return useQuery({
    queryKey: keys.legacyImport,
    queryFn: () => invoke('get_legacy_import'),
    staleTime: Infinity,
  });
};
export const useSettings = () => {
  const invoke = useInvoke();
  return useQuery({ queryKey: keys.settings, queryFn: () => invoke('get_settings') });
};
export const useSyncStatus = () => {
  const invoke = useInvoke();
  return useQuery({
    queryKey: keys.sync,
    queryFn: () => invoke('get_sync_status'),
    refetchInterval: 30_000,
  });
};
export const useProfile = () => {
  const invoke = useInvoke();
  return useQuery({ queryKey: keys.profile, queryFn: () => invoke('get_candidate_profile') });
};
export const useExperiences = () => {
  const invoke = useInvoke();
  return useQuery({ queryKey: keys.experiences, queryFn: () => invoke('list_experiences') });
};
export const useProjects = () => {
  const invoke = useInvoke();
  return useQuery({ queryKey: keys.projects, queryFn: () => invoke('list_projects') });
};
export const useMasterResumeText = () => {
  const invoke = useInvoke();
  return useQuery({
    queryKey: keys.masterResumeText,
    queryFn: () => invoke('get_master_resume_text'),
  });
};
export const useJobs = () => {
  const invoke = useInvoke();
  return useQuery({ queryKey: keys.jobs, queryFn: () => invoke('list_jobs') });
};
export const useJob = (id: string) => {
  const invoke = useInvoke();
  return useQuery({
    queryKey: keys.job(id),
    queryFn: () => invoke('get_job', { id }),
    enabled: !!id,
  });
};
export const useApplications = () => {
  const invoke = useInvoke();
  return useQuery({ queryKey: keys.applications, queryFn: () => invoke('list_applications') });
};
export const useApplication = (id: string) => {
  const invoke = useInvoke();
  return useQuery({
    queryKey: keys.application(id),
    queryFn: () => invoke('get_application', { id }),
    enabled: !!id,
  });
};
export const useResumes = () => {
  const invoke = useInvoke();
  return useQuery({ queryKey: keys.resumes, queryFn: () => invoke('list_resumes') });
};
export const useAnswers = () => {
  const invoke = useInvoke();
  return useQuery({ queryKey: keys.answers, queryFn: () => invoke('list_answers') });
};
export const useAgentStatus = () => {
  const invoke = useInvoke();
  return useQuery({
    queryKey: keys.agentStatus,
    queryFn: () => invoke('get_agent_status'),
    refetchInterval: 15_000,
  });
};
export const useQueue = () => {
  const invoke = useInvoke();
  return useQuery({
    queryKey: keys.queue,
    queryFn: () => invoke('list_queue'),
    refetchInterval: 30_000,
  });
};
export const useRuns = (limit = 20) => {
  const invoke = useInvoke();
  return useQuery({
    queryKey: [...keys.runs, limit],
    queryFn: () => invoke('list_agent_runs', { limit }),
  });
};
export const useRunEvents = (runId: string | null) => {
  const invoke = useInvoke();
  return useQuery({
    queryKey: keys.runEvents(runId ?? ''),
    queryFn: () => invoke('get_run_events', { runId: runId ?? '', limit: 500 }),
    enabled: !!runId,
  });
};
export const useLogs = (minLevel: LogLevel) => {
  const invoke = useInvoke();
  return useQuery({
    queryKey: keys.logs(minLevel),
    queryFn: () => invoke('get_logs', { minLevel, limit: 1000 }),
  });
};
export const useDashboard = () => {
  const invoke = useInvoke();
  return useQuery({
    queryKey: keys.dashboard,
    queryFn: () => invoke('get_dashboard'),
    refetchInterval: 20_000,
  });
};
export const useTextFile = (path: string | null | undefined) => {
  const invoke = useInvoke();
  return useQuery({
    queryKey: keys.file(path ?? ''),
    queryFn: () => invoke('read_text_file', { path: path ?? '' }),
    enabled: !!path,
    staleTime: 60_000,
  });
};
export const useServerInfo = () => {
  const invoke = useInvoke();
  return useQuery({
    queryKey: ['serverInfo'],
    queryFn: () => invoke('get_server_info'),
    staleTime: Infinity,
  });
};
export const useAboutInfo = () => {
  const invoke = useInvoke();
  return useQuery({
    queryKey: ['aboutInfo'],
    queryFn: () => invoke('get_about_info'),
    staleTime: Infinity,
  });
};
/** Checked on start and every 6 hours; also refetched by "Check for updates". */
export const useUpdateCheck = () => {
  const invoke = useInvoke();
  return useQuery({
    queryKey: ['updateCheck'],
    queryFn: () => invoke('check_for_update'),
    staleTime: 60 * 60_000,
    refetchInterval: 6 * 60 * 60_000,
    retry: false,
  });
};
export const usePlatformProfiles = () => {
  const invoke = useInvoke();
  return useQuery({
    queryKey: keys.platformProfiles,
    queryFn: () => invoke('list_platform_profiles'),
  });
};
export const usePublishingPlan = () => {
  const invoke = useInvoke();
  return useQuery({ queryKey: keys.publishingPlan, queryFn: () => invoke('get_publishing_plan') });
};
export const useNotifications = () => {
  const invoke = useInvoke();
  return useQuery({
    queryKey: keys.notifications,
    queryFn: () => invoke('list_notifications', { limit: 50 }),
  });
};
export const useRemoteStatus = () => {
  const invoke = useInvoke();
  return useQuery({ queryKey: keys.remoteStatus, queryFn: () => invoke('get_remote_status') });
};
export const useRemoteDevices = (enabled: boolean) => {
  const invoke = useInvoke();
  return useQuery({
    queryKey: keys.remoteDevices,
    queryFn: () => invoke('remote_list_devices'),
    enabled,
    refetchInterval: enabled ? 15_000 : false,
  });
};

// ---- settings, account, updates ---------------------------------------------------------

export function useSaveSettings() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (settings: AppSettings) => invoke('save_settings', { settings }),
    onSuccess: () => inv([keys.settings, keys.setup, keys.dashboard]),
  });
}

export function useImportLegacyData() {
  const invoke = useInvoke();
  return useMutation({ mutationFn: () => invoke('import_legacy_data') });
}

export function useInstallUpdate() {
  const invoke = useInvoke();
  return useMutation({ mutationFn: () => invoke('install_update') });
}

export function useTestBackend() {
  const invoke = useInvoke();
  return useMutation({ mutationFn: () => invoke('test_backend') });
}

export function useBackendRegister() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (args: AuthArgs) => invoke('backend_register', args),
    onSuccess: () => inv([keys.setup, keys.sync, keys.settings, keys.dashboard]),
  });
}

export function useBackendLogin() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (args: AuthArgs) => invoke('backend_login', args),
    onSuccess: () => inv([keys.setup, keys.sync, keys.settings, keys.dashboard]),
  });
}

export function useBackendLogout() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: () => invoke('backend_logout'),
    onSuccess: () => inv([keys.setup, keys.sync, keys.settings, keys.dashboard]),
  });
}

// ---- candidate --------------------------------------------------------------------------

export function useSaveProfile() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (profile: CandidateProfile) => invoke('save_candidate_profile', { profile }),
    onSuccess: () => inv([keys.profile, keys.setup]),
  });
}

export function useSaveExperience() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (experience: Experience) => invoke('save_experience', { experience }),
    onSuccess: () => inv([keys.experiences]),
  });
}

export function useDeleteExperience() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => invoke('delete_experience', { id }),
    onSuccess: () => inv([keys.experiences]),
  });
}

export function useSaveProject() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (project: Project) => invoke('save_project', { project }),
    onSuccess: () => inv([keys.projects]),
  });
}

/** Claude drafts a project from the candidate's description; nothing is saved. */
export function useDraftProject() {
  const invoke = useInvoke();
  return useMutation({
    mutationFn: (args: { description: string; experienceId?: string | null }) =>
      invoke('draft_project', args),
  });
}

export function useDeleteProject() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => invoke('delete_project', { id }),
    onSuccess: () => inv([keys.projects]),
  });
}

/** "I know this": add skills an analysis listed as missing to the profile. */
export function useMarkSkillsKnown() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (args: { skills: string[]; group: SkillGroup }) =>
      invoke('mark_skills_known', args),
    onSuccess: () =>
      inv([keys.profile, keys.jobs, keys.platformProfiles, ['job'], ['application']]),
  });
}

export function useImportMasterResume() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (path: string) => invoke('import_master_resume', { path }),
    onSuccess: () => inv([keys.profile, keys.setup, keys.masterResumeText]),
  });
}

export function useParseMasterResume() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: () => invoke('parse_master_resume'),
    onSuccess: () => inv([keys.profile, keys.setup, keys.experiences, keys.projects]),
  });
}

// ---- job-site profiles ------------------------------------------------------------------

/** Claude suggests which projects to feature; nothing is saved. */
export function useSuggestProjectPicks() {
  const invoke = useInvoke();
  return useMutation({ mutationFn: () => invoke('suggest_project_picks') });
}

export function useSavePublishingPlan() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (args: { featuredProjectIds: string[]; picks: ProjectPick[] }) =>
      invoke('save_publishing_plan', args),
    onSuccess: () => inv([keys.publishingPlan, keys.platformProfiles]),
  });
}

/** Update a site's profile; `resume` continues an update that stopped part-way. */
export function useSyncPlatformProfile() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (args: { platform: string; resume?: boolean }) =>
      invoke('sync_platform_profile', args),
    onSuccess: announcing(() => inv([keys.platformProfiles, keys.agentStatus, keys.runs])),
  });
}

/** Look for employers' replies in Gmail (inbox and spam) now. */
export function useCheckInbox() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: () => invoke('check_inbox_now'),
    onSuccess: announcing(() => inv([keys.agentStatus, keys.runs])),
  });
}

/** Re-create an application's files that were deleted after it was sent. */
export function useRestoreApplicationFiles() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => invoke('restore_application_files', { id }),
    onSuccess: () => inv([keys.resumes, ['application'], ['job'], ['file']]),
  });
}

export function useMarkNotificationsRead() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (ids?: string[]) => invoke('mark_notifications_read', { ids }),
    onSuccess: () => inv([keys.notifications]),
  });
}

export function useAnswerPlatformQuestions() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (args: { platform: string; answers: ApplicationAnswer[] }) =>
      invoke('answer_platform_questions', args),
    onSuccess: announcing(() =>
      inv([keys.platformProfiles, keys.answers, keys.agentStatus, keys.runs]),
    ),
  });
}

/** Apply from a pasted job link (applyNow = approve and apply when the resume is ready). */
export function useApplyFromLink() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (args: { url: string; applyNow: boolean }) => invoke('apply_from_link', args),
    onSuccess: announcing(() => inv([keys.agentStatus, keys.runs])),
  });
}

/** A job the user found: text and/or screenshots/PDFs → resume, application, Gmail draft. */
export function useAddSharedJob() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (args: { text: string; files: string[]; draftEmail: boolean }) =>
      invoke('add_shared_job', args),
    onSuccess: announcing(() => inv([keys.agentStatus, keys.runs])),
  });
}

/** "Update all now": queue every site that's behind. */
export function useQueueProfileUpdates() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: () => invoke('queue_profile_updates'),
    onSuccess: () => inv([keys.platformProfiles, keys.agentStatus]),
  });
}

export function useSetPlatformAutoSync() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (args: { platform: string; enabled: boolean }) =>
      invoke('set_platform_auto_sync', args),
    onSuccess: () => inv([keys.platformProfiles]),
  });
}

// ---- jobs -------------------------------------------------------------------------------

export function useSetJobSaved() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (args: { id: string; saved: boolean }) => invoke('set_job_saved', args),
    onSuccess: () => inv([keys.jobs, ['job']]),
  });
}

export function useRejectJob() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => invoke('reject_job', { id }),
    onSuccess: () => inv([keys.jobs, keys.applications, keys.dashboard, ['job'], ['application']]),
  });
}

export function useDeleteJob() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => invoke('delete_job', { id }),
    onSuccess: () => inv([keys.jobs, keys.applications, keys.dashboard]),
  });
}

// ---- applications -----------------------------------------------------------------------

export function useApproveApplication() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; applyNow?: boolean }) => invoke('approve_application', args),
    onSuccess: (_application, args) => {
      // The apply itself waits in the queue while the agent is busy.
      const status = qc.getQueryData<AgentStatus>(keys.agentStatus);
      if (args.applyNow !== false && status && isAgentRunning(status.state)) {
        toast.show({
          type: 'info',
          title: 'Approved and queued',
          description: "The agent is busy; this application is sent as soon as it's free.",
        });
      }
      inv([
        keys.applications,
        keys.jobs,
        keys.dashboard,
        keys.agentStatus,
        keys.queue,
        ['application'],
        ['job'],
      ]);
    },
  });
}

export function useRejectApplication() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (args: { id: string; reason?: string }) => invoke('reject_application', args),
    onSuccess: () => inv([keys.applications, keys.jobs, keys.dashboard, ['application'], ['job']]),
  });
}

export function useApplyApplication() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (args: { id: string; simulate?: string }) => invoke('apply_application', args),
    onSuccess: announcing(() =>
      inv([keys.applications, keys.agentStatus, keys.dashboard, ['application']]),
    ),
  });
}

export function useAnswerQuestions() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (args: { id: string; answers: ApplicationAnswer[]; saveForReuse?: boolean }) =>
      invoke('answer_application_questions', args),
    onSuccess: () =>
      inv([keys.applications, keys.answers, keys.agentStatus, keys.queue, ['application']]),
  });
}

/** The user got an interview call for a sent application. */
export function useRecordInterview() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (args: { id: string; interview: InterviewInput }) =>
      invoke('record_interview', args),
    onSuccess: () => inv([keys.applications, keys.jobs, keys.dashboard, ['application'], ['job']]),
  });
}

export function useMarkManualComplete() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (args: { id: string; note?: string }) =>
      invoke('mark_manual_application_complete', args),
    onSuccess: () => inv([keys.applications, keys.jobs, keys.dashboard, ['application'], ['job']]),
  });
}

export function useSetApplicationStatus() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (args: { id: string; status: ApplicationStatus; note?: string }) =>
      invoke('set_application_status', args),
    onSuccess: () => inv([keys.applications, keys.jobs, keys.dashboard, ['application'], ['job']]),
  });
}

export function useAddApplicationNote() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (args: { id: string; note: string }) => invoke('add_application_note', args),
    onSuccess: () => inv([keys.applications, ['application']]),
  });
}

export function useUpdateResumeContent() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (args: { id: string; content: ResumeDocument }) =>
      invoke('update_resume_content', args),
    onSuccess: () => inv([keys.resumes, ['job'], ['application'], ['file']]),
  });
}

export function useUpdateCoverLetter() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (args: { id: string; text: string }) => invoke('update_cover_letter', args),
    onSuccess: () => inv([['job'], ['application'], ['file']]),
  });
}

export function useSaveAnswer() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (record: AnswerRecord) => invoke('save_answer', { record }),
    onSuccess: () => inv([keys.answers]),
  });
}

export function useDeleteAnswer() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => invoke('delete_answer', { id }),
    onSuccess: () => inv([keys.answers]),
  });
}

// ---- the agent --------------------------------------------------------------------------

export function useStartJobHunt() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (options?: JobHuntOptions) => invoke('start_job_hunt', { options }),
    onSuccess: announcing(() => inv([keys.agentStatus, keys.runs, keys.dashboard])),
  });
}

export function useStopJobHunt() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: () => invoke('stop_job_hunt'),
    onSuccess: () => inv([keys.agentStatus]),
  });
}

export function usePauseAgent() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: () => invoke('pause_agent'),
    onSuccess: () => inv([keys.agentStatus]),
  });
}

export function useResumeAgent() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: () => invoke('resume_agent'),
    onSuccess: () => inv([keys.agentStatus]),
  });
}

export function useDiscoverJobs() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (sources?: string[]) => invoke('discover_jobs', { sources }),
    onSuccess: announcing(() => inv([keys.agentStatus, keys.runs])),
  });
}

export function usePrepareApplications() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: () => invoke('prepare_applications'),
    onSuccess: announcing(() => inv([keys.agentStatus, keys.runs])),
  });
}

export function useRemoveQueuedTask() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => invoke('remove_queued_task', { id }),
    onSuccess: () => inv([keys.queue, keys.agentStatus]),
  });
}

export function useClearQueue() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: () => invoke('clear_queue'),
    onSuccess: () => inv([keys.queue, keys.agentStatus]),
  });
}

export function useAnalyzeJob() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (jobId: string) => invoke('analyze_job', { jobId }),
    onSuccess: announcing(() => inv([keys.agentStatus, keys.runs])),
  });
}

export function useGenerateResume() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (jobId: string) => invoke('generate_resume', { jobId }),
    onSuccess: announcing(() => inv([keys.agentStatus, keys.runs])),
  });
}

export function useClearLogs() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: () => invoke('clear_logs'),
    onSuccess: () => inv([['logs']]),
  });
}

export function useExportLogs() {
  const invoke = useInvoke();
  return useMutation({ mutationFn: () => invoke('export_logs') });
}

export function useOpenUrl() {
  const invoke = useInvoke();
  return useMutation({ mutationFn: (url: string) => invoke('open_url', { url }) });
}

export function useOpenPath() {
  const invoke = useInvoke();
  return useMutation({ mutationFn: (path: string) => invoke('open_path', { path }) });
}

// ---- mobile companion app (relay) -------------------------------------------------------

export function useRemoteRegister() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (args: AuthArgs) => invoke('remote_register', args),
    onSuccess: () => inv([keys.remoteStatus, keys.remoteDevices, keys.setup]),
  });
}

export function useRemoteLogin() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (args: AuthArgs) => invoke('remote_login', args),
    onSuccess: () => inv([keys.remoteStatus, keys.remoteDevices, keys.setup]),
  });
}

export function useRemoteLogout() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: () => invoke('remote_logout'),
    onSuccess: () => inv([keys.remoteStatus, keys.remoteDevices, keys.setup]),
  });
}

export function useRemoteCreatePairingCode() {
  const invoke = useInvoke();
  return useMutation({ mutationFn: () => invoke('remote_create_pairing_code') });
}

export function useRemoteRevokeDevice() {
  const invoke = useInvoke();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (deviceId: string) => invoke('remote_revoke_device', { deviceId }),
    onSuccess: () => inv([keys.remoteStatus, keys.remoteDevices]),
  });
}
