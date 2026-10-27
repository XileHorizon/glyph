// Margin: a line's leading mark hangs in a column left of the words, so a heading's, a list item's, a quote's and a
// paragraph's words start at one edge; the mark is still the note's text, and Markdown and Formatted are as before.
import 'package:flutter/rendering.dart' show debugDisableShadows;
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ghost_md/app/preferences.dart';
import 'package:ghost_md/editor/editor.dart' hide Decoration;
import 'package:ghost_md/editor/view/base.dart';
import 'package:ghost_md/editor/view/column.dart';
import 'package:ghost_md/editor/view/editor_view.dart';
import 'package:ghost_md/editor/view/margin_marks.dart';
import 'package:ghost_md/editor/view/view_mode.dart';
import 'package:glacier/glacier.dart';

import '../../support/render.dart';

const String _note = '# One\n\nSome words here\n\n- An item\n\n> A quote\n\n###### Six\n\n```\n# not a heading\n```';

Future<EditorView> _show(WidgetTester tester, NoteView display, {Compartment? compartment}) async {
  final view = EditorView(
    wholeDocument: true,
    state: EditorState.create(doc: _note, extensions: noteExtensions(more: [(compartment ?? Compartment()).of(noteView(display))])),
  );
  addTearDown(view.destroy);
  await pumpApp(
    tester,
    prefs: const AppPreferences(theme: 'light'),
    ratio: 2,
    home: Builder(
      builder: (context) => ColoredBox(
        color: context.tokens.color('glacier-bg'),
        child: Align(alignment: Alignment.topLeft, child: SizedBox(width: 390, child: SingleChildScrollView(child: EditorColumn(view: view)))),
      ),
    ),
  );
  tester.view.padding = FakeViewPadding.zero;
  tester.view.viewPadding = FakeViewPadding.zero;
  await tester.pump();
  return view;
}

/// Where the words of the line holding [words] start.
double _wordsX(EditorView view, String words) => view.coordsAtPos(view.state.doc.toString().indexOf(words))!.left;

void main() {
  setUpAll(loadAppFonts);

  testWidgets('in Margin every line’s words start at one edge, the marks hung left of it', (tester) async {
    final view = await _show(tester, NoteView.margin);
    expect(view.state.facet(marginView), isTrue);
    final edge = _wordsX(view, 'Some words');
    for (final words in ['One', 'An item', 'Six']) {
      expect(_wordsX(view, words), moreOrLessEquals(edge, epsilon: 0.5), reason: words);
    }
    // Each mark sits left of the edge, in the column.
    for (final at in [0, _note.indexOf('- An'), _note.indexOf('###### ')]) {
      expect(view.coordsAtPos(at)!.left, lessThan(edge - 4), reason: 'mark at $at');
    }
    // A `#` in a block of code is code, not a mark: it stays in its card's line.
    expect(view.coordsAtPos(_note.indexOf('# not'))!.left, greaterThan(edge - 1));
    // The quote's words are after its bar, past the edge, as in the other views.
    expect(_wordsX(view, 'A quote'), greaterThan(edge));
    // pumpApp draws shadows; the binding checks every painting switch is back as it was when the test ends.
    debugDisableShadows = true;
  });

  testWidgets('a hung mark is still text: typed into, it is the note’s', (tester) async {
    final view = await _show(tester, NoteView.margin);
    final edge = _wordsX(view, 'Some words');
    view.dispatch(TransactionSpec(changes: const ChangeSpec(from: 0, insert: '#')));
    await tester.pump();
    expect(view.state.doc.toString(), startsWith('## One'));
    expect(_wordsX(view, 'One'), moreOrLessEquals(edge, epsilon: 0.5));
    // Taken away, the line is a paragraph, and its words are at the same edge as any other.
    view.dispatch(TransactionSpec(changes: const ChangeSpec(from: 0, to: 3)));
    await tester.pump();
    expect(view.state.doc.toString(), startsWith('One'));
    expect(_wordsX(view, 'One'), moreOrLessEquals(edge, epsilon: 0.5));
    // pumpApp draws shadows; the binding checks every painting switch is back as it was when the test ends.
    debugDisableShadows = true;
  });

  testWidgets('Markdown is as it was: a heading’s words after its marks, and no column', (tester) async {
    final display = Compartment();
    final view = await _show(tester, NoteView.mixed, compartment: display);
    final plain = _wordsX(view, 'Some words');
    expect(_wordsX(view, 'One'), greaterThan(plain + 4));
    expect(view.state.facet(marginView), isFalse);
    // Swapped to Margin in place, the column opens and the heading's words come to the paragraph's edge.
    view.dispatch(TransactionSpec(effects: display.reconfigure(noteView(NoteView.margin))));
    await tester.pump();
    final edge = _wordsX(view, 'Some words');
    expect(edge, greaterThan(plain));
    expect(_wordsX(view, 'One'), moreOrLessEquals(edge, epsilon: 0.5));
    debugDisableShadows = true;
  });

  test('shownView: Margin is Markdown with the setting on; Formatted wins over it', () {
    expect(shownView('mixed', marksInMargin: true), NoteView.margin);
    expect(shownView('mixed', marksInMargin: false), NoteView.mixed);
    expect(shownView('formatted', marksInMargin: true), NoteView.formatted);
    expect(shownView('nonsense', marksInMargin: false), NoteView.mixed);
  });
}
