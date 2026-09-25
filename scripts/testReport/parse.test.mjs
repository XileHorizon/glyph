import { describe, expect, it } from 'vitest';
import { clean, fromCargo, fromVitest, totalsOf } from './parse.mjs';

const meta = { root: '/repo', command: 'npx vitest run', exitCode: 1, durationMs: 1200, version: 'vitest/5.0.0' };

describe('reading Vitest’s JSON', () => {
  it('files each test with its ancestors, line, time and failure', () => {
    const suite = fromVitest(
      {
        testResults: [
          {
            name: '/repo/src/a.test.ts',
            assertionResults: [
              { ancestorTitles: ['group'], title: 'works', status: 'passed', duration: 3.4, location: { line: 5 } },
              { ancestorTitles: [], title: 'breaks', status: 'failed', duration: 1, failureMessages: ['[31mExpected 1[0m'] },
              { ancestorTitles: [], title: 'later', status: 'todo' },
            ],
          },
          { name: '/repo/src/b.test.ts', assertionResults: [], message: 'SyntaxError: nope' },
        ],
      },
      meta,
    );
    expect(suite.status).toBe('failed');
    expect(suite.counts).toEqual({ total: 4, passed: 1, failed: 2, skipped: 0, todo: 1 });
    expect(suite.tests[0]).toEqual({ file: 'src/a.test.ts', line: 5, name: 'group › works', status: 'passed', ms: 3, failure: null });
    expect(suite.tests[1].failure).toBe('Expected 1');
    expect(suite.tests[3]).toMatchObject({ file: 'src/b.test.ts', name: '(the file did not run)', status: 'failed' });
  });

  it('calls a run with no tests an error, not a pass', () => {
    expect(fromVitest({ testResults: [] }, { ...meta, exitCode: 0 })).toMatchObject({ status: 'error', reason: 'Vitest ran no tests.' });
    expect(fromVitest(null, meta).status).toBe('error');
  });
});

describe('reading cargo test’s output', () => {
  const output = [
    'running 3 tests',
    'test llm::tests::loads ... ok',
    'test llm::tests::prints_a_review ... ignored, needs a model',
    'test ota::tests::verifies ... FAILED',
    '',
    'failures:',
    '',
    '---- ota::tests::verifies stdout ----',
    "thread 'ota::tests::verifies' panicked at src/ota.rs:10:5:",
    'assertion failed',
    '',
    'failures:',
    '    ota::tests::verifies',
    '',
    'test result: FAILED. 1 passed; 1 failed; 1 ignored',
  ].join('\n');

  it('files tests by module, with the failure’s own output', () => {
    const suite = fromCargo(output, { id: 'cargo:app', title: 'App', command: 'cargo test', exitCode: 101, durationMs: 9, version: 'cargo 1.9' });
    expect(suite.counts).toEqual({ total: 3, passed: 1, failed: 1, skipped: 1, todo: 0 });
    expect(suite.tests.map((t) => [t.file, t.name, t.status])).toEqual([
      ['llm::tests', 'loads', 'passed'],
      ['llm::tests', 'prints_a_review', 'skipped'],
      ['ota::tests', 'verifies', 'failed'],
    ]);
    expect(suite.tests[2].failure).toContain('assertion failed');
    expect(suite.status).toBe('failed');
  });

  it('keeps the compiler’s errors when nothing ran', () => {
    const suite = fromCargo('error[E0425]: cannot find value `x`\n  --> src/lib.rs:3:5', { id: 'cargo:app', title: 'App', command: 'cargo test', exitCode: 101, durationMs: 1, version: null });
    expect(suite.status).toBe('error');
    expect(suite.reason).toContain('cannot find value');
  });
});

describe('the totals', () => {
  it('adds the suites and counts the ones that did not run', () => {
    const passed = { status: 'passed', counts: { total: 2, passed: 2, failed: 0, skipped: 0, todo: 0 } };
    const missing = { status: 'notRun', counts: { total: 0, passed: 0, failed: 0, skipped: 0, todo: 0 } };
    expect(totalsOf([passed, missing])).toEqual({ total: 2, passed: 2, failed: 0, skipped: 0, todo: 0, notRun: 1 });
    expect(clean('x'.repeat(2100)).endsWith('…')).toBe(true);
  });
});
