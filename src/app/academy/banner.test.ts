import { beforeEach, describe, expect, it } from 'vitest';
import { academyBannerDue, dismissAcademyBanner } from './banner.ts';
import { writeProgress } from './lessons.ts';

/**
 * The home page's Academy card (notes/Notices.tsx) is for someone who has
 * not started. These are the two ways it goes: a lesson passed, or the cross.
 */

describe('the Academy card', () => {
  beforeEach(() => localStorage.clear());

  it('is offered to someone who has not started', () => {
    expect(academyBannerDue()).toBe(true);
  });

  it('goes once a lesson is passed', () => {
    writeProgress(new Set(['title']));
    expect(academyBannerDue()).toBe(false);
  });

  it('goes when it is put away, and stays gone', () => {
    dismissAcademyBanner();
    expect(academyBannerDue()).toBe(false);
  });
});
