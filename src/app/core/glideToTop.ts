import { useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * Glides `scroller` back to its top whenever `key` changes: a workspace chosen on the home page (Matt: "when I click
 * different workspaces the page should scroll back up smoothly, not just jump to the top").
 *
 * The jump was the browser's, not ours: the new workspace's list is usually shorter, so the page can't stay as far
 * down as it was and snaps up in the same frame. So the scroll position is remembered as it moves, and when the key
 * changes, before the new list paints, the page is given enough room at its foot to stay where it was, put back
 * there, and then scrolled to the top smoothly. The room goes once the page is at the top, where it is out of sight.
 * With reduced motion it goes to the top at once.
 */
export function useGlideToTop(scroller: RefObject<HTMLElement | null>, key: string | null): void {
  // Where the page was before a change: read at every commit that keeps the key, as it scrolls, and as a finger lands
  // (a tap on a workspace), so it is never the position the browser clamps to once the shorter list is in.
  const lastTop = useRef(0);
  const lastKey = useRef(key);
  const release = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return undefined;
    if (lastKey.current !== key) {
      lastKey.current = key;
      const from = lastTop.current;
      if (key !== null && from > 0) glide(el, from, release);
    }
    lastTop.current = el.scrollTop;
    const remember = () => {
      lastTop.current = el.scrollTop;
    };
    el.addEventListener('scroll', remember, { passive: true });
    el.addEventListener('pointerdown', remember, { capture: true, passive: true });
    return () => {
      el.removeEventListener('scroll', remember);
      el.removeEventListener('pointerdown', remember, { capture: true });
    };
  });
  // Leaving the page mid-glide: the borrowed room goes with it.
  useLayoutEffect(() => () => release.current?.(), []);
}

/** Holds `el` at `from` over a list too short to reach it, then scrolls it to the top; the room at the foot goes when the glide ends. */
function glide(el: HTMLElement, from: number, release: { current: (() => void) | null }): void {
  release.current?.();
  const still = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const base = parseFloat(getComputedStyle(el).paddingBlockEnd) || 0;
  const short = from + el.clientHeight - el.scrollHeight;
  if (short > 0) el.style.paddingBlockEnd = `${base + short}px`;
  el.scrollTop = from;
  let done = false;
  const end = () => {
    if (done) return;
    done = true;
    el.style.paddingBlockEnd = '';
    el.removeEventListener('scrollend', ended);
    window.clearTimeout(timer);
    if (release.current === end) release.current = null;
  };
  // Only the end of the glide itself: putting the page back at `from` above fires a scrollend of its own a frame
  // later, and taking the room away then would drop the page to the short list's foot before it had moved.
  const ended = () => {
    if (el.scrollTop <= 1) end();
  };
  release.current = end;
  el.addEventListener('scrollend', ended);
  // A WebView without scrollend: the room goes once the page has reached the top, or after three seconds whatever
  // happened, so a glide cut short by a finger never leaves the list longer than it is.
  const started = performance.now();
  const check = () => {
    if (el.scrollTop <= 1 || performance.now() - started > 3000) end();
    else timer = window.setTimeout(check, 250);
  };
  let timer = window.setTimeout(check, 700);
  el.scrollTo({ top: 0, behavior: still ? 'auto' : 'smooth' });
  if (still) end();
}
