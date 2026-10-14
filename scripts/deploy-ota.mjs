#!/usr/bin/env node
/**
 * Publishes Glyph to attack.fm/glyph: the web build, the over-the-air update
 * an installed Glyph picks up by itself, and (with --apk) the APK.
 *
 * WHAT GOES WHERE
 *
 *   /glyph/            the web build. Chrome on the phone opens it and it is the
 *                      whole editor, minus what needs a Rust core (no haptics,
 *                      notes in localStorage rather than SQLite).
 *   /glyph/ota.json    the manifest an installed Glyph checks (src-tauri/src/ota.rs),
 *                      whose version carries this release's number: 1.4.3-12 is the
 *                      twelfth update published on 1.4.3, counted from what is live.
 *   /glyph/ota.json.sig  and its Ed25519 signature (scripts/ota-sign.mjs).
 *                      It describes THIS web build: the app downloads the files
 *                      it lists from /glyph/assets/, verifies each SHA-256, and
 *                      runs them on its next load. The web build and the OTA
 *                      bundle are the same `dist/` - one build, one upload.
 *   /glyph/glyph.apk   the installable app, for first installs and for changes
 *   /glyph/apk.json    to the native layer. apk.json is what makes an installed
 *   /glyph/apk.json.sig  Glyph offer "Install" when this APK is newer than it.
 *   /glyph/glyph.dmg   the Mac app (with --desktop): universal, signed with the
 *   /glyph/desktop.json  Developer ID, not yet notarised. desktop.json says what
 *                      it is (version, size, SHA-256, the lowest macOS it runs on)
 *                      and is what install.html reads to offer it; it lands after
 *                      glyph.dmg, by rename, like the other manifests. Unsigned for
 *                      now, because no app reads it - sign it (a CONTEXT in
 *                      ota-sign.mjs) the day the Mac app offers its own updates.
 *   /glyph/changelog.json  every release published here, newest first: version, build,
 *                      when, the notes it carried, and the APK that went with it. Written
 *                      from the live one each deploy, and read by Settings' What's new.
 *   /glyph/install.html  a page to open on the phone: version, size, the link.
 *   /glyph/models/     the Whisper weights, ~250 MB, uploaded once from a
 *                      verified `models/` (scripts/fetch-model.mjs). Never
 *                      staged, never deleted, never backed up - see the filters.
 *
 * ORDER IS THE SAFETY. The manifests are written LAST, each by an atomic
 * rename, after every file they name is already in place. A phone that reads
 * ota.json mid-deploy therefore sees either the old manifest (whose files may
 * be gone - it fails verification and simply tries again later) or the new one
 * with all its files present. apk.json in particular must not land before
 * glyph.apk has, or a phone downloads the old APK against the new checksum.
 *
 * SIGNED, AND MOVABLE. Both manifests are signed with the key at
 * ~/.config/glyph/ota-signing-key.pem (or $GLYPH_OTA_KEY), and this refuses to
 * run without it or with a key the app does not trust. ota.json is stamped with
 * `sources` from src-tauri/ota-sources.txt and, if src-tauri/ota-services.json
 * exists, `services` - which is how installed apps are moved to a new domain
 * (README "Moving to another domain"). A web-only deploy leaves apk.json and
 * its signature as they are; the first deploy of a signing release must be --apk.
 *
 * BUILD ONCE. The Android build runs `beforeBuildCommand` (vite) again, which
 * stamps a new build id and so a new entry hash - the APK would then embed a
 * different frontend from the dist being published and verified. With --apk
 * the web build runs first and the Android build is told to skip it
 * (`--config` merge), so the APK embeds exactly the dist that goes out.
 *
 * Usage:
 *   node scripts/deploy-ota.mjs                  # web + OTA update, the quick loop
 *   node scripts/deploy-ota.mjs --apk            # also build and publish the APK
 *   node scripts/deploy-ota.mjs --desktop        # also build and publish the Mac app (on a Mac, with the Developer ID)
 *   node scripts/deploy-ota.mjs --mcp            # also build and publish Claude's MCP server, /glyph/mcp/glyph-mcp.mjs (docs/MCP.md)
 *   node scripts/deploy-ota.mjs --apk --same-version
 *   node scripts/deploy-ota.mjs --skip-tests     # ship without running the tests first (not recommended)
 *   node scripts/deploy-ota.mjs --apk --keep-connection && npm run deploy:server   # one login for both
 *                                                # republish an APK whose version is not newer
 *   node scripts/deploy-ota.mjs --public         # build without the formatting token (a public release)
 *   node scripts/deploy-ota.mjs --release 13     # number this release by hand, after a rollback put an older manifest back
 *   node scripts/deploy-ota.mjs --notes "Faster voice notes."
 *                                                # what changed: the text of the update alert people opt into
 *
 * Credentials come from .env: AFM_DEPLOY_HOST / AFM_DEPLOY_USER / AFM_DEPLOY_PASS,
 * the same box and account the other sites on attack.fm use. The password
 * reaches sshpass through the SSHPASS environment variable and never appears in
 * an argument list, where `ps` would show it.
 *
 * Note: the box runs fail2ban and it counts CONNECTIONS, not deploys. Running
 * this twice in quick succession, or back to back with another app's deploy,
 * is enough to get locked out for a few minutes - and it presents as a wrong
 * password rather than as a rate limit. Everything below is batched into as
 * few ssh sessions as possible.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONTEXT,
  KEY_PATH,
  SOURCES_FILE,
  TRUSTED_KEYS_FILE,
  loadPrivateKey,
  publicKeyBase64,
  readList,
  signBytes,
  verifyBytes,
} from './ota-sign.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(ROOT, 'dist');
const REMOTE = '/opt/attackfm-site/glyph';
const URL_ = 'https://attack.fm/glyph/';
const APK_DIR = join(ROOT, 'src-tauri/gen/android/app/build/outputs/apk');
// A RELEASE build: not debuggable, signed by the pinned key (build.gradle.kts).
// Debug APKs are for a phone on the desk (scripts/push-fold.mjs), never for the
// public link - a debuggable app lets anyone with adb copy its notes out.
const APK = join(APK_DIR, 'universal/release/app-universal-release.apk');
const APK_META = join(APK_DIR, 'universal/release/output-metadata.json');
const SIGNER_PIN = join(ROOT, 'src-tauri/apk-signer.sha256');
const BUILD_TOOLS = join(process.env.ANDROID_HOME ?? join(process.env.HOME, 'Library/Android/sdk'), 'build-tools/35.0.0');
// The Mac app: one universal build (Apple silicon and Intel in one file), so the download page needs no question.
const MAC_TARGET = 'universal-apple-darwin';
const MAC_BUNDLE = join(ROOT, 'src-tauri/target', MAC_TARGET, 'release/bundle');
/*
 * Who may sign it. The team is pinned the way the APK's signer is (apk-signer.sha256): an app signed by anyone else
 * is refused before it goes out, checked on the built file rather than trusted from the build. The identity is the
 * certificate's name in this Mac's keychain; $GLYPH_MAC_IDENTITY overrides it on another machine.
 */
