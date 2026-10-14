import { Check } from '@glacier/icons';
import { WORKSPACE_HUES, type WorkspaceHue } from '../core/workspaces.ts';
import styles from './WorkspaceSwatch.module.css';

/**
 * A workspace's colour, chosen from a swatch (Matt: "add the ability to choose from a swatch of colours for the
 * workspace pill colour").
 *
 * Six hues and the app's own ink, as dots in a row. The app is grey everywhere else on purpose, so this is the one
 * place a colour carries meaning - which workspace a note is in, seen without reading - and each hue is drawn at the
 * lightness its paper needs, so the same choice reads on white and on black (ink.css).
 *
 * The dots are a radio group: one is chosen, the arrow keys move between them, and the chosen one wears a tick
 * rather than only a ring, so it is not colour alone that says which.
 */
export function WorkspaceSwatch({ hue, onHue }: { hue: WorkspaceHue; onHue: (hue: WorkspaceHue) => void }) {
  return (
    <div className={styles.swatch} role="radiogroup" aria-label="Colour">
      {WORKSPACE_HUES.map((one) => (
        <button
          key={one}
          type="button"
          role="radio"
          aria-checked={one === hue}
          aria-label={NAMES[one]}
          title={NAMES[one]}
          className={styles.dot}
          data-hue={one}
          tabIndex={one === hue ? 0 : -1}
          onClick={() => onHue(one)}
          onKeyDown={(event) => {
            const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
            if (!step) return;
            event.preventDefault();
            const at = WORKSPACE_HUES.indexOf(hue);
            const next = WORKSPACE_HUES[(at + step + WORKSPACE_HUES.length) % WORKSPACE_HUES.length];
            if (next) onHue(next);
          }}
        >
          {one === hue ? <Check size={14} aria-hidden="true" /> : null}
        </button>
      ))}
    </div>
  );
}

/** What each hue is called, for the finger that cannot see the colour. */
const NAMES: Record<WorkspaceHue, string> = {
  ink: 'Ink',
  ember: 'Ember',
  amber: 'Amber',
  moss: 'Moss',
  sea: 'Sea',
  violet: 'Violet',
  rose: 'Rose',
};
