import { ApiError, call, callBytes } from '../account/api.ts';
import { imageNames } from '../images.ts';
import type { Note } from '../store.ts';
import { isSharedLive } from '../live/shared.ts';
import { open, openBytes, seal, sealBytes, type Bytes } from './crypto.ts';

/**
 * Notes kept the same on every device (docs/SYNC.md, "Sync").
 *
 * AttackFM's change feed, run from both ends. The service keeps each note as a sealed blob with a revision; a device
 * keeps, per note, the revision it last saw and a fingerprint of the note as it was then. So a sync is:
 *
 * 1. **Pull** every note written since the cursor. A note unchanged here takes the other device's version; a note
 *    changed on both sides keeps both - this device's copy becomes a new note, and the other device's version takes the
 *    id. Nothing a person typed is ever thrown away. A deletion only removes a note that was not changed here.
 * 2. **Push** every note whose fingerprint moved, written from the revision last seen. A refusal (409) says what won,
 *    which is merged exactly as a pulled note is, and the push is tried again.
 *
 * A note's recording and pictures travel beside it as sealed files: the note says which (by hash, for a recording,
 * which can be taken again; by name, for a picture, whose name is never reused), and a device fetches what it lacks.
 */

// --- what this module is given ---------------------------------------------------------

/** This device's notes. The app's store, or a map in the tests. */
export interface LocalNotes {
  list(): Promise<Note[]>;
  get(id: string): Promise<Note | null>;
  apply(note: Note): Promise<Note>;
  remove(id: string): Promise<void>;
}

export type FileKind = 'recording' | 'image';

/** This device's recordings (by note id) and pictures (by name). */
export interface LocalFiles {
  read(kind: FileKind, name: string): Promise<Bytes | null>;
  write(kind: FileKind, name: string, bytes: Bytes): Promise<void>;
}

export interface SyncContext {
  token: string;
  key: CryptoKey;
  notes: LocalNotes;
  files: LocalFiles;
  state: SyncState;
  /** Called after each page of the feed and each push, so an interrupted sync resumes where it stopped. */
  save(state: SyncState): void;
  fetcher?: typeof fetch;
}

// --- what a device remembers -----------------------------------------------------------

export interface SyncState {
  /** The last revision of the account's feed this device has read. */
  cursor: number;
  /** Per note: the revision last seen, and the note's fingerprint then. */
  notes: Record<string, { rev: number; mark: string }>;
  /** Per synced file: its revision, and for a recording the hash of what it held. */
  files: Record<string, { rev: number; sha?: string }>;
}

export function emptyState(): SyncState {
  return { cursor: 0, notes: {}, files: {} };
}

// --- what travels ----------------------------------------------------------------------

/** A note as it is sealed: the note, and the files it needs. */
export interface NotePayload {
  v: 1;
  note: Note;
  recording?: string;
  images?: string[];
}

interface FeedItem {
  id: string;
  rev: number;
  deleted: boolean;
  blob: string | null;
}

/**
 * What a note is, for telling whether it changed: everything a list read carries. A recording's phrases and the
 * formatted text are not in a list read, and move with `recordingMs` and `formattedFor`, which are.
 */
export function mark(note: Note): string {
  return JSON.stringify([
    note.body,
    note.createdAt,
    note.updatedAt,
    note.source,
    Boolean(note.starred),
    note.archivedAt ?? null,
    note.recordingMs ?? null,
    note.formattedFor ?? null,
    note.formattedModel ?? null,
    note.path ?? null,
  ]);
}

/** The service's name for a file: `r-<note id>` for a recording, `i-<ext>-<stem>` for a picture. */
export function fileId(kind: FileKind, name: string): string | null {
  if (kind === 'recording') return /^[A-Za-z0-9_-]{1,62}$/.test(name) ? `r-${name}` : null;
  const match = /^([A-Za-z0-9_-]+)\.([A-Za-z]+)$/.exec(name);
  if (!match) return null;
  const id = `i-${match[2]!.toLowerCase()}-${match[1]!}`;
  return id.length <= 64 ? id : null;
}

export async function sha(bytes: Bytes): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}

function blank(note: Note): boolean {
  return !note.body.trim() && !note.starred && !note.archivedAt && !note.recordingMs;
}

// --- files -----------------------------------------------------------------------------

