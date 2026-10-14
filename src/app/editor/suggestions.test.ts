import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { lineSuggestions, type LineSuggestion } from './suggestions.ts';

/** Every to-do line gets a word, like the Notion plugin offers. */
function todos(body: string, run: () => Promise<void>): LineSuggestion[] {
  return body
    .split('\n')
    .map((text, index) => ({ text, line: index + 1 }))
    .filter(({ text }) => text.startsWith('- [ ] '))
    .map(({ line }) => ({ line, label: 'Notion', busyLabel: 'Sending', run }));
}

function open(doc: string, caret: number, run: () => Promise<void> = () => Promise.resolve()) {
  const state = EditorState.create({ doc, selection: { anchor: caret }, extensions: [lineSuggestions({ suggest: (body) => todos(body, run) })] });
  return new EditorView({ state, parent: document.createElement('div') });
}

const words = (view: EditorView) => [...view.contentDOM.querySelectorAll('.cm-suggest')].map((b) => b.textContent);

describe('inline suggestions', () => {
  it('puts the word after every line offered, except the one being typed', () => {
    const view = open('- [ ] milk\n- [ ] eggs\nplain\n', 0);
    expect(words(view)).toEqual(['Notion']);
    // The caret leaves the first line: both to-dos have their word.
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    expect(words(view)).toEqual(['Notion', 'Notion']);
    view.destroy();
  });

  it('follows the note as it changes', () => {
    const view = open('plain\n', 0);
    expect(words(view)).toEqual([]);
    view.dispatch({ changes: { from: view.state.doc.length, insert: '- [ ] call the plumber\n' }, selection: { anchor: 0 } });
    expect(words(view)).toEqual(['Notion']);
    view.dispatch({ changes: { from: 6, to: 12, insert: '- [x] ' } });
    expect(words(view)).toEqual([]);
    view.destroy();
  });

  it('says its busy word while it runs, then the word again', async () => {
    let finish: () => void = () => undefined;
    const running = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const view = open('- [ ] milk\n', 11, () => running);
    const button = view.contentDOM.querySelector<HTMLButtonElement>('.cm-suggest');
    expect(button?.textContent).toBe('Notion');
    button?.click();
    expect(words(view)).toEqual(['Sending']);
    expect(view.contentDOM.querySelector<HTMLButtonElement>('.cm-suggest')?.disabled).toBe(true);
    finish();
    await running;
    await Promise.resolve();
    expect(words(view)).toEqual(['Notion']);
    view.destroy();
  });
});

describe('a pill pressed with a finger', () => {
  it('stays on its line while the finger is down, even once the caret lands there', async () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: '- [ ] Book the cabin\n- [ ] Call Sam',
        extensions: [lineSuggestions({ suggest: () => [{ line: 2, label: 'Notion', busyLabel: 'Sending', run: async () => undefined }] })],
      }),
      parent: document.body,
    });
    const pill = () => view.contentDOM.querySelector('.cm-suggest');
    expect(pill()).toBeTruthy();
    // A finger goes down on it, and the caret moves to that line the way a tap on the editor moves it.
    pill()!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    view.dispatch({ selection: { anchor: view.state.doc.line(2).from + 3 } });
    expect(pill(), 'the pill is held while the finger is down').toBeTruthy();
    // The finger lifts: the line is being typed on now, so the pill goes as it always did.
    window.dispatchEvent(new PointerEvent('pointerup'));
    view.dispatch({ selection: { anchor: view.state.doc.line(2).from + 4 } });
    expect(pill()).toBeNull();
    view.destroy();
  });
});

describe('what a finger’s press is allowed to do', () => {
  const pill = () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: 'words\n- [ ] Book the cabin',
        extensions: [lineSuggestions({ suggest: () => [{ line: 2, label: 'Notion', busyLabel: 'Sending', run: async () => undefined }] })],
      }),
      parent: document.body,
    });
    return { view, button: view.contentDOM.querySelector('.cm-suggest') as HTMLElement };
  };

  it('keeps a touch alive so the browser still makes a click of it', () => {
    const { view, button } = pill();
    const touch = new Event('touchstart', { bubbles: true, cancelable: true });
    button.dispatchEvent(touch);
    // A touchstart whose default is taken away never becomes a click, and the pill stops working on a phone.
    expect(touch.defaultPrevented, 'a touch on the pill must keep its default').toBe(false);
    view.destroy();
  });

  it('takes the default off a mouse or pointer press, which is what keeps the caret off the line', () => {
    const { view, button } = pill();
    for (const kind of ['pointerdown', 'mousedown']) {
      const press = new Event(kind, { bubbles: true, cancelable: true });
      button.dispatchEvent(press);
      expect(press.defaultPrevented, kind).toBe(true);
    }
    view.destroy();
  });

  it('runs what it offers when the click arrives', async () => {
    let done = 0;
    const view = new EditorView({
      state: EditorState.create({
        doc: 'words\n- [ ] Book the cabin',
        extensions: [
          lineSuggestions({
            suggest: () => [
              {
                line: 2,
                label: 'Notion',
                busyLabel: 'Sending',
                run: async () => {
                  done += 1;
                },
              },
            ],
          }),
        ],
      }),
      parent: document.body,
    });
    const button = view.contentDOM.querySelector('.cm-suggest') as HTMLElement;
    button.dispatchEvent(new Event('touchstart', { bubbles: true, cancelable: true }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(done).toBe(1);
    view.destroy();
  });
});
