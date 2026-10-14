import { RangeSetBuilder, type EditorState, type Extension } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { shortcodesIn } from '../core/emoji.ts';

/**
 * The extended markdown Glyph draws but had no look for.
 *
 * The language already parses more than the app drew (editor/language.ts takes GFM plus subscript, superscript and
 * emoji): `x^2^` and `H~2~O` were plain words with their marks showing, and a GitHub callout - a quote whose first
 * line is `[!NOTE]` - was an ordinary quote. Both are ordinary markdown anywhere else, so a note written in Glyph
 * reads the same in GitHub, Obsidian or a plain text editor, which is the whole point of the format.
 *
 * Nothing is hidden, as everywhere else in the editor: the marks stay, and the words between them take the look. The
 * one exception is a shortcode, which is replaced by its emoji the way a table is replaced by a table - the drawn
 * thing being unmistakably the written thing - and comes back as words while the caret is on its line.
 *
 * What is drawn here, all of it ordinary markdown elsewhere (docs/MARKDOWN.md):
 *
 *   x^2^  H~2~O            raised and lowered runs
 *   > [!NOTE]              a callout, GitHub's own spelling
 *   Term / : the meaning   a definition list, as PHP Markdown Extra writes it
 *   ---\ntitle: …\n---     front matter, which read as a horizontal rule before
 *   $x^2$  $$ … $$         maths, set as code rather than drawn: a renderer is 280 KB the phone does not need
 *   :tada:                 a shortcode, drawn as its emoji (core/emoji.ts)
 */

/** The words of a raised or lowered run, by node name: the highlighter gives both the same tag. */
const SCRIPTS: Record<string, string | undefined> = { Superscript: 'cm-sup', Subscript: 'cm-sub' };

/** A definition's line: `: the meaning`, under the term it belongs to. */
const DEFINITION = /^(\s{0,3}:)(\s+\S.*)$/;
/** Maths, inline or on its own lines: `$x^2$`, `$$ … $$`. */
const MATHS = /\$\$[^$]+\$\$|\$[^$\n]+\$/g;
/** The fence of a front matter block, which is only front matter on the note's first line. */
const FRONT = /^(---|\+\+\+)\s*$/;

/** Which lines the note's front matter covers, or null: an opening fence on line 1 and the next one that closes it. */
export function frontMatter(doc: { line: (n: number) => { text: string }; lines: number }): { from: number; to: number } | null {
  if (!FRONT.test(doc.line(1).text)) return null;
  for (let n = 2; n <= Math.min(doc.lines, 40); n += 1) {
    if (FRONT.test(doc.line(n).text)) return { from: 1, to: n };
    if (!/^\s*[\w.-]+\s*:/.test(doc.line(n).text) && doc.line(n).text.trim() !== '') return null;
  }
  return null;
}

/** A callout's kind, as GitHub writes it: `> [!NOTE]` on the quote's first line. */
export const CALLOUT = /^\s*>\s*\[!(note|tip|important|warning|caution)\]\s*(.*)$/i;

/** The kind of callout a blockquote is, or null for an ordinary quote. */
export function calloutKind(firstLine: string): string | null {
  const found = CALLOUT.exec(firstLine);
  return found ? (found[1] ?? '').toLowerCase() : null;
}

/** A shortcode, drawn as its emoji. The words come back the moment the caret is on the line. */
class EmojiWidget extends WidgetType {
  constructor(
    readonly emoji: string,
    readonly name: string,
  ) {
    super();
  }

  eq(other: EmojiWidget): boolean {
    return other.emoji === this.emoji;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-emoji';
    span.textContent = this.emoji;
    span.title = this.name;
    return span;
  }
}

