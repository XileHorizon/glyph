import {
  ArrowDownToLine,
  ArrowUpToLine,
  Bold,
  ChevronLeft,
  ClipboardPaste,
  Code,
  Copy,
  CopyPlus,
  Heading,
  ImagePlus,
  LayoutGrid,
  SquareKanban,
  Italic,
  Link,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Scissors,
  Strikethrough,
  Table,
  TextQuote,
  TextSearch,
  TextSelect,
  Trash2,
  Type,
} from '@glacier/icons';
import { useCallback, useEffect, useReducer, useRef, useState, type ComponentType, type CSSProperties, type HTMLAttributes } from 'react';
import type { EditorView } from '@codemirror/view';
import { useBack } from '../core/back.ts';
import { fireNativeHaptic } from '../core/haptics.ts';
import { plugins } from '../plugins/registry.ts';
import {
  activeBlock,
  activeMarks,
  activeWraps,
  deleteSelection,
  duplicateSelection,
  insertLink,
  insertRule,
  insertTable,
  moveLines,
  toggleBlock,
  toggleMark,
  toggleWrap,
  type Block,
  type Mark,
} from './format.ts';
import { addToBoard, boardAt, boardCopy, boardFromList, listAround } from '../core/boards.ts';
import { itemWords } from '../core/itemLinks.ts';
import styles from './ContextMenu.module.css';

/**
 * The note's own press-and-hold menu, in place of the phone's.
 *
 * A long press in the editor (a right click on a desktop) fires `contextmenu`;
 * preventing it keeps the word the press selected, handles and all, and
 * keeps Android's own Cut / Copy / Read aloud bar away - measured on the
 * emulator, and the reason this needs nothing native. What appears instead is
 * a row of Glyph's words above the selection: Cut, Copy, Paste, Select all,
 * Add image; and under it, when the formatter offers them, the edits that
 * rewrite the selection (Shorten, Expand and the rest, from format/edits.ts).
 *
 * Reading the clipboard is the one thing the page cannot do here (the WebView
 * refuses `clipboard.read`), so Paste appears only on a build whose activity
 * answers `GlyphHost.readClipboard`; the keyboard's own paste works either
 * way. Writing is allowed, so Cut and Copy are the page's own.
 *
 * Each word stands under its drawn icon, in display weight, the same hand as
 * a linked line's menu (MarkMenu.tsx). Matt: "make the options typography and
 * iconography heavy so they fit the theme on all context menus".
 *
 * Style is here too, not in a bar of its own (Matt, of the bar of symbols
 * under the top bar: "redo the UI/UX for selecting text styles, it doesn't
 * look good as is, maybe it needs to be something we do by pressing and
 * holding on text"). Style turns the menu over to the formatting, in the same
 * hand: the marks that wrap the selection (bold, italic, struck, code, and
 * any a switched-on plugin adds, like Spoiler), the forms a line takes
 * (heading, quote, list, numbered, to-do), and the things put in (link,
 * table, rule), all in one band that scrolls sideways, a little space between
 * the three kinds (three bands stacked "looks a bit strange", Matt; a heavier
 * rule between the kinds read as "two pixels thick"). A
 * pressed style stays on the menu, lit while it applies, so a word can be
 * made bold and struck in one go; the arrow goes back.
 */

export interface MenuEdit {
  id: string;
  label: string;
}

interface ContextMenuProps {
  view: EditorView | null;
  /** Opens the picture picker; absent where a picture makes no sense, and the word is not shown. */
  onAddImage?: () => void;
  /** Adopts a picture the activity copied out of the clipboard, by path; answers its name. */
  onPasteImage?: (path: string) => Promise<void>;
  /** A sentence for the person, when something they asked for could not be done. */
  say?: (message: string) => void;
  edits?: MenuEdit[];
  onEdit?: (id: string, from: number, to: number) => void;
  /** Why the edits cannot run right now, shown under them greyed. */
  editsUnavailable?: string | null;
  /** Opens find and replace with the selected words (FindBar.tsx); absent, the word is not shown. */
  onFind?: (text: string) => void;
  /** Sends the line's words where a plugin takes them (a Notion board, a GitHub issue); absent, nothing is shown. */
  send?: { label: string; run: (text: string) => Promise<void> | void } | null;
}

interface Open {
  x: number;
  y: number;
  from: number;
  to: number;
}

type Clipboard = { text?: string; path?: string; error?: string };

