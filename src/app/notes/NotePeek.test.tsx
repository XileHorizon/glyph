import { afterEach, describe, expect, it } from 'vitest';
import { EditorView } from '@codemirror/view';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NotePeek } from './NotePeek.tsx';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function show(element: React.ReactElement): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(element));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('a note drawn small on a card', () => {
  it('is the note’s own editor, read-only, in the formatted view, without the title', () => {
    const shown = show(<NotePeek body={'# Groceries\n\n- [ ] Eggs\n- [x] Milk\n\nSome words.'} />);
    const editor = shown.querySelector('.cm-editor');
    expect(editor).not.toBeNull();
    expect(shown.querySelector('[data-view="formatted"]')).not.toBeNull();
    expect(shown.querySelector('.cm-content')?.getAttribute('contenteditable')).toBe('false');
    const text = shown.querySelector('.cm-content')?.textContent ?? '';
    expect(text).toContain('Eggs');
    expect(text).toContain('Some words.');
    expect(text).not.toContain('Groceries');
  });

  it('draws nothing for a note that is only its title', () => {
    const shown = show(<NotePeek body={'# Just a title'} />);
    expect(shown.querySelector('.cm-editor')).toBeNull();
  });

  it('keeps what its editor drew and lets the editor go, and a card of the same text draws with no editor at all', async () => {
    const body = '# Kept\n\n- [ ] A box\n\nWords drawn once.';
    const first = show(<NotePeek body={body} />);
    expect(EditorView.findFromDOM(first.querySelector('.cm-editor') as HTMLElement)).not.toBeNull();
    await act(async () => {
      await new Promise((done) => setTimeout(done, 400));
    });
    // The drawing is the editor's own, with no view behind it.
    const kept = first.querySelector('.cm-editor') as HTMLElement;
    expect(kept.textContent).toContain('Words drawn once.');
    expect(EditorView.findFromDOM(kept)).toBeNull();
    act(() => root?.unmount());
    host?.remove();
    const again = show(<NotePeek body={body} />);
    const drawn = again.querySelector('.cm-editor') as HTMLElement;
    expect(drawn.textContent).toContain('A box');
    expect(EditorView.findFromDOM(drawn)).toBeNull();
  });
});
