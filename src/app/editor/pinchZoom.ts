import type { EditorView } from '@codemirror/view';
import { useEffect, type RefObject } from 'react';

/**
 * Pinch a note's text larger or smaller (Matt: "add pinch to zoom text larger and smaller on notes").
 *
 * Two fingers on the page set `--note-zoom` on it, which the note's type sizes are multiplied by
 * (NoteScreen.module.css), on top of the Text size setting. The words under the fingers stay under them as the lines
 * reflow, and the zoom is kept, so every note opens at the size last pinched. The app shell turns the browser's own
 * page zoom off (index.html), so this is the only pinch there is.
 */

export const ZOOM_MIN = 0.7;
export const ZOOM_MAX = 2;
const KEY = 'glyph-note-zoom';

export function clampZoom(zoom: number): number {
  return Number.isFinite(zoom) ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom)) : 1;
}

export function readZoom(): number {
  try {
    const stored = Number(localStorage.getItem(KEY));
    return stored ? clampZoom(stored) : 1;
  } catch {
    return 1;
  }
}

function writeZoom(zoom: number): void {
  try {
    if (Math.abs(zoom - 1) < 0.02) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, zoom.toFixed(3));
  } catch {
    // The size holds for this note until it closes.
  }
}

/** The zoom for fingers now `distance` apart, pinched from `startDistance` at `startZoom`. */
export function pinched(startZoom: number, startDistance: number, distance: number): number {
  return startDistance > 0 ? clampZoom((startZoom * distance) / startDistance) : clampZoom(startZoom);
}

const apart = (touches: TouchList) => {
  const [a, b] = [touches[0], touches[1]];
  return a && b ? Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) : 0;
};
const middle = (touches: TouchList) => {
  const [a, b] = [touches[0], touches[1]];
  return a && b ? { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 } : null;
};

export function useNoteZoom(page: RefObject<HTMLElement | null>, view: EditorView | null, active: boolean): void {
  useEffect(() => {
    const scroller = page.current;
    if (!scroller) return undefined;
    let zoom = readZoom();
    scroller.style.setProperty('--note-zoom', String(zoom));
    if (!view || !active) return undefined;

    let start: { distance: number; zoom: number; pos: number | null; y: number } | null = null;
    let frame = 0;
    let wanted = zoom;

    const draw = () => {
      frame = 0;
      if (!start) return;
      zoom = wanted;
      scroller.style.setProperty('--note-zoom', String(zoom));
      // The words that were under the fingers go back under them as the lines reflow.
      if (start.pos !== null) {
        const at = view.coordsAtPos(start.pos);
        if (at) scroller.scrollTop += at.top - start.y;
      }
    };

    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      const mid = middle(event.touches);
      if (!mid) return;
      const pos = view.posAtCoords({ x: mid.x, y: mid.y }, false);
      const at = view.coordsAtPos(pos);
      start = { distance: apart(event.touches), zoom, pos: at ? pos : null, y: at ? at.top : mid.y };
    };
    const onMove = (event: TouchEvent) => {
      if (!start || event.touches.length !== 2) return;
      // Two fingers are a pinch, not a scroll.
      event.preventDefault();
      wanted = pinched(start.zoom, start.distance, apart(event.touches));
      if (!frame) frame = requestAnimationFrame(draw);
    };
    const onEnd = (event: TouchEvent) => {
      if (!start || event.touches.length >= 2) return;
      cancelAnimationFrame(frame);
      frame = 0;
      draw();
      start = null;
      writeZoom(zoom);
      view.requestMeasure();
    };

    scroller.addEventListener('touchstart', onStart, { passive: true });
    scroller.addEventListener('touchmove', onMove, { passive: false });
    scroller.addEventListener('touchend', onEnd, { passive: true });
    scroller.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener('touchstart', onStart);
      scroller.removeEventListener('touchmove', onMove);
      scroller.removeEventListener('touchend', onEnd);
      scroller.removeEventListener('touchcancel', onEnd);
    };
  }, [page, view, active]);
}
