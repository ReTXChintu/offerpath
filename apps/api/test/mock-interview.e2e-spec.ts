import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FakeAIProvider } from '@offerpath/ai';
import { PrismaClient } from '@offerpath/database';
import request from 'supertest';

import { AppModule } from '../src/app.module.js';
import { ProblemDetailsFilter } from '../src/common/filters/problem-details.filter.js';
import { AiFallbackService } from '../src/modules/settings/application/ai-fallback.service.js';

/**
 * Mock interviews (docs/mock-interview.md) and what they read: the CV (an
 * upload, pasted text or the synced profile) and the DSA choice. The AI is
 * the user's fallback provider, faked: one canned answer per step.
 */

// Generous: a sleeping Neon branch over a slow link answers in seconds, not milliseconds.
jest.setTimeout(240_000);

const prisma = new PrismaClient();

let app: INestApplication;
let http: ReturnType<typeof request>;
let accessToken: string;
let userId: string;
let fallback: AiFallbackService;

const user = {
  email: `mock-${Date.now()}@offerpath.test`,
  password: 'a-long-enough-password',
  displayName: 'Mock Test',
};
const auth = () => ({ Authorization: `Bearer ${accessToken}` });
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

const CV = 'Jane Doe. Senior backend engineer, 6 years. Built a payments ledger on PostgreSQL.';

const PLAN = {
  summary: 'A backend role on Node.js and PostgreSQL; expect depth on both.',
  focusAreas: [{ topic: 'PostgreSQL', why: 'Named twice in the JD', priority: 1 }],
  schedule: [{ day: 1, focus: 'Indexes and transactions' }],
  questions: [
    {
      kind: 'DSA',
      topic: 'Arrays',
      question: 'Find two numbers in an array that add up to a target.',
      keyPoints: ['Hash map of seen values', 'O(n) time'],
      difficulty: 2,
    },
  ],
};

const turn = (next: Record<string, unknown>, language?: unknown, verdict = 'PARTIAL') => ({
  language: language ?? { ok: true, corrections: [] },
  assessment: { verdict, note: 'Covered the basics, missed the trade-offs.' },
  next: { problem: null, ...next },
});

const REPORT = {
  overallScore: 6.4,
  verdict: 'LEAN_HIRE',
  summary: 'Solid on PostgreSQL basics, shaky on isolation levels.',
  dimensions: [
    { name: 'TECHNICAL_DEPTH', score: 6, comment: 'Knows indexes; not isolation.' },
    { name: 'LANGUAGE', score: 7, comment: 'Clear, a few article slips.' },
  ],
  questions: [
    {
      turnOrder: 0,
      question: 'Introduce yourself.',
      answerSummary: 'Six years of backend work, a payments ledger.',
      score: 7,
      wentWell: 'Concrete project.',
      couldBeBetter: 'Say what you owned.',
      strongerAnswer: 'Lead with the ledger and its scale.',
    },
    {
      turnOrder: 99,
      question: 'A question that was never asked.',
      answerSummary: '-',
      score: 0,
      wentWell: '',
      couldBeBetter: '',
      strongerAnswer: 'Dropped: no such turn.',
    },
  ],
  language: {
    score: 7,
    patterns: ['Missing articles: "I built ledger"'],
    note: 'Read answers back.',
  },
  strengths: ['Concrete examples'],
  improvements: ['Isolation levels'],
  nextSteps: ['Practise explaining MVCC'],
};

/** The next AI call (and only it) goes to this fake. */
function useFake(...responses: { data: unknown; when?: RegExp }[]): FakeAIProvider {
  const fake = new FakeAIProvider(responses);
  jest.spyOn(fallback, 'providerFor').mockResolvedValue(fake as never);
  return fake;
}

async function waitFor<T>(check: () => Promise<T | undefined>, ms = 120_000): Promise<T> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const value = await check();
    if (value !== undefined) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('timed out');
}

/** A one-page PDF with one line of text, xref offsets and all. */
function minimalPdf(text: string): Buffer {
  const content = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ProblemDetailsFilter());
  await app.init();
  http = request(app.getHttpServer());
  fallback = app.get(AiFallbackService);
  const registered = await http.post('/api/v1/auth/register').send(user).expect(201);
  accessToken = registered.body.accessToken;
  userId = (await prisma.user.findUniqueOrThrow({ where: { email: user.email } })).id;
}, 120_000);

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: user.email } }).catch(() => undefined);
  await prisma.$disconnect();
  await app?.close();
});

