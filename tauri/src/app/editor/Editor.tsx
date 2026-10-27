import { useEffect, useRef } from 'react';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { syntaxHighlighting } from '@codemirror/language';
import { glyphHighlight } from './glyphHighlight.ts';
import { glyphLines } from './glyphLines.ts';
import { glyphTheme } from './glyphTheme.ts';
import { feelTransaction } from './feel.ts';
import { inlineImages } from './images.ts';
import { doneSync } from './doneSync.ts';
import { linkedRows, type LinkMenus } from './linkedRows.ts';
import { shortLinks } from './links.ts';
import { drawnMaths } from './mathsDrawn.ts';
import { boxTapsWhileReadOnly } from './boxTaps.ts';
import { extendedMarkdown } from './extended.ts';
import { footnotes } from './footnotes.ts';
import { taskToggle } from './taskToggle.ts';
import { tags } from './tags.ts';
import { taskFields } from './taskFields.ts';
import { counters } from './counters.ts';
import { sums } from './sums.ts';
import { headingProgress } from './headingProgress.ts';
import { choices } from './choices.ts';
import { linkCards } from './linkCards.ts';
import { wikiLinks, type WikiOptions } from './wikiLinks.ts';
import { refreshTickets, tickets } from './tickets.ts';
import { queries, refreshQueries } from './queries.ts';
import { markNotes } from './markNotes.ts';
import { drawnTables } from './tables.ts';
import { swipeItemAction, swipeItemTheme, type SwipeAction } from './swipeItems.ts';
import { lineSuggestions, type LineSuggestion } from './suggestions.ts';
import { glyphMarkdown } from './language.ts';
import { formatLooks } from './formatLooks.ts';
import { wispFormat } from './wispFormat.ts';
import { textEffects } from './textEffects.ts';
import { wispArrivals } from './wispArrivals.ts';
import { noteView, type NoteDisplay } from './viewMode.ts';
import { findExtension } from './find.ts';
import { clips, tapeSource } from './clips.ts';
import { drawnBoards } from './boards.ts';
import { drawnMermaid } from './mermaid.ts';
import { canvasFrames, refreshCanvasFrames } from './canvasFrames.ts';
import { bookmarkRibbon } from './bookmarkLine.ts';
import { localUndo, undoSlot } from './undoSlot.ts';
import { wispRipples, type RippleSource } from './wispRipples.ts';
import { aiChanges, type AiChange } from './aiChanges.ts';
import { insertPlus, type PlusHooks } from './insertPlus.ts';
import { placeCards, refreshPlaceCards, type PlaceMode } from './placeCards.ts';
import { videoCards, type VideoMode } from './videos.ts';
import { nameChips, setOffers, type BlankOffers } from './nameChips.ts';
import { leadLine, openHeading as openHeadingHint } from './openHeading.ts';
import type { Look } from '../core/look.ts';
import { isMobile } from '../core/platform.ts';
import { blanks as blankSquares, type BlankHooks } from './blanks.ts';
import { fillPanel } from './fillPanel.ts';
import { noteComments, type CommentHooks } from './comments.ts';
import { plugins } from '../plugins/registry.ts';
import styles from './markdown.module.css';

