/**
 * Live practice (docs/live-practice.md): two people practise interviews face
 * to face while an OpenAI Realtime session listens. Whenever anyone asks an
 * interview question, it answers it, directly, as text. These are that
 * session's instructions; the API puts them into the realtime client secret,
 * so nothing about the prompt lives on the phone.
 */

/** What the model replies when what it heard isn't a question to answer. */
export const LIVE_SKIP = '-';

export interface LiveAnswererInput {
  company: string | null;
  role: string | null;
  jobDescription: string | null;
  technologies: readonly string[];
  /** The CV to answer as; null answers neutrally. */
  resume: string | null;
  /** The last saved questions and answers, oldest first, after a reconnect. */
  earlier: readonly { question: string; answer: string }[];
}

export function liveAnswererInstructions(input: LiveAnswererInput): string {
  const background = [
    input.company ? `Company: ${input.company}` : '',
    input.role ? `Role: ${input.role}` : '',
    input.technologies.length > 0 ? `Technologies: ${input.technologies.join(', ')}` : '',
    input.jobDescription
      ? `Job description:\n"""\n${input.jobDescription.slice(0, 5_000)}\n"""`
      : '',
    input.resume
      ? `You are this candidate. Their CV:\n"""\n${input.resume.slice(0, 8_000)}\n"""`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  const earlier =
    input.earlier.length > 0
      ? `Questions already answered in this session (for follow-ups):\n${input.earlier
          .map((e) => `Q: ${e.question}\nA: ${e.answer.slice(0, 600)}`)
          .join('\n\n')}`
      : '';

  return [
    `You listen to two people practising job interviews together and you answer every interview question you hear. Either of them may ask; there are no turns.

How to answer:
- Answer the question itself, directly, as the candidate would say it in the interview. Never give advice about what to say, never "you could mention", no talking points about the answer, no preamble, no restating the question.
- ${input.resume ? "Speak in the first person as the candidate, using their real projects, numbers and technologies from the CV where they fit. Never invent experience the CV doesn't show; where it has nothing relevant, answer from solid general knowledge." : 'Answer neutrally, as a strong candidate would, without inventing personal history.'}
- Be correct, specific and current. Usually 3 to 6 sentences; longer only when the question needs it (a design or a coding question). For coding, give the approach in a sentence, then the code in a markdown code block, then the complexity.
- Speech recognition is imperfect: read through mistakes in technical terms and answer what was meant.
- If what you heard is not an interview question to answer (small talk, an answer someone is giving, "okay", "next one", noise, an unfinished sentence), reply with exactly ${LIVE_SKIP} and nothing else.
- Write plain text; markdown only for code.`,
    background,
    earlier,
  ]
    .filter(Boolean)
    .join('\n\n---\n\n');
}
