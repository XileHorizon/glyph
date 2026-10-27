/// The app's own Claude, for the whole app (docs/CLAUDE_APP.md): the settings, the one run at a time, the
/// conversation an Ask Claude sheet continues, and the inbox.
///
/// One run at a time: an ask while one is working waits for it (the inbox's requests queue behind the person's).
/// The conversation is kept until the sheet's New chat or the app closes; it is never written anywhere.
///
/// A conversation keeps the system prompt it began with: Claude's thinking blocks go back with every follow-up
/// (lib/claude/claude_run.dart), and the API refuses a block once anything sent before it has changed, the system
/// prompt included. So a follow-up asked the next day, or after the "Claude rules" note was edited, is asked with the
/// day and the rules the conversation started with; New chat takes the new ones.
library;

import 'dart:async';

import 'package:flutter/foundation.dart';

import 'claude_books.dart' show ClaudeBooks;
import 'claude_folders.dart';
import 'claude_run.dart';
import 'claude_settings.dart';
import 'claude_spend.dart' show claudeLimitError;
import 'claude_tools.dart';
import 'messages_api.dart';

/// The title of the note of standing instructions the connector keeps (mcp/server.ts `ensureRulesNote`), handed to
/// the app's Claude too.
const String claudeRulesTitle = 'Claude rules';

/// A DEBUG BUILD'S AND A TEST'S ONLY: the API a run is given in place of Anthropic's, for a test that drives the
/// root's own runner (test/root/claude_new_note_test.dart). Read only where `kDebugMode`, a constant false in a
/// release, so a release always talks to the real API.
@visibleForTesting
ClaudeApi Function(String key)? debugClaudeApi;

class ClaudeRunner extends ChangeNotifier {
  ClaudeRunner({required this.settings, required this.notes, required this.desk, ClaudeApi Function(String key)? api, DateTime Function()? now, this.allowed, this.folders, this.books})
      : _api = api ?? ((key) => ClaudeApi(key: key)),
        _now = now ?? DateTime.now {
    settings.addListener(notifyListeners);
  }

  final ClaudeSettings settings;

  /// Whether the app's Claude is on (the Claude plugin's switch, lib/plugins/claude): an ask while it is off is
  /// refused. Always, where none is given.
  final bool Function()? allowed;
  final ClaudeNotes notes;
  final ClaudeDesk desk;

  /// The folders Claude may arrange (GHST-108); none, and it is offered no folder tools.
  final ClaudeFolders? folders;

  /// Notebooks, tickets and the Trash (lib/claude/claude_books.dart); none, and those tools are not offered.
  final ClaudeBooks? books;
  final ClaudeApi Function(String key) _api;
  final DateTime Function() _now;

  ClaudeRun? _run;

  /// The run working now, or the last one.
  ClaudeRun? get run => _run;

  bool get working => _run?.working ?? false;

  /// The ask the sheet shows, for a follow-up: the conversation's messages so far.
  List<Map<String, Object?>> _history = const [];

  /// The runs of this conversation, oldest first, for the sheet.
  final List<ClaudeRun> conversation = [];

  /// The system prompt this conversation was begun with, kept for its follow-ups (see the header).
  String? _system;

  Future<void> _queue = Future<void>.value();

  /// Whether Claude can be asked: a key is kept.
  bool get ready => settings.hasKey;

  /// Whether this month's spending limit is reached, so an ask is refused (lib/claude/claude_spend.dart).
  bool get limited => settings.spend.reached;

  /// Asks Claude. In the sheet's conversation unless [alone] (the inbox's requests are each their own). Answers the
  /// run once it has started, which is after any run before it has ended. [desk] in place of the screen's, for a run
  /// that writes out of sight (a request from the watch with the app in the background).
  Future<ClaudeRun> ask(String prompt, {bool alone = false, String? extraSystem, ClaudeDesk? desk}) {
    final started = Completer<ClaudeRun>();
    _queue = _queue.then((_) => _start(prompt, started, alone: alone, extraSystem: extraSystem, desk: desk)).catchError((Object error) {
      // A failure here never stops the asks after it.
      if (!started.isCompleted) started.completeError(error);
    });
    return started.future;
  }

  Future<void> _start(String prompt, Completer<ClaudeRun> started, {required bool alone, String? extraSystem, ClaudeDesk? desk}) async {
    if (!(allowed?.call() ?? true)) {
      started.completeError(const ClaudeError('Claude is switched off on this device. Add it in the Market.'));
      return;
    }
    await settings.load();
    final key = settings.key;
    if (key == null) {
      started.completeError(const ClaudeError('Add your Anthropic API key in Settings › Claude.'));
      return;
    }
    if (settings.spend.reached) {
      started.completeError(claudeLimitError(settings.spend));
      return;
    }
    final kept = alone || _history.isEmpty ? null : _system;
    final String system;
    if (kept != null) {
      system = kept;
    } else {
      String? rules;
      try {
        rules = (await notes.read(title: claudeRulesTitle))?.body;
      } catch (_) {
        rules = null;
      }
      system = [claudeSystem(now: _now(), rules: rules, folders: folders != null, books: books != null), ?extraSystem].join('\n\n');
      if (!alone) _system = system;
    }
    final made = ClaudeRun(api: (kDebugMode ? debugClaudeApi?.call(key) : null) ?? _api(key), model: settings.model, effort: settings.effortChosen ? settings.effort : null, notes: notes, desk: desk ?? this.desk, folders: folders, books: books, prompt: prompt, system: system, spend: settings.spend, history: alone ? null : _history);
    _run?.removeListener(notifyListeners);
    _run = made..addListener(notifyListeners);
    if (!alone) conversation.add(made);
    notifyListeners();
    started.complete(made);
    await made.run();
    if (!alone) _history = made.messages;
    notifyListeners();
  }

  /// Answers once [run] is over: done, stopped or failed.
  static Future<ClaudeRun> over(ClaudeRun run) {
    bool ended() => !run.working && run.state != ClaudeState.idle;
    if (ended()) return Future.value(run);
    final done = Completer<ClaudeRun>();
    void heard() {
      if (!ended() || done.isCompleted) return;
      run.removeListener(heard);
      done.complete(run);
    }

    run.addListener(heard);
    return done.future;
  }

  /// Stops the run working now.
  void stop() => _run?.stop();

  /// A fresh conversation in the sheet.
  void newChat() {
    if (working) return;
    _history = const [];
    _system = null;
    conversation.clear();
    notifyListeners();
  }

  @override
  void dispose() {
    settings.removeListener(notifyListeners);
    _run?.removeListener(notifyListeners);
    super.dispose();
  }
}
