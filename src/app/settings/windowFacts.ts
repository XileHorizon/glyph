/**
 * What the window is, read off the page itself: the inset the page gets at its top (the status bar's height when the
 * page is drawn under it, 0 when it is not), the page against the screen, and the engine drawing it. For a phone
 * whose top strip does not match the header (Matt: "the topbar background color doesn't match the header"): a 0 here
 * on a phone with a status bar says the page is not under the bar, and the strip is the window behind it.
 */
export function windowFacts(): { inset: string; page: string; screen: string; engine: string } {
  const inset = typeof getComputedStyle === 'undefined' ? '' : getComputedStyle(document.documentElement).getPropertyValue('--app-inset-top').trim();
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const chrome = /Chrome\/([\d.]+)/.exec(ua)?.[1];
  const engine = chrome ? `Chrome ${chrome}${/\bwv\b/.test(ua) ? ' (WebView)' : ''}` : /AppleWebKit\/([\d.]+)/.exec(ua)?.[0] ?? 'unknown';
  return {
    inset: inset || '0px',
    page: `${window.innerWidth} × ${window.innerHeight} @${window.devicePixelRatio}`,
    screen: `${screen.width} × ${screen.height}`,
    engine,
  };
}
