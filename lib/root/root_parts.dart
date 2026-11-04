part of 'ghost_root.dart';

/// What the root puts on screen: everything in [_GhostRootState._whole], made once, and what each part of it is
/// built from. The shell and the screens it is handed (the home page, a note's desk, All notes, an organization's
/// pages, the recorder, the sidebars, the aside, the notifications), and over it the phone at work, Settings, the
/// palette, a note's menu, the + sheet and the new notebook's, a workspace's and an organization's sheets, the way
/// into an account, an invitation, the walkthrough and the launch screen.
///
/// Each is a part (lib/root/selected.dart): it says what it reads, as a record of values, and is built again
/// when that record is another and at no other time. So the pattern for every one of them is two things side by
/// side, what it selects and what it builds, and a part that reads something new must select it too.
///
/// One of the files `_GhostRootState` is written in (lib/root/ghost_root.dart says which). Nothing here is held:
/// what the parts read (the notes shown, the counts, which sheet is open) are the class's fields.
extension _RootParts on _GhostRootState {
  /// A part of what is on screen: built when [select] answers another value than it drew, and at no other time
  /// (lib/root/selected.dart).
  Widget _part<T>(String name, T Function() select, WidgetBuilder builder) =>
      Selected<T>(listenable: _tick, name: name, select: select, builder: (context, _) => builder(context));

  static const Widget _nothing = SizedBox.shrink();

  /// What [_whole] is made of, once (the field is the class's own).
  Widget _wholeOf() => AccountScope(
    services: _services,
    // A folder's menu at a right-click anywhere a folder is shown (lib/notes/folder_menu.dart): its sheet to rename
    // it, or at its Delete; and a note's menu for a list handed none of its own.
    child: FolderMenuScope(
    store: _workspaces,
    onRename: (folder) => _manageFolder(folder),
    onDelete: (folder) => _manageFolder(folder, deleting: true),
    // Delete folder and its notes… (2026-11-01): the sheet at its question, and the delete once it is answered.
    onDeleteAll: (folder) => _manageFolder(folder, all: true),
    deleteAll: _deleteFolderAndNotes,
    noteExists: _noteLive,
    onSetTemplate: (folder) => unawaited(_setFolderTemplate(folder)),
    onNoteMenu: _menu.open,
    // Show in Finder (Explorer, Files) for a folder's directory and a page's file, on a desktop.
    show: _showInFiles,
    // Keep an index… (docs/AI_INDEXES.md, root_indexes.dart).
    onKeepIndex: _keepIndex,
    // Clean up with AI… (lib/plugins/cleanup, 2026-11-02): Cleanup's page at the folder, while the plugin is on.
    onCleanup: _cleanUp,
    child: Stack(
      fit: StackFit.expand,
      children: [
        _part('shell', _shellReads, _shellPart),
        // The phone at work, over the app, while a review is on the note being read (lib/scene/at_work.dart).
        // It reads the note's words, and follows its AI, only while a review is on it: with none the scene is not
        // up, and a save of the note, or its AI finding its model as the note opens, is nothing to it.
        _part('atWork', () {
          final ai = _noteAi, id = _noteAiId;
          if (ai == null || id == null) return null;
          final reviewing = ai.reviewKey != null || ai.reviewStage.value != null;
          return (ai, id, reviewing ? _aiAt : 0, reviewing ? _library.noteOf(id) : null, _voice);
        }, _atWorkPart),
        // Settings is handed what its pages read whether it is open or shut (the models, the tapes' room, the
        // updates), so it is built again as those change; never for a runner's turn or the home page's news.
        _part('settings', () => (_settings, _settingsPage, _voice, _voiceAt, _modelsAt, _updatesAt, _voice == null ? null : _tapeFacts, _voice == null || _read, preferences.value.formatModel, _builtReport.value, _claudeOn, _toolsAt), _settingsPart),
        // The palette's commands and a note's menu are made from the notes while each is open; shut, neither
        // draws anything, and each is built with the notes as they are the moment it opens.
        _part('commands', () => ((_commands.currentState?.isOpen ?? false) ? _library.value : null, _workspaces.value, _prefsAt, _capture != null, _toolsAt), _commandsPart),
        _part('noteMenu', () => _menu.value == null ? null : (_shown, _claudeOn), _noteMenuPart),
        // What the + makes (notes/NewSheet.tsx). The rows read where to make it as they are pressed, since the
        // sheet closes first.
        _part(
          'newSheet',
          () => _newSheet ? (_newInto, _shown, _shell.currentState?.shown, _capture != null, _voiceAt, preferences.value.meetingSound, preferences.value.simple) : null,
          _newSheetPart,
        ),
        _part('newBook', () => _bookSheet == null ? null : (_bookSheet, _bookInto, _shown), _newBookPart),
        _part('workspace', () => _workspace, _workspacePart),
        // The Trash (lib/notes/trash_sheet.dart), with the notes in it as they are now, while it is open.
        _part('trash', () => _trashSheet == null ? null : (_trashSheet, _trashed, _trash.value, _made?.hidden, _workspaces.value, preferences.value.simple), _trashPart),
        // The chat with Claude (lib/claude/claude_chat.dart): it hears the runner for itself while it is up.
        _part('askClaude', () => (_askClaude && _claudeOn, _chatAgent, _chatInitial), _askClaudePart),
        // Ask (lib/ask/ask_sheet.dart): the notes it reads are read as a question is asked, so it is built again only
        // as it opens, shuts, or its scopes or the look change.
        _part('ask', () => _askSheet == null ? null : (_askSheet, _workspaces.value, preferences.value.simple), _askPart),
        // Claude talked to (lib/claude/claude_voice_sheet.dart): it hears the talk for itself while it is up.
        _part('claudeTalk', () => _claudeOn ? _talk : null, _talkPart),
        // A smart notebook's sheet: a search kept by name, or one changed (lib/root/organize.dart).
        OrganizeSheets(organize: _organize),
        if (_services case final services?) ...[
          _part('organization', () => (_organization, _accountAt, _syncAt, _organization == null ? 0 : _presenceAt, _toolsAt), (context) => _organizationSheetPart(services)),
          _part('newOrganization', () => (_newOrganization, _accountAt, _syncAt), (context) => _newOrganizationPart(services)),
          // The way in, the first thing on screen once, on an open that is signed out. Never over a recorder
          // (App.tsx: `accountGate.open && !isRecording(screen)`): it waits under one.
          _part('gate', () => (_gate, _gate?.open ?? false, _shell.currentState?.screen.isRecording ?? false, _accountAt, _syncAt), (context) {
            final gate = _gate;
            return gate != null && gate.open && !(_shell.currentState?.screen.isRecording ?? false) ? AccountGate(
                    services: services,
                    onDone: gate.close,
                    // "I have a backup" (root_git_backup.dart): the git plugin's page, where Open library from git is.
                    onHaveBackup: _gitWired.service == null
                        ? null
                        : () {
                            gate.close();
                            _openSettingsAt('plugin:git-backup');
                          },
                  )
                : _nothing;
          }),
        ],
        // An invite link that opened the app, and a code held on this device from before, asked about once
        // someone is signed in: nothing is joined until the person says so. Held back while the way into an
        // account is up at launch.
        _part(
          'join',
          () => (_joinRequest, _gate?.open, _accountAt, _syncAt),
          (context) => JoinInvites(
            services: _services,
            request: _joinRequest,
            hold: _services != null && (_gate?.open ?? true),
            onOpen: (id) => _shell.currentState?.openOrganization(id),
            onAccount: _toAccount,
          ),
        ),
        // The walkthrough, over everything but the way into an account, and never over a recorder: it is taken
        // away while a capture is on screen and comes back, at its page, when the capture ends. Nor before the
        // launch screen has gone (Matt, 2026-10-28: "The tour starts before the loading page is done wait until the
        // app is fully loaded to start the audio and tour"): it is made, and its voice starts, only once that is over.
        _part('guide', () {
          final guide = _guide;
          if (guide == null || !guide.open || _launchUp || (_gate?.open ?? false) || (_shell.currentState?.screen.isRecording ?? false)) return null;
          return (guide.page, guide.tooSoon, _capture != null, _modelsForGuide);
        }, _guidePart),
        // What's new after an update (lib/changelog/whats_new.dart; Matt, 2026-10-30: "Add a changelog popup modal that
        // shows after every update with iconography"): raised only once nothing else is in the way (the launch screen,
        // the walkthrough, a recording, a setup or any other sheet; _whatsNewClear), and up until it is put away.
        _part('whatsNew', () {
          final whatsNew = _whatsNew, waiting = whatsNew?.waiting, running = whatsNew?.running;
          if (whatsNew == null || !whatsNew.up || waiting == null || running == null) return null;
          return (waiting, running);
        }, _whatsNewPart),
        // Something another app shared: its sheet, over the app, one share at a time (lib/share/ui/share_in_sheet.dart).
        _part('shareIn', () => _sharing.isEmpty || _launching ? null : _sharing.first, _shareInPart),
        _part('launch', () => _launching ? (_launchLoading, _launchNotes, _updatesAt, _launchSync, _voice) : null, _launchPart),
      ],
    ),
    ),
  );

