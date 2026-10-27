/// The app's own Claude over notebooks, tickets and the Trash (Matt, 2026-10-27: "please increase the functionality of
/// the Claude in app to better prevent this"). On his Fold, asked to make a HelloTrade notebook of tickets from a
/// meeting, Claude wrote each ticket's front matter by hand through create_note, the create was cut off mid-way, and
/// three notes named "book: true", "type: ticket" and "ticket" were left that it could neither take back nor file into
/// the organization. These tools do it the app's way:
///
/// - **create_notebook**: a notebook ([bookNoteBody]) with its ticket key (`HT`), made in a folder, an organization's
///   included: a note made new for the team shares nothing that was the person's alone.
/// - **create_ticket**: a ticket in a notebook as the app makes one ([newTicketBody]): its next key (`HT-4`), the
///   notebook's first open status, the fields given (status, assignee, due, priority), its page put in the notebook's
///   index and filed where the notebook is.
/// - **trash_note**: to the Trash, from where the person brings it back. Only a note of the person's own: a team's note
///   taken away is taken from every member for good (an organization's deletes skip the Trash; 2026-10-26, 108 team
///   notes), and no run asks the person first, so a team's note, even one Claude made, is the person's to remove.
///
/// And create_note's `folder`, which files the note it makes there, an organization's too, by the same rule.
library;

import 'dart:convert';

import 'claude_folders.dart';

/// The notes Claude made since the app opened: what trash_note may take from an organization, and what a cut-off
/// create leaves behind to be taken back.
final Set<String> claudeMade = <String>{};

/// What a book tool refuses, said back to Claude.
class ClaudeBookProblem implements Exception {
  const ClaudeBookProblem(this.message);
  final String message;
  @override
  String toString() => message;
}

/// The library and the workspaces as the book tools reach them; the app's is in lib/root/root_claude.dart.
abstract interface class ClaudeShelf {
  /// A new notebook named [title], with ticket key [key] where given and [about] under its heading, filed in
  /// [workspaceId] where given. Answers its id.
  Future<String> notebook({required String title, String? key, String? about, String? workspaceId});

  /// A notebook by its id or exact title: its id, title and ticket key, or null where there is no such notebook.
  ({String id, String title, String? key})? findNotebook(String asked);

  /// A ticket in the notebook [notebookId]: made as the app makes one, with [fields] set, [details] under its
  /// heading, filed where the notebook is and put in its index. Answers its id and its key (null in a notebook with no
  /// key).
  Future<({String id, String? key})> ticket({required String notebookId, required String title, required List<(String, String)> fields, String? details});

  /// Files the note [id], just made, in [workspaceId].
  void fileNew(String id, String workspaceId);

  /// Whether [id] is the team's: filed in an organization's workspace or a folder under it.
  bool isTeams(String id);

  /// The note's title, or null where there is no such note.
  String? titleOf(String id);

  /// Moves the note [id] to the Trash.
  Future<void> trash(String id);
}

/// The book tools' names.
abstract final class ClaudeBookTool {
  static const notebook = 'create_notebook';
  static const ticket = 'create_ticket';
  static const trash = 'trash_note';
  static const Set<String> all = {notebook, ticket, trash};
}

Map<String, Object?> _string(String description) => {'type': 'string', 'description': description};

Map<String, Object?> _tool(String name, String description, Map<String, Object?> properties, List<String> required) => {
      'name': name,
      'description': description,
      'input_schema': {'type': 'object', 'properties': properties, 'required': required},
    };

/// The book tools, as the API is told them.
final List<Map<String, Object?>> claudeBookTools = [
  _tool(
    ClaudeBookTool.notebook,
    'A new notebook: a note whose pages are listed in it, in order. With `ticket_key` (2 to 6 capital letters, like HT) every ticket made in it is numbered HT-1, HT-2 and on. Made in `folder` where given, an organization’s included (a new notebook for the team is the team’s). Use this, never create_note, to make a notebook.',
    {
      'title': _string('Its name.'),
      'ticket_key': _string('The tickets’ prefix, like HT. Leave out for a notebook without tickets.'),
      'folder': _string('Where it goes: a folder’s id or its path from list_folders, like “HelloTrade › Tickets”. Left out, it is the person’s own, in no folder.'),
      'about': _string('A line or two under its heading saying what it is for.'),
    },
    const ['title'],
  ),
  _tool(
    ClaudeBookTool.ticket,
    'A ticket in a notebook, made as the app makes one: the notebook’s next key (HT-4), its first open status unless `status` says another, the fields given, its page added to the notebook and filed where the notebook is. Use this, never create_note, for a ticket. Make one and check it with read_note before making many.',
    {
      'notebook': _string('The notebook’s id, or its exact title.'),
      'title': _string('What the ticket is, in a few words. It is the page’s title.'),
      'status': _string('Its status, one of the notebook’s (To do, In progress, In review, Done, unless it says others).'),
      'assignee': _string('Who does it: a name, or a handle like @matt.'),
      'due': _string('When it is due, as YYYY-MM-DD.'),
      'priority': _string('Highest, High, Medium, Low or Lowest.'),
      'details': _string('Markdown under its heading: what is to be done, where it came from (a [[Meeting note]] link), and anything said about it.'),
    },
    const ['notebook', 'title'],
  ),
  _tool(
    ClaudeBookTool.trash,
    'Moves a note of the person’s own to the Trash, from where they can bring it back. An organization’s note is refused, even one you made: taking it away takes it from every member. For one of those, tell the person which note and why, and they remove it. Say what you moved and why.',
    {'id': _string('The note’s id.')},
    const ['id'],
  ),
];

