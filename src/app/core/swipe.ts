import { useEffect, useRef, type RefObject } from 'react';
import { markSteppedBack } from './back.ts';

/**
 * A horizontal swipe across a surface: right for back, left for forward.
 *
 * Matt: "just support swiping to go back on the settings page" and "going
 * forward with swiping the other direction too". Android's own back gesture
 * lives on the screen's edges and already reaches the app (core/back.ts);
 * this is the swipe across the page itself, for the surfaces that have no
 * other horizontal gesture of their own - Settings and the guide. The list's
 * rows swipe to star and archive, and the editor drags to select, so those
 * surfaces are left alone.
 *
 * A swipe is a quick, mostly horizontal drag: at least 64 px sideways, more
 * than twice as far sideways as up or down, inside a second and a half (a
 * thumb takes about 200 ms; the rest is for a slow, deliberate one). Drags that begin
 * on a control that moves sideways itself - a segmented control, a slider,
 * anything marked `data-noswipe` - or on text being edited are ignored.
 */

interface SwipeHandlers {
  onBack?: () => void;
  onForward?: () => void;
}

const MIN_DISTANCE = 64;
const MAX_MS = 1500;

const IGNORE = 'input, textarea, [contenteditable="true"], [role="slider"], [data-noswipe], .cm-content';

/** A drag that began on something that moves sideways itself: the kit's segmented control, a slider, text being edited. */
function ownsTheDrag(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest(IGNORE)) return true;
  // The kit's SegmentedControl is a radiogroup of radio inputs whose thumb
  // slides; the guide's choice rows are a radiogroup of buttons and swipe fine.
  const group = target.closest('[role="radiogroup"]');
  return Boolean(group?.querySelector('input[type="radio"]'));
}

/**
 * `active` is whether the surface is on screen: a surface that renders null
 * while closed has no element to listen on until it opens, and the ref alone
 * does not change identity when it does.
 */
export function useSwipeNav(target: RefObject<HTMLElement | null>, handlers: SwipeHandlers, active = true): void {
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    const element = target.current;
    if (!element || !active) return undefined;
    let start: { x: number; y: number; at: number; id: number } | null = null;

    const down = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0) return;
      if (ownsTheDrag(event.target)) return;
      start = { x: event.clientX, y: event.clientY, at: performance.now(), id: event.pointerId };
    };
    const up = (event: PointerEvent) => {
      if (!start || event.pointerId !== start.id) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      const took = performance.now() - start.at;
      start = null;
      if (took > MAX_MS || Math.abs(dx) < MIN_DISTANCE || Math.abs(dx) < Math.abs(dy) * 2) return;
      if (dx > 0) {
        // Android offers the same thumb-swipe as its own back gesture a moment later: one swipe, one step (core/back.ts).
        markSteppedBack();
        latest.current.onBack?.();
      }
      else latest.current.onForward?.();
    };
    const cancel = () => {
      start = null;
    };

    element.addEventListener('pointerdown', down);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', cancel);
    return () => {
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', cancel);
    };
  }, [target, active]);
}
