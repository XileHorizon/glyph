import { preferences } from '../core/preferences.ts';
import { WISP_EDGE_BUDGET } from './wispEdge.ts';

/**
 * The wisp edge's foot (art/wispEdge.ts) for a small box that scrolls inside a page: a board's lane with more cards
 * than it shows (editor/boards.ts). Matt: "the blur at the bottom of the swimlanes should be the wisp effect we use on
 * text". What slides off the lane's foot is bent by fractal noise and softened, the same smoke a page makes under its
 * header, where a plain fade used to be.
 *
 * The page's filter is one element placed for one view at a time (`placeFoot`), so a lane can't wear it. A lane has
 * its own: the same primitives with the band at the lane's own foot. Lanes in a board are all one height, so one
 * filter serves a board, and boards the same height share it. It is made once per height and kept, and nothing about
 * it moves, so a lane at rest costs nothing but its band.
 *
 * `wispFoot(height, width)` answers the filter to wear, as a CSS value, or null where the smoke is not wanted:
 * switched off under Settings (`wispEdge`), with reduced motion, and where the lane is so large that the filter's
 * region would not fit its budget (`WISP_EDGE_BUDGET`, art/wispEdge.ts). There the lane keeps its plain fade. The
 * region is the lane's own box and not a width big enough for any lane: over the budget the lane would be painted
 * solid black, which is how this effect was lost on Apple's engine for a while.
 *
 * **Everything here is in the lane's own box, not in user space** (`objectBoundingBox` for both the region and the
 * primitives, so every length is a fraction of the lane's width or height). The page's filter can afford
 * `userSpaceOnUse` because `placeRegion` sizes its region to the window from (0,0), so the frame the engine picks
 * makes no difference. A lane's cannot: its band is placed at its own foot, and the two engines do not agree on
 * where a lane's user space begins. Measured in Playwright on a striped lane 300px tall, the band at the lane's
 * foot and the noise fixed:
 *
 * | | band, in rows down from the lane's own top | rows of the lane drawn at all |
 * | --- | --- | --- |
 * | Chromium, lane anywhere, any scroll | 272..299 | 136 of 136 |
 * | WebKit, lane 40px down the page | 232..299 | 134 |
 * | WebKit, lane 420px down the page | 0..19 | 8 |
 * | WebKit, lane in a scroller, scrolled | none | 0 |
 *
 * Chromium measures user space from the element's own corner, so the band sits at the lane's foot wherever the lane
 * is. WebKit measures it from the DOCUMENT's corner - the page's top left, before any page scrolling - so the band
 * lands as far above the lane's foot as the lane is down the page, and the region, placed in the same frame, stops
 * covering the lane at all: nothing outside a filter's region is drawn, so the lane's cards simply go.
 *
 * Which corner WebKit uses was probed directly, with a filter whose only primitive is a red square at user space
 * (0, 0) on a box 160px tall that is otherwise drawn plain, since a filter's output is clipped to the box and the
 * square only shows where the origin falls inside it. Chromium drew it at the box's own top in every case. WebKit
 * drew it at the box's top for a box at document y=0 with the page unscrolled, and nowhere at all for the same box
 * scrolled to document y=300 with the page scrolled 300, where the WINDOW's corner sits inside the box and the
 * document's is 300px above it. So it is the document's corner, not the window's: art/wispSides.ts had read it as the
 * window's, which is the same corner when the probe is run at the top of a page and is where that note was written.
 * That filter is in its box's own units too now, and has no corner to be wrong about (§55).
 *
 * In the lane's own box there is no corner to pick, and both engines now draw the band at rows 271..299 with every
 * row of the lane present, at every scroll position, in a page and inside a scroller.
 *
 * The one thing the box units cost is legibility: a length here has to be divided by the side of the lane it runs
 * along, a blur needs both of its numbers (one fraction shared between a wide box and a tall one is two different
 * blurs), and `feDisplacementMap` measures its throw against the box's diagonal over root two. `box` and `across`
 * below do that arithmetic in one place.
 */

/** The full-strength lip, how far above the lane's foot it sits, the soft ramp above it, and how far the bend reaches. */
const BAND = 8;
/**
 * The lip above the lane's foot, as the page's foot band sits above the view's (`WISP_EDGE_FOOT_LIFT`), and for the
 * same reason: at the foot itself the lane's own fade has already taken the cards, so the strongest bend happens to
 * nothing and what shows is a plain dark gradient (Matt, of the page's: "it's just a black gradient not the cool
 * effect"). Half the page's 36, as this band's lip and ramp are half the page's: a card's words are smaller.
 */
