import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';

import {
  describeAIFailure,
  mockInterviewReportAgent,
  mockInterviewerAgent,
  type CodingProblemOutput,
  type MockInterviewContext,
  type MockReportOutput,
  type MockTranscriptTurn,
} from '@offerpath/ai';
import type { InterviewPrep, MockInterview, MockInterviewTurn, Prisma } from '@offerpath/database';

import { Problems } from '../../../common/http/problem-details.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { HubService } from '../../hub/application/hub.service.js';
import { PushService } from '../../sync/application/push.service.js';
import { STAGES, pace, settle, type Stage } from '../domain/mock-pacing.js';

import { NoPrepAiError, PrepAiRouter, type PrepAiSource } from './prep-ai.router.js';

export type MockStatus = MockInterview['status'];

export interface MockTurnView {
  id: string;
  order: number;
  speaker: 'INTERVIEWER' | 'CANDIDATE';
  stage: Stage;
  kind: string;
  text: string;
  code: string | null;
  codeLanguage: string | null;
  problem: CodingProblemOutput | null;
  language: {
    ok: boolean;
    corrections: { original: string; corrected: string; note: string }[];
  } | null;
  /** Only once the interview is over. */
  assessment: { verdict: string; note: string } | null;
  createdAt: string;
}

export interface MockInterviewView {
  id: string;
  prepId: string;
  status: MockStatus;
  stage: Stage;
  stages: Stage[];
  awaitingReply: boolean;
  replying: boolean;
  aiSource: PrepAiSource | null;
  turns: MockTurnView[];
  answered: number;
  report: MockReportOutput | null;
  overallScore: number | null;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
}

export interface MockInterviewSummary {
  id: string;
  status: MockStatus;
  stage: Stage;
  overallScore: number | null;
  verdict: MockReportOutput['verdict'] | null;
  answered: number;
  startedAt: string;
  endedAt: string | null;
}

export interface MockAnswerInput {
  text?: string;
  code?: string | null;
  codeLanguage?: string | null;
}

type WithTurns = MockInterview & { turns: MockInterviewTurn[] };

const FORCED_GOODBYE =
  "We're at time, so let's stop here. Thank you, I enjoyed talking with you. " +
  'Your feedback will be ready in a moment: every question, what you said, and what you could do better.';

const VERDICT_LABEL: Record<MockReportOutput['verdict'], string> = {
  STRONG_HIRE: 'strong hire',
  HIRE: 'hire',
  LEAN_HIRE: 'lean hire',
  LEAN_NO_HIRE: 'lean no hire',
  NO_HIRE: 'no hire',
};

/**
 * Mock interviews for a prep (docs/mock-interview.md): an AI interviewer
 * that reads the CV, the job description and the technologies and talks to
 * the user turn by turn, cross-questions wrong answers and corrects their
 * English, then writes a report.
 *
 * Every reply runs while the user waits (AI on the desktop, else the OpenAI
 * fallback, `PrepAiRouter`); an answer is saved before the AI runs, so a
 * failed reply is retried rather than retyped. The report is written in the
 * background and announced to the phone; one waiting for an offline desktop
 * starts when it comes back.
 */
