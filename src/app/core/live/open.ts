import type { EditorView } from '@codemirror/view';
import { bindLive, unbindLive } from '../../editor/liveBinding.ts';
import { announceNotesChanged, createNote, getNote, newNoteId } from '../store.ts';
import { hasUnsyncedChanges } from '../sync/engine.ts';
import { closeLive, openLive } from './hub.ts';
import type { LiveSession } from './session.ts';

/**
 * A note's editor made live (docs/LIVE.md): the one door the note screen uses.
 *
 * Loaded only when live sync is switched on (editor/NoteScreen.tsx imports it on demand), so Yjs and the CodeMirror
 * binding arrive with it and not before - the app everyone downloads is the same size with it off. Answers how to
 * stop: unbind the editor, leave the room, and let the connection go with the last note.
 */
export async function goLive(view: EditorView, noteId: string, onPeers: (count: number) => void): Promise<() => void> {
  let session: LiveSession | null = null;
  let bound = false;
  const bind = () => {
    if (!session || bound || session.state !== 'ready') return;
    bindLive(view, session);
    bound = true;
  };
  session = await openLive(
    noteId,
    view.state.doc.toString(),
    { ready: bind, peers: onPeers },
    {
      // The saved note, not the editor's words: the saved one is what the pass sync compares.
      hasUnsynced: async (id) => {
        const note = await getNote(id);
        return note ? hasUnsyncedChanges(note) : false;
      },
      // This device's own words, kept beside the room's: a conflict makes a copy, never a loss.
      keepCopy: async (_id, words) => {
        await createNote(newNoteId(), words, 'editor');
        announceNotesChanged();
      },
    },
  );
  if (!session) return () => undefined;
  // Ready before the session was in hand is not possible over a network, but costs nothing to allow for.
  bind();
  return () => {
    if (bound) {
      try {
        unbindLive(view);
      } catch {
        // The editor went first (its note closed): nothing left to unbind.
      }
    }
    closeLive(noteId);
    onPeers(0);
  };
}
