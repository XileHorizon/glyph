/// MARGIN: the Markdown view with a line's leading mark hung in a column of its own, left of the words (Kevin,
/// 2026-10-27: "markdown symbols are essentially instructions ... they could also be used as markers along the edge,
/// while still remaining editable like normal text"). Ports the Tauri app's `noteView('margin')` (viewMode.ts).
///
/// A heading's `#`s, a list's `-` or `1.` and a quote's `>`, with the space after them, are drawn in a column the
/// width of [marginColumn] at the left of every line, so every line's words start at one edge whatever its mark. The
/// mark is still the note's own text, where it was: the caret walks into it, a backspace takes it, a typed `#`
/// becomes one.
///
/// What differs from the page: the page drew the mark as an inline-block pulled back by the column's width. Here the
/// line's own hang does it, the one a list item's marker already has (line.dart: the marker and the words as two
/// paragraphs, the marker [LookElement] `--hang` left of the words), so the caret, a tap and a wrapped line are the
/// list's and already right:
/// - [glyphLines] gives a line with a leading mark the class [marginLineClass] and its `--hang`, `--hang-indent` and
///   `data-hang-chars` (`leadingMark` here says what the mark is);
/// - the editor carries `data-marks="margin"`, which the stylesheet reads to move every line in by the column
///   (`.cm-content { padding-inline-start }` on the page; markdown_look.dart);
/// - the mark itself is [marginMarkClass], set at the note's own size and weight whatever its line is set in, so a
///   heading's `#` reads as a sign in the column and not as a giant letter.
///
/// A mark too long for the column (`#####`, `######`) ends where the others' words start and reaches back into the
/// page's edge instead, so its words keep the same edge too.
library;

import '../../core/item_syntax.dart';
import '../state/rangeset.dart';
import '../state/state.dart';
import 'decoration.dart';
import 'plugin.dart';
import 'syntax_tree.dart';

/// Whether the note is shown in Margin, for what draws the lines (glyph_lines.dart).
final Facet<bool, bool> marginView = Facet.define<bool, bool>(combine: (values) => values.any((value) => value));

/// The editor attribute the stylesheet reads (markdown_look.dart `_marks`).
const String marginAttribute = 'data-marks';

/// The line class of a line whose leading mark hangs in the column.
const String marginLineClass = 'lineMarginMark';

/// The class of the mark itself, in the column.
const String marginMarkClass = 'marginMark';

/// The column's width for a note set at [body]: three times the note's size, as the page's `--margin-marks`.
double marginColumn(double body) => body * 3;

/// A line's leading mark: its indent, the mark (`#` to `######`, a bullet or a number, a quote's `>`) and the one
/// space after it. Only the first thing on the line: a list inside a quote hangs the quote's `>`.
final RegExp _leading = RegExp('^([ \\t]*)(#{1,6}(?=[ \\t]|\$)|$markerPattern(?=[ \\t]|\$)|>)([ \\t]?)((?:$boxPattern)[ \\t]?)?');

/// What a line's leading mark is: `indent` (spaces before it), `mark` (the mark and the space after it). Null for a
/// line that has none. [heading], [item] and [quote] say which blocks the line is in, so a `-` in a paragraph, or a
/// `#` the parser did not take as a heading, is left where it is.
({String indent, String mark, String box})? leadingMark(String text, {required bool heading, required bool item, required bool quote}) {
  final found = _leading.firstMatch(text);
  if (found == null) return null;
  final sign = found.group(2)!;
  final kind = sign.startsWith('#') ? heading : (sign == '>' ? quote : item);
  if (!kind) return null;
  // A to-do's box hangs with its bullet, so the words, and the lines they wrap onto, start at the edge.
  return (indent: found.group(1)!, mark: '$sign${found.group(3)!}', box: kind && sign != '>' && !sign.startsWith('#') ? found.group(4) ?? '' : '');
}

/// The marks on the visible lines, each as [marginMarkClass]: the size and ink of the column's signs. Read from the
/// syntax tree, as the page's were: a `#` in a block of code, or a `-` the parser did not make a list, is left alone.
DecorationSet _marks(EditorViewLike view) {
  final builder = RangeSetBuilder<Decoration>();
  final state = view.state;
  final doc = state.doc;
  final mark = Decoration.mark(className: marginMarkClass);
  var last = -1;
  for (final range in view.visibleRanges) {
    syntaxTree(state).iterate(
      from: range.from,
      to: range.to,
      enter: (node) {
        final name = node.name;
        final parent = node.parent?.name ?? '';
        final heading = name == 'HeaderMark' && parent.startsWith('ATXHeading');
        final item = name == 'ListMark' && parent == 'ListItem';
        final quote = name == 'QuoteMark';
        if (!heading && !item && !quote) return null;
        final line = doc.lineAt(node.from);
        // Only the first thing on its line: a list inside a quote hangs the quote's `>`, not its own `-`.
        if (node.from < last || doc.sliceString(line.from, node.from).trim().isNotEmpty) return null;
        var end = node.to;
        if (end < line.to && (doc.sliceString(end, end + 1) == ' ' || doc.sliceString(end, end + 1) == '\t')) end += 1;
        builder.add(node.from, end, mark);
        last = end;
        return null;
      },
    );
  }
  return builder.finish();
}

class _Marks extends PluginValue {
  _Marks(EditorViewLike view) : decorations = _marks(view);

  DecorationSet decorations;

  @override
  void update(ViewUpdate update) {
    if (update.docChanged || update.viewportChanged || !identical(syntaxTree(update.startState), syntaxTree(update.state))) decorations = _marks(update.view);
  }
}

final ViewPlugin<_Marks> _hungMarks = ViewPlugin.define<_Marks>(_Marks.new, decorations: (plugin) => plugin.decorations);

/// The extension for Margin: the facet glyph_lines reads, the editor's attribute the stylesheet reads, and the marks'
/// own class.
Extension marginMarks() => Extension.list(<Extension>[
  marginView.of(true),
  EditorViewLike.editorAttributes.of(const <String, String>{marginAttribute: 'margin'}),
  _hungMarks,
]);
