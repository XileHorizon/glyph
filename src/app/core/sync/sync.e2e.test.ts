import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { accountState, changePassword, recover, signIn, signUp, type Deps } from '../account/account.ts';
import { memoryKeys } from '../account/keystore.ts';
import { DEFAULT_PREFERENCES, type Preferences } from '../preferences.ts';
import type { Note } from '../store.ts';
import type { Bytes } from './crypto.ts';
import { emptyState, syncNotes, type FileKind, type LocalFiles, type LocalNotes, type SyncContext } from './notes.ts';
import { syncPrefs, type PrefsContext } from './prefs.ts';

/**
 * Two devices and one account, against a real glyph-api (server/): run with
 *
 *   GLYPH_SYNC_E2E=<the server's data folder> VITE_GLYPH_API=http://127.0.0.1:<port>/glyph/api npx vitest run sync.e2e
 *
 * Skipped otherwise. Every run makes a fresh account.
 */

const DATA = process.env.GLYPH_SYNC_E2E;
const FAST = 1_000;

interface Device {
  deps: Deps;
  notes: Map<string, Note>;
  files: Map<string, Bytes>;
  ctx: () => Promise<SyncContext>;
  prefs: Preferences;
  prefsCtx: () => Promise<PrefsContext>;
  token: string;
}

function device(): Device {
  const notes = new Map<string, Note>();
  const files = new Map<string, Bytes>();
  const deps: Deps = { keys: memoryKeys(), rounds: FAST };
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
  const localFiles: LocalFiles = {
    read: async (kind: FileKind, name: string) => files.get(`${kind}/${name}`) ?? null,
    write: async (kind: FileKind, name: string, bytes: Bytes) => {
      files.set(`${kind}/${name}`, bytes);
    },
  };
  let state = emptyState();
  let prefsState = { rev: 0, seen: null as string | null };
  const d: Device = {
    deps,
    notes,
    files,
    token: '',
    prefs: { ...DEFAULT_PREFERENCES },
    ctx: async () => ({
      token: d.token,
      key: (await deps.keys.accountKey())!,
      notes: local,
      files: localFiles,
      state,
      save: (next) => {
        state = JSON.parse(JSON.stringify(next)) as typeof state;
      },
    }),
    prefsCtx: async () => ({
      token: d.token,
      key: (await deps.keys.accountKey())!,
      read: () => d.prefs,
      write: (next) => {
        d.prefs = { ...d.prefs, ...next };
      },
      state: prefsState,
      save: (next) => {
        prefsState = next;
      },
    }),
  };
  return d;
}

let clock = Date.parse('2026-09-16T10:00:00Z');
function note(id: string, body: string, extra: Partial<Note> = {}): Note {
  clock += 1000;
  return { id, body, createdAt: clock, updatedAt: clock, source: 'editor', starred: false, archivedAt: null, ...extra };
}

function edit(d: Device, id: string, body: string): void {
  clock += 1000;
  d.notes.set(id, { ...d.notes.get(id)!, body, updatedAt: clock });
}

function bodies(d: Device): string[] {
  return [...d.notes.values()].map((n) => n.body).filter(Boolean).sort();
}

const sync = async (d: Device) => syncNotes(await d.ctx());

