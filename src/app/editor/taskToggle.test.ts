import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { boxAt, toggleBox } from './taskToggle.ts';

describe('tapping a to-do box', () => {
  it('finds the box on a to-do line, bulleted, numbered or indented, and nothing on other lines', () => {
    const state = EditorState.create({ doc: '- [ ] milk\n  * [x] eggs\n3. [X] bread\n- plain\n[ ] not a list' });
    const line = (n: number) => state.doc.line(n).from;
    expect(boxAt(state, line(1))).toEqual({ from: 2, to: 5, done: false });
    expect(boxAt(state, line(2) + 4)).toMatchObject({ from: line(2) + 4, done: true });
    expect(boxAt(state, line(3))).toMatchObject({ from: line(3) + 3, done: true });
    expect(boxAt(state, line(4))).toBeNull();
    expect(boxAt(state, line(5))).toBeNull();
  });

  it('ticks an empty box and clears a ticked one, touching nothing else, as one edit', () => {
    let state = EditorState.create({ doc: '- [ ] milk [notion](https://notion.so/x) ^milk' });
    const tr = toggleBox(state, boxAt(state, 0)!);
    expect(tr.isUserEvent('input')).toBe(true);
    state = tr.state;
    expect(state.doc.toString()).toBe('- [x] milk [notion](https://notion.so/x) ^milk');
    state = toggleBox(state, boxAt(state, 0)!).state;
    expect(state.doc.toString()).toBe('- [ ] milk [notion](https://notion.so/x) ^milk');
    const upper = EditorState.create({ doc: '- [X] done' });
    expect(toggleBox(upper, boxAt(upper, 0)!).state.doc.toString()).toBe('- [ ] done');
  });
});

describe('a box that is also a card', () => {
  const note = ['```board', 'To do: milk, eggs', 'Done: bread', '```', '', '- [ ] Milk ^milk', '- [ ] Eggs ^eggs', '- [x] Bread ^bread', ''].join('\n');
  const tick = (doc: string, line: number) => {
    const state = EditorState.create({ doc });
    return toggleBox(state, boxAt(state, state.doc.line(line).from)!).state.doc.toString();
  };

  it('moves its card to Done when the box is ticked in the list, as one edit', () => {
    const after = tick(note, 6);
    expect(after).toContain('To do: eggs\nDone: bread, milk');
    expect(after).toContain('- [x] Milk ^milk');
  });

  it('takes the card out of Done when the box is cleared, back to the first lane', () => {
    const after = tick(note, 8);
    expect(after).toContain('To do: milk, eggs, bread\nDone:');
    expect(after).toContain('- [ ] Bread ^bread');
  });

  it('settles cards that had drifted at the same time, and leaves a board with no Done lane alone', () => {
    // The note Matt had: ticked items still sitting in To do, drawn in Done but not written there.
    const drifted = ['```board', 'To do: milk, eggs', 'Done:', '```', '', '- [ ] Milk ^milk', '- [x] Eggs ^eggs', ''].join('\n');
    expect(tick(drifted, 6)).toContain('To do:\nDone: milk, eggs');
    const noDone = ['```board', 'To do: milk', 'Next: eggs', '```', '', '- [ ] Milk ^milk', '- [x] Eggs ^eggs', ''].join('\n');
    expect(tick(noDone, 6)).toContain('To do: milk\nNext: eggs');
  });

  it('leaves the fence alone for an item that is not on a board', () => {
    const plain = ['```board', 'To do: milk', 'Done:', '```', '', '- [ ] Milk ^milk', '- [ ] Loose ^loose', ''].join('\n');
    expect(tick(plain, 7)).toContain('To do: milk\nDone:');
  });
});

describe('a box that is not a card yet', () => {
  it('joins its list’s board in Done, anchor and all, as one edit', () => {
    const note = ['```board', 'To do: milk', 'Done:', '```', '', '- [ ] Milk ^milk', '- [ ] Bread', ''].join('\n');
    const state = EditorState.create({ doc: note });
    const after = toggleBox(state, boxAt(state, state.doc.line(7).from)!).state.doc.toString();
    // The line gains its name, the box is ticked, and the card lands in Done: one tap, one undo.
    expect(after).toContain('- [x] Bread ^bread');
    expect(after).toContain('To do: milk\nDone: bread');
  });

  it('leaves an item alone when its list has nothing on a board', () => {
    const note = ['```board', 'To do: milk', 'Done:', '```', '', '- [ ] Milk ^milk', '', '## Later', '', '- [ ] Bread', ''].join('\n');
    const state = EditorState.create({ doc: note });
    const after = toggleBox(state, boxAt(state, state.doc.line(10).from)!).state.doc.toString();
    expect(after).toContain('- [x] Bread');
    expect(after).not.toContain('^bread');
    expect(after).toContain('To do: milk\nDone:');
  });
});
