// Local dashboard for running Playwright tests and reviewing failures.
// Start with `npm run test:dashboard`, then open http://127.0.0.1:5190.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir, copyFile, rm, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { findClaude, buildPrompt, analyse } from './analysis.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const runsDir = path.join(here, '.runs');
const PORT = Number(process.env.DASHBOARD_PORT || 5190);
const HOST = '127.0.0.1';
// Older runs are deleted with their videos, traces and screenshots.
const MAX_RUNS = 5;
const MARKER = '@@PWDASH@@';
const playwright = (...args) => [process.execPath, ['--preserve-symlinks', '--preserve-symlinks-main', path.join(root, 'node_modules/@playwright/test/cli.js'), ...args]];

const stripAnsi = s => typeof s === 'string' ? s.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '') : s;
const cleanError = e => e && { ...e, message: stripAnsi(e.message), stack: stripAnsi(e.stack), snippet: stripAnsi(e.snippet) };
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webm': 'video/webm', '.mp4': 'video/mp4', '.zip': 'application/zip', '.md': 'text/markdown; charset=utf-8', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.ttf': 'font/ttf', '.map': 'application/json' };
// Monaco (the editor VS Code is built on) powers the Code tab; served from node_modules so it works offline.
const monacoDir = path.join(root, 'node_modules', 'monaco-editor', 'min');

// Playwright records WebM, which VS Code's built-in browser can't open (its media library has no WebM support)
// but it can play H.264 MP4. Each recording also gets an MP4 copy next to it (about 8x smaller), which the
// pages offer first. Uses the ffmpeg-static dev dependency; without it, only WebM is available.
let ffmpegPath = null;
try { ffmpegPath = (await import('ffmpeg-static')).default; } catch {}
const mp4Of = file => file.replace(/\.webm$/i, '.mp4');
let conversions = Promise.resolve();
function toMp4(webm) {
  if (!ffmpegPath || !/\.webm$/i.test(webm)) return Promise.resolve(false);
  // One conversion at a time, so a run with many tests doesn't compete with the tests for CPU.
  conversions = conversions.then(() => new Promise(resolve => {
    const p = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-i', webm, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', mp4Of(webm)], { stdio: 'ignore' });
    p.on('close', code => resolve(code === 0));
    p.on('error', () => resolve(false));
  }));
  return conversions;
}
// Convert recordings kept from before this existed (runs and bug reports), in the background.
async function convertExistingVideos() {
  for (const base of [runsDir, path.join(here, 'bugs')]) {
    for (const dir of await readdir(base).catch(() => [])) {
      for (const file of await readdir(path.join(base, dir)).catch(() => [])) {
        if (!/\.webm$/i.test(file)) continue;
        const webm = path.join(base, dir, file);
        if (!(await stat(mp4Of(webm)).catch(() => null))) await toMp4(webm);
      }
    }
  }
}

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

// Triage of a finished test: failures need triage until they pass on a retry or are linked to a bug report.
const triage = t => t.state === 'failed' ? (t.bug ? 'bugged' : 'investigate') : t.state;

const summarize = run => {
  const counts = { passed: 0, investigate: 0, bugged: 0, skipped: 0, running: 0, queued: 0 };
  for (const t of Object.values(run.tests)) counts[triage(t)] = (counts[triage(t)] || 0) + 1;
  // Total attempts across tests (1 per test that ran, plus retries).
  // Runs recorded before attempts were tracked count 1 per test that ran.
  const attempts = Object.values(run.tests).reduce((n, t) => n + (t.attempts?.length || (['queued', 'stopped'].includes(t.state) ? 0 : 1)), 0);
  // Per-test outcome lets the Tests view show each test's latest result across runs.
  const results = Object.fromEntries(Object.values(run.tests).map(t => [t.id, { state: t.state, duration: t.duration, bug: t.bug || null }]));
  return { id: run.id, startedAt: run.startedAt, endedAt: run.endedAt, status: run.status, workers: run.workers, headed: run.headed, slowMo: run.slowMo || 0, retries: run.retries || 0, attempts, total: Object.keys(run.tests).length, counts, results };
};

async function saveRun(run) {
  await writeFile(path.join(runsDir, run.id, 'run.json'), JSON.stringify(run, null, 1));
}

