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
pnpm dev                  # API on :50010, web on :50011 (proxies /api to the API)
pnpm dev:desktop          # desktop app
pnpm check                # everything CI runs: versions, format, typecheck, lint, tests, build, Rust, Flutter
```

## Releasing

One version for the whole repo. `pnpm release` (or `release:patch|minor|major`) bumps the root `package.json`, and `scripts/sync-versions.mjs` stamps the same version into every `package.json`, `tauri.conf.json`, `Cargo.toml`, `Cargo.lock` and `pubspec.yaml`, then commits, tags `vX.Y.Z` and pushes. The tag runs `.github/workflows/release.yml`, which builds the Windows installer and the APK and publishes a GitHub Release. It needs the `OFFERPATH_SERVER_URL` repository secret, e.g. `http://<server-ip>:50010`.

## Server

`pnpm server:update` on the server pulls, installs, runs `prisma migrate deploy`, builds and reloads the PM2 apps `offerpath-api` and `offerpath-sandbox` (`ecosystem.config.cjs`). The API listens on `OFFERPATH_PORT` (50010); there is no nginx.
