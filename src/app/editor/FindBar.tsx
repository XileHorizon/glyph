import { ChevronDown, ChevronUp, Replace } from '@glacier/icons';
import { useEffect, useReducer, useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import { useBack } from '../core/back.ts';
import { fireNativeHaptic } from '../core/haptics.ts';
import { endSearch, findOf, replaceAll, replaceOne, search, step } from './find.ts';
import styles from './FindBar.module.css';

/**
 * Find and replace, as a bar resting on top of the keyboard (editor/find.ts). Opened from the note's settings sheet,
 * or with a selection's words from the press-and-hold menu. The header stays as it is; the bar is there while it is
 * used and gone after (Matt: "I'm not sure where to put things like this in the UI/UX without messing up the UI").
 *
 * The find field, where the current match is out of how many, the arrows between them, and Replace, which adds a
 * second field with Replace and All. Done, or the back gesture, closes it and leaves the caret on the last match.
 */
export function FindBar({ view, initial, onClose }: { view: EditorView; initial: string; onClose: () => void }) {
  const [query, setQuery] = useState(initial);
  const [replacing, setReplacing] = useState(false);
  const [replacement, setReplacement] = useState('');
  const [said, setSaid] = useState<string | null>(null);
  // The count follows the note's own state, which the arrows and edits change outside React.
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    search(view, query);
    redraw();
  }, [view, query]);

  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);

  const close = () => {
    endSearch(view);
    onClose();
    view.focus();
  };
  useBack(true, close);

  const { matches, current } = findOf(view.state);
  const move = (by: 1 | -1) => {
    step(view, by);
    fireNativeHaptic('selection');
    redraw();
  };

  // A press on a button keeps the keyboard up and the field focused.
  const keep = (event: React.PointerEvent) => event.preventDefault();

  return (
    <div className={styles.bar} role="search" aria-label="Find in this note">
      <div className={styles.row}>
        <input
          ref={field}
          className={styles.field}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          placeholder="Find"
          aria-label="Find"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSaid(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') move(event.shiftKey ? -1 : 1);
            if (event.key === 'Escape') close();
          }}
        />
        <span className={styles.count} aria-live="polite">
          {query ? (matches.length ? `${current + 1} of ${matches.length}` : 'None') : ''}
        </span>
        <button type="button" className={styles.icon} onPointerDown={keep} onClick={() => move(-1)} disabled={!matches.length} aria-label="Previous match">
          <ChevronUp size={20} strokeWidth={2.2} />
        </button>
        <button type="button" className={styles.icon} onPointerDown={keep} onClick={() => move(1)} disabled={!matches.length} aria-label="Next match">
          <ChevronDown size={20} strokeWidth={2.2} />
        </button>
        <button type="button" className={styles.icon} data-on={replacing || undefined} onPointerDown={keep} onClick={() => setReplacing((on) => !on)} aria-pressed={replacing} aria-label="Replace">
          <Replace size={19} strokeWidth={2.1} />
        </button>
        <button type="button" className={`app-word ${styles.word}`} onClick={close}>
          Done
        </button>
      </div>
      {replacing ? (
        <div className={styles.row}>
          <input
            className={styles.field}
            type="text"
            enterKeyHint="done"
            placeholder="Replace with"
            aria-label="Replace with"
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
          />
          <button
            type="button"
            className={`app-word ${styles.word}`}
            onPointerDown={keep}
            disabled={!matches.length}
            onClick={() => {
              replaceOne(view, replacement);
              fireNativeHaptic('selection');
              redraw();
            }}
          >
            Replace
          </button>
          <button
            type="button"
            className={`app-pill ${styles.all}`}
            onPointerDown={keep}
            disabled={!matches.length}
            onClick={() => {
              const count = replaceAll(view, replacement);
              fireNativeHaptic('success');
              setSaid(`Replaced ${count}`);
              redraw();
            }}
          >
            All
          </button>
        </div>
      ) : null}
      {said ? <p className={styles.said}>{said}. Undo takes it back.</p> : null}
    </div>
  );
}
