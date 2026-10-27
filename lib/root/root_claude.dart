part of 'ghost_root.dart';

/// The app's own Claude in the root (docs/CLAUDE_APP.md): the library and the screen as Claude's tools reach them,
/// the chat with Claude, Claude on the dock, the bar over a note Claude writes in, the "Ask Claude" inbox, and Claude
/// talked to: the dock's orange mic and the phone's assistant (lib/claude/claude_voice.dart).
extension _RootClaude on _GhostRootState {
  /// Starts the inbox once the library is read; the runner itself is made on first use.
  void _startClaude() {
    unawaited(claudeSettings.load());
    _claudeInbox.start();
  }

  /// The chat with Claude, or with [agent] (an organization's AI row's Chat), its field starting with [initial].
  /// Nothing while the Claude plugin is off.
  void _openAskClaude({String? agent, String? initial}) {
    if (!_claudeOn) return;
    _shell.currentState?.closeSidebar();
    _told(() {
      _askClaude = true;
      _chatAgent = agent;
      _chatInitial = initial;
    });
  }

  void _closeAskClaude() => _told(() => _askClaude = false);

  /// Whether Claude can be talked to here: its plugin on, and a recorder to hear with (lib/root/root_voice.dart).
  bool get _canTalk => _claudeShown && _voice != null;

  /// Talk to Claude on the home page's dock; none where Claude cannot be talked to.
  Widget? _claudeTalkDock() => _canTalk ? ClaudeTalkButton(onPressed: () => _startTalk()) : null;

  /// Talk to Claude for a page's dock, about what the page is about where it says (see [_claudeDockAbout]).
  DockClaudeBuilder? get _claudeTalkForDock => _canTalk ? _claudeTalkAbout : null;

  Widget _claudeTalkAbout(String Function()? subject) => ClaudeTalkButton(onPressed: () => _startTalk(about: subject?.call()));

  /// Opens the ear for an ask said aloud (lib/claude/claude_voice.dart), its sheet over the app: from the dock, or,
  /// [fromAssistant], the phone's assistant. Pressed again while it listens, it is done. Answers whether it opened:
  /// not while Claude is off or nothing can hear, nor while the recorder or a meeting holds the microphone.
  bool _startTalk({String? about, bool fromAssistant = false}) {
    final voice = _voice;
    if (!_canTalk || voice == null) return false;
    final talking = _talk;
    if (talking != null && talking.stage == ClaudeVoiceStage.listening) {
      unawaited(talking.done());
      return true;
    }
    if ((_shell.currentState?.screen.isRecording ?? false) || (voice.live?.meetingStateNow()?.recording ?? false)) return false;
    if (talking != null) _endTalk();
    FocusManager.instance.primaryFocus?.unfocus();
    final recorder = voice.recorder;
    late final ClaudeVoice talk;
    talk = ClaudeVoice(
      runner: _claude,
      follow: _follow,
      inbox: _toClaudeInbox,
      about: about,
      ear: recorderEar(
        openMicrophone: recorder.openMicrophone,
        startCapture: recorder.startCapture,
        native: recorder.native,
        simulate: recorder.simulate,
        setLive: recorder.setRecorderLive,
        haptic: recorder.host.haptic,
        warn: recorder.warn,
      ),
      onEnd: () {
        if (identical(_talk, talk)) _endTalk();
      },
    );
    _told(() {
      _askClaude = false;
      _talk = talk;
      _talkFromAssistant = fromAssistant;
    });
    talk.start();
    return true;
  }

  /// The talk's sheet put away. Claude goes on with what it was asked, in the chat. A talk the phone's assistant
  /// started takes back the launch's leave to show over the lock screen, as a recording's end does.
  void _endTalk() {
    final talk = _talk;
    if (talk == null) return;
    final assistant = _talkFromAssistant;
    _told(() {
      _talk = null;
      _talkFromAssistant = false;
    });
    // After the frame: its sheet is being taken down in it.
    WidgetsBinding.instance.addPostFrameCallback((_) => talk.dispose());
    if (assistant) unawaited(_voice?.service?.endCapture(leave: false).then<void>((_) {}, onError: (Object _) {}));
  }