/// What the system prompt says of them.
const String claudeBookSystem =
    'Notebooks and tickets: make a notebook with create_notebook and its tickets with create_ticket, never by writing their front matter yourself through create_note. Make one ticket and read it back before making the rest. A note you made that came out wrong can go to the Trash with trash_note. When a note does start with front matter, the `---` block comes first and the `# Title` heading after it.';

/// Answers the book tools over a [ClaudeShelf], the folders resolving where things go.
class ClaudeBooks {
  ClaudeBooks(this.shelf, this.folders);

  final ClaudeShelf shelf;
  final ClaudeFolders? folders;

  String? _workspace(Object? asked) {
    final key = (asked as String?)?.trim() ?? '';
    if (key.isEmpty) return null;
    final folders = this.folders;
    if (folders == null) throw const ClaudeBookProblem('Folders cannot be reached here: leave out `folder`.');
    try {
      return folders.resolve(key).id;
    } on ClaudeFolderProblem catch (problem) {
      throw ClaudeBookProblem(problem.message);
    }
  }

  /// Files a note create_note just made in the folder asked for, by the same rule. Answers where.
  String? fileNew(String id, Object? folder) {
    final workspace = _workspace(folder);
    if (workspace == null) return null;
    shelf.fileNew(id, workspace);
    return workspace;
  }

  /// Answers [tool] with [input]: what it says back to Claude, and the step the sheet shows.
  Future<({String said, String step, String? noteId})> answer(String tool, Map<String, Object?> input) async {
    switch (tool) {
      case ClaudeBookTool.notebook:
        final title = (input['title'] as String? ?? '').trim();
        if (title.isEmpty) throw const ClaudeBookProblem('Give the notebook a `title`.');
        if (shelf.findNotebook(title) != null) throw ClaudeBookProblem('There is already a notebook called “$title”. Use it, or name this one differently.');
        final key = (input['ticket_key'] as String?)?.trim().toUpperCase();
        if (key != null && key.isNotEmpty && !RegExp(r'^[A-Z][A-Z0-9]{1,5}$').hasMatch(key)) throw const ClaudeBookProblem('`ticket_key` is 2 to 6 capital letters or digits, starting with a letter, like HT.');
        final workspace = _workspace(input['folder']);
        final id = await shelf.notebook(title: title, key: key == null || key.isEmpty ? null : key, about: (input['about'] as String?)?.trim(), workspaceId: workspace);
        claudeMade.add(id);
        return (said: jsonEncode({'id': id, 'title': title, if (key != null && key.isNotEmpty) 'ticket_key': key, 'done': true}), step: 'Made the notebook $title', noteId: id);
      case ClaudeBookTool.ticket:
        final asked = (input['notebook'] as String? ?? '').trim();
        final title = (input['title'] as String? ?? '').trim();
        if (asked.isEmpty || title.isEmpty) throw const ClaudeBookProblem('Give the `notebook` and the ticket’s `title`.');
        final book = shelf.findNotebook(asked);
        if (book == null) throw ClaudeBookProblem('No notebook “$asked”. Make it with create_notebook, or list notes to find its id.');
        final fields = <(String, String)>[
          for (final field in const ['status', 'assignee', 'due', 'priority'])
            if ((input[field] as String?)?.trim().isNotEmpty ?? false) (field, (input[field]! as String).trim()),
        ];
        final made = await shelf.ticket(notebookId: book.id, title: title, fields: fields, details: (input['details'] as String?)?.trim());
        claudeMade.add(made.id);
        final named = made.key == null ? title : '${made.key} $title';
        return (said: jsonEncode({'id': made.id, 'key': made.key, 'title': title, 'notebook': book.title, 'done': true}), step: 'Made the ticket $named', noteId: made.id);
      case ClaudeBookTool.trash:
        final id = (input['id'] as String? ?? '').trim();
        final title = id.isEmpty ? null : shelf.titleOf(id);
        if (title == null) throw const ClaudeBookProblem('No such note. List or search to find its id.');
        if (shelf.isTeams(id)) {
          throw ClaudeBookProblem('“$title” is the team’s: taking it away would take it from every member. Tell the person which note and why, and ask them to remove it themselves.');
        }
        await shelf.trash(id);
        claudeMade.remove(id);
        return (said: jsonEncode({'id': id, 'title': title, 'trashed': true}), step: 'Moved ${title.isEmpty ? 'a note' : title} to the Trash', noteId: null);
    }
    throw ClaudeBookProblem('There is no tool called $tool.');
  }
}
