import { RangeSetBuilder, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';

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

/** The syntax nodes a styled note hides: marks that only style the words beside them. */
const HIDDEN = new Set(['EmphasisMark', 'StrikethroughMark', 'HeaderMark', 'QuoteMark']);

function hiddenMarks(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { state } = view;
  // While the note is being written, the lines the caret or a selection touches keep their marks.
  const active = new Set<number>();
  for (const range of view.hasFocus ? state.selection.ranges : []) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let n = first; n <= last; n += 1) active.add(n);
  }
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

/** The extension for a view: Formatted hides the marks; Markdown, the mixed page, adds nothing. */
export function noteView(view: NoteView): Extension {
  return view === 'formatted' ? styled : [];
}

export function isNoteView(value: unknown): value is NoteView {
  return value === 'mixed' || value === 'formatted';
}
