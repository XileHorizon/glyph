import 'package:flutter/gestures.dart';
import 'package:flutter/widgets.dart';
import 'package:ghost_md/app/ghost_app.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ghost_md/core/core_library.dart';
import 'package:ghost_md/core/preferences.dart';
import 'package:ghost_md/core/stored.dart';
import 'package:ghost_md/core/workspaces.dart';
import 'package:ghost_md/editor/queries/queries.dart' show Part, queriesWatchMidnight;
import 'package:ghost_md/root/ghost_root.dart';
import 'package:ghost_md/shell/app_shell.dart';

import '../library/support.dart' show FakeCore, libraryOver;
import '../support/render.dart';

/// A query's board in a notebook's own words, as Matt has it (2026-10-27: "I can't drag items around in the query
/// tickets for hello trade"): HelloTrade Tickets at the HelloTrade organization's top level, its tickets in the
/// organization's folder HelloTrade › Tickets, and over its index a ```query of them as a board, `sort: due`, the
/// Done ones left out. The library is the fake core's, so a card dropped on a lane writes its ticket as the phone
/// does, and every file is still there after.
///
/// The notebook's own words are drawn read only (book_view.dart `BookWords`), and a query there was drawn as one
/// that could not be changed: its cards never lifted. Its tickets are notes of their own, the person's to move.
void main() {
  setUpAll(() async {
    await loadAppFonts();
    queriesWatchMidnight = false;
  });

  const org = 'org-hellotrade';
  const tickets = 'w-f43egk';

  const notebook = '---\n'
      'title: "HelloTrade Tickets"\n'
      'book: true\n'
      'key: HT\n'
      'authors: mattmattmattmatt, Claude\n'
      'banner: "![](image/lovart-hellotrade.png)"\n'
      '---\n'
      '# HelloTrade Tickets\n'
      '\n'
      "Matt's tickets at HelloTrade, numbered from HT-1.\n"
      '\n'
      '```query\n'
      'from: tickets [[HelloTrade Tickets]]\n'
      'where: status != Done\n'
      'sort: due\n'
      'show: board\n'
      '```\n'
      '\n'
      "1. [[Fix the waitlist bugs for Thursday's release]]\n"
      '2. [[Put up the waitlist website PR]]\n';

  String ticket(String id, String status, String due, String title) => '---\n'
      'type: ticket\n'
      'id: $id\n'
      'status: $status\n'
      'assignee: mattmattmattmatt\n'
      'priority: highest\n'
      'due: $due\n'
      'authors: mattmattmattmatt, Claude\n'
      '---\n'
      '# $title\n'
      '\n'
      'What it is about.\n';

  const home = '---\nbook: true\nkey: GT\n---\n# Garden Tickets\n\n```query\nfrom: tickets [[Garden Tickets]]\nwhere: status != Done\nsort: due\nshow: board\n```\n\n1. [[Plant the beans]]\n';

  WorkspaceSheet sheet() => const WorkspaceSheet(
        list: [
          Workspace(id: org, name: 'HelloTrade', hue: 'blue'),
          Workspace(id: tickets, name: 'Tickets', parent: org),
          Workspace(id: 'home', name: 'Home'),
        ],
        notes: {'ht': org, 'ht1': tickets, 'ht2': tickets, 'gt': 'home', 'gt1': 'home'},
      );

  late FakeCore core;
  late CoreLibrary library;

  Future<void> settle(WidgetTester tester) async {
    for (var i = 0; i < 8; i += 1) {
      await tester.pump(const Duration(milliseconds: 100));
    }
  }

  Future<void> open(WidgetTester tester, String id, {String chosen = org, Size size = const Size(1200, 1000), String theme = 'light'}) async {
    core = FakeCore()
      ..seed('ht', notebook, path: 'orgs/HelloTrade/HelloTrade Tickets.md')
      ..seed('ht1', ticket('HT-1', 'In progress', '2026-10-28', "Fix the waitlist bugs for Thursday's release"), path: "orgs/HelloTrade/Tickets/Fix the waitlist bugs for Thursday's release.md")
      ..seed('ht2', ticket('HT-2', 'To do', '2026-10-30', 'Put up the waitlist website PR'), path: 'orgs/HelloTrade/Tickets/Put up the waitlist website PR.md')
      ..seed('gt', home, path: 'workspaces/Home/Garden Tickets.md')
      ..seed('gt1', '---\ntype: ticket\nid: GT-1\nstatus: To do\ndue: 2026-11-02\n---\n# Plant the beans\n', path: 'workspaces/Home/Plant the beans.md');
    final it = libraryOver(core);
    library = it.library;
    await tester.runAsync(it.library.load);
    final store = WorkspaceStore(storage: MemoryWorkspaceStorage(sheet()))..chooseWorkspace(chosen);
    await pumpApp(tester, size: size, prefs: Preferences(theme: theme), home: GhostRoot(launch: false, library: it.library, workspaces: store, stored: MemoryStored()));
    await tester.pump(const Duration(milliseconds: 100));
    tester.state<AppShellState>(find.byType(AppShell)).openNote(id);
    await settle(tester);
  }

  Future<void> close(WidgetTester tester) async {
    debugDisableShadows = true;
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump(const Duration(seconds: 6));
  }

  Finder parts(String name) => find.byWidgetPredicate((widget) => widget is Part && widget.name == name);

  /// A lane by its name, as a screen reader hears it: "In review, 0".
  Finder lane(WidgetTester tester, String name) {
    final lanes = parts('lane');
    for (var at = 0; at < lanes.evaluate().length; at += 1) {
      if (tester.getSemantics(lanes.at(at)).label.split('\n').first.startsWith('$name, ')) return lanes.at(at);
    }
    throw StateError('no lane $name');
  }

  Finder card(String title) => find.ancestor(of: find.textContaining(title), matching: parts('card')).first;

  /// A press held until the card lifts, carried onto [to], and let go there: a mouse's or a finger's.
  Future<void> carry(WidgetTester tester, Finder from, Finder to, PointerDeviceKind kind) async {
    final start = tester.getRect(from).topLeft + const Offset(24, 10);
    final gesture = await tester.startGesture(start, kind: kind);
    await tester.pump(const Duration(milliseconds: 240));
    await tester.pump();
    final target = tester.getRect(to);
    await gesture.moveTo(Offset(target.left + 40, target.top + 40));
    await tester.pump();
    await tester.pump();
    await gesture.up();
    await tester.pump();
    await settle(tester);
  }

  String bodyOf(String id) => library.noteOf(id)?.body ?? '';

  for (final kind in const <PointerDeviceKind>[PointerDeviceKind.mouse, PointerDeviceKind.touch]) {
    testWidgets('a team ticket’s card carried to another lane by a ${kind.name} takes that status, in its own file', (tester) async {
      await open(tester, 'ht');
      expect(parts('card'), findsNWidgets(2));
      // The lanes are the workflow's, Done among them though the query leaves out what is in it.
      for (final name in const <String>['Backlog', 'To do', 'In progress', 'In review', 'Done']) {
        expect(lane(tester, name), findsOneWidget);
      }
      // The query's own lines are the notebook's words, drawn read only: nothing at its head changes them.
      expect(find.bySemanticsLabel('Edit the query'), findsNothing);
      expect(find.bySemanticsLabel('How to show the query'), findsNothing);
      final files = core.files;
      await carry(tester, card("Fix the waitlist bugs"), lane(tester, 'In review'), kind);
      expect(bodyOf('ht1'), contains('status: In review'));
      expect(bodyOf('ht1'), contains('due: 2026-10-28'), reason: 'the rest of its front matter as it was');
      expect(core.files, files, reason: 'nothing deleted, nothing moved');
      expect(tester.getSemantics(lane(tester, 'In review')).label, startsWith('In review, 1'));
      await close(tester);
    });

    testWidgets('a personal ticket’s card carried by a ${kind.name} takes the lane’s status', (tester) async {
      await open(tester, 'gt', chosen: 'home');
      await carry(tester, card('Plant the beans'), lane(tester, 'In progress'), kind);
      expect(bodyOf('gt1'), contains('status: In progress'));
      await close(tester);
    });
  }

  testWidgets('dropped on Done, which the query leaves out, the card leaves the board with Moved to Done and Undo', (tester) async {
    await open(tester, 'ht');
    await carry(tester, card("Fix the waitlist bugs"), lane(tester, 'Done'), PointerDeviceKind.mouse);
    expect(bodyOf('ht1'), contains('status: Done'));
    expect(find.ancestor(of: find.textContaining('Fix the waitlist bugs'), matching: parts('card')), findsNothing, reason: 'the query leaves out what is done');
    expect(find.text('Moved to Done'), findsOneWidget);
    await tester.tap(find.text('Undo'));
    await settle(tester);
    expect(bodyOf('ht1'), contains('status: In progress'));
    expect(card('Fix the waitlist bugs'), findsOneWidget);
    await close(tester);
  });

  testWidgets('under its sort, a card dropped back in its own lane stays where the sort puts it and writes nothing', (tester) async {
    await open(tester, 'ht');
    final before = bodyOf('ht1');
    await carry(tester, card("Fix the waitlist bugs"), lane(tester, 'In progress'), PointerDeviceKind.mouse);
    expect(bodyOf('ht1'), before);
    expect(find.text('Moved to Done'), findsNothing);
    await close(tester);
  });

  testWidgets('on a phone, a finger carries a card to the lane beside it', (tester) async {
    await open(tester, 'ht', size: const Size(412, 900));
    await carry(tester, card('Put up the waitlist website PR'), lane(tester, 'Backlog'), PointerDeviceKind.touch);
    expect(bodyOf('ht2'), contains('status: Backlog'));
    expect(tester.getSemantics(lane(tester, 'Backlog')).label, startsWith('Backlog, 1'));
    await close(tester);
  });

  // Pictures of the board mid-carry, for the eye: written only by `flutter test --update-goldens
  // test/root/query_board_drag_test.dart`, into build/feature-shots/query-board-drag/ (not committed).
  for (final (where, size, kind) in const [('mac', Size(1200, 900), PointerDeviceKind.mouse), ('fold', Size(904, 1000), PointerDeviceKind.touch)]) {
    for (final theme in const <String>['light', 'dark']) {
      testWidgets('a picture of a card held over In review on the $where, $theme', (tester) async {
        if (!autoUpdateGoldenFiles) return;
        await open(tester, 'ht', size: size, theme: theme);
        final start = tester.getRect(card('Fix the waitlist bugs')).topLeft + const Offset(24, 10);
        final gesture = await tester.startGesture(start, kind: kind);
        await tester.pump(const Duration(milliseconds: 240));
        await tester.pump();
        final target = tester.getRect(lane(tester, 'In review'));
        await gesture.moveTo(Offset(target.left + 60, target.top + 60));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 200));
        await expectLater(find.byType(GhostApp), matchesGoldenFile('../../build/feature-shots/query-board-drag/held-$where-$theme.png'));
        await gesture.up();
        await settle(tester);
        await close(tester);
      });
    }
  }
}
