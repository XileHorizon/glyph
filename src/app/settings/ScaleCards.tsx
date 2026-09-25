import { isUiScale, UI_SCALES, type UiScale } from '../core/preferences.ts';
import styles from './ScaleCards.module.css';

/**
 * Interface size as cards (Matt: "the interface size ... with the physical representation"): one card per step, and
 * inside each the same small piece of the app - a row with its icon, its two lines and its switch - drawn at that
 * size, so what a step does is seen before it is chosen. The kit's DensitySelector does the same for spacing; this is
 * its shape for the one number that scales everything (core/preferences.ts UI_SCALES).
 *
 * The card's inside is sized in em from a font size that is the step, so the row grows and shrinks exactly as the
 * app would: the root's font size is how the app applies the number.
 */

const WORDS: Record<UiScale, string> = { 0.85: '85%', 0.925: '93%', 1: 'Default', 1.1: '110%', 1.25: '125%' };

interface ScaleCardsProps {
  value: UiScale;
  onValueChange: (value: UiScale) => void;
}

export function ScaleCards({ value, onValueChange }: ScaleCardsProps) {
  return (
    <div className={styles.row} role="radiogroup" aria-label="Interface size">
      {UI_SCALES.map((scale) => {
        const selected = scale === value;
        return (
          <label key={scale} className={styles.option} data-selected={selected || undefined}>
            <input
              className={styles.input}
              type="radio"
              name="ui-scale"
              value={String(scale)}
              aria-label={WORDS[scale]}
              checked={selected}
              onChange={() => {
                if (isUiScale(scale)) onValueChange(scale);
              }}
            />
            <span className={styles.preview} style={{ fontSize: `${scale}rem` }} aria-hidden="true">
              <span className={styles.piece}>
                <span className={styles.icon} />
                <span className={styles.lines}>
                  <span className={styles.line} />
                  <span className={styles.line} data-short="true" />
                </span>
                <span className={styles.switch}>
                  <span className={styles.knob} />
                </span>
              </span>
            </span>
            <span className={styles.label}>{WORDS[scale]}</span>
          </label>
        );
      })}
    </div>
  );
}
