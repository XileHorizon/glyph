import { useSyncExternalStore } from 'react';
import { onPreferences, preferences, setPreferences } from './preferences.ts';
import { fileNoteInFolder, fileNotesInFolder } from './noteFolders.ts';

/**
 * Workspaces: a name a note can be filed under, and the list shown one
 * workspace at a time.
 *
 * Matt: "add workspaces so we can sort notes by a given workspace". A
 * workspace is only a name; a note is in at most one, or in none. The list
 * has a row of them above the notes once one exists (notes/WorkspaceBar.tsx),
 * "All" first, and the chosen one is remembered, so the app opens where it
 * was left. A note is filed from its cog (editor/WorkspacePicker.tsx), and a
 * note made while a workspace is chosen is filed there, because that is the
 * list the person is looking at. Removing a workspace unfiles its notes and
 * deletes nothing.
 *
 * Kept on the page under one key, so it ships over the air: the note store is
 * Rust's (core/store.ts), and a column there is a native change. The archive
 * is not filtered: it is the place to find anything.
 */

/**
 * The hues a workspace can wear (Matt: "add the ability to choose from a swatch of colours for the workspace pill
 * colour"). A name, not a colour: what each one looks like is the page's (ink.css `[data-hue]`), tuned for the paper
 * it is read on, so the swatch can be retuned without touching anybody's workspaces. `ink` is the app's own colour,
 * and what a workspace with no hue wears.
 */
export const WORKSPACE_HUES = ['ink', 'ember', 'amber', 'moss', 'sea', 'violet', 'rose'] as const;
export type WorkspaceHue = (typeof WORKSPACE_HUES)[number];

export function isHue(value: unknown): value is WorkspaceHue {
  return typeof value === 'string' && (WORKSPACE_HUES as readonly string[]).includes(value);
}

export interface Workspace {
  id: string;
  name: string;
  /** Its colour, worn by its pill and its tag on a note. Absent is `ink`, the app's own. */
  hue?: WorkspaceHue;
}

export interface Workspaces {
  /** Every workspace, in the order they were made. */
  list: readonly Workspace[];
  /** Which workspace each filed note is in, by note id. */
  of: Readonly<Record<string, string>>;
  /** The list's filter: the chosen workspace, or null for all notes. */
  current: Workspace | null;
}

interface Sheet {
  list: Workspace[];
  notes: Record<string, string>;
  current: string | null;
}

/**
 * Where a workspace lives.
 *
 * The workspaces themselves, and which note is filed in each, are a preference (core/preferences.ts `workspaces`), so
 * they travel with the rest of a person's settings to their other devices (Matt: "I'm not seeing the workspaces being
 * in sync"). The one thing that stays on the device is which workspace the list is filtered by: that is where you are
 * looking, not what you have, and a phone filtered to Home should not filter the desktop too.
 *
 * `KEY` is where all three used to live, and is read once to carry an existing set of workspaces into the preferences.
 */
const KEY = 'glyph-workspaces';
const HERE = 'glyph-workspace-current';
const listeners = new Set<() => void>();
let sheet: Sheet | null = null;
let snapshot: Workspaces | null = null;

/** The workspaces as the preferences hold them, with a hue this build does not know read as ink. */
function fromPrefs(): { list: Workspace[]; notes: Record<string, string> } {
  const held = preferences().workspaces;
  const list = held.list.map((w) => (isHue(w.hue) && w.hue !== 'ink' ? { id: w.id, name: w.name, hue: w.hue } : { id: w.id, name: w.name }));
  const ids = new Set(list.map((w) => w.id));
  const notes: Record<string, string> = {};
  for (const [note, id] of Object.entries(held.notes)) if (ids.has(id)) notes[note] = id;
  return { list, notes };
}

