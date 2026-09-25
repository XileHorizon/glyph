// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { toBase64Url } from '../src/app/core/sync/crypto.ts';
import type { Note } from '../src/app/core/store.ts';
import { fakeService, FAST } from './fake.ts';
import { Conflict, GlyphAccount, GlyphApiError, imageNames, noteTitle, type StoredSession } from './glyph.ts';

/**
 * The client against a sync service stood in for in memory: the same routes, revisions and refusals as
 * server/src/sync.rs and accounts.rs, so every rule the client lives by is tried without a server. The end-to-end
 * test (mcp.e2e.test.ts) tries the same against the real one.
 */

const API = 'https://fake.test/glyph/api';

const aNote = (id: string, body: string): Note => ({ id, body, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000, source: 'capture', starred: false, archivedAt: null });

describe('signing in from outside the app', () => {
  it('derives the password the way the app does and comes away with the account key and a device key', async () => {
    const service = await fakeService('matt', 'correct horse');
    const session = await GlyphAccount.signIn(API, 'matt', 'correct horse', { rounds: FAST, fetcher: service.fetcher });
    expect(session.handle).toBe('matt');
    expect(session.accountId).toBe(7);
    expect(session.token).toMatch(/^tok-/);
    expect(session.deviceKey?.kty).toBe('OKP');
    expect(service.calls).toEqual(['POST login', 'POST device']);
    // The key is the account's: a note another device sealed opens with it.
    await service.deviceWrites(aNote('n1', '# Groceries\n\n- eggs'));
    const account = new GlyphAccount(session, { fetcher: service.fetcher });
    const [note] = await account.list();
    expect(note?.note.body).toBe('# Groceries\n\n- eggs');
    expect(note?.rev).toBe(1);
  });

  it('says so on the wrong password, without leaking which half was wrong', async () => {
    const service = await fakeService('matt', 'correct horse');
    await expect(GlyphAccount.signIn(API, 'matt', 'wrong horse', { rounds: FAST, fetcher: service.fetcher })).rejects.toThrow(GlyphApiError);
  });
});

describe('the session between runs', () => {
  async function signedIn() {
    const service = await fakeService('matt', 'correct horse');
    const session = await GlyphAccount.signIn(API, 'matt', 'correct horse', { rounds: FAST, fetcher: service.fetcher });
    const saved: StoredSession[] = [];
    const account = new GlyphAccount(session, { fetcher: service.fetcher, save: (s) => saved.push(s) });
    return { service, account, saved, session };
  }

  it('renews a lapsed token with its own key, and keeps the new one', async () => {
    const { service, account, saved, session } = await signedIn();
    service.expireAllTokens();
    await account.resume();
    expect(saved).toHaveLength(1);
    expect(saved[0]?.token).not.toBe(session.token);
    expect(service.calls.slice(-3)).toEqual(['POST refresh', 'POST login/challenge', 'POST login/device']);
    // And works: a call with the renewed token.
    expect(await account.list()).toEqual([]);
  });

  it('renews once in the middle of a call, so a long-running server never notices a token lapsing', async () => {
    const { service, account } = await signedIn();
    await service.deviceWrites(aNote('n1', 'Hello'));
    service.expireAllTokens();
    const notes = await account.list();
    expect(notes.map((r) => r.note.body)).toEqual(['Hello']);
  });

  it('asks for the password again when it has no device key', async () => {
    const { service, session } = await signedIn();
    const account = new GlyphAccount({ ...session, deviceKey: null }, { fetcher: service.fetcher });
    service.expireAllTokens();
    await expect(account.list()).rejects.toThrow(/Sign in again/);
  });
});

