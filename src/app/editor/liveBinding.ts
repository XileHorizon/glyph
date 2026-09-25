import { keymap, type EditorView } from '@codemirror/view';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import * as Y from 'yjs';
import type { LiveSession } from '../core/live/session.ts';
import { localUndo, undoSlot } from './undoSlot.ts';

/**
 * A note's editor bound to its live document (docs/LIVE.md, "The binding"), and unbound again.
 *
 * The editor is brought to the document's words first, read now rather than when the session said it was ready:
 * another device may have typed in between, and the binding assumes the two start equal. Then CodeMirror's undo is
 * swapped for Yjs's (editor/undoSlot.ts), with its keys - `yCollab` handles the phone keyboard's undo on its own, but
 * not Cmd-Z, which needs the keymap alongside it.
 */
export function bindLive(view: EditorView, session: LiveSession): void {
  const words = session.text.toString();
  if (view.state.doc.toString() !== words) {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: words } });
  }
  const undoManager = new Y.UndoManager(session.text);
  view.dispatch({
    effects: undoSlot.reconfigure([yCollab(session.text, null, { undoManager }), keymap.of(yUndoManagerKeymap)]),
  });
}

export function unbindLive(view: EditorView): void {
  view.dispatch({ effects: undoSlot.reconfigure(localUndo()) });
}
