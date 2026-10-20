import { z } from 'zod';

import type { AIProvider, CallContext, PromptSpec } from '../provider/ai-provider.port.js';

import { list, optionalText, score, text } from './lenient.js';
import { PROMPT_VERSION } from './policy.js';

/**
 * A live mock interview for one real interview: the interviewer reads the
 * CV, the job description and the technologies, and talks to the candidate
 * turn by turn: an introduction with follow-ups, technology questions,
 * coding, a wrap-up. Every turn also corrects the candidate's English and
 * privately judges the answer; a second agent writes the report at the end.
 *
 * The API decides the pacing (`directive`): which stage the interview is in
 * and whether the interviewer may follow up, ask the next question or must
 * move on. See docs/mock-interview.md.
 */

export const MOCK_STAGES = ['INTRO', 'TECHNICAL', 'CODING', 'WRAP_UP'] as const;
export type MockStage = (typeof MOCK_STAGES)[number];

export const MOCK_TURN_KINDS = [
  'FOLLOW_UP',
  'CROSS_QUESTION',
  'NEW_QUESTION',
  'CODING',
  'CLOSING',
] as const;
export type MockTurnKind = (typeof MOCK_TURN_KINDS)[number];

export const MOCK_VERDICTS = ['STRONG', 'CORRECT', 'PARTIAL', 'WRONG', 'NO_ANSWER'] as const;

export const codingProblemSchema = z.object({
  title: text(120),
  /** Markdown. */
  statement: text(3_000),
  examples: list(
    z.object({
      input: text(600),
      output: text(600),
      explanation: optionalText(600).nullable(),
    }),
    0,
    4,
  ),
  constraints: list(text(240), 0, 8),
});

export const mockTurnSchema = z.object({
  /** The candidate's latest message, corrected like a language coach would. */
  language: z.object({
    ok: z.boolean(),
    corrections: list(
      z.object({ original: text(400), corrected: text(400), note: text(240) }),
      0,
      8,
    ),
  }),
  /** Private until the interview is over. */
  assessment: z.object({
    verdict: z.enum(MOCK_VERDICTS),
    note: text(600),
  }),
  next: z.object({
    kind: z.enum(MOCK_TURN_KINDS),
    stage: z.enum(MOCK_STAGES),
    /** What the interviewer says. */
    message: text(2_500),
    /** Only for CODING turns. */
    problem: codingProblemSchema.nullable(),
  }),
});

export type CodingProblemOutput = z.infer<typeof codingProblemSchema>;
export type MockTurnOutput = z.infer<typeof mockTurnSchema>;

export interface MockInterviewContext {
  company: string | null;
  role: string | null;
  jobDescription: string | null;
  technologies: readonly string[];
  resume: string | null;
  includeDsa: boolean;
}

export interface MockTranscriptTurn {
  order: number;
  speaker: 'INTERVIEWER' | 'CANDIDATE';
  stage: MockStage;
  kind: string;
  text: string;
  code?: string | null;
  codeLanguage?: string | null;
  /** Interviewer CODING turns. */
  problemTitle?: string | null;
  /** Candidate turns, for the report. */
  assessment?: { verdict: string; note: string } | null;
  languageCorrections?: number | null;
}

export interface MockTurnInput extends MockInterviewContext {
  stage: MockStage;
  /** From the API: what the interviewer may do next. */
  directive: string;
  transcript: readonly MockTranscriptTurn[];
}

