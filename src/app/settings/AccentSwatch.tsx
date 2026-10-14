import { Check } from '@glacier/icons';
import { ACCENTS, type Accent } from '../core/preferences.ts';
import styles from './AccentSwatch.module.css';

/**
 * The app's one colour, chosen from a swatch (Matt: "add ... the accent color picker").
 *
 * Ink first, which is Glyph's own answer and no accent at all, then the colours the kit carries. Each dot wears
 * `data-accent` itself, so what it shows is the very ramp that choosing it would put on the app (tokens.css), drawn
 * by the kit rather than by a list of hex values kept here - a retuned kit retunes the swatch.
 *
 * A radio group: the arrow keys move between them, and the chosen one is ticked as well as ringed, so it is never
 * colour alone that says which is picked. Ink's dot is the page's own ink, which is exactly what it does.
 */
export function AccentSwatch({ accent, onAccent }: { accent: Accent; onAccent: (accent: Accent) => void }) {
  return (
    <div className={styles.swatch} role="radiogroup" aria-label="Accent">
      {ACCENTS.map((one) => (
        <button
          key={one}
          type="button"
          role="radio"
          aria-checked={one === accent}
          aria-label={NAMES[one]}
          title={NAMES[one]}
          className={styles.dot}
          {...(one === 'ink' ? {} : { 'data-accent': one })}
          data-ink={one === 'ink' ? '' : undefined}
          tabIndex={one === accent ? 0 : -1}
          onClick={() => onAccent(one)}
          onKeyDown={(event) => {
            const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
            if (!step) return;
            event.preventDefault();
            const at = ACCENTS.indexOf(accent);
            const next = ACCENTS[(at + step + ACCENTS.length) % ACCENTS.length];
            if (next) onAccent(next);
          }}
        >
          {one === accent ? <Check size={14} aria-hidden="true" /> : null}
        </button>
      ))}
    </div>
  );
}

/** What each one is called, for the finger that cannot see the colour. */
const NAMES: Record<Accent, string> = {
  ink: 'Ink',
  graphite: 'Graphite',
  red: 'Red',
  amber: 'Amber',
  green: 'Green',
  teal: 'Teal',
  purple: 'Purple',
};
