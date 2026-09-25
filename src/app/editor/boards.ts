import { EditorSelection, Facet, RangeSetBuilder, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { wispFoot, wispFootFade } from '../art/wispFoot.ts';
import { fireNativeHaptic } from '../core/haptics.ts';
import { markOf, unmarked } from '../core/itemLinks.ts';
import {
  BOARD_HEIGHT,
  boardsIn,
  clampHeight,
  withBoardHeight,
  cardText,
  cardsOf,
  columnFor,
  doneColumn,
  itemAt,
  itemsIn,
  moveCard,
  newCard,
  putCard,
  putCardAt,
  itemWords,
  refsIn,
  settleTicks,
  settleColumns,
  setItemDone,
  wordsEnd,
  withoutCard,
  writeBoard,
  type BoardColumn,
  type Card,
  type Item,
} from '../core/boards.ts';

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
 */

const setFocus = StateEffect.define<boolean>();

const focusField = StateField.define<boolean>({
  create: () => false,
  update(focused, tr) {
    for (const effect of tr.effects) if (effect.is(setFocus)) return effect.value;
    return focused;
  },
});

/** Where a board is in the document, and what it holds. */
interface Drawn {
  /** The whole fence, from the first backtick to the last. */
  from: number;
  to: number;
  /** The line the opening fence is on, which is how core/boards.ts is asked about this board. */
  open: number;
  columns: BoardColumn[];
  items: Item[];
  cards: Card[];
  /** How tall the lanes are set, in ems (core/boards.ts), or null for their own height. */
  height: number | null;
}

function boards(state: EditorState): Drawn[] {
  const doc = state.doc.toString();
  const items = itemsIn(doc);
  const all = boardsIn(doc);
  // Every anchor any board names: an item one of them names is never taken for a card whose anchor has slipped.
  const named = new Set(all.flatMap((board) => board.columns.flatMap((column) => column.cards)));
  return all
    .filter((board) => board.to > board.from)
    .map((board) => {
      const columns = board.columns;
      // A ticked item sits in Done wherever the fence has it, so the board never disagrees with the note.
      const cards = cardsOf(columns, items, named).map((card) => (card.item ? { ...card, column: Math.max(0, columnFor(columns, card.item)) } : card));
      return {
        from: state.doc.line(board.from).from,
        to: state.doc.line(board.to).to,
        open: board.from,
        columns,
        items,
        cards,
        height: board.height,
      };
    });
}

/**
 * The board's icons, drawn in the same strokes as the rest of the app's (lucide's paths, 24-unit box, round caps), so
 * the controls are icons rather than the characters `‹ › +` set in whatever face the phone falls back to.
 */
const ICONS = {
  plus: ['M5 12h14', 'M12 5v14'],
  // A page with an N on it, as the Notion plugin draws its own mark (plugins/notion/marks.tsx).
  notion: ['M5 4h10l4 4v12H5z', 'M9 16V9l6 7V9'],
  // Any other plugin's link: two rings of a chain.
  link: ['M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'],
  left: ['m15 18-6-6 6-6'],
  right: ['m9 18 6-6-6-6'],
  check: ['M20 6 9 17l-5-5'],
  // The card's own menu: three dots (lucide ellipsis).
  more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  // What the menu offers: go to the line, take the card off the board.
  words: ['M4 6h16', 'M4 12h10', 'M4 18h13'],
  off: ['M18 6 6 18', 'M6 6l12 12'],
  // An empty column's picture, by what the column is for (lucide list-checks, hourglass, check-check, inbox).
  todo: ['M13 5h8', 'M13 12h8', 'M13 19h8', 'm3 17 2 2 4-4', 'm3 7 2 2 4-4'],
  doing: [
    'M5 22h14',
    'M5 2h14',
    'M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22',
    'M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2',
  ],
  done: ['M18 6 7 17l-5-5', 'm22 10-7.5 7.5L13 16'],
  inbox: ['M22 12h-6l-2 3h-4l-2-3H2', 'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z'],
} as const;

/**
 * What an empty column shows, by what its name says it is for (Matt: "add an icon when there are no items in a board
 * like no todo items or no doing tasks"). Column names are free, so this reads the common ones and gives any other
 * column the plain empty tray.
 */
export function emptyLook(name: string): { icon: 'todo' | 'doing' | 'done' | 'inbox'; words: string } {
  const called = name.trim().toLowerCase();
  if (/^done\b|\bdone$|^finished|^complete/.test(called)) return { icon: 'done', words: 'Nothing done yet' };
  if (/doing|in progress|progress|working|active|started|underway/.test(called)) return { icon: 'doing', words: 'Nothing in progress' };
  if (/to ?do|backlog|up next|^next|later|this week|today|planned|waiting/.test(called)) return { icon: 'todo', words: 'Nothing to do' };
  return { icon: 'inbox', words: 'No cards' };
}

function icon(name: keyof typeof ICONS, size = '1em'): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  /*
   * Named so the page can say which of these wear the soft fill every closed-silhouette icon in the app wears
   * (app.css). Drawn here rather than imported, so nothing else could reach them: the hourglass over an empty
   * "in progress" column was the one outline among filled icons (Matt: "even the hour glass icon doesn't have fill").
   */
  svg.classList.add('app-drawnIcon');
  svg.setAttribute('data-icon', name);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.4');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.style.inlineSize = size;
  svg.style.blockSize = size;
  for (const d of ICONS[name]) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/**
 * What a plugin offers a card, given the item's line and its words (Matt: "Add context menu to board items for moving
 * lanes and adding to notion etc.").
 *
 * The line comes first and the words second on purpose: a card names an exact line, and two items that read the same
 * way are told apart by nothing else. `suggest` is the per-line offer the note already shows quietly under a line
 * (editor/suggestions.ts); `action` is the one a swipe on a list item runs (editor/swipeItems.ts), by text, and is
 * only reached for when there is no offer for that line. Neither goes near a plugin: both are the registry's.
 */
export interface CardActions {
  suggest: (body: string) => { line: number; label: string; run: () => Promise<void> }[];
  action: () => { label: string; run: (text: string) => Promise<void> } | null;
}

/** What this editor's plugins offer a card, or nothing where the note is not one a plugin acts on. */
const cardActions = Facet.define<CardActions, CardActions | null>({ combine: (values) => values[0] ?? null });

/** How long a finger rests on a card before it is picked up, and how far it may stray first. */
const HOLD = 220;
const SLOP = 10;
/** How near the edge of the board a held card scrolls it along, and how fast. */
const EDGE = 44;
const EDGE_STEP = 14;

class BoardWidget extends WidgetType {
  constructor(
    readonly board: Drawn,
    readonly face: string,
  ) {
    super();
  }

  eq(other: BoardWidget): boolean {
    return other.face === this.face;
  }

  /**
   * How tall the board is before it is drawn: the height it was last drawn at, or a guess from its cards. Left to
   * CodeMirror, a board not yet on the screen was one line tall, and grew by a screenful as it came into view; the
   * editor then moved the note to keep its place, and on a phone that move stops a fling dead (Matt: "scrolling past
   * boards is glitchy and stops scroll momentum").
   */
  get estimatedHeight(): number {
    return drawnHeight(this.face) ?? guessHeight(this.board);
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-boardWrap';
    const board = document.createElement('div');
    board.className = 'cm-board';
    board.setAttribute('role', 'group');
    board.setAttribute('aria-label', 'Board');
    for (const index of this.board.columns.keys()) {
      const pane = document.createElement('section');
      pane.className = 'cm-boardColumn';
      pane.dataset.column = String(index);
      this.fill(view, pane, index);
      board.append(pane);
    }
    const split = heightSplit(view, wrap);
    wrap.append(board, split);
    sized(board, split, this.board.height);
    watch(view, wrap, board, this.face);
    return wrap;
  }

  destroy(dom: HTMLElement): void {
    watching.get(dom)?.disconnect();
    watching.delete(dom);
  }

  /**
   * The same board changed - a card added, moved or ticked - is redrawn in place, column by column, rather than
   * built again. What that keeps is the field a card is being typed into (`openComposer`): built again, it would
   * lose its focus and the phone its keyboard after every card. A board whose columns changed is built again.
   */
  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    const board = dom.querySelector<HTMLElement>(':scope > .cm-board');
    const split = dom.querySelector<HTMLElement>(':scope > .cm-boardSplit');
    if (!board || !split) return false;
    const panes = [...board.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child.classList.contains('cm-boardColumn'));
    if (panes.length !== this.board.columns.length) return false;
    panes.forEach((pane, index) => this.fill(view, pane, index));
    sized(board, split, this.board.height);
    watch(view, dom, board, this.face);
    return true;
  }

  /** A column's heading and cards, put in its pane or put in place of the ones it had; a field being typed in stays. */
  private fill(view: EditorView, pane: HTMLElement, index: number): void {
    const column = this.board.columns[index]!;
    const held = this.board.cards.filter((card) => card.column === index);
    pane.setAttribute('aria-label', `${column.name}, ${held.length} ${held.length === 1 ? 'card' : 'cards'}`);

    const head = document.createElement('p');
    head.className = 'cm-boardName';
    const name = document.createElement('span');
    name.className = 'cm-boardNameWords';
    name.textContent = column.name;
    const count = document.createElement('span');
    count.className = 'cm-boardCount';
    count.textContent = String(held.length);
    // A card is added where the eye already is, at the top of the column it belongs in.
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'cm-boardAdd';
    add.append(icon('plus', '1.05em'));
    add.setAttribute('aria-label', `Add a card to ${column.name}`);
    press(add, () => openComposer(view, pane, column.name));
    head.append(name, count, add);

    const stack = document.createElement('div');
    stack.className = 'cm-boardStack';
    stack.dataset.column = String(index);
    stack.addEventListener('scroll', () => laneFoot(stack), { passive: true });
    for (const card of held) stack.append(this.drawCard(view, card, index));
    // An empty column is a place, not a blank: at rest it shows what it would hold and says it holds nothing, and
    // while a card is held it is a target, in this column and every other.
    const empty = document.createElement('div');
    empty.className = 'cm-boardEmpty';
    if (!held.length) empty.dataset.none = '';
    const look = emptyLook(column.name);
    const rest = document.createElement('span');
    rest.className = 'cm-boardEmptyRest';
    const picture = icon(look.icon, '1.5em');
    picture.classList.add('cm-boardEmptyIcon');
    const words = document.createElement('span');
    words.textContent = look.words;
    rest.append(picture, words);
    const drop = document.createElement('span');
    drop.className = 'cm-boardEmptyDrop';
    drop.textContent = 'Drop a card here';
    empty.append(rest, drop);
    stack.append(empty);

    const hadHead = pane.querySelector(':scope > .cm-boardName');
    if (hadHead) hadHead.replaceWith(head);
    else pane.prepend(head);
    const hadStack = pane.querySelector(':scope > .cm-boardStack');
    if (hadStack) hadStack.replaceWith(stack);
    else pane.append(stack);
  }

  private drawCard(view: EditorView, card: Card, column: number): HTMLElement {
    const box = document.createElement('div');
    box.className = 'cm-boardCard';
    box.dataset.card = card.id;
    if (!card.item) box.dataset.gone = '';
    else if (card.item.done) box.dataset.done = '';

    // What the item is linked to rides at the end of its line as `[notion](…)`, and read as words the card said
    // "notion" after every single item (Matt: "every item has a notion link each of the items has the literal
    // notion text"). The link is taken off the words and shown as its plugin's mark instead.
    const mark = card.item ? markOf(card.item.text) : null;
    // A card the + has just written has no words yet: it says so until they are typed, rather than sitting blank.
    const written = card.item ? cardText(mark ? unmarked(card.item.text) : card.item.text) : '';
    const said = card.item ? written || 'New card' : `^${card.id}`;
    if (card.item && !written) box.dataset.empty = '';

    // A to-do's box is the card's. An item with no box - a bullet, a step - is a card with nothing to tick.
    if (card.item?.done !== null || !card.item) {
      const tick = document.createElement('button');
      tick.type = 'button';
      tick.className = 'cm-boardTick';
      tick.append(icon('check', '0.85em'));
      tick.setAttribute('aria-label', card.item?.done ? `Untick ${said}` : `Tick ${said}`);
      tick.disabled = !card.item;
      press(tick, () => this.tick(view, card));
      box.append(tick);
    } else {
      const dot = document.createElement('span');
      dot.className = 'cm-boardDot';
      dot.setAttribute('aria-hidden', 'true');
      box.append(dot);
    }

    const words = document.createElement('button');
    words.type = 'button';
    words.className = 'cm-boardWords';
    // What the card says: the words without their markdown, and a few lines of them at most (core/boards.ts).
    words.textContent = said;
    words.title = said;
    words.setAttribute('aria-label', card.item ? `Go to ${said} in the note` : `${card.id}: this item is not in the note`);
    press(words, () => this.goTo(view, card));

    const moves = document.createElement('span');
    moves.className = 'cm-boardMoves';
    for (const [by, label, glyph] of [
      [-1, 'Move left', 'left'],
      [1, 'Move right', 'right'],
    ] as const) {
      const move = document.createElement('button');
      move.type = 'button';
      move.className = 'cm-boardMove';
      move.append(icon(glyph, '1em'));
      move.setAttribute('aria-label', `${label}: ${said}`);
      move.disabled = (by < 0 && column === 0) || (by > 0 && column === this.board.columns.length - 1);
      press(move, () => this.move(view, card, by));
      moves.append(move);
    }

    // The card's own menu: lanes to move to, the line in the note, what a plugin offers, and off the board. A press
    // and hold is already the drag, so the menu needs a button of its own.
    const menu = document.createElement('button');
    menu.type = 'button';
    menu.className = 'cm-boardMore';
    menu.append(icon('more', '1.1em'));
    menu.setAttribute('aria-label', `More for ${said}`);
    menu.setAttribute('aria-haspopup', 'menu');
    press(menu, () => this.cardMenu(view, card, box));
    moves.prepend(menu);

    const badge = mark ? document.createElement('span') : null;
    if (badge && mark) {
      badge.className = 'cm-boardLinked';
      badge.title = `Linked to ${mark.name}`;
      badge.setAttribute('aria-label', `Linked to ${mark.name}`);
      badge.append(icon(mark.name === 'notion' ? 'notion' : 'link', '0.95em'));
    }

    box.append(words, ...(badge ? [badge] : []), moves);
    this.hold(view, box, card);
    return box;
  }

  /** The card's tick box is the item's: the line is ticked, and a Done column takes the card. */
  private tick(view: EditorView, card: Card): void {
    const item = card.item;
    if (!item || item.done === null) return;
    const line = view.state.doc.line(item.line);
    const done = !item.done;
    const changes = [{ from: line.from, to: line.to, insert: setItemDone(line.text, done) }];
    const put = done ? doneColumn(this.board.columns) : 0;
    const columns = put >= 0 ? putCard(this.board.columns, card.id, put) : null;
    hushGoTo();
    view.dispatch({ changes: columns ? [...changes, this.fence(view, columns, card.id)] : changes, userEvent: 'input.board' });
    fireNativeHaptic('selection');
    if (columns) reveal(view, card.id);
  }

  private move(view: EditorView, card: Card, by: number): void {
    view.dispatch({ changes: this.fence(view, moveCard(this.board.columns, card.id, by), card.id), userEvent: 'input.board' });
    fireNativeHaptic('selection');
  }

  /**
   * A card's own menu (Matt: "Add context menu to board items for moving lanes and adding to notion etc.").
   *
   * It opens from the card's **more** button rather than a press and hold, because a press and hold is already how a
   * card is picked up to drag. It sits in the lane right under its card, the way the + field sits at the top of a
   * column: no floating panel to place, and it scrolls with the board it belongs to.
   *
   * What it offers: each other lane to move to, the item's tick, the line in the note, whatever a plugin offers this
   * item (its own line's offer first, then the one a swipe would run), and the card off the board. Nothing that cannot
   * be done is shown, so a card whose item is gone offers only to take itself off.
   */
  private cardMenu(view: EditorView, card: Card, at: HTMLElement): void {
    const board = this.board;
  const stack = at.closest<HTMLElement>('.cm-boardStack');
  if (!stack) return;
  // A second press on the button closes it again, and only one is ever open.
  const already = stack.querySelector('.cm-boardMenu');
  const mine = already?.previousElementSibling === at;
  for (const open of board ? [...(at.closest('.cm-board')?.querySelectorAll('.cm-boardMenu') ?? [])] : []) open.remove();
  if (mine) return;

  const menu = document.createElement('div');
  menu.className = 'cm-boardMenu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Card');

  const row = (label: string, glyph: keyof typeof ICONS, run: () => void) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-boardMenuRow';
    button.setAttribute('role', 'menuitem');
    button.append(icon(glyph, '1em'));
    const words = document.createElement('span');
    words.textContent = label;
    button.append(words);
    press(button, () => {
      close();
      run();
    });
    menu.append(button);
    return button;
  };

  const close = () => {
    menu.remove();
    window.removeEventListener('pointerdown', away, true);
    window.removeEventListener('keydown', escape, true);
  };
  const away = (event: PointerEvent) => {
    if (!(event.target instanceof Node) || (!menu.contains(event.target) && event.target !== at)) close();
  };
  const escape = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  const item = card.item;
  // Every other lane, in the board's own order.
  board.columns.forEach((column, index) => {
    if (index === card.column) return;
      row(`Move to ${column.name}`, index < card.column ? 'left' : 'right', () => this.land(view, card, index, Number.MAX_SAFE_INTEGER));
  });
  if (item && item.done !== null) {
    row(item.done ? 'Untick' : 'Tick', 'check', () => this.tick(view, card));
  }
  if (item) {
    row('Go to the line', 'words', () => goToLine(view, item.line));
    const offer = pluginOffer(view, item);
    if (offer) row(offer.label, 'link', () => void offer.run());
  }
    row('Take off the board', 'off', () => {
      view.dispatch({ changes: this.fence(view, withoutCard(board.columns, card.id), card.id), userEvent: 'input.board' });
      fireNativeHaptic('selection');
    });

  at.after(menu);
  menu.querySelector('button')?.focus();
  menu.scrollIntoView({ block: 'nearest' });
  window.addEventListener('pointerdown', away, true);
  window.addEventListener('keydown', escape, true);
}

  /** The fence rewritten: the columns as a person would have typed them, between the two ``` lines. */
  private fence(view: EditorView, columns: readonly BoardColumn[], moved?: string) {
    const open = view.state.doc.lineAt(this.board.from);
    const close = view.state.doc.lineAt(this.board.to);
    // What the board shows, written down: the card the person just moved where they put it, and any other card whose
    // item is ticked in Done, where it is already drawn (core/boards.ts `settleColumns`).
    return { from: open.to + 1, to: close.from - 1, insert: writeBoard(settleColumns(columns, this.board.items, moved)) };
  }

  /** The words are a way into the note: the caret lands on the item, and the note scrolls to it. */
  private goTo(view: EditorView, card: Card): void {
    if (!card.item || Date.now() < quietUntil) return;
    goToLine(view, card.item.line);
  }

  /**
   * Press and hold, then drag: the card is lifted under the finger, a gap opens where it would land, and letting go
   * writes it there. Before the hold is up the finger still scrolls the board, which is why nothing is taken over
   * until the card is actually lifted.
   */
  private hold(view: EditorView, card: HTMLElement, held: Card): void {
    card.addEventListener('pointerdown', (event: PointerEvent) => {
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      // A press on one of the card's controls is that control's: a finger resting on the tick box a little past the
      // hold used to lift the card instead of ticking it, so a slow tap did nothing and the next landed on the words.
      if ((event.target as Element | null)?.closest?.('.cm-boardTick, .cm-boardMove, .cm-boardAdd, .cm-boardMore, .cm-boardMenu')) return;
      const board = card.closest('.cm-board') as HTMLElement | null;
      if (!board) return;
      // The card answers its own press and hold: the note's long-press menu is for the words, not for a card.
      event.stopPropagation();
      const startX = event.clientX;
      const startY = event.clientY;
      let lift: Lift | null = null;
      let timer = window.setTimeout(() => {
        timer = 0;
        lift = pickUp(board, card, held, startX, startY);
      }, HOLD);

      const move = (moving: PointerEvent) => {
        if (moving.pointerId !== event.pointerId) return;
        if (!lift) {
          // Moved before the hold was up: the finger is scrolling the board, so the card is left alone.
          if (Math.hypot(moving.clientX - startX, moving.clientY - startY) > SLOP && timer) {
            window.clearTimeout(timer);
            timer = 0;
            done();
          }
          return;
        }
        moving.preventDefault();
        dragTo(lift, moving.clientX, moving.clientY);
      };
      const up = (lifting: PointerEvent) => {
        if (lifting.pointerId !== event.pointerId) return;
        const landed = lift;
        const column = landed?.column ?? 0;
        const index = Math.max(0, landed?.index ?? 0);
        done();
        if (landed) this.land(view, held, column, index);
      };
      const cancel = (cancelling: PointerEvent) => {
        if (cancelling.pointerId === event.pointerId) done();
      };
      // Held, a finger's movement is the drag and not a scroll. `touch-action` is read when the finger goes down, so
      // setting it at pick-up is too late for this touch: the browser would take the next move as a pan and cancel
      // the pointer. A touchmove that is not passive can still refuse the pan, as long as the card is held.
      const still = (touching: TouchEvent) => {
        if (lift && touching.cancelable) touching.preventDefault();
      };
      const done = () => {
        if (timer) window.clearTimeout(timer);
        timer = 0;
        if (lift) putDown(lift);
        lift = null;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
        window.removeEventListener('touchmove', still);
      };

      // The moves are heard on the window, not the card. The drag moves the card to where it would land, and a node
      // moved in the page loses the pointer it had captured: from then on the moves, the lift and the cancel went to
      // whatever was under the finger, the card never heard them, and it was left held with its copy on the screen.
      // Nor is the pointer captured at all: captured, a mouse's click went to the card instead of the tick box in it.
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
      window.addEventListener('touchmove', still, { passive: false });
    });
  }

  /** Where the card was let go: the fence rewritten, and the tick box brought with it where a Done column is crossed. */
  private land(view: EditorView, card: Card, column: number, index: number): void {
    const was = card.column;
    if (was === column && index === this.board.cards.filter((other) => other.column === column).findIndex((other) => other.id === card.id)) return;
    const changes = [this.fence(view, putCardAt(this.board.columns, card.id, column, index), card.id)];
    // Dragged into Done, the item is done; dragged out of it, it is not. The note says so, not only the board.
    const done = doneColumn(this.board.columns);
    const item = card.item;
    if (item && item.done !== null && done >= 0 && (was === done) !== (column === done)) {
      const line = view.state.doc.line(item.line);
      changes.push({ from: line.from, to: line.to, insert: setItemDone(line.text, column === done) });
    }
    hushGoTo();
    view.dispatch({ changes, userEvent: 'input.board' });
    fireNativeHaptic('success');
    reveal(view, card.id);
  }

  /** The field a card is typed into is the page's own input: the editor leaves its keys and taps alone. */
  ignoreEvent(event: Event): boolean {
    return event.target instanceof Element && event.target.closest('.cm-boardCompose, .cm-boardSplit, .cm-boardMenu') !== null;
  }
}

