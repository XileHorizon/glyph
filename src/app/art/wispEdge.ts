import { usePreferences } from '../core/preferences.ts';
import { useEffect, useState, type RefObject } from 'react';
import { installWispMasks, type WispDraw, wispDraw } from './wispMask.ts';

/**
 * The wisp edge: the app's standard soft top for anything that scrolls under
 * a header. Content slipping up behind the header goes to smoke, with the
 * headline's own effect (art/WispText.tsx: fractal noise bending the picture,
 * a blur softening it), and the bend grows the higher the content goes
 * (Matt: "the wisp effect should get stronger the higher up it goes"), from
 * nothing about 40px under the header's edge to its full strength at it.
 * Matt: "use this blur animation wisp effect behind every header on the app,
 * save it as a standard mask effect we'll use quite frequently".
 *
 * A header that sits over the scroller (the guide's, a note's) is a solid
 * pane of the page's paper (app.css `.app-headerPane`), with the wisp a
 * little way under its edge, short and tight (Matt, after glass: "do a solid
 * black background, just make the wisp effect move down a bit further and
 * condense it vertically a bit"). Pass the header as `under`, and the band
 * moves down below its bottom edge, with `--wisp-under` set on the scroller
 * for its own padding; the top fade (`--wisp-top-fade`) is only for a
 * scroller with no header.
 *
 * While a view is being scrolled, the smoke drifts, and when the scrolling
 * stops it holds where it is (Matt: "only animate when we're actively
 * scrolling"; it used to drift the whole time a view sat scrolled). The noise
 * slides up and down and its frequency breathes, on the
 * animation clock at about 35 steps a second (eight a second "makes it look
 * choppy"), each step redrawing the band only: the filter computes the noise,
 * the bend and the blur over the band's reach and leaves the rest of the view
 * alone. Still while nothing is scrolled, while the page is hidden, with
 * reduced motion, and while a recording holds it (`holdWispDrift`). Matt
 * tried a stiller, gentler band and asked for this one back: "Go back to the
 * one I said was too intense".
 *
 * To use it: mount `<WispEdgeFilter />` once (App.tsx does), and call
 * `useWispEdge(scrollerRef)` for the element that scrolls. The effect is only
 * worn once the element has been scrolled off its top (the `data-wisp-edge`
 * attribute, styled in app.css), so a still, unscrolled view pays nothing.
 */

export const WISP_EDGE_FILTER_ID = 'wispEdge';
/** The foot's band, a filter of its own so a view that wants only its foot never draws another view's header band. */
export const WISP_EDGE_FOOT_FILTER_ID = 'wispEdgeFoot';
export const WISP_EDGE_NOISE_ID = 'wispEdgeNoise';
export const WISP_EDGE_DRIFT_ID = 'wispEdgeDrift';
export const WISP_EDGE_STRIP_ID = 'wispEdgeStrip';
export const WISP_EDGE_BENT_ID = 'wispEdgeBent';
export const WISP_EDGE_SOFT_ID = 'wispEdgeSoft';
export const WISP_EDGE_NEAR_ID = 'wispEdgeNear';
export const WISP_EDGE_FOOT_NOISE_ID = 'wispEdgeFootNoise';
export const WISP_EDGE_FOOT_DRIFT_ID = 'wispEdgeFootDrift';
export const WISP_EDGE_FOOT_STRIP_ID = 'wispEdgeFootStrip';
export const WISP_EDGE_FOOT_BENT_ID = 'wispEdgeFootBent';
export const WISP_EDGE_FOOT_NEAR_ID = 'wispEdgeFootNear';
export const WISP_EDGE_FOOT_SOFT_ID = 'wispEdgeFootSoft';

/**
 * How far under the header's edge the smoke still bends a little (the strip's
 * blur, a long ramp: Matt found a short one "quite abrupt", and a 40px one
 * "way too subtle"), and its full-strength lip (Matt, of a 10px one under a
 * bend of 24: "can still be stronger on the header").
 */
