import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FakeAIProvider, type FakeResponse } from '@offerpath/ai';
import { PrismaClient } from '@offerpath/database';
import request from 'supertest';

import { AppModule } from '../src/app.module.js';
import { ProblemDetailsFilter } from '../src/common/filters/problem-details.filter.js';
import { AiFallbackService } from '../src/modules/settings/application/ai-fallback.service.js';

/**
 * Live practice (docs/live-practice.md): what the phone hears becomes a
 * transcript, questions get AI answers, spoken answers get graded. OpenAI
 * only; here a fake that also "transcribes".
 */

jest.setTimeout(240_000);

const prisma = new PrismaClient();

let app: INestApplication;
let http: ReturnType<typeof request>;
let accessToken: string;
let userId: string;
let fallback: AiFallbackService;

const user = {
  email: `live-${Date.now()}@offerpath.test`,
  password: 'a-long-enough-password',
  displayName: 'Live Test',
};
const auth = () => ({ Authorization: `Bearer ${accessToken}` });

const CV = 'Jane Doe. Built a payments ledger on PostgreSQL that handles 2M rows a day.';
const INDEX_Q = 'Can you explain how a database index works?';
const ANSWER_1 = {
  summary: 'A B-tree that lets lookups skip a full scan.',
  points: ['B-tree', 'Write cost'],
  detail: '',
};
const GRADE = {
  score: 7,
  covered: ['B-tree'],
  missed: ['Write cost'],
  feedback: 'Mention what every index costs on writes.',
};

const turn = (kind: string, question: string | null = null, answer: unknown = null) => ({
  kind,
  question,
  answer,
});

type LiveFake = FakeAIProvider & { transcribe: jest.Mock };

/** The OpenAI provider for this test: canned analyses, grades and transcripts. */
function useOpenAI(responses: FakeResponse[], transcripts: string[] = []): LiveFake {
  const fake = new FakeAIProvider(responses) as LiveFake;
  fake.transcribe = jest.fn(async () => transcripts.shift() ?? '');
  jest.spyOn(fallback, 'providerFor').mockResolvedValue(fake as never);
  jest.spyOn(fallback, 'available', 'get').mockReturnValue(true);
  jest.spyOn(fallback, 'view').mockResolvedValue({
    configured: true,
    last4: 'abcd',
    modelFast: 'm',
    modelReasoning: 'm',
    available: true,
  });
  return fake;
}

const segment = (durationMs = 2_000) => ({
  audioBase64: Buffer.from('fake aac bytes').toString('base64'),
  fileName: 'segment.m4a',
  durationMs,
});

async function waitFor<T>(check: () => Promise<T | undefined>, ms = 60_000): Promise<T> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const value = await check();
    if (value !== undefined) return value;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('timed out');
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ProblemDetailsFilter());
  await app.init();
  http = request(app.getHttpServer());
  fallback = app.get(AiFallbackService);
  accessToken = (await http.post('/api/v1/auth/register').send(user).expect(201)).body.accessToken;
  userId = (await prisma.user.findUniqueOrThrow({ where: { email: user.email } })).id;
}, 120_000);

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: user.email } }).catch(() => undefined);
  await prisma.$disconnect();
  await app?.close();
});

it('needs an OpenAI key', async () => {
  const ready = (await http.get('/api/v1/live-practice/ready').set(auth()).expect(200)).body;
  expect(ready.ready).toBe(false);
  expect(ready.reason).toBeTruthy();
  await http
    .post('/api/v1/live-practice')
    .set(auth())
    .send({ technologies: ['Go'] })
    .expect(400);
});