async function sendFile(ctx: SyncContext, kind: FileKind, name: string, bytes: Bytes, digest?: string): Promise<void> {
  const id = fileId(kind, name);
  if (!id) return;
  const known = ctx.state.files[id];
  const sealed = await sealBytes(ctx.key, bytes, `file:${id}`);
  const put = (base: number) => call<{ rev: number }>('PUT', `recordings/${id}?base=${base}`, { token: ctx.token, bytes: sealed, fetcher: ctx.fetcher, timeoutMs: 300_000 });
  let rev: number;
  try {
    rev = (await put(known?.rev ?? 0)).rev;
  } catch (failure) {
    if (!(failure instanceof ApiError) || failure.status !== 409) throw failure;
    // A picture's name is never reused, so one already there is this one. A recording taken again on two devices:
    // the note that carries it decides which is meant, and this device's note is the one being sent.
    const winner = (failure.body as { rev?: number } | null)?.rev ?? 0;
    if (kind === 'image') {
      ctx.state.files[id] = { rev: winner };
      return;
    }
    rev = (await put(winner)).rev;
  }
  ctx.state.files[id] = digest ? { rev, sha: digest } : { rev };
}

async function fetchFile(ctx: SyncContext, kind: FileKind, name: string, digest?: string): Promise<void> {
  const id = fileId(kind, name);
  if (!id) return;
  try {
    const { bytes, rev } = await callBytes('GET', `recordings/${id}`, { token: ctx.token, fetcher: ctx.fetcher, timeoutMs: 300_000 });
    await ctx.files.write(kind, name, await openBytes(ctx.key, bytes, `file:${id}`));
    ctx.state.files[id] = digest ? { rev, sha: digest } : { rev };
  } catch (failure) {
    // Not there yet (the other device is still sending it): the next sync asks again.
    if (failure instanceof ApiError && failure.status === 404) return;
    throw failure;
  }
}

/** What a note needs sent before it: its recording and pictures, where the service lacks them. */
async function sendFilesOf(ctx: SyncContext, note: Note): Promise<Pick<NotePayload, 'recording' | 'images'>> {
  const out: Pick<NotePayload, 'recording' | 'images'> = {};
  if (note.recordingMs) {
    const bytes = await ctx.files.read('recording', note.id);
    if (bytes) {
      const digest = await sha(bytes);
      out.recording = digest;
      const id = fileId('recording', note.id);
      if (id && ctx.state.files[id]?.sha !== digest) await sendFile(ctx, 'recording', note.id, bytes, digest);
    }
  }
  const images = imageNames(note.body);
  if (images.length) {
    out.images = images;
    for (const name of images) {
      const id = fileId('image', name);
      if (!id || ctx.state.files[id]) continue;
      const bytes = await ctx.files.read('image', name);
      if (bytes) await sendFile(ctx, 'image', name, bytes);
    }
  }
  return out;
}

/** What a note from another device needs fetched: its recording and pictures, where this device lacks them. */
async function fetchFilesOf(ctx: SyncContext, payload: NotePayload): Promise<void> {
  if (payload.recording) {
    const id = fileId('recording', payload.note.id);
    if (id && ctx.state.files[id]?.sha !== payload.recording) await fetchFile(ctx, 'recording', payload.note.id, payload.recording);
  }
  for (const name of payload.images ?? []) {
    const id = fileId('image', name);
    if (!id || ctx.state.files[id]) continue;
    if (await ctx.files.read('image', name)) {
      ctx.state.files[id] = { rev: 0 };
      continue;
    }
    await fetchFile(ctx, 'image', name);
  }
}

// --- merging one note ------------------------------------------------------------------

export interface Outcome {
  /** Notes written, removed or copied on this device. */
  changed: number;
  /** Notes kept twice because both sides changed them. */
  conflicts: number;
}

