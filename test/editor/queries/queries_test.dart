// A ```query fence drawn in its note (lib/editor/queries/queries.dart, query_view.dart; docs/DESIGN.md §159): what
// it finds, drawn in place of its lines and live as the note and the library change; its lines and the sentence
// where it cannot be read; the lines again with the caret in them; and what a tap on a row and on a box does, here
// and in another note. `src/app/editor/queries.test.ts`, case for case.
//
// What is asked differently:
// - The page's cases looked for elements by tag and class; these look for the same pieces by the name each has in
//   the stylesheet (`Part`) and by what a screen reader hears.
// - A to-do ticked and a card moved in another note went to the screen as `tick(noteId, line, source, done)` and
//   `move(noteId, line, source, kind, field, value)`; here both are `write(noteId, change)`, and a case holds the
//   change by what it makes of that note's words.
// - The head's title is upper case in the widget, where the page's stylesheet made it so.
// - A press and hold is a finger held past the hold, not a wait on a clock.
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ghost_md/core/hold_drag.dart';
import 'package:ghost_md/core/query/query.dart';
import 'package:ghost_md/editor/queries/lane_carry.dart' show DragGap;
import 'package:ghost_md/editor/queries/queries.dart';
import 'package:ghost_md/editor/queries/query_board.dart';
import 'package:ghost_md/editor/state/state.dart';
import 'package:ghost_md/editor/state/change.dart';
import 'package:ghost_md/editor/view/editor_view.dart';
import 'package:ghost_md/sheet/kit.dart';
import 'package:ghost_md/sheet/sheet.dart';

import '../../support/render.dart';
import 'support.dart';

const String today = '2026-10-08';
const String yesterday = '2026-10-07';

const QueryNote shop = QueryNote(id: 'shop', body: '# Groceries\n\n- [ ] Milk 📅 $yesterday @sam\n- [x] Eggs\n- [ ] Bread ⏫ 📅 $today\n', createdAt: 0, updatedAt: 0);
const QueryNote ticket = QueryNote(id: 'gho1', body: '---\ntype: ticket\nid: GHO-1\nstatus: In progress\npriority: high\nestimate: 3\n---\n# Fix the login loop\n', createdAt: 0, updatedAt: 0);

String fence(String lines) => '# This week\n\n```query\n$lines\n```\n';

late List<QueryNote> library;
late Asked asked;

Future<EditorView> open(WidgetTester tester, String doc, {bool given = true, bool editable = true, bool? adds}) =>
    pumpQueries(tester, doc, options: given ? optionsOver(() => library, asked, adds: adds) : null, readOnly: !editable, today: today);

/// A row of the open sheet, by its label.
Finder sheetRow(String label) => find.descendant(of: find.byType(SheetRow), matching: find.text(label));

/// What the one change asked of the screen makes of `note`'s words.
String? written(QueryNote note) {
  final (id, change) = asked.written.single;
  expect(id, note.id);
  return change(note.body);
}

Future<void> settle(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 400));
  await tester.pump(const Duration(milliseconds: 400));
}

/// The board, or a table, scrolled along so `finder` is on the screen.
Future<void> show(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.pump();
}

