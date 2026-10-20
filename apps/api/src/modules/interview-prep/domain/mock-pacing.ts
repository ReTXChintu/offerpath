/**
 * Pacing for a mock interview: the interviewer AI chooses what to ask, the
 * API decides how long each stage lasts. Pure, so it is tested on its own.
 *
 * Stages run in order: an introduction, technology questions, coding, a
 * wrap-up. Each has a budget of main questions and of follow-ups per main
 * question; when the main questions are used up the interviewer may move on,
 * and when the follow-ups are too it must. Stages never go back, and never
 * jump more than one ahead.
 */

export const STAGES = ['INTRO', 'TECHNICAL', 'CODING', 'WRAP_UP'] as const;
export type Stage = (typeof STAGES)[number];

export type InterviewerKind =
  'OPENING' | 'FOLLOW_UP' | 'CROSS_QUESTION' | 'NEW_QUESTION' | 'CODING' | 'CLOSING';

export interface PacingTurn {
  speaker: 'INTERVIEWER' | 'CANDIDATE';
  stage: Stage;
  kind: string;
}

interface Budget {
  /** Main questions in the stage (the opening counts in INTRO). */
  main: number;
  /** Follow-ups and cross-questions per main question. */
  followUps: number;
}

/** After this many answers the interview closes, whatever the stage. */
export const MAX_ANSWERS = 30;

export function budgets(includeDsa: boolean): Record<Stage, Budget> {
  return {
    INTRO: { main: 1, followUps: 2 },
    TECHNICAL: { main: 4, followUps: 2 },
    CODING: { main: includeDsa ? 2 : 1, followUps: 3 },
    // "Any questions for me?", then answering one of theirs.
    WRAP_UP: { main: 1, followUps: 1 },
  };
}

const MAIN_KINDS = new Set(['OPENING', 'NEW_QUESTION', 'CODING']);
const FOLLOW_UP_KINDS = new Set(['FOLLOW_UP', 'CROSS_QUESTION']);

export function nextStage(stage: Stage): Stage | null {
  return STAGES[STAGES.indexOf(stage) + 1] ?? null;
}

const STAGE_ENTRY: Record<Stage, string> = {
  INTRO: 'the introduction',
  TECHNICAL: 'the technical questions (kind NEW_QUESTION, stage TECHNICAL)',
  CODING: 'the coding round (kind CODING, stage CODING, with a problem)',
  WRAP_UP:
    'the wrap-up: ask whether they have any questions for you (kind NEW_QUESTION, stage WRAP_UP)',
};

export interface Pacing {
  stage: Stage;
  answered: number;
  mainAsked: number;
  mainBudget: number;
  followUpsOnCurrent: number;
  followUpBudget: number;
  canFollowUp: boolean;
  canAskNew: boolean;
  /** Moving on is allowed (the stage's main questions are used up). */
  canAdvance: boolean;
  /** Nothing left in this stage: move on now. */
  mustAdvance: boolean;
  /** Out of time: the next turn closes the interview. */
  mustClose: boolean;
  /** Told to the interviewer AI, word for word. */
  directive: string;
}

