import { Controller, Get } from '@nestjs/common';

import { APP_VERSION } from '../version';

@Controller('health')
export class HealthController {
  /** Liveness: the process is up. Readiness (database, Redis) comes with phase 1. */
  @Get()
  live(): { status: 'ok'; version: string } {
    return { status: 'ok', version: APP_VERSION };
  }
}
