import { frontMatterValue } from '../core/frontMatter.ts';
import { noteTitle, withoutFrontMatter, type Note } from '../core/store.ts';
import { sameTitle } from '../editor/wikiLinks.ts';

/**
 * A book: a collection of notes in an order, with an index (Matt: "add a Book feature it should be a collection of
 * organized notes with an index"). Like a board and a canvas, it is a note, and its index is its body: a list of
 * `[[links]]` to the chapters, in order, a chapter indented under another being a part of it. The file reads as a
 * table of contents in any Markdown app, and every link in it is a link there too. What makes the note a book rather
 * than a note with a list of links is one line of front matter, `book: true`, which is what the app draws the index
 * from (book/BookView.tsx) and what a chapter's screen looks for to find the book it is in (`bookOf`).
 *
 * Words that are not list items - a paragraph before the list, a heading - are the book's own and are kept where
 * they are: the index view shows them over the chapters. Nothing here touches a chapter note; a chapter is any note,
 * found by its title, and a title with no note yet is a chapter still to be written.
 */

export interface Chapter {
  title: string;
  /** 0 for a chapter, 1 for a chapter indented under the one before (a part's chapter). */
  depth: 0 | 1;
  /** The line of the body it is on. */
  line: number;
}

/** A list item, with what follows its marker. */
const ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/;
/** The first `[[link]]` on a line; a `#heading` or `|alias` after the title is not part of the title. */
const LINK = /\[\[([^\]\n|#]{1,120})(?:[#|][^\]\n]*)?\]\]/;

/** Whether a note is a book: its front matter says so. */
export function isBookBody(body: string): boolean {
  const said = frontMatterValue(body, 'book');
  return said !== null && /^(true|yes)$/i.test(said);
}

/** The body of a new book note, named, with any chapters given in order. */
export function bookNoteBody(title: string, chapters: readonly string[] = []): string {
  const safe = title.replace(/["\n]/g, "'").trim() || 'Book';
  const index = chapters.map((chapter) => `- [[${chapter.trim()}]]`).join('\n');
  return `---\ntitle: "${safe}"\nbook: true\n---\n# ${safe}\n\n${index}${index ? '\n' : ''}`;
}

/** The chapters of a book, in the index's order. */
export function chaptersOf(body: string): Chapter[] {
  const lines = body.split('\n');
  const chapters: Chapter[] = [];
  let inFrontMatter = /^(---|\+\+\+)\s*$/.test(lines[0] ?? '');
  for (let n = inFrontMatter ? 1 : 0; n < lines.length; n += 1) {
    const line = lines[n]!;
    if (inFrontMatter) {
      if (/^(---|\+\+\+)\s*$/.test(line)) inFrontMatter = false;
      continue;
    }
    const item = ITEM.exec(line);
    if (!item) continue;
    const link = LINK.exec(item[2] ?? '');
    if (!link) continue;
    chapters.push({ title: link[1]!.trim(), depth: (item[1] ?? '').length >= 2 ? 1 : 0, line: n });
  }
  return chapters;
}

/** The chapter numbers as the index shows them: "1", "2", "2.1", "2.2", "3". */
export function numbered(chapters: readonly Chapter[]): string[] {
  let major = 0;
  let minor = 0;
  return chapters.map((chapter) => {
    if (chapter.depth === 0) {
      major += 1;
      minor = 0;
      return String(major);
    }
    minor += 1;
    return `${Math.max(major, 1)}.${minor}`;
  });
}

/** The body with a chapter added: after `after` where that chapter is in the index, else last. */
export function withChapter(body: string, title: string, after: string | null = null): string {
  const clean = title.trim();
  if (!clean) return body;
  const lines = body.split('\n');
  const chapters = chaptersOf(body);
  if (chapters.some((c) => sameTitle(c.title, clean))) return body;
  const place = after ? chapters.find((c) => sameTitle(c.title, after)) : chapters[chapters.length - 1];
  if (place) {
    const indent = place.depth === 1 ? '  ' : '';
    lines.splice(place.line + 1, 0, `${indent}- [[${clean}]]`);
    return lines.join('\n');
  }
  // No index yet: the first chapter goes at the end, after a blank line, and the body ends with a newline.
  while (lines.length && lines[lines.length - 1]!.trim() === '') lines.pop();
  lines.push(lines.length ? '' : '', `- [[${clean}]]`, '');
  return lines.join('\n').replace(/^\n/, '');
}

/** The body with a chapter's line taken out of the index; the note it names is untouched. */
export function withoutChapter(body: string, title: string): string {
  const chapter = chaptersOf(body).find((c) => sameTitle(c.title, title));
  if (!chapter) return body;
  const lines = body.split('\n');
  lines.splice(chapter.line, 1);
  return lines.join('\n');
}

/** The body with a chapter moved one place up (-1) or down (1) in the index; at either end, as it was. */
export function withChapterMoved(body: string, title: string, by: -1 | 1): string {
  const chapters = chaptersOf(body);
  const at = chapters.findIndex((c) => sameTitle(c.title, title));
  const other = at + by;
  if (at < 0 || other < 0 || other >= chapters.length) return body;
  const lines = body.split('\n');
  const a = chapters[at]!.line;
  const b = chapters[other]!.line;
  [lines[a], lines[b]] = [lines[b]!, lines[a]!];
  return lines.join('\n');
}

/**
 * The body with a chapter moved to the place of the chapter now `to`th in the index (0-based); past the end, last.
 * What a drag does (book/rowDrag.ts): the line leaves where it was and lands where the finger let go, at that row's
 * depth.
 */
export function withChapterAt(body: string, title: string, to: number): string {
  const chapters = chaptersOf(body);
  const from = chapters.findIndex((c) => sameTitle(c.title, title));
  if (from < 0) return body;
  const target = Math.max(0, Math.min(chapters.length - 1, to));
  if (target === from) return body;
  const lines = body.split('\n');
  const [line] = lines.splice(chapters[from]!.line, 1);
  // The lines after the one taken out have moved up by one.
  const landing = chapters[target]!.line - (target > from ? 1 : 0);
  const depth = chapters[target]!.depth;
  const words = (line ?? '').trim();
  lines.splice(landing + (target > from ? 1 : 0), 0, `${depth === 1 ? '  ' : ''}${words}`);
  return lines.join('\n');
}

/** Where a note stands in a book: the book, its chapters, and which one this is. */
export interface BookPlace {
  book: Note;
  title: string;
  chapters: Chapter[];
  at: number;
}

/**
 * The book a note is a chapter of, by its title, or null: the first book in the library whose index names it. A
 * book is not a chapter of itself.
 */
export function bookOf(notes: readonly Note[], title: string): BookPlace | null {
  const clean = title.trim();
  if (!clean) return null;
  for (const note of notes) {
    if (!isBookBody(note.body)) continue;
    const bookTitle = noteTitle(note.body);
    if (sameTitle(bookTitle, clean)) continue;
    const chapters = chaptersOf(note.body);
    const at = chapters.findIndex((c) => sameTitle(c.title, clean));
    if (at >= 0) return { book: note, title: bookTitle, chapters, at };
  }
  return null;
}

/** A title as `sameTitle` matches it (editor/wikiLinks.ts): what a person said, not what they typed. */
export function titleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Every page's book at once, by the page's title as it is matched: what a list draws its marks from (the sidebar's
 * rows, the home page's cards; Matt: "book mark in the sidebar"), one pass over the books rather than one per row.
 * A page in two books is marked with the first, as `bookOf` answers.
 */
export function bookIndex(notes: readonly Note[]): Map<string, BookPlace> {
  const places = new Map<string, BookPlace>();
  for (const note of notes) {
    if (!isBookBody(note.body)) continue;
    const title = noteTitle(note.body);
    const chapters = chaptersOf(note.body);
    chapters.forEach((chapter, at) => {
      const key = titleKey(chapter.title);
      if (!key || key === titleKey(title) || places.has(key)) return;
      places.set(key, { book: note, title, chapters, at });
    });
  }
  return places;
}

/** The book a note is a page of, from the index: null for a note in none, or for a book itself. */
export function placeOf(index: ReadonlyMap<string, BookPlace>, note: Note): BookPlace | null {
  if (isBookBody(note.body)) return null;
  return index.get(titleKey(noteTitle(note.body))) ?? null;
}

/**
 * A chapter's words for reading straight through: its front matter gone, and its first heading gone where it is the
 * chapter's own title, since the section that draws it names it. What is left keeps its marks.
 */
export function bodyWithoutTitle(body: string, title: string): string {
  // `withoutFrontMatter` puts the front matter's `title:` where the fences were, as a line, so the list can name the
  // note; here that line is the title too, and goes with any heading of the same name under it.
  const lines = withoutFrontMatter(body.split('\n'));
  for (let pass = 0; pass < 2; pass += 1) {
    const first = lines.findIndex((l) => l.trim());
    if (first < 0) break;
    const line = lines[first]!;
    const words = (/^#{1,6}\s+(.*)$/.exec(line)?.[1] ?? line).trim();
    if (!sameTitle(words, title)) break;
    lines.splice(0, first + 1);
  }
  while (lines.length && !lines[0]!.trim()) lines.shift();
  return lines.join('\n');
}

/** The lines of the body that are the book's own words, not its index and not its front matter: shown over it. */
export function prefaceOf(body: string): string[] {
  const lines = body.split('\n');
  const out: string[] = [];
  let inFrontMatter = /^(---|\+\+\+)\s*$/.test(lines[0] ?? '');
  for (let n = inFrontMatter ? 1 : 0; n < lines.length; n += 1) {
    const line = lines[n]!;
    if (inFrontMatter) {
      if (/^(---|\+\+\+)\s*$/.test(line)) inFrontMatter = false;
      continue;
    }
    if (ITEM.test(line) && LINK.test(line)) continue;
    // The heading that names the book is the header's, not the page's.
    if (n <= 5 && /^#\s+/.test(line) && out.length === 0) continue;
    if (line.trim()) out.push(line.trim());
  }
  return out;
}
