// Local dashboard for running Playwright tests and reviewing failures.
// Start with `npm run test:dashboard`, then open http://127.0.0.1:5190.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir, copyFile, rm, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const runsDir = path.join(here, '.runs');
const PORT = Number(process.env.DASHBOARD_PORT || 5190);
const HOST = '127.0.0.1';
const MAX_RUNS = 30;
const MARKER = '@@PWDASH@@';
const playwright = (...args) => [process.execPath, ['--preserve-symlinks', '--preserve-symlinks-main', path.join(root, 'node_modules/@playwright/test/cli.js'), ...args]];

const stripAnsi = s => typeof s === 'string' ? s.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '') : s;
const cleanError = e => e && { ...e, message: stripAnsi(e.message), stack: stripAnsi(e.stack), snippet: stripAnsi(e.snippet) };
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webm': 'video/webm', '.zip': 'application/zip', '.md': 'text/markdown; charset=utf-8', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8' };

let testCache = null;
let current = null; // the run in progress, if any
const clients = new Set();

function broadcast(event) {
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) res.write(line);
}

function collect(cmd, args) {
  return new Promise(resolve => {
    const child = spawn(cmd, args, { cwd: root, env: process.env });
    let out = '', err = '';
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => err += d);
    child.on('close', code => resolve({ code, out, err }));
    child.on('error', e => resolve({ code: -1, out, err: String(e) }));
  });
}

async function listTests() {
  const { out, err } = await collect(...playwright('test', '--list', '--reporter=json'));
  let report;
  try { report = JSON.parse(out.slice(out.indexOf('{'))); }
  catch { throw new Error(stripAnsi(err || out) || 'Could not list tests.'); }
  if (report.errors?.length) throw new Error(report.errors.map(e => stripAnsi(e.message)).join('\n\n'));
  const tests = [];
  const walk = (suite, titles) => {
    for (const spec of suite.specs || []) {
      tests.push({ id: spec.id, title: spec.title, titlePath: [...titles, spec.title], file: spec.file, line: spec.line, tags: spec.tags || [] });
    }
    for (const child of suite.suites || []) walk(child, [...titles, child.title]);
  };
  for (const fileSuite of report.suites || []) walk(fileSuite, []);
  testCache = { tests, workers: report.config?.workers, listedAt: Date.now() };
  return testCache;
}

const summarize = run => {
  const counts = { passed: 0, failed: 0, flaky: 0, skipped: 0, running: 0, queued: 0 };
  for (const t of Object.values(run.tests)) counts[t.state] = (counts[t.state] || 0) + 1;
  // Per-test outcome lets the Tests view show each test's latest result across runs.
  const results = Object.fromEntries(Object.values(run.tests).map(t => [t.id, { state: t.state, duration: t.duration }]));
  return { id: run.id, startedAt: run.startedAt, endedAt: run.endedAt, status: run.status, workers: run.workers, headed: run.headed, total: Object.keys(run.tests).length, counts, results };
};

async function saveRun(run) {
  await writeFile(path.join(runsDir, run.id, 'run.json'), JSON.stringify(run, null, 1));
}

async function pruneRuns() {
  const ids = (await readdir(runsDir).catch(() => [])).sort().reverse();
  for (const id of ids.slice(MAX_RUNS)) await rm(path.join(runsDir, id), { recursive: true, force: true });
}

