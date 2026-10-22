# Live practice

Two people practise interviews face to face with the phone on the table. The
person whose account runs the session is the **interviewee** for the whole
session, and every other voice is the **interviewer**. To swap roles, the
partner starts a session on their own account and phone.

The phone recognises the interviewee's voice on the device. When the
interviewer asks a question, a direct answer appears within a second or two
and fills in as it's written. The answer is in the first person, from the
interviewee's CV; it isn't advice about what to say. What the interviewee
says is never answered. Each question and its answer is saved to review
later. It's for practice with a partner, never for a real interview.

**OpenAI Realtime only** (user decision, 2026-10-21): the user's own OpenAI
key (Settings → AI), never Claude.

- The model is `OPENAI_REALTIME_MODEL`, default `gpt-realtime-2.1`.
- The captions use `OPENAI_TRANSCRIBE_MODEL`, default `gpt-transcribe`. That's the model OpenAI recommends for transcription inside a Realtime session.
- Voice recognition is on the phone, never OpenAI: sherpa-onnx with WeSpeaker ResNet34-LM (English, VoxCeleb). OpenAI's only diarization model shuts down on 2027-02-26, and Realtime never had speaker labels.

## Your voice (once per account)

1. The phone downloads the speaker model once from `GET /downloads/speaker-model/file`, checks its `sha256` against `GET /downloads/speaker-model`, and keeps it.
2. The user reads three short sentences, about 4–6 s each. The model turns each into an embedding, and the three are averaged into the user's voiceprint. It's saved with `PUT /live-practice/voice`, with the model's name and a match threshold, so it survives a reinstall. Recording it again replaces it; `DELETE` removes it.
3. A test mode records a phrase and shows how closely it matches (a cosine similarity) and the verdict. That's how the threshold is tuned, and the user can change it.

## A session

1. The phone asks for a realtime pass (`POST /live-practice/:id/realtime`).
   - The API creates an OpenAI Realtime client secret with the user's key. It's short-lived; the key never leaves the server.
   - The session config is fixed by the API:
     - the model, and the instructions (the CV, JD and technologies, and how to answer);
     - text output only, and input transcription;
     - far-field noise reduction, because the phone is on the table;
     - server voice activity detection with **`create_response: false`**, because the phone decides what gets an answer.
2. The phone opens `wss://api.openai.com/v1/realtime?model=<model>` with `Authorization: Bearer <clientSecret>`. It streams the microphone as `input_audio_buffer.append` events: PCM16, 24 kHz, mono, base64, every ~100 ms. It also keeps the last ~60 s of what it sent in a ring buffer, indexed by milliseconds since this connection started.
3. OpenAI's voice detection marks each turn with `input_audio_buffer.speech_started` (`audio_start_ms`, `item_id`) and `speech_stopped` (`audio_end_ms`).
   - Both times are milliseconds from the start of all audio sent on this connection, and `audio_start_ms` already includes the prefix padding.
   - The phone cuts `[audio_start_ms, audio_end_ms]` out of its ring buffer, resamples it to 16 kHz, and compares its embedding with the voiceprint.
4. If the cosine similarity is at or above the threshold, it's the **interviewee**: no answer; the line is labelled "You". Otherwise it's the **interviewer**: the phone sends `response.create`, and the line is labelled "Interviewer".
   - A turn shorter than about 1 s is too short to tell, so it counts as the interviewer. If it isn't a question, the model replies `-`.
   - The instructions say to reply with exactly `-` to anything that isn't an interview question. The phone drops those replies.
5. When an answer finishes, the phone saves it with `POST /live-practice/:id/exchanges`. The question is the transcript of the interviewer's turn.
6. OpenAI ends a realtime connection after about an hour, and a pass only lets the phone connect for 10 minutes. On a dropped connection the phone gets a new pass and reconnects; the ring buffer and the milliseconds start again from zero. The new instructions include the last saved exchanges, so follow-ups keep their context.

