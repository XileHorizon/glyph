import { RangeSetBuilder, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet } from '@codemirror/view';
import { isDarkNow, onPreferences, preferences } from '../core/preferences.ts';

/**
 * Mermaid diagrams, drawn (Matt: "Add support for Mermaid charts").
 *
 * A ```mermaid fence is markdown like any other: the text is what is kept, what is edited, and what another app
 * sees. A fence the caret is not in is drawn as the diagram it describes, the way a table is drawn as a table
 * (editor/tables.ts) and a board as a board (editor/boards.ts). Tapping it puts the caret at the fence's first line
 * and the drawing steps aside; leaving it draws it again.
 *
 * **Mermaid itself is the library**, every diagram type it knows (Matt chose that over a smaller subset, knowing it
 * roughly doubles what the phone carries). It is loaded the first time a note actually has a diagram in it, so a
 * phone that never draws one never pays for it at startup; the chunks come down with the update, not from the
 * network, so a diagram drawn once is drawn for ever, offline and all.
 *
 * **A diagram that cannot be drawn stays as its own text** - the library missing (a browser with no network and a
 * half-fetched bundle), or the diagram written wrong - in the typewriter face, exactly as typed, with a quiet line
 * saying why. Nothing is ever lost, and nothing spins for ever.
 *
 * What it draws is cached by what it says and which way the app is painted, so scrolling past a diagram redraws
 * nothing; and a diagram's height is remembered between launches (`glyph-mermaid-heights`), so the editor knows how
 * tall a diagram is before it has drawn it and the note does not jump as one comes into view - the same lesson as
 * boards (docs/BOARDS.md).
 */

/** The fence that opens a diagram: ```mermaid, or ~~~mermaid, and nothing else on the line. */
const OPEN = /^\s*(`{3,}|~{3,})\s*mermaid\s*$/i;

export interface Diagram {
  /** The line the opening fence is on, counting from 1. */
  from: number;
  /** The line the closing fence is on; the same as `from` when the fence never closes. */
  to: number;
  /** What is between the fences: the diagram itself. */
  code: string;
}

/** Every mermaid fence in the note, in the order they appear. */
export function diagramsIn(doc: string): Diagram[] {
  const lines = doc.split('\n');
  const found: Diagram[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const open = OPEN.exec(lines[i] ?? '');
    if (!open) continue;
    const fence = open[1] ?? '```';
    const close = new RegExp(`^\\s*${fence[0] === '~' ? '~' : '`'}{${fence.length},}\\s*$`);
    let end = i;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (close.test(lines[j] ?? '')) {
        end = j;
        break;
      }
    }
    if (end > i) found.push({ from: i + 1, to: end + 1, code: lines.slice(i + 1, end).join('\n') });
    i = end;
  }
  return found;
}

/** Whether the app is painted dark right now, as the diagram has to be drawn to match. */
function darkNow(): boolean {
  return isDarkNow(preferences().theme);
}

/** What a drawn diagram is: its picture, or why there is none. */
type Drawing = { svg: string } | { failed: string };

/** Diagrams already drawn, by what they say and which way they are painted: scrolling past one redraws nothing. */
const drawn = new Map<string, Drawing>();
/** One request at a time: mermaid keeps its settings in one place, so two renders at once can steal each other's theme. */
let queue: Promise<unknown> = Promise.resolve();
/** The library, once. Null while it has never been asked for; the promise is kept so it is only ever fetched once. */
let loading: Promise<typeof import('mermaid')['default']> | null = null;

function library(): Promise<(typeof import('mermaid'))['default']> {
  loading ??= import('mermaid').then((module) => module.default);
  return loading;
}

/** A diagram drawn, or the reason it could not be: cached, and never two at once. */
export async function draw(code: string, dark: boolean): Promise<Drawing> {
  const key = `${dark ? 'dark' : 'light'}\n${code}`;
  const already = drawn.get(key);
  if (already) return already;
  const made = queue.then(() => render(code, dark));
  // The queue is only a place in line: one diagram's failure must not stop the ones behind it.
  queue = made.catch(() => undefined);
  const done = await made;
  drawn.set(key, done);
  return done;
}

