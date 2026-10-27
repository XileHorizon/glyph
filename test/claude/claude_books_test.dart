// The app's own Claude over notebooks, tickets and the Trash (lib/claude/claude_books.dart), and what a create cut off
// leaves (Matt, 2026-10-27: the in-app Claude left notes named "book: true", "type: ticket" and "ticket").
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:ghost_md/claude/claude_books.dart';
import 'package:ghost_md/claude/claude_folders.dart';
import 'package:ghost_md/claude/claude_run.dart';
import 'package:ghost_md/claude/claude_tools.dart';
import 'package:ghost_md/claude/live_typing.dart';
import 'package:ghost_md/claude/messages_api.dart';
import 'package:ghost_md/claude/sse.dart';
import 'package:ghost_md/core/note_text.dart' show noteTitle;
import 'package:ghost_md/core/workspaces.dart';
import 'package:ghost_md/editor/editor.dart';
import 'package:ghost_md/editor/view/editor_view.dart';

SseEvent _e(String name, Map<String, Object?> data) => SseEvent(name, jsonEncode(data));

/// A reply calling [tool] with its input in [pieces]; with [whole] false the stream ends before the tool's block
/// closes, as a cut-off one does.
List<SseEvent> _turn({String? tool, List<String> pieces = const [], bool whole = true, String words = ''}) => [
      _e('message_start', {'type': 'message_start'}),
      if (words.isNotEmpty) ...[
        _e('content_block_start', {'index': 0, 'content_block': {'type': 'text', 'text': ''}}),
        _e('content_block_delta', {'index': 0, 'delta': {'type': 'text_delta', 'text': words}}),
        _e('content_block_stop', {'index': 0}),
      ],
      if (tool != null) ...[
        _e('content_block_start', {'index': 1, 'content_block': {'type': 'tool_use', 'id': 'toolu_1', 'name': tool, 'input': <String, Object?>{}}}),
        for (final piece in pieces) _e('content_block_delta', {'index': 1, 'delta': {'type': 'input_json_delta', 'partial_json': piece}}),
        if (whole) _e('content_block_stop', {'index': 1}),
      ],
      _e('message_delta', {'delta': {'stop_reason': tool == null ? 'end_turn' : (whole ? 'tool_use' : 'max_tokens')}}),
      _e('message_stop', {'type': 'message_stop'}),
    ];

List<String> _cut(String json, int size) => [for (var i = 0; i < json.length; i += size) json.substring(i, i + size > json.length ? json.length : i + size)];

class _Api extends ClaudeApi {
  _Api(this.turns) : super(key: 'sk-ant-test');
  final List<List<SseEvent>> turns;
  final List<Map<String, Object?>> asked = [];

  @override
  ClaudeCall stream(Map<String, Object?> body) {
    asked.add(jsonDecode(jsonEncode(body)) as Map<String, Object?>);
    return ClaudeCall(Stream<SseEvent>.fromIterable(turns[asked.length - 1]), () {});
  }
}

class _Notes implements ClaudeNotes {
  final Map<String, String> bodies = {};
  _Desk? desk;
  int _made = 0;

  String _now(String id) => desk?.views[id]?.state.doc.toString() ?? bodies[id]!;

  @override
  Future<List<NoteBrief>> list({String? query, int limit = 50}) async => [for (final id in bodies.keys) NoteBrief(id: id, title: noteTitle(_now(id)))];

  @override
  Future<List<NoteHit>> search(String query, {int limit = 20}) async => const [];

  @override
  Future<NoteRead?> read({String? id, String? title}) async {
    if (id == null || !bodies.containsKey(id)) return null;
    return NoteRead(id: id, title: noteTitle(_now(id)), body: _now(id));
  }

  @override
  Future<String> create(String body) async {
    final id = 'n${++_made}';
    bodies[id] = body;
    return id;
  }

  @override
  Future<void> write(String id, String body) async => bodies[id] = body;
}

