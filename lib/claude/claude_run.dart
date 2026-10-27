/// One ask of the app's own Claude, run to its end (docs/CLAUDE_APP.md, "A run"): the request streamed, Claude's
/// words shown as they come, each tool it calls answered, and the next request made with the answers, until Claude
/// stops calling tools, is stopped, or fails.
///
/// A tool that writes a note is played out on screen as it streams ([_Writing]): the note made or opened, the old
/// words of a passage taken out, and Claude's new ones typed in at its caret (lib/claude/live_typing.dart). Where
/// the note cannot be shown (the person went elsewhere, or there is no screen), it is written behind it, the same
/// change by the library.
///
/// **Claude's thinking, shown** (Matt, 2026-10-17: "show claudes or whatever AI agent were using thought process"):
/// every request asks for adaptive thinking with its summary shown (`thinking: {type: adaptive, display:
/// summarized}`), where the model takes it ([claudeShowsThinking]). The current models think whether asked or not and
/// hand back each thinking block with its text empty unless `display` asks for it; so the ask changes what is seen,
/// not what is billed. The summary arrives as `thinking_delta`s, read into [ClaudeRun.thinking] as they come and kept
/// as a `thought` step once the block closes. Every thinking block, an empty one and a `redacted_thinking` one too,
/// goes back in the conversation exactly as it came, with its signature: the API checks them, and a block changed or
/// left out of a tool's turn is refused.
///
/// **The spending limit** (lib/claude/claude_spend.dart): every request is counted as it ends ([meterClaude]), and
/// none is sent once the month's limit is reached: a run asked then fails at once with [claudeLimitMessage], and one
/// that crosses it in the request it is in finishes that request (its tools answered) and starts no other, ending
/// with the same words. "Warn me at 80%" is a `notice` step, once a month.
library;

import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../editor/editor.dart' show EditorViewLike;
import 'claude_books.dart';
import 'claude_folders.dart';
import 'claude_spend.dart';
import 'claude_tools.dart';
import 'live_typing.dart';
import 'messages_api.dart';
import 'partial_json.dart';

/// Where a run reaches the screen: lib/root's, over the shell and the open notes; a test's, over a view of its own.
abstract interface class ClaudeDesk {
  /// Opens [noteId] on screen and answers its editor once it has one, or null where it cannot be shown.
  Future<EditorViewLike?> open(String noteId);

  /// Whether [view] is still [noteId]'s editor on screen.
  bool showing(String noteId, EditorViewLike view);

  /// [noteId]'s words changed by [change]: through its editor where it is open, else in the library.
  Future<void> change(String noteId, String Function(String body) change);

  /// Whether Claude's words rise out of smoke (Ghostly typing).
  bool get smoke;
}

/// Where a run is.
enum ClaudeState { idle, thinking, writing, done, stopped, failed }

/// One thing a run did, as its sheet lists it.
@immutable
class ClaudeStep {
  const ClaudeStep({required this.kind, required this.words, this.noteId});

  /// `said` for Claude's words, `asked` for the person's, `tool` for what a tool did, `thought` for the summary of
  /// what Claude thought before it went on, `notice` for what the app says (the spending limit's warning).
  final String kind;
  final String words;
  final String? noteId;
}

/// The note a writing tool is in, for the bar and the dock.
@immutable
class ClaudeAt {
  const ClaudeAt(this.noteId, this.title, this.doing);

  final String noteId;
  final String title;

  /// `writing`, `reading` or `opening`.
  final String doing;
}

/// How many requests one run may make: each tool answer is one more.
const int claudeTurnLimit = 24;

/// What a request asks of Claude's thinking: adaptive, its summary shown. Only the models the app offers
/// (lib/claude/claude_settings.dart `claudeModels`, each of which thinks adaptively and shows a summary when asked);
/// another id kept from before is sent no `thinking` at all, rather than one it might refuse.
Map<String, Object?>? claudeThinkingFor(String model) => claudeShowsThinking(model) ? const {'type': 'adaptive', 'display': 'summarized'} : null;

/// Whether [model] is asked for its thinking (see [claudeThinkingFor]).
bool claudeShowsThinking(String model) => const {'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'}.contains(model);

