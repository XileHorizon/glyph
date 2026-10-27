import { cursorCharRight } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseWhole } from '../../test/syntaxTree.ts';
import { glyphMarkdown } from './language.ts';
import { isNoteView, noteView, shownView, type NoteDisplay } from './viewMode.ts';

const doc = ['# Packing', '**Warm** things, _dry_ ones, ~~wet~~ none, and `code` as written: \\*one\\*', '- [ ] Tent', '> Pack light'].join('\n');

let view: EditorView | null = null;

function open(shown: NoteDisplay, text = doc): EditorView {
  view = parseWhole(new EditorView({ state: EditorState.create({ doc: text, extensions: [glyphMarkdown(), noteView(shown)] }), parent: document.body }));
  return view;
}
/** What a line reads as on the page. */
const line = (on: EditorView, n: number) => on.contentDOM.querySelectorAll('.cm-line')[n - 1]?.textContent;

afterEach(() => {
  view?.destroy();
  view = null;
});

describe('the Formatted view', () => {
  it('hides the marks that only say how words look, a heading’s and a quote’s with the space after them', () => {
    const on = open('formatted');
    expect(line(on, 1)).toBe('Packing');
    expect(line(on, 2)).toBe('Warm things, dry ones, wet none, and code as written: *one*');
    expect(line(on, 4)).toBe('Pack light');
  });

  it('keeps a list’s dash and a to-do’s box, which are part of how a list looks', () => {
    expect(line(open('formatted'), 3)).toBe('- [ ] Tent');
  });

  it('steps the caret over a hidden mark rather than into it', () => {
    const on = open('formatted');
    const start = on.state.doc.line(2).from;
    on.dispatch({ selection: { anchor: start } });
    cursorCharRight(on);
    expect(on.state.selection.main.head).toBe(start + 2);
  });

  it('shows the marks on the line being written, while the note has focus', async () => {
    const on = open('formatted');
    on.focus();
    on.dispatch({ selection: { anchor: on.state.doc.line(2).from + 3 } });
    await vi.waitFor(() => expect(line(on, 2)).toContain('**Warm**'));
    expect(line(on, 1)).toBe('Packing');
  });
});

describe('the Markdown view', () => {
  it('adds nothing: every mark stays on the page', () => {
    const on = open('mixed');
    expect(line(on, 1)).toBe('# Packing');
    expect(line(on, 2)).toContain('**Warm**');
    expect(noteView('mixed')).toEqual([]);
  });

  it('is one of the two views a preference can hold', () => {
    expect(isNoteView('formatted')).toBe(true);
    expect(isNoteView('mixed')).toBe(true);
    expect(isNoteView('styled')).toBe(false);
    expect(isNoteView(undefined)).toBe(false);
  });
});

describe('the Margin view', () => {
  /** The marks hung in the margin's column, as the page has them. */
  const hung = (on: EditorView) => [...on.contentDOM.querySelectorAll('.cm-hangMark')].map((mark) => mark.textContent);

  it('hangs a line’s leading mark, with the space after it, and keeps every character on the page', () => {
    const on = open('margin');
    expect(hung(on)).toEqual(['# ', '- ', '> ']);
    expect(line(on, 1)).toBe('# Packing');
    expect(line(on, 3)).toBe('- [ ] Tent');
    expect(on.dom.classList.contains('cm-marginMarks')).toBe(true);
  });

  it('hangs only what starts a line: a nested item’s bullet after its indent, a quote’s > before its list’s dash, never a closing #', () => {
    const on = open('margin', ['## Done ##', '1. One', '  - Two', '> - Three'].join('\n'));
    expect(hung(on)).toEqual(['## ', '1. ', '- ', '> ']);
  });

  it('is the mark still: typing in front of it edits the note', () => {
    const on = open('margin');
    on.dispatch({ changes: { from: 0, insert: '#' } });
    expect(on.state.doc.line(1).text).toBe('## Packing');
    expect(hung(on)[0]).toBe('## ');
  });

  it('is Markdown with the margin setting on, and never Formatted', () => {
    expect(shownView({ noteView: 'mixed', marksInMargin: true })).toBe('margin');
    expect(shownView({ noteView: 'mixed', marksInMargin: false })).toBe('mixed');
    expect(shownView({ noteView: 'formatted', marksInMargin: true })).toBe('formatted');
    expect(isNoteView('margin')).toBe(false);
  });
});