/** The set kept under the old key, for a device that has not moved its workspaces into the preferences yet. */
function fromOldKey(): { list: Workspace[]; notes: Record<string, string>; current: string | null } | null {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Sheet> | null;
    if (!value || !Array.isArray(value.list) || !value.list.length) return null;
    const list = value.list
      .filter((w): w is Workspace => Boolean(w) && typeof w.id === 'string' && typeof w.name === 'string')
      .map((w) => (isHue(w.hue) && w.hue !== 'ink' ? { id: w.id, name: w.name, hue: w.hue } : { id: w.id, name: w.name }));
    const ids = new Set(list.map((w) => w.id));
    const notes: Record<string, string> = {};
    if (value.notes && typeof value.notes === 'object') {
      for (const [note, id] of Object.entries(value.notes)) if (typeof id === 'string' && ids.has(id)) notes[note] = id;
    }
    return { list, notes, current: typeof value.current === 'string' && ids.has(value.current) ? value.current : null };
  } catch {
    return null;
  }
}

function read(): Sheet {
  const held = fromPrefs();
  // Workspaces made before they travelled: taken into the preferences once, and the old key left where it is.
  const old = held.list.length ? null : fromOldKey();
  if (old) {
    setPreferences({ workspaces: { list: old.list, notes: old.notes } });
    if (old.current) {
      try {
        localStorage.setItem(HERE, old.current);
      } catch {
        // No storage: the filter holds for this run.
      }
    }
    return { list: old.list, notes: old.notes, current: old.current };
  }
  const here = (() => {
    try {
      return localStorage.getItem(HERE);
    } catch {
      return null;
    }
  })();
  const ids = new Set(held.list.map((w) => w.id));
  return { list: held.list, notes: held.notes, current: here && ids.has(here) ? here : null };
}

function current(): Sheet {
  if (!sheet) sheet = read();
  return sheet;
}

function write(next: Sheet): void {
  sheet = next;
  snapshot = null;
  // The workspaces travel; the filter stays here.
  ours = true;
  setPreferences({ workspaces: { list: next.list, notes: next.notes } });
  ours = false;
  try {
    if (next.current) localStorage.setItem(HERE, next.current);
    else localStorage.removeItem(HERE);
  } catch {
    // No storage: the change holds for this run.
  }
  listeners.forEach((listener) => listener());
}

/**
 * A workspace made on another device arrives as a change to the preferences (core/sync/prefs.ts), so the sheet is
 * read again and everything watching it hears about it. `ours` keeps a write of our own from bouncing back.
 */
let ours = false;
onPreferences(() => {
  if (ours) return;
  const held = preferences().workspaces;
  const now = sheet;
  if (now && JSON.stringify(held.list) === JSON.stringify(now.list) && JSON.stringify(held.notes) === JSON.stringify(now.notes)) return;
  sheet = null;
  snapshot = null;
  listeners.forEach((listener) => listener());
});

/** Reads the sheet again: after a reset, and in tests. */
export function reloadWorkspaces(): void {
  sheet = null;
  snapshot = null;
  listeners.forEach((listener) => listener());
}

export function workspaces(): Workspaces {
  if (!snapshot) {
    const { list, notes, current: chosen } = current();
    snapshot = { list, of: notes, current: list.find((w) => w.id === chosen) ?? null };
  }
  return snapshot;
}

