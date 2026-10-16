import { randomBytes } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';

import type { AppConfig } from '@offerpath/config';
import type { DeviceKind } from '@offerpath/database';

import { Problems } from '../../../common/http/problem-details.js';
import { APP_CONFIG } from '../../../infrastructure/config/config.module.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import {
  DeviceAuthService,
  hashToken,
  newDeviceToken,
  recentlySeen,
} from '../../hub/application/device-auth.service.js';
import { HubService } from '../../hub/application/hub.service.js';

export type DeviceKindName = 'desktop' | 'mobile';

export interface DeviceView {
  id: string;
  name: string;
  kind: DeviceKindName;
  platform: string;
  createdAt: string;
  lastSeenAt: string | null;
  online: boolean;
}

export interface IssuedDevice {
  deviceId: string;
  deviceToken: string;
}

/**
 * Read off one screen and typed on another (or scanned as a QR code), so the
 * alphabet leaves out look-alikes (0/O, 1/I/L).
 */
const PAIRING_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export function randomPairingCode(): string {
  let out = '';
  for (const byte of randomBytes(6)) out += PAIRING_ALPHABET[byte % PAIRING_ALPHABET.length];
  return out;
}

const toKind = (kind: DeviceKindName): DeviceKind => (kind === 'desktop' ? 'DESKTOP' : 'MOBILE');
const fromKind = (kind: DeviceKind): DeviceKindName => (kind === 'DESKTOP' ? 'desktop' : 'mobile');

/**
 * Desktops and phones signed in to an account.
 *
 * A device signs in once (a desktop with email and password, a phone by
 * scanning the desktop's pairing code) and gets an opaque device token. Only
 * its hash is stored; revoking the device makes it useless at once.
 */
@Injectable()
export class DevicesService {
  private readonly logger = new Logger(DevicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hub: HubService,
    private readonly deviceAuth: DeviceAuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async register(
    userId: string,
    input: { name: string; kind: DeviceKindName; platform: string },
  ): Promise<IssuedDevice> {
    const token = newDeviceToken();
    const device = await this.prisma.device.create({
      data: {
        userId,
        name: input.name,
        kind: toKind(input.kind),
        platform: input.platform,
        tokenHash: hashToken(token),
      },
      select: { id: true },
    });
    this.logger.log(`device ${device.id} (${input.kind}) registered for ${userId}`);
    return { deviceId: device.id, deviceToken: token };
  }

  async list(userId: string): Promise<DeviceView[]> {
    const devices = await this.prisma.device.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    return devices.map((d) => ({
      id: d.id,
      name: d.name,
      kind: fromKind(d.kind),
      platform: d.platform,
      createdAt: d.createdAt.toISOString(),
      lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
      // A live socket, or a recent request (the desktop's sync heartbeat).
      online: this.hub.isOnline(userId, d.id) || recentlySeen(d.lastSeenAt),
    }));
  }

  async revoke(userId: string, deviceId: string): Promise<void> {
    const { count } = await this.prisma.device.deleteMany({ where: { id: deviceId, userId } });
    if (count === 0) throw Problems.notFound('Device');
    this.deviceAuth.forget(deviceId);
    this.hub.forceDisconnect(userId, deviceId);
    this.logger.log(`device ${deviceId} revoked by ${userId}`);
  }

  /** A phone registers (or, with null, clears) its Firebase push token. */
  async setPushToken(userId: string, deviceId: string, token: string | null): Promise<void> {
    await this.prisma.device.updateMany({
      where: { id: deviceId, userId },
      data: { pushToken: token },
    });
  }

  /** A short-lived, single-use code the desktop shows (as a QR code) for a phone to redeem. */
  async createPairingCode(userId: string): Promise<{ code: string; expiresAt: string }> {
    const expiresAt = new Date(Date.now() + this.config.env.PAIRING_CODE_TTL_SECS * 1000);
    // Old codes are dead weight; clearing them here keeps the table tiny.
    await this.prisma.pairingCode.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = randomPairingCode();
      try {
        await this.prisma.pairingCode.create({
          data: { codeHash: hashToken(code), userId, expiresAt },
        });
        return { code, expiresAt: expiresAt.toISOString() };
      } catch {
        // A collision on a 31^6 space: astronomically rare, so just draw again.
      }
    }
    throw Problems.internal();
  }

  /** Redeems a pairing code for a phone's device token. */
  async redeemPairingCode(input: {
    code: string;
    name: string;
    platform: string;
  }): Promise<IssuedDevice & { userId: string }> {
    const now = new Date();
    const codeHash = hashToken(input.code.trim().toUpperCase());
    // One statement, so two phones racing for the same code can't both win.
    const { count } = await this.prisma.pairingCode.updateMany({
      where: { codeHash, redeemedAt: null, expiresAt: { gt: now } },
      data: { redeemedAt: now },
    });
    if (count === 0) {
      throw Problems.badRequest(
        'That pairing code is invalid or has expired. Show a new one on your desktop.',
      );
    }
    const { userId } = await this.prisma.pairingCode.findUniqueOrThrow({
      where: { codeHash },
      select: { userId: true },
    });
    const issued = await this.register(userId, {
      name: input.name,
      kind: 'mobile',
      platform: input.platform,
    });
    return { ...issued, userId };
  }
}
