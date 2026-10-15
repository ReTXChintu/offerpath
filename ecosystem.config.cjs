/**
 * PM2 processes on the server (docs/plan.md, section 7).
 *
 * Configuration, including the port, lives in the repo's single root .env,
 * which each app loads itself, so nothing here duplicates it.
 *
 * Use the root package.json scripts rather than calling pm2 directly:
 *   pnpm server:build     build the API, the web app and the sandbox worker
 *   pnpm server:start     start (or reload, if already running)
 *   pnpm server:stop | server:restart | server:logs | server:status
 */
module.exports = {
  apps: [
    {
      name: 'offerpath-api',
      cwd: __dirname + '/apps/api',
      script: 'dist/main.js',
      instances: 1, // presence and WebSocket routing are in-memory: never cluster this
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 20,
      restart_delay: 3000,
      max_memory_restart: '500M',
      time: true,
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'offerpath-sandbox',
      cwd: __dirname + '/apps/sandbox',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      // Until phase 1 ports the worker, the placeholder exits after one log line.
      autorestart: false,
      time: true,
      env: { NODE_ENV: 'production' },
    },
  ],
};
