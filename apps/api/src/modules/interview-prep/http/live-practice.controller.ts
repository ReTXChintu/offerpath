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
  Put,
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
  type LiveExchangeView,
  type LivePracticeSummary,
  type LivePracticeView,
  type RealtimePass,
  type VoiceProfile,
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

const embedding = z.array(z.number().finite()).min(32).max(1_024);
const threshold = z.number().min(0).max(1);

const voiceSchema = z.object({
  model: z.string().trim().min(1).max(200),
  embedding,
  threshold: threshold.optional(),
});

const thresholdSchema = z.object({ threshold });

const exchangeSchema = z.object({
  question: z.string().trim().min(1).max(2_000),
  answer: z.string().trim().min(1).max(8_000),
});

/** Live practice with a partner (docs/live-practice.md). OpenAI Realtime only. */
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

  // Declared before ':id', so "voice" is never taken for a session id.

  @Get('voice')
  @ApiOperation({ summary: "The user's voiceprint, for telling them from the interviewer" })
  voice(@CurrentUser() user: AuthenticatedUser): Promise<VoiceProfile> {
    return this.live.voice(user.userId);
  }

  @Put('voice')
  @ApiOperation({ summary: 'Save the voiceprint the phone made (replaces the old one)' })
  saveVoice(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(voiceSchema)) body: z.infer<typeof voiceSchema>,
  ): Promise<VoiceProfile> {
    return this.live.saveVoice(user.userId, body);
  }

  @Patch('voice')
  @ApiOperation({ summary: 'Change how closely a voice must match to count as the user' })
  setThreshold(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(thresholdSchema)) body: z.infer<typeof thresholdSchema>,
  ): Promise<VoiceProfile> {
    return this.live.setThreshold(user.userId, body.threshold);
  }

  @Delete('voice')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteVoice(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    return this.live.deleteVoice(user.userId);
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

  @Post(':id/realtime')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'A short-lived pass for the phone to open the OpenAI Realtime session' })
  realtime(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<RealtimePass> {
    return this.live.realtime(user.userId, id);
  }

  @Post(':id/exchanges')
  @ApiOperation({ summary: 'Save a question the phone heard and the answer it got' })
  addExchange(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(exchangeSchema)) body: z.infer<typeof exchangeSchema>,
  ): Promise<LiveExchangeView> {
    return this.live.addExchange(user.userId, id, body);
  }

  @Post(':id/end')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'End the session' })
  end(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<LivePracticeView> {
    return this.live.end(user.userId, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    return this.live.remove(user.userId, id);
  }
}
