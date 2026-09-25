import { SquareKanban } from '@glacier/icons';
import { fireNativeHaptic } from '../../core/haptics.ts';
import { itemAt, linkedLine, unsentItems } from '../../core/itemLinks.ts';
import { isTauri } from '../../core/tauri.ts';
import type { GlyphPlugin, NoteEditing } from '../types.ts';
import { BoardPicker } from './BoardPicker.tsx';
import { notionDetails } from './details.ts';
import { boardFor, boardLinks, createTask, notionAvailable, notionReadyNow, type Board } from './client.ts';
import { manifest } from './manifest.ts';
import { NotionMark } from './marks.tsx';
import { NotionPane } from './NotionPane.tsx';
import { notionItems, sendCommand, taskNoteCommand } from './voice.ts';

/**
 * The Notion plugin, standard in Glyph: a note linked to a board sends its list
 * items there as tasks, and each item's words become a link to its task.
 *
 * - On a note's cog: "Notion board" under Linked to (BoardPicker), and "Send
 *   list to Notion" once one is linked.
 * - In the note: swipe a list item left to send it.
 * - While recording: the commands in voice.ts.
 * - In Settings: signing in, and the boards Notion shared (NotionPane).
 */

/**
 * What has just been sent from a note, so the same words are never sent twice (Matt: "i click it once and it says
 * sending then nothing happens then i click it again and it fully processes creating the ticket": the task was made
 * both times). Keyed by the note and the words; kept for a few minutes, which is as long as a second press is a
 * second press rather than a person meaning it.
 */
const justSent = new Map<string, { url: string; at: number }>();
const SENT_FOR_MS = 5 * 60 * 1000;

function sentKey(noteId: string, text: string): string {
  return `${noteId}\u0000${text.trim().toLowerCase()}`;
}

function alreadySent(noteId: string, text: string, now = Date.now()): string | null {
  const known = justSent.get(sentKey(noteId, text));
  if (!known) return null;
  if (now - known.at > SENT_FOR_MS) {
    justSent.delete(sentKey(noteId, text));
    return null;
  }
  return known.url;
}

/** For the tests, and for a note that is closed: nothing here outlives the app. */
export function forgetSent(): void {
  justSent.clear();
}

/**
 * Sends list items to Notion from the note on screen: each becomes a task on
 * `board`, and its words a link to it, edited into the note so it is one undo
 * per item and saves like typing. Items are found again by their words after
 * each send, since the note can change while Notion answers; failing that, by
 * the line they were on, so a task that was made always gets its link and the
 * item is never left looking unsent.
 */
async function sendItems(board: Board, items: readonly { text: string; line?: number }[], editing: NoteEditing): Promise<void> {
  let sent = 0;
  let marked = 0;
  for (const item of items) {
    // Sent a moment ago: mark the line with the task that already exists rather than making a second one.
    const had = alreadySent(editing.noteId, item.text);
    if (had) {
      if (markItem(editing, item, had)) marked += 1;
      continue;
    }
    try {
      const task = await createTask(board, item.text);
      justSent.set(sentKey(editing.noteId, item.text), { url: task.url, at: Date.now() });
      sent += 1;
      if (markItem(editing, item, task.url)) marked += 1;
    } catch (failure) {
      editing.say(failure instanceof Error ? failure.message : String(failure));
      return;
    }
  }
  if (sent || marked) {
    fireNativeHaptic('success');
    const made = sent || marked;
    editing.say(`${made === 1 ? 'Sent 1 task' : `Sent ${made} tasks`} to ${board.title}.`);
  }
  // A task was made and its words could not be found to mark: said plainly, because a silent nothing is what makes
  // a person press again.
  if (sent > marked) editing.say(`Made the task in ${board.title}, but the line has changed, so it isn’t marked.`);
}

/** The item's line, marked with its task: by its words, or failing that the line it was on if that is still an item. */
function markItem(editing: NoteEditing, item: { text: string; line?: number }, url: string): boolean {
  const link = (text: string) => linkedLine(text, url, 'notion');
  if (editing.replaceLine((text, line) => itemAt(text, line)?.text === item.text, link)) return true;
  const was = item.line;
  return was !== undefined && editing.replaceLine((text, line) => line === was && itemAt(text, line) !== null, link);
}

export const notionPlugin: GlyphPlugin = {
  manifest,
  icon: SquareKanban,
  settings: { Pane: NotionPane, summary: () => 'Boards for your lists' },
  noteLinks: [
    {
      id: 'notion-board',
      label: 'Notion board',
      icon: NotionMark,
      hint(noteId) {
        const board = boardFor(noteId);
        return board ? `Tasks go to ${board.title}.` : 'Choose where this note’s list items go as tasks.';
      },
      async unavailable() {
        if (!isTauri()) return 'Works in the Ghost.md app on your phone.';
        return (await notionAvailable()) ? null : 'Needs the newest Ghost.md. Update it in Settings.';
      },
      Picker: BoardPicker,
      linked: (noteId) => boardFor(noteId)?.title ?? null,
    },
  ],
  noteActions: [
    {
      id: 'notion-send-list',
      label: 'Send list to Notion',
      icon: NotionMark,
      visible: (noteId) => notionReadyNow() && boardFor(noteId) !== null,
      hint(_noteId, body) {
        const unsent = unsentItems(body).length;
        return unsent
          ? `${unsent} ${unsent === 1 ? 'item isn’t' : 'items aren’t'} there yet. Each becomes a task and a link.`
          : 'Every item is already in Notion.';
      },
      enabled: (_noteId, body) => unsentItems(body).length > 0,
      async run(editing) {
        const board = boardFor(editing.noteId);
        if (board) await sendItems(board, unsentItems(editing.body()), editing);
      },
    },
  ],
  itemAction: {
    id: 'notion-send-item',
    label: 'Notion',
    busyLabel: 'Sending…',
    available: (noteId) => notionReadyNow() && boardFor(noteId) !== null,
    async run(text, editing) {
      const board = boardFor(editing.noteId);
      if (board) await sendItems(board, [{ text }], editing);
    },
  },
  // The quiet "Notion" after each item not sent yet, once a board is linked.
  suggest(noteId, body) {
    const board = boardFor(noteId);
    if (!notionReadyNow() || !board) return [];
    return unsentItems(body).map((item) => ({
      line: item.line,
      label: 'Notion',
      busyLabel: 'Sending',
      run: (editing: NoteEditing) => sendItems(board, [{ text: item.text, line: item.line }], editing),
    }));
  },
  marks: notionDetails,
  voice: [sendCommand, taskNoteCommand],
  itemTargets: [notionItems],
  tips: () => (Object.keys(boardLinks()).length ? [{ say: 'Send that to Notion', does: 'to make what you just said a task' }] : []),
};
