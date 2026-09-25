import { beforeAll, describe, expect, it } from 'vitest';
import { wispSides } from './wispSides.ts';

/**
 * The one attribute in the tab row's filter that must NOT be converted into the row's box, written in the shape the
 * lane's own test proved (art/wispFoot.test.ts, docs/DESIGN.md §54): the two files carry the same filter written
 * twice and can drift back independently, so each holds itself honest.
 *
 * `primitiveUnits="objectBoundingBox"` turns every length here into a fraction of the row, but it does not reach
 * `feTurbulence`'s `baseFrequency` - an engine reads a frequency in the filter's own space whatever the units
 * attribute says. Converted along with the lengths, it asked for 26 cycles across a 375px row where 0.07 a pixel was
 * meant, and the row's smoke shipped as fine static (Matt: "The tabs have a grainy effect on the wisp blur distort").
 *
 * jsdom draws no filters, so nothing here can look at the smoke. It asserts the shape of the mistake instead - the
 * frequency is the same string at any row size - and, so that the assertion can fail rather than pass vacuously, that
 * a length in the same filter does move between two rows. A check that cannot express the failure always passes: that
 * is what let this through the first time, in a metric that counted the smoke's pixels and could not see how fine the
 * noise inside it was.
 */

function filterFor(width: number, height: number, start = true, end = true): SVGElement {
  const value = wispSides(width, height, start, end);
  if (!value) throw new Error(`no filter for ${width}x${height}`);
  const id = /url\(#(.+)\)/.exec(value)?.[1];
  const node = id ? document.getElementById(id) : null;
  if (!node) throw new Error(`filter ${id} is not in the document`);
  return node as unknown as SVGElement;
}

const attr = (filter: SVGElement, tag: string, name: string): string | null => filter.querySelector(tag)?.getAttribute(name) ?? null;

beforeAll(() => {
  // The filter is refused with reduced motion, and jsdom has no matchMedia to ask.
  window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
});

describe('wispSides', () => {
  it('reads the noise per pixel, at every row size', () => {
    const narrow = filterFor(375, 41);
    const wide = filterFor(1024, 44);
    expect(attr(narrow, 'feTurbulence', 'baseFrequency')).toBe('0.07 0.035');
    expect(attr(wide, 'feTurbulence', 'baseFrequency')).toBe(attr(narrow, 'feTurbulence', 'baseFrequency'));
  });

  it('still converts the lengths, so the test above can fail', () => {
    const narrow = filterFor(376, 41);
    const wide = filterFor(1025, 44);
    // The bend is a fraction of the box's diagonal, so two rows of different sizes cannot throw by the same number.
    expect(attr(narrow, 'feDisplacementMap', 'scale')).not.toBe(attr(wide, 'feDisplacementMap', 'scale'));
    expect(narrow.getAttribute('filterUnits')).toBe('objectBoundingBox');
    expect(narrow.getAttribute('primitiveUnits')).toBe('objectBoundingBox');
  });

  it('smokes only an end that is open, and refuses a row too small to carry a band', () => {
    expect(wispSides(375, 41, false, false)).toBeNull();
    expect(wispSides(20, 41, true, true)).toBeNull();
    const startOnly = filterFor(375, 41, true, false);
    expect(startOnly.querySelectorAll('feFlood')).toHaveLength(2);
  });
});
