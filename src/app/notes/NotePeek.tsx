import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Editor } from '../editor/Editor.tsx';
import { isDarkNow, usePreferences } from '../core/preferences.ts';
import { PEEK_LINES, peekMarkdown } from './peek.ts';
import { isCanvasBody } from '../canvas/jsonCanvas.ts';
import styles from './NotePeek.module.css';

/**
 * A note drawn small: the first lines of it, in the note's own editor, set in the formatted view at a fraction of the
 * size. The card's description on the home page and in the sidebar.
 *
 * It was a miniature drawn by hand (notes/peek.ts, still there for the sample note's tests): a heading a heavier
 * line, a to-do a six-pixel box, a bullet a dot. Matt: "the preview for the formatting should use the same formatter
 * that the actual note uses instead of custom rolled small stuff like the checkboxes are weird for example". So it is
 * the same editor the note opens in (editor/Editor.tsx), read-only and in its `peek` mode - nothing that fetches,
 * polls or acts - given the note after its title (`peekMarkdown`) and clipped to a few lines' height. Whatever the
 * note draws, the card draws the same way: a to-do's box is the note's box, a board is a board, a table a table.
 * The card is a button, so nothing here takes a tap.
 *
 * An editor is not free: measured at 25-30 ms each on a Mac in the dev build, and the sidebar's tree has one card
 * per note. So a card holds a blank of about the right height until it is near the screen, then gets its editor -
 * one card at a time, so the page paints first and the previews fill in behind it - and gives it back once it has
 * scrolled well away. A page that cannot watch the screen (a test) draws them all at once.
 *
 * It says nothing to a screen reader: the row already has its name and its date.
 *
 * Built once, kept after (measured: one scroll down a sidebar of 150 notes built and tore down 276 editors, 5.4 s of
 * CPU in the dev build). Once a card's editor has drawn, what it drew is kept as HTML, for that text in that theme,
 * and the live editor is let go: the next time that card - or any card of the same text - comes near the screen, it is
 * drawn from what was kept, with no editor at all. The same formatter, run once per note per session instead of once
 * per scroll past it. The card watches the screen through one observer shared by every card, and does not render
 * again when the list around it does (`memo`: its props are two strings).
 */

export interface NotePeekProps {
  body: string;
  className?: string;
}

/** How far off the screen a card is drawn, or kept drawn, in pixels: a scroll's worth. */
const NEAR_PX = 400;

/** What each card's editor drew, by its text and theme, the most recently drawn last; the oldest go past the cap. */
const drawings = new Map<string, string>();
const DRAWINGS = 300;

function remember(key: string, html: string): void {
  drawings.delete(key);
  drawings.set(key, html);
  if (drawings.size > DRAWINGS) {
    const oldest = drawings.keys().next().value;
    if (oldest !== undefined) drawings.delete(oldest);
  }
}

/** How long after its editor mounts a card's drawing is kept: long enough for the editor to have drawn what it draws. */
const SETTLE_MS = 250;

/** One observer for every card: each card says what it wants done as it comes near the screen or goes from it. */
const watched = new Map<Element, (near: boolean) => void>();
let observer: IntersectionObserver | null = null;

function watch(el: Element, onNear: (near: boolean) => void): () => void {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) watched.get(entry.target)?.(entry.isIntersecting);
    },
    { rootMargin: `${NEAR_PX}px 0px` },
  );
  watched.set(el, onNear);
  observer.observe(el);
  return () => {
    watched.delete(el);
    observer?.unobserve(el);
  };
}

/**
 * One editor at a time, whichever card asked first, each in a task of its own: ten cards mounting in one go is a
 * quarter of a second in which nothing paints, and the same ten one after another is a page that appears and fills
 * in. A task rather than an animation frame, which a hidden page never gets: a page that comes back to the front
 * finds its cards drawn, and a job that throws does not stop the ones behind it.
 */
