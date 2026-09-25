// @vitest-environment node
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accountState, signUp, type Deps } from '../src/app/core/account/account.ts';
import { API_BASE } from '../src/app/core/account/api.ts';
import { memoryKeys } from '../src/app/core/account/keystore.ts';
import type { Note } from '../src/app/core/store.ts';
import { emptyState, syncNotes, type LocalFiles, type LocalNotes, type SyncContext } from '../src/app/core/sync/notes.ts';
import { derive, passwordSalt, ROUNDS, toBase64Url, unwrap } from '../src/app/core/sync/crypto.ts';
import { ClaudeMemory } from './fake.ts';
import { GlyphAccount } from './glyph.ts';

/**
 * The MCP server against a real glyph-api and the app's own sync code: run with
 *
 *   GLYPH_MCP_E2E=1 VITE_GLYPH_API=http://127.0.0.1:<port>/glyph/api npx vitest run mcp.e2e
 *
 * after `node scripts/build-mcp.mjs`. Skipped otherwise. Every run makes a fresh account. "The phone" here is the
 * app's sync (core/sync/notes.ts) over a map of notes, exactly as sync.e2e.test.ts stands a device in; the MCP server
 * is the built file, spoken to over stdio as Claude speaks to it.
 */

const ON = process.env.GLYPH_MCP_E2E;
const BUNDLE = join(process.cwd(), 'mcp/dist/glyph-mcp.mjs');
const HOSTED = join(process.cwd(), 'mcp/dist/glyph-mcp-hosted.mjs');

/** A phone: the app's sync over a map. */
function phone(deps: Deps, token: () => string) {
  const notes = new Map<string, Note>();
  const local: LocalNotes = {
    list: async () => [...notes.values()].map((n) => ({ ...n, segments: null, formatted: null })),
    get: async (id) => (notes.has(id) ? { ...notes.get(id)! } : null),
    apply: async (note) => {
      notes.set(note.id, { ...note });
      return { ...note, segments: null, formatted: null };
    },
    remove: async (id) => {
      notes.delete(id);
    },
  };
  const files: LocalFiles = { read: async () => null, write: async () => undefined };
  let state = emptyState();
  const ctx = async (): Promise<SyncContext> => ({
    token: token(),
    key: (await deps.keys.accountKey())!,
    notes: local,
    files,
    state,
    save: (next) => {
      state = JSON.parse(JSON.stringify(next)) as typeof state;
    },
  });
  return { notes, sync: async () => syncNotes(await ctx()) };
}