/**
 * The editing surface: one CodeMirror view, held outside React.
 *
 * React renders the host element and nothing inside it. That division is not
 * stylistic - the editor's DOM is CodeMirror's, it is reconciled against a
 * document model React knows nothing about, and a re-render that touched it
 * would destroy a selection or a live IME composition. So the view is created
 * once in an effect with an empty dependency list, the `onChange` and `value`
 * props are read through refs, and this component re-renders as often as its
 * parent likes without the editor noticing.
 *
 * `value` is treated as an INITIAL value plus a resync signal: when it differs
 * from what the view holds, the document is replaced (a different note was
 * opened). It is deliberately not a controlled prop in the React sense, because
 * round-tripping every keystroke through a parent's state is exactly the
 * latency this app exists to avoid.
 *
 * So a prop reaches the view in one of three ways, and a caller has to know
 * which. The callbacks (`onChange`, `onImageError`, `swipeAction`, `suggest`,
 * `linkMenus`, `wiki`, `onAiMarks`, `comments`) are read through refs when they are used.
 * `dark`, `assist`, `readOnly`, `tape`/`tapeId`, `display` and `look` sit in
 * Compartments and are swapped in place when they change. Everything else -
 * `grow`, `arrivals`, `wispTyping`, `ripples`, `peek`, `diagrams`,
 * `placeholder`, and whether `wiki` or `linkMenus` was given at all - is read
 * once, when the view is made, and so are whether `plus` or `blankPage` was
 * given, `openHeading`, which `places` and which `videos`; a caller that needs a different set remounts
 * the editor with a new `key` (src/read/Reader.tsx does). And a new `wiki`
 * object is also a sign the notes changed (below), so a caller keeps the same
 * one while its lookups are the same.
 *
 * markdown.module.css is the markdown renderer's rule book: the classes
 * glyphHighlight.ts, glyphLines.ts and the widgets hand to CodeMirror, and
 * read by ten other files. Only `.editor` is this host's own, and it lives
 * there because the renderer's line rules are written under it.
 */