/**
 * A board on the page, kept an eye on: its size, for the lanes' feet and for the height it is remembered at. The
 * observer goes when CodeMirror takes the board off the page (`destroy`).
 */
const watching = new WeakMap<HTMLElement, ResizeObserver>();
/** What each board on the page shows, for remembering its height by. */
const faces = new WeakMap<HTMLElement, string>();

function watch(view: EditorView, wrap: HTMLElement, board: HTMLElement, face: string): void {
  faces.set(wrap, face);
  // Drawn or redrawn: the lanes are new, and the board may be a new height, once it is laid out.
  view.requestMeasure({
    read: () => null,
    write: () => {
      // Its own height, held while it is on the screen, so a card moving lanes never moves the note under a finger.
      pin(board);
      lanesFoot(board);
      remember(wrap, board);
    },
  });
  if (watching.has(wrap) || typeof ResizeObserver === 'undefined') return;
  const observer = new ResizeObserver(() => {
    repin(board);
    lanesFoot(board);
    remember(wrap, board);
  });
  observer.observe(board);
  watching.set(wrap, observer);
}

/**
 * A lane with more cards below than it shows: its foot goes to smoke, the app's wisp edge (art/wispFoot.ts), and
 * fades into the lane. Only a board with a set height has lanes that scroll; left to itself a lane shows every card.
 */