const MAC_TEAM = 'F6ZAL7ANAD';
const MAC_IDENTITY = process.env.GLYPH_MAC_IDENTITY ?? `Developer ID Application: Matt Wisniewski (${MAC_TEAM})`;

const withApk = process.argv.includes('--apk');
const withDesktop = process.argv.includes('--desktop');
/** Claude's MCP server as one file (scripts/build-mcp.mjs), published at /glyph/mcp/glyph-mcp.mjs beside the app. */
const withMcp = process.argv.includes('--mcp');
const MCP_FILE = join(ROOT, 'mcp/dist/glyph-mcp.mjs');
const sameVersion = process.argv.includes('--same-version');
const isPublic = process.argv.includes('--public');
// Leave the connection open (it closes itself two minutes after its last use)
// so a server deploy straight after this one spends no second login.
const keepConnection = process.argv.includes('--keep-connection');
// Ship without running the tests first: only for a release that cannot wait. The
// Test results page in that build then says its report is from other code.
const skipTests = process.argv.includes('--skip-tests');
// The release number by hand, for the one case the live manifest cannot answer: after a rollback it is an older
// manifest, so the next release must go past the HIGHEST ever published, not past what is live.
const releaseFlag = process.argv.indexOf('--release');
const askedRelease = releaseFlag >= 0 ? Number(process.argv[releaseFlag + 1]) : null;
if (releaseFlag >= 0 && (!Number.isInteger(askedRelease) || askedRelease < 1)) fail('--release needs a whole number, the release this is on the current version.');
const notesFlag = process.argv.indexOf('--notes');
const notes = notesFlag >= 0 ? String(process.argv[notesFlag + 1] ?? '').trim() : '';
if (notesFlag >= 0 && (!notes || notes.startsWith('--'))) fail('--notes needs the text of what changed.');
if (notes.length > 2000) fail('--notes is limited to 2000 characters; the app refuses a longer manifest.');
const SERVICES_FILE = join(ROOT, 'src-tauri/ota-services.json');

const c = {
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};
const step = (s) => console.log(`\n\x1b[36m>\x1b[0m ${c.bold(s)}`);
const ok = (s) => console.log(`\x1b[32mok\x1b[0m ${s}`);
const fail = (message) => {
  console.error(`\x1b[31mx\x1b[0m ${message}`);
  process.exit(1);
};

function loadEnv() {
  const path = join(ROOT, '.env');
  if (!existsSync(path)) {
    fail(`No .env at ${path} (needs AFM_DEPLOY_HOST / AFM_DEPLOY_USER / AFM_DEPLOY_PASS).`);
  }
  const env = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match) env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
  for (const key of ['AFM_DEPLOY_HOST', 'AFM_DEPLOY_USER', 'AFM_DEPLOY_PASS']) {
    if (!env[key]) fail(`.env is missing ${key}.`);
  }
  return env;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) fail(`${command} failed (exit ${result.status ?? 'signal'}).`);
}

/*
 * ONE LOGIN PER DEPLOY. The box locks an account out after a handful of logins
 * in a short window, and the lockout answers "Permission denied" with the right
 * password - on 2026-09-12 a deploy authenticated its backup and its web upload
 * and was refused on the third login, the APK. So every ssh and rsync here
 * shares one multiplexed connection: the first authenticates (sshpass supplies
 * the password once), the rest ride its control socket with no login at all,
 * and the master closes itself a minute after the last use. ~/.ssh because a
 * control socket path must be short (%C is a hash) and private.
 */
const SSH_OPTS = [
  '-o', 'StrictHostKeyChecking=no',
  '-o', 'ControlMaster=auto',
  '-o', `ControlPath=${join(homedir(), '.ssh', 'glyph-deploy-%C')}`,
  '-o', 'ControlPersist=120',
  // A refused login costs one strike, not ssh's default three prompts' worth.
  '-o', 'NumberOfPasswordPrompts=1',
];

/*
 * The master is opened on its own, before anything else, with every stdio
 * ignored and `-fN` (authenticate, then background with no command). Letting
 * the first real command create it instead does not work here: that master
 * inherits the command's stdout pipe, spawnSync waits for the pipe to close,
 * the pipe closes only when the master exits - and the next command, finding
 * no master, logs in again.
 */
