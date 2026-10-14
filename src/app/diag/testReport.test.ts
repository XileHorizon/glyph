import { describe, expect, it } from 'vitest';
import { buildMatch, byFile, matches, reportSummary, tally, verdict, type Suite, type TestReport } from './testReport.ts';

const suite = (over: Partial<Suite>): Suite => ({
  id: 'vitest',
  title: 'Page (Vitest)',
  runner: 'vitest',
  runnerVersion: 'vitest/5',
  command: 'npx vitest run',
  status: 'passed',
  reason: null,
  exitCode: 0,
  durationMs: 1000,
  counts: { total: 2, passed: 2, failed: 0, skipped: 0, todo: 0 },
  tests: [
    { file: 'src/a.test.ts', line: 3, name: 'reads a note', status: 'passed', ms: 2, failure: null },
    { file: 'src/b.test.ts', line: 9, name: 'writes a table', status: 'passed', ms: 1, failure: null },
  ],
  ...over,
});

export const sample = (over: Partial<TestReport> = {}): TestReport => ({
  schemaVersion: 1,
  generatedAt: '2026-09-14T10:00:00.000Z',
  version: '1.1.2',
  commit: 'abc1234',
  dirty: true,
  sourceHash: 'feedface',
  host: { os: 'darwin arm64', node: 'v24' },
  tools: { vitest: 'vitest/5', cargo: 'cargo 1.90' },
  ok: true,
  totals: { total: 2, passed: 2, failed: 0, skipped: 0, todo: 0, notRun: 0 },
  suites: [suite({})],
  ...over,
});

describe('reading the test report', () => {
  it('trusts the suites, not the report’s own word', () => {
    const failing = sample({ ok: true, suites: [suite({ status: 'failed', counts: { total: 2, passed: 1, failed: 1, skipped: 0, todo: 0 } })] });
    expect(verdict(failing)).toBe('failed');
    expect(tally(failing).failed).toBe(1);
    expect(verdict(sample({ suites: [suite({}), suite({ id: 'cargo:app', status: 'notRun', counts: { total: 0, passed: 0, failed: 0, skipped: 0, todo: 0 }, tests: [] })] }))).toBe('incomplete');
    expect(verdict(sample({ generatedAt: null, suites: [] }))).toBe('empty');
  });

  it('knows whether the report is for this build’s code', () => {
    expect(buildMatch(sample(), 'feedface')).toBe('same');
    expect(buildMatch(sample(), 'cafebabe')).toBe('different');
    expect(buildMatch(sample(), null)).toBe('unknown');
  });

  it('sums up for the Settings row', () => {
    expect(reportSummary(sample({ sourceHash: null }))).toBe('2 passed');
    expect(reportSummary(sample({ generatedAt: null, suites: [] }))).toBe('No report yet');
  });

  it('groups tests by file, failures first, and finds them by words', () => {
    const tests = [
      { file: 'src/a.test.ts', line: 1, name: 'fine', status: 'passed' as const, ms: 1, failure: null },
      { file: 'src/b.test.ts', line: 2, name: 'broken table', status: 'failed' as const, ms: 1, failure: 'boom' },
    ];
    expect(byFile(tests).map((g) => g.file)).toEqual(['src/b.test.ts', 'src/a.test.ts']);
    expect(matches(tests[1]!, 'table b.test')).toBe(true);
    expect(matches(tests[1]!, 'table missing')).toBe(false);
  });
});
