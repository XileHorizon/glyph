import { GUIDE_PAGES } from './pages.ts';

/**
 * Whether the reader left the guide early.
 *
 * Matt: "if the app is relaunched we can assume they hit the button on the
 * side too early, so reload with a warning about it being too soon". The
 * guide is shown once, on the first launch, and closed with Skip or from its
 * last page (App.tsx `markGuideSeen`). A launch before that, with the guide
 * started and left on a page before the side-key page, is someone who held
 * the key on page one: the app comes up on the guide again with one line at
 * the top of it (Guide.tsx says so in a line of its own) and does not start a recording. From the
 * side-key page on, a press of the key is what the page asks for, and it
 * records as it always did.
 *
 * Two keys next to `glyph-guide-seen`: that the guide has been started, and
 * the page it was last on. Both go when the guide is finished.
 */

const STARTED = 'glyph-guide-started';
const PAGE = 'glyph-guide-page';

/** The first page that expects the side key. Pages before it are reading. */
const SIDE_KEY_PAGE = GUIDE_PAGES.indexOf('sidekey');

function get(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function set(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // No storage: a relaunch cannot be told from a first launch, and the guide simply shows.
  }
}

/** The guide is on screen for the first time. */
export function markGuideStarted(): void {
  set(STARTED, '1');
  if (get(PAGE) === null) set(PAGE, '0');
}

/** The page the guide is showing, kept so a relaunch knows how far the reader got. */
export function rememberGuidePage(index: number): void {
  set(PAGE, String(Math.max(0, index)));
}

/** The guide was finished (or skipped): nothing left to come back to. */
export function clearGuideProgress(): void {
  set(STARTED, null);
  set(PAGE, null);
}

/** The page the guide was last on, or -1 when it was never started. */
export function guidePageLeftAt(): number {
  if (get(STARTED) !== '1') return -1;
  const page = Number(get(PAGE) ?? '0');
  return Number.isFinite(page) && page >= 0 ? Math.floor(page) : 0;
}

/** Whether a page is one the reader should still be reading: before the side-key page. */
export function isReadingPage(index: number): boolean {
  return index < SIDE_KEY_PAGE;
}

/**
 * A launch that came too soon: the guide has not been finished (`seen` is
 * App.tsx's `glyph-guide-seen`), it was started before, and it was left on a
 * reading page. The guide should open again with its line, and a side-key
 * launch should not record.
 */
export function launchedTooSoon(seen: boolean): boolean {
  if (seen) return false;
  const left = guidePageLeftAt();
  return left >= 0 && isReadingPage(left);
}
