import { describe, expect, it } from 'vitest';
import type { Note } from '../core/store.ts';
import { bodyWithoutTitle, bookIndex, bookNoteBody, bookOf, chaptersOf, isBookBody, numbered, placeOf, prefaceOf, titleKey, withChapter, withChapterAt, withChapterMoved, withoutChapter } from './book.ts';

/**
 * A book is its index: a list of links in a note that says `book: true`. Read from the body, written back to it a
 * line at a time, and found again from any of its chapters.
 */

const note = (id: string, body: string): Note => ({ id, body, createdAt: 0, updatedAt: 0, source: 'editor' });

const BOOK = `---
title: "Field guide"
book: true
---
# Field guide

What to know before the walk.

- [[Introduction]]
- [[Trees]]
  - [[Oaks]]
  - [[Pines]]
- [[Birds]]
`;

describe('a book note', () => {
  it('is one by its front matter, and a note with a list of links is not', () => {
    expect(isBookBody(BOOK)).toBe(true);
    expect(isBookBody('- [[One]]\n- [[Two]]\n')).toBe(false);
    expect(isBookBody('---\ntitle: "X"\nbook: false\n---\n')).toBe(false);
    expect(isBookBody(bookNoteBody('Trip'))).toBe(true);
  });

  it('is made named, with its chapters in order, and reads back the same', () => {
    const body = bookNoteBody('Trip', ['Packing', 'Days']);
    expect(body).toBe('---\ntitle: "Trip"\nbook: true\n---\n# Trip\n\n- [[Packing]]\n- [[Days]]\n');
    expect(chaptersOf(body).map((c) => c.title)).toEqual(['Packing', 'Days']);
    expect(bookNoteBody('  ')).toContain('title: "Book"');
  });

  it('reads its chapters in order with their depth, and numbers them as an index does', () => {
    const chapters = chaptersOf(BOOK);
    expect(chapters.map((c) => [c.title, c.depth])).toEqual([
      ['Introduction', 0],
      ['Trees', 0],
      ['Oaks', 1],
      ['Pines', 1],
      ['Birds', 0],
    ]);
    expect(numbered(chapters)).toEqual(['1', '2', '2.1', '2.2', '3']);
    // A link with a heading or an alias is the note's title alone; a numbered list and a to-do count too.
    expect(chaptersOf('---\nbook: true\n---\n1. [[Trees#Oaks|the oaks]]\n2. [ ] [[Birds]]\n').map((c) => c.title)).toEqual(['Trees', 'Birds']);
  });

  it('keeps its own words apart from the index', () => {
    expect(prefaceOf(BOOK)).toEqual(['What to know before the walk.']);
    expect(prefaceOf(bookNoteBody('Trip'))).toEqual([]);
  });
});

describe('changing the index', () => {
  it('adds a chapter last, or after a named one at that one’s depth, and never twice', () => {
    const last = withChapter(BOOK, 'Rivers');
    expect(chaptersOf(last).map((c) => c.title)).toEqual(['Introduction', 'Trees', 'Oaks', 'Pines', 'Birds', 'Rivers']);
    const after = withChapter(BOOK, 'Elms', 'Oaks');
    expect(chaptersOf(after).map((c) => [c.title, c.depth])[3]).toEqual(['Elms', 1]);
    expect(withChapter(BOOK, 'trees')).toBe(BOOK);
    expect(withChapter(BOOK, '  ')).toBe(BOOK);
  });

  it('starts an index in a book with none, after its words', () => {
    const empty = bookNoteBody('Trip');
    const one = withChapter(empty, 'Packing');
    expect(one.endsWith('# Trip\n\n- [[Packing]]\n')).toBe(true);
    expect(chaptersOf(one).map((c) => c.title)).toEqual(['Packing']);
  });

  it('takes a chapter out of the index and leaves the note it names alone', () => {
    const fewer = withoutChapter(BOOK, 'Oaks');
    expect(chaptersOf(fewer).map((c) => c.title)).toEqual(['Introduction', 'Trees', 'Pines', 'Birds']);
    expect(fewer).toContain('What to know before the walk.');
    expect(withoutChapter(BOOK, 'Nope')).toBe(BOOK);
  });

  it('moves a chapter to a place, taking that row’s depth, and lands past the end as last', () => {
    expect(chaptersOf(withChapterAt(BOOK, 'Birds', 0)).map((c) => c.title)).toEqual(['Birds', 'Introduction', 'Trees', 'Oaks', 'Pines']);
    expect(chaptersOf(withChapterAt(BOOK, 'Introduction', 4)).map((c) => c.title)).toEqual(['Trees', 'Oaks', 'Pines', 'Birds', 'Introduction']);
    // Dropped among a part's chapters, it becomes one; pulled out, it stands on its own.
    expect(chaptersOf(withChapterAt(BOOK, 'Birds', 2)).map((c) => [c.title, c.depth])).toEqual([['Introduction', 0], ['Trees', 0], ['Birds', 1], ['Oaks', 1], ['Pines', 1]]);
    expect(chaptersOf(withChapterAt(BOOK, 'Oaks', 0)).map((c) => [c.title, c.depth])[0]).toEqual(['Oaks', 0]);
    expect(withChapterAt(BOOK, 'Trees', 1)).toBe(BOOK);
    expect(withChapterAt(BOOK, 'Nope', 0)).toBe(BOOK);
    expect(chaptersOf(withChapterAt(BOOK, 'Introduction', 99)).map((c) => c.title).pop()).toBe('Introduction');
  });

  it('moves a chapter up or down one place, and not past the ends', () => {
    expect(chaptersOf(withChapterMoved(BOOK, 'Birds', -1)).map((c) => c.title)).toEqual(['Introduction', 'Trees', 'Oaks', 'Birds', 'Pines']);
    expect(chaptersOf(withChapterMoved(BOOK, 'Introduction', 1)).map((c) => c.title)).toEqual(['Trees', 'Introduction', 'Oaks', 'Pines', 'Birds']);
    expect(withChapterMoved(BOOK, 'Introduction', -1)).toBe(BOOK);
    expect(withChapterMoved(BOOK, 'Birds', 1)).toBe(BOOK);
  });
});