  /// The phone's assistant asked (lib/root/capture_route.dart `CaptureRouteWorld.askAi`): Claude is talked to where
  /// it can answer here, with its plugin on and a key on this device, and the phone not locked (a note Claude opens
  /// is not for the lock screen). Else the assistant records, as it did.
  Future<bool> _assistantTalk() async {
    if (!_canTalk) return false;
    await claudeSettings.load();
    final voice = _voice;
    if (!mounted || voice == null || !_claude.ready) return false;
    await voice.readLocked();
    if (!mounted || voice.locked) return false;
    return _startTalk(fromAssistant: true);
  }

  Widget _talkPart(BuildContext context) {
    final talk = _talk;
    if (talk == null || !_claudeOn) return _RootParts._nothing;
    return ClaudeVoiceSheet(
      voice: talk,
      onChat: () {
        _endTalk();
        _openAskClaude();
      },
      onSettings: () {
        _endTalk();
        _openSettingsAt('plugin:claude');
      },
      onOpenNote: (id) {
        _endTalk();
        _openForClaude(id);
      },
    );
  }

  /// Claude on the home page's dock; none while the Claude plugin is off or no API key is entered.
  Widget? _claudeDock() => _claudeShown ? ClaudeDockButton(runner: _claude, follow: _follow, onPressed: _openAskClaude) : null;

  /// Claude for a page's dock (see [_claudeDockAbout]); none while the Claude plugin is off or no API key is entered,
  /// so the dock has a ring fewer.
  DockClaudeBuilder? get _claudeForDock => _claudeShown ? _claudeDockAbout : null;

  /// Claude at the head of a page's dock (docs/DOCK.md): the chat, about what the page is about where it says. The
  /// chat holds no subject, so a note's `[[Title]]` is put in its field, ready to ask about.
  Widget _claudeDockAbout(String Function()? subject) => ClaudeDockButton(
        runner: _claude,
        follow: _follow,
        onPressed: () {
          final about = subject?.call().trim() ?? '';
          _openAskClaude(initial: about.isEmpty ? null : '[[$about]] ');
        },
      );

  /// The bars under the top bar: Follow's, for an AI through the connector, and the app's own Claude's.
  Widget _claudeBanner() => Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_follow != null) FollowBar(follow: _follow!),
          if (_claudeShown) ClaudeBar(runner: _claude, onReply: _openAskClaude, onOpenNote: _openForClaude),
        ],
      );

  void _openForClaude(String noteId) {
    final shell = _shell.currentState;
    if (shell == null || _library.noteOf(noteId) == null) return;
    _told(() => _askClaude = false);
    if (shell.shown != noteId) shell.openNote(noteId);
  }

  Widget _askClaudePart(BuildContext context) {
    if (!_askClaude || !_claudeOn) return _RootParts._nothing;
    return ClaudeChat(
      runner: _claude,
      follow: _follow,
      agent: _chatAgent,
      initial: _chatInitial,
      onClose: _closeAskClaude,
      onOpenNote: _openForClaude,
      onSettings: () {
        _told(() => _askClaude = false);
        // The key is added on the Claude plugin's page (lib/plugins/claude).
        _openSettingsAt('plugin:claude');
      },
      onOpenAi: _openForAi,
      onInbox: _toClaudeInbox,
    );
  }

  /// A request written into the "Ask Claude" note, made first with the connector's own words where there is none
  /// (mcp/prompts.ts `INBOX_BODY`): for the connector's agents and the Mac's routine to work through.
  Future<void> _toClaudeInbox(String request) async {
    final line = '- [ ] ${request.replaceAll('\n', ' ').trim()}';
    final inbox = _claudeInboxBody();
    if (inbox == null) {
      await _library.createNote(newInboxBody(line));
      await _library.refresh();
      return;
    }
    await _RootClaudeDesk(this).change(inbox.id, (body) => addInboxRequest(body, line));
  }
}

/// The library as Claude's tools read and write it.
class _RootClaudeNotes implements ClaudeNotes {
  _RootClaudeNotes(this._root);

  final _GhostRootState _root;

