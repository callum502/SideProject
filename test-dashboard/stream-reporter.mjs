// Playwright reporter that streams run events to the dashboard server as JSON lines on stdout.
// Each event is one line prefixed with MARKER so it can be separated from other output.
import path from 'node:path';

const MARKER = '@@PWDASH@@';
const emit = (type, data = {}) => process.stdout.write(MARKER + JSON.stringify({ type, ...data }) + '\n');
const serializeError = e => e && ({ message: e.message, stack: e.stack, snippet: e.snippet, location: e.location, value: e.value });

// Typed values appear in action titles (Fill "..."), so hide the E2E password and generated test-account passwords.
const secrets = [process.env.E2E_PASSWORD].filter(s => s && s.length >= 4);
const mask = text => secrets.reduce((t, s) => t.split(s).join('••••••'), String(text)).replace(/pw-[0-9a-f]{8}-[0-9a-f-]{27}/gi, '••••••');

// Browser actions and assertions with their time in the video. Recording starts when the page is created,
// so times are measured from the "Create page" step. Each top-level test.step() is included as a section.
function actionTimeline(result) {
  const all = [];
  const walk = (steps, section) => { for (const s of steps) { all.push({ s, section }); walk(s.steps, s.category === 'test.step' && !s.parent ? s.title : section); } };
  walk(result.steps, null);
  const createPage = all.find(({ s }) => s.category === 'pw:api' && /^Create page/i.test(s.title));
  const start = (createPage?.s.startTime ?? result.startTime).getTime();
  const out = [];
  for (const { s, section } of all) {
    const inHook = (st => { while (st.parent) st = st.parent; return st.category === 'hook'; })(s);
    if (inHook) continue;
    const isAction = (s.category === 'pw:api' || s.category === 'expect') && !(s.parent && ['pw:api', 'expect'].includes(s.parent.category));
    const isStep = s.category === 'test.step' && !s.parent;
    if (!isAction && !isStep) continue;
    out.push({
      kind: isStep ? 'step' : s.category === 'expect' ? 'expect' : 'api', title: mask(s.title), section,
      t: Math.max(0, s.startTime.getTime() - start), duration: s.duration, failed: !!s.error,
      location: s.location ? { file: s.location.file, line: s.location.line, column: s.location.column } : null,
    });
  }
  return out.slice(0, 500);
}

// Time spent in page.pause(): inside the test body, or in the after-hooks (the "Retry headed" keep-open pause).
// The server takes the end pause off the test's time, and leaves the time blank if the body was paused.
function pauseTime(steps) {
  const total = { body: 0, end: 0 };
  const walk = (list, inHook) => {
    for (const s of list) {
      const hook = inHook || s.category === 'hook';
      // Closing the browser ends a pause without finishing its step (duration -1), so measure from its start.
      if (s.category === 'pw:api' && /^pause\b/i.test(s.title)) total[hook ? 'end' : 'body'] += s.duration >= 0 ? s.duration : Math.max(0, Date.now() - s.startTime.getTime());
      walk(s.steps, hook);
    }
  };
  walk(steps, false);
  return total;
}

export default class StreamReporter {
  onBegin(config, suite) {
    this.rootDir = config.rootDir;
    emit('begin', { workers: config.workers, tests: suite.allTests().map(t => this.info(t)) });
  }

  info(test) {
    return {
      id: test.id,
      title: test.title,
      titlePath: test.titlePath().slice(3),
      file: path.relative(this.rootDir, test.location.file).split(path.sep).join('/'),
      line: test.location.line,
    };
  }

  onTestBegin(test, result) {
    emit('testBegin', { id: test.id, retry: result.retry, workerIndex: result.workerIndex, startTime: result.startTime });
  }

  onStepBegin(test, result, step) {
    if (step.category === 'test.step' && !step.parent) emit('stepBegin', { id: test.id, title: step.title, location: step.location });
  }

  onStepEnd(test, result, step) {
    // Only top-level test.step() calls (e.g. Create / Edit / Delete) are reported.
    if (step.category !== 'test.step' || step.parent) return;
    emit('stepEnd', { id: test.id, title: step.title, duration: step.duration, error: serializeError(step.error), location: step.location, pausedMs: pauseTime(step.steps).body });
  }

  onStdOut(chunk, test) { emit('log', { stream: 'stdout', id: test?.id, text: chunk.toString() }); }
  onStdErr(chunk, test) { emit('log', { stream: 'stderr', id: test?.id, text: chunk.toString() }); }

  onTestEnd(test, result) {
    emit('testEnd', {
      actions: actionTimeline(result),
      pause: pauseTime(result.steps),
      id: test.id,
      status: result.status,
      expectedStatus: test.expectedStatus,
      outcome: test.outcome(),
      duration: result.duration,
      retry: result.retry,
      // Playwright runs another attempt after a failure while retries remain (test.retries is the configured count).
      willRetry: ['failed', 'timedOut'].includes(result.status) && result.status !== test.expectedStatus && result.retry < test.retries,
      errors: result.errors.map(serializeError),
      annotations: [...test.annotations, ...(result.annotations || [])],
      attachments: result.attachments.map(a => ({ name: a.name, contentType: a.contentType, path: a.path, body: a.body && a.body.length < 100_000 ? a.body.toString() : undefined })),
    });
  }

  onError(error) { emit('error', { error: serializeError(error) }); }

  onEnd(result) { emit('end', { status: result.status, duration: result.duration }); }

  printsToStdio() { return false; }
}
