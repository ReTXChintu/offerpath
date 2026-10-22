import { Inject, Injectable } from '@nestjs/common';

import { describeAIFailure, liveAnswererInstructions } from '@offerpath/ai';
import type { AppConfig } from '@offerpath/config';
import type {
  InterviewPrep,
  LivePracticeExchange,
  LivePracticeSession,
  LivePracticeVoice,
} from '@offerpath/database';

import { Problems } from '../../../common/http/problem-details.js';
import { APP_CONFIG } from '../../../infrastructure/config/config.module.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { AiFallbackService } from '../../settings/application/ai-fallback.service.js';

import { CvService } from './cv.service.js';

export type AnswerFor = 'me' | 'neutral';

export interface LiveExchangeView {
  id: string;
  order: number;
  question: string;
  answer: string;
  answerFor: AnswerFor;
  createdAt: string;
}

export interface LivePracticeView {
  id: string;
  prepId: string | null;
  title: string;
  technologies: string[];
  answerFor: AnswerFor;
  status: LivePracticeSession['status'];
  exchanges: LiveExchangeView[];
  createdAt: string;
  endedAt: string | null;
}

export interface LivePracticeSummary {
  id: string;
  prepId: string | null;
  title: string;
  status: LivePracticeSession['status'];
  exchanges: number;
  createdAt: string;
  endedAt: string | null;
}

export interface LivePracticeInput {
  prepId?: string | null;
  technologies?: string[];
  title?: string | null;
  answerFor?: AnswerFor;
}

export interface VoiceProfile {
  model: string;
  embedding: number[];
  threshold: number;
  updatedAt: string;
}

export interface VoiceInput {
  model: string;
  embedding: number[];
  threshold?: number;
}

export interface RealtimePass {
  clientSecret: string;
  expiresAt: string;
  model: string;
  url: string;
}

/** How long the phone has to connect with a pass. */
const PASS_SECONDS = 600;
/** Earlier exchanges carried into a reconnected session, for follow-ups. */
const CARRIED_EXCHANGES = 6;

type Full = LivePracticeSession & {
  exchanges: LivePracticeExchange[];
  prep: InterviewPrep | null;
};

/**
 * Live practice (docs/live-practice.md): the phone talks to an OpenAI
 * Realtime session directly, for speed; this service hands it a short-lived
 * pass for that session (so the user's key stays here), fixes the session's
 * instructions (the CV, the JD, how to answer), and keeps the questions and
 * answers the phone saves.
 *
 * OpenAI only, on the user's own key (user decision, 2026-10-21).
 */
