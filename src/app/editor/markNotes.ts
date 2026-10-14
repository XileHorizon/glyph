import { RangeSetBuilder, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import type { InlineFormat } from '../plugins/types.ts';

/**
 * A note on a mark, shown when the words are tapped (Matt: "add the ability to include tooltip text for the
 * ??unsure?? usage so when tapping on it we get a popup with the tooltip").
 *
 * The note is written the way a link's target is, in brackets straight after the mark:
 *
 *   The deposit is ??four hundred??(Sam said 400, the email says 450) and needs checking.
 *
 * Any of Glyph's marks can carry one, not only a doubt: a highlight can say why it is highlighted, a shout why it
 * shouts. The words keep the look the mark gives them (editor/formatLooks.ts); the bracketed part is hidden so the
 * line reads as a sentence, and tapping the words shows the note. The brackets come back as plain text while the
 * caret is in them, so the note is edited like anything else.
 *
 * Nothing is stored anywhere but the note itself: a reader with no Glyph sees `??four hundred??(…)`, which says the
 * same thing in the same order.
 */

export interface MarkNote {
  /** The whole thing, from the opening delimiter to the closing bracket. */
  from: number;
  to: number;
  /** The words the mark covers, delimiters aside: what a tap has to land on. */
  words: { from: number; to: number };
  /** The bracketed part, including its brackets. */
  brackets: { from: number; to: number };
  /** What the note says. */
  text: string;
  /** The mark it is written on, so a reader can ask that mark whether the name is a colour of its own. */
  delimiter: string;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The pattern for `<delimiter>words<delimiter>(a note)`, for the marks that are switched on. */
export function notePattern(formats: readonly InlineFormat[]): RegExp | null {
  const delimiters = [...new Set(formats.map((format) => format.delimiter))];
  if (!delimiters.length) return null;
  const any = delimiters.map(escape).join('|');
  return new RegExp(`(${any})(?=(\\S))((?:(?!\\1).)*?\\S)\\1\\(([^)\\n]+)\\)`, 'g');
}

/** Every noted mark in `text`, counting positions from `offset`. */
export function notesIn(text: string, pattern: RegExp, offset = 0): MarkNote[] {
  const found: MarkNote[] = [];
  pattern.lastIndex = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const whole = match[0];
    const delimiter = match[1] ?? '';
    const note = match[4] ?? '';
    const from = offset + match.index;
    const words = { from: from + delimiter.length, to: from + whole.length - note.length - 2 - delimiter.length };
    found.push({ from, to: from + whole.length, words, brackets: { from: words.to + delimiter.length, to: from + whole.length }, text: note, delimiter });
  }
  return found;
}

/** The note whose words `pos` is inside, if there is one. */
export function noteAt(notes: readonly MarkNote[], pos: number): MarkNote | null {
  return notes.find((note) => pos >= note.words.from && pos <= note.to) ?? null;
}

/**
 * Whether these brackets are a colour rather than a note: `==the key==(green)` names a wash, and the mark itself says
 * which names it knows (plugins/types.ts `InlineFormat.tint`). The brackets are hidden either way, so the line reads
 * as its words; only the tap differs, since there is nothing to say about a colour.
 */
export function isTint(note: MarkNote, formats: readonly InlineFormat[]): boolean {
  const format = formats.find((one) => one.delimiter === note.delimiter);
  return Boolean(format?.tint?.(note.text));
}

/**
 * The brackets, hidden. They were a small ring once, something to see and to tap; Matt asked for it gone ("remove
 * (?) icon from the end of ??text?? entries with notes"), so the mark's own look is the cue and the words are the
 * place to tap.
 */
const hidden = Decoration.replace({});

function decorate(state: EditorState, pattern: RegExp): { marks: DecorationSet; notes: MarkNote[] } {
  const builder = new RangeSetBuilder<Decoration>();
  const notes = notesIn(state.doc.toString(), pattern);
  for (const note of notes) {
    // The caret inside the brackets: the words are being written, so they stay words.
    const editing = state.selection.ranges.some((range) => range.to >= note.brackets.from && range.from <= note.brackets.to);
    if (editing) continue;
    builder.add(note.brackets.from, note.brackets.to, hidden);
  }
  return { marks: builder.finish(), notes };
}

/** The panel a tap opens: one at a time, over the words it belongs to. */
function showNote(view: EditorView, note: MarkNote): void {
  closeNote(view);
  const at = view.coordsAtPos(note.words.from);
  if (!at) return;
  const panel = document.createElement('div');
  panel.className = 'cm-markNotePanel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Note');
  panel.textContent = note.text;
  const box = view.dom.getBoundingClientRect();
  panel.style.left = '0px';
  panel.style.top = `${at.bottom - box.top + 6}px`;
  view.dom.appendChild(panel);
  // Measured once it is there: a panel as wide as its words would otherwise run off the edge it opened near.
  const width = panel.getBoundingClientRect().width;
  panel.style.left = `${Math.max(8, Math.min(at.left - box.left, box.width - width - 8))}px`;
}

function closeNote(view: EditorView): void {
  view.dom.querySelector('.cm-markNotePanel')?.remove();
}

const noteTheme = EditorView.baseTheme({
  '.cm-markNotePanel': {
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

/** Notes on marks: the brackets hidden after the words, and the panel a tap on them opens. */
export function markNotes(formats: readonly InlineFormat[]): Extension {
  const found = notePattern(formats);
  if (!found) return [];
  const pattern: RegExp = found;
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      notes: MarkNote[];

      constructor(view: EditorView) {
        const drawn = decorate(view.state, pattern);
        this.decorations = drawn.marks;
        this.notes = drawn.notes;
      }

      update(update: ViewUpdate) {
        if (!update.docChanged && !update.selectionSet) return;
        const drawn = decorate(update.state, pattern);
        this.decorations = drawn.marks;
        this.notes = drawn.notes;
        if (update.docChanged) closeNote(update.view);
      }
    },
    {
      decorations: (value) => value.decorations,
      eventHandlers: {
        mousedown(event, view) {
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (pos === null) return false;
          const note = noteAt(this.notes, pos);
          // A colour is not a note: there is nothing to show, and the tap is the editor's as usual.
          if (note && isTint(note, formats)) {
            closeNote(view);
            return false;
          }
          if (!note) {
            closeNote(view);
            return false;
          }
          // The panel opens; the caret still goes where the finger went, so the words can be edited straight after.
          showNote(view, note);
          return false;
        },
      },
    },
  );
  return [plugin, noteTheme, EditorView.domEventHandlers({ scroll: (_event, view) => void closeNote(view) })];
}
