import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useRef } from 'react';
import { ROW_HOLD_MS, useRowDrag } from './rowDrag.ts';

/**
 * Rows dragged by their grip: a mouse lifts at once, a finger after a hold - and a finger that moves before the
 * hold is scrolling, not dragging. The row's new place comes back on release, and only when it changed.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function Rows({ onMove }: { onMove: (from: number, to: number) => void }) {
  const els = useRef<(HTMLElement | null)[]>([]);
  const drag = useRowDrag(() => els.current, onMove);
  return (
    <ol>
      {['a', 'b', 'c', 'd'].map((name, i) => (
        <li
          key={name}
          ref={(el) => {
            els.current[i] = el;
          }}
          data-lifted={drag.lifted?.index === i || undefined}
          style={drag.rowStyle(i)}
        >
          <span data-grip={name} {...drag.grip(i)} />
          {name}
        </li>
      ))}
    </ol>
  );
}

/** jsdom lays nothing out: every row is 40px tall, one under another. */
function layRowsOut(): void {
  document.querySelectorAll('li').forEach((li, i) => {
    li.getBoundingClientRect = () => ({ top: i * 40, bottom: i * 40 + 40, height: 40, left: 0, right: 100, width: 100, x: 0, y: i * 40, toJSON: () => ({}) }) as DOMRect;
  });
  if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => undefined;
}

function show(element: React.ReactElement): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(element));
  layRowsOut();
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
});

const grip = (name: string) => document.querySelector<HTMLElement>(`[data-grip="${name}"]`)!;
const pointer = (type: string, target: HTMLElement, clientY: number, pointerType = 'mouse') =>
  act(() => {
    target.dispatchEvent(Object.assign(new MouseEvent(type, { bubbles: true, clientY, button: 0 }), { pointerId: 1, pointerType }));
  });

describe('rows dragged by their grip', () => {
  it('lifts at once under a mouse, follows it, and lands where it is let go', () => {
    const onMove = vi.fn();
    show(<Rows onMove={onMove} />);
    pointer('pointerdown', grip('a'), 20);
    expect(document.querySelector('li[data-lifted]')?.textContent).toBe('a');
    pointer('pointermove', grip('a'), 110);
    expect(document.querySelector('li[data-lifted]')?.getAttribute('style')).toContain('translateY(90px)');
    pointer('pointerup', grip('a'), 110);
    expect(onMove).toHaveBeenCalledWith(0, 2);
    expect(document.querySelector('li[data-lifted]')).toBeNull();
  });

  it('under a finger, lifts only after the hold, and a move before it is a scroll', () => {
    vi.useFakeTimers();
    const onMove = vi.fn();
    show(<Rows onMove={onMove} />);
    pointer('pointerdown', grip('b'), 60, 'touch');
    expect(document.querySelector('li[data-lifted]')).toBeNull();
    pointer('pointermove', grip('b'), 90, 'touch');
    act(() => {
      vi.advanceTimersByTime(ROW_HOLD_MS + 10);
    });
    expect(document.querySelector('li[data-lifted]')).toBeNull();
    pointer('pointerup', grip('b'), 90, 'touch');
    expect(onMove).not.toHaveBeenCalled();

    pointer('pointerdown', grip('b'), 60, 'touch');
    act(() => {
      vi.advanceTimersByTime(ROW_HOLD_MS + 10);
    });
    expect(document.querySelector('li[data-lifted]')?.textContent).toBe('b');
    pointer('pointermove', grip('b'), 10, 'touch');
    pointer('pointerup', grip('b'), 10, 'touch');
    expect(onMove).toHaveBeenCalledWith(1, 0);
  });

  it('says nothing when a row is let go where it was', () => {
    const onMove = vi.fn();
    show(<Rows onMove={onMove} />);
    pointer('pointerdown', grip('c'), 100);
    pointer('pointermove', grip('c'), 104);
    pointer('pointerup', grip('c'), 104);
    expect(onMove).not.toHaveBeenCalled();
  });
});
