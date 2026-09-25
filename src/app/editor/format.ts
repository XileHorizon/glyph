import { EditorSelection, Transaction, type ChangeSpec, type EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

/**
 * What the Style page of the press-and-hold menu writes (editor/ContextMenu.tsx).
 *
 * The delimiters are the kit's, exactly: `**`, `_`, backtick, `~~`, and the
 * block prefixes from `@glacier/logic`'s `rich-text.ts`, plus a to-do's
 * `- [ ] `. That is not politeness, it is correctness - the bar writes
 * characters and the highlighter reads them, and if the two ever disagree the
 * app types a mark that does not render. Underscore for italic (not `*`) also
 * keeps `*` free to mean bold's half, which is what a person typing expects.
 * A plugin's formatting (plugins/types.ts `InlineFormat`) is wrapped the same
 * way, with its own delimiter, through `toggleWrap`.
 *
 * Every edit goes through `state.changeByRange`, so a multi-cursor selection
 * behaves and the caret lands somewhere sensible afterwards: with a selection,
 * around the wrapped text; with none, BETWEEN the delimiters, so pressing Bold
 * and typing produces bold text instead of leaving the caret stranded past the
 * markers.
 *
 * Transactions are annotated `input.format` so `feel.ts` can tell a deliberate
 * bar press (which already got its own tap tick from the button) from a mark
 * the person typed by hand (which is the thing worth announcing).
 */

export type Mark = 'bold' | 'italic' | 'code' | 'strike';
export type Block = 'heading' | 'quote' | 'bullet' | 'number' | 'task';

const MARK_DELIMITERS: Record<Mark, string> = {
  bold: '**',
  italic: '_',
  code: '`',
  strike: '~~',
};

const BLOCK_PREFIXES: Record<Block, string> = {
  heading: '# ',
  quote: '> ',
  bullet: '- ',
  number: '1. ',
  task: '- [ ] ',
};

/** A prefix matcher per block form, loose enough to spot what is already there. */
const BLOCK_PATTERNS: Record<Block, RegExp> = {
  heading: /^#{1,6}\s+/,
  quote: /^>\s+/,
  bullet: /^[-*+]\s+/,
  number: /^\d+[.)]\s+/,
  task: /^[-*+]\s+\[[ xX]\]\s+/,
};

/** The order forms are recognised in: a to-do before the list it also is. */
const BLOCK_ORDER: readonly Block[] = ['heading', 'quote', 'task', 'bullet', 'number'];

const format = Transaction.userEvent.of('input.format');

/**
 * Wrap or unwrap the selection.
 *
 * Toggling recognises two shapes, because a selection lands either way: the
 * delimiters sitting just OUTSIDE it (the word was selected and is being
 * un-bolded) or INSIDE it (the whole `**word**` was selected). Both unwrap.
 */
export function toggleMark(view: EditorView, mark: Mark): void {
  toggleWrap(view, MARK_DELIMITERS[mark]);
}

/** Wrap or unwrap the selection in `delimiter`: a mark's, or a plugin formatting's. */
export function toggleWrap(view: EditorView, delimiter: string): void {
  const width = delimiter.length;

  view.dispatch(
    view.state.changeByRange((range) => {
      const { from, to } = range;
      const doc = view.state.doc;
      const outsideBefore = doc.sliceString(Math.max(0, from - width), from);
      const outsideAfter = doc.sliceString(to, Math.min(doc.length, to + width));

      if (outsideBefore === delimiter && outsideAfter === delimiter) {
        return {
          changes: [
            { from: from - width, to: from },
            { from: to, to: to + width },
          ],
          range: EditorSelection.range(from - width, to - width),
        };
      }

      const selected = doc.sliceString(from, to);
      if (selected.length >= width * 2 && selected.startsWith(delimiter) && selected.endsWith(delimiter)) {
        return {
          changes: [
            { from, to: from + width },
            { from: to - width, to },
          ],
          range: EditorSelection.range(from, to - width * 2),
        };
      }

      return {
        changes: [
          { from, insert: delimiter },
          { from: to, insert: delimiter },
        ],
        range: range.empty
          ? EditorSelection.cursor(from + width)
          : EditorSelection.range(from + width, to + width),
      };
    }),
    { annotations: format },
  );
}

/** Which lines a range touches, as line numbers. */
function linesOf(state: EditorState, from: number, to: number): number[] {
  const first = state.doc.lineAt(from).number;
  const last = state.doc.lineAt(to).number;
  const out: number[] = [];
  for (let n = first; n <= last; n += 1) out.push(n);
  return out;
}

/**
 * Apply or remove a block form on every line the selection touches.
 *
 * Applied when ANY touched line lacks the prefix, removed only when every one
 * of them already has it - so dragging across a half-formatted list completes
 * it rather than clearing the half that was done.
 */
export function toggleBlock(view: EditorView, block: Block): void {
  const { state } = view;
  const pattern = BLOCK_PATTERNS[block];
  const prefix = BLOCK_PREFIXES[block];
  const main = state.selection.main;
  const numbers = linesOf(state, main.from, main.to);
  const lines = numbers.map((n) => state.doc.line(n));
  const removing = lines.every((line) => pattern.test(line.text));

  const changes: ChangeSpec[] = [];
  for (const line of lines) {
    const match = pattern.exec(line.text);
    if (removing && match) {
      changes.push({ from: line.from, to: line.from + match[0].length });
    } else if (!removing && !match) {
      // A numbered list counts up rather than repeating "1."; anything else
      // uses the same prefix on every line.
      const insert =
        block === 'number' ? `${numbers.indexOf(line.number) + 1}. ` : prefix;
      changes.push({ from: line.from, insert });
    }
  }
  if (!changes.length) return;
  view.dispatch(state.update({ changes, annotations: format }));
}