describe('the CV', () => {
  it('comes out of a PDF or a text file, and refuses other files', async () => {
    const pdf = await http
      .post('/api/v1/interview-preps/cv/extract')
      .set(auth())
      .send({
        fileName: 'jane.pdf',
        contentBase64: minimalPdf(
          'Jane Doe - Senior backend engineer, Node.js and PostgreSQL',
        ).toString('base64'),
      })
      .expect(200);
    expect(pdf.body.text).toBe('Jane Doe - Senior backend engineer, Node.js and PostgreSQL');
    expect(pdf.body).toMatchObject({ fileName: 'jane.pdf', chars: pdf.body.text.length });

    const txt = await http
      .post('/api/v1/interview-preps/cv/extract')
      .set(auth())
      .send({
        fileName: 'cv.txt',
        contentBase64: Buffer.from(`  ${CV}\r\n\r\n\r\n`).toString('base64'),
      })
      .expect(200);
    expect(txt.body.text).toBe(CV);

    await http
      .post('/api/v1/interview-preps/cv/extract')
      .set(auth())
      .send({ fileName: 'cv.png', contentBase64: Buffer.from('not a cv').toString('base64') })
      .expect(400);
  });

  it('is written from the synced profile, without contact details', async () => {
    expect((await http.get('/api/v1/interview-preps/cv/profile').set(auth())).body).toEqual({
      text: null,
    });
    const now = new Date();
    await prisma.syncDocument.createMany({
      data: [
        {
          userId,
          collection: 'candidate_profiles',
          id: 'p1',
          updatedAt: now,
          doc: {
            personal: {
              name: 'Jane Doe',
              email: 'jane@example.com',
              currentTitle: 'Backend engineer',
            },
            summary: 'Backend engineer who likes ledgers.',
            skills: { backend: ['Node.js', 'PostgreSQL'], frontend: [] },
          },
        },
        {
          userId,
          collection: 'experiences',
          id: 'e1',
          updatedAt: now,
          doc: {
            company: 'Paysafe',
            role: 'Senior engineer',
            startDate: '2021-01',
            endDate: null,
            description: 'Owned the payments ledger.',
            achievements: ['Cut reconciliation time by 80%'],
            technologies: ['PostgreSQL'],
          },
        },
      ],
    });
    const { text } = (await http.get('/api/v1/interview-preps/cv/profile').set(auth())).body;
    expect(text).toContain('Jane Doe · Backend engineer');
    expect(text).toContain('Senior engineer at Paysafe (2021-01 – present)');
    expect(text).toContain('- Cut reconciliation time by 80%');
    expect(text).toContain('Backend: Node.js, PostgreSQL');
    expect(text).not.toContain('jane@example.com');
  });
});

