import { createElement, useEffect, useId, useLayoutEffect, useRef } from 'react';
import { cadence, planSwap, runLength, tokenize, type Step, type Token } from './wisp.ts';
import styles from './WispText.module.css';

/**
 * Words that arrive from smoke, a letter at a time, and swap whole words when
 * the text changes.
 *
 * Matt chose Wisp from the Apparition Type playground: each new letter is run
 * through an SVG turbulence that bends it like smoke in a draught and stills
 * as the letter sets, with a blur that lifts a beat later. This is that
 * treatment as a component. Give it `text`; the first text types itself in
 * at a hand's pace (or is simply there, with `still`), and every later text
 * is worked out word by word (art/wisp.ts): the words that stay put stay,
 * the words that go are untyped from their last letter, quicker and bending
 * as they thin out, and then the new words type in. So "Hold. Talk. Done."
 * becoming "Hold. Talk. Write." moves one word.
 *
 * The letters are the component's own DOM, not React's: a span per letter
 * whose class and filter change under a requestAnimationFrame, which runs
 * only while something is settling. Each settling letter has its own filter
 * (two sharing one flickered, both writing its scale every frame), from a
 * pool that grows as fast text needs it and caps at 48, after which the
 * oldest letter simply sets. The filter region is wide, so the smeared
 * strokes are never clipped, and it works in sRGB, so thin type doesn't
 * brighten while filtered. With reduced motion asked for, the text is shown
 * at rest and a change is a short fade.
 *
 * Cost: an SVG filter per settling letter is fine on the Fold and heavy on an
 * old phone, so this is for a headline, the guide's first page, not a note.
 */

interface WispTextProps {
  text: string;
  /** Letters a second when typing in. */
  pace?: number;
  /** The first text is shown at rest instead of typed in. */
  still?: boolean;
  /** The element to render: a span by default; a heading on a page. */
  as?: 'span' | 'p' | 'div' | 'h1' | 'h2' | 'h3';
  className?: string;
  /** Called once the text on screen has fully settled, with that text. */
  onSettled?: (text: string) => void;
  /** Called as each arriving letter starts to appear, with the letter: for a haptic tick per letter, say. Not for leaving letters, nor with reduced motion. */
  onLetter?: (letter: string) => void;
  /** A wait, in ms, before the first text starts to type in: titles on a page come in one after another. Later swaps don't wait. */
  delay?: number;
  /**
   * What moves as one: each letter (the default, a headline typed by hand), or each word, which arrives whole at its
   * first letter's moment under one filter. Words for a list of titles all typing at once: a filter and a layer a
   * letter there made the phone lag (Matt: "the titles loading in with the wisp animation is still lagging out").
   */
  unit?: 'letter' | 'word';
}

const SVG_NS = 'http://www.w3.org/2000/svg';
/** A class from the module, never the empty string (which classList refuses). */
const cls = (name: string): string => styles[name] ?? name;
/**
 * How long a letter takes to set, in ms; the fade runs the same length so neither ends first. Quickened twice on
 * Matt's word - "boosted by 33% speed", then "speed up the wisp animation on text" - so the arc is 0.56 of what it
 * first was and the letters come in at `SPEED` times the asked-for pace.
 */
const IN_MS = 346;
const IN_JITTER_MS = 100;
const SPEED = 16 / 9;
/** Untyping is quicker than typing. */
const OUT_MS = 345;
/** Letters leave this far apart. */
const OUT_GAP_MS = 26;
const POOL_MAX = 48;
const BEND = 34;
const SOFT = 5;

interface Slot {
  id: string;
  disp: Element;
  blur: Element;
  busy: boolean;
}

interface Run {
  slot: Slot;
  at: number;
  dur: number;
  dir: 'in' | 'out';
  scale: number;
  blur: number;
}

interface Phase {
  start: number;
  steps: Step[];
  next: number;
  /** When the last letter has settled, in ms from `start`. */
  length: number;
  then: () => void;
  /** Letters arriving, or leaving. */
  kind: 'in' | 'out';
}

