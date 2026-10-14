import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { Bookmark } from '@glacier/icons';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BOOKMARK_PATH, bookmarkLineIn, bookmarkRibbon, markedWords, placeBookmark, showBookmark } from './bookmarkLine.ts';

const doc = [
  '# Launch week',
  '',
  '- [ ] Write the *pricing* page ^pricing-page',
  '',
  '   ',
  'A line of ordinary words that runs on well past the room a toast has',
].join('\n');

let view: EditorView | null = null;

function editor(text = doc): EditorView {
  view = new EditorView({ state: EditorState.create({ doc: text, extensions: [bookmarkRibbon()] }), parent: document.body });
  return view;
}

/** Which lines carry the ribbon, counting from 1. */
function ribboned(on: EditorView): number[] {
  return [...on.contentDOM.querySelectorAll('.cm-bookmarked')].map((line) => [...on.contentDOM.children].indexOf(line) + 1);
}

afterEach(() => {
  view?.destroy();
  view = null;
});

describe('the bookmark shown in the note', () => {
  it('marks nothing until a place is given, then the line that place is on', () => {
    const on = editor();
    expect(ribboned(on)).toEqual([]);
    on.dispatch({ effects: showBookmark.of(on.state.doc.line(3).from + 4) });
    expect(ribboned(on)).toEqual([3]);
  });

  it('comes off again, and holds a place past the end of the note', () => {
    const on = editor();
    on.dispatch({ effects: showBookmark.of(on.state.doc.line(3).from) });
    on.dispatch({ effects: showBookmark.of(null) });
    expect(ribboned(on)).toEqual([]);
    on.dispatch({ effects: showBookmark.of(9999) });
    expect(ribboned(on)).toEqual([6]);
  });

  it('stays on its words when the note is typed into above them', () => {
    const on = editor();
    on.dispatch({ effects: showBookmark.of(on.state.doc.line(3).from) });
    on.dispatch({ changes: { from: 0, insert: 'A first line\n' } });
    expect(ribboned(on)).toEqual([4]);
  });
});

describe('the words a bookmark sits on', () => {
  it('says them without the marks that shape them', () => {
    const on = editor();
    expect(markedWords(on, on.state.doc.line(1).from)).toBe('Launch week');
    expect(markedWords(on, on.state.doc.line(3).from)).toBe('Write the pricing page');
  });

  it('looks past blank lines, and cuts a long line short', () => {
    const on = editor();
    expect(markedWords(on, on.state.doc.line(4).from)).toBe('A line of ordinary words that…');
    expect(markedWords(editor('   \n\n'), 0)).toBeNull();
  });
});

describe('a place on a blank line', () => {
  it('ribbons the next line that has words, so the mark is where the words are', () => {
    const on = editor();
    on.dispatch({ effects: showBookmark.of(on.state.doc.line(2).from) });
    expect(ribboned(on)).toEqual([3]);
    expect(markedWords(on, on.state.doc.line(2).from)).toBe('Write the pricing page');
  });
});

describe('the bookmark written in the note', () => {
  const put = (doc: string, line: number | null) => {
    const state = EditorState.create({ doc });
    return state.update(placeBookmark(state, line)).state.doc.toString();
  };

  it('goes at the end of a line, and before a list item’s mark, counter and anchor', () => {
    expect(put('The deposit is four hundred.', 1)).toBe('The deposit is four hundred. §§');
    expect(put('- [ ] Ship it [notion](https://notion.so/a) ^ship-it', 1)).toBe('- [ ] Ship it §§ [notion](https://notion.so/a) ^ship-it');
    expect(put('- Water [3/8]', 1)).toBe('- Water §§ [3/8]');
  });

  it('moves from wherever it was, keeping one, and comes off with null', () => {
    const doc = 'One line §§\nTwo line\n- [ ] Three §§ ^three';
    expect(put(doc, 2)).toBe('One line\nTwo line §§\n- [ ] Three ^three');
    expect(put(doc, 3)).toBe('One line\nTwo line\n- [ ] Three §§ ^three');
    expect(put(doc, null)).toBe('One line\nTwo line\n- [ ] Three ^three');
    expect(bookmarkLineIn('a\nb §§\nc')).toBe(2);
    expect(bookmarkLineIn('a § b')).toBeNull();
  });
});

/*
 * The mark on the page and the button that put it there are one icon (Matt: "The bookmark icon that renders in the
 * code should match the bookmark icon in the top controls"). The widget has to copy lucide's path, since a widget is
 * plain DOM; this is what stops the copy drifting when lucide redraws the icon.
 */
describe('the bookmark drawn on the page', () => {
  it('is the same shape as the Bookmark button draws', () => {
    const drawn = renderToStaticMarkup(createElement(Bookmark));
    expect(/<path[^>]*\sd="([^"]+)"/.exec(drawn)?.[1]).toBe(BOOKMARK_PATH);
  });

  it('wears lucide’s classes, so the one rule that washes the button’s icon washes this too', () => {
    const view = new EditorView({ state: EditorState.create({ doc: 'Marked here §§', extensions: bookmarkRibbon() }) });
    const svg = view.dom.querySelector('.cm-bookmarkMark svg');
    expect(svg?.getAttribute('class')).toBe('lucide lucide-bookmark');
    expect(svg?.querySelector('path')?.getAttribute('d')).toBe(BOOKMARK_PATH);
    view.destroy();
  });

  it('sits in a line wearing the gold, which ink.css works out against that line’s own paper', () => {
    const view = new EditorView({ state: EditorState.create({ doc: 'Marked here §§', extensions: bookmarkRibbon() }) });
    expect(view.dom.querySelector('.cm-bookmarkMark')?.closest('.cm-bookmarked')?.classList.contains('app-gold')).toBe(true);
    view.destroy();
  });
});
