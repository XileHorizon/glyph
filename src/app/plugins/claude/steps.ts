import { API_BASE } from '../../core/account/api.ts';

/**
 * The words of Settings › Claude and its instructions drawer (ClaudePane.tsx, ClaudeGuide.tsx): where Claude
 * connects, the two ways in, and what it can do once it is. The same facts as docs/MCP.md, said for a phone.
 *
 * The addresses follow the sync service this build talks to (core/account/api.ts), so a staging or local build
 * points Claude at its own server rather than the real one.
 */

/** Where Claude connects: the hosted MCP server, reached through the sync service (mcp/hosted.ts). */
export const MCP_URL = `${API_BASE}/mcp`;

/** The one-file server for a person's own computer, published beside the app (scripts/deploy-ota.mjs --mcp). */
export const LOCAL_FILE_URL = API_BASE.replace(/\/api$/, '/mcp/glyph-mcp.mjs');

export type Way = 'hosted' | 'local';

export interface Step {
  title: string;
  body: string;
  /** Things to copy, each shown as a block with a Copy: an address, a command, a piece of a config file. */
  snippets?: string[];
}

export interface Guide {
  way: Way;
  label: string;
  /** One line on what this way is, above the steps. */
  lead: string;
  steps: Step[];
}

/**
 * The steps, one way at a time. `handle` fills the local sign-in command with the person's own handle when this
 * device is signed in, so it can be copied and run as it is.
 */
export function guides(handle: string | null): Guide[] {
  const who = handle ?? '<your handle>';
  return [
    {
      way: 'hosted',
      label: 'Hosted',
      lead: 'Nothing to install. Claude connects to Ghost.md’s server, and you sign in on a page once.',
      steps: [
        {
          title: 'Add the server to Claude',
          body: 'In claude.ai or Claude Desktop: Settings › Connectors › Add custom connector, with this address. In Claude Code, one line in a terminal.',
          snippets: [MCP_URL, `claude mcp add --transport http glyph ${MCP_URL}`],
        },
        {
          title: 'Sign in on the page that opens',
          body: 'Claude opens a Ghost.md page in your browser. Sign in with your handle and password, and you are back in Claude with the tools ready. Your password stays in the browser; your account key goes to Ghost.md’s server, which keeps it in memory only, never on disk, while the connection lasts.',
        },
        {
          title: 'Ask in words',
          body: '“What’s in my Groceries note?” “Add ‘book the ferry’ as a task to my Trip plan.” “Make a note called Standup with these three points.” “Which notes mention the cabin?”',
        },
        {
          title: 'To end it',
          body: 'Disconnect the server in Claude. A week without using it ends it too, and the key with it.',
        },
      ],
    },
    {
      way: 'local',
      label: 'On your computer',
      lead: 'One file you run with Node. Your account key stays on your machine, and Ghost.md’s server never sees it.',
      steps: [
        {
          title: 'Get the file',
          body: 'You need Node.js 20 or newer (node --version). Then the server, as one file:',
          snippets: [`curl -fsSL ${LOCAL_FILE_URL} -o ~/glyph-mcp.mjs`],
        },
        {
          title: 'Sign in once',
          body: 'The password is typed at the prompt and is not stored; what is kept is what a signed-in phone keeps, readable by you alone.',
          snippets: [`node ~/glyph-mcp.mjs login ${who}`],
        },
        {
          title: 'Tell Claude where it is',
          body: 'In Claude Code, one line. In Claude Desktop: Settings › Developer › Edit Config, and add the server (with the full path to the file, not ~), then restart it.',
          snippets: [
            'claude mcp add glyph -- node ~/glyph-mcp.mjs',
            '{\n  "mcpServers": {\n    "glyph": { "command": "node", "args": ["/Users/you/glyph-mcp.mjs"] }\n  }\n}',
          ],
        },
        {
          title: 'To end it',
          body: 'Forget the session on that computer, and remove the server from Claude.',
          snippets: ['node ~/glyph-mcp.mjs logout'],
        },
      ],
    },
  ];
}

/** What Claude can do once connected: the eight tools (mcp/server.ts), in words. */
export const CAN_DO: { name: string; words: string }[] = [
  { name: 'Read a note', words: 'One note in full, by its title.' },
  { name: 'List your notes', words: 'Newest change first, with a line of each.' },
  { name: 'Search', words: 'Notes whose words contain something, with the line around it.' },
  { name: 'Make a note', words: 'From markdown, with a title. Every Ghost.md mark works: lists, to-dos, tables, boards.' },
  { name: 'Add to a note', words: 'A task or an item joins the note’s list in its own style; a paragraph goes on the end.' },
  { name: 'Rewrite a note', words: 'The whole body replaced, never over a change another device made in between.' },
  { name: 'Pin or archive', words: 'Either, and undo either. There is no delete: archiving is what it can do, and you can undo it here.' },
  { name: 'Say which account', words: 'Whose notes these are, and how many.' },
];