function openMaster(env) {
  // A master left open by a deploy a moment ago (deploy-server.mjs rides the
  // same socket) is a login already spent: use it.
  if (spawnSync('ssh', [...SSH_OPTS, '-O', 'check', `${env.AFM_DEPLOY_USER}@${env.AFM_DEPLOY_HOST}`], { stdio: 'ignore' }).status === 0) return;
  const result = spawnSync('sshpass', ['-e', 'ssh', ...SSH_OPTS, '-fN', `${env.AFM_DEPLOY_USER}@${env.AFM_DEPLOY_HOST}`], {
    stdio: 'ignore',
    env: { ...process.env, SSHPASS: env.AFM_DEPLOY_PASS },
  });
  if (result.status !== 0) {
    fail('Could not log in to the box. If the password is right, it is the lockout: wait ten minutes, and do not retry sooner.');
  }
}

function closeMaster(env) {
  spawnSync('ssh', [...SSH_OPTS, '-O', 'exit', `${env.AFM_DEPLOY_USER}@${env.AFM_DEPLOY_HOST}`], { stdio: 'ignore' });
}
const RSYNC_SSH = `ssh ${SSH_OPTS.map((o) => (o.includes(' ') ? `'${o}'` : o)).join(' ')}`;

function ssh(env, script, { capture = false } = {}) {
  const result = spawnSync(
    'sshpass',
    ['-e', 'ssh', ...SSH_OPTS, `${env.AFM_DEPLOY_USER}@${env.AFM_DEPLOY_HOST}`, script],
    {
      stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
      env: { ...process.env, SSHPASS: env.AFM_DEPLOY_PASS },
      encoding: 'utf8',
    },
  );
  if (result.status !== 0) fail('Remote command failed.');
  return capture ? String(result.stdout ?? '').trim() : '';
}

const curl = (args) => String(spawnSync('curl', args, { encoding: 'utf8' }).stdout ?? '').trim();

/** Dotted versions compared numerically. The app compares the same way (core/ota.ts). */
function isNewer(offered, installed) {
  const parse = (v) => String(v).split(/[.+-]/).slice(0, 3).map((p) => Number.parseInt(p, 10) || 0);
  const a = parse(offered);
  const b = parse(installed);
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

const env = loadEnv();
if (spawnSync('sshpass', ['-V'], { stdio: 'ignore' }).status !== 0) {
  fail('sshpass is not installed (brew install sshpass).');
}

// Before any build: a deploy that cannot sign is a deploy no installed app will take.
const signingKey = loadPrivateKey();
if (!signingKey) fail(`No OTA signing key at ${KEY_PATH}. Restore it from backup, or (first time only) run node scripts/ota-keygen.mjs.`);
const trustedKeys = readList(TRUSTED_KEYS_FILE);
if (!trustedKeys.includes(publicKeyBase64(signingKey))) {
  fail(`The signing key at ${KEY_PATH} is not in ${TRUSTED_KEYS_FILE}, so installed apps would reject everything this signs.`);
}
const sources = readList(SOURCES_FILE);
if (!sources.length || sources.some((u) => !/^https:\/\/\S+[^/]$/.test(u))) {
  fail(`${SOURCES_FILE} must list at least one https base URL, without a trailing slash.`);
}
const services = existsSync(SERVICES_FILE) ? JSON.parse(readFileSync(SERVICES_FILE, 'utf8')) : null;

// ---- tests ------------------------------------------------------------------

// Every suite runs before the build, and the report it writes is compiled into
// the page (Settings > Test results, Developer mode), stamped with the same
// source fingerprint the build is. A failing test, or a suite that did not
// run, stops the release here, before anything is built or signed.
if (!skipTests) {
  step('Running every test suite for the Test results page');
  const tested = spawnSync('node', [join(ROOT, 'scripts/test-report.mjs')], { cwd: ROOT, stdio: 'inherit' });
  if (tested.status !== 0) {
    fail('A test failed or a suite did not run (the lines above say which). Fix it and release again, or pass --skip-tests to ship anyway.');
  }
} else {
  console.log(c.dim('  --skip-tests: the Test results page in this build will say its report is from other code.'));
}

// ---- number this release -----------------------------------------------------

/*
 * Every bundle between two APKs used to call itself the same version, so About could not say which update was
 * running and a phone that had taken one looked like a phone that had not (Matt: "my phone is still on 1.4.1";
 * "every ota deploy should do a -version so like 1.4.3-12 for the 12th OTA on 1.4.3"). The count comes from what is
 * live, not from anything kept here: the next release is one past the live manifest's, and the first on a new
 * version is 1. The number is chosen BEFORE the build, because the version is compiled into the bundle. A manifest
 * that cannot be read stops the deploy rather than guessing, so no two releases can claim the same number; and after
 * a rollback, when an older manifest is live again, pass `--release <n>` past the highest ever published.
 */
const base = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
function nextRelease() {
  if (askedRelease !== null) return askedRelease;
  const answer = spawnSync('curl', ['-s', '-m', '20', '-w', '\n%{http_code}', `${URL_}ota.json`], { encoding: 'utf8' });
  const lines = String(answer.stdout ?? '').trim().split('\n');
  const code = lines.pop();
  if (answer.status !== 0 || !code) fail(`Could not reach ${URL_}ota.json to number this release. Try again, or pass --release <n>.`);
  // Nothing published there yet: this is the first.
  if (code === '404') return 1;
  if (code !== '200') fail(`${URL_}ota.json answered ${code}; this release cannot be numbered. Try again, or pass --release <n>.`);
  let version;
  try {
    version = String(JSON.parse(lines.join('\n')).version ?? '');
  } catch {
    fail(`${URL_}ota.json is not readable JSON; this release cannot be numbered. Try again, or pass --release <n>.`);
  }
  const [, of, n] = /^(\d+\.\d+\.\d+)(?:-(\d+))?$/.exec(version) ?? [];
  if (!of) fail(`The live manifest's version is ${JSON.stringify(version)}; this release cannot be numbered. Pass --release <n>.`);
  if (of !== base) return 1;
  return (Number(n) || 0) + 1;
}
const release = nextRelease();
ok(`release ${base}-${release}`);

// ---- build ------------------------------------------------------------------

step(`Building the web app${isPublic ? c.dim(' (public: no formatting token)') : ''}`);
// A real environment variable beats .env in Vite, so an empty one keeps the
// token out of a public build; annotate.ts then formats locally.
run('npm', ['run', 'build'], {
  cwd: ROOT,
  env: { ...process.env, GLYPH_RELEASE: String(release), ...(isPublic ? { VITE_GLYPH_API_TOKEN: '' } : {}) },
});

const html = readFileSync(join(DIST, 'index.html'), 'utf8');
// The hashed entry proves later that the box serves THIS build and not a
// cached older one. `base: './'` in vite.config.ts is what makes it relative,
// which is also what lets the app live in a subdirectory at all.
const built = /src="\.\/(assets\/index-[^"]+\.js)"/.exec(html)?.[1];
if (!built) fail("Built index.html has no relative hashed entry - is vite's base still './'?");
const manifest = JSON.parse(readFileSync(join(DIST, 'ota.json'), 'utf8'));
if (manifest.entry !== built) fail(`ota.json names ${manifest.entry} but index.html loads ${built}.`);
ok(`web build ${manifest.version} (${manifest.build}), ${manifest.files.length} files`);

