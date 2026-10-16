import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { ConceptTutorService } from '../../concepts/application/concept-tutor.service.js';
import { PracticeSetService } from '../../concepts/application/practice-set.service.js';
import { GenerationService } from '../../generation/application/generation.service.js';
import { HubService } from '../../hub/application/hub.service.js';
import { RoutinesService } from '../../routines/application/routines.service.js';

import { TodayService } from './today.service.js';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Prepares the day's AI content ahead, while the desktop is on.
 *
 * AI runs only on the user's desktop. So once per learning day, as soon as
 * the desktop is online with Claude (it comes online, or is already online
 * when a new day starts), this plans today's routine and writes what its
 * concepts will need: the explainer pages and a practice set for each, and
 * the next technology's curriculum. Most of the day's learning then needs no
 * live AI at all, and keeps working if the desktop goes off later.
 *
 * Interactive AI (tutor answers, grading feedback, live mock interviews)
 * still needs the desktop at that moment.
 */
@Injectable()
export class PregenerationService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PregenerationService.name);
  private readonly running = new Set<string>();
  private unsubscribe: (() => void) | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly hub: HubService,
    private readonly today: TodayService,
    private readonly routines: RoutinesService,
    private readonly tutor: ConceptTutorService,
    private readonly practice: PracticeSetService,
    private readonly generation: GenerationService,
  ) {}

  onApplicationBootstrap(): void {
    this.unsubscribe = this.hub.onDesktopPresence((userId, online) => {
      if (online) void this.prepare(userId);
    });
    // A desktop left on overnight: catch the new day when it starts.
    this.timer = setInterval(() => {
      for (const userId of this.hub.aiReadyUsers()) void this.prepare(userId);
    }, HOUR_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    if (this.timer) clearInterval(this.timer);
  }

  /** Prepares today's content for one user, once per learning day. Never throws. */
  async prepare(userId: string): Promise<boolean> {
    if (this.running.has(userId)) return false;
    this.running.add(userId);
    try {
      const date = this.today.learningToday();
      const plan = await this.prisma.dailyPlan.upsert({
        where: { userId_date: { userId, date } },
        create: { userId, date },
        update: {},
      });
      if (plan.pregeneratedAt) return false;
      // Only accounts that have set up learning get a plan to prepare.
      const onboarded = await this.prisma.userPreferences.findUnique({
        where: { userId },
        select: { onboardedAt: true },
      });
      if (!onboarded?.onboardedAt) return false;

      const routine = await this.routines.today(userId);
      const conceptIds = [
        ...new Set(routine.items.map((i) => i.conceptId).filter((id): id is string => !!id)),
      ];
      let prepared = 0;
      for (const conceptId of conceptIds) {
        // One at a time: the desktop runs two learning jobs at once at most,
        // and the user may be using it.
        if (!this.hub.isDesktopOnline(userId)) break;
        try {
          await this.tutor.explainer(userId, conceptId);
          await this.practice.view(userId, conceptId);
          prepared += 1;
        } catch (error) {
          this.logger.warn(`pre-generating ${conceptId} for ${userId}: ${String(error)}`);
        }
      }
      await this.generation.enqueueNext(userId).catch(() => undefined);

      if (prepared === conceptIds.length) {
        await this.prisma.dailyPlan.update({
          where: { id: plan.id },
          data: { pregeneratedAt: new Date() },
        });
      }
      this.logger.log(`Prepared ${prepared}/${conceptIds.length} concepts ahead for ${userId}`);
      return prepared === conceptIds.length;
    } catch (error) {
      this.logger.warn(`pre-generation for ${userId} failed: ${String(error)}`);
      return false;
    } finally {
      this.running.delete(userId);
    }
  }
}