describe.skipIf(!DATA)('sync between two devices', () => {
  const handle = `t${Date.now().toString(36)}`;
  const phone = device();
  const desk = device();

  it('signs up on one device and in on the other, with the same account key', async () => {
    const { codes } = await signUp(handle, 'correct horse', phone.deps);
    expect(codes).toHaveLength(8);
    phone.token = accountState().session!.token;
    await signIn(handle, 'correct horse', desk.deps);
    desk.token = accountState().session!.token;
    expect(accountState().unlocked).toBe(true);
    await expect(signIn(handle, 'wrong horse', device().deps)).rejects.toThrow();
  });

  it('carries notes, their recording and their pictures across', async () => {
    const audio = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);
    const picture = new Uint8Array([0xff, 0xd8, 0xff, 9, 9]);
    phone.notes.set('n1', note('n1', '# Weekend trip\n\nThe deposit is four hundred.\n\n![](image/pic-1.jpg)\n', { recordingMs: 1200, segments: [{ text: 'hi', startMs: 0, endMs: 5 }], starred: true }));
    phone.notes.set('n2', note('n2', '# Groceries\n\n- [ ] milk\n'));
    phone.notes.set('blank', note('blank', ''));
    phone.files.set('recording/n1', audio);
    phone.files.set('image/pic-1.jpg', picture);

    expect(await sync(phone)).toEqual({ changed: 0, conflicts: 0 });
    const got = await sync(desk);
    expect(got.changed).toBe(2);
    expect(desk.notes.get('n1')).toEqual(phone.notes.get('n1'));
    expect(desk.notes.get('n2')).toEqual(phone.notes.get('n2'));
    expect(desk.notes.has('blank')).toBe(false);
    expect(desk.files.get('recording/n1')).toEqual(audio);
    expect(desk.files.get('image/pic-1.jpg')).toEqual(picture);

    // Nothing more to do on either side.
    expect(await sync(phone)).toEqual({ changed: 0, conflicts: 0 });
    expect(await sync(desk)).toEqual({ changed: 0, conflicts: 0 });
  });

  it('never gives the service the words', () => {
    const files = readdirSync(DATA!).filter((f) => f.startsWith('glyph-accounts.sqlite3'));
    const bytes = files.map((f) => readFileSync(join(DATA!, f)).toString('latin1')).join('');
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes).not.toContain('deposit');
    expect(bytes).not.toContain('Groceries');
  });

  it('carries an edit one way and a deletion the other', async () => {
    edit(desk, 'n1', '# Weekend trip\n\nThe deposit is five hundred.\n');
    desk.notes.delete('n2');
    await sync(desk);
    const got = await sync(phone);
    expect(got.changed).toBe(2);
    expect(phone.notes.get('n1')!.body).toContain('five hundred');
    expect(phone.notes.has('n2')).toBe(false);
  });

  it('keeps both versions of a note changed on both devices, on both devices', async () => {
    edit(phone, 'n1', '# Weekend trip\n\nphone words\n');
    edit(desk, 'n1', '# Weekend trip\n\ndesk words\n');
    await sync(phone);
    const got = await sync(desk);
    expect(got.conflicts).toBe(1);
    await sync(phone);
    expect(bodies(desk)).toEqual(bodies(phone));
    expect(bodies(phone)).toEqual(['# Weekend trip\n\ndesk words\n', '# Weekend trip\n\nphone words\n']);
    expect(phone.notes.get('n1')!.body).toContain('phone words');
  });

  it('brings back a note deleted on one device and edited on the other', async () => {
    phone.notes.set('n3', note('n3', '# Ideas\n'));
    await sync(phone);
    await sync(desk);
    phone.notes.delete('n3');
    await sync(phone);
    edit(desk, 'n3', '# Ideas\n\nstill wanted\n');
    await sync(desk);
    expect(desk.notes.get('n3')!.body).toContain('still wanted');
    await sync(phone);
    expect(phone.notes.get('n3')!.body).toContain('still wanted');
  });

  it("takes the other device's pin when only the pin and archive differ", async () => {
    phone.notes.set('n5', note('n5', '# Pinned\n'));
    await sync(phone);
    await sync(desk);
    phone.notes.set('n5', { ...phone.notes.get('n5')!, starred: true });
    desk.notes.set('n5', { ...desk.notes.get('n5')!, archivedAt: clock });
    await sync(phone);
    expect((await sync(desk)).conflicts).toBe(0);
    await sync(phone);
    expect(desk.notes.get('n5')).toEqual(phone.notes.get('n5'));
    expect(phone.notes.get('n5')!.starred).toBe(true);
  });

  it('settles two devices syncing the same note at once', async () => {
    phone.notes.set('n4', note('n4', '# Race\n'));
    await sync(phone);
    await sync(desk);
    edit(phone, 'n4', '# Race\n\nphone\n');
    edit(desk, 'n4', '# Race\n\ndesk\n');
    // Both pull before either pushes, so one push is refused, merged, and its words kept as a copy.
    const [a, b] = await Promise.all([sync(phone), sync(desk)]);
    const [c, d] = [await sync(phone), await sync(desk)];
    await sync(phone);
    expect(a.conflicts + b.conflicts + c.conflicts + d.conflicts).toBe(1);
    expect(bodies(phone)).toEqual(bodies(desk));
    expect(bodies(phone).filter((body) => body.startsWith('# Race'))).toEqual(['# Race\n\ndesk\n', '# Race\n\nphone\n']);
  });

  it('carries settings, but not the ones that belong to the device', async () => {
    phone.prefs = { ...phone.prefs, theme: 'light', typeface: 'plex', localOnly: true, formatModel: 'other' };
    await syncPrefs(await phone.prefsCtx());
    const took = await syncPrefs(await desk.prefsCtx());
    expect(took).toBe(true);
    expect(desk.prefs.theme).toBe('light');
    expect(desk.prefs.typeface).toBe('plex');
    expect(desk.prefs.localOnly).toBe(false);
    expect(desk.prefs.formatModel).toBe(DEFAULT_PREFERENCES.formatModel);
    // A change on the desk goes back.
    desk.prefs = { ...desk.prefs, density: 'compact' };
    await syncPrefs(await desk.prefsCtx());
    await syncPrefs(await phone.prefsCtx());
    expect(phone.prefs.density).toBe('compact');
  });

  it('changes the password, and recovers with a code into a new one', async () => {
    const laptop = device();
    const { codes } = await signUp(`${handle}r`, 'first password', laptop.deps);
    await changePassword('first password', 'second password', laptop.deps);
    await expect(changePassword('first password', 'third password', laptop.deps)).rejects.toThrow();
    const lost = device();
    await expect(signIn(`${handle}r`, 'first password', lost.deps)).rejects.toThrow();
    const fresh = await recover(`${handle}r`, codes[0]!.toLowerCase(), 'fourth password', lost.deps);
    expect(fresh.codes).toHaveLength(8);
    // The same account key: what the laptop seals, the recovered device opens.
    const { seal, open } = await import('./crypto.ts');
    const sealed = await seal((await laptop.deps.keys.accountKey())!, 'hello', 'prefs');
    expect(await open((await lost.deps.keys.accountKey())!, sealed, 'prefs')).toBe('hello');
    // The old sheet is gone with the recovery.
    await expect(recover(`${handle}r`, codes[1]!, 'fifth password', device().deps)).rejects.toThrow();
    await signIn(`${handle}r`, 'fourth password', device().deps);
  });
});