describe('a session for a prep', () => {
  let sessionId: string;

  it('takes its title, technologies and CV from the prep', async () => {
    useOpenAI([]);
    const prep = await prisma.interviewPrep.create({
      data: {
        userId,
        company: 'Acme',
        role: 'Backend engineer',
        technologies: ['PostgreSQL', 'Node.js'],
        resumeText: CV,
        resumeSource: 'pasted',
        scheduledAt: new Date(Date.now() + 86_400_000),
        status: 'READY',
      },
    });
    expect((await http.get('/api/v1/live-practice/ready').set(auth())).body).toEqual({
      ready: true,
      reason: null,
    });
    const created = await http
      .post('/api/v1/live-practice')
      .set(auth())
      .send({ prepId: prep.id })
      .expect(201);
    sessionId = created.body.id;
    expect(created.body).toMatchObject({
      prepId: prep.id,
      title: 'Backend engineer at Acme',
      technologies: ['PostgreSQL', 'Node.js'],
      answerFor: 'me',
      status: 'ACTIVE',
      lines: [],
      questions: [],
      stats: { questions: 0, graded: 0, averageScore: null },
    });
  });

  it('turns a spoken question into a question card with an answer from the CV', async () => {
    const fake = useOpenAI(
      [{ when: /explain how a database index/, data: turn('QUESTION', INDEX_Q, ANSWER_1) }],
      ['can you explain how a database index works'],
    );
    const view = (
      await http
        .post(`/api/v1/live-practice/${sessionId}/audio`)
        .set(auth())
        .send(segment())
        .expect(200)
    ).body;
    expect(view.questions).toHaveLength(1);
    expect(view.questions[0]).toMatchObject({
      order: 0,
      text: INDEX_Q,
      answerFor: 'me',
      aiAnswer: ANSWER_1,
      spokenAnswer: null,
      score: null,
      grading: false,
    });
    expect(view.lines[0]).toMatchObject({
      kind: 'QUESTION',
      text: 'can you explain how a database index works',
      questionId: view.questions[0].id,
    });

    expect(fake.transcribe).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'segment.m4a',
        model: 'gpt-4o-mini-transcribe',
        prompt: expect.stringContaining('PostgreSQL, Node.js'),
      }),
    );
    expect(fake.calls[0]).toMatchObject({ agent: 'live-practice' });
    expect(fake.calls[0]!.messages).toContain(CV);
  });

  it('ignores clicks, silence and what recognition invents from it', async () => {
    const fake = useOpenAI([], ['Thank you.', '   ']);
    await http
      .post(`/api/v1/live-practice/${sessionId}/audio`)
      .set(auth())
      .send(segment(200))
      .expect(200);
    expect(fake.transcribe).not.toHaveBeenCalled();
    await http
      .post(`/api/v1/live-practice/${sessionId}/audio`)
      .set(auth())
      .send(segment())
      .expect(200);
    const view = (
      await http
        .post(`/api/v1/live-practice/${sessionId}/audio`)
        .set(auth())
        .send(segment())
        .expect(200)
    ).body;
    expect(view.lines).toHaveLength(1);
    expect(fake.calls).toHaveLength(0);
  });

  it('collects the spoken answer, in order, even when sent at once', async () => {
    useOpenAI([
      { when: /It is a B-tree/, data: turn('ANSWER') },
      { when: /so lookups skip/, data: turn('ANSWER') },
    ]);
    const [first, second] = await Promise.all([
      http
        .post(`/api/v1/live-practice/${sessionId}/text`)
        .set(auth())
        .send({ text: 'It is a B-tree' }),
      http
        .post(`/api/v1/live-practice/${sessionId}/text`)
        .set(auth())
        .send({ text: 'so lookups skip rows' }),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const view = (await http.get(`/api/v1/live-practice/${sessionId}`).set(auth())).body;
    expect(view.lines.map((l: { kind: string }) => l.kind)).toEqual([
      'QUESTION',
      'ANSWER',
      'ANSWER',
    ]);
    expect(view.questions[0].spokenAnswer).toBe('It is a B-tree so lookups skip rows');
  });

  it('grades the last answer when the next question comes, and answers neutrally on request', async () => {
    await http
      .patch(`/api/v1/live-practice/${sessionId}`)
      .set(auth())
      .send({ answerFor: 'neutral' })
      .expect(200);
    const fake = useOpenAI([
      { when: /Key points:/, data: GRADE },
      {
        when: /What is a goroutine/,
        data: turn('QUESTION', 'What is a goroutine?', {
          summary: 'A lightweight thread.',
          points: ['Scheduler'],
          detail: '',
        }),
      },
    ]);
    const view = (
      await http
        .post(`/api/v1/live-practice/${sessionId}/text`)
        .set(auth())
        .send({ text: 'What is a goroutine?' })
        .expect(200)
    ).body;
    expect(view.questions).toHaveLength(2);
    expect(view.questions[1]).toMatchObject({ answerFor: 'neutral' });
    const analysis = fake.calls.find((c) => c.agent === 'live-practice')!;
    expect(analysis.messages).not.toContain(CV);
    expect(analysis.messages).toContain('No CV');

    const graded = await waitFor(async () => {
      const v = (await http.get(`/api/v1/live-practice/${sessionId}`).set(auth())).body;
      return v.questions[0].score !== null ? v : undefined;
    });
    expect(graded.questions[0]).toMatchObject({
      score: 7,
      feedback: { covered: ['B-tree'], missed: ['Write cost'], feedback: GRADE.feedback },
      grading: false,
    });
    expect(graded.stats).toEqual({ questions: 2, graded: 1, averageScore: 7 });
    const grading = fake.calls.find((c) => c.agent === 'interview-prep-grader')!;
    expect(grading.messages).toContain('- B-tree');
    expect(grading.messages).toContain('It is a B-tree so lookups skip rows');
  });

  it('refuses to grade an unanswered question, and ends', async () => {
    useOpenAI([]);
    const view = (await http.get(`/api/v1/live-practice/${sessionId}`).set(auth())).body;
    await http
      .post(`/api/v1/live-practice/${sessionId}/questions/${view.questions[1].id}/grade`)
      .set(auth())
      .expect(409);

    const ended = (
      await http.post(`/api/v1/live-practice/${sessionId}/end`).set(auth()).expect(200)
    ).body;
    expect(ended.status).toBe('ENDED');
    expect(ended.endedAt).toBeTruthy();
    await http
      .post(`/api/v1/live-practice/${sessionId}/text`)
      .set(auth())
      .send({ text: 'Hi' })
      .expect(409);

    const list = (await http.get('/api/v1/live-practice').set(auth()).expect(200)).body.sessions;
    expect(list[0]).toMatchObject({
      id: sessionId,
      status: 'ENDED',
      stats: { questions: 2, graded: 1, averageScore: 7 },
    });
  });
});

it('runs without a prep, from technologies alone', async () => {
  useOpenAI([]);
  const created = await http
    .post('/api/v1/live-practice')
    .set(auth())
    .send({ technologies: ['Go', ' Kubernetes ', 'Go'], answerFor: 'neutral' })
    .expect(201);
  expect(created.body).toMatchObject({
    prepId: null,
    title: 'Go, Kubernetes',
    technologies: ['Go', 'Kubernetes'],
    answerFor: 'neutral',
  });
  await http.delete(`/api/v1/live-practice/${created.body.id}`).set(auth()).expect(204);
  await http.get(`/api/v1/live-practice/${created.body.id}`).set(auth()).expect(404);
});
