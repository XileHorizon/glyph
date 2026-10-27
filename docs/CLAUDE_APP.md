# Claude in the app, with your own key

Matt, 2026-10-17: "add the ability to add a anthropic API key to the app so ask Claude works in real time and note
creation and editing happens in real time when we ask Claude it should open up to the note it's editing and we
follow along with a stream from Claude". Then: "move the Claude chip to a icon on the home page dock and make it
match claudes brand colors"; "If we follow Claude I also want to see a cursor where Claude last typed and scroll the
screen to there after navigating us to the note"; "Make the ask Claude and other agents open a chat when we go to talk
to them". Of the two ways in offered, both: a chat to ask in, and the "Ask Claude" note done as requests are written.
The Flutter app first; the Tauri app has none of it.

docs/CLAUDE_LIVE.md is Claude reaching the account from outside, through the connector. This is the other way round:
the app asks Claude itself, with the person's Anthropic API key, and so sees Claude's words as the model writes them.
The connector can only type a tool call's words once the call is whole; here a note fills in token by token.

## The Claude plugin

Matt, 2026-10-17: "Ask Claude and other integrations should be shipped as plugins". The app's own Claude is the
**Claude** plugin's (lib/plugins/claude), the same plugin as the connector's page: one switch in Settings › Plugins,
standard, so on until switched off. Its page, Settings › Plugins › Claude, is in two parts: **In the app** (the key,
the model, the "Ask Claude" note: lib/plugins/claude/claude_in_app.dart) and **From Claude's own app** (the
connector, as the web's page has it: claude_pane.dart). Switched off, no dock has Claude, the chat does not open (and
closes if it was up), the command bar has no Ask Claude, an AI's row has no Chat, the bar goes and the inbox asks
nothing (`claudeInApp()`, asked by lib/root/root_claude.dart, the runner's `allowed` and the inbox's `on`). The
connector is not touched: Claude reaches in from its own app until it is disconnected there. Local only holds the
plugin off with every plugin that uses the internet, the app's Claude with it (it talks to `api.anthropic.com`).

## What a person sees

1. **Claude on the dock.** Every page's dock has Claude at its head (docs/DOCK.md, since 2026-10-17; the home page's
   alone before): a ring in Claude's orange (`#d97757`, the landing page's `.brand-claude`) with its mark in ivory. It
   turns slowly while Claude works in the app, and wears a small ivory dot while an AI is online through the
   connector. The top bar's Claude chip is gone; its menu (what each AI online is doing, Follow, Open) is in the chat.
   On a note (a canvas, a notebook and a journal too) it opens the chat with the note's `[[Title]] ` in the field,
   ready to ask about it, since the chat holds no subject of its own; elsewhere with the field empty. The rest of each
   page's dock, and Settings or the note's ⋯ at its foot, are docs/DOCK.md's.
2. **The chat.** A tap on a dock, the command bar's Ask Claude, the bar's Reply, or Chat on an AI's row of an
   organization's page opens a chat: over the whole window on a phone, a panel down the right on a wide one, closed by
   its back arrow or the back gesture. The person's words on the right, Claude's on the left as they arrive, each tool
   as a quiet line that opens its note, the field over the keyboard, Send (Stop while Claude works), New chat.
3. **Following along.** When Claude starts writing in a note, the chat makes way and the note opens; Claude's words
   are typed into it at Claude's caret, labelled Claude, and the page is kept scrolled to it. A bar under the top bar
   says what Claude is doing or the words it is saying, with Stop following and Stop; when it ends, Claude's answer in
   a line with Reply and Close. A press or a key in the note stops the following (the bar then offers Watch), never
   the typing: Claude's words go in where it was, moved along by anything typed above them.
4. **Where Claude last typed.** Between one tool call and the next, Claude's caret stays where it last typed. Watch
   (in the bar or the chat) opens the note Claude is in, puts its caret there and scrolls to it, even in an editor made
   again for the note. The carets go when the run ends. Follow for an AI through the connector does the same: the
   app keeps where each AI's caret was last seen in each note, and a note followed into after the AI has stopped
   typing shows Claude's caret there and scrolls to it.
