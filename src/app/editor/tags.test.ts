import { describe, expect, it } from 'vitest';
import { tagsIn } from './tags.ts';

const names = (text: string) => tagsIn(text).map((tag) => text.slice(tag.from, tag.to));

describe('tags', () => {
  it('finds a # against a letter, after the start, a space or a bracket', () => {
    expect(names('- [ ] Ship it #web #Launch-2 (#later)')).toEqual(['#web', '#Launch-2', '#later']);
    expect(names('#inbox first')).toEqual(['#inbox']);
    expect(names('#work/clients and #café')).toEqual(['#work/clients', '#café']);
    expect(tagsIn('#Web')[0]?.name).toBe('web');
  });

  it('leaves headings, numbers, words and links alone, and trims a trailing dash or slash', () => {
    expect(names('# Weekend trip')).toEqual([]);
    expect(names('## The budget')).toEqual([]);
    expect(names('issue #42 and C#sharp')).toEqual([]);
    expect(names('see https://example.com/#section')).toEqual([]);
    expect(names('- [ ] Ship it #web [notion](https://notion.so/a#b) ^ship')).toEqual(['#web']);
    expect(names('tagged #todo- and #a/')).toEqual(['#todo', '#a']);
  });

  it('counts positions from the line it was given', () => {
    expect(tagsIn('a #b', 10)).toEqual([{ from: 12, to: 14, name: 'b' }]);
  });
});
