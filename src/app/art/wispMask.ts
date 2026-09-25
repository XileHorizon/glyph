import { WISP_EDGE_FOOT_SOFT, WISP_EDGE_SOFT } from './wispEdge.ts';

/**
 * The wisp edge drawn as a mask instead of a filter (art/wispEdge.ts), for the engine that cannot afford the filter.
 *
 * Matt, of the Mac app: "desktop is still very laggy, can we fix the wisp animation to be more performant?" Measured
 * in the real WKWebView by the lanes session: free at rest, 585-690ms for one repaint with one band's filter and over
 * four seconds a frame while scrolling with both, against 16-18ms with the filter off. The same page in GPU
 * Chromium draws at 16.7ms whatever the filter does. The mechanism, not a number, says why: WebKit renders the whole
 * element that wears `filter: url()` into a buffer and pushes it through the graph on every repaint, however small
 * the primitives' subregions are, and a scrolling page repaints every frame. Subregions cannot help, and
 * `backdrop-filter: url()` - which would let a thin band bend what is under it - is not in WebKit.
 *
 * So on that engine the smoke is a mask. The band's shape is made once, as an image: the same turbulence the filter
 * uses, stitched so it tiles along the edge, over the same soft ramp the filter blurs from its strip, taken to alpha
 * and pushed through a steep curve so it tears the words into tendrils rather than misting them. An image used as
 * `mask-image` is rasterised one time and cached, and a mask composites on the GPU, so nothing is re-rendered when
 * the page scrolls under it; the drift is the mask sliding (`mask-position`, from the same clock that slides the
 * filter's noise). What it loses is the bend - the letters dissolve through the smoke instead of being pulled into
 * it. What it keeps is the smoke, its movement, and the engines drawing the one page the same way.
 *
 * Which is drawn is a switch, so the two can stand beside each other (the Developer page the fork session draws) and
 * so the phone, whose GPU draws the filter for nothing, keeps the bend: `wispDraw()` picks the mask in the Mac app
 * and the filter elsewhere, and `glyph-wisp-draw` in localStorage overrides it for anyone comparing.
 */
export type WispDraw = 'filter' | 'mask';

export const WISP_DRAW_KEY = 'glyph-wisp-draw';

/** Which drawing a view gets when its hook is not told: the mask in the Mac app, the filter everywhere else. */
export function wispDraw(): WispDraw {
  try {
    const asked = localStorage.getItem(WISP_DRAW_KEY);
    if (asked === 'filter' || asked === 'mask') return asked;
  } catch {
    // Nowhere to ask: the platform decides.
  }
  if (typeof document === 'undefined') return 'filter';
  return document.documentElement.dataset.titlebar === 'overlay' ? 'mask' : 'filter';
}

/** The image tiles along the edge this wide; the turbulence is stitched so the seam is not there. */
export const WISP_MASK_TILE = 512;
/**
 * The image's height and where the lip sits in it: enough smoke above the lip to reach the top of any header a view
 * runs under (the tallest, two rows of tabs under the Mac's title bar, is under 160px), and the ramp below it.
 */
export const WISP_MASK_ABOVE = 160;
export const WISP_MASK_HEIGHT = 256;
// The two modules import each other (the hook picks the drawing, the drawing takes the hook's sizes), so nothing
// here reads wispEdge's exports until it is called: a top-level read hit the cycle before it was set.

/** How much of the words shows through the smoke past the lip, where the filter draws them bent and blurred. */
const SMOKE_SHOW = 0.34;

/**
 * The band as an SVG: white below the lip going grey above it, softened over the ramp, the noise added, the result
 * taken to alpha through a steep curve. Alpha is what a mask reads from an image, so white here is the words shown
 * and black is the words gone.
 */
function bandSvg(soft: number, flip: boolean): string {
  const grey = Math.round(SMOKE_SHOW * 255)
    .toString(16)
    .padStart(2, '0');
  const w = WISP_MASK_TILE;
  const h = WISP_MASK_HEIGHT;
  // The strip stands above the lip, the ramp below it: the flip turns the whole picture over for the foot.
  const flipped = flip ? ` transform="translate(0 ${h}) scale(1 -1)"` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    `<filter id="b" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB">` +
    `<feTurbulence type="fractalNoise" baseFrequency="0.018 0.06" numOctaves="2" seed="3" stitchTiles="stitch" result="raw"/>` +
    // Opaque noise, or the arithmetic below would read a see-through value and lift the whole band.
    `<feColorMatrix in="raw" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0 1" result="noise"/>` +
    `<feFlood flood-color="#fff" result="white"/>` +
    `<feFlood flood-color="#${grey}${grey}${grey}" x="0" y="0" width="${w}" height="${WISP_MASK_ABOVE}" result="strip"/>` +
    `<feMerge result="stripOnWhite"><feMergeNode in="white"/><feMergeNode in="strip"/></feMerge>` +
    `<feGaussianBlur in="stripOnWhite" stdDeviation="0 ${soft}" result="ramp"/>` +
    // The ramp with the noise on it: the words show where the sum is high, and the noise decides the tendrils.
    `<feComposite in="noise" in2="ramp" operator="arithmetic" k1="0" k2="0.9" k3="1" k4="-0.45" result="field"/>` +
    `<feColorMatrix in="field" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0" result="alpha"/>` +
    `<feComponentTransfer in="alpha" result="torn"><feFuncA type="table" tableValues="0 0 0.12 0.88 1 1"/></feComponentTransfer>` +
    `<feFlood flood-color="#000" result="ink"/>` +
    `<feComposite in="ink" in2="torn" operator="in"/>` +
    `</filter>` +
    `<rect width="${w}" height="${h}" filter="url(#b)"${flipped}/>` +
    `</svg>`
  );
}

/** The band as a `url()` for CSS, top or foot. */
export function wispMaskImage(end: 'top' | 'foot'): string {
  const svg = end === 'top' ? bandSvg(WISP_EDGE_SOFT, false) : bandSvg(WISP_EDGE_FOOT_SOFT, true);
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

let installed = false;

/** Puts both images on the root once, for app.css to draw from (`--wisp-mask-top`, `--wisp-mask-foot`). */
export function installWispMasks(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  const root = document.documentElement.style;
  root.setProperty('--wisp-mask-top', wispMaskImage('top'));
  root.setProperty('--wisp-mask-foot', wispMaskImage('foot'));
  root.setProperty('--wisp-mask-above', `${WISP_MASK_ABOVE}px`);
  root.setProperty('--wisp-mask-height', `${WISP_MASK_HEIGHT}px`);
}
