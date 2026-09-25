import { describe, expect, it } from 'vitest';
import { MARKS } from '../plugins/marks/index.tsx';
import type { InlineFormat } from '../plugins/types.ts';
import { isTint, noteAt, notePattern, notesIn } from './markNotes.ts';

const pattern = () => notePattern(MARKS)!;

describe('a note written after a mark', () => {
  it('finds the words, the brackets and what the note says', () => {
    const line = 'The deposit is ??four hundred??(Sam said 400, the email says 450) and needs checking.';
    const [note] = notesIn(line, pattern());
    expect(note).toBeTruthy();
    expect(line.slice(note!.words.from, note!.words.to)).toBe('four hundred');
    expect(line.slice(note!.brackets.from, note!.brackets.to)).toBe('(Sam said 400, the email says 450)');
    expect(note!.text).toBe('Sam said 400, the email says 450');
  });

  it('works for every mark, not only a doubt', () => {
    const found = notesIn('==this==(why it matters) and ^^that^^(said twice) and ++new++(added Friday)', pattern());
    expect(found.map((note) => note.text)).toEqual(['why it matters', 'said twice', 'added Friday']);
  });

  it('leaves a mark with no brackets, and brackets with no mark, alone', () => {
    expect(notesIn('??just a doubt?? and (a plain aside)', pattern())).toEqual([]);
    expect(notesIn('nothing here at all', pattern())).toEqual([]);
  });

  it('counts positions from where the text starts in the note', () => {
    const [note] = notesIn('??x??(y)', pattern(), 100);
    expect(note?.from).toBe(100);
    expect(note?.words.from).toBe(102);
  });

  it('answers which note a tap landed in: its words or its hidden brackets, not the words before them', () => {
    const line = 'Ask ??Sam??(before Friday) today';
    const notes = notesIn(line, pattern());
    expect(noteAt(notes, line.indexOf('Sam') + 1)?.text).toBe('before Friday');
    expect(noteAt(notes, line.indexOf('(before') + 2)?.text).toBe('before Friday');
    expect(noteAt(notes, 1)).toBeNull();
    expect(noteAt(notes, line.length - 1)).toBeNull();
  });

  it('takes the shorter of two marks on a line rather than running them together', () => {
    const found = notesIn('??one??(first) then ??two??(second)', pattern());
    expect(found.map((note) => note.text)).toEqual(['first', 'second']);
  });

  it('has no pattern at all when every mark is switched off', () => {
    expect(notePattern([])).toBeNull();
  });
});

describe('brackets that name a colour', () => {
  const tinted: InlineFormat[] = [
    { name: 'Highlight', delimiter: '==', look: { kind: 'style', css: '' }, tint: (name) => (name === 'green' ? 'background: green;' : null) },
    { name: 'Unsure', delimiter: '??', look: { kind: 'style', css: '' } },
  ];

  it('are a colour on the mark that takes one, and a note anywhere else', () => {
    const pattern = notePattern(tinted)!;
    const [colour] = notesIn('the ==key==(green) is under the mat', pattern);
    expect(colour?.delimiter).toBe('==');
    expect(isTint(colour!, tinted)).toBe(true);
    // The same word on a mark that takes no colours is what it always was: a note.
    const [note] = notesIn('the ??key??(green) is under the mat', pattern);
    expect(isTint(note!, tinted)).toBe(false);
  });

  it('are still a note when the name is not one the mark knows', () => {
    const pattern = notePattern(tinted)!;
    const [note] = notesIn('the ==key==(Sam has one) is under the mat', pattern);
    expect(note?.text).toBe('Sam has one');
    expect(isTint(note!, tinted)).toBe(false);
  });
});