/// One run.
class ClaudeRun extends ChangeNotifier {
  ClaudeRun({
    required this.api,
    required this.model,
    this.effort,
    required this.notes,
    required this.desk,
    this.folders,
    this.books,
    required this.prompt,
    this.system,
    this.maxTokens = 16000,
    this.spend,
    List<Map<String, Object?>>? history,
  }) : _messages = [...?history];

  final ClaudeApi api;
  final String model;

  /// The effort to ask for (`output_config.effort`), or null for the model's own.
  final String? effort;
  final ClaudeNotes notes;
  final ClaudeDesk desk;

  /// The folders, where Claude may arrange them and file notes in them (lib/claude/claude_folders.dart, GHST-108);
  /// none, and the folder tools are not offered.
  final ClaudeFolders? folders;

  /// Notebooks, tickets and the Trash (lib/claude/claude_books.dart); none, and those tools are not offered.
  final ClaudeBooks? books;
  final String prompt;
  final String? system;
  final int maxTokens;

  /// Where each request is counted, and the limit that keeps one from being sent; none, and nothing is counted.
  final ClaudeSpend? spend;

  final List<Map<String, Object?>> _messages;

  /// The conversation so far, as the API takes it: for a follow-up ask in the same sheet.
  List<Map<String, Object?>> get messages => List.unmodifiable(_messages);

  ClaudeState _state = ClaudeState.idle;
  ClaudeState get state => _state;
  bool get working => _state == ClaudeState.thinking || _state == ClaudeState.writing;

  final List<ClaudeStep> _steps = [];
  List<ClaudeStep> get steps => List.unmodifiable(_steps);

  /// Claude's words of the request in flight, as they come.
  String _saying = '';
  String get saying => _saying;

  /// The summary of Claude's thinking in the block streaming now, as it comes; '' between blocks. A thought that
  /// has closed is a `thought` step ([lastThought]).
  String _thinking = '';
  String get thinking => _thinking;

  /// The last thought Claude finished, or ''.
  String get lastThought {
    for (final step in _steps.reversed) {
      if (step.kind == 'thought') return step.words;
    }
    return '';
  }

  /// Every note this run wrote, by id, with its title.
  final Map<String, String> touched = {};

  ClaudeAt? _at;
  ClaudeAt? get at => _at;

  /// Whether the note Claude writes in is opened and kept scrolled to its caret. Stop following and the words still
  /// go in, out of sight.
  bool _following = true;
  bool get following => _following;

  String? _problem;
  String? get problem => _problem;

  ClaudeCall? _call;
  bool _stopped = false;
  _Writing? _writing;

  /// The last thing Claude said, whole: the run's answer.
  String get answer {
    for (final step in _steps.reversed) {
      if (step.kind == 'said') return step.words;
    }
    return '';
  }

  void stopFollowing() {
    if (!_following) return;
    _following = false;
    notifyListeners();
  }

  /// Where Claude last typed in each note this run wrote, and in which editor: the caret shown and scrolled to when
  /// the note is opened to follow Claude, and taken away when the run ends.
  final Map<String, ({EditorViewLike view, int at})> _lastTyped = {};

  /// Follows Claude again: the note it is in opened, its caret shown where Claude last typed and the page scrolled
  /// there (Matt: "scroll the screen to there after navigating us to the note").
  void follow() {
    _following = true;
    notifyListeners();
    final at = _at;
    if (at != null) unawaited(_watch(at.noteId));
  }

  Future<void> _watch(String noteId) async {
    final view = await desk.open(noteId);
    if (view == null || !_following) return;
    // The typer's caret where this editor has it (Claude is typing here now), else where Claude last typed, which an
    // editor made again for the note no longer holds.
    final place = claudeCaretOf(view.state) ?? _writing?.typer?.at ?? _lastTyped[noteId]?.at;
    if (place == null) return;
    _lastTyped[noteId] = (view: view, at: place);
    showClaudeCaret(view, place);
    final typer = _writing?.typer;
    if (typer != null && identical(typer.view, view)) typer.rewatch();
  }

