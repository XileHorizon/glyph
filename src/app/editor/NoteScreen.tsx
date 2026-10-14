import { Ghost } from '../art/Ghost.tsx';
import { createPortal } from 'react-dom';
import { liveEnabled } from '../core/live/enabled.ts';
import { useTopBarTools } from '../core/topBarTools.ts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Bookmark, Code, EllipsisVertical, Mic } from '@glacier/icons';
import { useToast } from '@glacier/react';
import type { EditorView } from '@codemirror/view';
import { adoptImagePath, pickImage } from '../core/images.ts';
import { useWispEdge } from '../art/wispEdge.ts';
import { caretPlace, placeOf, readBookmark, scrollToPlace, useNotePlace, writeBookmark } from './notePlace.ts';
import { bookmarkLineIn, markedLine, markedWords, placeBookmark, showBookmark } from './bookmarkLine.ts';
import { boardFrom, itemAt, wordsEnd } from '../core/boards.ts';
import { hasClips, setTapeId, tapeId } from '../core/clips.ts';
import { useNoteZoom } from './pinchZoom.ts';
import { ContextMenu } from './ContextMenu.tsx';
import { FindBar } from './FindBar.tsx';
import { Editor } from './Editor.tsx';
import { CanvasView } from '../canvas/CanvasView.tsx';
import { canvasOf, withCanvas } from '../canvas/jsonCanvas.ts';
import { BookBar, BookView } from '../book/BookView.tsx';
import { isBookBody, type BookPlace } from '../book/book.ts';
import { withFrontMatterTitle } from '../core/frontMatter.ts';
import { insertImageAt, releaseImageSpot, reserveImageSpot } from './images.ts';
import { useBack } from '../core/back.ts';
import { fireNativeHaptic } from '../core/haptics.ts';
import { useUnfold } from '../core/unfold.ts';
import { getNote, noteTitle, setNoteRecording, updateNote, type Note } from '../core/store.ts';
import type { Segment } from '../capture/markdown.ts';
import { isDarkNow, setPreferences, usePreferences } from '../core/preferences.ts';
import { useWideScreen } from '../core/useWideScreen.ts';
import type { NoteView } from './viewMode.ts';
import { convertFileSrc } from '@tauri-apps/api/core';
import { FormattedView, type ApplyHow } from '../format/FormattedView.tsx';
import { useFormatter } from '../format/formatter.ts';
import type { Mode } from '../format/modes.ts';
import { NoteTape, TranscriptWords } from '../tapes/NoteTape.tsx';
import { NoteSettings } from './NoteSettings.tsx';
import { LinkMarks } from '../plugins/LinkMarks.tsx';
import { plugins } from '../plugins/registry.ts';
import type { NoteEditing } from '../plugins/types.ts';
import { useTape } from '../tapes/useTape.ts';
import styles from './NoteScreen.module.css';

/**
 * One note, open.
 *
 * This component owns SAVING, and saving is the part with teeth. A phone kills
 * a backgrounded webview without warning and without a beforeunload, so a
 * debounce alone would lose whatever was typed in the last fraction of a
 * second before the user switched apps - which is precisely the moment a person
 * has just written the thing they opened the app to write.
 *
 * So there are two paths. The debounce (400ms after the last keystroke) keeps
 * the common case cheap, and a flush on blur, on unmount, and on
 * `visibilitychange` covers every way the app can go away. The flush is
 * synchronous in its decision - it checks a ref, not state - because by the
 * time a re-render could happen the process may be gone.
 *
 * The note, and over it what the robot makes of it: the robot button in the
 * More sheet's AI group lists Format, Summarize and Enhance, and choosing
 * one opens that mode's view (format/FormattedView.tsx) over the
 * note, which starts writing the first time it is opened; Close, "Back to
 * note" in the menu, or the back gesture returns to the note. Matt: "make
 * all of these buttons instead of the segmented toggle, make a robot drop
 * down button for these options". A spoken note has one more view, the
 * transcript - the recording's phrases following the sound - which shows
 * whenever the tape is playing and steps aside when it stops (Matt: "the
 * default mode whenever we're playing, not a different tab"). The editor
 * stays mounted behind the others, hidden, so nothing typed is lost and its
 * caret keeps its place.
 */

