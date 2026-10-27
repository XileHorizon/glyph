import { RangeSetBuilder, StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { settleTicks } from '../core/boards.ts';
import { itemAnchors } from './boards/anchors.ts';
import { cardActions, cardMenuIn, closeCardMenu, closeCardMenuIfGone, type CardActions } from './boards/cardMenu.ts';
import { boardsOn, faceOf } from './boards/drawn.ts';
import { boardTheme } from './boards/theme.ts';
import { BoardWidget } from './boards/widget.ts';
import { caretIn, focused, trackFocus } from './drawnBlock.ts';

/**
 * Boards, shown as boards (docs/BOARDS.md, core/boards.ts).
 *
 * A ```board fence is columns; the items it names are anywhere in the note, each with its anchor. The fence is drawn
 * as a board of cards, the way a table is drawn as a table (editor/tables.ts): the markdown is what is kept and what
 * is edited, and the caret in the fence steps the drawing aside so the lines can be typed.
 *
 * A card IS its item, which is what Matt asked for ("linking the tasks in the board to a task on the page"):
 *
 * - Its tick box is the item's box. Ticking it ticks the line in the note, and moves the card to Done when the board
 *   has such a column. An item with no box - a bullet, a numbered step - is drawn as a card with no box.
 * - Its words are the item's words. Tapping them puts the caret on that line, so the board is a way around the note.
 * - Press and hold picks the card up and it is dragged to where it goes, in its own column or another (Matt: "add a
 *   way to tap and drag to re organize items in lanes"). The chevrons do the same a tap at a time, for a hand that
 *   would rather not drag and for anything driving the app by keyboard.
 * - A card whose item is gone is drawn with its anchor and nothing else, so it can be seen and taken out.
 *
 * The rest is the phone it is used on (Matt: "make the UI / UX of these boards friendlier on mobile"): columns that
 * snap as they scroll, a heading that stays while the cards go by, an empty column that says it will take a card, a
 * + that writes a new item into the note, and targets big enough for a thumb.
 *
 * This is the extension and what decides where a board is drawn. Its parts are in editor/boards/: the board as drawn
 * from the markdown (drawn.ts), the widget (widget.ts) and what a card does to the note (cardEdits.ts), the card's
 * menu, the kit's (cardMenu.ts, CardMenu.tsx), the drag (drag.ts), the + field (composer.ts), the board's height held
 * and remembered (height.ts) and set by the line under it (divider.ts), getting around from a card (navigate.ts), the
 * note's own scroller that both roll (scrolling.ts), the anchors in the note's lines (anchors.ts), the touch-safe
 * button every control is (press.ts), the icons (icons.ts) and the look (theme.ts).
 */

function decorate(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const board of boardsOn(state)) {
    // The caret in the fence: the lines themselves, to edit. Elsewhere, and in a view with no caret, the board.
    if (caretIn(state, board.from, board.to)) continue;
    builder.add(board.from, board.to, Decoration.replace({ widget: new BoardWidget(board, faceOf(board)), block: true }));
  }
  return builder.finish();
}

const boardField = StateField.define<DecorationSet>({
  create: (state) => decorate(state),
  update(value, tr) {
    return tr.docChanged || tr.selection || focused(tr.startState) !== focused(tr.state) ? decorate(tr.state) : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * The changes that bring every fence in the note back in step with its ticks, for a box turned somewhere other than
 * the board: a tap in the list (editor/taskToggle.ts) or a task going Done in Notion (editor/doneSync.ts). `ticks` is
 * each item's line, counting from 1, and the state its box is being set to; several at once are fine.
 *
 * An item that is not a card, ticked in a list whose neighbours are on a board, joins that board in Done, and its
 * line gains the anchor that names it (core/boards.ts `settleTicks`).
 *
 * Put them in the same transaction as the boxes themselves, so the note and its boards change together, as one undo.
 * Empty when nothing has to move, which is the usual answer.
 */
export function settleFences(state: EditorState, ticks: ReadonlyMap<number, boolean>): { from: number; to?: number; insert: string }[] {
  const settled = settleTicks(state.doc.toString(), ticks);
  return [
    ...settled.fences.map((edit) => ({
      from: state.doc.line(edit.from).to + 1,
      to: state.doc.line(edit.to).from - 1,
      insert: edit.body,
    })),
    // The anchor is put at the END of the item's line rather than the line written again, so it can never overlap
    // the one character the tick itself is changing at the start of it.
    ...settled.lines.map((line) => ({ from: state.doc.line(line.number).to, insert: ` ^${line.anchor}` })),
  ];
}

/**
 * How much room a board has, and how far the page's own margin reaches (`--cm-board-room`, `--cm-board-bleed`).
 *
 * A board is a row of columns wider than a phone, and a block widget's width is what decides how wide the editor's
 * content is: left to itself the board made every line of the note as wide as the board, and the words ran off the
 * screen. So the board is told what it may take - the width the note scrolls in - and scrolls its columns inside
 * that. The bleed is the note's own indent, given back so the columns run edge to edge and still line up with the
 * words when the board is scrolled home.
 */
const boardRoom = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {
      this.measure();
    }

    update(update: ViewUpdate): void {
      if (update.geometryChanged || update.docChanged) this.measure();
    }

    measure(): void {
      this.view.requestMeasure({
        read: (view) => {
          const line = view.contentDOM.querySelector('.cm-line');
          const style = line ? window.getComputedStyle(line) : null;
          const bleed = style ? parseFloat(style.paddingInlineStart || '0') || 0 : 0;
          // The whole width the note scrolls in: the board starts where the page's indent does and ends at its edge. Less
          // any room the content keeps at its own sides (the Margin view's column of marks, editor/viewMode.ts), which
          // the board would otherwise add to and widen every line by.
          const content = window.getComputedStyle(view.contentDOM);
          const sides = (parseFloat(content.paddingInlineStart) || 0) + (parseFloat(content.paddingInlineEnd) || 0);
          return { room: Math.max(160, (view.scrollDOM.clientWidth || view.dom.clientWidth) - sides), bleed };
        },
        write: ({ room, bleed }, view) => {
          view.dom.style.setProperty('--cm-board-room', `${room}px`);
          view.dom.style.setProperty('--cm-board-bleed', `${bleed}px`);
        },
      });
    }
  },
);

/**
 * A card's menu goes with the note it describes (editor/boards/cardMenu.ts): its rows are the card as it was when it
 * opened, so any change to the note closes it, and so does a redraw that took its more button off the page, looked at
 * once the view has drawn. The lane's menu went with the widget's DOM the same way.
 */
const cardMenuGoes = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {}

    update(update: ViewUpdate): void {
      if (!cardMenuIn(this.view)) return;
      if (update.docChanged) closeCardMenu(this.view);
      else queueMicrotask(() => closeCardMenuIfGone(this.view));
    }

    destroy(): void {
      closeCardMenu(this.view);
    }
  },
);

/** Boards drawn in a note, the fence still there to edit. */
export function drawnBoards(actions?: CardActions): Extension {
  return [trackFocus, boardField, itemAnchors, boardRoom, cardMenuGoes, boardTheme, ...(actions ? [cardActions.of(actions)] : [])];
}
