#!/usr/bin/env node
/**
 * Ships glyph-api, the server half of voice-note formatting, to attack.fm.
 *
 * The phone transcribes and formats on its own; this service is the optional
 * second pass, where a model on the box points at the title, the dates, the
 * action items and the lists in a transcript (see server/src/main.rs). It is a
 * Rust binary cross-compiled here with cargo-zigbuild, because the box has no
 * cargo - the same recipe PrettyCardboard's redeploy uses - and it runs as
 * `glyph-api.service` on 127.0.0.1:8796 behind Caddy's `/glyph/api/*` route.
 *
 * What a run does, and every step is safe to repeat:
 *
 *   test      `cargo test` on this Mac. A deploy of code whose verbatim filter
 *             is broken is a deploy that lets a model rewrite Matt's notes.
 *   build     cargo zigbuild for x86_64 Linux, glibc pinned to 2.35 (the box
 *             has 2.39; the pin is for the next box, not this one).
 *   ship      the binary, the unit, an install script and the token, in one
 *             ssh session (see `ship` for why one, and how the token travels).
 *   install   the `glyph` system user if missing, the token file, a backup of
 *             the running binary, the new binary, the unit; then restarts
 *             glyph-api and NOTHING ELSE. If it does not answer its health
 *             check on loopback, the backup goes straight back in.
 *   verify    through the public URL, from here: health answers, the model
 *             is reachable, and a request without the token is refused.
 *
 * THE TOKEN. `VITE_GLYPH_API_TOKEN` in .env is the single source: Vite bakes
 * it into the app at build time, and this script writes the same value to
 * /opt/glyph-api/glyph-api.env on the box (root-owned, 0600) on every run, so
 * rotating it is "change .env, run this, rebuild the app". It ships inside the
 * public APK, which makes it a speed bump rather than a secret - the rate
 * limit and the single model slot in the server are the real protection.
 *
 * It still stays out of every argument list and every file on this Mac: it
 * travels on ssh's STDIN, because an argument is visible to `ps` for as long
 * as ssh runs. The password reaches sshpass through SSHPASS, as in
 * deploy-ota.mjs.
 *
 * NOT done here, deliberately: the Caddy route. It was added once, by hand,
 * with a backup, a `caddy validate` and before/after checks of every site on
 * that Caddyfile - attack.fm, the registry and prettycardboard.com included.
 * A deploy script that edits a shared Caddyfile on every run is a deploy
 * script that eventually takes down four sites to ship one endpoint.
 *
 * Usage:
 *   node scripts/deploy-server.mjs      (or: npm run deploy:server)
 *
 * The box runs fail2ban and it counts CONNECTIONS, not deploys (see
 * deploy-ota.mjs). This spends ONE.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SERVER = join(ROOT, 'server');
const TARGET = 'x86_64-unknown-linux-gnu.2.35';
const BIN = join(SERVER, 'target/x86_64-unknown-linux-gnu/release/glyph-api');
const UNIT = join(SERVER, 'glyph-api.service');
/** Claude's hosted MCP server (docs/MCP.md): one file, run by the box's Node as glyph-mcp.service, reached through glyph-api. */
const MCP_BUNDLE = join(ROOT, 'mcp/dist/glyph-mcp-hosted.mjs');
const MCP_UNIT = join(SERVER, 'glyph-mcp.service');
const MCP_SERVICE = 'glyph-mcp';
/** Must match GLYPH_MCP_BIND in server/glyph-mcp.service. */
const MCP_PORT = 18820;

