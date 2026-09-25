import { useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronUp, GripVertical, X } from '@glacier/icons';
import { useRowDrag } from './rowDrag.ts';
import { useBack } from '../core/back.ts';
import { useSheetDrag } from '../editor/sheetDrag.ts';
import { sameTitle } from '../editor/wikiLinks.ts';
import { SheetField, SheetGroup, SheetNote, SheetRow, SheetTitle } from '../plugins/kit.tsx';
import sheet from '../editor/NoteSettings.module.css';
import styles from './NewBookSheet.module.css';

/**
 * Making a book (Matt: "expand the UI/UX for creating books, allow choosing existing notes as pages"): a sheet in
 * the New sheet's own look that asks for the name, then which notes are its pages and in what order. The library's
 * notes are listed under a search; a tap puts one in the book and a second tap takes it out, and the pages so far
 * stand above the list in the order they were chosen, each movable a place or removable. Making the book writes
 * one note with those pages as its index (book/book.ts `bookNoteBody`) and opens it. Nothing is written until then:
 * closing the sheet makes nothing.
 */

export interface NewBookSheetProps {
  open: boolean;
  onClose: () => void;
  /** Every note that could be a page: the library's titles, less the books (a book of books is not a page). */
  titles: readonly string[];
  onCreate: (title: string, pages: readonly string[]) => void;
}

export function NewBookSheet({ open, onClose, titles, onCreate }: NewBookSheetProps) {
  const panel = useRef<HTMLElement>(null);
  const drag = useSheetDrag(panel, onClose);
  useBack(open, onClose);
  const [name, setName] = useState('');
  const [find, setFind] = useState('');
  const [pages, setPages] = useState<string[]>([]);
  const pageEls = useRef<(HTMLElement | null)[]>([]);
  const rows = useRowDrag(
    () => pageEls.current,
    (from, to) =>
      setPages((was) => {
        const next = [...was];
        const [moved] = next.splice(from, 1);
        if (moved !== undefined) next.splice(to, 0, moved);
        return next;
      }),
  );
  const found = useMemo(() => {
    const needle = find.trim().toLowerCase();
    return titles.filter((t) => t.trim() && (!needle || t.toLowerCase().includes(needle))).slice(0, 60);
  }, [titles, find]);
  if (!open) return null;

  const chosen = (title: string) => pages.some((p) => sameTitle(p, title));
  const toggle = (title: string) => setPages((was) => (was.some((p) => sameTitle(p, title)) ? was.filter((p) => !sameTitle(p, title)) : [...was, title]));
  const move = (title: string, by: -1 | 1) =>
    setPages((was) => {
      const at = was.findIndex((p) => sameTitle(p, title));
      const to = at + by;
      if (at < 0 || to < 0 || to >= was.length) return was;
      const next = [...was];
      [next[at], next[to]] = [next[to]!, next[at]!];
      return next;
    });
  const make = () => {
    const title = name.trim();
    if (!title) return;
    onClose();
    onCreate(title, pages);
    setName('');
    setFind('');
    setPages([]);
  };

  return (
    <div className={sheet.scrim} onClick={onClose}>
      <section ref={panel} className={`${sheet.sheet} ${styles.sheet}`} role="dialog" aria-modal="true" aria-label="New book" onClick={(e) => e.stopPropagation()}>
        <span className={sheet.grip} aria-hidden="true" {...drag} />
        <SheetTitle>New book</SheetTitle>
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            make();
          }}
        >
          <SheetField label="Name" value={name} placeholder="Field guide" autoFocus onChange={(event) => setName(event.target.value)} />
          <SheetNote>Its pages are notes, in the order you choose. Pick any now, or add them later from the book's index.</SheetNote>

          {pages.length ? (
            <ol className={styles.pages} aria-label="Pages in this book">
              {pages.map((title, i) => (
                <li
                  key={title}
                  ref={(el) => {
                    pageEls.current[i] = el;
                  }}
                  className={styles.page}
                  data-lifted={rows.lifted?.index === i || undefined}
                  style={rows.rowStyle(i)}
                >
                  <span className={styles.grip} aria-hidden="true" {...rows.grip(i)}>
                    <GripVertical size={16} />
                  </span>
                  <span className={styles.number} aria-hidden="true">
                    {i + 1}
                  </span>
                  <span className={styles.pageTitle}>{title}</span>
                  <span className={styles.tools}>
                    <button type="button" className={styles.tool} aria-label={`Move ${title} up`} disabled={i === 0} onClick={() => move(title, -1)}>
                      <ChevronUp size={16} aria-hidden="true" />
                    </button>
                    <button type="button" className={styles.tool} aria-label={`Move ${title} down`} disabled={i === pages.length - 1} onClick={() => move(title, 1)}>
                      <ChevronDown size={16} aria-hidden="true" />
                    </button>
                    <button type="button" className={styles.tool} aria-label={`Leave ${title} out`} onClick={() => toggle(title)}>
                      <X size={16} aria-hidden="true" />
                    </button>
                  </span>
                </li>
              ))}
            </ol>
          ) : null}

          <SheetField label="Find a note" value={find} placeholder="Type to find" onChange={(event) => setFind(event.target.value)} />
          <ul className={styles.found} aria-label="Notes">
            {found.length === 0 ? <li className={styles.none}>{titles.length ? 'No note by that name.' : 'No notes yet: the book starts empty, and pages can be added from its index.'}</li> : null}
            {found.map((title) => {
              const on = chosen(title);
              return (
                <li key={title}>
                  <button type="button" className={styles.pick} aria-pressed={on} onClick={() => toggle(title)}>
                    <span className={styles.pickMark} aria-hidden="true">
                      {on ? <Check size={14} /> : null}
                    </span>
                    <span className={styles.pickTitle}>{title}</span>
                  </button>
                </li>
              );
            })}
          </ul>

          <SheetGroup>
            <SheetRow label="Make the book" hint={pages.length ? `${pages.length} page${pages.length === 1 ? '' : 's'}, in this order.` : 'Empty, with its index ready.'} onPress={make} disabled={!name.trim()} />
          </SheetGroup>
        </form>
      </section>
    </div>
  );
}
