/**
 * Tables, said out loud: "Glyph, add a table to the AttackFM bugbash note",
 * and then the recorder asks for them a piece at a time.
 *
 * Matt: "once we say a trigger word the UI should prompt the user so if we say
 * something like 'add a table to the attackfm bugbash note' it should ask 'and
 * what will the column labels be?' ... to guide the user more". A table is too
 * much to say in one breath, and too easy to get wrong in one, so it is a
 * short conversation: the column labels, then each row, then "done", then the
 * table as it will look and a yes. The recorder holds the conversation
 * (CaptureScreen); this file is the words: splitting what was said into
 * cells, hearing "done", and writing the markdown. Pure, so every way of
 * saying a row is a test.
 */

/** "Done", "that's it", "no more rows": the rows are finished. */
const DONE = /^(?:(?:ok(?:ay)?|um+|uh+|and)[,\s]+)?(?:done|i'm done|we're done|that's it|that is it|that's all|that is all|finished|no more(?: rows)?|nothing else|end (?:of )?(?:the )?table|finish(?: the)? table|that's the table)$/i;

export function saysDone(text: string): boolean {
  return DONE.test(text.trim().replace(/[.!?,]+$/, '').trim());
}

/** Words that name a column or row position, said before a cell: "column one, bug". */
const POSITION = /^(?:(?:column|row|cell)\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)|first|second|third|fourth|fifth|next|then|last)[,:\s]+/i;

/**
 * What was said, as cells. People say a row the way they say a list, so
 * commas (or semicolons) split it, with "and" before the last one; with no
 * commas, "and" alone does. "Column one, bug, column two, owner" keeps only
 * the cells.
 */
export function cellsOf(text: string): string[] {
  // Whisper often writes the pauses between cells as full stops: "Item. Where. Packed."
  const said = text
    .trim()
    .replace(/^[\s.,;:!?]+/, '')
    .replace(/[.!?]+$/, '')
    .replace(/\.\s+/g, ', ')
    .trim();
  if (!said) return [];
  // "Bug, owner and status": the last of a comma list carries the "and".
  const parts = /[,;]/.test(said)
    ? said.split(/\s*[,;]\s*/).flatMap((part, i, all) => (i === all.length - 1 ? part.split(/\s+and\s+/i) : [part]))
    : said.split(/\s+and\s+/i);
  return parts
    .map((part) => part.replace(/^(?:and|then)\s+/i, '').replace(POSITION, '').trim())
    .filter((part) => part && !/^(?:column|row)\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)$/i.test(part))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1));
}

/**
 * A row fitted to the columns: a short one is padded with empty cells, and a
 * long one keeps its extra words in the last cell rather than inventing a column.
 */
export function fitRow(cells: readonly string[], columns: number): string[] {
  if (columns <= 0) return [...cells];
  if (cells.length <= columns) return [...cells, ...Array<string>(columns - cells.length).fill('')];
  return [...cells.slice(0, columns - 1), cells.slice(columns - 1).join(', ')];
}

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

/** The table in GFM markdown: header, divider, rows. */
export function tableMarkdown(columns: readonly string[], rows: readonly (readonly string[])[]): string {
  const line = (cells: readonly string[]) => `| ${cells.map(cell).join(' | ')} |`;
  return [line(columns), line(columns.map(() => '---')), ...rows.map((row) => line(fitRow(row, columns.length)))].join('\n');
}

/** `body` with `block` as its own block at the end. */
export function appendBlock(body: string, block: string): string {
  const base = body.replace(/\s+$/, '');
  return `${base}${base ? '\n\n' : ''}${block}\n`;
}
