// AI failure analysis for the dashboard, run through Claude Code in headless mode (`claude -p`), so it uses the
// signed-in Claude subscription rather than an API key. Claude gets the failure's evidence in the prompt and
// may only read files (Read, Grep, Glob) - it can't run commands or edit anything, and .env files are blocked.
// It returns a structured verdict; every fix or bug report it proposes is applied only after you approve it.
import { spawn, execFile } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const TIMEOUT_MS = 6 * 60 * 1000;

// Claude Code: CLAUDE_CODE_PATH, else `claude` on PATH, else the copy bundled with the VS Code extension.
export async function findClaude() {
  if (process.env.CLAUDE_CODE_PATH) return process.env.CLAUDE_CODE_PATH;
  const onPath = await new Promise(resolve => execFile(process.platform === 'win32' ? 'where' : 'which', ['claude'], (err, out) => resolve(err ? null : out.split(/\r?\n/)[0].trim() || null)));
  if (onPath) return onPath;
  const extDir = path.join(os.homedir(), '.vscode', 'extensions');
  const exts = (await readdir(extDir).catch(() => [])).filter(d => d.startsWith('anthropic.claude-code-')).sort().reverse();
  for (const ext of exts) {
    const bin = path.join(extDir, ext, 'resources', 'native-binary', process.platform === 'win32' ? 'claude.exe' : 'claude');
    if (await stat(bin).catch(() => null)) return bin;
  }
  return null;
}

export const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['category', 'confidence', 'summary', 'cause', 'evidence', 'fix_description', 'edits', 'bug_title', 'bug_description'],
  properties: {
    category: { type: 'string', enum: ['ui_change', 'timing', 'app_bug', 'unclear'] },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    summary: { type: 'string', description: 'One or two sentences: what went wrong.' },
    cause: { type: 'string', description: 'The likely cause, in a short paragraph.' },
    evidence: { type: 'array', items: { type: 'string' }, description: 'Specific observations that support the verdict.' },
    fix_description: { type: 'string', description: 'For ui_change or timing: what the proposed test change does. Empty otherwise.' },
    edits: {
      type: 'array',
      description: 'For ui_change or timing: exact find/replace edits to files under tests/. Empty for app_bug and unclear.',
      items: {
        type: 'object', additionalProperties: false, required: ['file', 'find', 'replace'],
        properties: {
          file: { type: 'string', description: 'Repo-relative path under tests/, e.g. tests/e2e/testHelpers.ts' },
          find: { type: 'string', description: 'Text copied exactly from the current file; must occur exactly once.' },
          replace: { type: 'string' },
        },
      },
    },
    bug_title: { type: 'string', description: 'For app_bug: a concise bug report title. Empty otherwise.' },
    bug_description: { type: 'string', description: 'For app_bug: what happened, what was expected, steps to reproduce and the evidence. Empty otherwise.' },
  },
};

const INSTRUCTIONS = `You are analysing a failed Playwright end-to-end test for SideProj, a climbing guide web app (React front end in src/, Node server in server.mjs, Supabase back end). Tests live in tests/e2e/; shared UI helpers are in tests/e2e/testHelpers.ts and API/DB helpers in tests/e2e/apiTestHelpers.ts.

Decide which one of these explains the failure:
- ui_change: the app's UI changed on purpose (different text, labels, roles, structure or flow) and the test still expects the old UI. The fix belongs in the test.
- timing: a race, slow load, animation or an assertion that runs before the page is ready. The fix belongs in the test's waiting.
- app_bug: the app misbehaves (wrong data, an error, a failed request, a broken feature). Don't change the test to hide it; draft a bug report instead.
- unclear: the evidence doesn't support a confident verdict. Say what you would need.

Use Read, Grep and Glob to look at the test, the helpers and the app source before deciding; compare what the test expects with what the app now renders. Base the verdict on specifics you can point to.

For ui_change or timing, propose the smallest change to files under tests/ as exact find/replace edits: copy "find" exactly from the current file (it must occur once) and keep the test's intent. Don't weaken or delete assertions just to make it pass, and prefer Playwright's auto-waiting assertions over fixed sleeps. For app_bug, leave edits empty and write the bug report: what happened, what was expected, steps to reproduce, and the evidence (error, step, failing request or status if seen). Fill fields that don't apply with an empty string or empty list.`;

const run = (cmd, args, cwd) => new Promise(resolve => execFile(cmd, args, { cwd, maxBuffer: 8 * 1024 * 1024 }, (err, out) => resolve(err ? '' : out)));
const clip = (text, max) => text.length > max ? text.slice(0, max) + `\n… (${text.length - max} more characters not shown)` : text;
const fmtMs = ms => ms == null ? '?' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
const rel = (root, file) => file ? path.relative(root, file).split(path.sep).join('/') : '';