/** Which of `delimiters` surround the caret right now, for the bar's pressed state. */
export function activeWraps(state: EditorState, delimiters: readonly string[]): string[] {
  const { from, to } = state.selection.main;
  const doc = state.doc;
  return delimiters.filter((delimiter) => {
    const width = delimiter.length;
    const before = doc.sliceString(Math.max(0, from - width), from);
    const after = doc.sliceString(to, Math.min(doc.length, to + width));
    return before === delimiter && after === delimiter;
  });
}

/** Which inline marks surround the caret right now, for the bar's pressed state. */
export function activeMarks(state: EditorState): Mark[] {
  const marks = Object.keys(MARK_DELIMITERS) as Mark[];
  const active = new Set(activeWraps(state, marks.map((mark) => MARK_DELIMITERS[mark])));
  return marks.filter((mark) => active.has(MARK_DELIMITERS[mark]));
}

/** Which block form the caret's line is in, if any. */
export function activeBlock(state: EditorState): Block | null {
  const text = state.doc.lineAt(state.selection.main.head).text;
  for (const block of BLOCK_ORDER) {
    if (BLOCK_PATTERNS[block].test(text)) return block;
  }
  return null;
}

/** A link around the selected words, or an empty one, with the caret where the address goes. */
export function insertLink(view: EditorView): void {
  const { from, to } = view.state.selection.main;
  const words = view.state.doc.sliceString(from, to);
  const lead = 'https://';
  view.dispatch({
    changes: { from, to, insert: `[${words}](${lead})` },
    selection: { anchor: from + words.length + 3 + lead.length },
    annotations: format,
  });
}

/** Lines of their own under the caret's line, with the caret (or a selection) placed in them. */
function insertBelow(view: EditorView, text: string, select: { from: number; to?: number }): void {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const lead = line.length ? '\n\n' : '';
  const at = line.to + lead.length;
  view.dispatch({
    changes: { from: line.to, insert: `${lead}${text}` },
    selection: { anchor: at + select.from, head: at + (select.to ?? select.from) },
    annotations: format,
  });
}

/** A small table below the caret's line, its first heading selected to be written over. */
export function insertTable(view: EditorView): void {
  insertBelow(view, '| Column | Column |\n| --- | --- |\n| Cell | Cell |', { from: 2, to: 8 });
}

/** A rule below the caret's line, the caret after it. */
export function insertRule(view: EditorView): void {
  insertBelow(view, '---', { from: 3 });
}

/** The selection gone, or the line the caret is on when nothing is selected. */
export function deleteSelection(view: EditorView): void {
  const { state } = view;
  view.dispatch(
    state.changeByRange((range) => {
      if (!range.empty) return { changes: { from: range.from, to: range.to }, range: EditorSelection.cursor(range.from) };
      const line = state.doc.lineAt(range.head);
      const to = Math.min(state.doc.length, line.to + 1);
      return { changes: { from: line.from, to }, range: EditorSelection.cursor(line.from) };
    }),
    { userEvent: 'delete.selection', scrollIntoView: true },
  );
}

/** The selection again after itself, or the line again under itself. */
export function duplicateSelection(view: EditorView): void {
  const { state } = view;
  const range = state.selection.main;
  if (!range.empty) {
    const text = state.sliceDoc(range.from, range.to);
    view.dispatch({
      changes: { from: range.to, insert: text },
      selection: EditorSelection.range(range.to, range.to + text.length),
      userEvent: 'input.duplicate',
      scrollIntoView: true,
    });
    return;
  }
  const line = state.doc.lineAt(range.head);
  view.dispatch({
    changes: { from: line.to, insert: `\n${line.text}` },
    selection: EditorSelection.cursor(range.head + line.length + 1),
    userEvent: 'input.duplicate',
    scrollIntoView: true,
  });
}

/** The lines the selection touches, moved one line up (`by` -1) or down (1). Nothing happens at either end. */
export function moveLines(view: EditorView, by: -1 | 1): void {
  const { state } = view;
  const range = state.selection.main;
  const first = state.doc.lineAt(range.from);
  const last = state.doc.lineAt(range.to);
  const swapWith = by < 0 ? first.number - 1 : last.number + 1;
  if (swapWith < 1 || swapWith > state.doc.lines) return;
  const other = state.doc.line(swapWith);
  const block = state.sliceDoc(first.from, last.to);
  const moved = by < 0 ? `${block}\n${other.text}` : `${other.text}\n${block}`;
  const from = Math.min(first.from, other.from);
  const to = Math.max(last.to, other.to);
  const shift = by < 0 ? -(other.length + 1) : other.length + 1;
  view.dispatch({
    changes: { from, to, insert: moved },
    selection: EditorSelection.range(range.from + shift, range.to + shift),
    userEvent: 'move.line',
    scrollIntoView: true,
  });
}