export const WISP_EDGE_SOFT = 22;
export const WISP_EDGE_BAND = 10;
/** How far below a header's edge the band's lip sits: the smoke happens under a solid header, not hidden behind it. */
export const WISP_EDGE_DROP = 18;
/** The strip starts this far above the view, so its blur never opens the top. */
export const WISP_EDGE_ABOVE = 200;
/**
 * The filter's region: the view, with room around it for the bend to throw pixels into and for the strip above.
 *
 * It used to be one guess big enough for any view - 4000 by 60000 - and that is what took the effect off Apple's
 * engine for a while (Matt, on the Mac: "the whole page is going black when I scroll down"). A filter region has a
 * budget of 2^24 device pixels, and over it WebKit draws nothing and the element paints solid black: measured in
 * WebKit, 4096 x 4096 draws and 4200 x 4000 is black, and at two device pixels to the CSS pixel the boundary moves
 * to 2048 x 2048 exactly. The old region was forty times over it. Sized to the view it is nowhere near - the app's
 * own window is 430 x 860 - so `placeRegion` sets it from the view, and a window too large even for that keeps the
 * plain fade rather than risking the black.
 */
const WISP_EDGE_SIDE = 40;
const WISP_EDGE_CROWN = WISP_EDGE_ABOVE + 40;
const WISP_EDGE_BELOW = 40;
export const WISP_EDGE_BUDGET = 2 ** 24;
/** The foot's full-strength lip at the view's bottom edge, and how far the band is computed above it. */
export const WISP_EDGE_FOOT_BAND = 16;
/**
 * The foot's own ramp, and how far above the edge its lip sits: taller than the top's (Matt: "Make the bottom
 * distortion taller"), so words start to smoke well before the edge and go on smoking down to it, where the top's
 * band is a lip just under the header.
 */
export const WISP_EDGE_FOOT_SOFT = 44;
export const WISP_EDGE_FOOT_LIFT = 36;
/** How far below the band's lip the bend and blur are computed at all: past the strip's soft edge, with room for the drift. */
export const WISP_EDGE_REACH = WISP_EDGE_BAND + WISP_EDGE_SOFT * 4 + 48;

/** Steps no closer than this: about 35 a second, smooth to the eye, a third of the frames on a 120Hz phone. */
const DRIFT_STEP_MS = 28;
const BASE_X = 0.018;
const BASE_Y = 0.06;
/** The noise slides this far, down and up, over its cycle: never past the view's top. Quiet: Matt found more "too intense". */
const SLIDE_PX = 20;

let drifting = 0;
let driftFrame = 0;
let lastStep = 0;
let held = 0;

/**
 * Holds the drift still (the smoke stays where it is) until the answer is
 * called: each step re-renders the filtered view, main-thread work a
 * recording can do without. The capture engine holds it while the phone
 * listens.
 */
export function holdWispDrift(): () => void {
  held += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held -= 1;
  };
}

/**
 * One frame of the drift, on the animation clock so it never ticks (Matt, of
 * eight steps a second: "too slow, it makes it look choppy"): the noise slides
 * over a few seconds and its frequency breathes a little slower.
 */
