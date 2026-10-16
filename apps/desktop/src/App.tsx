import {
  HuntEvents,
  HuntProvider,
  defaultHuntPath,
  type HuntClient,
  type HuntNavigator,
} from '@offerpath/hunt';
import { UiProvider } from '@offerpath/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, type RouterHistory } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { NotInTauri } from './pages/Placeholders';
import { createAppRouter } from './router';
import { isTauri, tauriClient } from './tauri';

/**
 * The desktop app. `client` and `history` default to Tauri and hash
 * history; tests pass a fake client and a memory history.
 */
export function App({
  client = tauriClient,
  history,
  requireTauri = true,
}: {
  client?: HuntClient;
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
          <HuntEvents />
          <RouterProvider router={router} />
        </HuntProvider>
      </QueryClientProvider>
    </UiProvider>
  );
}