async function startRun({ ids, workers, headed }) {
  if (current) throw Object.assign(new Error('A run is already in progress.'), { status: 409 });
  const { tests } = testCache || await listTests();
  const selected = Array.isArray(ids) && ids.length ? tests.filter(t => ids.includes(t.id)) : tests;
  if (!selected.length) throw Object.assign(new Error('No tests selected.'), { status: 400 });
  workers = Math.max(1, Math.min(16, Number(workers) || 1));

  const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomBytes(2).toString('hex');
  const dir = path.join(runsDir, id);
  await mkdir(dir, { recursive: true });

  const args = ['test', `--workers=${workers}`, `--add-reporter=${path.join(here, 'stream-reporter.mjs')}`];
  if (headed) args.push('--headed');
  if (selected.length !== tests.length) {
    const listFile = path.join(dir, 'test-list.txt');
    await writeFile(listFile, selected.map(t => [t.file, ...t.titlePath].join(' › ')).join('\n'));
    args.push(`--test-list=${listFile}`);
  }

  const run = {
    id, startedAt: Date.now(), endedAt: null, status: 'running', workers, headed: !!headed,
    command: `playwright test --workers=${workers}${headed ? ' --headed' : ''}${selected.length !== tests.length ? ` --test-list (${selected.length} tests)` : ''}`,
    tests: Object.fromEntries(selected.map(t => [t.id, { ...t, state: 'queued', steps: [], errors: [], attachments: [], duration: null, analysis: null }])),
    errors: [], log: '',
  };
  const [cmd, cmdArgs] = playwright(...args);
  const child = spawn(cmd, cmdArgs, { cwd: root, env: { ...process.env, PLAYWRIGHT_HTML_OPEN: 'never', FORCE_COLOR: '0' } });
  current = { run, child, dir, pending: [] };
  broadcast({ type: 'runStart', run });

  let buffer = '';
  const onLine = line => {
    if (!line.startsWith(MARKER)) return appendLog(line + '\n');
    let event;
    try { event = JSON.parse(line.slice(MARKER.length)); } catch { return; }
    current.pending.push(handleEvent(run, dir, event));
  };
  child.stdout.on('data', d => {
    buffer += d;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) { onLine(buffer.slice(0, i).replace(/\r$/, '')); buffer = buffer.slice(i + 1); }
  });
  child.stderr.on('data', d => appendLog(String(d)));
  const appendLog = text => {
    text = stripAnsi(text);
    run.log = (run.log + text).slice(-200_000);
    broadcast({ type: 'log', runId: id, text });
  };
  child.on('close', async code => {
    if (buffer) onLine(buffer);
    await Promise.all(current.pending);
    if (run.status === 'running') run.status = current.stopped ? 'stopped' : code === 0 ? 'passed' : 'failed';
    run.endedAt = Date.now();
    for (const t of Object.values(run.tests)) if (t.state === 'running' || t.state === 'queued') t.state = current.stopped ? 'stopped' : 'skipped';
    if (current.stopped) run.status = 'stopped';
    await saveRun(run).catch(() => {});
    current = null;
    broadcast({ type: 'runEnd', run });
    pruneRuns();
  });
  child.on('error', e => { run.errors.push({ message: String(e) }); });
  return run;
}

async function handleEvent(run, dir, e) {
  const t = run.tests[e.id];
  switch (e.type) {
    case 'begin':
      // Tests Playwright actually collected; anything else that was selected won't run.
      for (const info of e.tests) if (!run.tests[info.id]) run.tests[info.id] = { ...info, state: 'queued', steps: [], errors: [], attachments: [], duration: null, analysis: null };
      break;
    case 'testBegin':
      if (!t) return;
      Object.assign(t, { state: 'running', retry: e.retry, workerIndex: e.workerIndex, steps: [], errors: [], attachments: [] });
      break;
    case 'stepBegin':
      if (t) t.steps.push({ title: e.title, state: 'running' });
      break;
    case 'stepEnd': {
      if (!t) return;
      const step = t.steps.findLast(s => s.title === e.title && s.state === 'running') || (t.steps.push({ title: e.title }), t.steps.at(-1));
      Object.assign(step, { state: e.error ? 'failed' : 'passed', duration: e.duration, error: cleanError(e.error) });
      break;
    }
    case 'testEnd': {
      if (!t) return;
      const attachments = [];
      for (const [i, a] of e.attachments.entries()) {
        const entry = { name: a.name, contentType: a.contentType };
        if (a.path) {
          const file = `${e.id}-r${e.retry}-${i}${path.extname(a.path)}`.replace(/[^\w.-]/g, '_');
          try { await copyFile(a.path, path.join(dir, file)); entry.file = file; } catch { continue; }
        } else if (a.body) entry.body = a.body;
        attachments.push(entry);
      }
      const state = e.outcome === 'flaky' ? 'flaky' : e.outcome === 'skipped' ? 'skipped' : e.outcome === 'expected' ? 'passed' : (e.status === 'failed' || e.status === 'timedOut' || e.status === 'interrupted' || e.outcome === 'unexpected') ? 'failed' : 'passed';
      Object.assign(t, { state, status: e.status, duration: e.duration, retry: e.retry, errors: e.errors.map(cleanError), annotations: e.annotations, attachments });
      for (const s of t.steps) if (s.state === 'running') s.state = 'failed';
      break;
    }
    case 'error':
      run.errors.push(cleanError(e.error));
      break;
    case 'end':
      run.status = e.status === 'passed' ? 'passed' : e.status === 'interrupted' ? 'stopped' : 'failed';
      break;
  }
  broadcast({ type: 'update', runId: run.id, event: e.type, test: t, errors: run.errors, status: run.status });
}

