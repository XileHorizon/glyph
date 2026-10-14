import { useSyncExternalStore } from 'react';

/**
 * Whether the screen is wide enough for more in a header: a tablet, or a folding phone opened out. Answers again as
 * the phone folds and unfolds.
 */
const WIDE = '(min-width: 600px)';

function subscribe(listener: () => void): () => void {
  if (typeof matchMedia === 'undefined') return () => undefined;
  const query = matchMedia(WIDE);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

export function useWideScreen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => typeof matchMedia !== 'undefined' && matchMedia(WIDE).matches,
    () => false,
  );
}

/**
 * Whether the notes sit in a sidebar beside the open note (Matt: "on widescreen desktop I would like to see a sidebar
 * with all notes in them"). Answers again as the window is resized, or as a phone is folded open.
 *
 * A question about the window's shape, not about the device (Matt: "On a wider display we should just use the desktop
 * layout"). It used to ask `!isMobile` as well, so a folding phone opened out or a tablet kept the phone layout however
 * wide the screen became - which is the very case the split is for, and the one Glyph is built on.
 *
 * Two panes need width, and they need a window that is not a strip: a phone held in landscape is as wide as a small
 * desktop window and a few hundred pixels tall, with no room to put a list beside anything. So width and height are
 * both asked - unless the pointer is fine, which means a mouse, where a short window is one the person chose and not
 * the shape of the hardware. 660px is the list's own column (300px, app.css `.app-split`) and a note beside it no
 * narrower than a small phone.
 */
const SIDEBAR_WIDE = '(min-width: 660px)';
const SIDEBAR_TALL = '(min-height: 600px)';
/** A mouse rather than a finger: the one case where a short window says nothing about the device. */
const SIDEBAR_MOUSE = '(pointer: fine)';
const SIDEBAR_ASKS = [SIDEBAR_WIDE, SIDEBAR_TALL, SIDEBAR_MOUSE];

/**
 * Asked as three separate queries rather than one with an `or` inside it: a media query the engine cannot parse is
 * false rather than ignored, so a single clever one that an older webview did not understand would take the sidebar
 * away entirely instead of falling back.
 */
function splitFits(): boolean {
  if (typeof matchMedia === 'undefined') return false;
  const wide = matchMedia(SIDEBAR_WIDE).matches;
  const tall = matchMedia(SIDEBAR_TALL).matches || matchMedia(SIDEBAR_MOUSE).matches;
  /*
   * The keyboard is not the window's shape. On the Fold opened out, the keyboard coming up takes the window under the
   * 600px it has to be tall, and the answer went from two panes to one mid-sentence - which moved the note into another
   * part of the page, where React made it again, and a new editor is not the one with the focus: the keyboard closed
   * the moment it opened (Matt: "When trying to type on a note now it closes out the keyboard immediately"). Measured:
   * split on, focused; window 880x900 to 880x480; split off, a different editor, nothing focused.
   *
   * So while something is being typed into, the height keeps the answer it had. Width still decides at once: folding or
   * unfolding the phone is the shape changing, keyboard or not.
   */
  if (heldWide === wide && heldTall !== null && heldTall !== tall && typing()) return wide && heldTall;
  heldWide = wide;
  heldTall = tall;
  return wide && tall;
}

/** The last answer each half of the question gave, for the keyboard's sake (`splitFits`). */
let heldWide: boolean | null = null;
let heldTall: boolean | null = null;

/** Whether a field has the focus: an editor, an input, a text box - what the phone's keyboard comes up for. */
function typing(): boolean {
  const el = typeof document === 'undefined' ? null : document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
}

function subscribeSidebar(listener: () => void): () => void {
  if (typeof matchMedia === 'undefined') return () => undefined;
  const asked = SIDEBAR_ASKS.map((ask) => matchMedia(ask));
  for (const query of asked) query.addEventListener('change', listener);
  return () => {
    for (const query of asked) query.removeEventListener('change', listener);
  };
}

export function useSidebar(): boolean {
  return useSyncExternalStore(subscribeSidebar, splitFits, () => false);
}

/**
 * Whether the docked sidebar is showing, kept to this device between launches: the top bar's sidebar icon shows and
 * hides it. Until it has been toggled, it shows where there is a mouse and starts hidden under a finger, so a folding
 * phone opened out starts on the note with its sidebar a tap away (Matt: "make the foldable phone still have the
 * sidebar hidden by default"), while a desktop window starts with it open.
 */
const SHOWN_KEY = 'glyph-sidebar-shown';

export function readSidebarShown(): boolean {
  try {
    const kept = localStorage.getItem(SHOWN_KEY);
    if (kept === '1' || kept === '0') return kept === '1';
  } catch {
    // Storage refused: fall through to the device's default.
  }
  return typeof matchMedia !== 'undefined' && matchMedia(SIDEBAR_MOUSE).matches;
}

export function writeSidebarShown(shown: boolean): void {
  try {
    localStorage.setItem(SHOWN_KEY, shown ? '1' : '0');
  } catch {
    // Not kept: it opens as the device's default next time.
  }
}
