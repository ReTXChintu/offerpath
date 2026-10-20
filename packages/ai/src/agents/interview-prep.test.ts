import { describe, expect, it } from 'vitest';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { toStrictSchema } from '../provider/schema/strict-schema.js';

import { interviewPrepSchema, prepAnswerGradeSchema } from './interview-prep.agent.js';

/**
 * The model never sees length or range limits (strict structured output drops
 * them), so a plan that runs long must be tidied, not thrown away: a failed
 * prep costs the user a whole regeneration.
 */

const question = {
  kind: 'TECHNICAL',
  topic: 'React',
  question: 'How does React decide when to re-render a component?',
  keyPoints: ['State or props change', 'Parent re-render'],
  difficulty: 3,
};

describe('interview prep contract', () => {
  it('shortens long text and pulls numbers into range instead of failing', () => {
    // The shape of the answer that failed in production.
    const parsed = interviewPrepSchema.parse({
      summary: 'x'.repeat(1_400),
      focusAreas: [
        { topic: 'T'.repeat(120), why: 'Core of the role.', priority: 1 },
        { topic: 'Testing', why: 'Listed in the JD.', priority: 4 },
        { topic: 'Ops', why: 'Nice to have.', priority: 2.6 },
      ],
      schedule: [{ day: 1, focus: 'Rendering and hooks' }],
      questions: [question, { ...question, difficulty: 7 }],
    });

    expect(parsed.summary).toHaveLength(900);
    expect(parsed.summary.endsWith('…')).toBe(true);
    expect(parsed.focusAreas[0]!.topic).toHaveLength(80);
    expect(parsed.focusAreas.map((f) => f.priority)).toEqual([1, 3, 3]);
    expect(parsed.questions[1]!.difficulty).toBe(5);
  });

  it('drops list items past the limit', () => {
    const parsed = interviewPrepSchema.parse({
      summary: 'A focused frontend interview.',
      focusAreas: Array.from({ length: 11 }, (_, i) => ({
        topic: `Area ${i}`,
        why: 'Because.',
        priority: 2,
      })),
      schedule: Array.from({ length: 20 }, (_, i) => ({ day: i + 1, focus: 'Practice' })),
      questions: Array.from({ length: 30 }, () => question),
    });
    expect(parsed.focusAreas).toHaveLength(8);
    expect(parsed.schedule).toHaveLength(14);
    expect(parsed.questions).toHaveLength(24);
  });

  it('still fails on an empty or missing field', () => {
    expect(
      interviewPrepSchema.safeParse({ summary: '  ', focusAreas: [], schedule: [], questions: [] })
        .success,
    ).toBe(false);
  });

  it('tidies the grader output the same way', () => {
    const parsed = prepAnswerGradeSchema.parse({
      score: 12,
      covered: ['State changes'],
      missed: Array.from({ length: 9 }, () => 'Something'),
      feedback: 'f'.repeat(1_000),
    });
    expect(parsed.score).toBe(10);
    expect(parsed.missed).toHaveLength(7);
    expect(parsed.feedback).toHaveLength(900);
  });

  it('still converts to a strict JSON schema for the model', () => {
    const json = zodToJsonSchema(interviewPrepSchema, {
      target: 'jsonSchema7',
      $refStrategy: 'none',
    }) as Record<string, unknown>;
    const { schema } = toStrictSchema(json);
    expect(JSON.stringify(schema)).toContain('"focusAreas"');
    expect(JSON.stringify(schema)).toContain('"SYSTEM_DESIGN"');
  });
});
