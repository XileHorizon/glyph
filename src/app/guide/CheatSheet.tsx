import { useMemo, useRef, useState } from 'react';
import { Search, X } from '@glacier/icons';
import { markGroups, type MarkRow } from './marks.ts';
import { MarkExample } from './MarkExample.tsx';
import styles from './CheatSheet.module.css';

/**
 * The cheat sheet: every formatting character, and nothing else (Matt: "redo the UI for the cheatsheet dont include
 * anything but formatting characters and condense the UI and bring in more organization and structure", and then
 * "the cheatsheet is disorganized and ugly please redo it with better iconography and layout also make sure were
 * using the real formatters as some things like spoilers isnt using the right one (wisp)").
 *
 * So: a field to find a mark by name or by the characters themselves, a line of chips to jump by group, and a card
 * for each mark - its icon, its name, the characters in a ring, the line to type, and under a rule the same line as
 * the note itself draws it (guide/MarkExample.tsx is the note's editor, read-only, so the spoiler here is the real
 * smoke and the code block the real highlighter).
 *
 * The rows are `guide/marks.ts` still, so a plugin switched off is not promised here and a new mark arrives on its
 * own. The voice cues live where they are taught, in Settings > Help > How to talk to Glyph (guide/phrases.ts).
 */
export function CheatSheet() {
  const groups = useMemo(() => markGroups(), []);
  const sheet = useRef<HTMLDivElement>(null);
  const [looking, setLooking] = useState('');

  /** What is left after the field: a mark is found by its name, its characters, or the words of its example. */
  const found = useMemo(() => {
    const words = looking.trim().toLowerCase();
    if (!words) return groups;
    return groups
      .map((group) => ({
        ...group,
        rows: group.rows.filter((row) => [row.name, row.symbol, row.typed, row.words].some((part) => part.toLowerCase().includes(words))),
      }))
      .filter((group) => group.rows.length);
  }, [groups, looking]);

  /** The chips are a way down a long page: the group's heading goes to the top of whatever is scrolling. */
  const jump = (title: string) => {
    sheet.current?.querySelector(`[data-group="${CSS.escape(title)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  return (
    <div ref={sheet} className={styles.sheet}>
      <div className={styles.sticky}>
        <div className={styles.find}>
          <span className={styles.findIcon} aria-hidden="true">
            <Search size={16} />
          </span>
          <input
            className={styles.findField}
            type="search"
            inputMode="search"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Find a mark"
            aria-label="Find a mark"
            value={looking}
            onChange={(event) => setLooking(event.target.value)}
          />
          {looking ? (
            <button type="button" className={styles.findClear} aria-label="Clear" onClick={() => setLooking('')}>
              <X size={16} />
            </button>
          ) : null}
        </div>

        {looking ? null : (
          <nav className={styles.chips} aria-label="The groups of marks">
            {groups.map((group) => (
              <button key={group.title} type="button" className={styles.chip} onClick={() => jump(group.title)}>
                {group.title}
              </button>
            ))}
          </nav>
        )}
      </div>

      {found.map((group) => (
        <section key={group.title} className={styles.group} data-group={group.title}>
          <header className={styles.groupHead}>
            <h2 className={styles.title}>{group.title}</h2>
            <p className={styles.lead}>{group.lead}</p>
          </header>
          <div className={styles.cards}>
            {group.rows.map((row) => (
              <Card key={row.name} row={row} />
            ))}
          </div>
        </section>
      ))}

      {found.length ? null : <p className={styles.nothing}>No mark by that name. Try “bold”, “||” or “board”.</p>}
    </div>
  );
}

/** One mark: its icon and name, the characters, what to type, and the same line as the note draws it. */
function Card({ row }: { row: MarkRow }) {
  const Icon = row.icon;
  return (
    <article className={styles.card} data-looks={row.looks}>
      <header className={styles.head}>
        <span className={styles.icon} aria-hidden="true">
          <Icon size={16} />
        </span>
        <h3 className={styles.name}>{row.name}</h3>
        <code className={styles.symbol}>{row.symbol}</code>
      </header>
      <p className={styles.label}>Type</p>
      <pre className={styles.typed}>{row.typed}</pre>
      <p className={styles.label}>Reads</p>
      <div className={styles.shown}>
        <MarkExample row={row} />
      </div>
    </article>
  );
}