let apkInfo = null;
if (withApk) {
  step('Building the APK');
  /*
   * The old APK is deleted first, every time. Gradle rewrites the file in place
   * and does not truncate it, so a build that comes out smaller than the last
   * one leaves the old bytes on the end: on 2026-09-12 a 43 MB APK was
   * published as a 78 MB file whose zip directory described 43 MB. It installs,
   * because the directory is intact - it is just a download 80% larger than it
   * needs to be, on a phone, over the air.
   */
  rmSync(APK_DIR, { recursive: true, force: true });
  // Through the npm script, not the Tauri CLI directly: the script is where
  // JAVA_HOME / ANDROID_HOME / NDK_HOME are set, and without JAVA_HOME the
  // build dies inside Gradle with a wall of Rust error wrappers whose only
  // useful line is "Unable to locate a Java Runtime". The empty
  // beforeBuildCommand is the build-once rule in the header.
  if (process.env.GLYPH_OTA_BASE) {
    fail('GLYPH_OTA_BASE is set: that is for test builds, and an APK built with it would never look at attack.fm.');
  }
  run('npm', ['run', 'android:build', '--', '--apk', '--target', 'aarch64', '--config', '{"build":{"beforeBuildCommand":""}}'], {
    cwd: ROOT,
  });
  if (!existsSync(APK)) {
    fail(`No signed release APK at ${APK}. Is ~/.config/glyph/android-signing.properties there? (An unsigned build is named *-unsigned.apk.)`);
  }

  // The two properties that decide whether this APK may go out, checked on the
  // file itself rather than trusted from the build config.
  const javaEnv = { ...process.env, JAVA_HOME: process.env.JAVA_HOME ?? '/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home' };
  const certs = spawnSync(join(BUILD_TOOLS, 'apksigner'), ['verify', '--print-certs', APK], { encoding: 'utf8', env: javaEnv });
  const signer = /certificate SHA-256 digest: ([0-9a-f]{64})/.exec(certs.stdout ?? '')?.[1];
  const pinned = readList(SIGNER_PIN)[0];
  if (certs.status !== 0 || !signer) fail(`apksigner could not verify ${APK}:\n${certs.stderr}`);
  if (signer !== pinned) {
    fail(`The APK is signed by ${signer}, not the pinned ${pinned}. No existing install could update to it. Was the keystore regenerated?`);
  }
  const badging = spawnSync(join(BUILD_TOOLS, 'aapt2'), ['dump', 'badging', APK], { encoding: 'utf8' });
  if (badging.status !== 0) fail(`aapt2 could not read ${APK}.`);
  if (/application-debuggable/.test(badging.stdout)) fail('The APK is debuggable. The public link must never serve one.');
  ok(`APK signed by the pinned key, not debuggable`);
  // The build-once rule, checked rather than trusted: had the Android build
  // re-run vite after all, dist/ is no longer what was verified above, and
  // nothing has been published yet.
  const after = JSON.parse(readFileSync(join(DIST, 'ota.json'), 'utf8'));
  if (after.build !== manifest.build) {
    fail(`The Android build rebuilt the web app (${manifest.build} -> ${after.build}); the APK and dist/ no longer match. Nothing was published.`);
  }

  const meta = JSON.parse(readFileSync(APK_META, 'utf8')).elements?.[0];
  const ota = readFileSync(join(ROOT, 'src-tauri/src/ota.rs'), 'utf8');
  const native = Number(/pub const NATIVE_GENERATION: u32 = (\d+);/.exec(ota)?.[1]);
  if (!meta?.versionName || !meta?.versionCode || !native) fail('Could not read the APK version or the native generation.');
  const bytes = readFileSync(APK);
  apkInfo = {
    version: meta.versionName,
    versionCode: meta.versionCode,
    native,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    url: 'glyph.apk',
    build: manifest.build,
  };

  // An APK that is not newer than the live one would never be offered to an
  // installed Glyph, and Android refuses a lower versionCode outright. Say so
  // before 40 MB goes up rather than after.
  const live = curl(['-s', '-m', '20', `${URL_}apk.json`]);
  try {
    const current = JSON.parse(live);
    if (!isNewer(apkInfo.version, current.version) && !sameVersion) {
      fail(`The live APK is ${current.version} and this one is ${apkInfo.version}. Bump the version in tauri.conf.json, or pass --same-version.`);
    }
  } catch {
    // No apk.json yet: the first OTA-capable release.
  }
  writeFileSync(join(DIST, 'apk.json'), `${JSON.stringify(apkInfo, null, 2)}\n`);
  ok(`APK ${apkInfo.version} (code ${apkInfo.versionCode}, native ${native}), ${(apkInfo.bytes / 1e6).toFixed(0)} MB`);
}

