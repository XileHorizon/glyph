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
import { extendedMarkdown } from './extended.ts';
import { footnotes } from './footnotes.ts';
import { taskToggle } from './taskToggle.ts';
import { tags } from './tags.ts';
import { counters } from './counters.ts';
import { sums } from './sums.ts';
import { headingProgress } from './headingProgress.ts';
import { choices } from './choices.ts';
import { linkCards } from './linkCards.ts';
import { wikiLinks, type WikiOptions } from './wikiLinks.ts';
import { markNotes } from './markNotes.ts';
import { drawnTables } from './tables.ts';
import { swipeItemAction, swipeItemTheme, type SwipeAction } from './swipeItems.ts';
import { lineSuggestions, type LineSuggestion } from './suggestions.ts';
import { glyphMarkdown } from './language.ts';
import { formatLooks } from './formatLooks.ts';
import { wispFormat } from './wispFormat.ts';
import { wispArrivals } from './wispArrivals.ts';
import { noteView, type NoteView } from './viewMode.ts';
import { findExtension } from './find.ts';
import { clips, tapeSource } from './clips.ts';
import { drawnBoards } from './boards.ts';
import { drawnMermaid } from './mermaid.ts';
import { bookmarkRibbon } from './bookmarkLine.ts';
import { localUndo, undoSlot } from './undoSlot.ts';
import { wispRipples, type RippleSource } from './wispRipples.ts';
import { plugins } from '../plugins/registry.ts';
import type { InlineFormat } from '../plugins/types.ts';
import styles from './Editor.module.css';

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
  /** Where this note's recording is played from, for the voice memos in it (editor/clips.ts); null without one. */
  tape?: string | null;
  /** Which tape that is (core/clips.ts `tapeId`): a memo of another tape is drawn, not played. */
  tapeId?: string | null;
  /**
   * Text written in with the `wisp` annotation arrives from smoke and leaves into it (editor/wispArrivals.ts): the
   * recorder writing a note as it is heard. Read once, when the editor is made.
   */
  arrivals?: boolean;
  /** What the person types arrives from smoke too, and a backspace leaves into it (editor/wispArrivals.ts `typing`). */
  wispTyping?: boolean;
  /**
   * The voice runs through the last lines as ripples (editor/wispRipples.ts): the recorder's page, with the mic
   * level as the source. Read once, when the editor is made.
   */
  ripples?: RippleSource;
  /**
   * The inline formattings plugins add (plugins/types.ts `InlineFormat`), parsed
   * and drawn in this note. Read once, when the editor is made; absent, the
   * switched-on plugins' own.
   */
  formats?: readonly InlineFormat[];
  /** The mixed page, marks and formatting both (the default), or just the formatted text (editor/viewMode.ts). */
  display?: NoteView;
  /**
   * A note drawn small on a card (notes/NotePeek.tsx): the same formatter as the note, but nothing that would fetch,
   * poll or act - no link preview cards, no diagrams, no Notion reads for its marks, no taps on its boxes. Read once,
   * when the editor is made.
   */
  peek?: boolean;
  /** Diagrams drawn even on a peek: a canvas card is small but is read, so a chart on it is the point of the card. */
  diagrams?: boolean;
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
  swipeAction,
  suggest,
  linkMenus,
  wiki,
  grow = false,
  tape = null,
  tapeId = null,
  arrivals = false,
  wispTyping = false,
  ripples,
  formats,
  display = 'mixed',
  peek = false,
  diagrams = false,
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
  const suggestRef = useRef(suggest);
  suggestRef.current = suggest;
  const linkMenusRef = useRef(linkMenus);
  linkMenusRef.current = linkMenus;
  const wikiRef = useRef(wiki);
  wikiRef.current = wiki;

  const themeSlot = useRef(new Compartment());
  const assistSlot = useRef(new Compartment());
  const readOnlySlot = useRef(new Compartment());
  const tapeSlot = useRef(new Compartment());
  const displaySlot = useRef(new Compartment());

  useEffect(() => {
    if (!host.current) return undefined;

    const formatList = formats ?? plugins.formats();
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
        // A note in brackets after a mark, shown when its words are tapped (editor/markNotes.ts).
        markNotes(formatList),
        syntaxHighlighting(glyphHighlight),
        glyphLines,
        // Superscript, subscript and GitHub callouts, drawn as what they are (editor/extended.ts).
        extendedMarkdown(),
        // [^a] raised and quiet, its words on a tap (editor/footnotes.ts).
        footnotes(),
        // #tags drawn as small chips (editor/tags.ts).
        tags(),
        // [3/8] counters, `= 450 + 120` sums, "3 of 7" after a heading, and `- ( )` choices (editor/counters.ts, sums.ts,
        // headingProgress.ts, choices.ts).
        counters(),
        sums(),
        headingProgress(),
        choices(),
        // [[Another note]] opens that note, or makes it (editor/wikiLinks.ts).
        wikiLinks(wiki ? { known: (title) => wikiRef.current?.known(title) ?? false, open: (title, anchor) => wikiRef.current?.open(title, anchor) } : null),
        inlineImages((message) => onImageErrorRef.current?.(message)),
        shortLinks({ still: peek }),
        // A card under a line that is only a link (editor/linkCards.ts).
        peek ? [] : linkCards(),
        linkedRows(linkMenus ? { say: (message) => linkMenusRef.current?.say(message) } : null),
        drawnTables(),
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
        readOnlySlot.current.of(readOnlyExtensions(readOnly)),
        displaySlot.current.of(noteView(display)),
        // Find and replace's marks (find.ts): nothing until a search is running.
        findExtension(),
        placeholder ? cmPlaceholder(placeholder) : [],
        grow ? Prec.highest(GROW_THEME) : [],
        arrivals || wispTyping ? wispArrivals({ typing: wispTyping }) : [],
        ripples ? wispRipples(ripples) : [],
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
    view.current?.dispatch({ effects: themeSlot.current.reconfigure(glyphTheme(dark)) });
  }, [dark]);

  useEffect(() => {
    view.current?.dispatch({
      effects: assistSlot.current.reconfigure(EditorView.contentAttributes.of(assist ? PROSE_ATTRS : PLAIN_ATTRS)),
    });
  }, [assist]);

  useEffect(() => {
    view.current?.dispatch({ effects: readOnlySlot.current.reconfigure(readOnlyExtensions(readOnly)) });
  }, [readOnly]);

  // The note's recording arrives after the note does, and goes when it is removed.
  useEffect(() => {
    view.current?.dispatch({ effects: tapeSlot.current.reconfigure(tapeSource.of({ src: tape, id: tapeId })) });
  }, [tape, tapeId]);

  useEffect(() => {
    view.current?.dispatch({ effects: displaySlot.current.reconfigure(noteView(display)) });
  }, [display]);

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
// One class more specific than glyphTheme's own rules, which set the scroller
// to scroll and to hold its overscroll; kept, those swallowed every swipe on
// the note before the page could scroll.
const GROW_THEME = EditorView.theme({
  '&.cm-editor': { height: 'auto', minHeight: '100%', flex: '1 0 auto' },
  '&.cm-editor .cm-scroller': { overflowY: 'visible', overscrollBehavior: 'auto', flex: '1 0 auto' },
});

/**
 * Read-only in both of CodeMirror's senses. `readOnly` stops transactions from
 * editing; `editable` stops the content element being contenteditable at all,
 * which is what keeps a phone's keyboard from rising over a note that is being
 * dictated rather than typed.
 */
function readOnlyExtensions(readOnly: boolean) {
  return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];
}
