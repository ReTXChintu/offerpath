# Mock interviews (interview prep)

A mock interview is a live, turn-by-turn conversation with an AI interviewer
for one interview prep. It reads the prep's CV, job description and
technologies. It moves through four stages: an introduction with follow-ups,
technology questions, coding (DSA problems when the prep includes DSA), and a
wrap-up. It cross-questions wrong answers and corrects the candidate's
grammar under each answer. At the end it writes a report: an overall score and
verdict, each question with what was said and what would have been better,
and language feedback.

AI runs like the rest of interview prep (`PrepAiRouter`): Claude on the user's
desktop first, the user's own OpenAI key when the desktop is offline. Turns
use the fast model, the report uses the reasoning model.

All routes are under `/api/v1`, need the usual bearer token, and answer
problem details on error (`aiUnavailable` is a 503).

## Interview prep: additions

`PrepInput` (create) gains:

```ts
includeDsa?: boolean; // default false: add DSA questions to the prep and DSA problems to its mock interviews
resume?: { text: string; source: 'upload' | 'profile' | 'pasted'; fileName?: string | null } | null;
```

`PATCH /interview-preps/:id` now also takes `jobDescription`, `technologies`,
`includeDsa` and `resume` (null removes the CV). Changing any of those four
rewrites the plan and questions: practice answers on the old questions are
lost, and the prep comes back `GENERATING`. Company, role and date alone don't.

`PrepView` gains:

```ts
includeDsa: boolean;
resume: { source: 'upload' | 'profile' | 'pasted'; fileName: string | null; chars: number; text: string } | null;
mockInterviews: MockInterviewSummary[]; // newest first
```

`PrepQuestionKind` gains `'DSA'`.

### CV helpers

- `POST /interview-preps/cv/extract`, body `{ fileName: string, contentBase64: string }`.
  It accepts `.pdf`, `.docx`, `.txt` and `.md` files of 4 MB or less, and returns
  `{ text: string, fileName: string, chars: number }`. It answers 400 (validation) when the
  file type isn't supported or no text comes out (a scanned PDF, for example).
  The client shows the text so the user can check it, then sends it as
  `resume` with `source: 'upload'`.
- `GET /interview-preps/cv/profile` returns `{ text: string | null }`: a CV
  written from the user's synced Offerpath profile (profile, experiences and
  projects), or null when there isn't one. It's sent as `resume` with
  `source: 'profile'`.

## Mock interview

