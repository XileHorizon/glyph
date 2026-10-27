import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * A fingerprint of the code the tests test: every file under src/, the Rust
 * crates' src/, the scripts, and the MCP server's own modules (mcp/, whose
 * tests run with the page's; not its bundle in mcp/dist), in a stable order,
 * except the report itself. The report records it when the tests run, and the
 * build (vite.config.ts) stamps it into the page, so the test results page can
 * say whether the build in your hand is the code those results are for.
 * Commits would do, but Glyph ships far more often than it commits.
 *
 * The Kotlin under src-tauri/gen/android is not here: the report runs no
 * Gradle suite, so its tests are not among these results to be told apart.
 */

export const REPORT_PATH = 'src/app/diag/testReport.generated.json';
// The service, the connector and their deploy scripts are at the repository's root, one above this app's (tauri/).
const ROOTS = ['src', 'src-tauri/src', '../server/src', 'scripts', '../scripts', '../mcp'];
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
    // Read with forward slashes: on Windows the path has backslashes, SKIP missed node_modules, and the walk stepped
    // into mcp/node_modules, a link Windows cannot follow, and failed the build.
    if (SKIP.test(path.split(sep).join('/'))) continue;
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