  /// Where Claude finished typing in [noteId].
  void _typedTo(String noteId, NoteTyper typer) {
    final at = typer.at ?? typer.lastAt;
    if (at == null) return;
    final was = _lastTyped[noteId];
    // A caret left in another editor of this note (one closed and opened again) is taken out of it.
    if (was != null && !identical(was.view, typer.view)) clearClaudeCaret(was.view);
    _lastTyped[noteId] = (view: typer.view, at: at);
  }

  /// The run is over: no caret of Claude's is left in any note.
  void _clearCarets() {
    for (final typed in _lastTyped.values) {
      clearClaudeCaret(typed.view);
    }
  }

  /// Stops the run: the request closed, what was being typed put in at once.
  void stop() {
    if (!working) return;
    _stopped = true;
    _writing?.typer?.flush();
    _call?.cancel();
  }

  void _set(ClaudeState state) {
    _state = state;
    notifyListeners();
  }

  /// Runs to the end. Never throws: a failure is [problem], with [state] [ClaudeState.failed].
  Future<void> run() async {
    if (_state != ClaudeState.idle) return;
    _messages.add({
      'role': 'user',
      'content': [
        {'type': 'text', 'text': prompt},
      ],
    });
    _steps.add(ClaudeStep(kind: 'asked', words: prompt));
    _set(ClaudeState.thinking);
    try {
      _notice();
      for (var turn = 0; turn < claudeTurnLimit; turn += 1) {
        // The limit reached, before this run or by its last request: nothing more is sent.
        final spend = this.spend;
        if (spend != null && spend.reached) throw claudeLimitError(spend);
        final reply = await _ask();
        _notice();
        if (reply.content.isNotEmpty) _messages.add({'role': 'assistant', 'content': reply.content});
        // Every tool Claude called is answered in the conversation, even when stopped, so a follow-up ask is whole.
        if (reply.results.isNotEmpty) _messages.add({'role': 'user', 'content': reply.results});
        if (_stopped) break;
        if (reply.stop != 'tool_use' || reply.results.isEmpty) break;
        _set(ClaudeState.thinking);
      }
      _at = null;
      _clearCarets();
      _set(_stopped ? ClaudeState.stopped : ClaudeState.done);
    } on ClaudeCancelled {
      _at = null;
      _clearCarets();
      _set(ClaudeState.stopped);
    } catch (error) {
      _at = null;
      _clearCarets();
      _problem = error is ClaudeError ? error.message : 'Something went wrong: $error';
      _set(ClaudeState.failed);
    } finally {
      _call = null;
    }
  }

  /// "Warn me at 80%": the month's one notice, as a step of its own.
  void _notice() {
    final words = spend?.takeNotice();
    if (words == null) return;
    _steps.add(ClaudeStep(kind: 'notice', words: words));
    notifyListeners();
  }

