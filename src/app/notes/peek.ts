import { shortenUrls } from '../core/shortUrl.ts';
import { withoutFrontMatter } from '../core/store.ts';

/**
 * The first few lines of a note, read as shapes rather than as characters, for the small preview drawn on each card in
 * the desktop sidebar (notes/NotePeek.tsx).
 *
 * Matt: "the title is huge and it's not got a long description of what we're doing, I think it could use a list of
 * live previewed versions of the cards". The line that was meant to say what a note is about is the gist, and the gist
 * is written by a model on the phone (format/gist.ts) - on a desktop there is no model, so the card was a title and a
 * date and nothing else. This needs nothing but the note: it is the note, smaller.
 *
 * A miniature, not a summary: one entry per line of the note, each carrying what kind of line it was, so a to-do list
 * still looks like a to-do list and a heading still looks like a heading at a tenth of the size. That is the part
 * worth seeing at a glance - shape is recognisable long before words are readable.
 *
 * Pure, and the title is never repeated: the card already says it.
 */

export type PeekLine =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'number'; text: string }
  | { kind: 'task'; done: boolean; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'table'; cells: string[] }
  | { kind: 'image'; text: string }
  | { kind: 'rule' }
  | { kind: 'text'; text: string };

/** How many lines are worth drawing. Past this the card is a note rather than a card. */
export const PEEK_LINES = 6;

/**
 * How many lines of the note the card's editor is given (notes/NotePeek.tsx): more than it shows, since a heading or
 * a wrapped line takes more than one, and few enough that a card of a long note costs a card, not a note.
 */
export const PEEK_SOURCE_LINES = 14;

/**
 * The note after its title, as markdown, for the card's own small editor to draw exactly as the note draws it
 * (Matt: "the preview for the formatting should use the same formatter that the actual note uses instead of custom
 * rolled small stuff"). Front matter and the title go, since the card says the title above; up to `most` lines
 * follow, and a block of code opened inside them is kept to its closing fence, so it is drawn as one. A board's
 * fence is left out altogether (Matt: "don't render boards in previews"): its lanes are a screen's worth, and its
 * cards are the note's own items, which follow and are drawn as the list they are. The blank lines around the cut
 * close up to one, and an item's anchor goes: it is the name a board calls the item by, never part of what it says
 * (docs/BOARDS.md), and on a card it took a line of its own.
 */
