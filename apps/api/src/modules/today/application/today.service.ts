import { Inject, Injectable } from '@nestjs/common';

import type { AppConfig } from '@offerpath/config';
import { type Prisma } from '@offerpath/database';
import { learningDate } from '@offerpath/shared';

import { Problems } from '../../../common/http/problem-details.js';
import { APP_CONFIG } from '../../../infrastructure/config/config.module.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { HubService } from '../../hub/application/hub.service.js';
import { RoutinesService, type RoutineView } from '../../routines/application/routines.service.js';
import {
  HuntViewsService,
  type UpcomingInterview,
} from '../../sync/application/hunt-views.service.js';
import { type JsonDoc, SyncService } from '../../sync/application/sync.service.js';
import { TechnologiesService } from '../../technologies/application/technologies.service.js';
import { type SkillGap, skillGaps } from '../domain/skill-gaps.js';

export interface GoalView {
  targetRoles: string[];
  targetCompanies: string[];
  locations: string[];
  targetDate: string | null;
  /** Whole days left until the target date, when there is one. */
  daysLeft: number | null;
}

export interface GoalInput {
  targetRoles?: string[];
  targetCompanies?: string[];
  locations?: string[];
  targetDate?: string | null;
}

/** One application that needs the user, for the plan's hunt section. */
export interface HuntTodo {
  applicationId: string;
  company: string;
  title: string;
  /** APPROVE: ready to review and approve. ANSWER: questions to answer. ACT: manual step. */
  action: 'APPROVE' | 'ANSWER' | 'ACT';
  questions: number;
}

export interface InterviewPrep extends UpcomingInterview {
  daysLeft: number;
  /** Catalogue technologies the job asks for, to practise before the day. */
  technologies: { id: string; name: string; onRoadmap: boolean }[];
}

export interface TodayView {
  date: string;
  startedAt: string | null;
  streak: number;
  goal: GoalView | null;
  learning: RoutineView;
  hunt: { todos: HuntTodo[]; approvals: number; questions: number };
  interviews: InterviewPrep[];
  skillGaps: (SkillGap & { onRoadmap: boolean })[];
  desktopOnline: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Interviews this close get a prep track on the plan. */
const PREP_WINDOW_DAYS = 14;

/**
 * The daily plan: one goal, one day.
 *
 * Assembled live each time, from parts that already know their own rules:
 * the learning routine (rule-based, from the roadmap), the hunt's to-dos
 * (the desktop's synced applications), interviews coming up with a prep
 * track, and the skills best-match jobs keep asking for. The `daily_plans`
 * row only records the day: when it was started and prepared ahead.
 */
@Injectable()
export class TodayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly routines: RoutinesService,
    private readonly sync: SyncService,
    private readonly hunt: HuntViewsService,
    private readonly technologies: TechnologiesService,
    private readonly hub: HubService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  learningToday(now = new Date()): Date {
    return learningDate(now, this.config.env.APP_TIMEZONE);
  }

  // -- Goal -----------------------------------------------------------------

  async goal(userId: string): Promise<GoalView | null> {
    const goal = await this.prisma.goal.findUnique({ where: { userId } });
    if (!goal) return null;
    const today = this.learningToday();
    return {
      targetRoles: goal.targetRoles,
      targetCompanies: goal.targetCompanies,
      locations: goal.locations,
      targetDate: goal.targetDate?.toISOString().slice(0, 10) ?? null,
      daysLeft: goal.targetDate
        ? Math.max(0, Math.round((goal.targetDate.getTime() - today.getTime()) / DAY_MS))
        : null,
    };
  }

