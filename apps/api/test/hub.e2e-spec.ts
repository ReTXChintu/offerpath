import type { AddressInfo } from 'node:net';

import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AIUnavailable, type AIProvider, type CliJob } from '@offerpath/ai';
import { PrismaClient } from '@offerpath/database';
import request from 'supertest';
import WebSocket from 'ws';

import { AppModule } from '../src/app.module.js';
import { ProblemDetailsFilter } from '../src/common/filters/problem-details.filter.js';
import { AI_PROVIDER } from '../src/modules/ai/ai.tokens.js';

/**
 * Devices, the hub, AI jobs and sync, end to end, with stand-in devices.
 *
 * A plain WebSocket client plays the desktop (says hello, answers AI jobs
 * with what `claude -p --output-format json` prints, answers relayed
 * requests) and another plays a paired phone. No model is called.
 */

const prisma = new PrismaClient();

let app: INestApplication;
let http: ReturnType<typeof request>;
let ai: AIProvider;
let accessToken: string;
let userId: string;
let hubUrl: string;

const user = {
  email: `hub-${Date.now()}@offerpath.test`,
  password: 'a-long-enough-password',
  displayName: 'Hub Test',
};

const auth = (token = accessToken) => ({ Authorization: `Bearer ${token}` });
const ctx = () => ({ userId, agent: 'hub-e2e', promptVersion: 'v1' });
const prompt = { model: 'fast' as const, messages: [{ role: 'user' as const, content: 'hello' }] };

const claudeEnvelope = (text: string) =>
  JSON.stringify({
    type: 'result',
    is_error: false,
    result: text,
    usage: { input_tokens: 3, output_tokens: 2 },
  });

interface Frame {
  v: 1;
  id: string;
  type: string;
  payload?: unknown;
}

interface FakeDevice {
  socket: WebSocket;
  frames: Frame[];
  closed: Promise<number>;
  next: (type: string, timeoutMs?: number) => Promise<Frame>;
}

async function connect(token: string): Promise<FakeDevice> {
  const socket = new WebSocket(`${hubUrl}?token=${token}`);
  const frames: Frame[] = [];
  const waiters: { type: string; resolve: (f: Frame) => void }[] = [];
  const closed = new Promise<number>((resolve) => socket.on('close', (code) => resolve(code)));
  socket.on('message', (raw) => {
    const frame = JSON.parse(raw.toString()) as Frame;
    frames.push(frame);
    const i = waiters.findIndex((w) => w.type === frame.type);
    if (i >= 0) waiters.splice(i, 1)[0]!.resolve(frame);
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  const next = (type: string, timeoutMs = 5_000) =>
    new Promise<Frame>((resolve, reject) => {
      const seen = frames.findIndex((f) => f.type === type);
      if (seen >= 0) return resolve(frames.splice(seen, 1)[0]!);
      const timer = setTimeout(() => reject(new Error(`no ${type} frame`)), timeoutMs);
      waiters.push({
        type,
        resolve: (f) => {
          clearTimeout(timer);
          frames.splice(frames.indexOf(f), 1);
          resolve(f);
        },
      });
    });
  return { socket, frames, closed, next };
}

/** A desktop that says hello and answers every AI job with `answer(job)`. */
async function connectDesktop(
  token: string,
  answer: (job: CliJob) => string | { fail: string },
  claude = true,
): Promise<FakeDevice & { jobs: CliJob[] }> {
  const device = await connect(token);
  const jobs: CliJob[] = [];
  device.socket.on('message', (raw) => {
    const frame = JSON.parse(raw.toString()) as Frame;
    if (frame.type !== 'ai_job') return;
    const { job } = frame.payload as { job: CliJob };
    jobs.push(job);
    const reply = answer(job);
    device.socket.send(
      JSON.stringify(
        typeof reply === 'string'
          ? {
              v: 1,
              id: frame.id,
              type: 'ai_job_result',
              payload: { outcome: { stdout: reply, stderr: '', code: 0 } },
            }
          : {
              v: 1,
              id: frame.id,
              type: 'ai_job_failed',
              payload: { error: { message: reply.fail } },
            },
      ),
    );
  });
  device.socket.send(
    JSON.stringify({
      v: 1,
      id: 'hello-1',
      type: 'hello',
      payload: { version: '0.1.0', claude: { available: claude, detail: null } },
    }),
  );
  await waitFor(async () => {
    const view = (await http.get('/api/v1/settings/ai').set(auth()).expect(200)).body;
    return view.desktop.online && view.desktop.claudeAvailable === claude;
  });
  return { ...device, jobs };
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('timed out waiting');
}

async function registerDevice(kind: 'desktop' | 'mobile', name: string) {
  return (
    await http
      .post('/api/v1/devices/register')
      .set(auth())
      .send({ name, kind, platform: 'test' })
      .expect(201)
  ).body as { deviceId: string; deviceToken: string };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ProblemDetailsFilter());
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  hubUrl = `ws://127.0.0.1:${port}/api/v1/hub`;
  http = request(app.getHttpServer());
  ai = app.get(AI_PROVIDER);

  const registered = await http.post('/api/v1/auth/register').send(user).expect(201);
  accessToken = registered.body.accessToken;
  userId = registered.body.userId;
  expect(userId).toBeTruthy();
}, 120_000);

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: user.email } }).catch(() => undefined);
  await prisma.$disconnect();
  await app?.close();
});