/**
 * What is on the clipboard, however this build can find out, and whether anything could actually answer.
 *
 * The activity is asked first: it is the only reader that answers with a picture, and inside the app it is usually
 * the only reader there is - `navigator.clipboard.readText` is missing or refuses in Android's WebView, where the
 * permission behind it is not wired up. The browser's reader is tried where the activity gives nothing, which is what
 * the web app has. When neither answers, that is not the same as an empty clipboard, and `read` says so, because a
 * message claiming the clipboard is empty when it could not be read sends a person looking in the wrong place.
 */
async function readClipboard(): Promise<{ clip: Clipboard; read: boolean }> {
  const host = (window as { GlyphHost?: { readClipboard?: () => string } }).GlyphHost;
  let said: Clipboard = {};
  if (typeof host?.readClipboard === 'function') {
    try {
      const answer = host.readClipboard();
      said = answer ? (JSON.parse(answer) as Clipboard) : {};
    } catch {
      // The activity could not read it (an older build, or a read that threw): the browser is tried below.
      said = {};
    }
  }
  if (said.text || said.path || said.error) return { clip: said, read: true };
  if (typeof navigator.clipboard?.readText !== 'function') return { clip: said, read: false };
  // A reader that answers, even with nothing, has told us the clipboard is empty. One that throws is the caller's.
  const text = await navigator.clipboard.readText();
  return text ? { clip: { text }, read: true } : { clip: {}, read: true };
}

/** Whether a Paste row is worth showing at all: one of the two readers is there to try. */
function canRead(): boolean {
  const host = (window as { GlyphHost?: { readClipboard?: () => string } }).GlyphHost;
  return typeof host?.readClipboard === 'function' || typeof navigator.clipboard?.readText === 'function';
}

/**
 * Whether a press landed on something drawn in place of the note's words - a board (editor/boards.ts) or a mermaid
 * diagram (editor/mermaid.ts). The note's own menu is about a line of text, and neither of those is one.
 */
function drawnBlock(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.cm-board, .cm-boardWrap, .cm-mermaid') !== null;
}

