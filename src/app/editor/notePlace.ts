import type { EditorView } from '@codemirror/view';
import { useEffect, type RefObject } from 'react';
import { bookmarkLineIn } from './bookmarkLine.ts';

/**
 * Where a note was being read, so it opens there again (Matt: "add bookmarking notes so opening the same note later
 * reopens to the same position"), and the bookmark the header's button puts in it, which wins over that.
 *
 * The two are read differently: the place is wherever the page was left, and the bookmark is the line the caret is on
 * (`caretPlace`), falling back to the page in a note the caret has not been put in.
 *
 * A place is the line at the top of the page and how far into it the page was scrolled, not a pixel count: a note
 * that grew above that line since (a recording added, a paragraph typed) still opens on the same words. Kept on the
 * page under one key, for the most recent notes only.
 */

export interface Place {
  /** The document position of the line at the top of the page. */
  pos: number;
  /** How far past that line's top, in pixels. */
  offset: number;
}

const KEY = 'glyph-note-places';
const MARKS_KEY = 'glyph-note-bookmarks';
/** Notes remembered; the least recently read are forgotten first. */
const KEEP = 200;
/** A page scrolled no further than this is at the top, and nothing is kept for it. */
const TOP_PX = 24;
/** Scrolling settles for this long before the place is written. */
const SAVE_AFTER_MS = 400;

type Places = Record<string, Place & { at: number }>;

function readAll(): Places {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Places) : {};
  } catch {
    return {};
  }
}

export function readPlace(noteId: string): Place | null {
  const place = readAll()[noteId];
  return place && Number.isFinite(place.pos) && Number.isFinite(place.offset) ? { pos: place.pos, offset: place.offset } : null;
}

export function writePlace(noteId: string, place: Place | null, now = Date.now()): void {
  try {
    const all = readAll();
    if (place) all[noteId] = { ...place, at: now };
    else delete all[noteId];
    const kept = Object.entries(all)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, KEEP);
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // No storage: the note opens at the top, as it did.
  }
}

/**
 * A bookmark is a place put there on purpose, from the note's header (Matt: "add bookmark button to topbar"). The
 * note opens at it, rather than where it was last left, until it is taken off again.
 */
function marks(): Record<string, Place> {
  try {
    const value = JSON.parse(localStorage.getItem(MARKS_KEY) ?? '{}') as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, Place>) : {};
  } catch {
    return {};
  }
}

export function readBookmark(noteId: string): Place | null {
  const mark = marks()[noteId];
  return mark && Number.isFinite(mark.pos) && Number.isFinite(mark.offset) ? { pos: mark.pos, offset: mark.offset } : null;
}

/** Puts a bookmark in `noteId`, or takes it off with null. */
export function writeBookmark(noteId: string, place: Place | null): void {
  try {
    const all = marks();
    if (place) all[noteId] = place;
    else delete all[noteId];
    localStorage.setItem(MARKS_KEY, JSON.stringify(all));
  } catch {
    // Without storage the bookmark holds while the note is open.
  }
}

/** Where the note's document starts inside the scrolling page, in the page's own scroll coordinates. */
function documentOffset(view: EditorView, page: HTMLElement): number {
  return view.documentTop - page.getBoundingClientRect().top + page.scrollTop;
}

/** The place the page is scrolled to now: the line at its top, and how far into it. Null at the top. */
export function placeOf(view: EditorView, page: HTMLElement): Place | null {
  const y = page.scrollTop - documentOffset(view, page);
  if (page.scrollTop <= TOP_PX || y < 0) return null;
  const block = view.lineBlockAtHeight(y);
  return { pos: block.from, offset: Math.max(0, y - block.top) };
}

/**
 * The caret as a place: the line it is on, from that line's top (Matt: "bookmarking notes is not placing the bookmark
 * on the carat of the text"). A bookmark is put on the words being read or written, not on whatever happens to be at
 * the top of the page.
 *
 * Null when the caret's line is not on screen, which is the case in a note nobody has touched since it opened: the
 * caret is at the start and the page is somewhere else, so where the page is scrolled to is what the person means.
 */
export function caretPlace(view: EditorView, page: HTMLElement): Place | null {
  const block = view.lineBlockAt(Math.min(view.state.selection.main.head, view.state.doc.length));
  const top = documentOffset(view, page) + block.top;
  const seen = top >= page.scrollTop - 1 && top < page.scrollTop + page.clientHeight;
  return seen ? { pos: block.from, offset: 0 } : null;
}