const queue: (() => void)[] = [];
let draining = false;
function soon(run: () => void): () => void {
  queue.push(run);
  if (!draining) {
    draining = true;
    const next = () => {
      const job = queue.shift();
      if (!job) {
        draining = false;
        return;
      }
      try {
        job();
      } finally {
        window.setTimeout(next, 0);
      }
    };
    window.setTimeout(next, 0);
  }
  return () => {
    const at = queue.indexOf(run);
    if (at >= 0) queue.splice(at, 1);
  };
}

export const NotePeek = memo(function NotePeek({ body, className }: NotePeekProps) {
  const { theme } = usePreferences();
  const dark = isDarkNow(theme);
  // A canvas note is JSON, not words: its card shows nothing small until a canvas can be drawn small (docs/CANVAS.md).
  const markdown = useMemo(() => (isCanvasBody(body) ? '' : peekMarkdown(body)), [body]);
  /** Which drawing this card is: the same text in the same theme draws the same. */
  const key = `${dark ? 'dark' : 'light'}\n${markdown}`;
  const keyRef = useRef(key);
  keyRef.current = key;
  /** A drawing was just kept for this card: render again to let its editor go. */
  const [, setKept] = useState(0);
  const host = useRef<HTMLSpanElement>(null);
  const [drawn, setDrawn] = useState(() => typeof IntersectionObserver === 'undefined');
  /** How tall the editor was, so the blank that stands in for it once it is gone keeps the card's height. */
  const [stood, setStood] = useState<number | null>(null);
  /** More of the note below the card's edge: the last line fades out, to say so. */
  const [clipped, setClipped] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el || !drawn || typeof ResizeObserver === 'undefined') return undefined;
    const check = () => setClipped(el.scrollHeight > el.clientHeight + 1);
    check();
    const watcher = new ResizeObserver(check);
    watcher.observe(el);
    for (const child of el.children) watcher.observe(child);
    return () => watcher.disconnect();
  }, [drawn, markdown]);

  useEffect(() => {
    const el = host.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    let cancel: (() => void) | null = null;
    const stop = watch(el, (near) => {
      cancel?.();
      cancel = null;
      if (near) {
        // Drawn before: straight back, with no editor to wait for. Otherwise in its turn, one editor at a time.
        if (drawings.has(keyRef.current)) setDrawn(true);
        else
          cancel = soon(() => {
            cancel = null;
            setDrawn(true);
          });
      } else {
        // Gone well off the screen: its editor goes, and a blank its height stands in.
        setDrawn((was) => {
          if (was) setStood(el.offsetHeight);
          return false;
        });
      }
    });
    return () => {
      cancel?.();
      stop();
    };
  }, []);

  // A card whose editor has drawn keeps what it drew, then lets the editor go.
  const kept = drawings.get(key);
  useEffect(() => {
    if (!drawn || kept !== undefined || !markdown) return undefined;
    const timer = window.setTimeout(() => {
      const el = host.current;
      if (!el?.querySelector('.cm-editor')) return;
      remember(key, el.innerHTML);
      setKept((n) => n + 1);
    }, SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [drawn, kept, key, markdown]);

  if (!markdown) return null;
  // Before the editor: a blank about as tall as the lines it will draw, so the cards do not jump as they fill in.
  const lines = Math.min(PEEK_LINES, markdown.split('\n').filter((line) => line.trim()).length);
  const style = drawn ? undefined : { blockSize: stood !== null ? `${stood}px` : `calc(var(--app-body) * 1.6 * ${lines})` };
  const peek = className ? `${styles.peek} ${className}` : styles.peek;
  // Drawn before: the kept drawing is the card's own HTML, what its editor drew, with no editor behind it.
  if (drawn && kept !== undefined) {
    return <span ref={host} className={peek} data-clipped={clipped ? '' : undefined} aria-hidden="true" dangerouslySetInnerHTML={{ __html: kept }} />;
  }
  return (
    <span ref={host} className={peek} style={style} data-clipped={drawn && clipped ? '' : undefined} aria-hidden="true">
      {drawn ? <Editor value={markdown} onChange={noop} dark={dark} assist={false} readOnly display="formatted" peek grow /> : null}
    </span>
  );
});

function noop(): void {
  // Read-only: nothing typed comes back.
}
