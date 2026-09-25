import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { placeWords } from '../src/app/capture/listAppend.ts';
import { Conflict, GlyphApiError, noteTitle, type GlyphAccount, type NoteRecord } from './glyph.ts';

/**
 * The MCP server: Glyph's notes as tools for Claude (docs/MCP.md). Matt: "make an MCP plugin for Claude so I can use
 * Claude to remote control my account and add and update notes as well as read them".
 *
 * Every tool reads the account fresh before it acts, so what Claude sees is what the phone last wrote; a write goes
 * from the revision just read and is refused, never applied, when another device got there first - the tool then
 * says so and shows that device's words. "Append" places words the way a spoken "add task" does (capture/
 * listAppend.ts): into the note's own list, in its style.
 */

export const VERSION = '1.0.0';

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** A note as the tools describe it: what a list needs, and never the whole body unless asked. */
function summary(record: NoteRecord) {
  const { note } = record;
  const lines = note.body.split('\n').map((l) => l.trim()).filter(Boolean);
  const first = lines.findIndex((l) => !/^!\[[^\]]*\]\([^)]*\)$/.test(l));
  const after = lines.slice(first + 1, first + 3).join(' ');
  return {
    id: note.id,
    title: noteTitle(note.body) || 'Untitled',
    updated: iso(note.updatedAt),
    created: iso(note.createdAt),
    pinned: Boolean(note.starred),
    archived: Boolean(note.archivedAt),
    folder: note.path?.includes('/') ? note.path.slice(0, note.path.lastIndexOf('/')) : null,
    hasRecording: Boolean(note.recordingMs),
    preview: after.length > 140 ? `${after.slice(0, 139)}…` : after,
  };
}

function whole(record: NoteRecord) {
  return { ...summary(record), rev: record.rev, body: record.note.body };
}

function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}

function failed(message: string) {
  return { isError: true, content: [{ type: 'text' as const, text: message }] };
}

/** A tool's work, with the account's refusals turned into words rather than a crash. */
async function guarded(run: () => Promise<ReturnType<typeof text> | ReturnType<typeof failed>>) {
  try {
    return await run();
  } catch (failure) {
    if (failure instanceof Conflict) {
      return failed(
        failure.theirs
          ? `${failure.message}\n\nTheir version (read it with read_note and try again):\n${JSON.stringify(whole(failure.theirs), null, 2)}`
          : failure.message,
      );
    }
    if (failure instanceof GlyphApiError) return failed(`Ghost.md's sync service refused: ${failure.message}`);
    return failed(failure instanceof Error ? failure.message : String(failure));
  }
}

/** The note `id` or, failing that, the one titled `title`; a clear complaint when neither finds one. */
async function find(account: GlyphAccount, id: string | undefined, title: string | undefined): Promise<NoteRecord> {
  if (id) {
    const found = await account.get(id);
    if (found) return found;
    throw new Error(`No note with the id ${id}. Use list_notes to find it.`);
  }
  if (title) {
    const found = await account.byTitle(title);
    if (found) return found;
    const near = (await account.list({ archived: true })).filter((r) => noteTitle(r.note.body).toLowerCase().includes(title.trim().toLowerCase()));
    if (near.length === 1) return near[0]!;
    throw new Error(
      near.length
        ? `Several notes could be "${title}": ${near.map((r) => `${noteTitle(r.note.body)} (${r.note.id})`).join(', ')}. Say which by id.`
        : `No note titled "${title}". Use list_notes or search_notes to find it.`,
    );
  }
  throw new Error('Say which note: its id (from list_notes) or its title.');
}

/**
 * What only the hosted server knows (mcp/hosted.ts): how many Claude connections an account has right now, and how to
 * end them all. The local server is one connection and has nothing to end but itself, so it hands nothing in.
 */
export interface HostedHooks {
  /** Live connections to this account, this one included. */
  connections: () => number;
  /** Ends every connection to this account, this one included; answers how many it ended. */
  signOutEverywhere: () => number;
}

