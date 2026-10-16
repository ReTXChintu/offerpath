/**
 * PM2 processes on the server (docs/plan.md, section 7).
 *
 * Configuration lives in the repo's single root .env, which the API and the
 * sandbox load themselves. The web app is plain static files, so its port is
 * read from the same .env here.
 *
 * Use the root package.json scripts rather than calling pm2 directly:
 *   pnpm server:build     build the API, the web app and the sandbox worker
 *   pnpm server:start     start (or reload, if already running)
 *   pnpm server:stop | server:restart | server:logs | server:status
 */
const { existsSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const ROOT = __dirname;

/** Just the plain KEY=value lines of the root .env; PM2 needs nothing fancier. */
function readEnv() {
  const file = resolve(ROOT, '.env');
  if (!existsSync(file)) return {};
  return Object.fromEntries(
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((line) => /^([A-Z0-9_]+)=(.*)$/.exec(line.trim()))
      .filter(Boolean)
      .map(([, key, value]) => [key, value.replace(/^(['"])(.*)\1$/, '$2')]),
  );
}

const env = { ...readEnv(), ...process.env };
const WEB_PORT = env.OFFERPATH_WEB_PORT || '50004';

module.exports = {
  apps: [
    {
      name: 'offerpath-api',
      cwd: resolve(ROOT, 'apps/api'),
      script: 'dist/main.js',
      instances: 1, // presence and WebSocket routing are in-memory: never cluster this
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 20,
      restart_delay: 3000,
      kill_timeout: 10_000,
      max_memory_restart: '500M',
      time: true,
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'offerpath-web',
      cwd: resolve(ROOT, 'apps/web'),
      // PM2's built-in static server, configured through PM2_SERVE_* (not the
      // `serve` npm package, which takes different flags).
      script: 'serve',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '256M',
      time: true,
      env: {
        NODE_ENV: 'production',
        PM2_SERVE_PATH: resolve(ROOT, 'apps/web/dist'),
        PM2_SERVE_PORT: WEB_PORT,
        // Single-page app: a refresh on /roadmap must get index.html, not a 404.
        PM2_SERVE_SPA: 'true',
        PM2_SERVE_HOMEPAGE: '/index.html',
      },
    },
    {
      name: 'offerpath-sandbox',
      cwd: resolve(ROOT, 'apps/sandbox'),
      script: 'dist/main.js',
      // The code-execution worker for EXECUTION_DRIVER=queue (it needs Redis).
      // Fork, one instance: it spawns child processes of its own.
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      // Long enough to finish the run it holds and kill its child processes.
      kill_timeout: 20_000,
      max_memory_restart: '512M',
      time: true,
      env: { NODE_ENV: 'production' },
    },
  ],
};
