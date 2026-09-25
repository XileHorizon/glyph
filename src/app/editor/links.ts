import { RangeSetBuilder, StateEffect, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { boardsIn, itemsIn } from '../core/boards.ts';
import { ITEM_TAIL, itemWords, markOf } from '../core/itemLinks.ts';
import { hasMarkDetails, markNameFor, onMarkDetails, peekMarkDetails, wantMarkDetails, type MarkEntry } from '../core/markDetails.ts';
import { shortUrl } from '../core/shortUrl.ts';

/**
 * Links, shortened: `notion.so/att…b3c` in place of the whole address.
 *
 * Matt: "For formatted links in the app don't show the full link path just
 * show the first 3 chars after the tld then a ... and the last 3 chars". A
 * Notion task's address is a hundred characters of slug and id, and set in the
 * note's own type it pushed every other word off the line.
 *
 * The first thing the editor shows in place of what is written, which the
 * rest of it never does (glyphLines.ts), so it is kept to the one case and it
 * steps aside whenever the address might be edited: on the line the caret is
 * on, the address is written out in full, exactly as it is stored. Everywhere
 * else a link's address, in `[words](address)` or said bare, shows as its
 * host, three characters, an ellipsis and three characters, with the whole
 * address as its title for a long press to read. Nothing about the text
 * changes, and a read-only view (the Formatted note) shows every link short.
 *
 * The item mark is the other case (core/itemLinks.ts): a list item that ends
 * with `[notion](address)` is linked to a Notion task, and the whole mark is
 * drawn as one small solid pill with the name on it - the done twin of the
 * outlined suggestion pill (suggestions.ts), so a note reads at a glance:
 * outlined could be a task, solid is one. On the caret's line it, too, is
 * written out in full.
 *
 * Where the mark's plugin reads what it links to (core/markDetails.ts), the
 * mark itself steps aside: the item's row of pills under it says what it is
 * linked to and what that is doing, and opens its menu (editor/linkedRows.ts).
 * The pill here is for a mark whose plugin is off, or one that reads nothing.
 * Either way this plugin asks for the details of every linked thing in view:
 * on opening, on coming back to the front, and once a minute while the note
 * is open.
 */

/** Details arrived from a plugin: redraw the pills and rows. */
export const detailsArrived = StateEffect.define<null>();

const STAGE_WORDS = { todo: 'To do', doing: 'In progress', done: 'Done' } as const;

/** What the pill shows for an entry, as one string, so a widget is redrawn only when that changes. */
function faceKey(entry: MarkEntry | null): string {
  if (!entry) return '';
  if (entry.state !== 'ready') return entry.state;
  const { status, brief, gone, title } = entry.details;
  return [status?.stage, status?.label, brief.join('·'), gone ? 'gone' : '', title].join('|');
}

class ItemMark extends WidgetType {
  readonly face: string;

  constructor(
    readonly name: string,
    readonly url: string,
    readonly entry: MarkEntry | null,
  ) {
    super();
    this.face = faceKey(entry);
  }

  eq(other: ItemMark): boolean {
    return other.name === this.name && other.url === this.url && other.face === this.face;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-itemMark';
    const part = (className: string, text?: string) => {
      const piece = document.createElement('span');
      piece.className = className;
      if (text !== undefined) piece.textContent = text;
      span.append(piece);
      return piece;
    };
    part('cm-itemMark-name', this.name.charAt(0).toUpperCase() + this.name.slice(1));
    const entry = this.entry;
    span.title = this.url;
    if (entry?.state === 'ready') {
      const { status, brief, gone, title } = entry.details;
      span.title = title;
      if (gone) {
        span.dataset.gone = '';
        part('cm-itemMark-status', 'In trash');
      } else if (status) {
        span.dataset.stage = status.stage;
        part('cm-itemMark-stage').setAttribute('aria-hidden', 'true');
        part('cm-itemMark-status', status.label || STAGE_WORDS[status.stage]);
      }
      if (!gone) {
        for (const fact of brief) {
          const piece = part('cm-itemMark-fact', fact);
          if (fact.startsWith('Overdue')) piece.dataset.late = '';
        }
      }
      span.setAttribute('aria-label', [this.name, gone ? 'in trash' : status?.label, ...brief].filter(Boolean).join(', '));
    } else if (entry?.state === 'failed') {
      span.dataset.failed = '';
      span.title = entry.message;
    }
    return span;
  }

  /** A tap lands the caret here, which writes the mark out in full for editing. */
  ignoreEvent(): boolean {
    return false;
  }
}

/** Where the row under the item carries the mark, the mark itself draws nothing. */
class HiddenMark extends WidgetType {
  eq(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-itemMarkHidden';
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

class ShortLink extends WidgetType {
  constructor(readonly url: string) {
    super();
  }

  eq(other: ShortLink): boolean {
    return other.url === this.url;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-shortLink';
    span.textContent = shortUrl(this.url);
    span.title = this.url;
    return span;
  }

  /** A tap lands the caret here, which writes the address out in full for editing. */
  ignoreEvent(): boolean {
    return false;
  }
}

/** The lines the selection touches: their links are shown whole. */
function activeLines(view: EditorView): Set<number> {
  const lines = new Set<number>();
  for (const range of view.state.selection.ranges) {
    const first = view.state.doc.lineAt(range.from).number;
    const last = view.state.doc.lineAt(range.to).number;
    for (let n = first; n <= last; n += 1) lines.add(n);
  }
  return lines;
}

const LINK = /\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g;

/** Every linked thing in view, marks and links a plugin reads, for reading their details again. */
function marksInView(view: EditorView): { name: string; url: string }[] {
  const marks: { name: string; url: string }[] = [];
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos);
      const mark = itemWords(line.text) !== null ? markOf(line.text) : null;
      if (mark) marks.push(mark);
      else if (line.text.includes('](')) {
        for (const match of line.text.matchAll(LINK)) {
          const name = markNameFor(match[1] ?? '');
          if (name) marks.push({ name, url: match[1] ?? '' });
        }
      }
      pos = line.to + 1;
    }
  }
  return [...marks, ...marksOnBoards(view)];
}

