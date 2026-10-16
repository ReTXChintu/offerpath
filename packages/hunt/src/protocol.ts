/**
 * The hunt protocol, from Job Hunter's `packages/agent-protocol`: the names
 * of the desktop's commands and events with their typed payloads. The names
 * are the Tauri command and event names registered in
 * `apps/desktop/src-tauri/src/lib.rs`; a web client maps the same names onto
 * the API.
 */
import type {
  AgentEvent,
  AgentRun,
  AgentStatus,
  AnswerRecord,
  AppSettings,
  Application,
  ApplicationAnswer,
  ApplicationDetail,
  ApplicationListItem,
  ApplicationStatus,
  CandidateProfile,
  CoverLetter,
  Dashboard,
  Experience,
  InterviewInput,
  Job,
  JobDetail,
  JobHuntOptions,
  JobListItem,
  LogEntry,
  LogLevel,
  MasterResumeRef,
  Notification,
  PairingCode,
  PlatformProfile,
  PlatformProfileView,
  Project,
  ProjectPick,
  PublishingPlan,
  QueuedTask,
  RemoteDevice,
  RemoteStatus,
  Resume,
  ResumeDocument,
  SetupStatus,
  SkillGroups,
  Submission,
  SyncStatus,
} from './types';

/** A key of the candidate's skill groups ("frontend", "backend", ...). */
export type SkillGroup = keyof SkillGroups;

/** Events the desktop emits. */
export const EVENTS = {
  agentEvent: 'agent:event',
  agentStatus: 'agent:status',
  syncStatus: 'sync:status',
  log: 'log:entry',
  dataChanged: 'data:changed',
  remoteStatus: 'remote:status',
  updateProgress: 'update:progress',
} as const;

export interface EventPayloads {
  'agent:event': AgentEvent;
  'agent:status': AgentStatus;
  'sync:status': SyncStatus;
  'log:entry': LogEntry;
  'data:changed': string[];
  'remote:status': RemoteStatus;
  'update:progress': UpdateProgress;
}

export type EventName = keyof EventPayloads;

export interface AboutInfo {
  name: string;
  version: string;
  serverUrl: string;
  serverBuiltIn: boolean;
  /** This build carries the updater's public key and can install updates itself. */
  updaterEnabled: boolean;
  dataDir: string;
  platform: string;
}

/** Mirrors `offerpath_core::updates::UpdateCheck`. */
export interface UpdateCheck {
  currentVersion: string;
  latestVersion: string | null;
  available: boolean;
  downloadUrl: string | null;
  canInstallInApp: boolean;
  sizeBytes: number | null;
  publishedAt: string | null;
}

export interface UpdateProgress {
  downloaded: number;
  total: number | null;
  finished: boolean;
}

/** The server this build talks to; fixed when the app is built. */
export interface ServerInfo {
  url: string;
  builtIn: boolean;
}

/**
 * An old Job Hunter install found on this computer (`offerpath_core::legacy::LegacyData`),
 * offered on the first-run screen while Offerpath has no data of its own.
 */
export interface LegacyData {
  path: string;
  /** Documents per collection in the old store: [collection, count]. */
  collections: [string, number][];
  bytes: number;
}

type NoArgs = Record<string, never>;

/** Every command: name → { args, result }. */
export interface Commands {
  get_setup_status: { args: NoArgs; result: SetupStatus };
  get_legacy_import: { args: NoArgs; result: LegacyData | null };
  import_legacy_data: { args: NoArgs; result: null };
  get_settings: { args: NoArgs; result: AppSettings };
  save_settings: { args: { settings: AppSettings }; result: AppSettings };
  get_server_info: { args: NoArgs; result: ServerInfo };
  get_about_info: { args: NoArgs; result: AboutInfo };
  check_for_update: { args: NoArgs; result: UpdateCheck };
  install_update: { args: NoArgs; result: null };
  test_backend: { args: NoArgs; result: null };
  backend_register: {
    args: { email: string; password: string; deviceName?: string };
    result: SyncStatus;
  };
  backend_login: {
    args: { email: string; password: string; deviceName?: string };
    result: SyncStatus;
  };
  backend_logout: { args: NoArgs; result: SyncStatus };
  get_sync_status: { args: NoArgs; result: SyncStatus };

  get_candidate_profile: { args: NoArgs; result: CandidateProfile };
  save_candidate_profile: { args: { profile: CandidateProfile }; result: CandidateProfile };
  list_experiences: { args: NoArgs; result: Experience[] };
  save_experience: { args: { experience: Experience }; result: Experience };
  delete_experience: { args: { id: string }; result: null };
  list_projects: { args: NoArgs; result: Project[] };
  draft_project: { args: { description: string; experienceId?: string | null }; result: Project };
  save_project: { args: { project: Project }; result: Project };
  delete_project: { args: { id: string }; result: null };
  import_master_resume: { args: { path: string }; result: MasterResumeRef };
  parse_master_resume: { args: NoArgs; result: CandidateProfile };
  get_master_resume_text: { args: NoArgs; result: string | null };
  mark_skills_known: { args: { skills: string[]; group: SkillGroup }; result: CandidateProfile };