function driftStep(now: number): void {
  driftFrame = requestAnimationFrame(driftStep);
  // The smoke's own clock only runs while it moves, so a scroll picks it up where the last one left it, not with a jump.
  const gap = lastFrameAt ? Math.min(now - lastFrameAt, 50) : 0;
  lastFrameAt = now;
  if (held > 0 || document.visibilityState !== 'visible') return;
  smokeClock += gap;
  if (now - lastStep < DRIFT_STEP_MS) return;
  lastStep = now;
  const noise = document.getElementById(WISP_EDGE_NOISE_ID);
  const slide = document.getElementById(WISP_EDGE_DRIFT_ID);
  if (!noise || !slide) return;
  const t = smokeClock;
  const x = BASE_X + 0.003 * Math.sin(t / 2600);
  const y = BASE_Y + 0.01 * Math.sin(t / 3400 + 1.3);
  const dx = (4 * Math.sin(t / 2300 + 0.7)).toFixed(2);
  const dy = (SLIDE_PX / 2 + (SLIDE_PX / 2) * Math.sin(t / 3100)).toFixed(2);
  noise.setAttribute('baseFrequency', `${x.toFixed(4)} ${y.toFixed(4)}`);
  slide.setAttribute('dx', dx);
  slide.setAttribute('dy', dy);
  // A view drawn as a mask (art/wispMask.ts) slides its smoke by the same amounts. Written on the views wearing it,
  // never on the root: a custom property set on the root thirty-five times a second invalidates style for everything
  // that inherits it, which is the whole document, whatever the mask itself costs (the lanes session's point).
  for (const view of masked()) {
    view.style.setProperty('--wisp-noise-x', `${dx}px`);
    view.style.setProperty('--wisp-noise-y', `${dy}px`);
  }
  // The foot's own noise drifts with the top's, so both ends of a view move as one smoke.
  document.getElementById(WISP_EDGE_FOOT_NOISE_ID)?.setAttribute('baseFrequency', `${x.toFixed(4)} ${y.toFixed(4)}`);
  const footSlide = document.getElementById(WISP_EDGE_FOOT_DRIFT_ID);
  footSlide?.setAttribute('dx', dx);
  footSlide?.setAttribute('dy', dy);
}

/** The views drawn as a mask right now: the drift slides their smoke by writing on them (app.css `--wisp-noise-x/y`). */
function masked(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-wisp-draw="mask"]')];
}

/** The drift's own time, advanced only while it runs; and the last frame's, to measure each step by. */
let smokeClock = 0;
let lastFrameAt = 0;

/** After the last scroll event, this long and the smoke holds still. */
const SCROLL_IDLE_MS = 160;

/** Counts the views drifting; the one animation loop runs while any is. */
function drift(on: boolean, reset = true): void {
  drifting += on ? 1 : -1;
  if (drifting === 1 && on) {
    lastFrameAt = 0;
    driftFrame = requestAnimationFrame(driftStep);
  }
  if (drifting <= 0) {
    drifting = 0;
    cancelAnimationFrame(driftFrame);
    // A scroll that stopped leaves the smoke as it was; only a view back at its top puts it back to rest.
    if (!reset) return;
    document.getElementById(WISP_EDGE_NOISE_ID)?.setAttribute('baseFrequency', `${BASE_X} ${BASE_Y}`);
    document.getElementById(WISP_EDGE_FOOT_NOISE_ID)?.setAttribute('baseFrequency', `${BASE_X} ${BASE_Y}`);
    for (const id of [WISP_EDGE_DRIFT_ID, WISP_EDGE_FOOT_DRIFT_ID]) {
      const slide = document.getElementById(id);
      slide?.setAttribute('dx', '0');
      slide?.setAttribute('dy', '0');
    }
    for (const view of masked()) {
      view.style.setProperty('--wisp-noise-x', '0px');
      view.style.setProperty('--wisp-noise-y', '0px');
    }
  }
}

/** How far above the view's bottom edge the foot's bend and blur are computed: its lip, its ramp, and room for the drift. */
export const WISP_EDGE_FOOT_REACH = WISP_EDGE_FOOT_BAND + WISP_EDGE_FOOT_SOFT * 4 + 48;

/**
 * Puts the foot band at the view's bottom edge, or takes it away: the same smoke as the top, so words scrolling off
 * the end dissolve instead of meeting a flat fade (Matt: "replace the areas where it's just a black fade and blur to
 * use the wisp fade effect"). `height` is the view's own height, since the filter's coordinates start at its top-left.
 */
