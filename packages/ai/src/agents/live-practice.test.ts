import { describe, expect, it } from 'vitest';

import { livePracticeAgent, liveTurnSchema, type LiveTurnInput } from './live-practice.agent.js';

const input: LiveTurnInput = {
  company: 'Acme',
  role: 'Backend engineer',
  jobDescription: null,
  technologies: ['PostgreSQL'],
  resume: 'Built a payments ledger on PostgreSQL.',
  recent: [{ kind: 'OTHER', text: 'Okay, my turn to ask.' }],
  currentQuestion: null,
  latest: 'how does mvcc work in postgres',
};

const text = (i: LiveTurnInput) =>
  livePracticeAgent
    .buildPrompt(i)
    .messages.map((m) => m.content)
    .join('\n');

describe('live practice agent', () => {
  it('answers from the CV, or says there is none', () => {
    expect(text(input)).toContain('Answer as this candidate, from their CV');
    expect(text(input)).toContain('payments ledger');
    const neutral = text({ ...input, resume: null });
    expect(neutral).not.toContain('payments ledger');
    expect(neutral).toContain('No CV');
  });

  it('runs on the fast model: the answer must be on screen in seconds', () => {
    expect(livePracticeAgent.buildPrompt(input).model).toBe('fast');
  });

  it('tidies long output instead of failing it', () => {
    const parsed = liveTurnSchema.parse({
      kind: 'QUESTION',
      question: 'How does MVCC work in PostgreSQL?',
      answer: {
        summary: 's'.repeat(800),
        points: Array.from({ length: 9 }, (_, i) => `Point ${i}`),
        detail: '',
      },
    });
    expect(parsed.answer!.summary).toHaveLength(500);
    expect(parsed.answer!.points).toHaveLength(6);
    expect(parsed.answer!.detail).toBe('');
    expect(liveTurnSchema.parse({ kind: 'OTHER', question: null, answer: null }).kind).toBe(
      'OTHER',
    );
  });
});