const REMOTE = '/opt/glyph-api';
const SERVICE = 'glyph-api';
/** Must match GLYPH_API_BIND in server/glyph-api.service. */
const PORT = 8796;
const STAGE = '.glyph-api-stage';
const API = 'https://attack.fm/glyph/api';

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
    fail(`No .env at ${path} (needs AFM_DEPLOY_HOST / AFM_DEPLOY_USER / AFM_DEPLOY_PASS / VITE_GLYPH_API_TOKEN).`);
  }
  const env = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match) env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
  for (const key of ['AFM_DEPLOY_HOST', 'AFM_DEPLOY_USER', 'AFM_DEPLOY_PASS', 'VITE_GLYPH_API_TOKEN']) {
    if (!env[key]) fail(`.env is missing ${key}.`);
  }
  // The shape is checked because the value is interpolated into a heredoc on
  // the box: hex cannot close a heredoc or start a command substitution.
  if (!/^[0-9a-f]{64}$/.test(env.VITE_GLYPH_API_TOKEN)) {
    fail('VITE_GLYPH_API_TOKEN must be 64 hex characters (openssl rand -hex 32).');
  }
  // Sign in with Notion (server/src/notion.rs). Optional: without both, the
  // Notion routes say sign-in isn't set up and nothing else changes. Their
  // shape is checked for the same reason as the token's.
  for (const key of ['NOTION_CLIENT_ID', 'NOTION_CLIENT_SECRET']) {
    if (env[key] && !/^[A-Za-z0-9_-]{8,200}$/.test(env[key])) fail(`${key} in .env has characters a Notion ${key.endsWith('ID') ? 'client ID' : 'secret'} doesn't.`);
  }
  if (Boolean(env.NOTION_CLIENT_ID) !== Boolean(env.NOTION_CLIENT_SECRET)) {
    fail('.env has one of NOTION_CLIENT_ID and NOTION_CLIENT_SECRET but not the other.');
  }
  return env;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) fail(`${command} ${args[0] ?? ''} failed (exit ${result.status ?? 'signal'}).`);
}

const curl = (args) => spawnSync('curl', ['-s', '-m', '25', ...args], { encoding: 'utf8' });

/*
 * `--mcp-only`: ship the hosted MCP server and nothing else - no cargo, and
 * glyph-api on the box is not touched, restarted or backed up. For a change
 * to the sign-in page or a tool, which is most of them. Either way, glyph-mcp
 * is restarted only when its file or unit actually changed: a restart signs
 * every connected person out (docs/MCP.md), and a glyph-api deploy is no
 * reason for that.
 */
const MCP_ONLY = process.argv.includes('--mcp-only');

/*
 * The same control socket deploy-ota.mjs uses. Run straight after
 * `deploy-ota.mjs --keep-connection`, this rides that deploy's login and
 * spends none of its own; on its own it logs in once, as before. One password
 * prompt, so a refused login is one strike against the lockout, not three.
 */
const SSH_OPTS = [
  '-o', 'StrictHostKeyChecking=no',
  '-o', 'ConnectTimeout=20',
  '-o', 'ControlMaster=auto',
  '-o', `ControlPath=${join(homedir(), '.ssh', 'glyph-deploy-%C')}`,
  '-o', 'ControlPersist=120',
  '-o', 'NumberOfPasswordPrompts=1',
];

const env = loadEnv();
for (const tool of ['cargo', 'cargo-zigbuild', 'zig', 'sshpass', 'tar', 'curl']) {
  if (spawnSync('sh', ['-c', `command -v ${tool}`], { stdio: 'ignore' }).status !== 0) {
    fail(`${tool} is not installed (brew install zig cargo-zigbuild sshpass; rustup target add x86_64-unknown-linux-gnu).`);
  }
}

// ---- build ------------------------------------------------------------------

if (!MCP_ONLY) {
  step('Testing the server');
  run('cargo', ['test', '--quiet'], { cwd: SERVER });

  step(`Cross-compiling for ${TARGET}`);
  run('cargo', ['zigbuild', '--release', '--target', TARGET], { cwd: SERVER });
  if (!existsSync(BIN)) fail(`Build produced no binary at ${BIN}.`);
}