function placeFoot(height: number, on: boolean): void {
  const strip = document.getElementById(WISP_EDGE_FOOT_STRIP_ID);
  const reach = WISP_EDGE_FOOT_REACH + 40 + WISP_EDGE_FOOT_LIFT;
  const top = height - WISP_EDGE_FOOT_LIFT - WISP_EDGE_FOOT_REACH;
  /*
   * The lip sits above the edge (`WISP_EDGE_FOOT_LIFT`), as the top band's sits below its header: where the words are still
   * there to bend. At the edge itself, where the lip used to be, the view's own fade (app.css `--wisp-foot-fade`) had
   * already taken them, so the strongest bend happened to nothing and what showed was the fade - a black gradient
   * where the header has smoke (Matt: "it's just a black gradient not the cool effect").
   */
  // Off: the strip is parked far below anything drawn, and nothing is computed for it.
  strip?.setAttribute('y', String(on ? height - WISP_EDGE_FOOT_LIFT - WISP_EDGE_FOOT_BAND : 1e6));
  strip?.setAttribute('height', String(WISP_EDGE_ABOVE + WISP_EDGE_FOOT_BAND));
  for (const id of [WISP_EDGE_FOOT_NOISE_ID, WISP_EDGE_FOOT_BENT_ID, WISP_EDGE_FOOT_NEAR_ID, WISP_EDGE_FOOT_SOFT_ID]) {
    const part = document.getElementById(id);
    part?.setAttribute('y', String(on ? top : 1e6));
    part?.setAttribute('height', String(on ? reach : 0));
  }
}

/**
 * Sizes the filter's region to the view about to wear it, and answers whether it fits the budget above.
 *
 * The window's size rather than the view's own: two views can be wearing the one filter at a time (a page with a
 * sheet over it), and a region cut to the smaller would clip the larger - what falls outside a filter's region is not
 * drawn at all, so the miss would be a page with its edges missing rather than a page without smoke.
 */
function placeRegion(el: HTMLElement): boolean {
  const across = Math.max(el.offsetWidth, typeof innerWidth === 'number' ? innerWidth : 0) + WISP_EDGE_SIDE * 2;
  const down = Math.max(el.offsetHeight, typeof innerHeight === 'number' ? innerHeight : 0) + WISP_EDGE_CROWN + WISP_EDGE_BELOW;
  // The budget is counted in the screen's own pixels, so a sharp screen spends two or three for each one here.
  const dots = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
  if (Math.ceil(across * dots) * Math.ceil(down * dots) > WISP_EDGE_BUDGET) return false;
  // Both bands' filters, each held to the budget on its own: an engine gives every filter its own buffer, so wearing
  // the two together does not pool them into one region twice the size.
  for (const id of [WISP_EDGE_FILTER_ID, WISP_EDGE_FOOT_FILTER_ID]) {
    const filter = document.getElementById(id);
    filter?.setAttribute('x', String(-WISP_EDGE_SIDE));
    filter?.setAttribute('y', String(-WISP_EDGE_CROWN));
    filter?.setAttribute('width', String(across));
    filter?.setAttribute('height', String(down));
  }
  return true;
}

/** The phone's status bar, in px: the app sets it on the root as `--app-safe-top` (app.css). */
function safeTop(): number {
  if (typeof getComputedStyle === 'undefined') return 0;
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-safe-top')) || 0;
}

/**
 * Moves the band down to sit under a header `under` px tall (0: at the view's top), and the bend's reach with it.
 * Off, the strip has no height at all, so a view wearing the filter for its foot alone has nothing at its top: a
 * page at rest under the header was smoking because the strip is always there while the filter is (Matt: "when
 * scrolled to top of page content under topbar shouldn't have ghostly effect").
 */
function placeBand(under: number, on = true): void {
  const drop = under > 0 ? WISP_EDGE_DROP : 0;
  document.getElementById(WISP_EDGE_STRIP_ID)?.setAttribute('height', String(on ? WISP_EDGE_ABOVE + under + drop + WISP_EDGE_BAND : 0));
  const reach = String(on ? 40 + under + drop + WISP_EDGE_REACH : 0);
  document.getElementById(WISP_EDGE_NOISE_ID)?.setAttribute('height', reach);
  document.getElementById(WISP_EDGE_BENT_ID)?.setAttribute('height', reach);
  document.getElementById(WISP_EDGE_NEAR_ID)?.setAttribute('height', reach);
  document.getElementById(WISP_EDGE_SOFT_ID)?.setAttribute('height', reach);
}