  /// What the shell is handed: built again when one of these is another, and for nothing else. The screens it
  /// holds are parts of their own.
  Object _shellReads() {
    final prefs = preferences.value;
    return (
      _shellDraws,
      _drafts,
      prefs.topBar,
      // Simple or advanced (GHST-103): the bar's icons and the tabs' groups.
      prefs.simple,
      _workspaces.value,
      // Who is signed in and the organizations joined.
      _accountAt,
      prefs.openNotes,
      prefs.tabGroups,
      // Whether there is a recorder, and a meeting's service, to put on screen.
      _voice != null && _capture != null,
      _voice?.live != null,
      readSidebarShown(_stored),
      readAsideShown(_stored),
      _unread,
      // The app's Claude's bar under the top bar and the docks' Claude (the Claude plugin's switch, and a key).
      _claudeShown,
      // The project tools switched: My tickets and Triage (lib/plugins/projects/suite.dart).
      _toolsAt,
    );
  }

  /// Whether something unread and wanted waits (`unreadNotifications`), or a change to a page this account follows
  /// (lib/team/updates.dart). Counted again when the account said something, a followed page changed or Settings ›
  /// Notifications' switches are others, and at no other time.
  bool get _unread {
    final prefs = preferences.value.notifications;
    final at = (_accountAt, _docsAt);
    if (_unreadAt != at || !identical(prefs, _unreadFor)) {
      _unreadAt = at;
      _unreadFor = prefs;
      final signedIn = _services?.signedIn ?? false;
      _unreadNow = unreadNotifications(_services, prefs) > 0 || (signedIn && _docUpdates.unread > 0);
    }
    return _unreadNow;
  }

