import { themePresets, type ThemePreviewPalette } from '@glacier/tokens';
import { THEME_PRESETS, type ThemePref, type ThemePreset } from '../core/preferences.ts';

/**
 * Each theme's colours, for the cards that choose one (ThemeCards.tsx): what the page would look like, painted small.
 *
 * Light and Dark are Glyph's own ink scale (ink.css), chroma zero, paper by day and the same page in reverse by
 * night; their accent is whatever the app's accent is right now, as a variable, so the cards follow the swatch below
 * them (ink when the accent is Ink, which is Glyph's own answer). The named themes take the kit's own preview for
 * each - its tinted greys and the accent that comes with it - because that is what the page becomes under one
 * (ink.css, "A named theme"). System is Light on the left and Dark on the right.
 */

const LIVE_ACCENT = { accent: 'var(--glacier-accent-solid)', accentSoft: 'var(--glacier-accent-soft)' };

export const INK_LIGHT: ThemePreviewPalette = {
  background: 'oklch(0.995 0 0)',
  sidebar: 'oklch(0.975 0 0)',
  surface: 'oklch(0.955 0 0)',
  border: 'oklch(0.925 0 0)',
  text: 'oklch(0.16 0 0)',
  muted: 'oklch(0.56 0 0)',
  ...LIVE_ACCENT,
};

export const INK_DARK: ThemePreviewPalette = {
  background: 'oklch(0.11 0 0)',
  sidebar: 'oklch(0.14 0 0)',
  surface: 'oklch(0.17 0 0)',
  border: 'oklch(0.205 0 0)',
  text: 'oklch(0.965 0 0)',
  muted: 'oklch(0.6 0 0)',
  ...LIVE_ACCENT,
};

export interface ThemeOption {
  value: ThemePref;
  label: string;
  description: string;
  palette: ThemePreviewPalette;
  /** Painted over the right half: the dark side of System. */
  alternatePalette?: ThemePreviewPalette;
}

const ACCENT_WORDS: Record<string, string> = { red: 'red', green: 'green', amber: 'amber', blue: 'blue' };

function presetOption(id: ThemePreset, label: string): ThemeOption {
  const kit = themePresets.find((p) => p.id === id);
  if (!kit) throw new Error(`The kit has no theme called “${id}”.`);
  const { scheme, accent } = THEME_PRESETS[id];
  return { value: id, label, description: `${scheme === 'light' ? 'Light' : 'Dark'}, with ${ACCENT_WORDS[accent] ?? accent}`, palette: kit.preview };
}

export const THEME_OPTIONS: readonly ThemeOption[] = [
  { value: 'system', label: 'System', description: 'Follows the phone', palette: INK_LIGHT, alternatePalette: INK_DARK },
  { value: 'light', label: 'Light', description: 'Ink on paper', palette: INK_LIGHT },
  { value: 'dark', label: 'Dark', description: 'Paper on ink', palette: INK_DARK },
  presetOption('dawn', 'Dawn'),
  presetOption('boreal', 'Boreal'),
  presetOption('ember', 'Ember'),
];