  list_platform_profiles: { args: NoArgs; result: PlatformProfileView[] };
  get_publishing_plan: { args: NoArgs; result: PublishingPlan };
  suggest_project_picks: { args: NoArgs; result: ProjectPick[] };
  save_publishing_plan: {
    args: { featuredProjectIds: string[]; picks: ProjectPick[] };
    result: PublishingPlan;
  };
  sync_platform_profile: { args: { platform: string; resume?: boolean }; result: Submission };
  answer_platform_questions: {
    args: { platform: string; answers: ApplicationAnswer[] };
    result: Submission;
  };
  set_platform_auto_sync: { args: { platform: string; enabled: boolean }; result: PlatformProfile };
  queue_profile_updates: { args: NoArgs; result: number };
  apply_from_link: { args: { url: string; applyNow?: boolean }; result: Submission };
  add_shared_job: {
    args: { text: string; files: string[]; draftEmail?: boolean };
    result: Submission;
  };

  list_notifications: { args: { limit?: number }; result: Notification[] };
  check_inbox_now: { args: NoArgs; result: Submission };
  restore_application_files: { args: { id: string }; result: null };
  mark_notifications_read: { args: { ids?: string[] }; result: null };

  list_jobs: { args: NoArgs; result: JobListItem[] };
  get_job: { args: { id: string }; result: JobDetail };
  set_job_saved: { args: { id: string; saved: boolean }; result: Job };
  reject_job: { args: { id: string }; result: Job };
  delete_job: { args: { id: string }; result: null };

  list_applications: { args: NoArgs; result: ApplicationListItem[] };
  get_application: { args: { id: string }; result: ApplicationDetail };
  approve_application: { args: { id: string; applyNow?: boolean }; result: Application };
  reject_application: { args: { id: string; reason?: string }; result: Application };
  apply_application: { args: { id: string; simulate?: string }; result: Submission };
  answer_application_questions: {
    args: { id: string; answers: ApplicationAnswer[]; saveForReuse?: boolean };
    result: Application;
  };
  mark_manual_application_complete: { args: { id: string; note?: string }; result: Application };
  set_application_status: {
    args: { id: string; status: ApplicationStatus; note?: string };
    result: Application;
  };
  record_interview: { args: { id: string; interview: InterviewInput }; result: Application };
  add_application_note: { args: { id: string; note: string }; result: Application };

  list_resumes: { args: NoArgs; result: Resume[] };
  update_resume_content: { args: { id: string; content: ResumeDocument }; result: Resume };
  update_cover_letter: { args: { id: string; text: string }; result: CoverLetter };
  read_text_file: { args: { path: string }; result: string };

  list_answers: { args: NoArgs; result: AnswerRecord[] };
  save_answer: { args: { record: AnswerRecord }; result: AnswerRecord };
  delete_answer: { args: { id: string }; result: null };

  get_agent_status: { args: NoArgs; result: AgentStatus };
  start_job_hunt: { args: { options?: JobHuntOptions }; result: Submission };
  stop_job_hunt: { args: NoArgs; result: boolean };
  pause_agent: { args: NoArgs; result: null };
  resume_agent: { args: NoArgs; result: null };
  discover_jobs: { args: { sources?: string[] }; result: Submission };
  prepare_applications: { args: NoArgs; result: Submission };
  list_queue: { args: NoArgs; result: QueuedTask[] };
  remove_queued_task: { args: { id: string }; result: boolean };
  clear_queue: { args: NoArgs; result: number };
  analyze_job: { args: { jobId: string }; result: Submission };
  generate_resume: { args: { jobId: string }; result: Submission };
  generate_cover_letter: { args: { jobId: string }; result: AgentRun };
  list_agent_runs: { args: { limit?: number }; result: AgentRun[] };
  get_run_events: { args: { runId: string; limit?: number }; result: AgentEvent[] };

  get_logs: { args: { minLevel?: LogLevel; limit?: number }; result: LogEntry[] };
  clear_logs: { args: NoArgs; result: null };
  export_logs: { args: NoArgs; result: string };

  open_url: { args: { url: string }; result: null };
  open_path: { args: { path: string }; result: null };
  get_dashboard: { args: NoArgs; result: Dashboard };

  get_remote_status: { args: NoArgs; result: RemoteStatus };
  remote_register: {
    args: { email: string; password: string; deviceName?: string };
    result: RemoteStatus;
  };
  remote_login: {
    args: { email: string; password: string; deviceName?: string };
    result: RemoteStatus;
  };
  remote_logout: { args: NoArgs; result: RemoteStatus };
  remote_create_pairing_code: { args: NoArgs; result: PairingCode };
  remote_list_devices: { args: NoArgs; result: RemoteDevice[] };
  remote_revoke_device: { args: { deviceId: string }; result: RemoteStatus };
}

export type CommandName = keyof Commands;
export type CommandArgs<N extends CommandName> = Commands[N]['args'];
export type CommandResult<N extends CommandName> = Commands[N]['result'];

/** Machine-readable event kinds the agent emits (see Rust `AgentEvent.kind`). */
export const EVENT_KINDS = [
  'STATE_CHANGED',
  'STEP_STARTED',
  'STEP_DONE',
  'STEP_FAILED',
  'PROGRESS',
  'MESSAGE',
  'JOB_DISCOVERED',
  'JOB_ANALYZED',
  'RESUME_GENERATED',
  'APPLICATION_READY',
  'APPLICATION_UPDATED',
  'PROFILE_UPDATED',
  'NOTIFICATION',
  'REPLY_FOUND',
  'CLAUDE_ACTIVITY',
  'RUN_FINISHED',
] as const;

export type EventKind = (typeof EVENT_KINDS)[number];
