import { ApiError, createFetchClient, type LearnClient } from '@offerpath/learn';
import type { ProblemDetails } from '@offerpath/types';

/**
 * The signed-in session: the account's email and its tokens. The access
 * token is short-lived; the refresh token renews it (and is rotated each
 * time). Kept in localStorage so a reload stays signed in.
 */
export interface Session {
  email: string;
  userId: string;
  accessToken: string;
  refreshToken: string;
}

interface AuthTokens {
  userId: string;
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

const STORAGE_KEY = 'offerpath.session';

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<Session>;
    return s.accessToken && s.refreshToken && s.email
      ? {
          email: s.email,
          userId: s.userId ?? '',
          accessToken: s.accessToken,
          refreshToken: s.refreshToken,
        }
      : null;
  } catch {
    return null;
  }
}

export function storeSession(session: Session | null): void {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable (a private window): the session just won't survive a reload.
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function problemFrom(status: number, body: unknown): ProblemDetails {
  if (body && typeof body === 'object' && 'title' in body && 'status' in body) {
    return body as ProblemDetails;
  }
  return { type: 'urn:offerpath:error:unknown', title: 'Request failed', status };
}

/**
 * Signing in, signing up, refreshing and signing out, plus the API client
 * every page uses (bearer token, one transparent refresh on a 401).
 */
export class Auth {
  private session: Session | null;
  private refreshing: Promise<boolean> | null = null;
  readonly client: LearnClient;

  constructor(
    private readonly baseUrl: string,
    initial: Session | null,
    private readonly onChange: (session: Session | null) => void,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {
    this.session = initial;
    this.client = createFetchClient({
      baseUrl,
      getToken: () => this.session?.accessToken ?? null,
      refresh: () => this.refresh(),
      onUnauthorized: () => this.set(null),
      fetch: fetchImpl as typeof fetch,
    });
  }

  get current(): Session | null {
    return this.session;
  }

  private set(session: Session | null): void {
    this.session = session;
    storeSession(session);
    this.onChange(session);
  }

  login(email: string, password: string): Promise<Session> {
    return this.authenticate('/auth/login', { email, password });
  }

  register(email: string, password: string, displayName: string): Promise<Session> {
    return this.authenticate('/auth/register', { email, password, displayName });
  }

  private async authenticate(path: string, body: Record<string, string>): Promise<Session> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      throw new ApiError({
        type: 'urn:offerpath:error:network',
        title: 'Cannot reach the server',
        status: 0,
        detail: 'Cannot reach the Offerpath server. Check your connection and try again.',
      });
    }
    const payload = await readJson(response);
    if (!response.ok) throw new ApiError(problemFrom(response.status, payload));
    const tokens = payload as AuthTokens;
    const session: Session = {
      email: (body.email ?? '').trim().toLowerCase(),
      userId: tokens.userId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
    this.set(session);
    return session;
  }

  /** One refresh at a time, however many requests hit a 401 together. */
  refresh(): Promise<boolean> {
    if (!this.refreshing) {
      this.refreshing = (async () => {
        const current = this.session;
        if (!current) return false;
        try {
          const response = await this.fetchImpl(`${this.baseUrl}/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: current.refreshToken }),
          });
          if (!response.ok) {
            this.set(null);
            return false;
          }
          const tokens = (await readJson(response)) as AuthTokens;
          this.set({
            ...current,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
          });
          return true;
        } catch {
          // Offline: keep the session; the request fails and can be retried.
          return false;
        }
      })().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  async logout(): Promise<void> {
    const refreshToken = this.session?.refreshToken;
    this.set(null);
    if (refreshToken) {
      await this.fetchImpl(`${this.baseUrl}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      }).catch(() => undefined);
    }
  }
}