void main() {
  setUpAll(loadAppFonts);
  setUp(() {
    library = <QueryNote>[shop, ticket];
    asked = Asked();
  });

  group('a query in a note', () {
    testWidgets('is drawn as what it finds, in place of its lines', (tester) async {
      final view = await open(tester, fence('from: tasks'));
      expect(drawn, findsOneWidget);
      final words = wordsOf(tester, drawn);
      expect(words, contains('TO-DOS'));
      expect(words, contains('Milk'));
      expect(words, contains('Bread'));
      // Open ones only, unless it asks.
      expect(words, isNot(contains('Eggs')));
      expect(shownLines(tester, view), isNot(contains('from: tasks')));
    });

    testWidgets('draws a ticket table with its columns and its total', (tester) async {
      await open(tester, fence('from: tickets\ntotal: estimate'));
      final heads = <String>[for (final element in parts('thWords').evaluate()) wordsOf(tester, find.byElementPredicate((each) => each == element)).trim()];
      expect(heads, <String>['ID', 'Title', 'Status', 'Assignee', 'Priority', 'Due']);
      final table = wordsOf(tester, parts('table'));
      expect(table, contains('GHO-1'));
      expect(table, contains('In progress'));
      expect(wordsOf(tester, drawn), contains('Estimate 3'));
    });

    testWidgets('draws a ticket board as the whole workflow', (tester) async {
      await open(tester, fence('from: tickets\nshow: board'));
      final lanes = <String>[for (var index = 0; index < parts('lane').evaluate().length; index += 1) tester.getSemantics(parts('lane').at(index)).label.split('\n').first];
      expect(lanes, <String>['Backlog, 0', 'To do, 0', 'In progress, 1', 'In review, 0', 'Done, 0']);
    });

    testWidgets('draws a count, and a month', (tester) async {
      await open(tester, '${fence('from: tasks\nshow: count')}\n${fence('from: tasks\nshow: calendar')}');
      expect(drawn, findsNWidgets(2));
      expect(wordsOf(tester, drawn.at(0)).replaceAll('\n', ''), contains('2to-dos'));
      expect(parts('dayCell', drawn.at(1)).evaluate().length, greaterThanOrEqualTo(28));
    });

    testWidgets('reads this note as it is typed', (tester) async {
      final view = await open(tester, '${fence('from: tasks')}\n- [ ] Call the plumber\n');
      expect(wordsOf(tester, drawn), contains('Call the plumber'));
      view.dispatch(TransactionSpec(changes: ChangeSpec(from: view.state.doc.length, insert: '- [ ] Post the letter\n')));
      await tester.pump();
      expect(wordsOf(tester, drawn), contains('Post the letter'));
    });

    testWidgets('is drawn again when the library changes', (tester) async {
      final view = await open(tester, fence('from: tasks'));
      library = <QueryNote>[...library, const QueryNote(id: 'more', body: '- [ ] Water the plants', createdAt: 0, updatedAt: 0)];
      view.dispatch(TransactionSpec(effects: refreshQueries.of(null)));
      await tester.pump();
      expect(wordsOf(tester, drawn), contains('Water the plants'));
    });

    testWidgets('cannot be read: its lines, and the sentence that says what is wrong and where', (tester) async {
      await open(tester, fence('from: tickets\nwhere: status ='));
      expect(wordsOf(tester, parts('lines')).trimRight(), 'from: tickets\nwhere: status =');
      expect(wordsOf(tester, drawn), contains('Line 2, column 16: After “status =”, something to compare it with'));
    });

    testWidgets('stays as its lines where there is no library to read', (tester) async {
      final view = await open(tester, fence('from: tasks'), given: false);
      expect(drawn, findsNothing);
      expect(shownLines(tester, view), contains('from: tasks'));
    });

    testWidgets('steps aside for its lines with the caret in them, and the pencil puts it there', (tester) async {
      final view = await open(tester, fence('from: tasks'));
      await tester.tap(said('Edit the query'));
      await tester.pump();
      expect(drawn, findsNothing);
      expect(view.state.doc.lineAt(view.state.selection.main.head).text, 'from: tasks');
    });

    testWidgets('has no pencil and no box to tick where the note cannot be edited', (tester) async {
      await open(tester, fence('from: tasks'), editable: false);
      expect(said('Edit the query'), findsNothing);
      expect(tester.getSemantics(said('Tick Milk')).flagsCollection.isEnabled.toBoolOrNull(), isFalse);
      await tester.tap(said('Tick Milk'), warnIfMissed: false);
      await tester.pump();
      expect(asked.written, isEmpty);
    });
  });

  group('a tap in a drawn query', () {
    testWidgets('opens another note, and a to-do’s note at its line', (tester) async {
      await open(tester, fence('from: tasks'));
      await tester.tap(said('Bread'));
      expect(asked.opened, <(String, int?)>[('shop', 4)]);
      asked.opened.clear();
      await open(tester, fence('from: tickets'));
      await tester.tap(said('Fix the login loop'));
      expect(asked.opened, <(String, int?)>[('gho1', null)]);
    });

    testWidgets('ticks a to-do in another note through the screen', (tester) async {
      await open(tester, fence('from: tasks'));
      await tester.tap(said('Tick Milk'));
      await tester.pump();
      // `tick('shop', 2, '- [ ] Milk 📅 … @sam', true)`: the line the query read, found by its words, ticked.
      expect(written(shop), tickedBody(shop.body, 2, '- [ ] Milk 📅 $yesterday @sam', true));
      expect(written(shop), contains('- [x] Milk'));
    });

    testWidgets('moves a ticket to the lane its card is dragged to, through the screen', (tester) async {
      await open(tester, fence('from: tickets\nshow: board'));
      // The board scrolled along until the card's lane and the one after it are both on the screen.
      final across = tester.state<ScrollableState>(find.descendant(of: drawn, matching: find.byWidgetPredicate((w) => w is Scrollable && w.axisDirection == AxisDirection.right)).last);
      across.position.jumpTo(470);
      await tester.pump();
      final card = boxOf(tester, parts('card'));
      final target = boxOf(tester, parts('lane').at(3));
      expect(tester.getSemantics(parts('lane').at(3)).label.split('\n').first, 'In review, 0');
      final finger = await holdAt(tester, card.topLeft + const Offset(30, 12));
      // Pressed and held, as a ```board's card is: a copy of it in the air.
      expect(find.descendant(of: find.byType(Overlay).first, matching: find.text('Fix the login loop')), findsNWidgets(2));
      await finger.moveTo(Offset(target.left + 60, target.center.dy));
      await tester.pump();
      // Held over another lane, the card leaves its own for the gap in that one.
      expect(find.descendant(of: parts('lane').at(3), matching: find.byType(DragGap)), findsOneWidget);
      expect(find.descendant(of: parts('lane').at(2), matching: parts('card')), findsNothing);
      await finger.up();
      await tester.pump(const Duration(milliseconds: 300));
      // `move('gho1', …, 'ticket', 'status', 'In review')`
      expect(written(ticket), contains('status: In review'));
      expect(find.text('Fix the login loop'), findsOneWidget);
    });

    // A notebook's own words are drawn read only, and the tickets on a board there are notes of their own (Matt,
    // 2026-10-27: "I can't drag items around in the query tickets for hello trade").
    testWidgets('in words drawn read only whose host lets it, moves a ticket and leaves the lines alone', (tester) async {
      final options = QueryOptions(
        notes: () => library,
        noteId: null,
        open: (noteId, line) => asked.opened.add((noteId, line)),
        write: (noteId, change) => asked.written.add((noteId, change)),
        listedWritable: () => true,
      );
      await pumpQueries(tester, fence('from: tickets\nshow: board'), options: options, readOnly: true, today: today);
      // Nothing at the head writes the lines, and no line under the board sets its height.
      expect(said('Edit the query'), findsNothing);
      expect(said('How to show the query'), findsNothing);
      final across = tester.state<ScrollableState>(find.descendant(of: drawn, matching: find.byWidgetPredicate((w) => w is Scrollable && w.axisDirection == AxisDirection.right)).last);
      across.position.jumpTo(470);
      await tester.pump();
      final card = boxOf(tester, parts('card'));
      final target = boxOf(tester, parts('lane').at(3));
      final finger = await holdAt(tester, card.topLeft + const Offset(30, 12));
      await finger.moveTo(Offset(target.left + 60, target.center.dy));
      await tester.pump();
      await finger.up();
      await tester.pump(const Duration(milliseconds: 300));
      expect(written(ticket), contains('status: In review'));
    });

    testWidgets('in words drawn read only, with nothing said, moves nothing', (tester) async {
      await open(tester, fence('from: tickets\nshow: board'), editable: false);
      final card = boxOf(tester, parts('card'));
      final finger = await holdAt(tester, card.topLeft + const Offset(30, 12));
      expect(find.descendant(of: find.byType(Overlay).first, matching: find.text('Fix the login loop')), findsOneWidget, reason: 'nothing lifted');
      await finger.up();
      await tester.pump(const Duration(milliseconds: 300));
      expect(asked.written, isEmpty);
    });

    for (final show in const <String>['list', 'table']) {
      testWidgets('moves a ticket to the group its row is dragged to in a grouped $show, by the same drag', (tester) async {
        // A second ticket, so there is another group to carry it to.
        library = <QueryNote>[...library, const QueryNote(id: 'gho2', body: '---\ntype: ticket\nid: GHO-2\nstatus: Done\n---\n# Ship the fix\n', createdAt: 0, updatedAt: 0)];
        await open(tester, fence('from: tickets\ngroup: status\nshow: $show'));
        final row = boxOf(tester, said('Fix the login loop'));
        // The other group, by its heading.
        final heads = parts('groupHead');
        expect(heads, findsNWidgets(2));
        final target = boxOf(tester, heads.at(1));
        final finger = await holdAt(tester, row.centerLeft + const Offset(4, 0));
        await finger.moveTo(Offset(target.left + 40, target.center.dy));
        await tester.pump();
        await finger.up();
        await tester.pump(const Duration(milliseconds: 300));
        expect(written(ticket), contains('status: Done'));
      });
    }

    testWidgets('ticks a to-do in this note in the note itself, and puts the caret on one it opens', (tester) async {
      final view = await open(tester, '${fence('from: tasks')}\n- [ ] Call the plumber\n');
      await tester.tap(said('Tick Call the plumber'));
      await tester.pump();
      expect(view.state.doc.toString(), contains('- [x] Call the plumber'));
      expect(asked.written, isEmpty);
      // Ticked, it has left the list of open to-dos; Milk opens in its own note.
      expect(wordsOf(tester, drawn), isNot(contains('Call the plumber')));
      final other = await open(tester, '${fence('from: tasks')}\n- [ ] Post the letter\n');
      await tester.tap(said('Post the letter'));
      await tester.pump();
      expect(other.state.doc.lineAt(other.state.selection.main.head).text, '- [ ] Post the letter');
    });

    testWidgets('picks a ticket’s status from its cell, and writes it in its own note through the screen', (tester) async {
      await open(tester, fence('from: tickets'));
      await show(tester, said(RegExp('^Status: In progress')));
      await tester.tap(said(RegExp('^Status: In progress')));
      await settle(tester);
      expect(tester.widget<Sheet>(find.byType(Sheet)).label, 'Status');
      await tester.tap(sheetRow('Done'));
      await settle(tester);
      // `move('gho1', -1, '', 'ticket', 'status', 'Done')`
      expect(written(ticket), contains('status: Done'));
      expect(find.byType(Sheet), findsNothing);
    });

    testWidgets('picks a to-do’s priority and person in this note, on its own line', (tester) async {
      final view = await open(tester, '${fence('from: tasks\nshow: table')}\n- [ ] Call the plumber\n');
      Finder inRow(Pattern label) {
        // The row of this note's to-do: the one whose cells are level with its name.
        final name = boxOf(tester, said('Call the plumber'));
        return find.byElementPredicate((element) {
          if (!said(label).evaluate().contains(element)) return false;
          final box = element.renderObject;
          return box is RenderBox && (box.localToGlobal(Offset.zero).dy - name.top).abs() < 12;
        });
      }

      await show(tester, inRow(RegExp('^Priority: none')));
      await tester.tap(inRow(RegExp('^Priority: none')));
      await settle(tester);
      await tester.tap(sheetRow('High'));
      await settle(tester);
      expect(view.state.doc.toString(), contains('- [ ] Call the plumber ⏫'));
      await show(tester, inRow(RegExp('^Assignee: none')));
      await tester.tap(inRow(RegExp('^Assignee: none')));
      await settle(tester);
      // The people the library names are offered: Milk's @sam.
      await tester.tap(sheetRow('sam'));
      await settle(tester);
      expect(view.state.doc.toString(), contains('- [ ] Call the plumber @sam ⏫'));
      expect(asked.written, isEmpty);
    });

    testWidgets('picks a card’s priority on a board, without carrying the card', (tester) async {
      await open(tester, fence('from: tickets\nshow: board'));
      final priority = said(RegExp('^Priority: high'));
      await show(tester, priority);
      // A press on the value, held past the hold, lifts nothing.
      final finger = await holdAt(tester, boxOf(tester, priority).center);
      expect(find.byType(DragGap), findsNothing);
      await finger.up();
      await settle(tester);
      if (find.byType(Sheet).evaluate().isEmpty) {
        await tester.tap(priority);
        await settle(tester);
      }
      await tester.tap(sheetRow('Highest'));
      await settle(tester);
      // `move('gho1', -1, '', 'ticket', 'priority', 'highest')`
      expect(written(ticket), contains('priority: highest'));
    });

    testWidgets('picks nothing where the note cannot be edited', (tester) async {
      await open(tester, fence('from: tickets'), editable: false);
      expect(said(RegExp('Change it')), findsNothing);
      // The status is still drawn, in its colour, as words.
      expect(wordsOf(tester, drawn), contains('In progress'));
    });
  });

  group('a new ticket typed at a lane of a board', () {
    Finder plusOf(String label) => said('Add a ticket to $label');

    testWidgets('is made through the screen with the lane’s status and what the query insists on, and the field stays for the next', (tester) async {
      await open(tester, fence('from: tickets [[Launch]] #bug\nwhere: priority = high and (due < today or assignee = sam)\nshow: board'), adds: false);
      await show(tester, plusOf('In review'));
      await tester.tap(plusOf('In review'));
      await tester.pump();
      expect(said('New ticket in In review'), findsOneWidget);
      await tester.enterText(find.byType(EditableText), 'Ship the changelog');
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pump(const Duration(milliseconds: 200));
      final (draft, title, from) = asked.added.single;
      expect(draft.toJson(), <String, Object?>{
        'link': 'Launch',
        'fields': <List<String>>[
          <String>['priority', 'high'],
          <String>['status', 'In review'],
        ],
        'labels': <String>['bug'],
      });
      expect(title, 'Ship the changelog');
      expect(from, 'here');
      // Open and empty for the next one.
      expect(tester.state<LaneComposerState>(find.byType(LaneComposer)).controller.text, '');
    });

    testWidgets('puts the ticket’s page in this note’s index where this note is its notebook', (tester) async {
      final view = await open(tester, '---\nbook: true\nkey: GHO\n---\n# Launch\n\n- [[Plan]]\n\n```query\nfrom: tickets [[Launch]]\nshow: board\n```\n', adds: true);
      await show(tester, plusOf('To do'));
      await tester.tap(plusOf('To do'));
      await tester.pump();
      await tester.enterText(find.byType(EditableText), 'Write the notes');
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pump(const Duration(milliseconds: 200));
      await tester.pump();
      expect(view.state.doc.toString(), contains('[[Write the notes]]'));
    });

    testWidgets('has no + on a board of to-dos, where the note cannot be edited, or with no way to make one', (tester) async {
      await open(tester, fence('from: tasks\nshow: board\ngroup: priority'), adds: false);
      expect(said(RegExp('^Add a ticket')), findsNothing);
      await open(tester, fence('from: tickets\nshow: board'), editable: false, adds: false);
      expect(said(RegExp('^Add a ticket')), findsNothing);
      await open(tester, fence('from: tickets\nshow: board'));
      expect(said(RegExp('^Add a ticket')), findsNothing);
    });

    testWidgets('closes on Escape without making anything', (tester) async {
      await open(tester, fence('from: tickets\nshow: board'), adds: false);
      await tester.tap(plusOf('Backlog'));
      await tester.pump();
      await tester.enterText(find.byType(EditableText), 'Never mind');
      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pump();
      expect(said('New ticket in Backlog'), findsNothing);
      expect(asked.added, isEmpty);
    });
  });

  // Not on the page: what the options' one `write` is handed, held to what `tick` and `move` wrote there.
  group('what is written to another note', () {
    test('is the change the page’s screen made: a line ticked, a field set, and nothing for a line that is gone', () {
      expect(tickedBody(shop.body, 2, '- [ ] Milk 📅 $yesterday @sam', true), contains('- [x] Milk'));
      expect(tickedBody(shop.body, 2, '- [ ] Gone', true), isNull);
      expect(movedBody(ticket.body, -1, '', RecordKind.ticket, 'status', 'Done'), contains('status: Done'));
      expect(holdTime, const Duration(milliseconds: 220));
    });
  });
}
