import { Text } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { headingCounts } from './headingProgress.ts';

const doc = (text: string) => Text.of(text.split('\n'));

describe('progress under a heading', () => {
  it('counts the to-dos until the next heading of the same level, a section counting its subsections', () => {
    const note = doc(['# Trip', '## Packing', '- [x] Tent', '- [ ] Stove', '### Food', '- [X] Oats', '## Plan', '- Just a bullet', '## Chores', '1. [ ] Bins'].join('\n'));
    expect(headingCounts(note)).toEqual([
      { line: 1, done: 2, total: 4 },
      { line: 2, done: 2, total: 3 },
      { line: 5, done: 1, total: 1 },
      { line: 9, done: 0, total: 1 },
    ]);
  });

  it('ignores boxes and headings inside code', () => {
    const note = doc(['## Code', '```', '# not a heading', '- [ ] not a to-do', '```', '- [ ] real'].join('\n'));
    expect(headingCounts(note)).toEqual([{ line: 1, done: 0, total: 1 }]);
  });
});