export function onWorkspaces(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useWorkspaces(): Workspaces {
  return useSyncExternalStore(onWorkspaces, workspaces, workspaces);
}

/** The workspace `noteId` is filed in, or null. */
export function workspaceOf(noteId: string): Workspace | null {
  const { list, notes } = current();
  const id = notes[noteId];
  return id ? (list.find((w) => w.id === id) ?? null) : null;
}

const tidy = (name: string) => name.replace(/\s+/g, ' ').trim();

function freshId(taken: readonly Workspace[]): string {
  for (;;) {
    const id = `w-${Math.random().toString(36).slice(2, 8)}`;
    if (!taken.some((w) => w.id === id)) return id;
  }
}

/** A new workspace called `name`, in `hue`, or the one already called that; null for an empty name. */
export function addWorkspace(name: string, hue: WorkspaceHue = 'ink'): Workspace | null {
  const clean = tidy(name);
  if (!clean) return null;
  const { list, notes, current: chosen } = current();
  const had = list.find((w) => w.name.toLowerCase() === clean.toLowerCase());
  if (had) return had;
  const made: Workspace = hue === 'ink' ? { id: freshId(list), name: clean } : { id: freshId(list), name: clean, hue };
  write({ list: [...list, made], notes, current: chosen });
  return made;
}

/** That workspace in `hue`; `ink` takes its colour off again. Unknown workspace, or unknown hue: nothing happens. */
export function setWorkspaceHue(id: string, hue: WorkspaceHue): void {
  const { list, notes, current: chosen } = current();
  if (!isHue(hue) || !list.some((w) => w.id === id)) return;
  write({
    list: list.map((w) => (w.id === id ? (hue === 'ink' ? { id: w.id, name: w.name } : { ...w, hue }) : w)),
    notes,
    current: chosen,
  });
}

export function renameWorkspace(id: string, name: string): void {
  const clean = tidy(name);
  const { list, notes, current: chosen } = current();
  if (!clean || !list.some((w) => w.id === id)) return;
  write({ list: list.map((w) => (w.id === id ? { ...w, name: clean } : w)), notes, current: chosen });
  // The folder is named after the workspace, so renaming one moves its notes into a folder of the new name.
  void fileNotesInFolder(
    Object.entries(notes)
      .filter(([, where]) => where === id)
      .map(([note]) => note),
    clean,
  );
}

/** Removes the workspace; its notes are simply not filed any more, and the list shows all notes if it was chosen. */
export function removeWorkspace(id: string): void {
  const { list, notes, current: chosen } = current();
  // Its notes are not filed any more, so their files go back to the inbox.
  void fileNotesInFolder(
    Object.entries(notes)
      .filter(([, where]) => where === id)
      .map(([note]) => note),
    null,
  );
  if (!list.some((w) => w.id === id)) return;
  const kept: Record<string, string> = {};
  for (const [note, where] of Object.entries(notes)) if (where !== id) kept[note] = where;
  write({ list: list.filter((w) => w.id !== id), notes: kept, current: chosen === id ? null : chosen });
}

/**
 * Files `noteId` in a workspace, or in none with null.
 *
 * The note's FILE follows its filing: into `workspaces/<the workspace>/`, or back to `Inbox/` when it is taken out
 * of one (core/noteFolders.ts). The move is asked for and not waited on: the pill changes now, and the file catches
 * up when the library answers.
 */
export function fileNote(noteId: string, id: string | null): void {
  const { list, notes, current: chosen } = current();
  if (id !== null && !list.some((w) => w.id === id)) return;
  if ((notes[noteId] ?? null) === id) return;
  const next = { ...notes };
  if (id === null) delete next[noteId];
  else next[noteId] = id;
  write({ list, notes: next, current: chosen });
  void fileNoteInFolder(noteId, id === null ? null : (list.find((w) => w.id === id)?.name ?? null));
}

/** A note just made: filed in the chosen workspace, if there is one and the note is not filed yet. */
export function fileNewNote(noteId: string): void {
  const { notes, current: chosen } = current();
  if (chosen && !(noteId in notes)) fileNote(noteId, chosen);
}

/** The note is gone: so is its filing. */
export function forgetNote(noteId: string): void {
  const { list, notes, current: chosen } = current();
  if (!(noteId in notes)) return;
  const next = { ...notes };
  delete next[noteId];
  write({ list, notes: next, current: chosen });
}

/** The list's filter. */
export function chooseWorkspace(id: string | null): void {
  const { list, notes, current: chosen } = current();
  const next = id !== null && list.some((w) => w.id === id) ? id : null;
  if (next === chosen) return;
  write({ list, notes, current: next });
}

/** Of `notes`, those filed in workspace `id`; all of them for null. */
export function inWorkspace<T extends { id: string }>(notes: readonly T[], id: string | null): T[] {
  if (id === null) return [...notes];
  const { notes: filed } = current();
  return notes.filter((note) => filed[note.id] === id);
}
