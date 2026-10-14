import { derive, fromBase64Url, open, passwordSalt, ROUNDS, seal, toBase64Url, unwrap } from '../src/app/core/sync/crypto.ts';
import type { Note } from '../src/app/core/store.ts';
import type { NotePayload } from '../src/app/core/sync/notes.ts';

/**
 * A Glyph account from outside the app: the sync service (docs/SYNC.md) as a client that signs in, reads the
 * account's notes and writes them, for the MCP server (mcp/server.ts, docs/MCP.md).
 *
 * The notes are end-to-end encrypted, so this is a device like any other: it signs in with the password once, keeps
 * the account key it unwraps, and seals and opens every note with it. The service sees nothing it did not already
 * see from a phone. What it keeps between runs (`StoredSession`) is what a signed-in phone keeps: the session token,
 * the account key, and a signing key of its own that renews a lapsed session without the password.
 *
 * It mirrors core/sync/notes.ts on the wire - the same sealed payload under the same associated data, the same feed
 * and the same `base` on every write - and it never overwrites what it has not read: a write another device beat is
 * refused by the service, and comes back here as a `Conflict` carrying that device's note. A note is never lost to a
 * race, which is the rule the app lives by too.
 */

export interface StoredSession {
  v: 1;
  /** The service, `https://attack.fm/glyph/api` unless told otherwise. */
  api: string;
  handle: string;
  accountId: number;
  token: string;
  /** The account key, raw, as base64url: what opens every note. Kept the way a signed-in device keeps it. */
  accountKey: string;
  /** This client's own Ed25519 signing key, a private JWK, for renewing a lapsed session without the password. */
  deviceKey: JsonWebKey | null;
}

/** A refusal from the service, with its status and its own words. */
export class GlyphApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown = null,
  ) {
    super(message);
  }
}

/** A write another device beat: the service kept theirs, and here it is. */
export class Conflict extends Error {
  constructor(
    readonly id: string,
    readonly theirs: NoteRecord | null,
  ) {
    super(theirs ? 'Another device changed this note first; read it again before writing.' : 'Another device deleted this note.');
  }
}

/** A note as the account holds it: its words, and the revision this client last saw. */
export interface NoteRecord {
  rev: number;
  note: Note;
  /** The hash of the note's recording on the service, if it has one; sent back unchanged with every write. */
  recording?: string;
  /** The pictures the note's body uses, by name; sent back with every write, minus any the body no longer names. */
  images?: string[];
}

interface FeedItem {
  id: string;
  rev: number;
  deleted: boolean;
  blob: string | null;
}

interface SignedIn {
  token: string;
  account: { id: number; handle: string };
  wrapped?: string;
}

export const DEFAULT_API = 'https://attack.fm/glyph/api';
const TIMEOUT_MS = 30_000;
const encoder = new TextEncoder();
/** The picture references a body carries (core/images.ts `IMAGE_REF`). */
const IMAGE_REF = /!\[([^\]]*)\]\(image\/([A-Za-z0-9_.-]+)\)/g;

export interface Hooks {
  fetcher?: typeof fetch;
  /** Called whenever the session changes (a renewed token), so what is kept between runs keeps up. */
  save?: (session: StoredSession) => void;
  /** The account key as a key object, in place of the session's bytes: the hosted server holds it this way, in memory only (docs/MCP.md). */
  key?: CryptoKey;
  /** The session could not be renewed and needs the password again. */
  lapsed?: () => void;
}

