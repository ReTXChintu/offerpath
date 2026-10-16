import type { IconName } from '@offerpath/ui';

export interface NavEntry {
  path: string;
  label: string;
  icon: IconName;
  /** Extra words the command palette matches. */
  keywords?: string;
}

export interface NavSection {
  label: string;
  /** The section's own overview page, if it has one. */
  path?: string;
  items: NavEntry[];
}

/** Plan section 5.2: Today; Grow; Hunt; Progress; then Agent and Settings at the bottom. */
export const TODAY: NavEntry = {
  path: '/',
  label: 'Today',
  icon: 'home',
  keywords: 'daily plan home',
};

export const GROW: NavSection = {
  label: 'Grow',
  items: [
    { path: '/roadmap', label: 'Roadmap', icon: 'route', keywords: 'goal skill tree' },
    { path: '/learn', label: 'Learn', icon: 'learn', keywords: 'concepts tutor' },
    { path: '/practice', label: 'Practice', icon: 'practice', keywords: 'exercises coding' },
    { path: '/recall', label: 'Recall', icon: 'brain', keywords: 'review flashcards' },
    { path: '/interviews', label: 'Interviews', icon: 'interview', keywords: 'mock' },
  ],
};

export const HUNT: NavSection = {
  label: 'Hunt',
  path: '/hunt',
  items: [
    { path: '/jobs', label: 'Jobs', icon: 'briefcase', keywords: 'search postings' },
    {
      path: '/applications',
      label: 'Applications',
      icon: 'send',
      keywords: 'approve review apply',
    },
    { path: '/job-sites', label: 'Job sites', icon: 'globe', keywords: 'linkedin naukri profile' },
  ],
};

export const PROGRESS: NavEntry = {
  path: '/progress',
  label: 'Progress',
  icon: 'progress',
  keywords: 'skills funnel history',
};

export const BOTTOM: NavEntry[] = [
  { path: '/agent', label: 'Agent', icon: 'bot', keywords: 'activity queue runs logs' },
  { path: '/settings', label: 'Settings', icon: 'settings', keywords: 'account sources chrome' },
];

/** Pages reached from other pages (and the palette) rather than the sidebar. */
export const MORE: NavEntry[] = [
  { path: '/hunt', label: 'Hunt overview', icon: 'dashboard', keywords: 'dashboard' },
  { path: '/candidate', label: 'Candidate profile', icon: 'user', keywords: 'skills experience' },
  { path: '/resumes', label: 'Resumes', icon: 'fileText', keywords: 'cv master' },
  { path: '/setup', label: 'Setup', icon: 'check', keywords: 'first run claude chrome' },
  { path: '/about', label: 'About and updates', icon: 'info', keywords: 'version update' },
];

/** Whether a sidebar entry is the current page (sub-pages count: /jobs/42 → Jobs). */
export function isActive(entryPath: string, current: string): boolean {
  if (entryPath === '/') return current === '/';
  return current === entryPath || current.startsWith(`${entryPath}/`);
}
