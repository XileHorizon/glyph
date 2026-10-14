/**
 * Links through the model, kept by construction rather than by asking.
 *
 * Matt: "AI formatting drops links". A note carries links three ways: as
 * markdown, `[the words](https://www.notion.so/…)` from a Notion send; as an
 * autolink, `<https://…>`; and bare, `https://…` in the middle of a sentence.
 * A small model rewriting the note loses them: an address is a hundred
 * characters it cannot copy and will not keep. So before the note goes in,
 * every address is swapped for a short token it can copy (`link-1`,
 * `link-2`), the way a picture line is kept whole, and after the rewrite
 * comes out the tokens are swapped back. A markdown link keeps its words in
 * the note, so the model can rewrite the sentence around them:
 * `[the words](link-1)`.
 *
 * A token that does not come back is not a lost link. If the link's words
 * survived, they are made the link again; if not, the link is added at the
 * end of the note on its own line. None of this depends on the prompt,
 * though the prompt asks as well (prompt.ts).
 */

import { ITEM_TAIL, isMarkName, itemWords, withMark } from '../core/itemLinks.ts';

export interface ProtectedLink {
  /** `link-3`: what stands in for the address while the model works. */
  token: string;
  /** The link's own words, for a markdown link; null for an address on its own. */
  text: string | null;
  url: string;
  /** How the link was written, to put it back the same way: `[words](url)`, `<url>`, or the bare address. */
  original: string;
  /**
   * For an item's mark (core/itemLinks.ts, `- [ ] Buy milk [notion](url)`): the
   * item's words, so a mark the model loses goes back onto the item it came
   * from, found again by those words, rather than to the end of the note.
   */
  item?: string;
}

export interface Protected {
  text: string;
  links: ProtectedLink[];
}

