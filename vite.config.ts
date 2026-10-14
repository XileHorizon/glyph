import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
// @ts-expect-error - a plain .mjs module shared with scripts/test-report.mjs, no types.
import { sourceHash } from './scripts/testReport/source.mjs';

const root = import.meta.dirname;
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };

/**
 * The version this build calls itself. Over the air it carries the release number this bundle is for its version:
 * 1.4.1-12 is the twelfth update published on 1.4.1 (scripts/deploy-ota.mjs sets GLYPH_RELEASE). Matt: "every ota
 * deploy should do a -version so like 1.4.3-12 for the 12th OTA on 1.4.3", so About says which update is running,
 * where every bundle between APKs used to read the same.
 */
const release = (process.env.GLYPH_RELEASE ?? '').trim();
const version = /^\d+$/.test(release) ? `${pkg.version}-${release}` : pkg.version;

/*
 * One build id per `vite build`, UTC to the second: `20260912221530`. It is how
 * an installed app tells a newer frontend from an older one, so it has to be
 * monotonic and it has to be the SAME value in the page (`__GLYPH_BUILD__`) and
 * in `ota.json`. Digits only, because the phone uses it as a directory name.
 */
const build = new Date().toISOString().replace(/\D/g, '').slice(0, 14);

/*
 * The native generation this page needs, read out of the Rust that defines it
 * so the two cannot drift. BUNDLE_REQUIRES, never NATIVE_GENERATION - see the
 * header of src-tauri/src/ota.rs for the AttackFM release that learned why.
 */
function bundleRequires(): number {
  const source = readFileSync(join(root, 'src-tauri/src/ota.rs'), 'utf8');
  const match = /pub const BUNDLE_REQUIRES: u32 = (\d+);/.exec(source);
  if (!match) throw new Error('src-tauri/src/ota.rs no longer declares BUNDLE_REQUIRES as a literal');
  return Number(match[1]);
}

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

/**
 * Writes `dist/ota.json`: what an installed Glyph needs to run this build as
 * an over-the-air update. The entry and stylesheets are read back out of the
 * built index.html rather than from Rollup's bundle object, because index.html
 * is what the website serves and what the APK embeds - if the two ever
 * disagreed, the HTML is the one that is right.
 */
function otaManifest(): Plugin {
  let outDir = 'dist';
  return {
    name: 'glyph-ota-manifest',
    apply: 'build',
    configResolved(config) {
      outDir = join(config.root, config.build.outDir);
    },
    closeBundle() {
      const html = readFileSync(join(outDir, 'index.html'), 'utf8');
      const entry = /<script type="module"[^>]*src="\.\/([^"]+)"/.exec(html)?.[1];
      const styles = [...html.matchAll(/<link rel="stylesheet"[^>]*href="\.\/([^"]+)"/g)].map((m) => m[1]);
      if (!entry) throw new Error('ota.json: the built index.html has no relative module entry');
      const files = [...walk(join(outDir, 'assets'))].sort().map((path) => {
        const bytes = readFileSync(path);
        return {
          path: relative(outDir, path).split(sep).join('/'),
          sha256: createHash('sha256').update(bytes).digest('hex'),
          bytes: bytes.length,
        };
      });
      const manifest = { schema: 1, build, version, native: bundleRequires(), entry, styles, files };
      writeFileSync(join(outDir, 'ota.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    },
  };
}

// A relative base so the built app works when Tauri serves it from a custom
// protocol rather than the server root - and, since OTA, so the same build runs
// from `ota.localhost` and from attack.fm/glyph/ unchanged. @glacier/react
// resolves from the vendored copy in node_modules (installed via the file:
// dependency).
/** The `--port` the dev server was started with (the phone's proxied page can't tell the socket its port). */
function portFromArgs(): number {
  const at = process.argv.indexOf('--port');
  return (at >= 0 && Number(process.argv[at + 1])) || Number(process.env.PORT) || 5250;
}

export default defineConfig({
  base: './',
  plugins: [react(), otaManifest()],
  define: {
    __GLYPH_BUILD__: JSON.stringify(build),
    __GLYPH_VERSION__: JSON.stringify(version),
    // The code this build is made from, for the test results page to check its report against.
    __GLYPH_SOURCE__: JSON.stringify(sourceHash(root)),
    // A staging build (GLYPH_STAGING=1, see gen/android/app/build.gradle.kts): its own app, no update checks.
    __GLYPH_STAGING__: JSON.stringify(Boolean(process.env.GLYPH_STAGING)),
  },
  server: {
    // 5250, not the 5240 the other Glacier apps use: two of them are often
    // running side by side, and Tauri wants a fixed port it can rely on.
    port: Number(process.env.PORT) || 5250,
    strictPort: true,
    // `tauri android dev` builds under src-tauri/ while this server runs; its output is not the page's.
    watch: { ignored: ['**/src-tauri/**', '**/server/**'] },
    // On a phone (`tauri android dev --host`), the page is proxied through tauri.localhost, so the
    // hot-reload socket must be told the Mac's real address; the CLI passes it as TAURI_DEV_HOST.
    ...(process.env.TAURI_DEV_HOST ? { host: '0.0.0.0', hmr: { host: process.env.TAURI_DEV_HOST, protocol: 'ws', port: portFromArgs() } } : {}),
  },
  // Two pages: the app, and the reader a shared note or book opens in (read.html, src/read, docs/SHARING.md).
  build: { rollupOptions: { input: { main: join(root, 'index.html'), read: join(root, 'read.html') } } },
  clearScreen: false,
});