/** One JSON call to `<api>/v1/<path>`. */
async function callApi<T>(api: string, method: string, path: string, { token, body, fetcher = fetch }: { token?: string; body?: unknown; fetcher?: typeof fetch }): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetcher(`${api}/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
  } catch (failure) {
    if (controller.signal.aborted) throw new GlyphApiError(0, 'The sync service took too long to answer.');
    throw new GlyphApiError(0, `The sync service could not be reached (${failure instanceof Error ? failure.message : String(failure)}).`);
  } finally {
    clearTimeout(timer);
  }
  const text = await response.text();
  const answer = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const words = answer && typeof answer === 'object' && typeof (answer as { error?: unknown }).error === 'string' ? (answer as { error: string }).error : null;
    throw new GlyphApiError(response.status, words ?? `The sync service answered ${response.status}.`, answer);
  }
  return answer as T;
}

/** Every picture a body refers to (core/images.ts `imageNames`). */
export function imageNames(body: string): string[] {
  return [...body.matchAll(IMAGE_REF)].map((m) => m[2] ?? '').filter(Boolean);
}

/** The note's title as the app's list shows it (core/store.ts `noteTitle`): its first line of words, without a heading's marks. */
export function noteTitle(body: string): string {
  const lines = withoutFrontMatter(body.split('\n'));
  const line = lines.find((l) => l.trim() && !/^!\[[^\]]*\]\([^)]*\)\s*$/.test(l)) ?? '';
  return line.replace(/^#{1,6}\s+/, '').replace(/\s*§§\s*/g, ' ').trim();
}

function withoutFrontMatter(lines: readonly string[]): string[] {
  if (!/^(---|\+\+\+)\s*$/.test(lines[0] ?? '')) return [...lines];
  for (let n = 1; n < Math.min(lines.length, 40); n += 1) {
    if (/^(---|\+\+\+)\s*$/.test(lines[n] ?? '')) {
      const named = lines.slice(1, n).find((key) => /^\s*title\s*:/i.test(key));
      const title = named ? named.replace(/^\s*title\s*:\s*/i, '').replace(/^['"]|['"]$/g, '').trim() : '';
      return title ? [title, ...lines.slice(n + 1)] : lines.slice(n + 1);
    }
  }
  return [...lines];
}

function newId(): string {
  return crypto.randomUUID();
}

async function importAccountKey(raw: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', fromBase64Url(raw), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export class GlyphAccount {
  private key: CryptoKey | null = null;
  private cursor = 0;
  private readonly cache = new Map<string, NoteRecord>();
  private pulled = false;

  constructor(
    private session: StoredSession,
    private readonly hooks: Hooks = {},
  ) {
    this.key = hooks.key ?? null;
  }

  /**
   * In with the password: the two halves are derived as the app derives them, the login half goes to the service, and
   * the wrap half opens the account key here. This client's own signing key is registered on the account, so the
   * session can be renewed later without the password, as a phone's is.
   */
  static async signIn(
    api: string,
    handle: string,
    password: string,
    { rounds = ROUNDS, fetcher = fetch, label = 'Claude' }: { rounds?: number; fetcher?: typeof fetch; label?: string } = {},
  ): Promise<StoredSession> {
    const base = api.replace(/\/+$/, '');
    const { login, wrapKey } = await derive(password, passwordSalt(handle), rounds);
    const answer = await callApi<SignedIn>(base, 'POST', 'login', { fetcher, body: { handle: handle.trim(), loginSecret: login } });
    if (!answer.wrapped) throw new GlyphApiError(500, 'The service answered without this account’s key.');
    const accountKey = await unwrap(answer.wrapped, wrapKey, true).catch(() => {
      throw new GlyphApiError(401, 'This account’s key would not open with that password.');
    });
    const raw = toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', accountKey)));
    // Extractable, unlike the app's, because this client has to keep it between runs in a file rather than in a browser's key store.
    const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    let deviceKey: JsonWebKey | null = null;
    try {
      const devicePublicKey = toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
      await callApi(base, 'POST', 'device', { token: answer.token, fetcher, body: { devicePublicKey, label } });
      deviceKey = await crypto.subtle.exportKey('jwk', pair.privateKey);
    } catch {
      // No device key: the session still works for as long as its token does, and then the password is asked for again.
    }
    return { v: 1, api: base, handle: answer.account.handle, accountId: answer.account.id, token: answer.token, accountKey: raw, deviceKey };
  }

  get handle(): string {
    return this.session.handle;
  }

  get api(): string {
    return this.session.api;
  }

  /** The session as it should be kept. */
  get stored(): StoredSession {
    return this.session;
  }

  private async accountKey(): Promise<CryptoKey> {
    this.key ??= await importAccountKey(this.session.accountKey);
    return this.key;
  }

  private update(session: StoredSession): void {
    this.session = session;
    this.hooks.save?.(session);
  }

  /**
   * The session renewed: with its token while that is good, and, once it has lapsed, with this client's own key. A
   * session that can be renewed neither way needs the password again (`signIn`).
   */
  async resume(): Promise<void> {
    const { api, token, handle } = this.session;
    try {
      const answer = await callApi<SignedIn>(api, 'POST', 'refresh', { token, fetcher: this.hooks.fetcher });
      this.update({ ...this.session, token: answer.token, accountId: answer.account.id, handle: answer.account.handle });
      return;
    } catch (failure) {
      if (!(failure instanceof GlyphApiError) || failure.status !== 401) throw failure;
    }
    const jwk = this.session.deviceKey;
    if (!jwk) {
      this.hooks.lapsed?.();
      throw new GlyphApiError(401, 'This session has lapsed. Sign in again with `login`.');
    }
    const privateKey = await crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['sign']);
    const { nonce } = await callApi<{ nonce: string }>(api, 'POST', 'login/challenge', { fetcher: this.hooks.fetcher, body: { handle } });
    const signature = toBase64Url(new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, privateKey, encoder.encode(nonce))));
    const answer = await callApi<SignedIn>(api, 'POST', 'login/device', { fetcher: this.hooks.fetcher, body: { handle, nonce, signature } }).catch((failure: unknown) => {
      if (failure instanceof GlyphApiError && failure.status === 401) {
        this.hooks.lapsed?.();
        throw new GlyphApiError(401, 'This session has lapsed and could not be renewed. Sign in again with `login`.');
      }
      throw failure;
    });
    this.update({ ...this.session, token: answer.token, accountId: answer.account.id, handle: answer.account.handle });
  }

  /** A call as the account; a lapsed token is renewed once and the call made again. */
  private async call<T>(method: string, path: string, body?: unknown, renewed = false): Promise<T> {
    try {
      return await callApi<T>(this.session.api, method, path, { token: this.session.token, body, fetcher: this.hooks.fetcher });
    } catch (failure) {
      if (failure instanceof GlyphApiError && failure.status === 401 && !renewed) {
        await this.resume();
        return this.call<T>(method, path, body, true);
      }
      throw failure;
    }
  }

  private async record(item: FeedItem): Promise<NoteRecord | null> {
    if (item.deleted || !item.blob) return null;
    const payload = await open<NotePayload>(await this.accountKey(), item.blob, `note:${item.id}`);
    const record: NoteRecord = { rev: item.rev, note: { ...payload.note, id: item.id } };
    if (payload.recording) record.recording = payload.recording;
    if (payload.images?.length) record.images = payload.images;
    return record;
  }

  /** Everything written since the last pull, opened and kept. */
  async pull(): Promise<{ changed: number }> {
    let changed = 0;
    for (;;) {
      const page = await this.call<{ rev: number; items: FeedItem[]; more: boolean }>('GET', `notes?since=${this.cursor}`);
      for (const item of page.items) {
        const known = this.cache.get(item.id);
        if (known && known.rev === item.rev) continue;
        const record = await this.record(item);
        if (record) this.cache.set(item.id, record);
        else this.cache.delete(item.id);
        changed += 1;
      }
      this.cursor = Math.max(this.cursor, page.rev);
      if (!page.more) break;
    }
    this.pulled = true;
    return { changed };
  }

  /** The account's notes, newest change first; archived ones included when asked. Pulls first if nothing has been. */
  async list({ archived = false }: { archived?: boolean } = {}): Promise<NoteRecord[]> {
    if (!this.pulled) await this.pull();
    return [...this.cache.values()].filter((r) => archived || !r.note.archivedAt).sort((a, b) => b.note.updatedAt - a.note.updatedAt);
  }

  async get(id: string): Promise<NoteRecord | null> {
    if (!this.pulled) await this.pull();
    return this.cache.get(id) ?? null;
  }

  /** The note whose title is `title`, exactly or ignoring case; null when none or several. */
  async byTitle(title: string): Promise<NoteRecord | null> {
    const want = title.trim().toLowerCase();
    const found = (await this.list({ archived: true })).filter((r) => noteTitle(r.note.body).toLowerCase() === want);
    return found.length === 1 ? found[0]! : null;
  }

  /** `record` written to the service from the revision it was read at; the answer is the revision it now has. */
  private async write(record: NoteRecord, base: number): Promise<NoteRecord> {
    const { note } = record;
    const payload: NotePayload = { v: 1, note };
    if (record.recording) payload.recording = record.recording;
    if (record.images?.length) payload.images = record.images;
    const blob = await seal(await this.accountKey(), payload, `note:${note.id}`);
    try {
      const { rev } = await this.call<{ rev: number }>('PUT', `notes/${encodeURIComponent(note.id)}`, { base, blob });
      const written = { ...record, rev };
      this.cache.set(note.id, written);
      return written;
    } catch (failure) {
      if (!(failure instanceof GlyphApiError) || failure.status !== 409 || !failure.body) throw failure;
      // Another device wrote first: theirs is the note now, and it is what the caller reads next.
      const winner = failure.body as FeedItem;
      const theirs = await this.record(winner);
      if (theirs) this.cache.set(note.id, theirs);
      else this.cache.delete(note.id);
      throw new Conflict(note.id, theirs);
    }
  }

  /** A new note of `body`, as the app would make one typed in. */
  async create(body: string, { pinned = false }: { pinned?: boolean } = {}): Promise<NoteRecord> {
    const now = Date.now();
    const note: Note = { id: newId(), body, createdAt: now, updatedAt: now, source: 'editor', starred: pinned, archivedAt: null };
    return this.write({ rev: 0, note }, 0);
  }

  /**
   * `id` changed by `change`, written from the revision last read. The words are the caller's; everything else the
   * note carried - when it was made, its pin, its folder, its recording - stays. A body that changed drops the
   * on-device model's formatted copy, which the app writes again for the new words.
   */
  async edit(id: string, change: (note: Note) => Note): Promise<NoteRecord> {
    const current = await this.get(id);
    if (!current) throw new GlyphApiError(404, `No note ${id}.`);
    const before = current.note;
    const next = change({ ...before });
    const note: Note = { ...before, ...next, id, createdAt: before.createdAt, updatedAt: Math.max(Date.now(), before.updatedAt + 1) };
    if (note.body !== before.body) {
      note.formatted = null;
      note.formattedFor = null;
      note.formattedModel = null;
    }
    const named = new Set(imageNames(note.body));
    const images = (current.images ?? []).filter((name) => named.has(name));
    return this.write({ rev: current.rev, note, recording: current.recording, images }, current.rev);
  }
}
