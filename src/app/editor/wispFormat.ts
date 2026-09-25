import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import type { InlineFormat } from '../plugins/types.ts';

/**
 * The look of a plugin formatting whose look is smoke (plugins/types.ts
 * `FormatLook` 'wisp'): the Spoiler plugin's `||secret||`. Every letter
 * between the delimiters is bent, blurred and half-there, without rest, so
 * the words can't be read until the caret is put in them; then they settle
 * to plain text for editing, and smoke over again when the caret leaves.
 * The delimiters stay as they are, dimmed marks, so the secret can be found.
 * Matt: "an extreme wisp effect when it's between two pipes".
 *
 * A whole line can be hidden the same way, written as a quote whose first character is a bar: `>| the answer`
 * (spoilerLineLetters). It is the same spoiler, so it lives and dies with the Spoiler mark.
 *
 * The letters keep their places: each is a plain inline mark carrying a
 * filter, as the recorder's arriving words are (editor/wispArrivals.ts), so
 * kerning and wrapping don't change. A dozen filters are shared round the
 * letters so neighbours never move alike, and animated together on the
 * animation clock at about 30 steps a second while any smoke is on screen
 * and the page is visible. With reduced motion the smoke stands still, and
 * still hides. A view that can't be edited (a read-only note) never clears.
 */

export interface SmokeLetter {
  from: number;
  to: number;
}

