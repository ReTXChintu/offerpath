import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  describeAIFailure,
  livePracticeAgent,
  prepAnswerGraderAgent,
  type LiveAnswerOutput,
  type LiveLineKind,
  type OpenAIProvider,
} from '@offerpath/ai';
import type { AppConfig } from '@offerpath/config';
import type {
  InterviewPrep,
  LivePracticeLine,
  LivePracticeQuestion,
  LivePracticeSession,
  Prisma,
} from '@offerpath/database';

import { Problems } from '../../../common/http/problem-details.js';
import { APP_CONFIG } from '../../../infrastructure/config/config.module.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { RecordingAIProvider } from '../../ai/infrastructure/recording-ai.provider.js';
import { AiFallbackService } from '../../settings/application/ai-fallback.service.js';

import { CvService } from './cv.service.js';

export type AnswerFor = 'me' | 'neutral';

export interface LiveLineView {
  id: string;
  order: number;
  text: string;
  kind: LiveLineKind;
  questionId: string | null;
  createdAt: string;
}

export interface LiveQuestionView {
  id: string;
  order: number;
  text: string;
  answerFor: AnswerFor;
  aiAnswer: LiveAnswerOutput;
  spokenAnswer: string | null;
  score: number | null;
  feedback: { covered: string[]; missed: string[]; feedback: string } | null;
  grading: boolean;
  gradedAt: string | null;
  createdAt: string;
}

export interface LiveStats {
  questions: number;
  graded: number;
  averageScore: number | null;
}

export interface LivePracticeView {
  id: string;
  prepId: string | null;
  title: string;
  technologies: string[];
  answerFor: AnswerFor;
  status: LivePracticeSession['status'];
  lines: LiveLineView[];
  questions: LiveQuestionView[];
  stats: LiveStats;
  createdAt: string;
  endedAt: string | null;
}

export interface LivePracticeSummary {
  id: string;
  prepId: string | null;
  title: string;
  status: LivePracticeSession['status'];
  stats: LiveStats;
  createdAt: string;
  endedAt: string | null;
}

export interface LivePracticeInput {
  prepId?: string | null;
  technologies?: string[];
  title?: string | null;
  answerFor?: AnswerFor;
}

export interface AudioSegment {
  audioBase64: string;
  fileName: string;
  durationMs: number;
}

/** The largest audio segment accepted, before base64 (30 s of AAC is far less). */
export const MAX_SEGMENT_BYTES = 4 * 1024 * 1024;
/** Shorter than this is a click or a breath, not speech. */
export const MIN_SEGMENT_MS = 400;
const AUDIO_EXTENSIONS = new Set([
  'm4a',
  'aac',
  'mp4',
  'wav',
  'mp3',
  'mpeg',
  'mpga',
  'webm',
  'ogg',
]);
/** What speech recognition tends to invent from silence. */
const PHANTOMS =
  /^(thank you( (so much|very much))?|thanks( for watching)?|you|bye|(please )?subscribe[\w\s]*)[.!]*$/i;

type Full = LivePracticeSession & {
  lines: LivePracticeLine[];
  questions: LivePracticeQuestion[];
  prep: InterviewPrep | null;
};

/**
 * Live practice (docs/live-practice.md): the phone sends what it hears in
 * segments; each is transcribed, classified (a new question, part of an
 * answer, or neither), and a question gets an AI answer to compare with.
 * Spoken answers are graded against that answer's points.
 *
 * OpenAI only, on the user's own key (user decision, 2026-10-21): the answer
 * must be on screen seconds after the question. Segments of one session are
 * handled one at a time, in arrival order, so the transcript stays in order.
 */
@Injectable()
export class LivePracticeService {
  private readonly logger = new Logger(LivePracticeService.name);
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly grading = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly fallback: AiFallbackService,
    private readonly cv: CvService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async ready(userId: string): Promise<{ ready: boolean; reason: string | null }> {
    if (!this.fallback.available) {
      return { ready: false, reason: 'This server cannot store OpenAI keys yet.' };
    }
    if (!(await this.fallback.view(userId)).configured) {
      return {
        ready: false,
        reason: 'Live practice runs on your OpenAI key. Add it in Settings → AI.',
      };
    }
    return { ready: true, reason: null };
  }

  // -- Sessions ---------------------------------------------------------------

