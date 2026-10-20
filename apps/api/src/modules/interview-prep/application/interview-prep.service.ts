import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';

import {
  describeAIFailure,
  interviewPrepAgent,
  prepAnswerGraderAgent,
  type InterviewPrepOutput,
  type PrepAnswerGradeOutput,
} from '@offerpath/ai';
import type { InterviewPrep, InterviewPrepQuestion, Prisma } from '@offerpath/database';

import { Problems } from '../../../common/http/problem-details.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { HubService } from '../../hub/application/hub.service.js';
import { PushService } from '../../sync/application/push.service.js';

import { MockInterviewService, type MockInterviewSummary } from './mock-interview.service.js';
import { NoPrepAiError, PrepAiRouter, type PrepAiSource } from './prep-ai.router.js';

export interface PrepInput {
  company?: string | null;
  role?: string | null;
  jobDescription?: string | null;
  technologies?: string[];
  /** Data structures and algorithms questions and coding problems. */
  includeDsa?: boolean;
  /** The CV the user interviews with; null removes it. */
  resume?: PrepResumeInput | null;
  /** ISO date-time of the interview. */
  scheduledAt: string;
}

export type ResumeSource = 'upload' | 'profile' | 'pasted';

export interface PrepResumeInput {
  text: string;
  source: ResumeSource;
  fileName?: string | null;
}

export interface PrepQuestionView {
  id: string;
  order: number;
  kind: string;
  topic: string;
  question: string;
  difficulty: number;
  /** What a strong answer covers; only once the question has been answered. */
  keyPoints: string[] | null;
  answer: string | null;
  score: number | null;
  feedback: { covered: string[]; missed: string[]; feedback: string } | null;
  answeredAt: string | null;
}

export interface PrepView {
  id: string;
  company: string | null;
  role: string | null;
  jobDescription: string | null;
  technologies: string[];
  includeDsa: boolean;
  resume: { source: ResumeSource; fileName: string | null; chars: number; text: string } | null;
  scheduledAt: string;
  status: 'GENERATING' | 'READY' | 'FAILED';
  error: string | null;
  generatedBy: PrepAiSource | null;
  plan: Pick<InterviewPrepOutput, 'summary' | 'focusAreas' | 'schedule'> | null;
  questions: PrepQuestionView[];
  /** Answered questions and their average score, 0-10. */
  progress: { answered: number; total: number; averageScore: number | null };
  /** Newest first. */
  mockInterviews: MockInterviewSummary[];
  createdAt: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Interview prep: the user adds a job description and/or technologies and
 * when the interview is; AI writes a plan and likely questions, then grades
 * practice answers.
 *
 * AI runs on the user's desktop (Claude) when it is online, otherwise on the
 * user's own OpenAI fallback key (`PrepAiRouter`). Generation runs in the
 * background; when it's done the phone hears about it at once (a hub frame
 * if the app is open, a push otherwise). A prep that could not start because
 * no AI was reachable starts by itself when the desktop comes online.
 */
