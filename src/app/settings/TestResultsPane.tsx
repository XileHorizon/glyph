import { useMemo, useState } from 'react';
import { CircleAlert, CircleCheck, CircleX, MinusCircle } from '@glacier/icons';
import { Pill, SearchField, Switch } from '@glacier/react';
import { BUILD_SOURCE, buildMatch, byFile, matches, REPORT, tally, verdict, type Suite, type TestReport, type TestResult } from '../diag/testReport.ts';
import { PaneSection, SettingRow, SettingsCallout, SettingsEmpty, SettingsFootnote } from './kit/settingsKit.tsx';
import styles from './TestResultsPane.module.css';

/**
 * Settings > Test results (Developer mode): every test Glyph has, from the
 * last full run on the machine that built this app. The page AttackFM has.
 *
 * A verdict card first, red or green, from the suites themselves (not the
 * report's own word), with the four numbers that matter. Then whatever makes
 * the results less than they seem: code changed since they ran, a suite that
 * did not run. Then where they came from, a search with "only failures", and
 * one card per suite, its tests grouped by file with failures first and open,
 * each failure's output under it. Nothing here runs a test: that is
 * `node scripts/test-report.mjs`, which every over-the-air release runs first.
 */

function ago(iso: string, now = Date.now()): string {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function seconds(ms: number | null): string {
  if (ms === null) return '';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

const STATUS_TONE: Record<Suite['status'], 'success' | 'danger' | 'warning' | 'neutral'> = {
  passed: 'success',
  failed: 'danger',
  error: 'danger',
  notRun: 'warning',
};

const STATUS_WORD: Record<Suite['status'], string> = {
  passed: 'Passed',
  failed: 'Failed',
  error: 'Did not run',
  notRun: 'Not run',
};

function TestIcon({ status }: { status: TestResult['status'] }) {
  if (status === 'passed') return <CircleCheck size={14} className={styles.iconPassed} aria-label="Passed" />;
  if (status === 'failed') return <CircleX size={14} className={styles.iconFailed} aria-label="Failed" />;
  return <MinusCircle size={14} className={styles.iconSkipped} aria-label={status === 'todo' ? 'To do' : 'Skipped'} />;
}

function SuiteCard({ suite, query, onlyFailures }: { suite: Suite; query: string; onlyFailures: boolean }) {
  const [open, setOpen] = useState(suite.status !== 'passed');
  const visible = suite.tests.filter((t) => (!onlyFailures || t.status === 'failed') && (!query || matches(t, query)));
  const filtering = onlyFailures || Boolean(query);
  if (filtering && !visible.length && suite.status === 'passed') return null;
  const groups = byFile(visible);
  return (
    <PaneSection title={suite.title} footer={suite.command ? <code className={styles.command}>{suite.command}</code> : undefined}>
      <SettingRow
        label={`${suite.counts.passed}/${suite.counts.total} passed${suite.counts.skipped ? ` · ${suite.counts.skipped} skipped` : ''}`}
        hint={[seconds(suite.durationMs), suite.runnerVersion].filter(Boolean).join(' · ') || undefined}
        control={
          <Pill tone={STATUS_TONE[suite.status]} variant="soft" size="sm">
            {STATUS_WORD[suite.status]}
          </Pill>
        }
        onPress={() => setOpen((on) => !on)}
      />
      {suite.reason ? (
        <div className={styles.reason}>
          <pre className={styles.failure}>{suite.reason}</pre>
          {suite.exitCode !== null ? <span className={styles.meta}>exit code {suite.exitCode}</span> : null}
        </div>
      ) : null}
      {open || filtering
        ? groups.map((group) => (
            <details key={group.file} className={styles.file} open={group.failed > 0 || filtering}>
              <summary className={styles.fileHead} data-failed={group.failed ? '' : undefined}>
                <span className={styles.fileName}>{group.file}</span>
                <span className={styles.meta}>{group.failed ? `${group.failed} failed · ` : ''}{group.tests.length}</span>
              </summary>
              <ul className={styles.tests}>
                {group.tests.map((test, i) => (
                  <li key={`${test.name}-${i}`} className={styles.test} data-status={test.status}>
                    <TestIcon status={test.status} />
                    <span className={styles.testName}>{test.name}</span>
                    <span className={styles.meta}>{[test.line !== null ? `:${test.line}` : null, seconds(test.ms)].filter(Boolean).join(' ')}</span>
                    {test.failure ? <pre className={styles.failure}>{test.failure}</pre> : null}
                  </li>
                ))}
              </ul>
            </details>
          ))
        : null}
    </PaneSection>
  );
}

export function TestResultsPane({ report = REPORT, buildSource = BUILD_SOURCE }: { report?: TestReport; buildSource?: string | null }) {
  const [query, setQuery] = useState('');
  const [onlyFailures, setOnlyFailures] = useState(false);
  const kind = verdict(report);
  const totals = useMemo(() => tally(report), [report]);
  const match = buildMatch(report, buildSource);

  if (kind === 'empty') {
    return (
      <SettingsEmpty
        icon={<CircleAlert size={22} />}
        title="No test report in this build."
        body={
          <>
            Run <code>node scripts/test-report.mjs</code> before building. Every over-the-air release does it for you.
          </>
        }
      />
    );
  }

  const missing = report.suites.filter((s) => s.status === 'notRun' || s.status === 'error');
  return (
    <>
      <section className={styles.verdict} data-ok={kind === 'passed' ? '' : undefined} aria-label="Verdict">
        <p className={styles.verdictWord}>
          {kind === 'passed' ? <CircleCheck size={22} aria-hidden="true" /> : <CircleX size={22} aria-hidden="true" />}
          {kind === 'passed' ? 'Every test passed' : kind === 'failed' ? `${totals.failed} ${totals.failed === 1 ? 'test' : 'tests'} failed` : 'Some suites did not run'}
        </p>
        <dl className={styles.tallies}>
          <div>
            <dt>Passed</dt>
            <dd>{totals.passed}</dd>
          </div>
          <div data-alarm={totals.failed > 0 ? '' : undefined}>
            <dt>Failed</dt>
            <dd>{totals.failed}</dd>
          </div>
          <div>
            <dt>Skipped</dt>
            <dd>{totals.skipped + totals.todo}</dd>
          </div>
          <div data-alarm={totals.notRun > 0 ? '' : undefined}>
            <dt>Not run</dt>
            <dd>{totals.notRun}</dd>
          </div>
        </dl>
      </section>

      {match === 'different' ? (
        <SettingsCallout icon={<CircleAlert size={16} />}>The code changed after these tests ran. They are not this build’s results.</SettingsCallout>
      ) : null}
      {match === 'unknown' ? <SettingsCallout icon={<CircleAlert size={16} />}>This build has no source fingerprint to check the report against (a development build).</SettingsCallout> : null}
      {missing.length ? (
        <SettingsCallout icon={<CircleAlert size={16} />}>
          {missing.map((s) => s.title).join(', ')} {missing.length === 1 ? 'did' : 'did'} not run for this report.
        </SettingsCallout>
      ) : null}

      <PaneSection title="Where these come from">
        <SettingRow label="Version" value={report.version ?? '—'} />
        <SettingRow
          label="Code"
          hint={match === 'same' ? 'The same code this build was made from.' : match === 'different' ? 'Not the code this build was made from.' : undefined}
          control={
            <Pill tone={match === 'same' ? 'success' : match === 'different' ? 'danger' : 'warning'} variant="soft" size="sm">
              {report.sourceHash ?? 'unknown'}
            </Pill>
          }
        />
        <SettingRow label="Commit" value={`${report.commit ?? 'none'}${report.dirty ? ' + changes' : ''}`} />
        {report.generatedAt ? <SettingRow label="Ran" value={ago(report.generatedAt)} hint={new Date(report.generatedAt).toLocaleString()} /> : null}
        {report.host ? <SettingRow label="On" value={report.host.os} hint={`Node ${report.host.node}`} /> : null}
        <SettingRow label="Tools" layout="stacked" control={<span className={styles.tools}>{Object.values(report.tools).filter(Boolean).map((tool) => <Pill key={tool} variant="outline" size="sm">{tool}</Pill>)}</span>} />
      </PaneSection>

      <PaneSection title="Find">
        <SettingRow layout="stacked" label="Search tests" control={<SearchField value={query} onValueChange={setQuery} placeholder="Words in a test’s name or file" size="sm" />} />
        <SettingRow label="Only failures" control={<Switch aria-label="Only failures" checked={onlyFailures} onCheckedChange={setOnlyFailures} />} />
      </PaneSection>

      {report.suites.map((suite) => (
        <SuiteCard key={suite.id} suite={suite} query={query} onlyFailures={onlyFailures} />
      ))}

      <SettingsFootnote>
        From <code>node scripts/test-report.mjs</code> on the machine that built this app. Real-model tests are skipped unless run by hand.
      </SettingsFootnote>
    </>
  );
}
