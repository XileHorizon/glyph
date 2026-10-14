import type { EditorState, Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { fireNativeHaptic } from '../core/haptics.ts';
import { settleFences } from './boards.ts';

/**
 * A tap on a to-do's box ticks it, and another clears it (Matt: "add ability to tap on todo list item to toggle the x
 * on and off"). Only the box: the words beside it are for writing, and a tap there puts the caret in them as ever.
 *
 * The change is an ordinary edit - one undo, saved like typing - so a linked to-do's task follows it the way it
 * follows a box typed by hand (editor/doneSync.ts).
 */

/** A to-do line up to its box: the indent and bullet (or number), then `[ ]`, `[x]` or `[X]`. */
const BOX = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/;

/** How far outside the drawn box a tap still counts, in px: a box is small under a thumb. */
const SLOP_PX = 8;

/** The box on the line at `pos`: where its brackets are and whether it's ticked, or null. */
export function boxAt(state: EditorState, pos: number): { from: number; to: number; done: boolean } | null {
  const line = state.doc.lineAt(pos);
  const found = BOX.exec(line.text);
  if (!found) return null;
  const from = line.from + (found[1] ?? '').length;
  return { from, to: from + 3, done: found[2] !== ' ' };
}

/**
 * The same line with its box turned: an `x` in an empty one, a space in a ticked one. An item that is a card on a
 * board moves with it - ticked into Done, cleared back to the first lane - in the same edit and the same undo, so the
 * fence never drifts from the ticks (editor/boards.ts `settleFences`).
 */
export function toggleBox(state: EditorState, box: { from: number; done: boolean }) {
  const line = state.doc.lineAt(box.from).number;
  return state.update({
    changes: [{ from: box.from + 1, to: box.from + 2, insert: box.done ? ' ' : 'x' }, ...settleFences(state, new Map([[line, !box.done]]))],
    userEvent: 'input.toggle',
  });
}

function boxUnder(view: EditorView, x: number, y: number) {
  const pos = view.posAtCoords({ x, y }, false);
  const box = boxAt(view.state, pos);
  if (!box) return null;
  const start = view.coordsAtPos(box.from, 1);
  const end = view.coordsAtPos(box.to, -1);
  if (!start || !end) return null;
  const inside = x >= start.left - SLOP_PX && x <= end.right + SLOP_PX && y >= start.top - SLOP_PX && y <= start.bottom + SLOP_PX;
  return inside ? box : null;
}

export function taskToggle(): Extension {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (event.button !== 0 || view.state.readOnly || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return false;
      const box = boxUnder(view, event.clientX, event.clientY);
      if (!box) return false;
      // Taken here, before the caret moves: a tap on the box ticks it and leaves the caret where it was.
      event.preventDefault();
      view.dispatch(toggleBox(view.state, box));
      fireNativeHaptic('selection');
      return true;
    },
  });
}
