import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationFull, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { derive, newAccountKey, open, passwordSalt, seal, wrap } from '../src/app/core/sync/crypto.ts';
import type { Note } from '../src/app/core/store.ts';
import type { NotePayload } from '../src/app/core/sync/notes.ts';

/**
 * Glyph's sync service stood in for in memory, for the tests (glyph.test.ts, hosted.test.ts): the same routes,
 * revisions and refusals as server/src/sync.rs and accounts.rs, so every rule the clients live by is tried without a
 * server. One account, its feed, and the tokens it has handed out.
 */

/** PBKDF2 rounds for a test: the real 600 000 are for a person's password, not for a test that makes ten accounts. */
export const FAST = 1_000;

const encoder = new TextEncoder();

interface Stored {
  rev: number;
  deleted: boolean;
  blob: string | null;
}

/** The service in memory: one account, its feed, and the tokens it has handed out. */
export async function fakeService(handle: string, password: string) {
  const accountKey = await newAccountKey();
  const { login, wrapKey } = await derive(password, passwordSalt(handle), FAST);
  const wrapped = await wrap(accountKey, wrapKey);
  const notes = new Map<string, Stored>();
  let counter = 0;
  const tokens = new Set<string>();
  let devicePublicKey: string | null = null;
  const nonces = new Set<string>();
  let issued = 0;
  const calls: string[] = [];
  const token = () => {
    const t = `tok-${++issued}`;
    tokens.add(t);
    return t;
  };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const account = { id: 7, handle };

  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const path = url.pathname.replace(/^.*\/v1\//, '');
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const bearer = (init?.headers as Record<string, string> | undefined)?.Authorization?.replace('Bearer ', '') ?? null;
    calls.push(`${method} ${path}`);
    if (method === 'POST' && path === 'login') {
      if (body.handle !== handle || body.loginSecret !== login) return json(401, { error: 'Wrong handle or password.' });
      return json(200, { token: token(), account, wrapped });
    }
    if (method === 'POST' && path === 'login/challenge') {
      const nonce = `nonce-${++issued}`;
      nonces.add(nonce);
      return json(200, { nonce });
    }
    if (method === 'POST' && path === 'login/device') {
      if (!devicePublicKey || !nonces.delete(String(body.nonce))) return json(401, { error: 'No such device.' });
      const key = await crypto.subtle.importKey('raw', Uint8Array.from(atob(String(devicePublicKey).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)), { name: 'Ed25519' }, false, ['verify']);
      const sig = Uint8Array.from(atob(String(body.signature).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
      const ok = await crypto.subtle.verify({ name: 'Ed25519' }, key, sig, encoder.encode(String(body.nonce)));
      return ok ? json(200, { token: token(), account }) : json(401, { error: 'Bad signature.' });
    }
    if (!bearer || !tokens.has(bearer)) return json(401, { error: 'Sign in first.' });
    if (method === 'POST' && path === 'refresh') return json(200, { token: token(), account });
    if (method === 'POST' && path === 'device') {
      devicePublicKey = String(body.devicePublicKey);
      return json(200, {});
    }
    if (method === 'GET' && path.startsWith('notes')) {
      const since = Number(url.searchParams.get('since') ?? 0);
      const items = [...notes.entries()]
        .filter(([, n]) => n.rev > since)
        .sort(([, a], [, b]) => a.rev - b.rev)
        .map(([id, n]) => ({ id, ...n }));
      return json(200, { rev: counter, items, more: false });
    }
    const put = /^notes\/([^/]+)$/.exec(path);
    if (put && (method === 'PUT' || method === 'DELETE')) {
      const id = decodeURIComponent(put[1]!);
      const current = notes.get(id);
      if (current && current.rev !== Number(body.base)) return json(409, { id, ...current });
      counter += 1;
      notes.set(id, method === 'PUT' ? { rev: counter, deleted: false, blob: String(body.blob) } : { rev: counter, deleted: true, blob: null });
      return json(200, { rev: counter });
    }
    return json(404, { error: `No route ${method} ${path}` });
  };

  /** Another device writing a note, sealed as the app seals it. */
  const deviceWrites = async (note: Note, extra: Partial<NotePayload> = {}) => {
    counter += 1;
    const blob = await seal(accountKey, { v: 1, note, ...extra }, `note:${note.id}`);
    notes.set(note.id, { rev: counter, deleted: false, blob });
    return counter;
  };
  const stored = async (id: string) => {
    const item = notes.get(id);
    if (!item?.blob) return null;
    return open<NotePayload>(accountKey, item.blob, `note:${id}`);
  };
  const expireAllTokens = () => tokens.clear();
  return { fetcher, deviceWrites, stored, expireAllTokens, calls, notes };
}


/** What Claude keeps for one server: the registration, the tokens, the PKCE verifier, and where it was sent to sign in. */
export class ClaudeMemory implements OAuthClientProvider {
  info: OAuthClientInformationFull | undefined;
  saved: OAuthTokens | undefined;
  verifier = '';
  sentTo: URL | null = null;
  constructor(readonly redirectUrl: string) {}
  get clientMetadata(): OAuthClientMetadata {
    return { client_name: 'Claude', redirect_uris: [this.redirectUrl], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' };
  }
  clientInformation() {
    return this.info;
  }
  saveClientInformation(info: OAuthClientInformationFull) {
    this.info = info;
  }
  tokens() {
    return this.saved;
  }
  saveTokens(tokens: OAuthTokens) {
    this.saved = tokens;
  }
  redirectToAuthorization(url: URL) {
    this.sentTo = url;
  }
  saveCodeVerifier(verifier: string) {
    this.verifier = verifier;
  }
  codeVerifier() {
    return this.verifier;
  }
}

