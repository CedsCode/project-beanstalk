'use strict';

const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { Worker } = require('worker_threads');
const pkg = require('../package.json');
const metadata = require('./metadata');

const ROOT = path.join(__dirname, '..');
// Folders that the lab .ebextensions / platform hooks write marker files into.
const MARKER_DIRS = [path.join(ROOT, 'lab-markers'), '/tmp/beanstalk-lab'];
const SECRET_NAME = /(SECRET|PASSWORD|PASSWD|TOKEN|KEY|CREDENTIAL|SESSION)/i;
const LIMITS = {
  cpuSeconds: 900,
  memoryMbPerCall: 512,
  memoryMbTotal: 4096,
  blockSeconds: 120,
  slowMs: 120_000,
  healthRevertMinutes: 60
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const toMb = (bytes) => Math.round(bytes / 1024 / 1024);
const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

// One JSON object per line: easy to read in `eb logs` and to query in CloudWatch Logs Insights.
function log(level, event, fields = {}) {
  const line = JSON.stringify({ time: new Date().toISOString(), level, event, ...fields });
  (level === 'info' ? console.log : console.error)(line);
}

const appVersion = () => process.env.APP_VERSION || pkg.version;
const chaosEnabled = () => process.env.CHAOS_ENABLED !== 'false';

function envVars() {
  return Object.keys(process.env)
    .sort()
    .map((name) => ({
      name,
      value: SECRET_NAME.test(name) ? '••••••• (hidden)' : process.env[name],
      masked: SECRET_NAME.test(name)
    }));
}

function readMarkers() {
  const markers = [];
  for (const dir of MARKER_DIRS) {
    let files;
    try {
      files = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const file of files.sort()) {
      const full = path.join(dir, file);
      try {
        const stat = fs.statSync(full);
        if (!stat.isFile()) continue;
        markers.push({ file: full, modified: stat.mtime.toISOString(), content: fs.readFileSync(full, 'utf8').slice(0, 2000) });
      } catch {
        /* unreadable marker, skip */
      }
    }
  }
  return markers;
}

function safeUser() {
  try {
    return os.userInfo().username;
  } catch {
    return null;
  }
}

function tcpCheck(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = net.connect({ host, port });
    let finished = false;
    const done = (reachable, error) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolve({ reachable, ms: Date.now() - started, error: error || null });
    };
    socket.setTimeout(timeoutMs, () => done(false, 'Timed out. This is usually a security group, subnet or VPC problem.'));
    socket.once('connect', () => done(true));
    socket.once('error', (err) =>
      done(false, err.code === 'ENOTFOUND' ? 'DNS name not found. Check the hostname.' : `${err.code || ''} ${err.message}`.trim())
    );
  });
}

const BURN_CODE = `
const { workerData } = require('worker_threads');
const end = Date.now() + workerData.ms;
let x = 0;
while (Date.now() < end) { x += Math.sqrt(Math.random() * 1e9); }
`;

