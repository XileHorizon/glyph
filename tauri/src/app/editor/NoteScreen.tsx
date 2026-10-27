import { Ghost } from '../art/Ghost.tsx';
import { createPortal } from 'react-dom';
import { useTopBarTail, useTopBarTools } from '../core/topBarTools.ts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '@glacier/react';
import { Archive, Bookmark, BookmarkCheck, History, MessageSquarePlus, Mic, Pin, PinOff, Share2 } from '@glacier/icons';
import { Sheet } from './Sheet.tsx';
import { SheetTitle } from '../plugins/kit.tsx';
import { ShareRows } from '../share/ShareRows.tsx';
import type { ToolAction } from './NoteTools.tsx';
import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { undoDepth } from '@codemirror/commands';
import { footSmokes, useWispEdge, WISP_EDGE_FOOT_CLEAR } from '../art/wispEdge.ts';
import { useNotePlace } from './notePlace.ts';
import { boardFrom } from '../core/boards.ts';
import { hasClips, tapeId } from '../core/clips.ts';
import { useNoteZoom } from './pinchZoom.ts';
import { ContextMenu } from './ContextMenu.tsx';
import { FindBar } from './FindBar.tsx';
import { Editor } from './Editor.tsx';
import { CanvasView } from '../canvas/CanvasView.tsx';
import { canvasOf, isCanvasBody, withCanvas } from '../canvas/jsonCanvas.ts';
import { BookBar, BookFoot } from '../book/BookNav.tsx';
import { BookView } from '../book/BookView.tsx';
import { JournalView } from '../book/JournalView.tsx';
import { isBookBody, isJournalBody, type BookPlace } from '../book/book.ts';
import { entryPlaceOf, templateOf, withEntryPlace, withJournal, withoutJournal, withTemplate, type JournalWriter } from '../book/journal.ts';
import { withNotebookKey } from '../book/tickets.ts';
import type { TicketOptions } from './tickets.ts';
import type { QueryOptions } from './queries.ts';
import { forgetUntouched, isFresh, isUntouched, keepFresh, rememberUntouched, spoilFresh, untouchedRecord } from '../core/untouched.ts';
import { lookOf, withLook, type Look } from '../core/look.ts';
import { nameOffers } from '../core/noteNames.ts';
import { setLiveTitle } from '../core/liveTitles.ts';
import { isGuideBook } from '../guidebook/guidebook.ts';
import { writeBookSpot } from '../book/bookSpot.ts';
import { frontMatterOffset, frontMatterValue, withFrontMatterTitle } from '../core/frontMatter.ts';
import { geoTagOf, sameTag, tagOf, withGeoTag, type GeoTag } from '../core/geotag.ts';
import {
  canAskPlace,
  canLocate,
  canShowTiles,
  forgetRefusal,
  heldFor,
  holdFor,
  landTag,
  locate,
  pendingTag,
  placeFor,
  placeName,
  refusedFor,
  rememberRefusal,
  setPendingTag,
  settleTag,
  tagEntryIfWanted,
  wantPlace,
  watchTag,
  whyLocateFailed,
  type LocateFailure,
} from '../core/location.ts';
import { placeMarkdown } from '../core/placeRefs.ts';
import { videoMarkdown } from '../core/videoRefs.ts';
import { canAddVideos, pickVideo } from '../core/videos.ts';
import { failureText } from '../core/failure.ts';
import { filmAdded } from './videos.ts';
import { afterComposition, focusToken, insertLineAt, nameLater, releaseSpot, reserveSpot, spotAt } from './inserts.ts';
import { plusRecheck, type PlusHooks, type PlusKey, type PlusOpening } from './insertPlus.ts';
import { AddList } from './AddList.tsx';
import { REVIEW_HANDED_BACK } from '../ai/useNoteReview.ts';
import { hasLocationBridge } from '../core/placeLink.ts';
import { MapCard, MapPicture } from './MapCard.tsx';
import { TemplateCards } from '../notes/TemplateCards.tsx';
import { fillNoteTemplate, type NoteTemplate } from '../notes/noteTemplates.ts';
import { authorsOf } from '../core/authors.ts';
import { Byline } from '../authors/Byline.tsx';
import { useBack } from '../core/back.ts';
import { fireNativeHaptic } from '../core/haptics.ts';
import { useUnfold } from '../core/unfold.ts';
import { getNote, type Note } from '../core/store.ts';
import { noteTitle } from '../core/noteTitle.ts';
import { titleKey } from '../core/titleKey.ts';
import { syncWithin } from '../core/sync/engine.ts';
import { PullToRefresh } from '../notes/PullToRefresh.tsx';
import { setPreferences, useDarkNow, usePreferences } from '../core/preferences.ts';
import { shownView, type NoteView } from './viewMode.ts';
import type { ReviewHandoff } from '../ai/review.ts';
import { enqueueSummary, onRecordingChanged } from '../ai/summaries.ts';
import { keptText, summaryBehind, summaryUnchanged } from '../ai/summaryKeep.ts';
import { summaryKindOf } from '../home/dashboard.ts';
import { summarySection } from '../ai/summaryText.ts';
import type { CaptureLanding } from '../capture/landing.ts';
import { keepAllChanges } from './aiChanges.ts';
import { NoteTape, TranscriptWords } from '../tapes/NoteTape.tsx';
import { NoteSettings } from './NoteSettings.tsx';
import { useNoteComments } from './useNoteComments.tsx';
import { LinkMarks } from '../plugins/LinkMarks.tsx';
import { AiStrip } from '../ai/AiStrip.tsx';
import { AtWork } from '../scene/AtWork.tsx';
import { boardMadeWords } from './boardActions.ts';
import { itemSend, lineOffers, noteEditing } from './notePlugins.ts';
import { NoteMore, NoteTools, type NoteKind } from './NoteTools.tsx';
import { useBookmark } from './useBookmark.ts';
import { useLandAt } from './useLandAt.ts';
import { useLanding } from './useLanding.ts';
import { useOrgs } from '../core/orgs/orgs.ts';
import { orgIdOf, useWorkspaces } from '../core/workspaces.ts';
import { useLiveNote } from './useLiveNote.ts';
import { useTeamNote } from './useTeamNote.ts';
import { isSpot, type Jump } from '../core/live/presence.ts';
import { useNoteAi, type NoteAsk } from './useNoteAi.ts';
import { fillPlanOf } from './blanks.ts';
import { useNotePictures } from './useNotePictures.ts';
import { useNoteSaving, type NoteRename } from './useNoteSaving.ts';
import { useVersionKeeping } from './useVersionKeeping.ts';
import { keepVersion } from '../core/versions/record.ts';
import { liveNoteOpened } from '../core/versions/live.ts';
import type { Version } from '../core/versions/file.ts';
import { useNoteTape } from './useNoteTape.ts';
import { useStripRoom } from './useStripRoom.ts';
import styles from './NoteScreen.module.css';

/**
 * One note, open: the words in their editor (editor/Editor.tsx), and everything that floats over or beside them.
 *
 * This component owns SAVING, and saving is the part with teeth: the words are kept in a ref, saved on a debounce,
 * and flushed on every way the app can go away and every way off the note this screen offers
 * (editor/useNoteSaving.ts says why). Everything outside the screen that must change the open note asks it rather
 * than writing the store - a rename from the tab comes in as `rename`.
 *
 * One screen shows five things in one place. While a spoken note's tape plays, the transcript - the recording's
 * phrases following the sound - takes the page (Matt: "the default mode whenever we're playing, not a different
 * tab"), and steps aside when it stops. Otherwise the note's own view: its words, or, for a note that is a canvas or a
 * book, the canvas drawn or the book's index, with the JSON or Markdown behind the view switch. The editor stays
 * mounted behind whichever of the others is up, hidden, so nothing typed is lost and its caret keeps its place.
 *
 * The rest is composed here from pieces with one job each: the tools (editor/NoteTools.tsx) and the bookmark behind
 * one of them (editor/useBookmark.ts), the tape and its removal (editor/useNoteTape.ts), the AI in the note
 * (editor/useNoteAi.ts, with the room its strip takes in editor/useStripRoom.ts), pictures and the note's one line
 * of problems (editor/useNotePictures.ts), landing on an item a link pointed at (editor/useLandAt.ts), live sync
 * (editor/useLiveNote.ts), and the ways plugins reach the note (editor/notePlugins.ts).
 *
 * Where the note was written is the screen's own (core/geotag.ts, core/location.ts): the map card at the top of the
 * note with the byline, drawn from the note's tag or from one waiting to be written; the tag written into the front
 * matter through the editor, as one undo step, so the words are untouched and the save is typing's; and the More
 * sheet's Add my location and Remove location. A tag waiting for a recording's better words lands here once the pass
 * has landed or the review has handed back, and a new note's once it has words.
 *
 * So is the + beside an empty line (editor/insertPlus.ts) and its list (editor/AddList.tsx): this screen says when a
 * + may show, opens the list against it, and owns the rows that leave the editor, the picker for a picture, the fix
 * and the name for a place, which lands as a line of its own with its map card under it (`addPlace`), and the Photo
 * Picker for a film, which lands the same way with its card, played here where it is on this phone (`addVideo`).
 */