export function pace(turns: readonly PacingTurn[], stage: Stage, includeDsa: boolean): Pacing {
  const budget = budgets(includeDsa)[stage];
  const answered = turns.filter((t) => t.speaker === 'CANDIDATE').length;
  const asked = turns.filter((t) => t.speaker === 'INTERVIEWER' && t.stage === stage);
  const mainAsked = asked.filter((t) => MAIN_KINDS.has(t.kind)).length;
  let followUpsOnCurrent = 0;
  for (let i = asked.length - 1; i >= 0 && !MAIN_KINDS.has(asked[i]!.kind); i--) {
    if (FOLLOW_UP_KINDS.has(asked[i]!.kind)) followUpsOnCurrent++;
  }

  const canFollowUp = followUpsOnCurrent < budget.followUps;
  const canAskNew = mainAsked < budget.main;
  const canAdvance = !canAskNew;
  const mustAdvance = !canFollowUp && !canAskNew;
  const mustClose = answered >= MAX_ANSWERS || (stage === 'WRAP_UP' && mustAdvance);

  const head =
    `Current stage: ${stage}. Main questions asked in this stage: ${mainAsked} of ${budget.main}; ` +
    `follow-ups on the current question: ${followUpsOnCurrent} of ${budget.followUps}. ` +
    `Answers so far: ${answered}.`;

  let directive: string;
  if (mustClose) {
    directive =
      answered >= MAX_ANSWERS
        ? `${head} Time is up: close the interview now (kind CLOSING, stage ${stage}) with a short, warm goodbye that says the feedback is coming.`
        : `${head} Close the interview now (kind CLOSING, stage WRAP_UP): briefly answer anything they just asked, then say goodbye and that the feedback is coming.`;
  } else if (stage === 'WRAP_UP') {
    directive =
      `${head} Allowed next: answer their question and ask if there is anything else (FOLLOW_UP, stage WRAP_UP), ` +
      'or close the interview (CLOSING, stage WRAP_UP) when they have no more questions.';
  } else {
    const options: string[] = [];
    if (canFollowUp) {
      options.push(
        `a FOLLOW_UP or CROSS_QUESTION on the current question (stage ${stage}), only if the answer calls for it`,
      );
    }
    if (canAskNew) {
      options.push(
        stage === 'CODING'
          ? 'the next coding problem (kind CODING, stage CODING, with a problem)'
          : `the next main question (kind NEW_QUESTION, stage ${stage})`,
      );
    }
    const after = nextStage(stage);
    if (canAdvance && after) options.push(`moving on to ${STAGE_ENTRY[after]}`);
    directive = mustAdvance
      ? `${head} This stage is done: move on now to ${after ? STAGE_ENTRY[after] : 'the close'}.`
      : `${head} Allowed next: ${options.join('; or ')}.`;
  }

  return {
    stage,
    answered,
    mainAsked,
    mainBudget: budget.main,
    followUpsOnCurrent,
    followUpBudget: budget.followUps,
    canFollowUp,
    canAskNew,
    canAdvance,
    mustAdvance,
    mustClose,
    directive,
  };
}

export interface ProposedTurn {
  kind: string;
  stage: Stage;
  hasProblem: boolean;
}

export interface SettledTurn {
  kind: InterviewerKind;
  stage: Stage;
  /** The interview ends with this turn. */
  closing: boolean;
  /** The AI didn't close when it had to: the API writes the goodbye. */
  forcedClose: boolean;
}

/**
 * What the AI proposed, made consistent with the pacing: never backwards,
 * at most one stage ahead, a kind that fits the stage, and a close when the
 * time is up.
 */
export function settle(pacing: Pacing, proposed: ProposedTurn): SettledTurn {
  const current = pacing.stage;
  if (pacing.mustClose) {
    return {
      kind: 'CLOSING',
      stage: current,
      closing: true,
      forcedClose: proposed.kind !== 'CLOSING',
    };
  }

  const index = (s: Stage) => STAGES.indexOf(s);
  const ceiling = nextStage(current) ?? current;
  let stage = proposed.stage;
  if (index(stage) < index(current)) stage = current;
  if (index(stage) > index(ceiling)) stage = ceiling;

  // Ending is the wrap-up's to do; earlier, the coding round may end it too.
  if (proposed.kind === 'CLOSING' && (current === 'WRAP_UP' || current === 'CODING')) {
    return { kind: 'CLOSING', stage: current, closing: true, forcedClose: false };
  }

  let kind: InterviewerKind;
  if (stage !== current) {
    kind = stage === 'CODING' ? 'CODING' : 'NEW_QUESTION';
  } else if (proposed.kind === 'CODING' || (stage === 'CODING' && proposed.hasProblem)) {
    kind = stage === 'CODING' ? 'CODING' : 'NEW_QUESTION';
  } else if (
    proposed.kind === 'FOLLOW_UP' ||
    proposed.kind === 'CROSS_QUESTION' ||
    proposed.kind === 'NEW_QUESTION'
  ) {
    kind = proposed.kind;
  } else {
    kind = 'NEW_QUESTION';
  }
  return { kind, stage, closing: false, forcedClose: false };
}
