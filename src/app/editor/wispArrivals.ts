import { Annotation, Facet, StateEffect, StateField, type EditorState, type Extension, type Range, type Transaction } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { motionScale } from '../core/preferences.ts';

/**
 * Words arriving in the editor from smoke, and leaving into it: the Wisp
 * treatment (art/WispText.tsx) for text the recorder writes into a note as it
 * is understood and rewritten.
 *
 * Matt: text should "appear and disappear with the Wisp effect as it's
 * understood and rewritten". The recorder dispatches its changes as ordinary
 * transactions with the `wisp` annotation; this extension does the rest:
 *
 * - Every letter a `heard` change inserts arrives out of smoke, one after
 *   another at a hand's pace even when a whole phrase lands at once.
 * - A `rewrite` change is diffed against the text it replaces, so a pending
 *   phrase firming up ("buy mil" to "buy milk") moves one letter, and the
 *   letters that really went are shown leaving, bending and thinning where
 *   they were.
 * - Only the newest letters are in motion, capped at a pool of filters, so a
 *   long note costs nothing but its last few words.
 * - With `typing` on, what the person types is treated the same way (Matt: "I
 *   want the text to fade in and delete away with the wisp effect as I
 *   type"): each typed letter arrives from smoke, a backspace leaves its
 *   letter going into it, and a long paste animates only its first letters.
 *
 * WispText owns its DOM; a note's is CodeMirror's, so here the motion is all
 * in the filter and none in the DOM: each moving letter is a mark decoration
 * carrying `filter: url(#one-of-the-pool)`, and the filter itself, with the
 * bend, the blur, the lift and the fade, is what a requestAnimationFrame
 * moves, in an svg the extension keeps beside the editor. CodeMirror may
 * rebuild a mark's span whenever its neighbours change; nothing is lost when
 * it does. With reduced motion asked for, nothing here happens at all.
 */

export type WispKind = 'heard' | 'rewrite';

/** Put on a transaction that writes what was heard, or rewrites a pending phrase. */
export const wisp = Annotation.define<{ kind: WispKind }>();

/** Whether typed and deleted text moves too. */
const typing = Facet.define<boolean, boolean>({ combine: (values) => values.some(Boolean) });

/**
 * Text deleted by hand leaves quickly, and quicker still in a run of backspaces (Matt: "if the item is being
 * backspaced make the animation quicker"): the smoke is a trace of what went, not something to wait for. A single
 * letter leaves no trace at all, because it read as a stutter while typing.
 */
const DELETE_MS = 140;
const DELETE_RUN_MS = 85;
/** Backspaces closer together than this are one run. */
const DELETE_RUN_GAP_MS = 350;
let lastDeleteAt = 0;

function deleteMs(now: number): number {
  const run = now - lastDeleteAt < DELETE_RUN_GAP_MS;
  lastDeleteAt = now;
  return run ? DELETE_RUN_MS : DELETE_MS;
}

/** A paste animates no more letters than this: past it the pool would only settle the first ones early. */
const PASTE_MAX = 40;

/** A letter that arrived, or the text that left, still in motion. */
export interface Moving {
  id: number;
  /** Arriving: the letter's range in the document. Leaving: an empty range at the point it left. */
  from: number;
  to: number;
  /** The text, for a ghost of what left; empty for an arrival. */
  gone: string;
  /** performance.now() at which its motion starts; later than now for letters still waiting their turn. */
  at: number;
  /** A tapped box's letter (`- [x]`, `- ( )`): it dissolves where it stands, without the throw or the lift. */
  box?: boolean;

  dur: number;
}

/**
 * Letters a phrase types in at, ms; the whole phrase never waits longer than the cap. The words follow each other
 * quickly (Matt: "the text needs to fade in way faster"), but each keeps its full arc: shortening that made the smoke
 * end before it read ("it seems shortening the animation was wrong").
 */
const STAGGER_MS = 8;
/** However long a word, the next one never waits longer than this behind it. */
const WORD_MAX_MS = 62;
const STAGGER_CAP_MS = 1350;
/**
 * Quicker again, another quarter off (Matt: "the fade in wisp effect needs to be boosted by 33% speed", then "speed
 * up the wisp animation on text"): arc, jitter and stagger together, so the words still arrive in order.
 */