function createApp() {
  const app = express();
  const state = {
    startedAt: Date.now(),
    health: { mode: 'ok', until: null },
    requests: 0,
    errors5xx: 0,
    memory: [],
    cpu: { workers: [], until: null },
    tasks: []
  };

  const uptime = () => Math.floor((Date.now() - state.startedAt) / 1000);
  const currentHealth = () => {
    if (state.health.until && Date.now() > state.health.until) state.health = { mode: 'ok', until: null };
    return state.health;
  };
  const chaosState = () => ({
    health: currentHealth(),
    cpuBurn: state.cpu.workers.length ? { workers: state.cpu.workers.length, until: new Date(state.cpu.until).toISOString() } : null,
    memoryHeldMb: state.memory.reduce((sum, b) => sum + b.length, 0) / 1024 / 1024
  });
  const servedBy = () => {
    const m = metadata.cached();
    return { instanceId: m.instanceId || null, availabilityZone: m.availabilityZone || null, host: os.hostname(), pid: process.pid };
  };
  const send = (res, payload, status = 200) => res.status(status).json({ ...payload, servedBy: servedBy() });

  app.disable('x-powered-by');
  // Beanstalk puts nginx (and optionally a load balancer) in front of the app.
  app.set('trust proxy', true);

  app.use((req, res, next) => {
    state.requests += 1;
    const started = Date.now();
    const reqPath = req.path; // captured now: routers rewrite req.path while handling
    res.on('finish', () => {
      if (res.statusCode >= 500) state.errors5xx += 1;
      const quiet = req.method === 'GET' && (reqPath === '/api/health' || reqPath === '/api/info' || !reqPath.startsWith('/api/'));
      if (!quiet) {
        log(res.statusCode >= 500 ? 'error' : 'info', 'http.request', {
          method: req.method, path: reqPath, status: res.statusCode, ms: Date.now() - started, ip: req.ip
        });
      }
    });
    next();
  });

  // ---- Worker tier: the SQS daemon (sqsd) POSTs each queue message here. ----
  // Registered before express.json() so that any body (JSON or plain text) is accepted.
  const anyBody = express.text({ type: () => true, limit: '256kb' });
  const workerHandler = (kind) => (req, res) => {
    const body = typeof req.body === 'string' ? req.body : '';
    const task = {
      id: req.get('x-aws-sqsd-msgid') || `local-${Date.now()}`,
      kind,
      path: req.path,
      receivedAt: new Date().toISOString(),
      fromSqsd: Boolean(req.get('x-aws-sqsd-msgid')),
      taskName: req.get('x-aws-sqsd-taskname') || null,
      receiveCount: Number(req.get('x-aws-sqsd-receive-count') || 1),
      queue: req.get('x-aws-sqsd-queue') || null,
      body: body.slice(0, 2000),
      result: body.includes('FAIL') ? 'failed' : 'ok'
    };
    state.tasks.unshift(task);
    state.tasks.length = Math.min(state.tasks.length, 50);
    log(task.result === 'ok' ? 'info' : 'error', 'worker.task', task);
    if (task.result !== 'ok') {
      return send(res, { error: 'The message contained FAIL, so the app returned 500. SQS will retry it.' }, 500);
    }
    send(res, { message: 'Task processed', task });
  };
  app.post('/', anyBody, workerHandler('sqs'));
  app.post('/worker/task', anyBody, workerHandler('sqs'));
  app.post('/worker/cron', anyBody, workerHandler('cron'));

  app.use(express.json({ limit: '100kb' }));
  app.use(express.static(path.join(ROOT, 'public')));

  // ---- Health check: used by Beanstalk's load balancer (see .ebextensions/healthcheck.config) ----
  app.get('/api/health', async (req, res) => {
    const health = currentHealth();
    if (health.mode === 'slow') await sleep(10_000);
    if (health.mode === 'fail') {
      return send(res, { status: 'failing', reason: 'The chaos lab set this health check to fail' }, 503);
    }
    send(res, { status: 'ok', service: pkg.name, version: appVersion(), uptimeSeconds: uptime() });
  });

  app.get('/api/info', async (req, res) => {
    const instance = await metadata.get();
    const mem = process.memoryUsage();
    send(res, {
      app: {
        name: pkg.name,
        version: appVersion(),
        color: process.env.APP_COLOR || null,
        greeting: process.env.GREETING || null
      },
      environment: {
        onBeanstalk: fs.existsSync('/opt/elasticbeanstalk'),
        nodeEnv: process.env.NODE_ENV || null,
        port: String(process.env.PORT || 8080),
        chaosEnabled: chaosEnabled(),
        labKeyRequired: Boolean(process.env.LAB_KEY)
      },
      instance,
      runtime: {
        node: process.version,
        pid: process.pid,
        ppid: process.ppid,
        user: safeUser(),
        hostname: os.hostname(),
        os: `${os.type()} ${os.release()}`,
        arch: process.arch,
        cwd: process.cwd(),
        uptimeSeconds: uptime()
      },
      system: {
        cpus: os.cpus().length,
        loadAverage: os.loadavg().map((n) => Number(n.toFixed(2))),
        totalMemMb: toMb(os.totalmem()),
        freeMemMb: toMb(os.freemem()),
        rssMb: toMb(mem.rss),
        heapUsedMb: toMb(mem.heapUsed)
      },
      request: {
        clientIp: req.ip,
        forwardedFor: req.get('x-forwarded-for') || null,
        forwardedProto: req.get('x-forwarded-proto') || null,
        host: req.get('host') || null,
        viaProxy: Boolean(req.get('x-forwarded-for') || req.get('x-real-ip'))
      },
      chaos: chaosState(),
      stats: { requests: state.requests, errors5xx: state.errors5xx },
      envVars: envVars(),
      markers: readMarkers()
    });
  });

  // ---- Chaos lab ----
  const guard = (req, res, next) => {
    if (!chaosEnabled()) return send(res, { error: 'Chaos endpoints are disabled because CHAOS_ENABLED=false' }, 403);
    if (process.env.LAB_KEY && req.get('x-lab-key') !== process.env.LAB_KEY) {
      return send(res, { error: 'The lab key is missing or wrong. Enter it at the top of the Chaos lab.' }, 401);
    }
    next();
  };

  const chaos = express.Router();
  chaos.use(guard);

  chaos.post('/health', (req, res) => {
    const mode = req.body && req.body.mode;
    if (!['ok', 'fail', 'slow'].includes(mode)) return send(res, { error: 'mode must be ok, fail or slow' }, 400);
    const minutes = clamp(req.body.revertAfterMinutes, 0, LIMITS.healthRevertMinutes, 0);
    state.health = { mode, until: mode !== 'ok' && minutes > 0 ? Date.now() + minutes * 60_000 : null };
    log('warn', 'chaos.health', { mode, revertAfterMinutes: minutes });
    const revert = state.health.until ? `, auto-revert in ${minutes} min` : '';
    send(res, { message: `Health check is now "${mode}" on this instance${revert}`, health: state.health });
  });

  chaos.get('/error', (req, res) => send(res, { error: 'Intentional 500 from the chaos lab' }, 500));

  chaos.get('/slow', async (req, res) => {
    const ms = clamp(req.query.ms, 0, LIMITS.slowMs, 5000);
    await sleep(ms);
    send(res, { message: `Responded after ${ms} ms` });
  });

  chaos.post('/cpu', (req, res) => {
    const cores = Math.round(clamp(req.body.cores, 1, os.cpus().length, os.cpus().length));
    const seconds = clamp(req.body.seconds, 1, LIMITS.cpuSeconds, 300);
    state.cpu.workers.forEach((w) => w.terminate());
    state.cpu.workers = Array.from({ length: cores }, () => {
      const worker = new Worker(BURN_CODE, { eval: true, workerData: { ms: seconds * 1000 } });
      worker.on('exit', () => {
        state.cpu.workers = state.cpu.workers.filter((w) => w !== worker);
      });
      return worker;
    });
    state.cpu.until = Date.now() + seconds * 1000;
    log('warn', 'chaos.cpu', { cores, seconds });
    send(res, { message: `Burning ${cores} core(s) for ${seconds}s. The app stays responsive because the work runs on worker threads.` });
  });

  chaos.post('/cpu/stop', (req, res) => {
    const count = state.cpu.workers.length;
    state.cpu.workers.forEach((w) => w.terminate());
    state.cpu.workers = [];
    state.cpu.until = null;
    log('info', 'chaos.cpu.stop', { stopped: count });
    send(res, { message: `Stopped ${count} CPU burner(s)` });
  });

  chaos.post('/memory', (req, res) => {
    const mb = Math.round(clamp(req.body.mb, 1, LIMITS.memoryMbPerCall, 128));
    const held = chaosState().memoryHeldMb;
    if (held + mb > LIMITS.memoryMbTotal) return send(res, { error: `The safety cap is ${LIMITS.memoryMbTotal} MB in total` }, 400);
    state.memory.push(Buffer.alloc(mb * 1024 * 1024, 1));
    log('warn', 'chaos.memory', { allocatedMb: mb, heldMb: held + mb });
    send(res, { message: `Allocated ${mb} MB. The process now holds ${held + mb} MB of chaos memory.` });
  });

  chaos.post('/memory/release', (req, res) => {
    const held = chaosState().memoryHeldMb;
    state.memory = [];
    log('info', 'chaos.memory.release', { releasedMb: held });
    send(res, { message: `Released ${held} MB (garbage collection reclaims it shortly)` });
  });

  chaos.post('/block', (req, res) => {
    const seconds = clamp(req.body.seconds, 1, LIMITS.blockSeconds, 20);
    log('warn', 'chaos.block', { seconds });
    send(res, { message: `Freezing the event loop for ${seconds}s. Requests to this instance hang until then.` });
    setTimeout(() => {
      const end = Date.now() + seconds * 1000;
      while (Date.now() < end) { /* intentionally blocking */ }
    }, 100);
  });

  chaos.post('/crash', (req, res) => {
    send(res, { message: 'Crashing the process with exit code 1. Beanstalk should restart it within seconds.' });
    setTimeout(() => {
      log('error', 'chaos.crash', { pid: process.pid, uptimeSeconds: uptime() });
      process.exit(1);
    }, 250);
  });

  app.use('/api/chaos', chaos);

  app.post('/api/log', guard, (req, res) => {
    const level = ['info', 'warn', 'error'].includes(req.body && req.body.level) ? req.body.level : 'info';
    const message = String((req.body && req.body.message) || 'Hello from the Beanstalk lab').slice(0, 500);
    log(level, 'lab.log', { message });
    send(res, { message: `Wrote a ${level} line to ${level === 'info' ? 'stdout' : 'stderr'}`, logged: { level, message } });
  });

  // ---- Database connectivity (TCP-level, works for any engine without a driver) ----
  app.get('/api/db', async (req, res) => {
    const host = process.env.RDS_HOSTNAME || process.env.DB_HOST;
    const port = Number(process.env.RDS_PORT || process.env.DB_PORT);
    const source = process.env.RDS_HOSTNAME ? 'RDS_* (RDS database attached to the environment)' : 'DB_* (your own environment properties)';
    if (!host) return send(res, { configured: false, message: 'Neither RDS_HOSTNAME nor DB_HOST is set.' });
    if (!port) return send(res, { configured: false, host, message: 'A host is set but the port is missing. Set DB_PORT (for example 5432 or 3306).' });
    const result = await tcpCheck(host, port, 3000);
    log(result.reachable ? 'info' : 'error', 'db.check', { host, port, ...result });
    send(res, { configured: true, host, port, source, dbName: process.env.RDS_DB_NAME || process.env.DB_NAME || null, ...result });
  });

  app.get('/api/worker/tasks', (req, res) => send(res, { tasks: state.tasks }));

  app.use('/api', (req, res) => send(res, { error: `No API route for ${req.method} ${req.originalUrl}` }, 404));
  app.use((req, res) => res.status(404).type('text').send('Not found'));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    log(status >= 500 ? 'error' : 'warn', 'http.error', { path: req.path, message: err.message });
    send(res, { error: status >= 500 ? 'Internal server error' : err.message }, status);
  });

  return app;
}

module.exports = { createApp, log, appVersion };
