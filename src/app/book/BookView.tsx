import { useMemo, useRef, useState } from 'react';
import { BookOpen, Check, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, GripVertical, List, Plus, Workflow, X } from '@glacier/icons';
import { isCanvasBody } from '../canvas/jsonCanvas.ts';
import { sameTitle } from '../editor/wikiLinks.ts';
import { bodyWithoutTitle, chaptersOf, numbered, prefaceOf, withChapter, withChapterAt, withChapterMoved, withoutChapter, type BookPlace } from './book.ts';
import { Editor } from '../editor/Editor.tsx';
import { isDarkNow, usePreferences } from '../core/preferences.ts';
import { useRowDrag } from './rowDrag.ts';
import styles from './BookView.module.css';

/**
 * A book's index, drawn where its words would be (editor/NoteScreen.tsx): its own words first, then the chapters,
 * numbered, each a row that opens the note - or makes it, where a chapter is a title with no note yet, which the row
 * says. The index is edited here in the three ways an index is: a chapter added (a new one, named here and opened at
 * once; or a note already written, picked from the library), moved a place up or down, or taken out - none of which
 * touches the chapter's own note. Every change is a change to the book note's body (book/book.ts), written the way
 * typing is, so the Markdown behind the view is always the index it shows, and the view is a toggle away from it.
 *
 * A chapter can be a canvas (Matt: "Add the ability for canvases to be in books as well"): a canvas is a note found
 * by its title like any other, so it was always a page a book could hold and open - what the index lacked was saying
 * so. A chapter that is a canvas, and a canvas offered in the picker, wear the canvas's own mark (the one the + sheet
 * gives it), so a book reads as the pages and the boards of cards it is made of.
 */

interface BookViewProps {
  body: string;
  /** Whether a note by that title exists: a chapter still to be written is drawn as waiting. */
  known: (title: string) => boolean;
  /** Opens the note by that title, or makes one that starts with it (App.tsx `openTitle`). */
  open: (title: string) => void;
  /** Every note's title, for adding one that is already written. */
  titles: () => string[];
  /** The book's own title, so it is not offered as a chapter of itself. */
  title: string;
  onChange: (body: string) => void;
  /** A note's body by its title, to tell a chapter that is a canvas from one of words; absent, none is marked. */
  bodyOf?: (title: string) => string | null;
}

/** The canvas's mark, beside a title that is a canvas. */
function CanvasMark() {
  return (
    <span className={styles.canvasMark} title="A canvas">
      <Workflow size={13} strokeWidth={2.2} aria-hidden="true" />
    </span>
  );
}

