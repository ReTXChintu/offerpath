import type { ProblemDetails } from '@offerpath/types';

/**
 * The learning pages' transport: a small fetch wrapper over the Offerpath
 * API, built by the host. The web app hands it the signed-in user's access
 * token (and a refresh); the desktop hands it its device token. The pages
 * never read a token or a base URL themselves.
 *
 * Errors always arrive as RFC 9457 problem documents, so `ApiError` carries
 * the `type` and callers can branch on the failure mode instead of matching
 * on a message that is free to change.
 */

export class ApiError extends Error {
  constructor(
    public readonly problem: ProblemDetails,
    /** The response body as it came, when it was not problem details (e.g. the desktop relay's `{ error }`). */
    public readonly body: unknown = null,
  ) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
  }

  get status(): number {
    return this.problem.status;
  }

  /** `exercise-locked`, `assistance-gated`, `ai-unavailable`, … */
  get kind(): string {
    return this.problem.type.split(/[/:]/).pop() ?? 'error';
  }

  /** Field errors from a validation failure, if any. */
  get fieldErrors(): Record<string, string[]> {
    return this.problem.errors ?? {};
  }
}

/** Whether a failure means "the desktop that runs AI is offline", not a real error. */
export function isAiUnavailable(error: unknown): boolean {
  return error instanceof ApiError && error.kind === 'ai-unavailable';
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
  /**
   * Lets the request outlive the page that started it: ending a learning
   * session while navigating away. `sendBeacon` cannot carry the
   * Authorization header.
   */
  keepalive?: boolean;
}

/** How the learning pages reach the API. */
export interface LearnClient {
  request<T>(path: string, options?: RequestOptions): Promise<T>;
}

export interface FetchClientOptions {
  /** The API's base, e.g. `http://localhost:50005/api/v1` or `/api/v1`. */
  baseUrl: string | (() => string);
  /** The bearer token for the next request: an access token or a device token. */
  getToken: () => string | null | Promise<string | null>;
  /**
   * Called once on a 401; resolves true when it obtained a new token, and
   * the request is retried once. Absent for device tokens, which don't expire.
   */
  refresh?: () => Promise<boolean>;
  /** Called when a 401 could not be recovered (signed out or revoked). */
  onUnauthorized?: () => void;
  fetch?: typeof fetch;
}

/** A `LearnClient` over `fetch`. Also used by the web app for its own calls. */
export function createFetchClient(options: FetchClientOptions): LearnClient {
  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const base = () =>
    (typeof options.baseUrl === 'function' ? options.baseUrl() : options.baseUrl).replace(
      /\/+$/,
      '',
    );

  async function send<T>(path: string, req: RequestOptions, isRetry: boolean): Promise<T> {
    const { method = 'GET', body, idempotencyKey, signal, keepalive } = req;
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    const token = await options.getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    let response: Response;
    try {
      response = await doFetch(`${base()}${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        ...(signal ? { signal } : {}),
        ...(keepalive ? { keepalive: true } : {}),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      throw new ApiError({
        type: 'urn:offerpath:error:network',
        title: 'Cannot reach the server',
        status: 0,
        detail: 'Cannot reach the Offerpath server. Check your connection and try again.',
      });
    }

    // One transparent refresh attempt. Without the isRetry guard an expired
    // refresh token would spin forever.
    if (response.status === 401) {
      if (!isRetry && options.refresh && (await options.refresh())) {
        return send<T>(path, req, true);
      }
      options.onUnauthorized?.();
    }

    if (response.status === 204) return undefined as T;

    const text = await response.text().catch(() => '');
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      throw new ApiError(
        isProblemDetails(payload)
          ? payload
          : {
              type: 'urn:offerpath:error:unknown',
              title: 'Request failed',
              status: response.status,
            },
        payload,
      );
    }

    // An empty 200 (e.g. "no roadmap yet") reads as null.
    return payload as T;
  }

  return { request: (path, req = {}) => send(path, req, false) };
}

function isProblemDetails(value: unknown): value is ProblemDetails {
  return typeof value === 'object' && value !== null && 'title' in value && 'status' in value;
}
