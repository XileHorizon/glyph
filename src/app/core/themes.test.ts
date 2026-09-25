import { describe, expect, it } from 'vitest';
import { applyPreferences, DEFAULT_PREFERENCES, isDarkNow, isUiScale, themeChoice, themeScheme } from './preferences.ts';

describe('the named themes', () => {
  it('knows which side of the page each one is', () => {
    expect(themeScheme('dawn')).toBe('light');
    expect(themeScheme('boreal')).toBe('dark');
    expect(themeScheme('ember')).toBe('dark');
    expect(themeScheme('light')).toBe('light');
    expect(themeScheme('system')).toBe('system');
    expect(isDarkNow('boreal')).toBe(true);
    expect(isDarkNow('dawn')).toBe(false);
  });

  it('stamps a named theme as its side and its name', () => {
    applyPreferences({ ...DEFAULT_PREFERENCES, theme: 'ember' });
    const root = document.documentElement;
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(root.getAttribute('data-theme-preset')).toBe('ember');
    // A plain theme takes the name off again, so the kit's tinted greys go with it.
    applyPreferences({ ...DEFAULT_PREFERENCES, theme: 'light' });
    expect(root.getAttribute('data-theme')).toBe('light');
    expect(root.hasAttribute('data-theme-preset')).toBe(false);
  });

  it('brings a named theme its own accent', () => {
    expect(themeChoice('boreal', { theme: 'dark', accent: 'ink' })).toEqual({ theme: 'boreal', accent: 'green' });
    expect(themeChoice('dawn', { theme: 'light', accent: 'purple' })).toEqual({ theme: 'dawn', accent: 'red' });
  });

  it('takes the accent back to ink on leaving a named theme, but only the one it brought', () => {
    // Still the green Boreal brought: going to Dark takes it off.
    expect(themeChoice('dark', { theme: 'boreal', accent: 'green' })).toEqual({ theme: 'dark', accent: 'ink' });
    // Changed to purple on purpose while on Boreal: left alone.
    expect(themeChoice('dark', { theme: 'boreal', accent: 'purple' })).toEqual({ theme: 'dark' });
    // Between plain themes the accent is never touched.
    expect(themeChoice('light', { theme: 'dark', accent: 'teal' })).toEqual({ theme: 'light' });
  });
});

describe('interface size', () => {
  it('sets the root size every rem is measured from, and takes it off at the kit own size', () => {
    const root = document.documentElement;
    applyPreferences({ ...DEFAULT_PREFERENCES, uiScale: 1.25 });
    expect(root.style.fontSize).toBe('125%');
    applyPreferences({ ...DEFAULT_PREFERENCES, uiScale: 0.925 });
    expect(root.style.fontSize).toBe('92.5%');
    applyPreferences({ ...DEFAULT_PREFERENCES, uiScale: 1 });
    expect(root.style.fontSize).toBe('');
  });

  it('knows its steps and nothing else', () => {
    expect(isUiScale(1.1)).toBe(true);
    expect(isUiScale(1.3)).toBe(false);
    expect(isUiScale('1.1')).toBe(false);
  });
});