interface EditorProps {
  /** The note's markdown. Changing it to something the view does not hold loads a new document. */
  value: string;
  onChange: (value: string) => void;
  dark: boolean;
  /** Prose input aids: autocorrect, autocapitalisation, spellcheck. */
  assist: boolean;
  placeholder?: string;
  /** A pasted picture could not be kept: the sentence to show. */
  onImageError?: (message: string) => void;
  /** Handed the view once it exists, so a toolbar can dispatch into it. */
  onView?: (view: EditorView | null) => void;
  /** No typing: the document is being written by something else, as during a capture. */
  readOnly?: boolean;
  /** Read-only, but a to-do's box and a choice's still take a tap, sent out through onChange (editor/boxTaps.ts). */
  boxTaps?: boolean;
  /**
   * Swiping a list item left runs a plugin's action on it (editor/swipeItems.ts):
   * the action on offer right now, or null. Read at swipe time, through a ref.
   */
  swipeAction?: () => SwipeAction | null;
  /**
   * The quiet words after lines a plugin could act on (editor/suggestions.ts),
   * read on every change of the document through a ref, so changing it never
   * rebuilds the editor. Absent where the note is not the person's to act on.
   */
  suggest?: (body: string) => LineSuggestion[];
  /**
   * Linked lines' rows open their menu on a tap (editor/linkedRows.ts), and a
   * menu action's sentence is said with this. Read once, when the editor is
   * made. Absent: the rows show, and open nothing.
   */
  linkMenus?: LinkMenus;
  /** Links from one note to another, `[[Title]]` (editor/wikiLinks.ts); absent where a note cannot be opened. */
  wiki?: WikiOptions;
  /**
   * As tall as its words, scrolled by the page around it rather than inside
   * itself: the note screen, where the tape scrolls away with the first lines.
   * Read once, when the editor is made.
   */
  grow?: boolean;
  /**
   * How far above the bottom of the page the caret is kept, in pixels, as it is typed and moved (art/wispEdge.ts
   * `WISP_EDGE_FOOT_CLEAR`): the page's foot smokes the words there, so a line is lifted out of it while it is still
   * being written rather than when it reaches the edge. Read on every scroll, so it can change with the page.
   */
  footClear?: number;
  /** Where this note's recording is played from, for the voice memos in it (editor/clips.ts); null without one. */
  tape?: string | null;
  /** Which tape that is (core/clips.ts `tapeId`): a memo of another tape is drawn, not played. */
  tapeId?: string | null;
  /**
   * Text written in with the `wisp` annotation arrives from smoke and leaves into it (editor/wispArrivals.ts): the
   * recorder writing a note as it is heard. Read once, when the editor is made.
   */
  arrivals?: boolean;
  /** What the person types arrives from smoke too, and a backspace leaves into it (editor/wispMotion.ts `typing`). */
  wispTyping?: boolean;
  /**
   * The voice runs through the last lines as ripples (editor/wispRipples.ts): the recorder's page, with the mic
   * level as the source. Read once, when the editor is made.
   */
  ripples?: RippleSource;
  /** The mixed page, marks and formatting both (the default), its marks hung in a margin, or just the formatted text (editor/viewMode.ts). */
  display?: NoteDisplay;
  /**
   * A note drawn small on a card (notes/NotePeek.tsx): the same formatter as the note, but nothing that would fetch,
   * poll or act - no link preview cards, no diagrams, no Notion reads for its marks, no taps on its boxes. Read once,
   * when the editor is made.
   */
  peek?: boolean;
  /** Diagrams drawn even on a peek: a canvas card is small but is read, so a chart on it is the point of the card. */
  diagrams?: boolean;
  /** The AI's tracked changes in this note changed (editor/aiChanges.ts): told so the note can keep them. Read through a ref. */
  onAiMarks?: (changes: readonly AiChange[]) => void;
  /**
   * The + beside an empty line, and its list (editor/insertPlus.ts): only the note screen asks for it. Whether it was
   * given is read once; its callbacks are read through a ref when they are used.
   */
  plus?: PlusHooks;
  /**
   * How a place in the words draws its map card (editor/placeCards.ts): `live` on the note screen, `ask` on a shared
   * page, and `off`, no card and nothing fetched, everywhere else. Read once.
   */
  places?: PlaceMode;
  /**
   * How a film in the words draws its card (editor/videos.ts): `play` on the note screen, which plays it where it is on
   * this phone, `shared` on a shared page, and `still`, the poster and its length, everywhere else. Read once.
   */
  videos?: VideoMode;
  /**
   * A new note's blank page (editor/nameChips.ts): the names under its first line and the screen's element under them,
   * or nothing on offer; told to the view as they change. Whether it was given is read once; `onName` and `onShown` are
   * read through a ref. Only the note screen gives it.
   */
  blankPage?: BlankOffers & { onName: (name: string) => void; onShown?: (shown: boolean) => void };
  /** `A name` said in an open first heading (editor/openHeading.ts): the note screen and a template's card. Read once. */
  openHeading?: boolean;
  /**
   * How the note looks (core/look.ts): `data-look` on the editor, which swaps the face alone for a reading note
   * (typefaces.css), and a reading note's lead line (editor/openHeading.ts). Sizes are the column's to set, never the
   * editor's: one set here would be nearer than a card's own scale. Swapped in place as it changes.
   */
  look?: Look | null;
  /**
   * Blanks the AI fills (editor/blanks.ts, docs/DESIGN.md §145): the note screen's hooks, which draw the Fill pill and
   * hand a press to the fills' queue. Absent, the squares, their icons and the worked-out answers still draw, with
   * nothing to press: a shared page, a notebook read straight through. Whether it was given is read once; its
   * callbacks through a ref.
   */
  blanks?: BlankHooks;
  /**
   * Comments on the note (editor/comments.ts, docs/SHARED.md S8): each anchor a round in its author's colour that opens
   * its thread, and the ```comments fence drawn as the threads. Only the note screen gives it; without it the anchors
   * and the fence are the text they are. Whether it was given is read once; its callbacks through a ref.
   */
  comments?: CommentHooks;
}

/**
 * The prose overrides.
 *
 * CodeMirror defaults `.cm-content` to `spellcheck: false`, `autocorrect: off`,
 * `autocapitalize: off` and `writingsuggestions: false`, which is right for
 * code and wrong for a notes app: on a phone those four settings are most of
 * what makes typing bearable. `contentAttributes` values overwrite the
 * defaults, so this simply wins.
 */
const PROSE_ATTRS = {
  autocorrect: 'on',
  autocapitalize: 'sentences',
  spellcheck: 'true',
  inputmode: 'text',
  enterkeyhint: 'enter',
};

const PLAIN_ATTRS = {
  autocorrect: 'off',
  autocapitalize: 'off',
  spellcheck: 'false',
  inputmode: 'text',
  enterkeyhint: 'enter',
};

