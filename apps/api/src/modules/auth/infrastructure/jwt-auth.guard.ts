import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

import type { AppConfig } from '@offerpath/config';

import type { AuthenticatedUser } from '../../../common/http/current-user.decorator.js';
import { Problems } from '../../../common/http/problem-details.js';
import { APP_CONFIG } from '../../../infrastructure/config/config.module.js';
import {
  DeviceAuthService,
  looksLikeDeviceToken,
} from '../../hub/application/device-auth.service.js';
import type { AccessTokenClaims } from '../domain/token.js';

/**
 * Accepts either credential every surface holds:
 *
 * - a short-lived **JWT access token** (the web app, after signing in), or
 * - an opaque **device token** (a signed-in desktop or a paired phone),
 *   stored hashed and revocable from Settings → Devices.
 *
 * Both resolve to the same `AuthenticatedUser`, so every endpoint serves
 * every surface. A device request also records the device as seen.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly devices: DeviceAuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const header = request.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      throw Problems.unauthorized('Provide a Bearer access token or device token.');
    }
    const token = header.slice(7).trim();

    if (looksLikeDeviceToken(token)) {
      const device = await this.devices.identify(token);
      if (!device) throw Problems.unauthorized('This device has been signed out.');
      this.devices.markSeen(device.deviceId);
      request.user = { userId: device.userId, email: device.email, deviceId: device.deviceId };
      return true;
    }

    try {
      const claims = await this.jwt.verifyAsync<AccessTokenClaims>(token, {
        secret: this.config.env.JWT_ACCESS_SECRET,
      });
      request.user = { userId: claims.sub, email: claims.email };
      return true;
    } catch {
      throw Problems.unauthorized('Your access token is invalid or has expired.');
    }
  }
}
