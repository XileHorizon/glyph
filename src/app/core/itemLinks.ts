/**
 * List items and their marks: which items are not linked to anything yet,
 * and what one becomes when it is.
 *
 * The one form, everywhere: a linked item keeps its words as they are and
 * ends with a mark - a link whose words are the lowercase name of what it is
 * linked to, `- [ ] Buy milk [notion](https://www.notion.so/…)`. Matt: "we
 * need a common format for linking Notion pages to list items, as the AI
 * will change how this looks when formatting or enhancing". The words used
 * to be the link, `[Buy milk](https://…)`, and a rewrite that moved or
 * dropped the link left the item looking unsent; a mark at the end is one
 * small thing the model is told to keep in place, the editor draws it as a
 * pill (editor/links.ts), and the formatter puts it back on the item it came
 * from when a model loses it (format/links.ts). The old form still counts as
 * linked, so a note from before is never sent twice.
 *
 * A board's name for the item (core/boards.ts, docs/BOARDS.md) comes after
 * the mark: `- [ ] Buy milk [notion](…) ^buy-milk`. The mark is last but for
 * that, and every reader and writer here knows it - a mark written after the
 * anchor left the board unable to find the item, and the anchor sent to
 * Notion as part of the task's title.
 *
 * So "not linked yet" is a to-do or bullet with no mark and no link in its
 * words, and linking a whole list twice links nothing the second time.
 * Ticked to-dos are left alone: a done thing is not a task to make. Plugins
 * use these for what they link items to (the Notion plugin's tasks), and the
 * recorder for words of a take linked while it is being said. Pure, so every
 * shape of line is a test.
 */

const ITEM = /^(\s*(?:- \[[ xX]\] |[-*+] |\d{1,3}[.)] ))(.*)$/;
/** The mark: the last thing on a line but a board's anchor, a link whose words are one lowercase name. */
const MARK = /\s*\[([a-z][a-z0-9-]*)\]\((https?:\/\/[^\s)]+)\)\s*$/;
/**
 * What may come after an item's mark, at the very end of its line: a board's anchor (core/boards.ts, `^buy-milk`)
 * and counters (editor/counters.ts, `[3/8]`), in any order. Written after the mark or typed after it later, they
 * leave the mark the item's mark. An anchor needs whitespace, or nothing, before its caret and the end of the line
 * or another of these after its name, which is what leaves `x^2^` the superscript it is.
 */
export const ITEM_TAIL = String.raw`\^[a-z0-9][a-z0-9_-]*|\[\d{1,4}\/\d{1,4}\]`;
const TAIL_END = new RegExp(String.raw`(?:(?:^|\s+)(?:${ITEM_TAIL}))+\s*$`);
/** A counter anywhere in an item's words: `[3/8]`, as editor/counters.ts reads it. */
const COUNTER = /(?<![!\]\w])\[\d{1,4}\/\d{1,4}\](?!\()/g;
/** A choice's box after a bullet (editor/choices.ts): `- ( ) Pick A`, `- (x) Pick A`. */
const CHOICE = /^\(([ xX])\) /;
/** The bookmark (editor/bookmarkLine.ts): `§§` after an item's words, a place in the note and never part of a title. */
const BOOKMARK = /\s*§§(?=\s|$)/g;

/** `text` without what comes after its mark, and that tail as written (`[3/8] ^buy-milk`, or '' where there is none). */
function anchorOff(text: string): { body: string; anchor: string } {
  const found = TAIL_END.exec(text);
  return found ? { body: text.slice(0, found.index), anchor: found[0].trim() } : { body: text, anchor: '' };
}

/**
 * What an item says, for a title or for finding it again: no choice box, no counters, which are a count kept on the
 * item rather than part of its name, and no bookmark.
 */
function said(marker: string, text: string): string {
  const unchosen = /[-*+] $/.test(marker) ? text.replace(CHOICE, '') : text;
  return unchosen.replace(COUNTER, '').replace(BOOKMARK, '').replace(/\s+/g, ' ').trim();
}

/** Words with an anchor put back after them, one space between. */
function withAnchorBack(words: string, anchor: string): string {
  if (!anchor) return words;
  return words.trim() ? `${words.trimEnd()} ${anchor}` : anchor;
}

export interface Item {
  /** 1-based line number in the note. */
  line: number;
  /** The words, without the marker and without a mark. */
  text: string;
}

export interface ItemMark {
  /** What it is linked to: "notion". */
  name: string;
  url: string;
}

/**
 * The names a mark can carry: the ids of the plugins that link items, told
 * here as they load (plugins/registry.ts). Without this, "read the [docs](…)"
 * at the end of an item would be a mark called docs.
 */
const MARK_NAMES = new Set(['notion']);

export function registerMarkName(name: string): void {
  MARK_NAMES.add(name.toLowerCase());
}

export function isMarkName(name: string): boolean {
  return MARK_NAMES.has(name);
}

/** The mark at the end of `text`, a board's anchor aside, if it has one. */
export function markOf(text: string): ItemMark | null {
  const match = MARK.exec(anchorOff(text).body);
  return match && isMarkName(match[1] ?? '') ? { name: match[1] ?? '', url: match[2] ?? '' } : null;
}

/** `text` without its mark; a board's anchor after it stays. */
export function unmarked(text: string): string {
  const { body, anchor } = anchorOff(text);
  const bare = markOf(body) ? body.replace(MARK, '').trimEnd() : body.trimEnd();
  return withAnchorBack(bare, anchor).trimEnd();
}

/**
 * The words of a list item line: marker, mark and a board's anchor aside - what the item says, and what is sent
 * as a task's title. Null for a line that is not an item.
 */
export function itemWords(lineText: string): string | null {
  const match = ITEM.exec(lineText);
  if (!match) return null;
  const { body } = anchorOff(match[2] ?? '');
  return said(match[1] ?? '', markOf(body) ? body.replace(MARK, '') : body);
}

/**
 * `lineText` with `mark` (`[notion](…)`, as written) added where a mark goes: at the end, before a board's anchor
 * if the line has one.
 */
export function withMark(lineText: string, mark: string): string {
  const { body, anchor } = anchorOff(lineText);
  return withAnchorBack(`${body.trimEnd()} ${mark}`, anchor);
}

/** Whether an item's words are already linked: a mark, or the old form with a link in the words. */
function linked(text: string): boolean {
  return markOf(text) !== null || /\[[^\]]+\]\(https?:\/\/[^)]+\)/.test(text);
}

