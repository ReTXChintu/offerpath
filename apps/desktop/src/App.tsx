import {
  HuntEvents,
  HuntProvider,
  defaultHuntPath,
  type HuntClient,
  type HuntNavigator,
} from '@offerpath/hunt';
import { LearnProvider, type LearnClient, type LearnNavigator } from '@offerpath/learn';
import { UiProvider } from '@offerpath/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, type RouterHistory } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { NotInTauri } from './pages/NotInTauri';
import { tauriLearnClient } from './learn';
import { createAppRouter } from './router';
import { isTauri, tauriClient } from './tauri';

/**
 * The desktop app. `client` and `history` default to Tauri and hash
 * history; tests pass a fake client and a memory history.
 */
export function App({
  client = tauriClient,
  learnClient,
  history,
  requireTauri = true,
}: {
  client?: HuntClient;
  /** The learning pages' API client; defaults to the Rust side's device-token proxy. */
  learnClient?: LearnClient;
  history?: RouterHistory;
  requireTauri?: boolean;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 5_000, retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );
  const [router] = useState(() => createAppRouter(history));
  const navigator = useMemo<HuntNavigator>(
    () => ({
      href: (target) => `#${defaultHuntPath(target)}`,
      navigate: (target) => router.history.push(defaultHuntPath(target)),
    }),
    [router],
  );

  const [learn] = useState<LearnClient>(() => learnClient ?? tauriLearnClient());
  const learnNavigator = useMemo<LearnNavigator>(
    () => ({
      href: (path) => `#${path}`,
      navigate: (path, options) =>
        options?.replace ? router.history.replace(path) : router.history.push(path),
      back: () => router.history.back(),
    }),
    [router],
  );

  if (requireTauri && !isTauri()) {
    return (
      <UiProvider>
        <NotInTauri />
      </UiProvider>
    );
  }

  return (
    <UiProvider>
      <QueryClientProvider client={queryClient}>
        <HuntProvider client={client} navigator={navigator}>
          <LearnProvider client={learn} navigator={learnNavigator} surface="desktop">
            <HuntEvents />
            <RouterProvider router={router} />
          </LearnProvider>
        </HuntProvider>
      </QueryClientProvider>
    </UiProvider>
  );
}