@Injectable()
export class LivePracticeService {
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
      include: { _count: { select: { exchanges: true } } },
    });
    return sessions.map((s) => ({
      id: s.id,
      prepId: s.prepId,
      title: s.title,
      status: s.status,
      exchanges: s._count.exchanges,
      createdAt: s.createdAt.toISOString(),
      endedAt: s.endedAt?.toISOString() ?? null,
    }));
  }

  async get(userId: string, id: string): Promise<LivePracticeView> {
    return toView(await this.load(userId, id));
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
    return this.get(userId, id);
  }

  async remove(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.livePracticeSession.deleteMany({ where: { id, userId } });
    if (count === 0) throw Problems.notFound('Live practice session');
  }

  // -- The interviewee's voice -------------------------------------------------------

  /**
   * The user's voiceprint, made on the phone: how it tells the interviewee
   * (this user) from the interviewer. Kept here so it survives a reinstall.
   */
  async voice(userId: string): Promise<VoiceProfile> {
    const voice = await this.prisma.livePracticeVoice.findUnique({ where: { userId } });
    if (!voice) throw Problems.notFound('Voice profile');
    return toVoiceView(voice);
  }

  async saveVoice(userId: string, input: VoiceInput): Promise<VoiceProfile> {
    const data = {
      model: input.model,
      embedding: input.embedding,
      ...(input.threshold !== undefined ? { threshold: input.threshold } : {}),
    };
    const voice = await this.prisma.livePracticeVoice.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return toVoiceView(voice);
  }

  async setThreshold(userId: string, threshold: number): Promise<VoiceProfile> {
    await this.voice(userId);
    const voice = await this.prisma.livePracticeVoice.update({
      where: { userId },
      data: { threshold },
    });
    return toVoiceView(voice);
  }

  async deleteVoice(userId: string): Promise<void> {
    const { count } = await this.prisma.livePracticeVoice.deleteMany({ where: { userId } });
    if (count === 0) throw Problems.notFound('Voice profile');
  }

  // -- The realtime session -------------------------------------------------------

  /** A short-lived pass for the phone to open the OpenAI Realtime session with. */
  async realtime(userId: string, id: string): Promise<RealtimePass> {
    const session = await this.load(userId, id);
    assertActive(session);
    const openai = await this.fallback.providerFor(userId);
    if (!openai) {
      throw Problems.aiUnavailable(
        'Live practice runs on your OpenAI key. Add it in Settings → AI.',
      );
    }

    const resume =
      session.answerFor === 'me'
        ? (session.prep?.resumeText ?? (await this.cv.fromProfile(userId)))
        : null;
    const instructions = liveAnswererInstructions({
      company: session.prep?.company ?? null,
      role: session.prep?.role ?? null,
      jobDescription: session.prep?.jobDescription ?? null,
      technologies: session.technologies,
      resume,
      earlier: session.exchanges
        .slice(-CARRIED_EXCHANGES)
        .map((e) => ({ question: e.question, answer: e.answer })),
    });
    const model = this.config.env.OPENAI_REALTIME_MODEL;

    try {
      const secret = await openai.createRealtimeSecret({
        expiresInSeconds: PASS_SECONDS,
        session: {
          type: 'realtime',
          model,
          instructions,
          output_modalities: ['text'],
          audio: {
            input: {
              format: { type: 'audio/pcm', rate: 24_000 },
              transcription: {
                model: this.config.env.OPENAI_TRANSCRIBE_MODEL,
                prompt: vocabulary(session),
              },
              // Cuts the conversation into turns. The phone decides which
              // turns get an answer (the interviewer's, by voice), so no
              // automatic responses, and nothing interrupts one.
              turn_detection: {
                type: 'server_vad',
                silence_duration_ms: 700,
                create_response: false,
                interrupt_response: false,
              },
              // The phone lies on the table between two people.
              noise_reduction: { type: 'far_field' },
            },
          },
        },
      });
      return {
        clientSecret: secret.value,
        expiresAt: new Date(secret.expiresAt * 1000).toISOString(),
        model,
        url: `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`,
      };
    } catch (error) {
      // OpenAI's own words: the user needs them to tell a bad key from a bad setting.
      throw Problems.aiUnavailable(describeAIFailure(error, 500));
    }
  }

  /** A question the phone heard and the answer it got. */
  async addExchange(
    userId: string,
    id: string,
    input: { question: string; answer: string },
  ): Promise<LiveExchangeView> {
    const session = await this.load(userId, id);
    assertActive(session);
    // Two saves at once may pick the same order: the unique index makes the
    // second one retry with the next.
    for (let attempt = 0; ; attempt++) {
      const last = await this.prisma.livePracticeExchange.findFirst({
        where: { sessionId: id },
        orderBy: { order: 'desc' },
        select: { order: true },
      });
      try {
        const exchange = await this.prisma.livePracticeExchange.create({
          data: {
            sessionId: id,
            order: (last?.order ?? -1) + 1,
            question: input.question.trim(),
            answer: input.answer.trim(),
            answerFor: session.answerFor,
          },
        });
        return toExchangeView(exchange);
      } catch (error) {
        if (attempt >= 4 || (error as { code?: string }).code !== 'P2002') throw error;
      }
    }
  }

  private async load(userId: string, id: string): Promise<Full> {
    const session = await this.prisma.livePracticeSession.findFirst({
      where: { id, userId },
      include: { exchanges: { orderBy: { order: 'asc' } }, prep: true },
    });
    if (!session) throw Problems.notFound('Live practice session');
    return session;
  }
}

function assertActive(session: LivePracticeSession): void {
  if (session.status !== 'ACTIVE') {
    throw Problems.conflict('This session has ended. Start a new one to practise again.');
  }
}

function toVoiceView(voice: LivePracticeVoice): VoiceProfile {
  return {
    model: voice.model,
    embedding: voice.embedding,
    threshold: voice.threshold,
    updatedAt: voice.updatedAt.toISOString(),
  };
}

function toExchangeView(e: LivePracticeExchange): LiveExchangeView {
  return {
    id: e.id,
    order: e.order,
    question: e.question,
    answer: e.answer,
    answerFor: e.answerFor as AnswerFor,
    createdAt: e.createdAt.toISOString(),
  };
}

function toView(session: Full): LivePracticeView {
  return {
    id: session.id,
    prepId: session.prepId,
    title: session.title,
    technologies: session.technologies,
    answerFor: session.answerFor as AnswerFor,
    status: session.status,
    exchanges: session.exchanges.map(toExchangeView),
    createdAt: session.createdAt.toISOString(),
    endedAt: session.endedAt?.toISOString() ?? null,
  };
}

/** Words to expect, so the captions spell the technologies right. */
function vocabulary(session: Full): string {
  return [
    'A job interview practice conversation.',
    session.prep?.role ? `Role: ${session.prep.role}.` : '',
    session.technologies.length > 0 ? `Technologies: ${session.technologies.join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join(' ')
    .slice(0, 400);
}
