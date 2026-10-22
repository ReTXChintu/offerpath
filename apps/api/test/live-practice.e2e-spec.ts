import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@offerpath/database';
import request from 'supertest';

import { AppModule } from '../src/app.module.js';
import { ProblemDetailsFilter } from '../src/common/filters/problem-details.filter.js';
import { DownloadsService } from '../src/modules/downloads/application/downloads.service.js';
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
      model: 'gpt-realtime-2.1',
      url: 'wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1',
    });
    expect(Date.parse(pass.expiresAt)).toBeGreaterThan(Date.now());

    const { session, expiresInSeconds } = secret.mock.calls[0]![0];
    expect(expiresInSeconds).toBe(600);
    expect(session).toMatchObject({
      type: 'realtime',
      model: 'gpt-realtime-2.1',
      output_modalities: ['text'],
    });
    expect(session.audio.input.format).toEqual({ type: 'audio/pcm', rate: 24_000 });
    expect(session.audio.input.turn_detection).toMatchObject({
      type: 'server_vad',
      create_response: false,
      interrupt_response: false,
    });
    expect(session.audio.input.noise_reduction).toEqual({ type: 'far_field' });
    expect(session.audio.input.transcription).toMatchObject({
      model: 'gpt-transcribe',
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

describe("the interviewee's voice", () => {
  const embedding = Array.from({ length: 256 }, (_, i) => Math.sin(i) / 10);

  it('is saved, tuned, replaced and removed', async () => {
    await http.get('/api/v1/live-practice/voice').set(auth()).expect(404);
    await http
      .put('/api/v1/live-practice/voice')
      .set(auth())
      .send({ model: 'x.onnx', embedding: [0.1, 0.2] })
      .expect(400);

    const saved = (
      await http
        .put('/api/v1/live-practice/voice')
        .set(auth())
        .send({ model: 'wespeaker_en_voxceleb_resnet34_LM.onnx', embedding })
        .expect(200)
    ).body;
    expect(saved).toMatchObject({
      model: 'wespeaker_en_voxceleb_resnet34_LM.onnx',
      threshold: 0.5,
    });
    expect(saved.embedding).toHaveLength(256);
    expect(saved.embedding[1]).toBeCloseTo(embedding[1]!, 10);

    const tuned = (
      await http
        .patch('/api/v1/live-practice/voice')
        .set(auth())
        .send({ threshold: 0.62 })
        .expect(200)
    ).body;
    expect(tuned.threshold).toBe(0.62);
    await http
      .patch('/api/v1/live-practice/voice')
      .set(auth())
      .send({ threshold: 1.5 })
      .expect(400);

    const replaced = (
      await http
        .put('/api/v1/live-practice/voice')
        .set(auth())
        .send({ model: 'other.onnx', embedding: embedding.map((x) => -x), threshold: 0.4 })
        .expect(200)
    ).body;
    expect(replaced).toMatchObject({ model: 'other.onnx', threshold: 0.4 });

    await http.delete('/api/v1/live-practice/voice').set(auth()).expect(204);
    await http.get('/api/v1/live-practice/voice').set(auth()).expect(404);
  });
});

describe('the speaker model download', () => {
  it('is public, with a checksum to verify it by', async () => {
    const dir = path.join(app.get(DownloadsService).dir, 'models');
    const file = path.join(dir, `test-${Date.now()}.onnx`);
    await mkdir(dir, { recursive: true });
    await writeFile(file, 'not really a model');
    try {
      const info = (await http.get('/api/v1/downloads/speaker-model').expect(200)).body;
      expect(info).toEqual({
        fileName: path.basename(file),
        sizeBytes: 18,
        // sha256 of "not really a model"
        sha256: '29a6a9f19463c8e9c592d2f06fa009fe46e351b618667e95eac63df77c56f404',
        url: '/api/v1/downloads/speaker-model/file',
      });
      const download = await http.get('/api/v1/downloads/speaker-model/file').expect(200);
      expect(download.headers['content-disposition']).toContain(path.basename(file));
      expect(Buffer.from(download.body as Buffer).toString()).toBe('not really a model');
    } finally {
      await rm(file, { force: true });
    }
  });
});