/**
 * The marks of the open to-dos on every board on screen.
 *
 * A board is drawn as one block in place of its fence (editor/boards.ts), so its lines are not among `visibleRanges`,
 * and its cards are items written further down the note, usually well out of view. Read only by their own lines, a
 * board being looked at never learned its tasks were done, so it never moved them (Matt: "a lot of the notion tickets
 * aren't moved to done"): his board had four cards in To do whose tasks were all Done in Notion, their items sixty
 * lines below it, and not one was read until they were scrolled to - then all four ticked and went to Done at once.
 *
 * Only the cards not ticked yet: what a board shows of a task is whether it is done, and those are the cards that can
 * move. The rest are read as ever when their own lines are in view. His board holds 66 cards, and reading every one
 * each minute the note is open would spend a third of what Notion allows Glyph, for four that could change.
 */
function marksOnBoards(view: EditorView): { name: string; url: string }[] {
  const { doc } = view.state;
  const { viewport } = view;
  const text = doc.toString();
  const shown = boardsIn(text).filter((board) => doc.line(board.from).from <= viewport.to && doc.line(board.to).to >= viewport.from);
  if (!shown.length) return [];
  const open = new Map(itemsIn(text).filter((item) => item.done === false).map((item) => [item.id, item.line]));
  const marks: { name: string; url: string }[] = [];
  for (const board of shown) {
    for (const column of board.columns) {
      for (const id of column.cards) {
        const number = open.get(id);
        const line = number === undefined ? null : doc.line(number).text;
        const mark = line !== null && itemWords(line) !== null ? markOf(line) : null;
        if (mark) marks.push(mark);
      }
    }
  }
  return marks;
}

/** Whether what follows a link is nothing, or only a board's anchor (core/boards.ts): the link is then the item's mark. */
function lastOnLine(after: string): boolean {
  return AFTER_MARK.test(after);
}

/** What may follow an item's mark: nothing, or a board's anchor and counters (core/itemLinks.ts `ITEM_TAIL`). */
const AFTER_MARK = new RegExp(String.raw`^(?:\s+(?:${ITEM_TAIL}))*\s*$`);

function decorate(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const editable = view.state.facet(EditorView.editable);
  const active = editable && view.hasFocus ? activeLines(view) : new Set<number>();
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name === 'Link') {
          // A mark: the link is the last thing on an item's line and its words are one name.
          const text = view.state.sliceDoc(node.from, node.to);
          const mark = markOf(text);
          const line = view.state.doc.lineAt(node.from);
          if (mark && text === `[${mark.name}](${mark.url})` && lastOnLine(line.text.slice(node.to - line.from)) && itemWords(line.text) !== null) {
            if (!active.has(line.number)) {
              const widget = hasMarkDetails(mark.name) ? new HiddenMark() : new ItemMark(mark.name, mark.url, peekMarkDetails(mark.name, mark.url));
              builder.add(node.from, node.to, Decoration.replace({ widget }));
            }
            return false;
          }
          return;
        }
        if (node.name !== 'URL') return;
        const url = view.state.sliceDoc(node.from, node.to);
        if (shortUrl(url).length >= url.length - 1) return;
        if (active.has(view.state.doc.lineAt(node.from).number)) return;
        builder.add(node.from, node.to, Decoration.replace({ widget: new ShortLink(url) }));
      },
    });
  }
  return builder.finish();
}

/** How often an open note reads its tasks again, while it is on screen. */
const REREAD_MS = 60_000;