  async create(userId: string, input: LivePracticeInput): Promise<LivePracticeView> {
    const { ready, reason } = await this.ready(userId);
    if (!ready) throw Problems.validation({ openai: [reason ?? 'No OpenAI key.'] });

    let prep: InterviewPrep | null = null;
    if (input.prepId) {
      prep = await this.prisma.interviewPrep.findFirst({ where: { id: input.prepId, userId } });
      if (!prep) throw Problems.notFound('Interview prep');
    }
    const technologies = [
      ...new Set(
        (input.technologies ?? prep?.technologies ?? []).map((t) => t.trim()).filter(Boolean),
      ),
    ].slice(0, 20);
    const title =
      input.title?.trim() ||
      [prep?.role, prep?.company ? `at ${prep.company}` : null].filter(Boolean).join(' ') ||
      technologies.slice(0, 3).join(', ') ||
      'Live practice';

    const session = await this.prisma.livePracticeSession.create({
      data: {
        userId,
        prepId: prep?.id ?? null,
        title: title.slice(0, 120),
        technologies,
        answerFor: input.answerFor ?? 'me',
      },
    });
    return this.get(userId, session.id);
  }

  async list(userId: string): Promise<LivePracticeSummary[]> {
    const sessions = await this.prisma.livePracticeSession.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { questions: { select: { score: true } } },
    });
    return sessions.map((s) => ({
      id: s.id,
      prepId: s.prepId,
      title: s.title,
      status: s.status,
      stats: statsOf(s.questions),
      createdAt: s.createdAt.toISOString(),
      endedAt: s.endedAt?.toISOString() ?? null,
    }));
  }

  async get(userId: string, id: string): Promise<LivePracticeView> {
    return this.toView(await this.load(userId, id));
  }

  async update(
    userId: string,
    id: string,
    input: { answerFor?: AnswerFor; title?: string | null },
  ): Promise<LivePracticeView> {
    await this.load(userId, id);
    await this.prisma.livePracticeSession.update({
      where: { id },
      data: {
        ...(input.answerFor ? { answerFor: input.answerFor } : {}),
        ...(input.title?.trim() ? { title: input.title.trim().slice(0, 120) } : {}),
      },
    });
    return this.get(userId, id);
  }

  async end(userId: string, id: string): Promise<LivePracticeView> {
    const session = await this.load(userId, id);
    if (session.status === 'ACTIVE') {
      await this.prisma.livePracticeSession.update({
        where: { id },
        data: { status: 'ENDED', endedAt: new Date() },
      });
    }
    // Every answered question still without a grade, one after another.
    const waiting = session.questions.filter(
      (q) => q.gradedAt === null && hasAnswer(session.lines, q.id),
    );
    for (const q of waiting) this.grading.add(q.id);
    void (async () => {
      for (const q of waiting) await this.gradeQuietly(userId, id, q.id);
    })();
    return this.get(userId, id);
  }

  async remove(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.livePracticeSession.deleteMany({ where: { id, userId } });
    if (count === 0) throw Problems.notFound('Live practice session');
  }

  // -- What the phone hears -----------------------------------------------------

  async audio(userId: string, id: string, segment: AudioSegment): Promise<LivePracticeView> {
    return this.serialize(id, async () => {
      const session = await this.load(userId, id);
      assertActive(session);
      if (segment.durationMs < MIN_SEGMENT_MS) return this.toView(session);

      const extension = segment.fileName.toLowerCase().split('.').pop() ?? '';
      if (!AUDIO_EXTENSIONS.has(extension)) {
        throw Problems.validation({ fileName: ['Send m4a, aac, wav, mp3, ogg or webm audio.'] });
      }
      const audio = Buffer.from(segment.audioBase64, 'base64');
      if (audio.length === 0) return this.toView(session);
      if (audio.length > MAX_SEGMENT_BYTES) {
        throw Problems.validation({ audioBase64: ['A segment can be at most 4 MB.'] });
      }

      const openai = await this.openai(userId);
      let text: string;
      try {
        text = await openai.transcribe({
          audio,
          fileName: `segment.${extension}`,
          model: this.config.env.OPENAI_TRANSCRIBE_MODEL,
          prompt: vocabulary(session),
        });
      } catch (error) {
        throw Problems.aiUnavailable(describeAIFailure(error).slice(0, 300));
      }
      return this.ingest(userId, session, text, segment.durationMs, openai);
    });
  }

  async text(userId: string, id: string, text: string): Promise<LivePracticeView> {
    return this.serialize(id, async () => {
      const session = await this.load(userId, id);
      assertActive(session);
      return this.ingest(userId, session, text, null, await this.openai(userId));
    });
  }

  /** Grades a question's spoken answer now. */
  async grade(userId: string, id: string, questionId: string): Promise<LivePracticeView> {
    const session = await this.load(userId, id);
    const question = session.questions.find((q) => q.id === questionId);
    if (!question) throw Problems.notFound('Question');
    if (!hasAnswer(session.lines, questionId)) {
      throw Problems.conflict('Nobody has answered this question yet.');
    }
    if (this.grading.has(questionId)) {
      throw Problems.conflict('This answer is being graded already.');
    }
    this.grading.add(questionId);
    try {
      await this.gradeQuestion(userId, session, question);
    } finally {
      this.grading.delete(questionId);
    }
    return this.get(userId, id);
  }

  // -- Internals -------------------------------------------------------------------

  private async ingest(
    userId: string,
    session: Full,
    raw: string,
    durationMs: number | null,
    openai: OpenAIProvider,
  ): Promise<LivePracticeView> {
    const text = raw.replace(/\s+/g, ' ').trim();
    // Nothing said, or what recognition makes of silence.
    if (!/[\p{L}\p{N}]/u.test(text) || PHANTOMS.test(text)) return this.toView(session);

    const current = session.questions.at(-1) ?? null;
    const resume =
      session.answerFor === 'me'
        ? (session.prep?.resumeText ?? (await this.cv.fromProfile(userId)))
        : null;

    let turn;
    try {
      turn = await livePracticeAgent.run(
        new RecordingAIProvider(openai, this.prisma),
        {
          company: session.prep?.company ?? null,
          role: session.prep?.role ?? null,
          jobDescription: session.prep?.jobDescription ?? null,
          technologies: session.technologies,
          resume,
          recent: session.lines
            .slice(-12)
            .map((l) => ({ kind: l.kind as LiveLineKind, text: l.text })),
          currentQuestion: current?.text ?? null,
          latest: text,
        },
        { userId },
      );
    } catch (error) {
      // Keep what was said even when the analysis failed.
      await this.addLine(session, text, 'OTHER', null, durationMs);
      throw Problems.aiUnavailable(describeAIFailure(error).slice(0, 300));
    }

    if (turn.kind === 'QUESTION' && turn.answer) {
      const question = await this.prisma.livePracticeQuestion.create({
        data: {
          sessionId: session.id,
          order: session.questions.length,
          text: turn.question?.trim() || text,
          answerFor: session.answerFor,
          aiAnswer: turn.answer as Prisma.InputJsonObject,
        },
      });
      await this.addLine(session, text, 'QUESTION', question.id, durationMs);
      // The previous question's answer is over: grade it while they go on.
      if (current && current.gradedAt === null && hasAnswer(session.lines, current.id)) {
        this.grading.add(current.id);
        void this.gradeQuietly(userId, session.id, current.id);
      }
    } else if (turn.kind === 'ANSWER' && current) {
      await this.addLine(session, text, 'ANSWER', current.id, durationMs);
    } else {
      await this.addLine(session, text, 'OTHER', null, durationMs);
    }
    return this.get(userId, session.id);
  }

  private async addLine(
    session: Full,
    text: string,
    kind: LiveLineKind,
    questionId: string | null,
    durationMs: number | null,
  ): Promise<void> {
    await this.prisma.livePracticeLine.create({
      data: {
        sessionId: session.id,
        order: (session.lines.at(-1)?.order ?? -1) + 1,
        text,
        kind,
        questionId,
        durationMs,
      },
    });
  }

  private async gradeQuestion(
    userId: string,
    session: Full,
    question: LivePracticeQuestion,
  ): Promise<void> {
    const spoken = spokenAnswer(session.lines, question.id);
    if (!spoken) return;
    const openai = await this.openai(userId);
    const answer = question.aiAnswer as unknown as LiveAnswerOutput;
    let grade;
    try {
      grade = await prepAnswerGraderAgent.run(
        new RecordingAIProvider(openai, this.prisma),
        {
          question: question.text,
          keyPoints: answer.points,
          answer: spoken,
          role: session.prep?.role ?? null,
        },
        { userId },
      );
    } catch (error) {
      throw Problems.aiUnavailable(describeAIFailure(error).slice(0, 300));
    }
    await this.prisma.livePracticeQuestion.update({
      where: { id: question.id },
      data: {
        score: grade.score,
        feedback: {
          covered: grade.covered,
          missed: grade.missed,
          feedback: grade.feedback,
        } as Prisma.InputJsonObject,
        gradedAt: new Date(),
      },
    });
  }

  /** In the background: a failure leaves the question ungraded, to grade by hand. */
  private async gradeQuietly(userId: string, sessionId: string, questionId: string): Promise<void> {
    try {
      const session = await this.load(userId, sessionId);
      const question = session.questions.find((q) => q.id === questionId);
      if (question && question.gradedAt === null) {
        await this.gradeQuestion(userId, session, question);
      }
    } catch (error) {
      this.logger.warn(`Live practice ${sessionId}: grading failed: ${String(error)}`);
    } finally {
      this.grading.delete(questionId);
    }
  }

  private async openai(userId: string): Promise<OpenAIProvider> {
    const provider = await this.fallback.providerFor(userId);
    if (!provider) {
      throw Problems.aiUnavailable(
        'Live practice runs on your OpenAI key. Add it in Settings → AI.',
      );
    }
    return provider;
  }

  /** One segment at a time per session, in the order they arrive. */
  private serialize<T>(id: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(id) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    this.queues.set(id, next);
    void next
      .catch(() => undefined)
      .finally(() => {
        if (this.queues.get(id) === next) this.queues.delete(id);
      });
    return next;
  }

  private async load(userId: string, id: string): Promise<Full> {
    const session = await this.prisma.livePracticeSession.findFirst({
      where: { id, userId },
      include: {
        lines: { orderBy: { order: 'asc' } },
        questions: { orderBy: { order: 'asc' } },
        prep: true,
      },
    });
    if (!session) throw Problems.notFound('Live practice session');
    return session;
  }

  private toView(session: Full): LivePracticeView {
    return {
      id: session.id,
      prepId: session.prepId,
      title: session.title,
      technologies: session.technologies,
      answerFor: session.answerFor as AnswerFor,
      status: session.status,
      lines: session.lines.map((l) => ({
        id: l.id,
        order: l.order,
        text: l.text,
        kind: l.kind as LiveLineKind,
        questionId: l.questionId,
        createdAt: l.createdAt.toISOString(),
      })),
      questions: session.questions.map((q) => ({
        id: q.id,
        order: q.order,
        text: q.text,
        answerFor: q.answerFor as AnswerFor,
        aiAnswer: q.aiAnswer as unknown as LiveAnswerOutput,
        spokenAnswer: spokenAnswer(session.lines, q.id),
        score: q.score,
        feedback: (q.feedback as LiveQuestionView['feedback']) ?? null,
        grading: this.grading.has(q.id),
        gradedAt: q.gradedAt?.toISOString() ?? null,
        createdAt: q.createdAt.toISOString(),
      })),
      stats: statsOf(session.questions),
      createdAt: session.createdAt.toISOString(),
      endedAt: session.endedAt?.toISOString() ?? null,
    };
  }
}

