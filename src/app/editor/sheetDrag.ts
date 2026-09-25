import { useCallback, useRef } from 'react';

/**
 * A sheet you can take hold of: drag its handle down and it follows your finger, and let go past halfway and it
 * closes (Matt: "Can't grab and scroll up and down on drawer handles").
 *
 * The handle is the grab, not the whole sheet, so the rows inside still scroll and a press on one is a press. Pulled
 * up, the sheet gives a little and comes back: there is nothing above it to open into, and a handle that does
 * nothing at all feels stuck. Let go under the threshold and it springs back to where it was.
 */

/** Past this far down, or this fast, the sheet closes. */
const CLOSE_PX = 96;
const FLICK_PX_PER_MS = 0.5;
/** How far it gives when pulled upward: enough to answer the hand, not enough to look like it opens. */
const GIVE_PX = 28;
const SPRING = 'transform 220ms cubic-bezier(0.2, 0.9, 0.3, 1)';

/**
 * Handlers for a sheet's handle. `sheet` is the panel that moves, `onClose` what a full pull does. Nothing moves
 * under reduced motion until it closes, and it closes just the same.
 */
export function useSheetDrag(sheet: { current: HTMLElement | null }, onClose: () => void) {
  const from = useRef<{ y: number; at: number } | null>(null);
  /** The last moment of movement, so a flick is judged on how it ended, not on its average. */
  const last = useRef<{ y: number; at: number } | null>(null);

  const move = useCallback(
    (dy: number, animated: boolean) => {
      const panel = sheet.current;
      if (!panel) return;
      panel.style.transition = animated ? SPRING : 'none';
      panel.style.transform = dy ? `translateY(${dy.toFixed(1)}px)` : '';
    },
    [sheet],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!event.isPrimary) return;
      from.current = { y: event.clientY, at: performance.now() };
      last.current = from.current;
      event.currentTarget.setPointerCapture(event.pointerId);
      move(0, false);
    },
    [move],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const start = from.current;
      if (!start) return;
      const dy = event.clientY - start.y;
      last.current = { y: event.clientY, at: performance.now() };
      // Down it follows the finger; up it gives, less and less, and never far.
      move(dy >= 0 ? dy : -GIVE_PX * (1 - 1 / (1 - dy / GIVE_PX + 1)), false);
    },
    [move],
  );

  const end = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const start = from.current;
      from.current = null;
      if (!start) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      const dy = event.clientY - start.y;
      const recent = last.current ?? start;
      last.current = null;
      // How it ended: a flick is quick at the last, where a slow pull that happens to cover ground is not.
      const speed = (event.clientY - recent.y) / Math.max(1, performance.now() - recent.at);
      if (dy > CLOSE_PX || (dy > 24 && speed > FLICK_PX_PER_MS)) {
        onClose();
        move(0, false);
        return;
      }
      move(0, true);
    },
    [move, onClose],
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: end,
    onPointerCancel: end,
  };
}
