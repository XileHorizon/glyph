import { useCallback, useEffect, useState } from 'react';
import { answerHost } from './host.ts';
import { invoke, isTauri } from './tauri.ts';
import type { Segment } from '../capture/markdown.ts';

/**
 * Where notes live, and the one door the page uses to reach them.
 *
 * The store is owned by RUST, not by this file, and that is forced rather than
 * chosen: on Android the voice capture runs in its own process with no webview
 * alive, and it has to be able to write a note. A store that lived in the page
 * could not be written to by a process the page is not running in. So the
 * SQLite database is the truth, `src-tauri/src/store.rs` owns it, and this
 * module is a typed remote control.
 *
 * The localStorage half is not a toy. `npm run dev` in a browser is where most
 * of the editor work actually happens - a Vite reload is milliseconds and an
 * Android build is minutes - so the browser has to be a real working app, with
 * the same interface and the same persistence guarantees within its own world.
 * It is never used inside the Tauri webview.
 */

export interface Note {
  id: string;
  body: string;
  /** Milliseconds since the epoch. */
  createdAt: number;
  updatedAt: number;
  /** How the note came to exist: typed in the app, or spoken into a capture. */
  source: NoteSource;
  /**
   * Pinned to the top of the list, by a swipe. Optional because a binary from
   * before native generation 3 answers without it.
   */
  starred?: boolean;
  /** When it was swiped into the archive; absent or null for a note in the list. */
  archivedAt?: number | null;
  /** The kept recording's length, for a spoken note whose tape was kept. Native generation 6. */
  recordingMs?: number | null;
  /** The recording's phrases with their times, only on a note fetched by id; the list answers null. */
  segments?: Segment[] | null;
  /**
   * The on-device model's version of the body (core/ai.ts, format/). Only on a
   * note fetched by id; the list answers null. Native generation 10.
   */
  formatted?: string | null;
  /** The page's hash (format/formatter.ts) of the body `formatted` was written from. */
  formattedFor?: number | null;
  /** The model that wrote it, by its id in core/ai.ts. */
  formattedModel?: string | null;
  /** Where the note's file is in the library, relative to it (`Inbox/AttackFM.md`). Native generation 15; absent before, and in a browser. */
  path?: string;
  /** Monotonic body version used by previewed command compare-and-swap writes. */
  revision?: number;
}

export type NoteSource = 'editor' | 'capture';

/** Newest-updated first, which is the only order the list is ever shown in. */
const byRecency = (a: Note, b: Note): number => b.updatedAt - a.updatedAt;

// --- the browser half -------------------------------------------------------

const WEB_KEY = 'glyph-notes';

function webAll(): Note[] {
  try {
    const raw = localStorage.getItem(WEB_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? (parsed as Array<Omit<Note, 'revision'> & { revision?: number }>).map((note) => ({ ...note, revision: note.revision ?? 1 }))
      : [];
  } catch {
    // A corrupt or unreadable store reads as empty rather than throwing: the
    // browser half exists so development never stops, and a parse error in a
    // dev fixture should not be the thing that stops it.
    return [];
  }
}

function webWrite(notes: Note[]): void {
  try {
    localStorage.setItem(WEB_KEY, JSON.stringify(notes));
  } catch {
    // Private mode, or quota. The note stays correct in memory for this run.
  }
}

// --- the public API ---------------------------------------------------------

/** Sent on `window` after this device changes a note, so sync (core/sync/engine.ts) sends it soon. */
export const NOTE_SAVED = 'glyph:note-saved';

function touched<T>(value: T): T {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(NOTE_SAVED));
  return value;
}

export async function listNotes(): Promise<Note[]> {
  if (isTauri()) return (await invoke<Note[]>('list_notes')).sort(byRecency);
  return webAll().sort(byRecency);
}

export async function getNote(id: string): Promise<Note | null> {
  if (isTauri()) return await invoke<Note | null>('get_note', { id });
  return webAll().find((n) => n.id === id) ?? null;
}

/** Create a genuinely new note. Existing-note writers must use updateNote. */
export async function createNote(id: string, body: string, source: NoteSource = 'editor'): Promise<Note> {
  if (isTauri()) return touched(await invoke<Note>('create_note', { id, body, source }));
  const now = Date.now();
  const notes = webAll();
  if (notes.some((note) => note.id === id)) throw new Error('the note id already exists');
  const note: Note = { id, body, createdAt: now, updatedAt: now, source, revision: 1 };
  webWrite([note, ...notes]);
  return touched(note);
}