  Widget _shellPart(BuildContext context) {
    final prefs = preferences.value;
    final simple = prefs.simple;
    final services = _services;
    final signedIn = services?.signedIn ?? false;
    final voice = _voice;
    final capture = _capture;
    // What the shell draws from here on, for the next change to be measured against (`_shellDraws`).
    final shown = _shellNotes = _shown;
    // Who is on each team page, for the header's avatars and the sidebar's dots, which read it for themselves.
    return PagePresenceScope(
      presence: _onPages,
      // A member's page from the list of who is on a page (docs/TEAMSPACES.md, "Members").
      child: MemberLinkScope(
      open: services == null ? null : (orgId, handle) => _shell.currentState?.openOrganizationMember(orgId, handle),
      child: AppShell(
      key: _shell,
      sheet: widget.sheet ?? context.tokens.sheet,
      notes: shown,
      // A note with no words yet is its own screen's alone, as on the page, whose list never holds it.
      drafts: _drafts,
      topBar: TopBarStyle.parse(prefs.topBar),
      // Simple mode (GHST-103, then GHST-105): the shell draws the places plain, with no bar, no sidebar and no
      // aside, and on a wide window the list beside the note with this pane while none is open.
      simple: prefs.simple,
      emptyPaneBuilder: (context, shell) => const SimpleEmptyPane(ghost: Ghost(scene: GhostScene.noNotes, size: GhostSize.small)),
      workspaces: _workspaces.value,
      // A folder of All notes an arrow lands on.
      onChooseWorkspace: _workspaces.chooseWorkspace,
      organizations: signedIn ? services!.joined : const [],
      organizationBuilder: services == null ? null : _organizationPage,
      onRenameNote: _rename,
      openNotes: prefs.openNotes,
      tabGroups: prefs.tabGroups,
      // The screen and the tabs are what an entry is left by.
      onOpenNotesChanged: (open) {
        preferences.update((now) => now.copyWith(openNotes: open));
        _left();
      },
      // And the walkthrough steps aside for a recorder, so the parts that read the screen are told.
      onScreenChanged: (screen) {
        _left();
        // The note on the screen is not gisted while it is open: its words are still moving (lib/format/gist.dart).
        holdGistsFor(screen is ScreenNote ? <String>[screen.note.id] : const <String>[]);
        final open = screen is ScreenNote ? screen.note.id : null;
        if (_bannerOpen != null && _bannerOpen != open) {
          unawaited(_banners.noteLeft(_bannerOpen!));
          unawaited(_sketches.noteLeft(_bannerOpen!));
        }
        _bannerOpen = open;
        _extras?.screen(screen);
        _tick.tell();
      },
      untouchedEntryOf: (id) => _untouched.recordOf(id)?.journalId,
      onTabGroupsChanged: (groups) => preferences.update((now) => now.copyWith(tabGroups: groups)),
      onSettings: _openSettings,
      // The people icon with no organization joined, and the picker's last row: Settings › Organizations.
      onOrganizations: () => _openSettingsAt('organizations'),
      onNew: _plus,
      // The command palette, which the header toolbar's title pill opens (lib/shell/header_toolbar.dart).
      onSearch: _search,
      // Whether the bell rings: something unread the person asked to see (`unreadCount`).
      unread: _unread,
      onDeleteNote: _delete,
      onRefresh: _library.refresh,
      // Claude in the bar while an AI is online, and the bar that says it is followed (docs/CLAUDE_LIVE.md): each
      // hears Follow for itself.
      // Claude is on the home page's dock now (lib/claude/claude_dock.dart), not in the bar. Under the bar: Follow's
      // bar for an AI through the connector, and the app's own Claude's while it works (docs/CLAUDE_APP.md).
      banner: _claudeBanner(),
      // Who else is on the team page on screen, in the bar (docs/TEAMSPACES.md, "Presence"): only while anyone is.
      barChip: switch (_onPages) {
        final PagePresence pages => (
            changes: pages,
            build: (context) {
              final id = _shell.currentState?.shown;
              return id == null || pages.presenceOn(id).isEmpty ? null : PresenceAvatars(key: ValueKey('presence:$id'), noteId: id);
            },
          ),
        _ => null,
      },
      noteBuilder: _note,
      // The recorder, the whole window: a fresh mount for each capture, keyed by the shell.
      captureBuilder: voice == null || capture == null
          ? null
          : (context, shell, screen) => _part(
                'capture',
                () => (screen, _voiceAt),
                (context) => CaptureScreen(
                  recorder: voice.recorder,
                  fromAssistant: screen.fromAssistant,
                  stopRequests: screen.stop,
                  noteId: screen.noteId,
                  placing: screen.placing is Placing ? screen.placing as Placing : null,
                  meeting: screen.meeting,
                  onMeeting: voice.canMeet && moreToolOn(meetingsTool) ? () => unawaited(capture.meeting(false)) : null,
                  onFinish: (note, locked, {review, ask, landing}) => unawaited(capture.finished(note, locked, review: review, ask: ask, landing: landing)),
                ),
              ),
      // Ghost.md Academy, the whole window: out by its arrow, and its contents' way to the cheat sheet.
      academyBuilder: (context, shell) => _part(
        'academy',
        () => shell,
        (context) => AcademyScreen(
          onDone: shell.backToList,
          onCheatSheet: () {
            shell.backToList();
            _openSettingsAt('cheatsheet');
          },
        ),
      ),
      meetingBuilder: voice == null || capture == null || voice.live == null
          ? null
          : (context, shell, screen) => _part(
                'meeting',
                () => (screen, _voiceAt),
                (context) => MeetingScreen(
                  noteId: screen.noteId,
                  fromAssistant: screen.fromAssistant,
                  onLeave: capture.leftMeeting,
                  live: voice.live!,
                  host: _meetingHost(voice, voice.live!),
                ),
              ),
      homeBuilder: _home,
      allNotesBuilder: (context, shell, screen) => _part(
        'allNotes',
        () => (shell.notes, !_read, screen.tapes, screen.icons, _workspaces.value, preferences.value.wispEdge, _claudeShown, _canTalk, preferences.value.simple, _trashed.length),
        (context) => AllNotesScreen(
          // The empty page's hint, as home's: the side key on any Android phone (AllNotesScreen.tsx `isAndroid`).
          sideKey: !kIsWeb && defaultTargetPlatform == TargetPlatform.android,
          notes: shell.notes,
          loading: !_read,
          workspaces: _workspaces,
          stored: _stored,
          tapes: screen.tapes,
          icons: screen.icons,
          clock: widget.clock,
          onOpen: (id) => _openWhereLeft(shell, id),
          onBack: shell.backToList,
          // Up a folder, a step back on the trail where it came down from there, and Forward down again.
          onUp: shell.folderUp,
          onForward: preferences.value.simple ? null : shell.goOn,
          onRefresh: _pullRefresh,
          onNoteMenu: (note, at) => _menu.open(note.id, at),
          notesInWorkspace: _notesIn,
          onTrashNotes: _trashNotes,
          // An organization's pill opens its page; its sheet's row, its settings.
          onOrganization: _services == null ? null : shell.openOrganization,
          onOrganizationSettings: _services == null ? null : _openOrganizationSettings,
          wisp: preferences.value.wispEdge,
          // Simple mode: no workspace pills, no Save as a smart notebook, and the dock without Claude.
          onSaveSearch: preferences.value.simple ? null : _organize.saveSearch,
          simple: preferences.value.simple,
          dock: _notesDock(),
          onNewFolder: _newFolder,
          // New note on the strip and in the icon view: filed in the level shown, or in none at the top.
          onNewNote: _new,
          // The Trash's word, beside Archived, while it holds any.
          trashCount: _trashed.length,
          onTrash: _openTrash,
        ),
      ),
      // The Tags page, a tag's notes and a smart notebook's (lib/notes/collection_screen.dart).
      collectionBuilder: (context, shell, screen) => _part(
        'collection',
        () => (screen, shell.notes, _workspaces.value, _claudeShown, _canTalk, preferences.value.simple),
        (context) => CollectionScreen(
          kind: screen.kind,
          name: screen.key,
          notes: shell.notes,
          workspaces: _workspaces.value,
          smart: _organize.smart,
          onOpen: (id) => _openWhereLeft(shell, id),
          onBack: screen.kind == CollectionKind.tag && screen.fromTags ? _organize.showTags : shell.backToList,
          onTag: (tag) => _organize.showTag(tag, fromTags: screen.kind == CollectionKind.tags),
          onRenameTag: _organize.renameTag,
          onEditSmart: _organize.editSmart,
          onNoteMenu: _menu.open,
          stored: _stored,
          clock: widget.clock,
          dock: _notesDock(),
        ),
      ),
      // My tickets and Triage (lib/tickets/ui/tickets_screen.dart; root_tickets.dart).
      ticketsBuilder: _ticketsPart,
      // The Market: plugins, themes and fonts (lib/market/market_screen.dart). A plugin's Settings opens Settings over
      // it at the plugin's own page, and Local only's word Account at Privacy.
      marketBuilder: (context, shell, screen) => _part(
        'market',
        () => (screen, _claudeShown, _canTalk),
        (context) => MarketScreen(
          plugin: screen.plugin,
          link: screen.link,
          onBack: shell.backToList,
          onPluginSettings: (id) => _openSettingsAt(pluginPageId(id)),
          onLocalOnly: () => _openSettingsAt('account', setting: 'Privacy'),
          dock: _notesDock(market: false),
        ),
      ),
      sidebarBuilder: (context, shell, close) => _part(
        'sidebar',
        () => _sidebarReads(shell),
        (context) => NotesDrawer(
          open: true,
          notes: shell.notes,
          activeId: shell.shown,
          workspaces: _workspaces,
          stored: _stored,
          onOpen: (id) {
            close();
            _openWhereLeft(shell, id);
          },
          onNew: () {
            close();
            _plus();
          },
          onClose: close,
          onCommands: _search,
          onBrowseFiles: simple ? null : _browseFiles,
          onGraph: simple
              ? null
              : () {
                  close();
                  _showGraph();
                },
          // `notices={split ? notices : undefined}`: a phone has its home page for them.
          notices: splitFits(MediaQuery.sizeOf(context), mouse: mousePointer) ? _sidebarNotices() : const [],
          onSpeak: _capture == null
              ? null
              : () {
                  close();
                  _speak();
                },
          onSettings: () {
            close();
            _openSettings();
          },
          trashed: _trashed,
          onRestore: _actions.restore,
          onDestroy: _actions.destroy,
          onEmptyTrash: () => _actions.emptyTrash(_trashed),
          onOpenTrash: (id) {
            close();
            _openTrash(id);
          },
          notesInWorkspace: _notesIn,
          onTrashNotes: _trashNotes,
          onOrganization: _services == null ? null : _openOrganizationSettings,
          onNoteMenu: _menu.open,
          emptyArt: const Ghost(scene: GhostScene.noNotes),
          // Simple mode's sidebar (GHST-103): no smart notebooks, no Tags row, and the tree's own tools trimmed.
          smart: simple ? null : _organize.smart,
          onSmart: simple
              ? null
              : (id) {
                  close();
                  _organize.showSmart(id);
                },
          onManageSmart: simple ? null : _organize.editSmart,
          onTags: simple
              ? null
              : () {
                  close();
                  _organize.showTags();
                },
          // My tickets, in simple mode too, once the library has any ticket (lib/tickets/ui/tickets_screen.dart).
          onTickets: _reads.entries.isEmpty
              ? null
              : () {
                  close();
                  shell.showTickets();
                },
          ticketCount: _reads.entries.isEmpty ? null : _myTicketCount(),
          // The Market's row under Tags: advanced mode's, as Settings › Plugins was.
          onMarket: simple
              ? null
              : () {
                  close();
                  _showMarket();
                },
          simple: simple,
          spaces: _sidebarSpaces(shell, close),
        ),
      ),
      // Advanced mode's sidebar on a wide window: simple mode's list (Matt, 2026-10-24: "make the sidebar on advanced
      // mode the same as simple but just hide it by default"), where it was the tree.
      dockedSidebarBuilder: (context, shell) => _part('list', () => _listReads(shell), (context) => _listColumn(shell)),
      // The sidebar and the aside, shown or hidden as this device left them (core/useWideScreen.ts
      // `readSidebarShown`, aside/aside.ts `readAsideShown`): the sidebar hidden until it is first shown.
      sidebarShown: readSidebarShown(_stored),
      onSidebarShownChanged: (shown) => writeSidebarShown(shown, _stored),
      asideShown: readAsideShown(_stored),
      onAsideShownChanged: (shown) => writeAsideShown(shown, _stored),
      // The open note's book or run of chapters, beside it (aside/aside_panel.dart). The version history's
      // tab is a desktop's (`asideHistory`), and waits for one.
      // The open note's book or run of chapters, and on a desktop its version history: with neither there is no
      // aside and no toggle for it (`asideHolds`).
      asideBuilder: (context, shell) {
        final content = _asideOf(shell);
        final history = _asideHistory(context, shell);
        // And, with room for two panes, the open note's links and outline (lib/links/note_links.dart).
        final links = _asideLinks(context, shell), outline = _asideOutline(context, shell);
        return content == null && history == null && links == null
            ? null
            : AsidePanel(content: content, history: history, links: links, outline: outline, stored: _stored, onOpen: shell.openNoteWithin, onOpenTitle: _openTitleWithin);
      },
      asideCardBuilder: (context, shell, close) => AsideCard(
        content: _asideOf(shell),
        history: _asideHistory(context, shell),
        links: _asideLinks(context, shell),
        outline: _asideOutline(context, shell),
        stored: _stored,
        onOpen: shell.openNoteWithin,
        onOpenTitle: _openTitleWithin,
        onClose: close,
      ),
      notificationsBuilder: (context, shell, close) => _part('notifications', () => (preferences.value.notifications, _accountAt, _syncAt, _docsAt), (context) {
        void openNote(String id, String? at) {
          close();
          // The morning's ticket digest's row: its page (root_tickets.dart).
          if (id == digestNoteId) return _openDigest();
          // A note Claude edited opens at its first changed line; any other where it was left.
          if (at == null) return _openWhereLeft(shell, id);
          shell.openNote(id, at: at);
        }

        void account() {
          close();
          _toAccount();
        }

        // The empty card's ghost, with everything ticked (`Ghost scene="all-ticked" size="small"`).
        const allRead = Ghost(scene: GhostScene.allTicked, size: GhostSize.small);

        if (services != null) {
          return FedNotificationsDrawer(
            services: services,
            onClose: close,
            onOpenNote: openNote,
            // A change to a ticket this account watches: Unwatch on its row (lib/book/ticket_events.dart).
            onUnwatch: (noteId) => unawaited(_setWatching(noteId, false)),
            // The changes to the pages this account follows, under Docs (lib/team/updates.dart).
            docs: services.signedIn ? _docUpdates : null,
            onOpenOrganization: (id) {
              close();
              shell.openOrganization(id);
            },
            onAccount: account,
            emptyArt: allRead,
          );
        }
        return NotificationsDrawer(notifications: const [], prefs: preferences.value.notifications, signedIn: false, onClose: close, onOpenNote: openNote, onOpenOrganization: (_) => close(), onAccount: account, emptyArt: allRead);
      }),
      ),
      ),
    );
  }

  /// What the narrow window's sidebar reads: the notes and the one on screen, the workspaces, the trash, whether there
  /// is a folder to browse and a recorder to speak to, and the update it carries.
  Object _sidebarReads(AppShellState shell) =>
      (shell.notes, shell.shown, _workspaces.value, _trashed, _canBrowse, _capture != null, _updatesAt, _bannerShown, preferences.value.simple, favoritesIn(preferences.value).join(' '));