async function pruneRuns() {
  const ids = (await readdir(runsDir).catch(() => [])).sort().reverse();
  for (const id of ids.slice(MAX_RUNS)) await rm(path.join(runsDir, id), { recursive: true, force: true });
}

async function startRun({ ids, workers, headed, slowMo, retries }) {
  if (current) throw Object.assign(new Error('A run is already in progress.'), { status: 409 });
  const { tests } = testCache || await listTests();
  const selected = Array.isArray(ids) && ids.length ? tests.filter(t => ids.includes(t.id)) : tests;
  if (!selected.length) throw Object.assign(new Error('No tests selected.'), { status: 400 });
  workers = Math.max(1, Math.min(16, Number(workers) || 1));
  slowMo = Math.max(0, Math.min(5000, Math.round(Number(slowMo)) || 0));
  // Failed tests are re-attempted within the same run; passing on a retry counts as passed.
  retries = Math.max(0, Math.min(3, Math.round(Number(retries)) || 0));
  // Dashboard runs always record video, so every result can be watched back.
  const video = true;
  // Video annotations and slow-mo both pause on every action, so the 60s test timeout is raised:
  // 2 min for the annotations plus 200 slowed actions' worth of slow-mo (220s at 500 ms; the
  // longest test, account CRUD, takes about 37s at that speed). Stop still ends a run.
  const timeout = 120000 + slowMo * 200;

  const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomBytes(2).toString('hex');
  const dir = path.join(runsDir, id);
  await mkdir(dir, { recursive: true });

  const args = ['test', `--workers=${workers}`, `--add-reporter=${path.join(here, 'stream-reporter.mjs')}`];
  if (headed) args.push('--headed');
  args.push(`--timeout=${timeout}`, `--retries=${retries}`);
  if (selected.length !== tests.length) {
    const listFile = path.join(dir, 'test-list.txt');
    await writeFile(listFile, selected.map(t => [t.file, ...t.titlePath].join(' › ')).join('\n'));
    args.push(`--test-list=${listFile}`);
  }

  const run = {
    id, startedAt: Date.now(), endedAt: null, status: 'running', workers, headed: !!headed, slowMo, retries, video,
    command: `playwright test --workers=${workers}${retries ? ` --retries=${retries}` : ''}${headed ? ' --headed' : ''}${slowMo ? ` (slow-mo ${slowMo} ms)` : ''}${selected.length !== tests.length ? ` --test-list (${selected.length} tests)` : ''}`,
    tests: Object.fromEntries(selected.map(t => [t.id, { ...t, state: 'queued', steps: [], errors: [], attachments: [], attempts: [], attemptBase: 0, duration: null, analysis: null }])),
    errors: [], log: '',
  };
  launch(run, dir, args, { slowMo, video });
  return run;
}

// Each test keeps at most MAX_ATTEMPTS attempts per run; retrying is blocked until one is deleted.
const MAX_ATTEMPTS = 5;
// A page.pause() longer than this inside a test means its time measures the pause, so it's left blank.
// (In headless runs page.pause() returns in a few ms, so those times stay.)
const PAUSE_BLANKS_TIME_MS = 1000;
const storedAttempts = t => t.attempts?.length || (['queued', 'stopped'].includes(t.state) ? 0 : 1);
// Attempt numbers only go up, so a deleted attempt's number is never reused (delete 3 of 5 → next is 6).
const nextAttempt = t => Math.max(t.nextAttempt || 0, ...(t.attempts || []).map(a => a.retry + 1), t.attempts?.length ? 0 : 1);

// Delete one stored attempt and its files. The test's result follows its latest remaining attempt.
async function deleteAttempt(runId, testId, retry) {
  if (current?.run.id === runId) throw fail('Wait for this run to finish first.', 409);
  const run = await loadRun(String(runId));
  const t = run?.tests[String(testId)];
  if (!t) throw fail('Test not found in this run.', 404);
  const attempt = (t.attempts || []).find(a => a.retry === Number(retry));
  if (!attempt) throw fail('Attempt not found.', 404);
  if (t.attempts.length < 2) throw fail("A test's only attempt can't be deleted.");
  t.nextAttempt = nextAttempt(t);
  t.attempts = t.attempts.filter(a => a !== attempt);
  for (const a of attempt.attachments || []) if (a.file) for (const f of [a.file, mp4Of(a.file)]) await rm(path.join(runsDir, run.id, f), { force: true });
  const last = [...t.attempts].sort((a, b) => a.retry - b.retry).at(-1);
  Object.assign(t, { state: last.state === 'passed' ? 'passed' : last.state === 'skipped' ? 'skipped' : 'failed', status: last.status, duration: last.duration, retry: last.retry, errors: last.errors, steps: last.steps, attachments: last.attachments });
  await saveRun(run);
  broadcast({ type: 'testChanged', runId: run.id, test: t, status: run.status });
}

