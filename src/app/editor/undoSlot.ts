import { history, historyKeymap } from '@codemirror/commands';
import { Compartment, type Extension } from '@codemirror/state';
import { keymap } from '@codemirror/view';

/**
 * Undo, in a slot live sync can swap (docs/LIVE.md, "The binding").
 *
 * A note on its own undoes with CodeMirror's history. A note live on two devices undoes with Yjs's instead, which
 * takes back this person's typing and leaves the other device's alone - CodeMirror's history would undo whatever
 * changed last, whoever changed it. One compartment serves every editor: a Compartment is a key, and each editor's
 * state keeps its own value under it.
 *
 * No Yjs in this file, on purpose: the editor loads it always, and Yjs only comes in when a note goes live
 * (core/live/open.ts), so the app a person downloads is the same size with live sync off.
 */
export const undoSlot = new Compartment();

export function localUndo(): Extension {
  return [history(), keymap.of(historyKeymap)];
}
