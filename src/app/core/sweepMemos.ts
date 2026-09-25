import type { Note } from './store.ts';
import { isTrashed, trashNote } from './trash.ts';

/**
 * Memos were a kind of note for a few hours on 2026-09-20: a note whose front matter said `kind: memo`, kept on a
 * wall of its own. Matt took them out ("remove memo's entirely from the app … we're going to focus on notes and
 * canvases") and chose that the ones already written go too, rather than becoming notes. So the first read of the
 * notes after this build puts any memo left in the trash (core/trash.ts), where it can still be brought back until
 * the trash is emptied, and remembers having done so, so a note someone later writes with that front matter by
 * hand is left alone.
 *
 * This can go, with its key, once every phone has run a build past it.
 */

const SWEPT_KEY = 'glyph-memos-swept';

/** A front matter fence, `---` or `+++`, on a line of its own. */
const FENCE = /^(---|\+\+\+)\s*$/;

/** Whether the note's front matter says `kind: memo`. */
export function wasMemo(body: string): boolean {
  const lines = body.split('\n');
  if (!FENCE.test(lines[0] ?? '')) return false;
  for (let n = 1; n < Math.min(lines.length, 40); n += 1) {
    const line = lines[n] ?? '';
    if (FENCE.test(line)) return false;
    if (/^\s*kind\s*:\s*memo\s*$/i.test(line)) return true;
    if (!/^\s*[\w.-]+\s*:/.test(line) && line.trim() !== '') return false;
  }
  return false;
}

function swept(): boolean {
  try {
    return localStorage.getItem(SWEPT_KEY) !== null;
  } catch {
    // Nowhere to remember it: sweep, and sweep again next time, which trashes nothing new.
    return false;
  }
}

function markSwept(): void {
  try {
    localStorage.setItem(SWEPT_KEY, new Date().toISOString());
  } catch {
    // Nowhere to remember it.
  }
}

/** Puts every memo among the notes in the trash, once; answers how many it did, so the list can read again. */
export function sweepMemos(notes: readonly Note[]): number {
  if (swept()) return 0;
  let count = 0;
  for (const note of notes) {
    if (!wasMemo(note.body) || isTrashed(note.id)) continue;
    trashNote(note.id);
    count += 1;
  }
  markSwept();
  return count;
}