/** The DOM and the motion, apart from React: made once per mounted component. */
class WispEngine {
  private readonly svg: SVGSVGElement;
  private readonly defs: SVGDefsElement;
  private body: HTMLElement | null = null;
  private readonly pool: Slot[] = [];
  private readonly active = new Map<HTMLElement, Run>();
  private letters: HTMLElement[][] = [];
  private text: string | null = null;
  private phase: Phase | null = null;
  private frame = 0;
  private lastTick = 0;
  private wait: (ch: string, next: string) => number;

  constructor(
    private readonly host: HTMLElement,
    private readonly idPrefix: string,
    pace: number,
    private readonly reduced: boolean,
    private onSettled: (text: string) => void,
    private readonly unit: 'letter' | 'word' = 'letter',
  ) {
    this.wait = cadence(pace * SPEED);
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('class', cls('defs'));
    this.svg.setAttribute('aria-hidden', 'true');
    this.defs = document.createElementNS(SVG_NS, 'defs');
    this.svg.appendChild(this.defs);
    host.appendChild(this.svg);
  }

  setPace(pace: number): void {
    this.wait = cadence(pace * SPEED);
  }

  private delay = 0;

  setDelay(ms: number): void {
    this.delay = Math.max(0, ms);
  }

  setOnSettled(onSettled: (text: string) => void): void {
    this.onSettled = onSettled;
  }

  private onLetter: (letter: string) => void = () => undefined;

  setOnLetter(onLetter: (letter: string) => void): void {
    this.onLetter = onLetter;
  }

  /** Shows `text`: typed in the first time (unless `still`), swapped word by word after. */
  set(text: string, still: boolean): void {
    if (text === this.text && !this.phase) return;
    const from = this.interrupt();
    if (this.reduced) {
      this.layout(tokenize(text), new Set());
      this.host.classList.remove(cls('faded'));
      if (from !== null) {
        // A change with reduced motion: the new text fades in, whole.
        void this.host.offsetWidth;
        this.host.classList.add(cls('faded'));
      }
      this.text = text;
      this.onSettled(text);
      return;
    }
    if (from === null && still) {
      this.layout(tokenize(text), new Set());
      this.text = text;
      this.onSettled(text);
      return;
    }
    const plan = planSwap(from ?? '', text, this.wait, OUT_GAP_MS);
    // The first text can wait its turn; a later swap is a change the eye is already watching for.
    const steps = from === null && this.delay ? plan.in.map((step) => ({ ...step, at: step.at + this.delay })) : plan.in;
    const arrive = () => {
      this.layout(plan.to, new Set(plan.diff.arriving));
      this.text = text;
      this.begin('in', steps, runLength(steps, IN_MS + IN_JITTER_MS), (step) => this.show(step), () => {
        this.phase = null;
        this.onSettled(text);
      });
    };
    if (plan.out.length) this.begin('out', plan.out, runLength(plan.out, OUT_MS), (step) => this.hide(step), arrive);
    else arrive();
  }

  /**
   * Lands the rest at once: the letters still in motion set where they are,
   * the ones yet to come simply appear (or go), and the settled callback
   * fires as it would have at the end. For a text whose tail is out of sight,
   * a title clamped to two lines whose visible letters have all arrived, so
   * the unseen letters cost no filters and no frames. Nothing to do when
   * nothing is moving.
   */
  finish(): void {
    // A leaving phase hands on to an arriving one through `then`; both are landed.
    for (let guard = 0; this.phase && guard < 3; guard += 1) {
      const phase = this.phase;
      this.phase = null;
      for (const [span, run] of this.active) this.settle(span, run);
      for (let i = phase.next; i < phase.steps.length; i += 1) {
        const span = this.letter(phase.steps[i]!);
        if (!span) continue;
        if (phase.kind === 'in') span.classList.remove(cls('hidden'));
        else span.classList.add(cls('hidden'));
      }
      phase.then();
    }
    cancelAnimationFrame(this.frame);
  }

