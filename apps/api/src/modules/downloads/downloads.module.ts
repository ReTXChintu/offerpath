import { Module } from '@nestjs/common';

import { DownloadsService } from './application/downloads.service.js';
import { DownloadsController } from './http/downloads.controller.js';

/** App builds and the desktop updater manifest (from Job Hunter's backend). */
@Module({
  controllers: [DownloadsController],
  providers: [DownloadsService],
})
export class DownloadsModule {}
