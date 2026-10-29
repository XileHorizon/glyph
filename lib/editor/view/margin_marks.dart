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

import 'package:flutter/widgets.dart' hide Decoration;
import 'package:glacier/glacier.dart';

import '../../core/item_syntax.dart';
import '../looks/look.dart' show layoutUnitCeil;
import '../state/rangeset.dart';
import '../state/state.dart';
import 'decoration.dart';
import 'editor_view.dart';
import 'line.dart' show EditorRunScope;
import 'plugin.dart';
import 'widget.dart';
import 'syntax_tree.dart';

/// Whether the note is shown in Margin, for what draws the lines (glyph_lines.dart).
final Facet<bool, bool> marginView = Facet.define<bool, bool>(combine: (values) => values.any((value) => value));

/// The editor attribute the stylesheet reads (markdown_look.dart `_marks`).
const String marginAttribute = 'data-marks';

/// The line class of a line whose leading mark hangs in the column.
const String marginLineClass = 'lineMarginMark';

/// The class of the mark itself, in the column.
const String marginMarkClass = 'marginMark';

/// The class of a hung mark's indent, which takes no room in the column: every mark starts on one rail.
const String marginIndentClass = 'marginIndent';

/// How large the column's marks are, of the note's size: a little under it, so `######` and `- [x]` fit the rail.
const double marginMarkScale = 0.8;

/// Margin's line height, tighter than the other views' 1.6.
const double marginLineHeight = 1.4;

/// The column's width for a note set at [body]: room for the widest mark, `###### `, at [marginMarkScale] in the
/// note's face. Fixed: every mark starts at its left edge, a rail down the side of the note (Kevin, 2026-10-28: "like
/// a timeline or place marker along that side edge").
double marginColumn(double body) => body * 3.4;

/// A line's leading mark: its indent, the mark (`#` to `######`, a bullet or a number, a quote's `>`) and the one
/// space after it. Only the first thing on the line: a list inside a quote hangs the quote's `>`.
final RegExp _leading = RegExp('^([ \\t]*)(#{1,6}(?=[ \\t]|\$)|$markerPattern(?=[ \\t]|\$)|>)([ \\t]?)');

/// A to-do's box, where the words would start.
final RegExp _box = RegExp('^(?:$boxPattern)');

/// A bullet list's own sign, not a number.
final RegExp _bulletSign = RegExp('^$bulletPattern\$');

/// The bullets drawn before a bullet item's words, one for each depth and round again: filled, open, square.
const List<String> _bullets = <String>['•', '◦', '▪'];

/// What a line's leading mark is: `indent` (spaces before it), `mark` (the mark and the space after it), and for an
/// item of a bullet list that is not a to-do, the `bullet` drawn before its words (Kevin, 2026-10-29: "add nice
/// bullets in line for lists, maybe not for checklists"); a to-do's box stays with its words, at the body's edge.
/// Null for a line that has none. [heading], [item] and [quote] say which blocks the line is in, so a `-` in a
/// paragraph, or a `#` the parser did not take as a heading, is left where it is.
({String indent, String mark, String? bullet})? leadingMark(String text, {required bool heading, required bool item, required bool quote}) {
  final found = _leading.firstMatch(text);
  if (found == null) return null;
  final sign = found.group(2)!;
  final kind = sign.startsWith('#') ? heading : (sign == '>' ? quote : item);
  if (!kind) return null;
  final indent = found.group(1)!;
  String? bullet;
  if (item && _bulletSign.hasMatch(sign) && !_box.hasMatch(text.substring(found.end))) {
    final columns = indent.replaceAll('\t', '    ').length;
    bullet = _bullets[(columns ~/ 2) % _bullets.length];
  }
  return (indent: indent, mark: '$sign${found.group(3)!}', bullet: bullet);
}