function background(input: MockInterviewContext): string {
  return [
    input.company ? `Company: ${input.company}` : '',
    input.role ? `Role: ${input.role}` : '',
    input.technologies.length > 0 ? `Technologies: ${input.technologies.join(', ')}` : '',
    input.jobDescription
      ? `Job description:\n"""\n${input.jobDescription.slice(0, 10_000)}\n"""`
      : '',
    input.resume
      ? `The candidate's CV:\n"""\n${input.resume.slice(0, 10_000)}\n"""`
      : 'No CV was shared.',
    input.includeDsa
      ? 'Coding round: data structures and algorithms problems.'
      : 'Coding round: a practical coding task in the role’s stack (no algorithm puzzles).',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function renderTurn(turn: MockTranscriptTurn, withJudgement: boolean): string {
  const who = turn.speaker === 'INTERVIEWER' ? 'Interviewer' : 'Candidate';
  const head = `[#${turn.order}] ${who} (${turn.stage}${turn.speaker === 'INTERVIEWER' ? `, ${turn.kind}` : ''})`;
  const lines = [`${head}:`, turn.text || '(no text)'];
  if (turn.problemTitle) lines.push(`(Coding problem: ${turn.problemTitle})`);
  if (turn.code) {
    lines.push(`Code (${turn.codeLanguage ?? 'unknown language'}):\n\`\`\`\n${turn.code}\n\`\`\``);
  }
  if (withJudgement && turn.assessment) {
    lines.push(
      `(Judged at the time: ${turn.assessment.verdict}: ${turn.assessment.note}` +
        `${turn.languageCorrections ? `; ${turn.languageCorrections} language corrections` : ''})`,
    );
  }
  return lines.join('\n');
}

/** The newest turns in full; older ones shortened, so long interviews still fit. */
function renderTranscript(turns: readonly MockTranscriptTurn[], withJudgement: boolean): string {
  const recent = 12;
  return turns
    .map((turn, i) => {
      const rendered = renderTurn(turn, withJudgement);
      return i < turns.length - recent && rendered.length > 1_500
        ? `${rendered.slice(0, 1_500)}…`
        : rendered;
    })
    .join('\n\n');
}

export const mockInterviewerAgent = {
  name: 'mock-interviewer' as const,
  promptVersion: PROMPT_VERSION,
  contract: mockTurnSchema,

  buildPrompt(input: MockTurnInput): PromptSpec {
    return {
      model: 'fast',
      temperature: 0.5,
      maxTokens: 3_000,
      messages: [
        {
          role: 'system',
          content: `You are a senior engineer running a real job interview, in writing, with one candidate. Stay in role the whole time: this should feel like the actual interview, not a quiz.

Every turn you get the background, the conversation so far and the candidate's latest message, and you return three things.

1. language: correct the English of the candidate's latest message the way a kind language coach would. Grammar, wrong words, tense, articles, prepositions, spelling of ordinary words, and phrasing a native speaker would find awkward. Quote the exact fragment as "original" and give the corrected fragment and a few words on why. Never correct code, identifiers or technical names. Casual but correct is fine. ok = true when there is nothing to fix (then no corrections).

2. assessment: your private judgment of the latest answer, which the candidate only sees after the interview. STRONG, CORRECT, PARTIAL, WRONG, or NO_ANSWER (didn't know / avoided it). The note says in one or two sentences what was right, what was wrong or missing.

3. next: what you say next, and its kind and stage.

How you interview:
- One question at a time. Short, natural sentences, the way people talk in interviews. A brief acknowledgement is fine ("Okay.", "Got it.", "Makes sense."), but no gushing praise, and never say the answer is correct or give a score.
- Wrong or shaky answer: cross-question it (CROSS_QUESTION). Challenge it the way a real interviewer does: "Are you sure? What happens when...", a counter-example, a failing input, "How would you check that?". Do not give the right answer away.
- Vague answer: ask for specifics (FOLLOW_UP): their own part, numbers, the trade-off, why that choice, what went wrong.
- Good answer: go one level deeper, or move on.
- "I don't know": invite them to reason it out aloud once; if they still can't, move on without lecturing.
- A clarifying question from the candidate: answer it briefly, then wait for their answer (FOLLOW_UP on the same question).
- INTRO: they introduce themselves; follow up on what they said and on the CV (a project, their impact, a decision, a gap, a claim worth checking).
- TECHNICAL: questions from the job description and technologies, weighted to what this role needs; probe what the CV claims. Mix concepts with "how would you..." scenarios.
- CODING: give a problem with kind CODING and fill "problem" (title, a clear statement, 1-3 examples, constraints). The message introduces it naturally and asks them to talk through the approach and then write the code. After they answer: ask about time and space complexity and edge cases; if the code has a bug, cross-question with an input it fails on, without fixing it for them.
- WRAP_UP: ask whether they have any questions for you. Answer theirs briefly and honestly as an interviewer would (don't invent facts about the company), then close (CLOSING) with a natural goodbye that says the feedback is coming.
- "problem" is null unless the kind is CODING.
- Follow the pacing directive exactly: it says which stage you are in and what you may do next.
- Plain conversational text; markdown only for code.`,
        },
        {
          role: 'user',
          content: [
            background(input),
            `The interview so far:\n\n${renderTranscript(input.transcript, false)}`,
            `Pacing directive: ${input.directive}`,
          ].join('\n\n---\n\n'),
        },
      ],
    };
  },

  async run(
    provider: AIProvider,
    input: MockTurnInput,
    context: Omit<CallContext, 'agent' | 'promptVersion'>,
  ): Promise<MockTurnOutput> {
    const result = await provider.structured({
      prompt: mockInterviewerAgent.buildPrompt(input),
      schema: mockTurnSchema,
      schemaName: 'MockInterviewTurn',
      context: { ...context, agent: 'mock-interviewer', promptVersion: PROMPT_VERSION },
    });
    return result.data;
  },
};

export const MOCK_DIMENSIONS = [
  'SELF_PRESENTATION',
  'TECHNICAL_DEPTH',
  'PROBLEM_SOLVING',
  'CODING',
  'COMMUNICATION',
  'LANGUAGE',
] as const;

export const MOCK_HIRE_VERDICTS = [
  'STRONG_HIRE',
  'HIRE',
  'LEAN_HIRE',
  'LEAN_NO_HIRE',
  'NO_HIRE',
] as const;

export const mockReportSchema = z.object({
  overallScore: score(0, 10),
  verdict: z.enum(MOCK_HIRE_VERDICTS),
  summary: text(1_500),
  dimensions: list(
    z.object({ name: z.enum(MOCK_DIMENSIONS), score: score(0, 10), comment: text(500) }),
    1,
    6,
  ),
  /** One per question the interviewer asked, follow-ups included, in order. */
  questions: list(
    z.object({
      /** The interviewer turn's number ([#n] in the transcript). */
      turnOrder: z.number().int(),
      question: text(500),
      answerSummary: text(600),
      score: score(0, 10),
      wentWell: optionalText(600),
      couldBeBetter: optionalText(800),
      strongerAnswer: text(1_500),
    }),
    0,
    40,
  ),
  language: z.object({
    score: score(0, 10),
    patterns: list(text(300), 0, 6),
    note: text(600),
  }),
  strengths: list(text(300), 0, 6),
  improvements: list(text(300), 0, 6),
  nextSteps: list(text(300), 0, 6),
});

export type MockReportOutput = z.infer<typeof mockReportSchema>;

export interface MockReportInput extends MockInterviewContext {
  /** Every turn, with the judgement made at the time on each answer. */
  transcript: readonly MockTranscriptTurn[];
  /** The candidate ended the interview before the interviewer did. */
  endedEarly: boolean;
}

export const mockInterviewReportAgent = {
  name: 'mock-interview-report' as const,
  promptVersion: PROMPT_VERSION,
  contract: mockReportSchema,

  buildPrompt(input: MockReportInput): PromptSpec {
    return {
      model: 'reasoning',
      temperature: 0.2,
      maxTokens: 10_000,
      messages: [
        {
          role: 'system',
          content: `You were the interviewer in the interview below, and now you write the candidate's feedback: honest, specific and useful, as a fair senior interviewer would after a real loop.

Rules:
- Score against what this role needs (the job description, the technologies, the seniority the CV shows), not against perfection. 10 = outstanding, 7 = a solid pass, 5 = borderline, 3 or less = clearly not ready.
- overallScore weighs every dimension; the verdict follows from it and from any deal-breakers (a basic concept badly wrong, no working code).
- dimensions: score each that the interview actually tested. CODING only if there was a coding round; LANGUAGE is the candidate's written English.
- questions: one entry for every question the interviewer asked, follow-ups and cross-questions included, in order, skipping only the closing goodbye. turnOrder is the interviewer turn's number from the transcript ([#n]). answerSummary is what the candidate actually said, in one or two sentences. couldBeBetter is concrete: what was missing, wrong or unclear. strongerAnswer is what a strong candidate would have said: the key content, in a few sentences or bullet points (for coding: the approach and complexity, not a full program). A question left unanswered gets a score of 0 and says so.
- language: the recurring patterns in the candidate's English (e.g. missing articles, tense) with an example each, and one practical tip.
- strengths, improvements and nextSteps are specific to this interview, not generic advice.
- If the candidate ended early, judge what happened and mention what wasn't covered.`,
        },
        {
          role: 'user',
          content: [
            background(input),
            `The interview${input.endedEarly ? ' (ended early by the candidate)' : ''}:\n\n${renderTranscript(input.transcript, true)}`,
          ].join('\n\n---\n\n'),
        },
      ],
    };
  },

  async run(
    provider: AIProvider,
    input: MockReportInput,
    context: Omit<CallContext, 'agent' | 'promptVersion'>,
  ): Promise<MockReportOutput> {
    const result = await provider.structured({
      prompt: mockInterviewReportAgent.buildPrompt(input),
      schema: mockReportSchema,
      schemaName: 'MockInterviewReport',
      context: { ...context, agent: 'mock-interview-report', promptVersion: PROMPT_VERSION },
    });
    return result.data;
  },
};
