import { z } from 'zod';

import type { AIProvider, CallContext, PromptSpec } from '../provider/ai-provider.port.js';

import { PROMPT_VERSION } from './policy.js';

/**
 * Prepares the user for one real interview: from a job description and/or a
 * list of technologies, and the date, it writes a focused plan and a set of
 * likely questions with what a strong answer covers. A second agent grades
 * the user's practice answers against those key points.
 *
 * Questions are the interviewer's, not exercises: no answer text is shown
 * up front, only the key points, after the user has tried.
 */

export const PREP_QUESTION_KINDS = [
  'TECHNICAL',
  'SYSTEM_DESIGN',
  'CODING',
  'BEHAVIORAL',
  'COMPANY',
] as const;

export const prepQuestionSchema = z.object({
  kind: z.enum(PREP_QUESTION_KINDS),
  /** The technology or theme it belongs to ("React", "Ownership", ...). */
  topic: z.string().min(1).max(80),
  question: z.string().min(10).max(600),
  /** What a strong answer covers, as short points. Shown after the attempt. */
  keyPoints: z.array(z.string().min(3).max(240)).min(2).max(7),
  difficulty: z.number().int().min(1).max(5),
});

export const interviewPrepSchema = z.object({
  /** Two or three sentences: what this interview will most likely test, and why. */
  summary: z.string().min(20).max(900),
  focusAreas: z
    .array(
      z.object({
        topic: z.string().min(1).max(80),
        why: z.string().min(5).max(300),
        priority: z.number().int().min(1).max(3),
      }),
    )
    .min(1)
    .max(8),
  /** One entry per day until the interview (the last is the day before). */
  schedule: z
    .array(z.object({ day: z.number().int().min(1).max(30), focus: z.string().min(3).max(240) }))
    .min(1)
    .max(14),
  questions: z.array(prepQuestionSchema).min(4).max(24),
});

export type PrepQuestionOutput = z.infer<typeof prepQuestionSchema>;
export type InterviewPrepOutput = z.infer<typeof interviewPrepSchema>;

export interface InterviewPrepInput {
  company: string | null;
  role: string | null;
  jobDescription: string | null;
  technologies: readonly string[];
  /** Whole days from now until the interview (0 = today). */
  daysUntil: number;
  /** What the user already practised, so the plan doesn't repeat it. */
  knownStrengths?: readonly string[];
  count?: number;
}

export const interviewPrepAgent = {
  name: 'interview-prep' as const,
  promptVersion: PROMPT_VERSION,
  contract: interviewPrepSchema,

  buildPrompt(input: InterviewPrepInput): PromptSpec {
    const count = input.count ?? 12;
    const days = Math.max(1, Math.min(14, input.daysUntil));
    return {
      model: 'reasoning',
      temperature: 0.3,
      maxTokens: 6_000,
      messages: [
        {
          role: 'system',
          content: `You prepare an engineer for one specific, real interview. Be concrete and honest.

Rules:
- Ground everything in the job description and the listed technologies. If both are thin, say so in the summary and stay with fundamentals.
- Questions are what an interviewer for THIS role would actually ask: a mix of technical depth, at least one system or design question when the role is mid-level or above, and two or three behavioral questions tied to the role's responsibilities.
- Each question gets 2-7 key points: what a strong answer must cover. Points, not a model answer to memorise.
- Order focus areas by how likely they are to be tested and how costly a gap would be (priority 1 = highest).
- The schedule fits the days left. With one day, it is one focused day. Never more days than are left.
- No trick questions, no trivia about version numbers.`,
        },
        {
          role: 'user',
          content: [
            input.company ? `Company: ${input.company}` : '',
            input.role ? `Role: ${input.role}` : '',
            input.technologies.length > 0
              ? `Technologies to prepare: ${input.technologies.join(', ')}`
              : '',
            input.jobDescription
              ? `Job description:\n"""\n${input.jobDescription.slice(0, 12_000)}\n"""`
              : '',
            input.knownStrengths && input.knownStrengths.length > 0
              ? `Already strong in: ${input.knownStrengths.join(', ')}`
              : '',
            `Days until the interview: ${days}`,
            `Write ${count} questions.`,
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
      ],
    };
  },

  async run(
    provider: AIProvider,
    input: InterviewPrepInput,
    context: Omit<CallContext, 'agent' | 'promptVersion'>,
  ): Promise<InterviewPrepOutput> {
    const result = await provider.structured({
      prompt: interviewPrepAgent.buildPrompt(input),
      schema: interviewPrepSchema,
      schemaName: 'InterviewPrep',
      context: { ...context, agent: 'interview-prep', promptVersion: PROMPT_VERSION },
    });
    return result.data;
  },
};

export const prepAnswerGradeSchema = z.object({
  /** 0-10 against the key points, not against perfection. */
  score: z.number().int().min(0).max(10),
  covered: z.array(z.string().max(240)).max(7),
  missed: z.array(z.string().max(240)).max(7),
  /** Two or three sentences the user can act on in the next attempt. */
  feedback: z.string().min(10).max(900),
});

export type PrepAnswerGradeOutput = z.infer<typeof prepAnswerGradeSchema>;

export interface PrepAnswerInput {
  question: string;
  keyPoints: readonly string[];
  answer: string;
  role: string | null;
}

export const prepAnswerGraderAgent = {
  name: 'interview-prep-grader' as const,
  promptVersion: PROMPT_VERSION,
  contract: prepAnswerGradeSchema,

  buildPrompt(input: PrepAnswerInput): PromptSpec {
    return {
      model: 'fast',
      temperature: 0.1,
      maxTokens: 1_200,
      messages: [
        {
          role: 'system',
          content: `You grade one practice answer for a real interview, as a fair senior interviewer would.

Rules:
- Grade against the key points. Score 10 means every point is covered correctly; 0 means nothing relevant.
- List which key points were covered and which were missed, in the key points' own words.
- Feedback is specific and actionable: what to add or fix next time. Do not write the full answer for them.
- A spoken-style, informal answer is fine; judge substance, not grammar.`,
        },
        {
          role: 'user',
          content: [
            input.role ? `Role: ${input.role}` : '',
            `Question: ${input.question}`,
            `Key points:\n${input.keyPoints.map((p) => `- ${p}`).join('\n')}`,
            `Answer:\n"""\n${input.answer.slice(0, 6_000)}\n"""`,
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
      ],
    };
  },

  async run(
    provider: AIProvider,
    input: PrepAnswerInput,
    context: Omit<CallContext, 'agent' | 'promptVersion'>,
  ): Promise<PrepAnswerGradeOutput> {
    const result = await provider.structured({
      prompt: prepAnswerGraderAgent.buildPrompt(input),
      schema: prepAnswerGradeSchema,
      schemaName: 'PrepAnswerGrade',
      context: { ...context, agent: 'interview-prep-grader', promptVersion: PROMPT_VERSION },
    });
    return result.data;
  },
};
