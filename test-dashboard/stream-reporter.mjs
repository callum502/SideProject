// Playwright reporter that streams run events to the dashboard server as JSON lines on stdout.
// Each event is one line prefixed with MARKER so it can be separated from other output.
import path from 'node:path';

const MARKER = '@@PWDASH@@';
const emit = (type, data = {}) => process.stdout.write(MARKER + JSON.stringify({ type, ...data }) + '\n');
const serializeError = e => e && ({ message: e.message, stack: e.stack, snippet: e.snippet, location: e.location, value: e.value });

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
    emit('stepEnd', { id: test.id, title: step.title, duration: step.duration, error: serializeError(step.error), location: step.location });
  }

  onStdOut(chunk, test) { emit('log', { stream: 'stdout', id: test?.id, text: chunk.toString() }); }
  onStdErr(chunk, test) { emit('log', { stream: 'stderr', id: test?.id, text: chunk.toString() }); }

  onTestEnd(test, result) {
    emit('testEnd', {
      id: test.id,
      status: result.status,
      expectedStatus: test.expectedStatus,
      outcome: test.outcome(),
      duration: result.duration,
      retry: result.retry,
      errors: result.errors.map(serializeError),
      annotations: [...test.annotations, ...(result.annotations || [])],
      attachments: result.attachments.map(a => ({ name: a.name, contentType: a.contentType, path: a.path, body: a.body && a.body.length < 100_000 ? a.body.toString() : undefined })),
    });
  }

  onError(error) { emit('error', { error: serializeError(error) }); }

  onEnd(result) { emit('end', { status: result.status, duration: result.duration }); }

  printsToStdio() { return false; }
}
