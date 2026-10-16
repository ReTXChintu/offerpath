import { Module } from '@nestjs/common';

import { DevicesService } from './application/devices.service.js';
import { DevicesController } from './http/devices.controller.js';

/** Device sign-in and pairing, from Job Hunter's backend (docs/plan.md, section 6). */
@Module({
  controllers: [DevicesController],
  providers: [DevicesService],
})
export class DevicesModule {}
