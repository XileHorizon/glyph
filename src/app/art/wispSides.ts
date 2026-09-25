import { preferences } from '../core/preferences.ts';
import { WISP_EDGE_BUDGET } from './wispEdge.ts';

/**
 * The wisp for a row that scrolls sideways: the tabs (notes/NoteTabs.tsx). Matt: "Blur the right side of the tabs and
 * the left when scrolled with the wisp animation but don't apply it to the left when it's scrolled all the way". What
 * runs off either end is bent by fractal noise and softened, the smoke a page makes under its header, turned on its
 * side - where the row had only a fade on its right end.
 *
 * Built like a board lane's foot (art/wispFoot.ts) and in the same units: **the whole filter is said in the row's own
 * box** - `objectBoundingBox` for the region and for the primitives, so every length here is a fraction of the row's
 * width or height. Made once per size and pair of ends and kept.
 *
 * `userSpaceOnUse` starts from the element's own corner in Chromium and from the DOCUMENT's in WebKit (§54), and this
 * row used to work around that twice over: its bands and its noise ran 400px above and below it so that either corner
 * fell inside them, and it refused to draw at all unless the row began at the page's own left edge, the one place
 * across where the two frames agree. In the row's own box there is no corner to pick, so both of those are gone. A row
 * anywhere on the page smokes now - a split window, a row inset beside a sidebar - where the `left` test used to leave
 * it with a plain fade, and the two engines draw it alike at every scroll position.
 *
 * `wispSides(width, height, start, end)` answers the filter to wear, as a CSS value, or null where the smoke is not
 * wanted: switched off under Settings (`wispEdge`), with reduced motion, with neither end open, and where the filter's
 * region would not fit its budget (`WISP_EDGE_BUDGET`, art/wispEdge.ts) - over it Apple's engine paints the whole box
 * black rather than clipping it.
 *
 * What the box units cost is legibility, as wispFoot's do: a length has to be divided by the side of the row it runs
 * along, a blur needs both of its numbers (one fraction shared between a wide row and a short one is two different
 * blurs), and `feDisplacementMap` measures its throw against the box's diagonal over root two. `box` and `corner`
 * below do that arithmetic in one place. The subregions stay, converted rather than dropped: they are most of what
 * this effect costs, and a draft of wispFoot's without them ran at nearly twice the cost a frame (§54).
 *
 * One attribute is outside all of that: the noise's `baseFrequency`, which an engine reads in user space whatever
 * the units say. Converting it with the rest is what made the smoke grainy, and the comment on it says how that was
 * measured. Everything with a length in it is a fraction of the box; the frequency is per pixel.
 *
 * The noise stays where it is and the tabs scroll through it, so the edge churns while they move and rests when they
 * stop: that is the animation, and a row at rest costs nothing but its bands. Sliding the noise as well was tried in
 * the plan and left out - a filter draws nothing outside its own region, so noise slid in from past the row's end
 * arrives blank.
 */

/** The full-strength lip at each end, and the soft ramp in from it. */
const BAND = 6;
const SOFT = 12;
/** How far outside the row the bend may throw a pixel, and so how far the region reaches around it, on all four sides. */
const SIDE = 24;
/** The strip reaches this far past each end, so its blur never opens the row's own edge. */
const PAST = 60;
/**
 * How far in from each end the lip sits: where the tabs are still drawn, as the header's lip sits a little below the
 * header. At the very end the row's fade had already taken them, and the smoke bent nothing anyone could see.
 */
const IN = 14;
/** Smaller than a page's: a tab's words are small. */
const BEND = 14;
const BLUR = 1.6;
const NEAR = 1.5;
/** How many are kept before the oldest is taken out: a row changes size as tabs open and the window moves. */
const KEEP = 16;

const SVG = 'http://www.w3.org/2000/svg';
const made = new Map<string, string>();
let holder: SVGSVGElement | null = null;

export function wispSides(width: number, height: number, start: boolean, end: boolean): string | null {
  if (typeof document === 'undefined' || !preferences().wispEdge || (!start && !end)) return null;
  if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  const wide = Math.round(width);
  const tall = Math.round(height);
  if (wide <= (BAND + SOFT) * 2 || tall <= 0) return null;
  // The budget is counted in the screen's own pixels; a row past it keeps the plain fade.
  const dots = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
  if (Math.ceil((wide + SIDE * 2) * dots) * Math.ceil((tall + SIDE * 2) * dots) > WISP_EDGE_BUDGET) return null;
  const key = `${wide}x${tall}${start ? 's' : ''}${end ? 'e' : ''}`;
  const known = made.get(key);
  if (known && document.getElementById(known)) return `url(#${known})`;
  const id = `wispSides${key}`;
  holder ??= makeHolder();
  if (!holder.isConnected) document.body.append(holder);
  holder.append(sidesFilter(id, wide, tall, start, end));
  made.set(key, id);
  if (made.size > KEEP) {
    const [oldest] = made;
    if (oldest) {
      made.delete(oldest[0]);
      document.getElementById(oldest[1])?.remove();
    }
  }
  return `url(#${id})`;
}