  NoteLibrary get _library => _root._library;

  static DateTime _at(int ms) => DateTime.fromMillisecondsSinceEpoch(ms);

  static String _preview(String body) {
    final lines = body.split('\n').map((line) => line.trim()).where((line) => line.isNotEmpty && !line.startsWith('#') && line != '---').toList();
    final line = lines.isEmpty ? '' : lines.first;
    return line.length > 120 ? '${line.substring(0, 117)}…' : line;
  }

  /// A note as list_notes shows it: its folder the workspace it is filed in, by path and id, so Claude can sort
  /// notes into folders (GHST-108); none for a note in no folder.
  NoteBrief _brief(Note note) {
    final filed = _root._workspaces.workspaceOf(note.id);
    return NoteBrief(
      id: note.id,
      title: noteTitle(note.body),
      updated: _at(note.updatedAt),
      preview: _preview(note.body),
      folder: filed == null ? null : workspacePathName(_root._workspaces.value.list, filed.id),
      folderId: filed?.id,
      pinned: note.starred,
    );
  }

  List<Note> get _notes => [
        for (final note in _root._shown)
          if (note.archivedAt == null) note,
      ]..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));

  @override
  Future<List<NoteBrief>> list({String? query, int limit = 50}) async {
    final q = (query ?? '').trim().toLowerCase();
    return [
      for (final note in _notes)
        if (q.isEmpty || noteTitle(note.body).toLowerCase().contains(q)) _brief(note),
    ].take(limit).toList();
  }

  @override
  Future<List<NoteHit>> search(String query, {int limit = 20}) async {
    final found = searchNotes(_notes, query).take(limit);
    final words = searchWords(query);
    return [
      for (final note in found) NoteHit(id: note.id, title: noteTitle(note.body), snippet: _snippet(note.body, words)),
    ];
  }

  static String _snippet(String body, List<String> words) {
    final low = body.toLowerCase();
    var at = -1;
    for (final word in words) {
      at = low.indexOf(word);
      if (at >= 0) break;
    }
    if (at < 0) return _preview(body);
    final from = (at - 60).clamp(0, body.length), to = (at + 100).clamp(0, body.length);
    return '${from > 0 ? '…' : ''}${body.substring(from, to).replaceAll('\n', ' ')}${to < body.length ? '…' : ''}';
  }

  /// The note's words as they are now: its editor's where it is open (unsaved letters included), else the store's.
  String? _wordsOf(String id) {
    final screen = openNoteScreen(_root._shell.currentContext, id);
    return screen?.view?.state.doc.toString() ?? screen?.body;
  }

  @override
  Future<NoteRead?> read({String? id, String? title}) async {
    Note? note;
    if (id != null && id.isNotEmpty) note = _library.noteOf(id);
    if (note == null && title != null && title.trim().isNotEmpty) {
      final key = title.trim().toLowerCase();
      note = _notes.where((n) => noteTitle(n.body).trim().toLowerCase() == key).firstOrNull ?? _root._reads.titled(title.trim());
    }
    if (note == null) return null;
    final fresh = await _library.get(note.id) ?? note;
    final body = _wordsOf(note.id) ?? fresh.body;
    return NoteRead(id: note.id, title: noteTitle(body), body: body);
  }

  @override
  Future<String> create(String body) async {
    // The account's own, in no workspace: filed nowhere, it is in the Inbox.
    final made = await _library.createNote(body);
    await _library.refresh();
    return made.id;
  }

  @override
  Future<void> write(String id, String body) => _root._writeNote(id, (_) => body);
}

/// The screen as a run reaches it.
class _RootClaudeDesk implements ClaudeDesk {
  _RootClaudeDesk(this._root);

  final _GhostRootState _root;

  ed.EditorViewLike? _viewOf(String noteId) => openNoteScreen(_root._shell.currentContext, noteId)?.view;