export function ContextMenu({ view, onAddImage, onPasteImage, say, edits = [], onEdit, editsUnavailable = null, onFind, send = null }: ContextMenuProps) {
  const [open, setOpen] = useState<Open | null>(null);
  /** The menu's words, or its styles. */
  const [styling, setStyling] = useState(false);
  // A style pressed changes what is lit: the menu reads the editor again.
  const [, restyled] = useReducer((n: number) => n + 1, 0);
  const menu = useRef<HTMLDivElement>(null);
  const pasteable = canRead();

  const close = useCallback(() => setOpen(null), []);

  // The press: where the selection is, or where the finger was.
  useEffect(() => {
    if (!view) return undefined;
    const dom = view.dom;
    const show = (x: number, y: number) => {
      const { from, to, head } = view.state.selection.main;
      const at = view.coordsAtPos(head);
      setStyling(false);
      setOpen({ x: at ? (at.left + at.right) / 2 : x, y: at ? at.top : y, from, to });
    };
    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      // Not over something the note draws in place of its words: a board or a diagram is not a line to format
      // (Matt: "Formatting menu shows up on board unexpectedly"). A board's cards have a menu of their own.
      if (drawnBlock(event.target)) return;
      // The word the press selected has landed by the next frame.
      window.requestAnimationFrame(() => show(event.clientX, event.clientY));
    };
    dom.addEventListener('contextmenu', onContextMenu);

    // A long press where there is no word to hold, an empty line or the space after a line's last word, selects
    // nothing, so the phone may fire no contextmenu and the caret may be somewhere else (Matt: "quite hard to open
    // on new text lines where there's nothing yet"). Timed here instead: the caret goes to the finger and the menu
    // opens there. A press on a word is left to the phone, which selects it and fires contextmenu as before.
    let press: { timer: number; x: number; y: number } | null = null;
    const cancel = () => {
      if (press) window.clearTimeout(press.timer);
      press = null;
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' || !event.isPrimary) return;
      cancel();
      // A press on a drawn board or diagram belongs to it: it is picked up, or it opens the card's own menu.
      if (drawnBlock(event.target)) return;
      const { clientX: x, clientY: y } = event;
      press = {
        x,
        y,
        timer: window.setTimeout(() => {
          press = null;
          // An empty note has no text under the finger, and the precise reading is null there; the nearest place in
          // the note is what a press means anyway (Matt: "i cant seem to paste a note" - into an empty one).
          const pos = view.posAtCoords({ x, y }) ?? view.posAtCoords({ x, y }, false);
          if (pos === null) return;
          const line = view.state.doc.lineAt(pos);
          const wordAt = (offset: number) => offset > line.from - 1 && offset < line.to && /\S/.test(view.state.sliceDoc(offset, offset + 1));
          if (wordAt(pos) || wordAt(pos - 1)) return;
          view.dispatch({ selection: { anchor: pos } });
          fireNativeHaptic('selection');
          show(x, y);
        }, LONG_PRESS_MS),
      };
    };
    const onPointerMove = (event: PointerEvent) => {
      if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8) cancel();
    };
    dom.addEventListener('pointerdown', onPointerDown);
    dom.addEventListener('pointermove', onPointerMove);
    dom.addEventListener('pointerup', cancel);
    dom.addEventListener('pointercancel', cancel);
    return () => {
      cancel();
      dom.removeEventListener('contextmenu', onContextMenu);
      dom.removeEventListener('pointerdown', onPointerDown);
      dom.removeEventListener('pointermove', onPointerMove);
      dom.removeEventListener('pointerup', cancel);
      dom.removeEventListener('pointercancel', cancel);
    };
  }, [view]);

  // It leaves on a touch anywhere else, a scroll, or the back gesture.
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event: PointerEvent) => {
      if (menu.current && event.target instanceof Node && menu.current.contains(event.target)) return;
      close();
    };
    // A scroll along the menu's own band (the styles run past the screen's edge) is not a scroll of the note.
    const onScroll = (event: Event) => {
      if (menu.current && event.target instanceof Node && menu.current.contains(event.target)) return;
      close();
    };
    document.addEventListener('pointerdown', outside, true);
    // Scroll events don't bubble; captured on the document, a scroll of the editor or of the page around it is heard.
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, [open, view, close]);

  useBack(open !== null, close);

  // Sits above the selection, inside the screen, and never over the keyboard.
  useEffect(() => {
    const element = menu.current;
    if (!open || !element) return;
    // Layout sizes, not the drawn box: the entrance animation starts a touch
    // smaller, and a rect taken on that frame would put the menu off-centre.
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    const margin = 8;
    let left = open.x - width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
    let top = open.y - height - 12;
    if (top < margin) top = open.y + 40;
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
  }, [open, styling]);

  if (!open || !view) return null;

  const { from, to } = open;
  const selected = from !== to;
  const text = () => view.state.sliceDoc(from, to);

  const act = (what: () => void | Promise<void>) => async () => {
    fireNativeHaptic('selection');
    close();
    await what();
    view.focus();
  };

  /** Words onto the clipboard, however this browser lets them go there. */
  const write = async (words: string) => {
    try {
      await navigator.clipboard.writeText(words);
    } catch {
      // A browser with no clipboard access: the old way still copies a selection.
      document.execCommand('copy');
    }
  };

  const copy = () => write(text());

  const cut = async () => {
    await copy();
    view.dispatch({ changes: { from, to, insert: '' }, selection: { anchor: from } });
  };

  const paste = async () => {
    let got: { clip: Clipboard; read: boolean };
    try {
      got = await readClipboard();
    } catch {
      // Refused outright: nothing is pasted, and the person is told why rather than left guessing at a dead row.
      say?.('Ghost.md couldn’t reach the clipboard here. Tap into the note and paste from your keyboard instead.');
      return;
    }
    const { clip, read } = got;
    if (clip.error) {
      say?.(clip.error);
      return;
    }
    if (clip.path && onPasteImage) {
      await onPasteImage(clip.path);
      return;
    }
    if (!clip.text) {
      // Nothing came back. Only a reader that answered can say the clipboard is empty; otherwise it went unread.
      // An activity that answered with nothing cannot tell an empty clipboard from a read it was refused, so the
      // words say only what is certain: nothing arrived, and here is the way round it.
      say?.(
        read
          ? 'Nothing on the clipboard to paste. Copy the words again, then hold here.'
          : 'Nothing came back from the clipboard. Copy it again, or tap into the note and paste from your keyboard.',
      );
      return;
    }
    view.dispatch({ changes: { from, to, insert: clip.text }, selection: { anchor: from + clip.text.length } });
  };

  const selectAll = () => {
    view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
  };

  if (styling) {
    const style = (run: (target: EditorView) => void) => () => {
      fireNativeHaptic('selection');
      run(view);
      restyled();
    };
    const put = (run: (target: EditorView) => void) => () => {
      fireNativeHaptic('selection');
      close();
      run(view);
      view.focus();
    };
    const state = view.state;
    // Each switched-on plugin's formattings, under that plugin's own icon.
    // A mark's own icon where it has one (plugins/types.ts `InlineFormat`), else the plugin's, else the letter.
    const formats = plugins
      .enabled()
      .flatMap((plugin) => (plugin.formats ?? []).map((format) => ({ format, icon: ((format.icon ?? plugin.icon) as Icon | undefined) ?? Type })));
    return (
      <div ref={menu} className={styles.menu} role="menu" aria-label="Styles" onPointerDown={(event) => event.preventDefault()}>
        <Row>
          <button type="button" role="menuitem" className={styles.item} onClick={() => setStyling(false)} aria-label="Back to the note's actions">
            <Word icon={ChevronLeft} label="Back" />
          </button>
          {MARKS.map(({ mark, icon, label }, i) => (
            <StyleItem
              key={mark}
              icon={icon}
              label={label}
              i={i}
              lit={activeMarks(state).includes(mark)}
              onClick={style((target) => toggleMark(target, mark))}
            />
          ))}
          {formats.map(({ format, icon }, i) => (
            <StyleItem
              key={format.name}
              icon={icon}
              label={format.name}
              i={MARKS.length + i}
              lit={activeWraps(state, [format.delimiter]).length > 0}
              onClick={style((target) => toggleWrap(target, format.delimiter))}
            />
          ))}
          {BLOCKS.map(({ block, icon, label }, i) => (
            <StyleItem
              key={block}
              icon={icon}
              label={label}
              i={MARKS.length + formats.length + i}
              group={i === 0}
              lit={activeBlock(state) === block}
              onClick={style((target) => toggleBlock(target, block))}
            />
          ))}
          {INSERTS.map(({ key, icon, label, run }, i) => (
            <StyleItem key={key} icon={icon} label={label} i={MARKS.length + formats.length + BLOCKS.length + i} group={i === 0} onClick={put(run)} />
          ))}
        </Row>
      </div>
    );
  }

  /** The line the caret is on, for the actions that are about a line rather than a selection. */
  const caretLine = view ? view.state.doc.lineAt(view.state.selection.main.head) : null;
  // What the item says, as a plugin sends it: no marker, no mark, and not the board's anchor (core/itemLinks.ts).
  const lineWords = caretLine ? (itemWords(caretLine.text) ?? caretLine.text.trim()) : '';
  /** A list item that a board in this note could take (core/boards.ts). */
  const boardable = view && caretLine ? addToBoard(view.state.doc.toString(), caretLine.number) !== null : false;
  /** The board the press landed on (core/boards.ts), and it as words: the fence and the items it names. */
  const fence = view && caretLine ? boardAt(view.state.doc.toString(), caretLine.number) : null;
  const board = view && caretLine ? boardCopy(view.state.doc.toString(), caretLine.number) : null;

  /**
   * A row that works on lines, run on a board: the whole fence is taken first. Pressed on a drawn board the caret is
   * on one of its column lines, and duplicating or deleting that alone would leave half a board behind.
   */
  const whole = (run: (target: EditorView) => void) => () => {
    if (!view) return;
    if (fence) {
      const open = view.state.doc.line(fence.from);
      const close = view.state.doc.line(fence.to);
      view.dispatch({ selection: { anchor: open.from, head: close.to } });
    }
    run(view);
  };

  /**
   * The list the press is in - or the lines selected, when more than one is - as a board of its own, set in just
   * above it (core/boards.ts `boardFromList`; Matt: "add ability to auto list a section of list items into a
   * board"). Not offered on a board, or on a list that already has one above it.
   */
  const listRange = (() => {
    if (!view || !caretLine || fence) return null;
    const doc = view.state.doc;
    const { from: start, to: end } = view.state.selection.main;
    const first = doc.lineAt(start).number;
    const last = doc.lineAt(end).number;
    return last > first ? { from: first, to: last } : listAround(doc.toString(), caretLine.number);
  })();
  const listBoard = view && listRange ? boardFromList(view.state.doc.toString(), listRange.from, listRange.to) : null;

  const makeListBoard = () => {
    if (!view || !listRange) return;
    const made = boardFromList(view.state.doc.toString(), listRange.from, listRange.to);
    if (!made) return;
    const doc = view.state.doc;
    // The item lines, and the fence put in at the start of the list's first line: where that line changes too, the
    // fence goes in front of its new words, as one change.
    const changes = made.lines.map(({ number, text }) => {
      const line = doc.line(number);
      return { from: line.from, to: line.to, insert: number === made.fence.before ? `${made.fence.text}${text}` : text };
    });
    if (!made.lines.some((line) => line.number === made.fence.before)) {
      const at = doc.line(made.fence.before).from;
      changes.push({ from: at, to: at, insert: made.fence.text });
    }
    view.dispatch({ changes, userEvent: 'input.board' });
    fireNativeHaptic('success');
    say?.(`${made.cards} ${made.cards === 1 ? 'item is' : 'items are'} now a board${made.done ? `, ${made.done} in Done` : ''}.`);
  };

  /**
   * The item joins its list's board: the line gains its anchor, and the fence gains the card (core/boards.ts
   * `addToBoard`; Matt: "add an 'add to board' option when other items in the list are in a board already"). The board
   * may be well off the screen, so where it went is said aloud.
   */
  const putOnBoard = () => {
    if (!view || !caretLine) return;
    const added = addToBoard(view.state.doc.toString(), caretLine.number);
    if (!added) return;
    const doc = view.state.doc;
    const open = doc.line(added.fence.from);
    const close = doc.line(added.fence.to);
    const changes = [{ from: open.to + 1, to: close.from - 1, insert: added.fence.body }];
    if (added.line) {
      const line = doc.line(added.line.number);
      changes.push({ from: line.from, to: line.to, insert: added.line.text });
    }
    view.dispatch({ changes, userEvent: 'input.board' });
    fireNativeHaptic('success');
    say?.(`Added to ${added.column}.`);
  };

  return (
    <div
      ref={menu}
      className={styles.menu}
      role="menu"
      aria-label="Note actions"
      // A press on the menu must not take the editor's focus or its selection.
      onPointerDown={(event) => event.preventDefault()}
    >
      <Row>
        {selected ? (
          <>
            <button type="button" role="menuitem" className={styles.item} onClick={() => void act(cut)()}>
              <Word icon={Scissors} label="Cut" />
            </button>
            <button type="button" role="menuitem" className={styles.item} onClick={() => void act(copy)()}>
              <Word icon={Copy} label="Copy" />
            </button>
          </>
        ) : null}
        {pasteable ? (
          <button type="button" role="menuitem" className={styles.item} onClick={() => void act(paste)()}>
            <Word icon={ClipboardPaste} label="Paste" />
          </button>
        ) : null}
        {/* A board is drawn as columns, so it cannot be dragged over: this takes the whole of it at once. */}
        {board ? (
          <button type="button" role="menuitem" className={styles.item} onClick={() => void act(() => write(board))()}>
            <Word icon={Copy} label="Copy board" />
          </button>
        ) : null}
        {selected && onFind && to - from <= 120 ? (
          <button
            type="button"
            role="menuitem"
            className={styles.item}
            onClick={() => {
              fireNativeHaptic('selection');
              close();
              onFind(text());
            }}
          >
            <Word icon={TextSearch} label="Find" />
          </button>
        ) : null}
        <button type="button" role="menuitem" className={styles.item} onClick={() => void act(selectAll)()}>
          <Word icon={TextSelect} label="Select all" />
        </button>
        <button type="button" role="menuitem" className={styles.item} onClick={() => void act(whole(duplicateSelection))()}>
          <Word icon={CopyPlus} label="Duplicate" />
        </button>
        <button type="button" role="menuitem" className={styles.item} onClick={() => void act(whole(deleteSelection))()}>
          <Word icon={Trash2} label="Delete" />
        </button>
        <button type="button" role="menuitem" className={styles.item} onClick={() => void act(whole((target) => moveLines(target, -1)))()}>
          <Word icon={ArrowUpToLine} label="Move up" />
        </button>
        <button type="button" role="menuitem" className={styles.item} onClick={() => void act(whole((target) => moveLines(target, 1)))()}>
          <Word icon={ArrowDownToLine} label="Move down" />
        </button>
        {boardable ? (
          <button type="button" role="menuitem" className={styles.item} onClick={() => void act(putOnBoard)()}>
            <Word icon={LayoutGrid} label="Add to board" />
          </button>
        ) : null}
        {listBoard ? (
          <button type="button" role="menuitem" className={styles.item} onClick={() => void act(makeListBoard)()}>
            <Word icon={SquareKanban} label="Board from list" />
          </button>
        ) : null}
        {send && lineWords ? (
          <button type="button" role="menuitem" className={styles.item} onClick={() => void act(() => send.run(lineWords))()}>
            <Word icon={Link} label={send.label} />
          </button>
        ) : null}
        <button
          type="button"
          role="menuitem"
          className={styles.item}
          onClick={() => {
            fireNativeHaptic('selection');
            setStyling(true);
          }}
        >
          <Word icon={Type} label="Style" />
        </button>
        {onAddImage ? (
          <button type="button" role="menuitem" className={styles.item} onClick={() => void act(onAddImage)()}>
            <Word icon={ImagePlus} label="Add image" />
          </button>
        ) : null}
      </Row>
      {selected && edits.length ? (
        <Row data-edits="" aria-disabled={editsUnavailable ? true : undefined}>
          {edits.map((edit) => (
            <button
              key={edit.id}
              type="button"
              role="menuitem"
              className={styles.item}
              disabled={Boolean(editsUnavailable)}
              onClick={() => void act(() => onEdit?.(edit.id, from, to))()}
            >
              {edit.label}
            </button>
          ))}
          {editsUnavailable ? <span className={styles.why}>{editsUnavailable}</span> : null}
        </Row>
      ) : null}
    </div>
  );
}