describe('reading and writing notes', () => {
  async function ready() {
    const service = await fakeService('matt', 'correct horse');
    const session = await GlyphAccount.signIn(API, 'matt', 'correct horse', { rounds: FAST, fetcher: service.fetcher });
    const account = new GlyphAccount(session, { fetcher: service.fetcher });
    return { service, account };
  }

  it('lists what the account holds, newest change first, and follows the feed', async () => {
    const { service, account } = await ready();
    await service.deviceWrites({ ...aNote('a', '# A'), updatedAt: 1 });
    await service.deviceWrites({ ...aNote('b', '# B'), updatedAt: 2 });
    expect((await account.list()).map((r) => noteTitle(r.note.body))).toEqual(['B', 'A']);
    await service.deviceWrites({ ...aNote('a', '# A again'), updatedAt: 3 });
    await account.pull();
    expect((await account.list()).map((r) => noteTitle(r.note.body))).toEqual(['A again', 'B']);
    expect(await account.byTitle('b')).toMatchObject({ note: { id: 'b' } });
  });

  it('makes a note the app can open, and sends it from nothing', async () => {
    const { service, account } = await ready();
    const made = await account.create('# From Claude\n\n- [ ] Book the ferry', { pinned: true });
    expect(made.rev).toBe(1);
    const stored = await service.stored(made.note.id);
    expect(stored?.v).toBe(1);
    expect(stored?.note).toMatchObject({ body: '# From Claude\n\n- [ ] Book the ferry', source: 'editor', starred: true, archivedAt: null });
    expect(stored?.note.createdAt).toBe(stored?.note.updatedAt);
    expect(stored?.recording).toBeUndefined();
    expect(stored?.images).toBeUndefined();
  });

  it('edits from the revision it read, keeping what the note carried', async () => {
    const { service, account } = await ready();
    const rev = await service.deviceWrites({ ...aNote('a', '# Trip\n\nWe leave Friday.'), starred: true, path: 'Inbox/Trip.md', recordingMs: 12_000, formatted: 'old', formattedFor: 3 }, { recording: 'abc123', images: ['sea.jpg', 'gone.png'] });
    const edited = await account.edit('a', (note) => ({ ...note, body: '# Trip\n\nWe leave Friday.\n\n![](image/sea.jpg)' }));
    expect(edited.rev).toBe(rev + 1);
    const stored = await service.stored('a');
    expect(stored?.note).toMatchObject({ body: '# Trip\n\nWe leave Friday.\n\n![](image/sea.jpg)', starred: true, path: 'Inbox/Trip.md', recordingMs: 12_000, formatted: null, formattedFor: null });
    expect(stored?.note.updatedAt).toBeGreaterThan(1_700_000_000_000);
    expect(stored?.note.createdAt).toBe(1_700_000_000_000);
    expect(stored?.recording).toBe('abc123');
    // Only the pictures the body still names go back: nothing is claimed that the body no longer shows.
    expect(stored?.images).toEqual(['sea.jpg']);
  });

  it('never writes over what another device wrote first: the conflict carries their note', async () => {
    const { service, account } = await ready();
    await service.deviceWrites(aNote('a', 'Mine, read at rev 1'));
    await account.list();
    await service.deviceWrites(aNote('a', 'Theirs, at rev 2'));
    const failure = await account.edit('a', (note) => ({ ...note, body: 'Mine, written blind' })).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(Conflict);
    expect((failure as Conflict).theirs?.note.body).toBe('Theirs, at rev 2');
    // The service still has theirs, and the client now reads theirs.
    expect((await service.stored('a'))?.note.body).toBe('Theirs, at rev 2');
    expect((await account.get('a'))?.note.body).toBe('Theirs, at rev 2');
    // Read again, the edit goes through.
    const edited = await account.edit('a', (note) => ({ ...note, body: `${note.body}\n\nAnd mine.` }));
    expect(edited.note.body).toBe('Theirs, at rev 2\n\nAnd mine.');
  });
});

describe('the helpers that mirror the app', () => {
  it('titles a note as the list does, and names its pictures', () => {
    expect(noteTitle('# Weekend trip §§\n\nWords')).toBe('Weekend trip');
    expect(noteTitle('---\ntitle: Front\n---\nBody')).toBe('Front');
    expect(noteTitle('![](image/a.jpg)\nUnder the picture')).toBe('Under the picture');
    expect(imageNames('![a](image/one.jpg) and ![](image/two.png)')).toEqual(['one.jpg', 'two.png']);
    expect(toBase64Url(new Uint8Array([1, 2, 3]))).toBe('AQID');
  });
});
