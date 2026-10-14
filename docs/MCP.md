# Glyph for Claude: the MCP server

Claude can read, add and update the notes in a Glyph account, through an MCP server that runs on your own
computer. Matt's brief (2026-09-18): "make an MCP plugin for Claude so I can use Claude to remote control my
account and add and update notes as well as read them, be detailed and make sure it all works for every user".

It works for any Glyph account, and it comes two ways:

- **Hosted** (the easy one): Claude connects to `https://attack.fm/glyph/api/mcp`, you sign in on a page once, and
  that is all. Nothing to install. While you are signed in, Glyph's server holds your account key in memory (below).
- **On your own computer**: one file you run with Node, which keeps your key on your machine and the server never
  sees it. For anyone who would rather keep end-to-end encryption whole.

## What it can do

Once it is connected, ask Claude in words. Behind them are eight tools:

| Tool | What it does |
| --- | --- |
| `list_notes` | Your notes, newest change first: id, title, dates, pinned, archived, folder, a line of preview. `query` narrows by title. |
| `read_note` | One note in full, by id or by title. |
| `search_notes` | Notes whose words contain something, with a snippet around the match. |
| `create_note` | A new note from markdown, with a title as its heading. Every Glyph mark works: headings, lists, `- [ ]` to-dos, tables, boards. |
| `update_note` | A note's whole body replaced. |
| `append_to_note` | Words added the way the app's own "add task" adds them: a task or an item joins the note's list, in the list's style; a paragraph goes on the end. |
| `set_note_flags` | Pin or archive a note, or undo either. |
| `account_status` | Which account this is, where its sync service is, how many notes it holds, and how many Claude connections it has. |
| `sign_out_everywhere` | Hosted only. Ends every Claude connection to the account - every Claude account and computer signed in to it, this one included; each signs in again on the page. |

Every tool reads the account fresh before it acts, so Claude sees what your phone last wrote. A write goes from the
version just read: if another device changed the note in between, the service refuses the write and Claude is shown
that device's words instead, never over them. That is the rule the app itself lives by (docs/SYNC.md).

A note Claude makes or changes reaches every signed-in device at its next sync, exactly as one typed on a phone would.
There is no delete: archive a note instead (`set_note_flags`), which the app can undo. Emptying the trash is a thing
you do in the app.

These steps are also in the app: the Claude plugin's page (Settings › Plugins › Claude) carries the address with a
Copy, and an instructions drawer with the steps for either way, each command with its own Copy
(`src/app/plugins/claude/`).

## Setting it up: hosted

Add `https://attack.fm/glyph/api/mcp` to Claude as a remote MCP server. Where that is:

- **claude.ai and Claude Desktop**: Settings › Connectors › Add custom connector, with that URL.
- **Claude Code**: `claude mcp add --transport http glyph https://attack.fm/glyph/api/mcp`
- **Any other MCP client** that speaks HTTP with OAuth: the same URL.

Claude opens a Glyph page in your browser: sign in with your handle and password, and you are back in Claude with
the tools ready. That is the whole setup, on every device you use Claude from.

**What the hosted server keeps.** Your notes are end-to-end encrypted, so a server that reads them has to hold your
account key. The sign-in page unwraps the key in your browser - your password stays there; the sync service sees the
same login half it sees from your phone - and hands the key to the MCP server, which keeps it **in memory only**, as
a key object the process cannot read out, never on disk. For as long as that session lasts, the server can read your
notes: that is what lets Claude. The page says so before it asks for the password.

The session ends, and the key with it, when you disconnect the server in Claude (Claude tells it), when nobody has
used it for a week, when the refresh token runs out after thirty days, or when the server restarts (a deploy of the
MCP server itself signs everyone out - a deploy of glyph-api alone does not - and Claude asks you to sign in again).
Changing your Glyph password does not end it: disconnect to be sure.

## Setting it up: on your own computer

You need Node.js 20 or newer (`node --version`), and the server as one file:

```bash
curl -fsSL https://attack.fm/glyph/mcp/glyph-mcp.mjs -o ~/glyph-mcp.mjs
```

Sign in once. The password is typed at the prompt and is not stored; what is stored is what a signed-in phone
stores (below).

```bash
node ~/glyph-mcp.mjs login <your handle>
```

Then tell Claude where the server is.

**Claude Code**, one line:

```bash
claude mcp add glyph -- node ~/glyph-mcp.mjs
```

**Claude Desktop**: Settings › Developer › Edit Config, and add the server to `mcpServers` (use the full path to
the file, not `~`):

```json
{
  "mcpServers": {
    "glyph": {
      "command": "node",
      "args": ["/Users/you/glyph-mcp.mjs"]
    }
  }
}
```

Restart Claude Desktop. Any other MCP client (Cursor, Windsurf, Zed, …) is configured the same way: the command is
`node`, the one argument is the file.

Then: "What's in my Groceries note?", "Add 'book the ferry' as a task to my Trip plan", "Make a note called
Standup with these three points", "Which notes mention the cabin?".

### Without a terminal prompt

A headless setup can give the handle and password in the environment instead, and the server signs in each time it
starts:

```json
{
  "mcpServers": {
    "glyph": {
      "command": "node",
      "args": ["/Users/you/glyph-mcp.mjs"],
      "env": { "GLYPH_HANDLE": "you", "GLYPH_PASSWORD": "…" }
    }
  }
}
```

The `login` command takes the password from `GLYPH_PASSWORD` too, for the one command, when there is no terminal.

### Commands

```
node glyph-mcp.mjs login <handle>   sign in and keep the session
node glyph-mcp.mjs status           which account, whether the session still works, how many notes
node glyph-mcp.mjs logout           forget the session
node glyph-mcp.mjs                  serve (what Claude runs)
```

`GLYPH_API` points the server at another sync service (the default is `https://attack.fm/glyph/api`);
`GLYPH_MCP_HOME` moves the session file (the default is `~/.config/glyph-mcp`).

## What it keeps, and where the key lives

Glyph's notes are end-to-end encrypted: the sync service holds copies it cannot read, and every device that shows
them holds the account key (docs/SYNC.md, "Keys"). The MCP server is a device like that. After `login` it keeps, in
`~/.config/glyph-mcp/session.json`, readable by you alone:

- the session token (renewed as it runs, and renewed again with the server's own signing key when it lapses, so
  the password is never asked for twice - the same as a phone);
- the account key, which opens the notes;
- that signing key.

The password itself is never written down. The sync service never sees the key: the server unwraps it on your
computer with the half of the password that never leaves, seals every note it writes, and opens every note it reads,
exactly as the app does (`core/sync/crypto.ts` is the same code, bundled in). Anyone who can read that file can read
your notes, as anyone who can unlock your phone can; keep it as you keep the phone. `logout` removes it.

The server itself runs on your computer, started by Claude, and talks to nothing but Glyph's sync service. Claude
sees the words of the notes it reads, as it sees anything you paste into it.

## Where the pieces are

| | |
| --- | --- |
| `mcp/glyph.ts` | the account as a client: sign-in, the session's renewal, the note feed opened into a cache, writes sealed as the app seals them, and the conflict rule |
| `mcp/server.ts` | the eight tools |
| `mcp/main.ts` | the command: login, status, logout, serve |
| `mcp/hosted.ts`, `mcp/hosted-main.ts` | the hosted server: OAuth with the SDK's handlers, the sign-in page, sessions in memory, MCP over HTTP; run on the box as `glyph-mcp.service` (`server/glyph-mcp.service`) |
| `server/src/mcp_proxy.rs` | glyph-api hands `/glyph/api/mcp` on to it, so the shared Caddy configuration is untouched |
| `scripts/deploy-server.mjs` | ships both services in one session; `--mcp-only` ships just the hosted server, and either way glyph-mcp is restarted only when its file changed, since a restart signs everyone out |
| `scripts/build-mcp.mjs` | the one-file build, `npm run mcp:build`, to `mcp/dist/glyph-mcp.mjs` |
| `scripts/deploy-ota.mjs --mcp` | publishes that file to `attack.fm/glyph/mcp/glyph-mcp.mjs` |
| `mcp/glyph.test.ts` | the client against a sync service stood in for in memory: sign-in, renewal, reading, writing, the conflict |
| `mcp/hosted.test.ts` | the hosted server connected to as Claude connects: the client library's own OAuth flow, the page, tokens, refresh, the tools, and a week's idleness ending the session |
| `mcp/mcp.e2e.test.ts` | a phone (the app's own sync code), the built local server over stdio, and the built hosted server over HTTP with the full sign-in, all on one real glyph-api: `GLYPH_MCP_E2E=1 VITE_GLYPH_API=http://127.0.0.1:<port>/glyph/api npx vitest run mcp.e2e` |

## How it was proven

- **Against a service in memory** (`mcp/glyph.test.ts`): the password derived and the key unwrapped as the app does;
  a lapsed token renewed with the device key, mid-call and without one being told to sign in again; notes listed and
  followed through the feed; a note made that the app opens; an edit that keeps everything the note carried (its pin,
  folder, recording) and drops the stale formatted copy; and a write over another device's change refused with their
  words.
- **Against a real glyph-api** (`mcp/mcp.e2e.test.ts`): a phone, run by the app's own `syncNotes`, writes a note; the
  client signs in with the password and reads it; what the client makes and edits is on the phone after one sync,
  with nothing copied twice. Then the built file is started over stdio as Claude starts it, its eight tools listed,
  and each one called: list, status, create with a title, append an item and a task, read by title, search, replace,
  archive - and all of it on the phone afterwards.
- **By hand** on a local service: `login` with a password, the session file written mode 600 with the token, key and
  device key; `status` from the file alone; a raw MCP `initialize` and `tools/list` over stdio; `logout`.
- **The hosted server** (`mcp/hosted.test.ts`, and the last part of the e2e): the client library refused with a 401
  that says where the sign-in metadata is, finds it, registers itself, is sent to the page; the page's own steps
  sign in, unwrap the key and hand it over; the code becomes tokens; the tools work; an hour on the access token has
  run out and the library refreshes it unasked; a token never issued, a stale page and a non-key are refused; and a
  week's idleness ends the session, key and all. Then the same, with the built file run as the box runs it, against
  a real glyph-api, with a phone syncing what Claude did.