/**
 * Update exactly the existing revision the caller read. Missing means deleted,
 * and is deliberately an error rather than an insert: stale autosaves must not
 * resurrect notes.
 */
export async function updateNote(id: string, body: string, expectedRevision: number): Promise<Note> {
  if (isTauri()) return touched(await invoke<Note>('update_note', { id, body, expectedRevision }));
  const now = Date.now();
  const notes = webAll();
  const existing = notes.find((note) => note.id === id);
  if (!existing || (existing.revision ?? 1) !== expectedRevision) throw new Error('the note was deleted or changed');
  const note: Note = { ...existing, body, updatedAt: now, revision: expectedRevision + 1 };
  webWrite(notes.map((candidate) => (candidate.id === id ? note : candidate)));
  return touched(note);
}

export interface CommandMutationRequest {
  mutationId: string;
  noteId: string;
  kind: 'append' | 'create';
  beforeRevision: number | null;
  beforeBody: string | null;
  afterBody: string;
  source: NoteSource;
}

export type CommandMutationResult =
  | { status: 'applied'; mutationId: string; note: Note }
  | { status: 'conflict'; current: Note | null };

export type CommandUndoResult =
  | { status: 'undone'; mutationId: string; note: Note | null }
  | { status: 'conflict'; current: Note | null }
  | { status: 'already-undone' }
  | { status: 'not-found' };

interface WebCommandRecord extends CommandMutationRequest {
  afterRevision: number;
  createdAt: number;
  undone: boolean;
}

export interface PendingCommandUndo {
  mutationId: string;
  noteId: string;
  kind: 'append' | 'create';
  createdAt: number;
}

const WEB_COMMAND_KEY = 'glyph-command-mutations';

function webCommands(): WebCommandRecord[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(WEB_COMMAND_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as WebCommandRecord[]) : [];
  } catch {
    return [];
  }
}

function webWriteCommands(records: WebCommandRecord[]): void {
  try {
    localStorage.setItem(WEB_COMMAND_KEY, JSON.stringify(records));
  } catch {
    // Browser development keeps the applied note even if its undo log cannot persist.
  }
}

/** Apply exactly the body that was previewed, if the previewed revision still exists. */
export async function applyCommandMutation(request: CommandMutationRequest): Promise<CommandMutationResult> {
  if (isTauri()) return touched(await invoke<CommandMutationResult>('apply_command_mutation', { request }));
  const notes = webAll();
  const current = notes.find((note) => note.id === request.noteId) ?? null;
  const matches =
    request.beforeRevision === null
      ? current === null && request.beforeBody === null
      : (current?.revision ?? 1) === request.beforeRevision && current?.body === request.beforeBody;
  if (!matches) return { status: 'conflict', current };
  const now = Date.now();
  const note: Note = current
    ? { ...current, body: request.afterBody, updatedAt: now, revision: (current.revision ?? 1) + 1 }
    : { id: request.noteId, body: request.afterBody, createdAt: now, updatedAt: now, source: request.source, revision: 1 };
  webWrite([note, ...notes.filter((candidate) => candidate.id !== note.id)]);
  webWriteCommands([
    ...webCommands().filter((record) => record.mutationId !== request.mutationId),
    { ...request, afterRevision: note.revision ?? 1, createdAt: now, undone: false },
  ]);
  return touched({ status: 'applied', mutationId: request.mutationId, note });
}

/** Undo only while the command's exact result remains current. */
export async function latestCommandMutation(): Promise<PendingCommandUndo | null> {
  if (isTauri()) return invoke<PendingCommandUndo | null>('latest_command_mutation');
  const cutoff = Date.now() - 10 * 60 * 1_000;
  const notes = webAll();
  const record = webCommands()
    .filter((candidate) => !candidate.undone && candidate.createdAt >= cutoff)
    .sort((a, b) => b.createdAt - a.createdAt)
    .find((candidate) => {
      const note = notes.find((item) => item.id === candidate.noteId);
      return note?.body === candidate.afterBody && (note.revision ?? 1) === candidate.afterRevision;
    });
  return record ? { mutationId: record.mutationId, noteId: record.noteId, kind: record.kind, createdAt: record.createdAt } : null;
}

