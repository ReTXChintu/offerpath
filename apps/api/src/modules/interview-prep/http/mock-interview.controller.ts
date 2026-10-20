import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
  MockInterviewService,
  type MockInterviewView,
} from '../application/mock-interview.service.js';

const answerSchema = z
  .object({
    text: z.string().max(8_000).optional(),
    code: z.string().max(20_000).nullish(),
    codeLanguage: z.string().trim().max(40).nullish(),
  })
  .refine((a) => Boolean(a.text?.trim() || a.code?.trim()), {
    message: 'Write an answer or some code.',
    path: ['text'],
  });

/** Mock interviews (docs/mock-interview.md); started from a prep. */
@ApiTags('interview-prep')
@Controller('mock-interviews')
@UseGuards(JwtAuthGuard)
export class MockInterviewController {
  constructor(private readonly mocks: MockInterviewService) {}

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<MockInterviewView> {
    return this.mocks.get(user.userId, id);
  }

  @Post(':id/answer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Answer; the interviewer replies (5-60 s). Saved even if AI fails.' })
  answer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(answerSchema)) body: z.infer<typeof answerSchema>,
  ): Promise<MockInterviewView> {
    return this.mocks.answer(user.userId, id, body);
  }

  @Post(':id/reply')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Retry the interviewer's reply to the last answer" })
  reply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<MockInterviewView> {
    return this.mocks.reply(user.userId, id);
  }

  @Post(':id/finish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'End the interview; the report is written in the background' })
  finish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<MockInterviewView> {
    return this.mocks.finish(user.userId, id);
  }

  @Post(':id/report')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Write a failed report again' })
  report(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<MockInterviewView> {
    return this.mocks.retryReport(user.userId, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    return this.mocks.remove(user.userId, id);
  }
}
