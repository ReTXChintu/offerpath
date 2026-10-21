# Live practice

Two people practise interviews face to face with the phone on the table. The
phone listens continuously. When anyone asks an interview question, a direct
answer appears on screen within a second or two and fills in as it's written.
The answer is the answer itself, in the first person, as the user (from their
CV) or neutrally; it isn't advice about what to say. Each question and answer
is saved to review later. It's for practice with a partner, never for a real
interview.

**OpenAI Realtime only** (user decision, 2026-10-21): the user's own OpenAI
key (Settings → AI), never Claude. The model is `OPENAI_REALTIME_MODEL`
(default `gpt-realtime`). It transcribes for the caption with
`OPENAI_TRANSCRIBE_MODEL` (default `gpt-4o-mini-transcribe`).

## How it works

1. The phone asks the API for a realtime pass (`POST /live-practice/:id/realtime`).
   - The API creates an OpenAI Realtime client secret with the user's key. The secret is short-lived, so the key itself never leaves the server.
   - The session config is fixed by the API: the model, the instructions (the CV, JD and technologies, and how to answer), text-only output, input transcription, and server voice-activity detection with `create_response: true` and `interrupt_response: false`.
2. The phone opens `wss://api.openai.com/v1/realtime?model=<model>` with `Authorization: Bearer <clientSecret>`. It streams the microphone as `input_audio_buffer.append` events: PCM16, 24 kHz, mono, base64, every ~100 ms.
3. OpenAI cuts the speech at pauses and answers every turn.
   - Its instructions say to reply with exactly `-` when what was said isn't a question. The phone drops those replies.
   - A long, unbroken stretch of speech is still a single turn.
4. When an answer finishes, the phone saves it with `POST /live-practice/:id/exchanges`. The question is the transcript of the turn that triggered it.
5. OpenAI ends a realtime connection after about an hour, and a client secret only lets the phone connect for 10 minutes. On a dropped connection, the phone asks for a new pass and reconnects. The new instructions include the last saved exchanges, so follow-up questions keep their context.

Events the phone handles (GA names first, beta names after; handle both):

| Event | Use |
| --- | --- |
| `input_audio_buffer.speech_started` / `speech_stopped` | "Listening…" / "Thinking…" states |
| `input_audio_buffer.committed` (`item_id`) | a turn ended; the next response belongs to it |
| `conversation.item.input_audio_transcription.delta` / `.completed` (`item_id`, `delta` / `transcript`) | the live caption and the question text |
| `response.created` | an answer started |
| `response.output_text.delta` / `response.text.delta` (`delta`) | the answer, as it arrives |
| `response.output_text.done` / `response.text.done`, `response.done` | the answer is finished |
| `error` (`error.message`) | shown as it is |

A typed question goes as `conversation.item.create`, an item with
`role: 'user'` and `content: [{ type: 'input_text', text }]`, followed by
`response.create`.

## API

All routes are under `/api/v1`, need the bearer token, and answer problem
details on error.

```ts
type AnswerFor = 'me' | 'neutral'; // me: the prep's CV, else the synced profile; neutral: no CV

interface LiveExchange {
  id: string;
  order: number;     // 0-based
  question: string;
  answer: string;
  answerFor: AnswerFor;
  createdAt: string;
}

interface LivePracticeView {
  id: string;
  prepId: string | null;
  title: string;
  technologies: string[];
  answerFor: AnswerFor;
  status: 'ACTIVE' | 'ENDED';
  exchanges: LiveExchange[];
  createdAt: string;
  endedAt: string | null;
}

interface LivePracticeSummary {
  id: string; prepId: string | null; title: string; status: 'ACTIVE' | 'ENDED';
  exchanges: number; createdAt: string; endedAt: string | null;
}

interface RealtimePass {
  clientSecret: string;  // ek_..., for the WebSocket's Authorization header
  expiresAt: string;     // ISO; the secret must be used before then
  model: string;
  url: string;           // wss://api.openai.com/v1/realtime?model=<model>
}
```

| Route | Body | Returns |
| --- | --- | --- |
| `GET /live-practice/ready` | | `{ ready: boolean, reason: string \| null }`: false without a saved OpenAI key. |
| `GET /live-practice` | | `{ sessions: LivePracticeSummary[] }`, newest first |
| `POST /live-practice` | `{ prepId?, technologies?, title?, answerFor? }` (default `me`) | `LivePracticeView` (201). 400 without an OpenAI key. |
| `GET /live-practice/:id` | | `LivePracticeView` |
| `PATCH /live-practice/:id` | `{ answerFor?, title? }` | `LivePracticeView`. A new `answerFor` needs a new pass and a reconnect. |
| `POST /live-practice/:id/realtime` | | `RealtimePass`. 409 when the session has ended. 503 `aiUnavailable` with OpenAI's own message when it refuses. |
| `POST /live-practice/:id/exchanges` | `{ question: string (≤ 2000), answer: string (≤ 8000) }` | `LiveExchange` (201). 409 when the session has ended. |
| `POST /live-practice/:id/end` | | `LivePracticeView` with status `ENDED` |
| `DELETE /live-practice/:id` | | 204 |
