// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MOST_TABS } from '../notes/openTabs.ts';

/**
 * The tabs a person left open travel with their settings (Matt: "Persist tabs across devices and reloads"): kept in
 * the preferences, so a reload finds them, and in the synced set, so another device opens the same row.
 *
 * Each case loads the module afresh, because the preferences are read once when it loads - which is exactly what a
 * reload does.
 */
const KEY = 'glyph-preferences';

async function afterReload(stored: unknown) {
  localStorage.clear();
  if (stored !== undefined) localStorage.setItem(KEY, JSON.stringify(stored));
  vi.resetModules();
  const prefs = await import('./preferences.ts');
  const sync = await import('./sync/prefs.ts');
  return { ...prefs, ...sync };
}

describe('the notes left open', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('comes back as it was after a reload', async () => {
    const first = await afterReload(undefined);
    expect(first.preferences().openNotes).toEqual([]);
    first.setPreferences({ openNotes: ['a', 'b', 'c'] });
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;

    const again = await afterReload(stored);
    expect(again.preferences().openNotes).toEqual(['a', 'b', 'c']);
  });

  it('travels with the settings, so another device opens the same row', async () => {
    const { preferences, setPreferences, pickSynced } = await afterReload(undefined);
    setPreferences({ openNotes: ['a', 'b'] });
    expect(pickSynced(preferences()).openNotes).toEqual(['a', 'b']);
  });

  it('takes nothing but ids, and no more than the row holds', async () => {
    const wrong = await afterReload({ openNotes: 'not a list' });
    expect(wrong.preferences().openNotes).toEqual([]);

    const mixed = await afterReload({ openNotes: ['a', 7, null, 'b'] });
    expect(mixed.preferences().openNotes).toEqual(['a', 'b']);

    const many = Array.from({ length: MOST_TABS + 4 }, (_, i) => `n${i}`);
    const capped = await afterReload({ openNotes: many });
    expect(capped.preferences().openNotes).toEqual(many.slice(-MOST_TABS));
  });
});
