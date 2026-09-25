import { useEffect, useRef, useState } from 'react';
import { Editor } from '../editor/Editor.tsx';
import { isDarkNow, usePreferences } from '../core/preferences.ts';
import type { MarkRow } from './marks.ts';
import styles from './MarkExample.module.css';

/**
 * A mark's example, drawn by the note's own editor (Matt: "make sure were using the real formatters as some things
 * like spoilers isnt using the right one (wisp)").
 *
 * Both pages that show the marks used to draw their own version of each one in CSS, which meant the cheat sheet and
 * the note could disagree - a spoiler was a blur here and smoke there. This is the editor itself, read-only, with
 * the same extensions and the same plugins the note has: the spoiler is the real wisp, the code block is the real
 * highlighter, a board is a real board. A mark that changes in the app changes here on its own.
 *
 * An editor a row is a real thing to build, so a row builds one when it comes near the screen and not before.
 */
export function MarkExample({ row, marks = false }: { row: MarkRow; marks?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const prefs = usePreferences();

  useEffect(() => {
    const where = host.current;
    if (!where || near) return undefined;
    if (typeof IntersectionObserver !== 'function') {
      setNear(true);
      return undefined;
    }
    // A screen's worth of warning, so a row is drawn before it is looked at.
    const watch = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { rootMargin: '400px' },
    );
    watch.observe(where);
    return () => watch.disconnect();
  }, [near]);

  return (
    <div ref={host} className={styles.example} data-looks={row.looks}>
      {near ? (
        <Editor
          value={row.typed}
          // Read-only: nothing is typed here, so nothing comes back.
          onChange={keep}
          dark={isDarkNow(prefs.theme)}
          assist={false}
          readOnly
          grow
          // The marks themselves are on the other side of the card; this side is the line as it comes out.
          display={marks ? 'mixed' : 'formatted'}
        />
      ) : (
        // Something the height of a line while the editor is on its way, so the page does not jump as it fills in.
        <p className={styles.waiting} aria-hidden="true">
          {row.words || row.name}
        </p>
      )}
    </div>
  );
}

/** The editor asks for somewhere to send changes; a read-only one never has any. */
const keep = (_value: string) => undefined;
