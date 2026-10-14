import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { glyphMarkdown } from './language.ts';
import { smokeLetters, spoilerLineLetters } from './wispFormat.ts';
import { styledRanges } from './formatLooks.ts';
import type { InlineFormat } from '../plugins/types.ts';

const spoiler: InlineFormat = { name: 'Spoiler', delimiter: '||', look: { kind: 'wisp' } };
const shout: InlineFormat = { name: 'Shout', delimiter: '!!', look: { kind: 'style', css: 'text-transform: uppercase' } };
const names = new Map([['Spoiler', 2]]);

function state(doc: string, selection?: number) {
  return EditorState.create({ doc, extensions: [glyphMarkdown([spoiler, shout])], selection: selection === undefined ? undefined : { anchor: selection } });
}

const whole = (s: EditorState) => ({ from: 0, to: s.doc.length });

describe('words in smoke', () => {
  it('smokes every letter between the pipes, and neither the pipes nor the spaces', () => {
    const s = state('The key is ||under the stone|| by the door.');
    const letters = smokeLetters(s, names, whole(s), true);
    expect(letters.map((l) => s.doc.sliceString(l.from, l.to)).join('')).toBe('underthestone');
    expect(letters.every((l) => l.to - l.from === 1)).toBe(true);
  });

  it('clears the words while the caret is in them, and only then', () => {
    const inside = state('a ||secret|| here', 6);
    expect(smokeLetters(inside, names, whole(inside), true)).toHaveLength(0);
    // A view that can't be edited never clears.
    expect(smokeLetters(inside, names, whole(inside), false)).toHaveLength(6);
    const outside = state('a ||secret|| here', 0);
    expect(smokeLetters(outside, names, whole(outside), true)).toHaveLength(6);
  });

  it('keeps a letter of more than one code unit whole', () => {
    const s = state('||🙂 ok||');
    const letters = smokeLetters(s, names, whole(s), false);
    expect(letters.map((l) => s.doc.sliceString(l.from, l.to))).toEqual(['🙂', 'o', 'k']);
  });

  it('styles the words of a styled formatting, delimiters aside', () => {
    const s = state('say !!hello!! there');
    const looks = new Map([['Shout', { length: 2, css: 'text-transform: uppercase' }]]);
    expect(styledRanges(s, looks, whole(s)).map((r) => s.doc.sliceString(r.from, r.to))).toEqual(['hello']);
  });
});

describe('hidden lines', () => {
  it('smokes every letter after >| on a run of lines, and clears the run while the caret is in it', () => {
    const doc = 'Q\n>| the answer\n>|is 42\n> plain quote';
    const all = { from: 0, to: doc.length };
    const away = EditorState.create({ doc, selection: { anchor: 0 } });
    const letters = spoilerLineLetters(away, all, true);
    expect(letters.map((l) => doc.slice(l.from, l.to)).join('')).toBe('theansweris42');
    const inside = EditorState.create({ doc, selection: { anchor: doc.indexOf('42') } });
    expect(spoilerLineLetters(inside, all, true)).toEqual([]);
    expect(spoilerLineLetters(inside, all, false)).toHaveLength(13);
  });
});