interface NoteScreenProps {
  note: Note;
  onBack: () => void;
  onDelete: (id: string) => void;
  /**
   * Talk into this note: the recorder, aimed here, and back here after. Left out where nothing records (the iPhone app,
   * core/platform.ts `recordsVoice`), and the note's mic and its recording's Add with it.
   */
  onSpeak?: (id: string) => void;
  onPin: (note: Note) => void;
  onArchive: (note: Note) => void;
  /**
   * The note's version history in the desktop's side panel (aside/AsideHistory.tsx), from the bar's History button;
   * left out where there is no side panel to hold it, when the More sheet's history page opens instead.
   */
  onHistory?: () => void;
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
  /** Makes a canvas by that title and opens it in this tab: a book's "Add a canvas" (book/BookView.tsx). */
  onNewCanvas?: (title: string) => void;
  /** A notebook's new page made from a template (App.tsx `openPageWithin`): Add a page's Start with. */
  onNewPage?: (title: string, template: string) => void;
  /** A note's body by its title, for a canvas card that is a note to be drawn small (canvas/CanvasView.tsx). */
  bodyOfTitle?: (title: string) => string | null;
  /** The note by its title, for a journal's entries: when each was written, where, and how it starts (book/JournalView.tsx). */
  noteOfTitle?: (title: string) => Note | undefined;
  /** New entry, for a journal (App.tsx `newEntry`): the journal's one action. */
  /** New entry, from the template chosen under it; left out, the journal's own. */
  onNewEntry?: (template?: string) => void;
  /**
   * A journal open here hands App the way to write its index through this screen (book/journal.ts `JournalWriter`),
   * and takes it back as it goes: an entry's line put in or taken out while the journal is open is a change the screen
   * makes and saves, never a write under it that its next save would undo or be refused by.
   */
  onJournal?: (writer: JournalWriter | null) => void;
  /**
   * A note just made, to be written in: the caret at this place in its words, or `end`, the editor focused and the
   * keyboard up where the phone allows it (shell/screen.ts). Absent, a note opened to be read, which takes no focus.
   */
  caret?: number | 'end';
  /** A member's caret, or their spot on a canvas, to open at (shell/screen.ts `cursor`): the selection put there once the team's document is bound, or the canvas panned there. */
  cursor?: Jump;
  /** Every note's title, for a canvas's + to choose a note from. */
  allTitles?: () => string[];
  /** The titles a notebook's index offers to add as a page: every note's but a journal's entries; absent, every note's. */
  pageTitles?: () => string[];
  /**
   * A canvas renamed from its tab (notes/NoteTabs.tsx), while this is the note being read.
   *
   * It cannot be written from outside: the live body is a ref here that only this screen's own `onChange` sets, so a
   * `saveNote` from App would be flushed away by the next keystroke. So the row asks, and the screen writes it the
   * way the canvas itself writes - through `onChange`, on the same debounce as typing. `asked` rises with each
   * asking, so renaming twice to the same name still lands.
   */
  rename?: NoteRename | null;
  /** A spoken instruction about this note, to run on it as it opens (App.tsx, ai/instruction.ts); `key` tells one from the next. */
  ask?: NoteAsk;
  /**
   * Every note's title key, archived and in the Trash too (App.tsx): a name another note has is not offered on a new
   * note's blank page (core/noteNames.ts). Absent, nothing is taken.
   */
  takenTitles?: ReadonlySet<string>;
  /** Your own templates, the pages of your Templates notebook (notes/ownTemplates.ts); absent or null, the six built in. */
  templates?: readonly NoteTemplate[] | null;
  /** Your templates, from the blank page: the notebook they are kept in, made the first time (App.tsx). */
  onTemplates?: () => void;
  /** The review after the recording that just made or grew this note (ai/useNoteReview.ts): run here, in the strip and the note. */
  review?: ReviewHandoff & { key: number };
  /** What the recording that just ended wrote into this note, for its Undo (editor/useLanding.ts). */
  landing?: CaptureLanding & { key: number };
  /** Settings at the Model card: a press of the AI with no model on the phone offers it. */
  onGetModel?: () => void;
  /**
   * The library's tickets (editor/tickets.ts; docs/DESIGN.md §157): a ticket's front matter drawn as its properties, a
   * `[[GHO-12]]` with its title, and a notebook with a key making its tickets (`onNewTicket`, with `ticketTemplates`).
   */
  tickets?: TicketOptions;
  /**
   * The library a ```query fence reads, and how to open and tick what it finds (editor/queries.ts; docs/DESIGN.md
   * §159). The note's own id is put in here, so the query reads this note as it is being typed.
   */
  queries?: Omit<QueryOptions, 'noteId'>;
  onNewTicket?: (title: string, notebook: string, template: NoteTemplate | null) => void;
  ticketTemplates?: readonly NoteTemplate[];
}

/** Nothing taken, for a screen given no titles. */
const NO_TITLES: ReadonlySet<string> = new Set();

/** The time now, read again at the turn of each minute while `on`: the blank page's names follow the clock. */
function useMinute(on: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!on) return undefined;
    const tick = () => setNow(new Date());
    tick();
    let every = 0;
    const first = window.setTimeout(
      () => {
        tick();
        every = window.setInterval(tick, 60_000);
      },
      60_000 - (Date.now() % 60_000) + 20,
    );
    return () => {
      window.clearTimeout(first);
      window.clearInterval(every);
    };
  }, [on]);
  return now;
}

/** How long a place from the + waits for its name before it is written with its coordinates (core/location.ts rule 2). */
const NAME_WAIT_MS = 3000;

/** What the note says when a fix did not come (core/location.ts `LocateFailure`). */
const NO_FIX: Record<LocateFailure, string> = {
  refused: 'Ghost.md wasn’t allowed to know where you are.',
  blocked: 'Location is off for Ghost.md.',
  unavailable: 'Couldn’t find where you are. Try again with location on, or outside.',
  timeout: 'Couldn’t find where you are. Try again with location on, or outside.',
  none: 'This browser can’t say where you are.',
  mac: 'This Mac can’t say where it is yet.',
  ios: 'Ghost.md can’t find where you are on this device yet.',
  'local-only': 'Local only is on.',
};

