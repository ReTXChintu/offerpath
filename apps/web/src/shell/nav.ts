import type { IconName } from '@offerpath/ui';

export interface NavEntry {
  path: string;
  label: string;
  icon: IconName;
  /** Extra words the command palette matches. */
  keywords?: string;
}

/** Plan section 5.3: the learning side in full, the hunt as a remote control. */
export const TODAY: NavEntry = {
  path: '/',
  label: 'Today',
  icon: 'home',
  keywords: 'daily plan home',
};

export const GROW: NavEntry[] = [
  { path: '/roadmap', label: 'Roadmap', icon: 'route', keywords: 'goal skill tree' },
  { path: '/learn', label: 'Learn', icon: 'learn', keywords: 'concepts tutor technologies' },
  { path: '/practice', label: 'Practice', icon: 'practice', keywords: 'exercises coding' },
  { path: '/recall', label: 'Recall', icon: 'brain', keywords: 'review flashcards' },
  { path: '/interviews', label: 'Interviews', icon: 'interview', keywords: 'mock' },
  {
    path: '/interview-prep',
    label: 'Interview prep',
    icon: 'calendarPlus',
    keywords: 'job description questions plan practise upcoming',
  },
];

/** Reached from the palette (and the Interview prep page) rather than the sidebar. */
export const NEW_PREP: NavEntry = {
  path: '/interview-prep/new',
  label: 'Prepare for an interview',
  icon: 'plus',
  keywords: 'new interview prep job description',
};

export const HUNT: NavEntry[] = [
  { path: '/hunt', label: 'Needs you', icon: 'bell', keywords: 'approvals questions start stop' },
  { path: '/applications', label: 'Applications', icon: 'send', keywords: 'approve review' },
  { path: '/jobs', label: 'Jobs', icon: 'briefcase', keywords: 'search postings' },
];

export const PROGRESS: NavEntry = {
  path: '/progress',
  label: 'Progress',
  icon: 'progress',
  keywords: 'skills funnel coding score',
};

export const SETTINGS: NavEntry = {
  path: '/settings',
  label: 'Settings',
  icon: 'settings',
  keywords: 'account devices downloads goal models',
};

/** The desktop installer and the Android app (Settings → Downloads). */
export const GET_APPS: NavEntry = {
  path: '/settings?tab=downloads',
  label: 'Get the apps',
  icon: 'download',
  keywords: 'download install windows android apk desktop phone',
};

/** Pages that belong to a sidebar entry without sharing its path. */
const ALSO: Record<string, string[]> = {
  '/learn': ['/concept'],
  '/practice': ['/exercise', '/project', '/challenge'],
  '/interview-prep': ['/mock-interview'],
};

/** Whether a sidebar entry is the current page (sub-pages count: /jobs/42 → Jobs). */
export function isActive(entryPath: string, current: string): boolean {
  if (entryPath === '/') return current === '/';
  return [entryPath, ...(ALSO[entryPath] ?? [])].some(
    (p) => current === p || current.startsWith(`${p}/`),
  );
}

/** Pages that own the whole content area: editors, the terminal, a live interview, onboarding. */
export function isFullBleed(path: string): boolean {
  return (
    /^\/(exercise|project|challenge)\/[^/]+$/.test(path) ||
    /^\/interviews\/[^/]+$/.test(path) ||
    path === '/onboarding'
  );
}