function assertActive(session: LivePracticeSession): void {
  if (session.status !== 'ACTIVE') {
    throw Problems.conflict('This session has ended. Start a new one to practise again.');
  }
}

function hasAnswer(lines: LivePracticeLine[], questionId: string): boolean {
  return lines.some((l) => l.kind === 'ANSWER' && l.questionId === questionId);
}

function spokenAnswer(lines: LivePracticeLine[], questionId: string): string | null {
  const parts = lines.filter((l) => l.kind === 'ANSWER' && l.questionId === questionId);
  return parts.length > 0 ? parts.map((l) => l.text).join(' ') : null;
}

function statsOf(questions: { score: number | null }[]): LiveStats {
  const graded = questions.filter((q) => q.score !== null);
  return {
    questions: questions.length,
    graded: graded.length,
    averageScore:
      graded.length > 0
        ? Math.round((graded.reduce((s, q) => s + (q.score ?? 0), 0) / graded.length) * 10) / 10
        : null,
  };
}

/** Words to expect, so recognition spells the technologies right. */
function vocabulary(session: Full): string {
  return [
    'A job interview practice session.',
    session.prep?.role ? `Role: ${session.prep.role}.` : '',
    session.technologies.length > 0 ? `Technologies: ${session.technologies.join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join(' ')
    .slice(0, 400);
}
