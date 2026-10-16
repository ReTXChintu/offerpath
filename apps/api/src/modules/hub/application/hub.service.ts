import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';

import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';

import type { CliJob, CliOutcome } from '@offerpath/ai';
import type { AppConfig } from '@offerpath/config';

import { APP_CONFIG } from '../../../infrastructure/config/config.module.js';
import { DeviceAuthService, type DeviceIdentity } from './device-auth.service.js';

/**
 * The one WebSocket every device holds open: `/<prefix>/v1/hub?token=<deviceToken>`.
 *
 * Frames are `{ v: 1, id, type, payload }` (docs/hub-protocol.md). The hub
 * routes them by which device sent them and never looks inside a relayed
 * payload:
 *
 * - **phone → desktop**: requests (approve, answer, start a hunt); answered
 *   with DESKTOP_OFFLINE when no desktop is connected.
 * - **desktop → phones**: replies, pushes and `changed` notices.
 * - **server → desktop**: requests for the web app (`request()`), and AI jobs
 *   (`runAiJob()`), which the desktop runs with its local Claude CLI.
 *
 * One desktop per account is online at a time: a second one replaces the
 * first. In memory, because the API is one process (ecosystem.config.cjs).
 */

export type HubFrame = { v: 1; id: string; type: string; payload?: unknown };

/** The desktop's answer to a request, as in a `response` frame's payload. */
export interface DesktopReply {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

/** What a desktop says about itself in its `hello` frame. */
export interface DesktopInfo {
  version: string | null;
  claude: { available: boolean; detail: string | null };
}

interface Connection {
  device: DeviceIdentity;
  socket: WebSocket;
  connectedAt: Date;
  alive: boolean;
  /** Desktops only, once their hello arrives. */
  info: DesktopInfo | null;
}

interface UserChannels {
  desktop: Connection | null;
  mobiles: Connection[];
}

interface Pending {
  userId: string;
  resolve: (frame: HubFrame) => void;
  timer: NodeJS.Timeout;
}

/** Close codes devices act on. */
export const HUB_CLOSE_UNAUTHORIZED = 4401;
export const HUB_CLOSE_REPLACED = 4409;

const HEARTBEAT_MS = 25_000;

export const DESKTOP_OFFLINE = {
  code: 'DESKTOP_OFFLINE',
  message: 'Your desktop is not online right now. Open Offerpath on your computer.',
};

@Injectable()
export class HubService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(HubService.name);

