import { Check } from '@glacier/icons';
import type { ThemePreviewPalette } from '@glacier/tokens';
import type { CSSProperties } from 'react';
import type { ThemePref } from '../core/preferences.ts';
import { THEME_OPTIONS } from './themePalettes.ts';
import styles from './ThemeCards.module.css';

/**
 * The theme chooser as the kit's docs and AttackFM draw it (Matt: "the interface size and themes to use the same UI
 * from glacier with the physical representation of the ... colors on the app"): a grid of radio cards, each a
 * miniature of the app painted in that theme's colours (themePalettes.ts), System split down the middle, light on
 * the left and dark on the right. AttackFM's selector, with the miniature redrawn as Glyph rather than a desktop
 * app: a top bar with the back word and two tabs, a note - its heading, its lines, a to-do with its box - a pair
 * of segments with the chosen one in the accent, and the Speak pill at the foot.
 *
 * Radios in labels, so the arrow keys move between them; the chosen card is ringed and ticked, never colour alone.
 */

type PreviewStyle = CSSProperties & Record<`--theme-${string}`, string>;

function previewStyle(palette: ThemePreviewPalette): PreviewStyle {
  return {
    '--theme-background': palette.background,
    '--theme-sidebar': palette.sidebar,
    '--theme-surface': palette.surface,
    '--theme-border': palette.border,
    '--theme-text': palette.text,
    '--theme-muted': palette.muted,
    '--theme-accent': palette.accent,
    '--theme-accent-soft': palette.accentSoft,
  };
}

/** Glyph, painted small: the note page with its bar, its words and its pill. */
function Scene({ palette, alternate = false }: { palette?: ThemePreviewPalette; alternate?: boolean }) {
  return (
    <span className={alternate ? `${styles.scene} ${styles.sceneAlternate}` : styles.scene} style={palette ? previewStyle(palette) : undefined}>
      <span className={styles.bar}>
        <span className={styles.back} />
        <span className={styles.tab} data-active="true" />
        <span className={styles.tab} />
      </span>
      <span className={styles.note}>
        <span className={styles.heading} />
        <span className={styles.line} />
        <span className={styles.line} data-short="true" />
        <span className={styles.todo}>
          <span className={styles.box} />
          <span className={styles.line} data-short="true" />
        </span>
        <span className={styles.segments}>
          <span className={styles.segment} data-chosen="true" />
          <span className={styles.segment} />
        </span>
      </span>
      <span className={styles.speak} />
    </span>
  );
}

interface ThemeCardsProps {
  value: ThemePref;
  onValueChange: (value: ThemePref) => void;
}

export function ThemeCards({ value, onValueChange }: ThemeCardsProps) {
  return (
    <div className={styles.grid} role="radiogroup" aria-label="Theme">
      {THEME_OPTIONS.map((option) => {
        const selected = option.value === value;
        return (
          <label key={option.value} className={styles.option} data-selected={selected || undefined}>
            <input className={styles.input} type="radio" name="theme" value={option.value} aria-label={option.label} checked={selected} onChange={() => onValueChange(option.value)} />
            <span className={styles.preview} style={previewStyle(option.palette)} data-split={option.alternatePalette ? 'true' : undefined} aria-hidden="true">
              <Scene />
              {option.alternatePalette ? <Scene palette={option.alternatePalette} alternate /> : null}
            </span>
            <span className={styles.meta}>
              <span className={styles.copy}>
                <span className={styles.label}>{option.label}</span>
                <span className={styles.description}>{option.description}</span>
              </span>
              <span className={styles.indicator} aria-hidden="true">
                <Check size={12} strokeWidth={2.5} />
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
