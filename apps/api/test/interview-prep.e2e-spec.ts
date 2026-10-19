import type { AddressInfo } from 'node:net';

import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FakeAIProvider, type CliJob } from '@offerpath/ai';
import { PrismaClient } from '@offerpath/database';
import request from 'supertest';
import WebSocket from 'ws';

import { AppModule } from '../src/app.module.js';
import { ProblemDetailsFilter } from '../src/common/filters/problem-details.filter.js';
import { AiFallbackService } from '../src/modules/settings/application/ai-fallback.service.js';

/**
 * Interview prep: the plan and questions come from the desktop's Claude when
 * it is online, from the user's OpenAI key when it is not (a fake provider
 * stands in here: no key, no model), and from nowhere otherwise. The phone
 * hears when a prep is ready.
 */

const prisma = new PrismaClient();

let app: INestApplication;
let http: ReturnType<typeof request>;
let hubUrl: string;
let accessToken: string;
let fallback: AiFallbackService;

const user = {
  email: `prep-${Date.now()}@offerpath.test`,
  password: 'a-long-enough-password',
  displayName: 'Prep Test',
};
const auth = () => ({ Authorization: `Bearer ${accessToken}` });
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

const PLAN = {
  summary: 'A backend role on Node.js and PostgreSQL; expect depth on both.',
  focusAreas: [{ topic: 'PostgreSQL', why: 'Named twice in the JD', priority: 1 }],
  schedule: [{ day: 1, focus: 'Indexes and transactions' }],
  questions: [
    {
      kind: 'TECHNICAL',
      topic: 'PostgreSQL',
      question: 'When does an index make a query slower?',
      keyPoints: ['Writes pay for every index', 'Low-selectivity columns'],
      difficulty: 3,
    },
    {
      kind: 'TECHNICAL',
      topic: 'Node.js',
      question: 'What blocks the event loop, and how do you find it?',
      keyPoints: ['CPU-bound work on the main thread', 'Profiling / event-loop lag'],
      difficulty: 3,
    },
    {
      kind: 'SYSTEM_DESIGN',
      topic: 'Queues',
      question: 'Design a job queue that survives a worker crash.',
      keyPoints: ['Visibility timeout / acks', 'Idempotent handlers'],
      difficulty: 4,
    },
    {
      kind: 'BEHAVIORAL',
      topic: 'Ownership',
      question: 'Tell me about an incident you owned end to end.',
      keyPoints: ['Situation and impact', 'What changed afterwards'],
      difficulty: 2,
    },
  ],
};
const GRADE = {
  score: 6,
  covered: ['Writes pay for every index'],
  missed: ['Low-selectivity columns'],
  feedback: 'Good on write cost; add when the planner skips a low-selectivity index.',
};

/** What `claude -p --output-format json --json-schema` prints. */
const envelope = (data: unknown) =>
  JSON.stringify({
    type: 'result',
    is_error: false,
    structured_output: data,
    usage: { input_tokens: 3, output_tokens: 2 },
  });

interface Frame {
  v: 1;
  id: string;
  type: string;
  payload?: unknown;
}

async function connect(token: string, onFrame: (f: Frame, ws: WebSocket) => void) {
  const ws = new WebSocket(`${hubUrl}?token=${token}`);
  ws.on('message', (raw) => onFrame(JSON.parse(raw.toString()) as Frame, ws));
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return ws;
}

async function device(kind: 'desktop' | 'mobile') {
  return (
    await http
      .post('/api/v1/devices/register')
      .set(auth())
      .send({ name: kind, kind, platform: 'test' })
      .expect(201)
  ).body.deviceToken as string;
}

async function waitFor<T>(check: () => Promise<T | undefined>, ms = 10_000): Promise<T> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const value = await check();
    if (value !== undefined) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('timed out');
}

const prepStatus = (id: string) => async () => {
  const prep = (await http.get(`/api/v1/interview-preps/${id}`).set(auth())).body;
  return prep.status === 'GENERATING' ? undefined : prep;
};

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ProblemDetailsFilter());
  await app.listen(0, '127.0.0.1');
  hubUrl = `ws://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1/hub`;
  http = request(app.getHttpServer());
  fallback = app.get(AiFallbackService);
  accessToken = (await http.post('/api/v1/auth/register').send(user).expect(201)).body.accessToken;
}, 120_000);

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: user.email } }).catch(() => undefined);
  await prisma.$disconnect();
  await app?.close();
});

describe('creating a prep', () => {
  it('needs a job description or technologies', async () => {
    await http
      .post('/api/v1/interview-preps')
      .set(auth())
      .send({ company: 'Acme', scheduledAt: inDays(3) })
      .expect(400);
  });

  it('with no desktop and no fallback key, waits and says why', async () => {
    const created = await http
      .post('/api/v1/interview-preps')
      .set(auth())
      .send({ technologies: ['PostgreSQL'], scheduledAt: inDays(3) })
      .expect(201);
    expect((await http.get('/api/v1/interview-preps/ai').set(auth())).body).toEqual({
      source: null,
    });

    const prep = await waitFor(prepStatus(created.body.id));
    expect(prep.status).toBe('FAILED');
    expect(prep.error).toContain('laptop is offline');
  });
});

