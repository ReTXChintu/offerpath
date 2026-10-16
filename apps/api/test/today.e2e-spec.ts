import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@offerpath/database';
import request from 'supertest';

import { AppModule } from '../src/app.module.js';
import { ProblemDetailsFilter } from '../src/common/filters/problem-details.filter.js';

/**
 * The daily plan: one goal, learning and the hunt on one page. The hunt
 * side comes from documents a desktop would sync; no AI is called.
 */

const prisma = new PrismaClient();

let app: INestApplication;
let http: ReturnType<typeof request>;
let accessToken: string;

const user = {
  email: `today-${Date.now()}@offerpath.test`,
  password: 'a-long-enough-password',
  displayName: 'Today Test',
};
const auth = () => ({ Authorization: `Bearer ${accessToken}` });
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ProblemDetailsFilter());
  await app.init();
  http = request(app.getHttpServer());

  const registered = await http.post('/api/v1/auth/register').send(user).expect(201);
  accessToken = registered.body.accessToken;

  // What a desktop would have synced: two strong matches missing Docker,
  // one application to approve, one with questions, one interview ahead.
  const put = (collection: string, id: string, doc: object) =>
    http
      .put(`/api/v1/data/${collection}/${id}`)
      .set(auth())
      .send({ id, ...doc })
      .expect(200);
  await put('jobs', 'j1', {
    title: 'Backend engineer',
    company: 'Acme',
    skills: ['Docker', 'Node.js'],
  });
  await put('jobs', 'j2', { title: 'Platform engineer', company: 'Globex', skills: [] });
  await put('job_analyses', 'a1', {
    jobId: 'j1',
    relevant: true,
    matchScore: 82,
    missingSkills: ['Docker'],
  });
  await put('job_analyses', 'a2', {
    jobId: 'j2',
    relevant: true,
    matchScore: 77,
    missingSkills: ['docker', 'Kafka'],
  });
  await put('applications', 'app1', {
    jobId: 'j1',
    status: 'READY_FOR_REVIEW',
    interviews: [
      {
        id: 'i1',
        scheduledAt: inDays(3),
        mode: 'VIDEO',
        round: 'Technical',
        contact: '',
        notes: '',
        recordedAt: inDays(0),
      },
    ],
  });
  await put('applications', 'app2', {
    jobId: 'j2',
    status: 'WAITING_FOR_USER',
    pendingQuestions: [{ id: 'q1', question: 'Notice period?' }],
  });
}, 120_000);

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: user.email } }).catch(() => undefined);
  await prisma.$disconnect();
  await app?.close();
});

describe('the goal', () => {
  it('is set once and read back, cleaned up', async () => {
    expect((await http.get('/api/v1/goal').set(auth()).expect(200)).body).toEqual({ goal: null });

    const goal = await http
      .put('/api/v1/goal')
      .set(auth())
      .send({
        targetRoles: [' Backend engineer ', 'Backend engineer', 'Platform engineer'],
        targetCompanies: ['Acme'],
        locations: ['Bengaluru', 'Remote'],
        targetDate: '2999-01-31',
      })
      .expect(200);

    expect(goal.body).toMatchObject({
      targetRoles: ['Backend engineer', 'Platform engineer'],
      targetCompanies: ['Acme'],
      targetDate: '2999-01-31',
    });
    expect(goal.body.daysLeft).toBeGreaterThan(0);

    await http.put('/api/v1/goal').set(auth()).send({ targetDate: 'soon' }).expect(400);
  });
});

describe('today', () => {
  it('puts learning, hunt to-dos, interview prep and skill gaps on one plan', async () => {
    const today = (await http.get('/api/v1/today').set(auth()).expect(200)).body;

    expect(today.goal.targetCompanies).toEqual(['Acme']);
    expect(today.learning).toHaveProperty('items');
    expect(today.hunt.todos).toEqual([
      {
        applicationId: 'app2',
        company: 'Globex',
        title: 'Platform engineer',
        action: 'ANSWER',
        questions: 1,
      },
      {
        applicationId: 'app1',
        company: 'Acme',
        title: 'Backend engineer',
        action: 'APPROVE',
        questions: 0,
      },
    ]);
    expect(today.interviews).toHaveLength(1);
    expect(today.interviews[0]).toMatchObject({ applicationId: 'app1', company: 'Acme' });
    expect(today.interviews[0].daysLeft).toBeGreaterThanOrEqual(2);
    expect(today.interviews[0].technologies.map((t: { name: string }) => t.name)).toContain(
      'Docker',
    );

    expect(today.skillGaps[0]).toMatchObject({ skill: 'Docker', jobs: 2, onRoadmap: false });
    expect(today.skillGaps[0].technology.slug).toBe('docker');
    expect(today.desktopOnline).toBe(false);
  });

  it('puts a skill gap on the roadmap', async () => {
    const { gaps } = (await http.get('/api/v1/goal/skill-gaps').set(auth()).expect(200)).body;
    const docker = gaps.find((g: { skill: string }) => g.skill === 'Docker');

    await http
      .post('/api/v1/goal/skill-gaps/add')
      .set(auth())
      .send({ technologyId: docker.technology.id })
      .expect(204);

    const after = (await http.get('/api/v1/goal/skill-gaps').set(auth()).expect(200)).body.gaps;
    expect(after.find((g: { skill: string }) => g.skill === 'Docker').onRoadmap).toBe(true);
  });

  it('starts the day and counts the streak', async () => {
    const started = (await http.post('/api/v1/today/start').set(auth()).expect(200)).body;
    expect(started.startedAt).not.toBeNull();
    expect(started.streak).toBe(1);
  });
});
