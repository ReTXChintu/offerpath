import { Global, Module } from '@nestjs/common';

import { AISettingsService } from './application/ai-settings.service.js';
import { AISettingsController } from './http/ai-settings.controller.js';

/** Global because the tutor and curriculum generation read the user's Claude models. */
@Global()
@Module({
  controllers: [AISettingsController],
  providers: [AISettingsService],
  exports: [AISettingsService],
})
export class SettingsModule {}
