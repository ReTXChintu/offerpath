import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@offerpath/database';
import request from 'supertest';

import { AppModule } from '../src/app.module.js';
import { ProblemDetailsFilter } from '../src/common/filters/problem-details.filter.js';
import { CloudinaryClient } from '../src/modules/portfolio/infrastructure/cloudinary.js';
import { SyncService } from '../src/modules/sync/application/sync.service.js';

/**
 * Portfolios (docs/portfolio.md): content edited in Offerpath, drafts from
 * the synced profile, and the public API a portfolio site reads, in the
 * `{ ok, ... }` envelope and shapes the old admin served.
 */

jest.setTimeout(240_000);

// Cloudinary secrets are stored encrypted; the config is read when the app starts below.
process.env.ENCRYPTION_KEY ||= 'e2e-encryption-key-not-a-secret';

const prisma = new PrismaClient();

let app: INestApplication;
let http: ReturnType<typeof request>;
let token: string;
let userId: string;
let otherToken: string;

const stamp = Date.now();
const users = {
  owner: {
    email: `pf-${stamp}@offerpath.test`,
    password: 'a-long-enough-password',
    displayName: 'Ada',
  },
  other: {
    email: `pf2-${stamp}@offerpath.test`,
    password: 'a-long-enough-password',
    displayName: 'Bob',
  },
};
const handle = `pf-${stamp}`;
const auth = () => ({ Authorization: `Bearer ${token}` });
const site = async () =>
  (await http.get(`/api/v1/public/portfolio/${handle}/site`).expect(200)).body.data;

async function waitFor<T>(check: () => Promise<T | undefined>, ms = 60_000): Promise<T> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const value = await check();
    if (value !== undefined) return value;
    await new Promise((r) => setTimeout(r, 300));
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
  token = (await http.post('/api/v1/auth/register').send(users.owner).expect(201)).body.accessToken;
  otherToken = (await http.post('/api/v1/auth/register').send(users.other).expect(201)).body
    .accessToken;
  userId = (await prisma.user.findUniqueOrThrow({ where: { email: users.owner.email } })).id;

  // The desktop's synced profile.
  const now = new Date();
  await prisma.syncDocument.createMany({
    data: [
      {
        userId,
        collection: 'candidate_profiles',
        id: 'profile-1',
        updatedAt: now,
        doc: { skills: { frontend: ['React', 'TypeScript'], backend: ['Node.js'], devops: [] } },
      },
      {
        userId,
        collection: 'projects',
        id: 'proj-ledger',
        updatedAt: now,
        doc: {
          name: 'Ledger',
          description: 'A double-entry ledger for payments.',
          technologies: ['PostgreSQL', 'Go'],
          url: 'https://github.com/ada/ledger',
        },
      },
      {
        userId,
        collection: 'experiences',
        id: 'exp-1',
        updatedAt: now,
        doc: {
          role: 'Senior engineer',
          company: 'Paysafe',
          startDate: '2021-01',
          endDate: null,
          achievements: ['Owned the ledger'],
        },
      },
    ],
  });
}, 120_000);

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  await prisma.user
    .deleteMany({ where: { email: { in: [users.owner.email, users.other.email] } } })
    .catch(() => undefined);
  await prisma.$disconnect();
  await app?.close();
});

