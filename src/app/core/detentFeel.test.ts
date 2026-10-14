import { describe, expect, it } from 'vitest';
import { approach, tickGap, tickNow, type Approaching } from './detentFeel.ts';

/** The times of the ticks felt dragging steadily from rest to `to` over `ms`. */
function ticks(detents: number[], to: number, ms: number): number[] {
  const state: Approaching = { lastTickAt: -Infinity, lastDistance: 0 };
  const felt: number[] = [];
  for (let now = 0; now <= ms; now += 8) {
    if (tickNow(state, detents, (to * now) / ms, now)) felt.push(now);
  }
  return felt;
}

describe('feeling a detent coming', () => {
  it('says which detent a drag is heading for and how far along it is', () => {
    expect(approach([0.22, 0.55], 0.11)).toEqual({ index: 0, progress: 0.5 });
    expect(approach([0.22, 0.55], 0.385)?.index).toBe(1);
    expect(approach([0.22, 0.55], 0.385)?.progress).toBeCloseTo(0.5);
    expect(approach([0.22, 0.55], 0.6)).toBeNull();
  });

  it('ticks nowhere in the first third, then faster and faster', () => {
    expect(tickGap(0.2)).toBeNull();
    expect(tickGap(0.35)).toBe(240);
    expect(tickGap(0.99)!).toBeLessThan(50);
    expect(tickGap(0.7)!).toBeGreaterThan(tickGap(0.9)!);
    expect(tickGap(1)).toBeNull();
  });

  it('packs the ticks closer together near the detent', () => {
    const felt = ticks([0.3], 0.299, 2000);
    expect(felt.length).toBeGreaterThan(4);
    const gaps = felt.slice(1).map((t, i) => t - felt[i]!);
    expect(gaps.at(-1)!).toBeLessThan(gaps[0]!);
  });

  it('is quiet backing off', () => {
    const state: Approaching = { lastTickAt: -Infinity, lastDistance: 0.29 };
    expect(tickNow(state, [0.3], 0.2, 1000)).toBe(false);
    expect(tickNow(state, [0.3], 0.15, 2000)).toBe(false);
  });
});