  /// The sidebar as spaces and pages (docs/TEAMSPACES.md; Matt, 2026-10-31: "Space switcher + sections";
  /// lib/notes/note_tree_spaces.dart): a drag and a new page written through the page tree's mover, the account's
  /// favorites, each space's home (Personal's home page, an organization's own page), Triage once there are tickets,
  /// the Updates (the bell's card), a page renamed from its row, and a refused drag said in the app's toast.
  SidebarSpaces _sidebarSpaces(AppShellState shell, VoidCallback close) => SidebarSpaces(
        mover: PageMover(library: _library, workspaces: _workspaces, orgFolders: {for (final entry in (_libraryConfig?.fileConfig ?? LibraryConfig.empty).orgs.entries) entry.key: entry.value.org}),
        favorites: favoritesIn(preferences.value),
        onFavorite: _setFavorite,
        onHome: (space) {
          close();
          if (space.orgId == null || _services == null) {
            shell.backToList();
          } else {
            shell.openOrganization(space.orgId!);
          }
        },
        onTriage: _reads.entries.isEmpty
            ? null
            : () {
                close();
                shell.showTickets(triage: true);
              },
        onUpdates: shell.showNotifications,
        onRename: (id, title) => unawaited(_writeNote(id, (body) => withPageTitle(body, title))),
        onSay: (words) {
          final at = _shell.currentContext;
          if (at != null) _say(at, words);
        },
      );

  /// A page in the sidebar's Favorites, or out of them (lib/core/favorites.dart): the account's, on every device.
  void _setFavorite(String noteId, bool on) => preferences.update((now) => withFavorite(now, noteId, on));

  /// The note's menu's Add to or Remove from Favorites, beside a ticket's Watch.
  List<Widget> _favoriteMenuRows(BuildContext context, Note note) {
    final on = favoritesIn(preferences.value).contains(note.id);
    return [
      GlacierMenuItem(icon: AppIcon(on ? Lucide.bookmarkCheck : Lucide.bookmark, size: context.tokens.fontSize('sm')), onSelect: () => _setFavorite(note.id, !on), child: Text(on ? 'Remove from Favorites' : 'Add to Favorites')),
    ];
  }

  /// What the wide window's sidebar reads ([_listColumn]): the notes, whether they are read yet, the microphone
  /// and whose it is, which list it is on, the update it carries, and whether there is a folder to browse.
  Object _listReads(AppShellState shell) => (shell.notes, !_read, _capture != null, _canTalk, _simpleTab, _updatesAt, _bannerShown, _canBrowse, preferences.value.simple, _toolsAt);

  /// Advanced mode's sidebar on a wide window (Matt, 2026-10-24: "make the sidebar on advanced mode the same as simple
  /// but just hide it by default"): simple mode's list itself ([_simpleHome] as a column), under the bar. What
  /// differs from simple's column is what the bar already has, or what only the old tree had:
  /// - no gear: the bar's cog is over it;
  /// - its notices are the tree's, an update waiting, not home's whole list (the experience card, the Academy's,
  ///   the invitations and the voice model are home's, which is beside it or a press of the bar's house away);
  /// - Browse files at its foot, on a phone that can show the folder: the tree's tool, which nothing else offers.
  /// Everything else the tree held lives elsewhere in advanced mode: the folders and workspaces on home and in All
  /// notes, the organizations behind the bar's people icon and on home, the archive in All notes, the trash in All
  /// notes and the palette, Tags, smart notebooks and the graph in the palette.
  Widget _listColumn(AppShellState shell) => SimpleHome(
        notes: shell.notes,
        loading: !_read,
        onOpen: (id) => _openFromHome(shell, id),
        onNew: _new,
        onNewLong: _plus,
        onSpeak: _simpleSpeak,
        onSwipe: _simpleSwipe,
        onNoteMenu: _menu.open,
        onRefresh: _pullRefresh,
        notices: _sidebarNotices(),
        clock: widget.clock,
        tab: _simpleTab,
        onTab: (tab) => _told(() => _simpleTab = tab),
        todos: _simpleTodos(shell),
        pane: true,
        underBar: true,
        onBrowseFiles: _browseFiles,
        ghost: const Ghost(scene: GhostScene.noNotes, size: GhostSize.lead, heightShare: 0.38),
      );

  /// The microphone of simple's list: Talk to Claude where Claude can hear and the recorder otherwise, one
  /// microphone only (GHST-104).
  VoidCallback? get _simpleSpeak => _canTalk
      ? () => _startTalk()
      : _capture == null
          ? null
          : _speak;

  /// `tabs.drop(note.id)` before a delete, as the advanced page's swipe does: the note's one tab goes too.
  void _simpleSwipe(Note note, NoteSwipe action) {
    if (action.name != 'pin') _shell.currentState?.dropTab(note.id);
    _actions.swipe(note, action);
  }

  /// The To-dos tab: every open to-do across the notes (lib/simple/simple_todos.dart). A tick is written as the
  /// query lists write theirs (tickedBody); a tap opens the note at the line.
  Widget _simpleTodos(AppShellState shell) => SimpleTodos(
        notes: _library,
        trash: _trash,
        clock: () => widget.clock == null ? DateTime.now() : DateTime.fromMillisecondsSinceEpoch(widget.clock!()),
        onTick: (id, line, done) => unawaited(_writeNote(id, (body) => tickedBody(body, line, body.split('\n')[line], done))),
        onOpen: (id, line) => shell.openNote(id, at: 'line:${line + 1}'),
        onAdd: _new,
      );

  /// The home page, while it is the screen (the shell takes it down under a note, the grid and an organization's
  /// page, and makes it anew on the way back, as the page's is: lib/shell/app_shell.dart). It is built again for
  /// the notes it shows, its layout, the workspace looked at, a recording, its notices, and the organizations with
  /// who is in them. The lines under its cards are its own to ask for and each card's to hear.
  Widget _home(BuildContext context, AppShellState shell) {
    // Simple mode's page as a column beside the note, or the whole window (GHST-105): asked of the window here,
    // where the shell's build has the size, so a window resized builds the page again for its new shape.
    final listPane = shell.listPane(context);
    return _part(
        'home',
        () => (
          shell.notes,
          !_read,
          preferences.value.homeLayout,
          _workspaces.value.current?.id,
          _capture != null,
          _recordingNow,
          _updatesAt,
          // The header images being made in the background, or stopped for a reason (lib/plugins/lovart/banner_run.dart).
          _bannerShown,
          _voiceModelLine,
          _accountAt,
          _presenceAt,
          // Claude on the dock, or not (the Claude plugin's switch, and an API key entered).
          _claudeShown,
          // The project tools switched (lib/plugins/projects/suite.dart).
          _toolsAt,
          // Simple or advanced (GHST-103).
          preferences.value.simple,
          // Which notes are meetings, for the shelf of their tapes (GHST-112).
          preferences.value.meetings,
          // Simple mode's Academy card (GHST-103): whether it is due now.
          _academyCardDue,
          // Simple mode's page (GHST-105): which list it is on, whether it is a column, and whose microphone.
          _simpleTab,
          listPane,
          _canTalk,
        ),
        (context) => preferences.value.simple ? _simpleHome(context, shell, pane: listPane) : _homePage(context, shell),
      );
  }

  /// The home page in simple mode (GHST-105; Matt, 2026-10-18: "The simple mode in the app is not quite right, it
  /// still is a bit complex with the tabs and such"): lib/simple/simple_home.dart in place of the advanced page. The
  /// + makes a note straight away, and held opens the + sheet; the microphone is Talk to Claude where Claude can
  /// hear and the recorder otherwise, one microphone only (GHST-104); the To-dos tab is kept to this device.
  Widget _simpleHome(BuildContext context, AppShellState shell, {required bool pane}) => SimpleHome(
        notes: shell.notes,
        loading: !_read,
        onOpen: (id) => _openFromHome(shell, id),
        onNew: _new,
        onNewLong: _plus,
        onSpeak: _simpleSpeak,
        onSettings: _openSettings,
        onSwipe: _simpleSwipe,
        onNoteMenu: _menu.open,
        onRefresh: _pullRefresh,
        notices: _notices(),
        clock: widget.clock,
        tab: _simpleTab,
        onTab: (tab) => _told(() => _simpleTab = tab),
        todos: _simpleTodos(shell),
        pane: pane,
        ghost: const Ghost(scene: GhostScene.noNotes, size: GhostSize.lead, heightShare: 0.38),
      );

