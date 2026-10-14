import { useEffect, useRef, useState } from 'react';
import { useBack } from '../core/back.ts';
import { addWorkspace, chooseWorkspace, removeWorkspace, renameWorkspace, setWorkspaceHue, type Workspace, type WorkspaceHue } from '../core/workspaces.ts';
import { SheetField, SheetGroup, SheetHeading, SheetNote, SheetRow, SheetTitle } from '../plugins/kit.tsx';
import { WorkspaceSwatch } from './WorkspaceSwatch.tsx';
import sheet from '../editor/NoteSettings.module.css';
import { useSheetDrag } from '../editor/sheetDrag.ts';

/**
 * A workspace's sheet, from the row on the list: a name to add, or the name
 * of one to change, a colour for its pill, and Remove under it. In the note's
 * settings' own look. A new one is chosen as it is made, so the list lands in
 * it with nothing in it yet and the + at the foot writes the first note there.
 *
 * The colour of one that exists is set as it is tapped, since it is a thing to
 * look at rather than a thing to fill in: the pill behind the sheet changes
 * under your finger. A new one carries its colour into the making.
 */
export function WorkspaceSheet({ which, onClose }: { which: Workspace | 'new' | null; onClose: () => void }) {
  const editing = which && which !== 'new' ? which : null;
  const [name, setName] = useState('');
  const [hue, setHue] = useState<WorkspaceHue>('ink');
  const panel = useRef<HTMLElement>(null);
  const drag = useSheetDrag(panel, onClose);
  useEffect(() => {
    setName(editing?.name ?? '');
    setHue(editing?.hue ?? 'ink');
  }, [editing, which]);
  useBack(which !== null, onClose);
  if (!which) return null;

  const clean = name.trim();
  const submit = () => {
    if (!clean) return;
    if (editing) {
      renameWorkspace(editing.id, name);
    } else {
      const made = addWorkspace(name, hue);
      if (made) chooseWorkspace(made.id);
    }
    onClose();
  };
  return (
    <div className={sheet.scrim} onClick={onClose}>
      <section
        ref={panel}
        className={sheet.sheet}
        role="dialog"
        aria-modal="true"
        aria-label={editing ? editing.name : 'New workspace'}
        onClick={(e) => e.stopPropagation()}
      >
        <span className={sheet.grip} aria-hidden="true" {...drag} />
        <SheetTitle>{editing ? editing.name : 'New workspace'}</SheetTitle>
        {editing ? null : <SheetNote>Notes filed in a workspace show together. A note made while one is chosen goes there.</SheetNote>}
        <SheetGroup>
          <SheetField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            autoCapitalize="words"
            enterKeyHint="done"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
          />
          <SheetRow label={editing ? 'Rename' : 'Add'} onPress={submit} disabled={!clean || clean === editing?.name} />
        </SheetGroup>
        <SheetHeading>Colour</SheetHeading>
        <SheetGroup>
          <WorkspaceSwatch
            hue={hue}
            onHue={(picked) => {
              setHue(picked);
              // One that exists changes as it is tapped; a new one wears it when it is made.
              if (editing) setWorkspaceHue(editing.id, picked);
            }}
          />
        </SheetGroup>
        {editing ? (
          <SheetGroup>
            <SheetRow
              label="Remove workspace"
              hint="Its notes stay; they just aren’t filed."
              danger
              onPress={() => {
                removeWorkspace(editing.id);
                onClose();
              }}
            />
          </SheetGroup>
        ) : null}
      </section>
    </div>
  );
}
