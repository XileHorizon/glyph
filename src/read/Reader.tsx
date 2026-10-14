import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Download, Plus } from '@glacier/icons';
import { Editor } from '../app/editor/Editor.tsx';
import { CanvasView } from '../app/canvas/CanvasView.tsx';
import { canvasOf, isCanvasBody } from '../app/canvas/jsonCanvas.ts';
import { BookBar } from '../app/book/BookView.tsx';
import { bookOf, chaptersOf, numbered } from '../app/book/book.ts';
import { sameTitle } from '../app/editor/wikiLinks.ts';
import { noteTitle, type Note } from '../app/core/store.ts';
import { readShared, readShareLink, sharedAsFile, type Shared } from '../app/share/share.ts';
import styles from './Reader.module.css';

/**
 * The page a shared note or book is read on (docs/SHARING.md): the link's key opens it here, in the browser, and the
 * server only ever held ciphertext. Made of the app's own parts - the note's editor, read-only and formatted, the
 * canvas, a book's index and the bar a chapter wears - so a note reads here as it does in Ghost.md, and nothing on
 * the page can change it. Two ways to keep it: save a copy into your own Ghost.md, or download it as Markdown.
 */

const dark = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
/** The app beside this page: its own copy saves the share into the reader's library (App.tsx, `#fork=`). */
const APP_URL = new URL('./', typeof location !== 'undefined' ? location.href : 'https://attack.fm/glyph/').href;

type State = { kind: 'loading' } | { kind: 'failed'; message: string } | { kind: 'ready'; shared: Shared };