  /** Prompts and schemas are text; a few MB covers the largest generation prompt. */
  private readonly server = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });
  private readonly users = new Map<string, UserChannels>();
  /** Requests the server itself sent to a desktop, by frame id. */
  private readonly pending = new Map<string, Pending>();
  private heartbeat: NodeJS.Timeout | null = null;
  private readonly listeners = new Set<(userId: string, online: boolean) => void>();

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly devices: DeviceAuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  get path(): string {
    return `/${this.config.env.API_GLOBAL_PREFIX}/v1/hub`;
  }

  onApplicationBootstrap(): void {
    const http = this.adapterHost.httpAdapter?.getHttpServer() as Server | undefined;
    if (!http) return;

    http.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      void this.onUpgrade(request, socket, head);
    });

    // A laptop going to sleep never sends a close frame: one missed ping and
    // the connection is gone, whatever its socket thinks.
    this.heartbeat = setInterval(() => {
      for (const connection of this.allConnections()) {
        if (!connection.alive) {
          connection.socket.terminate();
          continue;
        }
        connection.alive = false;
        connection.socket.ping();
      }
    }, HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  onModuleDestroy(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const connection of this.allConnections())
      connection.socket.close(1001, 'Server restarting');
    this.server.close();
  }

  // -- Connections --------------------------------------------------------------

  private async onUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname !== this.path) return; // Not ours; another handler may want it.

    const token = url.searchParams.get('token') ?? bearer(request.headers.authorization);
    const device = token ? await this.devices.identify(token).catch(() => null) : null;

    this.server.handleUpgrade(request, socket, head, (ws) => {
      if (!device) {
        ws.close(HUB_CLOSE_UNAUTHORIZED, 'Invalid device token');
        return;
      }
      this.attach(ws, device);
    });
  }

  private attach(socket: WebSocket, device: DeviceIdentity): void {
    const connection: Connection = {
      device,
      socket,
      connectedAt: new Date(),
      alive: true,
      info: null,
    };
    const channels = this.channelsFor(device.userId);

    if (device.kind === 'DESKTOP') {
      const old = channels.desktop;
      channels.desktop = connection;
      if (old) old.socket.close(HUB_CLOSE_REPLACED, 'Another desktop signed in to this account');
      this.broadcastPresence(device.userId, true);
    } else {
      channels.mobiles = channels.mobiles.filter((c) => c.device.deviceId !== device.deviceId);
      channels.mobiles.push(connection);
      this.send(socket, presenceFrame(channels.desktop !== null));
    }
    this.devices.markSeen(device.deviceId);
    this.logger.log(`${device.kind.toLowerCase()} ${device.deviceId} connected`);

    socket.on('pong', () => {
      connection.alive = true;
    });
    socket.on('message', (raw: RawData) => {
      connection.alive = true;
      this.devices.markSeen(device.deviceId);
      this.onMessage(connection, raw.toString());
    });
    const detach = () => this.detach(connection);
    socket.on('close', detach);
    socket.on('error', detach);
  }

  private detach(connection: Connection): void {
    const { userId, deviceId, kind } = connection.device;
    const channels = this.users.get(userId);
    if (!channels) return;
    if (kind === 'DESKTOP') {
      // Already replaced by a newer connection: nothing to undo.
      if (channels.desktop !== connection) return;
      channels.desktop = null;
      this.broadcastPresence(userId, false);
      // Anything the server was waiting for from this desktop fails now,
      // rather than at its timeout.
      for (const [id, pending] of this.pending) {
        if (pending.userId !== userId) continue;
        this.pending.delete(id);
        clearTimeout(pending.timer);
        pending.resolve(failedFrame(id, DESKTOP_OFFLINE));
      }
    } else {
      channels.mobiles = channels.mobiles.filter((c) => c !== connection);
    }
    if (!channels.desktop && channels.mobiles.length === 0) this.users.delete(userId);
    this.logger.log(`${kind.toLowerCase()} ${deviceId} disconnected`);
  }

  private onMessage(connection: Connection, text: string): void {
    const { userId, kind } = connection.device;

    if (kind === 'MOBILE') {
      if (!this.routeToDesktop(userId, text)) {
        this.send(connection.socket, offlineResponseFrame(text));
      }
      return;
    }

    const frame = parseFrame(text);
    if (frame?.type === 'hello') {
      connection.info = parseInfo(frame.payload);
      for (const listener of this.listeners) listener(userId, true);
      return;
    }
    // An answer to something the server asked: not meant for the phones.
    if (frame && this.pending.has(frame.id)) {
      const pending = this.pending.get(frame.id)!;
      this.pending.delete(frame.id);
      clearTimeout(pending.timer);
      pending.resolve(frame);
      return;
    }
    this.routeToMobiles(userId, text);
  }

  // -- Routing ------------------------------------------------------------------

  routeToDesktop(userId: string, text: string): boolean {
    const desktop = this.users.get(userId)?.desktop;
    if (!desktop) return false;
    this.send(desktop.socket, text);
    return true;
  }

  routeToMobiles(userId: string, text: string): void {
    for (const mobile of this.users.get(userId)?.mobiles ?? []) this.send(mobile.socket, text);
  }

  /** A frame from the server to every phone of the account (`changed`, `notification`). */
  pushToMobiles(userId: string, type: string, payload: unknown): void {
    this.routeToMobiles(userId, JSON.stringify({ v: 1, id: randomUUID(), type, payload }));
  }

  /**
   * Sends a request to the account's desktop on behalf of an HTTP caller (the
   * web app) and resolves with its reply, exactly like a phone's request. The
   * desktop runs it through the same approval-gated code as its own UI.
   */
  async request(
    userId: string,
    type: string,
    payload: unknown,
    timeoutMs = 30_000,
  ): Promise<DesktopReply> {
    const frame = await this.ask(userId, type, payload ?? {}, timeoutMs, {
      code: 'DESKTOP_TIMEOUT',
      message: "Your desktop didn't answer in time. Try again.",
    });
    return (frame.payload ?? { ok: false }) as DesktopReply;
  }

  /**
   * Hands one AI job to the account's desktop and waits for what its Claude
   * CLI printed. Rejects when no desktop is online, Claude isn't available on
   * it, or it doesn't answer in time.
   */
  async runAiJob(
    userId: string,
    jobId: string,
    job: CliJob,
    signal?: AbortSignal,
  ): Promise<{ outcome: CliOutcome; deviceId: string }> {
    const desktop = this.users.get(userId)?.desktop;
    if (!desktop) throw new HubError(DESKTOP_OFFLINE.message);
    if (desktop.info && !desktop.info.claude.available) {
      throw new HubError(
        `Claude Code isn't available on your desktop${desktop.info.claude.detail ? `: ${desktop.info.claude.detail}` : ''}.`,
      );
    }

    // The desktop's own process start plus the round trip, beyond the job's timeout.
    const timeoutMs = job.timeoutMs + 15_000;
    const onAbort = () => {
      this.send(desktop.socket, JSON.stringify({ v: 1, id: jobId, type: 'ai_job_cancel' }));
      const pending = this.pending.get(jobId);
      if (!pending) return;
      this.pending.delete(jobId);
      clearTimeout(pending.timer);
      pending.resolve(failedFrame(jobId, { code: 'CANCELLED', message: 'Cancelled' }));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const frame = await this.ask(
        userId,
        'ai_job',
        { jobId, job },
        timeoutMs,
        {
          code: 'DESKTOP_TIMEOUT',
          message: `Your desktop did not finish the AI job within ${Math.round(timeoutMs / 1000)}s.`,
        },
        jobId,
      );

      if (frame.type === 'ai_job_result') {
        const outcome = (frame.payload as { outcome?: Partial<CliOutcome> } | undefined)?.outcome;
        return {
          deviceId: desktop.device.deviceId,
          outcome: {
            stdout: typeof outcome?.stdout === 'string' ? outcome.stdout : '',
            stderr: typeof outcome?.stderr === 'string' ? outcome.stderr : '',
            code: typeof outcome?.code === 'number' ? outcome.code : null,
            answer: null,
          },
        };
      }
      const error = (frame.payload as { error?: { message?: unknown } } | undefined)?.error;
      throw new HubError(
        typeof error?.message === 'string'
          ? error.message.slice(0, 500)
          : 'The AI job failed on your desktop.',
      );
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  private ask(
    userId: string,
    type: string,
    payload: unknown,
    timeoutMs: number,
    timeoutError: { code: string; message: string },
    id = `srv-${randomUUID()}`,
  ): Promise<HubFrame> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(failedFrame(id, timeoutError));
      }, timeoutMs);
      this.pending.set(id, { userId, resolve, timer });
      if (!this.routeToDesktop(userId, JSON.stringify({ v: 1, id, type, payload }))) {
        clearTimeout(timer);
        this.pending.delete(id);
        resolve(failedFrame(id, DESKTOP_OFFLINE));
      }
    });
  }

  // -- Presence -----------------------------------------------------------------

  /** Accounts whose desktop is connected and has Claude available. */
  aiReadyUsers(): string[] {
    return [...this.users.entries()]
      .filter(([, c]) => c.desktop?.info?.claude.available)
      .map(([userId]) => userId);
  }

  isDesktopOnline(userId: string): boolean {
    return !!this.users.get(userId)?.desktop;
  }

  desktopInfo(userId: string): (DesktopInfo & { deviceId: string; connectedAt: string }) | null {
    const desktop = this.users.get(userId)?.desktop;
    if (!desktop) return null;
    return {
      deviceId: desktop.device.deviceId,
      connectedAt: desktop.connectedAt.toISOString(),
      version: desktop.info?.version ?? null,
      claude: desktop.info?.claude ?? {
        available: false,
        detail: 'Waiting for the desktop to say hello',
      },
    };
  }

  isOnline(userId: string, deviceId: string): boolean {
    const channels = this.users.get(userId);
    if (!channels) return false;
    return (
      channels.desktop?.device.deviceId === deviceId ||
      channels.mobiles.some((m) => m.device.deviceId === deviceId)
    );
  }

  /** Called when an account's desktop comes online (after its hello) or goes offline. */
  onDesktopPresence(listener: (userId: string, online: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Closes a revoked device's socket. */
  forceDisconnect(userId: string, deviceId: string): void {
    const channels = this.users.get(userId);
    if (!channels) return;
    if (channels.desktop?.device.deviceId === deviceId) {
      channels.desktop.socket.close(HUB_CLOSE_UNAUTHORIZED, 'This device was signed out');
    }
    for (const mobile of channels.mobiles) {
      if (mobile.device.deviceId === deviceId) {
        mobile.socket.close(HUB_CLOSE_UNAUTHORIZED, 'This device was signed out');
      }
    }
  }

  private broadcastPresence(userId: string, online: boolean): void {
    this.routeToMobiles(userId, presenceFrame(online));
    if (!online) for (const listener of this.listeners) listener(userId, false);
  }

  private channelsFor(userId: string): UserChannels {
    let channels = this.users.get(userId);
    if (!channels) {
      channels = { desktop: null, mobiles: [] };
      this.users.set(userId, channels);
    }
    return channels;
  }

  private *allConnections(): Iterable<Connection> {
    for (const channels of this.users.values()) {
      if (channels.desktop) yield channels.desktop;
      yield* channels.mobiles;
    }
  }

  private send(socket: WebSocket, text: string): void {
    if (socket.readyState === socket.OPEN) socket.send(text);
  }
}

export class HubError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HubError';
  }
}

