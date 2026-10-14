import { describe, expect, it } from 'vitest';
import { countersIn, stepped } from './counters.ts';

describe('counters', () => {
  it('finds a count and a goal in brackets, and nothing that only looks like one', () => {
    expect(countersIn('- Water [3/8] and push-ups [0/50]').map((c) => [c.count, c.goal])).toEqual([
      [3, 8],
      [0, 50],
    ]);
    expect(countersIn('[1/2](https://x.dev) ![3/4](image/a.jpg) a[1/2] [0/0] [ 1/2 ]')).toEqual([]);
    expect(countersIn('x [2/5]', 10)[0]).toEqual({ from: 12, to: 17, count: 2, goal: 5 });
  });

  it('steps up to the goal and down to nothing, and no further', () => {
    const at = (count: number) => ({ from: 0, to: 0, count, goal: 3 });
    expect(stepped(at(1), 1)).toBe('[2/3]');
    expect(stepped(at(3), 1)).toBe('[3/3]');
    expect(stepped(at(1), -1)).toBe('[0/3]');
    expect(stepped(at(0), -1)).toBe('[0/3]');
  });
});