export function buildServer(account: GlyphAccount, hosted?: HostedHooks): McpServer {
  const server = new McpServer({ name: 'glyph', version: VERSION });

  server.registerTool(
    'list_notes',
    {
      title: 'List notes',
      description:
        'The notes in this Ghost.md account, newest change first: id, title, dates, pinned, archived, folder and a line of preview. Optionally only those whose title contains `query`. Reads the account fresh first.',
      inputSchema: {
        query: z.string().optional().describe('Only notes whose title contains this (case-insensitive).'),
        include_archived: z.boolean().optional().describe('Include archived notes. Off by default.'),
        limit: z.number().int().min(1).max(500).optional().describe('At most this many, default 50.'),
      },
    },
    async ({ query, include_archived, limit }) =>
      guarded(async () => {
        await account.pull();
        const want = query?.trim().toLowerCase();
        const notes = (await account.list({ archived: Boolean(include_archived) })).filter((r) => !want || noteTitle(r.note.body).toLowerCase().includes(want));
        return text({ count: notes.length, notes: notes.slice(0, limit ?? 50).map(summary) });
      }),
  );

  server.registerTool(
    'read_note',
    {
      title: 'Read a note',
      description: 'A note in full: its markdown body and what the account knows about it. Give its id (from list_notes) or its exact title.',
      inputSchema: {
        id: z.string().optional().describe('The note’s id.'),
        title: z.string().optional().describe('The note’s title, when the id is not known.'),
      },
    },
    async ({ id, title }) =>
      guarded(async () => {
        await account.pull();
        return text(whole(await find(account, id, title)));
      }),
  );

  server.registerTool(
    'search_notes',
    {
      title: 'Search notes',
      description: 'Notes whose words contain `query` (case-insensitive), each with a snippet around the first match. Titles and bodies both count.',
      inputSchema: {
        query: z.string().min(1).describe('What to look for.'),
        include_archived: z.boolean().optional(),
        limit: z.number().int().min(1).max(200).optional().describe('At most this many, default 20.'),
      },
    },
    async ({ query, include_archived, limit }) =>
      guarded(async () => {
        await account.pull();
        const want = query.trim().toLowerCase();
        const hits = (await account.list({ archived: Boolean(include_archived) }))
          .map((record) => {
            const at = record.note.body.toLowerCase().indexOf(want);
            if (at < 0) return null;
            const from = Math.max(0, at - 80);
            const snippet = `${from > 0 ? '…' : ''}${record.note.body.slice(from, at + want.length + 80).replace(/\s+/g, ' ')}${at + want.length + 80 < record.note.body.length ? '…' : ''}`;
            return { ...summary(record), snippet };
          })
          .filter((hit): hit is NonNullable<typeof hit> => hit !== null);
        return text({ count: hits.length, notes: hits.slice(0, limit ?? 20) });
      }),
  );

  server.registerTool(
    'create_note',
    {
      title: 'Create a note',
      description:
        'A new note in the account, as if typed in the app: markdown, with the first line as its title. Give a `title` and it becomes a `# Title` heading above the body. It appears on every signed-in device at its next sync.',
      inputSchema: {
        body: z.string().describe('The note’s markdown. Ghost.md’s marks all work: headings, lists, `- [ ]` to-dos, tables, ```board fences.'),
        title: z.string().optional().describe('A title to put above the body as a heading, if the body does not start with one.'),
        pinned: z.boolean().optional().describe('Pin it to the top of the list.'),
      },
    },
    async ({ body, title, pinned }) =>
      guarded(async () => {
        const heading = title?.trim();
        const words = heading && !/^#\s/.test(body.trimStart()) ? `# ${heading}\n\n${body.trim()}` : body;
        if (!words.trim()) return failed('A note needs some words.');
        const made = await account.create(words, { pinned: Boolean(pinned) });
        return text({ created: whole(made) });
      }),
  );

  server.registerTool(
    'update_note',
    {
      title: 'Replace a note’s body',
      description:
        'The whole markdown body of a note replaced with `body`. Read the note first and send it back changed: this writes from the version last read, and if another device changed the note meanwhile the write is refused and their version shown, never overwritten. For adding a line or a task to the end of a note, prefer append_to_note.',
      inputSchema: {
        id: z.string().describe('The note’s id.'),
        body: z.string().describe('The new markdown body, whole.'),
      },
    },
    async ({ id, body }) =>
      guarded(async () => {
        await account.pull();
        if (!body.trim()) return failed('A note needs some words. To remove a note, archive it with set_note_flags.');
        const written = await account.edit(id, (note) => ({ ...note, body }));
        return text({ updated: whole(written) });
      }),
  );

  server.registerTool(
    'append_to_note',
    {
      title: 'Add to a note',
      description:
        'Words added to a note the way the app’s own "add task" does: a task or an item joins the note’s list, in the list’s own style, or starts one; a paragraph goes on the end. Safe against another device editing at the same time.',
      inputSchema: {
        id: z.string().optional().describe('The note’s id.'),
        title: z.string().optional().describe('Or its title.'),
        text: z.string().min(1).describe('What to add. Several items may be given with commas.'),
        as: z.enum(['task', 'item', 'paragraph', 'auto']).optional().describe('`task` for a `- [ ]` to-do, `item` for a bullet, `paragraph` for a line of its own, `auto` (default) to put it where it fits.'),
      },
    },
    async ({ id, title, text: words, as }) =>
      guarded(async () => {
        await account.pull();
        const target = await find(account, id, title);
        const how = as === 'task' || as === 'item' ? 'item' : as === 'paragraph' ? 'paragraph' : 'leave';
        let added: string[] = [];
        const written = await account.edit(target.note.id, (note) => {
          const placed = placeWords(note.body, words, { how, task: as === 'task', many: false });
          added = placed.added;
          return { ...note, body: placed.body };
        });
        return text({ added, note: summary(written) });
      }),
  );

  server.registerTool(
    'set_note_flags',
    {
      title: 'Pin or archive a note',
      description: 'Pin a note to the top of the list, or archive it (out of the list, kept). Either can be undone by setting it back.',
      inputSchema: {
        id: z.string().describe('The note’s id.'),
        pinned: z.boolean().optional(),
        archived: z.boolean().optional(),
      },
    },
    async ({ id, pinned, archived }) =>
      guarded(async () => {
        await account.pull();
        if (pinned === undefined && archived === undefined) return failed('Say what to set: pinned, archived, or both.');
        const written = await account.edit(id, (note) => ({
          ...note,
          ...(pinned === undefined ? {} : { starred: pinned }),
          ...(archived === undefined ? {} : { archivedAt: archived ? (note.archivedAt ?? Date.now()) : null }),
        }));
        return text({ note: summary(written) });
      }),
  );

  server.registerTool(
    'account_status',
    {
      title: 'Account status',
      description: 'Which Ghost.md account this is signed in to, where its sync service is, and how many notes it holds.',
      inputSchema: {},
    },
    async () =>
      guarded(async () => {
        const { changed } = await account.pull();
        const notes = await account.list({ archived: true });
        return text({
          handle: account.handle,
          service: account.api,
          notes: notes.length,
          archived: notes.filter((r) => r.note.archivedAt).length,
          pinned: notes.filter((r) => r.note.starred).length,
          changedSinceLastRead: changed,
          // Several Claude accounts, or Claude on several computers, can be signed in to one Ghost.md account (docs/
          // MCP.md); this says how many are, so a person can tell (Matt: "can I connect multiple Claude accounts").
          connections: hosted ? hosted.connections() : 1,
        });
      }),
  );

  if (hosted) {
    server.registerTool(
      'sign_out_everywhere',
      {
        title: 'Sign out everywhere',
        description:
          'Ends every Claude connection to this Ghost.md account - every Claude account and every computer signed in to it, this one included. Each signs in again on the page. For a connection you no longer want, or a key you no longer trust here.',
        inputSchema: {},
      },
      async () => text({ endedConnections: hosted.signOutEverywhere() }),
    );
  }

  return server;
}