function laneFoot(stack: HTMLElement): void {
  const board = stack.closest<HTMLElement>('.cm-board');
  const more = Boolean(board?.hasAttribute('data-sized')) && stack.scrollHeight - stack.clientHeight - stack.scrollTop > 4;
  stack.toggleAttribute('data-more', more);
  const smoke = more ? (board?.dataset.wisp ?? '') : '';
  if ((stack.dataset.smoke ?? '') === smoke) return;
  if (smoke) {
    stack.dataset.smoke = smoke;
    stack.style.filter = smoke;
    // The fade the smoke sits under, from the same place the lip is (art/wispFoot.ts): a longer one would rub out
    // the strongest bend, which is what the page's foot read as a plain gradient for. By the lane's own height,
    // since a short lane's band is scaled down to fit it and its fade has to come down with it. Without smoke the
    // lane keeps the em fade in the stylesheet, where there is no lip for it to agree with.
    stack.style.setProperty('--cm-lane-fade', `${wispFootFade(stack.offsetHeight)}px`);
  } else {
    delete stack.dataset.smoke;
    stack.style.removeProperty('filter');
    stack.style.removeProperty('--cm-lane-fade');
  }
}

/** Every lane's foot, and the smoke they wear: one filter for the board, made for the lanes' height. */
function lanesFoot(board: HTMLElement): void {
  const stack = board.querySelector<HTMLElement>('.cm-boardStack');
  // While the line under the board is being dragged the height changes by the pixel, and a filter for each would be
  // made and thrown away: the plain fade does until the finger lifts.
  const moving = board.parentElement?.querySelector(':scope > .cm-boardSplit[data-dragging]');
  const smoke = stack && board.hasAttribute('data-sized') && !moving ? wispFoot(stack.offsetHeight, stack.offsetWidth) : null;
  if (smoke) board.dataset.wisp = smoke;
  else delete board.dataset.wisp;
  for (const lane of board.querySelectorAll<HTMLElement>('.cm-boardStack')) laneFoot(lane);
}

/**
 * How tall boards are drawn, remembered by what they show (`faceOf`), in memory and across launches: a note opened
 * again knows its boards' heights before they are on the screen (`estimatedHeight`). A board being typed into, having
 * a card dragged, or having its height dragged is not at its own height, and is not remembered.
 */
const HEIGHTS_KEY = 'glyph-board-heights';
const HEIGHTS_KEPT = 300;
let heights: Map<string, number> | null = null;
let heightsSaving = 0;
/** The type a board and the note around it were last drawn in, in px, for guessing at a board not yet drawn. */
const drawnType = { board: 16.64, note: 19.35 };

function remember(wrap: HTMLElement, board: HTMLElement): void {
  const face = faces.get(wrap);
  if (!face || !wrap.isConnected || board.hasAttribute('data-holding')) return;
  if (wrap.querySelector('.cm-boardCompose, .cm-boardSplit[data-dragging]')) return;
  const height = wrap.getBoundingClientRect().height;
  if (!(height > 0)) return;
  drawnType.board = parseFloat(window.getComputedStyle(board).fontSize) || drawnType.board;
  drawnType.note = parseFloat(window.getComputedStyle(wrap).fontSize) || drawnType.note;
  keepHeight(face, height);
}

function allHeights(): Map<string, number> {
  if (heights) return heights;
  heights = new Map();
  try {
    const value = JSON.parse(localStorage.getItem(HEIGHTS_KEY) ?? '[]') as unknown;
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'number') heights.set(entry[0], entry[1]);
      }
    }
  } catch {
    // No storage: boards are guessed at until they are drawn.
  }
  return heights;
}

function drawnHeight(face: string): number | null {
  return allHeights().get(faceKey(face)) ?? null;
}

export function keepHeight(face: string, height: number): void {
  const all = allHeights();
  const key = faceKey(face);
  const px = Math.round(height * 10) / 10;
  if (all.get(key) === px) return;
  // Newest last, so the oldest are the first let go.
  all.delete(key);
  all.set(key, px);
  for (const old of all.keys()) {
    if (all.size <= HEIGHTS_KEPT) break;
    all.delete(old);
  }
  if (heightsSaving || typeof window === 'undefined') return;
  heightsSaving = window.setTimeout(() => {
    heightsSaving = 0;
    try {
      localStorage.setItem(HEIGHTS_KEY, JSON.stringify([...all]));
    } catch {
      // No storage: remembered for as long as the app is open.
    }
  }, 500);
}

