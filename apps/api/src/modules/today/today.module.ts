import { Module } from '@nestjs/common';

import { ConceptsModule } from '../concepts/concepts.module.js';
import { GenerationModule } from '../generation/generation.module.js';
import { RoutinesModule } from '../routines/routines.module.js';
import { SyncModule } from '../sync/sync.module.js';
import { TechnologiesModule } from '../technologies/technologies.module.js';

import { PregenerationService } from './application/pregeneration.service.js';
import { TodayService } from './application/today.service.js';
import { TodayController } from './http/today.controller.js';

/** The goal and the daily plan that ties learning and the hunt together (plan section 3). */
@Module({
  imports: [RoutinesModule, ConceptsModule, GenerationModule, SyncModule, TechnologiesModule],
  controllers: [TodayController],
  providers: [TodayService, PregenerationService],
  exports: [TodayService],
})
export class TodayModule {}