describe('devices', () => {
  it('issues a device token that works like a sign-in, and stores only its hash', async () => {
    const { deviceId, deviceToken } = await registerDevice('desktop', 'Work laptop');
    expect(deviceToken).toMatch(/^[0-9a-f]{64}$/);

    const stored = await prisma.device.findUniqueOrThrow({ where: { id: deviceId } });
    expect(stored.tokenHash).not.toBe(deviceToken);

    const me = await http.get('/api/v1/auth/me').set(auth(deviceToken)).expect(200);
    expect(me.body.userId).toBe(userId);

    const list = await http.get('/api/v1/devices').set(auth()).expect(200);
    expect(list.body.devices.map((d: { id: string }) => d.id)).toContain(deviceId);

    await http.delete(`/api/v1/devices/${deviceId}`).set(auth()).expect(204);
    await http.get('/api/v1/auth/me').set(auth(deviceToken)).expect(401);
  });

  it('pairs a phone with a one-time code', async () => {
    const { code } = (await http.post('/api/v1/pairing/create').set(auth()).expect(201)).body;
    expect(code).toMatch(/^[2-9A-HJKMNP-Z]{6}$/);

    const paired = await http
      .post('/api/v1/pairing/redeem')
      .send({ code: code.toLowerCase(), name: 'My phone', platform: 'android' })
      .expect(200);
    expect(paired.body.userId).toBe(userId);

    await http.post('/api/v1/pairing/redeem').send({ code, name: 'Again' }).expect(400);

    await http
      .put('/api/v1/devices/me/push-token')
      .set(auth(paired.body.deviceToken))
      .send({ token: 'fcm-token-0123456789' })
      .expect(200);
    const stored = await prisma.device.findUniqueOrThrow({ where: { id: paired.body.deviceId } });
    expect(stored.kind).toBe('MOBILE');
    expect(stored.pushToken).toBe('fcm-token-0123456789');
    // A JWT can't set a push token: it isn't a device.
    await http.put('/api/v1/devices/me/push-token').set(auth()).send({ token: null }).expect(401);
  });
});

describe('the hub', () => {
  it('refuses a socket without a valid device token', async () => {
    const device = await connect('0'.repeat(64));
    expect(await device.closed).toBe(4401);
  });

  it('relays a phone request to the desktop and the reply back, and says when the desktop is away', async () => {
    const desktopIds = await registerDevice('desktop', 'Desk');
    const phoneIds = await registerDevice('mobile', 'Phone');

    const phone = await connect(phoneIds.deviceToken);
    expect((await phone.next('presence')).payload).toMatchObject({ online: false });

    // No desktop: the phone's request is answered for it.
    phone.socket.send(JSON.stringify({ v: 1, id: 'r1', type: 'list_queue', payload: {} }));
    const offline = await phone.next('response');
    expect(offline).toMatchObject({
      id: 'r1',
      payload: { ok: false, error: { code: 'DESKTOP_OFFLINE' } },
    });

    const desktop = await connectDesktop(desktopIds.deviceToken, () => claudeEnvelope('unused'));
    expect((await phone.next('presence')).payload).toMatchObject({ online: true });

    desktop.socket.on('message', (raw) => {
      const frame = JSON.parse(raw.toString()) as Frame;
      if (frame.type !== 'list_queue' && frame.type !== 'approve_application') return;
      desktop.socket.send(
        JSON.stringify({
          v: 1,
          id: frame.id,
          type: 'response',
          payload: { ok: true, data: { echoed: frame.type } },
        }),
      );
    });

    phone.socket.send(JSON.stringify({ v: 1, id: 'r2', type: 'list_queue', payload: {} }));
    expect(await phone.next('response')).toMatchObject({
      id: 'r2',
      payload: { ok: true, data: { echoed: 'list_queue' } },
    });

    // The web app's way in: an HTTP request relayed the same way.
    const viaWeb = await http
      .post('/api/v1/desktop/request')
      .set(auth())
      .send({ type: 'approve_application', payload: { id: 'a1' } })
      .expect(201);
    expect(viaWeb.body).toEqual({ data: { echoed: 'approve_application' } });

    desktop.socket.close();
    expect((await phone.next('presence')).payload).toMatchObject({ online: false });
    const away = await http
      .post('/api/v1/desktop/request')
      .set(auth())
      .send({ type: 'list_queue' });
    expect(away.status).toBe(503);
    phone.socket.close();
  });
});

