import { describe, expect, it } from 'vitest';
import { COMMON, modelOf, onScreen, SIDE_KEYS, sideKeySpot } from './sideKeys.ts';

const ua = (model: string) => `Mozilla/5.0 (Linux; Android 16; ${model} Build/BP2A.250605.031; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/138.0.0.0 Mobile Safari/537.36`;

describe('where the side key is', () => {
  it('reads the model out of the user agent', () => {
    expect(modelOf(ua('SM-F971U1'))).toBe('SM-F971U1');
    expect(modelOf(ua('Pixel 10 Pro'))).toBe('Pixel 10 Pro');
    expect(modelOf('Mozilla/5.0 (Linux; Android 15; en-us; CPH2649 Build/AP3A) AppleWebKit')).toBe('CPH2649');
    expect(modelOf('Mozilla/5.0 (Linux; Android 14; K) AppleWebKit')).toBe('K');
    expect(modelOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('');
  });

  it('knows the phones by model', () => {
    expect(sideKeySpot(ua('SM-F971U1'), 'samsung').phone).toMatch(/Fold/);
    expect(sideKeySpot(ua('SM-S938U'), 'samsung').phone).toMatch(/S25/);
    expect(sideKeySpot(ua('SM-F766B'), 'samsung').phone).toMatch(/Flip/);
    expect(sideKeySpot(ua('Pixel 10 Pro'), 'Google').at).toBe(0.31);
    expect(sideKeySpot(ua('Pixel 9 Pro Fold'), 'Google').phone).toMatch(/Fold/);
    expect(sideKeySpot(ua('CPH2649'), 'OnePlus').phone).toMatch(/OnePlus 13/);
    expect(sideKeySpot(ua('XQ-FS54'), 'Sony').at).toBe(0.5);
    expect(sideKeySpot(ua('motorola razr 60 ultra'), 'motorola').phone).toMatch(/Razr/);
    expect(sideKeySpot(ua('A059'), 'Nothing').note).toMatch(/left/);
  });

  it('falls back to the maker, then to the common case', () => {
    expect(sideKeySpot(ua('SM-A566B'), 'samsung').maker).toBe('Samsung');
    expect(sideKeySpot(ua('ZZZ-1'), 'Google').at).toBe(0.31);
    expect(sideKeySpot(ua('2506AAA'), 'Xiaomi').maker).toBe('Xiaomi');
    expect(sideKeySpot(ua('K'), '')).toBe(COMMON);
    expect(sideKeySpot('', '')).toBe(COMMON);
  });

  it('keeps every position on the phone, and a little higher on the screen', () => {
    for (const spot of SIDE_KEYS) {
      expect(spot.at).toBeGreaterThan(0.2);
      expect(spot.at).toBeLessThan(0.6);
    }
    expect(onScreen(0.42)).toBeCloseTo(0.416, 2);
    expect(onScreen(0.02)).toBe(0.1);
    expect(onScreen(0.99)).toBe(0.9);
  });
});
