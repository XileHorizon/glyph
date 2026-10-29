/// The block half of the renderer: the things an inline run cannot reach. Ports `src/app/editor/glyphLines.ts`.
///
/// The highlighter can colour and resize a run of text, but it cannot put space above a heading, draw the bar down
/// the side of a quote, hang a list's text off its marker, or paint a ground behind a fenced block: those are
/// properties of the LINE. Hence one small plugin that gives each line the classes of the blocks it is in
/// (`looks/markdown_look.dart` says what they mean), and for a list item the measured width of its marker, so
/// wrapped lines hang under the first letter of the words.
///
/// What differs:
/// - The marker is measured with the view's own text measure ([EditorView.measureText]) where the web appends a
///   ruler element to the scroller; the same runs (the marker, with a to-do's box in the `taskMarker` class), and
///   the width taken as the page takes it: up to a sixty-fourth of a pixel, then to two decimals.
/// - Beside `style: --hang: <n>px` the line decoration carries `data-hang-chars`, how many characters the marker
///   is. The page's `text-indent` needs no such thing; the line's render object draws the marker and the words as
///   two paragraphs and has to know where one ends (`line.dart`).
/// - `document.fonts`' `loadingdone` is `PaintingBinding.systemFonts`.
library;

import 'package:flutter/painting.dart' show PaintingBinding;

import '../../core/item_syntax.dart';
import '../looks/look.dart' show layoutUnitCeil;
import '../looks/markdown_look.dart';
import '../state/rangeset.dart';
import '../state/text.dart';
import '../state/state.dart';
import 'decoration.dart';
import 'editor_view.dart';
import 'margin_marks.dart';
import 'plugin.dart';
import 'syntax_tree.dart';

/// Which line class a syntax node contributes to every line it covers.
const Map<String, String> _lineClass = <String, String>{
  'ATXHeading1': MarkdownClass.lineH1,
  'ATXHeading2': MarkdownClass.lineH2,
  'ATXHeading3': MarkdownClass.lineH3,
  'ATXHeading4': MarkdownClass.lineH4,
  'ATXHeading5': MarkdownClass.lineH4,
  'ATXHeading6': MarkdownClass.lineH4,
  'Blockquote': MarkdownClass.lineQuote,
  'ListItem': MarkdownClass.lineItem,
  'FencedCode': MarkdownClass.lineCode,
  'CodeBlock': MarkdownClass.lineCode,
  'HorizontalRule': MarkdownClass.lineHr,
};

/// A list line's marker as far as its words: the indent, `-` or `10.`, a task's box, and the spaces after them.
final RegExp _hanging = RegExp('^(\\s*$markerPattern[ \\t]+(?:$boxPattern[ \\t]+)?)\\S');

/// A to-do's box inside a marker.
final RegExp _boxIn = RegExp(boxPattern);

/// How wide a marker is, measured in the editor's own face. Kept for each face and size, so a note costs one
/// measure for each kind of marker: by the marker as written first, and by the marker with its box unticked where
/// that is new, so a ticked box and an unticked one are one measure.
final Map<String, Map<String, double>> _widths = <String, Map<String, double>>{};
final Map<String, Map<String, double>> _measures = <String, Map<String, double>>{};

/// A look's face and sizes as one string, said once for each look: it is long, and was said again for every list
/// item on screen on every letter.
final Expando<String> _faceOf = Expando<String>('look face');

double _markerWidth(EditorViewLike view, String marker) {
  if (view is! EditorView) return 0;
  final look = view.look;
  if (look == null) return 0;
  final face = _faceOf[look] ??= look.env.key;
  final widths = _widths[face] ??= <String, double>{};
  final known = widths[marker];
  if (known != null) return known;
  // Ticked or not, a box is the same width: one measure for both.
  final measures = _measures[face] ??= <String, double>{};
  final key = marker.replaceFirst(_boxIn, '[ ]');
  final had = measures[key];
  if (had != null) return widths[marker] = had;
  // A to-do's box is set in the monospace face (`.taskMarker`), so `[ ]` and `[x]` are one width.
  final box = _boxIn.firstMatch(marker);
  final width = box == null
      ? view.measureText(<(String, String?)>[(marker, null)])
      : view.measureText(<(String, String?)>[(marker.substring(0, box.start), null), (box.group(0)!, MarkdownClass.taskMarker), (marker.substring(box.end), null)]);
  return widths[marker] = measures[key] = layoutUnitCeil(width);
}

/// A list line's marker as far as its words, kept for every line of a document (`LineFact`): every list item on
/// screen was put to the pattern on every letter. A marker is a bullet or a number.
final LineFact<String> _markers = LineFact<String>((text) => _hanging.firstMatch(text)?.group(1));

