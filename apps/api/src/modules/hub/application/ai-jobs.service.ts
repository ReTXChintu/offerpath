import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';

import { AIUnavailable, type CallContext, type CliExecutor, type CliJob } from '@offerpath/ai';
import type { AppConfig } from '@offerpath/config';

import { APP_CONFIG } from '../../../infrastructure/config/config.module.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { HubError, HubService } from './hub.service.js';

/** Jobs (with their prompts) are kept this long, then pruned: Neon's free tier is 0.5 GB. */
const KEEP_DAYS = 30;
/** A stored CLI envelope is capped; the parsed answer lives in the domain tables anyway. */
const MAX_OUTPUT_CHARS = 200_000;

/**
 * Every AI call, as a row in `ai_jobs`, run by the user's own desktop.
 *
 * The server never runs AI. `executorFor(userId)` gives the Claude provider a
 * way to run a job: write the row, hand the job to the desktop over the hub,
 * record what came back. When the desktop is offline the job fails at once
 * with a message the user can act on, and the calling agent falls back the
 * way it already does when AI is unavailable.
 */
@Injectable()
export class AiJobsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AiJobsService.name);
  private pruneTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly hub: HubService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    void this.prune();
    this.pruneTimer = setInterval(() => void this.prune(), 24 * 60 * 60 * 1000);
    this.pruneTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.pruneTimer) clearInterval(this.pruneTimer);
  }

  /** How long the desktop gets for one job. */
  get timeoutMs(): number {
    return this.config.env.AI_REQUEST_TIMEOUT_MS;
  }

  executorFor(userId: string): CliExecutor {
    return (job, context) => this.run(userId, job, context);
  }

  private async run(userId: string, job: CliJob, context: CallContext) {
    const row = await this.prisma.aiJob.create({
      data: {
        userId,
        agent: context.agent,
        promptVersion: context.promptVersion,
        model: job.model,
        job: job as object,
        status: 'RUNNING',
        startedAt: new Date(),
      },
      select: { id: true },
    });

    try {
      const { outcome, deviceId } = await this.hub.runAiJob(userId, row.id, job, context.signal);
      await this.finish(row.id, {
        status: 'SUCCEEDED',
        deviceId,
        output: outcome.stdout.slice(0, MAX_OUTPUT_CHARS),
      });
      return outcome;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.finish(row.id, {
        status: context.signal?.aborted ? 'CANCELLED' : 'FAILED',
        error: message.slice(0, 2_000),
      });
      throw error instanceof HubError
        ? new AIUnavailable(context.agent, error)
        : error instanceof AIUnavailable
          ? error
          : new AIUnavailable(context.agent, error);
    }
  }

  private async finish(
    id: string,
    data: {
      status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
      deviceId?: string;
      output?: string;
      error?: string;
    },
  ): Promise<void> {
    // Bookkeeping never fails the call the user is waiting for.
    await this.prisma.aiJob
      .update({ where: { id }, data: { ...data, finishedAt: new Date() } })
      .catch((error: unknown) => this.logger.warn(`ai_jobs ${id}: ${String(error)}`));
  }

  /** Deletes finished jobs older than KEEP_DAYS, and marks ones stuck RUNNING (a restart) failed. */
  async prune(now = new Date()): Promise<void> {
    try {
      const cutoff = new Date(now.getTime() - KEEP_DAYS * 24 * 60 * 60 * 1000);
      const stale = new Date(now.getTime() - 2 * this.timeoutMs);
      await this.prisma.aiJob.deleteMany({ where: { createdAt: { lt: cutoff } } });
      await this.prisma.aiJob.updateMany({
        where: { status: { in: ['QUEUED', 'RUNNING'] }, createdAt: { lt: stale } },
        data: { status: 'FAILED', error: 'Interrupted (server restarted)', finishedAt: now },
      });
    } catch (error) {
      this.logger.warn(`Pruning ai_jobs failed: ${String(error)}`);
    }
  }
}
