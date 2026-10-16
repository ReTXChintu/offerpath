# Hub protocol

Every desktop and phone holds one WebSocket to the API:

```
ws://<server>:50005/api/v1/hub?token=<deviceToken>
```

The token is the device token from `POST /api/v1/devices/register` (a desktop, after signing in) or `POST /api/v1/pairing/redeem` (a phone, after scanning the desktop's code). A bad or revoked token closes the socket with code **4401**. A second desktop on the same account replaces the first, which is closed with **4409**. The server pings every 25 seconds, and a device that misses a ping is dropped.

## Frames

Every frame is JSON: `{ "v": 1, "id": "<unique>", "type": "<type>", "payload": { ... } }`.

### Phone ↔ desktop (relayed, never inspected)

| Direction | Types | Notes |
|---|---|---|
| phone → desktop | requests (`list_queue`, `approve_application`, `answer_application_questions`, `start_hunt`, …) | With no desktop online the server answers for it: `response` with `{ ok: false, error: { code: "DESKTOP_OFFLINE" } }` and the request's own `id`. |
| desktop → phones | `response` (to a phone's `id`), pushes | Sent to every phone of the account; each phone ignores ids it didn't send. |
| server → phones | `presence` `{ device: "desktop", online, lastSeenAt }` | On connect, and whenever the desktop comes or goes. |
| server → phones | `changed` `{ collections: [...] }` | After every sync write: refetch those collections. |
| server → phones | `notification` `{ id, level, kind, title, body, linkPage, linkId, createdAt }` | A new unread notification the desktop synced. Also sent by Firebase push when configured. |

The web app reaches the desktop through `POST /api/v1/desktop/request` `{ type, payload }`, which the server relays as a request frame (id `srv-…`) and answers with the desktop's reply: `{ data }`, or `{ error }` with 503 (offline), 504 (timeout), 404 or 409.

### Desktop ↔ server

| Direction | Type | Payload |
|---|---|---|
| desktop → server | `hello` | `{ version, claude: { available, detail } }`, sent right after connecting and whenever Claude's availability changes. |
| server → desktop | `ai_job` | `{ jobId, job }`, where `job` is a `CliJob`: `{ tool: "CLAUDE_CODE", system, conversation, jsonSchema, model, timeoutMs }`. The frame `id` is the job id. |
| desktop → server | `ai_job_result` | `{ outcome: { stdout, stderr, code } }`, which is exactly what `claude` printed. Same `id` as the job. |
| desktop → server | `ai_job_failed` | `{ error: { message } }`, when the job couldn't run (Claude missing, not signed in, timed out). |
| server → desktop | `ai_job_cancel` | No payload; the frame `id` is the job to stop. |

## How the desktop runs an AI job

The desktop builds the argument list itself and runs nothing else:

```
claude -p --output-format json --model <model> --disallowedTools <every file, shell and web tool>
       [--system-prompt <system>] [--json-schema <schema>]
```

It writes `conversation` to stdin, runs in an empty temporary folder, with no Chrome and no `--resume`, and never through the hunt dispatcher. `claudeCodeArgs` in `packages/ai` is the reference. Learning jobs have their own small concurrency limit, so a hint never waits behind a hunt.

The server checks every answer against the agent's Zod contract and the tutor's assistance policy. It records each job in `ai_jobs` (status, model, device, output) and keeps it for 30 days.