describe('the book a note is in', () => {
  const notes = [note('b', BOOK), note('t', '# Trees\n\nTall.'), note('o', '# Oaks\n'), note('x', '# Loose\n')];

  it('is found from any chapter, with its place, and not from a note that is in no book', () => {
    const place = bookOf(notes, 'Oaks');
    expect(place?.book.id).toBe('b');
    expect(place?.title).toBe('Field guide');
    expect(place?.at).toBe(2);
    expect(bookOf(notes, 'trees')?.at).toBe(1);
    expect(bookOf(notes, 'Loose')).toBeNull();
    expect(bookOf(notes, '')).toBeNull();
  });

  it('is not the book itself', () => {
    const selfish = note('s', '---\nbook: true\n---\n# Self\n\n- [[Self]]\n');
    expect(bookOf([selfish], 'Self')).toBeNull();
  });
});

describe('a chapter read straight through', () => {
  it('drops the front matter and the heading that is its own title, and keeps the rest with its marks', () => {
    expect(bodyWithoutTitle('---\ntitle: "Oaks"\n---\n# Oaks\n\nTall, and *old*.\n\n- [ ] count them\n', 'Oaks')).toBe('Tall, and *old*.\n\n- [ ] count them\n');
    // A heading that is not the title stays: it is the chapter's own first section.
    expect(bodyWithoutTitle('# Where they grow\n\nHere.', 'Oaks')).toBe('# Where they grow\n\nHere.');
    expect(bodyWithoutTitle('\n\nNo heading.', 'Oaks')).toBe('No heading.');
  });
});

describe('the marks a list draws', () => {
  const notes = [
    note('b', BOOK),
    note('t', '# Trees\n\nTall.'),
    note('o', '# oaks\n'),
    note('x', '# Loose\n'),
    note('b2', '---\ntitle: "Other"\nbook: true\n---\n# Other\n\n- [[Trees]]\n'),
  ];

  it('keys titles the way links are matched', () => {
    expect(titleKey('  The Oaks!  ')).toBe('the oaks');
    expect(titleKey('oaks')).toBe(titleKey('Oaks'));
  });

  it('answers every page’s book in one pass, the first book for a page in two, and nothing for a book or a loose note', () => {
    const index = bookIndex(notes);
    expect(placeOf(index, notes[1]!)?.title).toBe('Field guide');
    expect(placeOf(index, notes[1]!)?.at).toBe(1);
    // "oaks" is the chapter "Oaks", however it is typed.
    expect(placeOf(index, notes[2]!)?.at).toBe(2);
    expect(placeOf(index, notes[3]!)).toBeNull();
    expect(placeOf(index, notes[0]!)).toBeNull();
    // Trees is in both books: the first wins, as bookOf answers.
    expect(placeOf(index, notes[1]!)?.book.id).toBe(bookOf(notes, 'Trees')?.book.id);
  });
});