let desktopInfo = null;
let desktopDmg = null;
if (withDesktop) {
  step('Building the Mac app');
  if (process.platform !== 'darwin') fail('--desktop builds the Mac app, and that needs a Mac.');
  if (process.env.GLYPH_OTA_BASE) {
    fail('GLYPH_OTA_BASE is set: that is for test builds, and a Mac app built with it would never look at attack.fm.');
  }
  // The certificate is looked for before a twenty-minute build, not found missing at the end of one.
  const identities = String(spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' }).stdout ?? '');
  if (!identities.includes(`"${MAC_IDENTITY}"`)) {
    fail(`No signing identity "${MAC_IDENTITY}" in this Mac's keychain. Set GLYPH_MAC_IDENTITY to the Developer ID Application certificate's name.`);
  }
  // As with the APK, the old bundle goes first, so nothing a previous build left behind can be what is published.
  rmSync(MAC_BUNDLE, { recursive: true, force: true });
  // The empty beforeBuildCommand is the build-once rule in the header: the app embeds exactly the dist that goes out.
  run('npx', ['tauri', 'build', '--bundles', 'app,dmg', '--target', MAC_TARGET, '--config', '{"build":{"beforeBuildCommand":""}}'], {
    cwd: ROOT,
    env: { ...process.env, APPLE_SIGNING_IDENTITY: MAC_IDENTITY },
  });
  const app = join(MAC_BUNDLE, 'macos/Ghost.md.app');
  const dmgDir = join(MAC_BUNDLE, 'dmg');
  const dmgName = existsSync(dmgDir) ? readdirSync(dmgDir).find((name) => name.endsWith('.dmg')) : undefined;
  if (!existsSync(app) || !dmgName) fail(`The Mac build left no app or no DMG under ${MAC_BUNDLE}.`);
  desktopDmg = join(dmgDir, dmgName);

  /*
   * What decides whether it may go out, read off the built app rather than trusted from the config - each of these
   * has a way of failing without a word. A wrong team is an app nobody's existing install trusts. Without the hardened
   * runtime it can never be notarised. Without the audio-input entitlement the hardened runtime closes the microphone
   * and getUserMedia hands back silence, no prompt and no error; without NSMicrophoneUsageDescription macOS refuses
   * the microphone outright. And one architecture short is a download that will not open on half the Macs there are.
   */
  const verified = spawnSync('codesign', ['--verify', '--deep', '--strict', app], { encoding: 'utf8' });
  if (verified.status !== 0) fail(`codesign does not verify the built app:\n${verified.stderr}`);
  const signing = String(spawnSync('codesign', ['-dv', '--verbose=2', app], { encoding: 'utf8' }).stderr ?? '');
  const team = /TeamIdentifier=(\S+)/.exec(signing)?.[1];
  if (team !== MAC_TEAM) fail(`The app is signed by team ${team ?? 'none'}, not the pinned ${MAC_TEAM}.`);
  if (!/^Authority=Developer ID Application:/m.test(signing)) fail('The app is not signed with a Developer ID Application certificate.');
  if (!/flags=\S*\(.*runtime.*\)/.test(signing)) fail('The app is not built with the hardened runtime.');
  const entitlements = String(spawnSync('codesign', ['-d', '--entitlements', ':-', app], { encoding: 'utf8' }).stdout ?? '');
  if (!entitlements.includes('com.apple.security.device.audio-input')) {
    fail('The app has no microphone entitlement: under the hardened runtime recording would return silence (src-tauri/Entitlements.plist).');
  }
  const plist = JSON.parse(spawnSync('plutil', ['-convert', 'json', '-o', '-', join(app, 'Contents/Info.plist')], { encoding: 'utf8' }).stdout || '{}');
  if (!plist.NSMicrophoneUsageDescription) {
    fail('The app has no NSMicrophoneUsageDescription: macOS would refuse it the microphone (src-tauri/Info.macos.plist).');
  }
  /*
   * The lowest macOS it opens on, which the download page quotes. It is the floor of the system's own WebKit, which
   * draws the app: the styles use color-mix() (Safari 16.2) and oklch() and :has() (15.4), and 13.1 is the first macOS
   * whose built-in WebKit has all three. Below it the app would open and draw without its colours.
   */
  if (!plist.LSMinimumSystemVersion) fail('The app has no LSMinimumSystemVersion for the download page to quote (tauri.conf.json bundle.macOS).');
  const executable = join(app, 'Contents/MacOS', String(plist.CFBundleExecutable ?? ''));
  const archs = String(spawnSync('lipo', ['-archs', executable], { encoding: 'utf8' }).stdout ?? '').trim().split(/\s+/);
  if (!archs.includes('arm64') || !archs.includes('x86_64')) fail(`The app is built for ${archs.join(', ') || 'nothing'}, not both Apple silicon and Intel.`);
  ok(`Mac app signed by team ${MAC_TEAM} (Developer ID, hardened runtime), microphone allowed, ${archs.join(' + ')}, macOS ${plist.LSMinimumSystemVersion}+`);

  // The build-once rule, checked rather than trusted, as it is for the APK.
  const afterMac = JSON.parse(readFileSync(join(DIST, 'ota.json'), 'utf8'));
  if (afterMac.build !== manifest.build) {
    fail(`The Mac build rebuilt the web app (${manifest.build} -> ${afterMac.build}); the app and dist/ no longer match. Nothing was published.`);
  }

  const dmgBytes = readFileSync(desktopDmg);
  desktopInfo = {
    version: plist.CFBundleShortVersionString,
    build: manifest.build,
    sha256: createHash('sha256').update(dmgBytes).digest('hex'),
    bytes: dmgBytes.length,
    url: 'glyph.dmg',
    arch: archs,
    minimumSystemVersion: plist.LSMinimumSystemVersion,
    team: MAC_TEAM,
    // Signed but not notarised (Matt's choice for now): the first launch needs Open Anyway, which install.html explains.
    notarized: false,
  };
  writeFileSync(join(DIST, 'desktop.json'), `${JSON.stringify(desktopInfo, null, 2)}\n`);
  ok(`Mac app ${desktopInfo.version}, ${(desktopInfo.bytes / 1e6).toFixed(0)} MB`);
}

let mcpInfo = null;
if (withMcp) {
  step('Building the MCP server');
  run('node', [join(ROOT, 'scripts/build-mcp.mjs')]);
  if (!existsSync(MCP_FILE)) fail(`The MCP build left nothing at ${MCP_FILE}.`);
  const mcpBytes = readFileSync(MCP_FILE);
  mcpInfo = { bytes: mcpBytes.length, sha256: createHash('sha256').update(mcpBytes).digest('hex') };
  ok(`MCP server, ${(mcpInfo.bytes / 1e6).toFixed(1)} MB`);
}

// ---- the changelog ------------------------------------------------------------
/*
 * Every release, newest first, carried forward from the one that is live: the history belongs to the site, so a
 * deploy from another machine adds to the same list (Matt: "show a changelog with all updates including OTA"). Not
 * signed, because it is words for a person to read rather than anything the app runs; the bundles it describes are
 * signed and checked as ever.
 */
step('Writing the changelog');
const KEEP_RELEASES = 60;
const SEED = join(ROOT, 'scripts/changelog-seed.json');
/*
 * The live list AND the seed in the repository, merged by build: a rollback on the box puts an older changelog back,
 * and carrying only that one forward would quietly drop the releases in between. Whichever copy has an entry, it
 * stays; the newest wording of a build wins.
 */
const releaseList = (json, what) => {
  try {
    const list = JSON.parse(json);
    return Array.isArray(list) ? list.filter((entry) => entry && typeof entry === 'object' && entry.build) : [];
  } catch {
    if (what) console.log(c.dim(`  ${what} could not be read; carrying on without it.`));
    return [];
  }
};
const before = (() => {
  const live = releaseList(curl(['-s', '-m', '20', `${URL_}changelog.json`]));
  const seeded = existsSync(SEED) ? releaseList(readFileSync(SEED, 'utf8'), 'the changelog seed') : [];
  const byBuild = new Map();
  for (const entry of [...seeded, ...live]) byBuild.set(String(entry.build), entry);
  return [...byBuild.values()].sort((a, b) => String(b.build).localeCompare(String(a.build)));
})();
// Every release says something, so the page never shows a row with nothing on it.
const entry = {
  version: manifest.version,
  build: manifest.build,
  at: new Date().toISOString(),
  notes: notes || 'Fixes and polish.',
  ...(apkInfo ? { apk: apkInfo.version } : {}),
};
const history = [entry, ...before.filter((old) => old && old.build !== entry.build)].slice(0, KEEP_RELEASES);
writeFileSync(join(DIST, 'changelog.json'), `${JSON.stringify(history, null, 2)}\n`);
ok(`changelog: ${history.length} release${history.length === 1 ? '' : 's'}, newest ${entry.version}`);

// ---- sign ---------------------------------------------------------------------

step('Signing');
// sources and services go into the published ota.json only - after the APK
// build, so the APK embeds the build's own manifest, whose build id is all the
// app reads from it.
const published = { ...manifest, sources, ...(services ? { services } : {}), ...(notes ? { notes } : {}) };
const otaBytes = Buffer.from(`${JSON.stringify(published, null, 2)}\n`);
writeFileSync(join(DIST, 'ota.json'), otaBytes);
writeFileSync(join(DIST, 'ota.json.sig'), `${signBytes(signingKey, CONTEXT.manifest, otaBytes)}\n`);
if (withApk) {
  const apkBytes = readFileSync(join(DIST, 'apk.json'));
  writeFileSync(join(DIST, 'apk.json.sig'), `${signBytes(signingKey, CONTEXT.apk, apkBytes)}\n`);
}
ok(`signed ota.json${withApk ? ' and apk.json' : ''}; sources ${sources.join(', ')}`);

// ---- publish ----------------------------------------------------------------

step('Logging in to the box');
openMaster(env);

step('Backing up what is on the box');
// Backup and staging in one session, to spend as few connections as possible.
// The stamp comes off the REMOTE clock: this may run from another zone.
const STAGE = `/home/${env.AFM_DEPLOY_USER}/.glyph-stage`;
const stamp = ssh(
  env,
  `set -e
   stamp=$(date -u +%Y%m%d-%H%M%S)
   if [ -d ${REMOTE} ]; then
     # models/ stays out of the backup. This script never publishes it, so
     # there is no older copy to roll back to, and with three backups kept it
     # would be 750 MB of disk holding the same unchanged weights three times.
     sudo rsync -a --exclude '/models/' ${REMOTE}/ ${REMOTE}.bak-$stamp/
     # Keep the three most recent backups; older ones are noise on a small disk.
     ls -1dt ${REMOTE}.bak-* 2>/dev/null | tail -n +4 | xargs -r sudo rm -rf
   fi
   rm -rf ${STAGE}
   mkdir -p ${STAGE}
   echo $stamp`,
  { capture: true },
)
  .split('\n')
  .pop()
  .trim();

step('Uploading');
// rsync writes into a staging path the deploy user owns, then the move is done
// with sudo, because /opt is not writable by that account.
run(
  'sshpass',
  ['-e', 'rsync', '-az', '--delete', '-e', RSYNC_SSH, `${DIST}/`, `${env.AFM_DEPLOY_USER}@${env.AFM_DEPLOY_HOST}:${STAGE}/`],
  { env: { ...process.env, SSHPASS: env.AFM_DEPLOY_PASS } },
);

if (withApk) {
  step(`Uploading the APK ${c.dim(`(${(apkInfo.bytes / 1e6).toFixed(0)} MB, this is the slow part)`)}`);
  run(
    'sshpass',
    ['-e', 'rsync', '-z', '--progress', '-e', RSYNC_SSH, APK, `${env.AFM_DEPLOY_USER}@${env.AFM_DEPLOY_HOST}:${STAGE}/glyph.apk`],
    { env: { ...process.env, SSHPASS: env.AFM_DEPLOY_PASS } },
  );
}

if (withDesktop) {
  // Not compressed on the way: a DMG is already compressed, and -z would only spend time.
  step(`Uploading the Mac app ${c.dim(`(${(desktopInfo.bytes / 1e6).toFixed(0)} MB)`)}`);
  run(
    'sshpass',
    ['-e', 'rsync', '--progress', '-e', RSYNC_SSH, desktopDmg, `${env.AFM_DEPLOY_USER}@${env.AFM_DEPLOY_HOST}:${STAGE}/glyph.dmg`],
    { env: { ...process.env, SSHPASS: env.AFM_DEPLOY_PASS } },
  );
}

if (withMcp) {
  step('Uploading the MCP server');
  run(
    'sshpass',
    ['-e', 'rsync', '-z', '-e', RSYNC_SSH, MCP_FILE, `${env.AFM_DEPLOY_USER}@${env.AFM_DEPLOY_HOST}:${STAGE}/glyph-mcp.mjs`],
    { env: { ...process.env, SSHPASS: env.AFM_DEPLOY_PASS } },
  );
}

step('Publishing');
ssh(
  env,
  `set -e
   sudo mkdir -p ${REMOTE}
   # P protects from --delete. models/ is never staged, and glyph.apk is only
   # staged with --apk, so without these a web deploy would delete the Whisper
   # weights and the installer. Anchored, so they protect those paths and
   # nothing a build happens to name the same further down.
   #
   # The two manifests are EXCLUDED here - excluded files are also not deleted
   # on the receiver - and placed below, last, by rename. See ORDER IS THE
   # SAFETY in the header.
   # glyph.dmg and desktop.json the same way as the APK and its manifest: protected, so a deploy without --desktop
   # neither deletes the Mac download nor the page's note of it, and desktop.json placed last, after the DMG.
   # mcp/ (Claude's MCP server, docs/MCP.md) is protected the same way, and the staged file is excluded here and
   # placed into it below by rename, so it is never half-written where a person downloads it from.
   sudo rsync -a --delete \\
     --filter 'P /models/' --filter 'P /glyph.apk' --filter 'P /glyph.dmg' --filter 'P /mcp/' \\
     --exclude '/ota.json' --exclude '/ota.json.sig' --exclude '/apk.json' --exclude '/apk.json.sig' \\
     --exclude '/desktop.json' --exclude '/glyph-mcp.mjs' \\
     ${STAGE}/ ${REMOTE}/
   sudo chown -R root:root ${REMOTE}
   # Caddy runs as its own user and only needs to read.
   sudo find ${REMOTE} -type d -exec chmod 755 {} +
   sudo find ${REMOTE} -type f -exec chmod 644 {} +
   # Each manifest and its signature are staged side by side and renamed one
   # after the other, signature first. A phone reading in the instant between
   # sees a mismatch, rejects it, and simply checks again later.
   place() {
     sudo install -m 644 -o root -g root ${STAGE}/$1.sig ${REMOTE}/.$1.sig.new
     sudo install -m 644 -o root -g root ${STAGE}/$1 ${REMOTE}/.$1.new
     sudo mv -f ${REMOTE}/.$1.sig.new ${REMOTE}/$1.sig
     sudo mv -f ${REMOTE}/.$1.new ${REMOTE}/$1
   }
   ${withApk ? 'place apk.json' : '# no --apk: the published apk.json and its signature stay as they are'}
   # desktop.json has no signature yet (the header says why), so it is placed on its own by the same rename.
   ${withDesktop
     ? `sudo install -m 644 -o root -g root ${STAGE}/desktop.json ${REMOTE}/.desktop.json.new
   sudo mv -f ${REMOTE}/.desktop.json.new ${REMOTE}/desktop.json`
     : '# no --desktop: the published glyph.dmg and desktop.json stay as they are'}
   ${withMcp
     ? `sudo mkdir -p ${REMOTE}/mcp
   sudo install -m 644 -o root -g root ${STAGE}/glyph-mcp.mjs ${REMOTE}/mcp/.glyph-mcp.mjs.new
   sudo mv -f ${REMOTE}/mcp/.glyph-mcp.mjs.new ${REMOTE}/mcp/glyph-mcp.mjs`
     : '# no --mcp: the published mcp/ stays as it is'}
   place ota.json
   rm -rf ${STAGE}`,
);

if (!keepConnection) closeMaster(env);

// ---- prove it ---------------------------------------------------------------

step('Checking it came back');
const code = curl(['-s', '-o', '/dev/null', '-w', '%{http_code}', '-m', '25', URL_]);
if (code !== '200') fail(`${URL_} answered ${code}, expected 200.`);

// A 200 is not the same as working: the page names a hashed bundle, and a
// publish that drops it serves a blank screen with a perfectly good status code.
const body = curl(['-s', '-m', '25', URL_]);
if (!body.includes(built)) fail(`${URL_} serves a different bundle than was just built (expected ${built}).`);
const assetCode = curl(['-s', '-o', '/dev/null', '-w', '%{http_code}', '-m', '25', `${URL_}${built}`]);
if (assetCode !== '200') fail(`the bundle 404s at /glyph/${built} - the base path did not resolve.`);

// Verify exactly what a phone will: the served bytes against the served signature.
const fetchBytes = (url) => spawnSync('curl', ['-s', '-m', '60', url], { maxBuffer: 128 * 1024 * 1024 }).stdout;
const liveOta = fetchBytes(`${URL_}ota.json`);
if (!verifyBytes(trustedKeys, CONTEXT.manifest, liveOta, fetchBytes(`${URL_}ota.json.sig`).toString())) {
  fail(`${URL_}ota.json does not verify against its signature; installed apps will ignore it.`);
}
let liveManifest;
try {
  liveManifest = JSON.parse(liveOta.toString());
} catch {
  fail(`${URL_}ota.json is not JSON.`);
}
if (liveManifest.build !== manifest.build) fail(`ota.json is build ${liveManifest.build}, expected ${manifest.build}.`);
const entryFile = manifest.files.find((f) => f.path === manifest.entry);
const servedEntry = fetchBytes(`${URL_}${manifest.entry}`);
if (createHash('sha256').update(servedEntry).digest('hex') !== entryFile.sha256) {
  fail(`the served ${manifest.entry} does not match its checksum in ota.json; installed apps would refuse it.`);
}
ok(`OTA manifest live and verified: build ${manifest.build}`);

if (withApk) {
  const liveApkBytes = fetchBytes(`${URL_}apk.json`);
  if (!verifyBytes(trustedKeys, CONTEXT.apk, liveApkBytes, fetchBytes(`${URL_}apk.json.sig`).toString())) {
    fail(`${URL_}apk.json does not verify against its signature.`);
  }
  let liveApk;
  try {
    liveApk = JSON.parse(liveApkBytes.toString());
  } catch {
    fail(`${URL_}apk.json is not JSON.`);
  }
  if (liveApk.sha256 !== apkInfo.sha256) fail('apk.json on the box does not describe the APK just built.');
  const head = curl(['-sI', '-m', '60', `${URL_}glyph.apk`]);
  const served = Number(/content-length:\s*(\d+)/i.exec(head)?.[1]);
  if (served !== apkInfo.bytes) fail(`glyph.apk is served as ${served} bytes, expected ${apkInfo.bytes}.`);
  ok(`APK live: ${apkInfo.version}, ${apkInfo.bytes} bytes`);
}

if (withDesktop) {
  let liveDesktop;
  try {
    liveDesktop = JSON.parse(fetchBytes(`${URL_}desktop.json`).toString());
  } catch {
    fail(`${URL_}desktop.json is not JSON.`);
  }
  if (liveDesktop.sha256 !== desktopInfo.sha256) fail('desktop.json on the box does not describe the Mac app just built.');
  // The whole download, hashed, rather than its length: it is small enough, and it is the one file a person runs.
  const servedDmg = fetchBytes(`${URL_}${desktopInfo.url}`);
  const servedHash = createHash('sha256').update(servedDmg).digest('hex');
  if (servedHash !== desktopInfo.sha256) {
    fail(`${desktopInfo.url} is served as ${servedDmg.length} bytes hashing to ${servedHash}, not the DMG just built.`);
  }
  ok(`Mac app live: ${desktopInfo.version}, ${desktopInfo.bytes} bytes, SHA-256 matches`);
}

if (withMcp) {
  const servedMcp = fetchBytes(`${URL_}mcp/glyph-mcp.mjs`);
  const servedHash = createHash('sha256').update(servedMcp).digest('hex');
  if (servedHash !== mcpInfo.sha256) fail(`mcp/glyph-mcp.mjs is served as ${servedMcp.length} bytes hashing to ${servedHash}, not the file just built.`);
  ok(`MCP server live: ${mcpInfo.bytes} bytes, SHA-256 matches`);
}

ok(`Published to ${URL_} ${c.dim(`serving ${built}`)}`);
console.log('');
console.log(`  open on the phone   ${URL_}install.html`);
console.log(`  install the app     ${URL_}glyph.apk`);
if (withDesktop) console.log(`  the Mac app         ${URL_}glyph.dmg`);
if (withMcp) console.log(`  Claude's MCP server ${URL_}mcp/glyph-mcp.mjs`);
console.log(`  web version         ${URL_}`);
console.log(`  OTA manifest        ${URL_}ota.json`);
console.log('');
// The rollback needs the same filters, and needs them MORE: the backup has no
// models/ in it at all, so an unfiltered --delete restore would be the one
// command in this file guaranteed to remove them.
//
// It restores the website and the APK, but it does NOT take an installed app
// back: the restored ota.json names an OLDER build, and an app never installs
// an older build than it has. To undo a bad over-the-air release, publish a
// fixed one. (A release that cannot boot at all undoes itself - the app
// quarantines it and falls back; see src-tauri/src/ota.rs.)
console.log(c.dim(`  rollback: sudo rsync -a --delete --filter 'P /models/' ${REMOTE}.bak-${stamp}/ ${REMOTE}/`));
console.log(c.dim(`  after a rollback the live manifest is older, so number the next release by hand: --release ${release + 1} or higher`));