interface NoteScreenProps {
  note: Note;
  onBack: () => void;
  onDelete: (id: string) => void;
  /** Talk into this note: the recorder, aimed here, and back here after. */
  onSpeak: (id: string) => void;
  onPin: (note: Note) => void;
  onArchive: (note: Note) => void;
  /** Opens the note by that title, making it where there is none: what a [[link]] in the words does. */
  onOpenTitle?: (title: string, at?: string) => void;
  /** The item to land on when the note was opened by a link pointing inside it: `^anchor` (core/boards.ts). */
  at?: string;
  /** Whether a note by that title exists, for drawing a [[link]] as written or as waiting. */
  hasTitle?: (title: string) => boolean;
  /** The book this note is a chapter of, for the bar under its header (book/book.ts `bookOf`); null for none. */
  book?: BookPlace | null;
  /** Opens a note by its title in this note's tab, for moving within a book; without it, `onOpenTitle`. */
  onOpenWithin?: (title: string) => void;
  /** A note's body by its title, for a canvas card that is a note to be drawn small (canvas/CanvasView.tsx). */
  bodyOfTitle?: (title: string) => string | null;
  /** Every note's title, for a canvas's + to choose a note from. */
  allTitles?: () => string[];
  /**
   * A canvas renamed from its tab (notes/NoteTabs.tsx), while this is the note being read.
   *
   * It cannot be written from outside: the live body is a ref here that only this screen's own `onChange` sets, so a
   * `saveNote` from App would be flushed away by the next keystroke. So the row asks, and the screen writes it the
   * way the canvas itself writes - through `onChange`, on the same debounce as typing. `asked` rises with each
   * asking, so renaming twice to the same name still lands.
   */
  rename?: { id: string; title: string; asked: number } | null;
  /** The "← Notes" in the header; off where the list is already beside the note (the desktop sidebar, App.tsx). */
}

const SAVE_DEBOUNCE_MS = 400;

/** How far below the header a note opened at an item sits, so the line is not against it. */
const LAND_ROOM = 12;