@Injectable()
export class InterviewPrepService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(InterviewPrepService.name);
  private readonly running = new Set<string>();
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: PrepAiRouter,
    private readonly hub: HubService,
    private readonly push: PushService,
    private readonly mocks: MockInterviewService,
  ) {}

  onApplicationBootstrap(): void {
    this.unsubscribe = this.hub.onDesktopPresence((userId, online) => {
      if (online) void this.resumeWaiting(userId);
    });
    // Anything left GENERATING by a restart is picked up again.
    void this.prisma.interviewPrep
      .findMany({ where: { status: 'GENERATING' }, select: { id: true, userId: true } })
      .then((rows) => rows.forEach((r) => void this.generate(r.userId, r.id)))
      .catch(() => undefined);
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }

  // -- Preps ----------------------------------------------------------------

  async create(userId: string, input: PrepInput): Promise<PrepView> {
    const technologies = cleanTechnologies(input.technologies);
    const jobDescription = input.jobDescription?.trim() || null;
    assertSomethingToPrepare(jobDescription, technologies);
    const prep = await this.prisma.interviewPrep.create({
      data: {
        userId,
        company: input.company?.trim() || null,
        role: input.role?.trim() || null,
        jobDescription,
        technologies,
        includeDsa: input.includeDsa ?? false,
        ...resumeData(input.resume ?? null),
        scheduledAt: new Date(input.scheduledAt),
      },
    });
    void this.generate(userId, prep.id);
    return this.get(userId, prep.id);
  }

  async list(userId: string): Promise<PrepView[]> {
    const preps = await this.prisma.interviewPrep.findMany({
      where: { userId },
      orderBy: { scheduledAt: 'asc' },
      include: { questions: { orderBy: { order: 'asc' } } },
    });
    const mocks = await this.mocks.summaries(preps.map((p) => p.id));
    return preps.map((p) => toView(p, p.questions, mocks.get(p.id) ?? []));
  }

  async get(userId: string, id: string): Promise<PrepView> {
    const prep = await this.prisma.interviewPrep.findFirst({
      where: { id, userId },
      include: { questions: { orderBy: { order: 'asc' } } },
    });
    if (!prep) throw Problems.notFound('Interview prep');
    const mocks = await this.mocks.summaries([prep.id]);
    return toView(prep, prep.questions, mocks.get(prep.id) ?? []);
  }

  /**
   * Company, role and date change in place. A new job description,
   * technologies, DSA choice or CV rewrites the plan and the questions.
   */
  async update(userId: string, id: string, input: Partial<PrepInput>): Promise<PrepView> {
    const prep = await this.prisma.interviewPrep.findFirst({ where: { id, userId } });
    if (!prep) throw Problems.notFound('Interview prep');

    let jobDescription = prep.jobDescription;
    let technologies = prep.technologies;
    const content: Prisma.InterviewPrepUpdateInput = {};
    if (input.jobDescription !== undefined) {
      const next = input.jobDescription?.trim() || null;
      if (next !== prep.jobDescription) content.jobDescription = jobDescription = next;
    }
    if (input.technologies !== undefined) {
      const next = cleanTechnologies(input.technologies);
      if (next.join('\n') !== prep.technologies.join('\n')) {
        content.technologies = technologies = next;
      }
    }
    if (input.includeDsa !== undefined && input.includeDsa !== prep.includeDsa) {
      content.includeDsa = input.includeDsa;
    }
    if (input.resume !== undefined) {
      const resume = resumeData(input.resume);
      if (
        resume.resumeText !== prep.resumeText ||
        resume.resumeSource !== prep.resumeSource ||
        resume.resumeFileName !== prep.resumeFileName
      ) {
        Object.assign(content, resume);
      }
    }
    assertSomethingToPrepare(jobDescription, technologies);
    const rewrite = Object.keys(content).length > 0;

    await this.prisma.interviewPrep.update({
      where: { id },
      data: {
        ...content,
        ...(input.scheduledAt ? { scheduledAt: new Date(input.scheduledAt) } : {}),
        ...(input.company !== undefined ? { company: input.company?.trim() || null } : {}),
        ...(input.role !== undefined ? { role: input.role?.trim() || null } : {}),
        ...(rewrite ? { status: 'GENERATING' as const, error: null } : {}),
      },
    });
    if (rewrite) void this.generate(userId, id);
    return this.get(userId, id);
  }

  async remove(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.interviewPrep.deleteMany({ where: { id, userId } });
    if (count === 0) throw Problems.notFound('Interview prep');
  }

  /** Writes the plan and questions again (a failed or stale prep). */
  async regenerate(userId: string, id: string): Promise<PrepView> {
    await this.get(userId, id);
    await this.prisma.interviewPrep.update({
      where: { id },
      data: { status: 'GENERATING', error: null },
    });
    void this.generate(userId, id);
    return this.get(userId, id);
  }

  // -- Generation -------------------------------------------------------------

  /** Runs in the background; never throws. */
  async generate(userId: string, prepId: string): Promise<void> {
    if (this.running.has(prepId)) return;
    this.running.add(prepId);
    try {
      const prep = await this.prisma.interviewPrep.findFirst({ where: { id: prepId, userId } });
      if (!prep) return;
      const daysUntil = Math.max(0, Math.ceil((prep.scheduledAt.getTime() - Date.now()) / DAY_MS));
      const { result, source } = await this.ai.run(userId, (provider) =>
        interviewPrepAgent.run(
          provider,
          {
            company: prep.company,
            role: prep.role,
            jobDescription: prep.jobDescription,
            technologies: prep.technologies,
            resume: prep.resumeText,
            includeDsa: prep.includeDsa,
            daysUntil,
          },
          { userId },
        ),
      );

      await this.prisma.$transaction([
        this.prisma.interviewPrepQuestion.deleteMany({ where: { prepId } }),
        this.prisma.interviewPrepQuestion.createMany({
          data: result.questions.map((q, order) => ({
            prepId,
            order,
            kind: q.kind,
            topic: q.topic,
            question: q.question,
            keyPoints: q.keyPoints,
            difficulty: q.difficulty,
          })),
        }),
        this.prisma.interviewPrep.update({
          where: { id: prepId },
          data: {
            status: 'READY',
            error: null,
            generatedBy: source,
            plan: {
              summary: result.summary,
              focusAreas: result.focusAreas,
              schedule: result.schedule,
            } as Prisma.InputJsonObject,
          },
        }),
      ]);
      this.logger.log(`Prep ${prepId} ready (${result.questions.length} questions via ${source})`);
      this.announce(userId, prepId, prep.company, prep.role, result.questions.length);
    } catch (error) {
      const message =
        error instanceof NoPrepAiError ? error.message : describeAIFailure(error).slice(0, 500);
      this.logger.warn(`Prep ${prepId} failed: ${message}`);
      await this.prisma.interviewPrep
        .update({ where: { id: prepId }, data: { status: 'FAILED', error: message } })
        .catch(() => undefined);
      this.hub.pushToMobiles(userId, 'changed', { collections: ['interview_preps'] });
    } finally {
      this.running.delete(prepId);
    }
  }

  /** The desktop just came online: start what was waiting for it. */
  private async resumeWaiting(userId: string): Promise<void> {
    const waiting = await this.prisma.interviewPrep.findMany({
      where: {
        userId,
        status: 'FAILED',
        questions: { none: {} },
        scheduledAt: { gt: new Date() },
      },
      select: { id: true },
    });
    for (const { id } of waiting) await this.regenerate(userId, id).catch(() => undefined);
  }

  /** The phone hears at once: a hub frame if the app is open, a push otherwise. */
  private announce(
    userId: string,
    prepId: string,
    company: string | null,
    role: string | null,
    count: number,
  ): void {
    const what =
      [role, company ? `at ${company}` : null].filter(Boolean).join(' ') || 'your interview';
    const payload = {
      id: `prep-${prepId}`,
      level: 'info',
      kind: 'INTERVIEW_PREP_READY',
      title: 'Interview prep is ready',
      body: `${count} questions for ${what}. Practise them on your phone or laptop.`,
      linkPage: 'interview-prep',
      linkId: prepId,
      createdAt: new Date().toISOString(),
    };
    this.hub.pushToMobiles(userId, 'notification', payload);
    this.hub.pushToMobiles(userId, 'changed', { collections: ['interview_preps'] });
    void this.push.sendToUser(userId, {
      title: payload.title,
      body: payload.body,
      data: { ...payload },
    });
  }

  // -- Practice ---------------------------------------------------------------

  async answer(
    userId: string,
    prepId: string,
    questionId: string,
    answer: string,
  ): Promise<PrepQuestionView> {
    const prep = await this.prisma.interviewPrep.findFirst({ where: { id: prepId, userId } });
    if (!prep) throw Problems.notFound('Interview prep');
    const question = await this.prisma.interviewPrepQuestion.findFirst({
      where: { id: questionId, prepId },
    });
    if (!question) throw Problems.notFound('Question');

    let grade: PrepAnswerGradeOutput;
    try {
      ({ result: grade } = await this.ai.run(userId, (provider) =>
        prepAnswerGraderAgent.run(
          provider,
          {
            question: question.question,
            keyPoints: question.keyPoints,
            answer,
            role: prep.role,
          },
          { userId },
        ),
      ));
    } catch (error) {
      if (error instanceof NoPrepAiError) throw Problems.aiUnavailable(error.message);
      throw Problems.aiUnavailable(describeAIFailure(error));
    }

    const saved = await this.prisma.interviewPrepQuestion.update({
      where: { id: questionId },
      data: {
        answer,
        score: grade.score,
        feedback: {
          covered: grade.covered,
          missed: grade.missed,
          feedback: grade.feedback,
        } as Prisma.InputJsonObject,
        answeredAt: new Date(),
      },
    });
    return toQuestionView(saved);
  }
}

