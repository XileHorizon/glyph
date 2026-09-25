/**
 * The runners' output, as one report's suites. Pure, so the parsing is
 * tested (parse.test.mjs) without running a single suite.
 *
 * A suite that ran zero tests is an error, not a pass: a runner that could not
 * find its tests, or crashed before them, would otherwise show green.
 */

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g');
const CLAMP = 2000;

export function clean(text) {
  const plain = String(text ?? '').replace(ANSI, '').trim();
  return plain.length > CLAMP ? `${plain.slice(0, CLAMP)}\n…` : plain;
}

function counts(tests) {
  const tally = { total: tests.length, passed: 0, failed: 0, skipped: 0, todo: 0 };
  for (const test of tests) tally[test.status] += 1;
  return tally;
}

function suiteStatus(tests, exitCode) {
  if (!tests.length) return 'error';
  if (tests.some((t) => t.status === 'failed')) return 'failed';
  return exitCode === 0 || exitCode === null ? 'passed' : 'error';
}

/**
 * Vitest's JSON reporter (`--reporter=json --includeTaskLocation`): one entry
 * per file, each with assertion results. A file that failed to load has no
 * results and a message, and becomes a failed test named after the file.
 */
export function fromVitest(json, { root, command, exitCode, durationMs, version }) {
  const tests = [];
  for (const file of json?.testResults ?? []) {
    const path = String(file.name ?? '').replace(`${root}/`, '');
    const results = file.assertionResults ?? [];
    if (!results.length && file.message) {
      tests.push({ file: path, line: null, name: '(the file did not run)', status: 'failed', ms: null, failure: clean(file.message) });
      continue;
    }
    for (const result of results) {
      const status = result.status === 'passed' ? 'passed' : result.status === 'failed' ? 'failed' : result.status === 'todo' ? 'todo' : 'skipped';
      tests.push({
        file: path,
        line: result.location?.line ?? null,
        name: [...(result.ancestorTitles ?? []), result.title].filter(Boolean).join(' › '),
        status,
        ms: typeof result.duration === 'number' ? Math.round(result.duration) : null,
        failure: status === 'failed' ? clean((result.failureMessages ?? []).join('\n\n')) : null,
      });
    }
  }
  return {
    id: 'vitest',
    title: 'Page (Vitest)',
    runner: 'vitest',
    runnerVersion: version,
    command,
    status: suiteStatus(tests, exitCode),
    reason: tests.length ? null : 'Vitest ran no tests.',
    exitCode,
    durationMs,
    counts: counts(tests),
    tests,
  };
}

/**
 * `cargo test`'s plain output: `test path::to::name ... ok | FAILED | ignored`,
 * then a `---- name stdout ----` block for each failure. The test's module path
 * stands in for its file (`llm::tests::x` is filed under `llm::tests`).
 */
export function fromCargo(output, { id, title, command, exitCode, durationMs, version }) {
  const text = String(output ?? '').replace(ANSI, '');
  const failures = new Map();
  const blocks = text.split(/^---- (.+?) stdout ----$/m);
  for (let i = 1; i < blocks.length; i += 2) {
    const body = (blocks[i + 1] ?? '').split(/^(?:failures:|successes:)$/m)[0];
    failures.set(blocks[i].trim(), clean(body));
  }
  const tests = [];
  for (const match of text.matchAll(/^test (\S+) \.\.\. (ok|FAILED|ignored)(?:, .*)?$/gm)) {
    const name = match[1];
    const at = name.lastIndexOf('::');
    const status = match[2] === 'ok' ? 'passed' : match[2] === 'FAILED' ? 'failed' : 'skipped';
    tests.push({ file: at > 0 ? name.slice(0, at) : '(crate)', line: null, name: at > 0 ? name.slice(at + 2) : name, status, ms: null, failure: status === 'failed' ? (failures.get(name) ?? null) : null });
  }
  const compileError = !tests.length && /error(\[E\d+\])?:/.test(text) ? clean(text.split('\n').filter((l) => /error|-->/.test(l)).slice(0, 30).join('\n')) : null;
  return {
    id,
    title,
    runner: 'cargo',
    runnerVersion: version,
    command,
    status: suiteStatus(tests, exitCode),
    reason: tests.length ? null : (compileError ?? 'cargo ran no tests.'),
    exitCode,
    durationMs,
    counts: counts(tests),
    tests,
  };
}

/** The report's totals, from its suites: a suite that did not run counts once as not run. */
export function totalsOf(suites) {
  const totals = { total: 0, passed: 0, failed: 0, skipped: 0, todo: 0, notRun: 0 };
  for (const suite of suites) {
    if (suite.status === 'notRun' || suite.status === 'error') totals.notRun += 1;
    for (const key of ['total', 'passed', 'failed', 'skipped', 'todo']) totals[key] += suite.counts[key];
  }
  return totals;
}
