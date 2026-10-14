import { describe, expect, it } from 'vitest';
import { grown, paceWaves, REST_GAP_MS, REST_LIFE_MS, shining, TALKING, wobbleAmount, wobbleAt, type Pacer } from './waves.ts';

describe('the rings from the side key', () => {
  it('keep a slow resting beat in silence', () => {
    const pacer: Pacer = { smooth: 0, lastAt: -Infinity };
    const first = paceWaves(pacer, 0, 0, 1);
    expect(first).toMatchObject({ born: 0, life: REST_LIFE_MS, reach: 1, alpha: 0.55, width: 1.5, seed: 1 });
    expect(paceWaves(pacer, 0, REST_GAP_MS - 1)).toBeNull();
    expect(paceWaves(pacer, 0, REST_GAP_MS)).not.toBeNull();
  });

  it('send rings out faster, wider and brighter with the voice, eased so a word does not jump', () => {
    const pacer: Pacer = { smooth: 0, lastAt: -Infinity };
    paceWaves(pacer, 1, 0);
    expect(pacer.smooth).toBeCloseTo(0.25, 5);
    let now = 0;
    let sent = 0;
    for (; now < 3000; now += 16) if (paceWaves(pacer, 1, now)) sent += 1;
    expect(sent).toBeGreaterThan(6);
    const loud = paceWaves({ smooth: 1, lastAt: -Infinity }, 1, 0)!;
    expect(loud.life).toBeLessThan(REST_LIFE_MS);
    expect(loud.reach).toBeGreaterThan(1.4);
    expect(loud.alpha).toBeGreaterThan(0.9);
    expect(loud.width).toBeGreaterThan(2.5);
    // Just under the talking line is still the resting beat.
    const quiet = { smooth: TALKING, lastAt: 0 };
    expect(paceWaves(quiet, TALKING, REST_GAP_MS - 1)).toBeNull();
  });

  it('grow quickly then slowly, and shine then fade, within 0 and 1', () => {
    expect(grown(0)).toBe(0);
    expect(grown(1)).toBe(1);
    expect(grown(0.3)).toBeGreaterThan(0.5);
    expect(shining(0)).toBe(0);
    expect(shining(0.12)).toBeCloseTo(1, 5);
    expect(shining(1)).toBeCloseTo(0, 5);
    expect(shining(2)).toBeCloseTo(0, 5);
  });

  it('wobble within a bound that grows with the voice, and never the same twice round', () => {
    for (let theta = 0; theta < Math.PI * 2; theta += 0.05) {
      const w = wobbleAt(theta, 1.5, 0.7);
      expect(Math.abs(w)).toBeLessThanOrEqual(1);
    }
    expect(wobbleAt(0.4, 1, 0.7)).not.toBe(wobbleAt(0.4, 1, 2.1));
    expect(wobbleAt(0.4, 1, 0.7)).not.toBe(wobbleAt(0.4, 2, 0.7));
    expect(wobbleAmount(0)).toBeCloseTo(0.035, 5);
    expect(wobbleAmount(1)).toBeCloseTo(0.165, 5);
  });
});
