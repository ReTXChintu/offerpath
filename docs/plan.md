# Offerpath: plan for the new app

> **Offerpath** — finds the jobs, gets you ready for the interviews, and moves you one step closer to the offer every day.

Status: plan, 2026-10-15. Phases 0-6 done 2026-10-16 (scaffold, API, desktop, learning UI, web, mobile, goal and daily plan); phase 7 (cutover) prepared, see docs/deploy.md. Replaces the earlier merge study in
[job-hunter/docs/merge-plan.md](../../job-hunter/docs/merge-plan.md), whose "two services behind one gateway" approach no
longer fits: this is a **new repository** that takes the best code from Job Hunter
and ForgeRoutine, runs **one** backend on **one** database, and uses **Claude CLI as
its only AI**.

---

## 1. Decisions already made

| | Decision |
|---|---|
| Repo | New repository. Job Hunter and ForgeRoutine are archived read-only once the cutover is done. |
| AI | Claude CLI, run on the user's own desktop. Exceptions: interview prep falls back to the user's own OpenAI key when their desktop is offline (2026-10-19); live practice runs on that key only, for speed (2026-10-21). No server-wide key; no Anthropic API / Gemini / Codex. |
| Surfaces | Desktop (everything), Web (supporter: mostly the learning side), Mobile (on the go), API. |
| Server | Same box (`187.127.179.114`). Job Hunter and ForgeRoutine are removed from it after the data is moved; Offerpath takes their place. |
| Database | PostgreSQL on Neon (external, free tier; sleeping when idle is fine). ForgeRoutine's database is already on Neon. MongoDB Atlas is retired after migration. |
| Redis | The one already on the server, reused, with an `offerpath:` key prefix. |
| Hosting | `http://<server-ip>:<port>`, no nginx (Traefik already owns ports 80 and 443 on the server). Web app on 50004, API on 50005. |
| Users | Multi-user, **open sign-up**: anyone can create an account and set it up for their own goal, on their own desktop with their own Claude. |
| Workspace | `D:\Personal\offerpath-workspace\` holds `offerpath\` (this repo, new code), `job-hunter\` and `forge-routine\` (the two source apps, for reference and data migration). |

## 2. Name and identifiers

**Offerpath** (chosen). The path to the offer, one day at a time: today's learning, today's applications, the next interview.

| What | Value |
|---|---|
| Repo / folder | `offerpath` (`D:\Personal\offerpath-workspace\offerpath`) |
| npm scope | `@offerpath/*` |
| Rust crates | `offerpath-core`, desktop crate `offerpath-desktop` |
| Desktop app id | `app.offerpath.desktop` (product name "Offerpath") |
| Android app id | `app.offerpath.mobile` |
| Local data dir | `%APPDATA%\Offerpath` |
| PM2 processes | `offerpath-api`, `offerpath-sandbox` |
| Redis prefix | `offerpath:` |
| First version | `0.1.0`, one version for the whole repo |

New ids mean a fresh install on every device (new Firebase app, new Android keystore, new Tauri updater key). That's the price of a clean product; old data is imported (section 9).

## 3. The product idea: one goal, one daily plan

Both apps already do half of the same job. Offerpath makes the link explicit:

- **Goal.** Target role(s), target companies, target date, locations. Set once in onboarding, editable.
- **Daily plan ("Today").** Every morning: what to learn (spaced recall, today's concepts, one blind-coding exercise), what to do in the hunt (approvals, questions waiting, applications to review), and what's coming (interviews, deadlines). Small, finishable, every day.
- **Hunt → Learn.** The skills job postings keep asking for and the analysis marks missing feed the learning roadmap. "React (hooks)" is matched, but "Next.js" missing in 12 of your best-match jobs puts Next.js on the roadmap.
- **Interview call → Interview prep.** Recording an interview call (already built) creates a prep track for that company and role: mock interviews with that stack, before the date.
- **Learn → Hunt.** Verified skills and the Independent Coding Score feed the resume generator: it can only claim what you've shown.
- **Progress.** One page: skill model, coding score, hunt funnel (found → applied → interviews → offers), streak.

## 4. Architecture

```
offerpath/
  apps/
    api/          NestJS (from ForgeRoutine api) + the Job Hunter backend's jobs, ported in
    web/          React 19 + Vite: the supporter web app (shell only; features come from packages)
    desktop/      Tauri 2 + React 19: the full app (shell only; features come from packages)
    mobile/       Flutter (from Job Hunter's app) + ForgeRoutine's learning pages
    sandbox/      Code-execution worker (from ForgeRoutine; BullMQ on the server's Redis)
  crates/
    offerpath-core/   Rust core (from job-hunter-core): hunt pipeline, Claude runner, local store,
                     sync, approval gating, + the AI-job executor for learning features
  packages/
    ui/              Design system: tokens, components (one look for web and desktop)
    learn/           Learning features as React components + hooks (routine, recall, practice,
                     interviews, roadmap, technologies, progress) over an injected API client
    hunt/            Hunt features (jobs, applications, approvals, job sites, queue) over an
                     injected client: Tauri commands on desktop, the API on web
    types/           Shared TS types (mirror Rust domain + API DTOs)
    shared/          Pure TS logic (filters, labels, approval guards, scoring maths)
    ai/              Agent definitions only: prompts, Zod output contracts, assistance policy.
                     No providers.
    database/        Prisma schema + migrations (Neon)
    curriculum/      Knowledge-graph algorithms + seed data
    sandbox/         Isolated code runner
    terminal/        Simulated shell for engineering challenges
    validation/      Zod schemas for every boundary
    config/          One validated read of the root .env
  agent/            Claude prompts/skills/schemas for the hunt (embedded in the Rust core)
  ecosystem.config.cjs   PM2 processes
  scripts/          sync-versions, server-update, migrations from the old apps, check-all
  docs/
```

### 4.1 One backend: NestJS on Neon

ForgeRoutine's API is the larger, more structured backend (14k lines, modular hexagonal, Prisma). It becomes the only backend. Job Hunter's Fastify backend (1.9k lines) is ported into it as new modules:

| New Nest module | From Job Hunter backend | Notes |
|---|---|---|
| `devices` | `routes/devices.ts`, `routes/pairing.ts` | One `devices` table for desktops and phones (kind DESKTOP / MOBILE). QR pairing. Opaque device tokens accepted by the same auth guard as JWTs. |
| `hub` | `hub.ts`, `routes/ws.ts` | **One** WebSocket per desktop (today there are two: Job Hunter's relay and ForgeRoutine's agent socket). Carries relayed requests from phone/web, AI jobs, presence, agent status, notifications. |
| `sync` | `routes/data.ts`, `db.ts` | The desktop's local-first store keeps syncing over the same three routes. Server side becomes a Postgres `sync_documents` table (`user_id, collection, id, doc jsonb, updated_at, deleted_at`) with indexes on the fields the web reads. The Rust sync code doesn't change. |
| `hunt-views` | `/v1/applications` joined views | Typed read endpoints for web and mobile (applications with job + analysis, jobs, upcoming interviews). |
| `notifications` | `models.ts` notifications + `push.ts` | Postgres table, pushed over the hub and FCM (new Firebase project for the new app ids). |
| `downloads` | `routes/static.ts`, `/v1/downloads` | APK, Windows installer, Tauri updater manifest. |

MongoDB goes away. ForgeRoutine's 41 Prisma models move to Neon unchanged, plus the new tables: `devices`, `sync_documents`, `notifications`, `ai_jobs`, `goals`, `daily_plans`.

Removed from ForgeRoutine's API: `ai_credentials`, provider routing, the vendor model switcher, per-user API keys, the Agent pairing-code flow (replaced by device sign-in), the server-side CLI spawn path.

### 4.2 AI: Claude CLI on the user's desktop, nothing else

This is the biggest behavioural change for the learning side, which today calls AI from the server.

- **Every AI call is a job.** The API writes an `ai_jobs` row (agent, input, output schema, model, priority, requester) and hands it to the user's connected desktop over the hub. The desktop runs it with its local `claude` and returns the structured result. The API validates it against the agent's Zod contract and the assistance policy (the code-withholding tutor rules stay exactly as they are, including their regression tests).
- **On the desktop:** learning jobs run through the same Claude runner as the hunt, with no tools, `--strict-mcp-config`, an empty working folder, no Chrome, no file access. They have their own small concurrency limit so a 20-second hint never waits behind a 3-hour hunt, and they never touch the hunt queue or approval gating.
- **When the desktop is off:**
  - Content is generated ahead: overnight (like the job-site profile sync), the desktop prepares tomorrow's plan, the next exercises, recall prompts and interview questions. Most of a day's learning then needs no live AI at all.
  - Interactive AI (tutor hints, code evaluation feedback, live mock interviews) shows "Your desktop is offline: hints come back when it's on" and the job waits, with a notification when the answer is ready. Running and testing code still works, because the sandbox is on the server.
- **Models:** the user picks Claude models per kind of work (e.g. Sonnet for tutoring, Opus for curriculum generation) in Settings. That's the only AI setting.
- **Removed:** OpenAI, Anthropic API, Gemini and Codex adapters, `CODEX_BIN`, Codex discovery, `ENCRYPTION_KEY` (if nothing else uses it), the Agent tray app.

### 4.3 One desktop app

Job Hunter's Tauri app is the base: it already runs Claude, drives Chrome, keeps the local store, syncs, and serves the phone. It gains:

- The learning features (from `packages/learn`), talking to the API.
- The AI-job executor for learning (section 4.2).
- Tray icon, close-to-tray, single instance: the desktop is the user's AI, so it should stay on. The first-run screen says so plainly.
- An importer for old Job Hunter data (section 9).

### 4.4 One look for web and desktop

ForgeRoutine's web UI is 10.9k lines (React 18, hand-written design system from `design.html`); Job Hunter's desktop UI is 5.9k lines (React 19, Chakra v3). The learning UI is the bigger body of work and must render on both web and desktop, so:

- `packages/ui` is built from ForgeRoutine's design system (tokens + components), re-skinned with the Offerpath brand, on React 19, with light and dark themes and accessible primitives (dialog, menu, tabs, toast) underneath.
- ForgeRoutine's pages move into `packages/learn` mostly as they are (React 18 → 19 is small).
- Job Hunter's desktop pages are rebuilt on `packages/ui` into `packages/hunt` (about 6k lines; the logic in `packages/shared` and the queries carry over, the Chakra markup doesn't).
- Monaco stays for coding on web and desktop.

## 5. UI plan

### 5.1 Who does what

| Feature | Desktop | Web | Mobile |
|---|---|---|---|
| Today (daily plan) | Full | Full | Full |
| Goal and onboarding | Full | Full | View |
| Roadmap, technologies, concepts | Full | Full | View |
| Learn a concept (reading + tutor) | Full | Full | Read, ask tutor |
| Practice: exercises, blind coding (Monaco + sandbox) | Full | Full | No (needs a keyboard) |
| Recall (spaced review) | Full | Full | Full (flashcards) |
| Mock interviews | Full (typed or spoken) | Full (typed) | Full (spoken) |
| Progress (skills, coding score, hunt funnel) | Full | Full | Summary |
| Job search (hunts, sources, companies, Telegram) | Full (runs here) | Start / stop | Start / stop |
| Jobs list, filters, location | Full | Read | Read |
| Applications: review, approve, answer questions, apply | Full (runs here) | Approve, reject, answer | Approve, reject, answer |
| Resume and cover letter editing | Full | View | View |
| Job-site profiles, Gmail replies, interview calls | Full | View, record calls | View, record calls |
| Queue, agent activity, logs | Full | Queue | Queue |
| Settings: account, devices, pairing | Full | Account, devices | Account |
| Settings: candidate profile, sources, AI models, Chrome | Full | No | No |
| Downloads (desktop installer, APK) | – | Yes | – |

Rule of thumb: **anything that needs Chrome, local files or Claude runs on the desktop**; web and mobile can ask the desktop to do it (through the queue) and review the result.

### 5.2 Desktop

Left sidebar, three groups, plus a status bar:

- **Today** — the daily plan: learning items, hunt to-dos (approvals, questions), interviews coming up, streak and progress toward the goal. One "Start my day" button.
- **Grow**
  - Roadmap (the goal's skill tree, what's next and why)
  - Learn (concepts by technology)
  - Practice (exercises, blind coding, projects, engineering challenges)
  - Recall
  - Interviews (mock interviews, reports; prep tracks for real interview calls)
- **Hunt**
  - Jobs (filters, location, company careers, Telegram, links, "a job I found")
  - Applications (review, approve, answers, interviews, replies)
  - Job sites (profile sync)
- **Progress** — skills, coding score, hunt funnel, history.
- Bottom: **Agent** (activity, queue, runs, logs), **Settings**.
- Top bar: Cmd-K command palette, notification bell, sync / desktop status.
- Status bar: what the agent is doing, queue count, and "Tutor running" when a learning job is in progress.

### 5.3 Web (supporter)

Same design system, lighter shell. The learning side in full, the hunt side as a remote control:

- **Today**, **Roadmap**, **Learn**, **Practice**, **Recall**, **Interviews**, **Progress** — the same `packages/learn` components as the desktop.
- **Hunt**: "Needs you" (approvals, questions), Applications (read, approve, reject, answer, record an interview call), Jobs (read, filter), Start a job hunt / Company careers / Stop.
- **Settings**: account, devices (desktops and phones, revoke), downloads.
- A strip at the top when the desktop is offline: "Your desktop is offline: AI and job hunting wait for it. Practice and recall still work."

### 5.4 Mobile

Job Hunter's Flutter app (pairing, push, queue, updates) with the learning pages from ForgeRoutine's app, in Offerpath's brand:

- **Today** — the daily plan, the agent panel, what's queued.
- **Learn** — today's routine, recall flashcards, spoken mock interviews, reading.
- **Hunt** — applications (approve, answer, record interview calls), jobs (filters, location).
- **Alerts** — one list for everything.
- **More** — progress, queue, job sites, saved answers, settings, about.

Password fields get the show/hide eye button with "Show password" / "Hide password" labels on every surface.

## 6. Accounts and devices

- ForgeRoutine's auth is the base: email + password (bcrypt), 15-minute JWT, rotating refresh tokens for the web.
- Desktop and phone sign in once and get a **device token** (opaque, stored hashed, revocable). The same auth guard accepts JWTs and device tokens, so every surface calls every endpoint with what it holds.
- Phones pair by scanning a QR code on the desktop (Job Hunter's flow), or sign in with email.
- Settings > Devices lists desktops and phones with last seen and revoke.
- One desktop online per account at a time, as today; signing in on a second computer takes over.

## 7. Server

- **Two public ports, no reverse proxy** (decided 2026-10-15). Traefik already holds 80 and 443 on the server, so Offerpath is reached as `http://<server-ip>:<port>`, like the two apps today:
  - **50004** (`OFFERPATH_WEB_PORT`): the built web app, PM2's static server in single-page mode.
  - **50005** (`OFFERPATH_API_PORT`): the API: `/api/v1/*` REST and `/api/v1/hub` WebSocket, `/downloads/*` (APK, Windows installer) and `/updates/*` (Tauri updater manifest). CORS allows the web app's origin (`OFFERPATH_CORS_ORIGINS`).

  The desktop and the phone get the API address compiled in (`OFFERPATH_SERVER_URL`).
- **These are ForgeRoutine's ports today.** ForgeRoutine's web and API must be stopped on the server before Offerpath starts there, so on the server the two can't run side by side; rehearse the cutover locally or on a Neon branch instead.
- **Processes (PM2):** `offerpath-api`, `offerpath-web` and `offerpath-sandbox` (code-execution worker, no port; it talks to the API through Redis/BullMQ).
- **TLS later, optionally:** since Traefik is already on the server, a domain can be routed to `:50004` and `:50005` with a Let's Encrypt certificate without touching the app. That's a client-config change (a new server URL), not a rewrite. Until then it's plain HTTP like today: the desktop updater keeps its signed-manifest check, and the APK allows cleartext to the server.
- **Neon (free tier):** pooled `DATABASE_URL` for the app, direct `DIRECT_DATABASE_URL` for `prisma migrate deploy`. The database sleeps when idle; the first request after a pause takes a few seconds, and the API retries the connection instead of failing. Neon branches give a throwaway copy for migration rehearsals. Watch the free storage limit (0.5 GB): job descriptions and run events are the biggest rows, so old agent events are pruned after 30 days.
- **Redis:** the existing server Redis, `offerpath:` prefix, for BullMQ (code execution, AI-job delivery), rate limits and cache.
- **Deploy:** tag → CI builds the Windows installer (signed updater) and the APK → uploads them → SSH `git pull && scripts/server-update.sh` (install, `prisma migrate deploy`, build, `pm2 reload`). Push/PR CI runs Rust, TS, Flutter and the API's Postgres-backed tests.
- **One `.env`** at the repo root, documented in `.env.example`.

## 8. Phases

Each phase ends with something that runs. Weeks assume near full-time solo work.

| # | Phase | Weeks | Done when |
|---|---|---|---|
| 0 | **Scaffold** — new repo, names and ids, pnpm + Turborepo + Cargo workspace + Flutter, root `.env`, Neon project, Redis prefix, CI (push/PR + tags), release-it + sync-versions, docs, CLAUDE.md with the carried-over rules | 1 | Empty apps build in CI; `pnpm release` stamps every app |
| 1 | **API** — ForgeRoutine's API moved in, AI providers removed, `ai_jobs` + hub with the AI-job protocol; Job Hunter backend modules ported (devices, pairing, hub relay, sync on `sync_documents`, hunt views, notifications + FCM, downloads); Prisma on Neon; API tests green against a Neon branch | 3 | Desktop protocol and sync work against the new API in tests; learning endpoints work with a fake desktop answering AI jobs |
| 2 | **Desktop** — `offerpath-core` from job-hunter-core, one hub socket, AI-job executor (Claude CLI only), tray / single instance, `packages/ui` and `packages/hunt` rebuilt from the Job Hunter desktop, old-data importer | 3 | Full hunt works end to end in the new app on real data; a learning AI job from the API runs on the desktop |
| 3 | **Learning UI** — `packages/learn` from ForgeRoutine's web pages on `packages/ui`; mounted in desktop and web; offline-desktop states | 2.5 | Routine, practice, recall, interviews, progress work on both web and desktop |
| 4 | **Web** — supporter shell: hunt remote control, devices, downloads | 1 | Approve / answer / start a hunt from the browser reach the desktop |
| 5 | **Mobile** — Job Hunter app re-branded with the new id, learning pages from ForgeRoutine, unified sign-in, new Firebase app | 2.5 | One APK, all tabs work, tested on a real phone |
| 6 | **Goal and daily plan** — goal model and onboarding, daily-plan engine, overnight pre-generation, hunt→learn and interview-call→prep links | 2 | "Today" is the home screen everywhere and changes day to day |
| 7 | **Migration and cutover** — rehearse on a Neon branch, move the data, deploy, install on your devices, remove the old apps from the server | 1 | Old apps off the server; Offerpath running with all your data |

**About 16 weeks.** Phases 3–5 can overlap once 2 is done.

## 9. Moving the data

Rehearsed on a Neon branch with `--dry-run` first; the old apps keep running until the final step.

The `offerpath` database exists in ForgeRoutine's Neon project (created 2026-10-15), and steps 2 and 3 have run (see below), so step 1 comes last.

1. **ForgeRoutine's Neon database → Offerpath's:** once phase 1 has ported ForgeRoutine's models, copy its rows into the `offerpath` database. Because `users` already holds the imported accounts, this is a script and not a plain `pg_dump` / `pg_restore`: upsert `users` by id (an account matched from Job Hunter already carries its ForgeRoutine id), then copy the other tables as they are. Skip `ai_credentials`. ForgeRoutine's own database stays untouched until the cutover is done, so it keeps running meanwhile.
2. **Job Hunter accounts (MongoDB) → `users`:** matched by email (bcrypt hashes copied as they are, so no password resets). An account whose email is also in ForgeRoutine takes the ForgeRoutine identity (id, password, name), so your account keeps its ForgeRoutine id and the hunt data is re-pointed to it.
3. **Job Hunter synced data (MongoDB) → `sync_documents`:** every domain collection (jobs, analyses, applications, resumes, cover letters, answers, runs, events, notifications, settings, profile, experiences, projects).

   Steps 2 and 3 are `pnpm db:import:job-hunter [--dry-run]` (`packages/database/src/import/job-hunter.ts`). First run 2026-10-15: 2 accounts and 4,854 documents, each checked identical to its MongoDB copy. The script can be re-run: users are never overwritten, documents are upserted, and anything deleted in Job Hunter since is soft-deleted. **Run it again just before the cutover**, because Job Hunter keeps writing to MongoDB until then.
4. **Desktop-only data:** on first start, the Offerpath desktop offers to import `%APPDATA%\JobHunter` (local-only collections such as job-site profiles, publishing plan, scan cursors and the queue; settings; generated resume files; the Claude/Chrome setup).
5. **Devices:** not migrated. Every desktop and phone signs in to Offerpath fresh.
6. **Server cleanup, last:** stop and delete the PM2 apps `job-hunter-backend`, `forgeroutine-api`, `forgeroutine-web`, `forgeroutine-sandbox`; remove `/opt/var/job-hunter` and `/opt/var/forge-routine` after a final backup; close their ports; retire MongoDB Atlas and ForgeRoutine's Neon database once Offerpath has run cleanly for a while.

## 10. Rules carried into the new repo's CLAUDE.md

- Claude CLI is the only AI. Never add an API key, a vendor SDK, or a direct API call.
- Approval gating stays in the Rust core (`can_transition_to`, `steps::apply`); every remote action goes through the dispatcher. Learning AI jobs never enter the dispatcher, never get Chrome, files or `--resume`.
- The tutor's assistance policy and its regression tests are binding: no code below SHOW_SOLUTION.
- The Independent Coding Score uses only server-observed facts.
- Mock mode stays deterministic and never reports a real submission or a real AI answer.
- One root `.env`; one version; `prisma migrate deploy` only on servers.
- Every password field has a show/hide toggle with an accessible label.
- Notifications for every user-facing outcome.

## 11. Risks

1. **Learning AI depends on the desktop being on.** Pre-generation overnight and clear offline states soften it; the web can't give a hint while the desktop is off. This is the trade-off of "Claude CLI only".
2. **One Claude subscription for everything.** Hunts, applications and tutoring share your plan's limits. Learning jobs get a small concurrency cap and the status bar says when one is running.
3. **UI rebuild of the hunt side** (~6k lines onto the new design system) is the main rewrite; approve/apply are the most sensitive screens and get the most tests.
4. **Data migration** is the one irreversible step: rehearse on a Neon branch, keep the Mongo and old Postgres dumps until Offerpath has run for a while.
5. **New app ids** mean reinstalling on every device and a new Firebase / keystore / updater key setup.
6. **Neon free tier:** cold starts after idle (accepted), latency from the server (keep the Neon region close to it), and the 0.5 GB storage limit (prune old run events; check it monthly).
7. **Other people's data on your server.** Other users' applications, resumes and answers live in your database and pass through your server. Their AI runs on their own desktops with their own Claude, so you never pay for it, but you hold their data: account delete must remove everything, and there's no admin view into anyone's documents.

## 12. Multi-user: what it means here

Sign-up is open: anyone who reaches the server can create an account and use Offerpath for their own goal. Each user:

- has their own goal, roadmap, routine, progress, jobs, applications, resumes and saved answers, never visible to anyone else (every table and synced document is scoped by user id, as both apps already do);
- installs the Offerpath desktop on their own computer and signs in; their desktop runs **their** Claude CLI on **their** Claude subscription, in **their** Chrome with **their** LinkedIn / Naukri / Gmail sign-ins;
- pairs their own phone to their own desktop.

The server only stores data and relays messages; it never runs AI or a browser for anyone. Adding users costs storage and a little bandwidth, not AI usage.

Because sign-up is open, the API rate-limits sign-up and sign-in per IP, and a server setting (`OFFERPATH_SIGNUP=open|closed`) can close it later without a release.

## 13. Open questions

1. **Your own data:** move everything from Job Hunter and ForgeRoutine into your Offerpath account (section 9), or start fresh? Planned as "move it"; decided before phase 7.
