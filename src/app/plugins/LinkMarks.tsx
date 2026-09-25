import { useWorkspaces, workspaceOf } from '../core/workspaces.ts';
import { useNoteLinks } from './registry.ts';
import styles from './LinkMarks.module.css';

/**
 * What a note is linked to, worn on the note: a small mark per link, with
 * the name of the thing - the Notion board its list goes to, the GitHub repo
 * the AI reads for it.
 *
 * Matt: "There should be some kind of indication if a note is linked to a
 * given notion board or git project." Until now the only place that said so
 * was the cog sheet, a tap away and out of sight. Now the note says it at its
 * top, under the tape, and the list says it on the row (`compact`: the mark
 * alone, so a row stays one line). Each link's plugin says what the note is
 * linked to (`NoteLink.linked`, plugins/types.ts); a plugin switched off says
 * nothing, and its marks go. A tap opens the cog sheet, where the link is
 * changed or removed.
 *
 * The workspace the note is filed in comes first in the row, as the pill the home page draws it with, in its own
 * hue (Matt: "show the workspace on the view that shows the note itself"): the home page said it and the note did
 * not, so a note opened from a tab or a search gave no sign of where it lived. The same tap opens the cog, where
 * the note is filed (editor/WorkspacePicker.tsx). On a list row (`compact`) the row stays the marks alone.
 */
export function LinkMarks({ noteId, compact = false, onPress }: { noteId: string; compact?: boolean; onPress?: () => void }) {
  const links = useNoteLinks(noteId);
  // Read through the store's hook, so filing the note from the cog redraws the pill.
  useWorkspaces();
  const space = compact ? null : workspaceOf(noteId);
  if (!links.length && !space) return null;
  const marks = links.map(({ link, name }) => {
    const Icon = link.icon;
    return (
      <span key={link.id} className={styles.mark} title={`${link.label}: ${name}`} data-compact={compact || undefined}>
        <span className={styles.icon} aria-hidden="true">
          <Icon />
        </span>
        {compact ? <span className={styles.hidden}>{`${link.label}: ${name}`}</span> : <span className={styles.name}>{name}</span>}
      </span>
    );
  });
  const pill = space ? (
    <span className={styles.space} data-hue={space.hue ?? 'ink'} title={`Workspace: ${space.name}`}>
      {space.name}
    </span>
  ) : null;
  if (onPress) {
    const said = [space ? `In the workspace ${space.name}` : '', links.length ? `Linked to ${links.map((l) => `${l.link.label} ${l.name}`).join(' and ')}` : '']
      .filter(Boolean)
      .join('. ');
    return (
      <button type="button" className={styles.row} onClick={onPress} aria-label={`${said}. Change in this note’s settings.`}>
        {pill}
        {marks}
      </button>
    );
  }
  return (
    <span className={styles.row} data-compact={compact || undefined}>
      {pill}
      {marks}
    </span>
  );
}
