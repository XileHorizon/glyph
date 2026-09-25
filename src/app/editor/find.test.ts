import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { findExtension, findOf, matchesIn, setFind } from './find.ts';

describe('find and replace', () => {
  it('finds every match, case forgiven, never overlapping', () => {
    expect(matchesIn('Friday, friday, FRIDAY', 'friday').map((m) => m.from)).toEqual([0, 8, 16]);
    expect(matchesIn('aaaa', 'aa').map((m) => m.from)).toEqual([0, 2]);
    expect(matchesIn('anything', '')).toEqual([]);
  });

  it('makes the first match after the caret current, and keeps finding as the words change', () => {
    const state = EditorState.create({ doc: 'milk, eggs, milk, bread, milk', extensions: [findExtension()] });
    const found = state.update({ effects: setFind.of({ query: 'milk', near: 7 }) }).state;
    expect(findOf(found).matches.length).toBe(3);
    expect(findOf(found).current).toBe(1);
    // One replaced by hand: the search follows, one fewer.
    const edited = found.update({ changes: { from: 0, to: 4, insert: 'oat' } }).state;
    expect(findOf(edited).matches.length).toBe(2);
  });

  it('replaces every match in one change', () => {
    const state = EditorState.create({ doc: 'milk, eggs, milk', extensions: [findExtension()] });
    const found = state.update({ effects: setFind.of({ query: 'milk' }) }).state;
    const changes = findOf(found).matches.map((m) => ({ from: m.from, to: m.to, insert: 'oat milk' }));
    const replaced = found.update({ changes }).state;
    expect(replaced.doc.toString()).toBe('oat milk, eggs, oat milk');
  });
});
