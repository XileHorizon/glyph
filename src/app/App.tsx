import { forkShared, readShared } from './share/share.ts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HapticsProvider, ToastProvider, useToast } from '@glacier/react';
import { UpdateNotice } from './notes/Notices.tsx';
import { HomeScreen } from './home/HomeScreen.tsx';
import type { OpenTask } from './home/dashboard.ts';
import { setItemDone } from './core/boards.ts';
import { inTrash, outOfTrash, useTrash } from './core/trash.ts';
import { NoteScreen } from './editor/NoteScreen.tsx';
import { NoteTabs } from './notes/NoteTabs.tsx';
import { NotesDrawer } from './notes/NotesDrawer.tsx';
import { Aside } from './aside/Aside.tsx';
import { useBack } from './core/back.ts';
import { asideContent, readAsideShown, writeAsideShown } from './aside/aside.ts';
import { NoteTree } from './notes/NoteTree.tsx';
import { addOpen, afterClose, closeOpen, moveOpen, openOnly, swapOpen } from './notes/openTabs.ts';
import { afterMove, displayOrder, joinGroup, leaveGroup, newGroup, pruneGroups, type TabGroups } from './notes/tabGroups.ts';
import { backFrom, canGoBack, canGoOn, FIRST, noteIdOf, notePlace, onFrom, placeAt, went, type Place } from './notes/visited.ts';
import { readSidebarShown, useSidebar, writeSidebarShown } from './core/useWideScreen.ts';
import { SettingsSheet } from './settings/SettingsSheet.tsx';
import { ReviewScreen } from './review/ReviewScreen.tsx';
import type { ReviewHandoff } from './review/useReview.ts';
import { CaptureScreen } from './capture/CaptureScreen.tsx';
import { AcademyScreen } from './academy/AcademyScreen.tsx';
import { CommandBar } from './commands/CommandBar.tsx';
import type { NoteView } from './editor/viewMode.ts';
import { academyBannerDue, dismissAcademyBanner } from './academy/banner.ts';
import { startRefining } from './capture/refine.ts';
import { startFormatting } from './format/queue.ts';
import { startSync } from './core/sync/engine.ts';
import { WhatsNewSheet } from './notes/WhatsNewSheet.tsx';
import { Guide } from './guide/Guide.tsx';
import { clearGuideProgress, isReadingPage, launchedTooSoon, markGuideStarted, rememberGuidePage } from './guide/tooSoon.ts';
import { useVoiceModel } from './capture/useVoiceModel.ts';
import { installBack } from './core/back.ts';
import { hapticsImpl, installTapHaptics } from './core/haptics.ts';
import { answerHost, takeCaptureLaunch } from './core/host.ts';
import { applyPreferences, onPreferences, preferences, setPreferences, themeChoice, usePreferences, type ThemePref } from './core/preferences.ts';
import { WispEdgeFilter } from './art/WispEdgeFilter.tsx';
import { settleBoot, useUpdates } from './core/ota.ts';
import {
  createNote,
  getNote,
  latestCommandMutation,
  newNoteId,
  NOTE_SAVED,
  noteTitle,
  undoCommandMutation,
  updateNote,
  useNotes,
  type Note,
  listNotes,
} from './core/store.ts';
import { sameTitle } from './editor/wikiLinks.ts';
import { addBoardNote, addCanvasNote, addHowCanvas, addSampleNote, sampleNoteSeeded, seedSampleNote } from './core/seed.ts';
import { canvasNoteBody } from './canvas/jsonCanvas.ts';
import { withFrontMatterTitle } from './core/frontMatter.ts';
import { bookNoteBody, bookOf, isBookBody } from './book/book.ts';
import { NewBookSheet } from './book/NewBookSheet.tsx';
import { NewSheet } from './notes/NewSheet.tsx';
import { sweepMemos } from './core/sweepMemos.ts';
import { chooseWorkspace, fileNewNote, fileNote, useWorkspaces, workspaceOf } from './core/workspaces.ts';
import { useNoteActions } from './notes/useNoteActions.ts';
import { afterPendingDeletes } from './capture/launch.ts';

/**
 * The whole app: a list, a note, a capture, and a settings sheet.
 *
 * There is no router. Glyph has three screens and a sheet, and a router would
 * be a dependency and a set of edge cases bought to express one piece of state.
 * The phone's back gesture is a stack of handlers instead (core/back.ts): the
 * screen on top says what leaving it means, and the list, at the root, lets
 * Android put the app behind the home screen.
 *
 * A capture can begin three ways, and all three arrive at the same screen: the
 * side key while Glyph is closed (read once at boot), the side key while Glyph
 * is open (pushed by the activity into `window.__glyph.capture`), and the
 * microphone button in the list. Each capture is a fresh mount, keyed, so a
 * second press mid-capture cannot inherit the first one's microphone.
 *
 * `HapticsProvider` is mounted with `enabled={false}` and a native `impl`,
 * which looks contradictory and is not: the flag governs only the kit's own
 * delegated pointerdown tick, which fires at the start of a scroll flick and
 * buzzes all the way down a list. The impl is what `useHaptics()` hands to
 * components, and it is ungated. `installTapHaptics` puts back the tick the
 * flag switched off, on pointerUP, where a tap can be told from a drag.
 */

const GUIDE_KEY = 'glyph-guide-seen';

function guideSeen(): boolean {
  try {
    return localStorage.getItem(GUIDE_KEY) === '1';
  } catch {
    // No storage: showing it every launch would be worse than never.
    return true;
  }
}

function markGuideSeen(): void {
  try {
    localStorage.setItem(GUIDE_KEY, '1');
  } catch {
    // Seen for this run, at least.
  }
  clearGuideProgress();
}

