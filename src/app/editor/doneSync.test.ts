import { beforeEach, describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undo } from '@codemirror/commands';
import { markDetailsChanged, provideMarkDetails, type MarkAction, type MarkDetails, type MarkEntry } from '../core/markDetails.ts';
import { doneSync } from './doneSync.ts';

const answers = new Map<string, MarkEntry | null>();
/** What the service was asked to do, and whether it can write tasks at all. */
const sent: string[] = [];
let writable = false;
provideMarkDetails('notion', () => ({
  peek: (url) => answers.get(url) ?? null,
  want: () => undefined,
  open: () => Promise.resolve(),
  reads: (url) => url.startsWith('https://www.notion.so/'),
  actions: (url): MarkAction[] => {
    const entry = answers.get(url);
    if (!writable || entry?.state !== 'ready') return [];
    const done = entry.details.status?.stage === 'done';
    return [
      {
        id: done ? 'reopen' : 'done',
        label: '',
        busyLabel: '',
        icon: done ? 'reopen' : 'done',
        run: async () => {
          sent.push(`${done ? 'reopen' : 'done'} ${url}`);
          answers.set(url, ready(url, done ? 'todo' : 'done', { editedAt: (entry.details.editedAt ?? 0) + 500 }));
        },
      },
    ];
  },
}));

const A = 'https://www.notion.so/a-1234';
const B = 'https://www.notion.so/b-5678';

function ready(url: string, stage: MarkDetails['status'] extends infer S ? (S extends { stage: infer G } ? G : never) : never, extra: Partial<MarkDetails> = {}): MarkEntry {
  return {
    state: 'ready',
    loading: false,
    details: { url, title: 'A task', status: { label: stage === 'done' ? 'Done' : 'To do', stage }, brief: [], fields: [], editedAt: 1000, readAt: 2000, ...extra },
  };
}

function open(doc: string): EditorView {
  const state = EditorState.create({ doc, extensions: [history(), doneSync()] });
  return new EditorView({ state, parent: document.createElement('div') });
}

const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('ticking a to-do whose task is done', () => {
  beforeEach(() => {
    answers.clear();
    sent.length = 0;
    writable = false;
  });

  it('ticks the box of an item whose task reads as done, and leaves the rest', async () => {
    answers.set(A, ready(A, 'done'));
    answers.set(B, ready(B, 'doing'));
    const view = open(`- [ ] milk [notion](${A})\n- [ ] eggs [notion](${B})\n- [ ] bread\n  - [ ] jam [notion](${A})\nplain [notion](${A})\n`);
    await settled();
    expect(view.state.doc.toString()).toBe(`- [x] milk [notion](${A})\n- [ ] eggs [notion](${B})\n- [ ] bread\n  - [x] jam [notion](${A})\nplain [notion](${A})\n`);
    view.destroy();
  });

  it('ticks when the answer arrives later, and not for a task in the trash', async () => {
    const view = open(`- [ ] milk [notion](${A})\n- [ ] eggs [notion](${B})\n`);
    await settled();
    expect(view.state.doc.toString()).toContain('- [ ] milk');
    answers.set(A, ready(A, 'done'));
    answers.set(B, ready(B, 'done', { gone: true }));
    markDetailsChanged();
    await settled();
    expect(view.state.doc.toString()).toBe(`- [x] milk [notion](${A})\n- [ ] eggs [notion](${B})\n`);
    view.destroy();
  });

  it('is not undone with typing, and does not fight a box unticked by hand', async () => {
    answers.set(A, ready(A, 'done'));
    const view = open(`- [ ] milk [notion](${A})\n`);
    await settled();
    expect(view.state.doc.toString()).toBe(`- [x] milk [notion](${A})\n`);
    view.dispatch({ changes: { from: view.state.doc.length, insert: 'more' }, userEvent: 'input.type' });
    undo(view);
    expect(view.state.doc.toString()).toBe(`- [x] milk [notion](${A})\n`);
    // Unticked on purpose: the same answer from Notion does not tick it again.
    view.dispatch({ changes: { from: 3, to: 4, insert: ' ' }, userEvent: 'input.type' });
    markDetailsChanged();
    await settled();
    expect(view.state.doc.toString()).toBe(`- [ ] milk [notion](${A})\n`);
    // The task changed in Notion since: it does.
    answers.set(A, ready(A, 'done', { editedAt: 3000 }));
    markDetailsChanged();
    await settled();
    expect(view.state.doc.toString()).toBe(`- [x] milk [notion](${A})\n`);
    view.destroy();
  });

  it('ticks an item linked the old way, its words the link', async () => {
    answers.set(A, ready(A, 'done'));
    const view = open(`- [ ] [milk](${A})\n- [ ] read the [docs](https://example.com/d)\n`);
    await settled();
    expect(view.state.doc.toString()).toBe(`- [x] [milk](${A})\n- [ ] read the [docs](https://example.com/d)\n`);
    view.destroy();
  });

  it('ticks a linked item pasted into the note', async () => {
    answers.set(A, ready(A, 'done'));
    const view = open('plain\n');
    await settled();
    view.dispatch({ changes: { from: view.state.doc.length, insert: `- [ ] milk [notion](${A})\n` } });
    await settled();
    expect(view.state.doc.toString()).toBe(`plain\n- [x] milk [notion](${A})\n`);
    view.destroy();
  });

  it('moves the item\'s card to Done, so a board says what its ticks say', async () => {
    answers.set(A, ready(A, 'done'));
    const view = open(`# Jobs\n\n\`\`\`board\nTo do: milk, eggs\nDoing:\nDone:\n\`\`\`\n\n- [ ] milk [notion](${A}) ^milk\n- [ ] eggs ^eggs\n`);
    await settled();
    expect(view.state.doc.toString()).toContain('- [x] milk');
    expect(view.state.doc.toString()).toContain('To do: eggs\nDoing:\nDone: milk');
    view.destroy();
  });

  it('unticks the box of a task reopened in the service', async () => {
    answers.set(A, ready(A, 'done'));
    const view = open(`- [ ] milk [notion](${A})\n`);
    await settled();
    expect(view.state.doc.toString()).toBe(`- [x] milk [notion](${A})\n`);
    answers.set(A, ready(A, 'doing', { editedAt: 5000 }));
    markDetailsChanged();
    await settled();
    expect(view.state.doc.toString()).toBe(`- [ ] milk [notion](${A})\n`);
    view.destroy();
  });
});

