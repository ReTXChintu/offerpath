import { createContext, useContext, useMemo, type ReactNode } from 'react';

import type { ProjectInput, ProjectItem } from './types';

/**
 * The Portfolio section's own places. Both hosts register `/portfolio` and
 * `/portfolio/$tab`; the pages move between them through the learning
 * side's navigator, so they never import a router.
 */
export const PORTFOLIO_TABS = [
  'overview',
  'settings',
  'projects',
  'skills',
  'experience',
  'tools',
  'messages',
] as const;

export type PortfolioTab = (typeof PORTFOLIO_TABS)[number];

export const portfolioPaths = {
  root: '/portfolio',
  tab: (tab: PortfolioTab) => (tab === 'overview' ? '/portfolio' : `/portfolio/${tab}`),
  // The phone's push for a new contact message: linkPage 'portfolio-messages'.
  messages: '/portfolio/messages',
} as const;

/** A route param read as a tab; anything unknown is the overview. */
export function parsePortfolioTab(value: string | undefined | null): PortfolioTab {
  return PORTFOLIO_TABS.includes(value as PortfolioTab) ? (value as PortfolioTab) : 'overview';
}

/** What a desktop-only tool in the project editor can see and change. */
export interface ProjectToolsProps {
  /** The saved project, or null while a new one is being written. */
  project: ProjectItem | null;
  /** The editor's unsaved values (what Save would send). */
  draft: ProjectInput;
  /** Changes editor values, e.g. `{ imageUrl, accent, gradientFrom, gradientTo }` from a mockup. */
  update: (patch: Partial<ProjectInput>) => void;
}

/**
 * What the host app adds to the Portfolio pages. Everything is optional: the
 * web app gives only the API's origin; the laptop app also gives its folder
 * picker and, later, its mockup generator.
 */
export interface PortfolioHost {
  /**
   * The API's origin (`http://203.0.113.10:50005`), to turn the public
   * site's path into a URL a portfolio site can call. Null when unknown.
   */
  apiOrigin?: string | null;
  /**
   * Opens a native folder picker for a project's folder (`localPath`).
   * Resolves the chosen absolute path, or null when cancelled. Without it
   * the folder is a plain text field.
   */
  pickProjectFolder?: (current: string | null) => Promise<string | null>;
  /**
   * Desktop-only tools in the project editor, rendered in the "On this
   * laptop" slot next to the folder: the place for "Generate mockup".
   */
  renderProjectTools?: (props: ProjectToolsProps) => ReactNode;
}

const PortfolioHostContext = createContext<PortfolioHost>({});

/**
 * Gives the Portfolio pages the host's extras. The API client and the
 * navigator come from the learning side's `<LearnProvider>`, which must be
 * mounted around this.
 */
export function PortfolioProvider({
  apiOrigin = null,
  pickProjectFolder,
  renderProjectTools,
  children,
}: PortfolioHost & { children: ReactNode }) {
  const value = useMemo<PortfolioHost>(
    () => ({ apiOrigin, pickProjectFolder, renderProjectTools }),
    [apiOrigin, pickProjectFolder, renderProjectTools],
  );
  return <PortfolioHostContext.Provider value={value}>{children}</PortfolioHostContext.Provider>;
}

export function usePortfolioHost(): PortfolioHost {
  return useContext(PortfolioHostContext);
}
