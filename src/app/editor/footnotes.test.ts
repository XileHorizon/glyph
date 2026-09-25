import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { glyphMarkdown } from './language.ts';
import { footnotes, footnotesIn, noteAtPos } from './footnotes.ts';

const doc = [
  'The deposit is four hundred[^sam], not four fifty[^bank].',
  '',
  '[^sam]: Sam said so on the phone.',
  '[^bank]: The bank statement disagrees.',
].join('\n');

function drawn(text: string) {
  const view = new EditorView({ state: EditorState.create({ doc: text, extensions: [glyphMarkdown([], []), footnotes()] }), parent: document.body });
  const html = view.contentDOM.innerHTML;
  const state = view.state;
  view.destroy();
  return { html, state };
}

describe('the footnotes a note defines', () => {
  it('reads each one by name, with what it says', () => {
    expect(footnotesIn(doc)).toEqual([
      { name: 'sam', text: 'Sam said so on the phone.', line: 3 },
      { name: 'bank', text: 'The bank statement disagrees.', line: 4 },
    ]);
  });

  it('takes the first of a name written twice, and nothing from a note with none', () => {
    expect(footnotesIn('[^a]: one\n[^a]: two')).toHaveLength(1);
    expect(footnotesIn('just words')).toEqual([]);
  });
});

describe('how they are drawn', () => {
  it('raises a marker that has a definition, and sets the definition quietly', () => {
    const { html } = drawn(doc);
    expect(html).toContain('cm-footMark');
    expect(html).toContain('cm-footDefinition');
  });

  it('leaves a marker with nothing to point at as plain words', () => {
    expect(drawn('a claim[^nowhere] here').html).not.toContain('cm-footMark');
  });

  it('never marks the definition’s own name as a reference', () => {
    const { html } = drawn('[^sam]: Sam said so.');
    expect(html).not.toContain('cm-footMark');
  });
});

describe('what a tap on a marker finds', () => {
  it('answers the footnote under that position, and nothing elsewhere', () => {
    const { state } = drawn(doc);
    const notes = footnotesIn(doc);
    const at = doc.indexOf('[^sam]') + 2;
    expect(noteAtPos(state, notes, at)?.text).toBe('Sam said so on the phone.');
    expect(noteAtPos(state, notes, 3)).toBeNull();
    // The definition line is not a reference to itself.
    expect(noteAtPos(state, notes, doc.indexOf('[^sam]: ') + 2)).toBeNull();
  });
});