describe('setting up', () => {
  it('starts with no portfolio and refuses a bad handle', async () => {
    await http.get('/api/v1/portfolio').set(auth()).expect(404);
    await http.post('/api/v1/portfolio').set(auth()).send({ handle: 'No Spaces!' }).expect(400);
  });

  it('creates one, with the profile as drafts', async () => {
    const view = (await http.post('/api/v1/portfolio').set(auth()).send({ handle }).expect(201))
      .body;
    expect(view).toMatchObject({
      handle,
      publicUrl: `/api/v1/public/portfolio/${handle}/site`,
      cloudinary: { configured: false },
      counts: { projects: 1, skills: 2, experience: 1, drafts: 4, unreadMessages: 0 },
    });

    const projects = (await http.get('/api/v1/portfolio/projects').set(auth()).expect(200)).body
      .items;
    expect(projects[0]).toMatchObject({
      title: 'Ledger',
      desc: 'A double-entry ledger for payments.',
      tags: ['PostgreSQL', 'Go'],
      githubUrl: 'https://github.com/ada/ledger',
      liveUrl: '',
      imageUrl: null,
      published: false,
      followsSource: true,
      source: { collection: 'projects', id: 'proj-ledger' },
    });
    expect(projects[0].accent).toMatch(/^#[0-9a-f]{6}$/);

    const skills = (await http.get('/api/v1/portfolio/skills').set(auth())).body.items;
    expect(skills.map((s: { cat: string }) => s.cat)).toEqual(['Frontend', 'Backend']);
    const experience = (await http.get('/api/v1/portfolio/experience').set(auth())).body.items;
    expect(experience[0]).toMatchObject({
      period: 'Jan 2021 – Present',
      bullets: ['Owned the ledger'],
    });

    // Drafts aren't public.
    expect(await site()).toMatchObject({ projects: [], skills: [], experience: [] });
  });

  it('keeps handles unique across users', async () => {
    await http
      .post('/api/v1/portfolio')
      .set({ Authorization: `Bearer ${otherToken}` })
      .send({ handle })
      .expect(409);
  });
});

describe('editing and publishing', () => {
  it('needs an image before a project is published, then shows it at once', async () => {
    const [ledger] = (await http.get('/api/v1/portfolio/projects').set(auth())).body.items;
    await http
      .patch(`/api/v1/portfolio/projects/${ledger.id}`)
      .set(auth())
      .send({ published: true })
      .expect(400);
    await http
      .patch(`/api/v1/portfolio/projects/${ledger.id}`)
      .set(auth())
      .send({
        imageUrl: 'https://res.cloudinary.com/x/ledger.png',
        published: true,
        accent: '#FF0000',
      })
      .expect(200);
    await http
      .patch(`/api/v1/portfolio/projects/${ledger.id}`)
      .set(auth())
      .send({ accent: 'red' })
      .expect(400);

    const data = await site();
    expect(data.projects).toEqual([
      {
        _id: ledger.id,
        title: 'Ledger',
        desc: 'A double-entry ledger for payments.',
        tags: ['PostgreSQL', 'Go'],
        accent: '#ff0000',
        gradientFrom: ledger.gradientFrom,
        gradientTo: ledger.gradientTo,
        imageUrl: 'https://res.cloudinary.com/x/ledger.png',
        liveUrl: '',
        githubUrl: 'https://github.com/ada/ledger',
        domain: '',
      },
    ]);
  });

  it('follows the profile until its text is edited, and re-links', async () => {
    const sync = app.get(SyncService);
    await sync.upsert(userId, 'projects', 'proj-ledger', {
      name: 'Ledger v2',
      description: 'A double-entry ledger for payments, now multi-currency.',
      technologies: ['PostgreSQL', 'Go'],
      url: 'https://github.com/ada/ledger',
    });
    const refreshed = await waitFor(async () => {
      const [p] = (await http.get('/api/v1/portfolio/projects').set(auth())).body.items;
      return p.title === 'Ledger v2' ? p : undefined;
    });
    // Its presentation stayed.
    expect(refreshed).toMatchObject({ published: true, accent: '#ff0000' });
    expect((await site()).projects[0].title).toBe('Ledger v2');

    const edited = (
      await http
        .patch(`/api/v1/portfolio/projects/${refreshed.id}`)
        .set(auth())
        .send({ title: 'The Ledger' })
        .expect(200)
    ).body;
    expect(edited.followsSource).toBe(false);
    await http.post('/api/v1/portfolio/import-profile').set(auth()).expect(200);
    expect((await http.get('/api/v1/portfolio/projects').set(auth())).body.items[0].title).toBe(
      'The Ledger',
    );

    const relinked = (
      await http
        .patch(`/api/v1/portfolio/projects/${refreshed.id}`)
        .set(auth())
        .send({ followsSource: true })
        .expect(200)
    ).body;
    expect(relinked).toMatchObject({ followsSource: true, title: 'Ledger v2' });
  });

  it('brings new profile items in as drafts, but never one the user deleted', async () => {
    const sync = app.get(SyncService);
    await sync.upsert(userId, 'projects', 'proj-chat', {
      name: 'Chat',
      description: 'A realtime chat app.',
      technologies: ['WebSockets'],
      url: 'https://chat.example.com',
    });
    const chat = await waitFor(async () => {
      const items = (await http.get('/api/v1/portfolio/projects').set(auth())).body.items;
      return items.find((p: { title: string }) => p.title === 'Chat');
    });
    expect(chat).toMatchObject({ published: false, liveUrl: 'https://chat.example.com', order: 1 });

    await http.delete(`/api/v1/portfolio/projects/${chat.id}`).set(auth()).expect(204);
    const again = (await http.post('/api/v1/portfolio/import-profile').set(auth()).expect(200))
      .body;
    expect(again.created).toBe(0);
  });

  it('publishes skills and experience, reorders, and makes unique tool slugs', async () => {
    const skills = (await http.get('/api/v1/portfolio/skills').set(auth())).body.items;
    for (const s of skills) {
      await http.patch(`/api/v1/portfolio/skills/${s.id}`).set(auth()).send({ published: true });
    }
    const reordered = (
      await http
        .post('/api/v1/portfolio/skills/reorder')
        .set(auth())
        .send({ ids: [skills[1].id, skills[0].id] })
        .expect(200)
    ).body.items;
    expect(reordered.map((s: { cat: string }) => s.cat)).toEqual(['Backend', 'Frontend']);
    await http
      .post('/api/v1/portfolio/skills/reorder')
      .set(auth())
      .send({ ids: [skills[0].id] })
      .expect(400);

    const [exp] = (await http.get('/api/v1/portfolio/experience').set(auth())).body.items;
    await http
      .patch(`/api/v1/portfolio/experience/${exp.id}`)
      .set(auth())
      .send({ published: true });

    const tool = {
      title: 'CRUD Generator',
      shortDescription: 'Generates CRUD for mongoose models.',
      published: true,
    };
    const first = (
      await http.post('/api/v1/portfolio/developer-tools').set(auth()).send(tool).expect(201)
    ).body;
    const second = (
      await http.post('/api/v1/portfolio/developer-tools').set(auth()).send(tool).expect(201)
    ).body;
    expect([first.slug, second.slug]).toEqual(['crud-generator', 'crud-generator-2']);
    await http
      .post('/api/v1/portfolio/developer-tools')
      .set(auth())
      .send({ title: 'X' })
      .expect(400);

    const data = await site();
    expect(data.skills.map((s: { cat: string }) => s.cat)).toEqual(['Backend', 'Frontend']);
    expect(data.experience).toEqual([
      {
        _id: exp.id,
        title: 'Senior engineer',
        company: 'Paysafe',
        period: 'Jan 2021 – Present',
        bullets: ['Owned the ledger'],
      },
    ]);
    expect(data.developerTools.map((t: { slug: string }) => t.slug)).toEqual([
      'crud-generator',
      'crud-generator-2',
    ]);
    expect(data.developerTools[0]).toMatchObject({
      featured: false,
      published: true,
      sortOrder: 0,
      npmUrl: '',
    });
  });

  it('saves the site settings, with the defaults a site relies on', async () => {
    await http
      .patch('/api/v1/portfolio')
      .set(auth())
      .send({
        settings: {
          heroName: 'Ada Lovelace',
          heroEyebrow: 'Full Stack Developer',
          aboutParagraphs: ['First.', 'Second.'],
          socials: { github: 'https://github.com/ada' },
        },
      })
      .expect(200);
    expect((await site()).settings).toEqual({
      heroName: 'Ada Lovelace',
      heroEyebrow: 'Full Stack Developer',
      roles: ['Full Stack Developer'],
      heroBio: '',
      resumeUrl: '#',
      aboutHeadline: '',
      aboutParagraphs: ['First.', 'Second.'],
      socials: { github: 'https://github.com/ada', linkedin: '#', twitter: '#', email: '#' },
    });
  });
});

describe('Cloudinary', () => {
  it('checks the credentials, keeps the secret, and uploads to the account', async () => {
    const upload = jest
      .spyOn(CloudinaryClient.prototype, 'upload')
      .mockResolvedValue('https://res.cloudinary.com/demo/image/upload/portfolio/x.png');
    const account = { cloudName: 'demo', apiKey: '123456789012', apiSecret: 'shh-secret' };

    // Nothing to upload to yet.
    await http
      .post('/api/v1/portfolio/uploads')
      .set(auth())
      .send({ fileName: 'x.png', contentBase64: Buffer.from('png').toString('base64') })
      .expect(400);

    // Cloudinary refuses: nothing is saved.
    jest.spyOn(CloudinaryClient.prototype, 'check').mockRejectedValueOnce(new Error('refused'));
    await http.put('/api/v1/portfolio/cloudinary').set(auth()).send(account).expect(400);

    const check = jest.spyOn(CloudinaryClient.prototype, 'check').mockResolvedValue();
    const saved = await http.put('/api/v1/portfolio/cloudinary').set(auth()).send(account);
    expect(saved.status).toBe(200);
    expect(saved.body.cloudinary).toEqual({
      configured: true,
      cloudName: 'demo',
      apiKeyLast4: '9012',
    });
    expect(check).toHaveBeenCalledWith({
      cloudName: 'demo',
      apiKey: '123456789012',
      apiSecret: 'shh-secret',
    });
    const row = await prisma.portfolio.findUniqueOrThrow({ where: { userId } });
    expect(row.cloudinarySecret).not.toContain('shh-secret');

    const uploaded = await http
      .post('/api/v1/portfolio/uploads')
      .set(auth())
      .send({ fileName: 'mock.PNG', contentBase64: Buffer.from('png bytes').toString('base64') })
      .expect(200);
    expect(uploaded.body).toEqual({
      url: 'https://res.cloudinary.com/demo/image/upload/portfolio/x.png',
    });
    expect(upload).toHaveBeenCalledWith(
      { cloudName: 'demo', apiKey: '123456789012', apiSecret: 'shh-secret' },
      { bytes: Buffer.from('png bytes'), mime: 'image/png' },
      'portfolio',
    );
    await http
      .post('/api/v1/portfolio/uploads')
      .set(auth())
      .send({ fileName: 'doc.pdf', contentBase64: 'eA==' })
      .expect(400);
  });
});

describe('the public contact form', () => {
  const contact = (body: object, ip = '203.0.113.7') =>
    http
      .post(`/api/v1/public/portfolio/${handle}/contact`)
      .set('x-nf-client-connection-ip', ip)
      .send(body);
  const valid = {
    name: 'Grace',
    email: 'Grace@Example.com',
    message: 'Loved your ledger project!',
  };

  it('saves a message to the inbox, in the envelope', async () => {
    expect((await contact(valid).expect(200)).body).toEqual({ ok: true });
    const inbox = (await http.get('/api/v1/portfolio/messages').set(auth()).expect(200)).body.items;
    expect(inbox[0]).toMatchObject({ name: 'Grace', email: 'grace@example.com', read: false });
    const read = (
      await http
        .patch(`/api/v1/portfolio/messages/${inbox[0].id}`)
        .set(auth())
        .send({ read: true })
        .expect(200)
    ).body;
    expect(read.read).toBe(true);
  });

  it('answers invalid input, unknown portfolios and bots in the envelope', async () => {
    expect((await contact({ ...valid, email: 'nope' }).expect(400)).body).toEqual({
      ok: false,
      error: 'Enter a valid email',
    });
    expect(
      (await http.get('/api/v1/public/portfolio/no-such-portfolio/site').expect(404)).body,
    ).toEqual({ ok: false, error: 'Portfolio not found' });
    const before = (await http.get('/api/v1/portfolio/messages').set(auth())).body.items.length;
    expect((await contact({ ...valid, website: 'http://spam' }).expect(200)).body).toEqual({
      ok: true,
    });
    expect((await http.get('/api/v1/portfolio/messages').set(auth())).body.items).toHaveLength(
      before,
    );
  });

  it('limits each visitor to five messages an hour', async () => {
    for (let i = 0; i < 5; i++) await contact(valid, '198.51.100.9').expect(200);
    expect((await contact(valid, '198.51.100.9').expect(429)).body.ok).toBe(false);
    await contact(valid, '198.51.100.10').expect(200);
  });
});
