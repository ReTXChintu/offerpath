import { describe, expect, it } from 'vitest';

import {
  LIVE_SKIP,
  liveAnswererInstructions,
  type LiveAnswererInput,
} from './live-practice.agent.js';

const input: LiveAnswererInput = {
  company: 'Acme',
  role: 'Backend engineer',
  jobDescription: null,
  technologies: ['PostgreSQL'],
  resume: 'Built a payments ledger on PostgreSQL.',
  earlier: [],
};

describe('live practice instructions', () => {
  it('answers directly, never with advice about what to say', () => {
    const text = liveAnswererInstructions(input);
    expect(text).toContain('Answer the question itself, directly');
    expect(text).toContain('Never give advice about what to say');
    expect(text).toContain('there are no turns');
  });

  it('answers as the candidate from the CV, or neutrally without one', () => {
    expect(liveAnswererInstructions(input)).toContain('payments ledger');
    expect(liveAnswererInstructions(input)).toContain('first person');
    const neutral = liveAnswererInstructions({ ...input, resume: null });
    expect(neutral).not.toContain('payments ledger');
    expect(neutral).toContain('Answer neutrally');
  });

  it('skips what is not a question with a marker the phone drops', () => {
    expect(liveAnswererInstructions(input)).toContain(`reply with exactly ${LIVE_SKIP}`);
  });

  it('carries earlier answers across a reconnect', () => {
    const text = liveAnswererInstructions({
      ...input,
      earlier: [{ question: 'What is MVCC?', answer: 'Each transaction sees a snapshot.' }],
    });
    expect(text).toContain('Q: What is MVCC?');
    expect(text).toContain('A: Each transaction sees a snapshot.');
  });
});