describe('a prep with DSA and a CV', () => {
  let prepId: string;

  it('asks for DSA questions and reads the CV', async () => {
    const fake = useFake({ data: PLAN });
    const created = await http
      .post('/api/v1/interview-preps')
      .set(auth())
      .send({
        company: 'Acme',
        role: 'Backend engineer',
        technologies: ['PostgreSQL'],
        includeDsa: true,
        resume: { text: CV, source: 'pasted' },
        scheduledAt: inDays(2),
      })
      .expect(201);
    prepId = created.body.id;
    expect(created.body).toMatchObject({
      includeDsa: true,
      resume: { source: 'pasted', fileName: null, chars: CV.length, text: CV },
      mockInterviews: [],
    });
    const prep = await waitFor(async () => {
      const p = (await http.get(`/api/v1/interview-preps/${prepId}`).set(auth())).body;
      return p.status === 'GENERATING' ? undefined : p;
    });
    expect(prep.status).toBe('READY');
    expect(prep.questions[0].kind).toBe('DSA');
    expect(fake.calls[0]!.messages).toContain('Include DSA questions.');
    expect(fake.calls[0]!.messages).toContain(CV);
  });

  it('rewrites the plan when the CV changes, but not for a new date', async () => {
    const dateOnly = await http
      .patch(`/api/v1/interview-preps/${prepId}`)
      .set(auth())
      .send({ scheduledAt: inDays(3) })
      .expect(200);
    expect(dateOnly.body.status).toBe('READY');

    useFake({ data: PLAN });
    const changed = await http
      .patch(`/api/v1/interview-preps/${prepId}`)
      .set(auth())
      .send({ resume: { text: `${CV} Also led a team of four.`, source: 'pasted' } })
      .expect(200);
    expect(changed.body.status).toBe('GENERATING');
    await waitFor(async () => {
      const p = (await http.get(`/api/v1/interview-preps/${prepId}`).set(auth())).body;
      return p.status === 'READY' ? p : undefined;
    });
  });

  describe('the mock interview', () => {
    let interviewId: string;

    it('opens at once, without waiting for AI', async () => {
      const started = await http
        .post(`/api/v1/interview-preps/${prepId}/mock-interviews`)
        .set(auth())
        .send({})
        .expect(200);
      interviewId = started.body.id;
      expect(started.body).toMatchObject({
        status: 'IN_PROGRESS',
        stage: 'INTRO',
        stages: ['INTRO', 'TECHNICAL', 'CODING', 'WRAP_UP'],
        awaitingReply: false,
        answered: 0,
      });
      expect(started.body.turns).toHaveLength(1);
      expect(started.body.turns[0]).toMatchObject({ speaker: 'INTERVIEWER', kind: 'OPENING' });
      expect(started.body.turns[0].text).toContain('Backend engineer role at Acme');
      expect(started.body.turns[0].text).toContain('brief introduction about yourself');

      // Starting again picks the same interview up.
      const again = await http
        .post(`/api/v1/interview-preps/${prepId}/mock-interviews`)
        .set(auth())
        .send({})
        .expect(200);
      expect(again.body.id).toBe(interviewId);
    });

    it('cross-questions, corrects the English and keeps its judgement to itself', async () => {
      const fake = useFake({
        data: turn(
          {
            kind: 'CROSS_QUESTION',
            stage: 'INTRO',
            message: 'You said the ledger was eventually consistent. How did you reconcile it?',
          },
          {
            ok: false,
            corrections: [
              { original: 'I have build', corrected: 'I have built', note: 'past participle' },
            ],
          },
          'WRONG',
        ),
      });
      const answered = await http
        .post(`/api/v1/mock-interviews/${interviewId}/answer`)
        .set(auth())
        .send({ text: 'I have build a payments ledger, it was eventually consistent.' })
        .expect(200);
      expect(answered.body.turns).toHaveLength(3);
      const [, mine, theirs] = answered.body.turns;
      expect(mine).toMatchObject({
        speaker: 'CANDIDATE',
        kind: 'ANSWER',
        language: {
          ok: false,
          corrections: [
            { original: 'I have build', corrected: 'I have built', note: 'past participle' },
          ],
        },
        assessment: null,
      });
      expect(theirs).toMatchObject({ speaker: 'INTERVIEWER', kind: 'CROSS_QUESTION' });
      expect(answered.body.awaitingReply).toBe(false);

      // The interviewer saw the CV, the pacing and the answer.
      const prompt = fake.calls[0]!.messages;
      expect(fake.calls[0]!.agent).toBe('mock-interviewer');
      expect(prompt).toContain('Also led a team of four.');
      expect(prompt).toContain('Current stage: INTRO');
      expect(prompt).toContain('I have build a payments ledger');
      expect(prompt).toContain('data structures and algorithms problems');
    });

    it('keeps an answer when the AI is unreachable, and replies on retry', async () => {
      // No fallback key and no desktop: nothing can reply.
      await http
        .post(`/api/v1/mock-interviews/${interviewId}/answer`)
        .set(auth())
        .send({ text: 'We ran a nightly job that compared balances.' })
        .expect(503);
      const waiting = (await http.get(`/api/v1/mock-interviews/${interviewId}`).set(auth())).body;
      expect(waiting).toMatchObject({ awaitingReply: true, replying: false });
      expect(waiting.error).toContain('laptop is offline');

      // A second answer has to wait for the reply.
      await http
        .post(`/api/v1/mock-interviews/${interviewId}/answer`)
        .set(auth())
        .send({ text: 'Also...' })
        .expect(409);

      useFake({
        data: turn({
          kind: 'NEW_QUESTION',
          stage: 'TECHNICAL',
          message: 'Let us talk PostgreSQL. What does MVCC buy you?',
        }),
      });
      const replied = await http
        .post(`/api/v1/mock-interviews/${interviewId}/reply`)
        .set(auth())
        .expect(200);
      expect(replied.body).toMatchObject({ stage: 'TECHNICAL', awaitingReply: false, error: null });
      expect(replied.body.turns.at(-1)).toMatchObject({ kind: 'NEW_QUESTION', stage: 'TECHNICAL' });
    });

    it('takes code, and turns a coding problem into a CODING turn', async () => {
      useFake({
        data: turn({
          kind: 'NEW_QUESTION',
          stage: 'CODING',
          message: "Let's do some coding.",
          problem: {
            title: 'Two sum',
            statement: 'Return the indices of the two numbers that add up to `target`.',
            examples: [{ input: '[2,7,11,15], 9', output: '[0,1]', explanation: null }],
            constraints: ['2 <= n <= 10^4'],
          },
        }),
      });
      const coding = await http
        .post(`/api/v1/mock-interviews/${interviewId}/answer`)
        .set(auth())
        .send({ text: 'Readers never block writers.' })
        .expect(200);
      expect(coding.body.stage).toBe('CODING');
      expect(coding.body.turns.at(-1)).toMatchObject({
        kind: 'CODING',
        problem: { title: 'Two sum', constraints: ['2 <= n <= 10^4'] },
      });

      useFake({
        data: turn({ kind: 'FOLLOW_UP', stage: 'CODING', message: 'What is the complexity?' }),
      });
      const code = await http
        .post(`/api/v1/mock-interviews/${interviewId}/answer`)
        .set(auth())
        .send({ text: '', code: 'const seen = new Map();', codeLanguage: 'TypeScript' })
        .expect(200);
      expect(code.body.turns.at(-2)).toMatchObject({
        speaker: 'CANDIDATE',
        text: '',
        code: 'const seen = new Map();',
        codeLanguage: 'TypeScript',
      });

      await http
        .post(`/api/v1/mock-interviews/${interviewId}/answer`)
        .set(auth())
        .send({ text: '  ', code: null })
        .expect(400);
    });

    it('writes the report when the candidate ends, and tells the prep', async () => {
      const fake = useFake({ data: REPORT });
      const finished = await http
        .post(`/api/v1/mock-interviews/${interviewId}/finish`)
        .set(auth())
        .expect(200);
      expect(finished.body.status).toBe('REPORTING');

      const done = await waitFor(async () => {
        const v = (await http.get(`/api/v1/mock-interviews/${interviewId}`).set(auth())).body;
        return v.status === 'COMPLETED' ? v : undefined;
      });
      expect(done.overallScore).toBe(6.4);
      expect(done.report.verdict).toBe('LEAN_HIRE');
      // A question pointing at no real turn is dropped.
      expect(done.report.questions.map((q: { turnOrder: number }) => q.turnOrder)).toEqual([0]);
      // Now the judgements show.
      expect(done.turns[1].assessment).toMatchObject({ verdict: 'WRONG' });
      expect(fake.calls[0]).toMatchObject({ agent: 'mock-interview-report' });
      expect(fake.calls[0]!.messages).toContain('ended early by the candidate');
      expect(fake.calls[0]!.messages).toContain('Judged at the time: WRONG');

      await http
        .post(`/api/v1/mock-interviews/${interviewId}/answer`)
        .set(auth())
        .send({ text: 'Hi' })
        .expect(409);

      const prep = (await http.get(`/api/v1/interview-preps/${prepId}`).set(auth())).body;
      expect(prep.mockInterviews).toEqual([
        expect.objectContaining({
          id: interviewId,
          status: 'COMPLETED',
          overallScore: 6.4,
          verdict: 'LEAN_HIRE',
          answered: 4,
        }),
      ]);
    });

    it('starts a fresh interview after one is over, and abandons on restart', async () => {
      const fresh = await http
        .post(`/api/v1/interview-preps/${prepId}/mock-interviews`)
        .set(auth())
        .send({})
        .expect(200);
      expect(fresh.body.id).not.toBe(interviewId);
      const restarted = await http
        .post(`/api/v1/interview-preps/${prepId}/mock-interviews`)
        .set(auth())
        .send({ restart: true })
        .expect(200);
      expect(restarted.body.id).not.toBe(fresh.body.id);
      const old = (await http.get(`/api/v1/mock-interviews/${fresh.body.id}`).set(auth())).body;
      expect(old.status).toBe('ABANDONED');

      // Ending before answering anything writes no report.
      const ended = await http
        .post(`/api/v1/mock-interviews/${restarted.body.id}/finish`)
        .set(auth())
        .expect(200);
      expect(ended.body.status).toBe('ABANDONED');
    });
  });
});
