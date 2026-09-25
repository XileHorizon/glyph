import { RangeSetBuilder, type Text, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';

/**
 * Progress under a heading (Matt picked it from the list of new formats): a heading with to-dos under it says how
 * many are done, after its words.
 *
 *   ## Packing            3 of 7
 *   - [x] Tent
 *   - [ ] Stove
 *
 * Nothing is typed and nothing is written: the count is read from the boxes until the next heading of the same level
 * or higher, so a `##` counts its `###` sections too. When every box is ticked it says so. A heading with no to-dos
 * under it says nothing.
 */

const HEADING = /^ {0,3}(#{1,6})\s+\S/;
const BOX = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]/;
const FENCE = /^\s*(```|~~~)/;

export interface HeadingCount {
  /** The heading's line number. */
  line: number;
  done: number;
  total: number;
}

/** Every heading with to-dos under it, and their count. */
export function headingCounts(doc: Text): HeadingCount[] {
  const open: { line: number; level: number; done: number; total: number }[] = [];
  const counts: HeadingCount[] = [];
  let fence: string | null = null;
  const close = (level: number) => {
    while (open.length && open[open.length - 1]!.level >= level) {
      const heading = open.pop()!;
      if (heading.total) counts.push({ line: heading.line, done: heading.done, total: heading.total });
    }
  };
  for (let n = 1; n <= doc.lines; n += 1) {
    const text = doc.line(n).text;
    const marker = FENCE.exec(text)?.[1];
    if (marker) {
      fence = fence === null ? marker : fence === marker ? null : fence;
      continue;
    }
    if (fence) continue;
    const heading = HEADING.exec(text);
    if (heading) {
      const level = heading[1]!.length;
      close(level);
      open.push({ line: n, level, done: 0, total: 0 });
      continue;
    }
    const box = BOX.exec(text);
    if (box) {
      for (const h of open) {
        h.total += 1;
        if (box[1] !== ' ') h.done += 1;
      }
    }
  }
  close(0);
  return counts.sort((a, b) => a.line - b.line);
}

class CountWidget extends WidgetType {
  constructor(
    readonly done: number,
    readonly total: number,
  ) {
    super();
  }
  eq(other: CountWidget): boolean {
    return other.done === this.done && other.total === this.total;
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = this.done === this.total ? 'cm-headingCount cm-headingCountDone' : 'cm-headingCount';
    span.textContent = this.done === this.total ? `All ${this.total} done` : `${this.done} of ${this.total}`;
    span.setAttribute('aria-label', `${this.done} of ${this.total} done`);
    return span;
  }
}

function decorate(doc: Text): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const count of headingCounts(doc)) {
    const line = doc.line(count.line);
    builder.add(line.to, line.to, Decoration.widget({ widget: new CountWidget(count.done, count.total), side: 1 }));
  }
  return builder.finish();
}

const theme = EditorView.baseTheme({
  '.cm-headingCount': {
    marginInlineStart: '0.6em',
    verticalAlign: 'middle',
    fontSize: 'var(--glacier-font-size-sm, 0.8rem)',
    fontWeight: '500',
    letterSpacing: '0.02em',
    color: 'var(--app-ink-3, currentColor)',
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
    userSelect: 'none',
  },
});

export function headingProgress(): Extension {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = decorate(view.state.doc);
        }
        update(update: ViewUpdate) {
          if (update.docChanged) this.decorations = decorate(update.state.doc);
        }
      },
      { decorations: (value) => value.decorations },
    ),
    theme,
  ];
}