export function NoteScreen({ note, onBack, onDelete, onSpeak, onPin, onArchive, onOpenTitle, hasTitle, book, onOpenWithin, bodyOfTitle, allTitles, at, rename }: NoteScreenProps) {
  const prefs = usePreferences();
  // The view switch has room in the header only on a wide screen (a folding phone opened out); otherwise it lives in
  // the cog's sheet (Matt: "too big, it clogs up the header; hide it under a more menu that only expands when there
  // is enough space on the screen").
  const wide = useWideScreen();
  const chooseView = (value: NoteView) => {
    if (prefs.noteView === value) return;
    setPreferences({ noteView: value });
    fireNativeHaptic('selection');
  };
  const [title, setTitle] = useState(() => noteTitle(note.body));
  const [view, setView] = useState<EditorView | null>(null);
  /*
   * A note that is a canvas (docs/CANVAS.md) is drawn as one where its words would be. Its JSON is there behind the
   * header's view switch (Matt: "the raw JSON in the editor"), but as the note's own switch rather than the
   * preference every note shares - that one defaults to the marks, and a canvas should open as a canvas. Switching
   * to the JSON hands the editor what the canvas has written since (it follows `value`); switching back reads the
   * canvas from what was typed. While the canvas is drawn there is no editor, so what needs one (find, zoom, the
   * caret's place) stands idle.
   */
  const [source, setSource] = useState(false);
  const [canvasBody, setCanvasBody] = useState(note.body);
  const canvas = useMemo(() => canvasOf(canvasBody), [canvasBody]);
  const drawing = !!canvas && !source;
  /*
   * A note that is a book (docs/BOOKS.md) is drawn as its index the same way, its Markdown behind the same switch.
   * The view's own changes (a chapter added, moved, taken out) are written through `onChange` like typing and kept
   * here too, so the index redraws from what it just wrote.
   */
  const [bookBody, setBookBody] = useState(note.body);
  const isBook = useMemo(() => isBookBody(bookBody), [bookBody]);
  const paging = isBook && !source;
  const typed = !!canvas || isBook;
  const showSource = (next: boolean) => {
    if (next === source) return;
    if (!next) {
      setCanvasBody(body.current);
      setBookBody(body.current);
    }
    setSource(next);
    fireNativeHaptic('selection');
  };
  /*
   * Live sync (docs/LIVE.md): this note open on another device too, typed into on either and arriving a character at
   * a time. Nothing at all unless the switch is on (core/live/enabled.ts), and even then the live code - Yjs and its
   * CodeMirror binding - is only loaded here, on demand, so the app is the same size for everyone with it off.
   */
  const [livePeers, setLivePeers] = useState(0);
  useEffect(() => {
    if (!view || !liveEnabled()) return undefined;
    let stop: (() => void) | null = null;
    let gone = false;
    void import('../core/live/open.ts')
      .then(({ goLive }) => goLive(view, note.id, setLivePeers))
      .then((stopping) => {
        if (gone) stopping();
        else stop = stopping;
      })
      .catch(() => {
        // Could not go live - no network, no account key: the note works as it always has, synced by the pass.
      });
    return () => {
      gone = true;
      stop?.();
    };
  }, [view, note.id]);
  const [photoProblem, setPhotoProblem] = useState<string | null>(null);
  // A spoken note keeps its recording: the tape at the top plays it. Removing it
  // (the tape's Remove) is held here, so the tape goes at once and Undo brings
  // it back without a trip to the store.
  const [kept, setKept] = useState<{
    ms: number | null;
    segments: Segment[] | null;
  } | null>(null);
  const spoken = useMemo(() => (kept ? { ...note, recordingMs: kept.ms, segments: kept.segments } : note), [note, kept]);
  const tape = useTape(spoken);
  const { toast } = useToast();
  /** The recording just removed, while its Undo still means something: cleared when the note is spoken into or left. */
  const removed = useRef<{ ms: number; segments: Segment[] } | null>(null);
  useEffect(
    () => () => {
      removed.current = null;
    },
    [],
  );
  /** What the robot is showing over the note, or null for the note itself. */
  const [mode, setMode] = useState<Mode | null>(null);
  /** The cog's sheet: pin, archive, what the note is linked to, delete. */
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Find and replace, open with its first words, or null when it's closed (FindBar.tsx). */
  const [finding, setFinding] = useState<string | null>(null);
  const [pinned, setPinned] = useState(Boolean(note.starred));
  /** The tape and the note's scrolling page. */
  const page = useRef<HTMLDivElement>(null);
  const header = useRef<HTMLElement>(null);
  // A picture that didn't come in is said once, then gets out of the way.
  useEffect(() => {
    if (!photoProblem) return;
    const id = window.setTimeout(() => setPhotoProblem(null), 6000);
    return () => window.clearTimeout(id);
  }, [photoProblem]);

  // The formatted text made the note (the Formatted view's Apply): said once,
  // with the way back, for a few seconds.
  const [applied, setApplied] = useState<{
    said: string;
    undo: () => void;
  } | null>(null);
  useEffect(() => {
    if (!applied) return;
    const id = window.setTimeout(() => setApplied(null), 8000);
    return () => window.clearTimeout(id);
  }, [applied]);

  // The live document, held in a ref rather than state: it changes on every
  // keystroke and nothing in this component's render depends on it, so putting
  // it in state would re-render the screen once per character for nothing.
  const body = useRef(note.body);
  const saved = useRef(note.body);
  const revision = useRef(note.revision ?? 1);
  const writes = useRef<Promise<void>>(Promise.resolve());
  const writable = useRef(true);
  const timer = useRef<number | null>(null);

  // The robot's text for the note in the mode showing (the hook looks up
  // what is kept itself); Format while nothing shows, so a run the queue
  // started is found the moment the view opens.
  const formatter = useFormatter(note.id, mode ?? 'format');
  const currentBody = useCallback(() => body.current, []);

  const flush = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (body.current === saved.current) return;
    const pending = body.current;
    saved.current = pending;
    writes.current = writes.current.then(async () => {
      if (!writable.current) return;
      try {
        const stored = await updateNote(note.id, pending, revision.current);
        revision.current = stored.revision ?? revision.current + 1;
      } catch (failure) {
        // The row was deleted or another writer won. Most importantly, this
        // editor has no insertion API and therefore cannot bring Delete back.
        writable.current = false;
        console.warn('[glyph] editor save stopped:', failure);
      }
    });
  }, [note.id]);

  // A note with no words in it yet shows the ghost with its pen under the editor, until the first word (art/Ghost.tsx).
  const [blank, setBlank] = useState(() => !note.body.trim());
  const onChange = useCallback(
    (next: string) => {
      body.current = next;
      setBlank(!next.trim());
      // The header title is the first line, so it does need to re-render - but
      // only when the first line actually changed, which is rare.
      setTitle((prev) => {
        const now = noteTitle(next);
        return prev === now ? prev : now;
      });
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, SAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  /*
   * A rename asked for from this note's tab (notes/NoteTabs.tsx): written here rather than by App, because the live
   * body is the ref above and only `onChange` may set it - a write from outside would be flushed away by the next
   * keystroke. The same path the canvas itself writes by, and so the same debounce and the same flushes.
   */
  useEffect(() => {
    if (!rename || rename.id !== note.id) return;
    const next = withFrontMatterTitle(body.current, rename.title);
    if (next !== body.current) onChange(next);
    // Each asking is its own: `asked` is what changes, so renaming twice to the same name still lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rename?.asked]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [flush]);

  const back = () => {
    flush();
    onBack();
  };

  // The phone's back gesture: the list.
  useBack(true, back);

  // On a folding phone, the note flattens with the hinge as the phone opens.
  const screen = useRef<HTMLDivElement>(null);
  useUnfold(screen);

  // A picture, put into the note at the caret on its own line: from the
  // phone's picker (the menu's Add image), or one the activity copied out of
  // the clipboard (the menu's Paste). Pasting with the keyboard is the
  // editor's own (editor/images.ts).
  const placeImage = async (fetch: () => Promise<string | null>) => {
    setPhotoProblem(null);
    // The place is taken now: the picker leaves the app, and the caret is not
    // guaranteed to be where it was when it comes back.
    const spot = view ? reserveImageSpot(view) : null;
    try {
      const name = await fetch();
      if (name && view && spot !== null) {
        insertImageAt(view, spot, name);
        fireNativeHaptic('light');
      }
    } catch (failure) {
      setPhotoProblem(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (view && spot !== null) releaseImageSpot(view, spot);
    }
  };
  const addPhoto = () => placeImage(pickImage);
  const pasteImage = (path: string) => placeImage(() => adoptImagePath(path));

  const remove = () => {
    // No confirmation: it goes to the trash, with an Undo, and is only deleted
    // for good from there (core/trash.ts, notes/useNoteActions.ts).
    fireNativeHaptic('warning');
    onDelete(note.id);
  };

  const showMode = (next: Mode | null) => {
    if (next) flush();
    setMode(next);
    // The editor was hidden, not unmounted, so nothing typed is lost; it
    // measures itself again now that it has a size.
    if (!next) window.requestAnimationFrame(() => view?.requestMeasure());
  };

  /**
   * The note, as plugins change it (plugins/types.ts `NoteEditing`): through the
   * editor, so each change is one undo and saves like typing, and anything to
   * say shows on the note like a picture's problem does.
   */
  const editing: NoteEditing = {
    noteId: note.id,
    body: () => view?.state.doc.toString() ?? body.current,
    replaceLine(find, next) {
      const doc = view?.state.doc;
      if (!view || !doc) return false;
      for (let n = 1; n <= doc.lines; n += 1) {
        const line = doc.line(n);
        if (find(line.text, n)) {
          view.dispatch({
            changes: { from: line.from, to: line.to, insert: next(line.text) },
          });
          return true;
        }
      }
      return false;
    },
    say: setPhotoProblem,
  };

  // Apply, from the robot's view: the text goes into the note - in place of
  // it, above it or below it. Through the editor, so its history has it, and
  // said with an Undo that puts the old words back and the kept version back
  // to what it was.
  const applyFormatted = (text: string, how: ApplyHow) => {
    if (!view) return;
    const previous = view.state.doc.toString();
    const piece = text.trim();
    const next = how === 'replace' ? text : how === 'prepend' ? `${piece}\n\n${previous.replace(/^\s+/, '')}` : `${previous.replace(/\s+$/, '')}\n\n${piece}\n`;
    view.dispatch({
      changes: { from: 0, to: previous.length, insert: next },
      selection: { anchor: how === 'append' ? next.length : 0 },
      scrollIntoView: true,
    });
    const unkeep = formatter.apply(text, next);
    showMode(null);
    fireNativeHaptic('success');
    setApplied({
      said: how === 'replace' ? 'Applied to the note.' : how === 'prepend' ? 'Added above the note.' : 'Added below the note.',
      undo: () => {
        const now = view.state.doc.toString();
        view.dispatch({
          changes: { from: 0, to: now.length, insert: previous },
          selection: { anchor: 0 },
          scrollIntoView: true,
        });
        unkeep();
        setApplied(null);
      },
    });
  };

  // Playing takes the screen for the transcript; the chosen view waits under it.
  const shown: 'transcript' | 'robot' | 'raw' = tape.length && tape.playing ? 'transcript' : mode ? 'robot' : 'raw';
  // The tape and note go to smoke as they slip behind the header; read again on a view change, since another view may not scroll (art/wispEdge.ts).
  // The page smokes at both ends: under the header, and off the bottom where the dock is (art/wispEdge.ts).
  // Not on a canvas: it is not a page that scrolls off its foot, and the band was smoking the canvas's own tools at
  // the bottom of the screen (Matt: "The bottom wisp effect is effecting canvas view buttons at the bottom").
  useWispEdge(page, shown, header, { foot: !canvas });
  // The note opens where it was left, and remembers where it is left (editor/notePlace.ts).
  // Opened at an item, the note goes to that line rather than back to where it was left last time.
  useNotePlace(note.id, page, view, shown === 'raw' && !at);
  /** Whether this note has a bookmark, for the header's button. */
  const [marked, setMarked] = useState(() => bookmarkLineIn(note.body) !== null || readBookmark(note.id) !== null);
  useEffect(() => setMarked(bookmarkLineIn(note.body) !== null || readBookmark(note.id) !== null), [note.id, note.body]);
  /** The bookmarked line, ribboned in the note so the place can be seen (editor/bookmarkLine.ts). */
  const showMark = useCallback(
    (at: number | null) => {
      view?.dispatch({ effects: showBookmark.of(at) });
    },
    [view],
  );
  // The note's words arrive a moment after its editor, so the ribbon waits for the line it belongs on.
  useEffect(() => {
    if (!view) return undefined;
    const at = readBookmark(note.id)?.pos ?? null;
    if (at === null || view.state.doc.length >= at) {
      showMark(at);
      return undefined;
    }
    let frame = 0;
    const started = performance.now();
    const wait = () => {
      if (view.state.doc.length >= at || performance.now() - started > 2500) showMark(at);
      else frame = requestAnimationFrame(wait);
    };
    frame = requestAnimationFrame(wait);
    return () => cancelAnimationFrame(frame);
  }, [note.id, view, showMark]);

  /**
   * The bookmark, written in the note as `§§` (editor/bookmarkLine.ts): pressed, it goes on the line being read or
   * written, moving from wherever it was; pressed on the line that already has it, it comes off (Matt: "i should be
   * able to tap bookmark again to update the position as well right now its stuck"). The note opens at it.
   */
  const bookmark = () => {
    const scroller = page.current;
    if (!view || !scroller) return;
    // The caret's own line first: a bookmark marks the words being read, not the top of the page (editor/notePlace.ts).
    const here = caretPlace(view, scroller) ?? placeOf(view, scroller);
    const current = bookmarkLineIn(view.state.doc);
    const kept = readBookmark(note.id);
    const target = here ? markedLine(view.state, here.pos) : view.state.doc.length ? 1 : null;
    const was = current ?? (kept ? markedLine(view.state, kept.pos) : null);
    // One kept on this device from before bookmarks were written in goes: the note carries its own from now on.
    if (kept) writeBookmark(note.id, null);
    if (target === null) {
      toast({ message: 'Write something first, then bookmark the line.' });
      return;
    }
    if (was === target) {
      view.dispatch(placeBookmark(view.state, null));
      showMark(null);
      setMarked(false);
      fireNativeHaptic('warning');
      toast({ message: 'Bookmark taken off.' });
      return;
    }
    view.dispatch(placeBookmark(view.state, target));
    showMark(null);
    setMarked(true);
    fireNativeHaptic('success');
    // The words it landed on are said back, so the place is known without scrolling to it.
    const words = markedWords(view, view.state.doc.line(target).from);
    const said = was === null ? 'Bookmarked at' : 'Bookmark moved to';
    toast({ message: words ? `${said} “${words}”. This note opens here.` : `${said} this line. This note opens here.` });
  };
  /**
   * Opened by a link that pointed inside this note (`[[Launch week#^ask-sam]]`), the caret lands on that item and
   * the page scrolls to it. The words arrive a moment after the editor does, so the item is looked for a few times
   * before the note is left where it opened.
   */
  useEffect(() => {
    const anchor = at?.replace(/^\^/, '');
    if (!anchor || !view) return undefined;
    const timers: number[] = [];
    let tries = 0;
    let landed = 0;
    const land = () => {
      const item = itemAt(view.state.doc.toString(), anchor);
      const scroller = page.current;
      if (item && scroller) {
        const line = view.state.doc.line(Math.min(item.line, view.state.doc.lines));
        // At the end of the item's words, before its mark and anchor, so what is typed next goes on the words.
        if (!landed) view.dispatch({ selection: { anchor: line.from + wordsEnd(line.text) } });
        // The first scroll works from the editor's own idea of where the line is, which is a guess for lines it has
        // not drawn (a board counts for a lot of page). Once the line is really on screen its own top is measured and
        // the last of it taken off, so a note with a board lands on the line and not a screen past it.
        const seen = view.coordsAtPos(line.from);
        // Under the header, which floats over the page rather than pushing it down.
        const room = (header.current?.getBoundingClientRect().bottom ?? scroller.getBoundingClientRect().top) + LAND_ROOM;
        if (seen) scroller.scrollTop += seen.top - room;
        else scrollToPlace(view, scroller, { pos: line.from, offset: 0 });
        landed += 1;
        if (landed < 4) timers.push(window.setTimeout(land, landed * 150));
        return;
      }
      if (tries < 24) {
        tries += 1;
        timers.push(window.setTimeout(land, 100));
      }
    };
    timers.push(window.setTimeout(land, 0));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [at, view]);

  /**
   * The note's list laid out as a board (core/boards.ts): each item gets a name at the end, and a fence of columns
   * goes in under the title, ticked items in Done. One change, so one Undo puts the note back as it was.
   */
  const makeBoard = () => {
    if (!view) return;
    const made = boardFrom(view.state.doc.toString());
    setSettingsOpen(false);
    if (!made) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: made.doc }, userEvent: 'input.board' });
    fireNativeHaptic('success');
    toast({ message: `${made.cards} ${made.cards === 1 ? 'item is' : 'items are'} now cards${made.done ? `, ${made.done} in Done` : ''}.` });
  };

  // Two fingers pinch the note's text larger or smaller (editor/pinchZoom.ts).
  useNoteZoom(page, view, shown === 'raw');

  // The tape's Remove: the recording comes off the note (its length and phrases forgotten; the audio file stays
  // until the note is spoken into again or deleted, which is what lets Undo put it back).
  const removeRecording = () => {
    const memos = hasClips(body.current);
    void (async () => {
      tape.audio.ref.current?.pause();
      const full = await getNote(note.id).catch(() => null);
      const ms = tape.length;
      const segments = full?.segments ?? tape.segments ?? [];
      // The tape's id goes with it, so the note's voice memos read as quiet marks until it is back (core/clips.ts).
      const heldTape = tapeId(note.id);
      removed.current = { ms, segments };
      setKept({ ms: null, segments: null });
      fireNativeHaptic('warning');
      setTapeId(note.id, null);
      try {
        await setNoteRecording(note.id, null, []);
      } catch (failure) {
        removed.current = null;
        setKept({ ms, segments });
        setTapeId(note.id, heldTape);
        toast({
          message: `The recording couldn’t be removed: ${failure instanceof Error ? failure.message : String(failure)}`,
        });
        return;
      }
      toast({
        message: memos ? 'Recording removed. Its voice memos are quiet until you undo.' : 'Recording removed.',
        duration: 5000,
        action: {
          label: 'Undo',
          onPress: () => {
            const back = removed.current;
            if (!back) return;
            removed.current = null;
            setKept({ ms: back.ms, segments: back.segments });
            setTapeId(note.id, heldTape);
            void setNoteRecording(note.id, back.ms, back.segments);
          },
        },
      });
    })();
  };
  const speakHere = () => {
    // A new take replaces a removed recording's file, so its Undo would no longer be true.
    removed.current = null;
    flush();
    onSpeak(note.id);
  };

  // Where the app's bar wants this screen's controls, if it is there to hold them (core/topBarTools.ts).
  const toolsSlot = useTopBarTools();

  const tools = (
  <div className={styles.tools}>
    {/* Another device has this note open, and what is typed on either arrives on the other as it is typed. */}
    {livePeers > 0 ? (
      <span className={styles.live} role="status" aria-label={livePeers === 1 ? 'Live with another device' : `Live with ${livePeers} other devices`}>
        Live
      </span>
    ) : null}
    {/*
      Markdown, the marks with the formatting (the default), or just the formatted text (editor/viewMode.ts).
      One ring like the others rather than a pair in a capsule (Matt: "change the pencil and book icon to the
      normal round icon we use for the other items in the toolbar just make it toggle between a code icon and a
      book icon"): the glyph is the view you are in - the marks, or the page - and the label says what a press
      does, which is the part a pair of buttons used to say by being two.
    */}
    <button
      type="button"
      className={styles.cog}
      disabled={shown !== 'raw'}
      onClick={() => (typed ? showSource(!source) : chooseView(prefs.noteView === 'formatted' ? 'mixed' : 'formatted'))}
      aria-label={
        canvas
          ? source
            ? 'Showing the canvas as JSON. Show the canvas.'
            : 'Showing the canvas. Show its JSON.'
          : isBook
            ? source
              ? 'Showing the index as Markdown. Show the index.'
              : 'Showing the index. Show its Markdown.'
            : prefs.noteView === 'formatted'
            ? 'Showing the formatted note. Show the marks.'
            : 'Showing the marks. Show the formatted note.'
      }
      title={canvas ? (source ? 'JSON' : 'Canvas') : isBook ? (source ? 'Markdown' : 'Index') : prefs.noteView === 'formatted' ? 'Formatted' : 'Markdown'}
    >
      {(typed ? !source : prefs.noteView === 'formatted') ? (
        <BookOpen size={20} strokeWidth={2.1} aria-hidden="true" />
      ) : (
        <Code size={20} strokeWidth={2.1} aria-hidden="true" />
      )}
    </button>
    <button
      type="button"
      className={`${styles.cog} ${styles.bookmark} app-gold`}
      data-on={marked || undefined}
      onClick={bookmark}
      aria-pressed={marked}
      aria-label={marked ? 'Move the bookmark to this line, or take it off here' : 'Bookmark this line'}
    >
      {/*
        The same outline and 33% wash as every other filled icon in the app, set or not (Matt: "the bookmark icon on the
        note should have the outline with semitransparent fill"). app.css gives it that; nothing here overrides it.

        It was solid once set, which read as a different kind of icon from everything beside it. Whether a bookmark is
        set is said by `aria-pressed` and the button's label, and on the page by the ribbon on the marked line - and,
        since the mark on the page went gold (Matt: "Make the bookmark icon on the note yellow / gold instead of white so
        it stands out"), by the button going gold with it (NoteScreen.module.css `.bookmark[data-on]`).
      */}
      <Bookmark size={20} strokeWidth={2.1} aria-hidden="true" />
    </button>
    {/* A note with no recording has no tape; talking into it is this mic. Once it has audio, the tape's Add is. */}
    {tape.length > 0 ? null : (
      <button type="button" className={styles.cog} onClick={speakHere} aria-label="Talk into this note">
        <Mic size={20} strokeWidth={2.1} aria-hidden="true" />
      </button>
    )}
    {/* More for this note: the robot's modes under AI, pin, archive, links, delete (NoteSettings). Three dots rather than a cog (Matt). */}
    <button type="button" className={`${styles.cog} ${styles.more}`} onClick={() => setSettingsOpen(true)} aria-label="More for this note">
      <EllipsisVertical size={20} strokeWidth={2.6} aria-hidden="true" />
    </button>
  </div>
  );

  return (
    <div ref={screen} className={styles.screen}>
      {/* The crease's shadow while the note unfolds; nothing the rest of the time. */}
      <div className={styles.crease} aria-hidden="true" />
      {/*
        Two words and the note. The note's first line is already the biggest
        type on the screen, so the header no longer repeats it; it keeps the
        title only as the back button's accessible description.
      */}
      {/*
        The note's controls live in the app's top bar now (Matt: "Move the controls for the note into the topbar"),
        put there by a portal because they hold the editor's state - the view being shown, the bookmark's line, the
        tape - and lifting them into App.tsx would lift the editor with them. Where there is no bar to take them,
        they stay in this header, which is where they have always been.
      */}
      <header ref={header} className={`app-headerPane ${styles.header}`}>
        {toolsSlot ? null : (
          <div className={styles.headerRow}>
            <span />
            {tools}
          </div>
        )}
      </header>
      {toolsSlot ? createPortal(tools, toolsSlot) : null}
      {photoProblem ? (
        <p className={styles.problem} role="alert">
          {photoProblem}
        </p>
      ) : null}
      {applied ? (
        <p className={styles.problem} role="status">
          {applied.said}
          <button type="button" className={`app-word ${styles.undo}`} onClick={applied.undo}>
            Undo
          </button>
        </p>
      ) : null}

      {/*
        The tape and the note are one page under the header, and scroll
        together (Matt: "the tape and stuff at the top of a note should scroll
        up with the rest of the note instead of sticking to the top"). The
        Formatted view and the transcript keep their own scrolling, under a
        tape that stays, since each has a bar of words at its top.
      */}
      <div ref={page} className={styles.page} data-scrolls={(shown === 'raw' && !drawing) || undefined}>
        {tape.length > 0 ? (
          <div className={styles.tapeRow}>
            {!tape.web ? (
              <audio
                ref={tape.audio.ref}
                src={convertFileSrc(`${note.id}.wav`, 'rec')}
                preload="metadata"
                onPlay={tape.audio.onPlay}
                onPause={tape.audio.onPause}
                onEnded={tape.audio.onEnded}
                onTimeUpdate={tape.audio.onTimeUpdate}
                onError={tape.audio.onError}
              />
            ) : null}
            <NoteTape note={note} title={title} tape={tape} onSpeak={speakHere} onRemove={removeRecording} hasMemos={hasClips(currentBody())} />
          </div>
        ) : null}
        {/* What the note is linked to (a Notion board, a repo): a tap opens the cog sheet to change it. */}
        <LinkMarks noteId={note.id} onPress={() => setSettingsOpen(true)} />
        {/* A chapter's book, its place in it and the chapters either side (docs/BOOKS.md). */}
        {book && onOpenTitle ? <BookBar place={book} open={(t) => (onOpenWithin ?? onOpenTitle)(t)} /> : null}

        {shown === 'transcript' ? (
          <div className={styles.body}>
            <TranscriptWords tape={tape} />
          </div>
        ) : null}
        {shown === 'robot' ? (
          <div className={styles.body}>
            {/* Keyed by mode: a change of mode is a fresh view, with its own editor and its own once-per-mount start. */}
            <FormattedView
              key={mode}
              formatter={formatter}
              currentBody={currentBody}
              dark={isDarkNow(prefs.theme)}
              onApply={applyFormatted}
              onClose={() => showMode(null)}
            />
          </div>
        ) : null}
        {drawing ? (
          <div className={`${styles.body} ${styles.canvasBody}`} hidden={shown !== 'raw'}>
            <CanvasView
              canvas={canvas}
              dark={isDarkNow(prefs.theme)}
              wiki={onOpenTitle && hasTitle ? { known: hasTitle, open: onOpenTitle, body: bodyOfTitle, titles: allTitles } : undefined}
              // A change to the canvas is a change to the note: written into the body as the spec's JSON, front
              // matter kept, and saved the way typing is (the debounce and its flushes above).
              onChange={(next) => onChange(withCanvas(body.current, next))}
            />
          </div>
        ) : null}
        {paging ? (
          <div className={styles.body} hidden={shown !== 'raw'}>
            <BookView
              body={bookBody}
              title={title}
              known={hasTitle ?? (() => false)}
              open={(t) => (onOpenWithin ?? onOpenTitle)?.(t)}
              titles={allTitles ?? (() => [])}
              bodyOf={bodyOfTitle}
              onChange={(next) => {
                setBookBody(next);
                onChange(next);
              }}
            />
          </div>
        ) : null}
        <div className={styles.body} hidden={shown !== 'raw' || drawing || paging}>
          <Editor
            // A canvas's JSON or a book's Markdown, once asked for, is what the view has written by now, not what the note opened with.
            value={typed && source ? body.current : note.body}
            onChange={onChange}
            onView={setView}
            wispTyping={prefs.wisp}
            display={typed ? 'mixed' : prefs.noteView}
            tape={!tape.web && tape.length > 0 ? convertFileSrc(`${note.id}.wav`, 'rec') : null}
            tapeId={tape.length > 0 ? tapeId(note.id) : null}
            onImageError={setPhotoProblem}
            dark={isDarkNow(prefs.theme)}
            assist={prefs.assist}
            placeholder="Write something."
            swipeAction={() => {
              const action = plugins.itemAction(note.id);
              return action
                ? {
                    label: action.label,
                    busyLabel: action.busyLabel,
                    run: (text) => action.run(text, editing),
                  }
                : null;
            }}
            suggest={(text) =>
              plugins.suggestions(note.id, text).map((s) => ({
                line: s.line,
                label: s.label,
                busyLabel: s.busyLabel,
                run: () => s.run(editing),
              }))
            }
            linkMenus={{ say: (message) => editing.say(message) }}
            wiki={onOpenTitle && hasTitle ? { known: hasTitle, open: onOpenTitle } : undefined}
            grow
          />
          {blank && !typed ? <Ghost scene="new-note" align="center" className={styles.blankGhost} /> : null}
        </div>
      </div>
      {/* Press and hold in the note: Cut, Copy, Paste, Select all, Add image. */}
      <ContextMenu
        view={view}
        onAddImage={() => void addPhoto()}
        onPasteImage={pasteImage}
        say={(message) => toast({ message })}
        onFind={setFinding}
        // The same send a swipe on the item does, where a plugin takes this note's items (a Notion board, a GitHub issue).
        send={(() => {
          const action = plugins.itemAction(note.id);
          return action ? { label: action.label, run: (text: string) => action.run(text, editing) } : null;
        })()}
      />
      {finding !== null && view && shown === 'raw' ? <FindBar view={view} initial={finding} onClose={() => setFinding(null)} /> : null}
      {/* The page's top and bottom soften while there is more to scroll to. */}
      <NoteSettings
        open={settingsOpen}
        noteId={note.id}
        title={title}
        pinned={pinned}
        editing={editing}
        onClose={() => setSettingsOpen(false)}
        name={typed ? { value: title, onChange: (next) => onChange(withFrontMatterTitle(body.current, next)) } : undefined}
        view={!wide && shown === 'raw' ? (typed ? (source ? 'mixed' : 'formatted') : prefs.noteView) : undefined}
        onView={typed ? (next) => showSource(next === 'mixed') : chooseView}
        mode={mode}
        onMode={showMode}
        onFind={
          shown === 'raw'
            ? () => {
                setSettingsOpen(false);
                setFinding('');
              }
            : undefined
        }
        onMakeBoard={shown === 'raw' && settingsOpen && boardFrom(view?.state.doc.toString() ?? body.current) ? makeBoard : undefined}
        onPin={() => {
          flush();
          onPin({ ...note, starred: pinned });
          setPinned((was) => !was);
          fireNativeHaptic('selection');
          setSettingsOpen(false);
        }}
        onArchive={() => {
          flush();
          setSettingsOpen(false);
          onArchive(note);
        }}
        onDelete={() => {
          setSettingsOpen(false);
          remove();
        }}
      />
    </div>
  );
}