function makeHolder(): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.style.position = 'absolute';
  document.body.append(svg);
  return svg;
}

function part(name: string, attributes: Record<string, string | number>, ...children: Element[]): Element {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  node.append(...children);
  return node;
}

/**
 * The header's band of art/WispEdgeFilter.tsx turned on its side: noise, a white strip at each open end on black,
 * blurred across into a ramp that decides where the noise bends the row, a softened copy kept to the strokes, and the
 * row itself everywhere the bands aren't. The noise runs in tall streaks, as the header's runs in long ones.
 *
 * Every coordinate is a fraction of the row's own box - `box` divides by the side it runs along - so the region reads
 * as the row's own rectangle grown by SIDE, and each strip as a bar at one end of it.
 */
function sidesFilter(id: string, wide: number, tall: number, start: boolean, end: boolean): Element {
  /** A length along the row's width, or down its height - what it has to be divided by to be a fraction of the box. */
  const box = (x: number, y: number, w: number, h: number) => ({ x: x / wide, y: y / tall, width: w / wide, height: h / tall });
  /** feDisplacementMap measures its throw against this, the box's diagonal over root two. */
  const corner = Math.sqrt((wide * wide + tall * tall) / 2);
  const region = box(-SIDE, -SIDE, wide + SIDE * 2, tall + SIDE * 2);
  const merge = (result: string, ...inputs: string[]) =>
    part('feMerge', result ? { result } : {}, ...inputs.map((input) => part('feMergeNode', { in: input })));
  const bar = (x: number) => box(x, -SIDE, PAST + IN + BAND, tall + SIDE * 2);
  const strips = [
    ...(start ? [part('feFlood', { 'flood-color': '#fff', ...bar(-PAST), result: 'startStrip' })] : []),
    ...(end ? [part('feFlood', { 'flood-color': '#fff', ...bar(wide - IN - BAND), result: 'endStrip' })] : []),
  ];
  return part(
    'filter',
    { id, filterUnits: 'objectBoundingBox', primitiveUnits: 'objectBoundingBox', ...region, 'color-interpolation-filters': 'sRGB' },
    /*
     * The one length here that is NOT in the box's units, and the only one that must not be: an engine reads
     * `baseFrequency` in the filter's own user space whatever `primitiveUnits` says. Converted with everything else
     * it came out multiplied by the row's width and height - 26 cycles across where 0.07 a pixel was meant - and the
     * smoke turned to static (Matt: "The tabs have a grainy effect on the wisp blur distort ... something changed
     * that needs reverted"). Drawn side by side at 375x41 from the one seed: per-pixel in user space, the same
     * frequency in box units, and the multiplied pair. The first two are the same soft cloud; the third is grain.
     * So it stays the per-pixel frequency every other wisp in the app is written in (art/wispEdge.ts, wispFormat.ts).
     */
    part('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.07 0.035', numOctaves: 2, seed: 5, ...region, result: 'rawNoise' }),
    part('feColorMatrix', { in: 'rawNoise', type: 'matrix', values: '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0 1', result: 'noise' }),
    part('feFlood', { 'flood-color': '#000', result: 'black' }),
    ...strips,
    merge('stripsOnBlack', 'black', ...(start ? ['startStrip'] : []), ...(end ? ['endStrip'] : [])),
    part('feGaussianBlur', { in: 'stripsOnBlack', stdDeviation: `${SOFT / wide} 0`, result: 'band' }),
    part('feComposite', { in: 'noise', in2: 'band', operator: 'arithmetic', k1: 1, k2: 0, k3: -0.5, k4: 0.5, result: 'field' }),
    part('feDisplacementMap', { in: 'SourceGraphic', in2: 'field', scale: BEND / corner, xChannelSelector: 'R', yChannelSelector: 'G', result: 'bent' }),
    // Both numbers, always: one fraction shared between a wide row and a short one is two different blurs.
    part('feGaussianBlur', { in: 'bent', stdDeviation: `${BLUR / wide} ${BLUR / tall}`, result: 'soft' }),
    part('feMorphology', { in: 'bent', operator: 'dilate', radius: `${NEAR / wide} ${NEAR / tall}`, result: 'near' }),
    part('feComposite', { in: 'soft', in2: 'near', operator: 'in', result: 'softNear' }),
    part('feColorMatrix', { in: 'band', type: 'luminanceToAlpha', result: 'bandAlpha' }),
    part('feComposite', { in: 'softNear', in2: 'bandAlpha', operator: 'in', result: 'smoke' }),
    part('feComposite', { in: 'SourceGraphic', in2: 'bandAlpha', operator: 'out', result: 'rest' }),
    part('feComposite', { in: 'bent', in2: 'bandAlpha', operator: 'in', result: 'bentIn' }),
    merge('', 'rest', 'bentIn', 'smoke'),
  );
}