// Everything the model should know about one failed attempt, as plain text.
export async function buildPrompt({ root, runsDir, run: testRun, test, attempt }) {
  const dir = path.join(runsDir, testRun.id);
  const attempts = [...(test.attempts?.length ? test.attempts : [test])].sort((a, b) => (a.retry ?? 0) - (b.retry ?? 0));
  const lines = [];
  lines.push(`# Failed test\n${test.titlePath.join(' › ')} (tests/e2e/${test.file}:${test.line})`);
  lines.push(`Run started ${new Date(testRun.startedAt).toISOString()}; analysing attempt ${(attempt.retry ?? 0) + 1} of ${attempts.length}.`);
  lines.push('\n## Attempts\n' + attempts.map(a => `- Attempt ${(a.retry ?? 0) + 1}: ${a.state}, ${fmtMs(a.duration)}${a.steps?.find(s => s.state === 'failed') ? `, failed in step "${a.steps.find(s => s.state === 'failed').title}"` : ''}`).join('\n'));

  lines.push('\n## Steps (analysed attempt)\n' + ((attempt.steps || []).map(s => `- ${s.title}: ${s.state}${s.duration != null ? `, ${fmtMs(s.duration)}` : ''}`).join('\n') || 'none recorded'));
  lines.push('\n## Errors (analysed attempt)\n' + ((attempt.errors || []).map(e => [
    e.location ? `At ${rel(root, e.location.file)}:${e.location.line}:${e.location.column}` : '',
    '```\n' + clip(String(e.message || e.value || ''), 6000) + '\n```',
    e.snippet ? 'Code:\n```\n' + clip(String(e.snippet), 3000) + '\n```' : '',
  ].filter(Boolean).join('\n')).join('\n\n') || 'none recorded'));

  const actions = attempt.actions || [];
  if (actions.length) {
    const shown = actions.length > 160 ? [...actions.slice(0, 40), null, ...actions.slice(-120)] : actions;
    lines.push('\n## Browser actions (time into the test, duration, code)\n' + shown.map(a => a === null ? '… (middle actions omitted)'
      : a.kind === 'step' ? `### step: ${a.title}` : `- [${fmtMs(a.t)}] ${a.title} (${fmtMs(a.duration)})${a.failed ? ' FAILED' : ''}${a.code ? ` — ${a.code}` : ''}${a.location ? ` @ ${a.location.file}:${a.location.line}` : ''}`).join('\n'));
  }

  // How long the same test and its steps took when they passed, to spot timing problems.
  const history = [];
  for (const id of (await readdir(runsDir).catch(() => [])).sort().reverse()) {
    const other = id === testRun.id ? testRun : JSON.parse(await readFile(path.join(runsDir, id, 'run.json'), 'utf8').catch(() => 'null'));
    const t = other?.tests?.[test.id];
    for (const a of (t?.attempts || []).filter(a => a.state === 'passed')) {
      history.push(`- ${new Date(other.startedAt).toISOString().slice(0, 16)}: passed in ${fmtMs(a.duration)} (${(a.steps || []).map(s => `${s.title} ${fmtMs(s.duration)}`).join(', ') || 'no steps'})`);
    }
  }
  lines.push('\n## Previous passes of this test (recent runs kept by the dashboard)\n' + (history.slice(0, 8).join('\n') || 'none kept'));

  // Playwright's text snapshot of the page at the failure, and the screenshot (readable with the Read tool).
  const context = (attempt.attachments || []).find(a => a.name === 'error-context' && a.file);
  if (context) {
    const text = await readFile(path.join(dir, context.file), 'utf8').catch(() => '');
    if (text) lines.push('\n## Page snapshot at the failure (accessibility tree)\n' + clip(text, 30000));
  }
  const shot = (attempt.attachments || []).find(a => a.file && a.contentType?.startsWith('image/'));
  if (shot) lines.push(`\n## Screenshot at the failure\nRead this image with the Read tool: ${rel(root, path.join(dir, shot.file))}`);

  // Recent app changes: the main clue for a UI change.
  const log = await run('git', ['log', '-8', '--date=short', '--format=%h %ad %s', '--', 'src', 'server.mjs'], root);
  const uncommitted = await run('git', ['diff', 'HEAD', '--', 'src', 'server.mjs'], root);
  lines.push('\n## Recent commits to the app (src/, server.mjs)\n' + (log.trim() || 'none'));
  lines.push('\n## Uncommitted app changes\n' + (uncommitted.trim() ? '```diff\n' + clip(uncommitted, 20000) + '\n```' : 'none'));

  lines.push(`\nRead tests/e2e/${test.file} and any helpers or app files you need, then return the verdict.`);
  return lines.join('\n');
}

// Run one analysis. Resolves with { result, model, durationMs } or rejects; returns a cancel function via onStart.
export function analyse({ claudePath, cwd, prompt, onStart }) {
  return new Promise((resolve, reject) => {
    const settings = JSON.stringify({ permissions: { deny: ['Read(./.env)', 'Read(./.env.*)', 'Read(./**/.env)', 'Read(./**/.env.*)'] } });
    const args = ['-p', '--output-format', 'json', '--json-schema', JSON.stringify(RESULT_SCHEMA),
      '--tools', 'Read,Grep,Glob', '--allowedTools', 'Read,Grep,Glob', '--settings', settings,
      '--append-system-prompt', INSTRUCTIONS, '--no-session-persistence', '--strict-mcp-config', '--disable-slash-commands'];
    const child = spawn(claudePath, args, { cwd, env: process.env, windowsHide: true });
    let out = '', err = '', done = false;
    const timer = setTimeout(() => { if (!done) { child.kill(); reject(new Error('The analysis took longer than 6 minutes and was stopped.')); } }, TIMEOUT_MS);
    onStart?.(() => { done = true; clearTimeout(timer); child.kill(); reject(new Error('Cancelled.')); });
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => err += d);
    child.on('error', e => { clearTimeout(timer); reject(new Error('Could not start Claude Code: ' + e.message)); });
    child.on('close', () => {
      clearTimeout(timer);
      if (done) return;
      done = true;
      let json;
      try { json = JSON.parse(out); } catch { return reject(new Error((err || out || 'Claude Code returned no result.').trim().slice(0, 600))); }
      if (json.is_error || !json.structured_output) return reject(new Error(String(json.result || json.subtype || 'The analysis failed.').slice(0, 600)));
      resolve({ result: json.structured_output, model: Object.keys(json.modelUsage || {}).find(m => /opus|sonnet|fable/.test(m)) || Object.keys(json.modelUsage || {})[0] || null, durationMs: json.duration_ms, turns: json.num_turns });
    });
    child.stdin.end(prompt);
  });
}
