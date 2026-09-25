/**
 * Which kind of machine the app is running on.
 *
 * Three callers need this and each means something different by it: haptics
 * asks whether there is a motor to drive, the editor asks whether the keyboard
 * is on screen (so the formatting bar has something to track), and the CSS
 * asks whether the screen has corners that curve. Sniffed from the user agent
 * rather than asked of `@tauri-apps/plugin-os`, because the answer never
 * changes during a run and the plugin's is an async call plus a Rust
 * dependency for a constant.
 */

import { isTauri } from './tauri.ts';

function userAgent(): string {
  return typeof navigator === 'undefined' ? '' : navigator.userAgent;
}

/**
 * True on iOS and Android, in the app or the browser.
 *
 * iPadOS is the awkward one: it reports itself as a Mac, and a Tauri iOS
 * webview can report a Mac-class agent too. A real Mac has no touchscreen, so
 * a Mac agent paired with ANY touch capability is a phone or tablet wearing a
 * Mac's clothes.
 */
export const isMobile = (() => {
  const ua = userAgent();
  if (/Android|iPhone|iPod|iPad/i.test(ua)) return true;
  const touchy =
    (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) ||
    (typeof window !== 'undefined' && 'ontouchstart' in window) ||
    (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches);
  return /Macintosh/i.test(ua) && touchy;
})();

export const isIOS = /iPhone|iPod|iPad/i.test(userAgent()) || (isMobile && /Macintosh/i.test(userAgent()));

export const isAndroid = /Android/i.test(userAgent());

/** A phone build with a Rust core behind it: the only place a motor exists. */
export const isNativeMobile = isTauri() && isMobile;

/*
 * Publish the platform to CSS, from the module body rather than an effect: the
 * chrome is positioned by these rules on the first paint, and a platform
 * arriving one render later would move the header after it was already drawn.
 */
if (typeof document !== 'undefined') {
  document.documentElement.dataset.platform = isAndroid ? 'android' : isIOS ? 'ios' : 'desktop';
  // The Mac app draws under a transparent title bar with the window buttons inset into it (src-tauri/src/lib.rs,
  // `set_traffic_lights_inset`): the page keeps that bar clear and lets it drag the window (app.css).
  if (isTauri() && !isMobile && /Macintosh/i.test(userAgent())) document.documentElement.dataset.titlebar = 'overlay';
}