describe('on the desktop', () => {
  it('writes the plan with Claude, tells the phone, then grades an answer', async () => {
    const jobs: CliJob[] = [];
    const desktop = await connect(await device('desktop'), (frame, ws) => {
      if (frame.type !== 'ai_job') return;
      const { job } = frame.payload as { job: CliJob };
      jobs.push(job);
      const data = job.conversation.includes('Answer:') ? GRADE : PLAN;
      ws.send(
        JSON.stringify({
          v: 1,
          id: frame.id,
          type: 'ai_job_result',
          payload: { outcome: { stdout: envelope(data), stderr: '', code: 0 } },
        }),
      );
    });
    desktop.send(
      JSON.stringify({
        v: 1,
        id: 'h',
        type: 'hello',
        payload: { version: '0.1.0', claude: { available: true, detail: null } },
      }),
    );
    const phoneFrames: Frame[] = [];
    const phone = await connect(await device('mobile'), (f) => phoneFrames.push(f));
    try {
      await waitFor(async () =>
        (await http.get('/api/v1/interview-preps/ai').set(auth())).body.source === 'desktop'
          ? true
          : undefined,
      );

      // The prep that was waiting for a desktop starts by itself now.
      const waiting = (await http.get('/api/v1/interview-preps').set(auth())).body.preps[0];
      expect((await waitFor(prepStatus(waiting.id))).status).toBe('READY');

      const created = await http
        .post('/api/v1/interview-preps')
        .set(auth())
        .send({
          company: 'Acme',
          role: 'Backend engineer',
          jobDescription: 'Node.js, PostgreSQL, queues. Own services end to end.',
          technologies: ['Node.js', 'PostgreSQL'],
          scheduledAt: inDays(2),
        })
        .expect(201);
      expect(created.body.status).toBe('GENERATING');

      const prep = await waitFor(prepStatus(created.body.id));
      expect(prep).toMatchObject({ status: 'READY', generatedBy: 'desktop' });
      expect(prep.plan.summary).toContain('backend role');
      expect(prep.questions).toHaveLength(4);
      // Key points stay hidden until the question has been answered.
      expect(prep.questions[0].keyPoints).toBeNull();
      const acme = jobs.find((j) => j.conversation.includes('Company: Acme'));
      expect(acme).toMatchObject({ tool: 'CLAUDE_CODE' });

      const ready = await waitFor(async () =>
        phoneFrames.find(
          (f) =>
            f.type === 'notification' &&
            (f.payload as { linkId?: string }).linkId === created.body.id,
        ),
      );
      expect(ready.payload).toMatchObject({
        kind: 'INTERVIEW_PREP_READY',
        linkPage: 'interview-prep',
        linkId: created.body.id,
      });

      const graded = await http
        .post(`/api/v1/interview-preps/${created.body.id}/questions/${prep.questions[0].id}/answer`)
        .set(auth())
        .send({ answer: 'Every write has to update every index on the table.' })
        .expect(200);
      expect(graded.body).toMatchObject({
        score: 6,
        feedback: { covered: GRADE.covered, missed: GRADE.missed, feedback: GRADE.feedback },
      });
      expect(graded.body.keyPoints).toEqual(PLAN.questions[0]!.keyPoints);

      const after = (await http.get(`/api/v1/interview-preps/${created.body.id}`).set(auth())).body;
      expect(after.progress).toEqual({ answered: 1, total: 4, averageScore: 6 });
    } finally {
      desktop.close();
      phone.close();
    }
    await waitFor(async () =>
      (await http.get('/api/v1/interview-preps/ai').set(auth())).body.source === null
        ? true
        : undefined,
    );
  });
});

describe('the OpenAI fallback', () => {
  it('needs ENCRYPTION_KEY on the server to save a key', async () => {
    const view = (await http.get('/api/v1/settings/ai/fallback').set(auth()).expect(200)).body;
    expect(view).toMatchObject({ configured: false, last4: null });
    if (!view.available) {
      await http
        .put('/api/v1/settings/ai/fallback')
        .set(auth())
        .send({ apiKey: 'sk-test-0123456789abcdefghij' })
        .expect(400);
    }
  });

  it('writes the plan when the desktop is offline', async () => {
    const fake = new FakeAIProvider([{ data: PLAN }]);
    jest.spyOn(fallback, 'providerFor').mockResolvedValue(fake as never);

    const created = await http
      .post('/api/v1/interview-preps')
      .set(auth())
      .send({ technologies: ['PostgreSQL'], scheduledAt: inDays(1) })
      .expect(201);

    const prep = await waitFor(prepStatus(created.body.id));
    expect(prep).toMatchObject({ status: 'READY', generatedBy: 'openai' });
    expect(fake.calls[0]).toMatchObject({ agent: 'interview-prep' });
  });

  it('answers 503 for grading when there is no AI at all', async () => {
    const prep = (await http.get('/api/v1/interview-preps').set(auth())).body.preps.find(
      (p: { status: string }) => p.status === 'READY',
    );
    await http
      .post(`/api/v1/interview-preps/${prep.id}/questions/${prep.questions[1].id}/answer`)
      .set(auth())
      .send({ answer: 'Profiling.' })
      .expect(503);
  });
});