/** A short name for what a board shows: its length and an FNV-1a hash, since the face itself holds every card's words. */
function faceKey(face: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < face.length; i += 1) {
    hash ^= face.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${face.length.toString(36)}.${(hash >>> 0).toString(36)}`;
}

/** Room under a lane's last card, in the lane's ems; the set-height lanes keep more, for the smoke. */
const LANE_FOOT = 0.25;
/** A board's type, against the note's. */
const BOARD_TYPE = 0.86;
/** The room above a board, the line under it and the space around that, in the note's ems (`.cm-boardWrap`, `.cm-boardSplit`). */
const WRAP_ROOM = 0.4 * BOARD_TYPE + 0.3 + 1 + 0.5;

/**
 * A board's height before it has ever been drawn, worked out the way it is laid out (`boardTheme`): its lanes' heads,
 * the tallest lane's cards at one to three lines each by how many words they have, and the line under it. Near enough
 * that the editor's correction, when the board is drawn, is small.
 */
export function guessHeight(board: Drawn): number {
  const em = drawnType.board;
  // A column is min(78vw, 16rem) across.
  const rem = typeof window === 'undefined' ? 16 : parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
  const across = typeof window === 'undefined' ? 256 : Math.min(window.innerWidth * 0.78, 16 * rem);
  // A card's words have its width less the tick, the gaps and the padding, at about 0.45em a letter.
  const perLine = Math.max(8, (across - 3.7 * em) / (0.45 * em));
  const lane = (column: number): number => {
    const cards = board.cards.filter((card) => card.column === column);
    // An empty lane: its picture and its words.
    if (!cards.length) return 4.95;
    const tall = cards.reduce((sum, card) => {
      const text = card.item?.text ?? '';
      const words = card.item ? cardText(markOf(text) ? unmarked(text) : text).length : card.id.length + 1;
      const lines = Math.min(3, Math.max(1, Math.ceil(words / perLine)));
      return sum + 2.41 + 1.35 * lines + 0.4;
    }, -0.4);
    return tall + LANE_FOOT;
  };
  const lanes = board.height ?? Math.max(2.5, ...board.columns.map((_, index) => lane(index)));
  // The board's padding, a column's padding, its head and the gap under it; then the lanes; then the room around.
  return Math.round((em * (0.6 + 0.7 + 1.6 + 0.4 + lanes) + drawnType.note * WRAP_ROOM + 1) * 10) / 10;
}

/**
 * How tall a board is, set by dragging the line under it (Matt: "make board height configurable with glacierUI split
 * view"). The line is Glacier's split-pane divider (@glacier/react `ResizableSplitPane`), made for a board that sits
 * in a scrolling note rather than in a box of its own: a hairline with a grip, a separator a screen reader can set,
 * dragged, stepped with the arrow keys, sent to either end with Home and End, and put back with a double tap. The
 * grip shows all the time, since a phone has no hover to show it on, and the line takes a finger's width of touch.
 *
 * The height is the lanes', in their own ems, so a board keeps its number of cards when the text size changes. It is
 * written into the board's fence when the finger lifts (core/boards.ts `withBoardHeight`), so it goes wherever the
 * note goes; while the finger moves it is only a style, and nothing is written.
 */
function heightSplit(view: EditorView, wrap: HTMLElement): HTMLElement {
  const split = document.createElement('div');
  split.className = 'cm-boardSplit';
  split.setAttribute('role', 'separator');
  split.setAttribute('aria-orientation', 'horizontal');
  split.setAttribute('aria-label', 'Board height');
  split.setAttribute('aria-valuemin', String(BOARD_HEIGHT.min));
  split.setAttribute('aria-valuemax', String(BOARD_HEIGHT.max));
  split.tabIndex = 0;
  split.title = 'Drag to resize the board';
  // The handle: Glacier's grip pill at the middle of the line under the board (Matt: "Add resize handle in the bottom
  // middle of board to resize", then "the resize handle under the board changed and doesnt match the simplistic
  // version anymore").
  const grip = document.createElement('span');
  grip.className = 'cm-boardGrip';
  grip.setAttribute('aria-hidden', 'true');
  split.append(grip);

  // The note must not take the press as a caret move, or the finger's drag as a text selection.
  split.addEventListener('mousedown', (event) => event.preventDefault());
  split.addEventListener('pointerdown', (event) => dragHeight(view, wrap, split, event));
  split.addEventListener('dblclick', (event) => {
    event.preventDefault();
    writeHeight(view, wrap, null);
  });
  split.addEventListener('keydown', (event) => {
    const now = laneHeight(wrap);
    const next =
      event.key === 'ArrowUp' ? now - 1 : event.key === 'ArrowDown' ? now + 1 : event.key === 'Home' ? BOARD_HEIGHT.min : event.key === 'End' ? BOARD_HEIGHT.max : null;
    if (next === null) return;
    event.preventDefault();
    writeHeight(view, wrap, clampHeight(next));
  });
  return split;
}

/** The board drawn at its set height, or its own; and the divider saying which. */
function sized(board: HTMLElement, split: HTMLElement, height: number | null): void {
  if (height === null) {
    board.style.removeProperty('--cm-lane-height');
    delete board.dataset.sized;
  } else {
    board.style.setProperty('--cm-lane-height', `${height}em`);
    board.dataset.sized = '';
    // A height from the fence is the height: no pin under it.
    board.style.removeProperty('--cm-board-pin');
    delete board.dataset.pinned;
  }
  if (height !== null) {
    split.setAttribute('aria-valuenow', String(height));
    return;
  }
  // Left to itself, the height is measured, and a board just built is not on the page to be measured until the
  // frame after.
  const measure = () => split.setAttribute('aria-valuenow', String(Math.round(laneHeightOf(board))));
  if (board.isConnected) measure();
  else requestAnimationFrame(measure);
}

/**
 * A board with no height of its own, pinned to the height it was first drawn at (Matt: "Clicking an item to toggle
 * the done state on and off is now super laggy and doesn't actually change the state off").
 *
 * The lanes are as tall as the tallest lane's cards, so moving a card between lanes changed the board's height, and
 * everything under it jumped - by 48px in the case Matt hit. The second tap then landed on whatever had slid under
 * the finger: the next item, or the board itself. Nothing was broken about the tick; the note had moved.
 *
 * So a board's height is settled when it is drawn and held there: ticking, dragging, adding and taking off all leave
 * it exactly where it is, and the lanes scroll inside it as a board with a set height does. It is measured once,
 * from the height the board would have chosen for itself, and let go when the board is built again - the note
 * reopened, its columns changed - or when the line under it is dragged, which sets a real height in the fence.
 */
function pin(board: HTMLElement): void {
  if (board.dataset.pinned !== undefined || board.hasAttribute('data-sized') || !board.isConnected) return;
  const stack = board.querySelector<HTMLElement>('.cm-boardStack');
  const tall = stack?.getBoundingClientRect().height ?? 0;
  if (!stack || tall <= 0) return;
  board.style.setProperty('--cm-board-pin', `${Math.round(tall)}px`);
  board.dataset.pinned = '';
  // The type it was measured in: a board pinned in px must be measured again when the words change size.
  board.dataset.pinnedType = window.getComputedStyle(stack).fontSize;
}

/** A pinned board whose words have changed size is measured again: the pin is px, and a px height ages. */
function repin(board: HTMLElement): void {
  const stack = board.querySelector<HTMLElement>('.cm-boardStack');
  if (board.dataset.pinned === undefined || !stack) return;
  if (window.getComputedStyle(stack).fontSize === board.dataset.pinnedType) return;
  board.style.removeProperty('--cm-board-pin');
  delete board.dataset.pinned;
  delete board.dataset.pinnedType;
  pin(board);
}

/** How tall the lanes are drawn now, in their own ems. */
function laneHeight(wrap: HTMLElement): number {
  const board = wrap.querySelector<HTMLElement>(':scope > .cm-board');
  return board ? laneHeightOf(board) : BOARD_HEIGHT.min;
}

function laneHeightOf(board: HTMLElement): number {
  // Set, the height is the one the fence gave; nothing to measure.
  const set = parseFloat(board.style.getPropertyValue('--cm-lane-height'));
  if (board.hasAttribute('data-sized') && Number.isFinite(set)) return set;
  const stack = board.querySelector<HTMLElement>('.cm-boardStack');
  if (!stack) return BOARD_HEIGHT.min;
  const em = parseFloat(window.getComputedStyle(stack).fontSize) || 16;
  // Left to themselves, the lanes are as tall as the tallest one's cards.
  const px = stack.getBoundingClientRect().height;
  return px > 0 ? px / em : BOARD_HEIGHT.min;
}

/** The height written into the board's fence, or taken out of it with null: one change, one undo. */
function writeHeight(view: EditorView, wrap: HTMLElement, height: number | null): void {
  const open = view.state.doc.lineAt(view.posAtDOM(wrap));
  const next = withBoardHeight(open.text, height);
  if (next !== open.text) view.dispatch({ changes: { from: open.from, to: open.to, insert: next }, userEvent: 'input.board' });
}

/**
 * The line under a board, dragged. The lanes follow the finger as a style; letting go writes the height. Heard on the
 * window and by pointer id, as the card drag is, so a pointer that wanders off the line still finishes the drag.
 */
function dragHeight(view: EditorView, wrap: HTMLElement, split: HTMLElement, event: PointerEvent): void {
  if (event.button !== 0 && event.pointerType === 'mouse') return;
  const board = wrap.querySelector<HTMLElement>(':scope > .cm-board');
  if (!board) return;
  event.preventDefault();
  event.stopPropagation();
  const stack = board.querySelector<HTMLElement>('.cm-boardStack');
  const em = stack ? parseFloat(window.getComputedStyle(stack).fontSize) || 16 : 16;
  const was = board.style.getPropertyValue('--cm-lane-height');
  const wasSized = board.hasAttribute('data-sized');
  const from = laneHeightOf(board);
  const startY = event.clientY;
  let height = from;
  let edge: 'min' | 'max' | null = null;
  split.dataset.dragging = '';

  const move = (moving: PointerEvent) => {
    if (moving.pointerId !== event.pointerId) return;
    moving.preventDefault();
    const wanted = from + (moving.clientY - startY) / em;
    height = clampHeight(wanted);
    board.style.setProperty('--cm-lane-height', `${height}em`);
    board.dataset.sized = '';
    split.setAttribute('aria-valuenow', String(height));
    // A buzz at either end, as Glacier's divider gives, so the finger knows it can go no further.
    const at = wanted <= BOARD_HEIGHT.min ? 'min' : wanted >= BOARD_HEIGHT.max ? 'max' : null;
    if (at !== edge) {
      edge = at;
      if (at) fireNativeHaptic('medium');
    }
  };
  const still = (touching: TouchEvent) => {
    if (touching.cancelable) touching.preventDefault();
  };
  const done = (write: boolean) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('touchmove', still);
    delete split.dataset.dragging;
    if (write && Math.abs(height - from) >= 0.5) {
      writeHeight(view, wrap, height);
      return;
    }
    // Let go where it started, or called off: the board as it was.
    if (was) board.style.setProperty('--cm-lane-height', was);
    else board.style.removeProperty('--cm-lane-height');
    if (wasSized) board.dataset.sized = '';
    else delete board.dataset.sized;
  };
  const up = (lifting: PointerEvent) => {
    if (lifting.pointerId === event.pointerId) done(true);
  };
  const cancel = (cancelling: PointerEvent) => {
    if (cancelling.pointerId === event.pointerId) done(false);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('touchmove', still, { passive: false });
}

/** What a plugin offers this item: its own line's offer, else the one a swipe on the line would run. Null for none. */
function pluginOffer(view: EditorView, item: Item): { label: string; run: () => Promise<void> } | null {
  const actions = view.state.facet(cardActions);
  if (!actions) return null;
  // The line first: a card names an exact line, and two items that read the same way are told apart by nothing else.
  const here = actions.suggest(view.state.doc.toString()).find((offer) => offer.line === item.line);
  if (here) return { label: here.label, run: here.run };
  const action = actions.action();
  return action ? { label: action.label, run: () => action.run(itemWords(view.state.doc.line(item.line).text) ?? item.text) } : null;
}

/**
 * The + on a column: a field at the top of it, for the new card's words (Matt: "a button on each board to add an
 * item, it should add the item to the list the board is derived from").
 *
 * The words are asked for before anything is written, and Enter writes the item under the board's last one with an
 * anchor named after them, and the card at the top of this column (core/boards.ts `newCard`). The field stays open
 * and empty for the next card; Escape, or leaving it empty, closes it. Nothing goes into the note's own lines by
 * the caret, so the line is always a proper task item, `- [ ] words ^anchor`.
 */
function openComposer(view: EditorView, pane: HTMLElement, name: string): void {
  const already = pane.querySelector<HTMLInputElement>(':scope > .cm-boardCompose input');
  if (already) {
    already.focus();
    return;
  }
  const form = document.createElement('form');
  form.className = 'cm-boardCompose';
  // A form with a text field and a submit button is what a password manager watches for: 1Password and the rest
  // offered to save a login every time a card was added (Matt: "New Tasks are popping password manager save modal").
  // These say what it really is, in each of the ways they read.
  form.setAttribute('autocomplete', 'off');
  form.setAttribute('data-form-type', 'other');
  form.setAttribute('data-1p-ignore', '');
  form.setAttribute('data-lpignore', 'true');
  const field = document.createElement('input');
  field.type = 'text';
  field.className = 'cm-boardComposeField';
  field.placeholder = 'New card';
  field.enterKeyHint = 'done';
  field.autocapitalize = 'sentences';
  field.name = 'card';
  field.autocomplete = 'off';
  field.setAttribute('data-form-type', 'other');
  field.setAttribute('data-1p-ignore', '');
  field.setAttribute('data-lpignore', 'true');
  field.setAttribute('aria-label', `New card in ${name}`);
  const add = document.createElement('button');
  add.type = 'submit';
  add.className = 'cm-boardComposeAdd';
  add.textContent = 'Add';
  add.disabled = true;
  // Pressing Add must not take the focus from the field first, or the phone's keyboard drops between cards.
  add.addEventListener('mousedown', (event) => event.preventDefault());
  // Where the card's tick box goes, so the words typed start where a card's words do.
  const box = document.createElement('span');
  box.className = 'cm-boardComposeTick';
  box.setAttribute('aria-hidden', 'true');
  const ready = () => {
    add.disabled = !field.value.trim();
  };
  field.addEventListener('input', ready);
  form.append(box, field, add);

  const close = () => form.remove();
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const board = pane.closest('.cm-board');
    if (!board || !field.value.trim()) return;
    // Read where the board is now, not where it was when the field opened: the note may have changed above it.
    const open = view.state.doc.lineAt(view.posAtDOM(board)).number;
    if (!addCard(view, open, Number(pane.dataset.column ?? 0), field.value)) return;
    field.value = '';
    ready();
    fireNativeHaptic('selection');
  });
  field.addEventListener('keydown', (event) => {
    // Enter adds the card itself: a form inside the note's editable page is not sent by Enter on every browser, and
    // a keyboard still composing a word is left to finish it.
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });
  field.addEventListener('blur', () => {
    if (field.value.trim()) return;
    window.setTimeout(() => {
      if (document.activeElement !== field) close();
    }, 150);
  });

  pane.querySelector(':scope > .cm-boardName')?.after(form);
  field.focus();
}

/** A card with these words in column `column` of the board that opens on line `open`: the fence and the new line together. */
function addCard(view: EditorView, open: number, column: number, words: string): boolean {
  const made = newCard(view.state.doc.toString(), open, column, words);
  if (!made) return false;
  const doc = view.state.doc;
  const top = doc.line(made.fence.from);
  const bottom = doc.line(made.fence.to);
  const end = made.at > doc.lines;
  const at = end ? doc.length : doc.line(made.at).from;
  // At the end of a note that does not end in a newline, the line needs one of its own in front of it.
  const tail = doc.length ? view.state.sliceDoc(doc.length - 1) : '\n';
  const insert = end ? `${tail === '\n' ? '' : '\n'}${made.text}` : `${made.text}\n`;
  view.dispatch({
    changes: [
      { from: top.to + 1, to: bottom.from - 1, insert: made.fence.body },
      { from: at, insert },
    ],
    userEvent: 'input.board',
  });
  return true;
}

/**
 * A card in the air: what was picked up, and where it would land.
 *
 * The card itself stays in the page as the gap it would leave, emptied out and outlined, and it is that element
 * which moves from place to place as the finger goes: the space under the finger is always the space the card will
 * take. A copy of it follows the finger overhead.
 */
interface Lift {
  board: HTMLElement;
  card: HTMLElement;
  ghost: HTMLElement;
  dx: number;
  dy: number;
  column: number;
  index: number;
  /** Where the finger is, for placing the gap again while something scrolls under a finger that is still. */
  x: number;
  y: number;
  /** The board scrolling itself while a card is held against its edge. */
  scroll: number;
  /** A lane, or the note, scrolling while a card is held near its top or foot. */
  rise: number;
  /** What is rising, so the roll can be stopped when the finger moves to another. */
  rising: HTMLElement | null;
}

function pickUp(board: HTMLElement, card: HTMLElement, held: Card, x: number, y: number): Lift {
  const box = card.getBoundingClientRect();
  const ghost = card.cloneNode(true) as HTMLElement;
  ghost.classList.add('cm-boardGhost');
  ghost.style.inlineSize = `${box.width}px`;
  ghost.style.transform = `translate(${box.left}px, ${box.top}px)`;
  // The copy is drawn over the whole page, so it lives outside the note - but the board's look is written under the
  // editor's own classes (EditorView.baseTheme), so it goes in a layer that carries them. Straight on the body it had
  // no look at all, and was drawn a screen below the finger.
  const editor = board.closest<HTMLElement>('.cm-editor');
  const layer = document.createElement('div');
  layer.className = editor?.className ?? '';
  layer.style.cssText = 'position:fixed;inset:0;z-index:40;pointer-events:none;background:none;border:none;outline:none;display:block';
  // The board's type, since the copy is no longer inside the board that sets it.
  const face = window.getComputedStyle(board);
  layer.style.font = face.font;
  layer.style.color = face.color;
  layer.append(ghost);
  document.body.append(layer);

  card.dataset.lifted = '';
  card.style.blockSize = `${box.height}px`;
  // Held, the finger drags rather than scrolls; the board is scrolled for it at the edges instead.
  card.style.touchAction = 'none';
  board.dataset.holding = '';

  fireNativeHaptic('selection');
  const lift: Lift = { board, card, ghost, dx: x - box.left, dy: y - box.top, column: held.column, index: 0, x, y, scroll: 0, rise: 0, rising: null };
  dragTo(lift, x, y);
  return lift;
}

/** The held card follows the finger, the gap goes where it would land, and the board scrolls at its edges. */
function dragTo(lift: Lift, x: number, y: number): void {
  lift.x = x;
  lift.y = y;
  lift.ghost.style.transform = `translate(${x - lift.dx}px, ${y - lift.dy}px)`;

  const box = lift.board.getBoundingClientRect();
  const edge = x < box.left + EDGE ? -EDGE_STEP : x > box.right - EDGE ? EDGE_STEP : 0;
  if (edge && !lift.scroll) {
    const roll = () => {
      lift.board.scrollLeft += edge;
      placeGap(lift);
      lift.scroll = requestAnimationFrame(roll);
    };
    lift.scroll = requestAnimationFrame(roll);
  } else if (!edge && lift.scroll) {
    cancelAnimationFrame(lift.scroll);
    lift.scroll = 0;
  }

  const stack = placeGap(lift);
  if (!stack) return;

  // Up and down: a lane with more cards than it shows rolls itself when the card is held near its top or foot, so a
  // card can be dropped below what it shows. A lane that shows every card is rolled by the note instead, near the top
  // or foot of the screen, so a card can be taken down a lane longer than the screen.
  const roller = stack.scrollHeight - stack.clientHeight > 1 ? stack : noteScroller(lift.board);
  const lean = roller ? leanAt(roller, y, roller !== stack) : 0;
  if (lift.rise && (lift.rising !== roller || !lean)) {
    cancelAnimationFrame(lift.rise);
    lift.rise = 0;
    lift.rising = null;
  }
  if (roller && lean && !lift.rise) {
    lift.rising = roller;
    const roll = () => {
      roller.scrollTop += lean;
      placeGap(lift);
      lift.rise = requestAnimationFrame(roll);
    };
    lift.rise = requestAnimationFrame(roll);
  }
}

/** The lane under the finger gets the gap, above the first card whose middle the finger is over. */
function placeGap(lift: Lift): HTMLElement | null {
  const { x, y } = lift;
  const stacks = [...lift.board.querySelectorAll<HTMLElement>('.cm-boardStack')];
  if (!stacks.length) return null;
  // The column under the finger, or the nearest one when the finger is past the end of the board.
  const stack =
    stacks.find((pane) => {
      const at = pane.getBoundingClientRect();
      return x >= at.left && x <= at.right;
    }) ??
    stacks.reduce((near, pane) => {
      const gap = (rect: DOMRect) => (x < rect.left ? rect.left - x : x - rect.right);
      return gap(pane.getBoundingClientRect()) < gap(near.getBoundingClientRect()) ? pane : near;
    }, stacks[0]!);

  for (const pane of stacks) if (pane !== stack) delete pane.dataset.over;
  stack.dataset.over = '';

  const cards = [...stack.querySelectorAll<HTMLElement>('.cm-boardCard')].filter((other) => other !== lift.card);
  const before = cards.find((other) => {
    const at = other.getBoundingClientRect();
    return y < at.top + at.height / 2;
  });
  const place = before ?? stack.querySelector('.cm-boardEmpty');
  // Moved only when it would land somewhere else: moving it again and again as a roll goes by is work for nothing.
  if (lift.card.parentElement !== stack || lift.card.nextElementSibling !== place) stack.insertBefore(lift.card, place);

  lift.column = Number(stack.dataset.column ?? 0);
  lift.index = [...stack.querySelectorAll<HTMLElement>('.cm-boardCard')].indexOf(lift.card);
  return stack;
}

/** The note's own scroller: the nearest box above the board that scrolls up and down. */
function noteScroller(board: HTMLElement): HTMLElement | null {
  for (let at = board.parentElement; at; at = at.parentElement) {
    const flow = window.getComputedStyle(at).overflowY;
    if ((flow === 'auto' || flow === 'scroll') && at.scrollHeight > at.clientHeight + 1) return at;
  }
  const page = document.scrollingElement;
  return page instanceof HTMLElement && page.scrollHeight > page.clientHeight + 1 ? page : null;
}

/**
 * How fast to roll `roller` for a finger at `y`: up near its top, down near its foot, nothing between. The note's
 * top is under its header, so the zone starts below that (`--wisp-under`, art/wispEdge.ts), and is wider, since the
 * finger is near the edge of the screen.
 */
function leanAt(roller: HTMLElement, y: number, note: boolean): number {
  const shown = roller.getBoundingClientRect();
  const under = note ? parseFloat(window.getComputedStyle(roller).getPropertyValue('--wisp-under')) || 0 : 0;
  const top = Math.max(shown.top, 0) + under;
  const bottom = Math.min(shown.bottom, window.innerHeight);
  const zone = note ? EDGE * 2 : EDGE;
  if (y < top + zone && roller.scrollTop > 0) return -EDGE_STEP;
  if (y > bottom - zone && roller.scrollTop + roller.clientHeight < roller.scrollHeight - 1) return EDGE_STEP;
  return 0;
}

/** The card set down: the copy overhead goes, and the card is a card again, wherever it ended up. */
function putDown(lift: Lift): void {
  if (lift.scroll) cancelAnimationFrame(lift.scroll);
  if (lift.rise) cancelAnimationFrame(lift.rise);
  // The layer the copy was drawn in goes with it.
  (lift.ghost.parentElement ?? lift.ghost).remove();
  delete lift.card.dataset.lifted;
  lift.card.style.removeProperty('block-size');
  lift.card.style.removeProperty('touch-action');
  delete lift.board.dataset.holding;
  for (const pane of lift.board.querySelectorAll<HTMLElement>('.cm-boardStack')) delete pane.dataset.over;
}

/** The caret put on a line of the note, and the note scrolled to it. */
function goToLine(view: EditorView, line: number): void {
  if (line < 1 || line > view.state.doc.lines) return;
  const at = view.state.doc.line(line);
  // At the end of the item's words, not the end of the line: typed there, a letter would go into the anchor after them.
  const caret = at.from + wordsEnd(at.text);
  view.dispatch({ selection: EditorSelection.cursor(caret), effects: EditorView.scrollIntoView(at.from, { y: 'center' }), scrollIntoView: true });
  view.focus();
}

/** A button that answers a tap without the editor taking the press as a caret move. */
/**
 * A status changed on the board - a card ticked, or dropped in another lane - keeps the person on the board (Matt:
 * "when changing the status of a ticket to done it jumps me way down to the item in the list instead of moving me to
 * view the task on the board"). For a moment after one, a press on a card's words is not taken as "go to the line":
 * on a phone the tick box sits beside the words, and a finger a little off, or the click a drop leaves behind, landed
 * on them and scrolled the note away.
 */
const QUIET_MS = 700;
let quietUntil = 0;

function hushGoTo(): void {
  quietUntil = Date.now() + QUIET_MS;
}

/**
 * The card where it landed, shown: its lane brought across the board and the card brought into its lane, then a short
 * flash so the eye finds it. The note is moved only as far as it takes to show the card, when a lane that shows every
 * card has put it past the top or foot of the screen.
 */
function reveal(view: EditorView, id: string): void {
  // Twice over a frame: the board is redrawn by the change that moved the card, and the card is in its lane after that.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const card = view.dom.querySelector<HTMLElement>(`.cm-boardCard[data-card="${CSS.escape(id)}"]`);
      const board = card?.closest<HTMLElement>('.cm-board');
      const lane = card?.closest<HTMLElement>('.cm-boardColumn');
      const stack = card?.closest<HTMLElement>('.cm-boardStack');
      if (!card || !board || !lane || !stack) return;
      const boardBox = board.getBoundingClientRect();
      const laneBox = lane.getBoundingClientRect();
      if (laneBox.left < boardBox.left || laneBox.right > boardBox.right) {
        board.scrollTo({ left: board.scrollLeft + laneBox.left - boardBox.left, behavior: 'smooth' });
      }
      const stackBox = stack.getBoundingClientRect();
      const cardBox = card.getBoundingClientRect();
      if (stack.scrollHeight > stack.clientHeight + 1) {
        if (cardBox.top < stackBox.top || cardBox.bottom > stackBox.bottom) {
          stack.scrollTo({ top: stack.scrollTop + cardBox.top - stackBox.top - 8, behavior: 'smooth' });
        }
      } else {
        const note = noteScroller(board);
        if (note) {
          const shown = note.getBoundingClientRect();
          const top = Math.max(shown.top, 0) + (parseFloat(window.getComputedStyle(note).getPropertyValue('--wisp-under')) || 0);
          const bottom = Math.min(shown.bottom, window.innerHeight);
          const by = cardBox.bottom > bottom - EDGE ? cardBox.bottom - bottom + EDGE : cardBox.top < top + 8 ? cardBox.top - top - 8 : 0;
          if (by) note.scrollBy({ top: by, behavior: 'smooth' });
        }
      }
      card.dataset.arrived = '';
      window.setTimeout(() => delete card.dataset.arrived, 900);
    }),
  );
}

function press(button: HTMLElement, run: () => void): void {
  button.addEventListener('mousedown', (event) => event.preventDefault());
  /*
   * A finger has to be stopped sooner than a mouse (Matt, on the phone: "I can't create a new issue on the board, as
   * soon as I open the board it closes again").
   *
   * A board shows its own lines instead of itself whenever the editor has the caret anywhere in its range, edges
   * included (`decorate`). A mouse is kept out by cancelling its `mousedown` above. A tap is not: the phone places a
   * caret from the touch itself, before any mouse event is sent, and it lands at the board's edge - so the board
   * turned back into its lines at the moment the + was pressed, and the field that + opens went with it. It worked
   * with a mouse on a desktop every time, which is why it looked like a phone problem and was.
   *
   * Cancelling the `touchstart` is what keeps a caret from being placed, and it also stops the browser sending the
   * click that would follow, so the button answers on `touchend` instead - only when the finger lifts on the button,
   * so a finger that slides off to scroll does nothing.
   */
  let tapped = 0;
  button.addEventListener(
    'touchstart',
    (event) => {
      event.preventDefault();
    },
    { passive: false },
  );
  button.addEventListener('touchend', (event) => {
    event.preventDefault();
    const touch = event.changedTouches[0];
    const box = button.getBoundingClientRect();
    if (touch && (touch.clientX < box.left || touch.clientX > box.right || touch.clientY < box.top || touch.clientY > box.bottom)) return;
    tapped = Date.now();
    run();
  });
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    // A browser that sends the click anyway after a cancelled touch would run it twice.
    if (Date.now() - tapped < 600) return;
    run();
  });
}

/** What a board looks like now, so the widget is rebuilt only when something on it changed. */
function faceOf(board: Drawn): string {
  return [
    board.columns.map((column) => `${column.name}:${column.cards.join(',')}`).join('|'),
    board.cards
      .map((card) => `${card.id}@${card.column}:${card.item ? `${card.item.done === null ? '-' : card.item.done ? 'x' : ' '}${card.item.text}` : 'gone'}`)
      .join('|'),
    // A height set, or taken off, redraws the board at it.
    `h${board.height ?? ''}`,
  ].join('||');
}

function decorate(state: EditorState, focused: boolean): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const board of boards(state)) {
    // The caret in the fence: the lines themselves, to edit. Elsewhere, and in a view with no caret, the board.
    const inside = focused && state.selection.ranges.some((range) => range.from <= board.to && range.to >= board.from);
    if (inside) continue;
    builder.add(board.from, board.to, Decoration.replace({ widget: new BoardWidget(board, faceOf(board)), block: true }));
  }
  return builder.finish();
}

const boardField = StateField.define<DecorationSet>({
  create: (state) => decorate(state, false),
  update(value, tr) {
    const focused = tr.state.field(focusField);
    return tr.docChanged || tr.selection || tr.startState.field(focusField) !== focused ? decorate(tr.state, focused) : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * The anchor on a line, and a pointer at one from the words (core/boards.ts).
 *
 * `^ship-page` at the end of an item is a name, not something to read: it is drawn small and faint, so the line
 * reads as its words. `[[#^ship-page]]` in the middle of a line is the other end of the same thing - a tap on it
 * goes to the item it names, wherever in the note that is.
 */
const anchorMark = Decoration.mark({ class: 'cm-itemAnchor' });
const refMark = Decoration.mark({ class: 'cm-itemRef' });
const goneMark = Decoration.mark({ class: 'cm-itemRef cm-itemRefGone' });

function anchors(state: EditorState): DecorationSet {
  const doc = state.doc.toString();
  const builder = new RangeSetBuilder<Decoration>();
  const named = new Set(itemsIn(doc).map((item) => item.id));
  for (let line = 1; line <= state.doc.lines; line += 1) {
    const at = state.doc.line(line);
    const marks: { from: number; to: number; mark: Decoration }[] = [];
    const item = itemOnLineAt(at.text);
    if (item) marks.push({ from: at.from + item.end - item.length, to: at.from + item.end, mark: anchorMark });
    for (const ref of refsIn(at.text, at.from)) marks.push({ from: ref.from, to: ref.to, mark: named.has(ref.id) ? refMark : goneMark });
    for (const mark of marks.sort((one, two) => one.from - two.from)) builder.add(mark.from, mark.to, mark.mark);
  }
  return builder.finish();
}

/** The `^anchor` that names the item on a line - last, or with an item's mark after it - and where it ends; or null. */
function itemOnLineAt(text: string): { length: number; end: number } | null {
  const found = /(?:^|\s)(\^[a-z0-9][a-z0-9_-]*)((?:\s+(?:\[[a-z][a-z0-9-]*\]\(https?:\/\/[^\s)]+\)|\[\d{1,4}\/\d{1,4}\]))*)\s*$/.exec(text);
  if (!found || !itemsIn(text).length) return null;
  const anchor = found[1] ?? '';
  const start = found.index + found[0].indexOf(anchor);
  return { length: anchor.length, end: start + anchor.length };
}

const anchorField = StateField.define<DecorationSet>({
  create: (state) => anchors(state),
  update: (value, tr) => (tr.docChanged ? anchors(tr.state) : value.map(tr.changes)),
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

/** A tap on `[[#^anchor]]`: the caret goes to the item it names. */
const refTaps = EditorView.domEventHandlers({
  mousedown(event, view) {
    const target = event.target as HTMLElement | null;
    if (!target?.classList.contains('cm-itemRef')) return false;
    const at = view.posAtDOM(target);
    const line = view.state.doc.lineAt(at);
    const ref = refsIn(line.text, line.from).find((found) => found.from <= at + 2 && found.to >= at);
    const item = ref ? itemAt(view.state.doc.toString(), ref.id) : null;
    if (!item) return false;
    event.preventDefault();
    goToLine(view, item.line);
    return true;
  },
});

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
          // The whole width the note scrolls in: the board starts where the page's indent does and ends at its edge.
          return { room: Math.max(160, view.scrollDOM.clientWidth || view.dom.clientWidth), bleed };
        },
        write: ({ room, bleed }, view) => {
          view.dom.style.setProperty('--cm-board-room', `${room}px`);
          view.dom.style.setProperty('--cm-board-bleed', `${bleed}px`);
        },
      });
    }
  },
);

