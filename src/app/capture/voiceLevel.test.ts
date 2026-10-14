import { describe, expect, it } from 'vitest';
import { onVoiceLevel, paceRings, publishVoiceLevel, type RingPacer } from './voiceLevel.ts';

/** Rings sent out over `ms` at a steady `level`, a frame every 16 ms. */
function ringsOver(level: number, ms: number) {
  const pacer: RingPacer = { smooth: level, lastRingAt: -Infinity };
  const rings = [];
  for (let now = 0; now <= ms; now += 16) {
    const ring = paceRings(pacer, level, now);
    if (ring) rings.push(ring);
  }
  return rings;
}

describe('rings sent out by the voice', () => {
  it('keeps a slow faint beat in silence', () => {
    const rings = ringsOver(0, 6000);
    expect(rings.length).toBe(3);
    expect(rings[0]?.opacity).toBeCloseTo(0.16);
  });

  it('sends more, wider, brighter rings the louder the voice', () => {
    const soft = ringsOver(0.3, 3000);
    const loud = ringsOver(1, 3000);
    expect(loud.length).toBeGreaterThan(soft.length);
    expect(soft.length).toBeGreaterThan(ringsOver(0, 3000).length);
    expect(loud[0]!.reach).toBeGreaterThan(soft[0]!.reach);
    expect(loud[0]!.opacity).toBeGreaterThan(soft[0]!.opacity);
    expect(loud[0]!.durationMs).toBeLessThan(soft[0]!.durationMs);
  });

  it('eases toward a new level instead of jumping', () => {
    const pacer: RingPacer = { smooth: 0, lastRingAt: 0 };
    paceRings(pacer, 1, 10);
    expect(pacer.smooth).toBeGreaterThan(0);
    expect(pacer.smooth).toBeLessThan(0.5);
  });

  it('hands the level to whoever listens, until they stop', () => {
    const heard: number[] = [];
    const off = onVoiceLevel((level) => heard.push(level));
    publishVoiceLevel(0.4);
    off();
    publishVoiceLevel(0.9);
    expect(heard).toEqual([0.4]);
  });
});
