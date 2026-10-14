import { useCallback, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * Rows dragged into a new order, by their grip (Matt: "drag to reorder pages"). The shape the app's other drags
 * have (canvas/CanvasView.tsx, notes/NoteTabs.tsx): on touch a short hold before the row lifts, so a finger that
 * meant to scroll still scrolls; with a mouse at once; the pointer captured so the drag survives leaving the row;
 * the lifted row following the finger and the others making room; on release, the row's new place handed back as
 * an index. The rows' own arrow buttons stay for the keyboard.
 */

/** How long a finger holds before a row lifts; a mouse needs none. */
export const ROW_HOLD_MS = 220;
/** How far the pointer moves before a press is a drag, not a tap. */
const TRAVEL = 6;

export interface RowDrag {
  /** The row being dragged, and how far it has moved from where it was. */
  lifted: { index: number; dy: number } | null;
  /** Where it would land now. */
  over: number | null;
  /** The grip's handlers, for row `index`. */
  grip: (index: number) => {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
    style: CSSProperties;
  };
  /** The row's own style: lifted, or shifted to make room. */
  rowStyle: (index: number) => CSSProperties | undefined;
}

/**
 * `rows` are the rows' elements in order, read when a drag starts; `onMove(from, to)` is called on release with a
 * changed place.
 */
export function useRowDrag(rows: () => (HTMLElement | null)[], onMove: (from: number, to: number) => void): RowDrag {
  const [lifted, setLifted] = useState<{ index: number; dy: number } | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const press = useRef<{ index: number; y: number; id: number; timer: number; live: boolean; tops: number[]; height: number } | null>(null);

  const measure = () => {
    const els = rows();
    const tops = els.map((el) => el?.getBoundingClientRect().top ?? 0);
    const first = els.find(Boolean);
    return { tops, height: first?.getBoundingClientRect().height ?? 40 };
  };

  const landing = (index: number, y: number, tops: number[], height: number): number => {
    // The row's middle, where it is now, against the rows' tops: the first row whose middle is below it.
    const middle = tops[index]! + height / 2 + (y - press.current!.y);
    let to = 0;
    for (let i = 0; i < tops.length; i += 1) if (tops[i]! + height / 2 < middle) to = i;
    return to;
  };

  const end = (commit: boolean) => {
    const p = press.current;
    if (!p) return;
    window.clearTimeout(p.timer);
    press.current = null;
    if (p.live && commit && over !== null && over !== p.index) onMove(p.index, over);
    setLifted(null);
    setOver(null);
  };

  const grip = useCallback(
    (index: number) => ({
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        if (event.button !== 0 && event.pointerType === 'mouse') return;
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // A pointer the browser no longer tracks (a synthetic one, or one already up): the drag goes on uncaptured.
        }
        const { tops, height } = measure();
        const start = () => {
          if (!press.current) return;
          press.current.live = true;
          setLifted({ index, dy: 0 });
          setOver(index);
        };
        press.current = { index, y: event.clientY, id: event.pointerId, timer: 0, live: false, tops, height };
        if (event.pointerType === 'mouse') start();
        else press.current.timer = window.setTimeout(start, ROW_HOLD_MS);
      },
      onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
        const p = press.current;
        if (!p || p.id !== event.pointerId) return;
        const dy = event.clientY - p.y;
        if (!p.live) {
          // Moved before the hold: a scroll, not a drag.
          if (Math.abs(dy) > TRAVEL) end(false);
          return;
        }
        setLifted({ index: p.index, dy });
        setOver(landing(p.index, event.clientY, p.tops, p.height));
      },
      onPointerUp: () => end(true),
      onPointerCancel: () => end(false),
      style: { touchAction: 'none' } as CSSProperties,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [over],
  );

  const rowStyle = (index: number): CSSProperties | undefined => {
    if (!lifted) return undefined;
    if (index === lifted.index) return { transform: `translateY(${lifted.dy}px)`, zIndex: 2, position: 'relative' };
    if (over === null) return undefined;
    const height = press.current?.height ?? 40;
    // The rows between where it was and where it is going make room.
    if (lifted.index < over && index > lifted.index && index <= over) return { transform: `translateY(${-height}px)`, transition: 'transform 120ms' };
    if (lifted.index > over && index >= over && index < lifted.index) return { transform: `translateY(${height}px)`, transition: 'transform 120ms' };
    return undefined;
  };

  return { lifted, over, grip, rowStyle };
}
