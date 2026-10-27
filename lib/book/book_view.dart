/// A book's index, drawn where its words would be (lib/note/note_screen.dart `NoteSeams.book`): its own words first,
/// then the chapters, numbered, each a row that opens the note - or makes it, where a chapter is a title with no
/// note yet, which the row says. A port of `src/app/book/BookView.tsx`, `BookView.module.css`, `rows.module.css`
/// and `CanvasMark.tsx`, with the index's writers of `book/book.ts` that lib/core/book.dart left for this screen.
///
/// The index is edited here in the three ways an index is: a chapter added (a new one, named here and opened at
/// once; or a note already written, picked from the library), moved - a place up or down, or dragged by its grip
/// (row_drag.dart) - or taken out, none of which touches the chapter's own note. Every change is a change to the
/// book note's body, written the way typing is, so the Markdown behind the view is always the index it shows, and
/// the view is a toggle away from it. The chapters can also be read straight through, one after another, each drawn
/// as the note draws it. The bar and the foot a chapter wears to find its way round the book are book_nav.dart.
///
/// A chapter can be a canvas (Matt: "Add the ability for canvases to be in books as well"): a chapter that is a
/// canvas, and a canvas offered in the picker, wear the canvas's own mark ([CanvasMark]).
///
/// Given `spot`, the view keeps where the book was left (book_spot.dart, book_spot_watch.dart): a book left reading
/// straight through opens reading straight through, scrolled back to the chapter and the line it was at.
///
/// A notebook with a ticket key (`key: GHO`; tickets.dart, tauri/docs/DESIGN.md §157) makes tickets as well as
/// pages: New ticket, beside Add a page, asks for the title and what the ticket starts with, and puts its line in
/// the index as a page's is. A page that is a ticket says its key and status on its row (lib/notes/ticket_mark.dart).
///
///     numbered, toggledTitle, withoutChapter, withChapterMoved, withChapterAt, bodyWithoutTitle, bookWords
///                    the rules (book/book.ts)
///     BookView       the index and the read-through
///     BookWords      the book's own words round its index
///     CanvasMark     the canvas's mark beside a title
///     BookAction, BookQuiet, BookField, FlexWrap, FlexItem
///                    the page's buttons, its field and its wrapping row, which the journal's page draws with too
///     BookPages      what the index's presses do to the library (App.tsx `openTitleFrom` and its callers)
///
/// What differs:
/// - **`dark` is not taken**: the tokens the view is built under say which side of the theme it is on.
/// - **`videos`** (whose film cards these are) is not taken: the film card is a later piece of the editor, and the
///   book's words are drawn by what the editor has.
/// - **The book's own words are a column drawn to be read** ([BookWords]), which takes no caret: a `[[link]]` in
///   them is drawn as a link and opens on a tap, which the column is asked about where the page's editor heard it
///   itself; nothing else in them is pressed.
/// - **`readBar`'s `position: sticky`** is a sliver of its own, first of the read-through's and over the rest
///   (stuck_head.dart): it takes no room, the first run keeping a box of the bar's height where the bar stands, and
///   it is drawn there until the page has scrolled it up to the room that page keeps at its top
///   (lib/note/page_head.dart), where a sticky box comes to rest under its scroll container's padding, and there
///   from then on, going up with the notebook's foot. It is one layer, moved: no page under it is drawn again.
/// - **The byline** is lib/note/byline.dart's, as the note screen draws it for a note.
/// - **`spot`** is the book note's id alone: the page it scrolls in is the [Scrollable] the view is built in.
/// - **Tab and the arrows in Start with**: the arrows move the choice and the focus together, as on the page; every
///   row can take the focus by Tab, where the page gave Tab one stop.
/// - A `.tool`'s `2em` is of a button's own 13.33 px on the page (it has no `font: inherit`), and is here too.
/// - **On a page with a dock** (lib/shell/page_dock.dart) the index offers it Add a page and Read straight through,
///   its own two buttons; reading straight through, the way back to the index in Read straight through's place.
library;

import 'dart:math' as math;

import 'package:flutter/gestures.dart' show PointerSignalEvent;
import 'package:flutter/rendering.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:glacier/glacier.dart';

import '../ai/support/authors.dart' show authorsAcross;
import '../canvas/json_canvas.dart' show canvasNoteBody, isCanvasBody;
import '../canvas/json_canvas.dart' as json_canvas show Canvas;
import '../core/back.dart';
import '../core/book.dart';
import '../core/front_matter.dart' show frontMatterEnd;
import '../core/item_syntax.dart' show jsTrim;
import '../core/library.dart';
import '../core/note.dart';
import '../core/note_text.dart' show noteTitle, sameTitle, titleKey, withoutFrontMatter;
import '../core/properties.dart' show Ticket, notebookKey, statusesOf, ticketOf, withProperty;
import '../core/properties.dart' as properties show isTicket;
import '../core/stored.dart';
import '../editor/fields/field_picker.dart';
import '../editor/fields/field_picks.dart';
import '../editor/items/wiki_links.dart' show WikiOptions, wikiLinks, wikiLinksIn;
import '../editor/looks/look.dart';
import '../editor/markdown_view.dart';
import '../editor/state/state.dart';
import '../editor/syntax/language.dart' show InlineFormatSyntax;
import '../editor/view/base.dart';
import '../editor/view/column.dart';
import '../editor/view/editor_view.dart';
import '../editor/view/sliver.dart';
import '../editor/view/view_mode.dart';
import '../home/home_icons.dart' show HomeGlyph;
import '../note/byline.dart';
import '../note/page_head.dart';
import '../notes/note_templates.dart';
import '../notes/ticket_mark.dart';
import '../perf/frame_log.dart';
import '../sheet/css.dart';
import '../sheet/flow.dart';
import '../shell/page_dock.dart';
import 'book_spot.dart';
import 'book_spot_watch.dart';
import 'entry_starts.dart';
import 'row_drag.dart';
import 'stuck_head.dart';
import 'tickets.dart' show newTicketBody, nextTicketId;

// ---- the rules (book/book.ts) -------------------------------------------------------------------------------------

/// The chapter numbers as the index shows them: "1", "2", "2.1", "2.2", "3" (`numbered`).
List<String> numbered(List<Chapter> chapters) {
  var major = 0;
  var minor = 0;
  return [
    for (final chapter in chapters)
      if (chapter.depth == 0) '${() {
        major += 1;
        minor = 0;
        return major;
      }()}' else '${math.max(major, 1)}.${minor += 1}',
  ];
}

/// The titles with [title] taken out where it is there, matched as a link matches, or put on the end where it is
/// not: a tap on a note in a picker, ticking it or unticking it (`toggledTitle`).
List<String> toggledTitle(List<String> titles, String title) =>
    titles.any((t) => sameTitle(t, title)) ? [for (final t in titles) if (!sameTitle(t, title)) t] : [...titles, title];

/// The body with a chapter's line taken out of the index; the note it names is untouched (`withoutChapter`).
String withoutChapter(String body, String title) {
  final chapter = chaptersOf(body).where((c) => sameTitle(c.title, title)).firstOrNull;
  if (chapter == null) return body;
  final lines = body.split('\n')..removeAt(chapter.line);
  return lines.join('\n');
}

/// The body with a chapter moved one place up (-1) or down (1) in the index; at either end, as it was
/// (`withChapterMoved`).
String withChapterMoved(String body, String title, int by) {
  final chapters = chaptersOf(body);
  final at = chapters.indexWhere((c) => sameTitle(c.title, title));
  final other = at + by;
  if (at < 0 || other < 0 || other >= chapters.length) return body;
  final lines = body.split('\n');
  final a = chapters[at].line, b = chapters[other].line;
  final held = lines[a];
  lines[a] = lines[b];
  lines[b] = held;
  return lines.join('\n');
}

/// The body with a chapter moved to the place of the chapter now [to]th in the index (0-based); past the end, last.
/// What a drag does (row_drag.dart): the line leaves where it was and lands where the finger let go, at that row's
/// depth (`withChapterAt`).
String withChapterAt(String body, String title, int to) {
  final chapters = chaptersOf(body);
  final from = chapters.indexWhere((c) => sameTitle(c.title, title));
  if (from < 0) return body;
  final target = math.max(0, math.min(chapters.length - 1, to));
  if (target == from) return body;
  final lines = body.split('\n');
  final line = lines.removeAt(chapters[from].line);
  // The lines after the one taken out have moved up by one.
  final landing = chapters[target].line - (target > from ? 1 : 0);
  final depth = chapters[target].depth;
  lines.insert(landing + (target > from ? 1 : 0), '${depth == 1 ? '  ' : ''}${jsTrim(line)}');
  return lines.join('\n');
}

final RegExp _heading = RegExp(r'^#{1,6}\s+(.*)$');

/// A chapter's words for reading straight through: its front matter gone, and its first heading gone where it is
/// the chapter's own title, since the section that draws it names it. What is left keeps its marks
/// (`bodyWithoutTitle`).
String bodyWithoutTitle(String body, String title) {
  // `withoutFrontMatter` puts the front matter's `title:` where the fences were, as a line, so the list can name
  // the note; here that line is the title too, and goes with any heading of the same name under it.
  final lines = withoutFrontMatter(body.split('\n')).toList();
  for (var pass = 0; pass < 2; pass += 1) {
    final first = lines.indexWhere((l) => jsTrim(l).isNotEmpty);
    if (first < 0) break;
    final line = lines[first];
    final words = jsTrim(_heading.firstMatch(line)?.group(1) ?? line);
    if (!sameTitle(words, title)) break;
    lines.removeRange(0, first + 1);
  }
  while (lines.isNotEmpty && jsTrim(lines.first).isEmpty) {
    lines.removeAt(0);
  }
  return lines.join('\n');
}

final RegExp _leadingBlank = RegExp(r'^\s*\n');
final RegExp _named = RegExp(r'^#\s+');
final RegExp _danglingLead = RegExp(r'(\n+(?:-{3,}|\*{3,}|#{1,6}\s.*))+\s*$');
final RegExp _onlyRule = RegExp(r'^(?:-{3,}|\*{3,})$');

/// The book's own words around its index, as Markdown: what comes before the first chapter (less the front matter
/// and the heading that names the book, which is the header's), and what comes after the last - a book's canvases,
/// its further reading, notes to self. What sits between chapters, a part's heading, belongs to the list and is
/// left out of both (`bookWords`).
({String before, String after}) bookWords(String body) {
  final lines = body.split('\n');
  final chapters = chaptersOf(body);
  final start = frontMatterEnd(lines);
  final first = chapters.isNotEmpty ? chapters.first.line : lines.length;
  final last = chapters.isNotEmpty ? chapters.last.line : lines.length - 1;
  final head = lines.sublist(math.min(start, first), first);
  final named = head.indexWhere((line) => jsTrim(line).isNotEmpty);
  if (named >= 0 && _named.hasMatch(head[named])) head.removeAt(named);
  String tidy(List<String> part) => jsTrim(part.join('\n').replaceFirst(_leadingBlank, ''));
  // A rule or a heading left dangling at the end of the words before - the lead-in to the list - goes with the list.
  final before = jsTrim(tidy(head).replaceFirst(_danglingLead, '').replaceFirst(_onlyRule, ''));
  return (before: before, after: chapters.isNotEmpty ? tidy(lines.sublist(last + 1)) : '');
}

// ---- the page's own pieces ----------------------------------------------------------------------------------------

/// `color-mix(in srgb, var(--glacier-text) N%, transparent)`.
Color _ink(Tokens t, double part) {
  final ink = t.color('glacier-text');
  return ink.withValues(alpha: part * ink.a);
}

/// The page's type (`.book { font-size: var(--app-body); line-height: 1.5 }`): [px] of it, its lines one and a half
/// times as tall, to the fraction (lib/sheet/css.dart [cssLines]).
TextStyle bookText(Tokens t, double px, {String weight = 'regular', Color? color, double tracking = 0}) =>
    t.textAt(px, weight: weight, color: color ?? t.color('glacier-text'), height: 1.5, tracking: tracking);

