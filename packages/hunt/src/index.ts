/**
 * @offerpath/hunt: the hunt side of Offerpath (jobs, applications,
 * approvals, job sites, the agent), rebuilt from Job Hunter's desktop pages
 * on @offerpath/ui. The transport is injected through <HuntProvider>.
 */
export * from './types';
export * from './protocol';
export * from './logic';
export {
  BackendError,
  HuntProvider,
  defaultHuntPath,
  errorDetails,
  errorMessage,
  toBackendError,
  useAppName,
  useHuntClient,
  useHuntNavigator,
  useInvoke,
  type FileFilter,
  type HuntClient,
  type HuntNavigator,
  type HuntTarget,
  type Unlisten,
} from './client';
export * from './queries';
export { activityFeed, logFeed, useActivity, useLogFeed, Feed } from './activity';
export { HuntEvents } from './events';

// Components
export {
  ErrorBanner,
  HuntLink,
  HuntStatusBadge,
  InfoBanner,
  Loading,
  LocationFilter,
} from './components/common';
export { ActivityFeed } from './components/ActivityFeed';
export { AdditionalDetails } from './components/AdditionalDetails';
export { AgentStatusBar, syncLabel } from './components/AgentStatusBar';
export { AutoUpdatePanel } from './components/AutoUpdatePanel';
export { CompaniesEditor } from './components/CompaniesEditor';
export { FileLinks, HtmlPreview } from './components/DocumentPreview';
export { InterviewDialog } from './components/InterviewDialog';
export { JobLinkDialog } from './components/JobLinkDialog';
export { MissingSkills } from './components/MissingSkills';
export { MobileAppSettings } from './components/MobileAppSettings';
export { NotificationBell, notificationTarget } from './components/NotificationBell';
export { ProjectPicker } from './components/ProjectPicker';
export { QuestionField } from './components/QuestionField';
export { QueuePanel } from './components/QueuePanel';
export { ResumeEditor } from './components/ResumeEditor';
export { SharedJobDialog } from './components/SharedJobDialog';
export { UpdateActions, UpdateBanner } from './components/UpdateNotifier';

// Pages
export { AboutPage } from './pages/About';
export { AgentPage, LogViewer } from './pages/Agent';
export { ApplicationReviewPage } from './pages/ApplicationReview';
export { ApplicationsPage } from './pages/Applications';
export { CandidatePage, MasterResumeTab } from './pages/Candidate';
export { DashboardPage } from './pages/Dashboard';
export { JobDetailPage } from './pages/JobDetail';
export { JobSitesPage } from './pages/JobSites';
export { JobsPage } from './pages/Jobs';
export { ResumesPage } from './pages/Resumes';
export { BackendSignInForm, SettingsPage, type SettingsTab } from './pages/Settings';
export { LegacyImportPanel, SetupPage, formatBytes } from './pages/Setup';
