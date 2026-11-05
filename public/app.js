'use strict';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
};

const VIEWS = {
  overview: ['Overview', 'The instance, version and configuration that answered this request.'],
  chaos: ['Chaos lab', 'Break things on purpose and watch how Elastic Beanstalk reacts.'],
  watch: ['Deploy watcher', 'Poll the app continuously to see deployments, load balancing and outages as they happen.'],
  backend: ['Worker & database', 'Messages from the SQS daemon and connectivity to your database.'],
  labs: ['Labs', 'A hands-on path from your first deploy to blue/green, auto scaling and workers.']
};

// ---------- API helper ----------
async function api(path, { method = 'GET', body, timeout = 15000 } = {}) {
  const headers = {};
  const key = store.get('labKey', '');
  if (key) headers['x-lab-key'] = key;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const started = performance.now();
  let res;
  try {
    res = await fetch(path, {
      method, headers, cache: 'no-store',
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout)
    });
  } catch (err) {
    return { ok: false, status: 0, error: err.name === 'TimeoutError' ? 'timed out' : 'network error', ms: Math.round(performance.now() - started) };
  }
  const text = await res.text();
  let data = text;
  try { data = JSON.parse(text); } catch { /* not JSON (e.g. nginx error page) */ }
  return { ok: res.ok, status: res.status, data, ms: Math.round(performance.now() - started) };
}
const post = (path, body = {}, opts = {}) => api(path, { method: 'POST', body, ...opts });