  async setGoal(userId: string, input: GoalInput): Promise<GoalView> {
    const clean = (list?: string[]) =>
      list === undefined
        ? undefined
        : [...new Set(list.map((s) => s.trim()).filter(Boolean))].slice(0, 20);
    const data = {
      ...(input.targetRoles !== undefined ? { targetRoles: clean(input.targetRoles) } : {}),
      ...(input.targetCompanies !== undefined
        ? { targetCompanies: clean(input.targetCompanies) }
        : {}),
      ...(input.locations !== undefined ? { locations: clean(input.locations) } : {}),
      ...(input.targetDate !== undefined
        ? { targetDate: input.targetDate ? new Date(`${input.targetDate}T00:00:00.000Z`) : null }
        : {}),
    };
    await this.prisma.goal.upsert({ where: { userId }, create: { userId, ...data }, update: data });
    // The interview date the learning side plans toward follows the goal.
    if (input.targetDate !== undefined) {
      await this.prisma.userPreferences.updateMany({
        where: { userId },
        data: { interviewDate: data.targetDate ?? null },
      });
    }
    return (await this.goal(userId))!;
  }

  // -- The day ----------------------------------------------------------------

  async today(userId: string): Promise<TodayView> {
    const date = this.learningToday();
    const [goal, learning, todos, interviews, gaps, plan, streak] = await Promise.all([
      this.goal(userId),
      this.routines.today(userId),
      this.huntTodos(userId),
      this.interviewPrep(userId),
      this.skillGaps(userId, 5),
      this.prisma.dailyPlan.upsert({
        where: { userId_date: { userId, date } },
        create: { userId, date },
        update: {},
      }),
      this.streak(userId, date),
    ]);

    const summary = {
      learningMinutes: learning.totalMinutes,
      learningDone: learning.completedMinutes,
      approvals: todos.filter((t) => t.action === 'APPROVE').length,
      questions: todos.filter((t) => t.action === 'ANSWER').length,
      interviews: interviews.length,
    };
    await this.prisma.dailyPlan.update({
      where: { id: plan.id },
      data: { summary: summary as Prisma.InputJsonObject },
    });

    return {
      date: date.toISOString().slice(0, 10),
      startedAt: plan.startedAt?.toISOString() ?? null,
      streak,
      goal,
      learning,
      hunt: { todos, approvals: summary.approvals, questions: summary.questions },
      interviews,
      skillGaps: gaps,
      desktopOnline: this.hub.isDesktopOnline(userId),
    };
  }

  /** "Start my day". */
  async start(userId: string): Promise<TodayView> {
    const date = this.learningToday();
    await this.prisma.dailyPlan.upsert({
      where: { userId_date: { userId, date } },
      create: { userId, date, startedAt: new Date() },
      update: { startedAt: new Date() },
    });
    return this.today(userId);
  }

  /**
   * Consecutive learning days, ending today or yesterday, on which the user
   * started their day or finished something in their routine.
   */
  async streak(userId: string, today: Date): Promise<number> {
    const since = new Date(today.getTime() - 400 * DAY_MS);
    const [plans, routines] = await Promise.all([
      this.prisma.dailyPlan.findMany({
        where: { userId, date: { gte: since }, startedAt: { not: null } },
        select: { date: true },
      }),
      this.prisma.routine.findMany({
        where: { userId, date: { gte: since }, completedMinutes: { gt: 0 } },
        select: { date: true },
      }),
    ]);
    const active = new Set([...plans, ...routines].map((r) => r.date.getTime()));
    let day = active.has(today.getTime()) ? today.getTime() : today.getTime() - DAY_MS;
    let count = 0;
    while (active.has(day)) {
      count += 1;
      day -= DAY_MS;
    }
    return count;
  }

  // -- Hunt → plan ------------------------------------------------------------