  /// One request, streamed: Claude's words and tools as they come, each tool answered once its input is whole.
  Future<_Reply> _ask() async {
    final thinking = claudeThinkingFor(model);
    final spend = this.spend;
    final asked = api.stream({
      'model': model,
      'max_tokens': maxTokens,
      'thinking': ?thinking,
      if (effort != null) 'output_config': {'effort': effort},
      if (system != null) 'system': system,
      'tools': [...claudeTools, if (folders != null) ...claudeFolderTools, if (books != null) ...claudeBookTools],
      'messages': _messages,
    });
    final call = _call = spend == null ? asked : meterClaude(asked, model: model, spend: spend);
    final blocks = <int, _Block>{};
    final content = <Map<String, Object?>>[];
    final results = <Map<String, Object?>>[];
    String? stop;
    _saying = '';
    _thinking = '';
    Object? failure;
    await for (final event in call.events.handleError((Object error) => failure ??= error)) {
      final data = _json(event.data);
      switch (event.event) {
        case 'content_block_start':
          final index = (data['index'] as num?)?.toInt() ?? 0;
          final block = data['content_block'];
          if (block is! Map) break;
          if (block['type'] == 'text') {
            blocks[index] = _Block.text();
          } else if (block['type'] == 'thinking') {
            blocks[index] = _Block.thought()..text.write(block['thinking'] as String? ?? '');
          } else if (block['type'] == 'redacted_thinking') {
            // Whole as it starts: nothing of it is read, and it goes back as it came.
            blocks[index] = _Block.thought(redacted: block['data'] as String? ?? '');
          } else if (block['type'] == 'tool_use') {
            final made = blocks[index] = _Block.tool(block['id'] as String? ?? '', block['name'] as String? ?? '');
            final field = ClaudeTool.typed[made.name];
            if (field != null) {
              made.reader = (_writing = _Writing(this, made.name!, field)).reader;
            } else {
              made.reader = PartialFields();
            }
          }
        case 'content_block_delta':
          final index = (data['index'] as num?)?.toInt() ?? 0;
          final block = blocks[index];
          final delta = data['delta'];
          if (block == null || delta is! Map) break;
          if (delta['type'] == 'text_delta') {
            final text = delta['text'] as String? ?? '';
            block.text.write(text);
            _saying += text;
            notifyListeners();
          } else if (delta['type'] == 'thinking_delta') {
            final text = delta['thinking'] as String? ?? '';
            block.text.write(text);
            _thinking += text;
            if (text.isNotEmpty) notifyListeners();
          } else if (delta['type'] == 'signature_delta') {
            block.signature.write(delta['signature'] as String? ?? '');
          } else if (delta['type'] == 'input_json_delta') {
            final piece = delta['partial_json'] as String? ?? '';
            block.json.write(piece);
            block.reader?.add(piece);
          }
        case 'content_block_stop':
          final index = (data['index'] as num?)?.toInt() ?? 0;
          final block = blocks[index];
          if (block == null) break;
          if (block.thought) {
            // Back exactly as it came, empty or not: the API checks it.
            final redacted = block.redacted;
            if (redacted != null) {
              content.add({'type': 'redacted_thinking', 'data': redacted});
            } else {
              final words = block.text.toString();
              content.add({'type': 'thinking', 'thinking': words, 'signature': block.signature.toString()});
              if (words.trim().isNotEmpty) _steps.add(ClaudeStep(kind: 'thought', words: words.trim()));
            }
            _thinking = '';
            notifyListeners();
          } else if (block.name == null) {
            final words = block.text.toString();
            // The API refuses an empty text block back.
            if (words.isNotEmpty) content.add({'type': 'text', 'text': words});
            if (words.trim().isNotEmpty) _steps.add(ClaudeStep(kind: 'said', words: words.trim()));
            _saying = '';
            notifyListeners();
          } else {
            Map<String, Object?>? input;
            try {
              final parsed = jsonDecode(block.json.isEmpty ? '{}' : block.json.toString());
              if (parsed is Map) input = parsed.cast<String, Object?>();
            } catch (_) {
              input = null;
            }
            content.add({'type': 'tool_use', 'id': block.id, 'name': block.name, 'input': input ?? const <String, Object?>{}});
            results.add(await _answer(block, input));
          }
        case 'message_delta':
          final delta = data['delta'];
          if (delta is Map && delta['stop_reason'] is String) stop = delta['stop_reason'] as String;
        case 'error':
          final error = data['error'];
          failure ??= ClaudeError(error is Map ? (error['message'] as String? ?? 'Claude stopped with an error.') : 'Claude stopped with an error.', type: error is Map ? error['type'] as String? : null);
      }
    }
    if (failure != null) {
      // What was being typed when it broke is finished before the run ends.
      await _writing?.abandon();
      throw failure!;
    }
    // A tool whose block never closed (the stream ended mid-input, max_tokens) is answered as broken.
    for (final block in blocks.values) {
      if (block.name != null && !block.answered) {
        await _writing?.abandon();
        _writing = null;
        content.add({'type': 'tool_use', 'id': block.id, 'name': block.name, 'input': const <String, Object?>{}});
        results.add(_result(block.id!, 'The input was cut off before it was whole; nothing was done.', error: true));
      }
    }
    return _Reply(content, results, stop);
  }

  static Map<String, Object?> _json(String data) {
    try {
      final parsed = jsonDecode(data);
      return parsed is Map ? parsed.cast<String, Object?>() : const {};
    } catch (_) {
      return const {};
    }
  }

  Map<String, Object?> _result(String id, String text, {bool error = false}) => {
        'type': 'tool_result',
        'tool_use_id': id,
        'content': text,
        if (error) 'is_error': true,
      };