```ts
type MockStage = 'INTRO' | 'TECHNICAL' | 'CODING' | 'WRAP_UP';
type MockStatus = 'IN_PROGRESS' | 'REPORTING' | 'COMPLETED' | 'FAILED' | 'ABANDONED';
type TurnKind =
  | 'OPENING' | 'FOLLOW_UP' | 'CROSS_QUESTION' | 'NEW_QUESTION' | 'CODING' | 'CLOSING' // interviewer
  | 'ANSWER'; // candidate

interface LanguageFix { original: string; corrected: string; note: string }

interface CodingProblem {
  title: string;
  statement: string; // markdown
  examples: { input: string; output: string; explanation: string | null }[];
  constraints: string[];
}

interface TurnView {
  id: string;
  order: number;              // 0-based, interleaved
  speaker: 'INTERVIEWER' | 'CANDIDATE';
  stage: MockStage;
  kind: TurnKind;
  text: string;               // what was said (markdown for the interviewer)
  code: string | null;        // candidate: code written for a coding question
  codeLanguage: string | null;
  problem: CodingProblem | null;  // interviewer CODING turns
  // Candidate turns, filled in once the interviewer has replied. ok = nothing to fix.
  language: { ok: boolean; corrections: LanguageFix[] } | null;
  // Candidate turns; only after the interview ends (status COMPLETED). Null before.
  assessment: { verdict: 'STRONG' | 'CORRECT' | 'PARTIAL' | 'WRONG' | 'NO_ANSWER'; note: string } | null;
  createdAt: string;
}

interface MockReport {
  overallScore: number;       // 0-10, one decimal
  verdict: 'STRONG_HIRE' | 'HIRE' | 'LEAN_HIRE' | 'LEAN_NO_HIRE' | 'NO_HIRE';
  summary: string;
  dimensions: {
    name: 'SELF_PRESENTATION' | 'TECHNICAL_DEPTH' | 'PROBLEM_SOLVING' | 'CODING' | 'COMMUNICATION' | 'LANGUAGE';
    score: number;            // 0-10
    comment: string;
  }[];
  // One per question the interviewer asked (follow-ups included), in order.
  // turnOrder is the interviewer turn's `order`; the answer is the next candidate turn.
  questions: {
    turnOrder: number;
    question: string;         // short restatement
    answerSummary: string;
    score: number;            // 0-10
    wentWell: string;
    couldBeBetter: string;
    strongerAnswer: string;   // what a strong answer would have said
  }[];
  language: { score: number; patterns: string[]; note: string };
  strengths: string[];
  improvements: string[];
  nextSteps: string[];
}

interface MockInterviewView {
  id: string;
  prepId: string;
  status: MockStatus;
  stage: MockStage;
  stages: MockStage[];        // the order shown in the progress bar
  // The last turn is the candidate's: the interviewer is replying (`replying`)
  // or the reply failed (POST .../reply retries it).
  awaitingReply: boolean;
  replying: boolean;
  aiSource: 'desktop' | 'openai' | null;
  turns: TurnView[];
  answered: number;           // candidate turns so far
  report: MockReport | null;  // when COMPLETED
  overallScore: number | null;
  error: string | null;       // why the report or the last reply failed
  startedAt: string;
  endedAt: string | null;
}

interface MockInterviewSummary {
  id: string;
  status: MockStatus;
  stage: MockStage;
  overallScore: number | null;
  verdict: MockReport['verdict'] | null;
  answered: number;
  startedAt: string;
  endedAt: string | null;
}
```

### Routes

| Route | Body | Returns |
| --- | --- | --- |
| `POST /interview-preps/:id/mock-interviews` | `{ restart?: boolean }` | `MockInterviewView`: the prep's interview still in progress, or a new one. `restart: true` abandons the one in progress first. The opening question is there at once (no AI wait). |
| `GET /mock-interviews/:id` | | `MockInterviewView` |
| `POST /mock-interviews/:id/answer` | `{ text?: string, code?: string \| null, codeLanguage?: string \| null }` (text ≤ 8000, code ≤ 20000, at least one of them) | `MockInterviewView` with the interviewer's next turn. Synchronous: 5–60 s. 409 when the interview isn't in progress or a reply is already pending. 503 `aiUnavailable` when no AI is reachable or the call fails: the answer **is saved** (`awaitingReply: true`); retry with `reply`. |
| `POST /mock-interviews/:id/reply` | | `MockInterviewView`: retries the interviewer's reply to the last answer. Same errors. |
| `POST /mock-interviews/:id/finish` | | `MockInterviewView` with status `REPORTING`: ends the interview early and writes the report in the background. |
| `POST /mock-interviews/:id/report` | | `MockInterviewView`: writes a `FAILED` report again. |
| `DELETE /mock-interviews/:id` | | 204 |

The interviewer also ends the interview itself: its `CLOSING` turn moves the
interview to `REPORTING`. While it is `REPORTING`, poll `GET` every 4 seconds
(or refresh on the hub's `changed` frame for `interview_preps`). When the report
is ready, the phone gets a notification:
`kind: 'MOCK_INTERVIEW_REPORT_READY'`, `linkPage: 'mock-interview'`, `linkId: <interview id>`.
A report waiting for an offline desktop starts when it comes back online.

## Stages

The server holds the interviewer to a budget and tells it when to move on:

- **Intro:** "tell me about yourself", then up to two follow-ups on what was said and on the CV.
- **Technical:** four main questions from the JD, technologies and CV. Each can have up to two follow-ups, and a wrong answer gets a cross-question.
- **Coding:** two DSA problems when `includeDsa` is on, otherwise one practical coding task in the role's stack. Then follow-ups on complexity and edge cases.
- **Wrap-up:** "any questions for me?", then `CLOSING`.

Stages only move forward. After 30 answers the interview closes regardless.
