import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DEFAULT_API, GlyphAccount, GlyphApiError, type StoredSession } from './glyph.ts';
import { buildServer, VERSION } from './server.ts';
import { ensureWebCrypto } from './webcrypto.ts';

/**
 * The `glyph-mcp` command (docs/MCP.md): sign in once, then serve Glyph's notes to Claude over stdio.
 *
 *   glyph-mcp login <handle>     sign in with the password (asked for, or GLYPH_PASSWORD), and keep the session
 *   glyph-mcp status             which account is signed in, and whether the session still works
 *   glyph-mcp logout             forget the session
 *   glyph-mcp                    serve: what Claude Desktop, Claude Code and the rest run
 *
 * The session - the token, the account key, and this client's own signing key - is kept in one file in the person's
 * config folder (`~/.config/glyph-mcp/session.json`, or under GLYPH_MCP_HOME), readable by them alone. It is what a
 * signed-in phone keeps, and it is the reason the password is never needed again and never stored. A headless setup
 * can give GLYPH_HANDLE and GLYPH_PASSWORD instead, and the server signs in each time it starts.
 */

const home = process.env.GLYPH_MCP_HOME || join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'glyph-mcp');
const sessionFile = join(home, 'session.json');
const api = (process.env.GLYPH_API || DEFAULT_API).replace(/\/+$/, '');

function readStored(): StoredSession | null {
  try {
    const value = JSON.parse(readFileSync(sessionFile, 'utf8')) as StoredSession;
    return value && value.v === 1 && typeof value.token === 'string' && typeof value.accountKey === 'string' ? value : null;
  } catch {
    return null;
  }
}

function writeStored(session: StoredSession): void {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(sessionFile, JSON.stringify(session, null, 2), { mode: 0o600 });
  chmodSync(sessionFile, 0o600);
}

/** The password, typed without echo, or from GLYPH_PASSWORD. */
async function askPassword(prompt: string): Promise<string> {
  const given = process.env.GLYPH_PASSWORD;
  if (given) return given;
  if (!process.stdin.isTTY) throw new Error('No terminal to ask for the password: set GLYPH_PASSWORD for this one command.');
  process.stderr.write(prompt);
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    let typed = '';
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          input.setRawMode(false);
          input.pause();
          input.off('data', onData);
          process.stderr.write('\n');
          resolve(typed);
          return;
        }
        if (ch === '') {
          input.setRawMode(false);
          reject(new Error('Cancelled.'));
          return;
        }
        if (ch === '' || ch === '\b') typed = typed.slice(0, -1);
        else typed += ch;
      }
    };
    input.on('data', onData);
  });
}

async function login(handle: string | undefined): Promise<void> {
  if (!handle) throw new Error('Say which account: glyph-mcp login <handle>');
  const password = await askPassword(`Password for ${handle} on ${api}: `);
  process.stderr.write('Signing in (this takes a moment: the password is stretched 600 000 times, as the app does)…\n');
  const session = await GlyphAccount.signIn(api, handle, password, { label: 'Claude' });
  writeStored(session);
  process.stderr.write(`Signed in as ${session.handle}. The session is kept in ${sessionFile}; the password is not.\n`);
}

async function status(): Promise<void> {
  const account = await openAccount();
  await account.pull();
  const notes = await account.list({ archived: true });
  process.stderr.write(`Signed in as ${account.handle} at ${account.api}: ${notes.length} notes.\nSession: ${process.env.GLYPH_PASSWORD ? 'from GLYPH_HANDLE and GLYPH_PASSWORD' : sessionFile}\n`);
}

function logout(): void {
  if (existsSync(sessionFile)) unlinkSync(sessionFile);
  process.stderr.write('Signed out: the session file is gone.\n');
}

/** The account to serve: the kept session, or a sign-in from the environment. */
async function openAccount(): Promise<GlyphAccount> {
  const handle = process.env.GLYPH_HANDLE;
  const password = process.env.GLYPH_PASSWORD;
  if (handle && password) {
    const session = await GlyphAccount.signIn(api, handle, password, { label: 'Claude' });
    return new GlyphAccount(session);
  }
  const stored = readStored();
  if (!stored) throw new Error(`Not signed in. Run: glyph-mcp login <handle>   (or set GLYPH_HANDLE and GLYPH_PASSWORD)`);
  const account = new GlyphAccount(stored, { save: writeStored });
  await account.resume();
  return account;
}

async function serve(): Promise<void> {
  const account = await openAccount();
  const server = buildServer(account);
  await server.connect(new StdioServerTransport());
  process.stderr.write(`glyph-mcp ${VERSION}: serving ${account.handle}'s notes over stdio.\n`);
}

async function main(): Promise<void> {
  ensureWebCrypto();
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case 'login':
      return login(rest[0]);
    case 'status':
      return status();
    case 'logout':
      return logout();
    case 'version':
      process.stdout.write(`${VERSION}\n`);
      return;
    case undefined:
    case 'serve':
      return serve();
    default:
      throw new Error(`Unknown command ${command}. Use: login <handle>, status, logout, or none to serve.`);
  }
}

main().catch((failure: unknown) => {
  const words = failure instanceof GlyphApiError ? `Ghost.md's sync service refused: ${failure.message}` : failure instanceof Error ? failure.message : String(failure);
  process.stderr.write(`glyph-mcp: ${words}\n`);
  process.exit(1);
});