Events the phone handles (GA names first, beta names after; handle both):

| Event | Use |
| --- | --- |
| `input_audio_buffer.speech_started` (`audio_start_ms`, `item_id`) / `speech_stopped` (`audio_end_ms`, `item_id`) | the turn's audio, for the speaker check; the "Listening…" state |
| `input_audio_buffer.committed` (`item_id`) | the turn is in the conversation; it's safe to send `response.create` for it |
| `conversation.item.input_audio_transcription.delta` / `.completed` (`item_id`, `delta` / `transcript`) | the caption and the question text |
| `response.created` | an answer started |
| `response.output_text.delta` / `response.text.delta` (`delta`) | the answer, as it arrives |
| `response.output_text.done` / `response.text.done`, `response.done` | the answer is finished |
| `error` (`error.message`) | shown as it is |

A typed question always counts as the interviewer's. It goes as
`conversation.item.create`, an item with `role: 'user'` and
`content: [{ type: 'input_text', text }]`, then `response.create`.

## API

All routes are under `/api/v1` and answer problem details on error. The
`/downloads` routes are public; the rest need the bearer token.

```ts
interface LiveExchange {
  id: string;
  order: number;     // 0-based
  question: string;
  answer: string;
  answerFor: 'me' | 'neutral'; // always 'me' from the phone now
  createdAt: string;
}

interface LivePracticeView {
  id: string;
  prepId: string | null;
  title: string;
  technologies: string[];
  answerFor: 'me' | 'neutral';
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
  expiresAt: string;     // ISO; connect before then
  model: string;
  url: string;           // wss://api.openai.com/v1/realtime?model=<model>
}

interface VoiceProfile {
  model: string;         // the speaker model's file name, e.g. 'wespeaker_en_voxceleb_resnet34_LM.onnx'
  embedding: number[];   // the averaged voiceprint (32-1024 numbers)
  threshold: number;     // 0-1: at or above it, a turn is the interviewee's
  updatedAt: string;
}

interface SpeakerModelInfo {
  fileName: string;
  sizeBytes: number;
  sha256: string;        // hex
  url: string;           // /api/v1/downloads/speaker-model/file
}
```

| Route | Body | Returns |
| --- | --- | --- |
| `GET /downloads/speaker-model` | | `SpeakerModelInfo` (public), 404 when the server has none |
| `GET /downloads/speaker-model/file` | | the model file (public) |
| `GET /live-practice/voice` | | `VoiceProfile`, 404 before one is saved |
| `PUT /live-practice/voice` | `{ model, embedding, threshold? }` (default 0.5) | `VoiceProfile` |
| `PATCH /live-practice/voice` | `{ threshold }` | `VoiceProfile` |
| `DELETE /live-practice/voice` | | 204 |
| `GET /live-practice/ready` | | `{ ready: boolean, reason: string \| null }`: false without a saved OpenAI key |
| `GET /live-practice` | | `{ sessions: LivePracticeSummary[] }`, newest first |
| `POST /live-practice` | `{ prepId?, technologies?, title? }` | `LivePracticeView` (201). 400 without an OpenAI key |
| `GET /live-practice/:id` | | `LivePracticeView` |
| `PATCH /live-practice/:id` | `{ title? }` | `LivePracticeView` |
| `POST /live-practice/:id/realtime` | | `RealtimePass`. 409 when the session has ended. 503 `aiUnavailable` with OpenAI's own message when it refuses |
| `POST /live-practice/:id/exchanges` | `{ question: string (≤ 2000), answer: string (≤ 8000) }` | `LiveExchange` (201). 409 when the session has ended |
| `POST /live-practice/:id/end` | | `LivePracticeView` with status `ENDED` |
| `DELETE /live-practice/:id` | | 204 |

The server keeps the speaker model at `<DOWNLOADS_DIR>/models/speaker-embedding.onnx`.
It isn't in git, and releases don't touch it; `docs/deploy.md` says how to put it there.