function toQuestionView(q: InterviewPrepQuestion): PrepQuestionView {
  const answered = q.answeredAt !== null;
  return {
    id: q.id,
    order: q.order,
    kind: q.kind,
    topic: q.topic,
    question: q.question,
    difficulty: q.difficulty,
    // Shown after an attempt: reading them first turns practice into recital.
    keyPoints: answered ? q.keyPoints : null,
    answer: q.answer,
    score: q.score,
    feedback: (q.feedback as PrepQuestionView['feedback']) ?? null,
    answeredAt: q.answeredAt?.toISOString() ?? null,
  };
}

function cleanTechnologies(list: string[] | undefined): string[] {
  return [...new Set((list ?? []).map((t) => t.trim()).filter(Boolean))].slice(0, 20);
}

function assertSomethingToPrepare(jobDescription: string | null, technologies: string[]): void {
  if (!jobDescription && technologies.length === 0) {
    throw Problems.validation({
      jobDescription: ['Add the job description, or the technologies to prepare.'],
    });
  }
}

function resumeData(resume: PrepResumeInput | null): {
  resumeText: string | null;
  resumeSource: string | null;
  resumeFileName: string | null;
} {
  const text = resume?.text.trim();
  if (!resume || !text) return { resumeText: null, resumeSource: null, resumeFileName: null };
  return {
    resumeText: text.slice(0, 30_000),
    resumeSource: resume.source,
    resumeFileName: resume.source === 'upload' ? resume.fileName?.trim() || null : null,
  };
}

