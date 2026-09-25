import { Transaction, type Extension, type Text } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { markActions, onMarkDetails, peekMarkDetails, wantMarkDetails } from '../core/markDetails.ts';
import { settleFences } from './boards.ts';
import { linkedOn } from './linkedRows.ts';

/**
 * A linked to-do and its task agree on whether it's done, both ways.
 *
 * Matt, first: "Notion items that are done should automatically update the checked status of the checkbox for the
 * item they're listed in." Then: "notion tasks don't update in sync with linked list item in glyph". A linked item
 * ends with a mark (core/itemLinks.ts), and the plugin behind the mark reads the task back for the pill
 * (core/markDetails.ts). So:
 *
 * - **The task changes, the box follows.** A task that reads as done ticks its `- [ ]`; one reopened unticks its
 *   `- [x]`. An edit to the note, saved like typing, not part of the undo history (undoing a keystroke should not
 *   untick a task Notion says is finished). Once per change of the task: a box set by hand stays as it was set until
 *   the task itself changes again, so the note never fights the person holding it.
 * - **The box changes, the task follows.** Ticking or unticking a linked to-do in the note runs the plugin's own Mark
 *   done or Reopen, the drawer's actions (editor/MarkMenu.tsx). A task that can't be written, or a write that fails,
 *   leaves the box as the person set it, and the next change of the task is the one that moves it.
 *
 * An item linked the old way, its words the link, is the same (linkedOn, editor/linkedRows.ts). Nothing is read here
 * but what a push needs; the pills' own reads (editor/links.ts) are what arrive, for the marks in view while the note
 * is open.
 */

/** A to-do's box: its indent and bullet, then what is in the box. */
const BOX = /^(\s*[-*+] )\[([ xX])\] /;

export interface BoxChange {
  /** The space inside the box. */
  from: number;
  to: number;
  url: string;
  /** What goes in it: "x" for done, " " for not. */
  insert: 'x' | ' ';
  /** When the task last changed as the service says it, or when it was read: the change this answers. */
  stamp: number;
}

/**
 * The boxes to set now: to-dos whose mark's task reads the other way, not already set for that change of the task,
 * and not one the person is sending to the service (`skip`).
 */
export function boxesDue(doc: Text, acted: ReadonlyMap<string, number>, skip: ReadonlySet<string> = new Set()): BoxChange[] {
  const changes: BoxChange[] = [];
  for (let n = 1; n <= doc.lines; n += 1) {
    const line = doc.line(n);
    const box = BOX.exec(line.text);
    if (!box) continue;
    const mark = linkedOn(line.text);
    if (!mark?.item || skip.has(mark.url)) continue;
    const entry = peekMarkDetails(mark.name, mark.url);
    if (entry?.state !== 'ready') continue;
    const { details } = entry;
    if (details.gone || !details.status) continue;
    const done = details.status.stage === 'done';
    if (done === (box[2] !== ' ')) continue;
    const stamp = details.editedAt ?? details.readAt;
    if (acted.get(mark.url) === stamp) continue;
    const at = line.from + (box[1] ?? '').length + 1;
    changes.push({ from: at, to: at + 1, url: mark.url, insert: done ? 'x' : ' ', stamp });
  }
  return changes;
}

/** A box on a linked to-do the person ticked or unticked in this change: the task, and which way. */
export interface Flip {
  name: string;
  url: string;
  done: boolean;
}

/** The linked to-dos whose box `tr` turned, compared line by line with what they were. */
export function flipsIn(tr: Transaction): Flip[] {
  if (!tr.docChanged) return [];
  const flips = new Map<string, Flip>();
  const back = tr.changes.invertedDesc;
  tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    for (let pos = fromB; pos <= toB;) {
      const line = tr.state.doc.lineAt(pos);
      const now = BOX.exec(line.text);
      const mark = now ? linkedOn(line.text) : null;
      if (now && mark?.item) {
        const was = tr.startState.doc.lineAt(Math.min(back.mapPos(line.from, -1), tr.startState.doc.length));
        const before = BOX.exec(was.text);
        const wasMark = before ? linkedOn(was.text) : null;
        const ticked = now[2] !== ' ';
        if (before && wasMark?.url === mark.url && (before[2] !== ' ') !== ticked) flips.set(mark.url, { name: mark.name, url: mark.url, done: ticked });
      }
      pos = line.to + 1;
    }
  });
  return [...flips.values()];
}