export function Reader() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [page, setPage] = useState(0);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isDark, setDark] = useState(dark);

  useEffect(() => {
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
    const query = matchMedia('(prefers-color-scheme: dark)');
    const change = () => setDark(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, [isDark]);

  useEffect(() => {
    if (!readShareLink(location.hash)) {
      setState({ kind: 'failed', message: 'This link is missing the part after the # that opens it. Ask for the link again.' });
      return;
    }
    readShared(location.href).then(
      (shared) => {
        setState({ kind: 'ready', shared });
        document.title = `${shared.title} · Ghost.md`;
      },
      (failure: unknown) => setState({ kind: 'failed', message: failure instanceof Error ? failure.message : String(failure) }),
    );
  }, []);

  if (state.kind === 'loading') return <main className={styles.page}><p className={styles.quiet}>Opening…</p></main>;
  if (state.kind === 'failed') {
    return (
      <main className={styles.page}>
        <h1 className={styles.title}>Nothing to read here</h1>
        <p className={styles.quiet}>{state.message}</p>
      </main>
    );
  }
  return <Read shared={state.shared} page={page} setPage={setPage} dark={isDark} saving={saving} setSaving={setSaving} copied={copied} setCopied={setCopied} />;
}

function Read({
  shared,
  page,
  setPage,
  dark,
  saving,
  setSaving,
  copied,
  setCopied,
}: {
  shared: Shared;
  page: number;
  setPage: (n: number) => void;
  dark: boolean;
  saving: boolean;
  setSaving: (on: boolean) => void;
  copied: boolean;
  setCopied: (on: boolean) => void;
}) {
  // The share's pages as notes, so the book's own helpers find the index and a chapter's place in it.
  const notes = useMemo(() => shared.pages.map((p, i) => ({ id: `page-${i}`, body: p.body, createdAt: 0, updatedAt: 0, source: 'editor' }) as Note), [shared]);
  const indexOf = (title: string) => shared.pages.findIndex((p) => sameTitle(p.title, title));
  const open = (title: string) => {
    const at = indexOf(title);
    if (at >= 0) {
      setPage(at);
      window.scrollTo({ top: 0 });
    }
  };
  const current = shared.pages[page] ?? shared.pages[0]!;
  const isBook = shared.kind === 'book';
  // A chapter with no page isn't in the share, so the bar steps only between the chapters that are.
  const whole = isBook && page > 0 ? bookOf(notes, noteTitle(current.body) || current.title) : null;
  const readable = whole ? whole.chapters.filter((c) => indexOf(c.title) > 0) : [];
  const place = whole ? { ...whole, chapters: readable, at: readable.findIndex((c) => sameTitle(c.title, whole.chapters[whole.at]!.title)) } : null;
  const canvas = isCanvasBody(current.body) ? canvasOf(current.body) : null;
  const link = typeof location !== 'undefined' ? location.href : '';
  const found = readShareLink(link);

  const download = () => {
    const file = sharedAsFile(shared);
    const url = URL.createObjectURL(file.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <main className={styles.page}>
      <header className={styles.top}>
        <span className={styles.brand}>Ghost.md</span>
        <span className={styles.shared}>{isBook ? 'A shared book, read-only' : 'A shared note, read-only'}</span>
        <span className={styles.actions}>
          <button type="button" className={`app-word ${styles.primary}`} aria-expanded={saving} onClick={() => setSaving(!saving)}>
            <Plus size={16} aria-hidden="true" />
            Save to my Ghost.md
          </button>
          <button type="button" className={`app-word ${styles.action}`} onClick={download}>
            <Download size={16} aria-hidden="true" />
            {isBook ? 'Download as Markdown (.zip)' : 'Download as Markdown'}
          </button>
        </span>
      </header>

      {saving && found ? (
        <section className={styles.save} aria-label="Save a copy">
          <p>
            Your copy is yours to change; what you save stays as it is when the owner edits theirs.
          </p>
          <a className={`app-word ${styles.primary}`} href={`${APP_URL}#fork=${found.id}.${found.key}`}>
            Save it in Ghost.md on the web
          </a>
          <p className={styles.quiet}>
            In the Ghost.md app on your phone or Mac: choose <strong>+</strong>, then <strong>From a shared link</strong>, and paste this page’s link.
          </p>
          <button type="button" className={`app-word ${styles.action}`} onClick={() => void copy()}>
            {copied ? 'Link copied' : 'Copy this page’s link'}
          </button>
        </section>
      ) : null}

      {isBook && page > 0 && place ? <BookBar place={place} open={(t) => (sameTitle(t, shared.title) ? setPage(0) : open(t))} /> : null}

      {isBook && page === 0 ? (
        <BookIndex shared={shared} open={open} />
      ) : canvas ? (
        <>
          <h1 className={styles.title}>{current.title}</h1>
          <div className={styles.canvas}>
            <CanvasView canvas={canvas} dark={dark} wiki={{ known: (t) => indexOf(t) >= 0, open }} />
          </div>
        </>
      ) : (
        <article className={styles.note}>
          <Editor
            key={`${page}:${current.title}`}
            value={current.body}
            onChange={readOnly}
            dark={dark}
            assist={false}
            readOnly
            display="formatted"
            wiki={{ known: (t) => indexOf(t) >= 0, open }}
          />
        </article>
      )}
    </main>
  );
}

function readOnly(): void {
  // Nothing typed here comes back: the page is read-only.
}

/** A book's index, read-only: its chapters in order, numbered, each opening its page; one with no page says so. */
function BookIndex({ shared, open }: { shared: Shared; open: (title: string) => void }) {
  const chapters = chaptersOf(shared.pages[0]!.body);
  const numbers = numbered(chapters);
  const has = (t: string) => shared.pages.some((p, i) => i > 0 && sameTitle(p.title, t));
  return (
    <article className={styles.note}>
      <h1 className={styles.title}>
        <BookOpen size={22} aria-hidden="true" /> {shared.title}
      </h1>
      <ol className={styles.chapters} aria-label="Chapters">
        {chapters.map((chapter, i) => (
          <li key={`${chapter.line}-${chapter.title}`} data-depth={chapter.depth}>
            <span className={styles.number} aria-hidden="true">
              {numbers[i]}
            </span>
            {has(chapter.title) ? (
              <button type="button" className={styles.chapter} onClick={() => open(chapter.title)}>
                {chapter.title}
              </button>
            ) : (
              <span className={styles.waiting}>{chapter.title} · not written yet</span>
            )}
          </li>
        ))}
      </ol>
    </article>
  );
}