export function peekMarkdown(body: string, most: number = PEEK_SOURCE_LINES): string {
  const lines = withoutFrontMatter(body.split('\n'));
  const title = lines.findIndex((l) => l.trim() && !IMAGE_ONLY.test(l));
  const out: string[] = [];
  let fence: string | null = null;
  let board = false;
  let fenceLines = 0;
  for (let n = title + 1; n < lines.length; n += 1) {
    const line = lines[n] ?? '';
    const fenced = /^\s*(```|~~~)\s*(\w*)/.exec(line);
    if (fence) {
      if (!board) out.push(line);
      fenceLines += 1;
      if (fenced && line.trim().startsWith(fence)) {
        fence = null;
        board = false;
      }
      // A fence that never closes still ends somewhere.
      if (fenceLines >= most * 3) break;
      continue;
    }
    if (out.length >= most) break;
    // A blank line before anything is drawn, or after another, is nothing to draw.
    if (!line.trim() && (!out.length || !out[out.length - 1]!.trim())) continue;
    if (fenced) {
      fence = fenced[1]!;
      fenceLines = 0;
      board = fenced[2]?.toLowerCase() === 'board';
      if (board) continue;
    }
    out.push(line.replace(ANCHOR_AT_END, ''));
  }
  return out.join('\n').replace(/\s+$/, '');
}

/** An item's anchor at the end of its line (core/boards.ts), with the space before it. */
const ANCHOR_AT_END = /(^|\s)\^[a-z0-9][a-z0-9_-]*\s*$/;

/** At most this many cells of a table row: three is what a sidebar can show without them all becoming slivers. */
const MOST_CELLS = 3;

const IMAGE_ONLY = /^!\[([^\]]*)\]\([^)]*\)\s*$/;
/** Every paired mark Glyph knows (plugins/marks/), so a line reads as its words. */
const PAIRED = /(\*\*|__|~~|`|\|\||==|%%|\?\?|@@|\^\^|\+\+)/g;

/** A line as its words: links as their text, marks gone, addresses shortened the way the list shortens them. */
export function bareWords(text: string): string {
  return shortenUrls(
    text
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(PAIRED, '')
      // The bookmark's mark (editor/bookmarkLine.ts): it says where the note opens, not anything the line says.
      .replace(/§§/g, '')
      // An item's anchor at the end of its line (core/boards.ts): the name a board calls it by, not its words.
      .replace(/(^|\s)\^[a-z0-9][a-z0-9_-]*\s*$/, '$1')
      // A lone `*` or `_` around a word, which the paired rule above leaves behind.
      .replace(/(^|\s)[*_](\S)/g, '$1$2')
      .replace(/(\S)[*_](?=\s|$|[.,;:!?])/g, '$1'),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** Where the words of a table row are, minus the rule under the header, which is drawn rather than read. */
function tableCells(line: string): string[] | null {
  // A pipe that is not doubled: `| Name | Size |` is a row, `||the answer||` is a hidden line (plugins/marks/).
  if (!/^\|[^|].*\|\s*$/.test(line)) return null;
  if (/^\|[\s:|-]+$/.test(line)) return [];
  const cells = line
    .replace(/^\||\|\s*$/g, '')
    .split('|')
    .map((cell) => bareWords(cell))
    .filter((cell) => cell);
  return cells.length ? cells.slice(0, MOST_CELLS) : [];
}

export function notePeek(body: string, most: number = PEEK_LINES): PeekLine[] {
  const lines = withoutFrontMatter(body.split('\n'));
  // Everything up to and including the title, which the card says above this.
  const title = lines.findIndex((l) => l.trim() && !IMAGE_ONLY.test(l));
  const out: PeekLine[] = [];
  let fence: string | null = null;

  for (let n = title + 1; n < lines.length && out.length < most; n += 1) {
    const line = (lines[n] ?? '').trim();
    const fenced = /^(```|~~~)/.exec(line);

    // Inside a block of code: its first line stood for it, and the rest is passed over.
    if (fence) {
      if (fenced && line.startsWith(fence)) fence = null;
      continue;
    }
    if (fenced) {
      fence = fenced[1]!;
      // What the block runs, rather than the fence and the language, which say nothing at this size.
      const first = lines.slice(n + 1).find((l) => l.trim() && !/^(```|~~~)/.test(l.trim()));
      if (first) out.push({ kind: 'code', text: first.trim().replace(/\s+/g, ' ') });
      continue;
    }
    if (!line) continue;

    if (/^(?:[-*_]\s*){3,}$/.test(line)) {
      out.push({ kind: 'rule' });
      continue;
    }
    const cells = tableCells(line);
    if (cells) {
      if (cells.length) out.push({ kind: 'table', cells });
      continue;
    }
    // A mark with no words after it - a lone "-", an empty "##" - is nothing to draw.
    if (!/[\p{L}\p{N}]/u.test(line)) continue;

    const picture = IMAGE_ONLY.exec(line);
    if (picture) {
      out.push({ kind: 'image', text: bareWords(picture[1] ?? '') });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const text = bareWords(heading[2] ?? '');
      if (text) out.push({ kind: 'heading', level: heading[1]!.length, text });
      continue;
    }
    const quote = /^(?:>\s?)+(.*)$/.exec(line);
    if (quote) {
      const text = bareWords(quote[1] ?? '');
      if (text) out.push({ kind: 'quote', text });
      continue;
    }
    const task = /^[-*+]\s+\[([ xX])\]\s*(.*)$/.exec(line);
    if (task) {
      const text = bareWords(task[2] ?? '');
      if (text) out.push({ kind: 'task', done: task[1] !== ' ', text });
      continue;
    }
    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      const text = bareWords(bullet[1] ?? '');
      if (text) out.push({ kind: 'bullet', text });
      continue;
    }
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      const text = bareWords(numbered[1] ?? '');
      if (text) out.push({ kind: 'number', text });
      continue;
    }
    const text = bareWords(line);
    if (text) out.push({ kind: 'text', text });
  }
  return out;
}
