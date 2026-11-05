'use strict';

process.env.DISABLE_IMDS = 'true';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

async function withServer(fn, env = {}) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; process.env[k] = v; }
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.close();
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
const json = (base, path, opts = {}) =>
  fetch(base + path, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } })
    .then(async (r) => ({ status: r.status, body: await r.json() }));

test('health is ok by default', () => withServer(async (base) => {
  const r = await json(base, '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'ok');
  assert.ok(r.body.servedBy.pid);
}));

test('health can be switched to fail and back', () => withServer(async (base) => {
  let r = await json(base, '/api/chaos/health', { method: 'POST', body: JSON.stringify({ mode: 'fail' }) });
  assert.equal(r.status, 200);
  r = await json(base, '/api/health');
  assert.equal(r.status, 503);
  await json(base, '/api/chaos/health', { method: 'POST', body: JSON.stringify({ mode: 'ok' }) });
  r = await json(base, '/api/health');
  assert.equal(r.status, 200);
}));

test('invalid health mode is rejected', () => withServer(async (base) => {
  const r = await json(base, '/api/chaos/health', { method: 'POST', body: JSON.stringify({ mode: 'nope' }) });
  assert.equal(r.status, 400);
}));

test('info reports app, runtime and masks secrets', () => withServer(async (base) => {
  const r = await json(base, '/api/info');
  assert.equal(r.status, 200);
  assert.equal(r.body.instance.onAws, false);
  assert.ok(r.body.app.version);
  const secret = r.body.envVars.find((v) => v.name === 'MY_SECRET_TOKEN');
  assert.equal(secret.masked, true);
  assert.ok(!JSON.stringify(r.body).includes('hunter2'));
}, { MY_SECRET_TOKEN: 'hunter2' }));

test('lab key protects chaos endpoints when set', () => withServer(async (base) => {
  let r = await json(base, '/api/chaos/error');
  assert.equal(r.status, 401);
  r = await json(base, '/api/chaos/error', { headers: { 'x-lab-key': 'secret' } });
  assert.equal(r.status, 500);
  assert.match(r.body.error, /Intentional/);
}, { LAB_KEY: 'secret' }));

test('chaos can be disabled', () => withServer(async (base) => {
  const r = await json(base, '/api/chaos/error');
  assert.equal(r.status, 403);
}, { CHAOS_ENABLED: 'false' }));

test('unknown API routes return JSON 404', () => withServer(async (base) => {
  const r = await json(base, '/api/does-not-exist');
  assert.equal(r.status, 404);
  assert.match(r.body.error, /No API route/);
}));

test('worker accepts plain-text SQS messages and fails on FAIL', () => withServer(async (base) => {
  const sqsd = { 'x-aws-sqsd-msgid': 'abc-123', 'x-aws-sqsd-receive-count': '2', 'content-type': 'application/json' };
  let r = await fetch(`${base}/worker/task`, { method: 'POST', headers: sqsd, body: 'hello not json' });
  assert.equal(r.status, 200);
  r = await fetch(`${base}/`, { method: 'POST', headers: sqsd, body: 'please FAIL' });
  assert.equal(r.status, 500);
  const tasks = (await json(base, '/api/worker/tasks')).body.tasks;
  assert.equal(tasks.length, 2);
  assert.equal(tasks[1].fromSqsd, true);
  assert.equal(tasks[1].receiveCount, 2);
  assert.equal(tasks[0].result, 'failed');
}));

test('db check reports unconfigured and unreachable hosts', () => withServer(async (base) => {
  const r = await json(base, '/api/db');
  assert.equal(r.body.configured, false);
}));

test('db check detects a closed port', () => withServer(async (base) => {
  const r = await json(base, '/api/db');
  assert.equal(r.body.configured, true);
  assert.equal(r.body.reachable, false);
}, { DB_HOST: '127.0.0.1', DB_PORT: '1' }));

test('memory allocation and release', () => withServer(async (base) => {
  let r = await json(base, '/api/chaos/memory', { method: 'POST', body: JSON.stringify({ mb: 8 }) });
  assert.equal(r.status, 200);
  r = await json(base, '/api/info');
  assert.equal(r.body.chaos.memoryHeldMb, 8);
  await json(base, '/api/chaos/memory/release', { method: 'POST', body: '{}' });
  r = await json(base, '/api/info');
  assert.equal(r.body.chaos.memoryHeldMb, 0);
}));

test('cpu burn starts and stops', () => withServer(async (base) => {
  let r = await json(base, '/api/chaos/cpu', { method: 'POST', body: JSON.stringify({ cores: 1, seconds: 5 }) });
  assert.equal(r.status, 200);
  r = await json(base, '/api/info');
  assert.equal(r.body.chaos.cpuBurn.workers, 1);
  await json(base, '/api/chaos/cpu/stop', { method: 'POST', body: '{}' });
}));

test('static UI is served', () => withServer(async (base) => {
  const r = await fetch(base + '/');
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Beanstalk Lab/);
  assert.equal((await fetch(base + '/labs.js')).status, 200);
}));
