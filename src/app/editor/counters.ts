import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { fireNativeHaptic } from '../core/haptics.ts';

/**
 * Counters (Matt picked them from the list of new formats): a count and a goal in brackets, anywhere in a line.
 *
 *   - Water [3/8]
 *   - Push-ups [0/50]
 *
 * Drawn as a small chip that fills as the count rises. A tap adds one, a hold takes one away; the count never goes
 * below nothing, and a full counter tapped again stays full. Every change is an ordinary edit, one undo each, so the
 * note is still the whole truth and reads the same anywhere: `[3/8]`.
 */

/** `[3/8]`: not a link's words (`[3/8](…)`), a picture's, or a footnote. */
const COUNTER = /(?<![!\]\w])\[(\d{1,4})\/(\d{1,4})\](?!\()/g;

export interface Counter {
  from: number;
  to: number;
  count: number;
  goal: number;
}

export function countersIn(text: string, offset = 0): Counter[] {
  const found: Counter[] = [];
  COUNTER.lastIndex = 0;
  for (let match = COUNTER.exec(text); match; match = COUNTER.exec(text)) {
    const goal = Number(match[2]);
    if (goal < 1) continue;
    found.push({ from: offset + match.index, to: offset + match.index + match[0].length, count: Number(match[1]), goal });
  }
  return found;
}

/** The counter moved by `step`, kept between nothing and its goal. */
export function stepped(counter: Counter, step: number): string {
  const count = Math.max(0, Math.min(counter.goal, counter.count + step));
  return `[${count}/${counter.goal}]`;
}

const QUIET = /Code|URL|FrontMatter|HTML|Comment|Math/;

function quiet(state: EditorState, pos: number): boolean {
  for (let node: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (QUIET.test(node.name)) return true;
  }
  return false;
}

function visibleCounters(view: EditorView): Counter[] {
  const out: Counter[] = [];
  const { state } = view;
  for (const { from, to } of view.visibleRanges) {
    let line = state.doc.lineAt(from);
    for (;;) {
      for (const counter of countersIn(line.text, line.from)) if (!quiet(state, counter.from)) out.push(counter);
      if (line.to >= to || line.number >= state.doc.lines) break;
      line = state.doc.line(line.number + 1);
    }
  }
  return out;
}

function decorate(counters: readonly Counter[]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const counter of counters) {
    const fill = Math.round((Math.min(counter.count, counter.goal) / counter.goal) * 100);
    builder.add(
      counter.from,
      counter.to,
      Decoration.mark({
        class: counter.count >= counter.goal ? 'cm-counter cm-counterFull' : 'cm-counter',
        attributes: { style: `--fill:${fill}%`, 'data-counter': `${counter.from}` },
      }),
    );
  }
  return builder.finish();
}

/** How long a press has to last to take one away, ms: about the phone's own long press. */
const HOLD_MS = 450;

const theme = EditorView.baseTheme({
  '.cm-counter': {
    padding: '0 0.3em',
    borderRadius: '0.4em',
    border: '1px solid color-mix(in srgb, currentColor 35%, transparent)',
    backgroundImage: 'linear-gradient(to right, color-mix(in srgb, currentColor 16%, transparent) var(--fill), transparent var(--fill))',
    fontVariantNumeric: 'tabular-nums',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitTouchCallout: 'none',
  },
  // Markdown reads `[3/8]` as a link's words; the chip is not a link.
  '.cm-counter *': {
    textDecoration: 'none',
    color: 'inherit',
  },
  '.cm-counterFull': {
    borderColor: 'currentColor',
  },
});

export function counters(): Extension {
  let press: { from: number; at: number; timer: number; held: boolean } | null = null;

  const change = (view: EditorView, from: number, step: number) => {
    const line = view.state.doc.lineAt(from);
    const counter = countersIn(line.text, line.from).find((c) => c.from === from);
    if (!counter) return;
    const insert = stepped(counter, step);
    if (insert === view.state.sliceDoc(counter.from, counter.to)) return;
    view.dispatch({ changes: { from: counter.from, to: counter.to, insert }, userEvent: 'input.counter' });
    fireNativeHaptic(step > 0 ? 'selection' : 'light');
  };

  const chipAt = (view: EditorView, target: EventTarget | null): number | null => {
    if (view.state.readOnly) return null;
    const chip = (target as HTMLElement | null)?.closest?.('.cm-counter');
    if (!chip || !view.contentDOM.contains(chip)) return null;
    const from = Number((chip as HTMLElement).dataset.counter);
    return Number.isFinite(from) ? from : null;
  };

  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = decorate(visibleCounters(view));
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
          this.decorations = decorate(visibleCounters(update.view));
        }
      }
    },
    { decorations: (value) => value.decorations },
  );

  return [
    plugin,
    theme,
    EditorView.domEventHandlers({
      pointerdown(event, view) {
        const from = chipAt(view, event.target);
        if (from === null || !event.isPrimary || event.button > 0) return false;
        if (press) window.clearTimeout(press.timer);
        const timer = window.setTimeout(() => {
          if (!press) return;
          press.held = true;
          change(view, press.from, -1);
        }, HOLD_MS);
        press = { from, at: Date.now(), timer, held: false };
        return false;
      },
      pointerup(_event, view) {
        if (!press) return false;
        window.clearTimeout(press.timer);
        const { from, held } = press;
        press = null;
        if (!held) change(view, from, 1);
        return false;
      },
      pointercancel() {
        if (press) window.clearTimeout(press.timer);
        press = null;
        return false;
      },
      // The chip is a control: the caret stays where it was, and a hold is a counter's, not the menu's or the phone's.
      mousedown(event, view) {
        if (chipAt(view, event.target) === null) return false;
        event.preventDefault();
        return true;
      },
      contextmenu(event, view) {
        if (chipAt(view, event.target) === null) return false;
        event.preventDefault();
        event.stopImmediatePropagation();
        return true;
      },
    }),
  ];
}
