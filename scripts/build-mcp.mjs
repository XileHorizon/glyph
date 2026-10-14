import { build } from 'esbuild';
import { chmodSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The MCP server as one file (docs/MCP.md): mcp/main.ts and everything it reaches - the app's own crypto and
 * list-placing rules under src/, and the MCP SDK - bundled for Node, so a person needs Node and this file and
 * nothing else. Written to mcp/dist/glyph-mcp.mjs; `deploy-ota.mjs --mcp` publishes it beside the app.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(ROOT, 'mcp/dist'), { recursive: true });

/** One file from one entry. `require` is defined for the CommonJS packages inside (express, the SDK's handlers). */
async function bundle(entry, name, target) {
  const out = join(ROOT, 'mcp/dist', name);
  await build({
    entryPoints: [join(ROOT, 'mcp', entry)],
    outfile: out,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target,
    banner: { js: "#!/usr/bin/env node\nimport { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
    // The sign-in page's typeface rides inside the hosted bundle as a data URL (mcp/hosted.ts).
    loader: { '.woff2': 'dataurl' },
    legalComments: 'none',
    logLevel: 'warning',
  });
  chmodSync(out, 0o755);
  console.log(`ok mcp/dist/${name} (${Math.round(statSync(out).size / 1024)} KB)`);
}

// The local server, run by a person's own Node; and the hosted one, run by the box's Node 18 (docs/MCP.md).
await bundle('main.ts', 'glyph-mcp.mjs', 'node20');
await bundle('hosted-main.ts', 'glyph-mcp-hosted.mjs', 'node18');
