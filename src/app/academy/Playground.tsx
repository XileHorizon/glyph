import { useEffect, useRef } from 'react';
import { Editor } from '../editor/Editor.tsx';
import { isDarkNow, usePreferences } from '../core/preferences.ts';
import styles from './Playground.module.css';

/**
 * The Academy's live page: what you type, and the same thing as a note draws it, right underneath (Matt: "set it up
 * as a live code type thing where it teaches you then you type it and see it format below").
 *
 * The top half is a plain field, in the typewriter face, with nothing helping or hiding: the marks have to be
 * visible, since they are the thing being taught. Autocorrect and autocapitalising are off, or a phone would turn
 * `# weekend` into `# Weekend` and the underscores into quotes while somebody is trying to learn what they do.
 *
 * The bottom half is the note's own editor, read-only and formatted (guide/MarkExample.tsx does the same for the
 * cheat sheet): the real marks drawn by the real app, so what is learned here is what a note does. It is redrawn as
 * the words change, which is the whole point - a star typed is a word gone bold underneath.
 */
export function Playground({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  const field = useRef<HTMLTextAreaElement>(null);
  const prefs = usePreferences();

  /*
   * The field owns what is in it; React only writes to it when the app changed
   * the text (Show me, or the next lesson). Matt, on the phone: "when doing the
   * ## and then hitting space on the academy it shows an extra # and the lesson
   * isn't passed".
   *
   * A phone keyboard composes as you type and commits the word on space. A
   * controlled field writes its value back into the middle of that composition,
   * and the keyboard, which is still holding the letters it thinks are there,
   * commits them again - so the hash arrives twice and `###` passes no heading
   * check. Setting the value only when it really differs leaves the composition
   * alone. The character typed still reaches the lesson through onChange, so
   * the preview and the check are as live as they were.
   */
  useEffect(() => {
    const area = field.current;
    if (!area) return;
    if (area.value !== value) area.value = value;
    // As tall as what is in it, so a list of five lines is not typed through a two-line window.
    area.style.blockSize = 'auto';
    area.style.blockSize = `${Math.max(area.scrollHeight, 0)}px`;
  }, [value]);

  return (
    <div className={styles.playground}>
      <label className={styles.part}>
        <span className={styles.label}>You type</span>
        <textarea
          ref={field}
          className={styles.field}
          defaultValue={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          rows={2}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          // A phone's Enter must make a new line here, not send anything.
          enterKeyHint="enter"
          aria-label="Type the markdown"
        />
      </label>
      <div className={styles.part}>
        <span className={styles.label}>Your note shows</span>
        <div className={styles.shown} aria-live="off">
          {value.trim() ? (
            <Editor
              value={value}
              onChange={keep}
              dark={isDarkNow(prefs.theme)}
              assist={false}
              readOnly
              grow
              display="formatted"
            />
          ) : (
            <p className={styles.waiting}>Whatever you type appears here, drawn the way a note draws it.</p>
          )}
        </div>
      </div>
    </div>
  );
}

/** The editor asks for somewhere to send changes; a read-only one never has any. */
const keep = (_value: string) => undefined;
