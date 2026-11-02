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

The desktop app and the web app do the same with the laptop on the table
(Learn → Live practice, and "Practise live with a partner" on a prep); see
[Desktop and web](#desktop-and-web). Everything below about "the phone"
applies to them too. One voiceprint per account serves every device.

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
   - The phone cuts `[audio_start_ms, audio_end_ms]` out of its ring buffer and resamples it to 16 kHz.
   - It checks the turn in **windows**: 1.5 s long, one every 0.75 s, plus one ending at the end. Windows quieter than a tenth of the loudest are pauses and skipped, and a long turn is checked in at most 16 (spread evenly). Each window's embedding is compared with the voiceprint. One score for the whole turn would blend both voices when the partner and the user speak without a 0.7 s pause.
4. The turn is the **interviewee**'s only when the windows' similarities average at or above the threshold **and** none is more than 0.15 below it: no answer; the line is labelled "You". Otherwise it's the **interviewer**'s, so a question inside a mixed turn still gets answered: the phone sends `response.create`, and the line is labelled "Interviewer". The user's own words answered by mistake cost little, since anything that isn't a question gets the skip reply and no card.
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
  clientSecret: string;  // ek_..., for the WebSocket's Authorization header (a subprotocol in browsers)
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

## Desktop and web

The same feature in `@offerpath/learn` (`src/features/live-practice`,
`src/lib/live`), routed by both apps at `/live-practice`,
`/live-practice/voice` and `/live-practice/:id`: the session list (Your
voice, New live practice, sessions newest first with Live/Ended and
Restart), the session page, the voice setup and test, and "Practise live with
a partner" on a ready prep. The session state machine
(`lib/live/controller.ts`), the event handling (`lib/live/realtime.ts`) and
the voice setup (`lib/live/voice.ts`) are ports of the phone's
`live_practice_controller.dart`, `realtime_client.dart` and
`voice_setup_controller.dart`, rule for rule: the same events,
`create_response: false` plus an explicit `response.create` for the
interviewer's turns only, one answer at a time, `-` replies dropped,
exchanges saved with retries, reconnecting with a new pass. Restart is
`POST /live-practice` with the old session's `prepId`, `technologies` and
`title` (never `answerFor`), and the new session opens listening. The API's
contract is unchanged; the desktop only gained a Tauri command for the model
download (below).

### Connecting to OpenAI from a browser

A browser's `WebSocket` can't send an `Authorization` header, so the page
authenticates the way OpenAI's own browser client does (openai-node's GA
`OpenAIRealtimeWebSocket`): the key goes as a WebSocket subprotocol.

```ts
new WebSocket(pass.url, ['realtime', `openai-insecure-api-key.${pass.clientSecret}`]);
```

The key is the `ek_` client secret from `POST /live-practice/:id/realtime`:
short-lived and minted for this session with the session config already
fixed by the API, so the page can't change the model or the instructions,
and the user's OpenAI key never leaves the server. There's no
`openai-beta.realtime-v1` subprotocol: the session is GA. The audio goes
straight to OpenAI, never through the Offerpath server. The desktop's CSP
allows `connect-src wss://api.openai.com` for it.

### The microphone

`getUserMedia({ audio: { channelCount: 1, echoCancellation: false,
noiseSuppression: false, autoGainControl: false } })`. All three are off on
purpose, as on the phone's recorder: nothing is played back (answers are
text), so there's no echo to cancel; OpenAI runs far-field noise reduction
on its side; and the browser's processing would change the voice that the
speaker model compares with a voiceprint recorded raw.

An `AudioContext` at 24 kHz (Chromium and WebView2 resample the microphone
into it) feeds an AudioWorklet (`dist/pcm-capture.worklet.js`, loaded by URL
from the app's own origin, so no `blob:` in the CSP) that posts PCM16 every
2,400 samples (100 ms). Where a 24 kHz context can't take a microphone
(Firefox), the context runs at the device's rate and the worklet resamples
linearly. The chunks go out as `input_audio_buffer.append` and into the same
60 s ring buffer the phone keeps; a turn is cut out of it by
`audio_start_ms` / `audio_end_ms` and resampled to 16 kHz exactly as on the
phone (`voice_math.dart`, ported to `lib/live/voice-math.ts`). It's then
checked window by window with the phone's rule (`speechWindows` /
`isUsersTurn`): 1.5 s windows every 0.75 s plus one ending at the end, quiet
windows skipped, at most 16; the turn is the user's only when the mean
similarity reaches the threshold and no window is more than 0.15 below it,
so a turn where the partner spoke straight after the user still gets an
answer.

