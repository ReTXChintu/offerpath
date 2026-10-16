import { Module } from '@nestjs/common';

import { HuntViewsService } from './application/hunt-views.service.js';
import { PushService } from './application/push.service.js';
import { SyncService } from './application/sync.service.js';
import { SyncController } from './http/sync.controller.js';

/** The hunt data synced from desktops, and the views over it (from Job Hunter's backend). */
@Module({
  controllers: [SyncController],
  providers: [SyncService, HuntViewsService, PushService],
  exports: [SyncService, HuntViewsService, PushService],
})
export class SyncModule {}
