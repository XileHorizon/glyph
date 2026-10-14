/**
 * Colours for code in a note: a fenced block's tokens, parsed by its language (language.ts, glyphHighlight.ts), in a
 * palette chosen for each side of the page's theme (Matt: "show rich text highlighting with some light and dark
 * themes"). The page's own ink is one of the choices, so a note can stay monochrome.
 *
 * Pastel is the default on both sides: soft colours in the page's own light, on a block lifted a touch from the page
 * itself (Matt, of One Dark's blue-grey block on the black page: "the background doesn't match the theme, nor do the
 * colours match the pastels we would use"). Every theme draws its block from the page, not a background of its own.
 *
 * Each theme is a set of custom properties on the root (`--code-*`), read by Editor.module.css. A light and a dark
 * theme are both stamped (`data-code-light`, `data-code-dark`, core/preferences.ts) and codeThemes.css picks between
 * them the way ink.css picks the page, so "System" switches code colours with the phone and no script runs.
 */

export type CodeThemeLight = 'pastel' | 'ink' | 'github' | 'solarized';
export type CodeThemeDark = 'pastel' | 'ink' | 'one-dark' | 'dracula' | 'nord';

export const CODE_THEMES_LIGHT: { value: CodeThemeLight; label: string }[] = [
  { value: 'pastel', label: 'Pastel' },
  { value: 'ink', label: 'Ink' },
  { value: 'github', label: 'GitHub' },
  { value: 'solarized', label: 'Solarized' },
];

export const CODE_THEMES_DARK: { value: CodeThemeDark; label: string }[] = [
  { value: 'pastel', label: 'Pastel' },
  { value: 'ink', label: 'Ink' },
  { value: 'one-dark', label: 'One Dark' },
  { value: 'dracula', label: 'Dracula' },
  { value: 'nord', label: 'Nord' },
];

export function isCodeThemeLight(value: unknown): value is CodeThemeLight {
  return CODE_THEMES_LIGHT.some((theme) => theme.value === value);
}

export function isCodeThemeDark(value: unknown): value is CodeThemeDark {
  return CODE_THEMES_DARK.some((theme) => theme.value === value);
}