async function render(code: string, dark: boolean): Promise<Drawing> {
  try {
    const mermaid = await library();
    mermaid.initialize({
      startOnLoad: false,
      // Labels are the note's own words, but a note can come from anywhere: no HTML out of a diagram, ever.
      securityLevel: 'strict',
      theme: dark ? 'dark' : 'default',
      fontFamily: 'inherit',
    });
    id += 1;
    const { svg } = await mermaid.render(`glyph-mermaid-${id}`, code);
    return { svg };
  } catch (failure) {
    const said = failure instanceof Error ? failure.message : String(failure);
    // The library itself missing is not the person's mistake, and is said differently.
    return { failed: /Failed to fetch|error loading|dynamically imported module/i.test(said) ? '' : said };
  }
}

let id = 0;

/**
 * How tall each diagram was drawn, by what it says: a diagram is drawn after the note is laid out, and without this
 * the editor would count an undrawn one as a single line and shift the note under a reading finger when it arrives.
 */
const HEIGHTS_KEY = 'glyph-mermaid-heights';
const HEIGHTS_KEPT = 200;
let heights: Map<string, number> | null = null;
let saving = 0;

function allHeights(): Map<string, number> {
  if (heights) return heights;
  heights = new Map();
  try {
    const value = JSON.parse(localStorage.getItem(HEIGHTS_KEY) ?? '[]') as unknown;
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'number') heights.set(entry[0], entry[1]);
      }
    }
  } catch {
    // No storage: diagrams are guessed at until they are drawn.
  }
  return heights;
}

function keepHeight(code: string, height: number): void {
  const all = allHeights();
  const key = codeKey(code);
  const px = Math.round(height);
  if (all.get(key) === px) return;
  all.delete(key);
  all.set(key, px);
  for (const old of all.keys()) {
    if (all.size <= HEIGHTS_KEPT) break;
    all.delete(old);
  }
  if (saving || typeof window === 'undefined') return;
  saving = window.setTimeout(() => {
    saving = 0;
    try {
      localStorage.setItem(HEIGHTS_KEY, JSON.stringify([...all]));
    } catch {
      // Remembered for as long as the app is open.
    }
  }, 500);
}