// Retry tests that need triage inside their original run, with the run's own settings.
// New attempts are added after the existing ones; a pass moves the test to Passed.
// A headed retry (one test) shows the browser and keeps it open at the end with the Playwright Inspector
// (PW_KEEP_OPEN, see tests/e2e/fixtures.ts) until you press Resume or close it, so it has no test timeout.
async function retryInRun(runId, ids, { headed = false } = {}) {
  if (current) throw Object.assign(new Error('A run is already in progress.'), { status: 409 });
  const run = await loadRun(runId);
  if (!run) throw Object.assign(new Error('Run not found.'), { status: 404 });
  if (headed && (!Array.isArray(ids) || ids.length !== 1)) throw Object.assign(new Error('A headed retry runs one test at a time.'), { status: 400 });
  const needTriage = (Array.isArray(ids) ? ids : []).map(id => run.tests[id]).filter(t => t && triage(t) === 'investigate');
  if (!needTriage.length) throw Object.assign(new Error('No tests need triage in this run.'), { status: 400 });
  // Tests already holding MAX_ATTEMPTS attempts are skipped until one is deleted.
  const targets = needTriage.filter(t => storedAttempts(t) < MAX_ATTEMPTS);
  if (!targets.length) throw Object.assign(new Error(`${needTriage.length > 1 ? 'These tests already have' : 'This test already has'} ${MAX_ATTEMPTS}/${MAX_ATTEMPTS} attempt data stored. Delete attempt data to retry.`), { status: 409 });
  const dir = path.join(runsDir, run.id);
  const listFile = path.join(dir, `retry-${Date.now()}.txt`);
  await writeFile(listFile, targets.map(t => [t.file, ...t.titlePath].join(' › ')).join('\n'));
  const slowMo = run.slowMo || 0;
  const args = ['test', `--workers=${headed ? 1 : run.workers || 1}`, `--add-reporter=${path.join(here, 'stream-reporter.mjs')}`, `--timeout=${headed ? 0 : 120000 + slowMo * 200}`, '--retries=0', `--test-list=${listFile}`];
  if (headed || run.headed) args.push('--headed');
  for (const t of targets) Object.assign(t, { state: 'queued', attemptBase: nextAttempt(t), steps: [], errors: [], attachments: [] });
  Object.assign(run, { status: 'running', endedAt: null, retrying: targets.map(t => t.id), retryStartedAt: Date.now(), keepOpen: headed });
  run.log = (run.log + `\n──── ${headed ? 'Headed retry, browser stays open at the end' : 'Retrying'}: ${targets.length} test${targets.length > 1 ? 's' : ''} (${new Date().toLocaleString()}) ────\n`).slice(-200_000);
  launch(run, dir, args, { slowMo, video: true, append: true, env: headed ? { PW_KEEP_OPEN: '1' } : {} });
  return run;
}