@Injectable()
export class MockInterviewService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MockInterviewService.name);
  private readonly replying = new Set<string>();
  private readonly reporting = new Set<string>();
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: PrepAiRouter,
    private readonly hub: HubService,
    private readonly push: PushService,
  ) {}

  onApplicationBootstrap(): void {
    this.unsubscribe = this.hub.onDesktopPresence((userId, online) => {
      if (online) void this.resumeReports(userId);
    });
    // Reports a restart interrupted.
    void this.prisma.mockInterview
      .findMany({ where: { status: 'REPORTING' }, select: { id: true, userId: true } })
      .then((rows) => rows.forEach((r) => void this.writeReport(r.userId, r.id)))
      .catch(() => undefined);
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }

  // -- Starting and reading ---------------------------------------------------

  /** The prep's interview in progress, or a new one; `restart` abandons the old. */
  async start(userId: string, prepId: string, restart = false): Promise<MockInterviewView> {
    const prep = await this.prisma.interviewPrep.findFirst({ where: { id: prepId, userId } });
    if (!prep) throw Problems.notFound('Interview prep');

    const current = await this.prisma.mockInterview.findFirst({
      where: { prepId, userId, status: 'IN_PROGRESS' },
      orderBy: { startedAt: 'desc' },
    });
    if (current && !restart) return this.get(userId, current.id);
    if (current) {
      if (this.replying.has(current.id)) {
        throw Problems.conflict('The interviewer is still replying. Try again in a moment.');
      }
      await this.prisma.mockInterview.update({
        where: { id: current.id },
        data: { status: 'ABANDONED', endedAt: new Date() },
      });
    }

    const interview = await this.prisma.mockInterview.create({
      data: {
        userId,
        prepId,
        turns: {
          create: {
            order: 0,
            speaker: 'INTERVIEWER',
            stage: 'INTRO',
            kind: 'OPENING',
            text: opening(prep),
          },
        },
      },
    });
    this.changed(userId);
    return this.get(userId, interview.id);
  }

  async get(userId: string, id: string): Promise<MockInterviewView> {
    return this.toView(await this.load(userId, id));
  }

  /** Newest first, for the prep page. */
  async summaries(prepIds: string[]): Promise<Map<string, MockInterviewSummary[]>> {
    const rows = await this.prisma.mockInterview.findMany({
      where: { prepId: { in: prepIds } },
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        prepId: true,
        status: true,
        stage: true,
        overallScore: true,
        report: true,
        startedAt: true,
        endedAt: true,
        _count: { select: { turns: { where: { speaker: 'CANDIDATE' } } } },
      },
    });
    const byPrep = new Map<string, MockInterviewSummary[]>();
    for (const row of rows) {
      const list = byPrep.get(row.prepId) ?? [];
      list.push({
        id: row.id,
        status: row.status,
        stage: row.stage,
        overallScore: row.overallScore,
        verdict: (row.report as MockReportOutput | null)?.verdict ?? null,
        answered: row._count.turns,
        startedAt: row.startedAt.toISOString(),
        endedAt: row.endedAt?.toISOString() ?? null,
      });
      byPrep.set(row.prepId, list);
    }
    return byPrep;
  }

  async remove(userId: string, id: string): Promise<void> {
    if (this.replying.has(id)) {
      throw Problems.conflict('The interviewer is still replying. Try again in a moment.');
    }
    const { count } = await this.prisma.mockInterview.deleteMany({ where: { id, userId } });
    if (count === 0) throw Problems.notFound('Mock interview');
    this.changed(userId);
  }

  // -- The conversation -------------------------------------------------------

  /** Saves the answer, then has the interviewer reply. */
  async answer(userId: string, id: string, input: MockAnswerInput): Promise<MockInterviewView> {
    const interview = await this.load(userId, id);
    this.assertInProgress(interview);
    const last = interview.turns.at(-1);
    if (this.replying.has(id) || last?.speaker === 'CANDIDATE') {
      throw Problems.conflict(
        'The interviewer has not replied to your last answer yet. Retry the reply first.',
      );
    }
    await this.prisma.mockInterviewTurn.create({
      data: {
        interviewId: id,
        order: (last?.order ?? -1) + 1,
        speaker: 'CANDIDATE',
        stage: interview.stage,
        kind: 'ANSWER',
        text: input.text?.trim() ?? '',
        code: input.code?.trim() ? input.code : null,
        codeLanguage: input.code?.trim() ? input.codeLanguage?.trim() || null : null,
      },
    });
    return this.reply(userId, id);
  }

  /** The interviewer's reply to the last answer: after `answer`, or to retry one that failed. */
  async reply(userId: string, id: string): Promise<MockInterviewView> {
    if (this.replying.has(id)) {
      throw Problems.conflict('The interviewer is already replying.');
    }
    this.replying.add(id);
    try {
      const interview = await this.load(userId, id);
      this.assertInProgress(interview);
      const last = interview.turns.at(-1);
      if (!last || last.speaker !== 'CANDIDATE') {
        throw Problems.conflict('There is no answer waiting for a reply.');
      }
      const prep = await this.prisma.interviewPrep.findUniqueOrThrow({
        where: { id: interview.prepId },
      });
      const stage = interview.stage as Stage;
      const pacing = pace(
        interview.turns.map((t) => ({
          speaker: t.speaker as 'INTERVIEWER' | 'CANDIDATE',
          stage: t.stage as Stage,
          kind: t.kind,
        })),
        stage,
        prep.includeDsa,
      );

      let output;
      let source: PrepAiSource;
      try {
        ({ result: output, source } = await this.ai.run(userId, (provider) =>
          mockInterviewerAgent.run(
            provider,
            {
              ...contextOf(prep),
              stage,
              directive: pacing.directive,
              transcript: interview.turns.map((t) => transcriptTurn(t, false)),
            },
            { userId },
          ),
        ));
      } catch (error) {
        const message =
          error instanceof NoPrepAiError ? error.message : describeAIFailure(error).slice(0, 500);
        this.logger.warn(`Mock interview ${id}: reply failed: ${message}`);
        await this.prisma.mockInterview.update({ where: { id }, data: { error: message } });
        throw Problems.aiUnavailable(message);
      }

      const settled = settle(pacing, {
        kind: output.next.kind,
        stage: output.next.stage,
        hasProblem: output.next.problem !== null,
      });
      const problem = settled.kind === 'CODING' ? output.next.problem : null;

      await this.prisma.$transaction([
        this.prisma.mockInterviewTurn.update({
          where: { id: last.id },
          data: {
            language: {
              ok: output.language.ok && output.language.corrections.length === 0,
              corrections: output.language.corrections,
            } as Prisma.InputJsonObject,
            assessment: output.assessment as Prisma.InputJsonObject,
          },
        }),
        this.prisma.mockInterviewTurn.create({
          data: {
            interviewId: id,
            order: last.order + 1,
            speaker: 'INTERVIEWER',
            stage: settled.stage,
            kind: settled.kind,
            text: settled.forcedClose ? FORCED_GOODBYE : output.next.message,
            ...(problem ? { problem: problem as Prisma.InputJsonObject } : {}),
          },
        }),
        this.prisma.mockInterview.update({
          where: { id },
          data: {
            stage: settled.stage,
            aiSource: source,
            error: null,
            ...(settled.closing ? { status: 'REPORTING', endedAt: new Date() } : {}),
          },
        }),
      ]);

      if (settled.closing) void this.writeReport(userId, id);
      this.changed(userId);
    } finally {
      this.replying.delete(id);
    }
    return this.get(userId, id);
  }

  /** The user ends the interview: the report is written from what was said. */
  async finish(userId: string, id: string): Promise<MockInterviewView> {
    const interview = await this.load(userId, id);
    if (interview.status !== 'IN_PROGRESS') return this.toView(interview);
    if (this.replying.has(id)) {
      throw Problems.conflict('The interviewer is still replying. Try again in a moment.');
    }
    const answered = interview.turns.some((t) => t.speaker === 'CANDIDATE');
    await this.prisma.mockInterview.update({
      where: { id },
      data: { status: answered ? 'REPORTING' : 'ABANDONED', endedAt: new Date(), error: null },
    });
    if (answered) void this.writeReport(userId, id);
    this.changed(userId);
    return this.get(userId, id);
  }

  /** Writes a failed report again. */
  async retryReport(userId: string, id: string): Promise<MockInterviewView> {
    const interview = await this.load(userId, id);
    if (interview.status !== 'FAILED') return this.toView(interview);
    await this.prisma.mockInterview.update({
      where: { id },
      data: { status: 'REPORTING', error: null },
    });
    void this.writeReport(userId, id);
    return this.get(userId, id);
  }

  // -- The report ---------------------------------------------------------------

  /** Runs in the background; never throws. */
  async writeReport(userId: string, id: string): Promise<void> {
    if (this.reporting.has(id)) return;
    this.reporting.add(id);
    try {
      const interview = await this.prisma.mockInterview.findFirst({
        where: { id, userId },
        include: { turns: { orderBy: { order: 'asc' } }, prep: true },
      });
      if (!interview || interview.status !== 'REPORTING') return;

      const { result: report, source } = await this.ai.run(userId, (provider) =>
        mockInterviewReportAgent.run(
          provider,
          {
            ...contextOf(interview.prep),
            transcript: interview.turns.map((t) => transcriptTurn(t, true)),
            endedEarly: !interview.turns.some((t) => t.kind === 'CLOSING'),
          },
          { userId },
        ),
      );

      // Only questions that point at a real interviewer turn.
      const askedOrders = new Set(
        interview.turns.filter((t) => t.speaker === 'INTERVIEWER').map((t) => t.order),
      );
      const cleaned: MockReportOutput = {
        ...report,
        questions: report.questions.filter((q) => askedOrders.has(q.turnOrder)),
      };

      await this.prisma.mockInterview.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          report: cleaned as unknown as Prisma.InputJsonObject,
          overallScore: cleaned.overallScore,
          aiSource: source,
          error: null,
        },
      });
      this.logger.log(
        `Mock interview ${id} report ready (${cleaned.overallScore}/10 via ${source})`,
      );
      this.announce(userId, id, cleaned);
    } catch (error) {
      const message =
        error instanceof NoPrepAiError ? error.message : describeAIFailure(error).slice(0, 500);
      this.logger.warn(`Mock interview ${id}: report failed: ${message}`);
      await this.prisma.mockInterview
        .update({ where: { id }, data: { status: 'FAILED', error: message } })
        .catch(() => undefined);
      this.changed(userId);
    } finally {
      this.reporting.delete(id);
    }
  }

  /** The desktop just came online: write the reports that were waiting for it. */
  private async resumeReports(userId: string): Promise<void> {
    const waiting = await this.prisma.mockInterview.findMany({
      // FAILED with no score: the report never got written.
      where: { userId, status: 'FAILED', overallScore: null },
      select: { id: true },
    });
    for (const { id } of waiting) await this.retryReport(userId, id).catch(() => undefined);
  }

  private announce(userId: string, id: string, report: MockReportOutput): void {
    const payload = {
      id: `mock-${id}`,
      level: 'info',
      kind: 'MOCK_INTERVIEW_REPORT_READY',
      title: 'Your interview feedback is ready',
      body:
        `${report.overallScore}/10, ${VERDICT_LABEL[report.verdict]}. ` +
        'See every question, your answers and how to make them stronger.',
      linkPage: 'mock-interview',
      linkId: id,
      createdAt: new Date().toISOString(),
    };
    this.hub.pushToMobiles(userId, 'notification', payload);
    this.changed(userId);
    void this.push.sendToUser(userId, {
      title: payload.title,
      body: payload.body,
      data: { ...payload },
    });
  }

  // -- Helpers -------------------------------------------------------------------

  private changed(userId: string): void {
    this.hub.pushToMobiles(userId, 'changed', { collections: ['interview_preps'] });
  }

  private async load(userId: string, id: string): Promise<WithTurns> {
    const interview = await this.prisma.mockInterview.findFirst({
      where: { id, userId },
      include: { turns: { orderBy: { order: 'asc' } } },
    });
    if (!interview) throw Problems.notFound('Mock interview');
    return interview;
  }

  private assertInProgress(interview: MockInterview): void {
    if (interview.status !== 'IN_PROGRESS') {
      throw Problems.conflict('This interview is over. Start a new one to practise again.');
    }
  }

  private toView(interview: WithTurns): MockInterviewView {
    const over = interview.status === 'COMPLETED';
    const last = interview.turns.at(-1);
    return {
      id: interview.id,
      prepId: interview.prepId,
      status: interview.status,
      stage: interview.stage as Stage,
      stages: [...STAGES],
      awaitingReply: interview.status === 'IN_PROGRESS' && last?.speaker === 'CANDIDATE',
      replying: this.replying.has(interview.id),
      aiSource: (interview.aiSource as PrepAiSource | null) ?? null,
      turns: interview.turns.map((t) => toTurnView(t, over)),
      answered: interview.turns.filter((t) => t.speaker === 'CANDIDATE').length,
      report: (interview.report as MockReportOutput | null) ?? null,
      overallScore: interview.overallScore,
      error: interview.error,
      startedAt: interview.startedAt.toISOString(),
      endedAt: interview.endedAt?.toISOString() ?? null,
    };
  }
}

