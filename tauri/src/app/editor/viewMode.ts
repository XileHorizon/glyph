import { Facet, RangeSetBuilder, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { selectedLines } from './lines.ts';

/**
 * How a note is shown (Matt: "the default mode is the mixed mode we use, where it's Markdown symbols and the formatted
 * text, then a second version that's just the formatted text"), switched with two words in the note's header.
 *
 * - **Markdown** (`mixed`, the default): the text formatted, with its marks still on the page, dimmed.
 * - **Formatted**: just the formatted text. The marks that only say how words look (`**`, `_`, `~~`, backticks, `#`,
 *   `>`, a plugin's delimiters) are hidden. While the note is being written, the line with the caret shows its marks
 *   so they can be edited; a list's dash and a to-do's box always stay, since they are part of how a list looks.
 */

export type NoteView = 'mixed' | 'formatted';

/**
 * What an editor is asked to draw: one of the two views, or **Margin**, the Markdown view with a line's leading mark
 * (`#`, `-`, `1.`, `>`) hung out in a column of its own left of the words (Kevin, 2026-10-27: "markdown symbols are
 * essentially instructions ... they could also be used as markers along the edge, while still remaining editable like
 * normal text"). Not a stored view: it is Markdown with Settings' `marksInMargin` on (`shownView`), so a device on an
 * older build reading the synced preferences still sees one of the two it knows.
 */
export type NoteDisplay = NoteView | 'margin';

/** What a note is drawn as, from the stored view and the margin setting. */
export function shownView(prefs: { noteView: NoteView; marksInMargin?: boolean }): NoteDisplay {
  return prefs.noteView === 'mixed' && prefs.marksInMargin ? 'margin' : prefs.noteView;
}

/** The syntax nodes a styled note hides: marks that only style the words beside them. */
const HIDDEN = new Set(['EmphasisMark', 'StrikethroughMark', 'HeaderMark', 'QuoteMark']);

function hiddenMarks(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { state } = view;
  // While the note is being written, the lines the caret or a selection touches keep their marks.
  const active = view.hasFocus ? selectedLines(state) : new Set<number>();
  const hide = Decoration.replace({});
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name;
        const inlineCode = name === 'CodeMark' && node.node.parent?.name === 'InlineCode';
        const pluginMark = name.endsWith('Mark') && !HIDDEN.has(name) && name !== 'CodeMark' && name !== 'ListMark' && name !== 'LinkMark' && name !== 'TaskMarker';
        const escape = name === 'Escape';
        if (!HIDDEN.has(name) && !inlineCode && !pluginMark && !escape) return;
        if (active.has(state.doc.lineAt(node.from).number)) return;
        // An escaped character shows as itself: only its backslash goes.
        if (escape) {
          builder.add(node.from, node.from + 1, hide);
          return;
        }
        let end = node.to;
        // A heading's `# ` and a quote's `> ` go with the space after them, so the words start where the line does.
        if ((name === 'HeaderMark' || name === 'QuoteMark') && state.doc.sliceString(end, end + 1) === ' ') end += 1;
        if (end > node.from) builder.add(node.from, end, hide);
      },
    });
  }
  return builder.finish();
}

const styled = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = hiddenMarks(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.focusChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
        this.decorations = hiddenMarks(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    // A hidden mark is stepped over, not into, by the arrow keys.
    provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none),
  },
);

/** Whether the note is shown Formatted, for what hides its own marks there too (a blank's braces, editor/blanks.ts). */
export const formattedView = Facet.define<boolean, boolean>({ combine: (values) => values.some(Boolean) });

/*
 * MARGIN. The mark that starts a line - a heading's `#`s, a list's `-` or `1.`, a quote's `>` - with the space after
 * it, is drawn in a column left of the words, so every line's words start at one edge whatever its mark. The mark is
 * still the note's own text, in the line where it was: the caret walks into it, a backspace takes it, a typed `#`
 * becomes one. Only where it is drawn changes: an inline-block exactly as wide as the column, pulled back by that
 * width (`--margin-marks`), so it takes no room in the line. A mark too long for the column (`#####`, `######`) ends
 * where the others' words start and reaches back into the page's edge instead, so its words keep the same edge too. The column is room on `.cm-content`, so every line, card and widget moves in by
 * the same width and the words share one edge with them.
 */

/** A leading mark: the first thing on its line but for spaces, so a list inside a quote hangs the quote's `>`. */
function leading(doc: EditorView['state']['doc'], from: number): boolean {
  const line = doc.lineAt(from);
  return /^[ \t]*$/.test(doc.sliceString(line.from, from));
}

/** The most characters, the space included, a mark can be and still sit in the column from its left edge (`#### `). */
const WIDEST = 5;

function marginMarks(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { state } = view;
  const hang = Decoration.mark({ class: 'cm-hangMark' });
  const wide = Decoration.mark({ class: 'cm-hangMark cm-hangWide' });
  let last = -1;
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name;
        const parent = node.node.parent?.name ?? '';
        const heading = name === 'HeaderMark' && parent.startsWith('ATXHeading');
        const item = name === 'ListMark' && parent === 'ListItem';
        const quote = name === 'QuoteMark';
        if (!heading && !item && !quote) return;
        if (node.from < last || !leading(state.doc, node.from)) return;
        const line = state.doc.lineAt(node.from);
        let end = node.to;
        if (end < line.to && state.doc.sliceString(end, end + 1) === ' ') end += 1;
        builder.add(node.from, end, end - node.from > WIDEST ? wide : hang);
        last = end;
      },
    });
  }
  return builder.finish();
}

const hung = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = marginMarks(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
        this.decorations = marginMarks(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const MARGIN_THEME = EditorView.theme({
  '&': { '--margin-marks': 'calc(var(--app-body) * 3)' },
  // Qualified by the editor's own class, so it sits above glyphTheme.ts's `padding` on the same element.
  '&.cm-marginMarks .cm-content': { paddingInlineStart: 'var(--margin-marks)' },
  // The mark at the note's own size and weight whatever its line is set in, so a heading's `#` reads as a sign in the
  // column and not as a giant letter.
  '.cm-hangMark': {
    display: 'inline-block',
    inlineSize: 'var(--margin-marks)',
    marginInlineStart: 'calc(-1 * var(--margin-marks))',
    textIndent: '0',
    whiteSpace: 'pre',
    fontSize: 'var(--app-body)',
    fontWeight: 'var(--glacier-font-weight-regular)',
    letterSpacing: '0',
    color: 'var(--glacier-text-subtle)',
  },
  '.cm-hangMark.cm-hangWide': { display: 'inline-flex', justifyContent: 'flex-end' },
  '.cm-hangMark *': { fontSize: 'inherit', fontWeight: 'inherit', letterSpacing: 'inherit', lineHeight: 'inherit' },
});

/** The Margin page's own class on the editor, for the stylesheet's rules that reach past the theme (markdown.module.css). */
const MARGIN_ATTRS = EditorView.editorAttributes.of({ class: 'cm-marginMarks' });

/** The extension for a view: Formatted hides the marks; Margin hangs the leading ones; Markdown adds nothing. */
export function noteView(view: NoteDisplay): Extension {
  if (view === 'formatted') return [styled, formattedView.of(true)];
  if (view === 'margin') return [hung, MARGIN_THEME, MARGIN_ATTRS];
  return [];
}

export function isNoteView(value: unknown): value is NoteView {
  return value === 'mixed' || value === 'formatted';
}
