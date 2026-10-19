import { Module } from '@nestjs/common';

import { SyncModule } from '../sync/sync.module.js';

import { InterviewPrepService } from './application/interview-prep.service.js';
import { PrepAiRouter } from './application/prep-ai.router.js';
import { InterviewPrepController } from './http/interview-prep.controller.js';

/**
 * Preparing for a real interview: a job description or technologies and a
 * date in, a plan, likely questions and graded practice out. AI on the
 * desktop first, the user's OpenAI key as the fallback.
 */
@Module({
  imports: [SyncModule],
  controllers: [InterviewPrepController],
  providers: [InterviewPrepService, PrepAiRouter],
})
export class InterviewPrepModule {}
