import { beforeEach, describe, expect, it } from 'vitest';
import { clampZoom, pinched, readZoom, ZOOM_MAX, ZOOM_MIN } from './pinchZoom.ts';

describe('pinching a note’s text', () => {
  beforeEach(() => localStorage.clear());

  it('follows the fingers: twice as far apart, twice the size', () => {
    expect(pinched(1, 100, 200)).toBe(2);
    expect(pinched(1.2, 100, 50)).toBeCloseTo(0.7);
    expect(pinched(1.5, 100, 100)).toBe(1.5);
  });

  it('stays between the smallest and largest size', () => {
    expect(pinched(1, 100, 1000)).toBe(ZOOM_MAX);
    expect(pinched(1, 100, 10)).toBe(ZOOM_MIN);
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(pinched(1.3, 0, 50)).toBe(1.3);
  });

  it('opens at the size last pinched, and at the usual size when none was', () => {
    expect(readZoom()).toBe(1);
    localStorage.setItem('glyph-note-zoom', '1.450');
    expect(readZoom()).toBe(1.45);
    localStorage.setItem('glyph-note-zoom', '9');
    expect(readZoom()).toBe(ZOOM_MAX);
    localStorage.setItem('glyph-note-zoom', 'huge');
    expect(readZoom()).toBe(1);
  });
});
