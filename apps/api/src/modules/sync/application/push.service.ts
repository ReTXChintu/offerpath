import { createSign } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { Inject, Injectable, Logger } from '@nestjs/common';

import type { AppConfig } from '@offerpath/config';

import { APP_CONFIG } from '../../../infrastructure/config/config.module.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';

export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

export interface PushMessage {
  title: string;
  body: string;
  /** String values only (FCM data payloads are string maps). */
  data: Record<string, string>;
}

type Fetch = typeof fetch;

/**
 * The service account from JSON text, base64 of it, or a path to the JSON
 * file (relative to the repo root, like the rest of the .env).
 */
export function parseServiceAccount(
  raw: string | undefined,
  baseDir: string,
): ServiceAccount | null {
  const value = raw?.trim().replace(/^["']|["']$/g, '');
  if (!value) return null;
  let text: string;
  if (value.startsWith('{')) {
    text = value;
  } else if (/\.json$/i.test(value) || /[\\/]/.test(value)) {
    const file = path.resolve(baseDir, value);
    if (!existsSync(file)) {
      throw new Error(`FCM_SERVICE_ACCOUNT points to ${file}, which doesn't exist.`);
    }
    text = readFileSync(file, 'utf8');
  } else {
    text = Buffer.from(value, 'base64').toString('utf8');
  }
  let parsed: Partial<ServiceAccount>;
  try {
    parsed = JSON.parse(text) as Partial<ServiceAccount>;
  } catch {
    throw new Error(
      'FCM_SERVICE_ACCOUNT isn’t valid JSON (give the JSON, base64 of it, or a path).',
    );
  }
  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new Error('FCM_SERVICE_ACCOUNT is not a Firebase service account.');
  }
  return parsed as ServiceAccount;
}

const base64url = (input: Buffer | string) => Buffer.from(input).toString('base64url');

/**
 * Push notifications to phones through Firebase Cloud Messaging (HTTP v1), so
 * they arrive even when the app is closed. Optional: without
 * FCM_SERVICE_ACCOUNT nothing is sent and phones check periodically instead.
 * Best-effort throughout: a failed push never fails the request behind it.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly account: ServiceAccount | null;
  private accessToken: { value: string; expiresAt: number } | null = null;
  /** Replaceable in tests. */
  fetchImpl: Fetch = fetch;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    let account: ServiceAccount | null = null;
    try {
      account = parseServiceAccount(config.env.FCM_SERVICE_ACCOUNT, config.repoRoot);
      if (account)
        this.logger.log(`Push notifications on (Firebase project ${account.project_id})`);
    } catch (error) {
      this.logger.error(`Push notifications off: ${(error as Error).message}`);
    }
    this.account = account;
  }

  get enabled(): boolean {
    return this.account !== null;
  }

  /** Sends to every phone of the account with a push token; forgets dead tokens. */
  async sendToUser(userId: string, message: PushMessage): Promise<void> {
    if (!this.account) return;
    try {
      const targets = await this.prisma.device.findMany({
        where: { userId, kind: 'MOBILE', pushToken: { not: null } },
        select: { id: true, pushToken: true },
      });
      const invalid = await this.send(
        targets.map((t) => ({ deviceId: t.id, token: t.pushToken! })),
        message,
      );
      if (invalid.length > 0) {
        await this.prisma.device.updateMany({
          where: { id: { in: invalid } },
          data: { pushToken: null },
        });
      }
    } catch (error) {
      this.logger.warn(`push failed: ${(error as Error).message}`);
    }
  }

  private async send(
    targets: { deviceId: string; token: string }[],
    message: PushMessage,
  ): Promise<string[]> {
    if (targets.length === 0 || !this.account) return [];
    const token = await this.token(this.account);
    const url = `https://fcm.googleapis.com/v1/projects/${this.account.project_id}/messages:send`;
    const invalid: string[] = [];
    await Promise.all(
      targets.map(async (t) => {
        const resp = await this.fetchImpl(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: {
              token: t.token,
              notification: { title: message.title, body: message.body },
              data: message.data,
              android: { priority: 'high', notification: { channel_id: 'offerpath_alerts' } },
            },
          }),
        });
        if (resp.ok) return;
        const text = await resp.text();
        // The token is gone for good: forget it rather than retry forever.
        if (
          resp.status === 404 ||
          text.includes('UNREGISTERED') ||
          (resp.status === 400 && text.includes('registration token'))
        ) {
          invalid.push(t.deviceId);
        } else {
          this.logger.warn(`push to ${t.deviceId} failed: ${resp.status} ${text.slice(0, 200)}`);
        }
      }),
    );
    return invalid;
  }

  /** A Google OAuth access token for FCM, cached until shortly before it expires. */
  private async token(account: ServiceAccount): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.accessToken && this.accessToken.expiresAt - 60 > now) return this.accessToken.value;
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64url(
      JSON.stringify({
        iss: account.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      }),
    );
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${claims}`);
    const assertion = `${header}.${claims}.${base64url(signer.sign(account.private_key))}`;
    const resp = await this.fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
    });
    if (!resp.ok) throw new Error(`Firebase auth failed: ${resp.status} ${await resp.text()}`);
    const body = (await resp.json()) as { access_token: string; expires_in: number };
    this.accessToken = { value: body.access_token, expiresAt: now + body.expires_in };
    return body.access_token;
  }
}
