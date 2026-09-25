import { describe, expect, it } from 'vitest';
import type { Note } from '../core/store.ts';
import { asideContent } from './aside.ts';

const note = (id: string, body: string, updatedAt = 1, extra: Partial<Note> = {}): Note => ({ id, body, createdAt: 0, updatedAt, source: 'editor', ...extra });
const BOOK = '---\ntitle: "Field guide"\nbook: true\n---\n# Field guide\n\n- [[Trees]]\n- [[Birds]]\n';
const notes = [note('b', BOOK, 5), note('t', '# Trees\n', 4), note('x', '# Loose\n', 3), note('a', '# Archived\n', 9, { archivedAt: 1 })];

describe('what the aside shows', () => {
  it('shows a page’s book with the page marked, and the book’s own index with none', () => {
    const page = asideContent(notes, notes[1]!);
    expect(page.kind).toBe('book');
    if (page.kind === 'book') {
      expect(page.place.title).toBe('Field guide');
      expect(page.place.chapters.map((c) => c.title)).toEqual(['Trees', 'Birds']);
      expect(page.open).toBe('t');
    }
    const book = asideContent(notes, notes[0]!);
    expect(book.kind === 'book' && book.place.at).toBe(-1);
    expect(book.kind === 'book' && book.open).toBeNull();
  });

  it('lists the workspace’s other notes otherwise - the open one and the archive left out, in the list’s order', () => {
    const loose = asideContent(notes, notes[2]!);
    expect(loose.kind).toBe('notes');
    if (loose.kind === 'notes') expect(loose.notes.map((n) => n.id)).toEqual(['b', 't']);
    const home = asideContent(notes, null);
    if (home.kind === 'notes') expect(home.notes.map((n) => n.id)).toEqual(['b', 't', 'x']);
  });
});