/** `still`: the marks are drawn from what is already known and never read again - a note drawn small on a card. */
function shortLinksPlugin(still: boolean) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      private readonly off: () => void;
      private readonly timer: number | null;
      private queued = false;

      constructor(readonly view: EditorView) {
        this.decorations = decorate(view);
        this.off = onMarkDetails(() => this.redraw());
        if (still) {
          this.timer = null;
          return;
        }
        this.timer = window.setInterval(() => this.want(false), REREAD_MS);
        document.addEventListener('visibilitychange', this.onVisible);
        this.want(false);
      }

      private readonly onVisible = () => {
        if (document.visibilityState === 'visible') this.want(false);
      };

      /** Asks for the details of the marks in view: read again if old, or now. */
      private want(fresh: boolean) {
        if (document.visibilityState === 'hidden') return;
        for (const mark of marksInView(this.view)) wantMarkDetails(mark.name, mark.url, fresh);
      }

      /** Answers arrive outside an update; the redraw is its own transaction, once per frame. */
      private redraw() {
        if (this.queued) return;
        this.queued = true;
        window.requestAnimationFrame(() => {
          this.queued = false;
          if (this.view.dom.isConnected) this.view.dispatch({ effects: detailsArrived.of(null) });
        });
      }

      update(update: ViewUpdate) {
        // While an IME composes, the line's DOM must not be replaced (glyphLines.ts).
        if (update.view.composing) {
          if (update.docChanged) this.decorations = this.decorations.map(update.changes);
          return;
        }
        const arrived = update.transactions.some((tr) => tr.effects.some((effect) => effect.is(detailsArrived)));
        if (arrived || update.docChanged || update.viewportChanged || update.selectionSet || update.focusChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
          this.decorations = decorate(update.view);
        }
        // A mark just made or scrolled to is read; one already read recently is not.
        if (!still && (update.docChanged || update.viewportChanged)) this.want(false);
      }

      destroy() {
        this.off();
        if (this.timer !== null) window.clearInterval(this.timer);
        document.removeEventListener('visibilitychange', this.onVisible);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

const shortLinksTheme = EditorView.baseTheme({
  '.cm-shortLink': {
    color: 'var(--glacier-text-muted)',
    textDecoration: 'none',
    whiteSpace: 'nowrap',
  },
  /* The mark: a solid pill, the same size and place as the suggestion it grew from. */
  '.cm-itemMark': {
    display: 'inline-block',
    // An item line hangs its wrapped lines with a negative text-indent, which an
    // inline-block inherits and applies to its own first line: the pill shrank to
    // three pixels and its word spilled out to the left. Not here.
    textIndent: '0',
    marginInlineStart: '0.6em',
    padding: '0 0.6em',
    borderRadius: '999px',
    background: 'var(--app-ink, currentColor)',
    color: 'var(--app-paper, #fff)',
    fontSize: '0.68em',
    lineHeight: '1.7',
    verticalAlign: '0.15em',
    whiteSpace: 'nowrap',
    userSelect: 'none',
  },
  /* What the task is doing, after the name: a hairline, then the stage, the status, the facts. */
  '.cm-itemMark-status, .cm-itemMark-fact': {
    marginInlineStart: '0.45em',
  },
  '.cm-itemMark-stage': {
    display: 'inline-block',
    boxSizing: 'border-box',
    width: '0.8em',
    height: '0.8em',
    marginInlineStart: '0.55em',
    paddingInlineStart: '0',
    borderRadius: '50%',
    border: '0.12em solid currentColor',
    verticalAlign: '-0.08em',
  },
  '.cm-itemMark[data-stage="doing"] .cm-itemMark-stage': {
    background: 'linear-gradient(90deg, currentColor 50%, transparent 50%)',
  },
  '.cm-itemMark[data-stage="done"] .cm-itemMark-stage': {
    background: 'currentColor',
  },
  '.cm-itemMark-name': {
    opacity: '0.72',
  },
  '.cm-itemMark-fact': {
    opacity: '0.72',
  },
  '.cm-itemMark-fact::before': {
    content: '"·"',
    marginInlineEnd: '0.45em',
  },
  '.cm-itemMark-fact[data-late]': {
    opacity: '1',
    fontWeight: '600',
  },
  '.cm-itemMark[data-gone] .cm-itemMark-status': {
    textDecoration: 'line-through',
    textDecorationThickness: '0.08em',
  },
  '.cm-itemMark[data-failed] .cm-itemMark-name::after': {
    content: '" ?"',
  },
});

export { shortUrl };

/** Link addresses shown short, and item marks as pills, away from the caret's line. */
export function shortLinks({ still = false }: { still?: boolean } = {}): Extension {
  return [shortLinksPlugin(still), shortLinksTheme];
}