/// The canvas's mark, beside a title that is a canvas (`CanvasMark`): the one the + sheet gives a canvas, so a book
/// reads as the pages and the boards of cards it is made of. `<Workflow size={13} strokeWidth={2.2} />` in
/// `color: var(--app-ink-3)`, `margin-inline-start: 0.4em; vertical-align: -0.1em` of the title's [em].
class CanvasMark extends StatelessWidget {
  const CanvasMark({super.key, required this.em});

  /// The font size of the title it follows.
  final double em;

  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.only(left: 0.4 * em),
        // Measured on the page: the mark's middle is 0.066em under the title's line's.
        child: Transform.translate(
          offset: Offset(0, 0.066 * em),
          child: Semantics(label: 'A canvas', child: lucide(Lucide.workflow, size: 13, strokeWidth: 2.2, color: context.tokens.color('app-ink-3'))),
        ),
      );
}

/// The page's button (`.action`): a pill with a hairline round it, a mark before its words where it has one.
/// `padding: 0.45em 0.9em; font-size: 0.9em; gap: 0.4em`, the em the page's own.
class BookAction extends StatelessWidget {
  const BookAction({super.key, this.icon, required this.label, required this.onPressed, this.expanded});

  final LucideIcon? icon;
  final String label;

  /// Null draws it faded and takes no press (`:disabled { opacity: 0.4 }`).
  final VoidCallback? onPressed;