const LIFT = 18;
const SOFT = 16;
/** Room above the ramp, so the drift never reaches the top of what is computed. */
const SLACK = 16;
/** The band at full size: the lip, the room above it, and the ramp's four sigma. */
const FULL = BAND + LIFT + SOFT * 4;

/**
 * A short lane gets the same band, made smaller, rather than no band at all.
 *
 * The band has to fit above the lane's foot, so a lane shorter than the band was simply left with the plain fade -
 * and lifting the lip to clear the fade (above) raised that floor from 88px to 106px, which took the smoke off
 * boards written `height=6` (about 91px). Matt asked for those back, and for the ramp to shorten to get them:
 * "make them smoke again". Shortening it for every lane would have paid for the short ones with a tighter, more
 * abrupt smoke on the tall ones that already look right, so the shortening is only where it is needed. `fit`
 * answers 1 for any lane with room for the whole band - every lane at `height=7` and up, and so every lane that
 * smoked before this - and shrinks the lip, the room and the ramp together below that, which keeps the band's
 * shape and only changes its size. Measured, tall lanes come out identical and a 91px lane smokes.
 *
 * Under `LEAST` the band would be a hairline standing in for smoke, so there the lane keeps the plain fade: about
 * 61px, a card and a half, which is under the shortest lane a board can be written with anyway (`height=5`).
 */
const LEAST = 0.5;
function fit(height: number): number {
  return Math.min(1, Math.max(LEAST, (height - SLACK) / FULL));
}
/** The band's parts at a lane's own height, all scaled together. */
function band(height: number): { band: number; lift: number; soft: number; reach: number } {
  const of = fit(height);
  return { band: BAND * of, lift: LIFT * of, soft: SOFT * of, reach: FULL * of + SLACK };
}
/** The shortest lane that still carries a band; under it the plain fade. */
const SHORTEST = FULL * LEAST + SLACK;
/** The strip reaches this far below the lane, so its blur never opens the foot. */
const BELOW = 120;
/** How far outside the lane the bend may throw a pixel, and so how far the region reaches around it. */
const SIDE = 40;
/** Smaller than the page's: a card's words are smaller than a page's. */
const BEND = 28;
const BLUR = 2.4;
const NEAR = 2;
/**
 * The lane's own fade, in px, for a lane of `height` (editor/boards.ts `laneFoot` sets it,
 * `.cm-boardStack[data-more]` wears it). Derived from the lip rather than written beside it: the fade must START
 * below where the band reaches full strength, or it is back to rubbing out the bend it was meant to sit under. It
 * was `1.2em`, which is about 20px in a board's type and about 26px at the largest text size - the width of the
 * whole lip - so the two would have drifted apart on the reader's own dial and only at one end of it. It takes the
 * lane's height because the lip does (`fit`): a short lane's smaller band needs a shorter fade under it, or the
 * fade swallows the band again on exactly the lanes this was for.
 */
export function wispFootFade(height: number): number {
  const shape = band(height);
  return shape.band + shape.lift - 4 * fit(height);
}
/** How many sizes are kept before the oldest is taken out. */
const KEEP = 24;

const SVG = 'http://www.w3.org/2000/svg';
const made = new Map<string, string>();
let holder: SVGSVGElement | null = null;

