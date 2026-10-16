import {
  HuntProvider,
  defaultHuntPath,
  type HuntClient,
  type HuntNavigator,
} from '@offerpath/hunt';
import { LearnProvider, type LearnNavigator } from '@offerpath/learn';
import { UiProvider } from '@offerpath/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, type RouterHistory } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';

import { AuthContext } from './auth-context';
import { apiBaseUrl } from './config';
import { httpHuntClient } from './hunt-client';
import { AuthPage } from './pages/AuthPage';
import { createAppRouter } from './router';
import { Auth, loadSession, type Session } from './session';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Hunt places the web app has; the rest are the desktop's (they open Needs you). */
function webHuntPath(target: Parameters<HuntNavigator['href']>[0]): string {
  switch (target.to) {
    case 'jobs':
    case 'job':
    case 'applications':
    case 'application':
      return defaultHuntPath(target);
    case 'settings':
      return '/settings';
    default:
      return '/hunt';
  }
}

/**
 * The supporter web app: the learning side in full and the hunt as a remote
 * control for the desktop (plan 5.3). `baseUrl`, `fetchImpl` and `history`
 * are for tests.
 */
export function App({
  baseUrl = apiBaseUrl(),
  fetchImpl,
  history,
}: {
  baseUrl?: string;
  fetchImpl?: FetchLike;
  history?: RouterHistory;
}) {
  const [session, setSession] = useState<Session | null>(loadSession);
  const [auth] = useState(() => new Auth(baseUrl, session, setSession, fetchImpl));
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: true } },
      }),
  );

  // Signing out forgets everything the last account loaded.
  useEffect(() => {
    if (!session) queryClient.clear();
  }, [session, queryClient]);

  return (
    <UiProvider>
      {session ? (
        <QueryClientProvider client={queryClient}>
          <SignedIn auth={auth} session={session} baseUrl={baseUrl} history={history} />
        </QueryClientProvider>
      ) : (
        <AuthPage auth={auth} />
      )}
    </UiProvider>
  );
}

function SignedIn({
  auth,
  session,
  baseUrl,
  history,
}: {
  auth: Auth;
  session: Session;
  baseUrl: string;
  history?: RouterHistory;
}) {
  const [router] = useState(() => createAppRouter(history));
  const [hunt] = useState<HuntClient>(() => httpHuntClient(auth.client));
  const huntNavigator = useMemo<HuntNavigator>(
    () => ({
      href: (target) => webHuntPath(target),
      navigate: (target) => router.history.push(webHuntPath(target)),
    }),
    [router],
  );
  const learnNavigator = useMemo<LearnNavigator>(
    () => ({
      href: (path) => path,
      navigate: (path, options) =>
        options?.replace ? router.history.replace(path) : router.history.push(path),
      back: () => router.history.back(),
    }),
    [router],
  );
  const authValue = useMemo(() => ({ auth, session, baseUrl }), [auth, session, baseUrl]);

  return (
    <AuthContext.Provider value={authValue}>
      <HuntProvider client={hunt} navigator={huntNavigator}>
        <LearnProvider client={auth.client} navigator={learnNavigator} surface="web">
          <RouterProvider router={router} />
        </LearnProvider>
      </HuntProvider>
    </AuthContext.Provider>
  );
}
