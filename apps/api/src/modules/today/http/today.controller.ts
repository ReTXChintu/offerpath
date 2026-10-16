import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../../common/http/current-user.decorator.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { JwtAuthGuard } from '../../auth/infrastructure/jwt-auth.guard.js';
import {
  TodayService,
  type GoalView,
  type InterviewPrep,
  type TodayView,
} from '../application/today.service.js';

const list = z.array(z.string().trim().min(1).max(120)).max(20);

const goalSchema = z.object({
  targetRoles: list.optional(),
  targetCompanies: list.optional(),
  locations: list.optional(),
  targetDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-31')
    .nullable()
    .optional(),
});

const addGapSchema = z.object({ technologyId: z.string().min(1).max(40) });

@ApiTags('today')
@Controller()
@UseGuards(JwtAuthGuard)
export class TodayController {
  constructor(private readonly today: TodayService) {}

  @Get('today')
  @ApiOperation({ summary: 'The daily plan: learning, hunt to-dos, interviews ahead, skill gaps' })
  view(@CurrentUser() user: AuthenticatedUser): Promise<TodayView> {
    return this.today.today(user.userId);
  }

  @Post('today/start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start my day' })
  start(@CurrentUser() user: AuthenticatedUser): Promise<TodayView> {
    return this.today.start(user.userId);
  }

  @Get('goal')
  @ApiOperation({ summary: 'What the user is working toward' })
  async goal(@CurrentUser() user: AuthenticatedUser): Promise<{ goal: GoalView | null }> {
    return { goal: await this.today.goal(user.userId) };
  }

  @Put('goal')
  @ApiOperation({ summary: 'Set target roles, companies, locations and date' })
  setGoal(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(goalSchema)) body: z.infer<typeof goalSchema>,
  ): Promise<GoalView> {
    return this.today.setGoal(user.userId, body);
  }

  @Get('goal/skill-gaps')
  @ApiOperation({ summary: 'Skills best-match jobs ask for that the user is missing' })
  async gaps(@CurrentUser() user: AuthenticatedUser) {
    return { gaps: await this.today.skillGaps(user.userId) };
  }

  @Post('goal/skill-gaps/add')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Put a skill gap’s technology on the roadmap' })
  addGap(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(addGapSchema)) body: z.infer<typeof addGapSchema>,
  ): Promise<void> {
    return this.today.addGapToRoadmap(user.userId, body.technologyId);
  }

  @Get('hunt/interviews/prep')
  @ApiOperation({ summary: 'Prep tracks for recorded interviews in the next two weeks' })
  async prep(@CurrentUser() user: AuthenticatedUser): Promise<{ interviews: InterviewPrep[] }> {
    return { interviews: await this.today.interviewPrep(user.userId) };
  }
}