Listening pauses when the window is hidden (minimised, or closed to the
tray), as the phone pauses in the background.

### Voice recognition in JavaScript

The phone's sherpa-onnx is C++; the apps run the same WeSpeaker model with
onnxruntime-web (WebAssembly, one thread, loaded only when a session starts
listening or the voice setup records) behind a JS front-end that reproduces
sherpa-onnx's (`lib/live/fbank.ts`). From sherpa-onnx's
`SpeakerEmbeddingExtractorGeneralImpl` and `FeatureExtractorConfig`, and
kaldi-native-fbank:

- 80 mel bins, 25 ms frames every 10 ms (400 / 160 samples at 16 kHz), a 512-point FFT;
- `dither` 0, `snip_edges` false (frame i is centred on sample `160 i + 80`; the edges are reflected), DC offset removed, pre-emphasis 0.97, the "povey" window;
- the power spectrum, Kaldi's mel banks from 20 Hz to 7,600 Hz (`high_freq` -400), `log(max(x, FLT_EPSILON))`, no energy column;
- the model's metadata says `normalize_samples = 0`, so the samples are scaled by 32,768 first, and has no `feature_normalize_type`, so no mean is subtracted;
- input `feats` `[1, frames, 80]`, output `embs` `[1, 256]`.

**The parity check** (`lib/live/parity.test.ts`, run in node): three 1.2 s
clips (Windows text-to-speech, two voices, 16 kHz PCM16, in
`lib/live/__fixtures__`) went through sherpa-onnx 2.0.1's Python extractor
with the model whose sha256 is `e9848563…c39012`; its embeddings, and
kaldi-native-fbank's features for one clip, are checked in next to them.

- The features are always checked: the largest difference from kaldi-native-fbank is 5.8e-5 (on values of about 5 to 25).
- The embeddings are checked when the model is on disk (`OFFERPATH_SPEAKER_MODEL=/path/to/wespeaker_en_voxceleb_resnet34_LM.onnx pnpm --filter @offerpath/learn test`): the cosine with sherpa-onnx's is 0.99999999999 for every clip (the test needs at least 0.99).

So a voiceprint made on the phone works on the laptop, and the other way round.

The model is downloaded once and kept in the Cache API under its sha256,
and checked against the sha256 every time it's loaded. The web app fetches
`GET /downloads/speaker-model/file` itself. The desktop's webview reaches the
API only through Rust, so it asks for the bytes with the `learn_api_download`
command (GET, `/downloads/...` paths only, the device token added there) and
gets them as raw IPC bytes. The desktop's CSP allows `'wasm-unsafe-eval'`
for onnxruntime's WebAssembly; both apps leave `onnxruntime-web` out of
Vite's dependency pre-bundling so it finds its `.wasm`.

### Where it can't listen

Browsers only expose `navigator.mediaDevices` in a secure context. The web
app is served over plain `http://<ip>:50004` (no TLS, by design), so there
it can't listen: `canListen()` checks `window.isSecureContext`,
`navigator.mediaDevices.getUserMedia` and AudioWorklet. Without them the
list, past sessions, Restart and typed questions (when OpenAI connects) all
work, and the list, session and voice pages say that live listening needs
the desktop app, the phone or an HTTPS address. At an HTTPS address (or on
`localhost`) the web app listens like the desktop.

The desktop's webview is a secure context (`http://tauri.localhost` counts
as localhost). WebView2 would ask "tauri.localhost wants to use your
microphone"; the app answers that itself for its own pages
(`on_permission_request`, the microphone only), so the first click on the
mic starts listening. Windows' own switch (Settings → Privacy & security →
Microphone → let desktop apps access it) still applies; when it's off,
`getUserMedia` fails and the page says how to allow it.

Still to confirm with a real microphone and a real OpenAI key: the WebView2
permission path, the 24 kHz capture, OpenAI accepting the subprotocol with an
`ek_` secret, and how well the voice check tells two real speakers apart
through a laptop microphone (the threshold is tunable in the voice setup's
test).