/** `[words](https://…)`, but not a picture `![…](…)`. */
const MARKDOWN = /(?<!!)\[([^\]\n]*)\]\(\s*(https?:\/\/[^\s()]+)\s*\)/g;
const AUTOLINK = /<(https?:\/\/[^\s<>]+)>/g;
const BARE = /https?:\/\/[^\s<>()[\]]+/g;
/** Punctuation that ends the sentence, not the address. */
const TRAILING = /[.,;:!?'"]+$/;

/** The note with every link replaced by a token, and the links to put back. */
export function protectLinks(body: string): Protected {
  const links: ProtectedLink[] = [];
  const next = () => `link-${links.length + 1}`;
  let text = body.replace(MARKDOWN, (whole: string, words: string, url: string, offset: number) => {
    const token = next();
    const item = markedItem(body, offset, whole, words);
    links.push(item === null ? { token, text: words, url, original: whole } : { token, text: words, url, original: whole, item });
    return `[${words}](${token})`;
  });
  text = text.replace(AUTOLINK, (whole, url: string) => {
    const token = next();
    links.push({ token, text: null, url, original: whole });
    return `<${token}>`;
  });
  text = text.replace(BARE, (match) => {
    const trailing = TRAILING.exec(match)?.[0] ?? '';
    const url = trailing ? match.slice(0, -trailing.length) : match;
    const token = next();
    links.push({ token, text: null, url, original: url });
    return `<${token}>${trailing}`;
  });
  return { text, links };
}

/**
 * The words of the item a link marks, when it is a mark: one lowercase name
 * for its words, the last thing on its line, and the line a list item.
 */
function markedItem(body: string, offset: number, whole: string, words: string): string | null {
  if (!isMarkName(words)) return null;
  const lineStart = body.lastIndexOf('\n', offset - 1) + 1;
  const lineEndAt = body.indexOf('\n', offset + whole.length);
  const lineEnd = lineEndAt === -1 ? body.length : lineEndAt;
  // Nothing after it on the line but, at most, a board's anchor and counters (core/itemLinks.ts `ITEM_TAIL`).
  const after = body.slice(offset + whole.length, lineEnd);
  if (!new RegExp(String.raw`^(?:\s+(?:${ITEM_TAIL}))*\s*$`).test(after)) return null;
  return itemWords(body.slice(lineStart, lineEnd)) || null;
}

/** The words of `text` worth matching on: lowercase, letters and digits, three characters or more. */
function tokensOf(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((t) => t.length >= 3);
}

/** The line of `lines` that is the item `words` most likely became, or -1: three words in five must be there. */
function findItemLine(lines: readonly string[], words: string): number {
  const wanted = tokensOf(words);
  if (!wanted.length) return -1;
  let best = -1;
  let bestScore = 0;
  lines.forEach((line, index) => {
    const item = itemWords(line);
    if (item === null) return;
    const have = new Set(tokensOf(item));
    const score = wanted.filter((t) => have.has(t)).length / wanted.length;
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  });
  return bestScore >= 0.6 ? best : -1;
}

/**
 * The rewrite with its links back. Every way the model may have written a
 * token is taken - `[words](link-1)`, `<link-1>`, `link-1` or `link 1` on its
 * own - and the model's words around it are kept. With `final`, a link whose
 * token never came back is restored around its words or added at the end;
 * a partial rewrite still streaming is only substituted.
 */
export function restoreLinks(text: string, links: readonly ProtectedLink[], final = true): string {
  let out = text;
  const missing: ProtectedLink[] = [];
  for (const link of links) {
    const number = link.token.slice('link-'.length);
    // `link-1` and not `link-10`; `link 1` too, a model's likeliest slip.
    const token = `link[\\s-]?${number}(?!\\d)`;
    let found = false;
    out = out.replace(new RegExp(`\\[([^\\]\\n]*)\\]\\s*\\(\\s*${token}\\s*\\)`, 'gi'), (_, words: string) => {
      found = true;
      return `[${words}](${link.url})`;
    });
    out = out.replace(new RegExp(`<\\s*${token}\\s*>`, 'gi'), () => {
      found = true;
      return link.original;
    });
    out = out.replace(new RegExp(`\\b${token}\\b`, 'gi'), () => {
      found = true;
      return link.original;
    });
    if (!found) missing.push(link);
  }
  if (!final) return out;

  // A lost mark goes back onto its item, found by the item's words.
  const lines = out.split('\n');
  const stillMissing: ProtectedLink[] = [];
  for (const link of missing) {
    const at = link.item ? findItemLine(lines, link.item) : -1;
    if (at >= 0 && !lines[at]!.includes(`](${link.url})`)) lines[at] = withMark(lines[at]!, link.original);
    else stillMissing.push(link);
  }
  out = lines.join('\n');

  const orphans: string[] = [];
  for (const link of stillMissing) {
    const words = link.text?.trim() ?? '';
    const at = words ? indexOfWords(out, words) : -1;
    if (at >= 0) {
      out = `${out.slice(0, at)}[${out.slice(at, at + words.length)}](${link.url})${out.slice(at + words.length)}`;
    } else {
      orphans.push(link.original);
    }
  }
  if (orphans.length) out = `${out.replace(/\s+$/, '')}\n\n${orphans.join('\n')}\n`;
  return out;
}

/** Where `words` appear in `haystack`, regardless of case, and not inside a link already: wrapping those would nest one. */
function indexOfWords(haystack: string, words: string): number {
  const lower = haystack.toLowerCase();
  const needle = words.toLowerCase();
  const spans = [...haystack.matchAll(/\[[^\]]*\]\([^)]*\)/g)].map((m) => [m.index, m.index + m[0].length] as const);
  let from = 0;
  while (from <= lower.length) {
    const at = lower.indexOf(needle, from);
    if (at < 0) return -1;
    const inside = spans.some(([start, end]) => at >= start && at < end);
    if (!inside) return at;
    from = at + needle.length;
  }
  return -1;
}