class _Desk implements ClaudeDesk {
  _Desk(this.notes) {
    notes.desk = this;
  }
  final _Notes notes;
  final Map<String, EditorView> views = {};

  @override
  Future<EditorViewLike?> open(String noteId) async =>
      views[noteId] ??= EditorView(wholeDocument: true, state: EditorState.create(doc: notes.bodies[noteId] ?? '', extensions: claudeTyping));

  @override
  bool showing(String noteId, EditorViewLike view) => identical(views[noteId], view);

  @override
  Future<void> change(String noteId, String Function(String body) change) async {
    final view = views[noteId];
    if (view == null) {
      notes.bodies[noteId] = change(notes.bodies[noteId] ?? '');
      return;
    }
    final now = view.state.doc.toString();
    view.dispatch(TransactionSpec(changes: ChangeSpec(from: 0, to: now.length, insert: change(now))));
  }

  @override
  bool get smoke => false;
}

/// Notes whose first read of a new note answers it without its opening `---`, as the editor's typing made of it.
class _Eating extends _Notes {
  bool _ate = false;

  @override
  Future<NoteRead?> read({String? id, String? title}) async {
    final note = await super.read(id: id, title: title);
    if (note == null || _ate || !note.body.startsWith('---\n')) return note;
    _ate = true;
    final eaten = note.body.substring(4);
    desk!.views[note.id]!.dispatch(TransactionSpec(changes: ChangeSpec(from: 0, to: note.body.length, insert: eaten)));
    return NoteRead(id: note.id, title: noteTitle(eaten), body: eaten);
  }
}

/// The shelf as a map: notebooks, tickets, what is filed where, and the Trash.
class _Shelf implements ClaudeShelf {
  _Shelf(this.notes, this.store);
  final _Notes notes;
  final WorkspaceStore store;
  final Set<String> trashed = {};
  final Map<String, int> next = {};

  @override
  Future<String> notebook({required String title, String? key, String? about, String? workspaceId}) async {
    final id = await notes.create('---\nbook: true\n${key == null ? '' : 'key: $key\n'}---\n# $title\n\n${about ?? ''}');
    if (workspaceId != null) store.fileNote(id, workspaceId);
    return id;
  }

  @override
  ({String id, String title, String? key})? findNotebook(String asked) {
    for (final MapEntry(:key, :value) in notes.bodies.entries) {
      if (!value.contains('book: true') || trashed.contains(key)) continue;
      if (key == asked || noteTitle(value).toLowerCase() == asked.toLowerCase()) {
        final k = RegExp(r'key: (\w+)').firstMatch(value)?.group(1);
        return (id: key, title: noteTitle(value), key: k);
      }
    }
    return null;
  }

  @override
  Future<({String id, String? key})> ticket({required String notebookId, required String title, required List<(String, String)> fields, String? details}) async {
    final book = findNotebook(notebookId)!;
    final n = next[notebookId] = (next[notebookId] ?? 0) + 1;
    final key = book.key == null ? null : '${book.key}-$n';
    final id = await notes.create('---\ntype: ticket\n${key == null ? '' : 'id: $key\n'}${[for (final (f, v) in fields) '$f: $v\n'].join()}---\n# $title\n\n${details ?? ''}');
    final space = store.workspaceOf(notebookId);
    if (space != null) store.fileNote(id, space.id);
    notes.bodies[notebookId] = '${notes.bodies[notebookId]}\n- [[$title]]';
    return (id: id, key: key);
  }

  @override
  void fileNew(String id, String workspaceId) => store.fileNote(id, workspaceId);

  @override
  bool isTeams(String id) {
    final filed = store.workspaceOf(id);
    return filed != null && store.orgOf(filed.id) != null;
  }

  @override
  String? titleOf(String id) => notes.bodies.containsKey(id) && !trashed.contains(id) ? noteTitle(notes.bodies[id]!) : null;