  /// `aria-expanded`, where the button opens something under it.
  final bool? expanded;

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;
    final em = 0.9 * t.len('app-body');
    final line = snapBorder(context, 1);
    return GlacierPressable(
      onPressed: onPressed,
      semanticLabel: label,
      excludeSemantics: true,
      builder: (context, state) => Semantics(
        expanded: expanded,
        child: Opacity(
          opacity: state.disabled ? 0.4 : 1,
          child: GlacierFocusRing(
            visible: state.focused,
            radius: t.radius('full'),
            child: DecoratedBox(
              decoration: BoxDecoration(
                border: Border.all(color: t.color('glacier-border-subtle'), width: line),
                borderRadius: BorderRadius.circular(999),
                color: (state.hovered || state.pressed) && !state.disabled ? _ink(t, 0.06) : null,
              ),
              child: Padding(
                padding: EdgeInsets.symmetric(vertical: 0.45 * em + line, horizontal: 0.9 * em + line),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  spacing: 0.4 * em,
                  children: [
                    if (icon != null) lucide(icon!, size: 16, color: t.color('glacier-text')),
                    cssLines(label, bookText(t, em), maxLines: 1, softWrap: false),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The page's quiet button (`.quiet`): words alone, in the muted ink. `padding: 0.45em 0.6em; font-size: 0.9em`.
class BookQuiet extends StatelessWidget {
  const BookQuiet({super.key, required this.label, required this.onPressed});

  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;
    final em = 0.9 * t.len('app-body');
    return GlacierPressable(
      onPressed: onPressed,
      semanticLabel: label,
      excludeSemantics: true,
      builder: (context, state) => GlacierFocusRing(
        visible: state.focused,
        child: Padding(
          padding: EdgeInsets.symmetric(vertical: 0.45 * em, horizontal: 0.6 * em),
          child: cssLines(label, bookText(t, em, color: t.color('glacier-text-muted')), maxLines: 1, softWrap: false),
        ),
      ),
    );
  }
}

/// A box to type in, in the look its caller gives it: the page's `.field` (one line, washed, a hairline round it),
/// and the template picker's `.box` (lib/book/template_picker.dart). The text, the caret and the selection are
/// Flutter's [EditableText], set up as lib/sheet/kit.dart's `SheetField` sets its own.
class BookField extends StatefulWidget {
  const BookField({
    super.key,
    required this.label,
    required this.controller,
    required this.style,
    required this.padding,
    required this.decoration,
    this.focusNode,
    this.placeholder,
    this.autoFocus = false,
    this.lines = 1,
    this.minHeight = 0,
    this.spellCheck = true,
    this.onChange,
    this.onSubmitted,
    this.onKeyDown,
  });

  /// What a screen reader calls it (`aria-label`).
  final String label;
  final TextEditingController controller;
  final TextStyle style;
  final EdgeInsets padding;

  /// The box, given whether the field has the focus.
  final Decoration Function(bool focused) decoration;
  final FocusNode? focusNode;
  final String? placeholder;
  final bool autoFocus;

  /// 1 for a line; null for a box that grows with what is written.
  final int? lines;
  final double minHeight;
  final bool spellCheck;
  final ValueChanged<String>? onChange;
  final ValueChanged<String>? onSubmitted;
  final KeyEventResult Function(KeyEvent event)? onKeyDown;

  @override
  State<BookField> createState() => _BookFieldState();
}

class _BookFieldState extends State<BookField> implements TextSelectionGestureDetectorBuilderDelegate {
  FocusNode? _ownFocus;
  late final TextSelectionGestureDetectorBuilder _gestures = TextSelectionGestureDetectorBuilder(delegate: this);
  bool _showHandles = false;

  FocusNode get _focus => widget.focusNode ?? (_ownFocus ??= FocusNode(debugLabel: 'BookField'));

  @override
  final GlobalKey<EditableTextState> editableTextKey = GlobalKey<EditableTextState>();

  @override
  bool get forcePressEnabled => false;

  @override
  bool get selectionEnabled => true;

  @override
  void initState() {
    super.initState();
    _focus.addListener(_redraw);
    widget.controller.addListener(_redraw);
  }

  @override
  void didUpdateWidget(BookField oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.focusNode != widget.focusNode) {
      (oldWidget.focusNode ?? _ownFocus)?.removeListener(_redraw);
      _focus.addListener(_redraw);
    }
    if (oldWidget.controller != widget.controller) {
      oldWidget.controller.removeListener(_redraw);
      widget.controller.addListener(_redraw);
    }
  }

  void _redraw() {
    if (!mounted) return;
    if (WidgetsBinding.instance.schedulerPhase == SchedulerPhase.persistentCallbacks) return;
    setState(() {});
  }

  @override
  void dispose() {
    (widget.focusNode ?? _ownFocus)?.removeListener(_redraw);
    widget.controller.removeListener(_redraw);
    _ownFocus?.dispose();
    super.dispose();
  }

  void _onSelection(TextSelection selection, SelectionChangedCause? cause) {
    final show = _gestures.shouldShowSelectionToolbar && (cause == SelectionChangedCause.longPress || cause == SelectionChangedCause.tap || cause == SelectionChangedCause.doubleTap) && widget.controller.text.isNotEmpty;
    if (show != _showHandles) setState(() => _showHandles = show);
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;
    final focused = _focus.hasFocus;
    final many = widget.lines != 1;
    Widget editable = EditableText(
      key: editableTextKey,
      controller: widget.controller,
      focusNode: _focus,
      style: widget.style,
      cursorColor: t.color('glacier-text'),
      cursorWidth: 1,
      backgroundCursorColor: t.color('glacier-text-subtle'),
      selectionColor: focused ? t.color('glacier-selection') : null,
      selectionControls: GlacierTextSelectionControls(color: t.color('glacier-accent-solid')),
      showSelectionHandles: _showHandles,
      contextMenuBuilder: (context, editable) => GlacierTextSelectionToolbar(tokens: t, editable: editable),
      autofocus: widget.autoFocus,
      autocorrect: widget.spellCheck,
      enableSuggestions: widget.spellCheck,
      maxLines: widget.lines,
      keyboardType: many ? TextInputType.multiline : TextInputType.text,
      textInputAction: many ? TextInputAction.newline : TextInputAction.done,
      textCapitalization: TextCapitalization.sentences,
      onChanged: widget.onChange,
      onSubmitted: widget.onSubmitted,
      onSelectionChanged: _onSelection,
      rendererIgnoresPointer: true,
      keyboardAppearance: t.isDark ? Brightness.dark : Brightness.light,
    );
    if (widget.onKeyDown != null) {
      editable = Focus(canRequestFocus: false, skipTraversal: true, onKeyEvent: (node, event) => event is KeyUpEvent ? KeyEventResult.ignored : widget.onKeyDown!(event), child: editable);
    }
    return Semantics(
      label: widget.label,
      textField: true,
      child: _gestures.buildGestureDetector(
        behavior: HitTestBehavior.translucent,
        child: MouseRegion(
          cursor: SystemMouseCursors.text,
          child: ConstrainedBox(
            constraints: BoxConstraints(minHeight: widget.minHeight),
            child: DecoratedBox(
              decoration: widget.decoration(focused),
              child: Padding(
                padding: widget.padding,
                child: Stack(
                  alignment: many ? AlignmentDirectional.topStart : AlignmentDirectional.centerStart,
                  children: [
                    if (widget.controller.text.isEmpty && widget.placeholder != null)
                      ExcludeSemantics(child: Text(widget.placeholder!, style: widget.style.copyWith(color: t.color('glacier-text-subtle')), maxLines: 1, softWrap: false, overflow: TextOverflow.clip)),
                    DefaultTextEditingShortcuts(child: editable),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The page's own field (`.field`): `padding: 0.45em 0.7em; border: 1px solid subtle; border-radius: md;
/// background: 4% of the ink`, ringed while it is typed in (`outline: 2px solid var(--glacier-accent-solid);
/// outline-offset: 1px`).
class _PageField extends StatelessWidget {
  const _PageField({super.key, required this.label, required this.placeholder, required this.controller, this.onSubmitted, this.onEscape});

  final String label;
  final String placeholder;
  final TextEditingController controller;
  final VoidCallback? onSubmitted;
  final VoidCallback? onEscape;

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;
    final em = t.len('app-body');
    final line = snapBorder(context, 1);
    final radius = t.radius('md');
    return BookField(
      label: label,
      placeholder: placeholder,
      controller: controller,
      autoFocus: true,
      style: bookText(t, em),
      padding: EdgeInsets.symmetric(vertical: 0.45 * em + line, horizontal: 0.7 * em + line),
      decoration: (focused) => _FieldBox(
        border: t.color('glacier-border-subtle'),
        line: line,
        radius: radius,
        ground: _ink(t, 0.04),
        ring: focused ? t.color('glacier-accent-solid') : null,
      ),
      onSubmitted: onSubmitted == null ? null : (_) => onSubmitted!(),
      // Taken here, so the back stack does not also step: one Escape closes the form and nothing more.
      onKeyDown: onEscape == null
          ? null
          : (event) {
              if (event.logicalKey != LogicalKeyboardKey.escape) return KeyEventResult.ignored;
              onEscape!();
              return KeyEventResult.handled;
            },
    );
  }
}

/// A field's box with its focus ring outside it (`outline`, which takes no room).
class _FieldBox extends Decoration {
  const _FieldBox({required this.border, required this.line, required this.radius, required this.ground, this.ring});

  final Color border;
  final double line;
  final double radius;
  final Color ground;
  final Color? ring;

  @override
  BoxPainter createBoxPainter([VoidCallback? onChanged]) => _FieldBoxPainter(this);
}

class _FieldBoxPainter extends BoxPainter {
  _FieldBoxPainter(this.box);
  final _FieldBox box;

  @override
  void paint(Canvas canvas, Offset offset, ImageConfiguration configuration) {
    final rect = offset & (configuration.size ?? Size.zero);
    final outer = RRect.fromRectAndRadius(rect, Radius.circular(box.radius));
    canvas.drawRRect(outer, Paint()..color = box.ground);
    canvas.drawRRect(
      outer.deflate(box.line / 2),
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = box.line
        ..color = box.border,
    );
    final ring = box.ring;
    if (ring != null) {
      canvas.drawRRect(
        outer.inflate(2),
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2
          ..color = ring,
      );
    }
  }
}

/// How a child of a [FlexWrap] takes its room: [basis] with `grow` is `flex: 1 1 <basis>` (it starts that wide and
/// takes what its row has left); [full] is `flex-basis: 100%`, a row of its own.
class FlexItem extends ParentDataWidget<_FlexData> {
  const FlexItem({super.key, this.basis, this.full = false, required super.child});

  final double? basis;
  final bool full;

  @override
  void applyParentData(RenderObject renderObject) {
    final data = renderObject.parentData! as _FlexData;
    if (data.basis == basis && data.full == full) return;
    data
      ..basis = basis
      ..full = full;
    renderObject.parent?.markNeedsLayout();
  }

  @override
  Type get debugTypicalAncestorWidgetClass => FlexWrap;
}

class _FlexData extends ContainerBoxParentData<RenderBox> {
  double? basis;
  bool full = false;
}

/// `display: flex; flex-wrap: wrap; align-items: center; gap`: children in rows, a child that does not fit starting
/// the next, each row's children middled on it. A child in a [FlexItem] grows or takes a row whole; the others are
/// as wide as their words. Flutter's [Wrap] has no child that grows.
class FlexWrap extends MultiChildRenderObjectWidget {
  const FlexWrap({super.key, required this.gap, super.children});

  final double gap;

  @override
  RenderObject createRenderObject(BuildContext context) => _RenderFlexWrap(gap);

  @override
  void updateRenderObject(BuildContext context, covariant RenderObject renderObject) => (renderObject as _RenderFlexWrap).gap = gap;
}

class _RenderFlexWrap extends RenderBox with ContainerRenderObjectMixin<RenderBox, _FlexData>, RenderBoxContainerDefaultsMixin<RenderBox, _FlexData> {
  _RenderFlexWrap(this._gap);

  double _gap;
  set gap(double value) {
    if (value == _gap) return;
    _gap = value;
    markNeedsLayout();
  }

  @override
  void setupParentData(RenderBox child) {
    if (child.parentData is! _FlexData) child.parentData = _FlexData();
  }

  double _arrange(double width, {required bool place}) {
    final rows = <List<RenderBox>>[];
    final wants = <RenderBox, double>{};
    var row = <RenderBox>[];
    var used = 0.0;
    for (var child = firstChild; child != null; child = childAfter(child)) {
      final data = child.parentData! as _FlexData;
      final want = data.full ? width : math.min(width, data.basis ?? child.getMaxIntrinsicWidth(double.infinity));
      wants[child] = want;
      if (row.isNotEmpty && used + _gap + want > width + 0.01) {
        rows.add(row);
        row = <RenderBox>[];
        used = 0;
      }
      used += (row.isEmpty ? 0 : _gap) + want;
      row.add(child);
    }
    if (row.isNotEmpty) rows.add(row);
    var y = 0.0;
    for (final (n, each) in rows.indexed) {
      final taken = each.fold<double>(0, (sum, child) => sum + wants[child]!) + _gap * (each.length - 1);
      final growers = each.where((child) => (child.parentData! as _FlexData).basis != null).length;
      final spare = math.max(0.0, width - taken);
      var tall = 0.0;
      final widths = <double>[];
      for (final child in each) {
        final data = child.parentData! as _FlexData;
        final wide = wants[child]! + (data.basis != null && growers > 0 ? spare / growers : 0);
        widths.add(wide);
        final fixed = data.basis != null || data.full;
        final box = fixed ? BoxConstraints.tightFor(width: wide) : BoxConstraints(maxWidth: width);
        if (place) {
          child.layout(box, parentUsesSize: true);
          tall = math.max(tall, child.size.height);
        } else {
          tall = math.max(tall, child.getDryLayout(box).height);
        }
      }
      if (place) {
        var x = 0.0;
        for (final (i, child) in each.indexed) {
          (child.parentData! as _FlexData).offset = Offset(x, y + (tall - child.size.height) / 2);
          x += (fixed(child) ? widths[i] : child.size.width) + _gap;
        }
      }
      y += tall + (n == rows.length - 1 ? 0 : _gap);
    }
    return y;
  }

  bool fixed(RenderBox child) {
    final data = child.parentData! as _FlexData;
    return data.basis != null || data.full;
  }

  @override
  Size computeDryLayout(BoxConstraints constraints) => constraints.constrain(Size(constraints.maxWidth, _arrange(constraints.maxWidth, place: false)));

  @override
  double computeMinIntrinsicHeight(double width) => _arrange(width, place: false);

  @override
  double computeMaxIntrinsicHeight(double width) => _arrange(width, place: false);

  @override
  void performLayout() {
    final width = constraints.maxWidth;
    size = constraints.constrain(Size(width, _arrange(width, place: true)));
  }

  @override
  bool hitTestChildren(BoxHitTestResult result, {required Offset position}) => defaultHitTestChildren(result, position: position);

  @override
  void paint(PaintingContext context, Offset offset) => defaultPaint(context, offset);
}

/// What a notebook's own words and its pages read straight through draw, from the note screen that shows the
/// notebook (lib/root/note_desk.dart): the inline marks its notes parse, and the blocks a note's editor draws - a
/// diagram, a query, a table, a board, a link's card, an embed, a picture - read only. Matt, 2026-10-16: "mermaid
/// charts and the query boards are not working": a notebook's preface drew a ```mermaid or ```query fence as its
/// lines, since the words here had only the editor's base. The page does the same (BookView.tsx's `BookWords`
/// passes no queries, and its read-through is a `peek`); here they are drawn as a note draws them.
///
/// Absent, the words have the base alone, as a test's notebook and a shared one draw them. [extensions] carry their
/// own `[[link]]`s, so [BookWords] adds none of its own beside them.
@immutable
class BookDrawing {
  const BookDrawing({this.formats = const <InlineFormatSyntax>[], this.extensions = const <Extension>[], this.changes, this.told});

  final List<InlineFormatSyntax> formats;
  final List<Extension> extensions;

  /// The library the blocks read (a query's tickets, a framed canvas), and what the words' editor is told when it
  /// changes: the effects that draw those blocks again, for the words as they are; none where nothing in them reads
  /// another note. Matt, 2026-10-27: "I can't drag items around in the query tickets for hello trade": a card
  /// carried to another lane of the board over a notebook's index was written, and the board, drawn when the
  /// notebook opened and never again, put it back in the lane it came from.
  final Listenable? changes;
  final List<StateEffect<Object?>> Function(EditorState state)? told;
}

/// The book's own words around its index, drawn as a note is - read-only, formatted - in the index's column
/// (`BookWords`, `.preface`): none of the note's gutter, none of the room a note leaves over its first line and
/// under its last, and in the muted ink.
class BookWords extends StatefulWidget {
  const BookWords({super.key, required this.words, this.known, this.open, this.drawing});

  final String words;

  /// Whether a note by that title exists, and the way to it (`wiki={{ known, open }}`): given, a `[[link]]` in the
  /// words is drawn as one, dashed for a note still to be written, and a tap on it opens the note.
  final bool Function(String title)? known;
  final ValueChanged<String>? open;

  /// The marks and blocks the words draw ([BookDrawing]). Given, the words take taps as a note's do - a query's
  /// row, a link's card, a `[[link]]` - and are read only all the same.
  final BookDrawing? drawing;

  @override
  State<BookWords> createState() => _BookWordsState();
}

class _BookWordsState extends State<BookWords> {
  late EditorView _view = _make();

  @override
  void initState() {
    super.initState();
    widget.drawing?.changes?.addListener(_libraryChanged);
  }

  /// The library changed: the words' blocks that read it are drawn again, after the frame where one is being built
  /// (note_desk.dart `_libraryChanged`, the note's own editor's).
  void _libraryChanged() {
    void tell() {
      final told = widget.drawing?.told;
      if (!mounted || told == null) return;
      final effects = told(_view.state);
      if (effects.isNotEmpty) _view.dispatch(TransactionSpec(effects: effects));
    }

    if (SchedulerBinding.instance.schedulerPhase == SchedulerPhase.idle) {
      tell();
    } else {
      SchedulerBinding.instance.addPostFrameCallback((_) => tell());
    }
  }

  bool get _links => widget.known != null && widget.open != null;

  EditorView _make() {
    final drawing = widget.drawing;
    return EditorView(
      wholeDocument: true,
      state: EditorState.create(
        doc: widget.words,
        extensions: noteExtensions(
          display: NoteView.formatted,
          readOnly: true,
          formats: drawing?.formats ?? const <InlineFormatSyntax>[],
          more: <Extension>[
            ...?drawing?.extensions,
            // Asked as each is drawn and as one is tapped, so the page's own answers are the ones in force.
            if (_links && drawing == null) wikiLinks(WikiOptions(known: (title) => widget.known?.call(title) ?? false, open: (title, [anchor]) => widget.open?.call(title))),
          ],
        ),
      ),
    );
  }

  /// A finished tap on the words: a link between notes under it opens (the editor's own `wikiLinks`, which hears the
  /// press in an editor that takes one).
  void _tapped(TapUpDetails details) {
    final pos = _view.posAtCoords(details.globalPosition);
    if (pos == null) return;
    final line = _view.state.doc.lineAt(pos);
    for (final link in wikiLinksIn(line.text, line.from)) {
      if (pos >= link.from && pos <= link.to) return widget.open?.call(link.title);
    }
  }

  @override
  void didUpdateWidget(BookWords oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.drawing?.changes, widget.drawing?.changes)) {
      oldWidget.drawing?.changes?.removeListener(_libraryChanged);
      widget.drawing?.changes?.addListener(_libraryChanged);
    }
    if (oldWidget.words != widget.words || (oldWidget.known != null && oldWidget.open != null) != _links || !identical(oldWidget.drawing, widget.drawing)) {
      _view.destroy();
      _view = _make();
    }
  }

  @override
  void dispose() {
    widget.drawing?.changes?.removeListener(_libraryChanged);
    _view.destroy();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;
    final env = LookEnv(
      t: t,
      body: t.len('app-body'),
      headings: <double>[for (var level = 1; level <= 6; level++) t.len('app-h$level')],
      // `.preface { --app-gutter: 0px }`, and `.cm-content { padding-block: 0 }`. The rule's `color:
      // var(--glacier-text-muted)` never reaches the words: the editor inside sets its own colour, the note's ink,
      // and on the page a notebook's own words are as bright as a note's (243 of 255 on a phone in the dark, where
      // the muted ink drew them at 190).
      gutter: 0,
      devicePixelRatio: MediaQuery.devicePixelRatioOf(context),
      dark: t.isDark,
      tabSize: _view.state.tabSize,
      contentTop: 0,
      // None on a phone. On the split layout the page's rule for the room under a note's last line beats the
      // preface's own, and the index starts that much lower (38px on the Fold opened, measured on the page).
      contentBottom: LookEnv.splitRoom(t) ?? 0,
    );
    return CssFlow.block(
      // `margin-block: var(--glacier-space-2) var(--glacier-space-4)`
      margin: EdgeInsets.only(top: t.space(2), bottom: t.space(4)),
      child: widget.drawing != null
          // Drawn as a note is, the words take a note's taps: a query's row or a link's card is its block's own,
          // the innermost in the arena. A `[[link]]` is words, which hear nothing in a column with no input (the
          // editor's `wikiLinks` hears a press only where there is a caret to keep), so it is this one's.
          ? (_links ? GestureDetector(behavior: HitTestBehavior.translucent, onTapUp: _tapped, child: EditorColumn(view: _view, env: env)) : EditorColumn(view: _view, env: env))
          : ExcludeSemantics(
              child: _links
                  ? GestureDetector(behavior: HitTestBehavior.translucent, onTapUp: _tapped, child: IgnorePointer(child: EditorColumn(view: _view, env: env)))
                  : IgnorePointer(child: EditorColumn(view: _view, env: env)),
            ),
    );
  }
}

// ---- the view -----------------------------------------------------------------------------------------------------

enum _Adding { page, existing, ticket }

/// One page of a notebook as its index and its read-through draw it ([BookViewState._pageOf]): whether there is a
/// note by its title, and what that note's words say of it. Each answer is worked out the first time it is asked
/// for and kept with the words it was read from.
class _PageRead {
  _PageRead({required this.there, required this.words, required this.notebook});

  /// Whether a note by the page's title exists.
  final bool there;

  /// That note's words, where there is one.
  final String? words;

  /// The notebook's own words, whose workflow a page's status is placed in.
  final String notebook;

  /// Whether the page's words are a canvas's, whatever they are (the read-through's question).
  late final bool isCanvas = words != null && isCanvasBody(words!);

  /// Whether the page is a canvas with something in it (the index's question, `_isCanvas`).
  late final bool canvas = words != null && words!.isNotEmpty && isCanvasBody(words!);

  /// Whether the page is a ticket, for its status's button (`TicketStatusButton.has`).
  late final bool isTicket = properties.isTicket(words ?? '');

  /// The page's ticket in the notebook's workflow, for its mark (`TicketMark.has`, then the mark's own reading).
  late final Ticket? ticket = ticketOf(words ?? '', statusesOf(notebook));

  String? _untitled;
  String? _untitledFor;

  /// The page's words for reading straight through ([bodyWithoutTitle]), for the title its row gives it.
  String untitled(String title) {
    if (_untitled != null && _untitledFor == title) return _untitled!;
    _untitledFor = title;
    return _untitled = bodyWithoutTitle(words ?? '', title);
  }
}

/// One way a page or a ticket can start, as Start with lists it: its name, and how it starts, on one line
/// (`StartRow`).
typedef _StartRow = ({String id, String name, String line});

/// A book's index and its read-through (`BookView`).
class BookView extends StatefulWidget {
  const BookView({
    super.key,
    required this.body,
    required this.known,
    required this.open,
    required this.titles,
    required this.title,
    required this.onChange,
    this.bodyOf,
    this.openCanvas,
    this.openNew,
    this.readOnly = false,
    this.setStatus,
    this.openTicket,
    this.ticketTemplates = const <NoteTemplate>[],
    this.spot,
    this.kept,
    this.clock,
    this.drawing,
  });

  final String body;

  /// What the book's own words and its pages read straight through draw ([BookDrawing]); absent, the base alone.
  final BookDrawing? drawing;

  /// Whether a note by that title exists: a chapter still to be written is drawn as waiting.
  final bool Function(String title) known;

  /// Opens the note by that title, or makes one that starts with it (App.tsx `openTitle`).
  final ValueChanged<String> open;

  /// Every note's title, for adding one that is already written.
  final List<String> Function() titles;

  /// The book's own title, so it is not offered as a chapter of itself.
  final String title;
  final ValueChanged<String> onChange;

  /// A note's body by its title, to tell a chapter that is a canvas from one of words; absent, none is marked.
  final String? Function(String title)? bodyOf;

  /// Makes a canvas by that title and opens it: the new-chapter form's "Add as a canvas". Absent, no such button.
  final ValueChanged<String>? openCanvas;

  /// Makes a page by that title from a template and opens it: Add a page's "Start with". Absent, the form offers no
  /// templates and a page begins as its title, through [open].
  final void Function(String title, String template)? openNew;

  /// Read, not changed: no grips, no move or take-out tools, nothing to add. The index, the preface, the canvas
  /// marks and reading straight through stay.
  final bool readOnly;

  /// Sets a page's ticket status, or takes it off with null: a tap on a ticket's status in the index opens its
  /// workflow's sheet (docs/DESIGN.md §169). Absent, the status is drawn and not pressed.
  final void Function(String title, String? status)? setStatus;

  /// Makes a ticket by that title in this notebook and opens it, from a ticket's template or none: New ticket,
  /// offered while the notebook has a key. Absent, no such button.
  final void Function(String title, NoteTemplate? template)? openTicket;

  /// The templates a ticket can start from, a Bug report and a Feature among them (lib/notes/note_templates.dart).
  final List<NoteTemplate> ticketTemplates;

  /// The book note's id, to keep where it was left; absent, nothing is kept.
  final String? spot;

  /// Where the spots are kept; the app's own store where it is left out.
  final Stored? kept;

  /// The minute a template's line is told for; this one where it is left out.
  final DateTime Function()? clock;

  @override
  State<BookView> createState() => BookViewState();
}

class BookViewState extends State<BookView> {
  /// The page whose status sheet is open, by its title.
  String? _statusOf;
  _Adding? _adding;

  /// Where the book was left, read once as it opens: reading straight through is picked up where it was.
  ReadingSpot? _left;

  /// Reading straight through: the chapters one after another, each drawn as the note draws it.
  late bool _reading;
  final TextEditingController _draft = TextEditingController();
  final TextEditingController _filter = TextEditingController();

  /// What the page being added starts with ([pageStarts]): just its title unless another is picked.
  String _start = justTheTitle.id;

  /// The notes ticked so far in the picker, in the order they were ticked.
  List<String> _picked = const <String>[];

  /// The drag that writes a chapter to where it was let go.
  late final RowDrag _drag = RowDrag(_dropped);
  BookSpotWatch? _watch;
  final List<GlobalKey> _sections = <GlobalKey>[];
  final List<FocusNode> _startNodes = <FocusNode>[];
  String _watched = '';

  List<Chapter> _chapters = const <Chapter>[];

  /// Whether the chapters are being read straight through.
  bool get reading => _reading;

  @override
  void initState() {
    super.initState();
    final spot = widget.spot;
    final was = spot == null ? null : readBookSpot(spot, on: widget.kept);
    _left = was is ReadingSpot ? was : null;
    _reading = _left != null;
    _chapters = chaptersOf(widget.body);
    if (spot != null) _watch = BookSpotWatch(spot, on: widget.kept);
    _draft.addListener(_redraw);
    _filter.addListener(_redraw);
  }

  void _redraw() {
    if (mounted) setState(() {});
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _syncWatch();
  }

  @override
  void didUpdateWidget(BookView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.body != widget.body) _chapters = chaptersOf(widget.body);
    if (oldWidget.spot != widget.spot) {
      _watch?.dispose();
      _watch = widget.spot == null ? null : BookSpotWatch(widget.spot!, on: widget.kept);
      _watched = '';
    }
    _syncWatch();
  }

  /// `useBookSpot`'s effect, run when the book, the mode or the chapters' titles change.
  void _syncWatch() {
    final watch = _watch;
    if (watch == null) return;
    final titles = [for (final c in _chapters) c.title];
    final key = '${_reading ? 'r' : 'i'}\n${titles.join('\n')}';
    if (key == _watched) return;
    _watched = key;
    if (!_reading) {
      watch.index();
      return;
    }
    final page = Scrollable.maybeOf(context)?.position;
    if (page == null) return;
    watch.reading(page: page, measure: _measure, titles: titles, restore: _left);
  }

  /// The scroller's top and each chapter's section's, on the screen.
  ({double pageTop, List<double> sectionTops})? _measure() {
    if (!mounted) return null;
    final page = Scrollable.maybeOf(context)?.context.findRenderObject();
    if (page is! RenderBox || !page.attached) return null;
    final pageTop = page.localToGlobal(Offset.zero).dy;
    final pixels = Scrollable.of(context).position.pixels;
    final tops = <double>[];
    for (final key in _sections) {
      final box = key.currentContext?.findRenderObject();
      if (box is! RenderBox || !box.attached || !box.hasSize) break;
      // Where the page would have to be scrolled to for the section to be at its top, less where it is: a sliver
      // under the window's foot is not placed (every one of them is where the last one in sight ends), so where
      // its box says it is on the screen is not where it would be.
      final viewport = RenderAbstractViewport.maybeOf(box);
      tops.add(viewport == null ? box.localToGlobal(Offset.zero).dy : pageTop + viewport.getOffsetToReveal(box, 0).offset - pixels);
    }
    return (pageTop: pageTop, sectionTops: tops);
  }

  @override
  void dispose() {
    _watch?.dispose();
    for (final each in _lazy.values) {
      each.view.destroy();
    }
    _lazy.clear();
    _drag.dispose();
    _draft.dispose();
    _filter.dispose();
    for (final node in _startNodes) {
      node.dispose();
    }
    super.dispose();
  }

  bool _isCanvas(String name) {
    final found = widget.bodyOf?.call(name);
    return found != null && found.isNotEmpty && isCanvasBody(found);
  }

  /// What the index and the read-through draw of each page, by its title, read once for the page's words and the
  /// notebook's as they are now. A build asked after every page's words several times over: whether it is a canvas,
  /// whether it is a ticket, its ticket for the mark and again for the mark's own drawing, each of those reading
  /// the notebook's statuses from its front matter, and its words less their title for reading straight through.
  final Map<String, _PageRead> _pages = <String, _PageRead>{};

  /// How many times a page's words have been taken for reading (any view's): once for a page as it is, however
  /// often its index is built. For a test.
  @visibleForTesting
  static int debugPageReads = 0;

  _PageRead _pageOf(String title) {
    final there = widget.known(title);
    final words = widget.bodyOf?.call(title);
    final notebook = widget.body;
    final had = _pages[title];
    if (had != null && had.there == there && identical(had.words, words) && identical(had.notebook, notebook)) return had;
    if (ghostPerf) Perf.count('book.page.read');
    debugPageReads += 1;
    // No more kept than the notebook has pages, and a few that were taken out or renamed.
    if (_pages.length > _chapters.length + 64) _pages.clear();
    return _pages[title] = _PageRead(there: there, words: words, notebook: notebook);
  }

  /// The notebook's own words round its index, its ticket key, and everyone who wrote it or a page of it: read once
  /// for the notebook's words and its pages' as they are now.
  ({String body, List<String?> pages, ({String before, String after}) words, String? key, List<String> authors})? _own;

  ({String body, List<String?> pages, ({String before, String after}) words, String? key, List<String> authors}) _ownOf(List<Chapter> chapters) {
    final body = widget.body;
    final pages = [for (final chapter in chapters) widget.bodyOf?.call(chapter.title)];
    final had = _own;
    if (had != null && identical(had.body, body) && had.pages.length == pages.length) {
      var same = true;
      for (var i = 0; i < pages.length && same; i += 1) {
        same = identical(had.pages[i], pages[i]);
      }
      if (same) return had;
    }
    return _own = (
      body: body,
      pages: pages,
      words: bookWords(body),
      key: notebookKey(body),
      // Everyone who wrote the book: its own authors, then each chapter's, first met first.
      authors: authorsAcross([body, for (final page in pages) page ?? '']),
    );
  }

  void _dropped(int from, int to) {
    if (from < 0 || from >= _chapters.length) return;
    widget.onChange(withChapterAt(widget.body, _chapters[from].title, to));
  }

  void _setReading(bool on) {
    setState(() {
      // Back at the index, the place the book was left at is spent: reading through again starts afresh.
      if (!on) _left = null;
      _reading = on;
      _readTo = 0;
    });
    _readMade.clear();
    if (!on) _keepLazy(const <String>{});
    _syncWatch();
  }

  /// How many pages reading straight through has drawn so far, from the first: a screenful of them with the view
  /// (and every page up to the one the book was left at), and the rest in the frames after, a few at a time. Every
  /// page of the notebook was built and laid out in the one frame the read-through opened in, and a notebook is
  /// as long as a book (measured on a Mac, tool/perf.sh, sixteen written pages, two of them of twelve thousand
  /// letters: one frame of 213 ms): what is under the window's foot is now made while the top is read.
  int _readTo = 0;

  /// Each page's widgets as the read-through last made them, by the page's place, and what they were made from.
  final Map<int, ({Object made, List<Widget> pieces})> _readMade = <int, ({Object made, List<Widget> pieces})>{};

  /// How much the next frame adds, in letters to lay out ([_readCost]): twice as much after a frame that was quick,
  /// half after a slow one. It was a number of pages, twice as many after a quick frame and eight at the most, and
  /// eight pages of a thousand letters each were one frame of 40 ms after four short ones had been quick.
  int _readStep = _readFirst;
  bool _readWaiting = false;
  final Stopwatch _readClock = Stopwatch();
  static const int _readLeast = 500, _readFirst = 1500, _readMost = 12000;

  /// About a screenful of a page's words, in letters: the pages built with the view reach this many between them.
  static const int _readSoon = 2000;

  /// What a page costs the frame it is added in, in letters to lay out: a short page's own, and a tenth of a long
  /// one's, whose lines wait until they are near the screen and whose words are only read.
  int _readCost(String title) {
    final read = _pageOf(title);
    if (!read.there || read.words == null || read.isCanvas) return 50;
    final letters = read.untitled(title).length;
    return 50 + (letters >= longPage ? letters ~/ 10 : letters);
  }

  /// The pages built in this build of the read-through; the rest are asked for a frame from now.
  int _readSoFar(List<Chapter> chapters) {
    final count = chapters.length;
    if (_readTo == 0) {
      final left = _left;
      final at = left == null ? -1 : chapters.indexWhere((chapter) => sameTitle(chapter.title, left.title));
      var first = 0, letters = 0;
      while (first < count && (first == 0 || letters < _readSoon)) {
        letters += _pageOf(chapters[first].title).words?.length ?? 0;
        first += 1;
      }
      _readTo = math.max(first, at + 1);
      _readStep = _readFirst;
    }
    if (_readTo >= count) return count;
    if (!_readWaiting) {
      _readWaiting = true;
      _readClock
        ..reset()
        ..start();
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _readWaiting = false;
        if (!mounted || !_reading) return;
        // What this frame's pages took, the rest of the frame with them: under a fifth of a frame and the next takes
        // twice as much, over half of one and it takes half.
        final took = _readClock.elapsedMicroseconds;
        if (took < 3000) {
          _readStep = math.min(_readStep * 2, _readMost);
        } else if (took > 8000) {
          _readStep = math.max(_readStep ~/ 2, _readLeast);
        }
        // A page at the least, and as many more as fit in what the frame may add.
        final pages = _chapters;
        var to = _readTo, cost = 0;
        while (to < pages.length) {
          final next = _readCost(pages[to].title);
          if (to > _readTo && cost + next > _readStep) break;
          cost += next;
          to += 1;
        }
        setState(() => _readTo = to);
      });
    }
    return _readTo;
  }

  /// A page of this many letters or more is long, and read straight through its lines are a sliver of the note's
  /// page (`EditorSliver`), built and laid out where they are near the screen as a note's own are. A shorter page,
  /// a few lines, is a box, whole. It was 1500 letters, a screenful: but a page under the window's foot is laid out
  /// whole as a box however short, and the pages come one a frame, so a notebook of pages of a thousand letters
  /// laid each out in a frame of its own before anyone had scrolled to it.
  @visibleForTesting
  static int longPage = 400;

  bool _isLong(_PageRead read, String title) => read.untitled(title).length >= longPage;

  /// The editor's view of each long page being read, by the page's title, for the words it was made for.
  final Map<String, ({String words, EditorView view})> _lazy = <String, ({String words, EditorView view})>{};

  EditorView _lazyView(String title, String words) {
    final had = _lazy[title];
    if (had != null && identical(had.words, words)) return had.view;
    if (had != null) _letGo([had.view]);
    final drawing = widget.drawing;
    final view = EditorView(
      state: EditorState.create(
        doc: words,
        extensions: noteExtensions(display: NoteView.formatted, readOnly: true, formats: drawing?.formats ?? const <InlineFormatSyntax>[], more: drawing?.extensions ?? const <Extension>[]),
      ),
    );
    _lazy[title] = (words: words, view: view);
    return view;
  }

  /// The views of pages no longer read as long ones are let go.
  void _keepLazy(Set<String> titles) {
    if (_lazy.length == titles.length) return;
    final gone = [for (final title in _lazy.keys) if (!titles.contains(title)) title];
    _letGo([for (final title in gone) _lazy.remove(title)!.view]);
  }

  /// Destroyed once the frame is over: the lines drawn from a view are still in the tree until this build is done.
  void _letGo(List<EditorView> views) {
    if (views.isEmpty) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      for (final view in views) {
        view.destroy();
      }
    });
  }

  /// Scrolls the page until [at] is at its top, as `scrollIntoView({ block: 'start' })` does. Where the way there
  /// crosses a long page, how far it is was reckoned from lines not yet laid out (the editor's estimate of their
  /// height), and the page arrives a little off: it is set right once it has arrived, unless the person has moved
  /// it meanwhile.
  Future<void> _goTo(BuildContext at, Duration duration) async {
    final position = Scrollable.maybeOf(at)?.position;
    if (position == null) return;
    double? target() {
      final box = at.mounted ? at.findRenderObject() : null;
      if (box == null || !box.attached) return null;
      final offset = RenderAbstractViewport.maybeOf(box)?.getOffsetToReveal(box, 0).offset;
      return offset?.clamp(position.minScrollExtent, position.maxScrollExtent).toDouble();
    }

    var aimed = target();
    await Scrollable.ensureVisible(at, alignment: 0, duration: duration, curve: Curves.easeOut);
    if (_lazy.isEmpty) return;
    for (var pass = 0; pass < 3; pass += 1) {
      // Somewhere other than where it was sent: the person's doing, and theirs to keep.
      if (!mounted || !_reading || aimed == null || (position.pixels - aimed).abs() > 1) return;
      await WidgetsBinding.instance.endOfFrame;
      if (!mounted || !_reading || (position.pixels - aimed).abs() > 1) return;
      final now = target();
      if (now == null || (now - position.pixels).abs() < 0.5) return;
      position.jumpTo(now);
      aimed = now;
    }
  }

  /// The chapter named in the form, into the index, then opened: as a page of words, or made as an empty canvas.
  void _addNew({bool asCanvas = false}) {
    final name = jsTrim(_draft.text);
    if (name.isEmpty) return;
    final template = pageStarts().where((each) => each.id == _start).firstOrNull?.text ?? '';
    widget.onChange(withChapter(widget.body, name));
    _draft.clear();
    setState(() {
      _start = justTheTitle.id;
      _adding = null;
    });
    if (asCanvas && widget.openCanvas != null) {
      widget.openCanvas!(name);
    } else if (template.isNotEmpty && widget.openNew != null) {
      widget.openNew!(name, template);
    } else {
      widget.open(name);
    }
  }

  /// A ticket named in its form, into the index as a page is, then made by the app and opened.
  void _addTicket() {
    final name = jsTrim(_draft.text);
    final openTicket = widget.openTicket;
    if (name.isEmpty || openTicket == null) return;
    final template = widget.ticketTemplates.where((each) => each.id == _start).firstOrNull;
    widget.onChange(withChapter(widget.body, name));
    _draft.clear();
    setState(() {
      _start = justTheTitle.id;
      _adding = null;
    });
    openTicket(name, template);
  }

  void _addPicked() {
    var next = widget.body;
    for (final name in _picked) {
      next = withChapter(next, name);
    }
    widget.onChange(next);
    _filter.clear();
    setState(() {
      _picked = const <String>[];
      _adding = null;
    });
  }

  /// Either form put away, and what it was holding let go: the next one opens as new.
  void _closeAdding() {
    _filter.clear();
    setState(() {
      _start = justTheTitle.id;
      _picked = const <String>[];
      _adding = null;
    });
  }

  DateTime _now() => widget.clock?.call() ?? DateTime.now();

  /// A page's ways to start: just the title, then the templates, each with a line of how it would start this minute
  /// (`pageLines`).
  List<_StartRow> _pageLines(String title) {
    final now = _now();
    return [
      for (final each in pageStarts())
        (id: each.id, name: each.name, line: each.text.isNotEmpty ? startLine(each.text, widget.title, now) : (title.isNotEmpty ? title : 'The page’s title, and nothing under it')),
    ];
  }

  /// A ticket's ways to start: its key and title alone, then each ticket's template, said in its sentence
  /// (`ticketLines`).
  List<_StartRow> _ticketLines(String? key, String title) {
    final alone = '${key != null && key.isNotEmpty ? '$key-…' : 'Its key'}, ${title.isNotEmpty ? '“$title”' : 'its title'} and its status, and nothing under them';
    return [
      (id: justTheTitle.id, name: justTheTitle.name, line: alone),
      for (final each in widget.ticketTemplates) (id: each.id, name: each.name, line: each.sentence),
    ];
  }

  @override
  Widget build(BuildContext context) {
    if (ghostPerf) Perf.count('book.build');
    final t = context.tokens;
    final em = t.len('app-body');
    final chapters = _chapters;
    final numbers = numbered(chapters);
    // `.book { padding: var(--glacier-space-4) var(--glacier-space-5) var(--glacier-space-8) }`
    final padding = EdgeInsets.fromLTRB(t.space(5), t.space(4), t.space(5), t.space(8));
    // The page's dock, where it has one: the index's own Add a page and Read straight through.
    return DockOffer(
      actions: [
        if (!widget.readOnly)
          DockAction(
            id: 'book-add-page',
            label: 'Add a page',
            glyph: HomeGlyph.plus,
            motion: DockMotion.turn,
            onPressed: () {
              if (_reading) _setReading(false);
              setState(() => _adding = _Adding.page);
            },
          ),
        if (_reading)
          DockAction(id: 'book-index', label: 'Back to the index', tip: 'Index', icon: Lucide.list, onPressed: () => _setReading(false))
        else if (chapters.isNotEmpty)
          DockAction(id: 'book-read', label: 'Read straight through', icon: Lucide.bookOpen, onPressed: () => _setReading(true)),
      ],
      child: OnBack(
        // While a form is open, the back gesture (Escape on a desktop) closes it before it would leave the notebook.
        active: _adding != null && !_reading,
        onBack: _closeAdding,
        child: DefaultTextStyle(
          style: bookText(t, em),
          // A sliver of the note's page (lib/note/note_screen.dart `seams.book`). Reading straight through, a long
          // page's lines are a sliver of their own, so the page lays out those near its window and not the page. The
          // index is one box.
          child: SliverMainAxisGroup(
            slivers: [
              // The index stays in the tree, out of sight, while the pages are read straight through: back at it,
              // its rows and the notebook's own words are the ones that were there, built again where they have
              // changed and laid out where that changed them, where every row was made and laid out from nothing
              // (tool/perf.sh, notebook-index: nineteen rows, one frame of 5 to 13 ms on a Mac and 24 on the Fold).
              // Out of sight it is the widgets it last was: nothing of it is built for a frame of the read-through.
              // A notebook that opens being read has no index until it is gone back to.
              if (!_reading || _indexKept != null)
                SliverOffstage(
                  key: const ValueKey('book-index-sliver'),
                  offstage: _reading,
                  sliver: SliverToBoxAdapter(
                    // A layer of its own: the index is one box in the note's scroller, and without one every row of
                    // it was drawn again at each frame of a scroll.
                    child: _reading ? _indexKept! : (_indexKept = RepaintBoundary(child: Padding(padding: padding, child: _index(context, t, em, chapters, numbers)))),
                  ),
                ),
              if (_reading) KeyedSubtree(key: const ValueKey('book-reading-sliver'), child: _readThrough(context, t, em, chapters, numbers, padding)),
            ],
          ),
        ),
      ),
    );
  }

  /// The index as it was last built, kept while the pages are read straight through.
  Widget? _indexKept;

  // ---- reading straight through ----

  Widget _readThrough(BuildContext context, Tokens t, double em, List<Chapter> chapters, List<String> numbers, EdgeInsets padding) {
    while (_sections.length < chapters.length) {
      _sections.add(GlobalKey(debugLabel: 'book-chapter-${_sections.length}'));
    }
    if (_sections.length > chapters.length) _sections.removeRange(chapters.length, _sections.length);
    final line = snapBorder(context, 1);
    final rule = t.color('glacier-border-subtle');
    final muted = t.color('glacier-text-muted');
    final railEm = 0.8 * em;
    final titleEm = 1.3 * em;

    final soFar = _readSoFar(chapters);

    void scrollTo(int i) {
      final at = _sections[i].currentContext;
      if (at == null) {
        // A page not drawn yet: every page up to it is drawn now, and it is gone to once it is there.
        if (i < chapters.length && i >= _readTo) {
          setState(() => _readTo = i + 1);
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted && _reading && i < _sections.length && _sections[i].currentContext != null) scrollTo(i);
          });
        }
        return;
      }
      _watch?.touched();
      // `scrollIntoView({ behavior: 'smooth', block: 'start' })`
      _goTo(at, t.reducedMotion ? Duration.zero : const Duration(milliseconds: 300));
    }

    // A press or a wheel anywhere over the read-through is the person's (`BookSpotWatch.touched`). The pieces are
    // slivers of the note's page, with no one box round them all to hear it, so each hears it for itself.
    void touched() => _watch?.touched();
    Widget heard(Widget child) => Listener(onPointerDown: (_) => touched(), onPointerSignal: (_) => touched(), child: child);

    // One of the rail's: a page's number and name in a round.
    Widget pill(String words, {required int depth, bool hovered = false}) => Opacity(
          // `.railItem[data-depth='1'] { opacity: 0.85 }`
          opacity: depth == 1 ? 0.85 : 1,
          child: DecoratedBox(
            decoration: BoxDecoration(border: Border.all(color: rule, width: line), borderRadius: BorderRadius.circular(999), color: hovered ? _ink(t, 0.06) : null),
            child: Padding(
              // `padding: 0.3em 0.7em`
              padding: EdgeInsets.symmetric(vertical: 0.3 * railEm + line, horizontal: 0.7 * railEm + line),
              child: cssLines(
                words,
                bookText(t, railEm, color: hovered ? t.color('glacier-text') : muted).copyWith(fontFeatures: const <FontFeature>[FontFeature.tabularFigures()]),
                maxLines: 1,
                softWrap: false,
              ),
            ),
          ),
        );

    // The way back, and the chapters as a rail: a tap scrolls to that one. [room] is the same boxes down its
    // height with nothing in them to press, find or read: what keeps the bar's place in the first run, the bar
    // itself being a sliver over the page (below).
    Widget barOf({required bool room}) => DecoratedBox(
          key: room ? null : const ValueKey('book-read-bar'),
          decoration: BoxDecoration(color: t.color('glacier-bg'), border: Border(bottom: BorderSide(color: rule, width: line))),
          child: Padding(
            // `padding-block: var(--glacier-space-2)`, the line under it inside the box.
            padding: EdgeInsets.only(top: t.space(2), bottom: t.space(2) + line),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              spacing: t.space(2),
              children: [
                if (room)
                  const BookAction(icon: Lucide.list, label: ' ', onPressed: null)
                else
                  BookAction(key: const ValueKey('book-index'), icon: Lucide.list, label: 'Index', onPressed: () => _setReading(false)),
                if (room)
                  // As tall as the rail: one of its rounds, or nothing where the notebook has no page.
                  chapters.isEmpty ? const SizedBox.shrink() : pill(' ', depth: 0)
                else
                  Semantics(
                    container: true,
                    label: 'Pages',
                    child: SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(
                        spacing: t.space(1),
                        children: [
                          for (final (i, chapter) in chapters.indexed)
                            GlacierPressable(
                              key: ValueKey('book-rail-$i'),
                              semanticLabel: '${numbers[i]} ${chapter.title}',
                              excludeSemantics: true,
                              onPressed: () => scrollTo(i),
                              builder: (context, state) => pill('${numbers[i]} ${chapter.title}', depth: chapter.depth, hovered: state.hovered),
                            ),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
          ),
        );

    // A page's title, which opens it.
    Widget titleOf(int i, Chapter chapter, bool canvas) {
      // `.readTitle { margin: 0 0 var(--glacier-space-3); font-size: 1.3em; font-weight: semibold }`. Its
      // `letter-spacing: -0.01em` stops at the button inside it, whose own is the browser's `normal`.
      return Padding(
        padding: EdgeInsets.only(bottom: t.space(3)),
        child: Align(
          alignment: AlignmentDirectional.centerStart,
          child: Transform.translate(
            // `margin-inline-start: -0.2em`
            offset: Offset(-0.2 * titleEm, 0),
            child: GlacierPressable(
              key: ValueKey('book-read-title-$i'),
              semanticLabel: 'Open ${chapter.title}',
              excludeSemantics: true,
              onPressed: () => widget.open(chapter.title),
              builder: (context, state) => DecoratedBox(
                decoration: BoxDecoration(borderRadius: BorderRadius.circular(t.radius('sm')), color: state.hovered ? _ink(t, 0.06) : null),
                child: Padding(
                  // `padding: 0.1em 0.2em`
                  padding: EdgeInsets.symmetric(vertical: 0.1 * titleEm, horizontal: 0.2 * titleEm),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      cssLines(numbers[i], bookText(t, titleEm, weight: 'semibold', color: muted).copyWith(fontFeatures: const <FontFeature>[FontFeature.tabularFigures()]), maxLines: 1, softWrap: false),
                      // `gap: 0.5em`
                      SizedBox(width: 0.5 * titleEm),
                      Flexible(child: cssLines(chapter.title, bookText(t, titleEm, weight: 'semibold'))),
                      if (canvas) CanvasMark(em: titleEm),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      );
    }

    final ratio = MediaQuery.devicePixelRatioOf(context);
    final left = _left;
    // `.book { padding: var(--glacier-space-4) var(--glacier-space-5) var(--glacier-space-8) }`: the sides beside
    // every piece, the top over the first and the foot under the last.
    final side = padding.left, top = padding.top, foot = padding.bottom;
    final border = BoxDecoration(border: Border(bottom: BorderSide(color: rule, width: line)));

    // The pieces of the page, one after another. A run is everything between two long pages, in one box as the
    // whole read-through was: the bar and every short page of a notebook with no long one. A long page is three
    // pieces: its title, its lines (a sliver, built and laid out where they are near the screen as the note's own
    // page has a note's), and the foot of its section.
    final pieces = <Widget>[];
    // The first run begins with the bar's room: laid out, and neither drawn nor pressed.
    var run = <Widget>[Visibility(visible: false, maintainSize: true, maintainAnimation: true, maintainState: true, child: barOf(room: true))];
    var runKey = 'bar';
    void endRun({required bool last}) {
      if (run.isEmpty) {
        // The book ends at a long page's foot: the book's own foot is under it.
        if (last) pieces.add(SliverToBoxAdapter(key: const ValueKey('book-read-end'), child: SizedBox(height: foot)));
        return;
      }
      final first = pieces.isEmpty;
      pieces.add(
        SliverToBoxAdapter(
          key: ValueKey('book-read-run-$runKey'),
          // A layer of its own: a run is one box in the note's scroller, and without one every line of every page
          // in it was drawn again at each frame of a scroll.
          child: RepaintBoundary(
            child: Padding(
              padding: EdgeInsets.fromLTRB(side, first ? top : 0, side, last ? foot : 0),
              child: Listener(
                key: first ? const ValueKey('book-reading') : null,
                onPointerDown: (_) => touched(),
                onPointerSignal: (_) => touched(),
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: run),
              ),
            ),
          ),
        ),
      );
      run = <Widget>[];
    }

    final lazy = <String>{};
    if (_readMade.length > soFar) _readMade.removeWhere((i, _) => i >= soFar);
    for (final (i, chapter) in chapters.indexed.take(soFar)) {
      final read = _pageOf(chapter.title);
      final there = read.there;
      final words = there ? read.words : null;
      final canvas = words != null && read.isCanvas;
      // `[data-depth='1'] { padding-inline-start: 1.6em }`
      final inset = chapter.depth == 1 ? 1.6 * em : 0.0;
      // The page the book was left in is drawn whole, so the line it was left at is where it was measured to be.
      final long = words != null && !canvas && _isLong(read, chapter.title) && !lazy.contains(chapter.title) && !(left != null && sameTitle(chapter.title, left.title));
      final view = long ? _lazyView(chapter.title, read.untitled(chapter.title)) : null;
      // A page's widgets are the ones it had while everything they are made from is what it was: the pages come a
      // few to a frame, and each of those frames made every page before them again, title, words and all.
      final made = (title: chapter.title, depth: chapter.depth, number: numbers[i], read: read, section: _sections[i], view: view, tokens: t, em: em, line: line, ratio: ratio, side: side);
      final had = _readMade[i];
      if (had != null && had.made == made) {
        if (view == null) {
          run.addAll(had.pieces);
        } else {
          endRun(last: false);
          runKey = '${i + 1}';
          lazy.add(chapter.title);
          pieces.addAll(had.pieces);
        }
        continue;
      }
      if (ghostPerf) Perf.count('book.read.page');
      if (view != null) {
        endRun(last: false);
        runKey = '${i + 1}';
        lazy.add(chapter.title);
        final from = pieces.length;
        pieces
          ..add(
            SliverToBoxAdapter(
              key: ValueKey('book-read-head-$i'),
              child: heard(
                Semantics(
                  key: _sections[i],
                  container: true,
                  label: chapter.title,
                  // `.chapterRead`'s padding over its title, as a short page's box has it.
                  child: Padding(padding: EdgeInsets.fromLTRB(side + inset, t.space(6), side, 0), child: titleOf(i, chapter, canvas)),
                ),
              ),
            ),
          )
          ..add(
            _ReadLines(
              key: ValueKey('book-read-body-$i'),
              onTouch: touched,
              sliver: SliverPadding(
                padding: EdgeInsets.only(left: side + inset, right: side),
                sliver: EditorSliver(view: view, env: LookEnv.page(t, devicePixelRatio: ratio, tabSize: view.state.tabSize)),
              ),
            ),
          )
          ..add(
            SliverToBoxAdapter(
              key: ValueKey('book-read-foot-$i'),
              // `.chapterRead`'s padding under its words, and the line under the section.
              child: heard(Padding(padding: EdgeInsets.symmetric(horizontal: side), child: DecoratedBox(decoration: border, child: SizedBox(height: t.space(4) + line)))),
            ),
          );
        _readMade[i] = (made: made, pieces: pieces.sublist(from));
        continue;
      }
      final section =
        Semantics(
          key: _sections[i],
          container: true,
          label: chapter.title,
          // Not a layer of its own, where a row of the index is: a line of a page is set on a whole device
          // pixel, and in a layer that began part-way down the book one line of the page's own pictures came
          // out a device pixel lower (test/book_ui/reference_test.dart, reading straight through).
          child: DecoratedBox(
            decoration: border,
            child: Padding(
              // `.chapterRead { padding-block: var(--glacier-space-6) var(--glacier-space-4) }`, and
              // `[data-depth='1'] { padding-inline-start: 1.6em }`.
              padding: EdgeInsets.fromLTRB(inset, t.space(6), 0, t.space(4) + line),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                mainAxisSize: MainAxisSize.min,
                children: [
                  titleOf(i, chapter, canvas),
                  if (!there)
                    cssLines('Not written yet.', bookText(t, em, color: muted))
                  else if (canvas)
                    cssLines('A canvas: open it to see the cards.', bookText(t, em, color: muted))
                  else if (words != null)
                    MarkdownView(key: ValueKey('book-read-body-$i'), markdown: read.untitled(chapter.title), peek: false, formats: widget.drawing?.formats ?? const <InlineFormatSyntax>[], extensions: widget.drawing?.extensions ?? const <Extension>[]),
                ],
              ),
            ),
          ),
        );
      _readMade[i] = (made: made, pieces: <Widget>[section]);
      run.add(section);
    }
    endRun(last: true);
    _keepLazy(lazy);
    // `.readBar { position: sticky; top: 0; z-index: 2 }`: the bar, first of the slivers and so over the rest, where
    // its room is in the first run until the page has scrolled it up to the top the page keeps, and there from then
    // on. Its box begins where the first run's does, the notebook's padding over it, so it is drawn as it was when
    // it stood in that run.
    final stuck = StuckHead(
      key: const ValueKey('book-read-stuck'),
      top: PageHead.of(context),
      inset: top,
      child: RepaintBoundary(child: Padding(padding: EdgeInsets.fromLTRB(side, top, side, 0), child: heard(barOf(room: false)))),
    );
    return SliverMainAxisGroup(slivers: [stuck, ...pieces]);
  }

  // ---- the index ----

  Widget _index(BuildContext context, Tokens t, double em, List<Chapter> chapters, List<String> numbers) {
    final body = widget.body;
    final readOnly = widget.readOnly;
    final own = _ownOf(chapters);
    final words = own.words;
    final authors = own.authors;
    final ticketKey = own.key;
    final muted = t.color('glacier-text-muted');
    final statusOf = _statusOf;

    final blocks = <Widget>[
      if (authors.isNotEmpty) NoteByline(authors: authors),
      if (words.before.isNotEmpty) BookWords(key: const ValueKey('book-words-before'), words: words.before, known: widget.known, open: widget.open, drawing: widget.drawing),
      if (chapters.isEmpty)
        CssFlow.block(
          // `.empty { margin: var(--glacier-space-3) 0; color: var(--glacier-text-muted) }`
          margin: EdgeInsets.symmetric(vertical: t.space(3)),
          child: cssLines(readOnly ? 'No pages yet.' : 'No pages yet. Add one below, or a note you have already written.', bookText(t, em, color: muted)),
        )
      else
        CssFlow.block(
          key: const ValueKey('book-index-list'),
          // `.index { margin: var(--glacier-space-3) 0 0 }`
          margin: EdgeInsets.only(top: t.space(3)),
          child: Semantics(
            container: true,
            label: 'Pages',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                for (var i = 0; i < chapters.length; i += 1)
                  DragRow(
                    key: ValueKey('book-row-$i'),
                    drag: _drag,
                    index: i,
                    radius: t.radius('sm'),
                    child: _row(context, t, em, chapters, numbers, i),
                  ),
              ],
            ),
          ),
        ),
      if (words.after.isNotEmpty) BookWords(key: const ValueKey('book-words-after'), words: words.after, known: widget.known, open: widget.open, drawing: widget.drawing),
      CssFlow.block(
        key: const ValueKey('book-adds'),
        // `.adds, .add { margin-block-start: var(--glacier-space-4) }`
        margin: EdgeInsets.only(top: t.space(4)),
        child: _adds(context, t, em, chapters, ticketKey),
      ),
      if (statusOf != null && widget.setStatus != null)
        () {
          final workflow = statusesOf(body);
          final ticket = ticketOf(widget.bodyOf?.call(statusOf) ?? '', workflow);
          return FieldPicker(
            pick: StatusPick(value: ticket?.status, workflow: workflow),
            label: 'Status',
            record: ticket?.id != null ? '${ticket!.id} · $statusOf' : statusOf,
            onClose: () => setState(() => _statusOf = null),
            onPick: (status) => widget.setStatus!(statusOf, status),
          );
        }(),
    ];
    return CssFlow(children: blocks);
  }

  /// One row of the index (`.row`): its grip, its number, the chapter and its tools.
  Widget _row(BuildContext context, Tokens t, double em, List<Chapter> chapters, List<String> numbers, int i, {bool ghost = false}) {
    if (ghostPerf) Perf.count('book.row');
    final chapter = chapters[i];
    final body = widget.body;
    final readOnly = widget.readOnly;
    final read = _pageOf(chapter.title);
    final there = read.there;
    final canvas = there && read.canvas;
    final page = read.words ?? '';
    final ticket = there && !canvas ? read.ticket : null;
    final muted = t.color('glacier-text-muted');
    final line = snapBorder(context, 1);
    final setStatus = widget.setStatus;
    final keyOnly = !readOnly && setStatus != null;

    final button = GlacierPressable(
      key: ghost ? null : ValueKey('book-chapter-$i'),
      semanticLabel: there ? (canvas ? '${chapter.title}, a canvas' : chapter.title) : '${chapter.title}, not written yet',
      excludeSemantics: true,
      onPressed: () => widget.open(chapter.title),
      builder: (context, state) => DecoratedBox(
        // `.chapter:hover, .chapter:focus-visible { background: 6% of the ink }`
        decoration: BoxDecoration(borderRadius: BorderRadius.circular(t.radius('sm')), color: state.hovered || state.focused ? _ink(t, 0.06) : null),
        child: Padding(
          // `padding: 0.35em 0.2em`
          padding: EdgeInsets.symmetric(vertical: 0.35 * em, horizontal: 0.2 * em),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            // `gap: 0.1em`
            spacing: 0.1 * em,
            children: [
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  // `.chapterTitle { overflow: hidden; text-overflow: ellipsis; white-space: nowrap }`, and a chapter
                  // with no note yet in the link's own waiting grey.
                  Flexible(child: cssLines(chapter.title, bookText(t, em, color: there ? null : muted), maxLines: 1, softWrap: false, overflow: TextOverflow.ellipsis)),
                  if (canvas) CanvasMark(em: em),
                ],
              ),
              // `.waiting { font-size: 0.75em; color: var(--glacier-text-muted) }`
              if (!there) cssLines('not written yet', bookText(t, 0.75 * em, color: muted), maxLines: 1, softWrap: false),
              if (ticket != null && TicketMark.shows(ticket, keyOnly: keyOnly))
                // The mark's line is the page's here, one and a half times its 11px, where a card's is `normal`.
                SizedBox(key: ghost ? null : ValueKey('book-ticket-$i'), height: 1.5 * t.fontSize('xs'), child: Align(alignment: AlignmentDirectional.centerStart, widthFactor: 1, child: TicketMark.of(ticket, keyOnly: keyOnly))),
            ],
          ),
        ),
      ),
    );

    // A `.tool` has no `font: inherit`: its 2em is of a button's own 13.33px.
    const toolSize = 2 * 13.3333;
    Widget tool(String label, LucideIcon icon, VoidCallback? onPressed) => GlacierPressable(
          semanticLabel: label,
          excludeSemantics: true,
          onPressed: onPressed,
          builder: (context, state) => Opacity(
            // `.tool:disabled { opacity: 0.3 }`
            opacity: state.disabled ? 0.3 : 1,
            child: Container(
              width: toolSize,
              height: toolSize,
              alignment: Alignment.center,
              decoration: BoxDecoration(shape: BoxShape.circle, color: state.hovered && !state.disabled ? _ink(t, 0.08) : null),
              child: lucide(icon, size: 16, color: state.hovered && !state.disabled ? t.color('glacier-text') : muted),
            ),
          ),
        );

    // Each row a layer of its own: a pointer over a row draws that row again, not the index.
    return RepaintBoundary(child: ConstrainedBox(
      // `min-block-size: 2.6em`, the line under the row inside it.
      constraints: BoxConstraints(minHeight: 2.6 * em),
      child: DecoratedBox(
        decoration: BoxDecoration(border: Border(bottom: BorderSide(color: t.color('glacier-border-subtle'), width: line))),
        child: Padding(
          // `.row[data-depth='1'] { padding-inline-start: 1.6em }`
          padding: EdgeInsets.only(left: chapter.depth == 1 ? 1.6 * em : 0, bottom: line),
          // `grid-template-columns: 1.4em 2em minmax(0, 1fr) auto; align-items: center; gap: var(--glacier-space-2)`;
          // read-only (the reader page), `2em minmax(0, 1fr)`.
          child: Row(
            spacing: t.space(2),
            children: [
              if (!readOnly)
                SizedBox(
                  width: 1.4 * em,
                  child: ghost
                      ? SizedBox(height: 2 * em, child: Center(child: lucide(Lucide.gripVertical, size: 16, color: t.color('glacier-text-subtle'))))
                      : RowGrip(
                          key: ValueKey('book-grip-$i'),
                          drag: _drag,
                          index: i,
                          count: chapters.length,
                          em: em,
                          radius: BorderRadius.circular(t.radius('sm')),
                          ghost: (context) => DefaultTextStyle(style: bookText(t, em), child: _row(context, t, em, chapters, numbers, i, ghost: true)),
                        ),
                ),
              SizedBox(
                width: 2 * em,
                // `.number { font-variant-numeric: tabular-nums; color: var(--glacier-text-muted); text-align: end }`
                child: ExcludeSemantics(
                  child: Align(
                    alignment: Alignment.centerRight,
                    child: cssLines(numbers[i], bookText(t, em, color: muted).copyWith(fontFeatures: const <FontFeature>[FontFeature.tabularFigures()]), maxLines: 1, softWrap: false),
                  ),
                ),
              ),
              Expanded(child: button),
              if (!readOnly)
                // `.tools { display: inline-flex; gap: 2px }`
                Row(
                  mainAxisSize: MainAxisSize.min,
                  spacing: 2,
                  children: [
                    if (there && !canvas && setStatus != null && read.isTicket)
                      // As tall as the tools beside it: `.tools` is a flex row, and its children stretch.
                      SizedBox(height: toolSize, child: TicketStatusButton(key: ValueKey('book-status-$i'), body: page, notebook: body, onPress: () => setState(() => _statusOf = chapter.title))),
                    tool('Move ${chapter.title} up', Lucide.chevronUp, i == 0 ? null : () => widget.onChange(withChapterMoved(body, chapter.title, -1))),
                    tool('Move ${chapter.title} down', Lucide.chevronDown, i == chapters.length - 1 ? null : () => widget.onChange(withChapterMoved(body, chapter.title, 1))),
                    tool('Take ${chapter.title} out of the notebook', Lucide.x, () => widget.onChange(withoutChapter(body, chapter.title))),
                  ],
                ),
            ],
          ),
        ),
      ),
    ));
  }

  /// Under the index: the ways to add a page, or the form one of them opened.
  Widget _adds(BuildContext context, Tokens t, double em, List<Chapter> chapters, String? ticketKey) {
    final gap = t.space(2);
    if (widget.readOnly) {
      if (chapters.isEmpty) return const SizedBox.shrink();
      return FlexWrap(gap: gap, children: [BookAction(icon: Lucide.bookOpen, label: 'Read straight through', onPressed: () => _setReading(true))]);
    }
    final adding = _adding;
    final draft = jsTrim(_draft.text);
    if (adding == _Adding.page || adding == _Adding.ticket) {
      final ticket = adding == _Adding.ticket;
      void submit() => ticket ? _addTicket() : _addNew();
      return FlexWrap(
        key: const ValueKey('book-add'),
        gap: gap,
        children: [
          // `.field { flex: 1 1 14rem }`
          FlexItem(
            basis: t.lenOf('14rem'),
            child: _PageField(
              key: ValueKey(ticket ? 'book-ticket-title' : 'book-page-title'),
              label: ticket ? 'New ticket’s title' : "New page's title",
              placeholder: ticket ? 'What needs doing' : 'Page title',
              controller: _draft,
              onSubmitted: submit,
              onEscape: _closeAdding,
            ),
          ),
          if (ticket)
            FlexItem(full: true, child: _starts(context, t, em, 'Start the ticket with', _ticketLines(ticketKey, draft)))
          else if (widget.openNew != null)
            FlexItem(full: true, child: _starts(context, t, em, 'Start the page with', _pageLines(draft))),
          BookAction(key: const ValueKey('book-add-open'), label: 'Add and open', onPressed: draft.isEmpty ? null : submit),
          if (widget.openCanvas != null && !ticket) BookAction(key: const ValueKey('book-add-canvas'), icon: Lucide.workflow, label: 'Add as a canvas', onPressed: draft.isEmpty ? null : () => _addNew(asCanvas: true)),
          BookQuiet(label: 'Cancel', onPressed: _closeAdding),
        ],
      );
    }
    if (adding == _Adding.existing) {
      final needle = jsTrim(_filter.text).toLowerCase();
      final others = [
        for (final title in widget.titles())
          if (jsTrim(title).isNotEmpty && !sameTitle(title, widget.title) && !chapters.any((c) => sameTitle(c.title, title)) && (needle.isEmpty || title.toLowerCase().contains(needle))) title,
      ];
      final line = snapBorder(context, 1);
      final rule = t.color('glacier-border-subtle');
      final muted = t.color('glacier-text-muted');
      return FlexWrap(
        key: const ValueKey('book-add'),
        gap: gap,
        children: [
          FlexItem(basis: t.lenOf('14rem'), child: _PageField(key: const ValueKey('book-find'), label: 'Find a note to add', placeholder: 'Find a note', controller: _filter, onEscape: _closeAdding)),
          FlexItem(
            full: true,
            // `.picker { max-block-size: 16rem; overflow-y: auto; border: 1px solid subtle; border-radius: md }`
            child: Semantics(
              container: true,
              label: 'Notes to add',
              child: Container(
                key: const ValueKey('book-picker'),
                constraints: BoxConstraints(maxHeight: t.lenOf('16rem')),
                decoration: BoxDecoration(border: Border.all(color: rule, width: line), borderRadius: BorderRadius.circular(t.radius('md'))),
                clipBehavior: Clip.antiAlias,
                child: SingleChildScrollView(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (others.isEmpty)
                        Padding(
                          // `.none { padding: 0.6em 0.8em; color: muted; font-size: 0.9em }`
                          padding: EdgeInsets.symmetric(vertical: 0.6 * 0.9 * em, horizontal: 0.8 * 0.9 * em),
                          child: cssLines(needle.isNotEmpty ? 'No note by that name outside the notebook.' : 'Every note is in the notebook already.', bookText(t, 0.9 * em, color: muted)),
                        ),
                      for (final name in others.take(40))
                        () {
                          final on = _picked.any((p) => sameTitle(p, name));
                          return GlacierPressable(
                            key: ValueKey('book-pick:$name'),
                            toggled: on,
                            semanticLabel: name,
                            excludeSemantics: true,
                            onPressed: () => setState(() => _picked = toggledTitle(_picked, name)),
                            builder: (context, state) => DecoratedBox(
                              decoration: BoxDecoration(border: Border(bottom: BorderSide(color: rule, width: line)), color: state.hovered ? _ink(t, 0.06) : null),
                              child: Padding(
                                // `.pick { padding: 0.5em 0.8em; gap: 0.5em }`
                                padding: EdgeInsets.fromLTRB(0.8 * em, 0.5 * em, 0.8 * em, 0.5 * em + line),
                                child: Row(
                                  children: [
                                    PickMark(on: on, size: 1.2 * em),
                                    SizedBox(width: 0.5 * em),
                                    Flexible(child: cssLines(name, bookText(t, em))),
                                    if (_isCanvas(name)) CanvasMark(em: em),
                                  ],
                                ),
                              ),
                            ),
                          );
                        }(),
                    ],
                  ),
                ),
              ),
            ),
          ),
          BookAction(key: const ValueKey('book-add-picked'), label: _picked.length <= 1 ? 'Add' : 'Add ${_picked.length} notes', onPressed: _picked.isEmpty ? null : _addPicked),
          BookQuiet(
            label: 'Cancel',
            onPressed: () => setState(() {
              _picked = const <String>[];
              _adding = null;
            }),
          ),
        ],
      );
    }
    return FlexWrap(
      gap: gap,
      children: [
        BookAction(key: const ValueKey('book-add-page'), icon: Lucide.plus, label: 'Add a page', onPressed: () => setState(() => _adding = _Adding.page)),
        if (widget.openTicket != null && ticketKey != null && ticketKey.isNotEmpty)
          BookAction(key: const ValueKey('book-new-ticket'), icon: Lucide.ticket, label: 'New ticket', onPressed: () => setState(() => _adding = _Adding.ticket)),
        BookAction(key: const ValueKey('book-add-existing'), icon: Lucide.bookOpen, label: 'Add a note you have', onPressed: () => setState(() => _adding = _Adding.existing)),
        if (chapters.isNotEmpty) BookAction(key: const ValueKey('book-read'), icon: Lucide.bookOpen, label: 'Read straight through', onPressed: () => _setReading(true)),
      ],
    );
  }

  /// What a new page starts with, under its title in Add a page (`PageStarts`): just the title, chosen until another
  /// is, then the templates, each with a line of how it would start this minute. A tap chooses; Add and open makes
  /// the page from it. New ticket's the same way, its templates the tickets', each said in its sentence.
  Widget _starts(BuildContext context, Tokens t, double em, String label, List<_StartRow> starts) {
    while (_startNodes.length < starts.length) {
      _startNodes.add(FocusNode(debugLabel: 'start ${_startNodes.length}'));
    }
    final line = snapBorder(context, 1);
    final muted = t.color('glacier-text-muted');
    // The arrows move the choice and the focus together, as a radio group does.
    void step(int from, int by) {
      final to = (from + by + starts.length) % starts.length;
      setState(() => _start = starts[to].id);
      _startNodes[to].requestFocus();
    }

    return Semantics(
      container: true,
      label: label,
      child: Container(
        key: const ValueKey('book-starts'),
        // `.starts { display: grid; gap: 2px; padding: var(--glacier-space-1); border: 1px solid subtle; radius: md }`
        decoration: BoxDecoration(border: Border.all(color: t.color('glacier-border-subtle'), width: line), borderRadius: BorderRadius.circular(t.radius('md'))),
        // (A [Container] keeps its border's width clear of its padding by itself.)
        padding: EdgeInsets.all(t.space(1)),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          spacing: 2,
          children: [
            Padding(
              // `.startsTitle { margin: var(--glacier-space-1) var(--glacier-space-2); font-size: 0.7em;
              // font-weight: bold; letter-spacing: 0.08em; text-transform: uppercase; color: subtle }`
              padding: EdgeInsets.symmetric(vertical: t.space(1), horizontal: t.space(2)),
              child: Semantics(
                label: 'Start with',
                child: ExcludeSemantics(child: cssLines('START WITH', bookText(t, 0.7 * em, weight: 'bold', color: t.color('glacier-text-subtle'), tracking: 0.08 * 0.7 * em))),
              ),
            ),
            for (final (n, each) in starts.indexed)
              () {
                final chosen = _start == each.id;
                return Focus(
                  canRequestFocus: false,
                  skipTraversal: true,
                  onKeyEvent: (node, event) {
                    if (event is KeyUpEvent) return KeyEventResult.ignored;
                    final key = event.logicalKey;
                    if (key == LogicalKeyboardKey.arrowDown || key == LogicalKeyboardKey.arrowRight) {
                      step(n, 1);
                      return KeyEventResult.handled;
                    }
                    if (key == LogicalKeyboardKey.arrowUp || key == LogicalKeyboardKey.arrowLeft) {
                      step(n, -1);
                      return KeyEventResult.handled;
                    }
                    return KeyEventResult.ignored;
                  },
                  child: GlacierPressable(
                    key: ValueKey('book-start:${each.id}'),
                    focusNode: _startNodes[n],
                    // `role="radio" aria-checked`
                    toggled: chosen,
                    semanticLabel: '${each.name}. ${each.line}',
                    excludeSemantics: true,
                    onPressed: () => setState(() => _start = each.id),
                    builder: (context, state) => GlacierFocusRing(
                      visible: state.focused,
                      offset: 1,
                      radius: t.radius('sm'),
                      child: DecoratedBox(
                        // `.start[aria-checked='true'] { border-color: var(--glacier-border-strong); background: 7% }`
                        decoration: BoxDecoration(
                          border: Border.all(color: chosen ? t.color('glacier-border-strong') : const Color(0x00000000), width: line),
                          borderRadius: BorderRadius.circular(t.radius('sm')),
                          color: chosen ? _ink(t, 0.07) : (state.hovered ? _ink(t, 0.05) : null),
                        ),
                        child: Padding(
                          // `.start { display: grid; gap: 2px; padding: var(--glacier-space-2) }`
                          padding: EdgeInsets.all(t.space(2) + line),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            mainAxisSize: MainAxisSize.min,
                            spacing: 2,
                            children: [
                              cssLines(each.name, bookText(t, em, weight: 'semibold')),
                              // How it starts, in two lines at most (`-webkit-line-clamp: 2`).
                              cssLines(each.line, bookText(t, 0.85 * em, color: muted), maxLines: 2, overflow: TextOverflow.ellipsis),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                );
              }(),
          ],
        ),
      ),
    );
  }
}

/// The tick beside a note in a picker (`.pickMark`): an empty ring, filled when the note is picked, with
/// `<Check size={14} />` in the page's ground.
class PickMark extends StatelessWidget {
  const PickMark({super.key, required this.on, required this.size});

  final bool on;
  final double size;

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;
    final ink = t.color('glacier-text');
    return ExcludeSemantics(
      child: Container(
        width: size,
        height: size,
        alignment: Alignment.center,
        decoration: BoxDecoration(shape: BoxShape.circle, color: on ? ink : null, border: Border.all(color: on ? ink : t.color('glacier-border-subtle'), width: snapBorder(context, 1))),
        child: on ? lucide(Lucide.check, size: 14, color: t.color('glacier-bg')) : null,
      ),
    );
  }
}

// ---- what the index's presses do to the library (App.tsx) ---------------------------------------------------------

/// The library's half of a notebook's page: what `open`, `openNew`, `openCanvas`, `openTicket` and `setStatus` do,
/// as `src/app/App.tsx` does them (`openTitleFrom`, `openPageWithin`, `openCanvasWithin`, `openTicketWithin`, and
/// NoteScreen's `setStatus` through `core/query/move.ts`). Every one reads and writes through the [NoteLibrary];
/// what is on screen afterwards is [show]'s, which is the shell's.
///
/// What differs: the page asked the store for its notes again (`listNotes`) where the list in hand could be a
/// moment old; here that is [NoteLibrary.refresh] and then the library's own list. A Templates notebook's pages
/// (`openTemplatePage`) are the shell's to send elsewhere before it calls these.
class BookPages {
  BookPages(this.library, {required this.show, this.clock, this.takenTitles});

  final NoteLibrary library;

  /// Puts a note on screen, in the notebook's tab.
  final void Function(Note note) show;
  final DateTime Function()? clock;

  /// The titles a filled template may not take (`takenTitles`); the library's own where it is left out.
  final Set<String> Function()? takenTitles;

  /// The note by that title, not archived, or null (`titled`).
  Note? titled(String title) => library.value.where((n) => n.archivedAt == null && sameTitle(noteTitle(n.body), title)).firstOrNull;

  /// Whether a note by that title exists (`hasTitle`).
  bool known(String title) => titled(title) != null;

  /// That note's body, or null (`bodyOfTitle`).
  String? bodyOf(String title) => titled(title)?.body;

  /// Opens the note by that title, or makes one that starts as [make] says: a heading, unless told otherwise
  /// (`openTitleFrom`).
  Future<void> open(String title, {String Function(String named)? make}) async {
    final found = titled(title);
    if (found != null) return show(found);
    // The list in hand can be a moment old - a chapter just made from a book's index is not in it yet - so the
    // library is asked once more before a second note by that title is made.
    await library.refresh().catchError((Object _) {});
    final fresh = titled(title);
    if (fresh != null) return show(fresh);
    final made = await library.createNote(make?.call(title) ?? '# $title\n\n');
    await library.refresh().catchError((Object _) {});
    show(library.noteOf(made.id) ?? made);
  }

  /// A notebook's new page from a template: its title as its heading and the template under it ([pageBody]). A
  /// page by that title already written opens as it is (`openPageWithin`).
  Future<void> openNew(String title, String template, String notebook) => open(title, make: (named) => pageBody(named, template, notebook, clock?.call()));

  /// A canvas by that title, made empty first if there is none (`openCanvasWithin`).
  Future<void> openCanvas(String title) => open(title, make: (named) => canvasNoteBody(named, json_canvas.Canvas(nodes: const [], edges: const [])));

  /// A ticket made in a notebook: the notebook's next key, read across every note the library has; its workflow's
  /// first open status; and its template filled for it, or its title alone ([newTicketBody]). A note by that title
  /// already written opens as it is (`openTicketWithin`).
  Future<void> openTicket(String title, String notebook, NoteTemplate? template) async {
    await library.refresh().catchError((Object _) {});
    final id = nextTicketId(notebook, library.value.map((n) => n.body));
    final taken = takenTitles?.call() ?? {for (final n in library.value) titleKey(noteTitle(n.body))};
    final words = template == null ? null : fillNoteTemplate(template, clock?.call() ?? DateTime.now(), taken, nextId: id, title: title).body;
    await open(title, make: (named) => newTicketBody(named, id: id, statuses: statusesOf(notebook), words: words));
  }

  /// A page's ticket status picked in the index, written into that page's front matter, or taken off with null
  /// (`setStatus`, through `core/query/move.ts`).
  Future<void> setStatus(String page, String? status) async {
    final found = titled(page);
    if (found == null) return;
    final next = withProperty(found.body, 'status', status);
    if (next == found.body) return;
    await library.save(found.id, next);
    await library.refresh().catchError((Object _) {});
  }
}


/// A long page's lines, read straight through: drawn, and neither touched nor read out, as a short page's are
/// (`MarkdownView`: `pointer-events: none`, `aria-hidden`). A press or a wheel over them is told to [onTouch] and
/// goes no further, as the box round a short page's lines takes it.
class _ReadLines extends SingleChildRenderObjectWidget {
  const _ReadLines({super.key, required this.onTouch, required Widget sliver}) : super(child: sliver);

  final VoidCallback onTouch;

  @override
  RenderObject createRenderObject(BuildContext context) => _RenderReadLines(onTouch);

  @override
  void updateRenderObject(BuildContext context, covariant _RenderReadLines renderObject) => renderObject.onTouch = onTouch;
}

class _RenderReadLines extends RenderProxySliver {
  _RenderReadLines(this.onTouch);

  VoidCallback onTouch;

  @override
  bool hitTestChildren(SliverHitTestResult result, {required double mainAxisPosition, required double crossAxisPosition}) => false;

  @override
  bool hitTestSelf({required double mainAxisPosition, required double crossAxisPosition}) => true;

  @override
  void handleEvent(PointerEvent event, SliverHitTestEntry entry) {
    if (event is PointerDownEvent || event is PointerSignalEvent) onTouch();
  }

  @override
  void visitChildrenForSemantics(RenderObjectVisitor visitor) {}
}
