import { similarity } from '../capture/route.ts';

/**
 * Boards in markdown: the whole syntax, read and written here and nowhere else (docs/BOARDS.md).
 *
 * Matt: "define and create a markdown standard we use to create kanban boards and task management boards entirely
 * within markdown, linking the tasks in the board to a task on the page", and later "come up with a generic way to
 * link list items to the board". Two pieces of ordinary markdown, and one of them is the link:
 *
 *   - [ ] Ship the pricing page ^ship-page      any list item may end with an anchor: the block id other tools write
 *   - Ask Sam about the copy ^ask-sam           the same way. A bullet, a number or a to-do, all the same.
 *
 *   ```board                                     a fence whose lines are the columns, each naming anchors
 *   To do: ship-page, ask-sam
 *   Done: pick-date
 *   ```
 *
 * The anchor is the generic part. It names an item, and anything that wants that item points at the anchor: the
 * board fence is only the first thing to do it, and `[[#^ask-sam]]` in any line is the same pointer written in
 * prose. Nothing is stored beside the note, so a board is readable as words wherever the note is opened, and Glyph
 * draws the columns with the items as cards (editor/boards.ts). A card IS its item: the same tick box, the same
 * words, and tapping it goes to the line.
 */

export interface BoardColumn {
  name: string;
  /** The anchors of the cards in it, in the order they sit. */
  cards: string[];
}

export interface Item {
  /** The anchor that names it. */
  id: string;
  /** The words, without the list marker, the tick box or the anchor. */
  text: string;
  /** Ticked, unticked, or null for an item with no box at all: a bullet or a numbered step. */
  done: boolean | null;
  /** Which line of the note it is on, counting from 1. */
  line: number;
}

/** What opens a list item: its marker, and the tick box a to-do has. */
const LEAD = /^(\s*(?:[-*+]|\d+[.)])\s+)(\[([ xX])\]\s?)?/;
/**
 * The anchor at the end of an item: a caret with whitespace before it (or nothing before it at all, on an item whose
 * words have not been written yet) and the end of the line after it. That is what leaves `E = mc^2^` and `foo ^2^`
 * the superscripts they are: a closing caret means the line does not end there.
 *
 * The things allowed after it are an item's mark (core/itemLinks.ts, `[notion](…)`) and counters (`[3/8]`,
 * editor/counters.ts), which a person typing at the end of the line puts there. The anchor goes last, but a
 * mark used to be added after it when an item was sent to Notion, and those lines must still be found: the card
 * showed its anchor and nothing else (Matt: "the last two items show up weird on the board as only their label no
 * title"). The marks stay with the item's words.
 */
const TAIL = /(?:^|\s)\^([a-z0-9][a-z0-9_-]*)((?:\s+(?:\[[a-z][a-z0-9-]*\]\(https?:\/\/[^\s)]+\)|\[\d{1,4}\/\d{1,4}\]))*)\s*$/;
/** A choice's box after a bullet (editor/choices.ts): `- ( ) Pick A`. A choice is picked, not done: it has no tick. */
const CHOICE = /^\(([ xX])\) /;
/**
 * The bookmark (editor/bookmarkLine.ts): `§§` where the reader left off, after an item's words and before its mark,
 * counters and anchor. It is a place in the note, not something the item says, so no card, title or anchor has it.
 */
const BOOKMARK = /\s*§§(?=\s|$)/g;

/** A list item pulled apart: what opens it, whether it has a box, its words, and the anchor naming it. */
interface Parsed {
  lead: string;
  done: boolean | null;
  text: string;
  id: string | null;
}

function parse(line: string): Parsed | null {
  const lead = LEAD.exec(line);
  if (!lead) return null;
  const box = lead[3];
  let rest = line.slice(lead[0].length);
  // A choice's box is not part of what the item says, and not a tick either: a bullet's words start after it.
  if (box === undefined && /[-*+]\s+$/.test(lead[1] ?? '')) rest = rest.replace(CHOICE, '');
  const tail = TAIL.exec(rest);
  return {
    lead: lead[0],
    done: box === undefined ? null : box !== ' ',
    text: (tail ? `${rest.slice(0, tail.index)}${tail[2] ?? ''}` : rest).replace(BOOKMARK, '').trim(),
    id: tail?.[1] ?? null,
  };
}

/** An anchor name: lower case, the shape a person can type and read. */
export const ANCHOR = /^[a-z0-9][a-z0-9_-]*$/;
/**
 * The fence that opens a board, and what follows the word: `board`, or `board height=18`. What follows is the
 * board's settings as `name=value` words, which any other renderer takes as part of the block's info string.
 */