/** Every list item not linked yet, in note order. */
export function unsentItems(body: string): Item[] {
  const items: Item[] = [];
  body.split('\n').forEach((raw, index) => {
    const match = ITEM.exec(raw);
    if (!match) return;
    const marker = match[1] ?? '';
    // The anchor is the board's name for the item, not part of what it says, and a counter or a choice's box is not
    // part of its name: none of them is sent.
    const whole = anchorOff((match[2] ?? '').trim()).body.trim();
    const text = said(marker, whole);
    if (!text || /\[[xX]\]/.test(marker) || linked(whole) || whole.startsWith('![')) return;
    items.push({ line: index + 1, text });
  });
  return items;
}

/** The item on `line` if it is one that can be sent, else null. */
export function itemAt(lineText: string, line: number): Item | null {
  return unsentItems(lineText).map((item) => ({ ...item, line }))[0] ?? null;
}

/** `lineText` with a mark to `url` at its end, before a board's anchor; the marker, the indent and the words stay. */
export function linkedLine(lineText: string, url: string, name = 'notion'): string {
  const match = ITEM.exec(lineText);
  if (!match) return lineText;
  const { body, anchor } = anchorOff(match[2] ?? '');
  const words = unmarked(body).trim();
  return `${match[1]}${withAnchorBack(`${words} [${name}](${url})`, anchor)}`;
}

export interface SentLink {
  text: string;
  url: string;
  /** What the words were sent to: "notion" unless said otherwise. */
  name?: string;
}

const squash = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * `markdown` with each sent thing marked, wherever its words landed: a to-do
 * or a bullet gets the mark at its end; words in a sentence get it right
 * after them. For a take whose phrases were sent while it is still being
 * said, so the words keep the shape the spoken cues gave them and only gain
 * the mark. The first line holding the words (ignoring case and punctuation)
 * is the one; words already linked are left alone.
 */
export function applyLinks(markdown: string, links: readonly SentLink[]): string {
  if (!links.length) return markdown;
  const lines = markdown.split('\n');
  for (const link of links) {
    const wanted = squash(link.text);
    if (!wanted) continue;
    const mark = `[${link.name ?? 'notion'}](${link.url})`;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? '';
      if (line.includes(`](${link.url})`)) break;
      const match = ITEM.exec(line);
      const marker = match ? (match[1] ?? '') : '';
      const whole = match ? (match[2] ?? '') : line;
      const { body: words, anchor } = match ? anchorOff(whole) : { body: whole, anchor: '' };
      if (squash(match ? said(marker, words) : words) === wanted) {
        lines[i] = `${marker}${withAnchorBack(`${words.trim().replace(/[.,;:!?]+$/, '')} ${mark}`, anchor)}`;
        break;
      }
      const at = words.toLowerCase().indexOf(link.text.toLowerCase().replace(/[.,;:!?]+$/, ''));
      if (at >= 0 && !/\]\(/.test(words)) {
        const end = at + link.text.replace(/[.,;:!?]+$/, '').length;
        lines[i] = `${marker}${words.slice(0, end)} ${mark}${words.slice(end)}`;
        break;
      }
    }
  }
  return lines.join('\n');
}