  /// The tool's answer, once its input is whole.
  Future<Map<String, Object?>> _answer(_Block block, Map<String, Object?>? input) async {
    block.answered = true;
    final id = block.id!, name = block.name!;
    if (input == null) {
      await _writing?.abandon();
      _writing = null;
      return _result(id, jsonEncode({'INVALID_JSON': block.json.toString()}), error: true);
    }
    try {
      final writing = ClaudeTool.typed.containsKey(name) ? _writing : null;
      _writing = null;
      final said = writing != null ? await writing.finish(input) : await _read(name, input);
      return _result(id, said);
    } on _ToolProblem catch (problem) {
      return _result(id, problem.message, error: true);
    } catch (error) {
      return _result(id, 'That did not work: $error', error: true);
    }
  }

  /// The tools that read, open_note, and the folder tools.
  Future<String> _read(String name, Map<String, Object?> input) async {
    final books = this.books;
    if (books != null && ClaudeBookTool.all.contains(name)) {
      try {
        final done = await books.answer(name, input);
        if (done.noteId != null) touched[done.noteId!] = books.shelf.titleOf(done.noteId!) ?? '';
        _tool(done.step, done.noteId);
        return done.said;
      } on ClaudeBookProblem catch (problem) {
        throw _ToolProblem(problem.message);
      }
    }
    final folders = this.folders;
    if (folders != null && ClaudeFolderTool.all.contains(name)) {
      try {
        final done = await folders.answer(name, input, notes);
        _tool(done.step);
        return done.said;
      } on ClaudeFolderProblem catch (problem) {
        throw _ToolProblem(problem.message);
      }
    }
    switch (name) {
      case ClaudeTool.list:
        final query = (input['query'] as String?)?.trim();
        final limit = ((input['limit'] as num?)?.toInt() ?? 30).clamp(1, 200).toInt();
        _tool('Looked through the notes${query == null || query.isEmpty ? '' : ' for “$query”'}');
        final found = await notes.list(query: query, limit: limit);
        return jsonEncode({'count': found.length, 'notes': [for (final note in found) note.toJson()]});
      case ClaudeTool.search:
        final query = (input['query'] as String? ?? '').trim();
        if (query.isEmpty) throw const _ToolProblem('Give `query`.');
        _tool('Searched for “$query”');
        final found = await notes.search(query);
        return jsonEncode({'count': found.length, 'notes': [for (final hit in found) hit.toJson()]});
      case ClaudeTool.read:
        final note = await notes.read(id: input['id'] as String?, title: input['title'] as String?);
        if (note == null) throw const _ToolProblem('No such note. List or search to find its id.');
        _at = ClaudeAt(note.id, note.title, 'reading');
        _tool('Read ${note.title.isEmpty ? 'a note' : note.title}', note.id);
        return jsonEncode({'id': note.id, 'title': note.title, 'body': note.body});
      case ClaudeTool.open:
        final noteId = input['id'] as String? ?? '';
        final note = await notes.read(id: noteId);
        if (note == null) throw const _ToolProblem('No such note.');
        _at = ClaudeAt(note.id, note.title, 'opening');
        _tool('Opened ${note.title}', note.id);
        if (_following) await desk.open(note.id);
        return 'Opened.';
    }
    throw _ToolProblem('There is no tool called $name.');
  }

  void _tool(String words, [String? noteId]) {
    _steps.add(ClaudeStep(kind: 'tool', words: words, noteId: noteId));
    notifyListeners();
  }
}

class _ToolProblem implements Exception {
  const _ToolProblem(this.message);
  final String message;
}

class _Reply {
  _Reply(this.content, this.results, this.stop);

  final List<Map<String, Object?>> content;
  final List<Map<String, Object?>> results;
  final String? stop;
}

class _Block {
  _Block.text()
      : id = null,
        name = null,
        thought = false,
        redacted = null;
  _Block.tool(this.id, this.name)
      : thought = false,
        redacted = null;
  _Block.thought({this.redacted})
      : id = null,
        name = null,
        thought = true;

  final String? id;
  final String? name;

  /// A thinking block: its summary in [text], its [signature]; or, [redacted], one sent sealed.
  final bool thought;
  final String? redacted;
  final StringBuffer signature = StringBuffer();
  final StringBuffer text = StringBuffer();
  final StringBuffer json = StringBuffer();
  PartialFields? reader;
  bool answered = false;
}

