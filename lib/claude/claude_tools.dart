/// The tools the app's own Claude has over the library (docs/CLAUDE_APP.md, "Tools"): what it may read and write,
/// each as the API is told it, and the port the app answers them through ([ClaudeNotes]).
///
/// The writing tools take their words last and are streamed (`eager_input_streaming`), so a note fills in on screen
/// while Claude is still writing it (lib/claude/live_typing.dart). The reading tools are small and are not.
///
/// What Claude can do here is the connector's (mcp/server.ts) cut to what a note open in front of the person needs:
/// list, search and read; make a note; add to one; change a passage of one; write one again whole; and open one.
/// The folder tools (GHST-108) are lib/claude/claude_folders.dart's, offered where the run has the folders. Nothing
/// deletes a note, moves one to the Trash, moves one into or out of an organization, or touches an organization's
/// settings.
library;

import 'package:flutter/foundation.dart';

import 'claude_books.dart' show claudeBookSystem;
import 'claude_folders.dart' show claudeFolderSystem;

/// A note as a list shows it.
@immutable
class NoteBrief {
  const NoteBrief({required this.id, required this.title, this.updated, this.preview = '', this.folder, this.folderId, this.pinned = false});

  final String id;
  final String title;
  final DateTime? updated;
  final String preview;
  /// The folder it is filed in, as a path (“Work › Clients”), and that folder's id: for Claude to sort by (GHST-108).
  final String? folder;
  final String? folderId;
  final bool pinned;

  Map<String, Object?> toJson() => {
        'id': id,
        'title': title,
        if (updated != null) 'updated': updated!.toUtc().toIso8601String(),
        if (folder != null) 'folder': folder,
        if (folderId != null) 'folder_id': folderId,
        if (pinned) 'pinned': true,
        if (preview.isNotEmpty) 'preview': preview,
      };
}

/// A note found by its words: the line round the first match.
@immutable
class NoteHit {
  const NoteHit({required this.id, required this.title, required this.snippet});

  final String id;
  final String title;
  final String snippet;

  Map<String, Object?> toJson() => {'id': id, 'title': title, 'snippet': snippet};
}

/// A note in full.
@immutable
class NoteRead {
  const NoteRead({required this.id, required this.title, required this.body});

  final String id;
  final String title;
  final String body;
}

/// The library, as Claude's tools reach it. The app's is made in lib/root (root_claude.dart) over the library's own
/// reads and writes; a test's is a map.
abstract interface class ClaudeNotes {
  /// The account's own notes and its organizations', newest change first; [query] narrows by title.
  Future<List<NoteBrief>> list({String? query, int limit = 50});

  /// Notes whose words contain [query].
  Future<List<NoteHit>> search(String query, {int limit = 20});

  /// A note by its id, else by its exact title (case aside), or null.
  Future<NoteRead?> read({String? id, String? title});

  /// A new note of the account's own, with [body] as its words, answering its id. Made empty first when Claude is
  /// about to type into it ([body] empty), then written by the editor as Claude types.
  Future<String> create(String body);

  /// [id]'s words replaced with [body], for a note that is not open on screen (the editor is the open note's one
  /// writer, and Claude's words reach an open note through it).
  Future<void> write(String id, String body);
}

/// One tool, as the API is told it.
Map<String, Object?> _tool(String name, String description, Map<String, Object?> properties, List<String> required, {bool streamed = false}) => {
      'name': name,
      'description': description,
      if (streamed) 'eager_input_streaming': true,
      'input_schema': {'type': 'object', 'properties': properties, 'required': required},
    };

Map<String, Object?> _string(String description) => {'type': 'string', 'description': description};

/// The tool names.
abstract final class ClaudeTool {
  static const list = 'list_notes';
  static const search = 'search_notes';
  static const read = 'read_note';
  static const open = 'open_note';
  static const create = 'create_note';
  static const append = 'append_to_note';
  static const replace = 'replace_in_note';
  static const rewrite = 'rewrite_note';

  /// The tools whose words are typed into the note as they stream, and which field holds them.
  static const Map<String, String> typed = {create: 'body', append: 'text', replace: 'new_text', rewrite: 'body'};
}

