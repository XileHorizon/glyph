import { afterEach, describe, expect, it } from 'vitest';
import { installWispMasks, WISP_DRAW_KEY, WISP_MASK_ABOVE, WISP_MASK_HEIGHT, WISP_MASK_TILE, wispDraw, wispMaskImage } from './wispMask.ts';

describe('the wisp edge drawn as a mask', () => {
  afterEach(() => {
    localStorage.removeItem(WISP_DRAW_KEY);
    delete document.documentElement.dataset.titlebar;
  });

  it('is what the Mac app draws, and the filter is what everything else draws, unless someone asks otherwise', () => {
    expect(wispDraw()).toBe('filter');
    document.documentElement.dataset.titlebar = 'overlay';
    expect(wispDraw()).toBe('mask');
    localStorage.setItem(WISP_DRAW_KEY, 'filter');
    expect(wispDraw()).toBe('filter');
    delete document.documentElement.dataset.titlebar;
    localStorage.setItem(WISP_DRAW_KEY, 'mask');
    expect(wispDraw()).toBe('mask');
    localStorage.setItem(WISP_DRAW_KEY, 'sideways');
    expect(wispDraw()).toBe('filter');
  });

  it('makes each band once as a tiling image: stitched turbulence over a soft strip, taken to a torn alpha', () => {
    const top = wispMaskImage('top');
    expect(top.startsWith('url("data:image/svg+xml,')).toBe(true);
    const svg = decodeURIComponent(top.slice('url("data:image/svg+xml,'.length, -2));
    expect(svg).toContain(`width="${WISP_MASK_TILE}" height="${WISP_MASK_HEIGHT}"`);
    expect(svg).toContain('stitchTiles="stitch"');
    expect(svg).toContain(`height="${WISP_MASK_ABOVE}" result="strip"`);
    expect(svg).toContain('feFuncA type="table"');
    // Nothing in it reaches outside the image: an image used as a mask may load nothing else.
    expect(svg).not.toMatch(/href=|url\((?!#)/);
  });

  it('turns the foot over, with its own taller ramp', () => {
    const top = decodeURIComponent(wispMaskImage('top').slice('url("data:image/svg+xml,'.length, -2));
    const foot = decodeURIComponent(wispMaskImage('foot').slice('url("data:image/svg+xml,'.length, -2));
    expect(foot).toContain(`transform="translate(0 ${WISP_MASK_HEIGHT}) scale(1 -1)"`);
    expect(top).not.toContain('scale(1 -1)');
    expect(top).toContain('stdDeviation="0 22"');
    expect(foot).toContain('stdDeviation="0 44"');
  });

  it('puts both images on the root for the stylesheet, once', () => {
    installWispMasks();
    const root = document.documentElement.style;
    expect(root.getPropertyValue('--wisp-mask-top')).toContain('data:image/svg+xml');
    expect(root.getPropertyValue('--wisp-mask-foot')).toContain('data:image/svg+xml');
    expect(root.getPropertyValue('--wisp-mask-above')).toBe(`${WISP_MASK_ABOVE}px`);
  });
});