/// A writing tool as it streams: told each field as it is read ([FieldListener]); once its words start, the note is
/// made or opened and the words typed into it; [finish] with the whole input.
class _Writing extends FieldListener {
  _Writing(this.run, this.tool, this.field);

  final ClaudeRun run;
  final String tool;

  /// The field whose words are typed.
  final String field;

  /// The reader of the tool's input, which tells this as it reads.
  late final PartialFields reader = PartialFields(this);

  /// The note being written, once known.
  String? noteId;

  /// The editor and its typer, once the note is open.
  NoteTyper? typer;

  /// Words that came before the note was open, typed once it is.
  final StringBuffer _early = StringBuffer();

  /// Settles when the note is open, or found not to be (then [typer] is null).
  Future<void>? _ready;

  /// Why the words could not be typed (an old passage not found): the tool answers with it.
  String? _refused;

  /// The note's title as it was, for the steps.
  String _title = '';

  /// Whether this tool made the note it writes (create_note): one cut off before its words were whole is taken back.
  bool _made = false;

  /// Whether the note was to be shown (made, or followed) and the screen could not show it: its words are written
  /// behind the screen all the same, and the run says so, to the person and to Claude.
  bool _unseen = false;

  @override
  void started(String key) {
    if (key != field) return;
    _ready = _open();
  }

  @override
  void letters(String key, String text) {
    if (key != field || _refused != null) return;
    final typer = this.typer;
    if (typer == null) {
      _early.write(text);
    } else {
      typer.type(text);
    }
  }

  Future<void> _open() async {
    final String id;
    var created = false;
    if (tool == ClaudeTool.create) {
      id = await run.notes.create('');
      created = true;
      _made = true;
      claudeMade.add(id);
      _title = 'a new note';
    } else {
      final named = reader.strings['id'];
      if (named == null || !reader.whole.contains('id')) return;
      final note = await run.notes.read(id: named);
      if (note == null) {
        _refused = 'No such note. List or search to find its id.';
        return;
      }
      id = named;
      _title = note.title;
    }
    noteId = id;
    run.touched[id] = _title;
    run._at = ClaudeAt(id, _title, 'writing');
    run._set(ClaudeState.writing);
    final shown = run._following || created;
    final view = shown ? await run.desk.open(id) : null;
    if (view == null) {
      // The words are kept as they come and written whole by [finish] (see [_behind]): none are lost.
      _unseen = shown;
      return;
    }
    final body = view.state.doc.toString();
    final made = NoteTyper(view, follow: () => run._following, smoke: () => run.desk.smoke, open: () => run.desk.showing(id, view), onTouched: run.stopFollowing);
    switch (tool) {
      case ClaudeTool.create:
        made.begin(0, to: body.length);
      case ClaudeTool.append:
        made.begin(body.length);
        if (body.isNotEmpty && !body.endsWith('\n')) made.type('\n');
      case ClaudeTool.rewrite:
        made.begin(0, to: body.length);
      case ClaudeTool.replace:
        final old = reader.strings['old_text'] ?? '';
        if (old.isEmpty || !reader.whole.contains('old_text')) return;
        final at = body.indexOf(old);
        if (at < 0 || body.indexOf(old, at + 1) >= 0) {
          _refused = at < 0 ? '`old_text` is not in the note. Read it again and copy the words exactly.' : '`old_text` is in the note more than once. Give more of it, so it is found once.';
          return;
        }
        made.begin(at, to: at + old.length);
    }
    typer = made;
    if (_early.isNotEmpty) {
      made.type(_early.toString());
      _early.clear();
    }
  }

