import { describe, expect, it } from 'vitest';
import { wispFoot, wispFootFade } from './wispFoot.ts';

/**
 * The one attribute in this filter that must NOT be converted into the lane's box.
 *
 * `primitiveUnits="objectBoundingBox"` turns every length here into a fraction of the lane, but it does not reach
 * `feTurbulence`'s `baseFrequency` - an engine reads a frequency in the filter's own space whatever the units
 * attribute says. Converting it along with the lengths multiplied the frequency by the lane and made the noise a
 * couple of hundred times too fine, and the smoke shipped as fine static (docs/DESIGN.md §54).
 *
 * What let that through was a check that counted the smoke's pixels, which sees where the band is and how strong it
 * is and is blind to how fine the noise inside it is: it matched to within 0.2% while the two filters looked nothing
 * alike. So this asserts the shape of the mistake rather than the look: the frequency is the same at any lane size,
 * and - so that the assertion can actually fail - a length in the same filter is not.
 */
function filterFor(height: number, width: number): SVGElement {
  const value = wispFoot(height, width);
  if (!value) throw new Error(`no filter for ${width}x${height}`);
  const id = /url\(#(.+)\)/.exec(value)?.[1];
  const node = id ? document.getElementById(id) : null;
  if (!node) throw new Error(`filter ${id} is not in the document`);
  return node as unknown as SVGElement;
}

const attr = (filter: SVGElement, tag: string, name: string): string | null => filter.querySelector(tag)?.getAttribute(name) ?? null;

describe('wispFoot', () => {
  it('reads the noise per pixel, at every lane size', () => {
    const short = filterFor(120, 240);
    const tall = filterFor(400, 240);
    expect(attr(short, 'feTurbulence', 'baseFrequency')).toBe('0.02 0.07');
    expect(attr(tall, 'feTurbulence', 'baseFrequency')).toBe(attr(short, 'feTurbulence', 'baseFrequency'));
  });

  it('still converts the lengths, so the test above can fail', () => {
    const short = filterFor(121, 240);
    const tall = filterFor(401, 240);
    // The band's blur is a fraction of the lane's height, so it has to differ between two lanes of different heights.
    expect(attr(short, 'feGaussianBlur', 'stdDeviation')).not.toBe(attr(tall, 'feGaussianBlur', 'stdDeviation'));
    expect(short.getAttribute('filterUnits')).toBe('objectBoundingBox');
    expect(short.getAttribute('primitiveUnits')).toBe('objectBoundingBox');
  });

  it('scales the band to a short lane and leaves a tall one whole', () => {
    // A lane with room for the whole band gets the full fade; a shorter one gets a smaller band and a shorter fade.
    expect(wispFootFade(300)).toBe(wispFootFade(150));
    expect(wispFootFade(91)).toBeLessThan(wispFootFade(300));
    // Under the shortest lane that can carry a band there is no filter at all, and the lane keeps its plain fade.
    expect(wispFoot(40, 240)).toBeNull();
  });
});
