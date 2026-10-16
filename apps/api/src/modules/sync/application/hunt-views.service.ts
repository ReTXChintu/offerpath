import { Injectable } from '@nestjs/common';

import { Problems } from '../../../common/http/problem-details.js';

import { type JsonDoc, SyncService } from './sync.service.js';

export interface ApplicationItem {
  application: JsonDoc;
  job: JsonDoc;
  analysis: JsonDoc | null;
}

/**
 * Ready-to-render reads of the hunt for the web app and phones, which work
 * whether or not the desktop is online. Joined server-side from the synced
 * documents. Resume and cover-letter file content stays on the desktop; only
 * the metadata on the records is here.
 */
@Injectable()
export class HuntViewsService {
  constructor(private readonly sync: SyncService) {}

  async applications(userId: string): Promise<ApplicationItem[]> {
    const [applications, jobs, analyses] = await Promise.all([
      this.sync.fetchAll(userId, 'applications'),
      this.sync.fetchAll(userId, 'jobs'),
      this.sync.fetchAll(userId, 'job_analyses'),
    ]);
    const jobsById = new Map(jobs.map((j) => [j.id as string, j]));
    const analysisByJob = new Map(analyses.map((a) => [a.jobId as string, a]));

    return applications.flatMap((application) => {
      const jobId = application.jobId as string | undefined;
      const job = jobId ? jobsById.get(jobId) : undefined;
      return job ? [{ application, job, analysis: analysisByJob.get(jobId!) ?? null }] : [];
    });
  }

  async application(userId: string, id: string): Promise<ApplicationItem> {
    const application = await this.sync.fetchOne(userId, 'applications', id);
    if (!application) throw Problems.notFound('Application');
    const jobId = application.jobId as string | undefined;
    const job = jobId ? await this.sync.fetchOne(userId, 'jobs', jobId) : null;
    if (!job) throw Problems.notFound('Job for this application');
    const [analysis] = await this.sync.fetchByField(userId, 'job_analyses', 'jobId', jobId!);
    return { application, job, analysis: analysis ?? null };
  }

  /** Jobs, newest first, optionally only one status. */
  async jobs(userId: string, status?: string): Promise<JsonDoc[]> {
    const jobs = await this.sync.fetchAll(userId, 'jobs');
    return jobs
      .filter((job) => !status || job.status === status)
      .sort((a, b) => String(b.discoveredAt ?? '').localeCompare(String(a.discoveredAt ?? '')));
  }

  /**
   * Interviews coming up, soonest first: each recorded interview (an
   * application's `interviews[]`) with a `scheduledAt` still ahead.
   */
  async upcomingInterviews(userId: string, now = new Date()): Promise<UpcomingInterview[]> {
    const items = await this.applications(userId);
    return items
      .flatMap(({ application, job }) =>
        (Array.isArray(application.interviews) ? (application.interviews as JsonDoc[]) : [])
          .filter(
            (interview) =>
              typeof interview.scheduledAt === 'string' &&
              Date.parse(interview.scheduledAt) >= now.getTime(),
          )
          .map((interview) => ({
            interview,
            applicationId: application.id as string,
            company: (job.company as string | undefined) ?? '',
            title: (job.title as string | undefined) ?? '',
          })),
      )
      .sort((a, b) =>
        String(a.interview.scheduledAt).localeCompare(String(b.interview.scheduledAt)),
      );
  }
}

export interface UpcomingInterview {
  interview: JsonDoc;
  applicationId: string;
  company: string;
  title: string;
}