const IN_MS = 350;
const IN_JITTER_MS = 100;
const OUT_MS = 380;
const POOL_MAX = 32;
const BEND = 34;
/**
 * How a tapped box's letter moves (`- [x]`, `- ( )`): a gentle throw, and no lift at all.
 *
 * The full bend throws a glyph's pixels up to seventeen pixels either way, and an arriving letter starts four
 * pixels low and rises into place. Across a word both read as smoke; on the one letter between two brackets that
 * stay put, they are the whole letter moving - sideways out of its box (Matt: "the x button still slides to the
 * left"), then up into it (Matt: "x button shifts down slightly when changing the status of a Todo checkbox").
 * A box's letter simply thickens and fades where it stands. Typing keeps both: its letters arrive among others,
 * with nothing fixed beside them to move against.
 */
const BOX_BEND = 8;
const BOX_LIFT = 0;
const SOFT = 5;
const LIFT = 4;

const settle = StateEffect.define<readonly number[]>();

/**
 * Fades a stretch of text that is already there in from smoke, a line at a time and quickly: the note opening (Matt:
 * "the text on notes should quickly fade in with the wisp"). One filter a line, so a screenful fits the pool.
 */
export const revealWisp = StateEffect.define<{ from: number; to: number }>();

/** The opening reveal: each piece this far behind the one before, the whole never longer than the cap; and its arc. */
const REVEAL_STEP_MS = 10;
const REVEAL_CAP_MS = 290;
const REVEAL_MS = 260;
/**
 * A piece of the reveal is a few words, never more than this many characters: short enough to sit on one row. A
 * whole paragraph as one piece was one filter the width of the page and several rows deep, redrawn every frame (Matt:
 * "loading the second row of text is still super laggy").
 */
const REVEAL_PIECE_CHARS = 24;
/** Pieces the opening reveal animates: about a screen; anything further down is already set when scrolled to. */
const REVEAL_PIECES = 48;

function revealing(state: EditorState, from: number, to: number, now: number): Moving[] {
  const moving: Moving[] = [];
  let line = state.doc.lineAt(Math.max(0, Math.min(from, state.doc.length)));
  const end = Math.min(to, state.doc.length);
  while (moving.length < REVEAL_PIECES) {
    const text = line.text;
    const words = /\S+/g;
    let piece: { from: number; to: number } | null = null;
    const flush = () => {
      if (!piece) return;
      moving.push({ id: nextId++, from: line.from + piece.from, to: line.from + piece.to, gone: '', at: now + Math.min(moving.length * REVEAL_STEP_MS, REVEAL_CAP_MS), dur: REVEAL_MS + Math.random() * IN_JITTER_MS });
      piece = null;
    };
    for (let word = words.exec(text); word && moving.length < REVEAL_PIECES; word = words.exec(text)) {
      const wordEnd = word.index + word[0].length;
      if (piece && wordEnd - piece.from > REVEAL_PIECE_CHARS) flush();
      if (piece) piece.to = wordEnd;
      else piece = { from: word.index, to: wordEnd };
    }
    flush();
    if (line.to >= end || line.number >= state.doc.lines) break;
    line = state.doc.line(line.number + 1);
  }
  return moving;
}

let nextId = 1;

