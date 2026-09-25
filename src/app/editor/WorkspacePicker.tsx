import { useState } from 'react';
import { Workspace as WorkspaceIcon } from '../art/Icons.tsx';
import { addWorkspace, fileNote, useWorkspaces, workspaceOf } from '../core/workspaces.ts';
import { SheetField, SheetGroup, SheetNote, SheetRow, SheetTitle } from '../plugins/kit.tsx';

/**
 * Where a note is filed, on its cog sheet: the workspaces to choose from with
 * the note's own ticked, a name for a new one that files the note there as it
 * is made, and a way out of the one it is in. The first workspace is made
 * here as often as on the list: a note is where the thought of sorting comes.
 */
export function WorkspacePicker({ noteId, onDone }: { noteId: string; onDone: () => void }) {
  const { list } = useWorkspaces();
  const filed = workspaceOf(noteId);
  const [name, setName] = useState('');
  const choose = (id: string | null) => {
    fileNote(noteId, id);
    onDone();
  };
  const make = () => {
    const made = addWorkspace(name);
    if (made) choose(made.id);
  };
  return (
    <>
      <SheetTitle>Workspace</SheetTitle>
      <SheetNote>{list.length ? 'Notes in a workspace show together on the list.' : 'A name to file notes under. The list can then show one workspace at a time.'}</SheetNote>
      {list.length ? (
        <SheetGroup>
          {list.map((workspace) => (
            <SheetRow key={workspace.id} icon={WorkspaceIcon} label={workspace.name} chosen={filed?.id === workspace.id} onPress={() => choose(workspace.id)} />
          ))}
        </SheetGroup>
      ) : null}
      <SheetGroup>
        <SheetField
          label="New workspace"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoCapitalize="words"
          enterKeyHint="done"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              make();
            }
          }}
        />
        <SheetRow label="Add it and file this note there" onPress={make} disabled={!name.trim()} />
      </SheetGroup>
      {filed ? (
        <SheetGroup>
          <SheetRow label={`Take this note out of ${filed.name}`} onPress={() => choose(null)} />
        </SheetGroup>
      ) : null}
    </>
  );
}
