import { applyNote, getNote, announceNotesChanged } from './store.ts';
import { isTauri } from './tauri.ts';

/**
 * A note's workspace decides which folder holds its file.
 *
 * Matt: "Setting a workspace should dictate the folder the note is saved in on disk
 * (workspaces/<workspace_name>/<note>.md)". The library is a folder of plain Markdown (docs/LIBRARY.md): a new note
 * is written into `Inbox/`, and the file is named after the note's title. Filing a note in a workspace now moves that
 * file into `workspaces/<the workspace>/`, and taking it out of one moves it back to `Inbox/`, so the folders a
 * person sees in Obsidian or a file manager say the same thing the pills in the app say.
 *
 * The move is the library's own: `store_apply` takes a note carrying the path it should have, and the Rust side
 * renames the file and re-indexes it (library/mod.rs `apply_note`). So this asks for a path and nothing here touches
 * the disk. Where there is no library - the browser, or a phone whose binary is older than the path field - a note
 * has no path and nothing happens.
 *
 * The workspace's name becomes a folder name, so it is cleaned the way a file name is: the characters a folder
 * cannot hold go, and a name that cleans away to nothing leaves the note where it is rather than making a folder
 * called nothing.
 */

/** Where notes with no workspace live: the library's own landing folder (library/mod.rs `INBOX`). */
export const INBOX = 'Inbox';
/** The folder the workspaces' folders sit in, as Matt asked for it. */
export const WORKSPACES = 'workspaces';

/** A workspace's name as a folder name: what a file name may not hold is dropped, and the ends are trimmed. */
export function folderName(name: string): string {
  return name
    .replace(/[/\\:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 60)
    .trim();
}

/** The folder a note belongs in: its workspace's, or the inbox with no workspace. Null when the name is unusable. */
export function folderFor(workspace: string | null): string | null {
  if (workspace === null) return INBOX;
  const folder = folderName(workspace);
  return folder ? `${WORKSPACES}/${folder}` : null;
}

/** The file's own name, without the folders: `workspaces/Home/Weekend trip.md` is `Weekend trip.md`. */
function fileName(path: string): string {
  const at = path.lastIndexOf('/');
  return at < 0 ? path : path.slice(at + 1);
}

/**
 * Moves one note's file into the folder its workspace names, if it is not there already.
 *
 * Quiet about everything it cannot do: a note with no file yet (a draft, or a browser), a name that cleans away to
 * nothing, or a library that refuses the move because something is already called that. The note's words are never
 * touched - only where the file sits.
 */
export async function fileNoteInFolder(noteId: string, workspace: string | null): Promise<void> {
  const folder = folderFor(workspace);
  if (folder !== null) await fileNoteAt(noteId, folder);
}

/** Moves one note's file into `folder`, whatever names it. */
export async function fileNoteAt(noteId: string, folder: string): Promise<void> {
  if (!isTauri()) return;
  try {
    const note = await getNote(noteId);
    if (!note?.path) return;
    const path = `${folder}/${fileName(note.path)}`;
    if (path === note.path) return;
    await applyNote({ ...note, path });
    announceNotesChanged();
  } catch (failure) {
    console.warn('[glyph] the note stayed where it was:', failure);
  }
}

/** The same for several notes at once: a workspace renamed, or taken away. */
export async function fileNotesInFolder(noteIds: readonly string[], workspace: string | null): Promise<void> {
  for (const id of noteIds) await fileNoteInFolder(id, workspace);
}