  /** Takes its own nodes out and nothing else: the host is React's, and React removes it. */
  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.phase = null;
    this.active.clear();
    this.svg.remove();
    this.body?.remove();
    this.body = null;
  }

  /** Stops whatever is moving and lands on the text its letters belong to; answers that text (null before the first). */
  private interrupt(): string | null {
    if (!this.phase) return this.text;
    this.phase = null;
    for (const [span, run] of this.active) this.settle(span, run);
    if (this.text !== null) this.layout(tokenize(this.text), new Set());
    return this.text;
  }

  /** Words of letter spans, gaps as text: every letter of a `hidden` word waits, invisible, holding its place. */
  private layout(tokens: Token[], hidden: Set<number>): void {
    this.letters = [];
    const body = document.createElement('span');
    body.className = cls('body');
    body.setAttribute('aria-hidden', 'true');
    tokens.forEach((token, index) => {
      if (token.kind === 'gap') {
        body.appendChild(document.createTextNode(token.text));
        this.letters.push([]);
        return;
      }
      const word = document.createElement('span');
      word.className = cls('word');
      const spans: HTMLElement[] = [];
      for (const ch of token.text) {
        const span = document.createElement('span');
        span.className = hidden.has(index) ? `${cls('ch')} ${cls('hidden')}` : cls('ch');
        span.textContent = ch;
        word.appendChild(span);
        spans.push(span);
      }
      body.appendChild(word);
      this.letters.push(spans);
    });
    if (this.body) this.body.replaceWith(body);
    else this.host.appendChild(body);
    this.body = body;
  }

  private begin(kind: 'in' | 'out', steps: Step[], length: number, fire: (step: Step) => void, then: () => void): void {
    this.phase = { start: performance.now(), steps, next: 0, length, then, kind };
    this.phaseFire = fire;
    this.lastTick = 0;
    this.tick();
  }

  private phaseFire: (step: Step) => void = () => undefined;

  /** One frame: fire the letters whose moment has come, move every settling letter on, and stop when nothing is left. */
  private tick = (): void => {
    cancelAnimationFrame(this.frame);
    const now = performance.now();
    // Frames stop while the page is hidden or the phone is busy. Coming back,
    // the clock is moved on by the gap, so the letters carry on from where
    // they were instead of every overdue one arriving in the same frame.
    const gap = this.lastTick ? now - this.lastTick : 0;
    if (gap > 200) {
      if (this.phase) this.phase.start += gap;
      for (const run of this.active.values()) run.at += gap;
    }
    this.lastTick = now;
    const phase = this.phase;
    if (phase) {
      const elapsed = now - phase.start;
      while (phase.next < phase.steps.length && (phase.steps[phase.next]?.at ?? 0) <= elapsed) {
        this.phaseFire(phase.steps[phase.next]!);
        phase.next += 1;
      }
    }
    for (const [span, run] of this.active) {
      const t = Math.min(1, (now - run.at) / run.dur);
      // Arriving: the bend is over by three quarters of the way and the blur a
      // little later, so the last frames near zero, where a half pixel of
      // displacement shimmers on thin strokes, are not drawn. Leaving: the same
      // curve backwards, the letter thinning as it bends.
      const p = run.dir === 'in' ? t : 1 - t;
      const bend = Math.max(0, 1 - p / 0.72);
      const soft = Math.max(0, 1 - p / 0.9);
      const scale = BEND * bend * bend;
      const blur = SOFT * soft * soft;
      if (Math.abs(scale - run.scale) > 0.05) {
        run.slot.disp.setAttribute('scale', scale.toFixed(2));
        run.scale = scale;
      }
      if (Math.abs(blur - run.blur) > 0.02) {
        run.slot.blur.setAttribute('stdDeviation', blur < 0.05 ? '0' : blur.toFixed(2));
        run.blur = blur;
      }
      if (t >= 1) this.settle(span, run);
    }
    if (phase && phase.next >= phase.steps.length && now - phase.start >= phase.length && this.active.size === 0) {
      const then = phase.then;
      this.phase = null;
      then();
      return;
    }
    if (this.phase || this.active.size) this.frame = requestAnimationFrame(this.tick);
  };

  private slot(): Slot {
    const free = this.pool.find((s) => !s.busy);
    if (free) return free;
    if (this.pool.length >= POOL_MAX) {
      // Faster than anyone types: the oldest letter simply sets now, cleanly.
      let oldest: [HTMLElement, Run] | null = null;
      for (const entry of this.active) if (!oldest || entry[1].at < oldest[1].at) oldest = entry;
      if (oldest) {
        this.settle(oldest[0], oldest[1]);
        return oldest[1].slot;
      }
    }
    const i = this.pool.length;
    const id = `${this.idPrefix}-${i}`;
    const filter = document.createElementNS(SVG_NS, 'filter');
    filter.setAttribute('id', id);
    // Room for the bend and the blur: a letter is a dozen pixels wide and the
    // displacement reaches seventeen; a region cut to the letter's box clipped
    // the smeared strokes, and the clipped edge crawled as the noise moved.
    // A word is several letters wide, so its region needs a far smaller share of it for the same spill.
    const word = this.unit === 'word';
    filter.setAttribute('x', word ? '-40%' : '-300%');
    filter.setAttribute('y', '-150%');
    filter.setAttribute('width', word ? '180%' : '700%');
    filter.setAttribute('height', '400%');
    // In sRGB: the default linearRGB lightens the anti-aliased edges of thin
    // type, so a letter brightened while filtered and dimmed as the filter came off.
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    const noise = document.createElementNS(SVG_NS, 'feTurbulence');
    noise.setAttribute('type', 'fractalNoise');
    noise.setAttribute('baseFrequency', '0.018 0.06');
    noise.setAttribute('numOctaves', '2');
    noise.setAttribute('seed', String(i * 7 + 1));
    noise.setAttribute('result', 'n');
    const disp = document.createElementNS(SVG_NS, 'feDisplacementMap');
    disp.setAttribute('in', 'SourceGraphic');
    disp.setAttribute('in2', 'n');
    disp.setAttribute('scale', '0');
    disp.setAttribute('xChannelSelector', 'R');
    disp.setAttribute('yChannelSelector', 'G');
    disp.setAttribute('result', 'd');
    const blur = document.createElementNS(SVG_NS, 'feGaussianBlur');
    blur.setAttribute('in', 'd');
    blur.setAttribute('stdDeviation', '0');
    filter.append(noise, disp, blur);
    this.defs.appendChild(filter);
    const slot = { id, disp, blur, busy: false };
    this.pool.push(slot);
    return slot;
  }

  private letter(step: Step): HTMLElement | null {
    return this.letters[step.token]?.[step.char] ?? null;
  }

  /** A letter arrives, or by words a whole word at its first letter: visible, fading in, bent by its own filter until it sets. */
  private show(step: Step): void {
    if (this.unit === 'word') {
      if (step.char !== 0) return;
      const letters = this.letters[step.token] ?? [];
      const word = letters[0]?.parentElement;
      if (!word) return;
      for (const letter of letters) letter.classList.remove(cls('hidden'));
      const dur = IN_MS + Math.random() * IN_JITTER_MS;
      word.style.setProperty('--dur', `${Math.round(dur)}ms`);
      word.classList.add(cls('new'));
      this.bend(word, { dir: 'in', dur, scale: BEND, blur: SOFT });
      this.onLetter(word.textContent ?? '');
      return;
    }
    const span = this.letter(step);
    if (!span) return;
    span.classList.remove(cls('hidden'));
    const dur = IN_MS + Math.random() * IN_JITTER_MS;
    span.style.setProperty('--dur', `${Math.round(dur)}ms`);
    span.classList.add(cls('new'));
    this.bend(span, { dir: 'in', dur, scale: BEND, blur: SOFT });
    this.onLetter(span.textContent ?? '');
  }

  /** A letter leaves, or by words a whole word at its first letter: thinning as it bends, and gone at the end. */
  private hide(step: Step): void {
    if (this.unit === 'word') {
      if (step.char !== 0) return;
      const letters = this.letters[step.token] ?? [];
      const word = letters[0]?.parentElement;
      if (!word) return;
      word.style.setProperty('--out', `${OUT_MS}ms`);
      word.classList.add(cls('out'));
      this.bendOut(word, letters);
      return;
    }
    const span = this.letter(step);
    if (!span) return;
    span.style.setProperty('--out', `${OUT_MS}ms`);
    span.classList.add(cls('out'));
    this.bend(span, { dir: 'out', dur: OUT_MS, scale: 0, blur: 0 });
  }

  private bend(span: HTMLElement, run: Omit<Run, 'slot' | 'at'>): void {
    const slot = this.slot();
    slot.busy = true;
    slot.disp.setAttribute('scale', run.scale.toFixed(2));
    slot.blur.setAttribute('stdDeviation', run.blur.toFixed(2));
    span.style.filter = `url(#${slot.id})`;
    this.active.set(span, { ...run, slot, at: performance.now() });
    if (!this.phase) this.tick();
  }

  /** A whole word leaving: its letters are hidden with it once it has gone. */
  private bendOut(word: HTMLElement, letters: HTMLElement[]): void {
    this.leaving.set(word, letters);
    this.bend(word, { dir: 'out', dur: OUT_MS, scale: 0, blur: 0 });
  }

  /** The letters of each word leaving whole, to hide once it has gone. */
  private readonly leaving = new Map<HTMLElement, HTMLElement[]>();

  /** Crisp before the filter comes off, so taking it away changes nothing on screen. */
  private settle(span: HTMLElement, run: Run): void {
    run.slot.disp.setAttribute('scale', '0');
    run.slot.blur.setAttribute('stdDeviation', '0');
    span.style.filter = '';
    if (run.dir === 'in') {
      span.classList.remove(cls('new'));
    } else {
      span.classList.remove(cls('out'));
      const letters = this.leaving.get(span);
      if (letters) {
        for (const letter of letters) letter.classList.add(cls('hidden'));
        this.leaving.delete(span);
      } else {
        span.classList.add(cls('hidden'));
      }
    }
    run.slot.busy = false;
    this.active.delete(span);
  }
}

