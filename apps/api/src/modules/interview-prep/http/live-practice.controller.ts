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
  LivePracticeService,
  type LivePracticeSummary,
  type LivePracticeView,
} from '../application/live-practice.service.js';

const answerFor = z.enum(['me', 'neutral']);

const createSchema = z.object({
  prepId: z.string().trim().min(1).nullish(),
  technologies: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  title: z.string().trim().max(120).nullish(),
  answerFor: answerFor.optional(),
});

const updateSchema = z.object({
  answerFor: answerFor.optional(),
  title: z.string().trim().max(120).nullish(),
});

const audioSchema = z.object({
  // 4 MB of audio is about 5.6 MB of base64.
  audioBase64: z.string().max(5_700_000),
  fileName: z.string().trim().min(1).max(100),
  durationMs: z.number().int().min(0).max(120_000),
});

const textSchema = z.object({ text: z.string().trim().min(1).max(4_000) });

/** Live practice with a partner (docs/live-practice.md). OpenAI only. */
@ApiTags('interview-prep')
@Controller('live-practice')
@UseGuards(JwtAuthGuard)
export class LivePracticeController {
  constructor(private readonly live: LivePracticeService) {}

  @Get('ready')
  @ApiOperation({ summary: 'Whether live practice can run: it needs a saved OpenAI key' })
  ready(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ ready: boolean; reason: string | null }> {
    return this.live.ready(user.userId);
  }

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser): Promise<{ sessions: LivePracticeSummary[] }> {
    return { sessions: await this.live.list(user.userId) };
  }

  @Post()
  @ApiOperation({ summary: 'Start a live practice session, for a prep or for technologies' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>,
  ): Promise<LivePracticeView> {
    return this.live.create(user.userId, body);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<LivePracticeView> {
    return this.live.get(user.userId, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSchema)) body: z.infer<typeof updateSchema>,
  ): Promise<LivePracticeView> {
    return this.live.update(user.userId, id, body);
  }

  @Post(':id/audio')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'A segment of speech: transcribed, classified, answered' })
  audio(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(audioSchema)) body: z.infer<typeof audioSchema>,
  ): Promise<LivePracticeView> {
    return this.live.audio(user.userId, id, body);
  }

  @Post(':id/text')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Typed instead of spoken: classified and answered like speech' })
  text(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(textSchema)) body: z.infer<typeof textSchema>,
  ): Promise<LivePracticeView> {
    return this.live.text(user.userId, id, body.text);
  }

  @Post(':id/questions/:questionId/grade')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Grade a question's spoken answer now" })
  grade(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('questionId') questionId: string,
  ): Promise<LivePracticeView> {
    return this.live.grade(user.userId, id, questionId);
  }

  @Post(':id/end')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'End the session; ungraded answers are graded in the background' })
  end(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<LivePracticeView> {
    return this.live.end(user.userId, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    return this.live.remove(user.userId, id);
  }
}
