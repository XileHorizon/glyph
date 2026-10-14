import { BookOpen, X } from '@glacier/icons';
import { noteTitle } from '../core/store.ts';
import { numbered } from '../book/book.ts';
import type { AsideContent } from './aside.ts';
import styles from './Aside.module.css';

/**
 * The right-hand aside (aside.ts says what it holds): a book's index while a book or one of its pages is on screen,
 * the open chapter marked and a tap opening another; otherwise the workspace's other notes. Docked as a column on
 * the split layout, over the note on a phone (App.tsx), and the tab row's mirrored sidebar icon shows and hides it
 * (notes/NoteTabs.tsx). `workspace` names the list's workspace over the notes, or "All notes".
 */
export interface AsideProps {
  content: AsideContent;
  workspace: string | null;
  onOpen: (id: string) => void;
  onOpenTitle: (title: string) => void;
  /** Over the note on a phone: the close, and the tap on the scrim. */
  onClose?: () => void;
}

export function Aside({ content, workspace, onOpen, onOpenTitle, onClose }: AsideProps) {
  return (
    <div className={styles.aside} data-kind={content.kind}>
      {content.kind === 'book' ? (
        <>
          <div className={styles.head}>
            <button type="button" className={styles.headButton} onClick={() => onOpen(content.place.book.id)} aria-label={`Open the book ${content.place.title}`}>
              <BookOpen size={15} aria-hidden="true" />
              <span className={styles.headTitle}>{content.place.title}</span>
            </button>
            {onClose ? (
              <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
                <X size={16} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          {content.place.chapters.length === 0 ? (
            <p className={styles.empty}>No chapters yet.</p>
          ) : (
            <ol className={styles.list} aria-label="Chapters">
              {content.place.chapters.map((chapter, i) => {
                const current = content.place.at === i;
                return (
                  <li key={`${chapter.line}-${chapter.title}`} data-depth={chapter.depth}>
                    <button type="button" className={styles.row} aria-current={current ? 'page' : undefined} data-current={current || undefined} onClick={() => onOpenTitle(chapter.title)}>
                      <span className={styles.number} aria-hidden="true">
                        {numbered(content.place.chapters)[i]}
                      </span>
                      <span className={styles.title}>{chapter.title}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      ) : (
        <>
          <div className={styles.head}>
            <span className={styles.headTitle}>{workspace ?? 'All notes'}</span>
            {onClose ? (
              <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
                <X size={16} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          {content.notes.length === 0 ? (
            <p className={styles.empty}>No other notes here.</p>
          ) : (
            <ol className={styles.list} aria-label="Notes">
              {content.notes.map((note) => {
                const title = noteTitle(note.body);
                return (
                  <li key={note.id}>
                    <button type="button" className={styles.row} onClick={() => onOpen(note.id)}>
                      <span className={styles.title} data-untitled={title ? undefined : ''}>
                        {title || 'Untitled'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}
    </div>
  );
}