function decorate(state: EditorState, from: number, to: number): DecorationSet {
  const marks: { from: number; to: number; deco: Decoration }[] = [];
  const caretLines = new Set(state.selection.ranges.map((range) => state.doc.lineAt(range.head).number));

  // The note's own front matter, which the parser reads as a rule and a run of words.
  const front = frontMatter(state.doc);
  if (front) {
    for (let n = front.from; n <= front.to; n += 1) {
      const line = state.doc.line(n);
      marks.push({ from: line.from, to: line.from, deco: Decoration.line({ class: 'cm-front' }) });
    }
  }

  const first = state.doc.lineAt(from).number;
  const last = state.doc.lineAt(to).number;
  for (let n = first; n <= last; n += 1) {
    const line = state.doc.line(n);
    if (front && n >= front.from && n <= front.to) continue;

    // A definition under its term: the line hangs off its colon, and the term above it is set apart.
    const definition = DEFINITION.exec(line.text);
    if (definition) {
      marks.push({ from: line.from, to: line.from, deco: Decoration.line({ class: 'cm-definition' }) });
      const above = n > 1 ? state.doc.line(n - 1) : null;
      if (above && above.text.trim() && !DEFINITION.test(above.text)) {
        marks.push({ from: above.from, to: above.from, deco: Decoration.line({ class: 'cm-term' }) });
      }
    }

    // Maths, set as code: read as what it is without carrying a renderer for it.
    for (let match = MATHS.exec(line.text); match; match = MATHS.exec(line.text)) {
      marks.push({ from: line.from + match.index, to: line.from + match.index + match[0].length, deco: Decoration.mark({ class: 'cm-maths' }) });
    }
    MATHS.lastIndex = 0;

    // A shortcode becomes its emoji, unless the caret is on that line, where the words are wanted.
    if (!caretLines.has(n)) {
      for (const code of shortcodesIn(line.text, line.from)) {
        marks.push({
          from: code.from,
          to: code.to,
          deco: Decoration.replace({ widget: new EmojiWidget(code.emoji, state.doc.sliceString(code.from, code.to)) }),
        });
      }
    }
  }

  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      const script = SCRIPTS[node.name];
      if (script) {
        // The words, the delimiters aside: `^` and `~` are one character each.
        const words = { from: node.from + 1, to: node.to - 1 };
        if (words.to > words.from) marks.push({ ...words, deco: Decoration.mark({ class: script }) });
        return false;
      }
      if (node.name !== 'Blockquote') return undefined;
      const first = state.doc.lineAt(node.from);
      const kind = calloutKind(first.text);
      if (!kind) return undefined;
      // `[!NOTE]` is a link label to the parser, and was drawn as one: underlined, in the link's ink. It is the
      // callout's name, so it is drawn as a name.
      const at = first.text.indexOf('[!');
      const shut = first.text.indexOf(']', at);
      if (at >= 0 && shut > at) marks.push({ from: first.from + at, to: first.from + shut + 1, deco: Decoration.mark({ class: 'cm-calloutName' }) });
      const last = state.doc.lineAt(Math.max(node.from, node.to - 1));
      for (let n = first.number; n <= last.number; n += 1) {
        const line = state.doc.line(n);
        marks.push({
          from: line.from,
          to: line.from,
          deco: Decoration.line({ class: n === first.number ? 'cm-callout cm-calloutTop' : 'cm-callout', attributes: { 'data-callout': kind } }),
        });
      }
      return undefined;
    },
  });
  // A line decoration and a mark can start at the same place; the line one must be added first.
  marks.sort((a, b) => a.from - b.from || (a.to === a.from ? -1 : 1) - (b.to === b.from ? -1 : 1));
  const builder = new RangeSetBuilder<Decoration>();
  for (const mark of marks) builder.add(mark.from, mark.to, mark.deco);
  return builder.finish();
}

const theme = EditorView.baseTheme({
  '.cm-sup': { verticalAlign: 'super', fontSize: '0.75em', lineHeight: '1' },
  '.cm-sub': { verticalAlign: 'sub', fontSize: '0.75em', lineHeight: '1' },
  /*
   * A callout is the quote it already is, with its own band of ink down the side and a tinted ground, so the eye
   * takes it as an aside rather than a quotation. The kinds differ only in weight of tint: Glyph is ink and paper,
   * and a wall of coloured boxes is not what a note should look like.
   */
  '.cm-callout': {
    background: 'color-mix(in oklch, currentColor 4%, transparent)',
    borderInlineStart: '3px solid color-mix(in oklch, currentColor 35%, transparent)',
    paddingInlineStart: '0.6em',
  },
  '.cm-callout[data-callout="warning"], .cm-callout[data-callout="caution"]': {
    background: 'color-mix(in oklch, currentColor 7%, transparent)',
    borderInlineStartColor: 'color-mix(in oklch, currentColor 60%, transparent)',
  },
  // The underline belongs to the link span inside, so the name's own children are cleared too.
  '.cm-calloutName, .cm-calloutName *': {
    textDecoration: 'none',
    color: 'var(--app-ink-3, var(--glacier-text-muted))',
    fontSize: '0.82em',
    letterSpacing: '0.08em',
  },
  '.cm-calloutTop': { fontWeight: 'var(--glacier-font-weight-semibold, 600)', paddingBlockStart: '0.25em', borderStartStartRadius: '0.4em' },
  '.cm-callout:not(.cm-calloutTop):last-of-type': { paddingBlockEnd: '0.25em' },

  // Front matter: the note's keys, quiet and set in the note's mono face, and no longer a rule across the page.
  '.cm-front, .cm-front *': {
    fontFamily: 'var(--glacier-font-mono)',
    fontSize: '0.84em',
    color: 'var(--app-ink-3, var(--glacier-text-muted))',
    textDecoration: 'none',
    fontWeight: 'inherit',
  },
  '.cm-front': { background: 'color-mix(in oklch, currentColor 3%, transparent)' },

  // A definition hangs under its term, the way a glossary sets one.
  '.cm-term': { fontWeight: 'var(--glacier-font-weight-semibold, 600)' },
  '.cm-definition': { paddingInlineStart: '1.2em' },

  // Maths, as code: the delimiters stay, because they are what makes it maths.
  '.cm-maths': { fontFamily: 'var(--glacier-font-mono)', fontSize: '0.92em', color: 'var(--app-ink-2, var(--glacier-text))' },

  '.cm-emoji': { fontSize: '1.05em', lineHeight: '1' },
});

/** Superscript, subscript and callouts, drawn as what they are. */
export function extendedMarkdown(): Extension {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;

        constructor(readonly view: EditorView) {
          this.decorations = this.build(view);
        }

        update(update: ViewUpdate) {
          if (update.docChanged || update.viewportChanged || update.selectionSet) this.decorations = this.build(update.view);
        }

        private build(view: EditorView): DecorationSet {
          const { from, to } = view.viewport;
          return decorate(view.state, from, to);
        }
      },
      { decorations: (value) => value.decorations },
    ),
    theme,
  ];
}