export async function undoCommandMutation(mutationId: string): Promise<CommandUndoResult> {
  if (isTauri()) return touched(await invoke<CommandUndoResult>('undo_command_mutation', { mutationId }));
  const records = webCommands();
  const record = records.find((candidate) => candidate.mutationId === mutationId);
  if (!record) return { status: 'not-found' };
  if (record.undone) return { status: 'already-undone' };
  const notes = webAll();
  const current = notes.find((note) => note.id === record.noteId) ?? null;
  if (!current || (current.revision ?? 1) !== record.afterRevision || current.body !== record.afterBody) return { status: 'conflict', current };
  let restored: Note | null = null;
  if (record.beforeRevision !== null && record.beforeBody !== null) {
    restored = { ...current, body: record.beforeBody, updatedAt: Date.now(), revision: record.afterRevision + 1 };
    webWrite(notes.map((note) => (note.id === restored?.id ? restored : note)));
  } else {
    webWrite(notes.filter((note) => note.id !== current.id));
  }
  webWriteCommands(records.map((candidate) => (candidate.mutationId === mutationId ? { ...candidate, undone: true } : candidate)));
  return touched({ status: 'undone', mutationId, note: restored });
}

/**
 * Star or unstar a note. Not an edit: the note keeps its place by when it was
 * last written (see store.rs `set_starred`). Answers with the note, or null if
 * it has gone.
 */
export async function setNoteStarred(id: string, starred: boolean): Promise<Note | null> {
  if (isTauri()) return touched(await invoke<Note | null>('set_note_starred', { id, starred }));
  return touched(webFlag(id, { starred }));
}

/** Archive a note or bring it back. Not an edit either. */
export async function setNoteArchived(id: string, archived: boolean): Promise<Note | null> {
  if (isTauri()) return touched(await invoke<Note | null>('set_note_archived', { id, archived }));
  return touched(webFlag(id, { archivedAt: archived ? Date.now() : null }));
}

function webFlag(
  id: string,
  change: Partial<Pick<Note, 'starred' | 'archivedAt' | 'recordingMs' | 'segments' | 'formatted' | 'formattedFor' | 'formattedModel'>>,
): Note | null {
  const notes = webAll();
  const note = notes.find((n) => n.id === id);
  if (!note) return null;
  const next = { ...note, ...change };
  webWrite(notes.map((n) => (n.id === id ? next : n)));
  return next;
}

/**
 * Keep the formatted version of a note (or forget it with null): the text, the
 * hash of the body it came from, and the model that wrote it. Not an edit: the
 * body and its time stand.
 */
export async function setNoteFormatted(id: string, formatted: string | null, formattedFor: number | null, model: string | null): Promise<Note | null> {
  if (isTauri()) return touched(await invoke<Note | null>('set_note_formatted', { id, formatted, formattedFor, model }));
  return touched(webFlag(id, { formatted, formattedFor, formattedModel: model }));
}

/** Keep a spoken note's recording length and phrases (or forget both with null). Not an edit. */
export async function setNoteRecording(id: string, recordingMs: number | null, segments: Segment[]): Promise<Note | null> {
  if (isTauri()) return touched(await invoke<Note | null>('set_note_recording', { id, recordingMs, segments }));
  return touched(webFlag(id, { recordingMs, segments: recordingMs === null ? null : segments }));
}

/**
 * Write a note exactly as another device has it (core/sync/notes.ts): its own
 * times, pin, archive and recording, not now's. Native generation 16; the sync
 * engine checks the generation before it calls. Answers the note as stored.
 */
export async function applyNote(note: Note): Promise<Note> {
  if (isTauri()) return await invoke<Note>('store_apply', { note });
  const notes = webAll();
  webWrite([note, ...notes.filter((n) => n.id !== note.id)]);
  return note;
}

/** Sent on `window` when notes changed without the list's doing - sync wrote some - so the list asks again. */
export const NOTES_CHANGED = 'glyph:notes-changed';

export function announceNotesChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(NOTES_CHANGED));
}

/**
 * The list as the list screen shows it: starred notes first, each group newest
 * edit first, archived notes left out. The archive is the reverse selection,
 * most recently archived first.
 */
export function listOrder(notes: readonly Note[]): Note[] {
  return notes.filter((n) => !n.archivedAt).sort((a, b) => Number(Boolean(b.starred)) - Number(Boolean(a.starred)) || b.updatedAt - a.updatedAt);
}

export function archiveOrder(notes: readonly Note[]): Note[] {
  return notes.filter((n) => n.archivedAt).sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));
}

export async function deleteNote(id: string): Promise<void> {
  if (isTauri()) await invoke<void>('delete_note', { id });
  else webWrite(webAll().filter((n) => n.id !== id));
  touched(null);
}

/**
 * A fresh id.
 *
 * `crypto.randomUUID` needs a secure context, which a Tauri custom protocol is
 * and an `http://` dev server on a phone on the LAN is not - so the fallback is
 * not hypothetical, it is what runs when the editor is opened from another
 * device on the network.
 */