type Screen =
  | { name: 'list' }
  | {
      name: 'note';
      note: Note;
      /** The item to land on, `^anchor`, when the note was opened by a link that pointed inside it (core/boards.ts). */
      at?: string;
    }
  | {
      name: 'capture';
      key: number;
      fromAssistant: boolean;
      stop: number;
      /** Talking into this note, from its Speak: the words go here, and the capture comes back here. */
      noteId?: string;
    }
  /** After Stop: the slower models check the take, and the person commits what they find (review/). */
  | { name: 'review'; handoff: ReviewHandoff }
  /** After a memo: where its parts go, proposed, and filed when committed (sort/). */
  /** Glyph Academy: markdown taught a mark at a time, open from Settings whenever it is wanted (academy/). */
  | { name: 'academy' };

export function App() {
  return (
    <HapticsProvider enabled={false} impl={hapticsImpl}>
      <ToastProvider>
        <Shell />
      </ToastProvider>
    </HapticsProvider>
  );
}

/** Everything under the providers, so it can raise toasts (Undo) itself. */
function Shell() {
  const { notes, loading, refresh } = useNotes();
  const actions = useNoteActions(refresh);
  const { flushDeletes } = actions;
  const { toast } = useToast();
  const bootCapture = useRef(takeCaptureLaunch());
  const bootTooSoon = useRef(Boolean(bootCapture.current && launchedTooSoon(guideSeen())));
  const [screen, setScreen] = useState<Screen>({ name: 'list' });

  /** Capture reads targets immediately, so every deferred permanent delete must finish first. */
  const launchCapture = useCallback(
    async (fromAssistant: boolean, noteId?: string) => {
      await afterPendingDeletes(flushDeletes, () => {
        setScreen({ name: 'capture', key: Date.now(), fromAssistant, stop: 0, ...(noteId ? { noteId } : {}) });
      });
    },
    [flushDeletes],
  );
  // Read by the side-key handler, which is registered once.
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const [settings, setSettings] = useState(false);
  /** Settings asked to open at the cheat sheet, from the Academy: the moment it was asked for, or 0. */
  const [toCheatSheet, setToCheatSheet] = useState(0);
  // The walkthrough opens by itself once, on the first launch that is not a
  // side-key capture - a person who held the key is already mid-sentence.
  const [guide, setGuide] = useState(() => !bootCapture.current && !guideSeen());
  // "Not yet, finish reading.": a relaunch, or the side key, while the guide was still on a reading page.
  const [tooSoon, setTooSoon] = useState(() => bootTooSoon.current);

  const [guidePage, setGuidePage] = useState(0);

  useEffect(() => {
    if (!bootCapture.current || bootTooSoon.current) return;
    bootCapture.current = false;
    void launchCapture(true);
  }, [launchCapture]);

  const undoRecoveryChecked = useRef(false);
  // A confirmed command and its undo record are persisted together. If the
  // process stopped before its success chip could be used, re-offer the same
  // guarded undo once; a later edit turns it into a conflict rather than data loss.
  useEffect(() => {
    if (undoRecoveryChecked.current) return undefined;
    undoRecoveryChecked.current = true;
    let live = true;
    void latestCommandMutation()
      .then((pending) => {
        if (!live || !pending) return;
        toast({
          message: pending.kind === 'create' ? 'Voice command created a note.' : 'Voice command changed a note.',
          duration: 10_000,
          action: {
            label: 'Undo',
            onPress: () => void undoCommandMutation(pending.mutationId).then(() => refresh()),
          },
        });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [refresh, toast]);
  // Read by the side-key handler, which is registered once.
  const guideRef = useRef({ open: guide, page: guidePage });
  guideRef.current = { open: guide, page: guidePage };
  // Where the guide is, kept for a relaunch (guide/tooSoon.ts); gone once it is finished.
  useEffect(() => {
    if (guide) {
      markGuideStarted();
      rememberGuidePage(guidePage);
    }
  }, [guide, guidePage]);

  useEffect(() => {
    // First, before anything that might reload: this frontend mounted, so the
    // build the loader staked on it is safe. See core/ota.ts.
    settleBoot();
    applyPreferences();
    // The phone's back gesture and Escape: each screen registers what
    // leaving it means (core/back.ts); this installs the answer once.
    const uninstallBack = installBack();
    const untap = installTapHaptics();
    return () => {
      uninstallBack();
      untap();
    };
  }, []);

  // New builds, looked for after launch and on return; applied on reload.
  const updates = useUpdates();

  // The side key, while Glyph is already open.
  //
  // During a capture it is the stop button: holding the key again saves, the
  // way pressing a tape recorder's key a second time does. (Letting go cannot
  // stop it - Android tells the assistant app when the key is held, and never
  // when it is released.)
  //
  // Otherwise it clears the stage: the sheet, the walkthrough, an open note
  // (whose editor flushes as it unmounts) and the keyboard all go, so the bare
  // recorder is the only thing on screen - and when it ends, the app lands on
  // the note or the list, not back in a menu.
  useEffect(
    () =>
      answerHost('capture', () => {
        const current = screenRef.current;
        if (current.name === 'capture') {
          setScreen({ ...current, stop: current.stop + 1 });
          return;
        }
        // On a reading page of the guide the key is too soon: the line, not a recording.
        if (guideRef.current.open && isReadingPage(guideRef.current.page)) {
          setTooSoon(true);
          return;
        }
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        setSettings(false);
        setGuide(false);
        void launchCapture(true);
      }),
    [launchCapture],
  );

  // Fetched when the app opens and again whenever it returns to the screen,
  // so the first held side key starts listening instead of downloading.
  const voiceModel = useVoiceModel();

  // The better words after a recording, worked out in the background; the list
  // is refreshed when a note's words change.
  useEffect(() => startRefining(() => void refresh()), [refresh]);
  // The staged formatting passes after a recording: draft, then revisions.
  useEffect(() => startFormatting(() => void refresh()), [refresh]);
  // Sync, for a device signed in to an account (docs/SYNC.md); nothing happens without one.
  useEffect(() => startSync(), []);
  // A desktop window wide enough keeps the notes in a sidebar beside the open note (core/useWideScreen.ts).
  const sidebar = useSidebar();
  // The list beside a note shows its title and order as it is written: read again a moment after each save.
  useEffect(() => {
    if (!sidebar) return undefined;
    let timer = 0;
    const saved = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void refresh(), 300);
    };
    window.addEventListener(NOTE_SAVED, saved);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(NOTE_SAVED, saved);
    };
  }, [sidebar, refresh]);

  /**
   * A note opened from inside a book - the index, the chapter bar, the aside, the read-through - takes the current
   * tab's place rather than a tab of its own (notes/openTabs.ts `swapOpen`; Matt: "the book should open in one tab
   * instead of each page opening in a new tab"). The tab to give up is noted here and read once by the effect that
   * turns a shown note into a tab; every other way of opening clears it first.
   */
  const swap = useRef<string | null>(null);
  const openNote = (id: string) => {
    swap.current = null;
    const note = notes.find((n) => n.id === id);
    if (note) setScreen({ name: 'note', note });
    setDrawer(false);
  };
  /** `id` opened in the current note's tab. */
  const openNoteWithin = (id: string) => {
    const current = screen.name === 'note' ? screen.note.id : null;
    swap.current = current && current !== id ? current : null;
    const note = notes.find((n) => n.id === id);
    if (note) setScreen({ name: 'note', note });
    setDrawer(false);
  };

  /*
   * The notes a person has open, as tabs over a note (notes/openTabs.ts). Every way into a note ends in a
   * `screen` of its own, so the row is kept here rather than at each of them: a note shown is a note open.
   */
  /*
   * The row survives a reload, and arrives on another device (Matt: "Persist tabs across devices and reloads"): the
   * ids are a synced preference (core/preferences.ts `openNotes`, core/sync/prefs.ts). Only the row is kept, never
   * which tab was in front - the app opens on the list as it always has, so tabs whose notes have not synced yet
   * simply are not drawn rather than opening a note this device cannot show.
   */
  const [open, setOpen] = useState<string[]>(() => preferences().openNotes);
  useEffect(() => {
    if (open.join('\u0000') !== preferences().openNotes.join('\u0000')) setPreferences({ openNotes: open });
  }, [open]);
  const [drawer, setDrawer] = useState(false);
  // The docked sidebar, shown or hidden by the top bar's icon (core/useWideScreen.ts `readSidebarShown`).
  const [sidebarShown, setSidebarShown] = useState(readSidebarShown);
  const toggleDock = () => {
    const next = !sidebarShown;
    setSidebarShown(next);
    writeSidebarShown(next);
  };
  // The right-hand aside (aside/Aside.tsx), shown or hidden by the tab row's mirrored icon; kept to this device.
  const [asideShown, setAsideShown] = useState(readAsideShown);
  const toggleAside = () => {
    const next = !asideShown;
    setAsideShown(next);
    writeAsideShown(next);
  };
  const shown = screen.name === 'note' ? screen.note.id : null;
  useEffect(() => {
    if (!shown) return;
    const from = swap.current;
    swap.current = null;
    setOpen((was) => (from ? swapOpen(was, from, shown) : addOpen(was, shown)));
  }, [shown]);
  /*
   * The notes every screen shows: a note deleted and still undoable is hidden at once (notes/useNoteActions.ts), and
   * removed from the store only when its Undo runs out. The old list filtered by this; the home page, the sidebar's
   * tree and the drawer took the full list, so a deleted note sat there until the timer, or a second delete, made it
   * final (Matt: "Notes need to be deleted twice before the UI updates").
   */
  const kept = useMemo(() => (actions.hidden.size ? notes.filter((n) => !actions.hidden.has(n.id)) : notes), [notes, actions.hidden]);
  /*
   * And a note in the trash (core/trash.ts) is out of all of them - the home page, the tree, tabs, links and search -
   * and only in the tree's Trash folder, until it is brought back or deleted for good.
   */
  const thrown = useTrash();
  const shownNotes = useMemo(() => outOfTrash(kept, thrown), [kept, thrown]);
  const trashedNotes = useMemo(() => inTrash(kept, thrown), [kept, thrown]);
  // A note deleted, or put in the trash, here or on another device leaves no tab behind.
  const liveIds = useMemo(() => new Set(shownNotes.map((n) => n.id)), [shownNotes]);
  const openIds = useMemo(() => openOnly(open, liveIds), [open, liveIds]);

  /*
   * Tab groups (notes/tabGroups.ts): Chrome-style, named and coloured runs of tabs (Matt chose "Chrome-style groups").
   * A synced preference like the open tabs, so a group made on the Mac is there on the phone; read again when another
   * device changes it. A group's tabs are drawn together, so the tabs are handed on in that order.
   */
  const [groups, setGroups] = useState<TabGroups>(() => preferences().tabGroups);
  useEffect(
    () =>
      onPreferences(() => {
        const theirs = preferences().tabGroups;
        setGroups((ours) => (JSON.stringify(ours) === JSON.stringify(theirs) ? ours : theirs));
      }),
    [],
  );
  useEffect(() => {
    if (JSON.stringify(groups) !== JSON.stringify(preferences().tabGroups)) setPreferences({ tabGroups: groups });
  }, [groups]);
  /*
   * A closed tab leaves its group, and a group left with nothing in it goes. Measured against `open` - the tabs as
   * stored - not the tabs whose notes have loaded: on the first render no note has loaded yet, so that list is empty,
   * and pruning against it emptied every group and saved the empty result, which lost the groups on every start.
   */
  useEffect(() => {
    setGroups((was) => {
      const next = pruneGroups(was, open);
      return JSON.stringify(next) === JSON.stringify(was) ? was : next;
    });
  }, [open]);
  const drawnIds = useMemo(() => displayOrder(openIds, groups), [openIds, groups]);
  const openTabs = useMemo(() => drawnIds.map((id) => notes.find((n) => n.id === id)!), [drawnIds, notes]);
  /*
   * Where he has been, and the arrows that walk it (notes/visited.ts, drawn in the tab bar). Matt: "Add the back and
   * forward arrows in the top bar to the right of the button used to toggle the sidebar and make sure we have full
   * forward and backwards support".
   *
   * The trail records arriving somewhere rather than every way of getting there, so it does not matter which of the
   * many paths into a note was taken - a tab, a link in the words, the floating list, a swipe back. `jumped` is how
   * the arrows say "this move was me": without it, going back would itself be recorded as somewhere new and forward
   * would never mean anything.
   */
  const [trail, setTrail] = useState(FIRST);
  const jumped = useRef(false);
  const place: Place | null = screen.name === 'note' ? notePlace(screen.note.id) : screen.name === 'list' ? 'list' : null;
  useEffect(() => {
    if (!place) return;
    if (jumped.current) {
      jumped.current = false;
      return;
    }
    setTrail((was) => went(was, place));
  }, [place]);
  /** A place worth landing on: the list always, a note only while it still exists. */
  const stillThere = useCallback(
    (spot: Place) => {
      const id = noteIdOf(spot);
      return id === null ? true : liveIds.has(id);
    },
    [liveIds],
  );
  const land = (spot: Place) => {
    jumped.current = true;
    const id = noteIdOf(spot);
    if (id === null) void backToList();
    else openNote(id);
  };
  const goBack = () => {
    const next = backFrom(trail, stillThere);
    const spot = next && placeAt(next);
    if (!next || !spot) return;
    setTrail(next);
    land(spot);
  };
  const goOn = () => {
    const next = onFrom(trail, stillThere);
    const spot = next && placeAt(next);
    if (!next || !spot) return;
    setTrail(next);
    land(spot);
  };

  const [openCommands, setOpenCommands] = useState<(() => void) | null>(null);
  /*
   * Stable, and the opener kept behind a function of its own: a new identity here would run the palette's effect
   * again on every render, and a setter handed a bare function would take it for an updater and call it mid-render.
   */
  const paletteReady = useCallback((open: () => void) => setOpenCommands(() => open), []);
  const prefs = usePreferences();
  const spaces = useWorkspaces();

  const closeTab = (id: string) => {
    const next = id === shown ? afterClose(openOnly(open, liveIds), id) : null;
    setOpen((was) => closeOpen(was, id));
    if (id !== shown) return;
    if (next) openNote(next);
    else void backToList();
  };

  /** Whether a note by that title is in the library: what a `[[link]]` is drawn by (editor/wikiLinks.ts). */
  const hasTitle = (title: string) => shownNotes.some((n) => sameTitle(noteTitle(n.body), title));
  /** What the aside holds now: the open note's book, or the workspace's other notes (aside/aside.ts). */
  const asideBody = useMemo(() => asideContent(shownNotes, screen.name === 'note' ? screen.note : null), [shownNotes, screen]);
  /** That note's body, for a canvas card that is a note to draw it small (canvas/CanvasView.tsx); null for none. */
  const bodyOfTitle = (title: string) => shownNotes.find((n) => sameTitle(noteTitle(n.body), title))?.body ?? null;

  /**
   * A `[[link]]` tapped: the note by that title, or a new note that starts with it as its heading, so a link is a
   * place to write as well as a place to go.
   */
  /**
   * A [[link]] in the words. `[[The cabin trip#^friday]]` opens that note on that item: the title half is
   * editor/wikiLinks.ts, the `^anchor` half core/boards.ts, and the note screen does the landing.
   */
  // A copy of something shared with this person, from its link (share/share.ts): saved into the library, then opened.
  const forkFromLink = async (link: string) => {
    const made = await forkShared(await readShared(link));
    await refresh();
    setScreen({ name: 'note', note: made });
  };

  // The reader page's "Save it in Ghost.md" opens the app at `#fork=` (src/read/Reader.tsx): once the notes are read,
  // the copy is saved, and the link comes out of the address bar so a reload does not save it twice.
  const forking = useRef(false);
  useEffect(() => {
    if (loading || forking.current || typeof location === 'undefined' || !location.hash.startsWith('#fork=')) return;
    forking.current = true;
    const link = location.hash.slice('#fork='.length);
    history.replaceState(null, '', location.pathname + location.search);
    void forkFromLink(link).catch((failure: unknown) => console.warn('[glyph] could not save the shared copy:', failure));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const openTitle = async (title: string, at?: string) => {
    swap.current = null;
    await openTitleFrom(title, at);
  };
  /** A title opened from inside a book: in the current tab's place. */
  const openTitleWithin = (title: string) => {
    const current = screen.name === 'note' ? screen.note.id : null;
    swap.current = current;
    void openTitleFrom(title);
  };
  const openTitleFrom = async (title: string, at?: string) => {
    const found = shownNotes.find((n) => sameTitle(noteTitle(n.body), title));
    if (found) {
      setScreen({ name: 'note', note: found, at });
      return;
    }
    // The list in hand can be a moment old - a chapter just made from a book's index is not in it yet - so the store is
    // asked once more before a second note by that title is made.
    const fresh = (await listNotes().catch(() => [])).find((n) => !n.archivedAt && sameTitle(noteTitle(n.body), title));
    if (fresh) {
      await refresh();
      setScreen({ name: 'note', note: fresh, at });
      return;
    }
    const made = await createNote(newNoteId(), `# ${title}\n\n`, 'editor');
    fileNewNote(made.id);
    await refresh();
    setScreen({ name: 'note', note: made });
  };

  // Memos were taken out of the app (Matt: "remove memo's entirely", and the ones written go too): the first read
  // of the notes after this build puts any left in the trash (core/sweepMemos.ts).
  useEffect(() => {
    if (loading) return;
    if (sweepMemos(notes)) void refresh();
  }, [loading, notes, refresh]);

  // A fresh library gets the sample note once (core/seed.ts): a few seconds
  // after the first read comes back empty, past the store's own re-asks, so a
  // slow first answer from the phone is never mistaken for an empty library.
  useEffect(() => {
    if (loading || sampleNoteSeeded()) return undefined;
    const timer = window.setTimeout(() => {
      void seedSampleNote(notes.length).then((made) => made && refresh());
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [loading, notes.length, refresh]);

  // Settings > About: another sample note, opened at once.
  const sampleNote = async () => {
    setSettings(false);
    const note = await addSampleNote();
    await refresh();
    setScreen({ name: 'note', note });
  };

  const boardNote = async () => {
    setSettings(false);
    const note = await addBoardNote();
    await refresh();
    setScreen({ name: 'note', note });
  };

  const canvasNote = async () => {
    setSettings(false);
    const note = await addCanvasNote();
    await refresh();
    setScreen({ name: 'note', note });
  };

  const howCanvasNote = async () => {
    setSettings(false);
    const note = await addHowCanvas();
    await refresh();
    setScreen({ name: 'note', note });
  };

  /**
   * A book from the + (docs/BOOKS.md): the New book sheet asks its name and which notes are its pages, in what
   * order, and makes one note with that index, opened on it. Filed and kept as a note is.
   */
  const [bookSheet, setBookSheet] = useState(false);
  const newBook = () => setBookSheet(true);
  const createBook = async (title: string, pages: readonly string[]) => {
    const note = await createNote(newNoteId(), bookNoteBody(title, pages), 'editor');
    fileNewNote(note.id);
    await refresh();
    setScreen({ name: 'note', note });
  };
  /** What can be a page: every note's title but the books' own. */
  const pageTitles = () => shownNotes.filter((n) => !isBookBody(n.body)).map((n) => noteTitle(n.body)).filter((t) => t.trim());

  const newNote = async () => {
    // Written to the store immediately rather than on first keystroke: a note
    // that exists only in memory is a note that a backgrounded webview loses,
    // and an empty row in the list is a far smaller problem than a lost one.
    // The library holds it as a draft with no file until its first words
    // (docs/LIBRARY.md), so a note opened and left leaves nothing behind.
    const note = await createNote(newNoteId(), '', 'editor');
    // Made while the list shows one workspace: it belongs there (core/workspaces.ts).
    fileNewNote(note.id);
    await refresh();
    setScreen({ name: 'note', note });
  };

  /*
   * What the + makes (notes/NewSheet.tsx): a note or a canvas. The sheet is one for every +, so the choice reads the
   * same wherever it is offered.
   */
  const [newSheet, setNewSheet] = useState(false);

  const newCanvas = async () => {
    const note = await createNote(newNoteId(), canvasNoteBody('Untitled canvas', { nodes: [], edges: [] }), 'editor');
    fileNewNote(note.id);
    await refresh();
    setScreen({ name: 'note', note });
  };

  // From the editor's Delete: the same undoable delete a swipe does.
  const removeNote = (id: string) => {
    const note = notes.find((n) => n.id === id);
    setOpen((was) => closeOpen(was, id));
    setScreen({ name: 'list' });
    if (note) {
      actions.remove(note);
      return;
    }
    // A note the list has not read yet (one a voice command just made or changed): read it now rather than closing
    // it and deleting nothing.
    void getNote(id)
      .catch(() => null)
      .then((fresh) => {
        if (fresh) actions.remove(fresh);
        return refresh();
      });
  };

  const backToList = async () => {
    setScreen({ name: 'list' });
    await refresh();
  };

  // Glyph Academy offered on the home screen, for someone who has not started it (academy/banner.ts). Read again
  // whenever the list comes back: a lesson passed in there is the card's answer, so it goes.
  const [academyCard, setAcademyCard] = useState(academyBannerDue);
  useEffect(() => {
    if (screen.name === 'list') setAcademyCard(academyBannerDue());
  }, [screen.name]);

  const captureFinished = useCallback(
    async (note: Note | null, locked: boolean, review?: ReviewHandoff) => {
      // A spoken note lands in the workspace the list is showing, unless it is filed already.
      if (note) fileNewNote(note.id);
      await refresh();
      if (note && review) {
        setScreen({ name: 'review', handoff: review });
        return;
      }
      // Talking into a note from the note: back to that note, read fresh, since
      // its words just changed (and a Formatted view compares against them).
      // Otherwise the list, the new note at its top: reading it back is a tap
      // away, and a locked phone has already stepped back behind its lock
      // screen, so nothing of the note is shown to whoever is holding it.
      const current = screenRef.current;
      const from = current.name === 'capture' ? current.noteId : undefined;
      if (from && !locked) {
        const fresh = await getNote(note?.id ?? from).catch(() => null);
        if (fresh) {
          setScreen({ name: 'note', note: fresh });
          return;
        }
      }
      setScreen({ name: 'list' });
    },
    [refresh],
  );

  const speakInto = (id: string) => void launchCapture(false, id);

  // The list and the open note sit side by side on a wide desktop window; the capture, review and sort
  // flows still take the whole window.
  const split = sidebar && (screen.name === 'list' || screen.name === 'note');
  /*
   * The sidebar docked beside the note, rather than a popover over it: a window wide enough, and Docked chosen in
   * Settings. A popover is the default everywhere (Matt: "Sidebar should open and close in a popover not a full
   * sidebar even on desktop", core/preferences.ts `SidebarStyle`). Either way the top bar's icon is the way to it;
   * docked, the icon shows and hides the column.
   */
  const docked = split && prefs.sidebarStyle === 'docked';
  const dockShown = docked && sidebarShown;
  // On a phone the back gesture closes the aside, as it closes a sheet (core/back.ts).
  useBack(!split && asideShown, toggleAside);
  // Docking takes over from a card left open, so the notes are never drawn twice.
  useEffect(() => {
    if (docked) setDrawer(false);
  }, [docked]);
  /*
   * The routes that carry the app's tab row (app.css .app-tabBar): the list and a note, which are the two places a
   * tab means anything. A capture, a review, a sort and the Academy are each the whole screen and the way out of them
   * is their own; the bar's height leaves `--app-safe-top` with it, so those screens keep their own top edge.
   */
  const tabBar = screen.name === 'list' || screen.name === 'note';
  /*
   * And how tall it is: one line of controls, or that line with the open notes under it (app.css `--app-tabs`). The
   * bar is two rows now (Matt: "put the tabs on the next line down"), and the second is not there at all when
   * nothing is open (Matt: "This row can be hidden when there are no tabs open"), so the height has to say which of
   * the two it is - every screen's header clears the bar by `--app-safe-top` without knowing the bar exists.
   */
  useEffect(() => {
    const root = document.documentElement;
    if (tabBar) root.dataset.tabs = openTabs.length ? 'rows' : 'on';
    else delete root.dataset.tabs;
    return () => {
      delete root.dataset.tabs;
    };
  }, [tabBar, openTabs.length]);
  /*
   * And whether the window is in two panes, said on the root so the stylesheets can ask without holding a copy of the
   * threshold. The rule is one expression in core/useWideScreen.ts; it used to be that expression plus a `900px` in
   * app.css and twice more in settings.css, which is three chances for the app to change shape at three widths. A
   * stamp has no number in it, so the panes and the chrome that dresses them can only agree.
   */
  useEffect(() => {
    const root = document.documentElement;
    if (sidebar) root.dataset.split = 'on';
    else delete root.dataset.split;
    return () => {
      delete root.dataset.split;
    };
  }, [sidebar]);
  /*
   * A canvas renamed from its tab (notes/NoteTabs.tsx): a canvas is named by `title:` in its front matter, since it
   * has no first line to write it in, and the only way to that was the note's own cog.
   *
   * Two ways to write it, and which one depends on whether the note is open. The note being read is the editor's:
   * its live body is a ref that only its own onChange sets, so a saveNote from here would be flushed away by the
   * next keystroke - it is asked instead, and writes it itself. Any other tab has no editor holding it, so it is a
   * plain write, of the body as the store has it rather than as this render remembers it.
   */
  const [rename, setRename] = useState<{ id: string; title: string; asked: number } | null>(null);
  const renameNote = (id: string, title: string) => {
    if (screen.name === 'note' && screen.note.id === id) {
      setRename({ id, title, asked: Date.now() });
      return;
    }
    void (async () => {
      const note = await getNote(id);
      if (!note) return;
      await updateNote(id, withFrontMatterTitle(note.body, title), note.revision ?? 1);
      await refresh();
    })();
  };
  const noteScreen =
    screen.name === 'note' ? (
      <NoteScreen
        key={screen.note.id}
        note={screen.note}
        onBack={() => void backToList()}
        onDelete={removeNote}
        onSpeak={speakInto}
        onPin={(n) => actions.pin(n)}
        at={screen.at}
        onOpenTitle={(title, at) => void openTitle(title, at)}
        hasTitle={hasTitle}
        onOpenWithin={openTitleWithin}
        book={bookOf(shownNotes, noteTitle(screen.note.body))}
        bodyOfTitle={bodyOfTitle}
        allTitles={() => shownNotes.map((n) => noteTitle(n.body)).filter(Boolean)}
        rename={rename}
        onArchive={(n) => {
          setOpen((was) => closeOpen(was, n.id));
          actions.archive(n, true);
          void backToList();
        }}
      />
    ) : null;
  /*
   * A to-do ticked on the home page: that one line of its note rewritten with its box ticked (core/boards.ts
   * `setItemDone`, the same change the editor's tick makes), and the notes read again.
   */
  const tickTask = async (task: OpenTask) => {
    const note = notes.find((n) => n.id === task.noteId);
    const lines = note?.body.split('\n');
    const line = lines?.[task.line];
    if (!note || !lines || line === undefined) return;
    lines[task.line] = setItemDone(line, true);
    await updateNote(note.id, lines.join('\n'), note.revision ?? 1);
    await refresh();
  };
  // Every note, from the home page's "All notes": the sidebar, docked or as its popover.
  const showAllNotes = () => {
    if (!docked) setDrawer(true);
    else if (!sidebarShown) toggleDock();
  };
  /*
   * The home page (home/HomeScreen.tsx): the start page on every screen (Matt: "Add a 'home' button to take us to a
   * dashboard like page"). It took the notes list's place on a phone and the empty "No note open" pane beside the
   * sidebar; the top bar's Glyph mark comes back to it from anywhere.
   */
  const home = (
    <HomeScreen
      notes={shownNotes}
      loading={loading}
      onOpen={(id, at) => {
        const note = notes.find((n) => n.id === id);
        if (note) setScreen({ name: 'note', note, at });
      }}
      onNew={() => setNewSheet(true)}
      onCapture={() => void launchCapture(false)}
      onSettings={() => setSettings(true)}
      onAllNotes={showAllNotes}
      onTick={(task) => void tickTask(task)}
      voiceModel={voiceModel.state}
      onRetryVoiceModel={voiceModel.retry}
      updates={updates}
      showAcademy={academyCard}
      onAcademy={() => setScreen({ name: 'academy' })}
      onHideAcademy={() => {
        dismissAcademyBanner();
        setAcademyCard(false);
      }}
    />
  );

  /*
   * The command palette (commands/palette.ts): what Glyph can do right now, and how. Built here because this is where
   * the app's doings already live - every command below is something a person can also do by hand.
   */
  const paletteWorld = useMemo(
    () => ({
      notes: shownNotes.map((n) => ({ id: n.id, title: noteTitle(n.body) })),
      tabs: openTabs.map((n) => ({ id: n.id, title: noteTitle(n.body) })),
      workspaces: spaces.list.map((w) => ({ id: w.id, name: w.name })),
      workspace: spaces.current?.id ?? null,
      note: screen.name === 'note' ? { id: screen.note.id, title: noteTitle(screen.note.body) } : null,
      filedIn: screen.name === 'note' ? (workspaceOf(screen.note.id)?.id ?? null) : null,
      pinned: screen.name === 'note' ? Boolean(screen.note.starred) : false,
      canBack: canGoBack(trail, stillThere),
      canForward: canGoOn(trail, stillThere),
      view: prefs.noteView,
      theme: prefs.theme,
      tabGroups: groups.list.map((g) => ({ id: g.id, name: g.name })),
      tabGroup: screen.name === 'note' ? (groups.of[screen.note.id] ?? null) : null,
    }),
    [shownNotes, openTabs, spaces, screen, trail, stillThere, prefs.noteView, prefs.theme, groups],
  );
  const paletteDoing = useMemo(
    () => ({
      openNote,
      newNote: () => void newNote(),
      speak: () => void launchCapture(false),
      speakInto,
      closeTab,
      showList: () => void backToList(),
      back: goBack,
      forward: goOn,
      settings: () => setSettings(true),
      cheatSheet: () => {
        setSettings(true);
        setToCheatSheet(Date.now());
      },
      guide: () => {
        setGuidePage(0);
        setGuide(true);
      },
      academy: () => setScreen({ name: 'academy' }),
      chooseWorkspace,
      fileNote,
      setView: (view: NoteView) => setPreferences({ noteView: view }),
      setTheme: (theme: ThemePref) => setPreferences(themeChoice(theme, preferences())),
      groupTab: (id: string) => setGroups((was) => newGroup(was, id).groups),
      joinTabGroup: (id: string, group: string) => setGroups((was) => joinGroup(was, id, group)),
      leaveTabGroup: (id: string) => setGroups((was) => leaveGroup(was, id)),
      pin: (id: string) => {
        const note = notes.find((n) => n.id === id);
        if (note) actions.pin(note);
      },
      archive: (id: string) => {
        const note = notes.find((n) => n.id === id);
        if (note) actions.archive(note, true);
      },
      remove: removeNote,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [notes, actions, trail],
  );

  /*
   * An update waiting: the sidebar's to carry on a wide window, where there is no home list to show them
   * (notes/NoteTree.tsx `notices`), docked or floating.
   */
  const notices = (
    <>
      <UpdateNotice updates={updates} />
    </>
  );

  return (
    <>
      {/* Under the status bar: what scrolls up fades out before it reaches the phone's clock and icons. */}
      <div className="app-statusScrim" aria-hidden="true" />
      {/* The Mac app's title bar: drags the window (app.css .app-dragBar; nothing on a phone). */}
      <div className="app-dragBar" data-tauri-drag-region aria-hidden="true" />
      {/*
        The app's own tab row, one bar of one height on every route that has it (app.css .app-tabBar). It used to be
        a row each screen's header carried, so it was as tall as that screen felt like being (Matt: "I want the tab
        nav to be the same height and dimensions across every route so make it part of the main app layout, also put
        the sidebar toggle in the same row as the tabs"). The screens know nothing about it: `--app-safe-top` carries
        its height, which is what every header already pads by.
      */}
      {tabBar ? (
        <div className="app-tabBar">
          <NoteTabs
            tabs={openTabs}
            activeId={screen.name === 'note' ? screen.note.id : ''}
            onOpen={openNote}
            onClose={closeTab}
            onNew={() => setNewSheet(true)}
            onSidebar={docked ? toggleDock : () => setDrawer((was) => !was)}
            onHome={() => void backToList()}
            atHome={screen.name === 'list'}
            sidebarOpen={docked ? sidebarShown : drawer}
            onAside={toggleAside}
            asideOpen={asideShown}
            onMove={(id, to, grouped) => {
              // Moved within the order as drawn. A drag has already said which group the tab is in (NoteTabs.tsx
              // `groupAt`); a move by the keys asks where it landed - into a group, or out of one.
              const next = moveOpen(open, drawnIds, id, to);
              setOpen(next);
              if (!grouped) setGroups((was) => afterMove(was, next.filter((each) => drawnIds.includes(each)), id));
            }}
            groups={groups}
            onGroups={setGroups}
            onCloseTabs={(ids) => ids.forEach((id) => closeTab(id))}
            onGoBack={goBack}
            onGoOn={goOn}
            canGoBack={canGoBack(trail, stillThere)}
            canGoOn={canGoOn(trail, stillThere)}
            onRename={renameNote}
          />
        </div>
      ) : null}
      {/* The wisp edge's filter, for every view that scrolls under a header (art/wispEdge.ts). */}
      <WispEdgeFilter />
      {screen.name === 'capture' ? (
        <CaptureScreen
          key={screen.key}
          fromAssistant={screen.fromAssistant}
          stopRequests={screen.stop}
          noteId={screen.noteId}
          onFinish={(note, locked, review) => void captureFinished(note, locked, review)}
        />
      ) : screen.name === 'academy' ? (
        <AcademyScreen
          onDone={() => setScreen({ name: 'list' })}
          onCheatSheet={() => {
            setScreen({ name: 'list' });
            setSettings(true);
            setToCheatSheet(Date.now());
          }}
        />
      ) : screen.name === 'review' ? (
        <ReviewScreen
          key={screen.handoff.noteId}
          handoff={screen.handoff}
          onDone={(id) => {
            void (async () => {
              await refresh();
              const fresh = await getNote(id).catch(() => null);
              setScreen(fresh ? { name: 'note', note: fresh } : { name: 'list' });
            })();
          }}
        />
      ) : split ? (
        <div className="app-split" data-sidebar={dockShown ? 'shown' : 'hidden'} data-aside={asideShown ? 'shown' : 'hidden'}>
          {/*
            The same tree the pop-up sidebar is (notes/NoteTree.tsx), docked (Matt: "Make the sidebar on desktop the
            same sidebar that shows up in the pop-up sidebar"). It was the whole home list squeezed into a column; the
            two things that list carried that a desktop has nowhere else to show - an update waiting, a memo waiting -
            come with it.
          */}
          {dockShown ? (
            <aside className="app-sidebar" aria-label="All notes">
              <NoteTree
                notes={shownNotes}
                activeId={shown}
                onOpen={openNote}
                onNew={() => setNewSheet(true)}
                onCommands={openCommands ?? undefined}
                onSettings={() => setSettings(true)}
                onSpeak={() => void launchCapture(false)}
                notices={notices}
                trashed={trashedNotes}
                onRestore={actions.restore}
                onDestroy={actions.destroy}
                onEmptyTrash={() => void actions.emptyTrash(trashedNotes)}
              />
            </aside>
          ) : null}
          <main className="app-notePane">
            {noteScreen ?? home}
          </main>
          {/* The right-hand aside as a column: a book's index, or the workspace's notes (aside/Aside.tsx). */}
          {asideShown ? (
            <aside className="app-aside" aria-label="Book index and notes">
              <Aside content={asideBody} workspace={spaces.current?.name ?? null} onOpen={asideBody.kind === 'book' ? openNoteWithin : openNote} onOpenTitle={openTitleWithin} />
            </aside>
          ) : null}
        </div>
      ) : (
        (noteScreen ?? home)
      )}
      {/* On a phone the same aside comes over the note from the right; the scrim, the X or the back gesture close it. */}
      {!split && asideShown ? (
        <div className="app-asideOver">
          <div className="app-asideScrim" onClick={toggleAside} />
          <div className="app-asidePanel" role="dialog" aria-modal="true" aria-label="Book index and notes">
            <Aside content={asideBody} workspace={spaces.current?.name ?? null} onOpen={(id) => { toggleAside(); (asideBody.kind === 'book' ? openNoteWithin : openNote)(id); }} onOpenTitle={(t) => { toggleAside(); openTitleWithin(t); }} onClose={toggleAside} />
          </div>
        </div>
      ) : null}
      {/* After an update: what it changed, once (notes/WhatsNewSheet.tsx). Not over the guide or a recording. */}
      <NewSheet open={newSheet} onClose={() => setNewSheet(false)} onNote={() => void newNote()} onCanvas={() => void newCanvas()} onBook={newBook} onFromLink={forkFromLink} />
      <NewBookSheet open={bookSheet} onClose={() => setBookSheet(false)} titles={pageTitles()} onCreate={(title, pages) => void createBook(title, pages)} />
      <WhatsNewSheet sources={updates.status?.sources} hold={guide || screen.name === 'capture'} />
      {/* Every note, in a card over the one being read; the tab row's icon opens it (notes/NotesDrawer.tsx). */}
      <NotesDrawer
        open={drawer}
        notices={split ? notices : undefined}
        notes={shownNotes}
        trashed={trashedNotes}
        onRestore={actions.restore}
        onDestroy={actions.destroy}
        onEmptyTrash={() => void actions.emptyTrash(trashedNotes)}
        activeId={shown}
        onOpen={openNote}
        onNew={() => {
          setDrawer(false);
          setNewSheet(true);
        }}
        onClose={() => setDrawer(false)}
        onSettings={() => {
          setDrawer(false);
          setSettings(true);
        }}
        onSpeak={() => {
          setDrawer(false);
          void launchCapture(false);
        }}
        onCommands={
          openCommands
            ? () => {
                setDrawer(false);
                openCommands();
              }
            : undefined
        }
      />
      {/* Everything Glyph can do, searched (commands/). ⌘K is the kit's; the drawer's first row is the phone's. */}
      <CommandBar world={paletteWorld} doing={paletteDoing} onReady={paletteReady} />
      <SettingsSheet
        open={settings}
        onClose={() => setSettings(false)}
        updates={updates}
        onGuide={(page) => {
          setSettings(false);
          // A row's press hands its event along; only a number is a page.
          setGuidePage(typeof page === 'number' ? page : 0);
          setGuide(true);
        }}
        onSample={() => void sampleNote()}
        onBoard={() => void boardNote()}
        onCanvas={() => void canvasNote()}
        onHowCanvas={() => void howCanvasNote()}
        onAcademy={() => {
          setSettings(false);
          setScreen({ name: 'academy' });
        }}
        toCheatSheet={toCheatSheet}
      />
      {/*
        Not over a capture. The side key can arrive while the guide is open -
        most often BECAUSE of it, testing step 2 - and a guide drawn over the
        capture screen hides the recording the person just started. It steps
        aside and comes back when the capture ends, so they carry on where
        they were.
      */}
      {guide && screen.name !== 'capture' ? (
        <Guide
          index={guidePage}
          tooSoon={tooSoon}
          onIndex={(index) => {
            setGuidePage(index);
            setTooSoon(false);
          }}
          onClose={() => {
            markGuideSeen();
            setGuide(false);
            // The list underneath loaded while the guide was up; ask again now it shows.
            void refresh();
          }}
          onTry={() => void launchCapture(false)}
        />
      ) : null}
    </>
  );
}
