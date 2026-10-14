import { similarity } from '../../capture/route.ts';
import { fireNativeHaptic } from '../../core/haptics.ts';
import { linkedLine } from '../../core/itemLinks.ts';
import type { CaptureContext, ItemTarget, VoiceCommand } from '../types.ts';
import { boardFor, boardLinks, createTask, findTasks, notionReadyNow } from './client.ts';

/**
 * Notion, by voice, while a note is being recorded:
 *
 * - "Send that to Notion" (on its own, or at the end of a phrase whose start is
 *   the thing to send): the words, or the last thing said, become a task on
 *   this note's board, and the words a link to it in the take.
 * - "New task for AttackFM in Notion, …": the recorder puts the item in
 *   AttackFM's list as it would anyway, then this plugin's item target sends
 *   the lines it added to AttackFM's board and links them.
 * - "Add a note for the Notion task for fix login": the task, found by name
 *   across the linked boards (fuzzy, as a note's name is), linked in the take.
 */

/*
 * "Send that to Notion", "put this in Notion", "add it to Notion": the last
 * thing said, as a task. Only as a phrase of its own, or at the end of one
 * ("oat milk, send that to Notion"), whose start is then the thing to send.
 */
const SEND = /^(?:(.*?)[,;.]?\s+)?(?:send|put|add|make|turn)\s+(?:that|this|it)\s+(?:to|in|into|as|a)\s+(?:a\s+)?(?:notion(?:\s+task)?|task\s+in\s+notion)[.!]?\s*$/i;

/** "Add a note for the Notion task for fix login", "note on the Notion task called dark mode". */
const TASK_NOTE = /^\s*(?:(?:add|make|start|take)\s+)?(?:a\s+)?notes?\s+(?:for|on|about|to)\s+(?:the\s+)?notion\s+task\s+(?:for|called|named|about)?\s*([^.!?]+?)[.!?]?\s*$/i;

function tidy(text: string): string {
  return text
    .replace(/\s+and\s*$/i, '')
    .replace(/^[\s,;:]+|[\s,;:]+$/g, '')
    .trim();
}

export function parseSend(text: string): { rest: string } | null {
  const send = SEND.exec(text);
  return send ? { rest: tidy(send[1] ?? '') } : null;
}

export function parseTaskNote(text: string): { name: string } | null {
  const found = TASK_NOTE.exec(text);
  const name = found?.[1] ? found[1].replace(/[.,;:!?"“”]+/g, ' ').replace(/\s+/g, ' ').trim() : '';
  return name.length >= 3 ? { name } : null;
}

const failed = (ctx: CaptureContext, message: string) => {
  ctx.status({ state: 'failed', title: message });
  fireNativeHaptic('warning');
};

const errorText = (failure: unknown) => (failure instanceof Error ? failure.message : String(failure));

/** Lines just put in a note's list, each made a task on that note's board and a link there. */
async function sendLines(noteId: string, lines: string[], ctx: CaptureContext) {
  const board = boardFor(noteId);
  if (!notionReadyNow()) return failed(ctx, 'Notion needs the newest Ghost.md.');
  if (!board) return failed(ctx, 'Link that note to a Notion board first, from its cog.');
  ctx.status({ state: 'working', lead: 'Sending to', title: board.title });
  try {
    const links: Array<{ line: string; url: string }> = [];
    for (const line of lines) {
      const words = line.replace(/^\s*(?:- \[[ xX]\] |[-*+] |\d+[.)] )/, '');
      links.push({ line, url: (await createTask(board, words)).url });
    }
    await ctx.updateNote(noteId, (body) => links.reduce((next, { line, url }) => next.replace(line, linkedLine(line, url)), body));
    ctx.status({ state: 'done', lead: 'In Notion on', title: board.title });
    fireNativeHaptic('success');
  } catch (failure) {
    failed(ctx, errorText(failure));
  }
}

/** The words said (or the last thing said) as a task on this note's board, and a link in the take. */
async function sendWords(words: string, ctx: CaptureContext) {
  const said = ctx.lastSaid();
  if (!words && said?.kind === 'items') return sendLines(said.noteId, said.lines, ctx);
  const text = (words || (said?.kind === 'take' ? said.text : '')).trim();
  if (!text) return failed(ctx, 'Say what to send first, then “send that to Notion”.');
  if (!notionReadyNow()) return failed(ctx, 'Notion needs the newest Ghost.md.');
  const board = boardFor(ctx.noteId());
  if (!board) return failed(ctx, 'Link this note to a Notion board first, from its cog.');
  ctx.status({ state: 'working', lead: 'Sending to', title: board.title });
  try {
    const clean = text.replace(/^(?:bullet(?:\s+point)?|check\s?box|to[\s-]?do|number\s+\w+)[:,.]?\s+/i, '').replace(/[.,;:!?]+$/, '');
    const task = await createTask(board, clean);
    ctx.link(clean, task.url);
    ctx.status({ state: 'done', lead: 'In Notion on', title: board.title });
    fireNativeHaptic('success');
  } catch (failure) {
    failed(ctx, errorText(failure));
  }
}

/** The task called `name` on any linked board, this note's first, linked at the end of the take. */
async function linkTask(name: string, ctx: CaptureContext) {
  if (!notionReadyNow()) return failed(ctx, 'Notion needs the newest Ghost.md.');
  const own = boardFor(ctx.noteId());
  const boards = [...(own ? [own] : []), ...Object.values(boardLinks())].filter((board, i, all) => all.findIndex((b) => b.id === board.id) === i);
  if (!boards.length) return failed(ctx, 'Link a note to a Notion board first, from its cog.');
  ctx.status({ state: 'working', lead: 'Finding', title: name });
  try {
    let best: { title: string; url: string; score: number } | null = null;
    for (const board of boards) {
      for (const task of await findTasks(board, name)) {
        const score = similarity(name, task.title);
        if (!best || score > best.score) best = { title: task.title, url: task.url, score };
      }
      if (best && best.score > 0.9) break;
    }
    if (!best || best.score < 0.6) return failed(ctx, `No Notion task called “${name}”.`);
    ctx.append(`Notion task: [${best.title}](${best.url}).`);
    ctx.status({ state: 'done', lead: 'Linked', title: best.title });
    fireNativeHaptic('success');
  } catch (failure) {
    failed(ctx, errorText(failure));
  }
}

export const sendCommand: VoiceCommand<{ rest: string }> = {
  id: 'notion-send',
  parse: parseSend,
  describe({ rest }, ctx) {
    const said = ctx.lastSaid();
    const what = rest || (said?.kind === 'take' ? said.text : said?.kind === 'items' ? `${said.lines.length === 1 ? 'the item' : `${said.lines.length} items`} just added` : 'what you just said');
    return { title: `Send “${what.replace(/[.,;:!?]+$/, '')}” to Notion`, action: 'Send' };
  },
  run({ rest }, ctx) {
    if (rest) ctx.said(rest);
    void sendWords(rest, ctx);
    return rest || null;
  },
};

export const taskNoteCommand: VoiceCommand<{ name: string }> = {
  id: 'notion-task-note',
  parse: parseTaskNote,
  describe: ({ name }) => ({ title: `Link the Notion task “${name}” here`, action: 'Link' }),
  run({ name }, ctx) {
    void linkTask(name, ctx);
    return null;
  },
};

export const notionItems: ItemTarget = {
  word: 'notion',
  afterAdd(noteId, lines, ctx) {
    void sendLines(noteId, lines, ctx);
  },
};
