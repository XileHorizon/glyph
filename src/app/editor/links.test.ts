import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { provideMarkDetails, type MarkDetailsProvider } from '../core/markDetails.ts';
import { drawnBoards } from './boards.ts';
import { glyphMarkdown } from './language.ts';
import { shortLinks } from './links.ts';

function open(doc: string, caret: number) {
  const state = EditorState.create({ doc, selection: { anchor: caret }, extensions: [glyphMarkdown(), shortLinks()] });
  return new EditorView({ state, parent: document.createElement('div') });
}

describe('item marks in the editor', () => {
  const URL = 'https://www.notion.so/attackfm/Buy-milk-1a2b3c4d5e6f';

  it('draws the mark at the end of an item as one pill with the name on it', () => {
    const view = open(`- [ ] Buy milk [notion](${URL})\nplain\n`, 0);
    const pills = [...view.contentDOM.querySelectorAll('.cm-itemMark')];
    expect(pills.map((p) => p.textContent)).toEqual(['Notion']);
    expect(pills[0]?.getAttribute('title')).toBe(URL);
    // The mark's own address is inside the pill, not shortened beside it.
    expect(view.contentDOM.querySelectorAll('.cm-shortLink')).toHaveLength(0);
    view.destroy();
  });

  it('leaves an ordinary link alone: its address is shortened, the words stay', () => {
    const view = open(`- [ ] read [the board](${URL})\n`, 0);
    expect(view.contentDOM.querySelectorAll('.cm-itemMark')).toHaveLength(0);
    expect(view.contentDOM.querySelectorAll('.cm-shortLink')).toHaveLength(1);
    view.destroy();
  });

  it('is still the mark with a board\u2019s anchor after it', () => {
    const view = open(`- [ ] Buy milk [notion](${URL}) ^buy-milk\n`, 0);
    expect([...view.contentDOM.querySelectorAll('.cm-itemMark')].map((p) => p.textContent)).toEqual(['Notion']);
    view.destroy();
  });

  it('is still the mark with a counter after it', () => {
    const view = open(`- [ ] Pack socks [notion](${URL}) [3/8] ^pack-socks\n`, 0);
    expect([...view.contentDOM.querySelectorAll('.cm-itemMark')].map((p) => p.textContent)).toEqual(['Notion']);
    view.destroy();
  });

  it('is not a mark when something follows it on the line, or the line is not an item', () => {
    const view = open(`- [ ] Buy milk [notion](${URL}) today\nSee [notion](${URL})\n`, 0);
    expect(view.contentDOM.querySelectorAll('.cm-itemMark')).toHaveLength(0);
    view.destroy();
  });
});

describe('reading the tasks on a board', () => {
  /**
   * A board sits where its fence is, and its cards are items written further down the note, often far out of view.
   * The board on screen is what a person looks at to see a task move to Done, so its cards are read while it shows,
   * wherever their lines are (Matt: "a lot of the notion tickets aren't moved to done").
   */
  const wanted: string[] = [];
  const reader: MarkDetailsProvider = { peek: () => null, want: (url) => void wanted.push(url), open: async () => undefined };

  function note(below: number): string {
    const filler = Array.from({ length: below }, (_, i) => `Line ${i + 1}, pushing the list down the page.`).join('\n\n');
    const items = [
      ...['a', 'b'].map((ch) => `- [ ] Task ${ch} [notion](https://app.notion.com/p/Task-${ch}-${ch.repeat(32)}) ^task-${ch}`),
      // Ticked, and a bullet with no box: neither can move, so neither is read from the board.
      `- [x] Task c [notion](https://app.notion.com/p/Task-c-${'c'.repeat(32)}) ^task-c`,
      `- Task d [notion](https://app.notion.com/p/Task-d-${'d'.repeat(32)}) ^task-d`,
    ].join('\n');
    return `# Tasks\n\n\`\`\`board height=25\nTo do: task-a, task-d\nDone: task-b, task-c\n\`\`\`\n\n${filler}\n\n${items}\n\n${filler}\n\n\`\`\`board\nLater: task-a\n\`\`\`\n`;
  }

  it('reads the open to-dos on a board in view, however far down their items are', () => {
    provideMarkDetails('notion', () => reader);
    wanted.length = 0;
    const view = new EditorView({ state: EditorState.create({ doc: note(400), extensions: [glyphMarkdown(), drawnBoards(), shortLinks()] }), parent: document.body });
    const itemLine = view.state.doc.lineAt(view.state.doc.toString().indexOf('- [ ] Task a')).from;
    // The items are out of view: only the board can have asked for them.
    expect(itemLine).toBeGreaterThan(view.viewport.to);
    expect(wanted).toEqual([`https://app.notion.com/p/Task-a-${'a'.repeat(32)}`, `https://app.notion.com/p/Task-b-${'b'.repeat(32)}`]);
    view.destroy();
  });

  it('leaves a board out of view alone, as it does the lines out of view', () => {
    provideMarkDetails('notion', () => reader);
    wanted.length = 0;
    const doc = `${Array.from({ length: 400 }, () => 'Words.').join('\n\n')}\n\n${note(0)}`;
    const view = new EditorView({ state: EditorState.create({ doc, extensions: [glyphMarkdown(), drawnBoards(), shortLinks()] }), parent: document.body });
    expect(wanted).toEqual([]);
    view.destroy();
  });
});
