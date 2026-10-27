/// How a note is shown: the mixed page, marks and formatting both, or just the formatted text. Ports
/// `src/app/editor/viewMode.ts`.
///
/// - **Markdown** (`mixed`, the default): the text formatted, with its marks still on the page, dimmed.
/// - **Formatted**: just the formatted text. The marks that only say how words look (`**`, `_`, `~~`, backticks,
///   `#`, `>`, a plugin's delimiters) are hidden. While the note is being written, the line with the caret shows
///   its marks so they can be edited; a list's dash and a to-do's box always stay, since they are part of how a
///   list looks.
///
/// What differs: nothing in what is hidden or when. The hidden ranges are `Decoration.replace()` with no widget,
/// which the line's projection leaves out of what it shows, and they are the plugin's atomic ranges, which the
/// input layer steps the caret over.
library;

import '../state/rangeset.dart';
import '../state/state.dart';
import 'decoration.dart';
import 'lines.dart';
import 'margin_marks.dart';
import 'plugin.dart';
import 'syntax_tree.dart';

/// `NoteView`: `mixed` or `formatted`, or `margin`, Markdown with a line's leading mark in a column of its own
/// (margin_marks.dart). Margin is never stored as the view: it is `mixed` with `Preferences.marksInMargin` on
/// ([shownView]), so a device on an older build reading the synced preferences still sees one of the two it knows.
enum NoteView { mixed, formatted, margin }

/// The syntax nodes a styled note hides: marks that only style the words beside them.
const Set<String> _hidden = <String>{'EmphasisMark', 'StrikethroughMark', 'HeaderMark', 'QuoteMark'};

final Decoration _hide = Decoration.replace();

DecorationSet _hiddenMarks(EditorViewLike view) {
  final builder = RangeSetBuilder<Decoration>();
  final state = view.state;
  // While the note is being written, the lines the caret or a selection touches keep their marks.
  final active = view.hasFocus ? selectedLines(state) : const <int>{};
  final tree = syntaxTree(state);
  for (final range in view.visibleRanges) {
    tree.iterate(
      from: range.from,
      to: range.to,
      enter: (node) {
        final name = node.name;
        final inlineCode = name == 'CodeMark' && node.parent?.name == 'InlineCode';
        final pluginMark = name.endsWith('Mark') && !_hidden.contains(name) && name != 'CodeMark' && name != 'ListMark' && name != 'LinkMark' && name != 'TaskMarker';
        final escape = name == 'Escape';
        if (!_hidden.contains(name) && !inlineCode && !pluginMark && !escape) return null;
        if (active.contains(state.doc.lineAt(node.from).number)) return null;
        // An escaped character shows as itself: only its backslash goes.
        if (escape) {
          builder.add(node.from, node.from + 1, _hide);
          return null;
        }
        var end = node.to;
        // A heading's `# ` and a quote's `> ` go with the space after them, so the words start where the line does.
        if ((name == 'HeaderMark' || name == 'QuoteMark') && state.doc.sliceString(end, end + 1 > state.doc.length ? state.doc.length : end + 1) == ' ') end += 1;
        if (end > node.from) builder.add(node.from, end, _hide);
        return null;
      },
    );
  }
  return builder.finish();
}

class _Styled extends PluginValue {
  _Styled(EditorViewLike view) : decorations = _hiddenMarks(view);

  DecorationSet decorations;

  @override
  void update(ViewUpdate update) {
    if (update.docChanged || update.selectionSet || update.focusChanged || update.viewportChanged || !identical(syntaxTree(update.startState), syntaxTree(update.state))) {
      decorations = _hiddenMarks(update.view);
    }
  }
}

final ViewPlugin<_Styled> _styled = ViewPlugin.define<_Styled>(
  _Styled.new,
  decorations: (plugin) => plugin.decorations,
  // A hidden mark is stepped over, not into, by the arrow keys.
  provide: (plugin) => EditorViewLike.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none),
);

/// Whether the note is shown Formatted, for what hides its own marks there too (a blank's braces).
final Facet<bool, bool> formattedView = Facet.define<bool, bool>(combine: (values) => values.any((value) => value));

/// The extension for a view: Formatted hides the marks; Margin hangs the leading ones; Markdown adds nothing.
Extension noteView(NoteView view) => switch (view) {
  NoteView.formatted => Extension.list(<Extension>[_styled, formattedView.of(true)]),
  NoteView.margin => marginMarks(),
  NoteView.mixed => const Extension.list(<Extension>[]),
};

/// What a note is drawn as, from the stored view and the Margin setting.
NoteView shownView(String noteView, {required bool marksInMargin}) {
  final view = noteViewNamed(noteView) ?? NoteView.mixed;
  return view == NoteView.mixed && marksInMargin ? NoteView.margin : view;
}

/// `isNoteView`, for a stored preference: the two names.
NoteView? noteViewNamed(Object? value) => switch (value) {
  'mixed' => NoteView.mixed,
  'formatted' => NoteView.formatted,
  _ => null,
};
