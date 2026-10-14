import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Note } from '../core/store.ts';
import { asideContent } from './aside.ts';
import { Aside } from './Aside.tsx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
function show(element: React.ReactElement): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(element));
}
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});
const button = (label: string): HTMLButtonElement => {
  const found = [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.getAttribute('aria-label') === label || b.textContent?.trim() === label);
  if (!found) throw new Error(`no button ${label}`);
  return found;
};

const note = (id: string, body: string, updatedAt = 1): Note => ({ id, body, createdAt: 0, updatedAt, source: 'editor' });
const BOOK = '---\ntitle: "Field guide"\nbook: true\n---\n# Field guide\n\n- [[Trees]]\n- [[Birds]]\n';
const notes = [note('b', BOOK, 5), note('t', '# Trees\n', 4), note('x', '# Loose\n', 3)];

describe('the right-hand aside', () => {
  it('shows a page’s book: its chapters with the open one marked, a tap opening another, the title opening the book', () => {
    const onOpen = vi.fn();
    const onOpenTitle = vi.fn();
    show(<Aside content={asideContent(notes, notes[1]!)} workspace={null} onOpen={onOpen} onOpenTitle={onOpenTitle} />);
    expect([...document.querySelectorAll('ol[aria-label="Chapters"] button')].map((b) => b.textContent?.trim())).toEqual(['1Trees', '2Birds']);
    expect(document.querySelector('[aria-current="page"]')?.textContent).toContain('Trees');
    act(() => button('2Birds').click());
    expect(onOpenTitle).toHaveBeenCalledWith('Birds');
    act(() => button('Open the book Field guide').click());
    expect(onOpen).toHaveBeenCalledWith('b');
  });

  it('lists the workspace’s other notes otherwise, named after the workspace, and closes over a phone', () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    show(<Aside content={asideContent(notes, notes[2]!)} workspace="Work" onOpen={onOpen} onOpenTitle={() => {}} onClose={onClose} />);
    expect(document.body.textContent).toContain('Work');
    expect([...document.querySelectorAll('ol[aria-label="Notes"] button')].map((b) => b.textContent?.trim())).toEqual(['Field guide', 'Trees']);
    act(() => button('Trees').click());
    expect(onOpen).toHaveBeenCalledWith('t');
    act(() => button('Close').click());
    expect(onClose).toHaveBeenCalled();
  });
});