export function BookView({ body, known, open, titles, title, onChange, bodyOf }: BookViewProps) {
  const isCanvas = (name: string) => {
    const found = bodyOf?.(name);
    return !!found && isCanvasBody(found);
  };
  const chapters = useMemo(() => chaptersOf(body), [body]);
  const numbers = useMemo(() => numbered(chapters), [chapters]);
  const preface = useMemo(() => prefaceOf(body), [body]);
  const [adding, setAdding] = useState<'new' | 'existing' | null>(null);
  /** Reading straight through: the chapters one after another, each in the note's own read-only editor. */
  const [reading, setReading] = useState(false);
  const dark = isDarkNow(usePreferences().theme);
  const [draft, setDraft] = useState('');
  const [filter, setFilter] = useState('');
  /** The notes ticked so far in the picker, in the order they were ticked. */
  const [picked, setPicked] = useState<string[]>([]);
  /** The rows, for a drag to measure; and the drag itself, which writes the chapter to where it was let go. */
  const rowEls = useRef<(HTMLElement | null)[]>([]);
  const drag = useRowDrag(
    () => rowEls.current,
    (from, to) => {
      const chapter = chapters[from];
      if (chapter) onChange(withChapterAt(body, chapter.title, to));
    },
  );

  const addNew = () => {
    const name = draft.trim();
    if (!name) return;
    onChange(withChapter(body, name));
    setDraft('');
    setAdding(null);
    open(name);
  };
  const togglePick = (name: string) => setPicked((was) => (was.some((p) => sameTitle(p, name)) ? was.filter((p) => !sameTitle(p, name)) : [...was, name]));
  const addPicked = () => {
    let next = body;
    for (const name of picked) next = withChapter(next, name);
    onChange(next);
    setPicked([]);
    setFilter('');
    setAdding(null);
  };
  const others = adding === 'existing' ? titles().filter((t) => t.trim() && !sameTitle(t, title) && !chapters.some((c) => sameTitle(c.title, t)) && (!filter.trim() || t.toLowerCase().includes(filter.trim().toLowerCase()))) : [];

  if (reading) {
    return (
      <div className={`${styles.book} ${styles.reading}`} data-chapters={chapters.length} data-reading="">
        {/* The way back, and the chapters as a rail: a tap scrolls to that one. */}
        <div className={styles.readBar}>
          <button type="button" className={styles.action} onClick={() => setReading(false)}>
            <List size={16} aria-hidden="true" /> Index
          </button>
          <nav className={styles.rail} aria-label="Chapters">
            {chapters.map((chapter, i) => (
              <button
                key={`${chapter.line}-${chapter.title}`}
                type="button"
                className={styles.railItem}
                data-depth={chapter.depth}
                onClick={() => document.getElementById(`book-chapter-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              >
                <span className={styles.railNumber}>{numbers[i]}</span> {chapter.title}
              </button>
            ))}
          </nav>
        </div>
        {chapters.map((chapter, i) => {
          const there = known(chapter.title);
          const words = there ? (bodyOf?.(chapter.title) ?? null) : null;
          const canvas = words !== null && isCanvasBody(words);
          return (
            <section key={`${chapter.line}-${chapter.title}`} id={`book-chapter-${i}`} className={styles.chapterRead} data-depth={chapter.depth} aria-label={chapter.title}>
              <h2 className={styles.readTitle}>
                <button type="button" className={styles.readTitleButton} onClick={() => open(chapter.title)} aria-label={`Open ${chapter.title}`}>
                  <span className={styles.number} aria-hidden="true">
                    {numbers[i]}
                  </span>
                  {chapter.title}
                  {canvas ? <CanvasMark /> : null}
                </button>
              </h2>
              {!there ? (
                <p className={styles.readNote}>Not written yet.</p>
              ) : canvas ? (
                <p className={styles.readNote}>A canvas: open it to see the cards.</p>
              ) : words === null ? null : (
                <div className={styles.readBody}>
                  <Editor value={bodyWithoutTitle(words, chapter.title)} onChange={noop} dark={dark} assist={false} readOnly display="formatted" peek grow />
                </div>
              )}
            </section>
          );
        })}
      </div>
    );
  }

  return (
    <div className={styles.book} data-chapters={chapters.length}>
      {preface.length > 0 ? (
        <div className={styles.preface}>
          {preface.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      ) : null}
      {chapters.length === 0 ? (
        <p className={styles.empty}>No chapters yet. Add one below, or a note you have already written.</p>
      ) : (
        <ol className={styles.index} aria-label="Chapters">
          {chapters.map((chapter, i) => {
            const there = known(chapter.title);
            const canvas = there && isCanvas(chapter.title);
            return (
              <li
                key={`${chapter.line}-${chapter.title}`}
                ref={(el) => {
                  rowEls.current[i] = el;
                }} className={styles.row} data-depth={chapter.depth} data-waiting={there ? undefined : ''}
                data-lifted={drag.lifted?.index === i || undefined}
                style={drag.rowStyle(i)}
              >
                <span className={styles.grip} aria-hidden="true" {...drag.grip(i)}>
                  <GripVertical size={16} />
                </span>
                <span className={styles.number} aria-hidden="true">
                  {numbers[i]}
                </span>
                <button
                  type="button"
                  className={styles.chapter}
                  onClick={() => open(chapter.title)}
                  aria-label={there ? (canvas ? `${chapter.title}, a canvas` : chapter.title) : `${chapter.title}, not written yet`}
                >
                  <span className={styles.chapterTitle}>
                    {chapter.title}
                    {canvas ? <CanvasMark /> : null}
                  </span>
                  {there ? null : <span className={styles.waiting}>not written yet</span>}
                </button>
                <span className={styles.tools}>
                  <button type="button" className={styles.tool} aria-label={`Move ${chapter.title} up`} disabled={i === 0} onClick={() => onChange(withChapterMoved(body, chapter.title, -1))}>
                    <ChevronUp size={16} aria-hidden="true" />
                  </button>
                  <button type="button" className={styles.tool} aria-label={`Move ${chapter.title} down`} disabled={i === chapters.length - 1} onClick={() => onChange(withChapterMoved(body, chapter.title, 1))}>
                    <ChevronDown size={16} aria-hidden="true" />
                  </button>
                  <button type="button" className={styles.tool} aria-label={`Take ${chapter.title} out of the book`} onClick={() => onChange(withoutChapter(body, chapter.title))}>
                    <X size={16} aria-hidden="true" />
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {adding === 'new' ? (
        <form
          className={styles.add}
          onSubmit={(event) => {
            event.preventDefault();
            addNew();
          }}
        >
          <input
            className={styles.field}
            aria-label="New chapter's title"
            placeholder="Chapter title"
            value={draft}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setAdding(null);
            }}
          />
          <button type="submit" className={styles.action} disabled={!draft.trim()}>
            Add and open
          </button>
          <button type="button" className={styles.quiet} onClick={() => setAdding(null)}>
            Cancel
          </button>
        </form>
      ) : adding === 'existing' ? (
        <div className={styles.add}>
          <input className={styles.field} aria-label="Find a note to add" placeholder="Find a note" value={filter} autoFocus onChange={(event) => setFilter(event.target.value)} />
          <ul className={styles.picker} aria-label="Notes to add">
            {others.length === 0 ? <li className={styles.none}>{filter.trim() ? 'No note by that name outside the book.' : 'Every note is in the book already.'}</li> : null}
            {others.slice(0, 40).map((name) => {
              const on = picked.some((p) => sameTitle(p, name));
              return (
                <li key={name}>
                  <button type="button" className={styles.pick} aria-pressed={on} onClick={() => togglePick(name)}>
                    <span className={styles.pickMark} aria-hidden="true">
                      {on ? <Check size={14} /> : null}
                    </span>
                    {name}
                    {isCanvas(name) ? <CanvasMark /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
          <button type="button" className={styles.action} disabled={picked.length === 0} onClick={addPicked}>
            {picked.length <= 1 ? 'Add' : `Add ${picked.length} notes`}
          </button>
          <button
            type="button"
            className={styles.quiet}
            onClick={() => {
              setPicked([]);
              setAdding(null);
            }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className={styles.adds}>
          <button type="button" className={styles.action} onClick={() => setAdding('new')}>
            <Plus size={16} aria-hidden="true" /> Add a chapter
          </button>
          <button type="button" className={styles.action} onClick={() => setAdding('existing')}>
            <BookOpen size={16} aria-hidden="true" /> Add a note you have
          </button>
          {chapters.length ? (
            <button type="button" className={styles.action} onClick={() => setReading(true)}>
              <BookOpen size={16} aria-hidden="true" /> Read straight through
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * The bar a chapter wears under its header: the book it is in, its place in it, and the chapters either side
 * (`bookOf` in book/book.ts finds them). A tap on the book opens the index; the ends open the neighbours.
 */
export function BookBar({ place, open }: { place: BookPlace; open: (title: string) => void }) {
  const prev = place.at > 0 ? place.chapters[place.at - 1]!.title : null;
  const next = place.at < place.chapters.length - 1 ? place.chapters[place.at + 1]!.title : null;
  return (
    <nav className={styles.bar} aria-label="Book">
      <button type="button" className={styles.end} disabled={!prev} onClick={() => prev && open(prev)} aria-label={prev ? `Previous chapter: ${prev}` : 'First chapter'}>
        <ChevronLeft size={16} aria-hidden="true" />
        <span className={styles.endTitle}>{prev ?? ''}</span>
      </button>
      <button type="button" className={styles.middle} onClick={() => open(place.title)} aria-label={`Open the book ${place.title}`}>
        <BookOpen size={15} aria-hidden="true" />
        <span className={styles.bookTitle}>{place.title}</span>
        <span className={styles.count}>
          {place.at + 1} of {place.chapters.length}
        </span>
      </button>
      <button type="button" className={styles.end} data-next="" disabled={!next} onClick={() => next && open(next)} aria-label={next ? `Next chapter: ${next}` : 'Last chapter'}>
        <span className={styles.endTitle}>{next ?? ''}</span>
        <ChevronRight size={16} aria-hidden="true" />
      </button>
    </nav>
  );
}

function noop(): void {
  // Read-only: nothing typed comes back.
}
