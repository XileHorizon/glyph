import { useSyncExternalStore } from 'react';
import { onPreferences, preferences, setPreferences } from './preferences.ts';
import type { Note } from './store.ts';

/**
 * The trash (Matt: "Send deleted notes to a trash folder where we can empty it to perma delete notes or restore
 * notes"). Deleting a note puts it here rather than ending it: it leaves every list, tab, search and link at once, and
 * waits in the sidebar's Trash folder to be restored, deleted for good, or emptied with the rest.
 *
 * Kept as a preference - which note went into the trash and when - the way workspaces keep which note is filed where
 * (core/workspaces.ts), and for the same reason: the notes themselves are Rust's (core/store.ts), and a column there
 * is a native change and an APK. A preference ships over the air, and it syncs, so a note put in the trash on the phone
 * is in the trash on the Mac too. The note itself is untouched until the trash is emptied; only then is it deleted
 * from the store, which syncs as a delete like any other.
 */

/** Notes in the trash, by id: when each went in. */
export type Trash = Readonly<Record<string, number>>;

export function trash(): Trash {
  return preferences().trash;
}

export function isTrashed(id: string): boolean {
  return id in preferences().trash;
}

/** Into the trash, now. */
export function trashNote(id: string, now = Date.now()): void {
  setPreferences({ trash: { ...preferences().trash, [id]: now } });
}

/** Out of the trash, back to wherever it was: its workspace, pin and archive were never touched. */
export function restoreNote(id: string): void {
  forget([id]);
}

/** The trash no longer holding these: restored, or deleted for good and gone from the store. */
export function forget(ids: readonly string[]): void {
  const held = preferences().trash;
  if (!ids.some((id) => id in held)) return;
  const next = { ...held };
  for (const id of ids) delete next[id];
  setPreferences({ trash: next });
}

/** The notes that are not in the trash: everything the app shows outside the Trash folder. */
export function outOfTrash(notes: readonly Note[], held: Trash): Note[] {
  return notes.filter((n) => !(n.id in held));
}

/** The notes in the trash, the most recently thrown away first. */
export function inTrash(notes: readonly Note[], held: Trash): Note[] {
  return notes.filter((n) => n.id in held).sort((a, b) => (held[b.id] ?? 0) - (held[a.id] ?? 0));
}

export function useTrash(): Trash {
  return useSyncExternalStore(onPreferences, trash, trash);
}