  @override
  Future<ed.EditorViewLike?> open(String noteId) async {
    final shell = _root._shell.currentState;
    if (shell == null || !_root.mounted) return null;
    // A note just made is in the list after the library's next read.
    for (var i = 0; i < 20 && _root._library.noteOf(noteId) == null; i += 1) {
      await Future<void>.delayed(const Duration(milliseconds: 50));
    }
    if (_root._library.noteOf(noteId) == null) return null;
    // The sheet makes way for the note.
    if (_root._askClaude) _root._told(() => _root._askClaude = false);
    if (shell.shown != noteId) {
      // The shell opens only a note it has been handed, and a note just made reaches it with the root's next build:
      // asked before then, `openNote` found nothing and did nothing, and a note Claude made was never shown
      // (2026-10-18). Handed the notes as they are now, it has it.
      shell.takeNotes(_root._shown);
      shell.openNote(noteId);
    }
    // Its editor, once the screen has made it: a few frames.
    for (var i = 0; i < 60; i += 1) {
      final view = _viewOf(noteId);
      if (view != null) return view;
      await Future<void>.delayed(const Duration(milliseconds: 50));
    }
    return null;
  }

  @override
  bool showing(String noteId, ed.EditorViewLike view) => _root.mounted && identical(_viewOf(noteId), view);

  /// Through the open editor where the note is open, so the person's caret and words stay (`_changeNote`); a
  /// passage not found, or a write refused, reaches the tool and Claude is told.
  @override
  Future<void> change(String noteId, String Function(String body) change) => _root._changeNote(noteId, change);

  @override
  bool get smoke => preferences.value.wisp;
}

/// Claude as a request from the watch reaches it (lib/watch/watch_notes.dart, "To Claude"): the words the phone heard,
/// asked as the dock's Talk to Claude asks them, in the chat's conversation.
///
/// - With the app in front and nothing else holding the screen, the talk's own sheet is put up with the words in it,
///   and the run goes on as one said to the microphone does: Claude's thinking, then the note it writes opened and
///   followed, the sheet made way down to its strip.
/// - With the chat open, it is asked there, and the chat shows it.
/// - With the app behind another (or the phone locked, a talk or a recording under way) it is a quiet run: written
///   out of sight ([_QuietClaudeDesk]), nothing opened, the screen left as it was. The run needs no frames, only the
///   network, so it is done then rather than kept for the app's return; the bar over the notes and the chat show it.
class _RootWatchClaude implements WatchClaude {
  _RootWatchClaude(this._root);

  final _GhostRootState _root;

  @override
  Future<bool> ready() async {
    await claudeSettings.load();
    return _root.mounted && _root._claudeShown && claudeSettings.watch;
  }

  bool get _inFront => WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed;

  @override
  Future<WatchAsked> ask({required String words, required String prompt, required WatchTake take}) async {
    final root = _root;
    if (!root.mounted || !root._claudeShown) return const WatchAskFailed('Claude is off on this phone');
    final voice = root._voice;
    final busy = root._talk != null ||
        (root._shell.currentState?.screen.isRecording ?? false) ||
        (voice?.live?.meetingStateNow()?.recording ?? false) ||
        (voice?.locked ?? false);
    if (_inFront && !busy && !root._askClaude) {
      late final ClaudeVoice talk;
      talk = ClaudeVoice(
        runner: root._claude,
        // Nothing is listened to: the words were heard from the watch's recording.
        ear: (_) => throw StateError('a request from the watch is not listened to'),
        fromWatch: true,
        onEnd: () {
          if (identical(root._talk, talk)) root._endTalk();
        },
      );
      FocusManager.instance.primaryFocus?.unfocus();
      root._told(() {
        root._talk = talk;
        root._talkFromAssistant = false;
      });
      await talk.sendHeard(words, prompt: prompt);
      final run = talk.run;
      if (run == null) return WatchAskFailed(talk.problem ?? 'Claude could not be asked');
      return watchRunOutcome(run);
    }
    // In the chat, open in front, as the chat shows it; else out of sight.
    final chat = root._askClaude && _inFront;
    return RunnerWatchClaude(runner: root._claude, shown: () => root._claudeShown, desk: () => chat ? null : _QuietClaudeDesk(root)).ask(words: words, prompt: prompt, take: take);
  }
}

