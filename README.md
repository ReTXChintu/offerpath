# Offerpath

Finds the jobs, gets you ready for the interviews, and moves you one step closer to the offer every day.

Status: phase 0 (scaffold) done: every app builds, nothing works yet. The plan is in [docs/plan.md](docs/plan.md).

## Layout

| Path                    | What                                                                       |
| ----------------------- | -------------------------------------------------------------------------- |
| `apps/api`              | NestJS API: REST under `/api/v1`, later the hub, downloads and the web app |
| `apps/web`              | React 19 + Vite supporter web app                                          |
| `apps/desktop`          | Tauri 2 + React 19 desktop app (`app.offerpath.desktop`)                   |
| `apps/mobile`           | Flutter app (`app.offerpath.mobile`)                                       |
| `apps/sandbox`          | Code-execution worker (placeholder until phase 1)                          |
| `crates/offerpath-core` | Rust core (placeholder until phase 2)                                      |
| `packages/config`       | The one validated read of the root `.env`                                  |
| `packages/database`     | Prisma schema and migrations (Neon)                                        |

## Requirements

Node 22+, pnpm 12 (`corepack enable`), Rust stable, Flutter 3.47 with Java 17 for Android.

## Commands

```bash
cp .env.example .env      # then fill in the Neon URLs
pnpm install
pnpm dev                  # web on :50004 (proxies /api to the API), API on :50005
pnpm dev:desktop          # desktop app
pnpm check                # everything CI runs: versions, format, typecheck, lint, tests, build, Rust, Flutter
pnpm db:deploy            # apply migrations to the database in .env
```

## Moving Job Hunter's data

`pnpm db:import:job-hunter [--dry-run]` copies Job Hunter's accounts and synced documents from MongoDB into `users` and `sync_documents`. It reads `JOB_HUNTER_MONGODB_URI` and `JOB_HUNTER_MONGODB_DATABASE` from the environment, plus `FORGEROUTINE_DATABASE_URL` (optional) so that accounts that also exist in ForgeRoutine keep their ForgeRoutine id. Pass them for the one command; they don't belong in Offerpath's `.env`. It's safe to run again, and it should be run once more just before the cutover (docs/plan.md, section 9).

## Releasing

One version for the whole repo. `pnpm release` (or `release:patch|minor|major`) bumps the root `package.json`, and `scripts/sync-versions.mjs` stamps the same version into every `package.json`, `tauri.conf.json`, `Cargo.toml`, `Cargo.lock` and `pubspec.yaml`, then commits, tags `vX.Y.Z` and pushes. The tag runs `.github/workflows/release.yml`, which builds the Windows installer and the APK and publishes a GitHub Release. It needs the `OFFERPATH_SERVER_URL` repository secret, e.g. `http://<server-ip>:50005`.

## Server

`pnpm server:update` on the server pulls, installs, runs `prisma migrate deploy`, builds and reloads the PM2 apps `offerpath-web` (static web app on `OFFERPATH_WEB_PORT`, 50004), `offerpath-api` (`OFFERPATH_API_PORT`, 50005) and `offerpath-sandbox` (`ecosystem.config.cjs`). There is no nginx.