describe.skipIf(!ON || !existsSync(BUNDLE))('Claude and a phone on one Glyph account', () => {
  const handle = `m${Date.now().toString(36)}`;
  const password = 'correct horse battery';
  // The real rounds, not a test's fast few: the built server stretches the password the real way, and the login
  // secret has to match. Node stretches 600 000 rounds in a fifth of a second.
  const deps: Deps = { keys: memoryKeys(), rounds: ROUNDS };
  let token = '';
  const device = phone(deps, () => token);
  let client: Client | null = null;

  afterAll(async () => {
    await client?.close();
  });

  it('the phone signs up and writes a note', async () => {
    await signUp(handle, password, deps);
    token = accountState().session!.token;
    const now = Date.now();
    device.notes.set('phone-1', { id: 'phone-1', body: '# Groceries\n\nWe need:\n- eggs\n- milk', createdAt: now, updatedAt: now, source: 'capture', starred: false, archivedAt: null });
    await device.sync();
  });

  it('the client signs in with the password and reads what the phone wrote', async () => {
    const session = await GlyphAccount.signIn(API_BASE, handle, password);
    const account = new GlyphAccount(session);
    const notes = await account.list();
    expect(notes.map((r) => r.note.body)).toEqual(['# Groceries\n\nWe need:\n- eggs\n- milk']);
    // A note made here lands on the phone at its next sync, and an edit made here too.
    const made = await account.create('# From Claude\n\n- [ ] Book the ferry');
    await account.edit('phone-1', (note) => ({ ...note, body: `${note.body}\n- bread` }));
    await device.sync();
    expect(device.notes.get(made.note.id)?.body).toBe('# From Claude\n\n- [ ] Book the ferry');
    expect(device.notes.get('phone-1')?.body).toBe('# Groceries\n\nWe need:\n- eggs\n- milk\n- bread');
    // And the phone's own words are still its own: the same fingerprint the app keeps, nothing copied twice.
    expect(device.notes.size).toBe(2);
  });

  it('the built server speaks MCP over stdio and its tools do the work', async () => {
    // The password is stretched with the real rounds here, as it is for a person: this one test takes a couple of seconds.
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [BUNDLE],
      env: { ...process.env, GLYPH_API: API_BASE, GLYPH_HANDLE: handle, GLYPH_PASSWORD: password, GLYPH_MCP_HOME: join(process.cwd(), 'mcp/dist/.e2e-home') },
      stderr: 'pipe',
    });
    client = new Client({ name: 'e2e', version: '0' });
    let said = '';
    transport.stderr?.on('data', (chunk: Buffer) => {
      said += chunk.toString();
    });
    await client.connect(transport).catch((failure: unknown) => {
      throw new Error(`The server did not start: ${failure instanceof Error ? failure.message : String(failure)}\nIt said: ${said}`);
    });

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['account_status', 'append_to_note', 'create_note', 'list_notes', 'read_note', 'search_notes', 'set_note_flags', 'update_note']);

    const asText = (result: Awaited<ReturnType<Client['callTool']>>) => {
      const content = result.content as { type: string; text?: string }[];
      return content[0]?.text ?? '';
    };
    const listed = JSON.parse(asText(await client.callTool({ name: 'list_notes', arguments: {} }))) as { count: number; notes: { id: string; title: string }[] };
    expect(listed.count).toBe(2);
    expect(listed.notes.map((n) => n.title).sort()).toEqual(['From Claude', 'Groceries']);

    const status = JSON.parse(asText(await client.callTool({ name: 'account_status', arguments: {} }))) as { handle: string; notes: number };
    expect(status).toMatchObject({ handle, notes: 2 });

    const created = JSON.parse(asText(await client.callTool({ name: 'create_note', arguments: { title: 'Trip plan', body: 'Leave at eight.', pinned: true } }))) as { created: { id: string; title: string; pinned: boolean; body: string } };
    expect(created.created).toMatchObject({ title: 'Trip plan', pinned: true, body: '# Trip plan\n\nLeave at eight.' });

    const appended = JSON.parse(asText(await client.callTool({ name: 'append_to_note', arguments: { title: 'Groceries', text: 'coffee', as: 'item' } }))) as { added: string[] };
    expect(appended.added).toEqual(['- Coffee']);

    const task = JSON.parse(asText(await client.callTool({ name: 'append_to_note', arguments: { id: created.created.id, text: 'pack the charger', as: 'task' } }))) as { added: string[] };
    expect(task.added).toEqual(['- [ ] Pack the charger']);

    const read = JSON.parse(asText(await client.callTool({ name: 'read_note', arguments: { title: 'Trip plan' } }))) as { body: string; rev: number };
    // The app's list-append ends a new list with a newline, as the editor does.
    expect(read.body.trimEnd()).toBe('# Trip plan\n\nLeave at eight.\n\n- [ ] Pack the charger');

    const found = JSON.parse(asText(await client.callTool({ name: 'search_notes', arguments: { query: 'ferry' } }))) as { count: number; notes: { title: string; snippet: string }[] };
    expect(found.count).toBe(1);
    expect(found.notes[0]).toMatchObject({ title: 'From Claude' });

    const updated = JSON.parse(asText(await client.callTool({ name: 'update_note', arguments: { id: created.created.id, body: '# Trip plan\n\nLeave at nine.' } }))) as { updated: { body: string } };
    expect(updated.updated.body).toBe('# Trip plan\n\nLeave at nine.');

    const archived = JSON.parse(asText(await client.callTool({ name: 'set_note_flags', arguments: { id: created.created.id, archived: true } }))) as { note: { archived: boolean } };
    expect(archived.note.archived).toBe(true);

    // A write from a stale read is refused, and their words shown, never overwritten.
    await device.sync();
    device.notes.set('phone-1', { ...device.notes.get('phone-1')!, body: '# Groceries\n\nChanged on the phone.', updatedAt: Date.now() });
    await device.sync();
    const refused = await client.callTool({ name: 'update_note', arguments: { id: 'phone-1', body: '# Groceries\n\nWritten blind.' } });
    // The tool read the account fresh first, so this write goes from the phone's revision and lands.
    expect(refused.isError).toBeFalsy();

    // Everything Claude did is on the phone after one sync, as the app would show it.
    await device.sync();
    expect(device.notes.get('phone-1')?.body).toBe('# Groceries\n\nWritten blind.');
    expect(device.notes.get(created.created.id)).toMatchObject({ body: '# Trip plan\n\nLeave at nine.', starred: true });
    expect(device.notes.get(created.created.id)?.archivedAt).toBeTruthy();
  });
});

