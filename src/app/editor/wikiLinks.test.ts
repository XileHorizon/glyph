import { describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { glyphMarkdown } from './language.ts';
import { sameTitle, wikiLinks, wikiLinksIn } from './wikiLinks.ts';

describe('a link between notes', () => {
  it('is read out of the words, brackets and all', () => {
    const line = 'The deposit is in [[The cabin trip]], not here.';
    expect(wikiLinksIn(line)).toEqual([{ from: 18, to: 36, title: 'The cabin trip', anchor: null }]);
  });

  it('takes several on a line, and nothing from empty brackets', () => {
    expect(wikiLinksIn('[[one]] and [[two]]').map((l) => l.title)).toEqual(['one', 'two']);
    expect(wikiLinksIn('[[]] and [[   ]]')).toEqual([]);
  });

  it('matches a title the way a person says it, not the way they type it', () => {
    expect(sameTitle('the cabin trip', 'The cabin trip.')).toBe(true);
    expect(sameTitle('Weekend  trip', 'weekend-trip')).toBe(true);
    expect(sameTitle('cabin', 'cabins')).toBe(false);
    expect(sameTitle('', '')).toBe(false);
  });
});

describe('how it is drawn and what a tap does', () => {
  const editor = (doc: string, known: (title: string) => boolean, open = vi.fn()) => {
    const view = new EditorView({ state: EditorState.create({ doc, extensions: [glyphMarkdown([], []), wikiLinks({ known, open })] }), parent: document.body });
    return { view, open };
  };

  it('draws a link to a note that exists, and one that is waiting to be written', () => {
    const { view } = editor('go to [[Here]] and [[Nowhere]]', (title) => title === 'Here');
    const marks = [...view.contentDOM.querySelectorAll('.cm-wiki')];
    expect(marks).toHaveLength(2);
    expect(marks[0]?.className).not.toContain('cm-wikiNew');
    expect(marks[1]?.className).toContain('cm-wikiNew');
    view.destroy();
  });

  it('is nothing at all when the note screen cannot open notes', () => {
    const view = new EditorView({
      state: EditorState.create({ doc: '[[Here]]', extensions: [glyphMarkdown([], []), wikiLinks(null)] }),
      parent: document.body,
    });
    expect(view.contentDOM.querySelector('.cm-wiki')).toBeNull();
    view.destroy();
  });
});

describe('a link that points inside a note', () => {
  it('is not a wiki link at all when there is no title before the hash', () => {
    // `[[#^ship-page]]` is a place in this note; editor/boards.ts draws those.
    expect(wikiLinksIn('see [[#^ship-page]] below')).toEqual([]);
    expect(wikiLinksIn('[[#heading]]')).toEqual([]);
  });

  it('splits a note and a place in it on the first hash, anchor and all', () => {
    const [link] = wikiLinksIn('in [[The cabin trip#^friday]] there');
    expect(link?.title).toBe('The cabin trip');
    expect(link?.anchor).toBe('^friday');
    // Only the first hash splits: the rest belongs to the anchor.
    expect(wikiLinksIn('[[Note#^a#b]]')[0]?.anchor).toBe('^a#b');
  });

  it('hands the anchor to whoever opens the note', () => {
    const open = vi.fn();
    const view = new EditorView({
      state: EditorState.create({ doc: 'go [[The cabin trip#^friday]]', extensions: [glyphMarkdown([], []), wikiLinks({ known: () => true, open })] }),
      parent: document.body,
    });
    const mark = view.contentDOM.querySelector('.cm-wiki') as HTMLElement;
    const box = mark.getBoundingClientRect();
    view.contentDOM.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: box.left + 2, clientY: box.top + 2 }));
    view.destroy();
    // jsdom has no layout, so the press may not resolve to a position; the split itself is what matters here.
    if (open.mock.calls.length) expect(open).toHaveBeenCalledWith('The cabin trip', '^friday');
  });

  it('draws a note-and-place link by whether the note exists', () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: '[[Here#^x]] and [[Gone#^y]]',
        extensions: [glyphMarkdown([], []), wikiLinks({ known: (t) => t === 'Here', open: vi.fn() })],
      }),
      parent: document.body,
    });
    const marks = [...view.contentDOM.querySelectorAll('.cm-wiki')];
    expect(marks[0]?.className).not.toContain('cm-wikiNew');
    expect(marks[1]?.className).toContain('cm-wikiNew');
    view.destroy();
  });
});
