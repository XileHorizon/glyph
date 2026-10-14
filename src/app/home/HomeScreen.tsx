import { useEffect, useMemo, useRef, useState } from 'react';
import { Book, Mic } from '@glacier/icons';
import { noteTitle, type Note } from '../core/store.ts';
import { inWorkspace, useWorkspaces, type Workspace } from '../core/workspaces.ts';
import type { VoiceModelState } from '../capture/useVoiceModel.ts';
import type { Updates } from '../core/ota.ts';
import { useGlideToTop } from '../core/glideToTop.ts';
import { useWispEdge } from '../art/wispEdge.ts';
import { Ghost } from '../art/Ghost.tsx';
import { Cog, Pin, Plus } from '../art/Icons.tsx';
import { NotePeek } from '../notes/NotePeek.tsx';
import { WorkspaceBar } from '../notes/WorkspaceBar.tsx';
import { WorkspaceSheet } from '../notes/WorkspaceSheet.tsx';
import { AcademyCard, RefiningNotice, UpdateNotice, VoiceModelStatus } from '../notes/Notices.tsx';
import { when } from '../notes/when.ts';
import { useGists } from '../format/gist.ts';
import { shortenUrls } from '../core/shortUrl.ts';
import { bookNotes, openTasks, pinnedNotes, recentNotes, tickedTasks, type OpenTask } from './dashboard.ts';
import { bookIndex, chaptersOf, placeOf } from '../book/book.ts';
import styles from './HomeScreen.module.css';

/**
 * The home page (Matt: "Add a 'home' button to take us to a dashboard like page"; he chose a new page on every screen,
 * the phone's start page included). The top bar's Glyph mark brings you here from anywhere.
 *
 * What a person comes back to Glyph for, in the order they want it: anything waiting on them (an update, a memo to
 * sort, the voice model), the notes they pinned, the ones they were in last, and every to-do not yet ticked, gathered
 * from all of their notes - ticked here without opening the note. Every note is one tap away in the sidebar, so the
 * page does not list them all again; "All notes" opens it.
 *
 * It took the place of the notes list, and kept what the list had that was not the list: the glass bar and scroller,
 * the workspace pills choosing what it shows, and the dock, so starting a note is where it always was.
 */

interface HomeScreenProps {
  notes: Note[];
  loading: boolean;
  onOpen: (id: string, at?: string) => void;
  onNew: () => void;
  onCapture: () => void;
  onSettings: () => void;
  /** Every note: the sidebar, which holds them all. */
  onAllNotes: () => void;
  /** A to-do ticked from here: its note's line rewritten with the box ticked. */
  onTick: (task: OpenTask) => void;
  voiceModel: VoiceModelState;
  onRetryVoiceModel: () => void;
  updates: Updates;
  showAcademy?: boolean;
  onAcademy?: () => void;
  onHideAcademy?: () => void;
}

/** How many of the notes touched last are shown, and how many to-dos before the rest are counted instead. */
const RECENT = 6;
const TASKS = 8;