/// Margin's hang for a line with a leading mark (margin_marks.dart): the words start the column's width in from the
/// line's edge (after its indent), and the mark hangs back by that width, or by its own where it is wider, so a
/// `#####` reaches into the page's edge instead of pushing its words over. `--hang-indent` is the indent's width,
/// which the words keep. Null for a line with no leading mark.
Map<String, String>? _marginHang(EditorViewLike view, String text, List<String> classes) {
  final heading = classes.any((c) => c == MarkdownClass.lineH1 || c == MarkdownClass.lineH2 || c == MarkdownClass.lineH3 || c == MarkdownClass.lineH4);
  final found = leadingMark(text, heading: heading, item: classes.contains(MarkdownClass.lineItem), quote: classes.contains(MarkdownClass.lineQuote));
  if (found == null) return null;
  final geometry = marginGeometry(view, found);
  if (geometry == null) return null;
  return <String, String>{
    'style': '--hang: ${geometry.hang.toStringAsFixed(2)}px; --hang-indent: ${geometry.words.toStringAsFixed(2)}px',
    'data-hang-chars': '${found.indent.length + found.mark.length}',
  };
}

DecorationSet _buildLines(EditorViewLike view) {
  final doc = view.state.doc;
  // One line can be covered by more than one node (a heading inside a quote is both), so classes gather for each
  // line before any decoration is made. Keyed by line start, which is also where the decoration must sit.
  final perLine = <int, List<String>>{};
  final tree = syntaxTree(view.state);
  for (final range in view.visibleRanges) {
    tree.iterate(
      from: range.from,
      to: range.to,
      enter: (node) {
        final cls = _lineClass[node.name];
        // Every node with a line's class is a block, and no block is inside a block that holds only words (a
        // paragraph, a heading, a table): the words of each were walked letter by letter for nothing, on every
        // letter typed.
        if (cls == null) return node.type.groups.contains('LeafBlock') ? false : null;
        final first = doc.lineAt(node.from).number;
        // `node.to` sits just past the block, which on a block ending in a newline is the first character of the
        // next line; stepping back one keeps the decoration off a line the node does not really cover.
        final last = doc.lineAt(node.to - 1 > node.from ? node.to - 1 : node.from).number;
        for (var n = first; n <= last; n += 1) {
          final at = doc.line(n).from;
          final classes = <String>[cls];
          // A block of code is one card: its first and last lines carry the corners.
          if (cls == MarkdownClass.lineCode) {
            if (n == first) classes.add(MarkdownClass.lineCodeTop);
            if (n == last) classes.add(MarkdownClass.lineCodeFoot);
          }
          // A quote's first and last lines hold the space between it and the lines around it.
          if (cls == MarkdownClass.lineQuote) {
            if (n == first) classes.add(MarkdownClass.lineQuoteTop);
            if (n == last) classes.add(MarkdownClass.lineQuoteFoot);
          }
          (perLine[at] ??= <String>[]).addAll(classes);
        }
        return node.type.groups.contains('LeafBlock') ? false : null;
      },
    );
  }

  // `RangeSetBuilder.add` must be called in ascending order, and a line decoration's range must be empty and sit
  // at the line's start.
  final builder = RangeSetBuilder<Decoration>();
  final margin = view.state.facet(marginView);
  for (final at in perLine.keys.toList()..sort()) {
    final classes = perLine[at]!;
    if (margin) {
      final hung = _marginHang(view, doc.lineAt(at).text, classes);
      if (hung != null) {
        builder.add(at, at, Decoration.line(className: <String>[...classes, marginLineClass].join(' '), attributes: hung));
        continue;
      }
    }
    final marker = classes.contains(MarkdownClass.lineItem) ? _markers.at(doc, doc.lineAt(at).number) : null;
    final attributes = marker == null ? null : <String, String>{'style': '--hang: ${_markerWidth(view, marker).toStringAsFixed(2)}px', 'data-hang-chars': '${marker.length}'};
    builder.add(at, at, Decoration.line(className: classes.join(' '), attributes: attributes));
  }
  return builder.finish();
}

class _GlyphLines extends PluginValue {
  _GlyphLines(this.view) {
    decorations = _buildLines(view);
    PaintingBinding.instance.systemFonts.addListener(_onFonts);
  }

  final EditorViewLike view;
  late DecorationSet decorations;

  /// Set when a face finished loading, so markers measured in the fallback face are measured again.
  bool _remeasure = false;

  void _onFonts() {
    _widths.clear();
    _measures.clear();
    _remeasure = true;
    view.dispatch(const TransactionSpec());
  }

  @override
  void destroy() => PaintingBinding.instance.systemFonts.removeListener(_onFonts);

  @override
  void update(ViewUpdate update) {
    // While an IME is composing, MAP the decorations through the changes instead of rebuilding them: a composition
    // never changes which block a line is, so the mapped set is correct as well as safe.
    if (update.view.composing) {
      if (update.docChanged) decorations = decorations.map(update.changes);
      return;
    }
    if (_remeasure ||
        update.docChanged ||
        update.viewportChanged ||
        // The text size setting: the markers are a different width now.
        update.geometryChanged ||
        // Margin chosen or left: every hung line hangs differently.
        update.startState.facet(marginView) != update.state.facet(marginView) ||
        !identical(syntaxTree(update.startState), syntaxTree(update.state))) {
      _remeasure = false;
      decorations = _buildLines(update.view);
    }
  }
}

/// The plugin: `glyphLines` in the web's Editor.tsx.
final ViewPlugin<PluginValue> glyphLines = ViewPlugin.define<PluginValue>((view) => _GlyphLines(view), decorations: (value) => (value as _GlyphLines).decorations);
