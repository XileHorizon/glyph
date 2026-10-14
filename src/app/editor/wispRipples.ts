import { RangeSetBuilder, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { moving } from './wispArrivals.ts';

/**
 * Ripples through the words as the person talks: the recorder's page
 * (capture/LivePage.tsx) shows what it hears, and the voice runs through the
 * words still coming in, bending them in waves that swell with the mic level
 * and lie still in a pause. Matt: "the memo page should real time fade words
 * in with the wisp effect and should show the voice recording ripples giving
 * the text weird wisp ripples". The fading-in is wispArrivals.ts; this is
 * the ripples.
 *
 * Only the arriving words ripple, never the text already set around them
 * (Matt: "it makes all of the text around it into the wisp text; it should
 * only make text that's fading in as I'm talking in the wisp look"): the
 * ranges this draws on are the letters wispArrivals reports in motion, run
 * together into stretches, and a word that has settled drops out of it as it
 * sets. A few SVG filters are shared round the stretches, each a slow, wide
 * noise bending the words (low frequency across, higher down, so the wave
 * runs along them) with a touch of blur, its bend scaled by the level. The
 * noise sways a few pixels rather than sliding far, and the filter region is
 * wide around each stretch, so a short word bent hard is never clipped. The level is followed with a
 * quick rise and a slow fall, the way a needle moves, on the animation
 * clock at about thirty steps a second, and the loop stops altogether once
 * the voice has died away, so silence costs nothing. Reduced motion: no
 * ripples.
 *
 * The level comes from whoever mounts it, as a subscribe function, so this
 * knows nothing of the recorder (`RippleSource`); the pure parts are
 * exported for the tests.
 */

export interface RippleSource {
  /** Hears the level, 0 to 1, as it comes; answers how to stop hearing it. */
  subscribe(listener: (level: number) => void): () => void;
}

/**
 * The stretches rippling: the arriving letters in motion (wispArrivals.ts), in document order, run together where
 * only a space or two lies between them, so a phrase is one stretch. Letters leaving (ghosts) take no part.
 */
export function rippledRanges(state: EditorState): { from: number; to: number }[] {
  const letters = moving(state)
    .filter((m) => m.to > m.from)
    .map((m) => ({ from: m.from, to: m.to }))
    .sort((a, b) => a.from - b.from);
  const stretches: { from: number; to: number }[] = [];
  for (const letter of letters) {
    const last = stretches[stretches.length - 1];
    if (last && letter.from <= last.to + 2 && !state.doc.sliceString(last.to, letter.from).includes('\n')) last.to = Math.max(last.to, letter.to);
    else stretches.push({ ...letter });
  }
  return stretches;
}

/** The level followed: up quickly with a voice, down slowly after it. */
export function follow(shown: number, level: number): number {
  const rate = level > shown ? 0.45 : 0.08;
  const next = shown + (level - shown) * rate;
  return next < 0.004 ? 0 : next;
}

/** How far a line bends and blurs at a followed level: nothing in silence, a full wave by ordinary talking. */
export function shape(level: number): { scale: number; blur: number } {
  const amount = Math.min(1, level / 0.3);
  return { scale: Math.round(amount * amount * 30 * 10) / 10, blur: Math.round(amount * 1.4 * 100) / 100 };
}

interface Slot {
  noise: SVGElement;
  sway: SVGElement;
  bend: SVGElement;
  blur: SVGElement;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const FILTERS = 4;
const STEP_MS = 33;

let instances = 0;

const prefersStill = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function slot(defs: SVGDefsElement, id: string, seed: number): Slot {
  const filter = document.createElementNS(SVG_NS, 'filter');
  filter.setAttribute('id', id);
  // Wide margins for the bend and the sway, so a short stretch bent hard is never clipped and the noise never runs out.
  filter.setAttribute('x', '-150%');
  filter.setAttribute('y', '-150%');
  filter.setAttribute('width', '400%');
  filter.setAttribute('height', '400%');
  filter.setAttribute('color-interpolation-filters', 'sRGB');
  const noise = document.createElementNS(SVG_NS, 'feTurbulence');
  noise.setAttribute('type', 'fractalNoise');
  noise.setAttribute('baseFrequency', '0.007 0.045');
  noise.setAttribute('numOctaves', '2');
  noise.setAttribute('seed', String(seed));
  noise.setAttribute('result', 'n');
  const sway = document.createElementNS(SVG_NS, 'feOffset');
  sway.setAttribute('in', 'n');
  sway.setAttribute('dx', '0');
  sway.setAttribute('dy', '0');
  sway.setAttribute('result', 's');
  const bend = document.createElementNS(SVG_NS, 'feDisplacementMap');
  bend.setAttribute('in', 'SourceGraphic');
  bend.setAttribute('in2', 's');
  bend.setAttribute('scale', '0');
  bend.setAttribute('xChannelSelector', 'R');
  bend.setAttribute('yChannelSelector', 'G');
  bend.setAttribute('result', 'd');
  const blur = document.createElementNS(SVG_NS, 'feGaussianBlur');
  blur.setAttribute('in', 'd');
  blur.setAttribute('stdDeviation', '0');
  filter.append(noise, sway, bend, blur);
  defs.appendChild(filter);
  return { noise, sway, bend, blur };
}

export function wispRipples(source: RippleSource): Extension {
  if (prefersStill()) return [];
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;
      private readonly svg: SVGSVGElement;
      private readonly slots: Slot[] = [];
      private readonly marks: Decoration[] = [];
      private count = 0;
      private readonly stop: () => void;
      private level = 0;
      private shown = 0;
      private frame = 0;
      private last = 0;

      constructor(readonly view: EditorView) {
        instances += 1;
        const prefix = `wispripple-${instances}`;
        this.svg = document.createElementNS(SVG_NS, 'svg');
        this.svg.setAttribute('aria-hidden', 'true');
        this.svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
        const defs = document.createElementNS(SVG_NS, 'defs');
        this.svg.appendChild(defs);
        for (let i = 0; i < FILTERS; i += 1) {
          const id = `${prefix}-${i}`;
          this.slots.push(slot(defs, id, i * 13 + 5));
          this.marks.push(Decoration.mark({ class: 'cm-wispRipple', attributes: { style: `filter:url(#${id})` } }));
        }
        view.dom.appendChild(this.svg);
        this.redraw();
        this.stop = source.subscribe((level) => {
          this.level = Math.max(0, Math.min(1, level));
          if (!this.frame && this.level > 0) this.frame = requestAnimationFrame(this.tick);
        });
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || moving(update.state) !== moving(update.startState)) this.redraw();
      }

      destroy() {
        this.stop();
        cancelAnimationFrame(this.frame);
        this.svg.remove();
      }

      /** The words still arriving, each stretch wearing one of the shared filters; settled text wears none. */
      private redraw() {
        const builder = new RangeSetBuilder<Decoration>();
        const stretches = rippledRanges(this.view.state);
        stretches.forEach((stretch, i) => builder.add(stretch.from, stretch.to, this.marks[i % FILTERS]!));
        this.decorations = builder.finish();
        this.count = stretches.length;
      }

      private readonly tick = (now: number) => {
        this.frame = requestAnimationFrame(this.tick);
        if (now - this.last < STEP_MS) return;
        this.last = now;
        this.shown = follow(this.shown, this.level);
        // Nothing arriving, nothing to bend: the filters only move while there are words wearing them.
        if (this.count) this.pose(now / 1000);
        if (this.shown === 0 && this.level === 0) {
          // The voice has died away and the lines lie still: nothing to draw until it comes back.
          cancelAnimationFrame(this.frame);
          this.frame = 0;
        }
      };

      /** Every filter at time `t` and the followed level, each on its own phase. */
      private pose(t: number) {
        const { scale, blur } = shape(this.shown);
        this.slots.forEach((s, k) => {
          const phase = k * 1.7;
          s.sway.setAttribute('dx', (7 * Math.sin(t * 2.3 + phase)).toFixed(2));
          s.sway.setAttribute('dy', (5 * Math.sin(t * 1.6 + phase * 1.3)).toFixed(2));
          s.noise.setAttribute('baseFrequency', `${(0.007 + 0.002 * Math.sin(t * 0.9 + phase)).toFixed(4)} ${(0.045 + 0.012 * Math.sin(t * 0.7 + phase * 0.8)).toFixed(4)}`);
          s.bend.setAttribute('scale', String(scale));
          s.blur.setAttribute('stdDeviation', String(blur));
        });
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
  // Plain inline spans, so the line's kerning and wrapping are exactly what they are without the ripple.
  return [plugin, EditorView.baseTheme({ '.cm-wispRipple': {} })];
}
