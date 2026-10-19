import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../../common/http/current-user.decorator.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { JwtAuthGuard } from '../../auth/infrastructure/jwt-auth.guard.js';
import {
  InterviewPrepService,
  type PrepQuestionView,
  type PrepView,
} from '../application/interview-prep.service.js';
import { PrepAiRouter, type PrepAiSource } from '../application/prep-ai.router.js';

const when = z
  .string()
  .datetime({ offset: true, message: 'Use an ISO date-time, e.g. 2026-11-03T10:30:00+05:30' });

const createSchema = z.object({
  company: z.string().trim().max(120).nullish(),
  role: z.string().trim().max(120).nullish(),
  jobDescription: z.string().trim().max(20_000).nullish(),
  technologies: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  scheduledAt: when,
});

const updateSchema = z.object({
  company: z.string().trim().max(120).nullish(),
  role: z.string().trim().max(120).nullish(),
  scheduledAt: when.optional(),
});

const answerSchema = z.object({ answer: z.string().trim().min(1).max(6_000) });

@ApiTags('interview-prep')
@Controller('interview-preps')
@UseGuards(JwtAuthGuard)
export class InterviewPrepController {
  constructor(
    private readonly preps: InterviewPrepService,
    private readonly ai: PrepAiRouter,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Interviews being prepared for, soonest first' })
  async list(@CurrentUser() user: AuthenticatedUser): Promise<{ preps: PrepView[] }> {
    return { preps: await this.preps.list(user.userId) };
  }

  @Get('ai')
  @ApiOperation({ summary: 'Where prep AI would run right now: desktop, openai, or nowhere' })
  async ai_(@CurrentUser() user: AuthenticatedUser): Promise<{ source: PrepAiSource | null }> {
    return { source: await this.ai.canRun(user.userId) };
  }

  @Post()
  @ApiOperation({ summary: 'Prepare for an interview from a job description and/or technologies' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>,
  ): Promise<PrepView> {
    return this.preps.create(user.userId, body);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<PrepView> {
    return this.preps.get(user.userId, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSchema)) body: z.infer<typeof updateSchema>,
  ): Promise<PrepView> {
    return this.preps.update(user.userId, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    return this.preps.remove(user.userId, id);
  }

  @Post(':id/regenerate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Write the plan and questions again' })
  regenerate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<PrepView> {
    return this.preps.regenerate(user.userId, id);
  }

  @Post(':id/questions/:questionId/answer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Answer a practice question; AI grades it against the key points' })
  answer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('questionId') questionId: string,
    @Body(new ZodValidationPipe(answerSchema)) body: z.infer<typeof answerSchema>,
  ): Promise<PrepQuestionView> {
    return this.preps.answer(user.userId, id, questionId, body.answer);
  }
}
