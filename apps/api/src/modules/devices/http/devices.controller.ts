import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../../common/http/current-user.decorator.js';
import { Problems } from '../../../common/http/problem-details.js';
import { RateLimitGuard } from '../../../common/http/rate-limit.guard.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { JwtAuthGuard } from '../../auth/infrastructure/jwt-auth.guard.js';
import { HubService } from '../../hub/application/hub.service.js';
import {
  DevicesService,
  type DeviceView,
  type IssuedDevice,
} from '../application/devices.service.js';

const deviceName = z.string().trim().min(1, 'Name the device').max(80);
const platform = z.string().trim().max(80).default('');

const registerSchema = z.object({
  name: deviceName,
  kind: z.enum(['desktop', 'mobile']),
  platform,
});
const pushTokenSchema = z.object({ token: z.string().min(10).max(4096).nullable() });
const redeemSchema = z.object({
  code: z.string().trim().min(4).max(16),
  name: deviceName,
  platform,
});
const desktopRequestSchema = z.object({
  type: z
    .string()
    .regex(/^[a-z_]{1,64}$/, 'type must be a request type like "approve_application"'),
  payload: z.unknown().optional(),
});

/** HTTP status for the error codes a desktop answers with. */
const REPLY_STATUS: Record<string, number> = {
  DESKTOP_OFFLINE: 503,
  DESKTOP_TIMEOUT: 504,
  NOT_FOUND: 404,
  AGENT_BUSY: 409,
  INVALID_TRANSITION: 409,
};

@ApiTags('devices')
@Controller()
export class DevicesController {
  constructor(
    private readonly devices: DevicesService,
    private readonly hub: HubService,
  ) {}

  @Post('devices/register')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Register this desktop or phone; returns its device token once' })
  register(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(registerSchema)) body: z.infer<typeof registerSchema>,
  ): Promise<IssuedDevice> {
    return this.devices.register(user.userId, body);
  }

  @Get('devices')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Desktops and phones signed in to this account' })
  async list(@CurrentUser() user: AuthenticatedUser): Promise<{ devices: DeviceView[] }> {
    return { devices: await this.devices.list(user.userId) };
  }

  @Delete('devices/:id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Sign a device out' })
  revoke(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    return this.devices.revoke(user.userId, id);
  }

  @Put('devices/me/push-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "A phone's Firebase push token (null clears it)" })
  async setPushToken(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(pushTokenSchema)) body: z.infer<typeof pushTokenSchema>,
  ): Promise<{ ok: true }> {
    // Only with the phone's own device token, so it lands on the right device.
    if (!user.deviceId) throw Problems.unauthorized('Use this phone’s device token.');
    await this.devices.setPushToken(user.userId, user.deviceId, body.token);
    return { ok: true };
  }

  @Post('pairing/create')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'A one-time code for a phone to pair with' })
  createPairing(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ code: string; expiresAt: string }> {
    return this.devices.createPairingCode(user.userId);
  }

  @Post('pairing/redeem')
  @UseGuards(RateLimitGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange a pairing code for a phone device token' })
  redeemPairing(
    @Body(new ZodValidationPipe(redeemSchema)) body: z.infer<typeof redeemSchema>,
  ): Promise<IssuedDevice & { userId: string }> {
    return this.devices.redeemPairingCode(body);
  }

  /**
   * The web app acting on the desktop: the same requests a phone sends over
   * the hub. The server only relays; the desktop runs each one through the
   * same approval-gated code as its own UI and this returns its reply.
   */
  @Post('desktop/request')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Send a request to this account’s desktop and wait for its reply' })
  async desktopRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(desktopRequestSchema)) body: z.infer<typeof desktopRequestSchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ data: unknown } | { error: { code: string; message: string } }> {
    const reply = await this.hub.request(user.userId, body.type, body.payload ?? {});
    if (reply.ok) return { data: reply.data ?? null };
    const error = reply.error ?? { code: 'OTHER', message: "The desktop couldn't do that." };
    res.status(REPLY_STATUS[error.code] ?? 400);
    return { error };
  }

  @Get('desktop/status')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Whether this account’s desktop is online, and its Claude' })
  status(@CurrentUser() user: AuthenticatedUser) {
    const info = this.hub.desktopInfo(user.userId);
    return { online: info !== null, desktop: info };
  }
}
