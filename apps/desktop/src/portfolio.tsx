import { useSettings } from '@offerpath/hunt';
import {
  PortfolioPage,
  PortfolioProvider,
  originOf,
  parsePortfolioTab,
} from '@offerpath/portfolio';
import { useParams } from '@tanstack/react-router';
import { open } from '@tauri-apps/plugin-dialog';
import type { ReactNode } from 'react';

/** The native folder picker, for a project's folder (used for mockups). */
export async function pickProjectFolder(current: string | null): Promise<string | null> {
  const chosen = await open({
    directory: true,
    multiple: false,
    ...(current ? { defaultPath: current } : {}),
    title: 'Choose the project’s folder',
  });
  return typeof chosen === 'string' ? chosen : null;
}

/**
 * The Portfolio pages' laptop extras: this build's server address (for the
 * public URL) and the folder picker. The project editor's tools slot
 * (`renderProjectTools`) is where "Generate mockup" plugs in.
 */
export function DesktopPortfolioProvider({ children }: { children: ReactNode }) {
  const settings = useSettings();
  return (
    <PortfolioProvider
      apiOrigin={originOf(settings.data?.backend.backendUrl)}
      pickProjectFolder={pickProjectFolder}
    >
      {children}
    </PortfolioProvider>
  );
}

/** `/portfolio/$tab`: the tab from the URL. */
export function PortfolioTabRoute() {
  const { tab } = useParams({ strict: false }) as { tab?: string };
  return <PortfolioPage tab={parsePortfolioTab(tab)} />;
}