export function HomeScreen({
  notes,
  loading,
  onOpen,
  onNew,
  onCapture,
  onSettings,
  onAllNotes,
  onTick,
  voiceModel,
  onRetryVoiceModel,
  updates,
  showAcademy = false,
  onAcademy,
  onHideAcademy,
}: HomeScreenProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const topBar = useRef<HTMLElement>(null);
  // Smoke at both ends: under the bar, and at the page's very foot, with the notes running on under the dock's
  // buttons down to it (Matt: "Make the bottom bar transparent and move the dark gradient down").
  useWispEdge(scroller, 'home', topBar, { foot: true });
  const spaces = useWorkspaces();
  const [manage, setManage] = useState<Workspace | 'new' | null>(null);
  // Another workspace chosen: the page glides back to its top rather than jumping there.
  useGlideToTop(scroller, spaces.current?.id ?? 'all');
  // The chosen workspace chooses the page too, as it chose the list. Held steady between renders, since the cards it
  // works out are what the gist runner is given: a fresh array every time a to-do is ticked would put its work off.
  const workspace = spaces.current?.id ?? null;
  const shown = useMemo(() => inWorkspace(notes, workspace), [notes, workspace]);
  const pinned = useMemo(() => pinnedNotes(shown), [shown]);
  const recent = useMemo(() => recentNotes(shown, RECENT), [shown]);
  const books = useMemo(() => bookNotes(shown), [shown]);
  /** Every page's book, for the cards' marks (book/book.ts). */
  const inBooks = useMemo(() => bookIndex(shown), [shown]);
  const tasks = openTasks(shown);
  // One quiet line under each card's title, what the note is about, written by a model on the phone (format/gist.ts).
  // Only the notes with a card on the page: the runner asks about what is on screen, not about every note there is.
  const carded = useMemo(() => [...pinned, ...recent], [pinned, recent]);
  const gists = useGists(carded);
  const titleOf = new Map(notes.map((n) => [n.id, noteTitle(n.body) || 'Untitled']));
  // A tick lands on the page at once; the note catches up when it has been written.
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  // Once the notes have been read again they say it themselves, and a line number may now be another to-do's.
  useEffect(() => setTicked(new Set()), [notes]);
  const open = tasks.filter((t) => !ticked.has(`${t.noteId}:${t.line}`));
  // With none left open, a page that had to-dos says they are done; one that never had any says nothing.
  const allDone = !open.length && (ticked.size > 0 || tickedTasks(shown) > 0);

  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  const card = (note: Note, i: number) => {
    const title = noteTitle(note.body);
    const place = placeOf(inBooks, note);
    return (
      <li key={note.id} className={styles.cardItem} style={{ '--i': Math.min(i, 8) } as React.CSSProperties}>
        <button type="button" className={styles.card} onClick={() => onOpen(note.id)}>
          <span className={styles.cardTitle} data-untitled={title ? undefined : ''}>
            {title ? shortenUrls(title) : 'Untitled'}
          </span>
          {/* A page of a book says which (docs/BOOKS.md). */}
          {place ? (
            <span className={styles.cardBook} title={`Page ${place.at + 1} of ${place.title}`}>
              <Book size={12} aria-hidden="true" />
              <span className={styles.cardBookName}>{place.title}</span>
            </span>
          ) : null}
          {/* What the note is about, when the phone has written it; the preview under it is the note itself. */}
          {gists[note.id] ? <span className={styles.cardGist}>{gists[note.id]}</span> : null}
          <NotePeek body={note.body} className={styles.cardPeek} />
          <span className={styles.cardWhen}>{when(note.updatedAt)}</span>
        </button>
      </li>
    );
  };

  /** A book's card (docs/BOOKS.md): its name, how many pages, and the first few of them; a tap opens the index. */
  const bookCard = (note: Note, i: number) => {
    const title = noteTitle(note.body);
    const chapters = chaptersOf(note.body);
    return (
      <li key={note.id} className={styles.cardItem} style={{ '--i': Math.min(i, 8) } as React.CSSProperties}>
        <button type="button" className={styles.card} onClick={() => onOpen(note.id)}>
          <span className={styles.cardTitle} data-untitled={title ? undefined : ''}>
            {title || 'Untitled book'}
          </span>
          <span className={styles.bookMeta}>{chapters.length === 0 ? 'No pages yet' : chapters.length === 1 ? '1 page' : `${chapters.length} pages`}</span>
          {chapters.length ? (
            <ol className={styles.bookPages} aria-hidden="true">
              {chapters.slice(0, 4).map((c, n) => (
                <li key={`${c.line}-${c.title}`} data-depth={c.depth}>
                  <span className={styles.bookPageNumber}>{n + 1}</span>
                  {c.title}
                </li>
              ))}
              {chapters.length > 4 ? <li className={styles.bookMore}>and {chapters.length - 4} more</li> : null}
            </ol>
          ) : null}
          <span className={styles.cardWhen}>{when(note.updatedAt)}</span>
        </button>
      </li>
    );
  };

  return (
    <div className={styles.screen}>
      <header ref={topBar} className={`app-headerPane ${styles.topBar}`}>
        {/* The name is for a screen reader, which has no bar to look at; the bar shows where you are with its mark. */}
        <h1 className={styles.saidOnly}>Home</h1>
      </header>
      <div ref={scroller} className={styles.scroll}>
        <div className={styles.page}>
          <p className={styles.today}>{today}</p>
          <WorkspaceBar onManage={setManage} />
          <UpdateNotice updates={updates} />
          <VoiceModelStatus state={voiceModel} onRetry={onRetryVoiceModel} />
          {showAcademy && onAcademy ? <AcademyCard onOpen={onAcademy} onHide={onHideAcademy} /> : null}
          <RefiningNotice />

          {!loading && shown.filter((n) => !n.archivedAt).length === 0 ? (
            <div className={styles.empty}>
              <Ghost scene={spaces.current ? 'empty-workspace' : 'no-notes'} size="lead" className={styles.emptyArt} />
              <p className={styles.emptyLead}>{spaces.current ? `Nothing in ${spaces.current.name} yet.` : 'A blank page.'}</p>
              <p className={styles.emptyHint}>Write it, or hold the side key and say it.</p>
            </div>
          ) : null}

          {pinned.length ? (
            <section aria-labelledby="home-pinned">
              <h2 id="home-pinned" className={styles.group}>
                <Pin className={styles.groupIcon} />
                Pinned
              </h2>
              <ol className={styles.cards}>{pinned.map(card)}</ol>
            </section>
          ) : null}

          {books.length ? (
            <section aria-labelledby="home-library">
              <h2 id="home-library" className={styles.group}>
                <Book className={styles.groupIconStill} />
                Library
              </h2>
              <ol className={styles.cards}>{books.map((n, i) => bookCard(n, i + pinned.length))}</ol>
            </section>
          ) : null}

          {recent.length ? (
            <section aria-labelledby="home-recent">
              <h2 id="home-recent" className={styles.group}>
                Recent
              </h2>
              <ol className={styles.cards}>{recent.map((n, i) => card(n, i + pinned.length + books.length))}</ol>
            </section>
          ) : null}

          {open.length ? (
            <section aria-labelledby="home-tasks">
              <h2 id="home-tasks" className={styles.group}>
                To do <span className={styles.count}>{open.length}</span>
              </h2>
              <ul className={styles.tasks}>
                {open.slice(0, TASKS).map((task) => (
                  <li key={`${task.noteId}:${task.line}`} className={styles.task}>
                    <button
                      type="button"
                      className={styles.box}
                      aria-label={`Tick off ${task.text}`}
                      onClick={() => {
                        setTicked((was) => new Set(was).add(`${task.noteId}:${task.line}`));
                        onTick(task);
                      }}
                    />
                    <button type="button" className={styles.taskOpen} onClick={() => onOpen(task.noteId, task.at)}>
                      <span className={styles.taskText}>{shortenUrls(task.text)}</span>
                      <span className={styles.taskNote}>{titleOf.get(task.noteId)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {open.length > TASKS ? <p className={styles.more}>and {open.length - TASKS} more in your notes</p> : null}
            </section>
          ) : allDone ? (
            <section aria-labelledby="home-tasks" className={styles.allDone}>
              <h2 id="home-tasks" className={styles.group}>
                To do
              </h2>
              <Ghost scene="all-ticked" className={styles.allDoneArt} />
              <p className={styles.allDoneWords}>Every to-do is done.</p>
            </section>
          ) : null}

          <button type="button" className={`app-word ${styles.allNotes}`} onClick={onAllNotes}>
            All notes · {notes.filter((n) => !n.archivedAt).length}
          </button>
        </div>
      </div>

      {/* The dock the notes list had: write on the left, Speak in the middle as the one ink pill, Settings on the right. */}
      <nav className={styles.dock} aria-label="New note">
        <button type="button" className={`${styles.round} ${styles.add}`} onClick={onNew} aria-label="Write a note">
          <Plus />
        </button>
        <button type="button" className={`app-pill ${styles.speak}`} onClick={onCapture} aria-label="Speak a voice note">
          <Mic size={18} strokeWidth={2.2} aria-hidden="true" />
          Speak
        </button>
        <button type="button" className={`${styles.round} ${styles.cog}`} onClick={onSettings} aria-label="Settings">
          <Cog />
        </button>
      </nav>
      <WorkspaceSheet which={manage} onClose={() => setManage(null)} />
    </div>
  );
}