step('Building the hosted MCP server');
run('node', [join(ROOT, 'scripts/build-mcp.mjs')]);
if (!existsSync(MCP_BUNDLE)) fail(`The MCP build left nothing at ${MCP_BUNDLE}.`);

// ---- ship and install -------------------------------------------------------

/*
 * The remote half. It runs from the stage, as the deploy account, with the
 * token in GLYPH_API_TOKEN_NEW (see `ship` below for how it got there).
 */
const INSTALL = `set -euo pipefail
SUDO=; [ "$(id -u)" -eq 0 ] || SUDO=sudo
STAGE="$HOME/${STAGE}"
stamp=$(date -u +%Y%m%d-%H%M%S)
MCP_ONLY=${MCP_ONLY ? 1 : 0}
[ \${#GLYPH_API_TOKEN_NEW} -eq 64 ] || { echo "the token did not arrive on stdin"; exit 1; }

# A system user of its own, like attackfm's: no home, no shell, no password.
id -u glyph >/dev/null 2>&1 || $SUDO useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin glyph

$SUDO install -d -o root -g root -m 755 ${REMOTE} ${REMOTE}/bin

# printf is a builtin, so the token is in no argument list on this side either;
# written beside the live file and moved over it, so the service never reads
# half of one. Unset straight after, so nothing started below inherits it.
# The Notion client ID and secret travel the same way, and are written only
# when both came (an empty line each when they did not).
backup=
if [ "$MCP_ONLY" != 1 ]; then
{
  printf 'GLYPH_API_TOKEN=%s\\n' "$GLYPH_API_TOKEN_NEW"
  if [ -n "$NOTION_CLIENT_ID_NEW" ] && [ -n "$NOTION_CLIENT_SECRET_NEW" ]; then
    printf 'NOTION_CLIENT_ID=%s\\n' "$NOTION_CLIENT_ID_NEW"
    printf 'NOTION_CLIENT_SECRET=%s\\n' "$NOTION_CLIENT_SECRET_NEW"
  fi
} | $SUDO tee ${REMOTE}/glyph-api.env.new >/dev/null
$SUDO chown root:root ${REMOTE}/glyph-api.env.new
$SUDO chmod 600 ${REMOTE}/glyph-api.env.new
$SUDO mv -f ${REMOTE}/glyph-api.env.new ${REMOTE}/glyph-api.env

if [ -f ${REMOTE}/bin/glyph-api ]; then
  backup=${REMOTE}/bin/glyph-api.bak-$stamp
  $SUDO cp -a ${REMOTE}/bin/glyph-api "$backup"
  # Three backups: enough to step back past one bad deploy and its fix.
  ls -1t ${REMOTE}/bin/glyph-api.bak-* 2>/dev/null | tail -n +4 | xargs -r $SUDO rm -f
fi

# Installed beside the live binary and renamed over it: a rename replaces the
# directory entry, so the running process keeps its old inode and there is no
# "text file busy", and there is never a moment with half a binary on disk.
$SUDO install -o root -g root -m 755 "$STAGE/glyph-api" ${REMOTE}/bin/glyph-api.new
$SUDO mv -f ${REMOTE}/bin/glyph-api.new ${REMOTE}/bin/glyph-api
$SUDO install -o root -g root -m 644 "$STAGE/glyph-api.service" /etc/systemd/system/${SERVICE}.service
fi
unset GLYPH_API_TOKEN_NEW NOTION_CLIENT_ID_NEW NOTION_CLIENT_SECRET_NEW

# Claude's hosted MCP server beside it: the one file, renamed into place like the binary, and its own unit. Only
# when either changed: a restart signs everyone out, so an unchanged server is left running. The previous file is
# kept as .prev for a way back.
$SUDO install -d -o root -g root -m 755 ${REMOTE}/mcp
mcp_changed=
if ! cmp -s "$STAGE/glyph-mcp-hosted.mjs" ${REMOTE}/mcp/glyph-mcp-hosted.mjs || ! cmp -s "$STAGE/glyph-mcp.service" /etc/systemd/system/${MCP_SERVICE}.service; then
  mcp_changed=1
  [ -f ${REMOTE}/mcp/glyph-mcp-hosted.mjs ] && $SUDO cp -a ${REMOTE}/mcp/glyph-mcp-hosted.mjs ${REMOTE}/mcp/glyph-mcp-hosted.mjs.prev
  $SUDO install -o root -g root -m 644 "$STAGE/glyph-mcp-hosted.mjs" ${REMOTE}/mcp/glyph-mcp-hosted.mjs.new
  $SUDO mv -f ${REMOTE}/mcp/glyph-mcp-hosted.mjs.new ${REMOTE}/mcp/glyph-mcp-hosted.mjs
  $SUDO install -o root -g root -m 644 "$STAGE/glyph-mcp.service" /etc/systemd/system/${MCP_SERVICE}.service
fi
$SUDO systemctl daemon-reload
$SUDO systemctl enable ${MCP_SERVICE} >/dev/null 2>&1
if [ -n "$mcp_changed" ] || ! $SUDO systemctl is-active --quiet ${MCP_SERVICE}; then
  $SUDO systemctl restart ${MCP_SERVICE} || true
fi

if [ "$MCP_ONLY" != 1 ]; then
$SUDO systemctl enable ${SERVICE} >/dev/null 2>&1
# A failed start is not fatal HERE: the health loop below is what decides,
# and it is the one place that knows how to put the backup back.
$SUDO systemctl restart ${SERVICE} || true

healthy=
for _ in $(seq 1 20); do
  if curl -fsS -m 5 http://127.0.0.1:${PORT}/glyph/api/health >/dev/null 2>&1; then healthy=1; break; fi
  sleep 0.5
done
if [ -z "$healthy" ]; then
  $SUDO journalctl -u ${SERVICE} -n 30 --no-pager || true
  if [ -n "$backup" ]; then
    $SUDO cp -a "$backup" ${REMOTE}/bin/glyph-api
    $SUDO systemctl restart ${SERVICE}
    echo "ROLLED_BACK to $backup"
  fi
  exit 1
fi
fi
mcp_healthy=
for _ in $(seq 1 20); do
  if curl -fsS -m 5 http://127.0.0.1:${MCP_PORT}/glyph/api/mcp/health >/dev/null 2>&1; then mcp_healthy=1; break; fi
  sleep 0.5
done
if [ -z "$mcp_healthy" ]; then
  $SUDO journalctl -u ${MCP_SERVICE} -n 30 --no-pager || true
fi
rm -rf "$STAGE"
echo "STAMP $stamp"
echo "BACKUP \${backup:-none}"
echo "ACTIVE $($SUDO systemctl is-active ${SERVICE})"
echo "LOOPBACK $(curl -s -m 5 http://127.0.0.1:${PORT}/glyph/api/health)"
echo "MCP_ACTIVE $($SUDO systemctl is-active ${MCP_SERVICE})"
echo "MCP_CHANGED \${mcp_changed:-0}"
echo "MCP_LOOPBACK $(curl -s -m 5 http://127.0.0.1:${MCP_PORT}/glyph/api/mcp/health)"
`;

