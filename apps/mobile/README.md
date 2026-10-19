# Offerpath mobile

Flutter app, Android id `app.offerpath.mobile`. Job Hunter's phone app (pairing, push, queue, approvals, updates) with ForgeRoutine's learning pages, talking to the Offerpath API (`apps/api`). No AI runs on the phone: tutor answers, interview questions and the job hunt run on the user's desktop.

## Build and test

```bash
flutter pub get
flutter analyze
flutter test
flutter build apk --release --dart-define=OFFERPATH_SERVER_URL=http://<server-ip>:50005
```

`OFFERPATH_SERVER_URL` is the server root; the app adds `/api/v1`. Without it (a local `flutter run`), the sign-in screen asks for a server address. Leave `pubspec.yaml`'s `version:` alone: `pnpm release` stamps it, and CI sets the build number. CI names the APK `offerpath-<version>-<build>.apk` and uploads it to the server's downloads folder, which is what the in-app update check (`GET /api/v1/downloads`) reads.

Release signing comes from `ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`; without them the APK is signed with the debug key (fine for local testing only).

**Firebase is optional.** Put the Firebase console's `google-services.json` in `android/app/` (CI writes it from a secret; it is git-ignored) to get instant push notifications with the app closed. Without it the app builds the same, and alerts arrive over the hub WebSocket while it runs and from a background check about every 15 minutes (WorkManager) while it's closed.

## Signing in

- **Pair with code** (main way): the desktop shows a QR code / 6-character code under Settings > Devices. The phone redeems it with `POST /api/v1/pairing/redeem` and gets a device token.
- **Email + password**: `POST /api/v1/auth/login` (or `/auth/register` for a new account), then `POST /api/v1/devices/register` `{name, kind: "mobile", platform}` with that access token.

Either way the phone keeps only the device token (Android Keystore), which the API accepts everywhere a JWT works. Signing out clears the push token and signs the device out on the server. If the hub closes the socket with **4401** (the phone was signed out from the desktop or the web), the app forgets the token and returns to sign-in.

## How it talks to the server

| What | Where |
|---|---|
| REST | `<server>/api/v1/...` with `Authorization: Bearer <deviceToken>` (`lib/services/api_client.dart`) |
| Live link to the desktop | WebSocket `<server>/api/v1/hub?token=<deviceToken>`, frames `{v, id, type, payload}` (`lib/services/hub_client.dart`, `docs/hub-protocol.md`) |
| Hunt data while the desktop is offline | `/applications`, `/applications/:id`, `/data/:collection` |
| Learning | `/routines/*`, `/recall/*`, `/interviews/*`, `/concepts/:id{,/explainer,/chat}`, `/roadmap`, `/progress/overview` |
| Interview prep | `/interview-preps{,/:id,/:id/regenerate,/:id/questions/:questionId/answer}`, `/interview-preps/ai` (where AI would run: `desktop`, `openai` or `null`) |
| Push token | `PUT /devices/me/push-token` `{token}` (null on sign-out) |
| Updates | `GET /downloads` (no auth) |

Errors are RFC 9457 problem details (`{type, title, status, detail, errors?}`), read into `ApiException`. `POST /desktop/request` answers `{data}` or `{error: {code, message}}`. A **503** means the user's desktop (and so Claude) is offline; the learning pages show "Your desktop is offline: AI answers come back when it's on" instead of an error, and keep whatever the user typed. Interview prep is the exception: it falls back to the user's own OpenAI key, so its 503 `ai-unavailable` says "Your laptop is offline and no OpenAI key is saved: AI answers come back when it's on."

## Screens

Bottom tabs, as in `docs/plan.md` section 5.4:

- **Today**: greeting and the agent panel, today's learning (routine progress, reviews due), interview prep for the next 14 days, upcoming interviews, applications waiting on you, the queue, counts, and everything the desktop can be asked to start.
- **Learn**: today's routine (coding items point to the desktop), recall flashcards, spoken mock interviews (speech-to-text on the phone; only the text is sent), interview prep (a plan and likely questions for a real interview from its job description or technologies; practise answers typed or spoken and get them graded), and reading a concept with the tutor.
- **Hunt**: applications (approve, reject, answer questions, record interview calls) and jobs (filters, location).
- **Alerts**: the desktop's notifications, and the server's ("Interview prep is ready", `linkPage: 'interview-prep'`, opens that prep, also from a system or Firebase notification and on a cold start).
- **More**: progress, queue, job sites, saved answers, settings, about (version and update).

Every password field has a show/hide eye button labelled "Show password" / "Hide password".

## Layout

- `lib/services`: API client, hub socket, notifications, Firebase push, updates, local store.
- `lib/state`: controllers (auth, connection, applications, jobs, queue, notifications, learning, ...).
- `lib/screens`: Job Hunter's screens; `lib/learn`: the learning pages from ForgeRoutine.
- `test/`: unit and widget tests; `test/support/fake_api.dart` runs the real `ApiClient` against canned replies.
