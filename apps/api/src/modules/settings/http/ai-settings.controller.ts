import { Body, Controller, Delete, Get, Put, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../../common/http/current-user.decorator.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { JwtAuthGuard } from '../../auth/infrastructure/jwt-auth.guard.js';
import { AiFallbackService, type FallbackKeyView } from '../application/ai-fallback.service.js';
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

const fallbackSchema = z.object({
  apiKey: z.string().trim().min(20).max(400).nullish(),
  modelFast: model.nullish(),
  modelReasoning: model.nullish(),
});

@ApiTags('settings')
@Controller('settings/ai')
@UseGuards(JwtAuthGuard)
export class AISettingsController {
  constructor(
    private readonly settings: AISettingsService,
    private readonly fallback: AiFallbackService,
  ) {}

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

  @Get('fallback')
  @ApiOperation({ summary: 'The OpenAI fallback for interview prep when the desktop is offline' })
  fallbackView(@CurrentUser() user: AuthenticatedUser): Promise<FallbackKeyView> {
    return this.fallback.view(user.userId);
  }

  @Put('fallback')
  @ApiOperation({ summary: 'Save the OpenAI fallback key (checked first) and its models' })
  saveFallback(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(fallbackSchema)) body: z.infer<typeof fallbackSchema>,
  ): Promise<FallbackKeyView> {
    return this.fallback.save(user.userId, body);
  }

  @Delete('fallback')
  @ApiOperation({ summary: 'Forget the OpenAI fallback key' })
  removeFallback(@CurrentUser() user: AuthenticatedUser): Promise<FallbackKeyView> {
    return this.fallback.remove(user.userId);
  }

  @Get('fallback/models')
  @ApiOperation({ summary: 'The OpenAI models the saved key can use' })
  async fallbackModels(@CurrentUser() user: AuthenticatedUser) {
    return { models: await this.fallback.models(user.userId) };
  }
}
