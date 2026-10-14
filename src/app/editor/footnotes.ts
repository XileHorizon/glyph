import { RangeSetBuilder, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';

/**
 * Footnotes, as extended markdown writes them (docs/MARKDOWN.md):
 *
 *   The deposit is four hundred[^sam], not four fifty.
 *
 *   [^sam]: Sam said so on the phone, the email disagrees.
 *
 * Until now the parser read `[^sam]` as a link label, so a reference was drawn as a link that went nowhere - wrong
 * in a way that matters, because a link is a promise. A marker is now raised and quiet, the way a footnote is set in
 * print, and tapping it shows what the note says: on a phone the note itself is a long way down the page, and the
 * point of a footnote is not to have to go there.
 *
 * The definition line keeps its `[^sam]:` and is set quietly, since it is the small print at the foot of the note.
 * Nothing is hidden, and a marker with no definition is left plain - it is a typo, and drawing it as a footnote
 * would hide that.
 */

export interface Footnote {
  name: string;
  /** What the definition says, without its `[^name]:`. */
  text: string;
  /** Which line the definition is on, counting from 1. */
  line: number;
}

/** `[^name]` in the words of a note; the definition is the same at the start of its own line, with a colon. */
const MARKER = /\[\^([^\]\s]+)\]/g;
const DEFINITION = /^(\s{0,3}\[\^([^\]\s]+)\]:)(\s*)(.*)$/;

/** Every footnote the note defines, the first of a repeated name winning. */
export function footnotesIn(doc: string): Footnote[] {
  const found: Footnote[] = [];
  const seen = new Set<string>();
  doc.split('\n').forEach((line, index) => {
    const match = DEFINITION.exec(line);
    const name = match?.[2];
    if (!match || !name || seen.has(name)) return;
    seen.add(name);
    found.push({ name, text: (match[4] ?? '').trim(), line: index + 1 });
  });
  return found;
}

/** The footnote a position is inside, when that position is on one of its markers. */
export function noteAtPos(state: EditorState, notes: readonly Footnote[], pos: number): Footnote | null {
  const line = state.doc.lineAt(pos);
  if (DEFINITION.test(line.text)) return null;
  MARKER.lastIndex = 0;
  for (let match = MARKER.exec(line.text); match; match = MARKER.exec(line.text)) {
    const from = line.from + match.index;
    if (pos >= from && pos <= from + match[0].length) return notes.find((note) => note.name === match[1]) ?? null;
  }
  return null;
}

function decorate(state: EditorState): DecorationSet {
  const notes = footnotesIn(state.doc.toString());
  const marks: { from: number; to: number; deco: Decoration }[] = [];
  const defined = new Set(notes.map((note) => note.name));
  for (let n = 1; n <= state.doc.lines; n += 1) {
    const line = state.doc.line(n);
    const definition = DEFINITION.exec(line.text);
    if (definition) {
      marks.push({ from: line.from, to: line.from, deco: Decoration.line({ class: 'cm-footDefinition' }) });
      continue;
    }
    MARKER.lastIndex = 0;
    for (let match = MARKER.exec(line.text); match; match = MARKER.exec(line.text)) {
      // A marker with nothing to point at stays plain words: it is a mistake, and should look like one.
      if (!defined.has(match[1] ?? '')) continue;
      const from = line.from + match.index;
      marks.push({ from, to: from + match[0].length, deco: Decoration.mark({ class: 'cm-footMark', attributes: { title: 'Footnote' } }) });
    }
  }
  marks.sort((a, b) => a.from - b.from || (a.to === a.from ? -1 : 1) - (b.to === b.from ? -1 : 1));
  const builder = new RangeSetBuilder<Decoration>();
  for (const mark of marks) builder.add(mark.from, mark.to, mark.deco);
  return builder.finish();
}

function showFoot(view: EditorView, note: Footnote, at: number): void {
  closeFoot(view);
  const coords = view.coordsAtPos(at);
  if (!coords) return;
  const panel = document.createElement('div');
  panel.className = 'cm-footPanel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', `Footnote ${note.name}`);
  panel.textContent = note.text || `Nothing written under [^${note.name}] yet.`;
  const box = view.dom.getBoundingClientRect();
  panel.style.left = '0px';
  panel.style.top = `${coords.bottom - box.top + 6}px`;
  view.dom.appendChild(panel);
  const width = panel.getBoundingClientRect().width;
  panel.style.left = `${Math.max(8, Math.min(coords.left - box.left, box.width - width - 8))}px`;
}

function closeFoot(view: EditorView): void {
  view.dom.querySelector('.cm-footPanel')?.remove();
}

const theme = EditorView.baseTheme({
  // The marker, set the way print sets one: raised, small, and quieter than the words it belongs to.
  '.cm-footMark, .cm-footMark *': {
    verticalAlign: 'super',
    fontSize: '0.72em',
    textDecoration: 'none',
    color: 'var(--app-ink-3, var(--glacier-text-muted))',
    cursor: 'pointer',
  },
  // The small print at the foot of the note.
  '.cm-footDefinition, .cm-footDefinition *': { fontSize: '0.88em', color: 'var(--app-ink-3, var(--glacier-text-muted))', textDecoration: 'none' },
  '.cm-footPanel': {
    position: 'absolute',
    zIndex: '30',
    maxInlineSize: 'min(20rem, 76vw)',
    padding: '0.5em 0.7em',
    borderRadius: 'var(--glacier-radius-lg, 0.75rem)',
    background: 'var(--app-paper-2, var(--glacier-surface))',
    border: '1px solid var(--app-rule, var(--glacier-border-subtle))',
    boxShadow: '0 6px 20px rgb(0 0 0 / 0.18)',
    font: 'inherit',
    fontSize: '0.86em',
    lineHeight: '1.4',
  },
});

/** Footnotes: the marker raised, the definition quiet, and what it says on a tap. */
export function footnotes(): Extension {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        notes: Footnote[];

        constructor(view: EditorView) {
          this.decorations = decorate(view.state);
          this.notes = footnotesIn(view.state.doc.toString());
        }

        update(update: ViewUpdate) {
          if (!update.docChanged) return;
          this.decorations = decorate(update.state);
          this.notes = footnotesIn(update.state.doc.toString());
          closeFoot(update.view);
        }
      },
      {
        decorations: (value) => value.decorations,
        eventHandlers: {
          mousedown(event, view) {
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
            if (pos === null) return false;
            const note = noteAtPos(view.state, this.notes, pos);
            if (!note) {
              closeFoot(view);
              return false;
            }
            showFoot(view, note, pos);
            return false;
          },
        },
      },
    ),
    theme,
    EditorView.domEventHandlers({ scroll: (_event, view) => void closeFoot(view) }),
  ];
}
