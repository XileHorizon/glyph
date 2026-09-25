import { describe, expect, it } from 'vitest';
import { applyLinks, itemAt, itemWords, linkedLine, markOf, registerMarkName, unmarked, unsentItems, withMark } from './itemLinks.ts';

describe('list items for Notion', () => {
  const body = [
    '# AttackFM',
    '',
    '- [ ] Fix the login bug',
    '- [x] Ship 0.6.9',
    '- [ ] Pins in the list [notion](https://www.notion.so/attackfm/Pins-1a2b3c)',
    '- [ ] [Old style link](https://www.notion.so/attackfm/Old-4d5e6f)',
    '- Radio idea',
    '1. First step',
    'Not an item.',
    '- ![](image/a.jpg)',
  ].join('\n');

  it('finds the items that are not sent yet, skipping done and linked ones of either form', () => {
    expect(unsentItems(body)).toEqual([
      { line: 3, text: 'Fix the login bug' },
      { line: 7, text: 'Radio idea' },
      { line: 8, text: 'First step' },
    ]);
  });

  it('marks an item at its end and keeps its marker and its words', () => {
    expect(linkedLine('- [ ] Fix the login bug', 'https://www.notion.so/x-1')).toBe('- [ ] Fix the login bug [notion](https://www.notion.so/x-1)');
    expect(linkedLine('  2) Brackets [out]', 'https://n.so/y')).toBe('  2) Brackets [out] [notion](https://n.so/y)');
    registerMarkName('github');
    expect(linkedLine('- Call Sam', 'https://github.com/i/1', 'github')).toBe('- Call Sam [github](https://github.com/i/1)');
    // Marking a marked item replaces the mark rather than stacking two.
    expect(linkedLine('- [ ] Buy milk [notion](https://n.so/a)', 'https://n.so/b')).toBe('- [ ] Buy milk [notion](https://n.so/b)');
  });

  it('reads a mark back, and the words without it', () => {
    expect(markOf('Buy milk [notion](https://n.so/a)')).toEqual({ name: 'notion', url: 'https://n.so/a' });
    expect(markOf('Buy milk')).toBeNull();
    expect(markOf('[Buy milk](https://n.so/a)')).toBeNull();
    // A one-word link at the end is only a mark when the word is a plugin's name.
    expect(markOf('read the [docs](https://n.so/d)')).toBeNull();
    expect(unmarked('read the [docs](https://n.so/d)')).toBe('read the [docs](https://n.so/d)');
    expect(unmarked('Buy milk [notion](https://n.so/a)  ')).toBe('Buy milk');
    expect(itemWords('- [ ] Buy milk [notion](https://n.so/a)')).toBe('Buy milk');
    expect(itemWords('Just words')).toBeNull();
  });

  it('answers for one line', () => {
    expect(itemAt('- [ ] Call Sam', 4)).toEqual({ line: 4, text: 'Call Sam' });
    expect(itemAt('Just words', 4)).toBeNull();
    expect(itemAt('- [ ] Call Sam [notion](https://n.so/a)', 4)).toBeNull();
  });

  it('is what the voice path writes too, line by line', () => {
    // plugins/notion/voice.ts: body.replace(line, linkedLine(line, url)).
    const noteBody = '# Trip\n\n- [ ] Book the cabin\n- [ ] Pack snacks\n';
    const line = '- [ ] Book the cabin';
    expect(noteBody.replace(line, linkedLine(line, 'https://n.so/a'))).toBe('# Trip\n\n- [ ] Book the cabin [notion](https://n.so/a)\n- [ ] Pack snacks\n');
  });
});

describe('links for things sent while talking', () => {
  it('marks the words where the cues put them', () => {
    const markdown = '# Trip\n\n- [ ] Book the cabin\n- Pack snacks\n\nWe leave Friday.';
    expect(applyLinks(markdown, [{ text: 'Book the cabin.', url: 'https://n.so/a' }])).toBe(
      '# Trip\n\n- [ ] Book the cabin [notion](https://n.so/a)\n- Pack snacks\n\nWe leave Friday.',
    );
    expect(applyLinks(markdown, [{ text: 'leave Friday', url: 'https://n.so/b' }])).toContain('We leave Friday [notion](https://n.so/b).');
  });

  it('does nothing when the words are not there or already linked', () => {
    expect(applyLinks('- x [notion](https://n.so/a)', [{ text: 'x', url: 'https://n.so/a' }])).toBe('- x [notion](https://n.so/a)');
    expect(applyLinks('- [x](https://n.so/a)', [{ text: 'x', url: 'https://n.so/a' }])).toBe('- [x](https://n.so/a)');
    expect(applyLinks('Hello', [{ text: 'bye', url: 'https://n.so/c' }])).toBe('Hello');
  });
});