/** A letter's smoke: what the animation moves. */
interface Slot {
  noise: SVGElement;
  disp: SVGElement;
  blur: SVGElement;
  lift: SVGElement;
  alpha: SVGElement;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const POOL = 12;
const STEP_MS = 33;
const BEND = 36;
const BEND_SWAY = 14;
const SOFT = 3.2;
const SOFT_SWAY = 1.3;
const LIFT = 3;

let instances = 0;

const prefersStill = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The letters to smoke in `range`: every letter, spaces aside, of each node
 * whose name is in `names` (mapped to its delimiter's length), except a node
 * the selection touches while `clearAtCaret`.
 */
export function smokeLetters(state: EditorState, names: ReadonlyMap<string, number>, range: { from: number; to: number }, clearAtCaret: boolean): SmokeLetter[] {
  const letters: SmokeLetter[] = [];
  syntaxTree(state).iterate({
    from: range.from,
    to: range.to,
    enter(node) {
      const length = names.get(node.name);
      if (length === undefined) return undefined;
      if (clearAtCaret && state.selection.ranges.some((r) => r.to >= node.from && r.from <= node.to)) return false;
      const from = node.from + length;
      const to = node.to - length;
      if (to <= from) return false;
      let pos = from;
      for (const ch of state.doc.sliceString(from, to)) {
        if (!/\s/.test(ch)) letters.push({ from: pos, to: pos + ch.length });
        pos += ch.length;
      }
      return false;
    },
  });
  return letters;
}

/** A spoiler line: a quote whose first character is `|`. */
const SPOILER_LINE = /^(\s{0,3}>\|\s?)/;

/**
 * The letters to smoke on spoiler lines in `range` (Matt: a whole line hidden, written `>| the answer`): everything
 * after the `>|`, a run of such lines being one block, which clears together while the selection touches any of it.
 */
export function spoilerLineLetters(state: EditorState, range: { from: number; to: number }, clearAtCaret: boolean): SmokeLetter[] {
  const { doc } = state;
  const letters: SmokeLetter[] = [];
  let n = doc.lineAt(range.from).number;
  const last = doc.lineAt(range.to).number;
  while (n <= last) {
    if (!SPOILER_LINE.test(doc.line(n).text)) {
      n += 1;
      continue;
    }
    // The whole block, even where it runs past the range, so a block half on screen still clears as one.
    let start = n;
    while (start > 1 && SPOILER_LINE.test(doc.line(start - 1).text)) start -= 1;
    let end = n;
    while (end < doc.lines && SPOILER_LINE.test(doc.line(end + 1).text)) end += 1;
    const from = doc.line(start).from;
    const to = doc.line(end).to;
    const open = clearAtCaret && state.selection.ranges.some((r) => r.to >= from && r.from <= to);
    if (!open) {
      for (let k = Math.max(start, n); k <= Math.min(end, last); k += 1) {
        const line = doc.line(k);
        const lead = SPOILER_LINE.exec(line.text)![1]!.length;
        let pos = line.from + lead;
        for (const ch of line.text.slice(lead)) {
          if (!/\s/.test(ch)) letters.push({ from: pos, to: pos + ch.length });
          pos += ch.length;
        }
      }
    }
    n = end + 1;
  }
  return letters;
}

function slot(defs: SVGDefsElement, id: string, seed: number): Slot {
  const filter = document.createElementNS(SVG_NS, 'filter');
  filter.setAttribute('id', id);
  // Room for a letter thrown well outside its box, so the smear is never clipped; in sRGB, so thin type doesn't brighten.
  filter.setAttribute('x', '-400%');
  filter.setAttribute('y', '-200%');
  filter.setAttribute('width', '900%');
  filter.setAttribute('height', '500%');
  filter.setAttribute('color-interpolation-filters', 'sRGB');
  const noise = document.createElementNS(SVG_NS, 'feTurbulence');
  noise.setAttribute('type', 'fractalNoise');
  noise.setAttribute('baseFrequency', '0.02 0.07');
  noise.setAttribute('numOctaves', '2');
  noise.setAttribute('seed', String(seed));
  noise.setAttribute('result', 'n');
  const disp = document.createElementNS(SVG_NS, 'feDisplacementMap');
  disp.setAttribute('in', 'SourceGraphic');
  disp.setAttribute('in2', 'n');
  disp.setAttribute('scale', String(BEND));
  disp.setAttribute('xChannelSelector', 'R');
  disp.setAttribute('yChannelSelector', 'G');
  disp.setAttribute('result', 'd');
  const blur = document.createElementNS(SVG_NS, 'feGaussianBlur');
  blur.setAttribute('in', 'd');
  blur.setAttribute('stdDeviation', String(SOFT));
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
  alpha.setAttribute('slope', '0.75');
  transfer.appendChild(alpha);
  filter.append(noise, disp, blur, lift, transfer);
  defs.appendChild(filter);
  return { noise, disp, blur, lift, alpha };
}

export function wispFormat(formats: readonly InlineFormat[]): Extension {
  const names = new Map<string, number>();
  for (const format of formats) if (format.look.kind === 'wisp') names.set(format.name, format.delimiter.length);
  if (!names.size) return [];
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;
      private readonly svg: SVGSVGElement;
      private readonly slots: Slot[] = [];
      private readonly marks: Decoration[] = [];
      private frame = 0;
      private last = 0;

      constructor(readonly view: EditorView) {
        instances += 1;
        const prefix = `wispfmt-${instances}`;
        this.svg = document.createElementNS(SVG_NS, 'svg');
        this.svg.setAttribute('aria-hidden', 'true');
        this.svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
        const defs = document.createElementNS(SVG_NS, 'defs');
        this.svg.appendChild(defs);
        for (let i = 0; i < POOL; i += 1) {
          const id = `${prefix}-${i}`;
          this.slots.push(slot(defs, id, i * 11 + 3));
          this.marks.push(Decoration.mark({ class: 'cm-wispFormat', attributes: { style: `filter:url(#${id})` } }));
        }
        view.dom.appendChild(this.svg);
        this.redraw();
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || update.selectionSet || update.focusChanged || syntaxTree(update.state) !== syntaxTree(update.startState)) {
          this.redraw();
        }
      }

      destroy() {
        this.stop();
        this.svg.remove();
      }

      private redraw() {
        const { view } = this;
        const first = view.visibleRanges[0];
        const last = view.visibleRanges[view.visibleRanges.length - 1];
        const clear = view.state.facet(EditorView.editable) && view.hasFocus;
        const range = first && last ? { from: first.from, to: last.to } : null;
        const letters = range ? [...smokeLetters(view.state, names, range, clear), ...spoilerLineLetters(view.state, range, clear)].sort((a, b) => a.from - b.from).filter((l, i, all) => i === 0 || all[i - 1]!.from !== l.from) : [];
        const builder = new RangeSetBuilder<Decoration>();
        letters.forEach((letter, i) => builder.add(letter.from, letter.to, this.marks[i % POOL]!));
        this.decorations = builder.finish();
        if (letters.length) this.start();
        else this.stop();
      }

      private start() {
        if (prefersStill()) {
          this.pose(0);
          return;
        }
        if (!this.frame) this.frame = requestAnimationFrame(this.tick);
      }

      private stop() {
        cancelAnimationFrame(this.frame);
        this.frame = 0;
      }

      private readonly tick = (now: number) => {
        this.frame = requestAnimationFrame(this.tick);
        if (now - this.last < STEP_MS || document.visibilityState !== 'visible') return;
        this.last = now;
        this.pose(now / 1000);
      };

      /** Every filter at time `t`, each on its own phase, so no two letters breathe together. */
      private pose(t: number) {
        this.slots.forEach((s, k) => {
          const phase = k * 0.83;
          s.disp.setAttribute('scale', (BEND + BEND_SWAY * Math.sin(t * 1.9 + phase)).toFixed(1));
          s.blur.setAttribute('stdDeviation', (SOFT + SOFT_SWAY * Math.sin(t * 1.4 + phase * 1.7)).toFixed(2));
          s.lift.setAttribute('dy', (LIFT * Math.sin(t * 1.1 + phase * 2.3)).toFixed(2));
          s.alpha.setAttribute('slope', (0.7 + 0.25 * Math.sin(t * 2.6 + phase * 3.1)).toFixed(3));
          s.noise.setAttribute('baseFrequency', `${(0.02 + 0.006 * Math.sin(t * 0.7 + phase)).toFixed(4)} ${(0.07 + 0.02 * Math.sin(t * 0.5 + phase * 1.3)).toFixed(4)}`);
        });
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
  // Plain inline spans, so the line's kerning and wrapping are exactly what they are without the smoke.
  const theme = EditorView.baseTheme({ '.cm-wispFormat': {} });
  return [plugin, theme];
}
