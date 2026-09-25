import { describe, expect, it } from 'vitest';
import { archiveOrder, listOrder, noteTitle, type Note } from './store.ts';

describe('the list labels', () => {
  it('titles a note by its first line, without heading marks', () => {
    expect(noteTitle('# Groceries\nmilk')).toBe('Groceries');
    expect(noteTitle('Plain first line')).toBe('Plain first line');
    // A bookmark set on the first line is where the note opens, not part of its name.
    expect(noteTitle('# Weekend trip §§\nmilk')).toBe('Weekend trip');
    expect(noteTitle('Half §§ way')).toBe('Half way');
  });

});

describe('the list order', () => {
  const note = (id: string, updatedAt: number, extra: Partial<Note> = {}): Note => ({
    id,
    body: id,
    createdAt: 0,
    updatedAt,
    source: 'editor',
    ...extra,
  });

  it('puts starred notes first and hides the archived', () => {
    const notes = [note('old', 1), note('new', 3), note('starred-old', 0, { starred: true }), note('gone', 9, { archivedAt: 5 })];
    expect(listOrder(notes).map((n) => n.id)).toEqual(['starred-old', 'new', 'old']);
  });

  it('shows the archive most recently archived first', () => {
    const notes = [note('a', 1, { archivedAt: 10 }), note('b', 2, { archivedAt: 20 }), note('live', 3)];
    expect(archiveOrder(notes).map((n) => n.id)).toEqual(['b', 'a']);
  });
});

describe('a note that opens with front matter', () => {
  it('is named by its own title key, not by the fence', () => {
    expect(noteTitle('---\ntitle: The deposit\ntags: cabin\n---\n\nWords.')).toBe('The deposit');
    expect(noteTitle('---\ntitle: "Quoted name"\n---\n\nWords.')).toBe('Quoted name');
  });

  it('falls back to the first words under the fence when there is no title key', () => {
    expect(noteTitle('---\ntags: cabin\n---\n\n# The deposit\n\nWords.')).toBe('The deposit');
  });

  it('leaves a rule in the middle of a note alone, and an unclosed fence', () => {
    expect(noteTitle('Words first\n\n---\n\nMore.')).toBe('Words first');
    expect(noteTitle('---\nnot really front matter, just words\n\nMore.')).toBe('---');
  });
});
