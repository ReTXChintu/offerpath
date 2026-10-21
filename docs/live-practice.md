# Live practice

Two people practise interviews together, face to face, with the phone on the
table. They take turns asking each other questions. The phone listens: what
is said is transcribed. When someone asks a question, an AI answer appears
for comparison. When the spoken answer is over, it is scored against the AI's
answer. It's for practice with a partner, never for a real interview.

**OpenAI only** (user decision, 2026-10-21): live practice needs speed, so it
runs on the user's own OpenAI key (Settings → AI), never Claude. Without a
saved key it doesn't start. Transcription uses `OPENAI_TRANSCRIBE_MODEL`
(default `gpt-4o-mini-transcribe`). Analysis and grading use the key's fast
model.

## How the phone talks to the API

The phone records the microphone and cuts the audio into segments at
pauses, using a simple voice-activity check on the input level. A segment
ends after about 1.2 s of silence, and none runs longer than 30 s. Each
segment goes to `POST /live-practice/:id/audio`, one at a time and in order.
The response is the whole updated session. The API transcribes the segment,
then classifies what was said:

- **QUESTION**: a new question card, with the AI answer.
- **ANSWER**: part of the spoken answer to the latest question.
- **OTHER**: small talk, "okay", or noise. It goes in the transcript only.

When a new question arrives, the previous question's spoken answer is graded
in the background. "Grade now" and ending the session grade it as well.

All routes are under `/api/v1`, need the bearer token, and answer problem
details on error.

```ts
type AnswerFor = 'me' | 'neutral'; // me: from the prep's CV, else the synced profile; neutral: no CV
type LineKind = 'QUESTION' | 'ANSWER' | 'OTHER';

interface LiveLine {
  id: string;
  order: number;
  text: string;
  kind: LineKind;
  questionId: string | null; // QUESTION lines and the ANSWER lines that belong to it
  createdAt: string;
}

interface LiveQuestion {
  id: string;
  order: number;              // 0-based
  text: string;               // the question, tidied up
  answerFor: AnswerFor;       // what the AI answer was written for
  aiAnswer: {
    summary: string;          // one or two sentences
    points: string[];         // 1-6 talking points
    detail: string;           // a fuller answer, markdown ('' when there is nothing to add)
  };
  spokenAnswer: string | null; // the ANSWER lines joined; null before anyone answered
  score: number | null;       // 0-10 once graded
  feedback: { covered: string[]; missed: string[]; feedback: string } | null;
  grading: boolean;           // a grade is being written now
  gradedAt: string | null;
  createdAt: string;
}

interface LivePracticeView {
  id: string;
  prepId: string | null;
  title: string;              // the prep's role/company, the technologies, or "Live practice"
  technologies: string[];
  answerFor: AnswerFor;
  status: 'ACTIVE' | 'ENDED';
  lines: LiveLine[];
  questions: LiveQuestion[];
  stats: { questions: number; graded: number; averageScore: number | null };
  createdAt: string;
  endedAt: string | null;
}

interface LivePracticeSummary {
  id: string; prepId: string | null; title: string; status: 'ACTIVE' | 'ENDED';
  stats: LivePracticeView['stats']; createdAt: string; endedAt: string | null;
}
```

| Route | Body | Returns |
| --- | --- | --- |
| `GET /live-practice/ready` | | `{ ready: boolean, reason: string \| null }`: false without a saved OpenAI key (or when the server can't decrypt keys). |
| `GET /live-practice` | | `{ sessions: LivePracticeSummary[] }`, newest first |
| `POST /live-practice` | `{ prepId?: string, technologies?: string[], title?: string, answerFor?: AnswerFor }` (default `me`) | `LivePracticeView` (201). 400 when there's no OpenAI key. |
| `GET /live-practice/:id` | | `LivePracticeView` |
| `PATCH /live-practice/:id` | `{ answerFor?, title? }` | `LivePracticeView`. `answerFor` affects questions asked from now on. |
| `POST /live-practice/:id/audio` | `{ audioBase64: string, fileName: string, durationMs: number }` (m4a/aac, wav, mp3 or webm; up to 4 MB) | `LivePracticeView` after the segment. A segment shorter than 400 ms, or one with no words in it, adds nothing. 503 `aiUnavailable` when OpenAI fails (the segment is lost; keep listening). |
| `POST /live-practice/:id/text` | `{ text: string }` (≤ 4000) | The same as audio, for typed input. |
| `POST /live-practice/:id/questions/:questionId/grade` | | `LivePracticeView`, with that question graded (synchronous, a few seconds). |
| `POST /live-practice/:id/end` | | `LivePracticeView` with status `ENDED`. Ungraded answered questions are graded in the background; poll `GET` while any is `grading`. |
| `DELETE /live-practice/:id` | | 204 |

An `ENDED` session refuses audio and text with 409.

Whether answers show at once or only after the spoken answer is a setting on
the phone, not on the server.
