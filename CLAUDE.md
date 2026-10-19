# Offerpath – notes for Claude Code sessions in this repo

Offerpath finds jobs, prepares the user for interviews and guides them every day toward their goal. It is built from Job Hunter (`../job-hunter`) and ForgeRoutine (`../forge-routine`); the plan is in `docs/plan.md`. Phases 0-6 are done (see `docs/plan.md`); the device protocol is in `docs/hub-protocol.md`, deployment and cutover in `docs/deploy.md`. The API runs every AI call as an `ai_jobs` row handed to the user's desktop over the hub.

- Checks: `pnpm check` runs everything CI runs. Prettier formats TS/JSON/YAML (single quotes); ESLint is one flat config at the root; Rust uses `cargo fmt` + clippy `-D warnings`.
- Versions: never edit a version by hand; `pnpm release` stamps one version everywhere through `scripts/sync-versions.mjs`.

- Surfaces: `apps/desktop` (Tauri, every feature), `apps/web` (supporter: the learning side plus a hunt remote control), `apps/mobile` (Flutter), `apps/api` (NestJS), `apps/sandbox` (code-execution worker).
- **Claude CLI on the user's own desktop is the AI.** Learning AI calls are jobs the API hands to the desktop. One exception (user decision, 2026-10-19): **interview prep** falls back to the user's own OpenAI key (saved encrypted in Settings → AI) when their desktop is offline; Claude is always tried first (`apps/api/src/modules/interview-prep/application/prep-ai.router.ts`). No other feature uses OpenAI, and there is never a server-wide AI key. No Anthropic API, Gemini or Codex.
- Database: PostgreSQL on Neon (free tier, may sleep; retry the connection). Redis: the server's existing instance, key prefix `offerpath:`.
- Hosting: `http://<server-ip>:<port>`, web app on 50004 (PM2 static server), API on 50005 (REST, WebSocket hub, downloads, updates; CORS allows the web origin). No nginx: Traefik owns 80/443 on the server.
- Multi-user with open sign-up; every row and synced document is scoped by user id.
- Approval gating lives in the Rust core and is never weakened; learning AI jobs never reach the hunt dispatcher, Chrome, local files or `--resume`.
- The tutor's assistance policy (no code below SHOW_SOLUTION) and its regression tests are binding.
- Every password field has a show/hide eye button labelled "Show password" / "Hide password".
- One root `.env`, one version for the whole repo, `prisma migrate deploy` only on servers.
