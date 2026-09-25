import { describe, expect, it } from 'vitest';
import { appendToList, leaveNote } from './listAppend.ts';

describe('adding spoken items to a note’s list', () => {
  it('goes on the end of the last list, in its own style', () => {
    const body = '# AttackFM\n\nSome thoughts about the app.\n\n- [ ] Fix the login bug\n- [x] Ship 0.6.9\n\nNotes after the list.';
    expect(appendToList(body, ['update the readme.']).body).toBe(
      '# AttackFM\n\nSome thoughts about the app.\n\n- [ ] Fix the login bug\n- [x] Ship 0.6.9\n- [ ] Update the readme\n\nNotes after the list.',
    );
  });

  it('counts on from a numbered list and keeps its delimiter', () => {
    expect(appendToList('Steps\n\n1) Build\n2) Test', ['ship it', 'celebrate']).body).toBe('Steps\n\n1) Build\n2) Test\n3) Ship it\n4) Celebrate');
  });

  it('uses the list’s own bullet and indent, after an item’s continuation lines', () => {
    const body = '- One\n  more about one\n* Two\n  - child\n\nEnd.';
    expect(appendToList(body, ['three']).body).toBe('- One\n  more about one\n* Two\n  - child\n* Three\n\nEnd.');
  });

  it('picks the LAST list when a note has several', () => {
    const body = '- a\n- b\n\nMiddle.\n\n- [ ] c';
    expect(appendToList(body, ['d']).added).toEqual(['- [ ] d'.replace('d', 'D')]);
  });

  it('starts a list at the end of a note that has none', () => {
    expect(appendToList('# Backlog\n\nIdeas go here.\n', ['dark mode']).body).toBe('# Backlog\n\nIdeas go here.\n\n- Dark mode\n');
    expect(appendToList('# Backlog', ['dark mode'], { asTasks: true }).body).toBe('# Backlog\n\n- [ ] Dark mode\n');
    expect(appendToList('', ['first']).body).toBe('- First\n');
  });

  it('adds nothing for empty items', () => {
    expect(appendToList('- a', ['  ', '.']).added).toEqual([]);
  });
});

describe('leaving a spoken note in another note', () => {
  it('adds it to the note’s list when it has one, in the list’s style', () => {
    const body = '# AttackFM\n\nBugs to fix:\n\n- [ ] Seek bar mismatch\n- [ ] Downloads stuck\n\nLaunch on Friday.\n';
    const left = leaveNote(body, 'that says the login is broken on Android');
    expect(left.into).toBe('list');
    expect(left.added).toEqual(['- [ ] The login is broken on Android']);
    expect(left.body).toBe('# AttackFM\n\nBugs to fix:\n\n- [ ] Seek bar mismatch\n- [ ] Downloads stuck\n- [ ] The login is broken on Android\n\nLaunch on Friday.\n');
  });

  it('picks the list it fits when a note has several', () => {
    const body = '# Ghost.md\n\n## Bugs\n\n- Paste drops pictures\n- Menu runs off the edge\n\n## Ideas\n\n- Wake word\n- Shared notes\n';
    expect(leaveNote(body, 'to fix the bug where the menu flickers').added).toEqual(['- Fix the bug where the menu flickers']);
    expect(leaveNote(body, 'to fix the bug where the menu flickers').body).toContain('- Menu runs off the edge\n- Fix the bug where the menu flickers\n\n## Ideas');
    expect(leaveNote(body, 'an idea for voice shortcuts').body).toMatch(/- Shared notes\n- An idea for voice shortcuts\n$/);
  });

  it('is a paragraph in a note with no list, or when it is a long thought', () => {
    expect(leaveNote('# Weekend trip\n\nCabin by the lake.\n', 'we need to book it by Thursday')).toEqual({
      body: '# Weekend trip\n\nCabin by the lake.\n\nWe need to book it by Thursday.\n',
      added: ['We need to book it by Thursday.'],
      into: 'paragraph',
    });
    const long = 'The seek bar goes out of step when two devices play. It starts after a pause. It gets worse over time. Nobody has found why yet.';
    expect(leaveNote('- [ ] One\n', long).into).toBe('paragraph');
  });
});
