import generated from './testReport.generated.json';

/**
 * The test report this build carries (scripts/test-report.mjs writes it; the
 * build compiles it in), and what the test results page needs from it.
 *
 * Nothing here runs a test. The report is a record of the last full run on the
 * machine that built the app, stamped with the fingerprint of the code it ran
 * against, and `buildMatch` compares that with the fingerprint this build was
 * made from, so a report from other code says so instead of passing for this
 * build's results.
 */

export type TestStatus = 'passed' | 'failed' | 'skipped' | 'todo';
export type SuiteStatus = 'passed' | 'failed' | 'error' | 'notRun';

export interface TestResult {
  file: string;
  line: number | null;
  name: string;
  status: TestStatus;
  ms: number | null;
  failure: string | null;
}

export interface Counts {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  todo: number;
}

export interface Suite {
  id: string;
  title: string;
  runner: string;
  runnerVersion: string | null;
  command: string | null;
  status: SuiteStatus;
  reason: string | null;
  exitCode: number | null;
  durationMs: number | null;
  counts: Counts;
  tests: TestResult[];
}

export interface TestReport {
  schemaVersion: number;
  generatedAt: string | null;
  version: string | null;
  commit: string | null;
  dirty: boolean;
  sourceHash: string | null;
  host: { os: string; node: string } | null;
  tools: Record<string, string | null>;
  ok: boolean;
  totals: Counts & { notRun: number };
  suites: Suite[];
}

export const REPORT = generated as unknown as TestReport;

/** The source fingerprint this build was made from (vite.config.ts), or null in development. */
export const BUILD_SOURCE: string | null = typeof __GLYPH_SOURCE__ === 'string' && __GLYPH_SOURCE__ ? __GLYPH_SOURCE__ : null;

export type Match = 'same' | 'different' | 'unknown';

/** Whether the report was made from the code this build was made from. */
export function buildMatch(report: TestReport, build: string | null = BUILD_SOURCE): Match {
  if (!report.sourceHash || !build) return 'unknown';
  return report.sourceHash === build ? 'same' : 'different';
}

/** The totals, recomputed from the suites rather than trusted from the report. */
export function tally(report: TestReport): Counts & { notRun: number } {
  const totals = { total: 0, passed: 0, failed: 0, skipped: 0, todo: 0, notRun: 0 };
  for (const suite of report.suites) {
    if (suite.status === 'notRun' || suite.status === 'error') totals.notRun += 1;
    totals.total += suite.counts.total;
    totals.passed += suite.counts.passed;
    totals.failed += suite.counts.failed;
    totals.skipped += suite.counts.skipped;
    totals.todo += suite.counts.todo;
  }
  return totals;
}

/** Green only when every suite ran and nothing failed. */
export function verdict(report: TestReport): 'passed' | 'failed' | 'incomplete' | 'empty' {
  if (!report.generatedAt || !report.suites.length) return 'empty';
  const totals = tally(report);
  if (totals.failed > 0) return 'failed';
  if (totals.notRun > 0) return 'incomplete';
  return 'passed';
}

/** The one-line reading for the row in Settings. */
export function reportSummary(report: TestReport = REPORT): string {
  const kind = verdict(report);
  if (kind === 'empty') return 'No report yet';
  const totals = tally(report);
  if (buildMatch(report) === 'different') return 'From other code';
  if (kind === 'failed') return `${totals.failed} failed`;
  if (kind === 'incomplete') return `${totals.notRun} ${totals.notRun === 1 ? 'suite' : 'suites'} missing`;
  return `${totals.passed} passed`;
}

/** Tests grouped by file, failures first, then by name order as run. */
export function byFile(tests: readonly TestResult[]): Array<{ file: string; tests: TestResult[]; failed: number }> {
  const groups = new Map<string, TestResult[]>();
  for (const test of tests) groups.set(test.file, [...(groups.get(test.file) ?? []), test]);
  return [...groups.entries()]
    .map(([file, list]) => ({ file, tests: [...list].sort((a, b) => Number(b.status === 'failed') - Number(a.status === 'failed')), failed: list.filter((t) => t.status === 'failed').length }))
    .sort((a, b) => b.failed - a.failed || a.file.localeCompare(b.file));
}

/** Whether a test matches a search: every word in its name or file. */
export function matches(test: TestResult, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = `${test.name} ${test.file}`.toLowerCase();
  return words.every((word) => hay.includes(word));
}
