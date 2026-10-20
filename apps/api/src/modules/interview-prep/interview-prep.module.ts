import { Module } from '@nestjs/common';

import { SyncModule } from '../sync/sync.module.js';

import { CvService } from './application/cv.service.js';
import { InterviewPrepService } from './application/interview-prep.service.js';
import { MockInterviewService } from './application/mock-interview.service.js';
import { PrepAiRouter } from './application/prep-ai.router.js';
import { InterviewPrepController } from './http/interview-prep.controller.js';
import { MockInterviewController } from './http/mock-interview.controller.js';

/**
 * Preparing for a real interview: a job description or technologies, a CV
 * and a date in; a plan, likely questions, graded practice and live mock
 * interviews out. AI on the desktop first, the user's OpenAI key as the
 * fallback.
 */
@Module({
  imports: [SyncModule],
  controllers: [InterviewPrepController, MockInterviewController],
  providers: [InterviewPrepService, MockInterviewService, CvService, PrepAiRouter],
})
export class InterviewPrepModule {}