// ---------- helpers ----------
function fmtDuration(total) {
  const d = Math.floor(total / 86400), h = Math.floor((total % 86400) / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`;
}
const val = (v) => (v === null || v === undefined || v === '' ? '<span class="muted">—</span>' : esc(v));
const kv = (rows) => `<dl class="kv">${rows.map(([k, v, raw]) => `<dt>${esc(k)}</dt><dd>${raw ? v : val(v)}</dd>`).join('')}</dl>`;
const who = (by) => (by ? `${by.instanceId || by.host} · pid ${by.pid}` : '');
const num = (sel, fallback) => { const n = Number($(sel).value); return Number.isFinite(n) ? n : fallback; };

function applyAccent(color) {
  if (color && CSS.supports('color', color)) document.documentElement.style.setProperty('--accent', color);
  else document.documentElement.style.removeProperty('--accent');
}

function updateChrome(info) {
  const ins = info.instance;
  const onEb = info.environment.onBeanstalk;
  applyAccent(info.app.color);
  $('#chip').textContent = `${ins.instanceId || 'local'} · v${info.app.version}`;
  $('#where').innerHTML = onEb
    ? `<span class="dot good"></span><span>On Elastic Beanstalk · ${esc(ins.availabilityZone || '')}</span>`
    : ins.onAws
      ? `<span class="dot good"></span><span>On EC2 (not Beanstalk)</span>`
      : `<span class="dot local"></span><span>Running locally</span>`;
  $('#eyebrow').textContent = onEb ? `ELASTIC BEANSTALK / ${ins.region || ''}`.toUpperCase() : 'BEANSTALK LAB / LOCAL';
}

// ---------- Overview ----------
let overviewTimer = null;

async function loadOverview() {
  const el = $('#overview');
  const r = await api('/api/info');
  if (!r.ok) {
    el.innerHTML = `<div class="callout bad">Could not load <code>/api/info</code> (${esc(r.status || r.error)}). If you just crashed or froze the app, wait a few seconds.</div>`;
    return;
  }
  const i = r.data;
  updateChrome(i);
  const { app, environment: env, instance: ins, runtime: rt, system: sys, request: rq, chaos, stats } = i;
  const memPct = Math.round(((sys.totalMemMb - sys.freeMemMb) / sys.totalMemMb) * 100);
  const health = chaos.health.mode;
  const banner = env.onBeanstalk
    ? `<div class="callout good"><b>Running on Elastic Beanstalk.</b> Refresh a few times: in a load-balanced environment the instance ID can change between requests.</div>`
    : ins.onAws
      ? `<div class="callout warn"><b>Running on EC2, but this doesn't look like a Beanstalk instance</b> (no <code>/opt/elasticbeanstalk</code>).</div>`
      : `<div class="callout"><b>Running locally.</b> Instance details appear after you deploy. Start with <a href="#labs">Lab 0</a>.</div>`;

  el.innerHTML = `${banner}
  <div class="grid cards">
    <article class="card"><h3>Instance</h3>
      <div class="big mono">${val(ins.instanceId || 'not on AWS')}</div>
      ${kv([['Type', ins.instanceType], ['Zone', ins.availabilityZone], ['Region', ins.region], ['Private IP', ins.privateIp], ['Public IP', ins.publicIp], ['AMI', ins.amiId]])}
    </article>
    <article class="card"><h3>Application</h3>
      <div class="big">v${esc(app.version)}</div>
      ${kv([
        ['Color', app.color ? `<span class="swatch" style="background:${esc(app.color)}"></span>${esc(app.color)}` : val(null), true],
        ['Greeting', app.greeting],
        ['NODE_ENV', env.nodeEnv],
        ['PORT', env.port],
        ['Chaos', env.chaosEnabled ? (env.labKeyRequired ? 'enabled (lab key required)' : 'enabled (open)') : 'disabled']
      ])}
      <p class="hint" style="margin-top:10px">Set <code>APP_VERSION</code>, <code>APP_COLOR</code> and <code>GREETING</code> with <code>eb setenv</code> (Lab 3).</p>
    </article>
    <article class="card"><h3>Process</h3>
      <div class="big">${fmtDuration(rt.uptimeSeconds)}</div>
      ${kv([['PID', rt.pid], ['Parent PID', rt.ppid], ['User', rt.user], ['Node', rt.node], ['Working dir', rt.cwd], ['OS', rt.os]])}
    </article>
    <article class="card"><h3>System</h3>
      ${kv([['CPUs', sys.cpus], ['Load avg', sys.loadAverage.join(' / ')]])}
      <h4>Machine memory ${memPct}% (${sys.totalMemMb - sys.freeMemMb} / ${sys.totalMemMb} MB)</h4>
      <div class="meter"><span style="width:${memPct}%"></span></div>
      ${kv([['Process RSS', `${sys.rssMb} MB`], ['Heap used', `${sys.heapUsedMb} MB`], ['Requests served', stats.requests], ['5xx returned', stats.errors5xx]])}
    </article>
  </div>
  <div class="grid two">
    <article class="card"><h3>Request path</h3>
      <p class="hint">On Beanstalk your request goes browser → (load balancer) → nginx → Node.js. Those hops add <code>X-Forwarded-*</code> headers.</p>
      ${kv([['Via proxy', rq.viaProxy ? 'yes' : 'no (direct)'], ['Client IP', rq.clientIp], ['X-Forwarded-For', rq.forwardedFor], ['X-Forwarded-Proto', rq.forwardedProto], ['Host', rq.host]])}
    </article>
    <article class="card"><h3>Chaos state on this instance</h3>
      ${kv([
        ['Health check', `<span class="pill ${health === 'ok' ? 'good' : health === 'slow' ? 'warn' : 'bad'}">${esc(health)}</span>${chaos.health.until ? ` until ${esc(new Date(chaos.health.until).toLocaleTimeString())}` : ''}`, true],
        ['CPU burn', chaos.cpuBurn ? `${chaos.cpuBurn.workers} worker(s) until ${new Date(chaos.cpuBurn.until).toLocaleTimeString()}` : 'off'],
        ['Leaked memory', `${chaos.memoryHeldMb} MB`]
      ])}
    </article>
  </div>
  <article class="card"><h3>Customization checks</h3>
    <p class="hint">These turn green as you complete Labs 11–13. Each check proves your <code>.ebextensions</code>, platform hooks or nginx config actually ran.</p>
    <div id="nginx-check" class="muted">Checking <code>/nginx-lab</code>…</div>
    <h4>Lab markers (${i.markers.length})</h4>
    ${i.markers.length
      ? `<div class="table-wrap"><table><tr><th>File</th><th>Content</th><th>Modified</th></tr>${i.markers.map((m) => `<tr><td class="mono">${esc(m.file)}</td><td class="mono">${esc(m.content)}</td><td>${esc(new Date(m.modified).toLocaleString())}</td></tr>`).join('')}</table></div>`
      : '<p class="muted">None yet. Do Labs 11 and 12.</p>'}
  </article>
  <article class="card"><h3>Environment variables (${i.envVars.length})</h3>
    <p class="hint">Beanstalk environment properties become process environment variables. Names that look secret are hidden.</p>
    <div class="table-wrap"><table><tr><th>Name</th><th>Value</th></tr>${i.envVars.map((v) => `<tr><td class="mono">${esc(v.name)}</td><td class="mono ${v.masked ? 'muted' : ''}">${esc(v.value)}</td></tr>`).join('')}</table></div>
  </article>`;

  const ng = await api('/nginx-lab', { timeout: 4000 });
  const ok = ng.ok && typeof ng.data === 'string' && ng.data.includes('nginx');
  $('#nginx-check').innerHTML = ok
    ? `<span class="pill good">nginx customised</span> <code>/nginx-lab</code> → ${esc(ng.data.trim())}`
    : `<span class="pill">not yet</span> <code>/nginx-lab</code> returned ${esc(ng.status || ng.error)}. That's expected until Lab 13.`;
}

// ---------- Chaos ----------
function logChaos(label, r) {
  const box = $('#chaos-log');
  if (box.querySelector('p.muted')) box.innerHTML = '';
  const d = typeof r.data === 'object' && r.data ? r.data : {};
  const msg = d.message || d.error || r.error || (typeof r.data === 'string' ? r.data.replace(/<[^>]+>/g, ' ').trim().slice(0, 120) : '');
  const line = document.createElement('div');
  line.className = `log-line ${r.ok ? '' : 'bad'}`;
  line.innerHTML = `<time>${new Date().toLocaleTimeString()}</time><b>${esc(label)}</b><span>${esc(r.status || 'ERR')} · ${r.ms} ms</span><span class="mono">${esc(who(d.servedBy))}</span><span>${esc(msg)}</span>`;
  box.prepend(line);
}

const actions = {
  'health-ok': () => post('/api/chaos/health', { mode: 'ok' }),
  'health-fail': () => post('/api/chaos/health', { mode: 'fail', revertAfterMinutes: num('#health-revert', 3) }),
  'health-slow': () => post('/api/chaos/health', { mode: 'slow', revertAfterMinutes: num('#health-revert', 3) }),
  async errors() {
    const total = Math.min(1000, Math.max(1, num('#error-count', 100)));
    const started = performance.now();
    const statuses = {};
    const instances = new Set();
    for (let sent = 0; sent < total; sent += 10) {
      const batch = await Promise.all(Array.from({ length: Math.min(10, total - sent) }, () => api('/api/chaos/error', { timeout: 5000 })));
      batch.forEach((r) => {
        statuses[r.status] = (statuses[r.status] || 0) + 1;
        if (r.data?.servedBy) instances.add(r.data.servedBy.instanceId || r.data.servedBy.host);
      });
    }
    const summary = Object.entries(statuses).map(([s, n]) => `${n}× ${s}`).join(', ');
    return { ok: true, status: 'done', ms: Math.round(performance.now() - started), data: { message: `Sent ${total} requests: ${summary}. Hit ${instances.size} instance(s).` } };
  },
  slow: () => { const ms = num('#slow-ms', 5000); return api(`/api/chaos/slow?ms=${ms}`, { timeout: ms + 70000 }); },
  cpu: () => post('/api/chaos/cpu', { cores: num('#cpu-cores', 2), seconds: num('#cpu-seconds', 600) }),
  'cpu-stop': () => post('/api/chaos/cpu/stop'),
  memory: () => post('/api/chaos/memory', { mb: num('#memory-mb', 128) }, { timeout: 30000 }),
  'memory-release': () => post('/api/chaos/memory/release'),
  block: () => post('/api/chaos/block', { seconds: num('#block-seconds', 20) }),
  crash: () => (confirm('Crash the Node.js process on whichever instance answers?') ? post('/api/chaos/crash') : null),
  log: () => post('/api/log', { level: $('#log-level').value, message: $('#log-message').value }),
  'clear-log': () => { $('#chaos-log').innerHTML = '<p class="muted">Nothing yet.</p>'; return null; }
};

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn || !actions[btn.dataset.action]) return;
  btn.disabled = true;
  try {
    const r = await actions[btn.dataset.action]();
    if (r) logChaos(btn.textContent.trim() + ' · ' + btn.closest('.card').querySelector('h3').textContent, r);
  } finally {
    btn.disabled = false;
  }
});