function launch(run, dir, args, { slowMo, video, append = false, env = {} }) {
  const id = run.id;
  const [cmd, cmdArgs] = playwright(...args);
  const child = spawn(cmd, cmdArgs, { cwd: root, env: { ...process.env, PLAYWRIGHT_HTML_OPEN: 'never', FORCE_COLOR: '0', PW_SLOW_MO: String(slowMo), PW_VIDEO: video ? '1' : '0', ...env } });
  current = { run, child, dir, pending: [], append };
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
    run.endedAt = Date.now();
    // A retry that didn't finish leaves the test where it was (needing triage).
    for (const t of Object.values(run.tests)) if (t.state === 'running' || t.state === 'queued') t.state = append ? 'failed' : current.stopped ? 'stopped' : 'skipped';
    const anyFailed = Object.values(run.tests).some(t => t.state === 'failed');
    run.status = current.stopped && !append ? 'stopped' : anyFailed || (!append && code !== 0) ? 'failed' : 'passed';
    delete run.retrying; delete run.keepOpen;
    await saveRun(run).catch(() => {});
    current = null;
    broadcast({ type: 'runEnd', run });
    pruneRuns();
  });
  child.on('error', e => { run.errors.push({ message: String(e) }); });
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
      // Attempt numbers continue across in-run retries: attemptBase is the attempts made before this process.
      Object.assign(t, { state: 'running', retry: (t.attemptBase || 0) + e.retry, workerIndex: e.workerIndex, steps: [], errors: [], attachments: [] });
      break;
    case 'stepBegin':
      // Step locations let the Code tab mark each test.step() line with its result.
      if (t) t.steps.push({ title: e.title, state: 'running', location: e.location });
      break;
    case 'stepEnd': {
      if (!t) return;
      const step = t.steps.findLast(s => s.title === e.title && s.state === 'running') || (t.steps.push({ title: e.title }), t.steps.at(-1));
      // A step that sat in page.pause() has no meaningful time, so it's left blank.
      const paused = (e.pausedMs || 0) > PAUSE_BLANKS_TIME_MS;
      Object.assign(step, { state: e.error ? 'failed' : 'passed', duration: paused ? null : e.duration, paused, error: cleanError(e.error), location: e.location || step.location });
      break;
    }
    case 'testEnd': {
      if (!t) return;
      const n = (t.attemptBase || 0) + e.retry;
      const attachments = [];
      for (const [i, a] of e.attachments.entries()) {
        const entry = { name: a.name, contentType: a.contentType };
        if (a.path) {
          const file = `${e.id}-r${n}-${i}${path.extname(a.path)}`.replace(/[^\w.-]/g, '_');
          try { await copyFile(a.path, path.join(dir, file)); entry.file = file; } catch { continue; }
          if (/\.webm$/i.test(file)) await toMp4(path.join(dir, file));
        } else if (a.body) entry.body = a.body;
        attachments.push(entry);
      }
      // Only pass or fail: a test that passes on a retry counts as passed (its attempts are kept).
      const state = e.outcome === 'flaky' ? 'passed' : e.outcome === 'skipped' ? 'skipped' : e.outcome === 'expected' ? 'passed' : (e.status === 'failed' || e.status === 'timedOut' || e.status === 'interrupted' || e.outcome === 'unexpected') ? 'failed' : 'passed';
      const errors = e.errors.map(cleanError);
      for (const s of t.steps) if (s.state === 'running') s.state = 'failed';
      // Keep every attempt so a retried test still shows the failed attempt's error, steps and video.
      const actions = await withSourceLines(e.actions || []);
      // Time spent paused isn't test time: the "Retry headed" pause after the test is taken off, and a pause
      // inside the test leaves the time blank (it would only measure how long the browser was left paused).
      const pausedInTest = (e.pause?.body || 0) > PAUSE_BLANKS_TIME_MS;
      const duration = pausedInTest ? null : Math.max(0, e.duration - (e.pause?.end || 0));
      const attempt = { retry: n, state: e.status === 'passed' ? 'passed' : e.status === 'skipped' ? 'skipped' : 'failed', status: e.status, duration, pausedInTest, errors, steps: t.steps, attachments, actions };
      t.attempts = [...(t.attempts || []).filter(a => a.retry !== n), attempt];
      t.nextAttempt = Math.max(t.nextAttempt || 0, n + 1);
      Object.assign(t, { state, status: e.status, duration, pausedInTest, retry: n, errors, annotations: e.annotations, attachments, actions });
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

// ---------- Bug reports ----------
// Stored in test-dashboard/bugs/<bug-001>/ (git-ignored), separately from runs so they survive run pruning.
// Each occurrence keeps a snapshot of the failure (error, step, screenshot, video) for the same reason.
const bugsDir = path.join(here, 'bugs');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const bugRef = bug => ({ id: bug.id, number: bug.number, title: bug.title });

async function loadBug(id) {
  if (!/^bug-\d+$/.test(id)) return null;
  try { return JSON.parse(await readFile(path.join(bugsDir, id, 'bug.json'), 'utf8')); } catch { return null; }
}
async function saveBug(bug) {
  bug.updatedAt = Date.now();
  await mkdir(path.join(bugsDir, bug.id), { recursive: true });
  await writeFile(path.join(bugsDir, bug.id, 'bug.json'), JSON.stringify(bug, null, 1));
  broadcast({ type: 'bugs' });
}
async function listBugs() {
  const ids = (await readdir(bugsDir).catch(() => [])).filter(id => /^bug-\d+$/.test(id));
  const bugs = (await Promise.all(ids.map(loadBug))).filter(Boolean).sort((a, b) => b.number - a.number);
  return bugs.map(b => ({ ...bugRef(b), status: b.status, createdAt: b.createdAt, updatedAt: b.updatedAt, occurrences: b.occurrences.length, tests: [...new Set(b.occurrences.map(o => o.testId))] }));
}

// Load a finished run's test that is waiting for triage.
async function investigatable(runId, testId) {
  if (current?.run.id === runId) throw fail('Wait for this run to finish first.', 409);
  const run = await loadRun(String(runId));
  const t = run?.tests[String(testId)];
  if (!t) throw fail('Test not found in this run.', 404);
  return { run, t };
}

// Snapshot the chosen attempts into the bug's folder. Each attempt is attached as a bundle: its logs (errors and
// code snippet), screenshot, video and trace, plus error-context, which is kept for AI analysis but not shown.
// With no attempts chosen, the latest failed attempt is used.
async function occurrence(run, t, bug, note, chosen) {
  const all = t.attempts?.length ? [...t.attempts].sort((a, b) => a.retry - b.retry) : [{ ...t, retry: t.retry ?? 0 }];
  let picked = Array.isArray(chosen) ? all.filter(a => chosen.map(Number).includes(a.retry)) : [];
  if (Array.isArray(chosen) && chosen.length && !picked.length) throw fail('Choose at least one attempt to attach.');
  if (!picked.length) picked = [[...all].reverse().find(a => a.state === 'failed') || all.at(-1)];
  const attemptData = [];
  for (const a of picked) {
    const files = [];
    for (const f of a.attachments || []) {
      if (!f.file || !(/^(image|video)\//.test(f.contentType || '') || ['trace', 'error-context'].includes(f.name))) continue;
      const name = `${run.id}-${f.file}`;
      if (/^video\//.test(f.contentType || '')) await copyFile(path.join(runsDir, run.id, mp4Of(f.file)), path.join(bugsDir, bug.id, mp4Of(name))).catch(() => {});
      try { await copyFile(path.join(runsDir, run.id, f.file), path.join(bugsDir, bug.id, name)); files.push({ name: f.name, contentType: f.contentType, file: name }); } catch {}
    }
    attemptData.push({
      attempt: a.retry + 1, state: a.state, duration: a.duration ?? null,
      step: a.steps?.find(s => s.state === 'failed')?.title || null,
      errors: (a.errors || []).map(e => ({ message: String(e.message || e.value || '').slice(0, 8000), snippet: e.snippet ? String(e.snippet).slice(0, 4000) : null, location: e.location || null })),
      files,
    });
  }
  // Top-level fields summarise the first failed attempt chosen (older reports only have these).
  const lead = attemptData.find(a => a.state === 'failed') || attemptData[0];
  return {
    runId: run.id, runStartedAt: run.startedAt, testId: t.id, title: t.titlePath.join(' › '), file: t.file, line: t.line,
    attempt: lead.attempt, attempts: all.length, attemptData,
    step: lead.step, error: lead.errors[0]?.message || '', location: lead.errors[0]?.location || null,
    note: note || '', files: attemptData.flatMap(a => a.files), addedAt: Date.now(),
  };
}

async function linkBug(bug, run, t, note, attempts) {
  await mkdir(path.join(bugsDir, bug.id), { recursive: true });
  bug.occurrences.push(await occurrence(run, t, bug, note, attempts));
  await saveBug(bug);
  t.bug = bugRef(bug);
  await saveRun(run);
  broadcast({ type: 'testChanged', runId: run.id, test: t, status: run.status });
}

async function createBug({ runId, testId, title, description, attempts }) {
  title = String(title || '').trim(); description = String(description || '').trim();
  if (!title || title.length > 200) throw fail('Give the report a title (up to 200 characters).');
  if (description.length < 10 || description.length > 20000) throw fail('Write a description of the bug (at least 10 characters).');
  const { run, t } = await investigatable(runId, testId);
  if (triage(t) !== 'investigate') throw fail('Only tests that need triage can be marked as bugged.');
  const number = (await listBugs()).reduce((n, b) => Math.max(n, b.number), 0) + 1;
  const bug = { id: 'bug-' + String(number).padStart(3, '0'), number, title, description, status: 'open', createdAt: Date.now(), occurrences: [] };
  await linkBug(bug, run, t, '', attempts);
  return bug;
}

async function addToBug(id, { runId, testId, note, attempts }) {
  const bug = await loadBug(id);
  if (!bug) throw fail('Bug report not found.', 404);
  note = String(note || '').trim();
  if (note.length > 5000) throw fail('Keep the note under 5000 characters.');
  const { run, t } = await investigatable(runId, testId);
  if (triage(t) !== 'investigate') throw fail('Only tests that need triage can be marked as bugged.');
  await linkBug(bug, run, t, note, attempts);
  return bug;
}

// Undo "Mark as bugged": the test needs triage again and its occurrence leaves the report.
async function unmarkBug(runId, testId) {
  const { run, t } = await investigatable(runId, testId);
  if (!t.bug) throw fail('This test is not marked as bugged.');
  const bug = await loadBug(t.bug.id);
  if (bug) {
    const gone = bug.occurrences.filter(o => o.runId === run.id && o.testId === t.id);
    bug.occurrences = bug.occurrences.filter(o => !gone.includes(o));
    for (const f of gone.flatMap(o => o.files)) for (const name of [f.file, mp4Of(f.file)]) await rm(path.join(bugsDir, bug.id, name), { force: true });
    await saveBug(bug);
  }
  delete t.bug;
  await saveRun(run);
  broadcast({ type: 'testChanged', runId: run.id, test: t, status: run.status });
}

// ---------- Test source (Code tab) ----------
// Only files under tests/ can be read or saved from the dashboard.
const sourceRoot = path.join(root, 'tests');
const hashOf = text => createHash('sha1').update(text).digest('hex');
const within = (file, dir) => process.platform === 'win32' ? file.toLowerCase().startsWith(dir.toLowerCase() + path.sep) : file.startsWith(dir + path.sep);
// Accepts an absolute path (from an error location), a repo-relative path or a path relative to tests/e2e.
function sourcePath(p) {
  p = String(p || '');
  const candidates = path.isAbsolute(p) ? [p] : [path.join(root, p), path.join(sourceRoot, 'e2e', p)];
  return candidates.map(c => path.resolve(c)).find(c => within(c, sourceRoot)) || null;
}
async function readSource(p) {
  const file = sourcePath(p);
  if (!file) throw fail('Only files under tests/ can be opened.', 403);
  let content, s;
  try { [content, s] = await Promise.all([readFile(file, 'utf8'), stat(file)]); } catch { throw fail('File not found.', 404); }
  return { path: path.relative(root, file).split(path.sep).join('/'), abs: file, content, mtime: s.mtimeMs, hash: hashOf(content) };
}
// Saving is refused if the file changed on disk since it was opened, so edits made elsewhere aren't overwritten.
async function saveSource({ path: p, content, hash }) {
  const file = sourcePath(p);
  if (!file) throw fail('Only files under tests/ can be saved.', 403);
  if (typeof content !== 'string') throw fail('Nothing to save.');
  let currentText;
  try { currentText = await readFile(file, 'utf8'); } catch { throw fail('File not found.', 404); }
  if (hashOf(currentText) !== hash) throw fail('This file changed on disk since it was opened (for example in VS Code). Reload it before saving.', 409);
  await writeFile(file, content);
  testCache = null; // Test titles or lines may have changed; re-list on next request.
  return readSource(file);
}

// Add the line of test code behind each action (e.g. "await page.getByRole('button').click()"), so the
// action list says what was clicked. Only files under tests/ are read.
async function withSourceLines(actions) {
  const files = new Map();
  for (const a of actions) {
    const file = a.location?.file && path.resolve(a.location.file);
    if (!file || !within(file, sourceRoot)) continue;
    if (!files.has(file)) files.set(file, readFile(file, 'utf8').then(text => text.split(/\r?\n/), () => null));
    const lines = await files.get(file);
    const code = lines?.[a.location.line - 1]?.trim();
    if (code) a.code = code.length > 160 ? code.slice(0, 157) + '…' : code;
    a.location.file = path.relative(root, file).split(path.sep).join('/');
  }
  return actions;
}

// ---------- AI analysis ----------
// Started from a test's "Analyse" button; runs Claude Code headless (see analysis.mjs) on the latest failed
// attempt. The result is stored on the test (t.analysis) and pushed to the page when it's ready.
const analysing = new Map(); // "runId:testId" -> cancel function

async function setAnalysis(runId, testId, analysis) {
  // Re-read the run so a retry or bug mark made meanwhile isn't overwritten (a live run is the in-memory copy).
  const latest = await loadRun(runId);
  const t = latest?.tests[testId];
  if (!t) return;
  t.analysis = analysis;
  await saveRun(latest).catch(() => {});
  broadcast({ type: 'testChanged', runId, test: t, status: latest.status });
}

async function startAnalysis(runId, testId) {
  runId = String(runId); testId = String(testId);
  if (current?.run.id === runId) throw fail('Wait for this run to finish first.', 409);
  const key = runId + ':' + testId;
  if (analysing.has(key)) throw fail('This test is already being analysed.', 409);
  const run = await loadRun(runId);
  const t = run?.tests[testId];
  if (!t) throw fail('Test not found in this run.', 404);
  const all = t.attempts?.length ? [...t.attempts].sort((a, b) => a.retry - b.retry) : [{ ...t, retry: t.retry ?? 0 }];
  const attempt = [...all].reverse().find(a => a.state === 'failed');
  if (!attempt) throw fail('This test has no failed attempt to analyse.');
  const claudePath = await findClaude();
  if (!claudePath) throw fail('Claude Code was not found. Install it, or set CLAUDE_CODE_PATH to the claude executable.', 503);
  const prompt = await buildPrompt({ root, runsDir, run, test: t, attempt });
  const base = { attempt: attempt.retry + 1, startedAt: Date.now() };
  analysing.set(key, null);
  await setAnalysis(runId, testId, { ...base, status: 'running' });
  analyse({ claudePath, cwd: root, prompt, onStart: cancel => analysing.set(key, cancel) })
    .then(r => setAnalysis(runId, testId, { ...base, status: 'done', finishedAt: Date.now(), ...r }))
    .catch(e => setAnalysis(runId, testId, { ...base, status: e.message === 'Cancelled.' ? 'cancelled' : 'error', finishedAt: Date.now(), error: e.message }))
    .finally(() => analysing.delete(key));
}

// An analysis can't survive a dashboard restart, so one left "running" in a saved run is marked interrupted.
async function clearInterruptedAnalyses() {
  for (const id of await readdir(runsDir).catch(() => [])) {
    const run = await loadRun(id);
    const stuck = Object.values(run?.tests || {}).filter(t => t.analysis?.status === 'running');
    if (!stuck.length) continue;
    for (const t of stuck) Object.assign(t.analysis, { status: 'error', error: 'Interrupted: the dashboard restarted during the analysis.' });
    await saveRun(run).catch(() => {});
  }
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

async function serveFile(res, file, req) {
  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error();
    const type = types[path.extname(file).toLowerCase()] || 'application/octet-stream';
    // Byte ranges let the browser seek within recorded videos.
    const range = /^bytes=(\d*)-(\d*)$/.exec(req?.headers.range || '');
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, s.size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), s.size - 1) : s.size - 1;
      if (start > end || start >= s.size) { res.writeHead(416, { 'content-range': `bytes */${s.size}` }); return res.end(); }
      res.writeHead(206, { 'content-type': type, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${s.size}`, 'accept-ranges': 'bytes' });
      return createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'content-type': type, 'content-length': s.size, 'accept-ranges': 'bytes' });
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
      let pm;
      if ((pm = p.match(/^\/api\/runs\/([\w-]+)\/retry$/))) return send(res, 200, summarize(await retryInRun(pm[1], body.ids, { headed: !!body.headed })));
      if ((pm = p.match(/^\/api\/runs\/([\w-]+)\/unbug$/))) { await unmarkBug(pm[1], body.testId); return send(res, 200, { ok: true }); }
      if ((pm = p.match(/^\/api\/runs\/([\w-]+)\/delete-attempt$/))) { await deleteAttempt(pm[1], body.testId, body.retry); return send(res, 200, { ok: true }); }
      if (p === '/api/bugs') return send(res, 200, await createBug(body));
      if (p === '/api/source') return send(res, 200, await saveSource(body));
      if (p === '/api/analyse') { await startAnalysis(body.runId, body.testId); return send(res, 200, { started: true }); }
      if (p === '/api/analyse/cancel') { const cancel = analysing.get(String(body.runId) + ':' + String(body.testId)); cancel?.(); return send(res, 200, { cancelled: !!cancel }); }
      if (p === '/api/analyse/applied') {
        // Record that the suggested fix was applied, so the page can say so.
        const run = await loadRun(String(body.runId)), t = run?.tests[String(body.testId)];
        if (!t?.analysis) return send(res, 404, { error: 'No analysis for this test.' });
        t.analysis.appliedAt = Date.now();
        await saveRun(run);
        broadcast({ type: 'testChanged', runId: run.id, test: t, status: run.status });
        return send(res, 200, { ok: true });
      }
      if ((pm = p.match(/^\/api\/bugs\/(bug-\d+)\/link$/))) return send(res, 200, await addToBug(pm[1], body));
      if ((pm = p.match(/^\/api\/bugs\/(bug-\d+)\/status$/))) {
        const bug = await loadBug(pm[1]);
        if (!bug) return send(res, 404, { error: 'Bug report not found.' });
        if (!['open', 'closed'].includes(body.status)) return send(res, 400, { error: 'Status must be open or closed.' });
        bug.status = body.status; await saveBug(bug);
        return send(res, 200, bug);
      }
      if (p === '/api/tests/refresh') return send(res, 200, await listTests());
      if (p === '/api/open-in-browser') {
        // Open a dashboard page in the system browser (e.g. when VS Code's browser can't play WebM).
        // Only this dashboard's own URL is opened, with a validated hash route.
        const hash = String(body.hash || '');
        if (!/^[\w=.-]*$/.test(hash)) return send(res, 400, { error: 'Invalid page.' });
        const url = `http://${HOST}:${PORT}/#${hash}`;
        const [cmd, args] = process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]];
        spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
        return send(res, 200, { opened: true });
      }
      if (p === '/api/trace') {
        // Traces live with a run, or as a copy in a bug report.
        let file = null;
        if (body.bugId) { const bug = await loadBug(String(body.bugId)); file = bug && inside(path.join(bugsDir, bug.id), String(body.file)); }
        else { const run = await loadRun(String(body.runId)); file = run && inside(path.join(runsDir, run.id), String(body.file)); }
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
      return file ? serveFile(res, file, req) : send(res, 404, { error: 'Not found' });
    }
    if (p === '/api/bugs') return send(res, 200, await listBugs());
    if (p === '/api/source') return send(res, 200, await readSource(url.searchParams.get('path')));
    if (p.startsWith('/vendor/monaco/')) {
      const file = inside(monacoDir, p.slice('/vendor/monaco'.length));
      return file ? serveFile(res, file, req) : send(res, 404, { error: 'Not found' });
    }
    if ((m = p.match(/^\/api\/bugs\/(bug-\d+)$/))) {
      const bug = await loadBug(m[1]);
      return bug ? send(res, 200, bug) : send(res, 404, { error: 'Bug report not found.' });
    }
    if ((m = p.match(/^\/api\/bugs\/(bug-\d+)\/files\/(.+)$/))) {
      const file = inside(path.join(bugsDir, m[1]), m[2]);
      return file ? serveFile(res, file, req) : send(res, 404, { error: 'Not found' });
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
await pruneRuns();
convertExistingVideos();
await clearInterruptedAnalyses();
server.listen(PORT, HOST, () => console.log(`Test dashboard: http://${HOST}:${PORT}`));
const shutdown = () => { stopRun(); setTimeout(() => process.exit(0), 300); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
