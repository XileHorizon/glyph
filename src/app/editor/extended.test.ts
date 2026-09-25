import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { glyphMarkdown } from './language.ts';
import { calloutKind, extendedMarkdown } from './extended.ts';

function drawn(doc: string) {
  const view = new EditorView({ state: EditorState.create({ doc, extensions: [glyphMarkdown([], []), extendedMarkdown()] }), parent: document.body });
  const html = view.contentDOM.innerHTML;
  const callouts = [...view.contentDOM.querySelectorAll('.cm-callout')].map((line) => line.getAttribute('data-callout'));
  view.destroy();
  return { html, callouts };
}

describe('the extended markdown the language already parsed', () => {
  it('raises a superscript and lowers a subscript, marks and all', () => {
    expect(drawn('x^2^ metres').html).toContain('cm-sup');
    expect(drawn('H~2~O').html).toContain('cm-sub');
    // The marks are still there to edit: nothing is hidden.
    expect(drawn('x^2^ metres').html).toContain('^');
  });

  it('leaves a lone caret or tilde alone', () => {
    expect(drawn('2 ^ 3 and a ~ b').html).not.toContain('cm-sup');
    expect(drawn('~~struck~~').html).not.toContain('cm-sub');
  });
});

describe('a callout', () => {
  it('is a quote whose first line names its kind', () => {
    expect(calloutKind('> [!NOTE]')).toBe('note');
    expect(calloutKind('> [!warning] mind this')).toBe('warning');
    expect(calloutKind('> an ordinary quote')).toBeNull();
    expect(calloutKind('> [!SHOUTING]')).toBeNull();
  });

  it('wears its kind on every line of the quote', () => {
    expect(drawn('> [!TIP]\n> Try the side key.\n> It is quicker.').callouts).toEqual(['tip', 'tip', 'tip']);
  });

  it('leaves an ordinary quote as a quote', () => {
    expect(drawn('> just a quote\n> over two lines').callouts).toEqual([]);
  });
});

describe('front matter', () => {
  it('is the note’s opening fence and its keys, drawn as keys rather than a rule', () => {
    const view = new EditorView({
      state: EditorState.create({ doc: '---\ntitle: A note\ntags: one, two\n---\n\nWords.', extensions: [glyphMarkdown([], []), extendedMarkdown()] }),
      parent: document.body,
    });
    expect(view.contentDOM.querySelectorAll('.cm-front')).toHaveLength(4);
    view.destroy();
  });

  it('is not a rule in the middle of a note, nor a fence with prose under it', () => {
    expect(drawn('Words.\n\n---\n\nMore.').html).not.toContain('cm-front');
    expect(drawn('---\njust some words\n---').html).not.toContain('cm-front');
  });
});

describe('a definition list', () => {
  it('sets the term apart and hangs the meaning under it', () => {
    const { html } = drawn('Deposit\n: what you pay up front');
    expect(html).toContain('cm-term');
    expect(html).toContain('cm-definition');
  });

  it('leaves a colon that starts an ordinary line alone', () => {
    expect(drawn('Words\n\n:not a definition').html).not.toContain('cm-definition');
  });
});

describe('maths', () => {
  it('sets both kinds as code, delimiters and all', () => {
    expect(drawn('when $x^2 + y$ holds').html).toContain('cm-maths');
    expect(drawn('$$\nx = y\n$$').html).not.toContain('cm-maths');
    expect(drawn('the sum $$a + b$$ inline').html).toContain('cm-maths');
  });

  it('leaves a price alone', () => {
    expect(drawn('it cost $20 and $30').html).toContain('cm-maths');
  });
});

describe('an emoji shortcode', () => {
  it('is drawn as its emoji', () => {
    const view = new EditorView({
      state: EditorState.create({ doc: 'words\nparty :tada: time', extensions: [glyphMarkdown([], []), extendedMarkdown()] }),
      parent: document.body,
    });
    expect(view.contentDOM.querySelector('.cm-emoji')?.textContent).toBe('🎉');
    view.destroy();
  });

  it('comes back as words while the caret is on its line', () => {
    const view = new EditorView({
      state: EditorState.create({ doc: 'party :tada: time', selection: { anchor: 2 }, extensions: [glyphMarkdown([], []), extendedMarkdown()] }),
      parent: document.body,
    });
    expect(view.contentDOM.querySelector('.cm-emoji')).toBeNull();
    view.destroy();
  });

  it('leaves a name it does not know as the words that were typed', () => {
    expect(drawn('a :not_an_emoji_name: here').html).not.toContain('cm-emoji');
  });
});
