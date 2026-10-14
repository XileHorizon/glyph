import { EditorSelection, StateEffect, StateField, type EditorState, type Extension, type Text } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';

/**
 * Find and replace in a note (Matt: "I'd like to be able to use tools like find and replace"): the matches, which one
 * is current, and the edits. The bar that drives it is editor/FindBar.tsx, opened from the note's settings sheet or
 * from a selection's press-and-hold menu.
 *
 * Plain text, case forgiven: the words are a note's, not code, and a person looking for "friday" means "Friday" too.
 * Every match is marked in the note, the current one printed in reverse like a selection; replacing all is one
 * change, so one undo takes it back.
 */

export interface Match {
  from: number;
  to: number;
}

interface FindState {
  query: string;
  matches: readonly Match[];
  /** The current match's index, or -1 when there is none. */
  current: number;
}

const EMPTY: FindState = { query: '', matches: [], current: -1 };

/** Sets what is searched for; `near` picks the first match at or after that position as current. */
export const setFind = StateEffect.define<{ query: string; near?: number }>();
/** Makes match `index` current. */
const pick = StateEffect.define<number>();

/** Every place `query` is in `doc`, case forgiven, never overlapping. */
export function matchesIn(doc: Text | string, query: string): Match[] {
  if (!query) return [];
  const text = (typeof doc === 'string' ? doc : doc.toString()).toLowerCase();
  const needle = query.toLowerCase();
  const out: Match[] = [];
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) out.push({ from: at, to: at + needle.length });
  return out;
}

function nearest(matches: readonly Match[], pos: number): number {
  if (!matches.length) return -1;
  const index = matches.findIndex((m) => m.to > pos);
  return index >= 0 ? index : 0;
}

export const findState = StateField.define<FindState>({
  create: () => EMPTY,
  update(value, tr) {
    let next = value;
    for (const effect of tr.effects) {
      if (effect.is(setFind)) {
        const matches = matchesIn(tr.state.doc, effect.value.query);
        next = { query: effect.value.query, matches, current: nearest(matches, effect.value.near ?? 0) };
      } else if (effect.is(pick)) {
        next = { ...next, current: next.matches.length ? ((effect.value % next.matches.length) + next.matches.length) % next.matches.length : -1 };
      }
    }
    if (tr.docChanged && next.query && next === value) {
      // The words changed under the search: found again, current kept as near where it was.
      const was = next.matches[next.current];
      const matches = matchesIn(tr.state.doc, next.query);
      next = { ...next, matches, current: nearest(matches, was ? tr.changes.mapPos(was.from) : 0) };
    }
    return next;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (value): DecorationSet => {
      if (!value.matches.length) return Decoration.none;
      return Decoration.set(value.matches.map((m, i) => Decoration.mark({ class: i === value.current ? 'cm-findCurrent' : 'cm-findMatch' }).range(m.from, m.to)));
    }),
});

const findTheme = EditorView.baseTheme({
  '.cm-findMatch': { backgroundColor: 'color-mix(in srgb, var(--glacier-text) 22%, transparent)', borderRadius: '2px' },
  // The words inside carry their own colours (a list item, a link), so the reverse is set on them too.
  '.cm-findCurrent, .cm-findCurrent *': { backgroundColor: 'var(--glacier-text)', color: 'var(--glacier-bg) !important' },
  '.cm-findCurrent': { borderRadius: '2px' },
});

export function findExtension(): Extension {
  return [findState, findTheme];
}

export function findOf(state: EditorState): FindState {
  return state.field(findState, false) ?? EMPTY;
}

/** Searches for `query`, current at or after the caret, and brings it into view. */
export function search(view: EditorView, query: string): void {
  view.dispatch({ effects: setFind.of({ query, near: view.state.selection.main.from }) });
  reveal(view);
}

/** The next match (or the previous, with `step` -1), wrapping round, brought into view. */
export function step(view: EditorView, by: 1 | -1): void {
  const { current, matches } = findOf(view.state);
  if (!matches.length) return;
  view.dispatch({ effects: pick.of(current + by) });
  reveal(view);
}

function reveal(view: EditorView): void {
  const { current, matches } = findOf(view.state);
  const match = matches[current];
  if (match) view.dispatch({ effects: EditorView.scrollIntoView(match.from, { y: 'center' }) });
}

/** Replaces the current match and moves on to the next. */
export function replaceOne(view: EditorView, replacement: string): void {
  const { current, matches, query } = findOf(view.state);
  const match = matches[current];
  if (!match) return;
  const after = match.from + replacement.length;
  view.dispatch({ changes: { from: match.from, to: match.to, insert: replacement }, userEvent: 'input.replace' });
  view.dispatch({ effects: setFind.of({ query, near: after }) });
  reveal(view);
}

/** Replaces every match in one change, so one undo takes it all back. Answers how many were replaced. */
export function replaceAll(view: EditorView, replacement: string): number {
  const { matches } = findOf(view.state);
  if (!matches.length) return 0;
  view.dispatch({ changes: matches.map((m) => ({ from: m.from, to: m.to, insert: replacement })), userEvent: 'input.replace.all' });
  return matches.length;
}

/** Ends the search: no marks, and the caret on what was current, so the note picks up where the search left it. */
export function endSearch(view: EditorView): void {
  const { current, matches } = findOf(view.state);
  const match = matches[current];
  view.dispatch({ effects: setFind.of({ query: '' }), ...(match ? { selection: EditorSelection.single(match.from, match.to) } : {}) });
}
