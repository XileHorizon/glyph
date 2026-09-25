import { describe, expect, it } from 'vitest';
import { answer, sumOnLine } from './sums.ts';

describe('sums', () => {
  it('works arithmetic out in the usual order', () => {
    expect(answer('450 + 120 * 2')).toBe('690');
    expect(answer('(450 + 120) * 2')).toBe('1140');
    expect(answer('2 ^ 3 ^ 2')).toBe('512');
    expect(answer('-3 + 10 / 4')).toBe('-0.5'.replace('-', '−'));
    expect(answer('10 × 3 ÷ 4')).toBe('7.5');
    expect(answer('200 * 15%')).toBe('30');
  });

  it('gives a currency sign and thousands back', () => {
    expect(answer('$1,200 / 3')).toBe('$400');
    expect(answer('£10 / 3')).toBe('£3.33');
    expect(answer('1,000 + 250')).toBe('1,250');
  });

  it('answers nothing for a lone number, words, or a sum that cannot be done', () => {
    expect(answer('450')).toBeNull();
    expect(answer('rent + food')).toBeNull();
    expect(answer('1 / 0')).toBeNull();
    expect(answer('(1 + 2')).toBeNull();
    expect(answer('1 +')).toBeNull();
  });

  it('is a line starting with = and a space, in a list or quote too, and not a heading underline', () => {
    expect(sumOnLine('= 1 + 1')).toEqual({ answer: '2' });
    expect(sumOnLine('- = 2 * 3')).toEqual({ answer: '6' });
    expect(sumOnLine('> = 9 - 4')).toEqual({ answer: '5' });
    expect(sumOnLine('===')).toBeNull();
    expect(sumOnLine('x = 1 + 1')).toBeNull();
  });
});
