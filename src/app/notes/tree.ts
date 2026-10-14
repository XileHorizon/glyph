import { archiveOrder, listOrder, type Note } from '../core/store.ts';
import type { Workspace } from '../core/workspaces.ts';

/**
 * The notes as the sidebar shows them: a folder for each workspace, then the notes filed in none, then the archive
 * (notes/NoteTree.tsx). Matt: "Make the sidebar on desktop the same sidebar that shows up in the pop-up sidebar. Make
 * it more similar to the obsidian sidebar", and asked, workspaces as folders in the tree.
 *
 * Pure, so the rules of what goes where are tests rather than something to click through. The order inside each
 * group is the list's own (pinned first, then the most recently touched), so a note sits in the same order in the
 * tree as it does on the phone's home screen.
 */

export interface TreeFolder {
  id: string;
  name: string;
  hue?: string;
  notes: Note[];
}

export interface Tree {
  folders: TreeFolder[];
  /** Notes filed in no workspace, or in one that has since gone. */
  loose: Note[];
  archived: Note[];
}

export function noteTree(notes: readonly Note[], spaces: { list: readonly Workspace[]; of: Record<string, string> }): Tree {
  const live = listOrder(notes);
  const known = new Set(spaces.list.map((space) => space.id));
  const folders = spaces.list.map((space) => ({
    id: space.id,
    name: space.name,
    ...(space.hue ? { hue: space.hue } : {}),
    notes: live.filter((note) => spaces.of[note.id] === space.id),
  }));
  const loose = live.filter((note) => !known.has(spaces.of[note.id] ?? ''));
  return { folders, loose, archived: archiveOrder(notes) };
}

/** The archive's place among the folders, for remembering whether it is open. */
export const ARCHIVE_FOLDER = 'archive';

/**
 * Which folders are closed, per device: how a sidebar is left is a matter of the screen it is on, not something to
 * carry to another device. The archive starts closed, everything else open.
 */
const KEY = 'glyph-tree-closed';

export function readClosed(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return new Set([ARCHIVE_FOLDER]);
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [ARCHIVE_FOLDER]);
  } catch {
    return new Set([ARCHIVE_FOLDER]);
  }
}

export function writeClosed(closed: ReadonlySet<string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...closed]));
  } catch {
    // Private mode: the sidebar just opens as it was for this run.
  }
}

/**
 * Whether the trash's folder is open, per device, and shut until it is opened. Kept apart from the folders' own list:
 * that list stores which are shut, and a device that stored it before there was a trash would show the trash open.
 */
const TRASH_KEY = 'glyph-tree-trash-open';

export function readTrashOpen(): boolean {
  try {
    return localStorage.getItem(TRASH_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeTrashOpen(open: boolean): void {
  try {
    localStorage.setItem(TRASH_KEY, open ? '1' : '0');
  } catch {
    // Private mode: it opens shut next time.
  }
}
