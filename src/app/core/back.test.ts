// @vitest-environment jsdom
import { describe, expect, it, afterEach } from 'vitest';
import { goBack, installBack, markSteppedBack, onBack } from './back.ts';

describe('the back gesture', () => {
  let stop: (() => void) | null = null;
  afterEach(() => {
    stop?.();
    stop = null;
  });

  it('gives the gesture to the newest screen that wants it', () => {
    const taken: string[] = [];
    const offList = onBack(() => {
      taken.push('list');
      return false;
    });
    const offNote = onBack(() => {
      taken.push('note');
      return true;
    });
    expect(goBack()).toBe(true);
    expect(taken).toEqual(['note']);
    offNote();
    expect(goBack()).toBe(false);
    expect(taken).toEqual(['note', 'list']);
    offList();
  });

  it('always tells the activity the page used it, so a back swipe never leaves the app', () => {
    stop = installBack();
    const answer = window.__glyph?.back;
    expect(answer).toBeTypeOf('function');
    // Nothing on screen: the gesture still counts as used, where before it meant "put Glyph behind the home screen".
    expect(answer?.()).toBe(true);
    const off = onBack(() => true);
    expect(answer?.()).toBe(true);
    off();
  });

  it('steps back once for a swipe the page already used', () => {
    stop = installBack();
    const answer = window.__glyph?.back;
    let steps = 0;
    const off = onBack(() => {
      steps += 1;
      return true;
    });
    // The page's own right-swipe closed a screen; Android offers the same swipe a moment later.
    markSteppedBack();
    expect(answer?.()).toBe(true);
    expect(steps).toBe(0);
    off();
  });
});
