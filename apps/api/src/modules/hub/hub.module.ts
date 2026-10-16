import { Global, Module } from '@nestjs/common';

import { AiJobsService } from './application/ai-jobs.service.js';
import { DeviceAuthService } from './application/device-auth.service.js';
import { HubService } from './application/hub.service.js';

/**
 * The device hub: device tokens, the one WebSocket per device, and AI jobs
 * run on the user's desktop. Global because the auth guard (device tokens),
 * the AI provider (jobs) and sync (`changed` notices) all reach it.
 */
@Global()
@Module({
  providers: [DeviceAuthService, HubService, AiJobsService],
  exports: [DeviceAuthService, HubService, AiJobsService],
})
export class HubModule {}