/// Every tool, for the request.
final List<Map<String, Object?>> claudeTools = [
  _tool(ClaudeTool.list, 'The notes in this Ghost.md account, newest change first: id, title, when it changed, the folder it is filed in (its path and id; none for a note in no folder) and a line of preview. `query` narrows to titles containing it.', {
    'query': _string('Only notes whose title contains this (case-insensitive).'),
    'limit': {'type': 'integer', 'description': 'At most this many, default 30.'},
  }, const []),
  _tool(ClaudeTool.search, 'Notes whose words contain `query` (case-insensitive), each with a snippet round the first match.', {
    'query': _string('What to look for.'),
  }, const ['query']),
  _tool(ClaudeTool.read, 'A note in full: its markdown. Give its id, or its exact title.', {
    'id': _string('The note’s id.'),
    'title': _string('The note’s title, when the id is not known.'),
  }, const []),
  _tool(ClaudeTool.open, 'Opens a note on the person’s screen without changing it, to show them something.', {
    'id': _string('The note’s id.'),
  }, const ['id']),
  _tool(
    ClaudeTool.create,
    'A new note, opened on the person’s screen, its words typed in as you write them. The body is markdown and its first line is its title, as a `# Title` heading. Ghost.md’s marks all work: headings, lists, `- [ ]` to-dos, tables, fenced code. Not for a notebook or a ticket: create_notebook and create_ticket make those. A note cut off before its words are whole is taken back.',
    {
      'folder': _string('Where it goes, given before the body: a folder’s id or its path from list_folders, like “HelloTrade › Meetings”, an organization’s included (a new note there is the team’s). Left out, it is the person’s own, in no folder.'),
      'body': _string('The note’s markdown, starting with its `# Title` (or with its front matter, then the `# Title`).'),
    },
    const ['body'],
    streamed: true,
  ),
  _tool(
    ClaudeTool.append,
    'Words added at the end of a note, which is opened on the person’s screen and typed into as you write. For a new line or a new section.',
    {
      'id': _string('The note’s id.'),
      'text': _string('The markdown to add. It starts on a line of its own.'),
    },
    const ['id', 'text'],
    streamed: true,
  ),
  _tool(
    ClaudeTool.replace,
    'One passage of a note changed: `old_text`, which must appear in the note exactly once, replaced with `new_text`. The note is opened on the person’s screen, the old words taken out and the new typed in as you write them. Read the note first. Prefer this to rewrite_note for any change smaller than the whole note.',
    {
      'id': _string('The note’s id.'),
      'old_text': _string('The words to change, exactly as they are in the note, enough of them to be found once.'),
      'new_text': _string('What they become.'),
    },
    const ['id', 'old_text', 'new_text'],
    streamed: true,
  ),
  _tool(
    ClaudeTool.rewrite,
    'A note written again whole: its words replaced with `body`, typed in as you write it on the person’s screen. Read it first, and keep its front matter (the `---` block at its top) unless asked to change it. Only for a change to most of a note.',
    {
      'id': _string('The note’s id.'),
      'body': _string('The new markdown, whole.'),
    },
    const ['id', 'body'],
    streamed: true,
  ),
];

/// The system prompt: who Claude is here and how to write into a note someone is watching.
String claudeSystem({required DateTime now, String? rules, bool folders = false, bool books = false}) {
  final day = '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
  return [
    'You are Claude, working inside Ghost.md, a markdown notes app, on the person’s own phone or computer. Today is $day.',
    'You can list, search and read their notes, and make and change notes with your tools. The note you write in is open on their screen and your words appear in it as you write them, so write as you would want to be watched: in order, from the top, and in finished sentences.',
    'Notes are plain markdown. A note’s first line is its title, as a `# Title` heading. Keep a note’s front matter (the `---` block at its top) as it is unless asked to change it.',
    'Find a note before changing it: search or list, then read it. To change part of a note use replace_in_note; to add to it, append_to_note; rewrite_note only when most of it changes.',
    if (folders) claudeFolderSystem,
    if (books) claudeBookSystem,
    'When you are done, say in a sentence or two what you did, naming the notes. Do not paste a note’s contents back into the reply.',
    if (rules != null && rules.trim().isNotEmpty) 'The person’s standing instructions for you (their “Claude rules” note):\n\n${rules.trim()}',
  ].join('\n\n');
}
