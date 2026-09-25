import { beforeEach, describe, expect, it } from 'vitest';
import type { Note } from '../core/store.ts';
import { ARCHIVE_FOLDER, noteTree, readClosed, writeClosed } from './tree.ts';

const note = (id: string, over: Partial<Note> = {}): Note => ({ id, body: `# ${id}`, createdAt: 1, updatedAt: 1, source: 'editor', ...over });

describe('the notes as the sidebar shows them', () => {
  it('puts each note in its workspace, and the rest below', () => {
    const tree = noteTree([note('a'), note('b'), note('c')], {
      list: [{ id: 'w1', name: 'Work' }, { id: 'w2', name: 'Home' }],
      of: { a: 'w1', b: 'w2' },
    });
    expect(tree.folders.map((f) => [f.name, f.notes.map((n) => n.id)])).toEqual([
      ['Work', ['a']],
      ['Home', ['b']],
    ]);
    expect(tree.loose.map((n) => n.id)).toEqual(['c']);
  });

  it('keeps an empty workspace, so it can still be filed into', () => {
    const tree = noteTree([note('a')], { list: [{ id: 'w1', name: 'Work' }], of: {} });
    expect(tree.folders).toEqual([{ id: 'w1', name: 'Work', notes: [] }]);
    expect(tree.loose.map((n) => n.id)).toEqual(['a']);
  });

  it('treats a note filed in a workspace that has gone as filed in none', () => {
    const tree = noteTree([note('a')], { list: [], of: { a: 'gone' } });
    expect(tree.loose.map((n) => n.id)).toEqual(['a']);
  });

  it('keeps archived notes out of the folders and in the archive', () => {
    const tree = noteTree([note('a', { archivedAt: 5 }), note('b')], { list: [{ id: 'w1', name: 'Work' }], of: { a: 'w1', b: 'w1' } });
    expect(tree.folders[0]?.notes.map((n) => n.id)).toEqual(['b']);
    expect(tree.archived.map((n) => n.id)).toEqual(['a']);
  });

  it('orders a folder as the list does: pinned first, then the most recent', () => {
    const tree = noteTree([note('old', { updatedAt: 1 }), note('new', { updatedAt: 9 }), note('pin', { updatedAt: 0, starred: true })], {
      list: [{ id: 'w1', name: 'Work' }],
      of: { old: 'w1', new: 'w1', pin: 'w1' },
    });
    expect(tree.folders[0]?.notes.map((n) => n.id)).toEqual(['pin', 'new', 'old']);
  });

  it('carries a workspace colour through', () => {
    const tree = noteTree([], { list: [{ id: 'w1', name: 'Work', hue: 'sea' }], of: {} });
    expect(tree.folders[0]?.hue).toBe('sea');
  });
});

describe('which folders are closed', () => {
  beforeEach(() => localStorage.clear());

  it('starts with only the archive closed', () => {
    expect([...readClosed()]).toEqual([ARCHIVE_FOLDER]);
  });

  it('remembers what was closed on this device', () => {
    writeClosed(new Set(['w1']));
    expect([...readClosed()]).toEqual(['w1']);
  });

  it('reads rubbish as the starting state', () => {
    localStorage.setItem('glyph-tree-closed', 'not json');
    expect([...readClosed()]).toEqual([ARCHIVE_FOLDER]);
  });
});