function stopRun() {
  if (!current) return false;
  current.stopped = true;
  // Kill the whole tree so Playwright's web server on 5174 is released too.
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(current.child.pid), '/T', '/F']);
  else current.child.kill('SIGINT');
  return true;
}

async function loadRun(id) {
  if (current?.run.id === id) return current.run;
  if (!/^[\w-]+$/.test(id)) return null;
  try { return JSON.parse(await readFile(path.join(runsDir, id, 'run.json'), 'utf8')); } catch { return null; }
}

async function listRuns() {
  const ids = (await readdir(runsDir).catch(() => [])).sort().reverse();
  const runs = [];
  for (const id of ids) { const run = await loadRun(id); if (run) runs.push(summarize(run)); }
  if (current && !runs.some(r => r.id === current.run.id)) runs.unshift(summarize(current.run));
  return runs;
}

async function serveFile(res, file) {
  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error();
    res.writeHead(200, { 'content-type': types[path.extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': s.size });
    createReadStream(file).pipe(res);
  } catch { send(res, 404, { error: 'Not found' }); }
}

// Resolve a request path inside base, refusing anything that escapes it.
const inside = (base, rel) => {
  const file = path.resolve(base, '.' + path.posix.normalize('/' + decodeURIComponent(rel)));
  return file.startsWith(base + path.sep) || file === base ? file : null;
};

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 1e6) throw new Error('Body too large'); }
  return body ? JSON.parse(body) : {};
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  try {
    if (req.method === 'POST') {
      // These endpoints spawn processes: only accept same-origin JSON requests.
      const origin = req.headers.origin;
      if (!String(req.headers['content-type']).startsWith('application/json') || (origin && origin !== `http://${req.headers.host}`)) return send(res, 403, { error: 'Forbidden' });
      const body = await readJson(req);
      if (p === '/api/run') return send(res, 200, summarize(await startRun(body)));
      if (p === '/api/stop') return send(res, 200, { stopped: stopRun() });
      if (p === '/api/tests/refresh') return send(res, 200, await listTests());
      if (p === '/api/trace') {
        const run = await loadRun(String(body.runId));
        const file = run && inside(path.join(runsDir, run.id), String(body.file));
        if (!file) return send(res, 404, { error: 'Trace not found' });
        const [cmd, args] = playwright('show-trace', file);
        spawn(cmd, args, { cwd: root, detached: true, stdio: 'ignore' }).unref();
        return send(res, 200, { opened: true });
      }
      return send(res, 404, { error: 'Not found' });
    }

    if (p === '/' || p === '/index.html') return serveFile(res, path.join(here, 'index.html'));
    if (p === '/api/tests') return send(res, 200, testCache || await listTests());
    if (p === '/api/state') return send(res, 200, { current: current?.run || null });
    if (p === '/api/runs') return send(res, 200, await listRuns());
    let m;
    if ((m = p.match(/^\/api\/runs\/([\w-]+)$/))) {
      const run = await loadRun(m[1]);
      return run ? send(res, 200, run) : send(res, 404, { error: 'Run not found' });
    }
    if ((m = p.match(/^\/api\/runs\/([\w-]+)\/files\/(.+)$/))) {
      const file = inside(path.join(runsDir, m[1]), m[2]);
      return file ? serveFile(res, file) : send(res, 404, { error: 'Not found' });
    }
    if (p === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(': connected\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    send(res, 404, { error: 'Not found' });
  } catch (e) {
    send(res, e.status || 500, { error: e.message });
  }
});

await mkdir(runsDir, { recursive: true });
server.listen(PORT, HOST, () => console.log(`Test dashboard: http://${HOST}:${PORT}`));
const shutdown = () => { stopRun(); setTimeout(() => process.exit(0), 300); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