/** How long a finger holds on empty paper before the menu opens there: about the phone's own long press. */
const LONG_PRESS_MS = 480;

type Icon = ComponentType<{ size?: number; strokeWidth?: number }>;

const MARKS: { mark: Mark; icon: Icon; label: string }[] = [
  { mark: 'bold', icon: Bold, label: 'Bold' },
  { mark: 'italic', icon: Italic, label: 'Italic' },
  { mark: 'strike', icon: Strikethrough, label: 'Struck' },
  { mark: 'code', icon: Code, label: 'Code' },
];

const INSERTS: { key: string; icon: Icon; label: string; run: (view: EditorView) => void }[] = [
  { key: 'link', icon: Link, label: 'Link', run: insertLink },
  { key: 'table', icon: Table, label: 'Table', run: insertTable },
  { key: 'rule', icon: Minus, label: 'Rule', run: insertRule },
];

const BLOCKS: { block: Block; icon: Icon; label: string }[] = [
  { block: 'heading', icon: Heading, label: 'Heading' },
  { block: 'quote', icon: TextQuote, label: 'Quote' },
  { block: 'bullet', icon: List, label: 'List' },
  { block: 'number', icon: ListOrdered, label: 'Numbered' },
  { block: 'task', icon: ListTodo, label: 'To-do' },
];