/// How a line with a leading mark hangs (line.dart's marker and words): `hang` back from the words to the rail,
/// `words` the room before the words past the edge (the indent, and a drawn bullet), and for a bullet item `lead`,
/// the room between the mark on the rail and the bullet, and `bullet` the bullet's own width.
typedef MarginGeometry = ({double hang, double words, double lead, double bullet});

/// The geometry of [found] in [view]'s look: the mark at the rail whatever its depth (its indent takes no room in
/// the column, `marginIndent`), the column fixed, a mark wider than it reaching back further, a quote's `>` hung back
/// over its bar too, and a bullet set just before the words. Null before the view has a look.
MarginGeometry? marginGeometry(EditorViewLike view, ({String indent, String mark, String? bullet}) found) {
  if (view is! EditorView) return null;
  final look = view.look;
  if (look == null) return null;
  final env = look.env;
  final indent = found.indent.isEmpty ? 0.0 : layoutUnitCeil(view.measureText(<(String, String?)>[(found.indent, null)]));
  final mark = layoutUnitCeil(view.measureText(<(String, String?)>[(found.mark, marginMarkClass)]));
  final column = marginColumn(env.body);
  final wide = mark > column ? mark : column;
  // A quote's words start past its bar and the room after it (markdown_look.dart `.lineQuote`).
  final quoted = found.mark.startsWith('>') ? env.t.len('glacier-shape-accent-edge') + env.body * 0.75 : 0.0;
  final bullet = found.bullet == null ? 0.0 : layoutUnitCeil(view.measureText(<(String, String?)>[('${found.bullet} ', null)]));
  return (hang: indent + wide + bullet + quoted, words: indent + bullet, lead: found.bullet == null ? 0.0 : wide - mark + indent, bullet: bullet);
}

/// The bullet before a bullet item's words: the room from the mark to it, then the bullet in the line's own face,
/// in the marks' ink. Drawn, not written: the note's text is still `- `, on the rail.
class MarginBullet extends EditorWidget {
  const MarginBullet({required this.glyph, required this.lead, required this.width});

  final String glyph;
  final double lead;
  final double width;

  @override
  bool eq(MarginBullet other) => other.glyph == glyph && other.lead == lead && other.width == width;

  @override
  bool get isHidden => true;

  @override
  bool takesPointer(_) => false;

  @override
  Widget build(BuildContext context) {
    final base = EditorRunScope.maybeOf(context)?.line.base.style ?? DefaultTextStyle.of(context).style;
    return SizedBox(
      width: lead + width,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.baseline,
        textBaseline: TextBaseline.alphabetic,
        children: [SizedBox(width: lead), Text(glyph, style: base.copyWith(color: context.tokens.color('glacier-text-subtle')))],
      ),
    );
  }
}

/// The marks on the visible lines, each as [marginMarkClass]: the size and ink of the column's signs; and before a
/// bullet item's words its [MarginBullet]. Read from the syntax tree, as the page's were: a `#` in a block of code,
/// or a `-` the parser did not make a list, is left alone.
DecorationSet _marks(EditorViewLike view) {
  final builder = RangeSetBuilder<Decoration>();
  final state = view.state;
  final doc = state.doc;
  final mark = Decoration.mark(className: marginMarkClass);
  final indent = Decoration.mark(className: marginIndentClass);
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
        if (node.from > line.from) builder.add(line.from, node.from, indent);
        builder.add(node.from, end, mark);
        if (item) {
          final found = leadingMark(line.text, heading: false, item: true, quote: false);
          final bullet = found?.bullet;
          final geometry = found == null || bullet == null ? null : marginGeometry(view, found);
          // Before the split, so it is drawn with the mark (line.dart's marker) and the words' wrapped lines hang
          // under the words, not under the bullet.
          if (geometry != null) builder.add(end, end, Decoration.widget(widget: MarginBullet(glyph: bullet!, lead: geometry.lead, width: geometry.bullet), side: -1));
        }
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
    if (update.docChanged || update.viewportChanged || update.geometryChanged || !identical(syntaxTree(update.startState), syntaxTree(update.state))) decorations = _marks(update.view);
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
