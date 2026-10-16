import { createContext, useContext, useMemo, type ReactNode } from 'react';

import type { CommandArgs, CommandName, CommandResult, EventName, EventPayloads } from './protocol';
import type { UserFacingError } from './types';

/** Stops listening to an event. */
export type Unlisten = () => void;

/** A file filter for the native file picker. */
export interface FileFilter {
  name: string;
  extensions: string[];
}

/**
 * How the hunt pages reach the agent. The desktop passes one built on
 * Tauri's `invoke` / `listen`; a web client can map the same command names
 * onto the API. The pages never import a transport themselves.
 */
export interface HuntClient {
  /** Run a command by its Tauri name, e.g. `invoke('get_job', { id })`. */
  invoke<N extends CommandName>(command: N, args?: CommandArgs<N>): Promise<CommandResult<N>>;
  /** Subscribe to a backend event; resolves to the function that unsubscribes. */
  listen<E extends EventName>(
    event: E,
    handler: (payload: EventPayloads[E]) => void,
  ): Promise<Unlisten>;
  /**
   * Pick local files (resumes, screenshots). Only the desktop can; where it
   * is missing, the pages hide the actions that need it.
   */
  pickFiles?: (options: { multiple: boolean; filters: FileFilter[] }) => Promise<string[]>;
}

/** A command's failure, normalised from whatever the transport threw. */
export class BackendError extends Error {
  code: string;
  details: string | null;
  recoverable: boolean;
  constructor(err: UserFacingError) {
    super(err.message);
    this.name = 'BackendError';
    this.code = err.code;
    this.details = err.details;
    this.recoverable = err.recoverable;
  }
}

export function toBackendError(e: unknown): BackendError {
  if (e instanceof BackendError) return e;
  if (e && typeof e === 'object' && 'message' in e && 'code' in e) {
    const err = e as Partial<UserFacingError>;
    return new BackendError({
      code: err.code ?? 'OTHER',
      message: String(err.message),
      details: err.details ?? null,
      recoverable: err.recoverable ?? true,
    });
  }
  return new BackendError({
    code: 'OTHER',
    message: typeof e === 'string' ? e : e instanceof Error ? e.message : 'Unknown error',
    details: null,
    recoverable: true,
  });
}

export function errorMessage(e: unknown): string {
  return toBackendError(e).message;
}

export function errorDetails(e: unknown): string | null {
  return toBackendError(e).details;
}

// ---- navigation -------------------------------------------------------------------------

/** The hunt's own places. The host maps each to one of its routes. */
export type HuntTarget =
  | { to: 'overview' }
  | { to: 'jobs' }
  | { to: 'job'; jobId: string }
  | { to: 'applications' }
  | { to: 'application'; applicationId: string }
  | { to: 'candidate' }
  | { to: 'resumes' }
  | { to: 'job-sites' }
  | { to: 'agent' }
  | { to: 'settings' }
  | { to: 'setup' }
  | { to: 'about' };

/** How the hunt pages move between places, injected by the host's router. */
export interface HuntNavigator {
  href(target: HuntTarget): string;
  navigate(target: HuntTarget): void;
}

/** Paths a host can use as they are (the desktop does). */
export function defaultHuntPath(target: HuntTarget): string {
  switch (target.to) {
    case 'overview':
      return '/hunt';
    case 'job':
      return `/jobs/${encodeURIComponent(target.jobId)}`;
    case 'application':
      return `/applications/${encodeURIComponent(target.applicationId)}`;
    default:
      return `/${target.to}`;
  }
}

// ---- provider ---------------------------------------------------------------------------

interface HuntContextValue {
  client: HuntClient;
  navigator: HuntNavigator;
  /** Product name shown in copy ("Offerpath will open Chrome…"). */
  appName: string;
}

const HuntContext = createContext<HuntContextValue | null>(null);

/**
 * Gives the hunt pages their transport and navigation. Mount it inside a
 * TanStack Query `QueryClientProvider`.
 */
export function HuntProvider({
  client,
  navigator,
  appName = 'Offerpath',
  children,
}: {
  client: HuntClient;
  navigator: HuntNavigator;
  appName?: string;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ client, navigator, appName }), [client, navigator, appName]);
  return <HuntContext.Provider value={value}>{children}</HuntContext.Provider>;
}

function useHuntContext(): HuntContextValue {
  const ctx = useContext(HuntContext);
  if (!ctx) throw new Error('Hunt pages must be rendered inside <HuntProvider>.');
  return ctx;
}

export function useHuntClient(): HuntClient {
  return useHuntContext().client;
}

export function useHuntNavigator(): HuntNavigator {
  return useHuntContext().navigator;
}

export function useAppName(): string {
  return useHuntContext().appName;
}

/** The client's invoke, with every failure normalised to a BackendError. */
export function useInvoke() {
  const client = useHuntClient();
  return useMemo(
    () =>
      async <N extends CommandName>(
        command: N,
        args?: CommandArgs<N>,
      ): Promise<CommandResult<N>> => {
        try {
          return await client.invoke(command, args);
        } catch (e) {
          throw toBackendError(e);
        }
      },
    [client],
  );
}