/** The bookmark written in the note (editor/bookmarkLine.ts), as a place: its line, from the top. */
export function writtenBookmark(view: EditorView): Place | null {
  const number = bookmarkLineIn(view.state.doc);
  return number === null ? null : { pos: view.state.doc.line(number).from, offset: 0 };
}

/** Scrolls the page back to `place`, clamped to the note as it is now. */
export function scrollToPlace(view: EditorView, page: HTMLElement, place: Place): void {
  const block = view.lineBlockAt(Math.min(place.pos, view.state.doc.length));
  page.scrollTop = documentOffset(view, page) + block.top + Math.min(place.offset, block.height);
}

/** How long an opening note is waited on for its words to arrive before it is left at the top. */
const WAIT_MS = 2500;

/**
 * Opens `noteId` where it was left and remembers where it is left. The note's words arrive a moment after its editor
 * (the store is read after the screen opens), so the page is scrolled back once the document reaches the place and
 * the page can scroll that far, and once more shortly after, when the editor has measured the lines it scrolled to
 * (lines never drawn only have estimated heights). Nothing is written until then, or until the person scrolls, so a
 * note closed before its words arrived keeps its place. Then it is read at every scroll and written as scrolling
 * settles, when the app is hidden, and when the note closes (from the last scroll: by then the page is gone).
 */
export function useNotePlace(noteId: string, page: RefObject<HTMLElement | null>, view: EditorView | null, active: boolean): void {
  useEffect(() => {
    const scroller = page.current;
    if (!view || !scroller || !active) return undefined;
    // A bookmark was put there on purpose, so it wins over wherever the note was last left: the one written in the note,
    // once its words arrive, then one kept on this device from before bookmarks were written in.
    let place = readBookmark(noteId) ?? readPlace(noteId);
    let written = false;
    // Settled: restored, given up on, or scrolled by the person. Only then is the place theirs to write.
    let settled = false;
    let frame = 0;
    let again = 0;
    const started = performance.now();
    const wait = () => {
      if (settled) return;
      if (!written) {
        const mark = writtenBookmark(view);
        if (mark) {
          place = mark;
          written = true;
        }
      }
      if (!place) {
        // Nothing to go back to, unless the note's words bring a bookmark with them.
        if (view.state.doc.length || performance.now() - started > WAIT_MS) settled = true;
        else frame = requestAnimationFrame(wait);
        return;
      }
      const target = place;
      const ready = view.state.doc.length >= target.pos && scroller.scrollHeight > scroller.clientHeight;
      if (ready) {
        scrollToPlace(view, scroller, target);
        again = window.setTimeout(() => {
          scrollToPlace(view, scroller, target);
          settled = true;
          latest = placeOf(view, scroller) ?? target;
        }, 150);
        return;
      }
      if (performance.now() - started > WAIT_MS) {
        settled = true;
        return;
      }
      frame = requestAnimationFrame(wait);
    };
    frame = requestAnimationFrame(wait);
    // The place as of the last scroll: by the time the note closes its page is gone and reads as scrolled to the top.
    let latest: Place | null = place;
    const save = () => {
      if (settled) writePlace(noteId, latest);
    };
    // The person's own scrolling ends the restore: a restore scrolls too, and must not be mistaken for it.
    const onTouch = () => {
      if (!settled) {
        cancelAnimationFrame(frame);
        window.clearTimeout(again);
        settled = true;
      }
    };
    let saving = 0;
    const onScroll = () => {
      if (settled && scroller.isConnected) latest = placeOf(view, scroller);
      window.clearTimeout(saving);
      saving = window.setTimeout(save, SAVE_AFTER_MS);
    };
    const onHide = () => {
      if (document.visibilityState !== 'hidden') return;
      if (settled && scroller.isConnected) latest = placeOf(view, scroller);
      save();
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    scroller.addEventListener('pointerdown', onTouch, { passive: true });
    scroller.addEventListener('wheel', onTouch, { passive: true });
    scroller.addEventListener('touchstart', onTouch, { passive: true });
    document.addEventListener('visibilitychange', onHide);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(again);
      window.clearTimeout(saving);
      scroller.removeEventListener('scroll', onScroll);
      scroller.removeEventListener('pointerdown', onTouch);
      scroller.removeEventListener('wheel', onTouch);
      scroller.removeEventListener('touchstart', onTouch);
      document.removeEventListener('visibilitychange', onHide);
      save();
    };
  }, [noteId, page, view, active]);
}