/** A style: its icon over its word, lit (printed in reverse) while it applies, coming in out of smoke after the ones before it. */
function StyleItem({
  icon,
  label,
  i,
  lit = false,
  group = false,
  onClick,
}: {
  icon: Icon;
  label: string;
  i: number;
  lit?: boolean;
  group?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={lit}
      className={`${styles.item} ${styles.style}`}
      data-lit={lit || undefined}
      data-group={group || undefined}
      style={{ '--i': i } as CSSProperties}
      onClick={onClick}
    >
      <Word icon={icon} label={label} />
    </button>
  );
}

/** An icon over its word. */
function Word({ icon: Icon, label }: { icon: ComponentType<{ size?: number; strokeWidth?: number }>; label: string }) {
  return (
    <>
      <Icon size={20} strokeWidth={2.1} />
      <span className={styles.word}>{label}</span>
    </>
  );
}

/**
 * One band of the menu. Five words do not always fit a phone held upright,
 * so the band scrolls sideways, and fades at whichever end has more: a word
 * cut off at the edge reads as broken, a word fading out reads as "and more".
 */
function Row({ children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const row = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState('');

  useEffect(() => {
    const element = row.current;
    if (!element) return undefined;
    const measure = () => {
      const start = element.scrollLeft > 1;
      const end = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
      setMore([start ? 'start' : '', end ? 'end' : ''].filter(Boolean).join(' '));
    };
    measure();
    element.addEventListener('scroll', measure, { passive: true });
    return () => element.removeEventListener('scroll', measure);
  }, []);

  return (
    <div ref={row} className={styles.row} data-more={more || undefined} {...rest}>
      {children}
    </div>
  );
}