function contextOf(prep: InterviewPrep): MockInterviewContext {
  return {
    company: prep.company,
    role: prep.role,
    jobDescription: prep.jobDescription,
    technologies: prep.technologies,
    resume: prep.resumeText,
    includeDsa: prep.includeDsa,
  };
}

function transcriptTurn(t: MockInterviewTurn, withJudgement: boolean): MockTranscriptTurn {
  const assessment = t.assessment as { verdict: string; note: string } | null;
  const language = t.language as { corrections?: unknown[] } | null;
  return {
    order: t.order,
    speaker: t.speaker as 'INTERVIEWER' | 'CANDIDATE',
    stage: t.stage as Stage,
    kind: t.kind,
    text: t.text,
    code: t.code,
    codeLanguage: t.codeLanguage,
    problemTitle: (t.problem as { title?: string } | null)?.title ?? null,
    assessment: withJudgement ? assessment : null,
    languageCorrections: withJudgement ? (language?.corrections?.length ?? null) : null,
  };
}

function toTurnView(t: MockInterviewTurn, over: boolean): MockTurnView {
  return {
    id: t.id,
    order: t.order,
    speaker: t.speaker as 'INTERVIEWER' | 'CANDIDATE',
    stage: t.stage as Stage,
    kind: t.kind,
    text: t.text,
    code: t.code,
    codeLanguage: t.codeLanguage,
    problem: (t.problem as CodingProblemOutput | null) ?? null,
    language: (t.language as MockTurnView['language']) ?? null,
    // Hidden while the interview runs: a real interviewer doesn't say.
    assessment: over ? ((t.assessment as MockTurnView['assessment']) ?? null) : null,
    createdAt: t.createdAt.toISOString(),
  };
}

/** The interviewer's first words: no AI needed, so the interview starts at once. */
function opening(prep: InterviewPrep): string {
  const role = prep.role ? `the ${prep.role} role` : 'this role';
  const where = prep.company ? ` at ${prep.company}` : '';
  const tech =
    prep.technologies.length > 0
      ? prep.technologies.slice(0, 3).join(', ')
      : 'the technical side of the role';
  const coding = prep.includeDsa ? 'a couple of algorithm problems' : 'some coding';
  return (
    `Hi, thanks for making the time today. I'll be interviewing you for ${role}${where}.\n\n` +
    `Here's the plan: we'll start with a bit about you, then go into ${tech}, then ${coding}, ` +
    `and we'll keep a few minutes at the end for your questions.\n\n` +
    `Let's begin. Could you give me a brief introduction about yourself?`
  );
}
