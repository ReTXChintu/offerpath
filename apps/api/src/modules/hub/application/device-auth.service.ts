import { createHash, randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import type { DeviceKind } from '@offerpath/database';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';

/** Who a device token belongs to. */
export interface DeviceIdentity {
  deviceId: string;
  userId: string;
  email: string;
  kind: DeviceKind;
}

/** Device tokens are opaque random hex; only their SHA-256 is stored. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newDeviceToken(): string {
  return randomBytes(32).toString('hex');
}

/** A device token is 64 hex characters; a JWT never is. */
export function looksLikeDeviceToken(token: string): boolean {
  return /^[0-9a-f]{64}$/.test(token);
}

/** Seen within this long counts as online (two missed one-minute sync heartbeats). */
export const PRESENCE_WINDOW_MS = 150_000;
const TOUCH_EVERY_MS = 30_000;
const CACHE_MS = 30_000;

/**
 * Resolves device tokens (desktops and phones) to their account.
 *
 * Every authenticated request from a desktop's sync carries one, so lookups
 * are cached briefly; a revoked device is dropped from the cache at once.
 */
@Injectable()
export class DeviceAuthService {
  private readonly cache = new Map<string, { identity: DeviceIdentity; at: number }>();
  private readonly lastTouched = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

  async identify(token: string): Promise<DeviceIdentity | null> {
    const hash = hashToken(token);
    const hit = this.cache.get(hash);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.identity;

    const device = await this.prisma.device.findUnique({
      where: { tokenHash: hash },
      select: {
        id: true,
        userId: true,
        kind: true,
        user: { select: { email: true, archivedAt: true } },
      },
    });
    if (!device || device.user.archivedAt) {
      this.cache.delete(hash);
      return null;
    }
    const identity: DeviceIdentity = {
      deviceId: device.id,
      userId: device.userId,
      email: device.user.email,
      kind: device.kind,
    };
    this.cache.set(hash, { identity, at: Date.now() });
    return identity;
  }

  /** Forget a revoked device straight away rather than at the cache's expiry. */
  forget(deviceId: string): void {
    for (const [hash, entry] of this.cache) {
      if (entry.identity.deviceId === deviceId) this.cache.delete(hash);
    }
  }

  /** Records "last seen", at most every 30 seconds per device. Never fails a request. */
  markSeen(deviceId: string, now = Date.now()): void {
    const last = this.lastTouched.get(deviceId) ?? 0;
    if (now - last < TOUCH_EVERY_MS) return;
    this.lastTouched.set(deviceId, now);
    this.prisma.device
      .update({ where: { id: deviceId }, data: { lastSeenAt: new Date(now) } })
      .catch(() => this.lastTouched.delete(deviceId));
  }
}

export function recentlySeen(lastSeenAt: Date | null, now = Date.now()): boolean {
  return !!lastSeenAt && now - lastSeenAt.getTime() <= PRESENCE_WINDOW_MS;
}
