import { EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { describe, expect, it } from 'vitest';
import { glyphMarkdown } from '../editor/language.ts';
import { BUILT_IN } from '../plugins/registry.ts';
import { imageNames } from './images.ts';
import { notePeek } from '../notes/peek.ts';
import { SAMPLE_TITLE, sampleNoteBody } from './sampleNote.ts';
import { noteTitle } from './store.ts';

/** The set of node names the editor's parser finds in `doc`, plugin formattings included. */
function found(doc: string): Set<string> {
  const state = EditorState.create({ doc, extensions: [glyphMarkdown(BUILT_IN.flatMap((plugin) => plugin.formats ?? []))] });
  const names = new Set<string>();
  // The whole note, however long the parse takes: the plain tree is only what the parser reached in its time slice,
  // and on a busy machine that stopped short of the table.
  ensureSyntaxTree(state, state.doc.length, 10_000)?.iterate({ enter: (node) => void names.add(node.name) });
  return names;
}

/** Everything the editor draws specially or highlights: each must be in the sample note. */
const EVERYTHING = [
  'ATXHeading1',
  'ATXHeading2',
  'ATXHeading3',
  'ATXHeading4',
  'ATXHeading5',
  'ATXHeading6',
  'StrongEmphasis',
  'Emphasis',
  'Strikethrough',
  'InlineCode',
  'Escape',
  'Spoiler',
  'Highlight',
  'Aside',
  'Unsure',
  'Shout',
  'Added',
  'BulletList',
  'OrderedList',
  'TaskMarker',
  'Blockquote',
  'Link',
  'URL',
  'Table',
  'FencedCode',
  'CodeInfo',
  'HorizontalRule',
  'Image',
];

describe('the sample note', () => {
  it('holds one of everything the editor knows, and parses as such', () => {
    const names = found(sampleNoteBody('a1b2c3.jpg'));
    for (const name of EVERYTHING) expect(names, name).toContain(name);
  });

  it('is titled, previews plainly, and names its picture', () => {
    const body = sampleNoteBody('a1b2c3.jpg');
    expect(noteTitle(body)).toBe(SAMPLE_TITLE);
    expect(notePeek(body)).toContainEqual({ kind: 'text', text: expect.stringMatching(/^A note is plain Markdown/) as unknown as string });
    expect(imageNames(body)).toEqual(['a1b2c3.jpg']);
  });

  it('says nothing of a picture where none could be drawn', () => {
    const body = sampleNoteBody(null);
    expect(imageNames(body)).toEqual([]);
    expect(body).not.toContain('picture');
    expect(found(body)).not.toContain('Image');
  });
});