  Widget _homePage(BuildContext context, AppShellState shell) {
    final services = _services;
    final signedIn = services?.signedIn ?? false;
    // Simple mode (GHST-103; Matt, 2026-10-17: "fancy features hidden behind more"): the dock is Search, Write,
    // Speak and Settings with no Claude; no organization cards, no New organization, no events of the day, no Save
    // as a smart notebook; the filters and the search are the page's own to trim (HomeScreen.simple).
    // Since GHST-105 the root builds lib/simple/simple_home.dart in simple mode instead ([_simpleHome]); the page
    // keeps its own trim for whoever still asks for it with `simple`.
    final simple = preferences.value.simple;
    // The organization the home page is filtered to, for its news.
    final chosen = _workspaces.value.current?.id;
    String? chosenOrg;
    for (final org in services?.joined ?? const <OrgRow>[]) {
      if (orgWorkspaceId(org.id) == chosen) chosenOrg = org.id;
    }
    return HomeScreen(
      notes: shell.notes,
      loading: !_read,
      workspaces: _workspaces,
      layout: homeLayoutOf(preferences.value.homeLayout),
      onOpen: (id) => _openFromHome(shell, id),
      onNew: _plus,
      // The dock's microphone, and the note of the meeting being recorded now.
      onCapture: _capture == null ? null : _speak,
      recording: _recordingNow,
      // `isAndroid ? 'Write it, or hold the side key and say it.'`: the page says the side key on any Android
      // phone, whether or not this build answers it, and the empty page's words are held to the page's.
      sideKey: !kIsWeb && defaultTargetPlatform == TargetPlatform.android,
      notices: _notices(),
      clock: widget.clock,
      onAllNotes: shell.showAllNotes,
      onSearch: _search,
      // Claude at the head of the dock: Ask Claude, and Claude at work or online (docs/CLAUDE_APP.md); Settings at
      // its foot (docs/DOCK.md).
      claude: simple ? null : _claudeDock(),
      // Talk to Claude under it, where Claude is on and the build can hear.
      claudeTalk: simple ? null : _claudeTalkDock(),
      onSettings: _openSettings,
      // The Market on the dock, over Settings; an advanced surface, so not in simple mode.
      onMarket: simple ? null : () => _showMarket(),
      // `tabs.drop(note.id)` before an archive or a delete (App.tsx `onSwipe`): the swiped note's tab goes too.
      onSwipe: (note, action) {
        if (action.name != 'pin') _shell.currentState?.dropTab(note.id);
        _actions.swipe(note, action);
      },
      onRefresh: _pullRefresh,
      onNoteMenu: _menu.open,
      onManageWorkspace: (workspace) => _told(() => _workspace = (editing: workspace, parent: null, deleting: false, all: false)),
      // New folder on the folders' strip (GHST-107): the sheet for a folder inside the chosen workspace.
      onNewFolder: _newFolder,
      // New note on the strip and in the icon view: a note filed in the folder shown.
      onNewNote: _new,
      // Where cards or icons is kept for each level, All notes' and the dashboard's too.
      stored: _stored,
      organizations: simple ? const [] : homeOrganizations(services, here: {for (final row in services?.joined ?? const <OrgRow>[]) row.id: _seenIn(row.id)}),
      orgNews: simple ? const [] : homeOrgNews(services, chosenOrg),
      onOrganization: services == null ? null : shell.openOrganization,
      // Edit on an organization's workspace, from the filters: its settings, opened from nowhere they go back to
      // (`openOrganizationSettings` with no `from`).
      onOrganizationSettings: services == null ? null : _openOrganizationSettings,
      onNewOrganization: signedIn && !simple ? () => _told(() => _newOrganization = true) : null,
      headerEdge: _headerEdge,
      dockHalo: _dockHalo,
      ghost: _homeGhost,
      onSaveSearch: simple ? null : _organize.saveSearch,
      // Today's events at the head of the page (docs/CALENDAR.md).
      // None while the Calendar plugin is off (lib/plugins/calendar): the service holds none then.
      simple: simple,
      // The meetings' tapes under the notices (GHST-112), and See all: All notes with its Tapes word on.
      // Read both ways for a release (lib/meet/meeting_mark.dart): the preferences, and the notes that say so.
      // The shelf of meetings, where Meetings is on (docs/PM_PLUGINS.md §10).
      meetings: moreToolOn(meetingsTool) ? meetingsOf(preferences.value, _library.value) : const {},
      onAllTapes: () => shell.showAllNotes(tapes: true),
      // A cassette: the note at its tape, playing, its transcript on the page (Matt, 2026-10-24).
      onOpenTape: (id) => _openTape(shell, id),
      // A cassette under a resting mouse plays on the memos' player, so a note open beside it keeps its tape's place.
      tapePlayer: widget.clipPlayer,
      // And on the Mac, the cassettes in view are loaded ahead on players of their own, so the rest ends in Play.
      tapePreviews: widget.tapePreviews,
    );
  }

  /// The art in the seams the home page leaves for it. Each answers from what it is handed and nothing else, and is
  /// the same function every time the page is built: the page does no work for a seam that is the one it had.
  static Widget _headerEdge(BuildContext context, HomeEdge edge, Widget scroller) => BlurEdge(under: edge.under, foot: true, child: scroller);

  static Widget _dockHalo(BuildContext context, HomeDock it) => DockBlur(behind: it.behind, dock: it.dock, alignment: it.alignment, padding: it.padding, scale: it.scale);

  /// Every other page's halo: none while its dock has stepped aside for the keyboard.
  static Widget _pageDockHalo(BuildContext context, DockPlace it) => DockBlur(behind: it.behind, dock: it.dock, alignment: it.alignment, padding: it.padding, shown: it.shown, scale: it.scale);

  /// The dock a page of notes carries, as the home page's (docs/DOCK.md): Claude, Search, a new note, Speak where the
  /// build records, and Settings at its foot. In simple mode (GHST-103) the same less Claude, as home's. One
  /// microphone only (GHST-104): where Talk to Claude is on the dock, Speak is not, as on home.
  ///
  /// The Market over Settings (Matt, 2026-10-26: "The market icon isn't showing up in the dock with settings new note
  /// search and the mic icon"), not in simple mode, and not on the Market's own page ([market] false).
  PageDockSeam _notesDock({bool market = true}) {
    final talk = preferences.value.simple ? null : _claudeTalkForDock;
    return PageDockSeam(
      claude: preferences.value.simple ? null : _claudeForDock,
      talk: talk,
      halo: _pageDockHalo,
      actions: [
        DockAction(id: 'search', label: 'Search and commands', glyph: HomeGlyph.magnifier, motion: DockMotion.lean, onPressed: _search),
        DockAction(id: 'add', label: 'Write a note', glyph: HomeGlyph.plus, motion: DockMotion.turn, onPressed: _plus),
        // Given whether or not Talk is: the dock draws one microphone, and Speak where Talk is hidden in the editor.
        if (_capture != null) DockAction(id: 'speak', label: 'Speak a voice note', glyph: HomeGlyph.mic, ink: true, onPressed: _speak),
        if (market && !preferences.value.simple) DockAction(id: 'market', label: 'Market', icon: Lucide.store, onPressed: _showMarket),
      ],
      foot: DockAction(id: 'settings', label: 'Settings', icon: Lucide.settings, onPressed: _openSettings),
    );
  }

  /// Claude and the halo, for a page whose dock's rings are its own: a note, an organization, Settings.
  /// Simple mode (GHST-103) has no Claude on any dock: a note's, an organization's and Settings' follow home's.
  PageDockSeam _pageDock() => preferences.value.simple ? PageDockSeam(halo: _pageDockHalo) : PageDockSeam(claude: _claudeForDock, talk: _claudeTalkForDock, halo: _pageDockHalo);

  static Widget _homeGhost(BuildContext context, HomeGhost it) => Ghost(
        scene: switch (it.scene) {
          HomeGhostScene.noNotes => GhostScene.noNotes,
          HomeGhostScene.emptyWorkspace => GhostScene.emptyWorkspace,
          HomeGhostScene.searchNothing => GhostScene.searchNothing,
        },
        size: it.lead ? GhostSize.lead : GhostSize.small,
        heightShare: it.heightShare,
      );

  Widget _atWorkPart(BuildContext context) {
    final noteAi = _noteAi, id = _noteAiId;
    if (noteAi == null || id == null) return _nothing;
    final voice = _voice;
    return AtWork(
      noteId: id,
      opening: noteAi.reviewKey,
      heard: noteAi.handoff?.heard ?? '',
      body: _library.noteOf(id)?.body ?? '',
      hasJob: noteAi.handoff?.job != null,
      stage: noteAi.reviewStage.value,
      refining: voice?.recorder.refining?.refining,
      summaryDue: voice?.summaries?.pendingFor(id),
    );
  }

  Widget _settingsPart(BuildContext context) {
    final services = _services;
    final guide = _guide;
    return SettingsSheet(
      open: _settings,
      toPage: _settingsPage,
      onClose: _closeSettings,
      workspaces: _workspaces,
      notesInWorkspace: _notesIn,
      onTrashNotes: _trashNotes,
      // About's Updates rows, in a build that looks for any (lib/root/update_wiring.dart).
      // An iPhone has no update client: About says whose its updates are (iphone_wiring.dart).
      updates: widget.updates == null ? appStoreUpdates() : settingsUpdatesOf(widget.updates!, onShow: _showUpdate),
      // A build with no service says so where a way in is pressed; one with an account takes it from the scope.
      features: _features(services),
      onOrganization: services == null ? null : _organizationSettings,
      onOpenLink: widget.openLink == null ? null : (url) => unawaited(widget.openLink!(url)),
      // A meeting's note, from a meeting plugin's page: Settings shut, the note opened where it was left, as home
      // opens it.
      onOpenNote: (id) {
        _closeSettings();
        _afterFrame((shell) => _openWhereLeft(shell, id));
      },
      onAcademy: () {
        _closeSettings();
        _shell.currentState?.show(const Screen.academy());
      },
      // Settings' Market row, a plugin page's word on where the plugin is, and a link to the old Plugins.
      onMarket: ({plugin}) => _showMarket(plugin: plugin),
      onGuide: guide == null
          ? null
          : () {
              _closeSettings();
              guide.show(0);
            },
      onGuideBook: () => unawaited(_openGuideBook()),
      // Examples' four rows, which were drawn and could not be pressed: nothing had given them a press.
      // The sample note and the example canvas with their picture, where one can be kept.
      onSample: _openExample(() async => sampleNoteWith(await _samplePicture())),
      onBoard: _openExample(() => boardNoteBody),
      onCanvas: _openExample(() async => sampleCanvasBody(await _samplePicture())),
      onHowCanvas: _openExample(howCanvasBody),
      // Claude alone on Settings' dock (docs/DOCK.md).
      dock: _pageDock(),
    );
  }