$('#lab-key').value = store.get('labKey', '');
$('#lab-key').addEventListener('change', (e) => store.set('labKey', e.target.value));

// ---------- Deploy watcher ----------
const PALETTE = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6', '#f97316', '#64748b', '#84cc16'];
const colorMaps = { version: new Map(), instance: new Map() };
const colorFor = (kind, key) => {
  const map = colorMaps[kind];
  if (!map.has(key)) map.set(key, PALETTE[map.size % PALETTE.length]);
  return map.get(key);
};
const watch = { running: false, timer: null, rows: [] };

async function watchTick() {
  if (!watch.running) return;
  const r = await api('/api/info?watch=1', { timeout: 5000 });
  const d = r.ok ? r.data : null;
  watch.rows.push({
    t: Date.now(), ok: r.ok, status: r.status || 'ERR', ms: r.ms,
    version: d ? `v${d.app.version}${d.app.color ? ` (${d.app.color})` : ''}` : null,
    instance: d ? d.instance.instanceId || d.runtime.hostname : null,
    pid: d ? d.runtime.pid : null,
    error: r.ok ? null : r.error || (typeof r.data === 'string' ? r.data.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) : r.data?.error) || `HTTP ${r.status}`
  });
  if (watch.rows.length > 3000) watch.rows.shift();
  renderWatch();
  watch.timer = setTimeout(watchTick, Number($('#watch-interval').value) || 1000);
}