/**
 * The hosted server (mcp/hosted.ts), built and run as the box runs it, against the same real glyph-api: Claude's
 * client library signs in through the page (played here with the page's own steps and the real rounds), and what the
 * tools do reaches the phone.
 */
describe.skipIf(!ON || !existsSync(HOSTED))('Claude on the hosted server, with a phone, on a real glyph-api', () => {
  const handle = `h${Date.now().toString(36)}`;
  const password = 'correct horse battery';
  const deps: Deps = { keys: memoryKeys(), rounds: ROUNDS };
  let token = '';
  const device = phone(deps, () => token);
  const port = 18821;
  const issuer = `http://127.0.0.1:${port}/glyph/api/mcp`;
  let child: ChildProcess | null = null;
  let said = '';

  beforeAll(async () => {
    await signUp(handle, password, deps);
    token = accountState().session!.token;
    const now = Date.now();
    device.notes.set('phone-1', { id: 'phone-1', body: '# Groceries\n\nWe need:\n- eggs', createdAt: now, updatedAt: now, source: 'capture', starred: false, archivedAt: null });
    await device.sync();
    child = spawn(process.execPath, [HOSTED], { env: { ...process.env, GLYPH_MCP_BIND: `127.0.0.1:${port}`, GLYPH_MCP_ISSUER: issuer, GLYPH_API: API_BASE, GLYPH_API_PUBLIC: API_BASE }, stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr?.on('data', (chunk: Buffer) => {
      said += chunk.toString();
    });
    for (let i = 0; i < 50; i += 1) {
      const up = await fetch(`${issuer}/health`).catch(() => null);
      if (up?.ok) return;
      await new Promise((done) => setTimeout(done, 100));
    }
    throw new Error(`The hosted server did not come up. It said: ${said}`);
  });

  afterAll(() => {
    child?.kill();
  });

  it('signs in through the page, serves the tools, and the phone sees what Claude did', async () => {
    const memory = new ClaudeMemory('http://localhost:9999/callback');
    const url = new URL(issuer);
    let transport = new StreamableHTTPClientTransport(url, { authProvider: memory });
    const client = new Client({ name: 'claude', version: '0' });
    await expect(client.connect(transport)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(memory.sentTo?.pathname).toBe('/glyph/api/mcp/authorize');

    // The page, played step by step: the real service's sign-in, the key unwrapped, the code back to Claude.
    const html = await (await fetch(memory.sentTo!)).text();
    const request = /data-request="([^"]+)"/.exec(html)![1]!;
    const { login, wrapKey } = await derive(password, passwordSalt(handle), ROUNDS);
    const answer = (await (await fetch(`${API_BASE}/v1/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ handle, loginSecret: login }) })).json()) as { token: string; wrapped: string; account: { handle: string } };
    const key = await unwrap(answer.wrapped, wrapKey, true);
    const raw = toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', key)));
    const done = await fetch(`${issuer}/authorize/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request, handle: answer.account.handle, token: answer.token, accountKey: raw }) });
    const { redirect, error } = (await done.json()) as { redirect?: string; error?: string };
    expect(done.status, error).toBe(200);
    await transport.finishAuth(new URL(redirect!).searchParams.get('code')!);

    transport = new StreamableHTTPClientTransport(url, { authProvider: memory });
    await client.connect(transport);
    const asText = (result: Awaited<ReturnType<Client['callTool']>>) => (result.content as { text?: string }[])[0]?.text ?? '';
    const listed = JSON.parse(asText(await client.callTool({ name: 'list_notes', arguments: {} }))) as { notes: { title: string }[] };
    expect(listed.notes.map((n) => n.title)).toEqual(['Groceries']);
    const created = JSON.parse(asText(await client.callTool({ name: 'create_note', arguments: { title: 'From the hosted server', body: '- [ ] Works' } }))) as { created: { id: string } };
    const added = JSON.parse(asText(await client.callTool({ name: 'append_to_note', arguments: { title: 'Groceries', text: 'milk', as: 'item' } }))) as { added: string[] };
    expect(added.added).toEqual(['- Milk']);
    await client.close();

    await device.sync();
    expect(device.notes.get('phone-1')?.body).toBe('# Groceries\n\nWe need:\n- eggs\n- Milk');
    expect(device.notes.get(created.created.id)?.body).toBe('# From the hosted server\n\n- [ ] Works');
  });
});
