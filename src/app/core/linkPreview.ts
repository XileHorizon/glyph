import { preferences } from './preferences.ts';
import { invoke, isTauri } from './tauri.ts';

/**
 * What a linked page is called, for the card under a link (editor/linkCards.ts; Matt: "add link preview cards").
 *
 * The page's own HTML can't be read from here - the webview refuses another site's page - so the app reads it
 * (`link_preview`, src-tauri/src/link_preview.rs, native generation 17). What comes back is kept here, so a card
 * shows its title at once the next time and the site is asked once a week at most. A browser, or an older app,
 * shows the site and path without asking anything.
 *
 * Asking is a request to the linked site, so it only happens for a card on screen, with Link previews on (Settings >
 * Type) and "Nothing leaves the phone" off.
 */

export interface LinkPreview {
  url: string;
  title?: string;
  site?: string;
  description?: string;
}

interface Kept extends Partial<LinkPreview> {
  at: number;
  failed?: boolean;
}

const KEY = 'glyph-link-previews';
const KEEP = 300;
const FRESH_MS = 7 * 24 * 60 * 60_000;
const RETRY_MS = 24 * 60 * 60_000;
export const PREVIEW_GENERATION = 17;
/** Sent on `window` when a preview arrives, so cards redraw. */
export const LINK_PREVIEW_READY = 'glyph:link-preview';

let kept: Record<string, Kept> | null = null;

function all(): Record<string, Kept> {
  if (kept) return kept;
  try {
    kept = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, Kept>;
  } catch {
    kept = {};
  }
  return kept;
}

function save(): void {
  const entries = Object.entries(all()).sort((a, b) => b[1].at - a[1].at).slice(0, KEEP);
  kept = Object.fromEntries(entries);
  try {
    localStorage.setItem(KEY, JSON.stringify(kept));
  } catch {
    // The card still shows the site; the title is asked again next time.
  }
}

/** A web address's site as a person reads it: `airbnb.com`, without `www.`. */
export function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** The address after the site, short: `/rooms/1234…`, or nothing for a home page. */
export function pathOf(url: string): string {
  try {
    const { pathname, search } = new URL(url);
    const rest = `${pathname === '/' ? '' : pathname}${search}`;
    return rest.length > 32 ? `${rest.slice(0, 31)}…` : rest;
  } catch {
    return '';
  }
}

/** What is known about `url` now, without asking. */
export function previewFor(url: string): LinkPreview | null {
  const entry = all()[url];
  if (!entry || entry.failed) return null;
  return { url, title: entry.title, site: entry.site, description: entry.description };
}

let generation: number | null = null;
const asking = new Set<string>();

async function canAsk(): Promise<boolean> {
  const prefs = preferences();
  if (!isTauri() || !prefs.linkPreviews || prefs.localOnly) return false;
  generation ??= await invoke<{ nativeGeneration?: number }>('ota_status').then(
    (s) => s.nativeGeneration ?? 0,
    () => 0,
  );
  return generation >= PREVIEW_GENERATION;
}

/** Asks for `url`'s preview if it isn't known and fresh, and says so on `window` when it arrives. */
export function wantPreview(url: string): void {
  const entry = all()[url];
  const age = entry ? Date.now() - entry.at : Number.POSITIVE_INFINITY;
  if (entry && age < (entry.failed ? RETRY_MS : FRESH_MS)) return;
  if (asking.has(url)) return;
  asking.add(url);
  void canAsk()
    .then(async (ok) => {
      if (!ok) return;
      try {
        const preview = await invoke<LinkPreview>('link_preview', { url });
        all()[url] = { title: preview.title, site: preview.site, description: preview.description, at: Date.now() };
      } catch {
        all()[url] = { at: Date.now(), failed: true };
      }
      save();
      window.dispatchEvent(new Event(LINK_PREVIEW_READY));
    })
    .finally(() => asking.delete(url));
}

/** Opens a web address in the phone's browser. */
export async function openLink(url: string): Promise<void> {
  if (isTauri()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } else {
    window.open(url, '_blank', 'noopener');
  }
}