  @override
  Future<void> trash(String id) async => trashed.add(id);
}

WorkspaceStore _store() => WorkspaceStore(
      storage: MemoryWorkspaceStorage(const WorkspaceSheet(
        list: [
          Workspace(id: 'w-mine', name: 'Mine'),
          Workspace(id: 'org-ht', name: 'HelloTrade'),
          Workspace(id: 'w-tickets', name: 'Tickets', parent: 'org-ht'),
        ],
        notes: {'team-note': 'org-ht'},
      )),
    );

void main() {
  late _Notes notes;
  late WorkspaceStore store;
  late _Shelf shelf;
  late ClaudeBooks books;

  setUp(() {
    claudeMade.clear();
    notes = _Notes();
    store = _store();
    shelf = _Shelf(notes, store);
    books = ClaudeBooks(shelf, ClaudeFolders(store));
    notes.bodies['team-note'] = '# Roadmap\n';
    notes.bodies['mine'] = '# Groceries\n';
  });

  group('the book tools', () {
    test('make a notebook with its ticket key in an organization\'s folder, then tickets in it, numbered and filed with it', () async {
      final book = await books.answer(ClaudeBookTool.notebook, {'title': 'HelloTrade tickets', 'ticket_key': 'ht', 'folder': 'HelloTrade › Tickets'});
      final bookId = (jsonDecode(book.said) as Map)['id'] as String;
      expect(store.workspaceOf(bookId)?.id, 'w-tickets');
      expect(jsonDecode(book.said), containsPair('ticket_key', 'HT'));
      final one = await books.answer(ClaudeBookTool.ticket, {'notebook': 'HelloTrade tickets', 'title': 'Ship the earnings calendar', 'assignee': '@matt', 'due': '2026-11-03', 'details': 'From [[Engineering Standup]].'});
      final ticket = jsonDecode(one.said) as Map;
      expect(ticket['key'], 'HT-1');
      expect(one.step, 'Made the ticket HT-1 Ship the earnings calendar');
      final body = notes.bodies[ticket['id']]!;
      expect(body, contains('type: ticket'));
      expect(body, contains('assignee: @matt'));
      expect(noteTitle(body), 'Ship the earnings calendar');
      expect(store.workspaceOf(ticket['id'] as String)?.id, 'w-tickets', reason: 'filed where its notebook is');
      expect(notes.bodies[bookId], contains('[[Ship the earnings calendar]]'));
      expect(claudeMade, containsAll([bookId, ticket['id']]));
    });

    test('refuse what would go wrong: a ticket in no notebook, a key that will not do, a notebook of a name that is taken', () async {
      await expectLater(books.answer(ClaudeBookTool.ticket, {'notebook': 'Nope', 'title': 'x'}), throwsA(isA<ClaudeBookProblem>()));
      await expectLater(books.answer(ClaudeBookTool.notebook, {'title': 'A', 'ticket_key': 'h t!'}), throwsA(isA<ClaudeBookProblem>()));
      await books.answer(ClaudeBookTool.notebook, {'title': 'Plans'});
      await expectLater(books.answer(ClaudeBookTool.notebook, {'title': 'plans'}), throwsA(isA<ClaudeBookProblem>()));
    });

    test('trash a note of the person\'s own, never a team\'s, even one Claude made', () async {
      final mine = await books.answer(ClaudeBookTool.trash, {'id': 'mine'});
      expect(jsonDecode(mine.said), containsPair('trashed', true));
      expect(shelf.trashed, {'mine'});
      await expectLater(books.answer(ClaudeBookTool.trash, {'id': 'team-note'}), throwsA(isA<ClaudeBookProblem>().having((p) => p.message, 'says', contains('every member'))));
      expect(shelf.trashed, {'mine'});
      // Made by Claude in the team's folder: still the team's, and the person's to remove.
      final made = await books.answer(ClaudeBookTool.notebook, {'title': 'Wrong one', 'folder': 'HelloTrade'});
      final id = (jsonDecode(made.said) as Map)['id'] as String;
      expect(shelf.isTeams(id), isTrue);
      await expectLater(books.answer(ClaudeBookTool.trash, {'id': id}), throwsA(isA<ClaudeBookProblem>()));
      expect(shelf.trashed, isNot(contains(id)));
    });
  });

  group('a run', () {
    testWidgets('is offered the book tools, and told to use them for notebooks and tickets', (tester) async {
      final api = _Api([_turn(words: 'Nothing to do.')]);
      final run = ClaudeRun(api: api, model: 'claude-sonnet-5-5', notes: notes, desk: _Desk(notes), books: books, folders: ClaudeFolders(store), prompt: 'Hi', system: claudeSystem(now: DateTime(2026, 10, 27), books: true));
      await tester.runAsync(run.run);
      final tools = [for (final tool in api.asked.first['tools']! as List) (tool as Map)['name']];
      expect(tools, containsAll(ClaudeBookTool.all));
      expect(api.asked.first['system'], contains('create_notebook'));
    });

    testWidgets('a note being made that is cut off before its words are whole is taken back to the Trash', (tester) async {
      final half = jsonEncode({'body': '---\nbook: true\nkey: HT\n---\n# HelloTrade\n\n1. [[One]]'});
      final api = _Api([
        _turn(tool: ClaudeTool.create, pieces: _cut(half.substring(0, 18), 4), whole: false),
        _turn(words: 'It was cut off.'),
      ]);
      final run = ClaudeRun(api: api, model: 'claude-sonnet-5-5', notes: notes, desk: _Desk(notes), books: books, prompt: 'Make the notebook');
      await tester.runAsync(run.run);
      final made = notes.bodies.keys.where((id) => id.startsWith('n')).toList();
      expect(made, hasLength(1));
      expect(shelf.trashed, contains(made.single), reason: 'the half-made note goes to the Trash');
      expect([for (final step in run.steps) step.words], contains('Took back a note that was cut off before it was whole'));
      expect(run.touched, isNot(contains(made.single)));
    });

    testWidgets('a note typed in whole that the editor made something else of is put right to the words sent', (tester) async {
      final words = '---\nbook: true\nkey: HT\n---\n# HelloTrade Tickets\n\nFrom the standup.\n';
      final eats = _Eating();
      final desk = _Desk(eats);
      final api = _Api([
        _turn(tool: ClaudeTool.create, pieces: _cut(jsonEncode({'body': words}), 6)),
        _turn(words: 'Done.'),
      ]);
      final run = ClaudeRun(api: api, model: 'claude-sonnet-5-5', notes: eats, desk: desk, prompt: 'Make it');
      await tester.runAsync(run.run);
      expect(desk.views['n1']!.state.doc.toString(), words);
      expect(run.touched, {'n1': 'HelloTrade Tickets'});
    });

    testWidgets('create_note makes its note in the folder asked for, an organization\'s too', (tester) async {
      final api = _Api([
        _turn(tool: ClaudeTool.create, pieces: _cut(jsonEncode({'folder': 'HelloTrade › Tickets', 'body': '# Meeting notes\n\nWords.\n'}), 7)),
        _turn(words: 'Done.'),
      ]);
      final run = ClaudeRun(api: api, model: 'claude-sonnet-5-5', notes: notes, desk: _Desk(notes), books: books, prompt: 'Write it up');
      await tester.runAsync(run.run);
      final id = notes.bodies.keys.firstWhere((id) => id.startsWith('n'));
      expect(store.workspaceOf(id)?.id, 'w-tickets');
      final second = api.asked[1]['messages']! as List;
      final answer = jsonDecode(((second.last as Map)['content'] as List).single['content'] as String) as Map;
      expect(answer['folder'], 'w-tickets');
      expect(shelf.trashed, isEmpty);
    });
  });
}