function bearer(header: string | undefined): string | null {
  return header?.startsWith('Bearer ') ? header.slice(7) : null;
}

function parseFrame(text: string): HubFrame | null {
  try {
    const frame = JSON.parse(text) as Partial<HubFrame>;
    if (typeof frame?.id !== 'string' || typeof frame.type !== 'string') return null;
    return frame as HubFrame;
  } catch {
    return null;
  }
}

function parseInfo(payload: unknown): DesktopInfo {
  const p = (payload ?? {}) as {
    version?: unknown;
    claude?: { available?: unknown; detail?: unknown };
  };
  return {
    version: typeof p.version === 'string' ? p.version.slice(0, 40) : null,
    claude: {
      available: p.claude?.available === true,
      detail: typeof p.claude?.detail === 'string' ? p.claude.detail.slice(0, 500) : null,
    },
  };
}

export function presenceFrame(online: boolean): string {
  return JSON.stringify({
    v: 1,
    id: randomUUID(),
    type: 'presence',
    payload: { device: 'desktop', online, lastSeenAt: new Date().toISOString() },
  });
}

function failedFrame(id: string, error: { code: string; message: string }): HubFrame {
  return { v: 1, id, type: 'response', payload: { ok: false, error } };
}

/** Echoes the request's own id, so the phone's pending request resolves. */
function offlineResponseFrame(inbound: string): string {
  const id = parseFrame(inbound)?.id ?? randomUUID();
  return JSON.stringify({
    v: 1,
    id,
    type: 'response',
    payload: { ok: false, error: DESKTOP_OFFLINE },
  });
}