export function Editor({
  value,
  onChange,
  dark,
  assist,
  placeholder,
  onImageError,
  onView,
  readOnly = false,
  boxTaps = false,
  swipeAction,
  suggest,
  linkMenus,
  wiki,
  grow = false,
  footClear = 0,
  tape = null,
  tapeId = null,
  arrivals = false,
  wispTyping = false,
  ripples,
  display = 'mixed',
  peek = false,
  diagrams = false,
  onAiMarks,
  plus,
  places = 'off',
  videos = 'still',
  blankPage,
  openHeading = false,
  look = null,
  blanks,
  comments,
}: EditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // Props the view needs at dispatch time, read through refs so changing them
  // never rebuilds the editor.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onImageErrorRef = useRef(onImageError);
  onImageErrorRef.current = onImageError;
  const swipeActionRef = useRef(swipeAction);
  swipeActionRef.current = swipeAction;
  const footClearRef = useRef(footClear);
  footClearRef.current = footClear;
  const suggestRef = useRef(suggest);
  suggestRef.current = suggest;
  const linkMenusRef = useRef(linkMenus);
  linkMenusRef.current = linkMenus;
  const wikiRef = useRef(wiki);
  wikiRef.current = wiki;
  const darkRef = useRef(dark);
  darkRef.current = dark;
  const onAiMarksRef = useRef(onAiMarks);
  onAiMarksRef.current = onAiMarks;
  const plusRef = useRef(plus);
  plusRef.current = plus;
  const blankRef = useRef(blankPage);
  blankRef.current = blankPage;
  const blanksRef = useRef(blanks);
  blanksRef.current = blanks;
  const commentsRef = useRef(comments);
  commentsRef.current = comments;

  const themeSlot = useRef(new Compartment());
  const assistSlot = useRef(new Compartment());
  const readOnlySlot = useRef(new Compartment());
  const tapeSlot = useRef(new Compartment());
  const displaySlot = useRef(new Compartment());
  const lookSlot = useRef(new Compartment());

  useEffect(() => {
    if (!host.current) return undefined;

    // The switched-on plugins' inline formattings (plugins/types.ts `InlineFormat`), parsed and drawn in this note.
    const formatList = plugins.formats();
    const state = EditorState.create({
      doc: value,
      extensions: [
        // Undo in a slot of its own, ahead of the default keys as it always was, so a note live on two devices can undo
        // with Yjs's instead and take back only this person's typing (editor/undoSlot.ts, docs/LIVE.md).
        undoSlot.of(localUndo()),
        keymap.of(defaultKeymap),
        glyphMarkdown(formatList),
        formatLooks(formatList),
        wispFormat(formatList),
        textEffects(formatList),
        // A note in brackets after a mark, shown when its words are tapped (editor/markNotes.ts).
        markNotes(formatList),
        syntaxHighlighting(glyphHighlight),
        glyphLines,
        // Superscript, subscript and GitHub callouts, drawn as what they are (editor/extended.ts).
        extendedMarkdown(),
        // Maths drawn as its formula off the caret's line, by KaTeX, fetched the first time a note has any (editor/mathsDrawn.ts).
        drawnMaths(),
        // [^a] raised and quiet, its words on a tap (editor/footnotes.ts).
        footnotes(),
        // #tags drawn as small chips (editor/tags.ts).
        tags(),
        // A to-do's due day, priority, people and named fields drawn as chips, a tap on one opening its menu
        // (editor/taskFields.ts).
        taskFields(),
        // [3/8] counters, `= 450 + 120` sums, "3 of 7" after a heading, and `- ( )` choices (editor/counters.ts, sums.ts,
        // headingProgress.ts, choices.ts).
        counters(),
        sums(),
        // {?questions} drawn as squares, worked out or waiting for the model, and the panel a tap on an answer opens
        // (editor/blanks.ts, editor/fillPanel.ts).
        blankSquares(
          blanks
            ? {
                noteId: () => blanksRef.current?.noteId() ?? '',
                canFill: () => blanksRef.current?.canFill() ?? false,
                learntUntil: () => blanksRef.current?.learntUntil() ?? 2024,
                lookups: () => blanksRef.current?.lookups() ?? 'off',
                fill: (targets) => blanksRef.current?.fill(targets),
                say: (message) => blanksRef.current?.say(message),
              }
            : null,
          { still: peek },
        ),
        peek ? [] : fillPanel(),
        headingProgress(),
        choices(),
        // [[Another note]] opens that note, or makes it (editor/wikiLinks.ts).
        wikiLinks(wiki ? { known: (title) => wikiRef.current?.known(title) ?? false, open: (title, anchor) => wikiRef.current?.open(title, anchor) } : null),
        // A ticket's front matter as its properties, and a [[GHO-12]] with the ticket's title (editor/tickets.ts).
        peek || !wiki ? [] : tickets(() => wikiRef.current?.tickets ?? null),
        // A ```query fence drawn as what it finds in the library (editor/queries.ts): its lines where there is none.
        peek || !wiki ? [] : queries(() => wikiRef.current?.queries ?? null),
        // ![[A canvas]] on a line of its own draws that canvas in a frame (editor/canvasFrames.ts). Not on a card, where
        // a note is drawn small and a canvas inside it would be a canvas inside a card inside a canvas.
        peek || !wiki
          ? []
          : canvasFrames({
              body: (title) => wikiRef.current?.body?.(title) ?? null,
              known: (title) => wikiRef.current?.known(title) ?? false,
              open: (title, anchor) => wikiRef.current?.open(title, anchor),
              dark: () => darkRef.current,
            }),
        inlineImages((message) => onImageErrorRef.current?.(message)),
        // A place in the words: its map card as `places` says, and its line folded to its name (editor/placeCards.ts).
        placeCards(places, { dark: () => darkRef.current }),
        // A film in the words: its card as `videos` says, and its line folded to its words (editor/videos.ts).
        videoCards(videos),
        shortLinks({ still: peek }),
        // A card under a line that is only a link (editor/linkCards.ts).
        peek ? [] : linkCards(),
        linkedRows(linkMenus ? { say: (message) => linkMenusRef.current?.say(message) } : null),
        drawnTables(),
        // Comments: the anchors as rounds in their authors' colours, the fence as the threads (editor/comments.ts).
        comments && !peek ? noteComments(() => commentsRef.current ?? null) : [],
        // Boards drawn from a ```board fence, their cards the note's own list items (editor/boards.ts). Not on a card,
        // where a board is a screen's worth and its items are drawn as the list they are.
        peek ? [] : drawnBoards(),
        // Mermaid diagrams drawn from a ```mermaid fence (editor/mermaid.ts).
        peek && !diagrams ? [] : drawnMermaid(),
        peek ? [] : swipeItemAction({ action: () => swipeActionRef.current?.() ?? null }),
        peek ? [] : lineSuggestions({ suggest: (body) => suggestRef.current?.(body) ?? [] }),
        // A tap on a to-do's box ticks or clears it (taskToggle.ts).
        peek ? [] : taskToggle(),
        // A to-do whose task reads as done gets its box ticked (doneSync.ts).
        peek ? [] : doneSync(),
        // Voice memos left in the note, played where they sit (clips.ts).
        clips(),
        // The bookmarked line, marked so the place can be seen (bookmarkLine.ts).
        bookmarkRibbon(),
        tapeSlot.current.of(tapeSource.of({ src: tape, id: tapeId })),
        swipeItemTheme,
        EditorView.lineWrapping,
        assistSlot.current.of(EditorView.contentAttributes.of(assist ? PROSE_ATTRS : PLAIN_ATTRS)),
        themeSlot.current.of(glyphTheme(dark)),
        readOnlySlot.current.of(readOnlyExtensions(readOnly, boxTaps)),
        displaySlot.current.of(noteView(display)),
        lookSlot.current.of(lookExtensions(look)),
        // Find and replace's marks (find.ts): nothing until a search is running.
        findExtension(),
        placeholder ? cmPlaceholder(placeholder) : [],
        grow ? Prec.highest(GROW_THEME) : [],
        // The caret kept out of the page's foot smoke as it moves: the line being written is scrolled up before the
        // smoke bends it, not when it reaches the edge. Widens only what is scrolled to, so nothing moves otherwise.
        peek ? [] : EditorView.scrollMargins.of((current) => (footClearRef.current > 0 ? { bottom: footClearAt(current, footClearRef.current) } : null)),
        arrivals || wispTyping ? wispArrivals({ typing: wispTyping }) : [],
        ripples ? wispRipples(ripples) : [],
        // The AI's changes, tracked: tinted where it added, struck where it took away, Keep and Revert (aiChanges.ts).
        peek ? [] : aiChanges({ onMarks: (changes) => onAiMarksRef.current?.(changes) }),
        // The + beside an empty line (insertPlus.ts), where the screen asked for one.
        plus && !peek
          ? insertPlus({
              allowed: () => plusRef.current?.allowed() ?? false,
              onOpen: (opening) => plusRef.current?.onOpen(opening),
              onClose: () => plusRef.current?.onClose(),
              onKey: (key) => plusRef.current?.onKey(key) ?? false,
            })
          : [],
        // What goes in an open first heading, said in it (openHeading.ts).
        openHeading ? openHeadingHint() : [],
        // A new note's names and what the screen puts under them (nameChips.ts), where the screen asked for them.
        blankPage && !peek
          ? nameChips({ readyAtOnce: !isMobile, onName: (name) => blankRef.current?.onName(name), onShown: (shown) => blankRef.current?.onShown?.(shown) })
          : [],
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          for (const tr of update.transactions) feelTransaction(tr);
        }),
      ],
    });

    const created = new EditorView({ state, parent: host.current });
    view.current = created;
    onView?.(created);

    return () => {
      onView?.(null);
      created.destroy();
      view.current = null;
    };
    // Built once. Every prop that can change is reconfigured below instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme and input aids flip through Compartments, which swap one extension
  // in place: no new state, no lost selection, no interrupted composition.
  useEffect(() => {
    view.current?.dispatch({ effects: [themeSlot.current.reconfigure(glyphTheme(dark)), refreshCanvasFrames.of(null), refreshPlaceCards.of(null)] });
  }, [dark]);

  // The notes changed under the links: a canvas framed in this note may have been drawn on, so its frame is looked at
  // again. Told by a new `wiki`, which is why a caller keeps the one object while nothing has changed: each new one
  // rescans the whole note (editor/canvasFrames.ts).
  useEffect(() => {
    if (wiki?.body) view.current?.dispatch({ effects: refreshCanvasFrames.of(null) });
  }, [wiki]);

  // The same for a ticket's panel and its keys' titles: another ticket closed, a person named (editor/tickets.ts).
  useEffect(() => {
    if (wiki?.tickets) view.current?.dispatch({ effects: refreshTickets.of(null) });
  }, [wiki]);

  // And every query in the note: any note changed may change what one finds (editor/queries.ts). Told by a new set of
  // queries' options, which is new only when the notes are (shell/useQueries.ts), not by every new `wiki`, which is
  // new whenever App draws: a query is run over the whole library, and need not be run when nothing it reads moved.
  const queryOptions = wiki?.queries;
  useEffect(() => {
    if (queryOptions) view.current?.dispatch({ effects: refreshQueries.of(null) });
  }, [queryOptions]);

  useEffect(() => {
    view.current?.dispatch({
      effects: assistSlot.current.reconfigure(EditorView.contentAttributes.of(assist ? PROSE_ATTRS : PLAIN_ATTRS)),
    });
  }, [assist]);

  useEffect(() => {
    view.current?.dispatch({ effects: readOnlySlot.current.reconfigure(readOnlyExtensions(readOnly, boxTaps)) });
  }, [readOnly, boxTaps]);

  // The note's recording arrives after the note does, and goes when it is removed.
  useEffect(() => {
    view.current?.dispatch({ effects: tapeSlot.current.reconfigure(tapeSource.of({ src: tape, id: tapeId })) });
  }, [tape, tapeId]);

  useEffect(() => {
    view.current?.dispatch({ effects: displaySlot.current.reconfigure(noteView(display)) });
  }, [display]);

  useEffect(() => {
    view.current?.dispatch({ effects: lookSlot.current.reconfigure(lookExtensions(look)) });
  }, [look]);

  // What the blank page offers, told to the view as it changes: the names turn with the minute, and go at the first
  // letter. Compared by what they say, so a render that made the same list again tells the view nothing.
  const offered = useRef('');
  const names = blankPage?.names ?? null;
  const offersHost = blankPage?.host ?? null;
  useEffect(() => {
    const said = JSON.stringify(names?.map((offer) => [offer.name, offer.label]) ?? null);
    const hostId = offersHost ? 'host' : '';
    if (offered.current === `${said}|${hostId}` && view.current) return;
    offered.current = `${said}|${hostId}`;
    view.current?.dispatch({ effects: setOffers.of({ names, host: offersHost }) });
  }, [names, offersHost]);

  // A different note was opened. Compared against the view's own document
  // rather than a previous prop, so the echo of our own `onChange` is ignored.
  useEffect(() => {
    const current = view.current;
    if (!current || current.state.doc.toString() === value) return;
    current.dispatch({
      changes: { from: 0, to: current.state.doc.length, insert: value },
      selection: { anchor: Math.min(current.state.selection.main.anchor, value.length) },
    });
  }, [value]);

  // The caret stays in sight when the editor's room changes under it: the
  // keyboard rising (the activity shortens the page for it, MainActivity.kt
  // fitAboveKeyboard; some WebViews shrink only the visual viewport), a fold
  // opening, the window resized. Matt: "when first tapping on something below
  // the keyboard when there is no room to scroll stuff gets hidden until I
  // begin typing". A tap moves the caret without scrolling, and the keyboard
  // arrives after it, so nothing else would bring the line back into view.
  useEffect(() => {
    let frame = 0;
    const keepCaret = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const current = view.current;
        if (!current?.hasFocus) return;
        current.dispatch({ effects: EditorView.scrollIntoView(current.state.selection.main.head, { y: 'nearest', yMargin: 56 }) });
      });
    };
    window.addEventListener('resize', keepCaret);
    window.visualViewport?.addEventListener('resize', keepCaret);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', keepCaret);
      window.visualViewport?.removeEventListener('resize', keepCaret);
    };
  }, []);

  return <div className={styles.editor} data-grow={grow || undefined} data-view={display} ref={host} />;
}