  /// What the palette finds in Settings and among the plugins, as Settings itself reads them: made the first time it is
  /// asked for in an opening of the palette and kept until the next, since a plugin added or a setting changed while
  /// it is up is the palette shut first.
  SettingsIndex _paletteSettings(BuildContext context) {
    final at = (_commands.currentState?.openings ?? -1, setupsPrepared);
    final held = _settingsIndex;
    if (held != null && at == _settingsIndexAt) return held;
    _settingsIndexAt = at;
    return _settingsIndex = settingsIndex(
      settingsFactsFor(context, services: _services, workspaces: _workspaces.value.list.length, updates: widget.updates == null ? appStoreUpdates() : settingsUpdatesOf(widget.updates!), features: _features(_services)),
      registry: plugins,
    );
  }

  Widget _commandsPart(BuildContext context) {
    final guide = _guide;
    return CommandBar.over(
      key: _commands,
      // The open note's blanks for Fill, as its editor counted them (lib/editor/ai/blanks.dart `openNoteBlanks`).
      world: () => paletteWorldFor(
        shell: _shell.currentState!,
        workspaces: _workspaces.value,
        prefs: preferences.value,
        blanks: switch (openNoteBlanks.value) {
          final counted? when counted.noteId == _shell.currentState!.shown => counted.count,
          _ => 0,
        },
        smartNotebooks: [for (final each in _organize.smart.value) (id: each.id, name: each.name)],
        // Settings and the plugins, as Settings itself reads them (Matt, 2026-10-29: "Add the ability to search
        // settings and plugins from the command search").
        settings: () => _paletteSettings(context),
        // "Start timer on HT-12" (root_ticket_rules.dart).
        tickets: _ticketsWired.paletteTickets,
        timing: _ticketsWired.timing,
      ),
      doing: () => paletteDoingFor(
        shell: _shell.currentState!,
        library: _library,
        workspaces: _workspaces,
        newNote: _new,
        newFromTemplate: () => unawaited(_newFromTemplate()),
        newNotebook: () => _newBook(NewBookKind.notebook),
        newJournal: () => _newBook(NewBookKind.journal),
        newEntry: (id) => unawaited(_newEntry(id)),
        academy: () => _shell.currentState?.show(const Screen.academy()),
        guide: guide == null ? null : () => guide.show(0),
        speak: _capture == null ? null : _speak,
        speakInto: _capture == null ? null : (id) => unawaited(_speakInto(id)),
        openNoteWhereLeft: (id) {
          final note = _library.noteOf(id);
          final shell = _shell.currentState;
          if (note != null && shell != null) shell.openNote(whereLeft(note, _shown, shell.shown, on: _stored).id);
        },
        // App.tsx `archive: (id) => actions.archive(note, true)` and `pin: (id) => actions.pin(note)`: the note's
        // tab stays, and a pin gives the tick an archive gives.
        archive: (id) {
          final note = _library.noteOf(id);
          if (note != null) _actions.archive(note, archived: true);
        },
        pin: (id, _) {
          final note = _library.noteOf(id);
          if (note != null) _actions.pin(note);
        },
        removeNote: _delete,
        // Show it formatted, Show the marks: the preference every note's editor reads.
        setView: (view) => preferences.update((now) => now.copyWith(noteView: view)),
        // The note's runs from the palette go through its screen, as a spoken instruction does (`noteAi`).
        noteAi: (id, kind) {
          final shell = _shell.currentState;
          final now = shell?.screen;
          if (shell != null && now is ScreenNote && now.note.id == id) shell.show(now.asked(Keyed(SpokenAsk(kind: kind), DateTime.now().millisecondsSinceEpoch)));
        },
        settings: _openSettings,
        settingsPage: _openSettingsAt,
        // The links between notes (lib/links): the whole graph, the open note's own, and its links.
        graph: _showGraph,
        localGraph: (id) => _showGraph(focus: id, title: noteTitle(_library.noteOf(id)?.body ?? '')),
        noteLinks: _openNoteLinks,
        today: _organize.today,
        askClaude: _claudeOn ? () => _openAskClaude() : null,
        tags: _organize.showTags,
        market: _showMarket,
        trash: _openTrash,
        // My tickets and Triage, once the library has any ticket (root_tickets.dart).
        myTickets: _reads.entries.isEmpty ? null : () => _shell.currentState?.showTickets(),
        triage: _reads.entries.isEmpty ? null : () => _shell.currentState?.showTickets(triage: true),
        openSmart: _organize.showSmart,
        settingsAt: _openSettingsAt,
        marketPlugin: (id) => _showMarket(plugin: id),
        startTimer: _ticketsWired.timers == null || !projectSuite.anywhere(timeTrackingTool) ? null : _ticketsWired.startTimer,
        stopTimer: _ticketsWired.timers == null ? null : _ticketsWired.stopTimer,
        backUpNow: _gitWired.backUpNow,
        asks: _askCommands,
      ),
    );
  }

  Widget _noteMenuPart(BuildContext context) => NoteMenuHost(
        controller: _menu,
        notes: _shown,
        onOpen: (note) {
          final shell = _shell.currentState;
          if (shell != null) _openWhereLeft(shell, note.id);
        },
        // The note itself, with a comment started on its first line once its editor is there
        // (core/comments/ask.ts).
        onComment: (note) {
          commentAsks.ask(note.id);
          _shell.currentState?.openNote(note.id);
        },
        onPin: _actions.pin,
        onArchive: (note, archived) => _actions.archive(note, archived: archived),
        onDelete: (note) => _delete(note.id),
        // Move to: the folders it may go to, as a drag onto one would move it (lib/notes/folder_drag.dart).
        workspaces: _workspaces,
        // A ticket's Watch or Unwatch (root_tickets.dart).
        more: (context, note) => [..._favoriteMenuRows(context, note), ..._ticketMenuRows(context, note)],
        // Show in Finder (Explorer, Files) for the note's file, on a desktop (lib/core/show_in_files.dart).
        show: _showInFiles,
      );

  /// The sheet of the oldest share waiting: kept or not, the person goes back to the app they shared from, and the
  /// next share, if one came meanwhile, has its sheet.
  Widget _shareInPart(BuildContext context) {
    if (_sharing.isEmpty) return _nothing;
    final share = _sharing.first;
    return ShareInSheet(
      key: ValueKey('share-in:${share.id}'),
      share: share,
      keeper: _shareKeeper,
      notes: shareTargets(_library.value, trashed: _trash.isTrashed),
      onDone: (kept) {
        _told(() => _sharing.remove(share));
        unawaited(widget.shares?.done());
      },
    );
  }

  Widget _newSheetPart(BuildContext context) {
    final services = _services;
    final voice = _voice;
    final capture = _capture;
    final into = _newInto;
    return NewSheet(
      open: _newSheet,
      // Simple mode (GHST-103): Note, then More… for the rest.
      simple: preferences.value.simple,
      onClose: () => _told(() {
        _newSheet = false;
        _newInto = null;
      }),
      onNote: () => _new(into),
      onTemplate: () => unawaited(_newFromTemplate(into)),
      // A canvas where Canvas is on (docs/PM_PLUGINS.md §10).
      onCanvas: moreToolOn(canvasTool) ? () => _newCanvas(into) : null,
      onBook: () => _newBook(NewBookKind.notebook, into),
      // Today's note (lib/notes/daily_notes.dart): the account's own, not offered from an organization's +.
      onToday: into != null ? null : () => _organize.today(),
      // A journal's entry is the account's own, and is not offered from an organization's +.
      entry: into != null || !_newSheet ? null : _entryRow(),
      // A shared link's copy is read from the account's service: not offered in a build with none.
      onFromLink: into != null || services?.shares == null ? null : _forkFromLink,
      // A meeting is the account's own too, and is offered only where one can be recorded.
      // A meeting recorded here, where Meetings is on (docs/PM_PLUGINS.md §10).
      onMeeting: into == null && capture != null && (voice?.canMeet ?? false) && moreToolOn(meetingsTool) ? () => unawaited(capture.meeting(false)) : null,
      sound: into == null && capture != null && (voice?.canMeet ?? false) && moreToolOn(meetingsTool) && (voice?.sound?.supported ?? false)
          ? NewSheetSound(
              // The page's words for it on this platform (`meetingSoundWords`): other apps' sound on
              // Android, the computer's own on a Mac.
              label: voice?.recorder.systemSound?.meetingSoundWords().label ?? 'Include sound from other apps',
              hint: voice?.recorder.systemSound?.meetingSoundWords().hint ??
                  'Android lets Ghost.md hear media and games, never calls. It asks to share your screen each time; only the sound is kept.',
              on: preferences.value.meetingSound,
              onToggle: () => preferences.update((now) => now.copyWith(meetingSound: !now.meetingSound)),
            )
          : null,
    );
  }

