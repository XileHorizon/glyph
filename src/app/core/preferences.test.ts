import { beforeEach, describe, expect, it } from 'vitest';
import { applyPreferences, DEFAULT_PREFERENCES, isAccent, isRounding, preferences, setPreferences } from './preferences.ts';

/**
 * What the page is stamped with, and what survives a store written by another build. The look itself is CSS
 * (app/ink.css): these are the attributes it hangs on, which is the part that can silently stop working.
 */
describe('how the app is drawn', () => {
  beforeEach(() => {
    localStorage.clear();
    setPreferences({ ...DEFAULT_PREFERENCES });
  });

  const root = () => document.documentElement;

  it('stamps nothing while everything is the app’s own', () => {
    applyPreferences({ ...DEFAULT_PREFERENCES });
    expect(root().hasAttribute('data-accent')).toBe(false);
    expect(root().hasAttribute('data-rounding')).toBe(false);
    expect(root().hasAttribute('data-density')).toBe(false);
    // The theme is the exception: Glyph's own default is dark, not the phone's, so it is always stamped.
    expect(root().getAttribute('data-theme')).toBe(DEFAULT_PREFERENCES.theme);
  });

  it('stamps the accent and the rounding once they are chosen, and clears them again', () => {
    setPreferences({ accent: 'teal', rounding: 'square', density: 'compact' });
    expect(root().getAttribute('data-accent')).toBe('teal');
    expect(root().getAttribute('data-rounding')).toBe('square');
    expect(root().getAttribute('data-density')).toBe('compact');
    setPreferences({ accent: 'ink', rounding: 'round', density: 'comfortable' });
    expect(root().hasAttribute('data-accent')).toBe(false);
    expect(root().hasAttribute('data-rounding')).toBe(false);
    expect(root().hasAttribute('data-density')).toBe(false);
  });

  it('knows its own names, and no others', () => {
    expect(isAccent('purple')).toBe(true);
    expect(isAccent('ink')).toBe(true);
    // The accent used to be a colour the app never drew with; a store from that build must not stamp it.
    expect(isAccent('blue')).toBe(false);
    expect(isRounding('rounder')).toBe(true);
    expect(isRounding('squircle')).toBe(false);
  });

  it('takes an accent or a rounding it does not know as the app’s own', () => {
    localStorage.setItem('glyph-preferences', JSON.stringify({ ...DEFAULT_PREFERENCES, accent: 'blue', rounding: 'squircle' }));
    // A fresh read of the store is what a launch does.
    setPreferences({});
    // Cast, because these are names the types no longer admit - which is the point: they can only arrive from a store.
    expect((preferences().accent as string) === 'blue').toBe(false);
    expect((preferences().rounding as string) === 'squircle').toBe(false);
    applyPreferences();
    expect(root().hasAttribute('data-accent')).toBe(false);
    expect(root().hasAttribute('data-rounding')).toBe(false);
  });
});
