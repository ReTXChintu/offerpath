import { Global, Module } from '@nestjs/common';

import { AiFallbackService } from './application/ai-fallback.service.js';
import { AISettingsService } from './application/ai-settings.service.js';
import { AISettingsController } from './http/ai-settings.controller.js';

/** Global because the tutor and curriculum generation read the user's Claude models. */
@Global()
@Module({
  controllers: [AISettingsController],
  providers: [AISettingsService, AiFallbackService],
  exports: [AISettingsService, AiFallbackService],
})
export class SettingsModule {}
