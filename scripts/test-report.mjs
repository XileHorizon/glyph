#!/usr/bin/env node
/**
 * Runs every test suite Glyph has and writes what happened to
 * src/app/diag/testReport.generated.json, which the app compiles in and shows
 * in Settings > Test results (Developer mode). The same page AttackFM has.
 *
 * Suites: the page's Vitest tests, the app's Rust (`cargo test --lib` in
 * src-tauri, which skips the real-model tests unless asked), and glyph-api's
 * Rust. Each runs to the end even when another fails, so the page shows all of
 * it. The report also records the source fingerprint (testReport/source.mjs),
 * the version, the commit, the machine and the tools.
 *
 * deploy-ota.mjs runs this before it builds, so a shipped page always carries
 * the results for its own code, and refuses to ship failures.
 *
 * Usage:
 *   node scripts/test-report.mjs                 # everything
 *   node scripts/test-report.mjs --only=vitest   # one suite; the others keep their last results, marked not run
 *   node scripts/test-report.mjs --skip=cargo    # every suite whose id starts with "cargo"
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { arch, platform, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromCargo, fromVitest, totalsOf } from './testReport/parse.mjs';
import { REPORT_PATH, sourceHash } from './testReport/source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, REPORT_PATH);
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]?.split(',') ?? null;
const only = arg('only');
const skip = arg('skip') ?? [];
const wanted = (id) => (!only || only.some((o) => id.startsWith(o))) && !skip.some((s) => id.startsWith(s));

const run = (command, args, options = {}) => {
  const started = Date.now();
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...options });
  return { ...result, durationMs: Date.now() - started, output: `${result.stdout ?? ''}\n${result.stderr ?? ''}` };
};
const firstLine = (command, args, cwd = ROOT) => (spawnSync(command, args, { cwd, encoding: 'utf8' }).stdout ?? '').split('\n')[0].trim() || null;

const say = (text) => process.stdout.write(`\x1b[36m>\x1b[0m ${text}\n`);

function vitestSuite() {
  const dir = mkdtempSync(join(tmpdir(), 'glyph-vitest-'));
  const json = join(dir, 'report.json');
  const args = ['vitest', 'run', '--reporter=default', '--reporter=json', `--outputFile.json=${json}`, '--includeTaskLocation'];
  say('Page tests (Vitest)');
  const result = run('npx', args, { stdio: ['ignore', 'inherit', 'inherit'] });
  const parsed = existsSync(json) ? JSON.parse(readFileSync(json, 'utf8')) : null;
  rmSync(dir, { recursive: true, force: true });
  return fromVitest(parsed, { root: ROOT, command: `npx ${args.slice(0, 2).join(' ')}`, exitCode: result.status, durationMs: result.durationMs, version: firstLine('npx', ['vitest', '--version']) });
}

function cargoSuite(id, title, manifest, extra) {
  const args = ['test', '--manifest-path', manifest, ...extra, '--', '--test-threads=1'];
  say(title);
  const result = run('cargo', args);
  process.stdout.write(result.output.split('\n').filter((l) => /^test result|FAILED|panicked|^error/.test(l)).join('\n') + '\n');
  return fromCargo(result.output, { id, title, command: `cargo ${args.join(' ')}`, exitCode: result.status, durationMs: result.durationMs, version: firstLine('cargo', ['--version']) });
}

const SUITES = [
  { id: 'vitest', run: vitestSuite },
  { id: 'cargo:app', run: () => cargoSuite('cargo:app', 'App (Rust)', 'src-tauri/Cargo.toml', ['--lib']) },
  { id: 'cargo:server', run: () => cargoSuite('cargo:server', 'glyph-api (Rust)', 'server/Cargo.toml', []) },
];

const previous = (() => {
  try {
    return JSON.parse(readFileSync(OUT, 'utf8'));
  } catch {
    return null;
  }
})();

const suites = SUITES.map((suite) => {
  if (wanted(suite.id)) return suite.run();
  const last = previous?.suites?.find((s) => s.id === suite.id);
  // Not asked for this time: what it did last is kept, but marked as not run for this report.
  return last ? { ...last, status: 'notRun', reason: 'Not run for this report (left out with --only or --skip). Its last results are shown.' } : { id: suite.id, title: suite.id, runner: suite.id.split(':')[0], runnerVersion: null, command: null, status: 'notRun', reason: 'Never run.', exitCode: null, durationMs: null, counts: { total: 0, passed: 0, failed: 0, skipped: 0, todo: 0 }, tests: [] };
});

const git = (args) => (spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' }).stdout ?? '').trim();
const totals = totalsOf(suites);
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  version: JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version,
  commit: git(['rev-parse', '--short', 'HEAD']) || null,
  dirty: git(['status', '--porcelain', '--', '.', `:(exclude)${REPORT_PATH}`]).length > 0,
  sourceHash: sourceHash(ROOT),
  host: { os: `${platform()} ${arch()}`, node: process.version },
  tools: { vitest: suites.find((s) => s.id === 'vitest')?.runnerVersion ?? null, cargo: firstLine('cargo', ['--version']), rustc: firstLine('rustc', ['--version']) },
  ok: suites.every((s) => s.status === 'passed'),
  totals,
  suites,
};

writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
const summary = `${totals.passed} passed, ${totals.failed} failed, ${totals.skipped} skipped${totals.notRun ? `, ${totals.notRun} suite${totals.notRun === 1 ? '' : 's'} not run` : ''}`;
process.stdout.write(`${report.ok ? '\x1b[32mok\x1b[0m' : '\x1b[31mx\x1b[0m'} ${summary} -> ${REPORT_PATH}\n`);
process.exit(report.ok ? 0 : 1);