  /// The tool's input is whole: what was typed is finished, and anything the screen could not take is written
  /// behind it. Answers what the tool says back to Claude.
  Future<String> finish(Map<String, Object?> input) async {
    await _ready;
    final typer = this.typer;
    if (typer != null) {
      await typer.end();
      final typed = noteId;
      if (typed != null) run._typedTo(typed, typer);
    }
    final refused = _refused;
    if (refused != null) throw _ToolProblem(refused);
    final words = input[field] as String? ?? '';
    final String id;
    final known = noteId ?? input['id'] as String?;
    if (known == null) {
      if (tool != ClaudeTool.create) throw const _ToolProblem('Give the note’s `id`.');
      // Made whole, never opened: nothing of it was streamed.
      id = noteId = await run.notes.create(words);
      claudeMade.add(id);
    } else {
      id = known;
      if (typer == null || !typer.whole) await _behind(id, input, typer);
      // A whole note typed in is checked against the words Claude sent: the editor's own typing rules may have made
      // something else of them (a `---` on a new note's first line was taken, and its front matter's first key became
      // its title: "book: true"). The words sent are what the note is.
      if ((tool == ClaudeTool.create || tool == ClaudeTool.rewrite) && words.isNotEmpty) {
        final typed = await run.notes.read(id: id);
        if (typed != null && typed.body != words) await run.desk.change(id, (_) => words);
      }
    }
    // Made in the folder asked for, an organization's included: a note made new shares nothing of the person's.
    String? filedIn;
    if (tool == ClaudeTool.create && input['folder'] != null) {
      try {
        filedIn = run.books?.fileNew(id, input['folder']);
      } on ClaudeBookProblem catch (problem) {
        throw _ToolProblem('The note was made, but not filed: ${problem.message}');
      }
    }
    final note = await run.notes.read(id: id);
    final title = note?.title ?? _title;
    run.touched[id] = title;
    final did = switch (tool) {
      ClaudeTool.create => 'Wrote $title',
      ClaudeTool.append => 'Added to $title',
      ClaudeTool.replace => 'Changed $title',
      _ => 'Rewrote $title',
    };
    run._tool(_unseen ? '$did, out of sight: it could not be opened' : did, id);
    return jsonEncode({
      'id': id,
      'title': title,
      'done': true,
      'folder': ?filedIn,
      if (_unseen) 'shown': 'No: the note could not be opened on the screen, so its words were written without being shown. Tell the person it is there.',
    });
  }

  /// The change written by the desk where the screen did not take it: the whole of it when nothing was typed, or
  /// what was left where the note was closed under Claude.
  Future<void> _behind(String id, Map<String, Object?> input, NoteTyper? typer) async {
    if (typer != null && typer.lastAt != null) {
      final left = typer.left, at = typer.lastAt!;
      if (left.isEmpty) return;
      await run.desk.change(id, (body) {
        final place = at.clamp(0, body.length);
        return body.substring(0, place) + left + body.substring(place);
      });
      return;
    }
    final words = input[field] as String? ?? '';
    await run.desk.change(id, (body) {
      switch (tool) {
        case ClaudeTool.create:
        case ClaudeTool.rewrite:
          return words;
        case ClaudeTool.append:
          return body.isEmpty ? words : '${body.endsWith('\n') ? body : '$body\n'}$words';
        case ClaudeTool.replace:
          final old = input['old_text'] as String? ?? '';
          final at = old.isEmpty ? -1 : body.indexOf(old);
          if (at < 0 || body.indexOf(old, at + 1) >= 0) {
            throw _ToolProblem(at < 0 ? '`old_text` is not in the note. Read it again and copy the words exactly.' : '`old_text` is in the note more than once. Give more of it.');
          }
          return body.substring(0, at) + words + body.substring(at + old.length);
      }
      return body;
    });
  }

  /// The stream broke: what was typed stays, and what waits is put in.
  Future<void> abandon() async {
    await _ready;
    final typer = this.typer, typed = noteId;
    if (typer != null) {
      typer.flush();
      await typer.end();
      // Its caret is taken out with the others' as the run ends.
      if (typed != null) run._typedTo(typed, typer);
    }
    // A note this tool made whose words never came whole (the stream cut off, the run stopped) is half a note, titled
    // by whatever line it got to ("book: true"): taken back to the Trash, and the step says so.
    final shelf = run.books?.shelf;
    if (_made && typed != null && shelf != null) {
      try {
        await shelf.trash(typed);
        claudeMade.remove(typed);
        run.touched.remove(typed);
        run._tool('Took back a note that was cut off before it was whole');
      } catch (_) {
        // Left as it is: the person can delete it.
      }
    }
  }
}