export function doneSync(): Extension {
  return ViewPlugin.fromClass(
    class {
      /** The change of each task a box was last set for, by either side. */
      private readonly acted = new Map<string, number>();
      /** Boxes the person set, to send to the service: done or not, and the mark's name. */
      private readonly sending = new Map<string, Flip>();
      /** Sends under way. */
      private readonly inFlight = new Set<string>();
      private readonly off: () => void;
      private timer = 0;
      private gone = false;

      constructor(readonly view: EditorView) {
        this.off = onMarkDetails(() => this.later());
        this.later();
      }

      update(update: ViewUpdate): void {
        if (!update.docChanged) return;
        for (const tr of update.transactions) {
          if (tr.isUserEvent('sync')) continue;
          for (const flip of flipsIn(tr)) this.sending.set(flip.url, flip);
        }
        // A mark pasted or typed in, a box turned, or a composition ending: look again.
        this.later();
      }

      destroy(): void {
        this.gone = true;
        this.off();
        window.clearTimeout(this.timer);
      }

      /** Answers arrive outside an update, and a change cannot be dispatched from inside one: the sync is its own turn. */
      private later(): void {
        if (this.timer) return;
        this.timer = window.setTimeout(() => {
          this.timer = 0;
          this.sync();
        }, 0);
      }

      /** The task as it reads now: its change stamp and whether it's done, or null while unread. */
      private task(flip: Flip): { stamp: number; done: boolean | null } | null {
        const entry = peekMarkDetails(flip.name, flip.url);
        if (entry?.state !== 'ready') return null;
        const { details } = entry;
        return { stamp: details.editedAt ?? details.readAt, done: details.gone || !details.status ? null : details.status.stage === 'done' };
      }

      /** Boxes the person set go to the service, through the plugin's own Mark done or Reopen. */
      private send(): void {
        for (const flip of this.sending.values()) {
          if (this.inFlight.has(flip.url)) continue;
          const task = this.task(flip);
          if (!task) {
            wantMarkDetails(flip.name, flip.url);
            continue;
          }
          const action =
            task.done === null || task.done === flip.done ? null : markActions(flip.name, flip.url, '').find((a) => a.id === (flip.done ? 'done' : 'reopen'));
          if (!action) {
            // Already so, or nothing to write it with: the box stays as set until the task changes.
            this.sending.delete(flip.url);
            this.acted.set(flip.url, task.stamp);
            continue;
          }
          this.inFlight.add(flip.url);
          void action
            .run()
            .catch((failure: unknown) => console.warn('[glyph] the task did not follow its box:', failure))
            .finally(() => {
              this.inFlight.delete(flip.url);
              // Turned again while it was sending: that turn is sent next.
              if (this.sending.get(flip.url)?.done === flip.done) this.sending.delete(flip.url);
              const after = this.task(flip);
              if (after) this.acted.set(flip.url, after.stamp);
              if (!this.gone) this.later();
            });
        }
      }

      private sync(): void {
        // While an IME composes, the document is not touched (glyphLines.ts); the composition's end brings a doc change.
        if (this.gone || this.view.composing) return;
        this.send();
        const changes = boxesDue(this.view.state.doc, this.acted, new Set(this.sending.keys()));
        if (!changes.length) return;
        for (const change of changes) this.acted.set(change.url, change.stamp);
        // A task going done in Notion moves its card the way a tap on the box does, in the same change: the lanes
        // of a board say what its ticks say, however the tick arrived (core/boards.ts, editor/boards.ts).
        const ticks = new Map(changes.map((change) => [this.view.state.doc.lineAt(change.from).number, change.insert !== ' ']));
        this.view.dispatch({
          changes: [...changes.map(({ from, to, insert }) => ({ from, to, insert })), ...settleFences(this.view.state, ticks)],
          annotations: [Transaction.addToHistory.of(false), Transaction.userEvent.of('sync.tick')],
        });
      }
    },
  );
}
