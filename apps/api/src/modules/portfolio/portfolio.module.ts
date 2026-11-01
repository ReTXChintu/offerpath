import { Module } from '@nestjs/common';

import { SyncModule } from '../sync/sync.module.js';

import { PortfolioService } from './application/portfolio.service.js';
import { ProfileImportService } from './application/profile-import.service.js';
import { PortfolioController } from './http/portfolio.controller.js';
import { PublicPortfolioController } from './http/public-portfolio.controller.js';

/**
 * Portfolios (docs/portfolio.md): content edited in Offerpath, fed by the
 * profile as drafts, and read by any portfolio site from the public API.
 */
@Module({
  imports: [SyncModule],
  controllers: [PortfolioController, PublicPortfolioController],
  providers: [PortfolioService, ProfileImportService],
})
export class PortfolioModule {}