export function newNoteId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** A note's lines with its front matter taken off, and its `title:` first where it has one. */
export function withoutFrontMatter(lines: readonly string[]): string[] {
  if (!/^(---|\+\+\+)\s*$/.test(lines[0] ?? '')) return [...lines];
  for (let n = 1; n < Math.min(lines.length, 40); n += 1) {
    const line = lines[n] ?? '';
    if (/^(---|\+\+\+)\s*$/.test(line)) {
      const named = lines.slice(1, n).find((key) => /^\s*title\s*:/i.test(key));
      const title = named
        ? named
            .replace(/^\s*title\s*:\s*/i, '')
            .replace(/^['"]|['"]$/g, '')
            .trim()
        : '';
      return title ? [title, ...lines.slice(n + 1)] : lines.slice(n + 1);
    }
    if (!/^\s*[\w.-]+\s*:/.test(line) && line.trim() !== '') return [...lines];
  }
  return [...lines];
}

/** The first line of a note, which is the only title Glyph has. */
export function noteTitle(body: string): string {
  // A note that opens with front matter is titled by its words, not by the
  // fence: `---` in the list looked like a note with no name at all
  // (docs/MARKDOWN.md). The keys between the fences are skipped with it, and
  // `title:` among them is taken as the name, which is what wrote it.
  const lines = withoutFrontMatter(body.split('\n'));
  // The first line that is words, not a picture: a note that opens with a
  // photo is titled by what is said under it.
  const line = lines.find((l) => l.trim() && !/^!\[[^\]]*\]\([^)]*\)\s*$/.test(l)) ?? '';
  // Strip leading heading markers for the LIST only. The note itself keeps
  // every character; this is a label, not an edit.
  // The bookmark's mark too (editor/bookmarkLine.ts): set on the first line, it said "Weekend trip §§" in every tab and
  // card. It says where the note opens, not what it is called.
  return line.replace(/^#{1,6}\s+/, '').replace(/\s*§§\s*/g, ' ').trim();
}

// --- the hook the list uses -------------------------------------------------

interface NotesState {
  notes: Note[];
  loading: boolean;
  refresh: () => Promise<void>;
}

/**
 * The notes list, refetched on demand and whenever the app comes back to the
 * front.
 *
 * The visibility listener is what makes voice capture appear without any
 * cross-process plumbing: a note written by the Android capture service while
 * the webview was dead shows up the moment the app is resumed, because the
 * page simply asks again. `MainActivity.onResume` also calls
 * `window.__glyph.refresh()` for the case where the webview was alive but
 * hidden and the browser never fired `visibilitychange`.
 */
/** Retries for the first read of the list, in ms: a store still opening, or an index busy after an install. */
const FIRST_READ_RETRIES_MS = [250, 900, 2400];

export function useNotes(): NotesState {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const next = await listNotes();
    setNotes(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    // The first read is the one that can go wrong: on a phone the store may
    // still be opening, or its index busy right after an install, and a
    // rejection here once left the list a blank page until a relaunch. So a
    // failed first read is tried again a few times, and an empty first answer
    // on the phone is asked once more a moment later, since a library that
    // was there a launch ago is more likely still there than gone.
    let cancelled = false;
    void (async () => {
      for (let attempt = 0; ; attempt += 1) {
        try {
          const next = await listNotes();
          if (cancelled) return;
          setNotes(next);
          setLoading(false);
          if (next.length === 0 && attempt === 0 && isTauri()) {
            // Where the empty answer came from, should it ever be wrong: a page under
            // another origin would be reading the browser store, not the phone's.
            console.info(`[glyph] first read of the notes was empty (tauri ${String(isTauri())}, origin ${location.origin}); asking again`);
            await new Promise((resolve) => setTimeout(resolve, 1200));
            if (!cancelled) await refresh().catch(() => undefined);
          }
          return;
        } catch (error) {
          const wait = FIRST_READ_RETRIES_MS[attempt];
          if (wait === undefined) {
            console.warn(`[glyph] the notes could not be read (tauri ${String(isTauri())}, origin ${location.origin})`, error);
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, wait));
          if (cancelled) return;
        }
      }
    })();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const onChanged = () => void refresh();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener(NOTES_CHANGED, onChanged);
    const unanswer = answerHost('refresh', () => void refresh());
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener(NOTES_CHANGED, onChanged);
      unanswer();
    };
  }, [refresh]);

  return { notes, loading, refresh };
}