export function wispFoot(height: number, width: number): string | null {
  if (typeof document === 'undefined' || !preferences().wispEdge) return null;
  if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  const tall = Math.round(height);
  const wide = Math.round(width) + SIDE * 2;
  if (tall < SHORTEST || wide <= SIDE * 2) return null;
  // The budget is counted in the screen's own pixels; a lane past it keeps the plain fade.
  const dots = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
  if (Math.ceil(wide * dots) * Math.ceil((tall + SIDE * 2 + BELOW) * dots) > WISP_EDGE_BUDGET) return null;
  const key = `${wide}x${tall}`;
  const known = made.get(key);
  if (known && document.getElementById(known)) return `url(#${known})`;
  const id = `wispFoot${wide}x${tall}`;
  holder ??= makeHolder();
  if (!holder.isConnected) document.body.append(holder);
  holder.append(footFilter(id, tall, wide));
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
 * The foot band of art/WispEdgeFilter.tsx at `height`: noise, a white strip from the lane's lip down on black,
 * blurred into a ramp that decides where the noise bends the lane, a softened copy kept to the strokes, and the lane
 * itself everywhere the band isn't. The bend and the blur are only worked out over the band's reach, which is most
 * of what this effect costs: measured in headless WebKit on two lanes scrolling, the same filter with its
 * subregions taken off went from 66ms a frame to 118ms, so they stay even though they are the fiddliest part of
 * saying all of this in the lane's own box.
 */
function footFilter(id: string, height: number, wide: number): Element {
  // The lane itself, inside the region: the region reaches SIDE past each edge, so the box it is measured against is
  // narrower than the filter by both of those.
  const across = wide - SIDE * 2;
  // The lip, the room above it and the ramp, at this lane's own size (`fit`): the same band, smaller on a short lane.
  // Not `part`: that is the element builder above, and a local of the same name would shadow it.
  const shape = band(height);
  /** A box along the lane's width, its height, or across it - what a length has to be divided by to be a fraction. */
  const box = (x: number, y: number, w: number, h: number) => ({ x: x / across, y: y / height, width: w / across, height: h / height });
  /** feDisplacementMap measures its throw against this, the box's diagonal over root two. */
  const corner = Math.sqrt((across * across + height * height) / 2);
  const reach = box(-SIDE, height - shape.reach, wide, shape.reach + 40);
  const merge = (result: string, ...inputs: string[]) =>
    part('feMerge', result ? { result } : {}, ...inputs.map((input) => part('feMergeNode', { in: input })));
  return part(
    'filter',
    {
      id,
      filterUnits: 'objectBoundingBox',
      primitiveUnits: 'objectBoundingBox',
      ...box(-SIDE, -SIDE, wide, height + SIDE * 2 + BELOW),
      'color-interpolation-filters': 'sRGB',
    },
    /*
     * Per pixel, like every other wisp in the app, and NOT converted with the lengths around it.
     * `primitiveUnits="objectBoundingBox"` does not reach `baseFrequency`: an engine reads a frequency in the
     * filter's own space whatever the units attribute says. Converting it multiplied the frequency by the lane, so
     * the noise came out a couple of hundred times too fine and the smoke read as static (Matt, of the tab row's,
     * which had the same line: "grainy"). Measured on bare turbulence, 240x120, neighbouring-pixel difference:
     * userSpaceOnUse per pixel 1.9 across / 5.8 down, objectBoundingBox per pixel 1.9 / 5.8 - the same cloud - and
     * objectBoundingBox times the box 33.6 / 34.7, which is the static. WebKit gives 1.8 / 5.7, 1.8 / 5.6 and
     * 33.6 / 34.6, so the two engines agree and one per-pixel constant serves both.
     */
    part('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.02 0.07', numOctaves: 2, seed: 3, ...reach, result: 'rawNoise' }),
    part('feColorMatrix', { in: 'rawNoise', type: 'matrix', values: '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0 1', result: 'noise' }),
    part('feFlood', { 'flood-color': '#000', result: 'black' }),
    part('feFlood', { 'flood-color': '#fff', ...box(-SIDE, height - shape.band - shape.lift, wide, shape.band + shape.lift + BELOW), result: 'strip' }),
    merge('stripOnBlack', 'black', 'strip'),
    part('feGaussianBlur', { in: 'stripOnBlack', stdDeviation: `0 ${shape.soft / height}`, result: 'band' }),
    part('feComposite', { in: 'noise', in2: 'band', operator: 'arithmetic', k1: 1, k2: 0, k3: -0.5, k4: 0.5, result: 'field' }),
    part('feDisplacementMap', { in: 'SourceGraphic', in2: 'field', scale: BEND / corner, xChannelSelector: 'R', yChannelSelector: 'G', ...reach, result: 'bent' }),
    // Both numbers, always: one fraction shared between a wide lane and a short one is two different blurs.
    part('feGaussianBlur', { in: 'bent', stdDeviation: `${BLUR / across} ${BLUR / height}`, ...reach, result: 'soft' }),
    part('feMorphology', { in: 'bent', operator: 'dilate', radius: `${NEAR / across} ${NEAR / height}`, ...reach, result: 'near' }),
    part('feComposite', { in: 'soft', in2: 'near', operator: 'in', result: 'softNear' }),
    part('feColorMatrix', { in: 'band', type: 'luminanceToAlpha', result: 'bandAlpha' }),
    part('feComposite', { in: 'softNear', in2: 'bandAlpha', operator: 'in', result: 'smoke' }),
    part('feComposite', { in: 'SourceGraphic', in2: 'bandAlpha', operator: 'out', result: 'rest' }),
    part('feComposite', { in: 'bent', in2: 'bandAlpha', operator: 'in', result: 'bentIn' }),
    merge('', 'rest', 'bentIn', 'smoke'),
  );
}