describe('an item a board names', () => {
  const url = 'https://app.notion.com/p/Add-task-input-3dd5';

  it('sends what the item says, never the anchor', () => {
    const body = '- [ ] Add task input and button dont match up ^add-task-input\n- ^only-a-name';
    expect(unsentItems(body)).toEqual([{ line: 1, text: 'Add task input and button dont match up' }]);
    expect(itemWords('- [ ] Add task input ^add-task-input')).toBe('Add task input');
    expect(itemAt('- [ ] Add task input ^add-task-input', 4)).toEqual({ line: 4, text: 'Add task input' });
  });

  it('writes the mark before the anchor, so the anchor still ends the line', () => {
    expect(linkedLine('- [ ] Add task input ^add-task-input', url)).toBe(`- [ ] Add task input [notion](${url}) ^add-task-input`);
    expect(linkedLine('  - Ask Sam ^ask-sam', url, 'github')).toBe(`  - Ask Sam [github](${url}) ^ask-sam`);
    // Linked again, the old mark is replaced and the anchor stays last.
    expect(linkedLine(`- [ ] Add task input [notion](${url}) ^add-task-input`, 'https://app.notion.com/p/new')).toBe(
      '- [ ] Add task input [notion](https://app.notion.com/p/new) ^add-task-input',
    );
  });

  it('reads the mark with an anchor after it, and keeps the anchor when the mark comes off', () => {
    const line = `Add task input [notion](${url}) ^add-task-input`;
    expect(markOf(line)).toEqual({ name: 'notion', url });
    expect(unmarked(line)).toBe('Add task input ^add-task-input');
    expect(itemWords(`- [ ] ${line}`)).toBe('Add task input');
    // A caret that is a superscript is not an anchor, and does not hide a mark before it.
    expect(markOf(`E = mc^2^ [notion](${url})`)).toEqual({ name: 'notion', url });
    expect(unmarked('E = mc^2^')).toBe('E = mc^2^');
  });

  it('is not linked twice when its mark sits before its anchor', () => {
    expect(unsentItems(`- [ ] Add task input [notion](${url}) ^add-task-input`)).toEqual([]);
  });

  it('puts a mark back before the anchor', () => {
    expect(withMark('- [ ] Ship it ^ship-it', `[notion](${url})`)).toBe(`- [ ] Ship it [notion](${url}) ^ship-it`);
    expect(withMark('- [ ] Ship it', `[notion](${url})`)).toBe(`- [ ] Ship it [notion](${url})`);
    expect(applyLinks('- [ ] Ship it ^ship-it', [{ text: 'Ship it', url }])).toBe(`- [ ] Ship it [notion](${url}) ^ship-it`);
  });
});

describe('a choice or a counter on an item', () => {
  const url = 'https://app.notion.com/p/Pack-3dd5';

  it('sends what the item says: no choice box, no counter', () => {
    expect(itemWords('- ( ) Pick the red one')).toBe('Pick the red one');
    expect(itemWords('- (x) Pick the blue one ^blue')).toBe('Pick the blue one');
    expect(itemWords('- [ ] Pack socks [3/8] ^pack-socks')).toBe('Pack socks');
    expect(itemWords('1. ( ) Numbered, so words')).toBe('( ) Numbered, so words');
    expect(unsentItems('- ( ) Pick red\n- [ ] Pack socks [3/8]')).toEqual([
      { line: 1, text: 'Pick red' },
      { line: 2, text: 'Pack socks' },
    ]);
  });

  it('keeps the box and the counter in the line when the mark goes on, and the mark before them at the end', () => {
    expect(linkedLine('- ( ) Pick red', url)).toBe(`- ( ) Pick red [notion](${url})`);
    expect(linkedLine('- [ ] Pack socks ^pack-socks [3/8]', url)).toBe(`- [ ] Pack socks [notion](${url}) ^pack-socks [3/8]`);
    // The sent item is found again by what it says, box and counter aside.
    expect(itemAt('- [ ] Pack socks [3/8]', 5)).toEqual({ line: 5, text: 'Pack socks' });
  });

  it('reads the mark with a counter typed after it, and does not send the item again', () => {
    const line = `- [ ] Pack socks [notion](${url}) [4/8]`;
    expect(markOf(line)).toEqual({ name: 'notion', url });
    expect(unmarked(`Pack socks [notion](${url}) [4/8] ^pack-socks`)).toBe('Pack socks [4/8] ^pack-socks');
    expect(unsentItems(line)).toEqual([]);
    expect(withMark('- [ ] Pack socks [4/8]', `[notion](${url})`)).toBe(`- [ ] Pack socks [notion](${url}) [4/8]`);
  });

  it('never sends the bookmark as part of a title, and puts the mark after it', () => {
    expect(itemWords('- [ ] Pack socks §§ ^pack-socks')).toBe('Pack socks');
    expect(unsentItems('- [ ] Pack socks §§')).toEqual([{ line: 1, text: 'Pack socks' }]);
    expect(linkedLine('- [ ] Pack socks §§ ^pack-socks', url)).toBe(`- [ ] Pack socks §§ [notion](${url}) ^pack-socks`);
    expect(markOf(`- [ ] Pack socks §§ [notion](${url}) ^pack-socks`)).toEqual({ name: 'notion', url });
  });
});
