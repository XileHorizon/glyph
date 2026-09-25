import { RangeSetBuilder, type EditorState, type Extension, type Text } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { fireNativeHaptic } from '../core/haptics.ts';

/**
 * Choices (Matt picked them from the list of new formats): list items with a round box, of which one is picked.
 *
 *   Where do we stay?
 *   - ( ) Tent
 *   - (x) Cabin
 *   - ( ) Hotel
 *
 * A tap on a round box picks that item and clears the others in its group: the choice lines next to each other at
 * the same indent. Tapping the picked one again clears it, so nothing needs to stay picked. One edit, one undo. The
 * words beside the box are for writing, as with a to-do's box (editor/taskToggle.ts).
 */

/** A choice line up to its box: the indent and bullet, then `( )`, `(x)` or `(X)`, then a space. */
const CHOICE = /^(\s*)[-*+] \(([ xX])\) /;

export interface Choice {
  line: number;
  /** Where the `(` is. */
  from: number;
  picked: boolean;
  indent: number;
}

export function choiceOn(doc: Text, lineNumber: number): Choice | null {
  const line = doc.line(lineNumber);
  const found = CHOICE.exec(line.text);
  if (!found) return null;
  const indent = found[1]!.length;
  return { line: lineNumber, from: line.from + indent + 2, picked: found[2] !== ' ', indent };
}

/** The choices grouped with the one on `lineNumber`: next to it, at its indent, with deeper lines between allowed. */
export function groupOf(doc: Text, lineNumber: number): Choice[] {
  const self = choiceOn(doc, lineNumber);
  if (!self) return [];
  const group = [self];
  const walk = (step: 1 | -1) => {
    for (let n = lineNumber + step; n >= 1 && n <= doc.lines; n += step) {
      const text = doc.line(n).text;
      const choice = choiceOn(doc, n);
      if (choice && choice.indent === self.indent) {
        group.push(choice);
        continue;
      }
      // A line indented under a choice belongs to it; anything else ends the group.
      const depth = /^\s*/.exec(text)![0].length;
      if (text.trim() && depth > self.indent) continue;
      break;
    }
  };
  walk(-1);
  walk(1);
  return group.sort((a, b) => a.line - b.line);
}

/** The changes a tap on the choice at `lineNumber` makes: it picked (or cleared, if it was), its group cleared. */
export function pick(state: EditorState, lineNumber: number) {
  const group = groupOf(state.doc, lineNumber);
  const chosen = group.find((c) => c.line === lineNumber);
  if (!chosen) return null;
  const changes = group
    .map((c) => {
      const want = c.line === lineNumber ? !chosen.picked : false;
      return want === c.picked ? null : { from: c.from + 1, to: c.from + 2, insert: want ? 'x' : ' ' };
    })
    .filter((c): c is { from: number; to: number; insert: string } => c !== null);
  return state.update({ changes, userEvent: 'input.choice' });
}

const SLOP_PX = 8;

function choiceUnder(view: EditorView, x: number, y: number): Choice | null {
  const pos = view.posAtCoords({ x, y }, false);
  const choice = choiceOn(view.state.doc, view.state.doc.lineAt(pos).number);
  if (!choice) return null;
  const start = view.coordsAtPos(choice.from, 1);
  const end = view.coordsAtPos(choice.from + 3, -1);
  if (!start || !end) return null;
  return x >= start.left - SLOP_PX && x <= end.right + SLOP_PX && y >= start.top - SLOP_PX && y <= start.bottom + SLOP_PX ? choice : null;
}

const box = Decoration.mark({ class: 'cm-choiceBox' });
const boxPicked = Decoration.mark({ class: 'cm-choiceBox cm-choicePicked' });

function decorate(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { doc } = view.state;
  for (const { from, to } of view.visibleRanges) {
    for (let n = doc.lineAt(from).number; n <= doc.lineAt(to).number; n += 1) {
      const choice = choiceOn(doc, n);
      if (choice) builder.add(choice.from, choice.from + 3, choice.picked ? boxPicked : box);
    }
  }
  return builder.finish();
}

const theme = EditorView.baseTheme({
  '.cm-choiceBox': {
    color: 'var(--glacier-accent-text, currentColor)',
    fontWeight: '500',
    cursor: 'pointer',
  },
});

export function choices(): Extension {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = decorate(view);
        }
        update(update: ViewUpdate) {
          if (update.docChanged || update.viewportChanged) this.decorations = decorate(update.view);
        }
      },
      { decorations: (value) => value.decorations },
    ),
    theme,
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (event.button !== 0 || view.state.readOnly || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return false;
        const choice = choiceUnder(view, event.clientX, event.clientY);
        if (!choice) return false;
        const tr = pick(view.state, choice.line);
        if (!tr) return false;
        event.preventDefault();
        view.dispatch(tr);
        fireNativeHaptic('selection');
        return true;
      },
    }),
  ];
}
