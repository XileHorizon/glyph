/**
 * The tidy-up the model does not do, and the mess it sometimes makes.
 *
 * Matt: "the formatter can do things like double nest links and not clean up
 * Notion task links to simply say notion, and other basic formatting tasks".
 * Two passes, both pure:
 *
 * `cleanNote`, before the model: an item whose words are one link to a Notion
 * task - the old way of marking a sent item, `- [ ] [Buy milk](https://www.notion.so/…)`
 * - becomes the mark form, `- [ ] Buy milk [notion](…)` (core/itemLinks.ts),
 * so the model sees the words as words and the mark as the one thing to keep.
 *
 * `cleanRewrite`, after the links are back: a link inside a link's words
 * (`[[Buy milk](url)](url)`, which a small model writes now and then) is one
 * link; an item's mark is once, and last; and the markdown is the plain kind
 * the prompts ask for - `-` bullets, `- [ ]` task boxes with their spaces, a
 * space after `#`, no trailing spaces, no run of blank lines. Words are never
 * touched.
 */

import { isMarkName } from '../core/itemLinks.ts';

const NOTION_HOST = /^https?:\/\/(?:[a-z0-9-]+\.)?notion\.(?:so|site)\//i;
const ITEM = /^(\s*(?:- \[[ xX]\] |[-*+] |\d{1,3}[.)] ))(.*)$/;
/** `[words](url)` where the words hold no link of their own. */
const LINK = /\[([^[\]]*)\]\((https?:\/\/[^\s()]+)\)/g;


/**
 * An item's line with one mark, last, for the Notion task it is linked to -
 * whichever way the link was written: the old form with the words as the
 * link (`[Buy milk](notion-url)`, whole or mid-words), a mark the model moved
 * or doubled, or both at once. Words are unwrapped, never changed; a link to
 * anywhere else is left where it is. A line that is not an item, or holds no
 * Notion link and no mark, comes back as it was.
 */
function markItem(line: string): string {
  const item = ITEM.exec(line);
  if (!item) return line;
  const words = item[2] ?? '';
  let url: string | null = null;
  let name = 'notion';
  const stripped = words
    .replace(LINK, (whole, text: string, target: string) => {
      if (isMarkName(text)) {
        // A mark: remembered, and taken out to go last.
        url ??= target;
        name = text;
        return '';
      }
      if (NOTION_HOST.test(target)) {
        // The old form: the words stay as words.
        url ??= target;
        return text;
      }
      return whole;
    })
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
  if (url === null) return line;
  return `${item[1]}${stripped}${stripped ? ' ' : ''}[${name}](${url})`;
}

/** The note as the model should see it: Notion item links as marks. */
export function cleanNote(body: string): string {
  return body.split('\n').map(markItem).join('\n');
}

/** `[[a](u)](v)` and `[a [b](u)](v)`: the inner link wins, the outer brackets go. */
function unnest(text: string): string {
  let out = text;
  // Repeat until nothing changes: a triple nest unwinds a layer at a time.
  for (let i = 0; i < 4; i += 1) {
    const next = out.replace(/\[([^[\]]*\[[^[\]]*\]\([^\s()]+\)[^[\]]*)\]\((?:https?:\/\/[^\s()]+)\)/g, '$1');
    if (next === out) return out;
    out = next;
  }
  return out;
}

/** The rewrite, tidy: one link per link, marks once and last, plain markdown. */
export function cleanRewrite(text: string): string {
  const lines = unnest(text)
    .split('\n')
    .map((raw) => {
      let line = raw.replace(/[ \t]+$/, '');
      // Plain bullets, and task boxes with their spaces.
      line = line.replace(/^(\s*)[*+] /, '$1- ');
      line = line.replace(/^(\s*)-\s*\[\s*([xX ]?)\s*\]\s*/, (_, indent: string, box: string) => `${indent}- [${box.toLowerCase() === 'x' ? 'x' : ' '}] `);
      // A space after the hashes of a heading.
      line = line.replace(/^(#{1,6})([^#\s])/, '$1 $2');
      return markItem(line);
    });
  // No run of blank lines.
  const out: string[] = [];
  for (const line of lines) {
    if (line.trim() === '' && out.length && out[out.length - 1]!.trim() === '') continue;
    out.push(line);
  }
  return out.join('\n');
}
