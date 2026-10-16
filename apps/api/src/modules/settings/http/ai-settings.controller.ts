import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../../common/http/current-user.decorator.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { JwtAuthGuard } from '../../auth/infrastructure/jwt-auth.guard.js';
import { AISettingsService, type AISettingsView } from '../application/ai-settings.service.js';

/** A CLI alias ("sonnet") or a full model id ("claude-sonnet-5-5"). */
const model = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9._\-[\]]+$/, 'Use a model alias such as sonnet, or a full model id');

const updateSchema = z.object({
  fast: model.optional(),
  reasoning: model.optional(),
  tutor: model.nullable().optional(),
});

type UpdateInput = z.infer<typeof updateSchema>;

@ApiTags('settings')
@Controller('settings/ai')
@UseGuards(JwtAuthGuard)
export class AISettingsController {
  constructor(private readonly settings: AISettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Claude models per kind of work, and whether the desktop can run them' })
  view(@CurrentUser() user: AuthenticatedUser): Promise<AISettingsView> {
    return this.settings.view(user.userId);
  }

  @Put()
  @ApiOperation({ summary: 'Choose the Claude models' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(updateSchema)) body: UpdateInput,
  ): Promise<AISettingsView> {
    return this.settings.update(user.userId, body);
  }
}