  async huntTodos(userId: string): Promise<HuntTodo[]> {
    const items = await this.hunt.applications(userId);
    const todos: HuntTodo[] = [];
    for (const { application, job } of items) {
      const status = application.status as string | undefined;
      const questions = Array.isArray(application.pendingQuestions)
        ? (application.pendingQuestions as JsonDoc[]).length
        : 0;
      const action: HuntTodo['action'] | null =
        status === 'READY_FOR_REVIEW'
          ? 'APPROVE'
          : status === 'WAITING_FOR_USER' || questions > 0
            ? 'ANSWER'
            : status === 'MANUAL_ACTION_REQUIRED'
              ? 'ACT'
              : null;
      if (!action) continue;
      todos.push({
        applicationId: application.id as string,
        company: (job.company as string | undefined) ?? '',
        title: (job.title as string | undefined) ?? '',
        action,
        questions,
      });
    }
    const order = { ANSWER: 0, APPROVE: 1, ACT: 2 } as const;
    return todos.sort((a, b) => order[a.action] - order[b.action]);
  }

  // -- Interview call → prep -------------------------------------------------

  async interviewPrep(userId: string): Promise<InterviewPrep[]> {
    const now = new Date();
    const upcoming = (await this.hunt.upcomingInterviews(userId, now)).filter(
      (i) =>
        Date.parse(String(i.interview.scheduledAt)) - now.getTime() <= PREP_WINDOW_DAYS * DAY_MS,
    );
    if (upcoming.length === 0) return [];

    const [catalogue, mine] = await Promise.all([
      this.prisma.technology.findMany({ select: { id: true, slug: true, name: true } }),
      this.prisma.userTechnology.findMany({
        where: { userId, archivedAt: null },
        select: { technologyId: true },
      }),
    ]);
    const onRoadmap = new Set(mine.map((m) => m.technologyId));

    return Promise.all(
      upcoming.map(async (item) => {
        const job = await this.sync.fetchOne(userId, 'jobs', await this.jobIdOf(userId, item));
        const asked = [
          ...(Array.isArray(job?.skills) ? (job!.skills as unknown[]) : []),
          ...(Array.isArray(job?.requirements) ? (job!.requirements as unknown[]) : []),
        ]
          .filter((s): s is string => typeof s === 'string')
          .join(' ')
          .toLowerCase();
        const technologies = catalogue
          .filter((t) => asked.includes(t.name.toLowerCase()) || asked.includes(t.slug))
          .map((t) => ({ id: t.id, name: t.name, onRoadmap: onRoadmap.has(t.id) }))
          .slice(0, 6);
        return {
          ...item,
          daysLeft: Math.max(
            0,
            Math.ceil((Date.parse(String(item.interview.scheduledAt)) - now.getTime()) / DAY_MS),
          ),
          technologies,
        };
      }),
    );
  }

  private async jobIdOf(userId: string, item: UpcomingInterview): Promise<string> {
    const application = await this.sync.fetchOne(userId, 'applications', item.applicationId);
    return (application?.jobId as string | undefined) ?? '';
  }

  // -- Hunt → learn ---------------------------------------------------------

  async skillGaps(userId: string, limit = 10): Promise<(SkillGap & { onRoadmap: boolean })[]> {
    const [analyses, catalogue, mine] = await Promise.all([
      this.sync.fetchAll(userId, 'job_analyses'),
      this.prisma.technology.findMany({ select: { id: true, slug: true, name: true } }),
      this.prisma.userTechnology.findMany({
        where: { userId, archivedAt: null },
        select: { technologyId: true },
      }),
    ]);
    const onRoadmap = new Set(mine.map((m) => m.technologyId));
    return skillGaps(analyses, catalogue, limit).map((gap) => ({
      ...gap,
      onRoadmap: gap.technology ? onRoadmap.has(gap.technology.id) : false,
    }));
  }

  /** Puts a gap's technology on the roadmap, at high priority. */
  async addGapToRoadmap(userId: string, technologyId: string): Promise<void> {
    const technology = await this.prisma.technology.findUnique({ where: { id: technologyId } });
    if (!technology) throw Problems.notFound('Technology');
    await this.technologies.add(userId, {
      technologyId,
      priority: 'HIGH',
      targetProficiency: 'WORKING',
      interviewImportance: 4,
      frequency: 'FREQUENT',
      existingKnowledge: null,
    });
  }
}