/**
 * Wears the wisp edge on `scroller` while it is scrolled off its top; answers
 * whether it is. `key` re-reads it when the content changes; `under` is a
 * header the scroller runs beneath.
 */
export function useWispEdge(
  scroller: RefObject<HTMLElement | null>,
  key?: unknown,
  under?: RefObject<HTMLElement | null>,
  options: {
    foot?: boolean;
    /**
     * What stands over the view's foot, a dock of buttons: the foot's smoke happens at its top edge rather than the
     * view's, and the view is gone below it (Matt: "The bottom bar doesn't give the wisp effect when content goes
     * behind it it shouldn't have the glass background just the wisp effect subtly"). At the view's own edge the
     * smoke was behind the buttons, where nobody could see it.
     */
    footOver?: RefObject<HTMLElement | null>;
    /**
     * How the smoke is drawn: the filter that bends the words, or the mask that tears them (art/wispMask.ts). Left
     * out, the platform decides - the mask in the Mac app, where the filter costs seconds a frame, the filter
     * elsewhere. A page comparing the two says which it wants.
     */
    draw?: WispDraw;
  } = {},
): boolean {
  const foot = options.foot ?? false;
  const footOver = options.footOver;
  const draw = options.draw;
  const [on, setOn] = useState(false);
  // Switched off under Settings > Animations, a page slips under its header with a clean edge (core/preferences.ts).
  const wanted = usePreferences().wispEdge;
  useEffect(() => {
    const el = scroller.current;
    if (!el || !wanted) return undefined;
    // Both refs are set by the time the effect runs; the header is read once so the cleanup sees the same node.
    const header = under?.current ?? null;
    const still = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Which drawing this view wears, said on the element for the stylesheet (app.css) and for anyone measuring.
    const mode = draw ?? wispDraw();
    const masked = mode === 'mask';
    if (masked) installWispMasks();
    el.dataset.wispDraw = mode;
    let worn = false;
    /** Whether the foot band is on this view right now. */
    let footWorn = false;
    /** Whether this view's scrolling is moving the smoke right now, and the wait for the scrolling to stop. */
    let moving = false;
    let idle = 0;
    const holdStill = (reset: boolean) => {
      window.clearTimeout(idle);
      if (!moving) return;
      moving = false;
      drift(false, reset);
    };
    let fitted = -1;
    /** What the band sits under: a header, or the phone's status bar on a view that has none. */
    let beneath = 0;
    /** Whether the filter's region can cover this view at all: a window past the budget goes without (`placeRegion`). */
    let roomy = false;
    const fit = () => {
      // A mask has no region and no budget: only the filter is held to one.
      roomy = masked || placeRegion(el);
      const height = header?.offsetHeight ?? 0;
      // With no header the status bar plays the part of one: the smoke's lip sits at its edge, so a page dissolves
      // as it reaches the clock instead of sliding under a flat scrim (app.css .app-statusScrim).
      beneath = height || safeTop();
      // The mask's lip, where the filter's strip would end: the stylesheet lays the band from it.
      if (masked) el.style.setProperty('--wisp-lip', `${beneath + (beneath > 0 ? WISP_EDGE_DROP : 0)}px`);
      // Only when it really changed: these set the scroller's own top padding, and writing them from a size observer
      // that then sees a new size would feed itself.
      if (height !== fitted) {
        fitted = height;
        el.style.setProperty('--wisp-under', `${height}px`);
        // Said on the view, for its scrollbar to start where the header ends (app.css `[data-under-header]`).
        el.toggleAttribute('data-under-header', height > 0);
        // Under a header the header hides the top; with no header the view dissolves into the status bar's own
        // ground, so what passes the clock is smoke rather than a flat fade (app.css .app-statusScrim).
        // Short, so the smoke has words to bend before they are gone: the lip sits a drop under the status bar, and a
        // fade that ran past it hid the bend and read as a black gradient (Matt: "not the cool effect").
        el.style.setProperty('--wisp-top-fade', height ? '0px' : 'calc(var(--app-safe-top, 0px) + 12px)');
      }
      if (worn && !masked) placeBand(beneath);
    };
    /** How much of the view's foot the dock covers: where the foot band sits, measured up from the view's bottom. */
    let covered = -1;
    const footAt = () => {
      const over = footOver?.current?.offsetHeight ?? 0;
      if (over !== covered) {
        covered = over;
        el.style.setProperty('--wisp-foot-inset', `${over}px`);
      }
      return el.offsetHeight - over;
    };
    const check = () => {
      // Scrolled off its top AND able to scroll: a view that stops scrolling (a note's page while the robot shows its
      // own card over it) keeps its scrollTop, and the band would go on smoking over whatever is under the header
      // (Matt: "when on the page where the AI is analyzing everything the top text looks distorted unexpectedly").
      const more = el.scrollHeight - el.clientHeight > 4;
      const scrolled = el.scrollTop > 4 && more && roomy;
      // The foot smokes while there is still something below the view's bottom edge to scroll to.
      const ending = foot && more && roomy && el.scrollTop < el.scrollHeight - el.clientHeight - 4;
      if (ending !== footWorn) {
        footWorn = ending;
        el.toggleAttribute('data-wisp-foot', ending);
        if (!masked) {
          placeFoot(footAt(), ending);
          // Wearing the filter for the foot alone: the top band stays off until this view is scrolled.
          if (ending && !worn) placeBand(beneath, false);
        } else {
          footAt();
        }
      } else if (ending) {
        if (masked) footAt();
        else placeFoot(footAt(), true);
      }
      setOn(scrolled);
      if (scrolled === worn) return;
      worn = scrolled;
      if (scrolled) {
        el.setAttribute('data-wisp-edge', '');
        if (!masked) placeBand(beneath);
      } else {
        el.removeAttribute('data-wisp-edge');
        // The top band goes with it: a view still wearing the filter for its foot must be crisp at its top.
        if (!masked) placeBand(beneath, false);
        holdStill(true);
      }
    };
    // Scrolling moves the smoke; a pause in it holds the smoke where it is.
    const onScroll = () => {
      check();
      if ((!worn && !footWorn) || still) return;
      if (!moving) {
        moving = true;
        drift(true);
      }
      window.clearTimeout(idle);
      idle = window.setTimeout(() => holdStill(false), SCROLL_IDLE_MS);
    };
    fit();
    check();
    el.addEventListener('scroll', onScroll, { passive: true });
    // The header's height, and the view's own: content that comes or goes can stop it scrolling without a scroll event.
    const resized = new ResizeObserver(() => {
      fit();
      check();
    });
    resized.observe(el);
    /*
     * The header by its border box, not the default content box. A header here is mostly padding - the list's is
     * `padding-block: calc(var(--app-safe-top) + ...)` around a title only a screen reader sees - so when the bar
     * above it changes height (the app stamping its height after the first paint, the Mac's title bar, the bar going
     * from one row to two) only the padding grows. The content box stays put, a content-box observer never fires,
     * and `--wisp-under` kept whatever the first `fit()` happened to catch: 16px on one load, 125 on the next, and
     * the workspace pills either under the bar or crowded against it. Measured: the same padding change fired a
     * content-box observer 0 times and a border-box one once. `fit()` reads `offsetHeight`, which is the border box,
     * so what is watched and what is measured now agree.
     */
    if (header) resized.observe(header, { box: 'border-box' });
    const dock = footOver?.current ?? null;
    if (dock) resized.observe(dock, { box: 'border-box' });
    return () => {
      el.removeEventListener('scroll', onScroll);
      resized.disconnect();
      el.removeAttribute('data-wisp-edge');
      el.removeAttribute('data-under-header');
      delete el.dataset.wispDraw;
      if (footWorn) {
        el.removeAttribute('data-wisp-foot');
        if (!masked) placeFoot(0, false);
      }
      holdStill(true);
    };
  }, [wanted, scroller, key, under, foot, footOver, draw]);
  return on;
}
