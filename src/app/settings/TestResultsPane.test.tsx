import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// The Glacier kit reads matchMedia as it loads; jsdom has none.
vi.hoisted(() => {
  window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
});
import { TestResultsPane } from './TestResultsPane.tsx';
import { sample } from '../diag/testReport.test.ts';

describe('the test results page', () => {
  it('shows the verdict, the numbers, and that the code matches', () => {
    render(<TestResultsPane report={sample()} buildSource="feedface" />);
    expect(screen.getByText('Every test passed')).toBeTruthy();
    expect(screen.getByText('The same code this build was made from.')).toBeTruthy();
    expect(screen.getByText('Page (Vitest)')).toBeTruthy();
  });

  it('warns when the report is for other code, and says what failed', () => {
    const failing = sample({
      suites: [
        {
          ...sample().suites[0]!,
          status: 'failed',
          counts: { total: 2, passed: 1, failed: 1, skipped: 0, todo: 0 },
          tests: [{ file: 'src/b.test.ts', line: 9, name: 'writes a table', status: 'failed', ms: 1, failure: 'Expected a table' }],
        },
      ],
    });
    render(<TestResultsPane report={failing} buildSource="cafebabe" />);
    expect(screen.getByText('1 test failed')).toBeTruthy();
    expect(screen.getByText(/The code changed after these tests ran/)).toBeTruthy();
    expect(screen.getByText('Expected a table')).toBeTruthy();
  });

  it('says how to make a report when the build has none', () => {
    render(<TestResultsPane report={sample({ generatedAt: null, suites: [] })} buildSource={null} />);
    expect(screen.getByText('No test report in this build.')).toBeTruthy();
  });
});
