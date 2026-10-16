import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { vi, type Mock } from 'vitest';

import { LearnProvider, type LearnNavigator } from '../context';
import { ApiError, type LearnClient, type RequestOptions } from '../lib/api';

export type RequestMock = Mock<(path: string, options?: RequestOptions) => Promise<unknown>>;

/** A fake client whose `request` is a mock the test routes. */
export function fakeClient(request: RequestMock = vi.fn()): {
  client: LearnClient;
  request: RequestMock;
} {
  return { client: { request: request as LearnClient['request'] }, request };
}

export function fakeNavigator(): LearnNavigator & {
  navigate: Mock<(path: string, options?: { replace?: boolean }) => void>;
  back: Mock<() => void>;
} {
  return { href: (path) => `#${path}`, navigate: vi.fn(), back: vi.fn() };
}

/** Problem details as the API sends them. */
export function problem(kind: string, status: number, detail?: string): ApiError {
  return new ApiError({
    type: `urn:offerpath:error:${kind}`,
    title: kind,
    status,
    ...(detail ? { detail } : {}),
  });
}

export function Providers({
  client,
  navigator = fakeNavigator(),
  surface = 'web',
  children,
}: {
  client: LearnClient;
  navigator?: LearnNavigator;
  surface?: 'web' | 'desktop';
  children: ReactNode;
}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <LearnProvider client={client} navigator={navigator} surface={surface}>
        {children}
      </LearnProvider>
    </QueryClientProvider>
  );
}

/** Renders a learning page over a fake client and navigator. */
export function renderLearn(
  ui: ReactElement,
  {
    request = vi.fn(),
    navigator = fakeNavigator(),
    surface = 'web',
  }: {
    request?: RequestMock;
    navigator?: ReturnType<typeof fakeNavigator>;
    surface?: 'web' | 'desktop';
  } = {},
): RenderResult & { request: RequestMock; navigator: ReturnType<typeof fakeNavigator> } {
  const { client } = fakeClient(request);
  const view = render(
    <Providers client={client} navigator={navigator} surface={surface}>
      {ui}
    </Providers>,
  );
  return { ...view, request, navigator };
}