function renderWatch() {
  const rows = watch.rows;
  const recent = rows.slice(-240);
  const strip = (kind) =>
    recent.map((r) => (r.ok
      ? `<i style="background:${colorFor(kind, r[kind])}" title="${esc(new Date(r.t).toLocaleTimeString())} · ${esc(r[kind])} · ${r.ms} ms"></i>`
      : `<i class="err" title="${esc(new Date(r.t).toLocaleTimeString())} · ${esc(r.status)} ${esc(r.error)}"></i>`)).join('');
  $('#strip-version').innerHTML = strip('version');
  $('#strip-instance').innerHTML = strip('instance');

  const group = (kind) => {
    const g = new Map();
    rows.filter((r) => r.ok).forEach((r) => {
      const e = g.get(r[kind]) || { n: 0, first: r.t, last: r.t, pids: new Set() };
      e.n += 1; e.last = r.t; e.pids.add(r.pid);
      g.set(r[kind], e);
    });
    return [...g.entries()];
  };
  const errors = rows.filter((r) => !r.ok);
  const okRows = rows.filter((r) => r.ok);
  const avg = okRows.length ? Math.round(okRows.reduce((s, r) => s + r.ms, 0) / okRows.length) : 0;
  const table = (title, kind) => `<div><h4>${title}</h4><table><tr><th>${kind}</th><th>Responses</th><th>First seen</th><th>Last seen</th>${kind === 'instance' ? '<th>PIDs</th>' : ''}</tr>${group(kind)
    .map(([k, e]) => `<tr><td class="mono"><span class="swatch" style="background:${colorFor(kind, k)}"></span>${esc(k)}</td><td>${e.n}</td><td>${new Date(e.first).toLocaleTimeString()}</td><td>${new Date(e.last).toLocaleTimeString()}</td>${kind === 'instance' ? `<td class="mono">${[...e.pids].join(', ')}</td>` : ''}</tr>`)
    .join('')}</table></div>`;
  $('#watch-summary').innerHTML = `${table('Versions seen', 'version')}${table('Instances seen', 'instance')}
    <div><h4>Totals</h4>${kv([['Requests', rows.length], ['Failed', `${errors.length} (${rows.length ? Math.round((errors.length / rows.length) * 100) : 0}%)`], ['Avg latency', `${avg} ms`]])}</div>`;
  $('#watch-table').innerHTML = `<h4>Last 15 requests</h4><div class="table-wrap"><table><tr><th>Time</th><th>Status</th><th>Version</th><th>Instance</th><th>PID</th><th>Latency</th><th>Error</th></tr>${rows.slice(-15).reverse()
    .map((r) => `<tr><td>${new Date(r.t).toLocaleTimeString()}</td><td><span class="pill ${r.ok ? 'good' : 'bad'}">${esc(r.status)}</span></td><td class="mono">${val(r.version)}</td><td class="mono">${val(r.instance)}</td><td>${val(r.pid)}</td><td>${r.ms} ms</td><td>${val(r.error)}</td></tr>`)
    .join('')}</table></div>`;
}