/**
 * Binary, unit, install script and token to the box in ONE ssh session.
 *
 * It used to be two - an rsync, then an ssh to install - and the second one
 * was refused on 2026-09-12 by the box's connection lockout, twice, ten
 * minutes apart, after an afternoon of benchmarking. One is what this box
 * can afford.
 *
 * stdin carries the token, then the Notion client ID and secret (each on a
 * line of its own, empty when not set), then a tarball. The remote shell `read`s the first line - bash reads a pipe one
 * byte at a time, precisely so that it never swallows what comes after the
 * newline - and tar gets the rest intact. So the token is never in a file on
 * this Mac, never in an argument list on either side (the remote command
 * names the variable, not the value), and never in the tarball.
 */
function ship(env) {
  const local = mkdtempSync(join(tmpdir(), 'glyph-api-'));
  try {
    if (!MCP_ONLY) {
      copyFileSync(BIN, join(local, 'glyph-api'));
      copyFileSync(UNIT, join(local, 'glyph-api.service'));
    }
    copyFileSync(MCP_BUNDLE, join(local, 'glyph-mcp-hosted.mjs'));
    copyFileSync(MCP_UNIT, join(local, 'glyph-mcp.service'));
    writeFileSync(join(local, 'install.sh'), INSTALL);
    // --no-xattrs: macOS stamps com.apple.provenance on everything, and GNU
    // tar on the box prints a warning per file for each one it cannot place.
    const tarball = spawnSync('tar', ['-czf', '-', '--no-xattrs', '--no-mac-metadata', '-C', local, '.'], {
      maxBuffer: 256 * 1024 * 1024,
    });
    if (tarball.status !== 0) fail(`tar failed: ${String(tarball.stderr)}`);
    const remote =
      `set -e; IFS= read -r GLYPH_API_TOKEN_NEW; IFS= read -r NOTION_CLIENT_ID_NEW; IFS= read -r NOTION_CLIENT_SECRET_NEW; ` +
      `export GLYPH_API_TOKEN_NEW NOTION_CLIENT_ID_NEW NOTION_CLIENT_SECRET_NEW; ` +
      `rm -rf "$HOME/${STAGE}"; mkdir -p "$HOME/${STAGE}"; tar xzf - -C "$HOME/${STAGE}"; bash "$HOME/${STAGE}/install.sh"`;
    const result = spawnSync(
      'sshpass',
      ['-e', 'ssh', ...SSH_OPTS, `${env.AFM_DEPLOY_USER}@${env.AFM_DEPLOY_HOST}`, remote],
      {
        input: Buffer.concat([
          Buffer.from(`${env.VITE_GLYPH_API_TOKEN}\n${env.NOTION_CLIENT_ID ?? ''}\n${env.NOTION_CLIENT_SECRET ?? ''}\n`),
          tarball.stdout,
        ]),
        stdio: ['pipe', 'pipe', 'inherit'],
        env: { ...process.env, SSHPASS: env.AFM_DEPLOY_PASS },
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    const out = String(result.stdout ?? '');
    if (result.status !== 0) {
      process.stdout.write(out);
      fail(
        result.status === 5 || /Permission denied/.test(out)
          ? 'ssh refused the password. If .env is right, this is the box\'s connection lockout - wait it out rather than retrying.'
          : 'Remote install failed (output above).',
      );
    }
    return out;
  } finally {
    rmSync(local, { recursive: true, force: true });
  }
}

step(MCP_ONLY ? `Shipping and installing ${MCP_SERVICE} only (one ssh session)` : 'Shipping and installing glyph-api (one ssh session)');
const installed = ship(env);
const field = (name) => new RegExp(`^${name} (.*)$`, 'm').exec(installed)?.[1] ?? '';
ok(`${SERVICE} is ${field('ACTIVE')} on 127.0.0.1:${PORT} ${c.dim(field('LOOPBACK'))}`);
if (field('MCP_ACTIVE') !== 'active') fail(`${MCP_SERVICE} is ${field('MCP_ACTIVE') || 'not reporting'} (its journal is above).`);
ok(`${MCP_SERVICE} is active on 127.0.0.1:${MCP_PORT} ${c.dim(field('MCP_LOOPBACK'))}${field('MCP_CHANGED') === '1' ? '' : c.dim(' (unchanged, left running)')}`);

// ---- prove it ---------------------------------------------------------------

step('Checking it from outside');
const health = curl(['-w', '\n%{http_code}', `${API}/health`]);
const [healthBody, healthCode] = [health.stdout.slice(0, health.stdout.lastIndexOf('\n')), health.stdout.split('\n').pop()];
if (healthCode !== '200') {
  fail(
    `${API}/health answered ${healthCode}. The service is up on loopback, so this is the route: ` +
      `/etc/caddy/Caddyfile needs "handle /glyph/api/* { reverse_proxy 127.0.0.1:${PORT} }" in the attack.fm block, ` +
      'before the catch-all handle.',
  );
}
let parsed;
try {
  parsed = JSON.parse(healthBody);
} catch {
  fail(`${API}/health answered 200 with something that is not JSON - is another handle catching the route?`);
}
// "ollama": false is a service that deployed fine and cannot do its one job,
// and a deploy that reports success over it would be the least useful kind.
if (!parsed.ollama) fail(`glyph-api is up, but reports Ollama unreachable or ${parsed.model} not pulled.`);
ok(`${API}/health ${c.dim(healthBody)}`);

const unauthorised = curl([
  '-o', '/dev/null', '-w', '%{http_code}',
  '-X', 'POST', '-H', 'Content-Type: application/json', '--data', '{"text":"hello"}',
  `${API}/format`,
]).stdout;
if (unauthorised !== '401') fail(`a POST without the token answered ${unauthorised}, expected 401.`);
ok('a request without the token is refused (401)');

// Sign in with Notion: with the app's credentials installed, the start route
// sends the browser on to Notion's consent page. The Location is not printed.
if (env.NOTION_CLIENT_ID) {
  const probe = 'glyphdeploycheck'.repeat(3);
  const start = curl(['-o', '/dev/null', '-w', '%{http_code} %{redirect_url}', `${API}/notion/start?state=${probe}&challenge=${probe}`]).stdout;
  const [code, location = ''] = start.split(' ');
  if (!['302', '303', '307'].includes(code) || !location.startsWith('https://api.notion.com/v1/oauth/authorize?')) {
    fail(`/notion/start answered ${code}${location ? ` to ${new URL(location).host}` : ''}, expected a redirect to Notion.`);
  }
  ok(`Sign in with Notion hands off to api.notion.com (${code})`);
}

// Claude's server, through the proxy: the one path a person's Claude will take.
const mcpHealth = curl(['-w', '\n%{http_code}', `${API}/mcp/health`]);
const mcpCode = mcpHealth.stdout.split('\n').pop();
if (mcpCode !== '200') fail(`${API}/mcp/health answered ${mcpCode}: the proxy route in glyph-api or ${MCP_SERVICE} is not right.`);
const discovery = curl(['-o', '/dev/null', '-w', '%{http_code}', `${API}/mcp/.well-known/openid-configuration`]).stdout;
if (discovery !== '200') fail(`${API}/mcp/.well-known/openid-configuration answered ${discovery}.`);
const challenged = curl(['-o', '/dev/null', '-w', '%{http_code}', '-X', 'POST', '-H', 'Content-Type: application/json', '--data', '{}', `${API}/mcp`]).stdout;
if (challenged !== '401') fail(`a POST to ${API}/mcp without a token answered ${challenged}, expected 401.`);
ok(`${API}/mcp answers: health, discovery, and 401 without a token`);

if (field('MCP_CHANGED') === '1') {
  console.log(c.dim(`  rollback (${MCP_SERVICE}): sudo mv -f ${REMOTE}/mcp/glyph-mcp-hosted.mjs.prev ${REMOTE}/mcp/glyph-mcp-hosted.mjs && sudo systemctl restart ${MCP_SERVICE}`));
}
const backup = field('BACKUP');
if (MCP_ONLY) {
  // glyph-api was not touched: nothing of it to roll back.
} else if (backup && backup !== 'none') {
  console.log(
    c.dim(`  rollback: sudo cp -a ${backup} ${REMOTE}/bin/glyph-api && sudo systemctl restart ${SERVICE}`),
  );
} else {
  console.log(c.dim(`  rollback: first install - sudo systemctl disable --now ${SERVICE} removes it`));
}