/** The common prefix and suffix of `a` and `b`, as lengths, never overlapping. */
export function commonEnds(a: string, b: string): { prefix: number; suffix: number } {
  const shortest = Math.min(a.length, b.length);
  let prefix = 0;
  while (prefix < shortest && a[prefix] === b[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < shortest - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix += 1;
  return { prefix, suffix };
}

function prefersStill(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** What a wisp transaction sets in motion: the letters it really added, and the text it really took away. */
function movingIn(tr: Transaction, now: number, cap = Number.POSITIVE_INFINITY, outMs = OUT_MS, singleLetters = true, box?: boolean): Moving[] {
  const moving: Moving[] = [];
  let wait = 0;
  let letters = 0;
  tr.changes.iterChanges((fromA, toA, fromB, _toB, inserted) => {
    const removed = tr.startState.doc.sliceString(fromA, toA);
    const added = inserted.toString();
    const { prefix, suffix } = commonEnds(removed, added);
    const gone = removed.slice(prefix, removed.length - suffix);
    // A letter backspaced by hand just goes: a trace of smoke on each was a stutter under the fingers (Matt:
    // "deleting characters should be instant and not glitchy when typing"). A word or a selection taken out at once
    // still smokes, and so does a letter a rewrite takes back while the words are being heard, which is not typing.
    if (gone.trim() && (singleLetters || gone.trim().length > 1)) moving.push({ id: nextId++, from: fromB + prefix, to: fromB + prefix, gone, at: now, dur: outMs, box });
    // A word at a time, one filter each, in turn at the pace its letters would type: a letter per filter made a long
    // phrase bend sixty at once, the phone fell behind, and the rest arrived all together (Matt: "it still animates
    // one line or so and then rapidly finishes"). A single typed letter is its own word, so typing is unchanged.
    const end = added.length - suffix;
    let i = prefix;
    while (i < end && letters < cap) {
      while (i < end && !(added[i] ?? '').trim()) i += 1;
      if (i >= end) break;
      let j = i;
      while (j < end && (added[j] ?? '').trim() && letters < cap) {
        j += 1;
        letters += 1;
      }
      moving.push({ id: nextId++, from: fromB + i, to: fromB + j, gone: '', at: now + Math.min(wait, STAGGER_CAP_MS), dur: IN_MS + Math.random() * IN_JITTER_MS, box });
      wait += Math.min(WORD_MAX_MS, (j - i + 1) * STAGGER_MS);
      i = j;
    }
  });
  return moving;
}

/** Motion set at the chosen pace (Settings > Animations): each piece's wait and its arc stretched or shortened alike. */
function paced(list: Moving[], now: number): Moving[] {
  const scale = motionScale();
  if (scale === 1) return list;
  return list.map((m) => ({ ...m, at: now + (m.at - now) * scale, dur: m.dur * scale }));
}

/** Everything in motion, mapped through every change, until the frame loop says it has settled. */
export const wispState = StateField.define<readonly Moving[]>({
  create: () => [],
  update(moving, tr) {
    let next = moving;
    if (tr.docChanged) {
      next = next.flatMap((m) => {
        const from = tr.changes.mapPos(m.from, m.gone ? -1 : 1);
        const to = tr.changes.mapPos(m.to, -1);
        // A word the change took away entirely is done moving.
        if (!m.gone && to <= from) return [];
        return [{ ...m, from, to }];
      });
    }
    for (const effect of tr.effects) {
      if (effect.is(revealWisp) && !prefersStill()) {
        const now = performance.now();
        next = [...next, ...paced(revealing(tr.state, effect.value.from, effect.value.to, now), now)];
      }
      if (effect.is(settle)) {
        const done = new Set(effect.value);
        next = next.filter((m) => !done.has(m.id));
      }
    }
    if (!tr.docChanged || prefersStill()) return next;
    if (tr.annotation(wisp)) {
      const now = performance.now();
      return [...next, ...paced(movingIn(tr, now), now)];
    }
    // A board's own edits are not typing (editor/boards.ts): a card ticked, moved or added rewrites the item's box and
    // the fence under the drawing, and none of that is a letter someone wrote.
    if (tr.isUserEvent('input.board')) return next;
    if (tr.state.facet(typing) && (tr.isUserEvent('input') || tr.isUserEvent('delete'))) {
      const now = performance.now();
      const deleting = tr.isUserEvent('delete');
      // A tapped box turns one letter between two that stay put: it dissolves where it stands.
      const box = tr.isUserEvent('input.toggle') || tr.isUserEvent('input.choice');
      return [...next, ...paced(movingIn(tr, now, tr.isUserEvent('input.paste') ? PASTE_MAX : Number.POSITIVE_INFINITY, deleting ? deleteMs(now) : OUT_MS, !deleting, box), now)];
    }
    return next;
  },
});

/** The letters and ghosts in motion right now, for a test or a caller wondering whether to wait. */
export function moving(state: EditorState): readonly Moving[] {
  return state.field(wispState, false) ?? [];
}

const SVG_NS = 'http://www.w3.org/2000/svg';

interface Slot {
  id: string;
  disp: Element;
  blur: Element;
  lift: Element;
  alpha: Element;
  busy: boolean;
  filter: Element;
  /** Whether the filter's region has been fitted to the word now using it. */
  sized: boolean;
}

class Ghost extends WidgetType {
  constructor(
    readonly text: string,
    readonly filterId: string,
    readonly id: number,
    /** The classes the text had where it stood, so its smoke is the same letters (`lookAt`). */
    readonly look: string,
  ) {
    super();
  }

  eq(other: Ghost): boolean {
    return other.text === this.text && other.filterId === this.filterId && other.id === this.id && other.look === this.look;
  }

  /**
   * A place that takes no room, with the text that went drawn over it. Inline, the ghost held the text after it in
   * its old place for the whole fade and then let it snap back, and a held backspace in the middle of a line shuffled
   * the rest of the line to and fro (Matt: "backspacing text in the middle of other text is quite glitchy"). Now the
   * line closes up at once and the letters smoke away where they were, over it.
   *
   * Where they were, and they stay there (`pinGhosts`): the place is where the text went, so the next backspace,
   * taking the letter before it, carried the last one's smoke back a letter, and it was drawn right-aligned to the
   * place, a letter left of the letter it was (Matt: "backspacing on the ghostly text is a bit glitchy and it shifts
   * the text being deleted back instead of fading away in place").
   */
  toDOM(): HTMLElement {
    const place = document.createElement('span');
    place.className = 'cm-wispGonePlace';
    place.dataset.wispGhost = String(this.id);
    place.setAttribute('aria-hidden', 'true');
    const span = document.createElement('span');
    span.className = this.look ? `cm-wispGone ${this.look}` : 'cm-wispGone';
    span.textContent = this.text;
    span.style.filter = `url(#${this.filterId})`;
    place.appendChild(span);
    return place;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

let instances = 0;

const wispPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet = Decoration.none;
    private readonly svg: SVGSVGElement;
    private readonly defs: SVGDefsElement;
    private readonly prefix: string;
    private readonly pool: Slot[] = [];
    private readonly slots = new Map<number, Slot>();
    private frame = 0;

    constructor(readonly view: EditorView) {
      instances += 1;
      this.prefix = `wispcm-${instances}`;
      this.svg = document.createElementNS(SVG_NS, 'svg');
      this.svg.setAttribute('aria-hidden', 'true');
      this.svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
      this.defs = document.createElementNS(SVG_NS, 'defs');
      this.svg.appendChild(this.defs);
      view.dom.appendChild(this.svg);
      this.redraw();
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.startState.field(wispState) !== update.state.field(wispState)) this.redraw();
    }

    destroy() {
      cancelAnimationFrame(this.frame);
      this.svg.remove();
    }

    /**
     * A filter for each thing in motion, kept while it moves; the marks and ghosts that carry them. A letter whose
     * turn hasn't come is only hidden, and takes no filter until it has: a long phrase then types across at its pace
     * with the pool holding just the letters mid-arc, where it used to fill on the first line and settle the rest at
     * once (Matt: "it still animates one line or so and then rapidly finishes").
     */
    private redraw() {
      const current = this.view.state.field(wispState);
      const now = performance.now();
      const alive = new Set<number>();
      const ranges: Range<Decoration>[] = [];
      this.nextDue = Number.POSITIVE_INFINITY;
      for (const m of current) {
        alive.add(m.id);
        if (!m.gone && m.at > now) {
          this.nextDue = Math.min(this.nextDue, m.at);
          if (m.to > m.from) ranges.push(Decoration.mark({ class: 'cm-wispWait' }).range(m.from, m.to));
          continue;
        }
        let slot = this.slots.get(m.id);
        if (!slot) {
          // A word never takes a filter from one still moving: with none free it waits its turn, unseen, and starts
          // when one settles. So a long phrase keeps arriving at the pace the phone can draw, instead of the rest
          // being set all at once to make room.
          const found = this.slot(Boolean(m.gone));
          if (!found) {
            /*
             * It waits, and nothing here asks for another look. When one settles, the `settle` it dispatches redraws
             * through the editor's own update, and this word takes the filter that was freed.
             *
             * It used to set `nextDue = now` to look again next frame, and that was a livelock: `tick` sees
             * `now >= nextDue` every frame, redraws and returns before the part of it that settles letters - and
             * settling is the only thing that frees a filter. So past 32 letters in motion none ever finished: 32
             * stayed mid-blur for good while the frame loop ran on at 60 a second. Measured typing at machine speed:
             * 20 and 40 letters settled, 60 and 90 froze at exactly 32. It only ever ran with the pool full, so
             * typing under 32 letters behaves exactly as it did. A paragraph arriving at once - pasted, or from
             * another device - is the case it broke.
             */
            if (!m.gone && m.to > m.from) ranges.push(Decoration.mark({ class: 'cm-wispWait' }).range(m.from, m.to));
            continue;
          }
          slot = found;
          slot.sized = false;
          this.slots.set(m.id, slot);
          this.starts.set(m.id, Math.max(m.at, now));
          // Not yet on screen until its moment: fully bent, blurred and clear.
          this.shape(slot, m.gone ? 1 : 0, Boolean(m.gone), Boolean(m.box));
        }
        if (m.gone) ranges.push(Decoration.widget({ widget: new Ghost(m.gone, slot.id, m.id, this.lookAt(m.from)), side: -1 }).range(m.from));
        else if (m.to > m.from) ranges.push(Decoration.mark({ class: 'cm-wispCh', attributes: { style: `filter:url(#${slot.id})` } }).range(m.from, m.to));
      }
      for (const [id, slot] of this.slots) {
        if (!alive.has(id)) {
          slot.busy = false;
          this.slots.delete(id);
          this.starts.delete(id);
        }
      }
      for (const id of this.pins.keys()) if (!alive.has(id)) this.pins.delete(id);
      if (current.some((m) => m.gone)) this.view.requestMeasure({ key: this.pinKey, read: () => this.readGhosts(), write: (read) => this.pinGhosts(read) });
      ranges.sort((a, b) => a.from - b.from || (a.value.startSide ?? 0) - (b.value.startSide ?? 0));
      this.decorations = Decoration.set(ranges, true);
      if (this.evicted.length) {
        const settled = this.evicted.splice(0);
        queueMicrotask(() => this.view.dispatch({ effects: settle.of(settled) }));
      }
      if (current.length) {
        cancelAnimationFrame(this.frame);
        this.frame = requestAnimationFrame(this.tick);
      }
    }

    /** Where each ghost first drew, against the top left of the content: it is held there until it has gone. */
    private readonly pins = new Map<number, { x: number; y: number }>();
    private readonly pinKey = {};

    /** Every ghost's place as it lays out now, after this update's DOM, before it is painted. */
    private readGhosts() {
      const content = this.view.contentDOM.getBoundingClientRect();
      return [...this.view.contentDOM.querySelectorAll<HTMLElement>('.cm-wispGonePlace[data-wisp-ghost]')].map((place) => {
        const rect = place.getBoundingClientRect();
        return { place, id: Number(place.dataset.wispGhost), x: rect.left - content.left, y: rect.top - content.top };
      });
    }

    /**
     * How the text that went was drawn: the classes on the span it stood in, given to its smoke.
     *
     * A ghost is CodeMirror's widget, a child of the line rather than of the span the letters were in, so it took the
     * note's prose face and plain ink whatever they had been. A to-do's `x` is set in the monospace face and the accent
     * colour (editor/glyphLines.ts, Editor.module.css), and its smoke, a narrower prose `x` on the same left edge, read
     * as the letter hopping left before it faded (Matt: "it jumps to the left then fades away instead of fading in
     * place"). Bold, code and a heading's letters smoke as themselves for the same reason.
     */
    private lookAt(pos: number): string {
      const at = this.view.domAtPos(pos);
      const node = at.node.nodeType === 3 ? at.node.parentElement : (at.node as HTMLElement);
      const span = node?.closest('.cm-line > span, .cm-line span') ?? null;
      if (!span || span.classList.contains('cm-wispGonePlace')) return '';
      return [...span.classList].filter((cls) => cls !== 'cm-wispCh' && cls !== 'cm-wispWait').join(' ');
    }

    /** A new ghost is pinned where it is; one whose place has moved since (the text before it deleted too) is drawn back at its pin. */
    private pinGhosts(ghosts: ReturnType<typeof this.readGhosts>) {
      for (const { place, id, x, y } of ghosts) {
        let pin = this.pins.get(id);
        if (!pin) {
          pin = { x, y };
          this.pins.set(id, pin);
        }
        const letters = place.firstElementChild as HTMLElement | null;
        if (letters) letters.style.translate = pin.x === x && pin.y === y ? '' : `${(pin.x - x).toFixed(1)}px ${(pin.y - y).toFixed(1)}px`;
      }
    }

    /** When the next waiting letter's turn comes, and the marks are drawn again with it moving. */
    private nextDue = Number.POSITIVE_INFINITY;

    /** Letters that lent their filter to a newer one during a pass, to be settled once the pass is over. */
    private evicted: number[] = [];

    /** When each word with a filter really began: its turn, or later if it had to wait for a filter. */
    private readonly starts = new Map<number, number>();

    /** One frame: every moving thing's filter set for its moment; the ones past the end handed back to settle. */
    private tick = () => {
      const now = performance.now();
      if (now >= this.nextDue) {
        // Its filter is set and its mark swapped in the same frame, so nothing shows plain in between; the empty
        // transaction is what makes the editor read the marks again.
        this.redraw();
        this.view.dispatch({});
        return;
      }
      const done: number[] = [];
      for (const m of this.view.state.field(wispState)) {
        const slot = this.slots.get(m.id);
        if (!slot) continue;
        if (!slot.sized) this.fit(slot, m);
        const t = (now - (this.starts.get(m.id) ?? m.at)) / m.dur;
        if (t >= 1) {
          done.push(m.id);
          continue;
        }
        this.shape(slot, Math.max(0, t), Boolean(m.gone), Boolean(m.box));
      }
      if (done.length) {
        this.view.dispatch({ effects: settle.of(done) });
        return;
      }
      if (this.slots.size || this.nextDue < Number.POSITIVE_INFINITY) this.frame = requestAnimationFrame(this.tick);
    };

    /**
     * Arriving: the bend is over by three quarters of the way and the blur a
     * little later, so the last frames near zero, where a half pixel of
     * displacement shimmers on thin strokes, are not drawn; the letter fades
     * in over the first third and lifts into place. Leaving: the same curves
     * backwards, thinning as it goes.
     */
    private shape(slot: Slot, t: number, leaving: boolean, box = false) {
      const p = leaving ? 1 - t : t;
      const spread = Math.max(0, 1 - p / 0.72);
      const soft = Math.max(0, 1 - p / 0.9);
      const alpha = leaving ? 1 - t : Math.min(1, t / 0.3);
      const bend = box ? BOX_BEND : BEND;
      const rise = box ? BOX_LIFT : LIFT;
      const lift = leaving ? -rise * 1.2 * t : rise * (1 - Math.min(1, t / 0.5));
      slot.disp.setAttribute('scale', (bend * spread * spread).toFixed(2));
      slot.blur.setAttribute('stdDeviation', (SOFT * soft * soft).toFixed(2));
      slot.lift.setAttribute('dy', lift.toFixed(2));
      slot.alpha.setAttribute('slope', alpha.toFixed(3));
    }

    /**
     * The filter's region, in shares of what it bends: wide around a single letter, which is a dozen pixels and the
     * bend reaches seventeen, and narrow around a word or a few, so a long piece doesn't paint several times its
     * width each frame. In shares of the element, never in pixels: a CSS filter's user space is not the word's own,
     * and a pixel region missed the text altogether (Matt: "the fade in and out of text with the wisp doesn't even
     * render").
     */
    private fit(slot: Slot, m: Moving) {
      slot.sized = true;
      const length = m.gone ? m.gone.length : m.to - m.from;
      const wide = length <= 1;
      slot.filter.setAttribute('x', wide ? '-300%' : length <= 4 ? '-80%' : '-30%');
      slot.filter.setAttribute('y', '-150%');
      slot.filter.setAttribute('width', wide ? '700%' : length <= 4 ? '260%' : '160%');
      slot.filter.setAttribute('height', '400%');
    }

    /** A free filter, a new one while the pool has room, or with `evict` (a deletion's ghost) the oldest one's. */
    private slot(evict = false): Slot | null {
      const free = this.pool.find((s) => !s.busy);
      if (free) {
        free.busy = true;
        return free;
      }
      if (this.pool.length >= POOL_MAX) {
        if (!evict) return null;
        // Faster than anyone talks: the oldest letter simply sets, cleanly, and lends its filter. Its settling is
        // dispatched after this pass: redraw can run inside an editor update, where a dispatch is not allowed.
        let oldest: [number, Slot] | null = null;
        for (const entry of this.slots) if (!oldest || entry[0] < oldest[0]) oldest = entry;
        if (!oldest) return null;
        this.slots.delete(oldest[0]);
        this.evicted.push(oldest[0]);
        oldest[1].busy = true;
        return oldest[1];
      }
      const i = this.pool.length;
      const id = `${this.prefix}-${i}`;
      const filter = document.createElementNS(SVG_NS, 'filter');
      filter.setAttribute('id', id);
      // Room for the bend and the blur, so the smeared strokes are never clipped; in sRGB, so thin type doesn't brighten.
      // Measured in pixels around the word, not in multiples of it: a region seven times a word's width made every
      // frame of a long phrase paint seven times the text it was moving.
      filter.setAttribute('x', '-150%');
      filter.setAttribute('y', '-100%');
      filter.setAttribute('width', '400%');
      filter.setAttribute('height', '300%');
      filter.setAttribute('color-interpolation-filters', 'sRGB');
      const noise = document.createElementNS(SVG_NS, 'feTurbulence');
      noise.setAttribute('type', 'fractalNoise');
      noise.setAttribute('baseFrequency', '0.018 0.06');
      noise.setAttribute('numOctaves', '1');
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
      blur.setAttribute('result', 'b');
      const lift = document.createElementNS(SVG_NS, 'feOffset');
      lift.setAttribute('in', 'b');
      lift.setAttribute('dx', '0');
      lift.setAttribute('dy', '0');
      lift.setAttribute('result', 'l');
      const transfer = document.createElementNS(SVG_NS, 'feComponentTransfer');
      transfer.setAttribute('in', 'l');
      const alpha = document.createElementNS(SVG_NS, 'feFuncA');
      alpha.setAttribute('type', 'linear');
      alpha.setAttribute('slope', '1');
      transfer.appendChild(alpha);
      filter.append(noise, disp, blur, lift, transfer);
      this.defs.appendChild(filter);
      const slot: Slot = { id, disp, blur, lift, alpha, busy: true, filter, sized: false };
      this.pool.push(slot);
      return slot;
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

// Plain inline spans: a letter box of its own (inline-block, as WispText's letters are) would change the
// line's kerning and wrapping, and the text under the filter must sit exactly where it does without it.
const wispTheme = EditorView.baseTheme({
  '.cm-wispCh': {},
  // Not its turn yet: there, so the line doesn't move, but unseen.
  '.cm-wispWait': { opacity: '0' },
  // An empty inline box, sitting on the line's own text box: its ghost lines up with the letters beside it.
  '.cm-wispGonePlace': { position: 'relative', display: 'inline' },
  /*
   * Left-aligned at where it went, which is where its first letter was; held there as the text around it moves
   * (`pinGhosts`).
   *
   * `text-indent: 0` is what keeps it there. Being positioned makes this span a block, and a block inherits the
   * hanging indent a list item's line carries (editor/glyphLines.ts writes `--hang`, and the line's first row is
   * pulled back by it): the smoke of a to-do's `x` was laid out a whole marker to the left - some sixty pixels - and
   * read as the letter leaping out of the box before it faded (Matt: "the x still jumps super far to the left").
   */
  '.cm-wispGone': { position: 'absolute', left: '0', top: '0', textIndent: '0', whiteSpace: 'pre', pointerEvents: 'none', userSelect: 'none' },
});

/** Text arriving from and leaving into smoke: transactions carrying the `wisp` annotation, and with `typing`, the person's own. */
export function wispArrivals(options: { typing?: boolean } = {}): Extension {
  return [typing.of(options.typing ?? false), wispState, wispPlugin, wispTheme];
}