const OPEN = /^\s*(`{3,}|~{3,})\s*board(?:\s+([^\n]*?))?\s*$/i;
/** `height=18`: how tall a board's lanes are, in the lanes' own ems (Matt: "make board height configurable"). */
const HEIGHT = /(?:^|\s)height=(\d+(?:\.\d+)?)(?:em)?(?=\s|$)/i;
/** The shortest and tallest a board's lanes can be set, in ems: a card and a half, and a long screen. */
export const BOARD_HEIGHT = { min: 5, max: 60 };
/** `[[#^ask-sam]]`: an item in this note, pointed at from anywhere in it. */
const REF = /\[\[#\^([a-z0-9][a-z0-9_-]*)\]\]/g;

/** The columns a board fence's body lays out. A line with no colon is a column with no cards. */
export function readBoard(body: string, known: ReadonlySet<string> = new Set()): BoardColumn[] {
  const columns: BoardColumn[] = [];
  // An anchor names one item, and a card is one card: an id is read into the first lane that has it, and a second
  // mention of it, in that lane or another, is dropped. Written by hand into two lanes, it used to be drawn twice in
  // the first of them, and the lane a person had put it in showed nothing at all.
  const taken = new Set<string>();
  for (const line of body.split('\n')) {
    const text = line.trim();
    if (!text) continue;
    const at = text.indexOf(':');
    const name = (at >= 0 ? text.slice(0, at) : text).trim();
    if (!name) continue;
    const cards: string[] = [];
    for (const said of (at >= 0 ? text.slice(at + 1) : '').split(',')) {
      const id = anchorRead(said, known);
      if (!id || taken.has(id)) continue;
      taken.add(id);
      cards.push(id);
    }
    const already = columns.find((column) => column.name.toLowerCase() === name.toLowerCase());
    if (already) already.cards.push(...cards);
    else columns.push({ name, cards });
  }
  return columns;
}

/**
 * An id in a fence read as the anchor it means: the caret a person may write in front of it taken off, and then, for
 * anything that is not an anchor already, upper case down and everything an anchor cannot hold turned into the hyphen
 * it would have been. `Fix Login` is `fix-login`.
 *
 * That second reading is only taken when the note really has an item with that anchor (`known`), so a lane written or
 * dictated by hand still finds its cards, while words after a colon that name nothing are left alone rather than
 * drawn as a card of their own. Read loosely, written back the one way (`writeBoard`), as an item's own anchor is
 * (docs/BOARDS.md). Empty for an id this board cannot use.
 */
function anchorRead(said: string, known: ReadonlySet<string>): string {
  const plain = said.trim().replace(/^\^/, '');
  if (ANCHOR.test(plain)) return plain;
  const id = plain
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');
  return ANCHOR.test(id) && known.has(id) ? id : '';
}

/** The columns written back as a fence's body, exactly as a person would type them. */
export function writeBoard(columns: readonly BoardColumn[]): string {
  return columns.map((column) => `${column.name}: ${column.cards.join(', ')}`.replace(/:\s+$/, ':')).join('\n');
}

/** Every anchored item in the note, the first of a repeated anchor winning. */
export function itemsIn(doc: string): Item[] {
  const items: Item[] = [];
  const seen = new Set<string>();
  doc.split('\n').forEach((line, index) => {
    const item = itemOnLine(line);
    if (!item || seen.has(item.id)) return;
    seen.add(item.id);
    items.push({ ...item, line: index + 1 });
  });
  return items;
}

/** The item a line is, if it is a list item with an anchor. */
export function itemOnLine(line: string): Item | null {
  const found = parse(line);
  return found?.id ? { id: found.id, text: found.text, done: found.done, line: 0 } : null;
}

/** Whether a line is a list item at all: what can be given an anchor and put on a board. */
export function isItemLine(line: string): boolean {
  const found = parse(line);
  return Boolean(found && (found.text || found.id));
}

/** The words of a list item, box and anchor off, or null where the line is not one. */
export function itemWords(line: string): string | null {
  return parse(line)?.text ?? null;
}

/**
 * That line with its box ticked or cleared: the one character between the brackets, and nothing else about the line
 * touched. An item with no box is left alone, since there is nothing to tick and writing a box is the person's to do.
 */
export function setItemDone(line: string, done: boolean): string {
  const found = LEAD.exec(line);
  if (!found?.[2]) return line;
  const at = found[0].indexOf('[');
  return `${line.slice(0, at + 1)}${done ? 'x' : ' '}${line.slice(at + 2)}`;
}

/** That line given an anchor, or left as it is when it has one already. */
export function withAnchor(line: string, id: string): string {
  return itemOnLine(line) ? line : `${line.replace(/\s+$/, '')} ^${id}`;
}

/** Which column holds `id`, or -1. */
export function columnOf(columns: readonly BoardColumn[], id: string): number {
  return columns.findIndex((column) => column.cards.includes(id));
}

/** The column a board calls Done, or -1: the one a ticked item belongs in. */
export function doneColumn(columns: readonly BoardColumn[]): number {
  return columns.findIndex((column) => /^done\b|\bdone$/i.test(column.name.trim()));
}

/** A copy nothing shares with the columns given: every write here answers new columns, never the ones passed in. */
function copy(columns: readonly BoardColumn[]): BoardColumn[] {
  return columns.map((column) => ({ ...column, cards: [...column.cards] }));
}

/** The columns with `id` moved `by` columns along, as far as there are columns to move it to. */
export function moveCard(columns: readonly BoardColumn[], id: string, by: number): BoardColumn[] {
  const from = columnOf(columns, id);
  if (from < 0) return copy(columns);
  const to = Math.min(columns.length - 1, Math.max(0, from + by));
  // Already at the end it was pushed against: nothing moves, and the card stays where it is.
  if (to === from) return copy(columns);
  return putCard(columns, id, to);
}

/** The columns with `id` at the end of `to`, wherever it was. */
export function putCard(columns: readonly BoardColumn[], id: string, to: number): BoardColumn[] {
  return putCardAt(columns, id, to, Number.MAX_SAFE_INTEGER);
}

/**
 * The columns with `id` in `to` at `index`, wherever it was: what a card dropped between two others becomes
 * (Matt: "add a way to tap and drag to re organize items in lanes").
 *
 * The index counts the column as it will be, the card taken out of wherever it was first, so dragging a card down
 * its own column lands it where the gap was shown and not one place short.
 */
export function putCardAt(columns: readonly BoardColumn[], id: string, to: number, index: number): BoardColumn[] {
  if (to < 0 || to >= columns.length) return copy(columns);
  const without = columns.map((column) => column.cards.filter((card) => card !== id));
  const target = without[to] ?? [];
  const at = Math.max(0, Math.min(target.length, index));
  target.splice(at, 0, id);
  return columns.map((column, i) => ({ ...column, cards: i === to ? target : (without[i] ?? []) }));
}

/**
 * The ticks and the lanes, brought back together.
 *
 * A column called Done means done, so an item ticked anywhere is DRAWN in the Done lane whatever its fence says
 * (`columnFor`). Ticking a box in the note's list, or a task going Done in Notion (editor/doneSync.ts), never moved
 * the id, so a note could drift until a lane held seventeen ids and drew two of them (Matt, of his Task Management
 * note: "items are in the Doing swimlane in the board code" while the lane drew nothing). The board was right and the
 * markdown was stale, which is the wrong way round: the markdown is the note.
 *
 * `settleColumns` gives the columns as the board draws them: every ticked item's card in Done. `moved` is a card the
 * person has just moved by hand, which is left exactly where they put it.
 */
export function settleColumns(columns: readonly BoardColumn[], items: readonly Item[], moved?: string): BoardColumn[] {
  const done = doneColumn(columns);
  if (done < 0) return copy(columns);
  let next = copy(columns);
  for (const item of items) {
    if (item.id === moved || item.done !== true) continue;
    const at = columnOf(next, item.id);
    if (at >= 0 && at !== done) next = putCard(next, item.id, done);
  }
  return next;
}

/** A fence to be written again: the lines it is on, counting from 1, and its new body. */
export interface FenceEdit {
  /** The line the opening fence is on. */
  from: number;
  /** The line the closing fence is on. */
  to: number;
  body: string;
}

/**
 * Every fence in the note that has something to say again, given the boxes about to change: `ticks` is each item's
 * line and the state its box is being set to. One box tapped in the list, or a batch of them arriving from Notion,
 * are the same thing here.
 *
 * A box ticked puts its card in Done; a box cleared takes its card out of Done and back to the first lane, as
 * unticking a card on the board does. Any other card whose item is already ticked is settled at the same time, so a
 * note that has drifted comes right with the next change rather than staying wrong. Nothing else about the fence
 * moves, and a board with no Done lane leaves its ticks alone.
 */
export function settleBoards(doc: string, ticks: ReadonlyMap<number, boolean> = new Map()): FenceEdit[] {
  const items = itemsIn(doc).map((item) => (ticks.has(item.line) ? { ...item, done: ticks.get(item.line) ?? item.done } : item));
  const cleared = [...ticks].filter(([, on]) => !on).map(([line]) => items.find((item) => item.line === line));
  const edits: FenceEdit[] = [];
  for (const board of boardsIn(doc)) {
    if (board.to <= board.from + 1) continue;
    let columns = settleColumns(board.columns, items);
    const done = doneColumn(columns);
    for (const item of cleared) {
      if (item && done >= 0 && columnOf(columns, item.id) === done) columns = putCard(columns, item.id, 0);
    }
    const body = writeBoard(columns);
    if (body !== writeBoard(board.columns)) edits.push({ from: board.from, to: board.to, body });
  }
  return edits;
}

/** A tick that had to write more than a fence: the lines that gained an anchor so they could join a board. */
export interface SettledTicks {
  fences: FenceEdit[];
  /** The item's line, counting from 1, and the anchor to put at the end of it. */
  lines: { number: number; anchor: string }[];
}

/**
 * Everything a tick changes, when the box is turned somewhere other than the board.
 *
 * `settleBoards` moves cards that exist. This adds the one thing it cannot: an item that is **not** a card, ticked in
 * a list whose other items are on a board, joins that board and lands in Done (found in Matt's own note -
 * three ticked items with no anchor, so ticking them moved nothing, while the other 57 worked). From where a person
 * sits, two identical-looking to-dos behaved differently and nothing said why.
 *
 * Scoped to the item's own list on purpose: docs/BOARDS.md says a board never has to hold every item in the note, so
 * a to-do in some unrelated list further down must not leap onto the board because it was ticked. It joins the board
 * its neighbours are already on, and nothing else does.
 */
export function settleTicks(doc: string, ticks: ReadonlyMap<number, boolean>): SettledTicks {
  const lines = doc.split('\n');
  const joined: { number: number; anchor: string }[] = [];
  for (const [line, on] of ticks) {
    if (!on) continue;
    const working = lines.join('\n');
    const text = lines[line - 1];
    if (text === undefined || !isItemLine(text)) continue;
    const item = itemOnLine(text);
    // Already a card: moving it is `settleBoards`' job, not this one.
    if (item && boardsIn(working).some((board) => columnOf(board.columns, item.id) >= 0)) continue;
    if (!listOnBoard(working, line)) continue;
    const added = addToBoard(working, line);
    if (!added) continue;
    if (added.line) {
      lines[added.line.number - 1] = added.line.text;
      joined.push({ number: added.line.number, anchor: added.id });
    }
    // The fence keeps its number of lines, so every line number above stays good for the next tick in the batch.
    lines.splice(added.fence.from, added.fence.to - added.fence.from - 1, ...added.fence.body.split('\n'));
  }
  // Then the ordinary settling - ticked cards into Done, cleared ones back out - over the note as it now stands.
  for (const edit of settleBoards(lines.join('\n'), ticks)) {
    lines.splice(edit.from, edit.to - edit.from - 1, ...edit.body.split('\n'));
  }
  const now = boardsIn(lines.join('\n'));
  const fences: FenceEdit[] = [];
  boardsIn(doc).forEach((board, at) => {
    const body = now[at]?.body ?? board.body;
    if (board.to > board.from + 1 && body !== board.body) fences.push({ from: board.from, to: board.to, body });
  });
  return { fences, lines: joined };
}

/** Whether the list `line` stands in has any item that is already a card on a board. */
function listOnBoard(doc: string, line: number): boolean {
  const around = listAround(doc, line);
  if (!around) return false;
  const boards = boardsIn(doc).filter((board) => board.to > board.from);
  if (!boards.length) return false;
  return itemsIn(doc).some(
    (item) => item.line !== line && item.line >= around.from && item.line <= around.to && boards.some((board) => columnOf(board.columns, item.id) >= 0),
  );
}

/**
 * The columns without `id`: the card taken off the board, its item left exactly where it is in the note (Matt: "Add
 * context menu to board items for moving lanes and adding to notion etc."). A board never has to hold every item.
 */
export function withoutCard(columns: readonly BoardColumn[], id: string): BoardColumn[] {
  return columns.map((column) => ({ ...column, cards: column.cards.filter((card) => card !== id) }));
}

export interface Board {
  /** The line the opening fence is on, counting from 1. */
  from: number;
  /** The line the closing fence is on; the same as `from` when the fence never closes. */
  to: number;
  /** The fence's body: the lines between. */
  body: string;
  columns: BoardColumn[];
  /** How tall the lanes are set, in ems, or null for the board's own height. */
  height: number | null;
}

/** The lanes' height a fence's settings name, held between the shortest and tallest a board can be; or null. */
function heightOf(settings: string): number | null {
  const found = HEIGHT.exec(settings);
  const value = found ? Number(found[1]) : NaN;
  return Number.isFinite(value) ? clampHeight(value) : null;
}

/** A height kept within what a board can be, to the half em. */
export function clampHeight(ems: number): number {
  return Math.round(Math.min(BOARD_HEIGHT.max, Math.max(BOARD_HEIGHT.min, ems)) * 2) / 2;
}

/**
 * A board's opening fence with its lanes' height set, or taken off with null: the rest of the line - the fence, the
 * word, any other settings - as it was. A line that does not open a board comes back as it is.
 */
export function withBoardHeight(openLine: string, height: number | null): string {
  const open = OPEN.exec(openLine);
  if (!open) return openLine;
  const start = /^\s*(?:`{3,}|~{3,})\s*board/i.exec(openLine)?.[0] ?? `${open[1]}board`;
  const rest = (open[2] ?? '').replace(HEIGHT, ' ').replace(/\s+/g, ' ').trim();
  const settings = [height === null ? '' : `height=${clampHeight(height)}`, rest].filter(Boolean).join(' ');
  return `${start}${settings ? ` ${settings}` : ''}`;
}

/** Every board in the note, in order. */
export function boardsIn(doc: string): Board[] {
  const lines = doc.split('\n');
  const boards: Board[] = [];
  // The note's own anchors, read once and only when a board is found: what a lane's ids are read against.
  let anchors: Set<string> | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const open = OPEN.exec(lines[i] ?? '');
    if (!open) continue;
    const fence = open[1] ?? '```';
    let end = i;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (new RegExp(`^\\s*${fence[0] === '~' ? '~' : '`'}{${fence.length},}\\s*$`).test(lines[j] ?? '')) {
        end = j;
        break;
      }
    }
    const body = end > i ? lines.slice(i + 1, end).join('\n') : '';
    boards.push({ from: i + 1, to: end + 1, body, columns: readBoard(body, anchors ?? (anchors = new Set(itemsIn(doc).map((item) => item.id)))), height: heightOf(open[2] ?? '') });
    i = end;
  }
  return boards;
}

/** A board's cards, each with the item it names: the ones whose item is gone are answered too, so nothing vanishes. */
export interface Card {
  id: string;
  column: number;
  item: Item | null;
}

export function cardsOf(
  columns: readonly BoardColumn[],
  items: readonly Item[],
  named: ReadonlySet<string> = new Set(columns.flatMap((column) => column.cards)),
): Card[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  // Items no board names: where a card's anchor matches no item, one of these may be the item it meant.
  const loose = items.filter((item) => !named.has(item.id));
  return columns.flatMap((column, index) => column.cards.map((id) => ({ id, column: index, item: byId.get(id) ?? slipOf(id, loose) })));
}

/**
 * The item a card meant when its anchor matches none: the one item, named by no board, whose anchor is a slip of
 * the card's (Matt: "the second item got glitched out on the board" - the fence said `blur-bottom-swimlanes`, the
 * line `^blur-bottom-swimlaness`). Only a single such item counts, and only for an anchor long enough to be sure.
 */
function slipOf(id: string, loose: readonly Item[]): Item | null {
  if (id.length < 4) return null;
  const near = loose.filter((item) => nearAnchor(id, item.id));
  return near.length === 1 ? (near[0] ?? null) : null;
}

/** Two anchors a slip apart: one letter added, dropped or changed, or up to two letters more or fewer at the end. */
export function nearAnchor(one: string, two: string): boolean {
  if (one === two) return false;
  const [short, long] = one.length <= two.length ? [one, two] : [two, one];
  const more = long.length - short.length;
  if (more <= 2 && long.startsWith(short)) return true;
  if (more > 1) return false;
  let at = 0;
  while (at < short.length && short[at] === long[at]) at += 1;
  return more === 0 ? short.slice(at + 1) === long.slice(at + 1) : short.slice(at) === long.slice(at + 1);
}

/** What may end an item's line after its words: its anchor, an item's mark, a counter, the bookmark. */
const LINE_TAIL = /\s+(?:\^[a-z0-9][a-z0-9_-]*|\[[a-z][a-z0-9-]*\]\(https?:\/\/[^\s)]+\)|\[\d{1,4}\/\d{1,4}\]|§§)$/;

/**
 * Where a list item's words end in its line: before its bookmark, mark, counters and anchor. The caret goes here when a card
 * or a pointer takes the note to the item, so what is typed next goes on the words and not into the anchor that
 * names them. A line that is not an item ends where its text does.
 */
export function wordsEnd(line: string): number {
  let rest = line.replace(/\s+$/, '');
  const lead = LEAD.exec(line);
  if (!lead) return rest.length;
  for (let found = LINE_TAIL.exec(rest); found; found = LINE_TAIL.exec(rest)) rest = rest.slice(0, found.index);
  return Math.max(lead[0].length, rest.length);
}

/** An item's own column: the Done one when it is ticked, else where the board has it. */
export function columnFor(columns: readonly BoardColumn[], item: Item): number {
  const done = doneColumn(columns);
  if (item.done === true && done >= 0) return done;
  return columnOf(columns, item.id);
}

/**
 * Words that say nothing about which item this is: an anchor made of "add-ability-to" names two different items
 * the same way, and is the name someone then has to point at.
 */
const FILLER = new Set(
  'a an the to of in on at by for from with into onto and or but nor so is are was were be been being it its this that these those as up out'.split(
    ' ',
  ),
);

/**
 * An anchor made from an item's words: its first three words that carry meaning, lower case, and not one the note
 * already uses. "Add ability to auto-tag notes" is `add-ability-auto`, not `add-ability-to`; words that are all
 * filler ("To do") keep them rather than come out empty.
 */
export function anchorFor(text: string, taken: readonly string[]): string {
  const words = text
    // A link is named by its words, not by where it points: [notion](https://…) anchors as "notion", never as a URL.
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    // A counter is a count kept on the item, and the bookmark a place in the note: neither is part of its name.
    .replace(/\[\d{1,4}\/\d{1,4}\]/g, ' ')
    .replace(BOOKMARK, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .split('-')
    .filter(Boolean);
  const telling = words.filter((word) => !FILLER.has(word));
  const base = (telling.length ? telling : words).slice(0, 3).join('-') || 'item';
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n += 1) {
    const tried = `${base}-${n}`;
    if (!taken.includes(tried)) return tried;
  }
}

/** The board `line` is inside, fence lines included, or null. */
export function boardAt(doc: string, line: number): Board | null {
  return boardsIn(doc).find((board) => board.to > board.from && line >= board.from && line <= board.to) ?? null;
}

/**
 * Where an anchor is pointed at from: `[[#^ask-sam]]`, anywhere in a line, counting positions from `offset`.
 *
 * This is the anchor used as prose rather than as a card, and it is why the anchor is worth having on every kind of
 * item: "the copy is waiting on [[#^ask-sam]]" reads as words anywhere, and in Glyph it is a way back to the line.
 */
export interface ItemRef {
  from: number;
  to: number;
  id: string;
}

export function refsIn(text: string, offset = 0): ItemRef[] {
  const found: ItemRef[] = [];
  REF.lastIndex = 0;
  for (let match = REF.exec(text); match; match = REF.exec(text)) {
    found.push({ from: offset + match.index, to: offset + match.index + match[0].length, id: match[1] ?? '' });
  }
  return found;
}

/** The item an anchor names, wherever it is in the note, or null. */
export function itemAt(doc: string, id: string): Item | null {
  return itemsIn(doc).find((item) => item.id === id) ?? null;
}

/** An anchor written as a pointer to it, for anything that offers to write one. */
export function refFor(id: string): string {
  return `[[#^${id}]]`;
}

/**
 * A whole board as words to take away (Matt: "the task management board needs to be copyable but formatting is
 * splitting it up"). Drawn as columns, a board cannot be dragged over and copied a piece at a time, and its fence and
 * its items sit apart in the note anyway. This is both together, in the note's own markdown: the fence, then every
 * item it names in the order the note has them. Pasted into another note it is the same working board; pasted
 * anywhere else it reads as a list under its columns.
 *
 * Null when `line` is not inside a board.
 */
export function boardCopy(doc: string, line: number): string | null {
  const lines = doc.split('\n');
  const board = boardAt(doc, line);
  if (!board) return null;
  const named = new Set(board.columns.flatMap((column) => column.cards));
  const items = itemsIn(doc)
    .filter((item) => named.has(item.id))
    .map((item) => lines[item.line - 1] ?? '');
  const fence = lines.slice(board.from - 1, board.to).join('\n');
  return items.length ? `${fence}\n\n${items.join('\n')}\n` : `${fence}\n`;
}

/**
 * An item's words as a card says them: links by their own words, not by where they point, a pointer at another item
 * by its anchor, and the marks that would be drawn as bold or code taken off. The note keeps every character; this
 * is only what the card shows.
 */
export function cardText(text: string): string {
  return text
    .replace(BOOKMARK, '')
    .replace(REF, '^$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<((?:https?|mailto):[^>]+)>/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The columns a note is given when its items are made into a board. */
export const NEW_COLUMNS = ['To do', 'Doing', 'Done'];

/** A note turned into a board: the words it becomes, and what it took. */
export interface BoardMade {
  doc: string;
  /** How many items became cards. */
  cards: number;
  /** How many of them were already ticked, and so went straight to Done. */
  done: number;
}

/**
 * A list made into a board (Matt: "transform the task management note i have into kanban format").
 *
 * Every list item in the note is given an anchor if it has none, and a fence of columns goes in under the note's
 * title naming them all: the ticked ones in Done, the rest in the first column. Nothing else about the note is
 * touched - the words, the headings and the order stay exactly as they were, which is the point of the standard.
 *
 * Null when there is nothing to do: a note with no list, or one that is a board already.
 */
export function boardFrom(doc: string, columns: readonly string[] = NEW_COLUMNS): BoardMade | null {
  if (boardsIn(doc).some((board) => board.to > board.from)) return null;
  const lines = doc.split('\n');
  const cards = anchorItems(lines, doc, 1, lines.length);
  if (!cards.length) return null;
  const fence = fenceFor(cards, columns);
  // Under the note's title, where a board is read first; a note that opens with words takes the board above them.
  const title = /^#\s+\S/.test(lines[0] ?? '') ? 1 : 0;
  const blank = title && (lines[1] ?? '').trim() === '';
  lines.splice(blank ? 2 : title, 0, ...(title && !blank ? ['', ...fence] : fence));
  return { doc: lines.join('\n'), cards: cards.length, done: cards.filter((card) => card.done).length };
}

/**
 * Every list item from line `from` to line `to` given an anchor where it has none, in place in `lines`, and each
 * one's anchor and whether it is ticked, in order. A list inside a block of code is code, not a list: its lines are
 * left exactly as they are.
 */
function anchorItems(lines: string[], doc: string, from: number, to: number): { id: string; done: boolean }[] {
  const taken = itemsIn(doc).map((item) => item.id);
  const inside = fencedLines(lines);
  const cards: { id: string; done: boolean }[] = [];
  for (let index = Math.max(0, from - 1); index < Math.min(lines.length, to); index += 1) {
    const text = lines[index] ?? '';
    if (inside.has(index + 1) || !isItemLine(text)) continue;
    const already = itemOnLine(text);
    const id = already?.id ?? anchorFor(itemWords(text) ?? text, taken);
    if (!already) {
      taken.push(id);
      lines[index] = withAnchor(text, id);
    }
    cards.push({ id, done: parse(text)?.done === true });
  }
  return cards;
}

/** A board fence laying `cards` out in `columns`: the ticked ones in the column called Done, the rest in the first. */
function fenceFor(cards: readonly { id: string; done: boolean }[], columns: readonly string[]): string[] {
  const named = columns.length ? [...columns] : [...NEW_COLUMNS];
  const called = named.findIndex((name) => /^done\b|\bdone$/i.test(name.trim()));
  const last = called >= 0 ? called : named.length - 1;
  const board: BoardColumn[] = named.map((name, index) => ({
    name,
    cards: cards.filter((card) => (card.done ? last : 0) === index).map((card) => card.id),
  }));
  return ['```board', writeBoard(board), '```', ''];
}

/**
 * The list line `line` is in, from its first item to its last, counting from 1; or null where the line is in no list
 * (Matt: "add ability to auto list a section of list items into a board").
 *
 * A list is the run of item lines around the line, with the indented lines that belong to its items and a single
 * blank line between two of them. A heading, a paragraph, a block of code, or two blank lines end it.
 */
export function listAround(doc: string, line: number): { from: number; to: number } | null {
  const lines = doc.split('\n');
  const inside = fencedLines(lines);
  const member = (index: number) => {
    const text = lines[index];
    if (text === undefined || inside.has(index + 1)) return false;
    return isItemLine(text) || /^\s{2,}\S/.test(text);
  };
  const blank = (index: number) => (lines[index] ?? 'x').trim() === '';
  let first = line - 1;
  if (!member(first)) return null;
  let last = first;
  for (;;) {
    if (member(first - 1)) first -= 1;
    else if (blank(first - 1) && member(first - 2)) first -= 2;
    else break;
  }
  for (;;) {
    if (member(last + 1)) last += 1;
    else if (blank(last + 1) && member(last + 2)) last += 2;
    else break;
  }
  // A list starts and ends with an item: indented lines outside those belong to something else.
  while (first <= last && !isItemLine(lines[first] ?? '')) first += 1;
  while (last >= first && !isItemLine(lines[last] ?? '')) last -= 1;
  return first <= last ? { from: first + 1, to: last + 1 } : null;
}

/** One list made into a board: what changes, where, and the board's opening line once it is in. */
export interface ListBoard extends BoardMade {
  /** Item lines that gained an anchor, each with its new words, numbered as the note was. */
  lines: { number: number; text: string }[];
  /** The fence, and the line of the note as it was that it goes in above. */
  fence: { before: number; text: string };
  /** The line the board opens on, in the note as it becomes. */
  open: number;
}

/**
 * The items from line `from` to line `to` made into a board of their own, set in just above them: each item named,
 * the ticked ones in Done. The rest of the note, other boards included, is left as it is, so a note can hold one
 * board per list.
 *
 * Null where there is nothing to make: no items in the lines, or a board already sitting right above them.
 */
export function boardFromList(doc: string, from: number, to: number, columns: readonly string[] = NEW_COLUMNS): ListBoard | null {
  const lines = doc.split('\n');
  let above = from - 2;
  while (above >= 0 && (lines[above] ?? '').trim() === '') above -= 1;
  if (above >= 0 && boardsIn(doc).some((board) => board.to > board.from && board.to === above + 1)) return null;
  const before = [...lines];
  const cards = anchorItems(lines, doc, from, to);
  if (!cards.length) return null;
  const changed = lines.flatMap((text, index) => (text !== before[index] ? [{ number: index + 1, text }] : []));
  const fence = fenceFor(cards, columns);
  // A line of words straight above the list keeps a blank line between it and the board.
  const gap = from > 1 && (lines[from - 2] ?? '').trim() !== '';
  const block = gap ? ['', ...fence] : fence;
  lines.splice(from - 1, 0, ...block);
  return {
    doc: lines.join('\n'),
    cards: cards.length,
    done: cards.filter((card) => card.done).length,
    lines: changed,
    fence: { before: from, text: `${block.join('\n')}\n` },
    open: from + (gap ? 1 : 0),
  };
}

/** Every line inside a fenced block, counting from 1: what is code and not markdown. */
function fencedLines(lines: readonly string[]): Set<number> {
  const inside = new Set<number>();
  let fence = '';
  lines.forEach((text, index) => {
    const edge = /^\s*(`{3,}|~{3,})/.exec(text);
    if (fence) {
      inside.add(index + 1);
      if (edge && edge[1]!.startsWith(fence[0]!) && edge[1]!.length >= fence.length && !text.trim().slice(edge[1]!.length).trim()) fence = '';
      return;
    }
    if (edge) {
      fence = edge[1]!;
      inside.add(index + 1);
    }
  });
  return inside;
}

/** What putting the item on line `line` onto a board changes: the line itself, when it needs an anchor, and the fence. */
export interface CardAdded {
  id: string;
  /** The item's line rewritten with its anchor, or null when it already had one. */
  line: { number: number; text: string } | null;
  /** The board's fence body rewritten, and which lines it lies between. */
  fence: { from: number; to: number; body: string };
  /** The column it went into. */
  column: string;
}

/**
 * The list item on `line` put on a board (Matt: "add an 'add to board' option when other items in the list are in a
 * board already").
 *
 * The board is the one that already holds the item's neighbours - the list it stands in, `listAround` - since a list
 * with cards on a board is almost always the board it belongs to; failing that, the nearest board above it, else the
 * first in the note.
 *
 * It lands in the first lane, or in Done when it is already ticked: a new card is something to do, whatever lane the
 * item next to it sits in. Within that lane it goes in beside the nearest neighbour that is already there, on the
 * same side as the note has it, so a board keeps the list's own order instead of collecting new cards at the end.
 *
 * Null when the line is not a list item, there is no board to put it on, or its anchor is already a card.
 */
export function addToBoard(doc: string, line: number): CardAdded | null {
  const lines = doc.split('\n');
  const text = lines[line - 1];
  if (text === undefined || !isItemLine(text)) return null;
  const item = itemOnLine(text);
  const boards = boardsIn(doc).filter((board) => board.to > board.from && board.columns.length);
  if (!boards.length) return null;
  const id =
    item?.id ??
    anchorFor(
      itemWords(text) ?? text,
      itemsIn(doc).map((other) => other.id),
    );
  // The item's neighbours in its own list, nearest first: which board they are on, and where on it.
  const around = listAround(doc, line);
  const mates = around
    ? itemsIn(doc)
        .filter((other) => other.line >= around.from && other.line <= around.to && other.line !== line)
        .sort((one, two) => Math.abs(one.line - line) - Math.abs(two.line - line))
    : [];
  const held = mates.map((mate) => ({ mate, board: boards.find((board) => columnOf(board.columns, mate.id) >= 0) })).filter((found) => found.board);
  const above = [...boards].reverse().find((board) => board.to < line);
  const board = held[0]?.board ?? above ?? boards[0]!;
  if (columnOf(board.columns, id) >= 0) return null;
  const done = doneColumn(board.columns);
  const into = item?.done === true && done >= 0 ? done : 0;
  // Beside the nearest neighbour already in that lane, on the side the note has it: the list's order, kept.
  const beside = held.find((found) => found.board === board && columnOf(board.columns, found.mate.id) === into)?.mate;
  const cards = board.columns[into]?.cards ?? [];
  const at = beside ? cards.indexOf(beside.id) + (beside.line < line ? 1 : 0) : Number.MAX_SAFE_INTEGER;
  const columns = putCardAt(board.columns, id, into, at);
  return {
    id,
    line: item ? null : { number: line, text: withAnchor(text, id) },
    fence: { from: board.from, to: board.to, body: writeBoard(columns) },
    column: columns[into]?.name ?? '',
  };
}

/** A card made from the board itself: the new line to put in the note, where it goes, and the fence that names it. */
export interface CardMade {
  id: string;
  /** The line to write, and the line number it becomes. */
  at: number;
  text: string;
  fence: { from: number; to: number; body: string };
}

/**
 * A new card in column `column` of the board whose fence opens on `open`, carrying `words` (Matt: "make the UI / UX
 * of these boards friendlier on mobile", and "a button on each board to add an item, it should add the item to the
 * list the board is derived from"): typing markdown to add one is not something to do on a phone, so the board
 * writes the line itself.
 *
 * The words come first and the line is made with them, so the anchor is named after what the item says from the
 * start. A card written empty and named later would be `^item`, `^item-2`, `^item-3` for as long as nobody renamed
 * it, and those are the names a person points at. No words, no card.
 *
 * The item goes in under the last item the board already names, so a board's items stay together, and under the
 * fence when it names none yet. It is written as a to-do, since a column is a place work waits in. The card goes in
 * at `index` in its column: the top by default, under the field it was typed into.
 */
export function newCard(doc: string, open: number, column: number, words: string, index = 0): CardMade | null {
  const said = words.replace(/\s+/g, ' ').trim();
  const board = boardAt(doc, open);
  if (!said || !board || !board.columns.length || column < 0 || column >= board.columns.length) return null;
  const named = new Set(board.columns.flatMap((held) => held.cards));
  const taken = itemsIn(doc);
  const last = taken.filter((item) => named.has(item.id) && item.line > board.to).pop();
  const id = anchorFor(
    said,
    taken.map((item) => item.id),
  );
  // Written at the indent of the item it follows, so a card added under a nested list stays in that list.
  const under = last ? (doc.split('\n')[last.line - 1] ?? '') : '';
  const indent = /^(\s*)/.exec(under)?.[1] ?? '';
  return {
    id,
    at: last ? last.line + 1 : board.to + 1,
    text: `${indent}- [ ] ${said} ^${id}`,
    fence: { from: board.from, to: board.to, body: writeBoard(putCardAt(board.columns, id, column, index)) },
  };
}

// ---- lanes, by voice --------------------------------------------------------------------------

/**
 * A board's columns as a voice command names them (Matt: "add voice commands and cues for adding to swimlanes on the
 * board"). The recorder reads "Glyph, add call Sam to Doing" and "move fix login to the Done column"
 * (capture/command.ts); these find the lane and make the change, in the note's own markdown.
 */
export interface Lane {
  name: string;
  /** The line the lane's board opens on, counting from 1. */
  board: number;
  /** Which of that board's columns. */
  column: number;
}

/** Every lane of every board in the note, in order. */
export function lanesOf(body: string): Lane[] {
  return boardsIn(body)
    .filter((board) => board.to > board.from)
    .flatMap((board) => board.columns.map((column, index) => ({ name: column.name, board: board.from, column: index })));
}

/** A lane's name as it is said: no "the" in front, and no "lane", "column" or "swimlane" after it. */
function spokenLane(text: string): string {
  return text
    .replace(/[.,;:!?"“”]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:(?:the|my|our)\s+)+/i, '')
    .replace(/\s+(?:swim\s?lanes?|lanes?|columns?)$/i, '')
    .trim();
}

const FINISHED = /^(?:done|finished|complete|completed)$/i;

/**
 * The lane `spoken` names, and how well, 0 to 1, on the same footing as a note's name (capture/route.ts
 * `similarity`), so the recorder can weigh a lane against a note of the same name. Null when no lane is a clear
 * match: the best must reach 0.72 and beat the next by 0.08, as a note's name must. "Finished" and "complete" find
 * the board's Done lane.
 */
export function matchLane(spoken: string, lanes: readonly Lane[]): { lane: Lane; score: number } | null {
  const said = spokenLane(spoken);
  if (said.length < 2) return null;
  let best: { lane: Lane; score: number } | null = null;
  let second = 0;
  for (const lane of lanes) {
    let score = similarity(said, lane.name);
    if (FINISHED.test(said) && /^done\b|\bdone$/i.test(lane.name.trim())) score = Math.max(score, 0.95);
    if (!best || score > best.score) {
      second = best?.score ?? second;
      best = { lane, score };
    } else if (score > second) {
      second = score;
    }
  }
  if (!best || best.score < 0.72) return null;
  if (best.score - second < 0.08 && best.score < 0.99) return null;
  return best;
}

/** The board a lane belongs to in `body` as it is now, or null when that board or column is not there any more. */
function boardOfLane(body: string, lane: Lane): Board | null {
  const board = boardAt(body, lane.board);
  if (!board || board.from !== lane.board) return null;
  const column = board.columns[lane.column];
  return column && column.name === lane.name ? board : null;
}

/** `body` with a board's fence body rewritten: the lines between its two fence lines. */
function withFence(lines: string[], board: Board, columns: readonly BoardColumn[]): void {
  lines.splice(board.from, board.to - board.from - 1, ...writeBoard(columns).split('\n'));
}

/**
 * A new to-do with `words`, on the lane: the line written under the board's last item (core/boards.ts `newCard`)
 * and its card put at the top of the lane. Null for no words, or a lane that is not in `body`.
 */
export function addToLane(body: string, lane: Lane, words: string): { body: string; line: string } | null {
  if (!boardOfLane(body, lane)) return null;
  const made = newCard(body, lane.board, lane.column, words);
  if (!made) return null;
  const lines = body.split('\n');
  // The item first, since it goes in below the board and so moves none of the board's lines.
  lines.splice(Math.min(made.at - 1, lines.length), 0, made.text);
  lines.splice(made.fence.from, made.fence.to - made.fence.from - 1, ...made.fence.body.split('\n'));
  return { body: lines.join('\n'), line: made.text };
}

/** The words worth matching an item on: lower case, letters and digits, three characters or more. */
function tokensOf(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((token) => token.length >= 3);
}

/**
 * The list item `itemWords` names, moved to the lane: named with an anchor if it has none, its card taken from
 * wherever it was on that board and put at the end of the lane. Moved into the Done lane its box is ticked, and out of
 * it unticked, as a card dragged there would be; `ticked` says which happened, or null when the box was left alone.
 *
 * The item is the note's list item whose words best match - three words in five, as a lost mark is found again
 * (format/links.ts) - anywhere in the note but a block of code. Null when none matches that well, or the lane is not
 * in `body`.
 */
export function moveToLane(
  body: string,
  itemWords: string,
  lane: Lane,
): { body: string; item: { id: string; text: string; line: number }; ticked: boolean | null } | null {
  const board = boardOfLane(body, lane);
  if (!board) return null;
  const wanted = tokensOf(itemWords);
  if (!wanted.length) return null;
  const lines = body.split('\n');
  const inside = fencedLines(lines);
  let best = -1;
  let bestScore = 0;
  lines.forEach((text, index) => {
    if (inside.has(index + 1) || !isItemLine(text)) return;
    const have = new Set(tokensOf(wordsOn(text)));
    const score = wanted.filter((token) => have.has(token)).length / wanted.length;
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  });
  if (best < 0 || bestScore < 0.6) return null;

  const original = lines[best] ?? '';
  const already = itemOnLine(original);
  const id = already?.id ?? anchorFor(wordsOn(original), itemsIn(body).map((item) => item.id));
  let line = withAnchor(original, id);
  const columns = putCard(board.columns, id, lane.column);
  const done = doneColumn(columns);
  const box = parse(line)?.done ?? null;
  let ticked: boolean | null = null;
  if (box !== null && done >= 0) {
    const into = lane.column === done;
    if (into !== box) {
      line = setItemDone(line, into);
      ticked = into;
    }
  }
  lines[best] = line;
  withFence(lines, board, columns);
  return { body: lines.join('\n'), item: { id, text: wordsOn(line), line: best + 1 }, ticked };
}

/** A list item's words, box and anchor off; '' for a line that is not one. */
function wordsOn(line: string): string {
  return itemWords(line) ?? '';
}