  Widget _newBookPart(BuildContext context) => NewBookSheet(
        open: _bookSheet != null,
        kind: _bookSheet ?? NewBookKind.notebook,
        onClose: () => _told(() => _bookSheet = null),
        titles: _bookSheet == null ? const [] : _pageTitles(books: false),
        isCanvas: (title) => isCanvasBody(_reads.titled(title)?.body ?? ''),
        onCreate: (title, pages) => _showMade(bookNoteBody(title, pages), into: _bookInto),
        onCreateJournal: (title, template, place) => _showMade(journal.journalNoteBody(title, template, place)),
        onCreateDocs: (title, pages) => _showMade(docsBookBody(title, parts: [DocsPart(docsStarterPart, pages)]), into: _bookInto),
        // A journal's "With where you are", where Places is on (docs/PM_PLUGINS.md §10): the prompt from the press that
        // turned it on, and why it cannot.
        offersPlace: moreToolOn(placesTool),
        device: _places == null
            ? const EntryPlaceDevice()
            : EntryPlaceDevice(cannot: () => _places.locations.cannotLocate, refused: _places.autoTagRefusal, allowWhere: _places.allowLocationWhere(), ask: _places.askFromPress),
      );

  /// The workspace sheet for a new folder inside [parent] (the folders' strips' and tiles' New folder, GHST-107), or
  /// at the top for null (the icon view with nothing chosen).
  void _newFolder(String? parent) => _told(() => _workspace = (editing: null, parent: parent, deleting: false, all: false));

  /// A folder's sheet from its menu (lib/notes/folder_menu.dart): to rename it, or at its Delete, which asks what
  /// becomes of its notes, as the sheet's own Delete does.
  void _manageFolder(Workspace folder, {bool deleting = false, bool all = false}) => _told(() => _workspace = (editing: folder, parent: null, deleting: deleting, all: all));

  Widget _workspacePart(BuildContext context) {
    final sheet = _workspace;
    if (sheet == null) return _nothing;
    return WorkspaceManageSheet(
      store: _workspaces,
      editing: sheet.editing,
      // A folder inside another, from a strip's New folder: the sheet says where it goes.
      parent: sheet.parent,
      folders: sheet.parent != null,
      deleting: sheet.deleting,
      deletingAll: sheet.all,
      onDeleteAll: _deleteFolderAndNotes,
      noteExists: _noteLive,
      onClose: () => _told(() => _workspace = null),
      onOrganization: _services == null ? null : _openOrganizationSettings,
      notesIn: _notesIn,
      onTrashNotes: _trashNotes,
      // A folder's own template (root_templates.dart): Set template… on its sheet, and what it is now.
      onSetTemplate: sheet.editing == null || isOrgWorkspace(sheet.editing!.id) ? null : (folder) => unawaited(_setFolderTemplate(folder)),
      templateOf: (folder) => _folderTemplate(folder.id)?.name,
    );
  }

  Widget _trashPart(BuildContext context) {
    final sheet = _trashSheet;
    if (sheet == null) return _nothing;
    final hidden = _made?.hidden ?? const <String>{};
    final spaces = _workspaces.value;
    return TrashSheet(
      key: ValueKey('trash-sheet:${sheet.note}'),
      // Less a note deleted for good whose Undo still stands: it has gone, as far as the person can see.
      notes: [for (final note in _trashed) if (!hidden.contains(note.id)) note],
      held: _trash.value,
      open: sheet.note,
      onRestore: _actions.restore,
      onDestroy: _actions.destroy,
      // The notes the sheet lists (all, or what its Find found): in batches, on the Activity tray.
      onEmpty: _actions.emptyTrash,
      onRestoreAll: _actions.restoreAll,
      onClose: () => _told(() => _trashSheet = null),
      teamNote: _isTeamNote,
      placeOf: (id) {
        final space = _workspaces.workspaceOf(id);
        return space == null ? null : workspacePathName(spaces.list, space.id);
      },
      simple: preferences.value.simple,
      now: widget.clock,
    );
  }

  Widget _organizationSheetPart(AccountServices services) {
    final sheet = _organization;
    if (sheet == null || services.orgs == null) return _nothing;
    return OrganizationSheet(
      key: ValueKey('organization-sheet:${sheet.id}'),
      services: services,
      orgId: sheet.id,
      from: sheet.from,
      // `landOnMembers={orgSettings.from === 'settings'}`: from anywhere else, its list of sections.
      landOnMembers: sheet.from == OrganizationFrom.settings,
      seen: _seenIn(sheet.id),
      onClose: _closeOrganizationSettings,
      // Report a member or a note: an email, handed to the phone.
      onOpenLink: widget.openLink == null ? null : (url) => unawaited(widget.openLink!(url)),
      onNotes: () {
        _told(() => _organization = null);
        _workspaces.chooseWorkspace(orgWorkspaceId(sheet.id));
        _shell.currentState?.backToList();
      },
    );
  }

  Widget _newOrganizationPart(AccountServices services) => NewOrganizationSheet(
        services: services,
        open: _newOrganization,
        onClose: () => _told(() => _newOrganization = false),
        // Its home page there and then, with the tools chosen in its second step as its `plugins:` (docs/PM_PLUGINS.md).
        onTools: (id, tools) => _createHome(id, plugins: tools),
        onMade: (id) {
          _told(() => _newOrganization = false);
          _shell.currentState?.openOrganization(id);
        },
      );

  /// The What's new card, while it is up: the releases since the version last seen, Got it, See all changes.
  Widget _whatsNewPart(BuildContext context) {
    final whatsNew = _whatsNew, waiting = whatsNew?.waiting, running = whatsNew?.running;
    if (whatsNew == null || waiting == null || running == null) return _nothing;
    return WhatsNewCard(version: running, releases: waiting.releases, more: waiting.more, onClose: _whatsNewDone, onSeeAll: () => _whatsNewDone(seeAll: true));
  }

  Widget _guidePart(BuildContext context) {
    final guide = _guide;
    if (guide == null || !guide.open || _launchUp || (_gate?.open ?? false) || (_shell.currentState?.screen.isRecording ?? false)) return _nothing;
    return Guide(
      index: guide.page,
      tooSoon: guide.tooSoon,
      onIndex: guide.turn,
      recordsVoice: _capture != null,
      models: _modelsForGuide,
      onClose: () {
        guide.close();
        // The list underneath loaded while the guide was up; ask again now it shows.
        unawaited(_library.refresh().catchError((Object _) {}));
      },
      onAcademy: () {
        guide.close();
        _shell.currentState?.show(const Screen.academy());
      },
    );
  }

  Widget _launchPart(BuildContext context) {
    if (!_launching) return _nothing;
    return LaunchScreen(
      loading: _launchLoading,
      notes: _launchNotes,
      updates: launchUpdatesOf(widget.updates),
      sync: _launchSync,
      recording: _meetingRecording,
      onDone: () {
        _told(() => _launching = false);
        _launchGone();
      },
    );
  }
  /// A note's screen with its editor: one desk to an open note (lib/root/note_desk.dart). Built again when the
  /// screen is another (the note, what it was opened with), and when what it reads of the app is: the other notes
  /// (the titles that are taken, its place in its notebook, your templates; so a notebook thrown away takes its bar
  /// off the page being read at once, not when its Undo runs out), the trash, the workspaces, the preferences and
  /// the account. Not for a keystroke, the home page's news or a runner's turn; and **not for the note's own
  /// save**, of which the screen it is handed here shows nothing: it is built from the note as it was opened
  /// (`screen.note`, as the page's is), every other note's title, and its notebook's index, and what its editor
  /// holds, its saving and its pin are its own to follow (`_notesBut`).
  Widget _note(BuildContext context, AppShellState shell, ScreenNote screen) {
    // Simple mode's note on a phone has its own Back (GHST-105): not beside the list pane, where the list stays.
    final back = preferences.value.simple && !shell.listPane(context);
    return Selected(
      listenable: _tick,
      name: 'note',
      select: () => (screen, _notesBut(screen.note.id), _trash.value, _made?.hidden, _workspaces.value, _prefsAt, _capture != null, _accountAt, _claudeShown, back),
      builder: (context, _) => _desked(context, shell, screen, back: back),
    );
  }

