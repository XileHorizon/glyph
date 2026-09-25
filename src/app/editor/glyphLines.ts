import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import styles from './Editor.module.css';

/**
 * The block half of the renderer: the things an inline span cannot reach.
 *
 * `glyphHighlight` can colour and resize a run of text, but it cannot put
 * space above a heading, draw the bar down the side of a quote, hang a list's
 * text off its marker, or paint a background behind a fenced block - all of
 * those are properties of the LINE, and a line is an element the highlighter
 * never sees. Hence one small plugin, and only one: everything that can be
 * done with an inline tag is done there instead, because a tag costs no code.
 *
 * Deliberately absent: any decoration that replaces or hides text. Obsidian-
 * style live preview needs widgets, replacement ranges, and reveal-on-cursor
 * logic because it HIDES the markers, and all three are where its edge cases
 * live (a cursor that will not enter a hidden span, a widget that remounts
 * mid-scroll). Glyph never hides anything, so it needs none of that machinery.
 */

/** Which line class a syntax node contributes to every line it covers. */
const LINE_CLASS: Record<string, string | undefined> = {
  ATXHeading1: styles.lineH1,
  ATXHeading2: styles.lineH2,
  ATXHeading3: styles.lineH3,
  ATXHeading4: styles.lineH4,
  ATXHeading5: styles.lineH4,
  ATXHeading6: styles.lineH4,
  Blockquote: styles.lineQuote,
  ListItem: styles.lineItem,
  FencedCode: styles.lineCode,
  CodeBlock: styles.lineCode,
  HorizontalRule: styles.lineHr,
};

/**
 * A list line's marker as far as its words: the indent, `-` or `10.`, a task's
 * box, and the spaces after them.
 */
const MARKER = /^(\s*(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)\S/;

/*
 * How wide a marker is, measured in the editor's own font. Wrapped lines of an
 * item hang at this width, so they start under the first letter of the words.
 * A guessed width (it was 1.2em) is never right for a proportional face: `- `
 * is narrow, `10. ` and `- [ ] ` are wide, and the setting changes the size.
 *
 * Measured with a real element inside the editor's scroller, so it inherits
 * the face, size and stylistic sets (app.css) exactly - copying the computed
 * `font` across does not work, because Chromium answers an empty shorthand
 * when a font feature is set. Cached per face and size, so a note costs one
 * measure per kind of marker.
 */
const widths = new Map<string, number>();

function markerWidth(view: EditorView, marker: string): number {
  const style = getComputedStyle(view.contentDOM);
  // Ticked or not, a box is the same width: one measure for both.
  const key = `${style.fontFamily}|${style.fontSize}|${style.fontWeight}|${style.letterSpacing}|${marker.replace(/\[[xX]\]/, '[ ]')}`;
  const known = widths.get(key);
  if (known !== undefined) return known;
  const ruler = document.createElement('span');
  ruler.setAttribute('aria-hidden', 'true');
  Object.assign(ruler.style, {
    position: 'absolute',
    visibility: 'hidden',
    whiteSpace: 'pre',
    insetInlineStart: '0',
    insetBlockStart: '0',
    pointerEvents: 'none',
  });
  // A to-do's box is set in the monospace face (Editor.module.css `.taskMarker`), so `[ ]` and `[x]` are one width.
  const box = /\[[ xX]\]/.exec(marker);
  if (box) {
    const drawn = document.createElement('span');
    drawn.className = styles.taskMarker ?? '';
    drawn.textContent = box[0];
    ruler.append(marker.slice(0, box.index), drawn, marker.slice(box.index + box[0].length));
  } else {
    ruler.textContent = marker;
  }
  view.scrollDOM.appendChild(ruler);
  const width = ruler.getBoundingClientRect().width;
  ruler.remove();
  widths.set(key, width);
  return width;
}

function buildLines(view: EditorView): DecorationSet {
  const { doc } = view.state;
  // One line can be covered by more than one node - a heading inside a
  // blockquote is both - so classes accumulate per line before any decoration
  // is built. Keyed by line start, which is also where the decoration must sit.
  const perLine = new Map<number, string[]>();

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        const cls = LINE_CLASS[node.name];
        if (!cls) return;
        const first = doc.lineAt(node.from).number;
        // `node.to` sits just past the block, which on a block ending in a
        // newline is the FIRST character of the next line; stepping back one
        // keeps the decoration off a line the node does not really cover.
        const last = doc.lineAt(Math.max(node.from, node.to - 1)).number;
        for (let n = first; n <= last; n += 1) {
          const at = doc.line(n).from;
          const classes = [cls];
          // A block of code is one card, not a stack of painted lines: its first and last lines carry the corners
          // (Matt: "code blocks missing border radii card shape and padding around the outside").
          if (cls === styles.lineCode) {
            if (n === first) classes.push(styles.lineCodeTop ?? '');
            if (n === last) classes.push(styles.lineCodeFoot ?? '');
          }
          // A quote's first and last lines hold the space between it and the lines around it.
          if (cls === styles.lineQuote) {
            if (n === first) classes.push(styles.lineQuoteTop ?? '');
            if (n === last) classes.push(styles.lineQuoteFoot ?? '');
          }
          const existing = perLine.get(at);
          if (existing) existing.push(...classes);
          else perLine.set(at, classes);
        }
      },
    });
  }

  // RangeSetBuilder.add must be called in ascending order, and a line
  // decoration's range must be zero-length and sit at the line start - both are
  // hard errors at runtime rather than quiet misbehaviour.
  const builder = new RangeSetBuilder<Decoration>();
  for (const at of [...perLine.keys()].sort((a, b) => a - b)) {
    const classes = perLine.get(at)!;
    const marker = classes.includes(styles.lineItem ?? '') ? MARKER.exec(doc.lineAt(at).text)?.[1] : undefined;
    const attributes = marker ? { style: `--hang: ${markerWidth(view, marker).toFixed(2)}px` } : undefined;
    builder.add(at, at, Decoration.line({ class: classes.join(' '), attributes }));
  }
  return builder.finish();
}

export const glyphLines = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    /** Set when the face finished loading, so markers measured in the fallback face are measured again. */
    private remeasure = false;
    private readonly onFonts = () => {
      widths.clear();
      this.remeasure = true;
      this.view.dispatch({});
    };

    constructor(readonly view: EditorView) {
      this.decorations = buildLines(view);
      document.fonts?.addEventListener('loadingdone', this.onFonts);
    }

    destroy() {
      document.fonts?.removeEventListener('loadingdone', this.onFonts);
    }

    update(update: ViewUpdate) {
      /*
       * While an IME is composing, MAP the existing decorations through the
       * changes instead of rebuilding them.
       *
       * Rebuilding replaces the line's DOM, and replacing DOM under a live
       * composition is the single most reliable way to break mobile text entry:
       * it is the cause behind four separate CodeMirror issues, all of them
       * Android or iOS, all of them "characters disappear" or "text garbles".
       * A composition never changes which BLOCK a line is - you cannot compose
       * a `#` into existence - so the mapped set is also correct, not merely
       * safe.
       */
      if (update.view.composing) {
        if (update.docChanged) this.decorations = this.decorations.map(update.changes);
        return;
      }
      if (
        this.remeasure ||
        update.docChanged ||
        update.viewportChanged ||
        // The text size setting: the markers are a different width now.
        update.geometryChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.remeasure = false;
        this.decorations = buildLines(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
