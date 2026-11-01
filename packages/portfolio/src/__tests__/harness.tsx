import { LearnProvider, type LearnNavigator, type RequestOptions } from '@offerpath/learn';
import { ApiError } from '@offerpath/learn';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { vi, type Mock } from 'vitest';

import { PortfolioProvider, type PortfolioHost } from '../context';

export type RequestMock = Mock<(path: string, options?: RequestOptions) => Promise<unknown>>;

type Route = (path: string, options: RequestOptions) => unknown;

/** A fake API: `route` answers each request; an Error it returns is thrown. */
export function router(route: Route): RequestMock {
  return vi.fn(async (path: string, options?: RequestOptions) => {
    const out = route(path, options ?? {});
    if (out instanceof Error) throw out;
    return out;
  }) as RequestMock;
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

export function fakeNavigator(): LearnNavigator & {
  navigate: Mock<(path: string, options?: { replace?: boolean }) => void>;
} {
  return { href: (path) => `#${path}`, navigate: vi.fn(), back: vi.fn() };
}

/** The calls made with a method to a path (exact, or a prefix ending in `*`). */
export function callsTo(request: RequestMock, method: string, path: string) {
  return request.mock.calls.filter(([p, o]) => {
    const m = o?.method ?? 'GET';
    const match = path.endsWith('*') ? p.startsWith(path.slice(0, -1)) : p === path;
    return m === method && match;
  });
}

/** Renders a Portfolio page over a fake API, with the host's extras. */
export function renderPortfolio(
  ui: ReactElement,
  {
    request = vi.fn(),
    host = { apiOrigin: 'http://203.0.113.10:50005' },
    navigator = fakeNavigator(),
  }: {
    request?: RequestMock;
    host?: PortfolioHost;
    navigator?: ReturnType<typeof fakeNavigator>;
  } = {},
): RenderResult & { request: RequestMock; navigator: ReturnType<typeof fakeNavigator> } {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <LearnProvider client={{ request: request as never }} navigator={navigator} surface="web">
        <PortfolioProvider {...host}>{ui}</PortfolioProvider>
      </LearnProvider>
    </QueryClientProvider>,
  );
  return { ...view, request, navigator };
}
