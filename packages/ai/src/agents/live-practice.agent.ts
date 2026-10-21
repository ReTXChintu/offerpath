import { z } from 'zod';

import type { AIProvider, CallContext, PromptSpec } from '../provider/ai-provider.port.js';

import { list, optionalText, text } from './lenient.js';
import { PROMPT_VERSION } from './policy.js';

/**
 * Live practice (docs/live-practice.md): two people practise interviews face
 * to face and a phone listens. For each new stretch of speech this agent
 * says whether it is a new question, part of the answer to the current one,
 * or neither; for a question it also writes the answer to compare with. The
 * spoken answers are graded with `prepAnswerGraderAgent`.
 *
 * It runs on the user's OpenAI key, on the fast model: the answer has to be
 * on screen a few seconds after the question.
 */

export const LIVE_LINE_KINDS = ['QUESTION', 'ANSWER', 'OTHER'] as const;
export type LiveLineKind = (typeof LIVE_LINE_KINDS)[number];

export const liveAnswerSchema = z.object({
  /** One or two sentences: the answer in brief. */
  summary: text(500),
  /** The talking points a strong answer covers. */
  points: list(text(300), 1, 6),
  /** A fuller answer, markdown; empty when the points say it all. */
  detail: optionalText(3_000),
});

export const liveTurnSchema = z.object({
  kind: z.enum(LIVE_LINE_KINDS),
  /** QUESTION: the question as asked, tidied up and complete. */
  question: optionalText(600).nullable(),
  /** QUESTION: the answer to compare with. */
  answer: liveAnswerSchema.nullable(),
});

export type LiveAnswerOutput = z.infer<typeof liveAnswerSchema>;
export type LiveTurnOutput = z.infer<typeof liveTurnSchema>;

export interface LiveTurnInput {
  /** The interview being practised for, when the session belongs to a prep. */
  company: string | null;
  role: string | null;
  jobDescription: string | null;
  technologies: readonly string[];
  /** The CV to answer as; null answers as a strong candidate in general. */
  resume: string | null;
  /** The last lines, oldest first. */
  recent: readonly { kind: LiveLineKind; text: string }[];
  /** The question being answered right now, if any. */
  currentQuestion: string | null;
  /** What was just said. */
  latest: string;
}

export const livePracticeAgent = {
  name: 'live-practice' as const,
  promptVersion: PROMPT_VERSION,
  contract: liveTurnSchema,

  buildPrompt(input: LiveTurnInput): PromptSpec {
    const background = [
      input.company ? `Company: ${input.company}` : '',
      input.role ? `Role: ${input.role}` : '',
      input.technologies.length > 0 ? `Technologies: ${input.technologies.join(', ')}` : '',
      input.jobDescription
        ? `Job description:\n"""\n${input.jobDescription.slice(0, 6_000)}\n"""`
        : '',
      input.resume
        ? `Answer as this candidate, from their CV:\n"""\n${input.resume.slice(0, 8_000)}\n"""`
        : 'No CV: answer as a strong candidate would, without inventing personal history.',
    ]
      .filter(Boolean)
      .join('\n\n');
    const recent =
      input.recent.length > 0
        ? input.recent.map((l) => `[${l.kind}] ${l.text}`).join('\n')
        : '(nothing yet)';

    return {
      model: 'fast',
      temperature: 0.3,
      maxTokens: 1_800,
      messages: [
        {
          role: 'system',
          content: `Two people are practising job interviews together and taking turns: one asks a question, the other answers out loud. A microphone transcribes them, so the text can have recognition mistakes, missing punctuation and fragments. You see the recent transcript and the latest piece of speech.

Decide what the latest piece is:
- QUESTION: an interview question for the other person (technical, behavioral, about projects, a coding or design prompt). Includes questions phrased as requests ("Tell me about...", "Explain..."). If the previous line was the start of this question, give the whole question. Fix obvious recognition mistakes in technical terms.
- ANSWER: someone answering the current question, or continuing an answer.
- OTHER: small talk, "okay", "next question", deciding who goes next, or noise.

For a QUESTION, also write the answer they can compare theirs with:
- summary: the answer in one or two sentences.
- points: 1-6 talking points a strong answer covers, short.
- detail: a fuller answer in markdown (a short code sample if it is a coding question), or "" if the points say it all. Keep it under 250 words.
- With a CV: answer in the first person as that candidate, using their real projects, numbers and technologies where they fit. Never invent experience the CV doesn't show; where the CV has nothing relevant, answer from general knowledge and say how they would approach it.
- Be accurate and current; no filler.

For ANSWER and OTHER, question and answer are null.`,
        },
        {
          role: 'user',
          content: [
            background,
            `Current question: ${input.currentQuestion ?? '(none yet)'}`,
            `Recent transcript:\n${recent}`,
            `Latest speech:\n"""\n${input.latest.slice(0, 4_000)}\n"""`,
          ].join('\n\n---\n\n'),
        },
      ],
    };
  },

  async run(
    provider: AIProvider,
    input: LiveTurnInput,
    context: Omit<CallContext, 'agent' | 'promptVersion'>,
  ): Promise<LiveTurnOutput> {
    const result = await provider.structured({
      prompt: livePracticeAgent.buildPrompt(input),
      schema: liveTurnSchema,
      schemaName: 'LivePracticeTurn',
      context: { ...context, agent: 'live-practice', promptVersion: PROMPT_VERSION },
    });
    return result.data;
  },
};
