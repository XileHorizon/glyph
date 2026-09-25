import { beforeEach, describe, expect, it } from 'vitest';
import { clearGuideProgress, guidePageLeftAt, isReadingPage, launchedTooSoon, markGuideStarted, rememberGuidePage } from './tooSoon.ts';
import { GUIDE_PAGES } from './pages.ts';

describe('leaving the guide too soon', () => {
  beforeEach(() => localStorage.clear());

  it('is not too soon on the very first launch, nor once the guide is finished', () => {
    expect(guidePageLeftAt()).toBe(-1);
    expect(launchedTooSoon(false)).toBe(false);
    markGuideStarted();
    expect(launchedTooSoon(true)).toBe(false);
  });

  it('is too soon when the guide was started and left on a reading page', () => {
    markGuideStarted();
    expect(guidePageLeftAt()).toBe(0);
    expect(launchedTooSoon(false)).toBe(true);
    rememberGuidePage(GUIDE_PAGES.indexOf('model'));
    expect(launchedTooSoon(false)).toBe(true);
  });

  it('is not too soon from the side-key page on, where the key is asked for', () => {
    markGuideStarted();
    rememberGuidePage(GUIDE_PAGES.indexOf('sidekey'));
    expect(launchedTooSoon(false)).toBe(false);
    rememberGuidePage(GUIDE_PAGES.length - 1);
    expect(launchedTooSoon(false)).toBe(false);
    expect(isReadingPage(0)).toBe(true);
    expect(isReadingPage(GUIDE_PAGES.indexOf('sidekey'))).toBe(false);
  });

  it('forgets everything when the guide is finished, and shrugs at bad storage', () => {
    markGuideStarted();
    rememberGuidePage(2);
    clearGuideProgress();
    expect(guidePageLeftAt()).toBe(-1);
    expect(launchedTooSoon(false)).toBe(false);
    localStorage.setItem('glyph-guide-started', '1');
    localStorage.setItem('glyph-guide-page', 'sideways');
    expect(guidePageLeftAt()).toBe(0);
    expect(launchedTooSoon(false)).toBe(true);
  });
});
