// @vitest-environment node
import type { Server } from 'node:http';
import { createServer } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { derive, passwordSalt, toBase64Url, unwrap } from '../src/app/core/sync/crypto.ts';
import type { Note } from '../src/app/core/store.ts';
import { ClaudeMemory, fakeService, FAST } from './fake.ts';
import { hostedApp } from './hosted.ts';

/**
 * The hosted server, connected to as Claude connects: the client library's own OAuth flow (discovery from the 401,
 * registration, the sign-in page, the code, the tokens), then the tools, against the sync service stood in for in
 * memory (fake.ts). The browser's part - the sign-in page's script - is played by the test with the same crypto.
 */

const aNote = (id: string, body: string): Note => ({ id, body, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000, source: 'capture', starred: false, archivedAt: null });

describe('Claude connecting to the hosted server', () => {
  let server: Server;
  let origin = '';
  let service: Awaited<ReturnType<typeof fakeService>>;
  let hosted: ReturnType<typeof hostedApp>;
  const clock = { now: 1_800_000_000_000 };

  /** A port nobody is using, so the app can be made with its real address as the issuer. */
  const freePort = () =>
    new Promise<number>((resolve) => {
      const probe = createServer();
      probe.listen(0, '127.0.0.1', () => {
        const { port } = probe.address() as { port: number };
        probe.close(() => resolve(port));
      });
    });

  beforeAll(async () => {
    service = await fakeService('matt', 'correct horse');
    await service.deviceWrites(aNote('n1', '# Groceries\n\nWe need:\n- eggs\n- milk'));
    const port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    hosted = hostedApp({ issuer: `${origin}/glyph/api/mcp`, api: 'https://fake.test/glyph/api', apiPublic: 'https://fake.test/glyph/api', fetcher: service.fetcher, rateLimit: false, now: () => clock.now });
    await new Promise<void>((resolve) => {
      server = hosted.app.listen(port, '127.0.0.1', () => resolve());
    });
  });

  afterAll(() => {
    server?.close();
  });

  /** The sign-in page's script, played here: the same halves derived, the key unwrapped, and handed over. */
  async function signInOnThePage(authorizeUrl: URL, handle: string, password: string): Promise<URL> {
    const page = await fetch(authorizeUrl);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('keeps it in memory only');
    const request = /data-request="([^"]+)"/.exec(html)?.[1];
    const base = /data-base="([^"]+)"/.exec(html)?.[1];
    expect(request && base).toBeTruthy();
    const { login, wrapKey } = await derive(password, passwordSalt(handle), FAST);
    const answer = await service.fetcher('https://fake.test/glyph/api/v1/login', { method: 'POST', body: JSON.stringify({ handle, loginSecret: login }) }).then((r) => r.json() as Promise<{ token: string; wrapped: string; account: { handle: string } }>);
    const key = await unwrap(answer.wrapped, wrapKey, true);
    const raw = toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', key)));
    const done = await fetch(`${base}/authorize/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request, handle: answer.account.handle, token: answer.token, accountKey: raw }) });
    const body = (await done.json()) as { redirect?: string; error?: string };
    expect(done.status, body.error).toBe(200);
    return new URL(body.redirect!);
  }

  const asText = (result: Awaited<ReturnType<Client['callTool']>>) => (result.content as { text?: string }[])[0]?.text ?? '';

  it('is found from the 401, registers Claude, sends the person to sign in, and then serves the tools', async () => {
    const memory = new ClaudeMemory('http://localhost:9999/callback');
    const url = new URL(`${origin}/glyph/api/mcp`);
    let transport = new StreamableHTTPClientTransport(url, { authProvider: memory });
    const client = new Client({ name: 'claude', version: '0' });
    // First contact: refused, and the client library works out where to sign in and registers itself.
    await expect(client.connect(transport)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(memory.info?.client_id).toBeTruthy();
    expect(memory.sentTo?.pathname).toBe('/glyph/api/mcp/authorize');
    expect(memory.sentTo?.searchParams.get('code_challenge_method')).toBe('S256');

    // The person signs in on the page; the page sends them back to Claude with a code.
    const back = await signInOnThePage(memory.sentTo!, 'matt', 'correct horse');
    expect(back.origin + back.pathname).toBe('http://localhost:9999/callback');
    const code = back.searchParams.get('code')!;
    expect(code).toBeTruthy();
    expect(back.searchParams.get('state')).toBe(memory.sentTo!.searchParams.get('state'));
    expect(hosted.sessions.size).toBe(1);

    // The code becomes tokens, and the connection is made.
    await transport.finishAuth(code);
    expect(memory.saved?.access_token).toBeTruthy();
    expect(memory.saved?.refresh_token).toBeTruthy();
    transport = new StreamableHTTPClientTransport(url, { authProvider: memory });
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('append_to_note');

    // The tools work on the account, through the key the page handed over.
    const listed = JSON.parse(asText(await client.callTool({ name: 'list_notes', arguments: {} }))) as { notes: { title: string }[] };
    expect(listed.notes.map((n) => n.title)).toEqual(['Groceries']);
    const added = JSON.parse(asText(await client.callTool({ name: 'append_to_note', arguments: { title: 'Groceries', text: 'bread', as: 'item' } }))) as { added: string[] };
    expect(added.added).toEqual(['- Bread']);
    expect((await service.stored('n1'))?.note.body).toBe('# Groceries\n\nWe need:\n- eggs\n- milk\n- Bread');

    // An hour on, the access token has run out: the library refreshes it by itself and carries on.
    clock.now += 61 * 60 * 1000;
    const status = JSON.parse(asText(await client.callTool({ name: 'account_status', arguments: {} }))) as { handle: string; notes: number };
    expect(status).toMatchObject({ handle: 'matt', notes: 1 });
    expect(memory.saved?.access_token).toBeTruthy();
    await client.close();
  });

  it('refuses a token it never issued, a stale sign-in page, and a key that is not one', async () => {
    const refused = await fetch(`${origin}/glyph/api/mcp`, { method: 'POST', headers: { Authorization: 'Bearer nope', 'Content-Type': 'application/json' }, body: '{}' });
    expect(refused.status).toBe(401);
    expect(refused.headers.get('www-authenticate')).toContain(`resource_metadata="${origin}/glyph/api/mcp/.well-known/oauth-protected-resource"`);
    const stale = await fetch(`${origin}/glyph/api/mcp/authorize/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request: 'gone', handle: 'matt', token: 't', accountKey: 'x' }) });
    expect(stale.status).toBe(400);
    const metadata = (await (await fetch(`${origin}/glyph/api/mcp/.well-known/openid-configuration`)).json()) as { issuer: string; token_endpoint: string; code_challenge_methods_supported: string[] };
    expect(metadata.issuer).toBe(`${origin}/glyph/api/mcp`);
    expect(metadata.token_endpoint).toBe(`${origin}/glyph/api/mcp/token`);
    expect(metadata.code_challenge_methods_supported).toEqual(['S256']);
    const noGet = await fetch(`${origin}/glyph/api/mcp`);
    expect(noGet.status).toBe(405);
  });

  it('ends a session, key and all, when nobody has used it for a week', async () => {
    expect(hosted.sessions.size).toBe(1);
    clock.now += 8 * 24 * 60 * 60 * 1000;
    hosted.sweep();
    expect(hosted.sessions.size).toBe(0);
  });
  it('counts the connections an account has, and one of them can end them all', async () => {
    // Two Claudes on Matt's account: a second computer, or a second Claude account.
    const url = new URL(`${origin}/glyph/api/mcp`);
    const connect = async () => {
      const memory = new ClaudeMemory('http://localhost:9999/callback');
      let transport = new StreamableHTTPClientTransport(url, { authProvider: memory });
      const client = new Client({ name: 'claude', version: '0' });
      await expect(client.connect(transport)).rejects.toBeInstanceOf(UnauthorizedError);
      const back = await signInOnThePage(memory.sentTo!, 'matt', 'correct horse');
      await transport.finishAuth(back.searchParams.get('code')!);
      transport = new StreamableHTTPClientTransport(url, { authProvider: memory });
      await client.connect(transport);
      return client;
    };
    const one = await connect();
    const two = await connect();
    const mine = () => [...hosted.sessions.values()].filter((s) => s.handle === 'matt').length;
    expect(mine()).toBeGreaterThanOrEqual(2);
    const status = JSON.parse(asText(await one.callTool({ name: 'account_status', arguments: {} }))) as { connections: number };
    expect(status.connections).toBe(mine());

    // One of them signs out everywhere: every session for the handle goes, the other's token with it.
    const ended = JSON.parse(asText(await two.callTool({ name: 'sign_out_everywhere', arguments: {} }))) as { endedConnections: number };
    expect(ended.endedConnections).toBe(status.connections);
    expect(mine()).toBe(0);
    await expect(one.callTool({ name: 'account_status', arguments: {} })).rejects.toBeTruthy();
    await one.close().catch(() => undefined);
    await two.close().catch(() => undefined);
  });

});
