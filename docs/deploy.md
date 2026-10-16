# Deploying Offerpath

One server runs everything that isn't the desktop app, reached as plain `http://<server-ip>:<port>` (Traefik owns 80/443 on it, so there is no nginx):

```
http://<server-ip>:50005/api/v1/...              API: desktop, phone and web
ws://<server-ip>:50005/api/v1/hub                the device hub
http://<server-ip>:50005/api/v1/downloads/...    latest APK and Windows installer
http://<server-ip>:50004/                        web app
```

The desktop installer and the APK are built by GitHub Actions with the API address baked in (`OFFERPATH_SERVER_URL`). Neither app has an address field.

**50004 and 50005 are ForgeRoutine's ports today.** ForgeRoutine's PM2 apps must stop before Offerpath's start (see "Cutover" below).

## 1. Server setup

Node 22+, pnpm (corepack), PM2 and git.

```bash
git clone git@github.com:ReTXChintu/offerpath.git ~/offerpath
cd ~/offerpath
cp .env.example .env      # fill it in; see the table
pnpm install --frozen-lockfile
pnpm db:deploy            # migrations only; never `migrate dev` on a server
pnpm server:build
pnpm server:start
npx pm2 save && npx pm2 startup   # survive reboots (run the printed command with sudo)
```

| Variable | Value on the server |
| --- | --- |
| `NODE_ENV` | `production` |
| `APP_TIMEZONE` | The users' zone, e.g. `Asia/Kolkata` |
| `OFFERPATH_API_PORT` / `OFFERPATH_WEB_PORT` | `50005` / `50004` |
| `OFFERPATH_CORS_ORIGINS` | The web app's address, e.g. `http://187.127.179.114:50004` |
| `OFFERPATH_SIGNUP` | `open` (or `closed` to stop new accounts) |
| `DATABASE_URL` / `DIRECT_DATABASE_URL` | Neon pooled / direct URLs of the `offerpath` database |
| `REDIS_URL`, `REDIS_ENABLED=true`, `REDIS_KEY_PREFIX=offerpath:` | The server's existing Redis |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Two different random values: `openssl rand -base64 48` |
| `FCM_SERVICE_ACCOUNT` | Optional: path to the Firebase service-account JSON, for phone push |
| `EXECUTION_DRIVER` | `inline`, or `queue` with Redis and the `offerpath-sandbox` worker |

Open both ports in the firewall. Check: `curl http://<ip>:50005/api/v1/health/live` prints `{"status":"ok"}` and the web app loads at `http://<ip>:50004/`.

PM2 runs `offerpath-api`, `offerpath-web` (static files) and `offerpath-sandbox`, one instance each. Device presence and the hub live in memory, so never cluster the API. Day to day: `pnpm server:status | server:logs | server:restart | server:update`.

## 2. GitHub secrets

Repository → Settings → Secrets and variables → Actions.

| Secret | Required | Value |
| --- | --- | --- |
| `OFFERPATH_SERVER_URL` | Yes | `http://<server-ip>:50005`, baked into both apps |
| `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | Strongly recommended | The release signing key (below). Without it every APK must be installed fresh. |
| `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `TAURI_UPDATER_PUBKEY` | Recommended | Lets the desktop install its own updates |
| `GOOGLE_SERVICES_JSON` | For phone push | base64 of the Firebase `google-services.json` for package `app.offerpath.mobile` |
| `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_PORT`, `DEPLOY_PATH` | Optional | With them, a release uploads the builds and runs `scripts/server-update.sh` on the server (`DEPLOY_PATH` defaults to `offerpath`) |

Keys, made once and kept safe (lose one and installed apps can't be updated):

```bash
keytool -genkeypair -v -keystore offerpath-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias offerpath
base64 -w0 offerpath-release.jks                     # → ANDROID_KEYSTORE_BASE64
pnpm --filter @offerpath/desktop tauri signer generate -w offerpath-updater.key
# offerpath-updater.key → TAURI_SIGNING_PRIVATE_KEY, offerpath-updater.key.pub → TAURI_UPDATER_PUBKEY
```

New app ids mean a new Firebase app, a new keystore and a new updater key: Job Hunter's can't be reused.

## 3. Releasing

`pnpm release` (on a clean `main`) bumps one version everywhere, commits, tags `vX.Y.Z` and pushes. The tag runs `.github/workflows/release.yml`: the Windows installer and the APK, a GitHub Release, and with the `DEPLOY_*` secrets the upload to `apps/api/downloads/` and a server update.

## 4. Cutover from Job Hunter and ForgeRoutine

Done in this order, so the old apps keep running until the last step.

**Steps 1-3 were done on 2026-10-16.** Offerpath runs from `/opt/var/offerpath` as `offerpath-api` (50005), `offerpath-web` (50004) and `offerpath-sandbox` (Redis queue); Job Hunter's and ForgeRoutine's PM2 processes were deleted, their folders in `/opt/var` are still there. Steps 4 and 5 are left.

1. **Data, one last time.** Job Hunter keeps writing to MongoDB until now, so on a machine with all three repos:
   ```bash
   # Job Hunter's accounts and synced documents (re-runnable)
   JOB_HUNTER_MONGODB_URI=... JOB_HUNTER_MONGODB_DATABASE=... FORGEROUTINE_DATABASE_URL=... \
     pnpm db:import:job-hunter
   # ForgeRoutine's learning data (re-runnable)
   FORGEROUTINE_DATABASE_URL=... pnpm db:import:forge-routine
   ```
   Do not run `pnpm db:seed` on the `offerpath` database: the curriculum comes from ForgeRoutine.
2. **Stop the old apps** on the server: `pm2 stop job-hunter-backend forgeroutine-api forgeroutine-web forgeroutine-sandbox`. This frees 50004 and 50005.
3. **Start Offerpath** (section 1) and cut the first release (section 3) so the installer and APK land in `apps/api/downloads/`.
4. **Install on each device.** The desktop offers to import the old `%APPDATA%\JobHunter` folder on first start (job-site profiles, the queue, generated resumes, settings). Sign in with your ForgeRoutine password (the account kept that identity); phones pair again by QR.
5. **Clean up, last**, after Offerpath has run cleanly for a while: `pm2 delete` the old apps, back up and remove `/opt/var/job-hunter` and `/opt/var/forge-routine`, retire MongoDB Atlas and ForgeRoutine's `forge_routine` database. The scratch databases `offerpath_test` (e2e) and `offerpath_rehearsal` can be dropped any time.
