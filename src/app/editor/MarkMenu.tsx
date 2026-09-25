import { CircleCheck, ExternalLink, PencilLine, RefreshCw, RotateCcw, Unlink } from '@glacier/icons';
import { useEffect, useReducer, useRef, useState, type ComponentType } from 'react';
import { useBack } from '../core/back.ts';
import { fireNativeHaptic } from '../core/haptics.ts';
import { agoText, markActions, onMarkDetails, openMarked, peekMarkDetails, wantMarkDetails, type MarkAction } from '../core/markDetails.ts';
import sheet from './NoteSettings.module.css';
import { useSheetDrag } from './sheetDrag.ts';
import styles from './MarkMenu.module.css';

/**
 * The drawer a linked line's row opens (editor/linkedRows.ts).
 *
 * Matt: "tap on the notion pills to show a few options like opening the ticket
 * in notion or un linking or updating etc. … make the options typography and
 * iconography heavy so they fit the theme on all context menus." It first
 * split the note open at the line; then "the notion opener should open in a
 * drawer instead of rendering in place". So it rises from the bottom over the
 * dimmed note, in the note settings' sheet: the task in the note's own type
 * (its title set large, its stage and status above, its properties in two
 * quiet columns) and then the things to do, each a full-width row with a drawn
 * icon and a word in display weight:
 *
 * - Open in Notion
 * - Mark done in Notion, or Reopen (the board's own first done or to-do status)
 * - Use these words as its title, when the item's words and the task's title differ
 * - Refresh
 * - Unlink: the link comes off the line and the words stay
 *
 * Opening it reads the task fresh. It closes on a tap on the dimmed note or the
 * back gesture; an action that changes the note closes it.
 */

export interface MarkMenuProps {
  name: string;
  url: string;
  words: string;
  say(message: string): void;
  close(): void;
  unlink(): void;
}

const ICONS: Record<MarkAction['icon'], ComponentType<{ size?: number; strokeWidth?: number }>> = {
  done: CircleCheck,
  reopen: RotateCcw,
  rename: PencilLine,
};

export function MarkMenu({ name, url, words, say, close, unlink }: MarkMenuProps) {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const [busy, setBusy] = useState<string | null>(null);
  // The drawer takes a pull on its handle: down far enough and it closes (editor/sheetDrag.ts).
  const panel = useRef<HTMLElement>(null);
  const drag = useSheetDrag(panel, close);
  const title = name.charAt(0).toUpperCase() + name.slice(1);

  useEffect(() => onMarkDetails(redraw), []);
  useEffect(() => wantMarkDetails(name, url, true), [name, url]);
  useBack(true, close);

  const entry = peekMarkDetails(name, url);
  const details = entry?.state === 'ready' ? entry.details : null;
  const reading = entry?.state === 'loading' || (entry?.state === 'ready' && entry.loading);
  const fields = details ? details.fields.filter((field) => !(details.status && /status/i.test(field.label))) : [];
  const actions = markActions(name, url, words);

  const act = async (id: string, run: () => Promise<string | void> | void, busyWords?: string) => {
    fireNativeHaptic('selection');
    if (busyWords) setBusy(id);
    try {
      const said = await run();
      if (said) {
        fireNativeHaptic('success');
        say(said);
      }
    } catch (failure) {
      fireNativeHaptic('error');
      say(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(null);
    }
  };

  const Row = ({
    id,
    icon: Icon,
    label,
    busyLabel,
    onPress,
    quiet = false,
  }: {
    id: string;
    icon: ComponentType<{ size?: number; strokeWidth?: number }>;
    label: string;
    busyLabel?: string;
    onPress: () => void;
    quiet?: boolean;
  }) => (
    <button type="button" className={styles.option} data-quiet={quiet || undefined} disabled={busy !== null} onClick={onPress}>
      <span className={styles.icon} aria-hidden="true">
        <Icon size={18} strokeWidth={2.2} />
      </span>
      <span className={styles.label}>{busy === id && busyLabel ? busyLabel : label}</span>
    </button>
  );

  return (
    <div className={sheet.scrim} onClick={close}>
      <section
        ref={panel}
        className={`${sheet.sheet} ${styles.drawer}`}
        role="dialog"
        aria-modal="true"
        aria-label={`${title} ${details?.title ?? 'link'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <span className={sheet.grip} aria-hidden="true" {...drag} />
        <div className={styles.head}>
          <p className={styles.eyebrow}>
            <span>{title}</span>
            {details?.gone ? <span className={styles.status}>In trash</span> : null}
            {details?.status && !details.gone ? (
              <span className={styles.status} data-stage={details.status.stage}>
                <span className={styles.stage} aria-hidden="true" />
                {details.status.label}
              </span>
            ) : null}
            {details?.brief.map((fact) => (
              <span key={fact} className={styles.fact}>
                {fact}
              </span>
            ))}
          </p>
          <p className={styles.title}>{details?.title || words || 'Linked'}</p>
          {fields.length ? (
            <dl className={styles.fields}>
              {fields.map((field) => (
                <div key={field.label} className={styles.field}>
                  <dt>{field.label}</dt>
                  <dd>{field.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          <p className={styles.quiet}>
            {entry?.state === 'failed'
              ? entry.message
              : details
                ? `${details.editedAt ? `Changed ${agoText(details.editedAt)} · ` : ''}${reading ? 'Reading…' : `Read ${agoText(details.readAt)}`}`
                : reading
                  ? `Reading from ${title}…`
                  : `Ghost.md can’t read ${title} right now.`}
          </p>
        </div>

        <div className={styles.options}>
          <Row
            id="open"
            icon={ExternalLink}
            label={`Open in ${title}`}
            onPress={() =>
              void act('open', async () => {
                close();
                await openMarked(name, details?.url || url);
              })
            }
          />
          {actions.map((action) => (
            <Row
              key={action.id}
              id={action.id}
              icon={ICONS[action.icon]}
              label={action.label}
              busyLabel={action.busyLabel}
              onPress={() => void act(action.id, action.run, action.busyLabel)}
            />
          ))}
          <Row
            id="refresh"
            icon={RefreshCw}
            label={reading ? 'Reading…' : 'Refresh'}
            onPress={() =>
              void act('refresh', () => {
                wantMarkDetails(name, url, true);
                redraw();
              })
            }
          />
          <Row
            id="unlink"
            icon={Unlink}
            label="Unlink"
            quiet
            onPress={() =>
              void act('unlink', async () => {
                unlink();
                return 'Unlinked. The words stay.';
              })
            }
          />
        </div>
      </section>
    </div>
  );
}
