#!/usr/bin/env node
/**
 * End-to-end check of phase 2's promise: a learning AI job from the API runs
 * on the desktop, with the real Claude CLI.
 *
 * Starts nothing itself. Run the API (against a test database) and this:
 *
 *   node scripts/hub-smoke.mjs http://127.0.0.1:50015
 *
 * It registers a throwaway user, starts the headless desktop
 * (`cargo run -p offerpath-core --example hub_smoke`) signed in as that user,
 * waits for it to come online, asks the concept tutor a question, and checks
 * the answer came back. The throwaway user stays in the test database.
 * Costs one small Claude call (Haiku).
 */
import { spawn } from 'node:child_process';

const server = (process.argv[2] ?? 'http://127.0.0.1:50015').replace(/\/$/, '');
const api = `${server}/api/v1`;
const email = `hub-smoke-${Date.now()}@offerpath.test`;
const password = 'a-long-enough-password';

async function call(method, path, token, body) {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 300)}`);
  return json;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { accessToken } = await call('POST', '/auth/register', null, {
  email,
  password,
  displayName: 'Hub smoke',
});
await call('PUT', '/settings/ai', accessToken, { fast: 'haiku', tutor: 'haiku' });

const desktop = spawn('cargo', ['run', '-q', '-p', 'offerpath-core', '--example', 'hub_smoke'], {
  env: {
    ...process.env,
    OFFERPATH_SERVER_URL: server,
    SMOKE_EMAIL: email,
    SMOKE_PASSWORD: password,
  },
  stdio: ['ignore', 'inherit', 'inherit'],
  shell: process.platform === 'win32',
});

let failed = false;
try {
  let view;
  for (let i = 0; i < 180; i += 1) {
    view = await call('GET', '/settings/ai', accessToken);
    if (view.desktop.online) break;
    await sleep(1000);
  }
  if (!view.desktop.online) throw new Error('the desktop never came online');
  console.log('desktop online:', view.desktop);
  if (!view.desktop.claudeAvailable) throw new Error(`Claude unavailable: ${view.desktop.detail}`);

  const concepts = await call('GET', '/concepts', accessToken).catch(() => null);
  const conceptId = Array.isArray(concepts) ? concepts[0]?.id : concepts?.items?.[0]?.id;
  if (!conceptId) throw new Error('no concept to ask about (is the test database seeded?)');

  const started = Date.now();
  const turns = await call('POST', `/concepts/${conceptId}/chat`, accessToken, {
    question: 'In one sentence: what is this concept for?',
  });
  const answer = turns.at(-1);
  console.log(`tutor answered in ${Date.now() - started} ms:`, answer?.content ?? answer);
  if (!answer || answer.role !== 'assistant') throw new Error('no answer from the tutor');
  console.log('PASS: a learning AI job ran on the desktop with the real Claude CLI');
} catch (error) {
  failed = true;
  console.error('FAIL:', error.message);
} finally {
  desktop.kill();
}
process.exit(failed ? 1 : 0);
