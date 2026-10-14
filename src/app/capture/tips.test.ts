import { describe, expect, it } from 'vitest';
import { tips } from './tips.ts';

describe('tips in a pause', () => {
  it('teach the newer cues, and a note’s board lanes when it has a board', () => {
    const said = tips({ noteTitle: 'Groceries', continuing: true, lane: 'Doing' }).map((tip) => tip.say);
    expect(said).toContain('Info box');
    expect(said).toContain('Option');
    expect(said).toContain('Hey Ghost, add … to Doing');
    expect(said).toContain('Hey Ghost, move … to Doing');
    expect(tips({ noteTitle: null, continuing: false }).some((tip) => tip.say.includes('to Doing'))).toBe(false);
  });
});
