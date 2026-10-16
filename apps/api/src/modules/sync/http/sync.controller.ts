import { Body, Controller, Delete, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../../common/http/current-user.decorator.js';
import { JwtAuthGuard } from '../../auth/infrastructure/jwt-auth.guard.js';
import {
  HuntViewsService,
  type ApplicationItem,
  type UpcomingInterview,
} from '../application/hunt-views.service.js';
import { type JsonDoc, SyncService } from '../application/sync.service.js';

/**
 * The desktop's sync routes, unchanged from Job Hunter's backend
 * (`PUT/DELETE /data/:collection/:id`, `GET /data/:collection`), and the
 * joined hunt views the web app and phones read.
 */
@ApiTags('hunt')
@Controller()
@UseGuards(JwtAuthGuard)
export class SyncController {
  constructor(
    private readonly sync: SyncService,
    private readonly views: HuntViewsService,
  ) {}

  @Put('data/:collection/:id')
  @ApiOperation({ summary: 'Store one document of the desktop’s store' })
  async upsert(
    @CurrentUser() user: AuthenticatedUser,
    @Param('collection') collection: string,
    @Param('id') id: string,
    @Body() body: JsonDoc,
  ): Promise<Record<string, never>> {
    await this.sync.upsert(user.userId, collection, id, body ?? {});
    return {};
  }

  @Delete('data/:collection/:id')
  @ApiOperation({ summary: 'Delete one document' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('collection') collection: string,
    @Param('id') id: string,
  ): Promise<Record<string, never>> {
    await this.sync.delete(user.userId, collection, id);
    return {};
  }

  @Get('data/:collection')
  @ApiOperation({ summary: 'Every document of one collection' })
  async fetchAll(
    @CurrentUser() user: AuthenticatedUser,
    @Param('collection') collection: string,
  ): Promise<{ documents: JsonDoc[] }> {
    return { documents: await this.sync.fetchAll(user.userId, collection) };
  }

  @Get('applications')
  @ApiOperation({ summary: 'Applications with their job and analysis' })
  applications(@CurrentUser() user: AuthenticatedUser): Promise<ApplicationItem[]> {
    return this.views.applications(user.userId);
  }

  @Get('applications/:id')
  @ApiOperation({ summary: 'One application with its job and analysis' })
  application(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ApplicationItem> {
    return this.views.application(user.userId, id);
  }

  @Get('jobs')
  @ApiOperation({ summary: 'Discovered jobs, newest first' })
  async jobs(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: string,
  ): Promise<{ jobs: JsonDoc[] }> {
    return { jobs: await this.views.jobs(user.userId, status) };
  }

  @Get('hunt/interviews/upcoming')
  @ApiOperation({ summary: 'Recorded interviews still ahead, soonest first' })
  async upcoming(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ interviews: UpcomingInterview[] }> {
    return { interviews: await this.views.upcomingInterviews(user.userId) };
  }
}