describe('AI jobs on the desktop', () => {
  it('runs a call as a job on the desktop and records it', async () => {
    const { deviceToken, deviceId } = await registerDevice('desktop', 'AI desk');
    await http.put('/api/v1/settings/ai').set(auth()).send({ fast: 'haiku' }).expect(200);
    const desktop = await connectDesktop(deviceToken, () => claudeEnvelope('hi from Claude'));

    const result = await ai.generate({ prompt, context: ctx() });

    expect(result.text).toBe('hi from Claude');
    expect(desktop.jobs[0]).toMatchObject({
      tool: 'CLAUDE_CODE',
      conversation: 'hello',
      model: 'haiku',
    });
    const job = await prisma.aiJob.findFirstOrThrow({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    expect(job).toMatchObject({ status: 'SUCCEEDED', deviceId, agent: 'hub-e2e', model: 'haiku' });

    desktop.socket.close();
    await desktop.closed;
  });

  it('passes on a failure the desktop reports', async () => {
    const { deviceToken } = await registerDevice('desktop', 'Failing desk');
    const desktop = await connectDesktop(deviceToken, () => ({ fail: 'Not logged in to Claude' }));

    const error = await ai.generate({ prompt, context: ctx() }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AIUnavailable);
    expect(String((error as AIUnavailable).cause)).toContain('Not logged in to Claude');

    desktop.socket.close();
    await desktop.closed;
  });

  it('fails at once, with a reason, when no desktop is online', async () => {
    await waitFor(
      async () => !(await http.get('/api/v1/settings/ai').set(auth())).body.desktop.online,
    );

    const error = await ai.generate({ prompt, context: ctx() }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AIUnavailable);
    expect(String((error as AIUnavailable).cause)).toContain('desktop is not online');
    const job = await prisma.aiJob.findFirstOrThrow({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    expect(job.status).toBe('FAILED');
  });
});

describe('sync', () => {
  it('stores, lists and deletes the desktop’s documents, telling the phones', async () => {
    const phoneIds = await registerDevice('mobile', 'Sync phone');
    const phone = await connect(phoneIds.deviceToken);
    await phone.next('presence');

    const job = {
      id: 'job-1',
      title: 'Engineer',
      company: 'Acme',
      status: 'NEW',
      updatedAt: '2026-10-01T10:00:00.123456789Z',
    };
    await http.put('/api/v1/data/jobs/job-1').set(auth()).send(job).expect(200);
    expect((await phone.next('changed')).payload).toEqual({ collections: ['jobs'] });

    const application = {
      id: 'app-1',
      jobId: 'job-1',
      status: 'READY',
      interviews: [
        {
          id: 'i1',
          scheduledAt: '2999-01-01T09:00:00Z',
          mode: 'VIDEO',
          round: 'HR',
          contact: '',
          notes: '',
          recordedAt: '2026-10-01T10:00:00Z',
        },
      ],
    };
    await http.put('/api/v1/data/applications/app-1').set(auth()).send(application).expect(200);

    const docs = await http.get('/api/v1/data/jobs').set(auth()).expect(200);
    expect(docs.body.documents).toEqual([{ ...job, userId }]);

    const items = await http.get('/api/v1/applications').set(auth()).expect(200);
    expect(items.body).toHaveLength(1);
    expect(items.body[0].job.title).toBe('Engineer');
    const upcoming = await http.get('/api/v1/hunt/interviews/upcoming').set(auth()).expect(200);
    expect(upcoming.body.interviews[0]).toMatchObject({ applicationId: 'app-1', company: 'Acme' });

    await http
      .put('/api/v1/data/notifications/n1')
      .set(auth())
      .send({
        id: 'n1',
        title: 'Approval needed',
        body: 'Acme',
        read: false,
        kind: 'APPROVAL',
        level: 'info',
        createdAt: '2026-10-01T10:00:00Z',
      })
      .expect(200);
    expect((await phone.next('notification')).payload).toMatchObject({
      id: 'n1',
      title: 'Approval needed',
    });

    await http.delete('/api/v1/data/jobs/job-1').set(auth()).expect(200);
    expect((await http.get('/api/v1/data/jobs').set(auth())).body.documents).toEqual([]);
    const row = await prisma.syncDocument.findUniqueOrThrow({
      where: { userId_collection_id: { userId, collection: 'jobs', id: 'job-1' } },
    });
    expect(row.deletedAt).not.toBeNull();

    await http.put('/api/v1/data/not_a_collection/x').set(auth()).send({}).expect(400);
    phone.socket.close();
  });
});