/** An editor as tall as its document, filling at least its box, for a page that scrolls it. */
/**
 * The foot's clearance, held to a third of the room the page shows under its header: on a short page - a phone on its
 * side with the keyboard up - the whole of it would lift the line being typed up under the header, into the top's
 * smoke. The room is the page that scrolls around the note (NoteScreen's, `[data-scrolls]`) less the header over its
 * top, which it pads by; not laid out (a test), the clearance stands.
 */
function footClearAt(view: EditorView, clear: number): number {
  const page = view.dom.closest<HTMLElement>('[data-scrolls]') ?? view.scrollDOM;
  const height = page.clientHeight;
  if (!height) return clear;
  const under = parseFloat(getComputedStyle(page).paddingTop) || 0;
  return Math.min(clear, Math.max(0, (height - under) / 3));
}

// One class more specific than glyphTheme's own rules, which set the scroller
// to scroll and to hold its overscroll; kept, those swallowed every swipe on
// the note before the page could scroll.
const GROW_THEME = EditorView.theme({
  '&.cm-editor': { height: 'auto', minHeight: '100%', flex: '1 0 auto' },
  '&.cm-editor .cm-scroller': { overflowY: 'visible', overscrollBehavior: 'auto', flex: '1 0 auto' },
});

/** A look said on the editor for the stylesheets, and a reading note's lead line; nothing for the usual look. */
function lookExtensions(look: Look | null) {
  if (!look) return [];
  return [EditorView.editorAttributes.of({ 'data-look': look }), look === 'reading' ? leadLine() : []];
}

/**
 * Read-only in both of CodeMirror's senses. `readOnly` stops transactions from
 * editing; `editable` stops the content element being contenteditable at all,
 * which is what keeps a phone's keyboard from rising over a note that is being
 * dictated rather than typed.
 */
function readOnlyExtensions(readOnly: boolean, boxTaps = false) {
  return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly), boxTapsWhileReadOnly.of(readOnly && boxTaps)];
}