/// The screen as a run out of sight reaches it: nothing is opened, and a note is written where it is (its editor, if
/// it is open, else the library), as the screen's own desk writes one it cannot show.
class _QuietClaudeDesk implements ClaudeDesk {
  _QuietClaudeDesk(this._root);

  final _GhostRootState _root;

  @override
  Future<ed.EditorViewLike?> open(String noteId) async => null;

  @override
  bool showing(String noteId, ed.EditorViewLike view) => false;

  @override
  Future<void> change(String noteId, String Function(String body) change) => _RootClaudeDesk(_root).change(noteId, change);

  @override
  bool get smoke => false;
}

/// The notebooks, tickets and Trash as Claude's book tools reach them (lib/claude/claude_books.dart): made the way the
/// app makes them, a query board's + and the notebook's own (root_commands.dart `_addFromQuery`).
class _RootClaudeShelf implements ClaudeShelf {
  _RootClaudeShelf(this._root);

  final _GhostRootState _root;

  NoteLibrary get _library => _root._library;
  WorkspaceStore get _workspaces => _root._workspaces;

  List<Note> get _live => [
        for (final note in _root._shown)
          if (note.archivedAt == null) note,
      ];

  static String _under(String body, String? words) {
    final said = words?.trim() ?? '';
    if (said.isEmpty) return body;
    final lines = body.split('\n');
    final heading = lines.indexWhere((line) => line.startsWith('# '));
    if (heading < 0) return '${body.trimRight()}\n\n$said\n';
    return [...lines.sublist(0, heading + 1), '', said, ...lines.sublist(heading + 1)].join('\n').replaceAll(RegExp(r'\n{3,}'), '\n\n');
  }

  @override
  Future<String> notebook({required String title, String? key, String? about, String? workspaceId}) async {
    var body = bookNoteBody(title);
    if (key != null) body = withNotebookKey(body, key);
    body = _under(body, about);
    final made = await _library.createNote(body);
    if (workspaceId != null) _workspaces.fileNote(made.id, workspaceId);
    await _library.refresh();
    return made.id;
  }

  @override
  ({String id, String title, String? key})? findNotebook(String asked) {
    final key = asked.trim().toLowerCase();
    for (final note in _live) {
      if (!isBookBody(note.body) || isJournalBody(note.body)) continue;
      if (note.id == asked.trim() || noteTitle(note.body).trim().toLowerCase() == key) {
        return (id: note.id, title: noteTitle(note.body), key: notebookKey(note.body));
      }
    }
    return null;
  }

  @override
  Future<({String id, String? key})> ticket({required String notebookId, required String title, required List<(String, String)> fields, String? details}) async {
    final book = await _library.get(notebookId);
    if (book == null) throw const ClaudeBookProblem('That notebook is gone.');
    // A page is its notebook's by its title, so two of one name would be one page twice.
    if (_live.any((note) => sameTitle(noteTitle(note.body), title))) throw ClaudeBookProblem('There is already a note called “$title”. Give the ticket another title.');
    final key = nextTicketId(book.body, [for (final note in _library.value) note.body]);
    var body = newTicketBody(title, id: key, statuses: statusesOf(book.body));
    for (final (field, value) in fields) {
      body = withProperty(body, field, value);
    }
    body = _under(body, details);
    final made = await _library.createNote(body);
    final space = _workspaces.workspaceOf(book.id);
    if (space != null) _workspaces.fileNote(made.id, space.id);
    // Into the notebook's index through its screen where it is open, so the page there keeps it.
    await _root._changeNote(book.id, (index) => withChapter(index, title), userEvent: 'claude.type');
    await _library.refresh();
    return (id: made.id, key: key);
  }

  @override
  void fileNew(String id, String workspaceId) => _workspaces.fileNote(id, workspaceId);

  @override
  bool isTeams(String id) {
    final filed = _workspaces.workspaceOf(id);
    return filed != null && _workspaces.orgOf(filed.id) != null;
  }

  @override
  String? titleOf(String id) {
    final note = _library.noteOf(id);
    return note == null ? null : noteTitle(note.body);
  }

  @override
  Future<void> trash(String id) async {
    _root._delete(id);
    await _library.refresh();
  }
}
