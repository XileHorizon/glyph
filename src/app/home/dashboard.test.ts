import { describe, expect, it } from 'vitest';
import type { Note } from '../core/store.ts';
import { bookNotes, openTasks, pinnedNotes, recentNotes, tickedTasks } from './dashboard.ts';

const note = (id: string, body: string, updatedAt: number, extra: Partial<Note> = {}): Note =>
  ({ id, body, createdAt: 0, updatedAt, source: 'editor', ...extra }) as Note;

describe('the home page', () => {
  const notes = [
    note('a', '# A', 10),
    note('b', '# B', 30, { starred: true }),
    note('c', '# C', 20),
    note('d', '# D', 40, { archivedAt: 50 }),
  ];

  it('pins and lists recent notes without showing one twice or anything archived', () => {
    expect(pinnedNotes(notes).map((n) => n.id)).toEqual(['b']);
    expect(recentNotes(notes, 5).map((n) => n.id)).toEqual(['c', 'a']);
    expect(recentNotes(notes, 1).map((n) => n.id)).toEqual(['c']);
  });

  it('gathers every unticked to-do, the note touched last first', () => {
    const tasks = openTasks([
      note('old', '# Old\n- [ ] Buy milk\n- [x] Done already', 1),
      note('new', '# New\n\n1. [ ] Ship it ^ship\n* [ ] Tell Sam\n- plain bullet', 2),
    ]);
    expect(tasks.map((t) => [t.noteId, t.line, t.text, t.at])).toEqual([
      ['new', 2, 'Ship it', 'ship'],
      ['new', 3, 'Tell Sam', undefined],
      ['old', 1, 'Buy milk', undefined],
    ]);
  });

  it('leaves out a to-do written as an example in a code fence, an empty box, and the archive', () => {
    const tasks = openTasks([
      note('n', '```md\n- [ ] not a task\n```\n- [ ] \n- [ ] real', 1),
      note('gone', '- [ ] archived', 2, { archivedAt: 3 }),
    ]);
    expect(tasks.map((t) => t.text)).toEqual(['real']);
  });

  it('counts the ticked to-dos, leaving out examples in a fence, empty boxes and the archive', () => {
    expect(
      tickedTasks([
        note('a', '- [x] Done\n- [X] Also done\n- [ ] Open\n- [x] ', 1),
        note('b', '```\n- [x] an example\n```\n1. [x] numbered', 2),
        note('gone', '- [x] archived', 3, { archivedAt: 4 }),
      ]),
    ).toBe(3);
    expect(tickedTasks([note('c', '- [ ] only open', 1)])).toBe(0);
  });
});

describe('the library', () => {
  const note = (id: string, body: string, extra: Partial<Note> = {}): Note => ({ id, body, createdAt: 0, updatedAt: 1, source: 'editor', ...extra });

  it('is the books, newest change first, the archive left out, and Recent is without them', () => {
    const notes = [
      note('a', '# A plain note', { updatedAt: 5 }),
      note('b', '---\ntitle: "Field guide"\nbook: true\n---\n# Field guide\n\n- [[A plain note]]\n', { updatedAt: 3 }),
      note('c', '---\ntitle: "Old"\nbook: true\n---\n', { updatedAt: 9, archivedAt: 1 }),
      note('d', '---\ntitle: "Trip"\nbook: true\n---\n', { updatedAt: 7 }),
    ];
    expect(bookNotes(notes).map((n) => n.id)).toEqual(['d', 'b']);
    expect(recentNotes(notes, 10).map((n) => n.id)).toEqual(['a']);
  });
});
