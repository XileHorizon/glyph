import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { accentOptions, accentSteps, themePresets } from '@glacier/tokens';
import { THEME_PRESETS, THEMES, UI_SCALES } from '../core/preferences.ts';
import { ScaleCards } from './ScaleCards.tsx';
import { ThemeCards } from './ThemeCards.tsx';
import { INK_DARK, INK_LIGHT, THEME_OPTIONS } from './themePalettes.ts';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function show(element: React.ReactElement): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(element));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const chosen = (within: ParentNode) => within.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.value;
const pick = (within: ParentNode, value: string) => act(() => within.querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`)!.click());

describe('the theme cards', () => {
  it('offer every theme the app has, System first and split into its light and dark halves', () => {
    expect(THEME_OPTIONS.map((o) => o.value)).toEqual(THEMES);
    expect(THEME_OPTIONS[0]!.alternatePalette).toBe(INK_DARK);
    expect(THEME_OPTIONS[0]!.palette).toBe(INK_LIGHT);
  });

  it('paint Light and Dark in Ghost.md’s own ink - no hue anywhere - with the accent left to the app', () => {
    const grey = /^oklch\([\d.]+ 0 0\)$/;
    for (const palette of [INK_LIGHT, INK_DARK]) {
      for (const key of ['background', 'sidebar', 'surface', 'border', 'text', 'muted'] as const) expect(palette[key]).toMatch(grey);
      expect(palette.accent).toBe('var(--glacier-accent-solid)');
    }
  });

  it('paint a named theme as the kit does, with the accent that comes with it', () => {
    for (const id of ['dawn', 'boreal', 'ember'] as const) {
      const option = THEME_OPTIONS.find((o) => o.value === id)!;
      const kit = themePresets.find((p) => p.id === id)!;
      expect(option.palette).toBe(kit.preview);
      const { scheme, accent } = THEME_PRESETS[id];
      const solid = accentSteps(accentOptions.find((a) => a.name === accent)!, scheme)[8];
      expect(option.palette.accent).toBe(solid);
      expect(option.description).toContain(accent);
    }
  });

  it('are radios: the chosen one is checked and ringed, and choosing another says so', () => {
    const picked: string[] = [];
    const cards = show(<ThemeCards value="dark" onValueChange={(v) => picked.push(v)} />);
    expect(cards.querySelectorAll('input[type="radio"]')).toHaveLength(6);
    expect(cards.querySelector('input[value="system"]')?.getAttribute('aria-label')).toBe('System');
    expect(chosen(cards)).toBe('dark');
    expect(cards.querySelector('[data-selected] input')?.getAttribute('value')).toBe('dark');
    pick(cards, 'ember');
    expect(picked).toEqual(['ember']);
    // System's card carries both halves; Dark's carries one.
    expect(cards.querySelector('[data-split]')?.querySelectorAll('[class*="scene"]')).toHaveLength(2);
  });
});

describe('the size cards', () => {
  it('draw the same piece of the app at every step, sized by the step, and choose by radio', () => {
    const picked: number[] = [];
    const cards = show(<ScaleCards value={1} onValueChange={(v) => picked.push(v)} />);
    const previews = Array.from(cards.querySelectorAll<HTMLElement>('[class*="preview"]'));
    expect(previews.map((p) => p.style.fontSize)).toEqual(UI_SCALES.map((s) => `${s}rem`));
    expect(chosen(cards)).toBe('1');
    expect(cards.textContent).toContain('Default');
    // A radio is named in words, not by its value: "85%", not "0.85".
    expect(Array.from(cards.querySelectorAll('input[type="radio"]')).map((r) => r.getAttribute('aria-label'))).toEqual(['85%', '93%', 'Default', '110%', '125%']);
    pick(cards, '1.25');
    expect(picked).toEqual([1.25]);
  });
});
