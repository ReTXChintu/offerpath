import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { RateLimitGuard } from '../../common/http/rate-limit.guard.js';

import { AuthService } from './application/auth.service.js';
import { AuthController } from './http/auth.controller.js';
import { JwtAuthGuard } from './infrastructure/jwt-auth.guard.js';

/**
 * Global because `JwtAuthGuard` is genuinely cross-cutting: every protected
 * controller in every domain module references it through `@UseGuards`.
 *
 * The alternative — importing AuthModule into all nine domain modules — would
 * be ceremony without benefit, and would couple each module to auth in its
 * import list while changing nothing about the dependency direction.
 *
 * Note that only the *guard* is global. Identity stays decoupled from learning
 * logic (§34): no domain module injects AuthService.
 */
@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, RateLimitGuard],
  exports: [JwtAuthGuard, JwtModule, RateLimitGuard],
})
export class AuthModule {}