  Widget _desked(BuildContext context, AppShellState shell, ScreenNote screen, {required bool back}) => NoteDesk(
        key: ValueKey('desk:${screen.note.id}'),
        noteId: screen.note.id,
        title: noteTitle(screen.note.body),
        world: _desk,
        readOnly: _trash.isTrashed(screen.note.id),
        // What the recorder handed the note it opened (lib/root/capture_route.dart `finished`).
        landing: screen.landing,
        ask: screen.ask,
        review: screen.review,
        playTape: screen.at == atTape,
        showTranscript: screen.at == atTranscript,
        say: (message) => _say(context, message),
        builder: (context, editor, seams) => noteScreenBuilder(
          library: _library,
          workspaces: _workspaces,
          actions: () => _actions,
          versions: _versions,
          trash: _trash,
          device: _stored,
          untouched: _untouched,
          editor: editor,
          seams: seams,
          say: _say,
          bookOf: _reads.placeInBook,
          templates: () => _reads.ownTemplates,
          onTemplates: () => unawaited(_openTemplates()),
          // Taken back by the next journal's own: one screen is gone only after the next has come.
          onJournal: (writer) => _journalWriter = writer ?? _journalWriter,
          onSpeak: _capture == null ? null : (id) => unawaited(_speakInto(id)),
          // The bar's History button: the side panel at its History tab, where the window has one; else More's page.
          onHistory: _asideHistoryOf(context, shell) == null ? null : () => _openHistoryAside(shell),
          tags: _places,
          // Claude, about this note, at the head of its dock; the note's own rings under it (docs/DOCK.md).
          dock: _pageDock(),
          back: back,
          backLabel: _simpleTab == SimpleTab.todos ? 'To-dos' : 'Notes',
        )(context, shell, screen),
      );
  /// An organization's dashboard or its log: built again with the notes, the account and its sync, who is in its
  /// notes, and the smoke's switch.
  Widget _organizationPage(BuildContext context, AppShellState shell, ScreenOrganization screen) => Selected(
        listenable: _tick,
        name: 'organization',
        select: () => (screen.orgId, screen.page, screen.member, shell.notes, _workspaces.value, _accountAt, _syncAt, _presenceAt, preferences.value.wispEdge, _claudeShown, _canTalk),
        builder: (context, _) => _organizationPageOf(context, shell, screen),
      );

  Widget _organizationPageOf(BuildContext context, AppShellState shell, ScreenOrganization screen) {
    final id = screen.orgId;
    final wisp = preferences.value.wispEdge;
    if (screen.page == OrganizationPage.member && screen.member != null) return _memberPage(shell, id, screen.member!);
    if (screen.page == OrganizationPage.log) {
      return OrganizationLog(services: _services, orgId: id, notes: shell.notes, onBack: () => shell.openOrganization(id), onOpenNote: (note) => _openWhereLeft(shell, note), record: _versions, wisp: wisp);
    }
    return OrganizationScreen(
      services: _services,
      orgId: id,
      notes: shell.notes,
      onBack: shell.backToList,
      onOpenNote: (note) => _openWhereLeft(shell, note),
      onNew: () => _plus(orgWorkspaceId(id)),
      // All of its notes, or a folder's (GHST-107): the home page with that workspace chosen.
      onAllNotes: (folder) {
        _workspaces.chooseWorkspace(folder ?? orgWorkspaceId(id));
        shell.backToList();
      },
      onNewFolder: _newFolder,
      // New note on the strip and in the icon view: filed in the organization's workspace, the team's.
      onNewNote: _new,
      onSettings: () => _openOrganizationSettings(id, OrganizationFrom.dashboard),
      onOpenOrganization: shell.openOrganization,
      seen: _seenIn(id),
      onJumpTo: (noteId) => _jumpTo(shell, id, noteId),
      onFollow: _follow == null ? null : _followFrom,
      // An AI's Chat: the chat with Claude, opened for it (docs/CLAUDE_APP.md, "The chat").
      onChat: _claudeOn ? (ai) => _openAskClaude(agent: ai.name) : null,
      // Ask the team's notes, with receipts (root_ask.dart).
      onAsk: () => _openAskOrg(id),
      onLog: () => shell.openOrganizationLog(id),
      onAccount: _toAccount,
      wisp: wisp,
      // Claude, then the page's own New, Invite and cog (docs/DOCK.md).
      dock: _pageDock(),
      // The teamspace home (docs/TEAMSPACES.md): its page drawn as a note's, the way to make it and to set how the
      // space's pages open, and a member's page from the strip (root_teamspaces.dart).
      homeDrawing: pageDrawingOf(_desk, open: _openTitle),
      onMember: (handle) => shell.openOrganizationMember(id, handle),
      onCreateHome: () => _createHome(id),
      onSetDocs: (mode) => _setDocs(id, mode),
      // The space's index card under its home page (root_indexes.dart).
      indexCard: (space) => _indexCardOf(shell, space),
    );
  }

  /// The voice model's fetch as its line says it.
  static notices.VoiceModel _voiceModelState(VoiceModel? model) => switch (model?.state) {
        VoiceModelStateDownloading(:final received, :final total) => notices.VoiceModelDownloading(received: received, total: total),
        VoiceModelStateFailed(:final message) => notices.VoiceModelFailed(message),
        _ => const notices.VoiceModelQuiet(),
      };

  /// Whether the voice model has a line above the notes, and which: nothing, its fetch, or why it failed. The
  /// fetch's progress is the line's own to follow.
  Object? get _voiceModelLine => switch (_voice?.recorder.voiceModel.state) {
        VoiceModelStateDownloading() => true,
        VoiceModelStateFailed(:final message) => message,
        _ => null,
      };

  /// What is waiting on the person, above the notes (notes/Notices.tsx), in the page's order: the simple-or-advanced
  /// question for an install from before there was one (GHST-103), an invitation to an organization where the build
  /// has an account, and the voice model while it is not ready. A new version of the app is not among them: it is the
  /// activity tray's, under the ring's badge (Matt, 2026-10-30: "show the updates stuff in the activity drawer only now
  /// with a badge").
  List<Widget> _notices() {
    final services = _services;
    final model = _voice?.recorder.voiceModel;
    return [
      if (_asksExperience) notices.ExperienceCard(onPick: _pickExperience),
      // Simple mode's way into the Academy (GHST-103): for the first week, until a lesson is passed or the cross.
      if (_academyCardDue)
        notices.AcademyCard(
          onOpen: () => _shell.currentState?.show(const Screen.academy()),
          onHide: () => setState(dismissAcademyBanner),
        ),
      if (services != null) InviteWaiting(services: services, onOpen: (id) => _shell.currentState?.openOrganization(id)),
      if (model != null && _voiceModelLine != null)
        ListenableBuilder(listenable: model, builder: (context, _) => notices.VoiceModelStatus(state: _voiceModelState(model), onRetry: model.retry)),
      if (_bannerShown) _bannerNotice(),
      // What may be out of date (lib/plugins/contradictions/; Matt, 2026-11-02): a quiet line while anything is.
      ?_contradictionsWired.notice(),
    ];
  }

  /// The header images being made for the recent notes, as the app's own job (lib/plugins/lovart/banner_run.dart;
  /// Matt, 2026-10-26: "Make the header generation async and a background task that runs while the app is
  /// generating the images"): "Making header images · 12 of 100" with Stop while it runs, on home and in the
  /// sidebar, wherever the person went after pressing Make them; and once it stopped for a reason (credits spent,
  /// keys refused, a costly step waiting), the reason, with Hide. The line follows the run by itself; the parts are
  /// built again only as it comes and goes ([_bannerShown]).
  Widget _bannerNotice() => ValueListenableBuilder<BannerRun?>(
        valueListenable: lovartBannerRun,
        builder: (context, run, _) {
          if (run == null) return const SizedBox.shrink();
          if (run.running) return notices.JobNotice(words: bannerRunLine(run), action: 'Stop', onAction: stopBannerRun);
          return notices.JobNotice(words: bannerRunEndWords(run), action: 'Hide', onAction: () => _told(() {
                _bannerHidden = run;
                _bannerShown = false;
              }));
        },
      );

  /// Whether home asks simple or advanced (GHST-103): the walkthrough has been seen (so it did not ask, or was
  /// skipped before its page) and the choice was never made, here or on another device. Matt, 2026-10-18: new
  /// installs choose in the walkthrough, "existing users see it on the card one time".
  bool get _asksExperience => !preferences.value.experienceChosen && _guide?.open != true && _stored.flag(guideSeenKey, value: guideSeenValue, unreadable: true).isMarked;

  /// Whether home offers the Academy's card (lib/academy/banner.dart): in simple mode, where the marks are hidden
  /// and the Academy is how they are learnt (Matt: "the academy page should show up on the home screen kinda like
  /// the update banner for new users"); advanced has the cheat sheet and the + list's More in reach already. On
  /// the root's clock, where a test sets one.
  bool get _academyCardDue =>
      preferences.value.simple && academyBannerDue(now: widget.clock == null ? null : DateTime.fromMillisecondsSinceEpoch(widget.clock!(), isUtc: true));

  /// The card's answer: the choice, made for every device, and the card goes with it.
  void _pickExperience(String mode) => preferences.update((now) => now.choosing(mode));

  /// The sidebar's notices on a wide window, where there is no home list to show them (App.tsx `notices`,
  /// notes/NoteTree.tsx): the list beside the note ([_listColumn]), and the tree's card where the window is in two
  /// panes: the header images being made. An update waiting was one, and is the activity tray's now.
  List<Widget> _sidebarNotices() => [
        if (_bannerShown) _bannerNotice(),
      ];
}
