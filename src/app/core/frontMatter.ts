/**
 * A note's front matter, written to: the `title:` a canvas note is named by (docs/CANVAS.md), since a canvas has
 * no heading to rename it in. Reading is core/store.ts `withoutFrontMatter`; this is the one write the app makes
 * to a note's front matter, and it keeps every other key as it was.
 */

/** A front matter fence, `---` or `+++`, on a line of its own. */
const FENCE = /^(---|\+\+\+)\s*$/;

/**
 * One key's value from the front matter, its quotes taken off, or null where there is no front matter or no such
 * key. A book note says `book: true` (book/book.ts); a canvas note is named by `title:`.
 */
export function frontMatterValue(body: string, key: string): string | null {
  const lines = body.split('\n');
  if (!FENCE.test(lines[0] ?? '')) return null;
  const close = lines.findIndex((line, n) => n > 0 && FENCE.test(line));
  if (close < 0) return null;
  const pattern = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*(.*?)\\s*$`, 'i');
  for (const line of lines.slice(1, close)) {
    const m = pattern.exec(line);
    if (m) return (m[1] ?? '').replace(/^(["'])(.*)\1$/, '$2');
  }
  return null;
}

/** The title as a front matter value: quoted, so a colon or a hash in it stays part of the name. */
function quoted(title: string): string {
  return `"${title.replace(/["\n]/g, "'").trim()}"`;
}

/**
 * The body with its `title:` set to `title`: the key replaced where the front matter has one, added first where it
 * has not, and front matter made where there was none. Everything else - other keys, the words - is untouched. An
 * empty title takes the key off, and takes front matter that held nothing else off with it.
 */
export function withFrontMatterTitle(body: string, title: string): string {
  const clean = title.trim();
  const lines = body.split('\n');
  if (!FENCE.test(lines[0] ?? '')) {
    return clean ? `---\ntitle: ${quoted(clean)}\n---\n${body}` : body;
  }
  const close = lines.findIndex((line, n) => n > 0 && FENCE.test(line));
  if (close < 0) return clean ? `---\ntitle: ${quoted(clean)}\n---\n${body}` : body;
  const keys = lines.slice(1, close).filter((key) => !/^\s*title\s*:/i.test(key));
  if (clean) keys.unshift(`title: ${quoted(clean)}`);
  const rest = lines.slice(close + 1);
  if (!keys.length) return rest.join('\n');
  return [lines[0], ...keys, lines[close], ...rest].join('\n');
}
