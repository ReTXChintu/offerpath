# Offerpath – notes for Claude Code sessions in this repo

Offerpath finds jobs, prepares the user for interviews and guides them every day toward their goal. It is built from Job Hunter (`../job-hunter`) and ForgeRoutine (`../forge-routine`); the plan is in `docs/plan.md`. Nothing is built yet beyond the plan.

- Surfaces: `apps/desktop` (Tauri, every feature), `apps/web` (supporter: the learning side plus a hunt remote control), `apps/mobile` (Flutter), `apps/api` (NestJS), `apps/sandbox` (code-execution worker).
- **Claude CLI is the only AI**, run on the user's own desktop. Never add an API key, a vendor SDK (OpenAI, Anthropic API, Gemini), Codex, or any server-side AI call. The server stores data and relays; learning AI calls are jobs the API hands to the user's desktop.
- Database: PostgreSQL on Neon (free tier, may sleep; retry the connection). Redis: the server's existing instance, key prefix `offerpath:`.
- Hosting: `http://<server-ip>:<port>` on one port (default 50010). No nginx: Traefik owns 80/443 on the server. The API serves REST, the WebSocket hub, downloads, updates and the web app.
- Multi-user with open sign-up; every row and synced document is scoped by user id.
- Approval gating lives in the Rust core and is never weakened; learning AI jobs never reach the hunt dispatcher, Chrome, local files or `--resume`.
- The tutor's assistance policy (no code below SHOW_SOLUTION) and its regression tests are binding.
- Every password field has a show/hide eye button labelled "Show password" / "Hide password".
- One root `.env`, one version for the whole repo, `prisma migrate deploy` only on servers.
