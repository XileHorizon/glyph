import { StateEffect, StateField, type EditorState, type Extension, type Text, type TransactionSpec } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { wordsEnd } from '../core/boards.ts';

/**
 * The bookmark, written in the note (Matt: "we should show the bookmark in markdown as a physical symbol combo thats
 * rarely used. i should be able to tap bookmark again to update the position as well right now its stuck").
 *
 * It is two section signs at the end of the bookmarked line's words:
 *
 *   The deposit is four hundred. §§
 *   - [ ] Ship the pricing page §§ [notion](…) ^pricing-page
 *
 * `§§` is almost never typed, reads as a mark anywhere the note is opened, and travels with the note - to another
 * device, into a sync, into a copy - where a bookmark kept beside the note did not. A note holds one: putting it on a
 * line takes it off every other. On a list item it goes before the item's mark, counters and anchor, which have to
 * stay last (core/boards.ts `wordsEnd`), and it is never part of what the item says.
 *
 * Drawn as a small ribbon in place of the two signs, and a line down the bookmarked line's leading edge, so scrolling
 * past it shows where it is. The signs come back as text while the caret is right at them, to be edited like anything.
 *
 * A bookmark from before this, kept on the device (editor/notePlace.ts), is still shown, with `showBookmark`, until
 * the button next puts one in the note.
 */

export const BOOKMARK = '§§';
/** The mark and the space before it, wherever it sits on a line. */
const MARK = /[ \t]*§§(?=\s|$)/g;

/** The line (from 1) holding the note's bookmark, or null. */
export function bookmarkLineIn(doc: Text | string): number | null {
  const text = typeof doc === 'string' ? doc : doc.toString();
  const at = text.search(/§§(?=\s|$)/);
  if (at < 0) return null;
  return text.slice(0, at).split('\n').length;
}

/** A line's text with the bookmark taken out. */
export function withoutBookmark(line: string): string {
  return line.replace(MARK, '');
}

/**
 * The changes that put the bookmark on line `number` (from 1), taking it off everywhere else; with null, only taking
 * it off. One transaction, so it is one undo.
 */
export function placeBookmark(state: EditorState, number: number | null): TransactionSpec {
  const changes: { from: number; to: number; insert?: string }[] = [];
  const { doc } = state;
  for (let n = 1; n <= doc.lines; n += 1) {
    const line = doc.line(n);
    for (const found of line.text.matchAll(MARK)) changes.push({ from: line.from + found.index, to: line.from + found.index + found[0].length });
  }
  if (number !== null && number >= 1 && number <= doc.lines) {
    const line = doc.line(number);
    const clean = withoutBookmark(line.text);
    // The words end before a list item's mark, counters and anchor; elsewhere, at the end of the line.
    const end = wordsEnd(clean);
    // Positions in the clean line map onto the real one because the marks taken out all sit at or after the words' end.
    const at = line.from + Math.min(end, line.text.length);
    const before = clean.slice(0, end);
    changes.push({ from: at, to: at, insert: `${before && !/\s$/.test(before) ? ' ' : ''}${BOOKMARK}` });
  }
  return { changes, userEvent: 'input.bookmark' };
}

/** A bookmark kept on the device, shown until the note carries its own: the position, or null. */
export const showBookmark = StateEffect.define<number | null>();

/** `app-gold` gives the line the bookmark's gold (ink.css), for its edge and its mark; its words stay the page's ink. */
const ribbon = Decoration.line({ class: 'cm-bookmarked app-gold', attributes: { 'data-bookmark': 'The bookmark in this note' } });

/**
 * The shape drawn where `§§` stands: lucide's bookmark, the very icon the note's Bookmark button draws in the top bar
 * (editor/NoteScreen.tsx), so the button and the mark it puts on the page are one icon (Matt: "The bookmark icon that
 * renders in the code should match the bookmark icon in the top controls"). It used to be a notched ribbon cut out of
 * a solid block with a clip-path: a different drawing of the same idea, filled where the button is an outline.
 *
 * Copied, because a widget is plain DOM and lucide exports its icons only as components. A copy is the thing that
 * drifts, so bookmarkLine.test.ts draws the real component and holds this to its path: if lucide redraws the
 * bookmark, the test fails rather than the two quietly parting.
 */
export const BOOKMARK_PATH =
  'M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z';
/** The button's own line weight (NoteScreen.tsx `strokeWidth={2.1}`), so the two are drawn with one pen. */
const BOOKMARK_STROKE = '2.1';

const SVG = 'http://www.w3.org/2000/svg';

class RibbonWidget extends WidgetType {
  eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const mark = document.createElement('span');
    mark.className = 'cm-bookmarkMark';
    mark.setAttribute('aria-label', 'Bookmark');
    mark.title = 'Bookmark';
    const icon = document.createElementNS(SVG, 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    /*
     * Lucide's own classes, so the one rule in app.css that gives every closed-silhouette icon its outline and 33%
     * wash (`:where(svg.lucide-bookmark, ...)`) dresses this exactly as it dresses the button. The `fill="none"` below
     * is an attribute, and loses to that rule, which is what lets the wash through.
     */
    icon.setAttribute('class', 'lucide lucide-bookmark');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('stroke', 'currentColor');
    icon.setAttribute('stroke-width', BOOKMARK_STROKE);
    icon.setAttribute('stroke-linecap', 'round');
    icon.setAttribute('stroke-linejoin', 'round');
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', BOOKMARK_PATH);
    icon.append(path);
    mark.append(icon);
    return mark;
  }
}

