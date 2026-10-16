import { useDashboard, useSyncStatus, type Dashboard } from '@offerpath/hunt';
import {
  ApiError,
  ChallengeWorkspace,
  ConceptView,
  ExerciseWorkspace,
  FunnelPanel,
  InterviewSession,
  ProgressPage,
  ProjectWorkspace,
  TechnologyView,
  type LearnClient,
  type RequestOptions,
} from '@offerpath/learn';
import { EmptyState } from '@offerpath/ui';
import { useParams } from '@tanstack/react-router';
import { invoke } from '@tauri-apps/api/core';
import type { ReactNode } from 'react';

import { NavLink } from './shell/NavLink';

/** What `learn_api_request` answers: the API's reply, passed through. */
interface ApiReply {
  status: number;
  body: unknown;
}

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

/**
 * The learning pages' client on the desktop. Every call goes through the
 * Rust side (`learn_api_request`), which adds this desktop's device token:
 * the token never reaches the webview, and the webview's CSP stays
 * `connect-src 'self'`.
 */
export function tauriLearnClient(call: Invoke = invoke as Invoke): LearnClient {
  return {
    async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
      let reply: ApiReply;
      try {
        reply = (await call('learn_api_request', {
          method: options.method ?? 'GET',
          path,
          body: options.body ?? null,
          idempotencyKey: options.idempotencyKey ?? null,
        })) as ApiReply;
      } catch (e) {
        // A UserFacingError from Rust: not signed in, or the server unreachable.
        const err = (e ?? {}) as { code?: string; message?: string };
        const notSignedIn = err.code === 'BACKEND_NOT_CONFIGURED';
        throw new ApiError({
          type: `urn:offerpath:error:${notSignedIn ? 'not-signed-in' : 'network'}`,
          title: notSignedIn ? 'Not signed in' : 'Cannot reach the server',
          status: notSignedIn ? 401 : 0,
          detail: notSignedIn
            ? 'Sign this desktop in to your Offerpath account in Settings → Account.'
            : (err.message ?? 'Cannot reach the Offerpath server.'),
        });
      }
      if (reply.status >= 400) {
        const body = reply.body as { type?: string; title?: string } | null;
        throw new ApiError(
          body && typeof body === 'object' && body.title
            ? (reply.body as ConstructorParameters<typeof ApiError>[0])
            : {
                type: 'urn:offerpath:error:unknown',
                title: 'Request failed',
                status: reply.status,
              },
        );
      }
      return (reply.body ?? undefined) as T;
    },
  };
}

/**
 * The learning side needs an account: its data lives on the server. Until
 * this desktop is signed in, say so and point at Settings → Account.
 */
export function RequireAccount({ children }: { children: ReactNode }) {
  const sync = useSyncStatus();
  if (sync.data && !sync.data.configured) {
    return (
      <EmptyState
        icon="user"
        title="Sign in to your Offerpath account"
        description="Today, learning, practice and interviews live in your account, so this desktop has to be signed in to it. The hunt works without one."
        action={
          <NavLink href="/settings?tab=backend" className="btn btn-primary">
            Open Settings → Account
          </NavLink>
        }
      />
    );
  }
  return <>{children}</>;
}

/** Route wrappers: read the URL's params and hand them to the learning pages. */
export function TechnologyRoute() {
  const { technologyId } = useParams({ strict: false }) as { technologyId?: string };
  return <TechnologyView technologyId={technologyId ?? ''} />;
}
export function ConceptRoute() {
  const { conceptId } = useParams({ strict: false }) as { conceptId?: string };
  return <ConceptView key={conceptId} conceptId={conceptId ?? ''} />;
}
export function ExerciseRoute() {
  const { exerciseId } = useParams({ strict: false }) as { exerciseId?: string };
  return <ExerciseWorkspace key={exerciseId} exerciseId={exerciseId ?? ''} />;
}
export function ProjectRoute() {
  const { exerciseId } = useParams({ strict: false }) as { exerciseId?: string };
  return <ProjectWorkspace key={exerciseId} exerciseId={exerciseId ?? ''} />;
}
export function ChallengeRoute() {
  const { exerciseId } = useParams({ strict: false }) as { exerciseId?: string };
  return <ChallengeWorkspace key={exerciseId} exerciseId={exerciseId ?? ''} />;
}
export function InterviewRoute() {
  const { interviewId } = useParams({ strict: false }) as { interviewId?: string };
  return <InterviewSession key={interviewId} interviewId={interviewId ?? ''} />;
}

/** The hunt's funnel from this desktop's own store. */
export function funnelFrom(d: Dashboard | undefined) {
  if (!d) return null;
  const t = d.total;
  return {
    found: t.jobsDiscovered,
    relevant: t.relevant,
    applied: t.applied,
    interviews: t.interviews,
    offers: t.offers,
  };
}

export function DesktopProgress() {
  const dashboard = useDashboard();
  return <ProgressPage hunt={<FunnelPanel counts={funnelFrom(dashboard.data)} />} />;
}
