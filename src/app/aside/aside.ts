import { bookIndex, chaptersOf, isBookBody, type BookPlace } from '../book/book.ts';
import { listOrder, noteTitle, type Note } from '../core/store.ts';

/**
 * What the right-hand aside shows (Matt: "a right side aside menu that can pop out book indexes and list other
 * notes from the workspace when not in book view"): in a book - a page of one, or the book itself - its index, the
 * open chapter marked; anywhere else, the other notes of the workspace the list is showing. Pure, so each rule is
 * a test.
 */
export type AsideContent =
  | { kind: 'book'; place: BookPlace; open: string | null }
  | { kind: 'notes'; notes: Note[] };

/**
 * `notes` are the workspace's notes as the list shows them; `open` the note on screen, or null on the home page.
 * A book itself shows its own index with no chapter marked; a page shows its book's with itself marked.
 */
export function asideContent(notes: readonly Note[], open: Note | null): AsideContent {
  if (open) {
    if (isBookBody(open.body)) {
      return { kind: 'book', place: { book: open, title: noteTitle(open.body), chapters: chaptersOf(open.body), at: -1 }, open: null };
    }
    const place = bookIndex(notes).get(keyOf(noteTitle(open.body)));
    if (place) return { kind: 'book', place, open: open.id };
  }
  const others = listOrder(notes.filter((n) => !n.archivedAt && n.id !== open?.id));
  return { kind: 'notes', notes: others };
}

/** The key `bookIndex` files a page under (book/book.ts `titleKey`), without the import cycle a re-export would make. */
function keyOf(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Whether the aside is shown, kept to this device between launches; hidden until it has been opened once. */
const SHOWN_KEY = 'glyph-aside-shown';

export function readAsideShown(): boolean {
  try {
    return localStorage.getItem(SHOWN_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeAsideShown(shown: boolean): void {
  try {
    localStorage.setItem(SHOWN_KEY, shown ? '1' : '0');
  } catch {
    // Not kept: it opens hidden next time.
  }
}
