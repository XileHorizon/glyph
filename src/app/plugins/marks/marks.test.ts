import { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { describe, expect, it } from 'vitest';
import { glyphMarkdown } from '../../editor/language.ts';
import { styledRanges } from '../../editor/formatLooks.ts';
import { BUILT_IN } from '../registry.ts';
import { isMarkColour, MARK_COLOURS, MARKS, marksPlugin, washFor } from './index.tsx';

const formats = MARKS;

function nodes(doc: string): string[] {
  const state = EditorState.create({ doc, extensions: [glyphMarkdown(formats)] });
  const names: string[] = [];
  syntaxTree(state).iterate({ enter: (node) => void names.push(node.name) });
  return names;
}

describe("Ghost.md's own marks", () => {
  it('are one plugin, with one switch, each mark carrying its own icon', () => {
    expect(marksPlugin.manifest.id).toBe('marks');
    expect(marksPlugin.formats).toBe(MARKS);
    expect(marksPlugin.manifest.permissions).toEqual([]);
    for (const format of MARKS) expect(format.icon, format.name).toBeTruthy();
    expect(MARKS.map((format) => format.name)).toContain('Spoiler');
  });

  it('each parses between its own delimiter, with a cue and a line for the guide', () => {
    for (const format of formats) {
      const doc = `say ${format.delimiter}these words${format.delimiter} now`;
      expect(nodes(doc), format.name).toContain(format.name);
      expect(format.cue, format.name).toBeTruthy();
      expect(format.about, format.name).toBeTruthy();
    }
  });

  it('shares no delimiter or node name with any other plugin', () => {
    const all = BUILT_IN.flatMap((plugin) => plugin.formats ?? []);
    expect(new Set(all.map((f) => f.delimiter)).size).toBe(all.length);
    expect(new Set(all.map((f) => f.name)).size).toBe(all.length);
  });

  it('leaves prose alone: a question, a comparison, a list marker', () => {
    expect(nodes('Really?? Sure?? Not that ??')).not.toContain('Unsure');
    expect(nodes('x == y and a == b')).not.toContain('Highlight');
    expect(nodes('+ an item\n+ another')).toContain('ListItem');
    expect(nodes('+ an item\n+ another')).not.toContain('Added');
  });

  it('a mark whose look lifts at the caret keeps the rest lit', () => {
    // No mark lifts today (the redaction did, and is gone), so one is made up here to hold the behaviour still.
    const doc = 'name: ==Sam Ortiz== and ??keep??';
    const looks = new Map([
      ['Highlight', { length: 2, css: 'background: red', clearAtCaret: true }],
      ['Unsure', { length: 2, css: 'text-decoration: underline dotted' }],
    ]);
    const inside = EditorState.create({ doc, extensions: [glyphMarkdown(formats)], selection: { anchor: 10 } });
    const words = (state: EditorState, atCaret: boolean) =>
      styledRanges(state, looks, { from: 0, to: doc.length }, atCaret).map((r) => doc.slice(r.from, r.to));
    expect(words(inside, true)).toEqual(['keep']);
    expect(words(inside, false)).toEqual(['Sam Ortiz', 'keep']);
    const outside = EditorState.create({ doc, extensions: [glyphMarkdown(formats)], selection: { anchor: 0 } });
    expect(words(outside, true)).toEqual(['Sam Ortiz', 'keep']);
  });

  it('has no redaction any more: @@ is plain words (Matt: "remove redacted its the same as spoiler")', () => {
    expect(formats.map((format) => format.name)).not.toContain('Redact');
    expect(nodes('a @@bar@@ of ink')).not.toContain('Redact');
  });
});

describe('a highlight with a colour named after it', () => {
  const highlight = MARKS.find((mark) => mark.name === 'Highlight')!;

  it('takes the kit’s own colour names, and nothing else', () => {
    for (const name of MARK_COLOURS) expect(isMarkColour(name)).toBe(true);
    expect(isMarkColour('chartreuse')).toBe(false);
    // The wash names a token, never a colour: the kit can retune green without touching a note.
    expect(washFor('green')).toBe('color-mix(in oklch, var(--glacier-green-9) 34%, transparent)');
    expect(washFor('GREEN ')).toBe(washFor('green'));
    expect(washFor('chartreuse')).toBe('');
  });

  it('tints the words for a name it knows and leaves the rest to the note', () => {
    expect(highlight.tint?.('amber')).toContain('var(--glacier-amber-9)');
    expect(highlight.tint?.('amber')).toContain('box-shadow');
    // A name it does not know is not a colour: those brackets are still a note (editor/markNotes.ts).
    expect(highlight.tint?.('Sam said 400')).toBeNull();
    expect(highlight.tint?.('')).toBeNull();
  });

  it('is the only mark that takes one', () => {
    for (const mark of MARKS.filter((one) => one.name !== 'Highlight')) expect(mark.tint).toBeUndefined();
  });
});
