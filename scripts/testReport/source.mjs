import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * A fingerprint of the code the tests test: every file under src/, the Rust
 * crates' src/, and the scripts, in a stable order, except the report itself.
 * The report records it when the tests run, and the build (vite.config.ts)
 * stamps it into the page, so the test results page can say whether the build
 * in your hand is the code those results are for. Commits would do, but Glyph
 * ships far more often than it commits.
 */

export const REPORT_PATH = 'src/app/diag/testReport.generated.json';
const ROOTS = ['src', 'src-tauri/src', 'server/src', 'scripts'];
const SKIP = /(^|\/)(node_modules|target|dist|\.DS_Store)(\/|$)/;

function* walk(dir) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names.sort()) {
    const path = join(dir, name);
    if (SKIP.test(path)) continue;
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

export function sourceHash(root) {
  const hash = createHash('sha256');
  for (const base of ROOTS) {
    for (const path of walk(join(root, base))) {
      const rel = relative(root, path).split(sep).join('/');
      if (rel === REPORT_PATH) continue;
      hash.update(rel);
      hash.update('\0');
      hash.update(readFileSync(path));
      hash.update('\0');
    }
  }
  return hash.digest('hex').slice(0, 16);
}