/** A short name for a diagram: its length and an FNV-1a hash, since the diagram itself can be long. */
function codeKey(code: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < code.length; i += 1) {
    hash ^= code.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${code.length.toString(36)}.${(hash >>> 0).toString(36)}`;
}

/** How tall a diagram is before it has been drawn: what it was last time, else a guess from how much it says. */
function guessHeight(code: string): number {
  const known = allHeights().get(codeKey(code));
  if (known) return known;
  // Lines of a diagram are steps, and a step is about a row of boxes; near enough to keep the note still.
  const lines = code.split('\n').filter((line) => line.trim()).length;
  return Math.round(Math.min(420, 80 + lines * 34));
}

class MermaidWidget extends WidgetType {
  constructor(
    readonly code: string,
    readonly from: number,
    readonly dark: boolean,
  ) {
    super();
  }

  eq(other: MermaidWidget): boolean {
    return other.code === this.code && other.from === this.from && other.dark === this.dark;
  }

  get estimatedHeight(): number {
    return guessHeight(this.code);
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-mermaid';
    wrap.setAttribute('role', 'img');
    wrap.setAttribute('aria-label', 'Diagram');
    // Until it is drawn - and if it never is - the diagram is its own text, which is the thing that was written.
    const text = document.createElement('pre');
    text.className = 'cm-mermaidText';
    text.textContent = this.code;
    wrap.append(text);

    void draw(this.code, this.dark).then((made) => {
      if (!wrap.isConnected) return;
      if ('svg' in made) {
        wrap.innerHTML = made.svg;
        wrap.dataset.drawn = '';
        // Measured once it is on the page, so the next launch knows how tall this diagram is before drawing it.
        view.requestMeasure({
          read: () => wrap.getBoundingClientRect().height,
          write: (height) => {
            if (height > 0) keepHeight(this.code, height);
          },
        });
        return;
      }
      const why = document.createElement('p');
      why.className = 'cm-mermaidWhy';
      why.textContent = made.failed ? `That diagram has a mistake: ${firstLine(made.failed)}` : 'This diagram could not be drawn here.';
      wrap.append(why);
    });

    wrap.addEventListener('mousedown', (event) => {
      if (!view.state.facet(EditorView.editable)) return;
      event.preventDefault();
      view.dispatch({ selection: { anchor: this.from } });
      view.focus();
    });
    return wrap;
  }

  ignoreEvent(event: Event): boolean {
    // A tap is ours, to open the fence for editing; anything else (a wide diagram scrolled sideways) is the picture's.
    return event.type !== 'mousedown';
  }
}

/** The first line of what mermaid said went wrong: the rest is the diagram drawn in letters, which no one needs here. */
function firstLine(said: string): string {
  return (said.split('\n')[0] ?? said).slice(0, 120);
}

const setFocus = StateEffect.define<boolean>();
/** The app painted the other way: every diagram on the page is drawn again, in the colours it is now read in. */
const setDark = StateEffect.define<boolean>();

const darkField = StateField.define<boolean>({
  create: () => darkNow(),
  update(dark, tr) {
    for (const effect of tr.effects) if (effect.is(setDark)) return effect.value;
    return dark;
  },
});

/**
 * Watches which way the app is painted: the theme setting, and the phone's own when the setting follows it. A drawn
 * diagram carries its colours inside its picture, so unlike everything else here it cannot follow a CSS variable - it
 * has to be drawn again.
 */
const darkWatch = ViewPlugin.fromClass(
  class {
    private readonly stop: (() => void)[] = [];

    constructor(readonly view: EditorView) {
      const look = () => {
        const dark = darkNow();
        if (dark !== view.state.field(darkField, false)) view.dispatch({ effects: setDark.of(dark) });
      };
      this.stop.push(onPreferences(look));
      if (typeof matchMedia === 'function') {
        const media = matchMedia('(prefers-color-scheme: dark)');
        media.addEventListener('change', look);
        this.stop.push(() => media.removeEventListener('change', look));
      }
    }

    destroy(): void {
      for (const stop of this.stop) stop();
    }
  },
);

const focusField = StateField.define<boolean>({
  create: () => false,
  update(focused, tr) {
    for (const effect of tr.effects) if (effect.is(setFocus)) return effect.value;
    return focused;
  },
});

function build(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const focused = state.field(focusField, false) ?? false;
  const editable = state.facet(EditorView.editable);
  const dark = state.field(darkField, false) ?? darkNow();
  for (const diagram of diagramsIn(state.doc.toString())) {
    const from = state.doc.line(diagram.from).from;
    const to = state.doc.line(diagram.to).to;
    // The caret in the fence: the lines themselves, to edit. Elsewhere, and in a view with no caret, the diagram.
    const inside = editable && focused && state.selection.ranges.some((range) => range.to >= from && range.from <= to);
    if (inside || !diagram.code.trim()) continue;
    builder.add(from, to, Decoration.replace({ widget: new MermaidWidget(diagram.code, from, dark), block: true }));
  }
  return builder.finish();
}

const mermaidField = StateField.define<DecorationSet>({
  create: build,
  update(decorations, tr) {
    const moved = tr.effects.some((effect) => effect.is(setFocus) || effect.is(setDark));
    if (tr.docChanged || tr.selection || moved || tr.reconfigured) return build(tr.state);
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const mermaidTheme = EditorView.baseTheme({
  '.cm-mermaid': {
    display: 'block',
    margin: '0',
    // A block widget is not a line, so it has no line's gutter: the same one, by hand (editor/tables.ts does this too).
    padding: '0.6em var(--app-gutter, 1rem)',
    overflowX: 'auto',
    textAlign: 'center',
    textIndent: '0',
    cursor: 'text',
  },
  // Drawn: the picture sits in the middle of the line, as wide as it needs and never wider than the note.
  '.cm-mermaid[data-drawn] svg': {
    maxInlineSize: '100%',
    blockSize: 'auto',
  },
  // Not drawn yet, or not drawable: the diagram as it was typed.
  '.cm-mermaidText': {
    margin: '0',
    textAlign: 'start',
    fontFamily: 'var(--glacier-font-mono, ui-monospace, monospace)',
    fontSize: '0.86em',
    lineHeight: 'var(--glacier-leading-md, 1.5)',
    whiteSpace: 'pre',
    overflowX: 'auto',
    color: 'var(--app-ink-2, currentColor)',
  },
  '.cm-mermaid[data-drawn] .cm-mermaidText': { display: 'none' },
  '.cm-mermaidWhy': {
    margin: '0.4em 0 0',
    textAlign: 'start',
    fontSize: '0.86em',
    color: 'var(--app-ink-3, currentColor)',
  },
});

export function drawnMermaid(): Extension {
  return [focusField, darkField, darkWatch, mermaidField, mermaidTheme, EditorView.focusChangeEffect.of((_state, focusing) => setFocus.of(focusing))];
}