const boardTheme = EditorView.baseTheme({
  '.cm-board': {
    display: 'flex',
    gap: '0.7em',
    // As wide as the note is, never as wide as its columns: the columns scroll inside it (`boardRoom`).
    inlineSize: 'var(--cm-board-room, 100%)',
    // A block widget sits outside the note's own indent, so the indent is put back as padding: the first column
    // lines up with the words, and a column scrolled along runs to the edge of the screen.
    paddingInline: 'var(--cm-board-bleed, 0px)',
    scrollPaddingInline: 'var(--cm-board-bleed, 0px)',
    overflowX: 'auto',
    // Sideways only. With the columns scrolling, the board is a scroller both ways, and a finger moving up it was
    // the board's to scroll wherever it overflowed by a pixel, not the note's.
    overflowY: 'hidden',
    overscrollBehaviorX: 'contain',
    // One column at a time on a phone: a swipe settles on a column rather than between two.
    scrollSnapType: 'x mandatory',
    paddingBlock: '0.1em 0.5em',
    scrollbarWidth: 'none',
    fontSize: `${BOARD_TYPE}em`,
    textIndent: '0',
  },
  '.cm-board[data-holding]': { scrollSnapType: 'none', cursor: 'grabbing' },
  '.cm-boardColumn': {
    flex: '0 0 auto',
    inlineSize: 'min(78vw, 16rem)',
    scrollSnapAlign: 'start',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.4em',
    padding: '0.5em 0.45em 0.2em',
    borderRadius: 'var(--glacier-radius-lg, 0.75rem)',
    background: 'color-mix(in oklch, currentColor 4%, transparent)',
  },
  '.cm-boardName': {
    display: 'flex',
    alignItems: 'center',
    gap: '0.45em',
    margin: '0',
    padding: '0 0.15em',
    minBlockSize: '1.9em',
    fontSize: '0.78em',
    fontWeight: '700',
    letterSpacing: '0.07em',
    textTransform: 'uppercase',
    color: 'var(--app-ink-3, var(--glacier-text-muted))',
  },
  '.cm-boardNameWords': { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  '.cm-boardCount': {
    flex: 'none',
    minInlineSize: '1.6em',
    padding: '0.05em 0.45em',
    borderRadius: '999px',
    background: 'color-mix(in oklch, currentColor 10%, transparent)',
    textAlign: 'center',
    letterSpacing: '0',
    fontWeight: '600',
  },
  '.cm-boardAdd': {
    flex: 'none',
    display: 'grid',
    placeItems: 'center',
    marginInlineStart: 'auto',
    inlineSize: '2em',
    blockSize: '2em',
    padding: '0',
    border: 'none',
    borderRadius: '999px',
    background: 'color-mix(in oklch, currentColor 8%, transparent)',
    color: 'var(--app-ink-2, inherit)',
    cursor: 'pointer',
  },
  /* The field a new card is typed into, under the column's name. */
  /*
   * The field a new card is typed into is drawn as the card it is about to be (Matt: "Add task input and button
   * dont match up"): the card's corners, ground and ring, an empty tick box where the card's box goes so the words
   * start where a card's do, and an Add whose corners sit inside the field's. The ring is a little stronger than a
   * card's, which is how the one being written is told from the rest.
   */
  '.cm-boardCompose': {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr auto',
    alignItems: 'center',
    columnGap: '0.55em',
    padding: '0.3em 0.3em 0.3em 0.65em',
    borderRadius: '0.7em',
    background: 'var(--app-paper, var(--glacier-bg))',
    boxShadow: 'inset 0 0 0 1.5px color-mix(in oklch, currentColor 30%, transparent), 0 1px 2px rgba(0, 0, 0, 0.12)',
  },
  '.cm-boardComposeTick': {
    inlineSize: '1.15em',
    blockSize: '1.15em',
    borderRadius: '0.32em',
    border: '1.5px solid color-mix(in oklch, var(--app-ink, var(--glacier-text)) 30%, transparent)',
  },
  '.cm-boardComposeField': {
    minInlineSize: '0',
    blockSize: '2.1em',
    padding: '0',
    border: 'none',
    background: 'none',
    color: 'inherit',
    font: 'inherit',
    lineHeight: '2.1em',
    outline: 'none',
  },
  '.cm-boardComposeField::placeholder': { color: 'var(--app-ink-3, var(--glacier-text-muted))' },
  '.cm-boardComposeAdd': {
    blockSize: '2.1em',
    padding: '0 0.85em',
    border: 'none',
    // The field's corner less its padding: the button's curve runs alongside the field's.
    borderRadius: 'calc(0.7em - 0.3em)',
    background: 'var(--app-ink, currentColor)',
    color: 'var(--app-paper, var(--glacier-bg))',
    // The field's own size, so its height and its corner are measured in the same em as the field's.
    font: 'inherit',
    fontWeight: '600',
    lineHeight: '1',
    cursor: 'pointer',
    transition: 'background-color 120ms ease, color 120ms ease',
  },
  // Nothing typed yet, nothing to add: the button waits, quiet, in the field's own ink.
  '.cm-boardComposeAdd:disabled': {
    background: 'color-mix(in oklch, currentColor 10%, transparent)',
    color: 'var(--app-ink-3, var(--glacier-text-muted))',
    cursor: 'default',
  },
  /*
   * Set by the line under the board: the lanes are that tall, cards or not (heightSplit), and one with more cards
   * scrolls inside itself. At either end of it the finger goes on to the note (no `overscroll-behavior`: a lane that
   * kept the scroll to itself stopped the note dead under a finger that landed on it).
   */
  '.cm-board[data-sized] .cm-boardStack': {
    blockSize: 'var(--cm-lane-height)',
    overflowY: 'auto',
    scrollbarWidth: 'none',
    paddingBlockEnd: '0.9em',
  },
  /* The same, for a board holding the height it was drawn at rather than one the fence set (`pin`). */
  '.cm-board[data-pinned]:not([data-sized]) .cm-boardStack': {
    blockSize: 'var(--cm-board-pin)',
    overflowY: 'auto',
    scrollbarWidth: 'none',
    paddingBlockEnd: '0.9em',
  },
  // More cards below than the lane shows: its foot fades, and goes to smoke where the app's wisp is on (laneFoot).
  // With smoke the length comes from the band's own lip (`--cm-lane-fade`, art/wispFoot.ts `WISP_FOOT_FADE`); the
  // em here is the plain fade, for a lane with no smoke to agree with.
  '.cm-boardStack[data-more]': {
    WebkitMaskImage: 'linear-gradient(to bottom, #000 calc(100% - var(--cm-lane-fade, 1.2em)), transparent)',
    maskImage: 'linear-gradient(to bottom, #000 calc(100% - var(--cm-lane-fade, 1.2em)), transparent)',
  },
  // Padding, not margin, above and below: the editor measures a block by its border box, and a margin - the board's
  // own at the top went straight through this box - put every line under the board that far from where the editor
  // thought it was. The room above is the board's 0.4em, in the note's type.
  '.cm-boardWrap': { paddingBlock: `calc(0.4em * ${BOARD_TYPE}) 0.5em` },
  /*
   * Glacier's split-pane divider (@glacier/react ResizableSplitPane): a hairline in the subtle border, a grip pill,
   * the accent when it is being moved or has the focus. Its touch reaches above and below the hairline.
   */
  '.cm-boardSplit': {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    blockSize: 'var(--glacier-hairline, 1px)',
    marginInline: 'var(--cm-board-bleed, 0px)',
    marginBlock: '0.3em 1em',
    background: 'var(--glacier-border-subtle, color-mix(in oklch, currentColor 14%, transparent))',
    cursor: 'row-resize',
    touchAction: 'none',
    transition: 'background-color var(--glacier-duration-fast, 120ms) var(--glacier-ease-out, ease-out)',
  },
  // A finger's width of touch: down to the next line, and up into the board's own padding but not onto its cards.
  '.cm-boardSplit::before': { content: '""', position: 'absolute', insetInline: '0', insetBlock: '-0.7em -1em' },
  '.cm-boardSplit:focus-visible, .cm-boardSplit[data-dragging]': {
    outline: 'none',
    background: 'var(--glacier-accent-solid, currentColor)',
  },
  // The grip, at the middle of the line and always there, since a phone has no hover: a small pill, white while it is
  // held or has the focus.
  '.cm-boardGrip': {
    position: 'relative',
    zIndex: '1',
    inlineSize: 'var(--glacier-space-6, 1.5rem)',
    blockSize: '6px',
    borderRadius: 'var(--glacier-radius-full, 999px)',
    background: 'color-mix(in oklch, currentColor 45%, transparent)',
    transition: 'background-color var(--glacier-duration-fast, 120ms) var(--glacier-ease-out, ease-out)',
  },
  '.cm-boardSplit:hover .cm-boardGrip': { background: 'color-mix(in oklch, currentColor 70%, transparent)' },
  '.cm-boardSplit:focus-visible .cm-boardGrip, .cm-boardSplit[data-dragging] .cm-boardGrip': { background: '#fff' },
  /*
   * A lane. Left to itself it shows every card and never scrolls: a note is scrolled past a board in one sweep (Matt:
   * "scrolling past boards is glitchy and stops scroll momentum"), where a lane with a cap of its own took the finger
   * and kept it. It runs to the foot of its column, which is as tall as the board's tallest, so an empty lane has a
   * middle.
   */
  '.cm-boardStack': {
    display: 'flex',
    flexDirection: 'column',
    flex: '1 1 auto',
    gap: '0.4em',
    minBlockSize: '2.5em',
    paddingBlockEnd: `${LANE_FOOT}em`,
  },
  /*
   * A card is a small grid (Matt: "the cards themselves can have the text go full width and we can move the notion icon
   * to the right more"): the tick and the words on the first row, the words taking every bit of width the card has,
   * and under them a footer that sits right - the plugin's mark, then the two arrows.
   */
  '.cm-boardCard': {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr auto auto',
    gridTemplateAreas: '"tick words words words" ". . linked moves"',
    alignItems: 'start',
    columnGap: '0.55em',
    rowGap: '0.15em',
    flex: 'none',
    minBlockSize: '2.6em',
    padding: '0.6em 0.4em 0.3em 0.65em',
    borderRadius: '0.7em',
    background: 'var(--app-paper, var(--glacier-bg))',
    boxShadow: 'inset 0 0 0 1px color-mix(in oklch, currentColor 9%, transparent), 0 1px 2px rgba(0, 0, 0, 0.12)',
    // The finger scrolls until the card is picked up, and then the drag takes over.
    touchAction: 'pan-x pan-y',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
    transition: 'opacity 120ms ease',
  },
  '.cm-boardCard[data-done]': { opacity: '0.62' },
  /* The card where it would land: its own shape, emptied out, so the column opens exactly the space it takes. */
  '.cm-boardCard[data-lifted]': {
    background: 'color-mix(in oklch, currentColor 4%, transparent)',
    borderStyle: 'dashed',
    overflow: 'hidden',
  },
  '.cm-boardCard[data-lifted] > *': { visibility: 'hidden' },
  '.cm-boardCard[data-done] .cm-boardWords': { textDecoration: 'line-through', color: 'var(--app-ink-3, var(--glacier-text-muted))' },
  '.cm-boardCard[data-gone] .cm-boardWords': { fontStyle: 'italic', color: 'var(--app-ink-3, var(--glacier-text-muted))' },
  '.cm-boardCard[data-empty] .cm-boardWords': { fontStyle: 'italic', color: 'var(--app-ink-3, var(--glacier-text-muted))' },
  /* The card in the air, under the finger: the same card, lifted off the page. */
  '.cm-boardGhost': {
    position: 'fixed',
    insetBlockStart: '0',
    insetInlineStart: '0',
    zIndex: '40',
    margin: '0',
    pointerEvents: 'none',
    boxShadow: '0 10px 24px rgba(0, 0, 0, 0.28)',
    transform: 'translate(0, 0)',
    opacity: '0.96',
  },
  '.cm-boardEmpty': {
    display: 'none',
    margin: '0',
    padding: '0.8em 0.6em',
    borderRadius: 'var(--glacier-radius-lg, 0.75rem)',
    border: '1px dashed transparent',
    textAlign: 'center',
    fontSize: '0.9em',
    color: 'var(--app-ink-3, var(--glacier-text-muted))',
  },
  // At rest, only an empty column shows it: the picture and the words, no outline.
  // It fills its lane, and the picture and words sit in the middle of it (Matt: "vertically center the icons in the
  // swimlanes"): a lane beside a full one is as tall as that one, and a board with a set height has tall lanes.
  // It reaches into the lane's own space at the foot, so the middle is the whole lane's: its type is 0.9 of the lane's,
  // so the lane's room is this element's room over 0.9.
  '.cm-boardEmpty[data-none]': {
    display: 'grid',
    flex: '1 1 auto',
    alignContent: 'center',
    paddingBlock: '1.1em',
    marginBlockEnd: `calc(${-LANE_FOOT}em / 0.9)`,
  },
  '.cm-board[data-sized] .cm-boardEmpty[data-none], .cm-board[data-pinned] .cm-boardEmpty[data-none]': { marginBlockEnd: 'calc(-0.9em / 0.9)' },
  '.cm-boardEmptyRest': { display: 'grid', justifyItems: 'center', gap: '0.45em' },
  '.cm-boardEmptyIcon': { opacity: '0.55' },
  '.cm-boardEmptyDrop': { display: 'none' },
  // A card held: every column is a target, outlined, and says so instead.
  '.cm-board[data-holding] .cm-boardEmpty': {
    display: 'block',
    paddingBlock: '0.8em',
    borderColor: 'var(--app-rule, var(--glacier-border-subtle))',
  },
  '.cm-board[data-holding] .cm-boardEmptyRest': { display: 'none' },
  '.cm-board[data-holding] .cm-boardEmptyDrop': { display: 'block' },
  '.cm-boardStack[data-over] .cm-boardEmpty': { borderStyle: 'solid' },
  // Sized from the card's own text rather than a button's default font, and set on the first line's centre, so every
  // box sits level with the words beside it (Matt: "the checkboxes also dont look like they line up nice").
  '.cm-boardTick': {
    gridArea: 'tick',
    position: 'relative',
    display: 'grid',
    placeItems: 'center',
    fontSize: 'inherit',
    lineHeight: '1',
    inlineSize: '1.15em',
    blockSize: '1.15em',
    marginBlockStart: 'calc((1.35em - 1.15em) / 2)',
    padding: '0',
    borderRadius: '0.32em',
    // The box's edge is named in ink, not `currentColor`: the tick's own colour is paper, for the check drawn on ink.
    border: '1.5px solid color-mix(in oklch, var(--app-ink, var(--glacier-text)) 45%, transparent)',
    background: 'none',
    color: 'var(--app-paper, var(--glacier-bg))',
    cursor: 'pointer',
  },
  '.cm-boardTick svg': { visibility: 'hidden' },
  // The box is small; the place to tap it is not. An invisible margin around it takes a finger that lands a little off,
  // which otherwise hit the words beside it and went to the line.
  '.cm-boardTick::before': { content: '""', position: 'absolute', inset: '-0.6em -0.45em -0.6em -0.6em' },
  // A card that has just arrived in its lane, lit for a moment so the eye finds it.
  '.cm-boardCard[data-arrived]': {
    boxShadow: 'inset 0 0 0 1.5px color-mix(in oklch, var(--app-ink, currentColor) 55%, transparent), 0 1px 2px rgba(0, 0, 0, 0.12)',
  },
  '.cm-boardCard[data-done] .cm-boardTick': {
    background: 'var(--app-ink, currentColor)',
    borderColor: 'var(--app-ink, currentColor)',
  },
  '.cm-boardCard[data-done] .cm-boardTick svg': { visibility: 'visible' },
  '.cm-boardTick:disabled': { opacity: '0.4', cursor: 'default' },
  /* An item with no box: a bullet, kept so every card's words start in the same place. */
  '.cm-boardDot': {
    gridArea: 'tick',
    justifySelf: 'center',
    flex: 'none',
    inlineSize: '0.4em',
    blockSize: '0.4em',
    marginBlockStart: '0.55em',
    marginInline: '0.45em',
    borderRadius: '50%',
    background: 'var(--app-ink-3, currentColor)',
  },
  '.cm-boardWords': {
    gridArea: 'words',
    minInlineSize: '0',
    // Three lines at most: one long item must not take the whole board. The words are whole in the note below.
    display: '-webkit-box',
    WebkitLineClamp: '3',
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
    padding: '0',
    border: 'none',
    background: 'none',
    font: 'inherit',
    lineHeight: '1.35',
    textAlign: 'start',
    color: 'inherit',
    cursor: 'pointer',
  },
  // The plugin a card's item is linked to, as its mark: quiet, beside the words, never read as one of them.
  '.cm-boardLinked': {
    gridArea: 'linked',
    alignSelf: 'center',
    display: 'grid',
    placeItems: 'center',
    color: 'var(--app-ink-3, var(--glacier-text-muted))',
    opacity: '0.8',
  },
  '.cm-boardMoves': { gridArea: 'moves', display: 'flex', gap: '0', marginInlineEnd: '-0.1em' },
  '.cm-boardMove': {
    display: 'grid',
    placeItems: 'center',
    inlineSize: '1.7em',
    blockSize: '1.7em',
    padding: '0',
    border: 'none',
    borderRadius: '999px',
    background: 'none',
    color: 'var(--app-ink-3, var(--glacier-text-muted))',
    opacity: '0.7',
    cursor: 'pointer',
  },
  '.cm-boardMove:disabled': { opacity: '0.25', cursor: 'default' },
  /* The card's menu button, the same size and weight as the chevrons beside it. */
  '.cm-boardMore': {
    display: 'grid',
    placeItems: 'center',
    inlineSize: '1.7em',
    blockSize: '1.7em',
    padding: '0',
    border: 'none',
    borderRadius: '999px',
    background: 'none',
    color: 'var(--app-ink-3, var(--glacier-text-muted))',
    opacity: '0.7',
    cursor: 'pointer',
  },
  /*
   * The card's menu: in the lane, right under its card, the way the + field sits at the top of a column. A panel of
   * the board's own ground with a hairline, and rows a thumb can hit.
   */
  '.cm-boardMenu': {
    display: 'grid',
    flex: 'none',
    gap: '1px',
    margin: '0.1em 0 0.2em',
    padding: '0.25em',
    borderRadius: '0.7em',
    background: 'var(--app-paper, var(--glacier-bg))',
    boxShadow: 'inset 0 0 0 1px color-mix(in oklch, currentColor 14%, transparent), 0 2px 6px rgba(0, 0, 0, 0.18)',
  },
  '.cm-boardMenuRow': {
    display: 'flex',
    alignItems: 'center',
    gap: '0.55em',
    minBlockSize: '2.4em',
    padding: '0 0.55em',
    border: 'none',
    borderRadius: '0.5em',
    background: 'none',
    color: 'var(--app-ink, currentColor)',
    font: 'inherit',
    fontSize: '0.95em',
    textAlign: 'start',
    cursor: 'pointer',
  },
  '.cm-boardMenuRow:hover': { background: 'color-mix(in oklch, currentColor 7%, transparent)' },
  '.cm-boardMenuRow svg': { flex: 'none', opacity: '0.75' },
  /* The anchor on the line, and a pointer at one from the words. */
  '.cm-itemAnchor': { fontSize: '0.82em', opacity: '0.45' },
  '.cm-itemRef': {
    textDecoration: 'underline',
    textUnderlineOffset: '0.2em',
    textDecorationThickness: '0.06em',
    textDecorationColor: 'color-mix(in oklch, currentColor 45%, transparent)',
    cursor: 'pointer',
  },
  '.cm-itemRefGone': { opacity: '0.55', textDecorationStyle: 'dotted' },
});

/** Boards drawn in a note, the fence still there to edit. */
export function drawnBoards(actions?: CardActions): Extension {
  return [
    focusField,
    boardField,
    anchorField,
    refTaps,
    boardRoom,
    boardTheme,
    ...(actions ? [cardActions.of(actions)] : []),
    EditorView.focusChangeEffect.of((_state, focusing) => setFocus.of(focusing)),
  ];
}