/** A new id for this device's side of a conflict. */
function copyId(): string {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * One note from the service, merged into this device. `local` is the note here as the list has it, or undefined
 * when there is none. A note left differing from its recorded fingerprint is sent by the push that follows.
 */
async function merge(ctx: SyncContext, item: FeedItem, local: Note | undefined, outcome: Outcome): Promise<void> {
  const known = ctx.state.notes[item.id];
  const changedHere = local ? !known || known.mark !== mark(local) : Boolean(known);

  if (item.deleted || !item.blob) {
    if (local && changedHere) {
      // Deleted there, changed here: this device's words stand, and are sent again from the deletion's revision.
      ctx.state.notes[item.id] = { rev: item.rev, mark: '' };
      return;
    }
    if (local) {
      await ctx.notes.remove(item.id);
      outcome.changed += 1;
    }
    delete ctx.state.notes[item.id];
    return;
  }

  const payload = await open<NotePayload>(ctx.key, item.blob, `note:${item.id}`);
  const theirs: Note = { ...payload.note, id: item.id };
  // Only the words are worth keeping twice: a pin, the archive or a folder changed on both sides takes theirs.
  if (local && changedHere && local.body !== theirs.body) {
    // Changed on both sides and not the same: this device's version is kept as a note of its own.
    const full = (await ctx.notes.get(item.id)) ?? local;
    // The recording is filed under the note's id, which the other version keeps; the copy is the words.
    await ctx.notes.apply({ ...full, id: copyId(), path: undefined, recordingMs: null, segments: null });
    outcome.conflicts += 1;
    outcome.changed += 1;
  }
  await fetchFilesOf(ctx, payload);
  const applied = local && mark(local) === mark(theirs) ? local : await ctx.notes.apply(theirs);
  if (applied !== local) outcome.changed += 1;
  ctx.state.notes[item.id] = { rev: item.rev, mark: mark(applied) };
}

// --- the two halves --------------------------------------------------------------------

async function pull(ctx: SyncContext, outcome: Outcome): Promise<void> {
  for (;;) {
    const page = await call<{ rev: number; items: FeedItem[]; more: boolean }>('GET', `notes?since=${ctx.state.cursor}`, {
      token: ctx.token,
      fetcher: ctx.fetcher,
    });
    if (page.items.length) {
      const here = new Map((await ctx.notes.list()).map((note) => [note.id, note]));
      for (const item of page.items) {
        // A revision already seen is this device's own write coming back.
        if (ctx.state.notes[item.id]?.rev === item.rev) continue;
        // Live with another device right now: its words are arriving a keystroke at a time already, and a merge made
        // mid-sentence would take the few characters still in flight for a conflict. Its revision stays unrecorded, so
        // once the session ends the push meets it as a 409 and finds the same words (docs/LIVE.md).
        if (isSharedLive(item.id)) continue;
        await merge(ctx, item, here.get(item.id), outcome);
      }
    }
    ctx.state.cursor = Math.max(ctx.state.cursor, page.rev);
    ctx.save(ctx.state);
    if (!page.more) return;
  }
}

/** Writes one note (or its deletion), merging and trying once more if another device got there first. */
async function send(ctx: SyncContext, id: string, note: Note | null, outcome: Outcome, retry = true): Promise<void> {
  const known = ctx.state.notes[id];
  try {
    if (note) {
      const full = (await ctx.notes.get(id)) ?? note;
      const payload: NotePayload = { v: 1, note: full, ...(await sendFilesOf(ctx, full)) };
      const blob = await seal(ctx.key, payload, `note:${id}`);
      const { rev } = await call<{ rev: number }>('PUT', `notes/${encodeURIComponent(id)}`, {
        token: ctx.token,
        fetcher: ctx.fetcher,
        body: { base: known?.rev ?? 0, blob },
      });
      ctx.state.notes[id] = { rev, mark: mark(note) };
    } else {
      await call('DELETE', `notes/${encodeURIComponent(id)}`, { token: ctx.token, fetcher: ctx.fetcher, body: { base: known?.rev ?? 0 } });
      delete ctx.state.notes[id];
    }
  } catch (failure) {
    if (!(failure instanceof ApiError) || failure.status !== 409 || !failure.body) throw failure;
    const winner = failure.body as FeedItem;
    const local = note ? ((await ctx.notes.list()).find((n) => n.id === id) ?? undefined) : undefined;
    await merge(ctx, winner, local, outcome);
    if (!retry) return;
    const now = (await ctx.notes.list()).find((n) => n.id === id) ?? null;
    const after = ctx.state.notes[id];
    const stillMine = now ? !after || after.mark !== mark(now) : Boolean(after) && !winner.deleted;
    if (stillMine) await send(ctx, id, now, outcome, false);
  }
  ctx.save(ctx.state);
}

async function push(ctx: SyncContext, outcome: Outcome): Promise<void> {
  const here = await ctx.notes.list();
  const present = new Set<string>();
  for (const note of here) {
    present.add(note.id);
    const known = ctx.state.notes[note.id];
    if (known && known.mark === mark(note)) continue;
    // Live with another device: sent once the session ends, when both hold the same words (docs/LIVE.md).
    if (isSharedLive(note.id)) continue;
    // A note opened and left empty is not a note yet: it is sent once it has words.
    if (!known && blank(note)) continue;
    await send(ctx, note.id, note, outcome);
  }
  for (const id of Object.keys(ctx.state.notes)) {
    if (!present.has(id)) await send(ctx, id, null, outcome);
  }
}

/** One whole sync of the notes: what changed elsewhere first, then what changed here. */
export async function syncNotes(ctx: SyncContext): Promise<Outcome> {
  const outcome: Outcome = { changed: 0, conflicts: 0 };
  await pull(ctx, outcome);
  await push(ctx, outcome);
  return outcome;
}
