import { useEffect, useRef } from 'react';
import { answerHost } from './host.ts';

/**
 * The phone's back gesture, answered by the app.
 *
 * Android owns the back swipe. MainActivity catches it and asks the page
 * (`window.__glyph.back`) whether the app can use it; the answer is a walk
 * down a stack of handlers, newest first. An open note, the settings page, a
 * settings pane, the guide: each registers a handler while it is up, and the
 * first to take the gesture wins.
 *
 * The activity is always told the page took it (`tookBack`), so a back swipe
 * never puts Glyph behind the home screen (Matt: "don't leave the app with a
 * back swipe ever"). Two things sent him out of the app: nothing took the
 * gesture at the list, and - the one he hit - a swipe the page had ALREADY
 * used to close the settings page, which Android then offered again as its
 * own back gesture, by which time nothing was open to take it. Answering yes
 * whatever happened settles both, and the home gesture is still the way out.
 *
 * Handlers stack in the order they register, which - since screens register
 * when they OPEN - is opening order: the newest thing on screen is the first
 * thing a back swipe dismisses, which is the order a person expects.
 *
 * The same stack answers the Escape key, so the desktop and a browser get the
 * same behaviour from the keyboard.
 */

type BackHandler = () => boolean;

const handlers: BackHandler[] = [];

/** Puts a handler on top of the stack; returns its unregister. */
export function onBack(handler: BackHandler): () => void {
  handlers.push(handler);
  return () => {
    const at = handlers.indexOf(handler);
    if (at !== -1) handlers.splice(at, 1);
  };
}

/** Runs the newest handler that wants the gesture. True if one took it. */
export function goBack(): boolean {
  for (let i = handlers.length - 1; i >= 0; i -= 1) {
    const handler = handlers[i];
    if (handler && handler()) return true;
  }
  return false;
}

/**
 * While `active`, a back gesture runs `close` and is taken. The screen case in
 * one line: pass whether it is showing and what leaving it means.
 */
export function useBack(active: boolean, close: () => void): void {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!active) return undefined;
    return onBack(() => {
      closeRef.current();
      return true;
    });
  }, [active]);
}

/**
 * A swipe the page has just stepped back on itself (core/swipe.ts).
 *
 * One swipe of a thumb is both things at once: the page's own right-swipe, which closes the settings page, and
 * Android's back gesture, which arrives a moment later and would close the note underneath it too. So a gesture that
 * lands right after the page moved is the same gesture, and is answered without stepping again.
 */
const SAME_SWIPE_MS = 500;
let steppedAt = -Infinity;

export function markSteppedBack(): void {
  steppedAt = performance.now();
}

/**
 * What the activity is told: the gesture is stepped back through the stack, and always counts as used, so Android
 * never backgrounds the app on it. Escape keeps the honest answer, since a key the page did not use belongs to
 * whatever else is listening.
 */
function tookBack(): boolean {
  if (performance.now() - steppedAt < SAME_SWIPE_MS) return true;
  goBack();
  return true;
}

/** Installs the page's answer for the activity, and Escape's. Call once. */
export function installBack(): () => void {
  const unanswer = answerHost('back', tookBack);
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (goBack()) event.preventDefault();
  };
  window.addEventListener('keydown', onKey);
  return () => {
    unanswer();
    window.removeEventListener('keydown', onKey);
  };
}