const hidden = Decoration.replace({ widget: new RibbonWidget() });

interface Marks {
  /** The device's own bookmark, for a note without one written in. */
  kept: number | null;
  decorations: DecorationSet;
}

function decorate(state: EditorState, kept: number | null): DecorationSet {
  const written = bookmarkLineIn(state.doc);
  const number = written ?? (kept === null ? null : markedLine(state, kept));
  if (number === null) return Decoration.none;
  const line = state.doc.line(number);
  const ranges = [ribbon.range(line.from)];
  const found = written !== null ? /[ \t]*§§(?=\s|$)/.exec(line.text) : null;
  if (found) {
    const from = line.from + found.index;
    const to = from + found[0].length;
    // The signs as text only while the caret is at them, so they can be edited; a caret elsewhere on the line leaves the ribbon.
    const editing = state.selection.ranges.some((range) => range.from <= to && range.to >= from + found[0].length - BOOKMARK.length);
    if (!editing) ranges.push(hidden.range(from, to));
  }
  return Decoration.set(ranges, true);
}

const bookmarkField = StateField.define<Marks>({
  create: (state) => ({ kept: null, decorations: decorate(state, null) }),
  update(value, tr) {
    let kept = value.kept === null ? null : tr.changes.mapPos(value.kept);
    let touched = false;
    for (const effect of tr.effects) {
      if (effect.is(showBookmark)) {
        kept = effect.value;
        touched = true;
      }
    }
    if (!touched && !tr.docChanged && !tr.selection) return value;
    return { kept, decorations: decorate(tr.state, kept) };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

const bookmarkTheme = EditorView.baseTheme({
  '.cm-bookmarked': {
    position: 'relative',
    // The words themselves are untouched: a breath of tint behind the line, and the ribbon in the margin the line
    // already leaves before its first letter, which is the only room there is (the note runs to the page's edge).
    // Gold, like its edge and its mark, so the three read as one thing (ink.css `.app-gold`). The fallbacks are the ink
    // they were before, for an editor drawn without ink.css.
    borderRadius: '0.25em',
    background: 'color-mix(in oklch, var(--app-gold, currentColor) 7%, transparent)',
  },
  '.cm-bookmarked::before': {
    content: '""',
    position: 'absolute',
    insetInlineStart: '0.4em',
    insetBlock: '0.1em',
    inlineSize: '3px',
    borderRadius: '2px',
    background: 'var(--app-gold, currentColor)',
  },
  // The button's bookmark where the two signs are, the height of the line's own letters, in gold.
  '.cm-bookmarkMark': {
    display: 'inline-block',
    marginInlineStart: '0.35em',
    verticalAlign: '-0.15em',
    lineHeight: '0',
    color: 'var(--app-gold, currentColor)',
  },
  '.cm-bookmarkMark svg': {
    inlineSize: '1em',
    blockSize: '1em',
  },
});

/** How much of the bookmarked line is said back, so the words fit a toast. */
const SAY = 32;
/** Lines looked at from the bookmark before giving up on finding words: a place can land on a blank line. */
const LOOK = 5;

/** The words on a line, without the marks that make them a heading, a bullet or a to-do, or the bookmark. */
function wordsOn(state: EditorState, number: number): string {
  return withoutBookmark(state.doc.line(number).text)
    .replace(/^\s*(#{1,6}\s+|[-*+]\s+(\[[ xX]\]\s+)?|>\s+|\d+[.)]\s+)/, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+\^[a-z0-9][a-z0-9_-]*$/, '')
    .trim();
}

/**
 * Which line a place stands for: the one it is on, or the next with words on it. A place is often the blank line
 * between two paragraphs, and a bookmark on a blank line marks nothing a person can see.
 */
export function markedLine(state: EditorState, pos: number): number {
  const first = state.doc.lineAt(Math.max(0, Math.min(pos, state.doc.length))).number;
  for (let number = first; number < Math.min(first + LOOK, state.doc.lines + 1); number += 1) if (wordsOn(state, number)) return number;
  return first;
}

/**
 * The words the bookmark sits on, said the way they read. Null where there is nothing to say, so the message can
 * leave the place out rather than quote an empty line.
 */
export function markedWords(view: EditorView, pos: number): string | null {
  const words = wordsOn(view.state, markedLine(view.state, pos));
  if (!words) return null;
  if (words.length <= SAY) return words;
  // Cut at a space rather than through a word, so the quote reads as words and not as a broken one.
  const cut = words.slice(0, SAY);
  const space = cut.lastIndexOf(' ');
  return `${(space > SAY / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** The bookmarked line, shown as one. */
export function bookmarkRibbon(): Extension {
  return [bookmarkField, bookmarkTheme];
}