export function NoteScreen({
  note,
  onBack,
  onDelete,
  onSpeak,
  onPin,
  onArchive,
  onHistory,
  onOpenTitle,
  hasTitle,
  book,
  onOpenWithin,
  onNewCanvas,
  onNewPage,
  bodyOfTitle,
  noteOfTitle,
  onNewEntry,
  onJournal,
  caret,
  cursor,
  allTitles,
  pageTitles,
  at,
  rename,
  ask,
  review,
  landing,
  takenTitles,
  templates,
  onTemplates,
  onGetModel,
  tickets,
  queries,
  onNewTicket,
  ticketTemplates,
}: NoteScreenProps) {
  const prefs = usePreferences();
  // The page's side, followed while the note is open: on System the phone may turn dark under it.
  const dark = useDarkNow(prefs.theme);
  const chooseView = (value: NoteView) => {
    if (prefs.noteView === value) return;
    setPreferences({ noteView: value });
    fireNativeHaptic('selection');
  };
  const [view, setView] = useState<EditorView | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  viewRef.current = view;
  const { toast, dismiss } = useToast();
  // The live words, and their saving: everything below that reads or writes the note goes through these. Words that
  // arrive from outside the editor - a meeting's transcript from the phone's write-up - are put into it whole.
  const { body, onChange: keep, flush, settled, title, blank, adopt } = useNoteSaving(note, rename, {
    onExternalChange: (next) => {
      const editor = viewRef.current;
      if (!editor) return;
      const now = editor.state.doc.toString();
      if (now !== next) editor.dispatch({ changes: { from: 0, to: now.length, insert: next } });
    },
  });
  // The phone's write-up changed this note (ai/summaries.ts `onRecordingChanged`): its transcript is read and shown,
  // when nothing typed here is waiting to be saved; else the next save picks it up.
  useEffect(
    () =>
      onRecordingChanged((id) => {
        if (id !== note.id) return;
        void getNote(note.id)
          .then((fresh) => {
            if (fresh) adopt(fresh);
          })
          .catch(() => undefined);
      }),
    [note.id, adopt],
  );
  /*
   * Where the note was written: the tag its front matter carries, or one waiting to be written (core/location.ts),
   * kept as the screen's own state the way `pinned` is, since `note` is the store's copy at open and `body` is a ref.
   * Every change to the words passes through here, so a `location:` typed by hand, or one arriving by live sync,
   * redraws the card, and a tag that has not changed leaves the state as it was.
   */
  const [tag, setTag] = useState<GeoTag | null>(() => geoTagOf(note.body) ?? pendingTag(note.id));
  /*
   * How the note looks (core/look.ts; docs/DESIGN.md §144): its map as a header across the column, or a page to read.
   * Read from every change, as the tag is, so a look written by a template, the More sheet or live sync redraws it.
   */
  const [look, setLook] = useState<Look | null>(() => lookOf(note.body));
  /*
   * A journal's entry this device made and nobody has written in yet (core/untouched.ts; docs/DESIGN.md §142). Not
   * `blank`, which keeps its meaning, no words at all, so the blank note's ghost never draws over an entry's date:
   * this is its own state, read from the entry's record, and followed only for a note that has one. While it holds, a
   * tag waits for the entry's first own words and the map fetches no tiles, since the entry is taken back if it is
   * left as it is (App.tsx).
   *
   * Its first own words make it the person's there and then: the record goes on the keystroke, not when the save
   * lands. App decides a take-back from the store, and the words reach the store 400 ms later, or on the way out a
   * turn after App has looked, so an entry typed in and left at once for home was taken back with its words.
   */
  const drafted = useRef(untouchedRecord(note.id) !== null);
  const [untouched, setUntouched] = useState(() => drafted.current && isUntouched(note.id, note.body, note));
  /*
   * A note made in this run that nobody has written in (core/untouched.ts `markFresh`): only it is offered names and
   * templates on its blank page. The person's first own words spoil it for good, before the record they are compared
   * with can be forgotten below.
   */
  const [fresh, setFreshNote] = useState(() => isFresh(note.id));
  const freshNow = useRef(fresh);
  // The note's version history, where it keeps one (core/versions/record.ts): a version after a pause, and on leaving.
  const versioning = useVersionKeeping(note.id, body);
  const versionChanged = versioning.changed;
  const onChange = useCallback(
    (next: string) => {
      keep(next);
      versionChanged();
      const now = geoTagOf(next) ?? pendingTag(note.id);
      setTag((was) => (sameTag(was, now) ? was : now));
      setLook(lookOf(next));
      if (freshNow.current) {
        keepFresh(note.id, next);
        if (!isFresh(note.id)) {
          freshNow.current = false;
          setFreshNote(false);
        }
      }
      if (!drafted.current) return;
      const still = isUntouched(note.id, next);
      setUntouched(still);
      if (still) return;
      forgetUntouched(note.id);
      drafted.current = false;
    },
    [keep, versionChanged, note.id],
  );
  /**
   * The map's box held for a new note while its fix is on its way, or once it is known none is coming (core/location.ts
   * `holdFor`): drawn empty at the card's full height from the first frame, so the card arriving in it, or a fix that
   * failed, never moves line 1 under the caret. Kept until the note is left.
   */
  const [hold, setHold] = useState(() => heldFor(note.id));
  /** The card just appeared on this open note: it arrives on the beat rather than at full height. */
  const [arriving, setArriving] = useState(false);
  /** The tag just taken off, drawn a moment longer while its card leaves on the same beat; null otherwise. */
  const [leaving, setLeaving] = useState<GeoTag | null>(null);
  /** Whether the screen is still up: a fix that comes after the note was left is kept for it rather than lost. */
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
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
  /**
   * A pull down from the top of the note (notes/PullToRefresh.tsx, docs/DESIGN.md §152): what is typed saved first, a
   * sync, and the note as the store then has it taken into the editor (useNoteSaving.ts `adopt`) - unless something
   * typed since is still to be saved, which the next save's rebase looks after.
   */
  const pullNote = async () => {
    await settled();
    await syncWithin();
    const stored = await getNote(note.id).catch(() => null);
    if (stored) adopt(stored);
  };
  /*
   * A note that is a book (docs/BOOKS.md) is drawn as its index the same way, its Markdown behind the same switch.
   * The view's own changes (a chapter added, moved, taken out) are written through `onChange` like typing and kept
   * here too, so the index redraws from what it just wrote.
   */
  const [bookBody, setBookBody] = useState(note.body);
  const isBook = useMemo(() => isBookBody(bookBody), [bookBody]);
  // A rename from the tab lands in the live body (editor/useNoteSaving.ts), and the index is drawn from its own copy:
  // it takes the new name too, or its next change would write the old one back.
  useEffect(() => {
    if (rename?.id === note.id) setBookBody(body.current);
    // Each asking is its own, as it is for the saving.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rename?.asked]);
  /** The name typed in the More sheet, into the front matter; the index takes it too, as it takes one from the tab. */
  const renameHere = (next: string) => {
    const named = withFrontMatterTitle(body.current, next);
    onChange(named);
    if (isBook) setBookBody(named);
  };
  /*
   * A notebook kept as a journal, or a journal's template and place switch (docs/DESIGN.md §142): written as the
   * notebook's own changes are, and into the editor where its Markdown is the view, so the next keystroke there does
   * not write the old keys back. Not the Guide's: a manual is not a diary.
   */
  const isJournal = useMemo(() => isJournalBody(bookBody), [bookBody]);
  const writeNotebook = (change: (was: string) => string) => {
    const next = change(body.current);
    if (next === body.current) return;
    if (source && view?.dom.isConnected) {
      const doc = view.state.doc.toString();
      view.dispatch({ changes: { from: 0, to: doc.length, insert: change(doc) } });
    } else onChange(next);
    setBookBody(next);
  };
  const journalRows =
    isBook && !isGuideBook({ ...note, body: bookBody })
      ? {
          on: isJournal,
          template: templateOf(bookBody),
          place: entryPlaceOf(bookBody),
          keep: (template: string, place: boolean) => writeNotebook((was) => withJournal(was, template, place)),
          setTemplate: (text: string) => writeNotebook((was) => withTemplate(was, text)),
          setPlace: (on: boolean) => writeNotebook((was) => withEntryPlace(was, on)),
          unkeep: () => writeNotebook(withoutJournal),
        }
      : undefined;
  /** A notebook's ticket key (book/tickets.ts; docs/DESIGN.md §157), written as its other keys are. Not a journal's. */
  const ticketKey = journalRows && !isJournal ? { value: frontMatterValue(bookBody, 'key') ?? '', onChange: (typed: string) => writeNotebook((was) => withNotebookKey(was, typed)) } : undefined;
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
  useLiveNote(view, note.id);
  const team = useTeamNote(view, note.id, cursor);
  // The colour this person wears here, for their own selection (editor/glyphTheme.ts `ownSelection`): the
  // organization's in a team's note, else the account's own; none chosen is the ink bar.
  const orgsNow = useOrgs();
  const filedIn = useWorkspaces().of[note.id];
  const inOrg = filedIn ? orgIdOf(filedIn) : null;
  const myHue = (inOrg ? orgsNow.list.find((row) => row.id === inOrg)?.colour : orgsNow.colour) ?? null;
  // The tab says the note's name as line 1 is written (core/liveTitles.ts), a name tapped on its blank page included.
  useEffect(() => setLiveTitle(note.id, title), [note.id, title]);
  // "Added to House TODOs", with an Undo that is an edit here; and no better words written under the open note.
  useLanding(note.id, landing, view, { toast, dismiss });
  const pictures = useNotePictures(view);
  // Comments on the note (docs/SHARED.md, S8): the rounds the editor draws, every way in, and the thread's card.
  const comments = useNoteComments(note.id, view, (message) => toast({ message }));
  const { tape, recording, removeRecording, forgetRemoved } = useNoteTape(note, body, toast);
  /** The More sheet: how it is read, the AI, pin, archive, what the note is linked to, delete (NoteSettings.tsx). */
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The More sheet opened at a page of its own, by a button in the bar: its version history.
  const [settingsAt, setSettingsAt] = useState<'history' | null>(null);
  const openSettings = (at: 'history' | null = null) => {
    setSettingsAt(at);
    setSettingsOpen(true);
  };
  // The note's share link, in a window of its own from the bar's Share button (share/ShareRows.tsx).
  const [sharing, setSharing] = useState(false);
  /** Find and replace, open with its first words, or null when it's closed (FindBar.tsx). */
  const [finding, setFinding] = useState<string | null>(null);
  // Local, because App keeps the same `note` after a pin (notes/useNoteActions.ts toggles `!note.starred`): passing
  // `note` unchanged would pin, then unpin, then pin.
  const [pinned, setPinned] = useState(Boolean(note.starred));
  /** The tape and the note's scrolling page. */
  const page = useRef<HTMLDivElement>(null);
  const header = useRef<HTMLElement>(null);

  const back = () => {
    flush();
    onBack();
  };

  // The phone's back gesture: the list.
  useBack(true, back);

  // On a folding phone, the note flattens with the hinge as the phone opens.
  const screen = useRef<HTMLDivElement>(null);
  useUnfold(screen);
  const onStripHeight = useStripRoom(screen, header);

  const ai = useNoteAi({ note, view, flush, body, wisp: prefs.wisp, ask, review, toast, onGetModel });

  const remove = () => {
    // No confirmation: it goes to the trash, with an Undo, and is only deleted
    // for good from there (core/trash.ts, notes/useNoteActions.ts).
    fireNativeHaptic('warning');
    onDelete(note.id);
  };

  const editing = noteEditing(note.id, view, () => body.current, pictures.say);

  /*
   * Whether a review is live for this note and has not handed its job back (ai/useNoteReview.ts): a tag waits on it,
   * since the better words land only if the note still reads as Done saved it (core/location.ts, section 3).
   */
  const reviewing = useRef(Boolean(review && review.noteId === note.id && review.job));
  /**
   * How many undo steps the tag has written through the editor that the person did not take: a tag that waited for the
   * note's first words landing, and its name coming. A place's name that comes late is written only while the place is
   * still the newest change the person made (editor/inserts.ts `nameLater`), and in a new note under Tag new notes, or
   * an entry whose journal keeps where it was written, the waiting tag lands just after a first insert from the +, as a
   * step of its own and its name another. Counted, they are not taken for something the person did, and the name is
   * still written. Add my location and Remove location are the person's, and not counted.
   */
  const tagSteps = useRef(0);
  /**
   * The tag written into the note, or taken out: through the editor where it holds the words, as one change to the
   * front matter alone (one undo step, the caret kept in view, saved like typing); through `onChange` where the
   * editor is hidden behind a canvas or a book's index, as a rename is (`renameHere`). Null takes both keys out.
   * `mine` for a write the person asked for from the sheet.
   */
  const writeTag = (next: GeoTag | null, mine = false): boolean => {
    if (typed && !source) {
      const after = withGeoTag(body.current, next);
      if (after !== body.current) {
        onChange(after);
        setCanvasBody(after);
        setBookBody(after);
      }
    } else if (view && mounted.current && view.dom.isConnected) {
      const doc = view.state.doc.toString();
      const after = withGeoTag(doc, next);
      if (after !== doc) {
        const was = frontMatterOffset(doc);
        const now = frontMatterOffset(after);
        /*
         * The caret stays with the words. CodeMirror keeps a caret at an insertion point before what is inserted, so
         * a caret at the top of a note with no front matter would be left in front of the new opening fence, and the
         * next keystroke would break the block and turn the tag into words (which a share then carries). A caret in
         * the block, or at its end, goes to the start of the words; one in the words moves by what the block grew.
         */
        const place = (pos: number) => (pos <= was ? now : pos + now - was);
        const selection = EditorSelection.create(
          view.state.selection.ranges.map((range) => EditorSelection.range(place(range.anchor), place(range.head))),
          view.state.selection.mainIndex,
        );
        view.dispatch({ changes: { from: 0, to: was, insert: after.slice(0, now) }, selection, scrollIntoView: true, userEvent: 'input.location' });
        if (!mine) tagSteps.current += 1;
      }
    } else {
      // No editor (not here yet, or the note was left): the next look, or the note's own store (`landTag`).
      return false;
    }
    setTag(next);
    setPendingTag(note.id, null);
    return true;
  };
  /**
   * A tag waiting for this note lands once it may (core/location.ts `settleTag`): the better words in, the note with
   * words. Until then the card is drawn from it. A note that says where it was written already keeps what it says.
   */
  const settle = (mine = false) => {
    const waiting = pendingTag(note.id);
    if (!waiting) return;
    if (geoTagOf(body.current)) {
      setPendingTag(note.id, null);
      return;
    }
    if (settleTag(note.id, body.current, { reviewing: reviewing.current }) !== null && writeTag(waiting, mine)) {
      // In the note now, so its name may be asked (this device made it; core/location.ts decides whether it may).
      wantPlace(note.id, waiting);
      return;
    }
    setTag((was) => (sameTag(was, waiting) ? was : waiting));
  };
  /** A name that came for the note's tag: written into the note, or onto the tag still waiting. */
  const namePlace = (place: string, lat: number, lon: number) => {
    const inBody = geoTagOf(body.current);
    if (inBody && !inBody.place && inBody.lat === lat && inBody.lon === lon) {
      writeTag({ ...inBody, place });
      return;
    }
    // The tag still waiting (core/location.ts may have named it already, as it told this screen): the card says it.
    const waiting = pendingTag(note.id);
    if (waiting && waiting.lat === lat && waiting.lon === lon) {
      const named = { ...waiting, place };
      if (waiting.place !== place) setPendingTag(note.id, named);
      setTag((was) => (sameTag(was, named) ? was : named));
    }
  };
  // The latest of these, for the listeners registered once per note.
  const latest = useRef({ settle, namePlace });
  latest.current = { settle, namePlace };
  useEffect(() => {
    const off = watchTag(note.id, (event) => {
      if (event.kind === 'place') latest.current.namePlace(event.place, event.lat, event.lon);
      else if (event.kind === 'held') setHold(heldFor(note.id));
      else latest.current.settle();
    });
    const handedBack = (event: Event) => {
      if ((event as CustomEvent<{ noteId?: string }>).detail?.noteId !== note.id) return;
      reviewing.current = false;
      latest.current.settle();
    };
    window.addEventListener(REVIEW_HANDED_BACK, handedBack);
    return () => {
      off();
      window.removeEventListener(REVIEW_HANDED_BACK, handedBack);
    };
  }, [note.id]);
  // On opening, once the editor is here: a tag waiting lands if it may, and a name that came while the note was closed is written.
  useEffect(() => {
    latest.current.settle();
    const now = geoTagOf(body.current);
    if (now && !now.place) {
      const known = placeFor(now);
      if (known) latest.current.namePlace(known, now.lat, now.lon);
    }
    // The editor arriving is what this waits for; the rest is read from the refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id, view]);
  // A new note's first words, or an entry's first of its own: the tag waiting for them lands.
  useEffect(() => {
    if (!blank && !untouched) latest.current.settle();
  }, [blank, untouched]);
  // A new note left without a word leaves nothing behind (docs/LIBRARY.md), its waiting tag included.
  const blankNow = useRef(blank);
  blankNow.current = blank;
  useEffect(
    () => () => {
      if (blankNow.current && !geoTagOf(body.current)) setPendingTag(note.id, null);
    },
    // The note's own leaving; the rest is read from the refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [note.id],
  );

  /** Add my location, from the More sheet: the fix, the tag into the note (or waiting), and its name asked for. */
  const addLocation = () => {
    flush();
    setSettingsOpen(false);
    let said = false;
    // The card arriving is the feedback; a slow fix says so after a moment.
    const slow = window.setTimeout(() => {
      said = true;
      toast({ message: 'Finding where you are.', duration: 0 });
    }, 600);
    locate().then(
      (fix) => {
        window.clearTimeout(slow);
        if (said) dismiss();
        forgetRefusal();
        const next = tagOf(fix);
        // Left while the fix was coming: the tag is kept for the note and written into it where it may land.
        if (!mounted.current) {
          landTag(note.id, next);
          return;
        }
        setPendingTag(note.id, next);
        setTag(next);
        setArriving(true);
        setLeaving(null);
        // Into the note now (and its name asked), or waiting for the better words with the card drawn from it meanwhile.
        latest.current.settle(true);
      },
      (failure: unknown) => {
        window.clearTimeout(slow);
        if (said) dismiss();
        if (!mounted.current) return;
        const why = whyLocateFailed(failure);
        // Refused here is refused: new notes are not asked for again until location is allowed.
        rememberRefusal(why);
        fireNativeHaptic('warning');
        toast({
          message: NO_FIX[why],
          ...(why === 'blocked' && typeof window.GlyphHost?.openLocationSettings === 'function' ? { action: { label: 'Open settings', onPress: () => void window.GlyphHost?.openLocationSettings?.() } } : {}),
        });
      },
    );
  };
  /**
   * A place from the + beside the line (editor/AddList.tsx): a line of its own where the caret was, a link to a `geo:`
   * address that draws its map card (core/placeRefs.ts), apart from the note's own tag above. The place is kept from
   * the tap, the fix is found (said after a moment, as Add my location says it), and the name is asked while it is,
   * from what is known first, and waited for a few seconds, so the place and its name land as one write and one Undo.
   * A note left before the fix, or a place let go, asks for nothing and writes nothing. A name later than the wait is
   * written only while the place is still the newest change (editor/inserts.ts `nameLater`); a write that lands after
   * the person went to another field leaves the focus where they are (`focusToken`).
   */
  const addPlace = () => {
    const editor = viewRef.current;
    if (!editor) return;
    const token = focusToken(editor);
    const spot = reserveSpot(editor);
    let said = false;
    const slow = window.setTimeout(() => {
      said = true;
      toast({ message: 'Finding where you are.', duration: 0 });
    }, 600);
    const quiet = () => {
      window.clearTimeout(slow);
      if (said) dismiss();
    };
    const letGo = () => {
      token.done();
      if (editor.dom.isConnected) releaseSpot(editor, spot);
    };
    const here = () => mounted.current && editor.dom.isConnected;
    void (async () => {
      let tag: GeoTag;
      try {
        tag = tagOf(await locate());
      } catch (failure) {
        quiet();
        letGo();
        if (!mounted.current) return;
        const why = whyLocateFailed(failure);
        rememberRefusal(why);
        fireNativeHaptic('warning');
        toast({
          message: NO_FIX[why],
          ...(why === 'blocked' && typeof window.GlyphHost?.openLocationSettings === 'function' ? { action: { label: 'Open settings', onPress: () => void window.GlyphHost?.openLocationSettings?.() } } : {}),
        });
        return;
      }
      forgetRefusal();
      // Left while the fix was coming, or the place was let go: nothing is asked for and nothing is written.
      if (!here() || spotAt(editor, spot) === null) {
        quiet();
        letGo();
        return;
      }
      let name: string | null = null;
      let late: Promise<string | null> | null = null;
      if (await canAskPlace()) {
        const asked = placeName(tag);
        const waited = await Promise.race([asked, new Promise<'waited'>((resolve) => window.setTimeout(() => resolve('waited'), NAME_WAIT_MS))]);
        if (waited === 'waited') late = asked;
        else name = waited;
      }
      if (!here()) {
        quiet();
        letGo();
        return;
      }
      await afterComposition(editor, 300);
      const line = placeMarkdown(tag, name);
      const landed = insertLineAt(editor, spot, line, { userEvent: 'input.plus.drawn', token, apart: true });
      const depth = undoDepth(editor.state);
      const tagged = tagSteps.current;
      quiet();
      letGo();
      fireNativeHaptic('light');
      if (!late) {
        releaseSpot(editor, landed.spot);
        return;
      }
      void late.then((named) => {
        // The note's own tag landing meanwhile is not the person's doing (`tagSteps`).
        if (named && here()) nameLater(editor, landed.spot, depth + tagSteps.current - tagged, line, placeMarkdown(tag, named));
        if (editor.dom.isConnected) releaseSpot(editor, landed.spot);
      });
    })();
  };
  /**
   * A film from the + beside the line (native generation 21): picked with the Photo Picker, copied with its poster
   * (media/VideoPick.kt) and kept (`save_video`), then written as a line of its own where the caret was, its poster
   * linked to it (core/videoRefs.ts), which draws its card (editor/videos.ts). The place is kept from the tap, since the
   * picker leaves the app and a long film takes a while to copy; "Adding the video." says so a moment after the copy
   * starts, and not while the picker is still up. A film copied for a note that was left, or whose place went, is
   * thrown away rather than kept for nothing. A write that lands after the person went to another field leaves the
   * focus where they are (`focusToken`). What goes wrong is said on the note's line, as a picture's is.
   */
  const addVideo = () => {
    const editor = viewRef.current;
    if (!editor) return;
    const token = focusToken(editor);
    const spot = reserveSpot(editor);
    let said = false;
    let slow = 0;
    const copying = () => {
      window.clearTimeout(slow);
      slow = window.setTimeout(() => {
        said = true;
        toast({ message: 'Adding the video.', duration: 0 });
      }, 600);
    };
    const quiet = () => {
      window.clearTimeout(slow);
      if (said) dismiss();
    };
    const letGo = () => {
      token.done();
      if (editor.dom.isConnected) releaseSpot(editor, spot);
    };
    const wanted = () => mounted.current && editor.dom.isConnected && spotAt(editor, spot) !== null;
    void (async () => {
      try {
        const film = await pickVideo({ keep: wanted, copying });
        quiet();
        if (!film || !wanted()) return;
        filmAdded(film.poster, film.width, film.height);
        const landed = insertLineAt(editor, spot, videoMarkdown(film.poster, film.video, film.ms), { userEvent: 'input.plus.drawn', token, apart: true });
        releaseSpot(editor, landed.spot);
        fireNativeHaptic('light');
      } catch (failure) {
        quiet();
        if (!mounted.current) return;
        fireNativeHaptic('warning');
        pictures.say(failureText(failure));
      } finally {
        letGo();
      }
    })();
  };
  /** The map's box: the card, or a map note's header across the column. */
  const mapSize = look === 'map' ? 'header' : 'card';
  /**
   * The More sheet's Look (docs/DESIGN.md §144): the key written into the front matter through the editor, as one undo
   * step, so the view redraws from what was written; Plain takes it off. The person's own doing, so a note given its
   * words by the app is theirs from here: its untouched record is forgotten, as a pin forgets it.
   */
  const chooseLook = (next: Look | null) => {
    const editor = viewRef.current;
    if (!editor || !editor.dom.isConnected) return;
    const doc = editor.state.doc.toString();
    const after = withLook(doc, next);
    if (after === doc) return;
    const was = frontMatterOffset(doc);
    const now = frontMatterOffset(after);
    const place = (pos: number) => (pos <= was ? now : pos + now - was);
    const selection = EditorSelection.create(
      editor.state.selection.ranges.map((range) => EditorSelection.range(place(range.anchor), place(range.head))),
      editor.state.selection.mainIndex,
    );
    editor.dispatch({ changes: { from: 0, to: was, insert: after.slice(0, now) }, selection, userEvent: 'input.look' });
    forgetUntouched(note.id);
    spoilFresh(note.id);
    drafted.current = false;
    setUntouched(false);
    fireNativeHaptic('selection');
  };
  /**
   * A version put back (editor/VersionHistory.tsx): the words as they are now kept as a version first, then the
   * version's words put in through the editor as one change - undone like any other, and saved the way typing is - and
   * kept as a version of their own, named for where they came from. So the history only grows, as `git revert` does.
   */
  const restoreVersion = (text: string, version: Version) => {
    const editor = viewRef.current;
    if (!editor || !editor.dom.isConnected) return;
    const now = editor.state.doc.toString();
    if (now === text) return;
    void keepVersion(note.id, now).catch(() => undefined);
    editor.dispatch({ changes: { from: 0, to: now.length, insert: text }, userEvent: 'input.restore', scrollIntoView: true });
    void keepVersion(note.id, text, { label: `Back to version ${version.n}` }).catch(() => undefined);
    toast({ message: `Back to version ${version.n}.` });
    fireNativeHaptic('success');
  };
  // The history in the desktop's aside (aside/AsideHistory.tsx) reads the editor's words and restores through it, as
  // the More sheet's does: said for as long as this note is on screen (core/versions/live.ts).
  const restoreLatest = useRef(restoreVersion);
  restoreLatest.current = restoreVersion;
  useEffect(
    () =>
      liveNoteOpened(note.id, {
        current: () => viewRef.current?.state.doc.toString() ?? body.current,
        restore: (text, version) => restoreLatest.current(text, version),
      }),
    [note.id, body],
  );
  /** Remove location: both keys out, as one undo step; the card going, on the beat it came on, is the feedback. */
  const removeLocation = () => {
    flush();
    setSettingsOpen(false);
    setArriving(false);
    setLeaving(tag);
    writeTag(null, true);
    setPendingTag(note.id, null);
    setTag(null);
  };

  // Playing takes the screen for the transcript; the note waits under it.
  const shown: 'transcript' | 'raw' = tape.length && tape.playing ? 'transcript' : 'raw';
  // The tape and note go to smoke as they slip behind the header; read again on a view change, since another view may not scroll (art/wispEdge.ts).
  // The page smokes at both ends: under the header, and off the bottom where the dock is (art/wispEdge.ts).
  // Not on a canvas: it is not a page that scrolls off its foot, and the band was smoking the canvas's own tools at
  // the bottom of the screen (Matt: "The bottom wisp effect is effecting canvas view buttons at the bottom").
  useWispEdge(page, shown, header, { foot: !canvas });
  // The note opens where it was left, and remembers where it is left (editor/notePlace.ts).
  // Opened at an item, the note goes to that line rather than back to where it was left last time.
  useNotePlace(note.id, page, view, shown === 'raw' && !at);
  // A chapter open is where its book was left, so the book opens here again from outside it (book/bookSpot.ts). Not a
  // journal's entry: a journal always opens on itself, where New entry is.
  const inBook = book && !book.journal ? book.book.id : null;
  useEffect(() => {
    if (inBook) writeBookSpot(inBook, { kind: 'chapter', title });
  }, [inBook, title]);
  const { marked, bookmark } = useBookmark(note, view, page, (message) => toast({ message }));
  useLandAt(at, view, page, header);
  // A note just made, to be written in: the caret where it was asked for, once the editor is here, and the focus. A new
  // note's line 1, or the end of a journal's entry. Whether Android raises the keyboard for a focus that follows the
  // note's write is the phone's to say; if not, the caret waits there and the first tap on the page raises it.
  const caretPlaced = useRef(caret === undefined);
  useEffect(() => {
    if (caretPlaced.current || !view) return;
    caretPlaced.current = true;
    const length = view.state.doc.length;
    view.dispatch({ selection: { anchor: caret === 'end' || caret === undefined ? length : Math.min(Math.max(0, caret), length) }, scrollIntoView: true });
    view.focus();
    // Once, as the editor arrives: the caret asked for when the note was opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
  // A journal open hands App the way to write its index through this screen (`onJournal`), and takes it back as it goes.
  const writeIndex = useRef<(change: (body: string) => string) => void>(() => undefined);
  writeIndex.current = (change) => {
    writeNotebook(change);
    flush();
  };
  useEffect(() => {
    if (!isJournal || !onJournal) return undefined;
    onJournal({ id: note.id, write: (change) => writeIndex.current(change) });
    return () => onJournal(null);
  }, [isJournal, onJournal, note.id]);

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
    toast({ message: boardMadeWords(made, 'cards') });
  };

  // Two fingers pinch the note's text larger or smaller (editor/pinchZoom.ts).
  useNoteZoom(page, view, shown === 'raw');

  /*
   * The + beside an empty line (editor/insertPlus.ts) and its list (editor/AddList.tsx). The + is this screen's alone,
   * and only while the note is words being written: not a notebook's index or a canvas in either view, not while the
   * transcript plays, and not while an AI run writes into it. The editor asks through a ref, and is told to look again
   * when any of those changes.
   */
  const [adding, setAdding] = useState<PlusOpening | null>(null);
  // Whether this binary adds films (native generation 21): asked once, for the list's A video.
  const [videosHere, setVideosHere] = useState(false);
  useEffect(() => {
    void canAddVideos().then((can) => {
      if (mounted.current) setVideosHere(can);
    });
  }, []);
  const addKeys = useRef<((key: PlusKey) => boolean) | null>(null);
  // A fill holds no landing bookmark an insert could cross: its answers go only where its blanks are, so the + stays
  // while one runs (docs/DESIGN.md §145, 19.3), and a press of Fill the blanks on a long note does not take it away.
  const plusAllowed = !typed && shown === 'raw' && (ai.runningKind === null || ai.runningKind === 'fill');
  const plusAllowedRef = useRef(plusAllowed);
  plusAllowedRef.current = plusAllowed;
  const plusHooks = useMemo<PlusHooks>(
    () => ({
      allowed: () => plusAllowedRef.current,
      onOpen: (opening) => {
        // A finger's press on the + has the app's tap tick already (core/haptics.ts); a mouse, a key or a / has none.
        if (opening.by !== 'touch') fireNativeHaptic('selection');
        setAdding(opening);
      },
      onClose: () => setAdding(null),
      onKey: (key) => addKeys.current?.(key) ?? false,
    }),
    [],
  );
  useEffect(() => {
    view?.dispatch({ effects: plusRecheck.of(null) });
    if (!plusAllowed) setAdding(null);
  }, [view, plusAllowed]);

  /*
   * A new note's blank page (docs/DESIGN.md §144): the names under its first line (editor/nameChips.ts), and under them
   * the screen's own element, which holds the ghost while they are shown, so the ghost is always below them. Offered
   * while the note is fresh (made in this run, nothing of the person's in it), has no words, and is words being
   * written (the +'s own gate). The names turn with the minute, so they are read again at each turn while offered.
   */
  const offering = fresh && blank && plusAllowed;
  const clock = useMinute(offering);
  const names = useMemo(() => (offering ? nameOffers(clock, takenTitles ?? NO_TITLES) : null), [offering, clock, takenTitles]);
  const [offersHost] = useState(() => document.createElement('div'));
  const [offersShown, setOffersShown] = useState(false);
  /*
   * The template cards under the names (notes/TemplateCards.tsx; Matt: "cards on the blank page"): shown with them, and
   * gone at the first letter, with the names, or at a tap elsewhere on the page, which says the page is to be written on
   * as it is. A tap that began before the cards were there, the one that raised the keyboard and brought them, is not
   * one: only a press that starts while they are shown counts.
   */
  const [cardsGone, setCardsGone] = useState(false);
  const cardsShown = offering && offersShown && !cardsGone;
  useEffect(() => {
    const el = page.current;
    if (!cardsShown || !el) return undefined;
    const outside = (target: EventTarget | null) => !(target instanceof Element && target.closest('.cm-blankOffers'));
    let armed = false;
    const down = (event: PointerEvent) => {
      armed = outside(event.target);
    };
    const click = (event: MouseEvent) => {
      if (armed && outside(event.target)) setCardsGone(true);
      armed = false;
    };
    el.addEventListener('pointerdown', down, true);
    el.addEventListener('click', click, true);
    return () => {
      el.removeEventListener('pointerdown', down, true);
      el.removeEventListener('click', click, true);
    };
  }, [cardsShown]);
  /**
   * A card pressed: the blank note becomes that template, as one change, so one undo takes it back to the blank page
   * with its names and cards. Its record first (core/untouched.ts), so a note left without a word of the person's own is
   * taken back; its name settled against every other note's before anything is measured (notes/noteTemplates.ts); the
   * caret in its first open line, the focus kept. A map at the top holds its header's box and asks for the place once,
   * the card's press being the choice, whatever Tag new notes says: unless a fix for this note is already on its way.
   *
   * And the page back at its top, where the note now starts. A card lower down is pressed with the page scrolled, which
   * keeps its scroll as the cards go. CodeMirror counts the band under the header and the tabs as seen, so its own
   * scroll left the caret's heading under them (found in review: Notes on a book at 412 by 585, typed into a heading
   * nobody could see). From the top, its scroll only ever brings the caret up from below.
   */
  const backToTop = () => {
    if (page.current) page.current.scrollTop = 0;
  };
  const startFrom = (template: NoteTemplate) => {
    const editor = viewRef.current;
    if (!editor || !isFresh(note.id) || editor.state.doc.toString().trim()) return;
    const filled = fillNoteTemplate(template, new Date(), takenTitles ?? NO_TITLES);
    rememberUntouched(note.id, { title: filled.title, words: filled.words, at: Date.now() });
    drafted.current = true;
    setUntouched(true);
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: filled.body }, selection: { anchor: filled.caret }, scrollIntoView: true, userEvent: 'input.template' });
    backToTop();
    flush();
    editor.focus();
    fireNativeHaptic('selection');
    if (template.look === 'map' && !geoTagOf(body.current) && !pendingTag(note.id) && heldFor(note.id) !== 'waiting') {
      holdFor([note.id]);
      void tagEntryIfWanted([note.id], { reviewing: false });
    }
  };
  /**
   * A name tapped: the note's heading, as the only name a note of words has is its first line, and the caret on the
   * line under it. Its record first (core/untouched.ts), so a note named and left without a word of the person's own
   * is taken back as an untouched entry is. One change, so one undo takes it back to a blank page with the names on it.
   * The page back at its top, as a card's press leaves it.
   */
  const nameIt = (name: string) => {
    const editor = viewRef.current;
    if (!editor || !isFresh(note.id)) return;
    const words = `# ${name}\n\n`;
    rememberUntouched(note.id, { title: name, words, at: Date.now() });
    drafted.current = true;
    setUntouched(true);
    const from = frontMatterOffset(editor.state.doc.toString());
    editor.dispatch({ changes: { from, to: editor.state.doc.length, insert: words }, selection: { anchor: from + words.length }, scrollIntoView: true, userEvent: 'input.name' });
    backToTop();
    // Kept now, not on typing's beat: a note named and left at once is looked at by its take-back from the store.
    flush();
    editor.focus();
    fireNativeHaptic('selection');
  };
  /**
   * The note's page, for the list's crease; the list's top is the status bar's (editor/menuRoom.ts), over the header
   * and the tabs (Matt: "Allow the header to be overlapped by the popup menus").
   */
  const notePane = (): DOMRect | null => page.current?.getBoundingClientRect() ?? null;
  /** Every canvas among the notes, for More's A canvas: a frame of it drawn in the words (editor/canvasFrames.ts). */
  const canvasTitles = allTitles && bodyOfTitle ? () => allTitles().filter((t) => isCanvasBody(bodyOfTitle(t) ?? '')) : undefined;

  const speakHere = onSpeak
    ? () => {
        // A new take replaces a removed recording's file, so its Undo would no longer be true.
        forgetRemoved();
        flush();
        onSpeak(note.id);
      }
    : undefined;

  // Where the app's bar wants this screen's controls, if it is there to hold them (core/topBarTools.ts).
  const toolsSlot = useTopBarTools();
  // And the bar's end, after its Organizations and bell, where More goes when the bar is there.
  const tailSlot = useTopBarTail();

  /*
   * The links for the editor, one object across this screen's own draws - a tape's playhead moving, a sheet opening -
   * since the editor takes a new one as the notes having changed and rescans the whole note for the canvases framed in
   * it (editor/Editor.tsx), and this screen draws several times a second while a tape plays. The object is new whenever
   * App draws, since App makes its lookups afresh each time it does; that covers every change to the notes, and more.
   */
  const noteQueries = useMemo(() => (queries ? { ...queries, noteId: note.id } : undefined), [queries, note.id]);
  const wiki = useMemo(
    () => (onOpenTitle && hasTitle ? { known: hasTitle, open: onOpenTitle, body: bodyOfTitle, tickets, queries: noteQueries } : undefined),
    [onOpenTitle, hasTitle, bodyOfTitle, tickets, noteQueries],
  );

  // The view switch, back in the header (Matt: "move the toggle between markdown and reading view back into the
  // header"). What it shows and what a press does is the screen's: a canvas or a book is its page or its source
  // (`showSource`), a plain note its formatted text or its marks (`chooseView`); it works only while the note's own
  // view is up, not the transcript during a tape.
  const viewKind: NoteKind = canvas ? 'canvas' : isBook ? 'book' : 'words';
  const onPage = typed ? !source : prefs.noteView === 'formatted';
  const switchView = () => (typed ? showSource(onPage) : chooseView(onPage ? 'mixed' : 'formatted'));
  /** Pin or unpin, from the bar or from More. */
  const togglePin = () => {
    flush();
    onPin({ ...note, starred: pinned });
    setPinned((was) => !was);
    fireNativeHaptic('selection');
    setSettingsOpen(false);
  };
  const archiveHere = () => {
    flush();
    setSettingsOpen(false);
    onArchive(note);
  };
  const historyHere = shown === 'raw' && !canvas;
  const speakWords = tape.length > 0 || !speakHere ? null : isJournal ? 'Speak an entry' : 'Talk into this note';
  /*
   * What comes out of More into the bar while there is room, in this order (Matt: "the following should be able to
   * expand out in order of priority: Share, History, Bookmark, Pin/Unpin, Archive, Speak"; editor/toolRoom.ts), with
   * Comment after History (Matt: "so we can quickly click to add comments"). Each is there only where More would have
   * it, and stays in More too.
   */
  const actions: ToolAction[] = [
    { id: 'share', label: 'Share', icon: Share2, onPress: () => setSharing(true) },
    ...(historyHere ? [{ id: 'history', label: 'Version history', icon: History, onPress: () => (onHistory ? onHistory() : openSettings('history')) }] : []),
    ...(shown === 'raw' && !typed ? [{ id: 'comment', label: 'Comment', icon: MessageSquarePlus, onPress: () => comments.start() }] : []),
    ...(shown === 'raw' ? [{ id: 'bookmark', label: marked ? 'Move or remove the bookmark' : 'Bookmark this line', icon: marked ? BookmarkCheck : Bookmark, onPress: bookmark, on: marked }] : []),
    { id: 'pin', label: pinned ? 'Unpin' : 'Pin to the top', icon: pinned ? PinOff : Pin, onPress: togglePin, on: pinned },
    { id: 'archive', label: 'Archive', icon: Archive, onPress: archiveHere },
    ...(speakWords && speakHere ? [{ id: 'speak', label: speakWords, icon: Mic, onPress: speakHere }] : []),
  ];
  const tools = (
    <NoteTools kind={viewKind} page={onPage} switchable={shown === 'raw'} onSwitch={switchView} onMore={() => openSettings()} more={!(toolsSlot && tailSlot)} actions={actions} />
  );

  return (
    <div ref={screen} className={styles.screen}>
      {/* The crease's shadow while the note unfolds; nothing the rest of the time. */}
      <div className={styles.crease} aria-hidden="true" />
      {/*
        The note's controls live in the app's top bar now (Matt: "Move the controls for the note into the topbar"),
        put there by a portal because they hold the editor's state - the view being shown, the bookmark's line, the
        tape - and lifting them into App.tsx would lift the editor with them. Where there is no bar to take them,
        they stay in this header, which is where they have always been. With them in the bar the header holds
        nothing at all, which its stylesheet's `.header:empty` depends on.
      */}
      <header ref={header} className={`app-headerPane ${styles.header}`}>
        {toolsSlot ? null : (
          <div className={styles.headerRow} data-tool-row>
            <span />
            {tools}
          </div>
        )}
      </header>
      {toolsSlot ? createPortal(tools, toolsSlot) : null}
      {toolsSlot && tailSlot ? createPortal(<NoteMore onMore={() => openSettings()} />, tailSlot) : null}
      {/* The model at work on this note, and what it did: under the header, over the page (ai/AiStrip.tsx). */}
      <div className={styles.stripHolder}>
        <AiStrip noteId={note.id} onUndo={ai.undoRun} onHeight={onStripHeight} marks={ai.marks && view ? { count: ai.marks, keepAll: () => keepAllChanges(view) } : undefined} stage={ai.reviewStage} />
      </div>
      {/* The models at work on a recording: full screen over the note until they are done, or sent behind (scene/AtWork.tsx). */}
      <AtWork noteId={note.id} opening={review?.key ?? null} heard={review?.heard ?? ''} body={note.body} hasJob={Boolean(review?.job)} stage={ai.reviewStage} />
      {pictures.problem ? (
        <p className={styles.problem} role="alert">
          {pictures.problem}
        </p>
      ) : null}

      {/* Only where the page itself scrolls: the Formatted view and the transcript scroll their own. */}
      <PullToRefresh scroller={page} onRefresh={pullNote} enabled={shown === 'raw' && !drawing} />
      {/*
        The tape and the note are one page under the header, and scroll
        together (Matt: "the tape and stuff at the top of a note should scroll
        up with the rest of the note instead of sticking to the top"). The
        Formatted view and the transcript keep their own scrolling, under a
        tape that stays, since each has a bar of words at its top.
      */}
      <div ref={page} className={styles.page} data-me-hue={myHue ?? undefined} data-scrolls={(shown === 'raw' && !drawing) || undefined} data-look={(!typed && look) || undefined}>
        {tape.length > 0 ? (
          <div className={styles.tapeRow}>
            {recording ? (
              <audio
                ref={tape.audio.ref}
                src={recording}
                preload="metadata"
                onPlay={tape.audio.onPlay}
                onPause={tape.audio.onPause}
                onEnded={tape.audio.onEnded}
                onTimeUpdate={tape.audio.onTimeUpdate}
                onError={tape.audio.onError}
              />
            ) : null}
            <NoteTape
              note={note}
              title={title}
              tape={tape}
              onSpeak={speakHere}
              onRemove={removeRecording}
              hasMemos={hasClips(body.current)}
              // The recording's summary (ai/summaries.ts): queued from here, and landed in this editor as a run. Only
              // where the AI can run: a browser has no model and shows what synced, and iOS has none yet.
              summary={
                ai.canSummarize
                  ? {
                      ask: (replace) => {
                        flush();
                        // The tape's real kind: a meeting's write-up for a meeting, a recording's otherwise.
                        enqueueSummary(note.id, summaryKindOf(note, prefs.meetings), { replace });
                      },
                      edited: () => {
                        const section = summarySection(body.current, keptText(note.id));
                        return section !== null && !summaryUnchanged(note.id, section.text);
                      },
                      behind: summaryBehind(note.id, tape.length),
                    }
                  : null
              }
            />
          </div>
        ) : null}
        {/* What the note is linked to (a Notion board, a repo): a tap opens the More sheet to change it. */}
        <LinkMarks noteId={note.id} onPress={() => setSettingsOpen(true)} />
        {/* A chapter's book, its place in it and the chapters either side (docs/BOOKS.md). */}
        {book && onOpenTitle ? <BookBar place={book} open={(t) => (onOpenWithin ?? onOpenTitle)(t)} /> : null}
        {/* Who wrote it, when it names anyone (core/authors.ts): a book says so for all its pages, in its index. */}
        {!paging ? <Byline authors={authorsOf(note.body)} className={styles.byline} /> : null}
        {/*
          Where it was written (core/geotag.ts): the map at the top of the note, with who wrote it. Only where the page
          scrolls with the words: not over a book's index, a canvas, or the transcript, which scrolls inside itself
          while the page holds still, so a card there would take its height from the tape for as long as it played.
        */}
        {(tag ?? leaving) && shown === 'raw' && !paging && !drawing ? (
          <MapCard
            tag={(tag ?? leaving)!}
            // A map note's map is its header, across the column (core/look.ts).
            size={mapSize}
            // A new note's tag still waiting for its first words is drawn quiet: a draft that may never be kept fetches no
            // tiles. So is an untouched entry's, which is taken back if it is left as it is.
            mode={canShowTiles() && !((blank || untouched) && !geoTagOf(body.current)) ? 'map' : 'quiet'}
            quietWhy={prefs.localOnly ? 'local-only' : !prefs.mapTiles ? 'off' : undefined}
            dark={dark}
            arrive={Boolean(tag) && arriving}
            leave={!tag}
            onLeft={() => setLeaving(null)}
            className={styles.mapCard}
          />
        ) : (hold || look === 'map') && shown === 'raw' && !paging && !drawing ? (
          // The box held for a new note's fix: the same box, empty, until the tag arrives in it or the note is left. A
          // map note's header is its shape, so it is drawn with no place too, saying why.
          <MapPicture size={mapSize} why={hold === 'waiting' ? undefined : prefs.localOnly ? 'Local only is on.' : 'No place yet.'} dark={dark} className={styles.mapCard} />
        ) : null}

        {shown === 'transcript' ? (
          <div className={styles.body}>
            <TranscriptWords tape={tape} />
          </div>
        ) : null}
        {drawing ? (
          <div className={`${styles.body} ${styles.canvasBody}`} hidden={shown !== 'raw'}>
            <CanvasView
              canvas={canvas}
              dark={dark}
              wiki={onOpenTitle && hasTitle ? { known: hasTitle, open: onOpenTitle, body: bodyOfTitle, titles: allTitles } : undefined}
              // A change to the canvas is a change to the note: written into the body as the spec's JSON, front
              // matter kept, and saved the way typing is (editor/useNoteSaving.ts).
              onChange={(next) => onChange(withCanvas(body.current, next))}
              // A team's canvas (docs/SHARED.md, S9): edited through its structure, with the members' pointers drawn.
              team={team}
              goTo={cursor && isSpot(cursor) ? cursor : undefined}
              noteId={note.id}
            />
          </div>
        ) : null}
        {paging && isJournal ? (
          <div className={styles.body} hidden={shown !== 'raw'}>
            <JournalView
              body={bookBody}
              onNewEntry={onNewEntry}
              noteOf={noteOfTitle ?? (() => undefined)}
              known={hasTitle ?? (() => false)}
              open={(t) => (onOpenWithin ?? onOpenTitle)?.(t)}
              onChange={(next) => {
                setBookBody(next);
                onChange(next);
              }}
            />
          </div>
        ) : paging ? (
          <div className={styles.body} hidden={shown !== 'raw'}>
            <BookView
              body={bookBody}
              title={title}
              known={hasTitle ?? (() => false)}
              open={(t) => (onOpenWithin ?? onOpenTitle)?.(t)}
              openCanvas={onNewCanvas}
              openNew={onNewPage ? (t, template) => onNewPage(t, template) : undefined}
              openTicket={onNewTicket ? (t, template) => onNewTicket(t, bookBody, template) : undefined}
              ticketTemplates={ticketTemplates}
              titles={pageTitles ?? allTitles ?? (() => [])}
              bodyOf={bodyOfTitle}
              spot={{ id: note.id, page }}
              // A page's ticket status picked in the index, written into that page through the queries' writer (App.tsx
              // `moveFromQuery`, core/query/move.ts), which reads the library again after (docs/DESIGN.md §169).
              setStatus={
                queries
                  ? (page, status) => {
                      const key = titleKey(page);
                      const found = queries.notes().find((each) => titleKey(noteTitle(each.body)) === key);
                      if (found) queries.move(found.id, -1, '', 'ticket', 'status', status);
                    }
                  : undefined
              }
              onChange={(next) => {
                setBookBody(next);
                onChange(next);
              }}
            />
          </div>
        ) : null}
        <div className={styles.body} hidden={shown !== 'raw' || drawing || paging} data-look={(!typed && look) || undefined}>
          <Editor
            // A canvas's JSON or a book's Markdown, once asked for, is what the view has written by now, not what the note opened with.
            value={typed && source ? body.current : note.body}
            onChange={onChange}
            // The line being typed stays above the page's foot smoke (art/wispEdge.ts), where there is smoke to keep
            // clear of: not on a canvas, nor a desktop's plain fade, nor with the smoke or motion turned down.
            footClear={!canvas && footSmokes(prefs.wispEdge) ? WISP_EDGE_FOOT_CLEAR : 0}
            onView={setView}
            wispTyping={prefs.wisp}
            display={typed ? 'mixed' : shownView(prefs)}
            tape={recording}
            tapeId={tape.length > 0 ? tapeId(note.id) : null}
            onImageError={pictures.say}
            dark={dark}
            assist={prefs.assist}
            placeholder="Write something."
            swipeAction={() => itemSend(note.id, editing)}
            suggest={(text) => lineOffers(note.id, editing, text)}
            linkMenus={{ say: (message) => editing.say(message) }}
            wiki={wiki}
            onAiMarks={ai.onAiMarks}
            plus={plusHooks}
            blankPage={{ names, host: offering ? offersHost : null, onName: nameIt, onShown: setOffersShown }}
            openHeading
            look={typed ? null : look}
            blanks={ai.blankHooks}
            comments={comments.hooks}
            places="live"
            videos="play"
            grow
          />
          {blank && !typed && !(offering && offersShown) ? <Ghost scene="new-note" align="center" className={styles.blankGhost} /> : null}
          {/* Under the names while they are shown: the ghost, in the page's flow, so it is never behind them. */}
          {offering && offersShown
            ? createPortal(
                <>
                  {cardsShown ? (
                    <TemplateCards at={clock} taken={takenTitles ?? NO_TITLES} onChoose={startFrom} templates={templates} onYours={onTemplates} />
                  ) : null}
                  <Ghost scene="new-note" align="center" className={styles.offersGhost} />
                </>,
                offersHost,
              )
            : null}
        </div>
        {/* And under its last line, the chapters either side again, to go on from the end of the page (docs/BOOKS.md). */}
        {book && onOpenTitle && shown === 'raw' ? <BookFoot place={book} open={(t) => (onOpenWithin ?? onOpenTitle)(t)} /> : null}
      </div>
      {/* Press and hold in the note: Cut, Copy, Paste, Select all, Add image. */}
      <ContextMenu
        view={view}
        onAddImage={() => void pictures.addPhoto()}
        onPasteImage={pictures.pasteImage}
        say={(message) => toast({ message })}
        onFind={setFinding}
        // The same send a swipe on the item does, where a plugin takes this note's items (a Notion board, a GitHub issue).
        send={itemSend(note.id, editing)}
        onComment={shown === 'raw' ? comments.start : undefined}
      />
      {/* The + beside the line's list: a picture, a place, the time, a table, a note, a to-do, and More. */}
      {adding && view ? (
        <AddList
          view={view}
          opening={adding}
          pane={notePane}
          onClose={() => setAdding(null)}
          keys={addKeys}
          onPicture={() => void pictures.addPhoto()}
          onPlace={addPlace}
          onVideo={videosHere ? addVideo : undefined}
          titles={wiki && allTitles ? allTitles : undefined}
          canvases={wiki ? canvasTitles : undefined}
          own={title}
        />
      ) : null}
      {finding !== null && view && shown === 'raw' ? <FindBar view={view} initial={finding} onClose={() => setFinding(null)} /> : null}
      {/* The note's share link, from the bar's Share button: the More sheet's rows, in a window of their own. */}
      {sharing ? (
        <Sheet label={`Share ${title || 'this note'}`} onClose={() => setSharing(false)}>
          <SheetTitle>Share {title || 'this note'}</SheetTitle>
          <ShareRows noteId={note.id} kind={isJournal ? 'journal' : isBook ? 'notebook' : 'note'} />
        </Sheet>
      ) : null}
      <NoteSettings
        open={settingsOpen}
        noteId={note.id}
        title={title}
        pinned={pinned}
        editing={editing}
        onClose={() => setSettingsOpen(false)}
        bookmark={
          shown === 'raw'
            ? {
                marked,
                onPress: () => {
                  setSettingsOpen(false);
                  bookmark();
                },
              }
            : undefined
        }
        name={typed ? { value: title, onChange: renameHere, kind: canvas ? 'canvas' : isJournal ? 'journal' : 'notebook' } : undefined}
        journal={journalRows}
        ticketKey={ticketKey}
        speak={speakWords && speakHere ? { label: speakWords, onPress: speakHere } : undefined}
        running={ai.runningKind}
        onAi={ai.runAi}
        blanks={settingsOpen && view ? fillPlanOf(view.state) : { count: 0, online: [] }}
        onFind={
          shown === 'raw'
            ? () => {
                setSettingsOpen(false);
                setFinding('');
              }
            : undefined
        }
        onMakeBoard={shown === 'raw' && settingsOpen && boardFrom(view?.state.doc.toString() ?? body.current) ? makeBoard : undefined}
        look={!typed && shown === 'raw' ? { value: look, canMap: Boolean(tag) || look === 'map', onChange: chooseLook } : undefined}
        history={shown === 'raw' && !canvas ? { keeps: versioning.keeps, current: () => viewRef.current?.state.doc.toString() ?? body.current, onRestore: restoreVersion } : undefined}
        location={{ tag, can: canLocate(), asksName: prefs.placeNames && !prefs.localOnly, refused: tag ? null : refusedFor(note.createdAt), onPhone: hasLocationBridge(), onAdd: addLocation, onRemove: removeLocation }}
        onPin={togglePin}
        onArchive={archiveHere}
        startAt={settingsAt}
        comments={shown === 'raw' && !typed ? { summary: settingsOpen ? comments.summary() : null, onComment: () => comments.start(), onList: comments.openList } : undefined}
        onDelete={() => {
          setSettingsOpen(false);
          remove();
        }}
      />
      {comments.sheet}
    </div>
  );
}
