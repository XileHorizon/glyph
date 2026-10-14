import { isBookBody } from '../book/book.ts';
import { itemOnLine, itemWords } from '../core/boards.ts';
import type { Note } from '../core/store.ts';

/**
 * What the home page gathers from the notes (home/HomeScreen.tsx): the pinned ones, the ones touched last, and every
 * to-do not yet ticked, wherever it was written. Pure, so each rule is a test rather than a page to look at.
 */

/** Pinned notes, newest first. The archive is never on the home page. */
export function pinnedNotes(notes: readonly Note[]): Note[] {
  return notes.filter((n) => n.starred && !n.archivedAt).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** The books (docs/BOOKS.md), newest change first, for the home page's Library. The archive stays out. */
export function bookNotes(notes: readonly Note[]): Note[] {
  return notes.filter((n) => !n.archivedAt && isBookBody(n.body)).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** The notes touched last, pinned ones and books left to their own rows so nothing shows twice. */
export function recentNotes(notes: readonly Note[], count: number): Note[] {
  return notes
    .filter((n) => !n.starred && !n.archivedAt && !isBookBody(n.body))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, count);
}

export interface OpenTask {
  noteId: string;
  /** The line it is on, counting from 0, which is what ticking it rewrites. */
  line: number;
  text: string;
  /** Its anchor (core/boards.ts), when it has one: opening the note lands on it. */
  at?: string;
  /** When its note was touched, which orders the list: what was being worked on comes first. */
  touched: number;
}

/** A to-do with its box still empty: `- [ ] words`, `* [ ]`, `1. [ ]`. */
const OPEN = /^\s*(?:[-*+]|\d+[.)])\s+\[ \]/;
/** A to-do with its box ticked: `- [x] words`. */
const TICKED = /^\s*(?:[-*+]|\d+[.)])\s+\[[xX]\]\s*\S/;
/** A code fence opening or closing: a to-do inside one is an example of a to-do, not one. */
const FENCE = /^\s*(`{3,}|~{3,})/;

/** Every unticked to-do in the notes, the most recently touched note's first, in the order each note has them. */
export function openTasks(notes: readonly Note[]): OpenTask[] {
  const tasks: OpenTask[] = [];
  for (const note of [...notes].filter((n) => !n.archivedAt).sort((a, b) => b.updatedAt - a.updatedAt)) {
    let fenced = false;
    note.body.split('\n').forEach((line, index) => {
      if (FENCE.test(line)) {
        fenced = !fenced;
        return;
      }
      if (fenced || !OPEN.test(line)) return;
      const text = itemWords(line)?.trim();
      if (!text) return;
      tasks.push({ noteId: note.id, line: index, text, at: itemOnLine(line)?.id, touched: note.updatedAt });
    });
  }
  return tasks;
}

/**
 * How many to-dos are ticked in the notes, outside code fences and the archive: with none left open, a page that had
 * to-dos says they are all done (the ghost on the home page), and a page that never had any says nothing.
 */
export function tickedTasks(notes: readonly Note[]): number {
  let count = 0;
  for (const note of notes) {
    if (note.archivedAt) continue;
    let fenced = false;
    for (const line of note.body.split('\n')) {
      if (FENCE.test(line)) fenced = !fenced;
      else if (!fenced && TICKED.test(line)) count += 1;
    }
  }
  return count;
}
