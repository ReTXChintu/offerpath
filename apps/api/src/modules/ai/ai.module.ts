import { Global, Module } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AiJobsService } from '../hub/application/ai-jobs.service.js';

import { AI_PROVIDER } from './ai.tokens.js';
import { AssistanceService } from './application/assistance.service.js';
import { AiController } from './http/ai.controller.js';
import { DesktopClaudeProvider } from './infrastructure/desktop-claude.provider.js';
import { RecordingAIProvider } from './infrastructure/recording-ai.provider.js';

@Global()
@Module({
  controllers: [AiController],
  providers: [
    {
      provide: AI_PROVIDER,
      inject: [PrismaService, AiJobsService],
      /**
       * Claude on the calling user's desktop, recorded in `ai_interactions`.
       * Recording on the outside so telemetry captures the model actually used.
       */
      useFactory: (prisma: PrismaService, jobs: AiJobsService) =>
        new RecordingAIProvider(new DesktopClaudeProvider(prisma, jobs), prisma),
    },
    AssistanceService,
  ],
  exports: [AI_PROVIDER, AssistanceService],
})
export class AiModule {}