export function WispText({ text, pace = 14, still = false, as: Tag = 'span', className, onSettled, onLetter, delay = 0, unit = 'letter' }: WispTextProps) {
  const host = useRef<HTMLElement>(null);
  const engine = useRef<WispEngine | null>(null);
  const settled = useRef(onSettled);
  settled.current = onSettled;
  const letter = useRef(onLetter);
  letter.current = onLetter;
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');

  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return undefined;
    const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const made = new WispEngine(element, `wisp-${id}`, pace, reduced, (shown) => {
      // Settled: the host says so, for styles that wait for the last letter (a title's clamp).
      element.removeAttribute('data-wisp-typing');
      settled.current?.(shown);
    }, unit);
    // Typing past the bottom of a box that clips (a title clamped to two lines): the letters that show are all in,
    // so the host stops saying it types once they've settled, whatever is still arriving out of sight.
    let overflowed = 0;
    made.setOnLetter((ch) => {
      letter.current?.(ch);
      if (!overflowed && element.clientHeight && element.scrollHeight > element.clientHeight + 1) {
        // Once the last visible letter has set, the unseen tail lands at once rather than typing on for nobody.
        overflowed = window.setTimeout(() => made.finish(), IN_MS + IN_JITTER_MS);
      }
    });
    engine.current = made;
    return () => {
      window.clearTimeout(overflowed);
      made.destroy();
      engine.current = null;
    };
    // Made once; the text and pace are set below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    engine.current?.setPace(pace);
  }, [pace]);

  const lastText = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (text !== lastText.current) {
      lastText.current = text;
      host.current?.setAttribute('data-wisp-typing', '');
    }
    engine.current?.setDelay(delay);
    engine.current?.set(text, still);
    // The delay only matters to the first text, set here with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, still]);

  // The letters are aria-hidden (a screen reader would spell them out); the whole text is read from here.
  return createElement(
    Tag,
    { ref: host, className: [styles.text, className].filter(Boolean).join(' '), 'data-unit': unit === 'word' ? 'word' : undefined },
    createElement('span', { className: styles.read }, text),
  );
}