function toView(
  prep: InterviewPrep,
  questions: InterviewPrepQuestion[],
  mockInterviews: MockInterviewSummary[],
): PrepView {
  const answered = questions.filter((q) => q.score !== null);
  return {
    id: prep.id,
    company: prep.company,
    role: prep.role,
    jobDescription: prep.jobDescription,
    technologies: prep.technologies,
    includeDsa: prep.includeDsa,
    resume: prep.resumeText
      ? {
          source: (prep.resumeSource as ResumeSource | null) ?? 'pasted',
          fileName: prep.resumeFileName,
          chars: prep.resumeText.length,
          text: prep.resumeText,
        }
      : null,
    scheduledAt: prep.scheduledAt.toISOString(),
    status: prep.status,
    error: prep.error,
    generatedBy: (prep.generatedBy as PrepAiSource | null) ?? null,
    plan: (prep.plan as PrepView['plan']) ?? null,
    questions: questions.map(toQuestionView),
    progress: {
      answered: answered.length,
      total: questions.length,
      averageScore:
        answered.length > 0
          ? Math.round((answered.reduce((s, q) => s + (q.score ?? 0), 0) / answered.length) * 10) /
            10
          : null,
    },
    mockInterviews,
    createdAt: prep.createdAt.toISOString(),
  };
}