$('#watch-toggle').addEventListener('click', () => {
  watch.running = !watch.running;
  clearTimeout(watch.timer);
  $('#watch-toggle').textContent = watch.running ? 'Stop watching' : 'Start watching';
  $('#watch-toggle').className = watch.running ? 'bad' : 'good';
  if (watch.running) watchTick();
});
$('#watch-clear').addEventListener('click', () => {
  watch.rows = [];
  colorMaps.version.clear();
  colorMaps.instance.clear();
  renderWatch();
});

// ---------- Worker & DB ----------
async function loadTasks() {
  const r = await api('/api/worker/tasks');
  const tasks = r.ok ? r.data.tasks : [];
  $('#tasks').innerHTML = !r.ok
    ? `<div class="callout bad">Could not load tasks (${esc(r.status || r.error)})</div>`
    : tasks.length
      ? `<p class="hint">Answered by ${esc(who(r.data.servedBy))}. Each instance only remembers the tasks it received itself, and only until it restarts.</p><div class="table-wrap"><table><tr><th>Received</th><th>Kind</th><th>From sqsd</th><th>Message ID / task</th><th>Attempt</th><th>Result</th><th>Body</th></tr>${tasks
        .map((t) => `<tr><td>${esc(new Date(t.receivedAt).toLocaleTimeString())}</td><td>${esc(t.kind)}</td><td>${t.fromSqsd ? 'yes' : 'no (simulated)'}</td><td class="mono">${esc(t.taskName || t.id)}</td><td>${esc(t.receiveCount)}</td><td><span class="pill ${t.result === 'ok' ? 'good' : 'bad'}">${esc(t.result)}</span></td><td class="mono">${esc(t.body)}</td></tr>`)
        .join('')}</table></div>`
      : '<p class="muted">No tasks received yet. Send one with the simulator, or deploy a worker environment (Lab 15).</p>';
}

$('#tasks-refresh').addEventListener('click', loadTasks);
$('#task-send').addEventListener('click', async () => {
  await fetch('/worker/task', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: $('#task-body').value });
  loadTasks();
});
$('#db-check').addEventListener('click', async (e) => {
  e.target.disabled = true;
  const r = await api('/api/db', { timeout: 8000 });
  e.target.disabled = false;
  const d = r.data || {};
  $('#db-result').innerHTML = !r.ok
    ? `<div class="callout bad">Request failed (${esc(r.status || r.error)})</div>`
    : !d.configured
      ? `<div class="callout warn" style="margin-top:12px">${esc(d.message)}</div>`
      : `<div class="callout ${d.reachable ? 'good' : 'bad'}" style="margin-top:12px"><b>${d.reachable ? 'Reachable' : 'Not reachable'}</b>
          ${kv([['Host', d.host], ['Port', d.port], ['Database', d.dbName], ['Source', d.source], ['Time', `${d.ms} ms`], ['Error', d.error], ['Checked from', who(d.servedBy)]])}</div>`;
});

