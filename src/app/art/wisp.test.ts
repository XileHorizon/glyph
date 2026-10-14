import { describe, expect, it } from 'vitest';
import { arrivals, cadence, departures, diffWords, planSwap, runLength, tokenize } from './wisp.ts';

const steady = cadence(10, () => 0.5); // 100 ms a letter, no jitter

describe('words from smoke: the plan', () => {
  it('splits a text into words and the gaps between them, and the join is the text', () => {
    const text = 'Hold.\nTalk.  Done.';
    const tokens = tokenize(text);
    expect(tokens.map((t) => `${t.kind}:${JSON.stringify(t.text)}`)).toEqual(['word:"Hold."', 'gap:"\\n"', 'word:"Talk."', 'gap:"  "', 'word:"Done."']);
    expect(tokens.map((t) => t.text).join('')).toBe(text);
    expect(tokenize('')).toEqual([]);
  });

  it('keeps the words a new text still has, in order, and swaps the rest', () => {
    const diff = diffWords(tokenize('Hold. Talk. Done.'), tokenize('Hold. Talk. Write.'));
    expect([...diff.kept.entries()]).toEqual([
      [0, 0],
      [2, 2],
    ]);
    expect(diff.gone).toEqual([4]);
    expect(diff.arriving).toEqual([4]);
  });

  it('treats a word that moved as leaving and arriving, not sliding', () => {
    const diff = diffWords(tokenize('one two three'), tokenize('three one two'));
    // The longest run in order is "one two"; "three" leaves the end and arrives at the front.
    expect(diff.kept.size).toBe(2);
    expect(diff.gone).toEqual([4]);
    expect(diff.arriving).toEqual([0]);
  });

  it('types arriving letters one at a time, pausing at gaps and after a full stop', () => {
    const tokens = tokenize('Hold. Done.');
    const steps = arrivals(tokens, [0, 2], steady);
    expect(steps.map((s) => `${s.token}:${s.char}`)).toEqual(['0:0', '0:1', '0:2', '0:3', '0:4', '2:0', '2:1', '2:2', '2:3', '2:4']);
    const at = steps.map((s) => s.at);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    // After "." a long breath (five beats), then the gap before a capital adds one more.
    expect(at[5]! - at[4]!).toBeGreaterThan(at[1]! - at[0]! * 4);
  });

  it('leaves kept words alone: only the arriving word takes time', () => {
    const tokens = tokenize('Hold. Talk. Write.');
    const steps = arrivals(tokens, [4], steady);
    expect(steps.map((s) => s.token)).toEqual([4, 4, 4, 4, 4, 4]);
    expect(steps[0]?.at).toBeGreaterThan(0); // the gap before it is a beat
  });

  it('untypes a leaving word from its last letter, quicker than typing', () => {
    const tokens = tokenize('Hold. Done.');
    const steps = departures(tokens, [2], 30);
    expect(steps.map((s) => `${s.char}@${s.at}`)).toEqual(['4@0', '3@30', '2@60', '1@90', '0@120']);
  });

  it('plans a swap as out then in, and says how long each takes', () => {
    const plan = planSwap('Hold. Talk. Done.', 'Hold. Talk. Write.', steady, 30);
    expect(plan.out.map((s) => s.token)).toEqual([4, 4, 4, 4, 4]);
    expect(plan.in.map((s) => s.token)).toEqual([4, 4, 4, 4, 4, 4]);
    expect(runLength(plan.out, 500)).toBe(120 + 500);
    expect(runLength([], 500)).toBe(0);
  });

  it('arrives everything the first time', () => {
    const plan = planSwap('', 'Hold. Talk.', steady);
    expect(plan.diff.arriving).toEqual([0, 2]);
    expect(plan.out).toEqual([]);
    expect(plan.in.length).toBe(10);
  });
});
