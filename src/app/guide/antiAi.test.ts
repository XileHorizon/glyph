import { describe, expect, it } from 'vitest';
import { BEATS, GAGS, SLAP_MS, STAMP, beatAt } from './antiAi.ts';

describe('the heads-up gags', () => {
  it('plays the datacenter, then the hot phone, over and over', () => {
    expect(BEATS.map((beat) => `${beat.gag}:${beat.stamp}`)).toEqual(['water:no', 'hot:ok']);
    expect(beatAt(0).gag).toBe('water');
    expect(beatAt(3).gag).toBe('hot');
  });

  it('lands the NO after the scene, and leaves time to slap, hold and slide away', () => {
    for (const beat of BEATS) {
      expect(beat.sceneMs).toBeGreaterThanOrEqual(2500);
      expect(beat.ms).toBe(beat.sceneMs + SLAP_MS);
    }
  });

  it('keeps every gag written: a NO title for what it doesn’t do, and the hot phone said to be A-OK', () => {
    expect(Object.keys(GAGS)).toEqual(['water', 'seal', 'art', 'hot']);
    for (const [gag, words] of Object.entries(GAGS)) {
      expect(words.line.length).toBeGreaterThan(10);
      if (STAMP[gag as keyof typeof STAMP] === 'no') expect(words.title).toMatch(/^No /);
    }
    expect(GAGS.hot.line).toMatch(/A-OK/);
  });
});