// ---------- Labs ----------
const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');

function renderLabs() {
  const done = store.get('labsDone', {});
  const open = store.get('labsOpen', null);
  $('#labs').innerHTML = window.LABS.map((lab, idx) => `
    <details class="lab ${done[lab.id] ? 'done' : ''}" data-id="${lab.id}" ${open === lab.id ? 'open' : ''}>
      <summary><span class="lab-num">${done[lab.id] ? '✓' : idx}</span>
        <span><div class="lab-title">${esc(lab.title)}</div><div class="lab-meta">${esc(lab.level)} · ~${lab.minutes} min · ${esc(lab.cost)}</div></span></summary>
      <div class="lab-body">
        <p>${inline(lab.goal)}</p>
        ${lab.concepts?.length ? `<h4>Concepts</h4><ul>${lab.concepts.map((c) => `<li>${inline(c)}</li>`).join('')}</ul>` : ''}
        <h4>Steps</h4><ol>${lab.steps.map((s) => `<li>${inline(s.t)}${s.cmd ? `<div class="cmd"><pre>${esc(s.cmd)}</pre><button data-copy>Copy</button></div>` : ''}</li>`).join('')}</ol>
        ${lab.gotchas?.length ? `<h4>Gotchas</h4>${lab.gotchas.map((g) => `<div class="gotcha">${inline(g)}</div>`).join('')}` : ''}
        <h4>You're done when…</h4><div class="verify">${inline(lab.verify)}</div>
        <label class="done-toggle"><input type="checkbox" data-done="${lab.id}" ${done[lab.id] ? 'checked' : ''}/> Mark lab as complete</label>
      </div>
    </details>`).join('');
  updateLabProgress();
}

function updateLabProgress() {
  const done = store.get('labsDone', {});
  const count = window.LABS.filter((l) => done[l.id]).length;
  $('#labs-progress-bar').style.width = `${(count / window.LABS.length) * 100}%`;
  $('#labs-progress-badge').textContent = `${count}/${window.LABS.length}`;
}

$('#labs').addEventListener('change', (e) => {
  const id = e.target.dataset.done;
  if (!id) return;
  const done = store.get('labsDone', {});
  done[id] = e.target.checked;
  store.set('labsDone', done);
  e.target.closest('details').classList.toggle('done', e.target.checked);
  e.target.closest('details').querySelector('.lab-num').textContent = e.target.checked ? '✓' : window.LABS.findIndex((l) => l.id === id);
  updateLabProgress();
});
$('#labs').addEventListener('toggle', (e) => {
  if (e.target.open) store.set('labsOpen', e.target.dataset.id);
}, true);
$('#labs').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-copy]');
  if (!btn) return;
  try {
    await navigator.clipboard.writeText(btn.previousElementSibling.textContent);
    btn.textContent = 'Copied';
  } catch {
    btn.textContent = 'Select & copy';
  }
  setTimeout(() => { btn.textContent = 'Copy'; }, 1200);
});

// ---------- Router ----------
function show() {
  const view = VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : 'overview';
  Object.keys(VIEWS).forEach((v) => { $(`#view-${v}`).hidden = v !== view; });
  $$('.nav-link').forEach((a) => a.classList.toggle('active', a.dataset.view === view));
  [$('#view-title').textContent, $('#view-subtitle').textContent] = VIEWS[view];
  clearInterval(overviewTimer);
  if (view === 'overview') {
    loadOverview();
    overviewTimer = setInterval(loadOverview, 10000);
  }
  if (view === 'backend') loadTasks();
}

$('#refresh').addEventListener('click', show);
window.addEventListener('hashchange', show);
renderLabs();
show();
// Keep the sidebar/chip current even when not on Overview.
api('/api/info').then((r) => r.ok && updateChrome(r.data));