5. **The "Ask Claude" note.** With a key and the switch on (Settings › Plugins › Claude), a `- [ ]` request written in
   the account's own note titled "Ask Claude" is done about four seconds after it last changed, never while the caret is
   on its line: Claude does it while it is watched, then the app writes one line under it, indented, and ticks it,
   unless it could not be done (mcp/prompts.ts's own format, so the connector's routine and the app agree). Without a
   key, what is written in the chat goes into that note as a request, for the connector's agents to work through.
6. **Talking to Claude** (2026-10-17; lib/claude/claude_voice.dart, claude_voice_sheet.dart, claude_ear.dart). Under
   Claude on every dock, where the build can hear, a plain ring with its rim and mic in Claude's orange: Talk to
   Claude. It is the dock's one microphone (GHST-104, 2026-10-18; Matt: "there should only be one microphone icon
   still it should just use Claude instead of the local models"): the ink-filled Speak that records a voice note is
   left off a dock that has Talk to Claude, and comes back where Claude is off or the build cannot hear. A press opens a card at the foot: Claude's orange
   mic with the recorder's own rings going out from it as the voice moves them, and the words under it as they are
   heard. The ear is the recorder's: Whisper in the core, on the phone, its guesses shown as they come, stopped with
   no note to keep a tape in, so no audio is kept. A tap is done, and so is a two-second pause once something was said
   (a minute at most; ten seconds of nothing says so). The words go to the app's Claude in the chat's own
   conversation (a note's dock puts `[[Title]] ` first), so they are in the chat afterwards; the card shows Claude's
   thinking as it comes and a line for each tool. Once Claude writes in a note, the card makes way, down to a strip at
   the head of the window (what Claude is doing, Stop, the chat, close), and the note is opened and typed into as for
   the chat; the answer lands on the strip, which goes by itself after six seconds unless pressed. Without a key the
   words go to the "Ask Claude" note, and an AI online through the connector is followed at once, the strip saying
   what it is doing. No always-on microphone: the ear opens only on a press or the phone's assistant, and closes as
   listening ends.
7. **The phone's assistant.** Settings › Plugins › Claude › Phone assistant (Android): the switch that was only
   Settings › Developer's (lib/core/wip.dart, one flag either way) offers Ghost.md to Android as a digital assistant
   and opens Android's Default digital assistant app screen, since the app cannot pick itself; a second row says
   whether it is the one chosen. The assistant (the side key held, the assistant gesture: MeetingBridge.kt's launch
   "assist") then talks to Claude where its plugin is on, a key is kept and the phone is unlocked; otherwise, and for
   the launcher's Record note, it records as before (lib/root/capture_route.dart `assist`).

## The key

Settings › Plugins › Claude, In the app (lib/plugins/claude/claude_in_app.dart; Settings › Ask Claude, a section of
its own, until 2026-10-17): the key, checked before it is kept (one read of
`GET /v1/models`), shown only as its start and last four, with Check and Forget (asked twice); the model (Sonnet 5.5
by default, Opus 5.5, Haiku 5.5); the inbox switch. The key is kept in the device's secure storage
(lib/account/device_keys.dart: the Android Keystore, the Keychain on a Mac and an iPhone), never in the preferences
in the clear, never in the library folder a backup copies. Since 2026-10-26 it follows the account (Matt: "make it so
things like the Claude tokens and other stuff is kept in sync across all instances of ghost logged in to my
account"): the key, the model, the effort, the inbox and watch switches, the plugin's switch and the spending limit
are each sealed under the account key into the synced settings and written into the next device's secure store
(docs/SYNC.md, "Keys and connections"), unless Settings › Account › Keep keys and connections in sync is off there.
Before, each device was given its own, and a meeting stuck on the Mac, which had none. Off a phone and a Mac it is
memory only. What is asked, and the notes Claude reads to answer, go from the device to `api.anthropic.com` and
nowhere else; Anthropic bills the key. So do meetings' transcripts, while Claude writes meetings up (Meetings,
below).

## Spending limit

Matt, 2026-10-20: "Also enable setting spending limits in claude settings in the app". Settings › Plugins › Claude,
In the app, the Spending limit card (lib/plugins/claude/claude_in_app.dart; the count and the limit in
lib/claude/claude_spend.dart). Search finds it by spending, limit, budget and cost.

- **The setting.** Off by default. On, a monthly amount in US dollars ($5, $10, $25, $50, or another typed), counted
  again from the 1st of each month, local time; "Warn me at 80%" (on by default). Under it, "This month: $X.XX of $Y ·
  N requests" with Reset count. The card says the count is "Counted on this device from what Claude reports for each
  request; other apps or devices using the same key aren't included": the API cannot report a key's spend without an
  Admin key, so this is the app's own count, per device, never synced, kept as one JSON string in the secure store
  beside the key (`anthropic-spend`). The limit itself (on, the amount, the warning) is kept a second time on its own,
  `anthropic-limit`, written only when it is set, and that one follows the account (docs/SYNC.md, "Keys and
  connections"): each device holds its own month to the same limit.
- **What is counted.** Every request: each turn of a run's tool loop (the chat, a voice ask, the inbox, the folder
  tools, all through lib/claude/claude_run.dart) and each request of a meeting's write-up (lib/ai/summary_claude.dart),
  both through `meterClaude`, which reads `usage` from `message_start` and `message_delta` (input, output, cache
  writes by TTL, cache reads, web searches) and prices it once the stream ends, stopped or broken too. A stream cut off
  before its last count is counted with what it had reported and its output guessed at about four characters a token
  of what had streamed. A request refused before it streamed costs nothing and is not counted.
- **The prices.** One table, `claudePrices`, with its date (`claudePricesAsOf`, 2026-10-20, from the Claude API
  reference's model table; Anthropic's page is platform.claude.com/docs/en/about-claude/pricing): input and output per
  MTok, cache reads at the model's rate, cache writes 1.25 times input (5 minutes) and 2 times (1 hour), Haiku 5.5's
  second card over 100K tokens of prompt. Priced by the model `message_start` names (a server-side fallback's), a dated
  id by its name; a model the table does not know at the dearest price of each kind, never under the real cost.
- **Enforcing.** Once the month's total reaches the limit, nothing is sent: an ask is refused with "Monthly spending
  limit reached ($Y). Change it in Settings › Claude." (the chat, the voice sheet; the inbox stops looking until the
  settings change). A run that crosses it finishes the request it is in, its tools answered so a later follow-up is
  whole, and starts no other, ending with the same words. A meeting's write-up waits, never fails for it: the queue
  holds the job as it does for Local only, the strip saying "The summary waits for Claude. Monthly spending limit
  reached ...", and asks again once the limit is raised or the count reset, or the month turns; a request in flight is
  let finish, and a piece not yet asked is left for then, the job uncounted. "Warn me at 80%" is a quiet line in the
  chat, once a month (a `notice` step), when a run starts or a request ends past 80% and under the limit.

## Meetings

Matt, 2026-10-19: "when claude is enabled the meeting summary should go through claude instead of gemma". A meeting's
write-up (one recorded on the phone or the Mac, and one Ghost was in, docs/MEET.md) is Claude's where Claude is
**chosen**: the Claude plugin's switch is on and a key is kept on this device. Without either, meetings are written up
on the device as they always were; a long voice note's summary always is. lib/ai/summary_claude.dart is Claude's half,
lib/ai/summaries.dart (its header, "CLAUDE, FOR MEETINGS") the queue's.

- **The same write-up.** The summary queue reads the tape's words as for the phone's model, in the same pieces when it
  is long (ai/summary_text.dart `transcriptPieces`), with the same prompts (format/prompt.dart), and the answer is
  placed and shaped by the same rules, written plain into a closed note or handed whole to an open note's editor,
  which lands it as tracked changes with Keep and Revert. Kept as made by the model chosen (`claude-sonnet-5-5`, ...).
- **The request.** One streamed `POST /v1/messages` a generation, read whole: the summary prompt as `system`, the
  words as the one user message, the model chosen, the effort chosen where one is (none sent otherwise), no
  `thinking` (the three models think adaptively by default), `max_tokens` 16000 (room for the thinking; the prompt
  sets the length). Opus 5.5 and Sonnet 5.5 are asked with the server-side fallback (`fallbacks: "default"`, beta
  `server-side-fallback-2026-07-01`), so a request a safety classifier declines is answered by the model Anthropic
  routes it to; Haiku 5.5 has none.
- **Privacy.** With Claude chosen, a meeting's transcript goes from the device to `api.anthropic.com` with the
  person's own key, and nowhere else; with Local only on, nothing goes.
- **Local only.** It holds Claude off but leaves it chosen: a meeting's write-up waits for Claude (the strip: "The
  summary waits for Claude: Local only is on.") and is asked once Local only is off, rather than being written by the
  phone's model, since a summary is never remade on its own. A request in flight when Local only comes on is stopped
  and its job waits, uncounted.
- **Failures** are said in Claude's words beside Try again ("The summary didn't come. The API key was refused.
  Check it in Settings › Claude."). A refused key or request, or a decline, fails the job at once; no connection, too
  many requests or Claude overloaded counts as one of the queue's three tries, 20 seconds apart. No "Needs a model":
  none is looked for.
- **With the app closed.** On Android the meeting service still makes the transcript with the app closed (Whisper
  is the phone's); while Claude is chosen its config says summaries off (ai/job_config.dart), so it writes none, and
  its notification says the transcript is in the note. The write-up then waits for the app: tapping the notification,
  or any return to the app, takes the service's result, makes the meeting the queue's own job, and asks Claude at
  once; while the app is alive behind another, the service's `recordingDone` does the same, since a Claude job runs
  with the app off the screen (the phone's model's never do). A summary the phone or the Mac's core wrote anyway (a
  config from before Claude was chosen; the Mac, whose core is sent none) is put aside for Claude's.

## The stream

lib/claude/messages_api.dart posts `/v1/messages` with `stream: true` over `dart:io` and reads the server-sent events
(lib/claude/sse.dart). Every writing tool is declared with `eager_input_streaming: true`, so its input arrives as
Claude writes it, unbuffered; lib/claude/partial_json.dart reads the top level of that object from pieces cut
anywhere (in a key, a word, an escape, a surrogate pair) and says when each string field starts, each run of its
letters, and when it ends. The whole input is still parsed once its block closes; input that is not JSON is answered
`{"INVALID_JSON": ...}` with `is_error`, as the API's docs ask.

## A run

lib/claude/claude_run.dart: the request, Claude's words and its thinking as they come, each tool answered once its input is whole, and
the next request with the answers, up to 24 requests, until Claude stops calling tools, is stopped, or fails. The
system prompt (lib/claude/claude_tools.dart `claudeSystem`) is who Claude is here, today's date, how to write into a
note being watched, and the account's "Claude rules" note. Every request asks for adaptive thinking with its summary
shown (`thinking: {type: "adaptive", display: "summarized"}`, on the three models the app offers); the summary streams
as `thinking_delta`s, is kept as a step and shown in the chat and the voice card, and every thinking block (empty,
signed, or `redacted_thinking`) goes back exactly as it came. A conversation keeps the system prompt it began with, so
the blocks it sends back stay valid; New chat takes today's date and rules again. One run at a time (lib/claude/claude_runner.dart); an ask
while one works waits for it. The chat's conversation is kept until New chat or the app closes, and written nowhere.

## Tools

`list_notes`, `search_notes`, `read_note`, `open_note`; and the four that write and stream: `create_note` (`body`),
`append_to_note` (`id`, `text`), `replace_in_note` (`id`, `old_text` found exactly once, `new_text`), `rewrite_note`
(`id`, `body`). Nothing deletes or trashes a note, and nothing shares or unshares one. A note made is the account's
own, in no workspace. `list_notes` gives each note's folder as its path (`folder`, "Work › Clients") and id
(`folder_id`).

### Folders (GHST-108)

Matt, 2026-10-19: "Make it so the AI can manage folders and sorting of files into folders and organize all my
organizations into neat logical folders". Six more tools, lib/claude/claude_folders.dart over the root's
`WorkspaceStore` (a folder is a workspace with a parent, docs/FEATURES_2_1.md), offered where the runner is handed the
folders (the root does) and named in the system prompt then:

- `list_folders`: every workspace and folder, with `id`, `name`, `path`, `parent`, `organization` (its name) and
  `organization_root` for an organization's own workspace, `notes` (filed in it) and `notes_under` (in it and under it).
- `create_folder` (`name`, `parent`?): made inside `parent`, or at the top; the one of that name already in that
  place is answered instead (at the top, the store's own rule: the personal one of that name wherever it is, said so).
- `rename_folder` (`folder`, `name`): not an organization's own workspace, nor to a name a folder beside it has.
- `move_folder` (`folder`, `parent`?): only where `canMove` lets it: never into itself or a folder inside it, never
  into or out of an organization (an organization's folder stays in it, never at the top).
- `delete_folder` (`folder`): no note is deleted. The folders inside it move up into its place; the notes filed in it
  are unfiled for a personal folder, and filed in the folder above for an organization's, so they stay the team's. Not
  an organization's own workspace.
- `file_notes` (`ids`, and `folder` or `unfile: true`): files the notes there, or out of every folder; their files
  follow (lib/core/note_folders.dart, and for an organization's folder the team sync, lib/team/folders.dart). Ids it
  cannot find come back as `missing`.

A `folder` (or `parent`) is found by its id, by its path ("Ghost.md › Clients" or "Ghost.md/Clients", case and spaces
aside), or by a bare name only one folder has; else the tool's error lists each candidate's path and id.

**The organization's edge.** Filing a note into an organization from outside it shares it with every member, and
filing one out takes it from them; the note's Workspace picker asks twice before either
(lib/note/workspace_picker.dart). A run has no way to ask the person mid-way, so `file_notes` leaves such a note where
it is and answers it under `refused`, with why and that the person can move it from the note's Workspace picker; the
others in the same call are filed. Within one organization, and among personal folders, Claude files freely.

### Notebooks, tickets and the Trash

Matt, 2026-10-27, after the in-app Claude (Haiku 5.5), asked to make a HelloTrade notebook of tickets from a meeting,
wrote each ticket's front matter by hand through `create_note`, had a create cut off, and left three notes named
"book: true", "type: ticket" and "ticket" it could neither take back nor file into the organization: "please increase
the functionality of the Claude in app to better prevent this". lib/claude/claude_books.dart:

- **`create_notebook`** `{title, ticket_key?, folder?, about?}`: a notebook (`bookNoteBody`) with its key, made in a
  folder, an organization's included: a note made new for the team shares nothing that was the person's alone.
- **`create_ticket`** `{notebook, title, status?, assignee?, due?, priority?, details?}`: made as the app makes one
  (`newTicketBody`, `nextTicketId`, `withChapter`): the next key, the notebook's first open status, filed where the
  notebook is, its page put in the index through the open screen where the notebook is open. A title another note has
  is refused (a notebook's pages are claimed by title).
- **`trash_note`** `{id}`: to the Trash. Only a note of the person's own: a team's note, even one Claude made, is
  refused, since taking it away takes it from every member for good (an organization's deletes skip the Trash).
- **`create_note`'s `folder`**: the note it makes is filed there, by the same rule.
- **A create cut off** (the stream failed, the input never closed, invalid JSON) takes back the half-made note to
  the Trash, and the run's steps say so.

The system prompt says to use the two tools for notebooks and tickets, to make one ticket and read it back before
the rest, and that front matter comes before the `# Title`.

## Typing as Claude writes

When a writing tool's words start, the note is made or found, opened (lib/root/root_claude.dart `_RootClaudeDesk`),
and its editor handed to a typer (lib/claude/live_typing.dart). The old passage is taken out (replace, rewrite) and
the words go in at Claude's caret at a reading pace (lib/claude/typing_pacer.dart): a word and the spaces after it at
a time, 60 letters a second while the stream keeps up, the rate rising smoothly when the stream runs ahead so the words
are never more than about two seconds behind it, never half a word where it can be helped (a word longer than 24
letters goes in pieces), and everything at once on Stop, when the stream breaks, or when the note is closed under
Claude. The caret and the following scroll go with the words let in. The editor stays the note's one writer: what is
typed is the editor's own change (`userEvent: 'claude.type'`), saved by the note's saving, carried to its live document
where it is bound, undone by the person's undo, and cleared out of a brief, light smoke (`WispKind.typed`,
lib/editor/marks/wisp_motion.dart: each word legible within 120 ms, at once with no turn to wait, only a change's last
eight words smoking, none ever waiting unseen on the pool of filters, and none with reduced motion) where Ghostly
typing is on and the note draws arrivals. Words the connector types arrive live in the same light smoke; they are paced
by the connector (docs/CLAUDE_LIVE.md, "Streaming"), not here, since the editor must hold the live document's words.
Where the note cannot be shown, or is closed under Claude, the rest is written behind it through the screen or the
library (`ClaudeDesk.change`).

Every note's editor has `claudeTyping` (lib/root/note_desk.dart): the caret's field, which rides every change, and an
observer of the person's presses and keys.

## Honest limits

- An agent working through the connector cannot be messaged while it works: it is a tool call away, in Claude's own
  app. Its chat says so; with a key the app's own Claude answers, and without one the words go to the "Ask Claude"
  note.
- Words typed by the app's Claude reach another device only where the note is live there (docs/LIVE.md); that device
  sees the words arrive but no caret, since the app's Claude says nothing in the presence rooms.
- Not built in this cloud session's checkout: it could not fetch Flutter or the packages (pub.dev and Google's storage
  are refused here). `flutter analyze` and the tests below are to be run on the Mac before it is merged and shipped.

## Ownership

| Part | Where |
| --- | --- |
| The stream, the input reader, the tools, a run, the runner, the inbox | lib/claude/ |
| Typing and Claude's caret in an editor | lib/claude/live_typing.dart, in lib/root/note_desk.dart's extensions |
| The chat, the bar, the dock's Claude, the mark | lib/claude/claude_chat.dart, claude_bar.dart, claude_dock.dart, claude_mark.dart |
| Talking to Claude: the ask said aloud, its ear, its card and strip | lib/claude/claude_voice.dart, claude_ear.dart, claude_voice_sheet.dart; the root's `_startTalk` in lib/root/root_claude.dart |
| The phone's assistant: its switch and its launch | lib/core/wip.dart, lib/plugins/claude/claude_in_app.dart, lib/root/capture_route.dart, android/…/MeetingBridge.kt |
| The spending limit: the count, the prices, the meter | lib/claude/claude_spend.dart; its card in lib/plugins/claude/claude_in_app.dart |
| Meetings written up by Claude | lib/ai/summary_claude.dart; lib/ai/summaries.dart, lib/ai/job_config.dart; lib/root/voice_wiring.dart wires them |
| The key's page, and the plugin | lib/plugins/claude/ (claude.dart's manifest and `claudeInApp`, claude_in_app.dart, claude_pane.dart) |
| The library and the screen as Claude reaches them, the chat's part, the inbox's note | lib/root/root_claude.dart, ghost_root.dart, root_parts.dart |
| The dock's slot | lib/home/home_screen.dart (`HomeScreen.claude`); every other page's, lib/shell/page_dock.dart (docs/DOCK.md) |
| Chat on an AI's row | lib/orgs/ui/organization_screen.dart (`onChat`) |
| Where a connector AI last typed, for Follow | lib/live/follow.dart |
| Ask Claude in the command bar | lib/commands/palette.dart, app_commands.dart |
| Tests | test/claude/, test/plugins/claude/, test/editor_ai/wisp_typed_test.dart, test/root/wiring_test.dart, test/settings/settings_sheet_test.dart |
