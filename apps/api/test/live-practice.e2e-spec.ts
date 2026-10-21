import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@offerpath/database';
import request from 'supertest';

import { AppModule } from '../src/app.module.js';
import { ProblemDetailsFilter } from '../src/common/filters/problem-details.filter.js';
import { AiFallbackService } from '../src/modules/settings/application/ai-fallback.service.js';

/**
 * Live practice (docs/live-practice.md): the phone talks to an OpenAI
 * Realtime session itself; the API hands it a short-lived pass with the
 * session's instructions fixed, and keeps the questions and answers. OpenAI
 * is faked: it never sees a real key here.
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

interface SecretCall {
  session: {
    type: string;
    model: string;
    instructions: string;
    output_modalities: string[];
    audio: { input: Record<string, Record<string, unknown>> };
  };
  expiresInSeconds: number;
}

/** A user with a saved OpenAI key, whose Realtime secrets are faked. */
function useOpenAI(fail?: Error) {
  const createRealtimeSecret = jest.fn(async (_req: SecretCall) => {
    if (fail) throw fail;
    return { value: 'ek_test_secret', expiresAt: Math.floor(Date.now() / 1000) + 600 };
  });
  jest.spyOn(fallback, 'providerFor').mockResolvedValue({ createRealtimeSecret } as never);
  jest.spyOn(fallback, 'available', 'get').mockReturnValue(true);
  jest.spyOn(fallback, 'view').mockResolvedValue({
    configured: true,
    last4: 'abcd',
    modelFast: 'm',
    modelReasoning: 'm',
    available: true,
  });
  return createRealtimeSecret;
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

  it('takes its title and technologies from the prep', async () => {
    useOpenAI();
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
      exchanges: [],
    });
  });

  it('hands out a realtime pass whose session answers as the candidate', async () => {
    const secret = useOpenAI();
    const pass = (
      await http.post(`/api/v1/live-practice/${sessionId}/realtime`).set(auth()).expect(200)
    ).body;
    expect(pass).toMatchObject({
      clientSecret: 'ek_test_secret',
      model: 'gpt-realtime',
      url: 'wss://api.openai.com/v1/realtime?model=gpt-realtime',
    });
    expect(Date.parse(pass.expiresAt)).toBeGreaterThan(Date.now());

    const { session, expiresInSeconds } = secret.mock.calls[0]![0];
    expect(expiresInSeconds).toBe(600);
    expect(session).toMatchObject({
      type: 'realtime',
      model: 'gpt-realtime',
      output_modalities: ['text'],
    });
    expect(session.audio.input.format).toEqual({ type: 'audio/pcm', rate: 24_000 });
    expect(session.audio.input.turn_detection).toMatchObject({
      type: 'server_vad',
      create_response: true,
      interrupt_response: false,
    });
    expect(session.audio.input.transcription).toMatchObject({
      model: 'gpt-4o-mini-transcribe',
      prompt: expect.stringContaining('PostgreSQL, Node.js'),
    });
    expect(session.instructions).toContain(CV);
    expect(session.instructions).toContain('Answer the question itself, directly');
  });

  it('keeps the questions and answers, and carries them into the next pass', async () => {
    useOpenAI();
    const [a, b] = await Promise.all([
      http
        .post(`/api/v1/live-practice/${sessionId}/exchanges`)
        .set(auth())
        .send({ question: 'What is MVCC?', answer: 'Each transaction reads a snapshot.' }),
      http
        .post(`/api/v1/live-practice/${sessionId}/exchanges`)
        .set(auth())
        .send({ question: 'Why did you pick PostgreSQL?', answer: 'Our ledger needed ACID.' }),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect([a.body.order, b.body.order].sort()).toEqual([0, 1]);
    expect(a.body).toMatchObject({ answerFor: 'me' });

    await http
      .patch(`/api/v1/live-practice/${sessionId}`)
      .set(auth())
      .send({ answerFor: 'neutral' })
      .expect(200);
    const secret = useOpenAI();
    await http.post(`/api/v1/live-practice/${sessionId}/realtime`).set(auth()).expect(200);
    const { instructions } = secret.mock.calls[0]![0].session;
    expect(instructions).not.toContain(CV);
    expect(instructions).toContain('Answer neutrally');
    expect(instructions).toContain('Q: What is MVCC?');
    expect(instructions).toContain('A: Our ledger needed ACID.');
  });

  it("passes OpenAI's own refusal on", async () => {
    useOpenAI(
      Object.assign(new Error('AI provider unavailable'), {
        cause: new Error("400 Unknown parameter: 'session.audio.input.foo'."),
      }),
    );
    const refused = await http
      .post(`/api/v1/live-practice/${sessionId}/realtime`)
      .set(auth())
      .expect(503);
    expect(refused.body.detail).toContain("Unknown parameter: 'session.audio.input.foo'");
  });

  it('ends: no more passes or saves, and lists it', async () => {
    useOpenAI();
    const ended = (
      await http.post(`/api/v1/live-practice/${sessionId}/end`).set(auth()).expect(200)
    ).body;
    expect(ended).toMatchObject({ status: 'ENDED' });
    expect(ended.exchanges).toHaveLength(2);
    await http.post(`/api/v1/live-practice/${sessionId}/realtime`).set(auth()).expect(409);
    await http
      .post(`/api/v1/live-practice/${sessionId}/exchanges`)
      .set(auth())
      .send({ question: 'Q?', answer: 'A.' })
      .expect(409);

    const list = (await http.get('/api/v1/live-practice').set(auth()).expect(200)).body.sessions;
    expect(list[0]).toMatchObject({ id: sessionId, status: 'ENDED', exchanges: 2 });
  });
});

it('runs without a prep, from technologies alone', async () => {
  useOpenAI();
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