describe('a box ticked in the note', () => {
  beforeEach(() => {
    answers.clear();
    sent.length = 0;
    writable = true;
  });

  it('marks its task done, and reopens it when unticked', async () => {
    answers.set(A, ready(A, 'todo'));
    const view = open(`- [ ] milk [notion](${A})\n- [ ] bread\n`);
    await settled();
    view.dispatch({ changes: { from: 3, to: 4, insert: 'x' }, userEvent: 'input' });
    await settled();
    await settled();
    expect(sent).toEqual([`done ${A}`]);
    expect(view.state.doc.toString()).toBe(`- [x] milk [notion](${A})\n- [ ] bread\n`);
    view.dispatch({ changes: { from: 3, to: 4, insert: ' ' }, userEvent: 'input' });
    await settled();
    await settled();
    expect(sent).toEqual([`done ${A}`, `reopen ${A}`]);
    expect(view.state.doc.toString()).toBe(`- [ ] milk [notion](${A})\n- [ ] bread\n`);
    view.destroy();
  });

  it('sends nothing for a plain to-do, or for a box the sync itself set', async () => {
    answers.set(A, ready(A, 'done'));
    const view = open(`- [ ] milk [notion](${A})\n- [ ] bread\n`);
    await settled();
    await settled();
    expect(view.state.doc.toString()).toBe(`- [x] milk [notion](${A})\n- [ ] bread\n`);
    view.dispatch({ changes: { from: view.state.doc.line(2).from + 3, to: view.state.doc.line(2).from + 4, insert: 'x' }, userEvent: 'input' });
    await settled();
    expect(sent).toEqual([]);
    view.destroy();
  });

  it('keeps a box ticked by hand when its task can’t be written', async () => {
    writable = false;
    answers.set(A, ready(A, 'todo'));
    const view = open(`- [ ] milk [notion](${A})\n`);
    await settled();
    view.dispatch({ changes: { from: 3, to: 4, insert: 'x' }, userEvent: 'input' });
    await settled();
    markDetailsChanged();
    await settled();
    expect(sent).toEqual([]);
    expect(view.state.doc.toString()).toBe(`- [x] milk [notion](${A})\n`);
    view.destroy();
  });
});
