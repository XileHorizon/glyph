import { useMemo } from 'react';
import { markGroups } from './marks.ts';
import { MarkExample } from './MarkExample.tsx';
import styles from './MarksTable.module.css';

/**
 * The guide's table of marks: every way a note can be formatted, what to type, how it comes out, and how to say it
 * while recording (Matt: "create a guide page, it should show every formatting mode we have in a table and show you
 * an example of how it works").
 *
 * A row is the mark with its icon, the line to type with its marks visible, and the same line drawn by the note's
 * own editor (guide/MarkExample.tsx), so what is promised here is what the app does with those characters. The rows
 * come from guide/marks.ts, which reads the switched-on plugins, so Glyph's own marks are listed with the app's and
 * a plugin switched off is never promised.
 *
 * On a phone it is two columns, "you type" and "it reads".
 */
export function MarksTable() {
  const groups = useMemo(() => markGroups(), []);
  return (
    <div className={styles.table}>
      {groups.map((group) => (
        <section key={group.title} className={styles.group}>
          <h2 className={styles.groupTitle}>{group.title}</h2>
          <p className={styles.groupLead}>{group.lead}</p>
          <div className={styles.rows} role="table" aria-label={`${group.title}: what to type, and how it reads`}>
            <div className={styles.head} role="row">
              <span role="columnheader">You type</span>
              <span role="columnheader">It reads</span>
            </div>
            {group.rows.map((row) => {
              const Icon = row.icon;
              return (
                <div key={row.name} className={styles.row} role="row" data-looks={row.looks}>
                  <div className={styles.typed} role="cell">
                    <span className={styles.mark}>
                      <span className={styles.icon} aria-hidden="true">
                        <Icon size={15} />
                      </span>
                      <code className={styles.symbol}>{row.symbol}</code>
                    </span>
                    <pre className={styles.code}>{row.typed}</pre>
                  </div>
                  <div className={styles.shown} role="cell">
                    <span className={styles.name}>{row.name}</span>
                    <MarkExample row={row} />
                    {row.say ? <span className={styles.say}>{row.say}</span> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
