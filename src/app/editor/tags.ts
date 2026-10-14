import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';

/**
 * Tags on list items, and anywhere else in a line (Matt: "add ability to make tags on list items"):
 *
 *   - [ ] Ship the pricing page #web #launch
 *
 * Written the way Obsidian and Bear write them, so a note reads the same elsewhere: a `#` straight against a letter,
 * then letters, digits, `_`, `-` or `/` (for `#work/clients`). A `#` with a space after it is a heading, a `#` inside
 * a word or a link is part of that, and nothing inside code is a tag. Drawn as a small quiet chip, the `#` kept.
 *
 * On a linked item, tags go with the words, before the mark and the anchor: `- [ ] Ship it #web [notion](…) ^ship`.
 */

/** A tag: after the line's start or a space or an opening bracket, `#`, a letter, then the rest of the name. */
const TAG = /(^|[\s([{])(#[\p{L}][\p{L}\p{N}_/-]*)/gu;

export interface Tag {
  /** The `#` and the name. */
  from: number;
  to: number;
  /** The name without the `#`, lower-cased: how two tags are compared. */
  name: string;
}

/** Every tag in `text`, counting positions from `offset`. A trailing `-` or `/` is punctuation, not the name. */
export function tagsIn(text: string, offset = 0): Tag[] {
  const found: Tag[] = [];
  TAG.lastIndex = 0;
  for (let match = TAG.exec(text); match; match = TAG.exec(text)) {
    const written = (match[2] ?? '').replace(/[-/]+$/, '');
    const from = offset + match.index + (match[1] ?? '').length;
    found.push({ from, to: from + written.length, name: written.slice(1).toLowerCase() });
  }
  return found;
}

/** Nodes whose text is never a tag. */
const QUIET = /Code|URL|FrontMatter|HTML|Comment|Math/;

function inQuiet(state: EditorState, pos: number): boolean {
  for (let node: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (QUIET.test(node.name)) return true;
  }
  return false;
}

const chip = Decoration.mark({ class: 'cm-tag' });

function decorate(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { state } = view;
  for (const { from, to } of view.visibleRanges) {
    let line = state.doc.lineAt(from);
    for (;;) {
      for (const tag of tagsIn(line.text, line.from)) {
        if (!inQuiet(state, tag.from)) builder.add(tag.from, tag.to, chip);
      }
      if (line.to >= to || line.number >= state.doc.lines) break;
      line = state.doc.line(line.number + 1);
    }
  }
  return builder.finish();
}

const theme = EditorView.baseTheme({
  '.cm-tag': {
    padding: '0 0.3em',
    borderRadius: '0.35em',
    background: 'color-mix(in srgb, currentColor 9%, transparent)',
    color: 'var(--app-ink-2, inherit)',
    fontSize: '0.92em',
    whiteSpace: 'nowrap',
  },
});

export function tags(): Extension {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = decorate(view);
        }
        update(update: ViewUpdate) {
          if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) this.decorations = decorate(update.view);
        }
      },
      { decorations: (plugin) => plugin.decorations },
    ),
    theme,
  ];
}
