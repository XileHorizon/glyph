import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NewBookSheet } from './NewBookSheet.tsx';

/**
 * The New book sheet: a name, notes picked as pages in the order they are tapped, moved and left out, and one note
 * made with exactly that index. Closed without making it, nothing is written.
 */

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
  const found = [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.getAttribute('aria-label') === label || b.textContent?.trim() === label || b.textContent?.trim().startsWith(`${label}`));
  if (!found) throw new Error(`no button ${label}`);
  return found;
};
const type = (label: string, value: string) => {
  const field = [...document.querySelectorAll<HTMLInputElement>('input')].find((i) => i.closest('label')?.textContent?.includes(label));
  if (!field) throw new Error(`no field ${label}`);
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const pages = () => [...document.querySelectorAll('ol[aria-label="Pages in this book"] li')].map((li) => li.querySelector('[class*=pageTitle]')?.textContent);

describe('the New book sheet', () => {
  it('is nothing while closed, and makes nothing when closed', () => {
    const onCreate = vi.fn();
    const onClose = vi.fn();
    show(<NewBookSheet open={false} onClose={onClose} titles={['A']} onCreate={onCreate} />);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('needs a name before it will make the book', () => {
    const onCreate = vi.fn();
    show(<NewBookSheet open onClose={() => {}} titles={[]} onCreate={onCreate} />);
    expect(button('Make the book').disabled).toBe(true);
    type('Name', 'Trip');
    expect(button('Make the book').disabled).toBe(false);
    act(() => button('Make the book').click());
    expect(onCreate).toHaveBeenCalledWith('Trip', []);
  });

  it('picks pages in the order tapped, finds by name, moves and leaves out, and makes the book with that index', () => {
    const onCreate = vi.fn();
    const onClose = vi.fn();
    show(<NewBookSheet open onClose={onClose} titles={['Packing', 'Days', 'Who comes', 'Food']} onCreate={onCreate} />);
    type('Name', 'Cabin trip');
    act(() => button('Days').click());
    act(() => button('Packing').click());
    act(() => button('Food').click());
    expect(pages()).toEqual(['Days', 'Packing', 'Food']);
    // A second tap takes it out; a search narrows the list.
    act(() => button('Food').click());
    expect(pages()).toEqual(['Days', 'Packing']);
    type('Find a note', 'who');
    expect([...document.querySelectorAll('ul[aria-label="Notes"] button')].map((b) => b.textContent?.trim())).toEqual(['Who comes']);
    act(() => button('Move Packing up').click());
    expect(pages()).toEqual(['Packing', 'Days']);
    act(() => button('Move Packing up').click());
    expect(pages()).toEqual(['Packing', 'Days']);
    act(() => button('Make the book').click());
    expect(onCreate).toHaveBeenCalledWith('Cabin trip', ['Packing', 'Days']);
    expect(onClose).toHaveBeenCalled();
  });
});
