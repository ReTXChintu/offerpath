/**
 * @offerpath/learn: the learning side of Offerpath (roadmap, concepts and the
 * tutor, practice, recall, interviews, progress, onboarding, the learning
 * settings) from ForgeRoutine's web app, plus Today, on @offerpath/ui.
 *
 * The transport and navigation are injected through <LearnProvider>; import
 * `@offerpath/learn/styles.css` once, after `@offerpath/ui/styles.css`.
 */
export {
  LearnLink,
  LearnProvider,
  exercisePath,
  learnPaths,
  useApi,
  useLearnNavigate,
  useLearnNavigator,
  useSurface,
  type ApiRequest,
  type LearnNavigator,
} from './context';
export {
  ApiError,
  createFetchClient,
  isAiUnavailable,
  type FetchClientOptions,
  type LearnClient,
  type RequestOptions,
} from './lib/api';
export { copyText, randomId } from './lib/browser';
export * from './lib/queries';
export * from './lib/plan';
export * from './lib/interview-prep';
export {
  countdown,
  formatWhen,
  isoToLocalInputs,
  localDateTimeToIso,
  toOffsetIso,
} from './lib/when';
export {
  AI_OFFLINE_MESSAGE,
  AiOfflineNotice,
  RequestError,
  describeError,
} from './components/AiOffline';
export { Assistant } from './components/Assistant';
export { CodeBlock } from './components/CodeBlock';
export { InlineMarkdown, Markdown } from './components/Markdown';
export { SessionClock } from './components/SessionClock';

// Pages
export { ChallengeList } from './features/challenges/ChallengeList';
export { ChallengeWorkspace } from './features/challenges/ChallengeWorkspace';
export { ConceptView } from './features/concepts/ConceptView';
export { ExerciseWorkspace } from './features/exercise/ExerciseWorkspace';
export { InterviewGuide } from './features/interview/InterviewGuide';
export { InterviewSession } from './features/interview/InterviewSession';
export { Onboarding } from './features/onboarding/Onboarding';
export { ProjectWorkspace } from './features/project/ProjectWorkspace';
export { RoadmapPage } from './features/roadmap/RoadmapView';
export { Technologies } from './features/technologies/Technologies';
export { TechnologyView } from './features/technologies/TechnologyView';
export { RoutineSection } from './features/routine/RoutineSection';
export { PracticePage } from './features/practice/PracticePage';
export { RecallPage } from './features/recall/RecallPage';
export { ProgressPage } from './features/progress/ProgressPage';
export { FunnelPanel, type FunnelCounts } from './features/progress/FunnelPanel';
export { LearningSettings, GoalEditor } from './features/settings/Settings';
export { AiFallbackSettings } from './features/settings/AiFallback';
export { InterviewPrepList } from './features/interview-prep/PrepList';
export {
  PrepCreate,
  validatePrepDraft,
  type PrepDraft,
} from './features/interview-prep/PrepCreate';
export { PrepDetail } from './features/interview-prep/PrepDetail';
export { UpcomingPreps } from './features/interview-prep/UpcomingPreps';
export { AI_SOURCE_MESSAGE } from './features/interview-prep/shared';
export { TodayPage } from './features/today/TodayPage';
export { DesktopOfflineStrip } from './features/today/DesktopOfflineStrip';
