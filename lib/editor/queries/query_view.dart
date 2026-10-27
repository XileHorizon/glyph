/// A query's answer, drawn (queries.dart, tauri/docs/QUERIES.md, docs/DESIGN.md §159): a table, a list, a board, a
/// month, a timeline or a count, with a quiet head that says what it lists and how many, a switcher for how it is
/// drawn, and a pencil that opens its lines. Ports `src/app/editor/QueryView.tsx` and `QueryView.module.css`.
/// Everything here is drawing; what is listed, in what order and in which groups is lib/core/query/run.dart's.
///
/// **A value is a button** where the note can be edited (docs/DESIGN.md §169; Matt: "I'd like to be able to click
/// things like done labels in order to change the status … use modals with iconography and color"): a status, a
/// priority, a person and a due, start or scheduled day, in a table's cell, a list's line or a board's card, opens
/// a sheet of its choices (fields/field_picker.dart), and the one picked is written where the record is
/// ([QueryView.onSet]), as a card dragged to another lane is. A to-do's status is its box: To do or Done.
///
/// Its parts: this frame, its head and the list, the table, the month and the count; a record's own pieces
/// (query_parts.dart); the board (query_board.dart); the timeline (query_timeline.dart); the builder
/// (query_builder.dart); things carried between groups (lane_carry.dart); the look (query_look.dart) and the
/// stylesheet's layouts (query_layout.dart).
///
/// What differs:
/// - **The two sheets** (the builder, a field's picker) are built here while they are open, as every sheet of the
///   app is (lib/sheet/sheet.dart puts itself over the page); the page made a portal to the body for each.
/// - **A table** is Flutter's own, its columns as wide as their widest cell and sharing what room is left in
///   proportion, its rows on their cells' baselines, as the page's `<table>` lays itself out. The rule under a row
///   is drawn inside the row's foot; the page's collapsed border straddles the two rows by half a pixel.
/// - **A row carried out of a grouped table** leaves a gap as tall as the row; the copy in the air is the row's
///   name and cells at the widths they have in the table.
/// - **The month's name** is English (lib/core/query/calendar.dart says why).
/// - **The timeline** is Mermaid's own drawing, as the page's is, photographed (query_timeline.dart).
library;

import 'dart:math' as math;

import 'package:flutter/widgets.dart';
import 'package:glacier/glacier.dart' show HapticKind, fireMotor;

import '../../art/app_icon.dart';
import '../../art/lucide.g.dart';
import '../../core/properties.dart' show StatusCategory;
import '../../core/query/query.dart';
import '../fields/field_picker.dart';
import '../fields/field_picks.dart';
import '../items/field_chips.dart' show daySaid;
import '../items/field_menu.dart' show DayPicker;
import 'lane_carry.dart';
import 'query_board.dart';
import 'query_builder.dart';
import 'query_timeline.dart';
import 'query_layout.dart';
import 'query_look.dart';
import 'query_parts.dart';

/// The ways a query can be shown, for the switcher: each with its mark and a word, in the order docs/QUERIES.md
/// teaches (`VIEWS`).
const Map<ShowAs, ({LucideIcon icon, String label})> queryViews = <ShowAs, ({LucideIcon icon, String label})>{
  ShowAs.table: (icon: Lucide.table, label: 'Table'),
  ShowAs.list: (icon: Lucide.list, label: 'List'),
  ShowAs.board: (icon: Lucide.squareKanban, label: 'Board'),
  ShowAs.calendar: (icon: Lucide.calendarDays, label: 'Calendar'),
  ShowAs.gantt: (icon: Lucide.chartGantt, label: 'Timeline'),
  ShowAs.count: (icon: Lucide.sigma, label: 'Count'),
};

/// A sheet open on one record's field (`Picking`).
class _Picking {
  const _Picking(this.row, this.field, this.label, this.pick);
  final QueryRow row;
  final String field;
  final String label;
  final FieldPick pick;
}

class QueryView extends StatefulWidget {
  const QueryView({
    super.key,
    required this.look,
    required this.lines,
    required this.problem,
    required this.result,
    this.dayEvents = const [],
    required this.editable,
    bool? linesEditable,
    this.today,
    this.locale,
    this.height,
    this.onHeight,
    this.onBody,
    required this.onEdit,
    required this.onOpen,
    required this.onTick,
    required this.onMove,
    this.onSet,
    this.onAdd,
    this.people,
    this.dayPicker,
  }) : linesEditable = linesEditable ?? editable;

  final QueryLook look;

  /// The fence's lines, shown with the problem where they cannot be read.
  final String lines;
  final QueryProblem? problem;

  /// Null where the lines cannot be read, or there is no library to read.
  final QueryResult? result;

  /// The calendars' events, as rows, that a calendar of to-dos shows quieter beside its own (docs/CALENDAR.md).
  final List<QueryRow> dayEvents;

  /// Whether what the query lists can be changed from it: a card carried, a box ticked, a field picked.
  final bool editable;

  /// Whether the query's own lines can be: the pencil, the switcher and the builder at its head. As [editable]
  /// unless given; false in a notebook's own words, drawn read only, where the tickets on its board are still the
  /// person's to move (queries.dart `QueryOptions.listedWritable`).
  final bool linesEditable;

  /// The day the days are named from; the result's own where none is given.
  final String? today;
  final String? locale;

  /// A board's lanes' height from the fence (`height=18`), in their own ems; null for the board's own.
  final double? height;

  /// Writes a board's height into the fence, or takes it out with null.
  final void Function(double? height)? onHeight;

  /// Writes the whole fence body back, one clause changed: the view switcher and the builder. Absent where the lines
  /// cannot be edited.
  final void Function(String body)? onBody;
  final VoidCallback onEdit;
  final void Function(QueryRow row) onOpen;
  final void Function(QueryRow row) onTick;

  /// A card dragged to another lane of a board: its grouped field set to the lane's value, or cleared with null.
  final void Function(QueryRow row, String? value) onMove;

  /// One field of a record set to a value picked in a sheet, or taken off with null. Absent, nothing is picked.
  final void Function(QueryRow row, String field, String? value)? onSet;

  /// A ticket made from a lane of a board, by the words typed at the lane's +: `lane` is the lane's value in the
  /// grouped field, null for a board that is not grouped. Absent, a board's lanes have no +.
  final void Function(String? lane, String title)? onAdd;

  /// The people the library names, the most named first: who a person's sheet offers. Read when it opens.
  final List<String> Function()? people;

  /// The app's calendar, for a day's sheet's Pick a date.
  final DayPicker? dayPicker;

  @override
  State<QueryView> createState() => QueryViewState();
}

class QueryViewState extends State<QueryView> {
  bool _building = false;
  _Picking? _picking;

  /// The pointer that went down on a control of a thing that can be carried.
  int controlPointer = -1;

  QueryLook get look => widget.look;

  QueryActs _acts(QueryResult result) {
    final canPick = widget.editable && widget.onSet != null;
    return QueryActs(
      today: widget.today ?? result.today,
      locale: widget.locale,
      editable: widget.editable,
      onOpen: widget.onOpen,
      onTick: widget.onTick,
      onMove: widget.onMove,
      onAdd: widget.editable ? widget.onAdd : null,
      onControl: (pointer) => controlPointer = pointer,
      pickable: (row, field) => canPick && picksField(row, field),
      pick: (row, column, cell) {
        final pick = pickOf(row, column.field, cell, widget.today ?? result.today, widget.people ?? () => const <String>[]);
        if (pick == null) return;
        fireMotor(HapticKind.selection);
        setState(() => _picking = _Picking(row, column.field, column.label, pick));
      },
    );
  }

  Widget _frame(String label, List<Widget> children) {
    // .query { margin-block: var(--glacier-space-1) var(--glacier-space-3);
    //   padding: var(--glacier-space-2) var(--glacier-space-3) var(--glacier-space-3);
    //   border: 1px solid var(--app-rule); border-radius: var(--glacier-radius-lg); background: var(--app-paper-2) }
    return Padding(
      // '.cm-query': { paddingBlock: '0.4em', paddingInline: 'var(--cm-board-bleed, …)' }
      padding: EdgeInsets.fromLTRB(look.bleed, look.blockEnds + look.space(1), look.bleed, look.blockEnds + look.space(3)),
      child: Semantics(
        container: true,
        label: label,
        child: Part(
          'query',
          child: Container(
            // The padding at the sides is each piece's own, so a table and a board can run out to the card's edge
            // and scroll there (`margin-inline: calc(-1 * var(--glacier-space-3))` on the page).
            padding: EdgeInsets.only(top: look.space(2), bottom: look.space(3)),
            decoration: BoxDecoration(color: look.paper2, border: Border.all(color: look.rule, width: look.hair), borderRadius: BorderRadius.circular(look.cardRadius)),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                for (final child in children) child is QueryTable || child is QueryBoard ? child : Padding(padding: EdgeInsets.symmetric(horizontal: look.space(3)), child: child),
              ],
            ),
          ),
        ),
      ),
    );
  }

  /// `.warning, .empty { margin: var(--glacier-space-1) 0; color: var(--app-ink-3) }`, the margins of two that meet
  /// run into one.
  Widget _quiet(String name, String text, {bool first = true}) => Padding(
    padding: EdgeInsets.only(top: first ? look.space(1) : 0, bottom: look.space(1)),
    child: Part(name, child: PageWords(text, look.sans(look.em, color: look.ink3), line: look.line)),
  );

  @override
  Widget build(BuildContext context) {
    final problem = widget.problem;
    final result = widget.result;
    if (problem != null || result == null) {
      return _frame('Query', <Widget>[
        QueryHead(look: look, title: 'Query', count: null, editable: widget.linesEditable, onEdit: widget.onEdit),
        // .lines { padding: var(--glacier-space-2) var(--glacier-space-3); border-radius: var(--glacier-radius-md);
        //   background: var(--app-paper); font-family: var(--glacier-font-mono);
        //   font-size: var(--glacier-font-size-xs); line-height: 1.6; white-space: pre-wrap; color: var(--app-ink-2) }
        Part(
          'lines',
          child: Container(
            padding: EdgeInsets.symmetric(horizontal: look.space(3), vertical: look.space(2)),
            decoration: BoxDecoration(color: look.paper, borderRadius: BorderRadius.circular(look.t.radius('md'))),
            child: PageWords(widget.lines, look.mono(look.xs, color: look.ink2), line: pageLine(look.xs, 1.6)),
          ),
        ),
        if (problem != null)
          // .problem { display: flex; gap: var(--glacier-space-2); margin: var(--glacier-space-2) 0 0;
          //   color: var(--glacier-amber-11) }  .problemMark { flex: none; margin-block-start: 0.2em }
          Padding(
            padding: EdgeInsets.only(top: look.space(2)),
            child: Part(
              'problem',
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Padding(padding: EdgeInsets.only(top: 0.2 * look.em), child: AppIcon(Lucide.triangleAlert, size: look.em, strokeWidth: 2.2, color: look.t.color('glacier-amber-11'))),
                  SizedBox(width: look.space(2)),
                  Expanded(child: Part('problemWords', child: PageWords('Line ${problem.line}, column ${problem.column}: ${problem.message}', look.sans(look.em, color: look.t.color('glacier-amber-11')), line: look.line))),
                ],
              ),
            ),
          ),
      ]);
    }
    final acts = _acts(result);
    final words = kindWords[result.kind]!;
    final count = result.shown < result.matched ? '${result.shown} of ${result.matched}' : '${result.matched}';
    final rows = <QueryRow>[for (final group in result.groups) ...group.rows];
    final empty = result.matched == 0 && result.show != ShowAs.count;
    final onBody = widget.onBody;
    final picking = _picking;
    final onSet = widget.onSet;
    final nothing = empty && !(result.show == ShowAs.board && result.groups.length > 1) && !(result.show == ShowAs.calendar && widget.dayEvents.isNotEmpty);
    final totals = result.totals.isNotEmpty && result.show != ShowAs.table && result.show != ShowAs.count;
    return _frame('Query: $words', <Widget>[
      QueryHead(
        look: look,
        title: words,
        count: count,
        editable: widget.linesEditable,
        onEdit: widget.onEdit,
        show: result.show,
        onShow: onBody == null ? null : (way) => onBody(withShow(widget.lines, way)),
        onBuild: onBody == null ? null : () => setState(() => _building = true),
      ),
      for (final (index, warning) in result.warnings.indexed) _quiet('warning', warning, first: index == 0),
      if (nothing)
        _quiet('empty', 'Nothing matches this query yet.', first: result.warnings.isEmpty)
      else
        switch (result.show) {
          ShowAs.table => QueryTable(look: look, result: result, acts: acts, state: this),
          ShowAs.board => QueryBoard(look: look, result: result, acts: acts, state: this, height: widget.height, onHeight: widget.onHeight),
          ShowAs.calendar => QueryCalendar(look: look, rows: rows, acts: acts, events: widget.dayEvents),
          ShowAs.gantt => QueryGantt(look: look, result: result, today: acts.today),
          ShowAs.count => QueryCount(look: look, result: result),
          ShowAs.list => QueryList(look: look, result: result, acts: acts, state: this),
        },
      if (totals) QueryTotals(look: look, totals: result.totals),
      if (_building && onBody != null)
        QueryBuilder(
          body: widget.lines,
          onBody: onBody,
          onLines: () {
            setState(() => _building = false);
            widget.onEdit();
          },
          onClose: () => setState(() => _building = false),
        ),
      if (picking != null && onSet != null)
        FieldPicker(
          pick: picking.pick,
          label: picking.label,
          record: picking.row.id != null && picking.row.id!.isNotEmpty ? '${picking.row.id} · ${picking.row.name}' : picking.row.name,
          dayPicker: widget.dayPicker,
          onClose: () => setState(() => _picking = null),
          onPick: (value) {
            fireMotor(HapticKind.selection);
            // A to-do's status is its box: ticked or cleared, only where that is a change.
            final pick = picking.pick;
            if (pick is BoxPick) {
              if ((value == 'done') != pick.done) widget.onTick(picking.row);
              return;
            }
            onSet(picking.row, picking.field, value);
          },
        ),
    ]);
  }
}

/// A round button of the head or the month's bar: `.edit, .turn`.
class _RoundButton extends StatelessWidget {
  const _RoundButton({required this.look, required this.name, required this.icon, required this.label, required this.onTap, this.stroke = 2.2});

  final QueryLook look;
  final String name;
  final LucideIcon icon;
  final String label;
  final VoidCallback onTap;
  final double stroke;

  @override
  Widget build(BuildContext context) {
    // .edit, .turn { display: inline-flex; align-items: center; justify-content: center;
    //   inline-size: var(--glacier-space-8); block-size: var(--glacier-space-8);
    //   border-radius: var(--glacier-radius-full); background: transparent; color: var(--app-ink-3) }
    final size = look.space(8);
    return Semantics(
      container: true,
      button: true,
      label: label,
      onTap: onTap,
      excludeSemantics: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: Part(
          name,
          child: SizedBox(
            width: size,
            height: size,
            child: Center(child: AppIcon(icon, size: look.em, strokeWidth: stroke, color: look.ink3)),
          ),
        ),
      ),
    );
  }
}

/// The quiet head: what the query lists, how many, a switcher for how it is drawn, and the pencil that shows its
/// lines (`Head`). The switcher writes only the `show:` line, so a list becomes a board or a table with its `from:`
/// and `where:` kept, the way a database's view tabs do; it is there only where the lines can be edited.
class QueryHead extends StatelessWidget {
  const QueryHead({super.key, required this.look, required this.title, required this.count, required this.editable, required this.onEdit, this.show, this.onShow, this.onBuild});

  final QueryLook look;
  final String title;
  final String? count;
  final bool editable;
  final VoidCallback onEdit;
  final ShowAs? show;
  final void Function(ShowAs show)? onShow;
  final VoidCallback? onBuild;

  @override
  Widget build(BuildContext context) {
    final show = this.show;
    final onShow = this.onShow;
    final onBuild = this.onBuild;
    final switcher = editable && show != null && onShow != null;
    final builds = editable && onBuild != null;
    // .view { flex: none; inline-size: var(--glacier-space-6); block-size: var(--glacier-space-6);
    //   border-radius: var(--glacier-radius-full); color: var(--app-ink-3) }
    // .view[data-here] { color: var(--app-ink); background: var(--glacier-bg);
    //   box-shadow: 0 1px 2px color-mix(in srgb, #000 16%, transparent) }
    final side = look.space(6);
    Widget view(ShowAs way) {
      final here = way == show;
      final label = queryViews[way]!.label;
      void press() {
        if (here) return;
        fireMotor(HapticKind.selection);
        onShow!(way);
      }

      return Semantics(
        container: true,
        button: true,
        selected: here,
        label: 'Show as a ${label.toLowerCase()}',
        onTap: press,
        excludeSemantics: true,
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: press,
          child: Part(
            'view',
            child: Container(
              width: side,
              height: side,
              decoration: here
                  ? ShapeDecoration(color: look.t.color('glacier-bg'), shape: const CircleBorder(), shadows: const <BoxShadow>[BoxShadow(color: Color(0x29000000), offset: Offset(0, 1), blurRadius: 2)])
                  : null,
              child: Center(child: AppIcon(queryViews[way]!.icon, size: look.em, strokeWidth: 2.2, color: here ? look.ink : look.ink3)),
            ),
          ),
        ),
      );
    }

    // .head { display: flex; align-items: center; gap: var(--glacier-space-2);
    //   min-block-size: var(--glacier-space-8); color: var(--app-ink-3) }
    return Part(
      'head',
      child: CssRow(
        gap: look.space(2),
        minHeight: look.space(8),
        children: <Widget>[
          // .title { font-size: var(--glacier-font-size-xs); font-weight: var(--glacier-font-weight-semibold);
          //   letter-spacing: 0.06em; text-transform: uppercase }
          CssItem(least: 0, child: Part('title', child: PageWords(title.toUpperCase(), look.sans(look.xs, weight: 'semibold', color: look.ink3, tracking: 0.06 * look.xs), line: look.lineXs))),
          // .count { font-size: var(--glacier-font-size-xs); font-variant-numeric: tabular-nums; color: var(--app-ink-3) }
          if (count != null) Part('count', child: PageWords(count!, look.sans(look.xs, color: look.ink3, tabular: true), line: look.lineXs, softWrap: false)),
          if (switcher)
            // .views { display: inline-flex; align-items: center; gap: 1px; margin-inline-start: auto; padding: 2px;
            //   border-radius: var(--glacier-radius-full);
            //   background: color-mix(in oklch, var(--app-ink-3) 10%, transparent); max-inline-size: 100%;
            //   overflow-x: auto }
            CssItem(
              least: 0,
              pushed: true,
              inset: 4,
              child: Semantics(
                container: true,
                label: 'How to show the query',
                child: Part(
                  'views',
                  child: Container(
                    decoration: ShapeDecoration(color: QueryLook.mix(look.ink3, 0.1), shape: const StadiumBorder()),
                    clipBehavior: Clip.antiAlias,
                    child: SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      padding: const EdgeInsets.all(2),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: <Widget>[
                          for (final (index, way) in ShowAs.values.indexed) ...<Widget>[if (index > 0) const SizedBox(width: 1), view(way)],
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          // .edit { margin-inline-start: auto }  .edit + .edit { margin-inline-start: 0 }
          // .views + .edit { margin-inline-start: var(--glacier-space-1) }
          if (builds)
            CssItem(
              least: look.em,
              pushed: !switcher,
              before: switcher ? look.space(1) : 0,
              child: _RoundButton(look: look, name: 'edit', icon: Lucide.slidersHorizontal, label: 'Build the query', onTap: onBuild),
            ),
          if (editable)
            CssItem(
              least: look.em,
              pushed: !switcher && !builds,
              before: switcher && !builds ? look.space(1) : 0,
              child: _RoundButton(look: look, name: 'edit', icon: Lucide.pencil, label: 'Edit the query', onTap: onEdit),
            ),
        ],
      ),
    );
  }
}

/// A list's row: a to-do's box, a ticket's key on its own line, the name and the cells beside it (`.row`).
class QueryRowLine extends StatelessWidget {
  const QueryRowLine({super.key, required this.look, required this.row, required this.acts, this.result, this.first = false, this.keyLine = true});

  final QueryLook look;
  final QueryRow row;
  final QueryActs acts;

  /// The query it is a row of, for the cells beside its name; null draws the name alone (a day's list).
  final QueryResult? result;
  final bool first;
  final bool keyLine;

  @override
  Widget build(BuildContext context) {
    final result = this.result;
    final id = row.id;
    final keyed = keyLine && id != null && id.isNotEmpty;
    // .rowBody { display: flex; flex-wrap: wrap; align-items: baseline; column-gap: var(--glacier-space-2);
    //   row-gap: var(--glacier-space-1); flex: 1; min-inline-size: 0; padding-block: var(--glacier-space-1) }
    final body = Part(
      'rowBody',
      child: Padding(
        padding: EdgeInsets.symmetric(vertical: look.space(1)),
        child: CssWrap(
          gap: look.space(2),
          rowGap: look.space(1),
          align: CssAlign.baseline,
          children: <Widget>[
            if (keyed) CssItem(whole: true, child: QueryKeyLine(look: look, id: id)),
            QueryName(look: look, row: row, acts: acts, hideKey: keyLine),
            if (result != null && QueryMeta.has(row, result)) QueryMeta(look: look, row: row, result: result, acts: acts),
          ],
        ),
      ),
    );
    // .row { display: flex; align-items: flex-start; gap: var(--glacier-space-2);
    //   min-block-size: var(--glacier-space-10); padding-block: var(--glacier-space-1);
    //   border-block-start: 1px solid var(--app-rule) }  .rows > .row:first-child { border-block-start: 0 }
    return Part(
      'row',
      child: Container(
        constraints: BoxConstraints(minHeight: look.space(10)),
        padding: EdgeInsets.symmetric(vertical: look.space(1)),
        decoration: first ? null : BoxDecoration(border: Border(top: BorderSide(color: look.rule, width: look.hair))),
        child: Stack(
          children: <Widget>[
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                if (QueryBox.has(row)) ...<Widget>[QueryBox(look: look, row: row, acts: acts), SizedBox(width: look.space(2))],
                Expanded(child: body),
              ],
            ),
            if (QueryBox.has(row)) QueryBoxReach(look: look, row: row, acts: acts, drop: QueryBox.rowDrop(look)),
          ],
        ),
      ),
    );
  }
}

/// `.group[data-over]`: a grouped list's or table's group a carried row is held over, ready to take it.
class _GroupOver extends StatelessWidget {
  const _GroupOver({required this.look, required this.over, required this.child, this.inset = 0});

  final QueryLook look;
  final bool over;
  final Widget child;

  /// How far in from each side the group's own box is, where what it holds runs out past it (a table).
  final double inset;

  @override
  Widget build(BuildContext context) {
    if (!over) return child;
    if (inset > 0) {
      return Stack(
        children: <Widget>[
          Positioned.fill(left: inset, right: inset, child: _GroupOver(look: look, over: true, child: const SizedBox.expand())),
          child,
        ],
      );
    }
    // .group[data-over] { border-radius: var(--glacier-radius-md);
    //   background: color-mix(in oklch, var(--app-ink) 6%, transparent);
    //   outline: 1px dashed color-mix(in oklch, var(--app-ink) 35%, transparent); outline-offset: 2px }
    return DecoratedBox(
      decoration: BoxDecoration(color: QueryLook.mix(look.ink, 0.06), borderRadius: BorderRadius.circular(look.t.radius('md'))),
      child: CustomPaint(foregroundPainter: DashedOutline(QueryLook.mix(look.ink, 0.35), look.t.radius('md'), offset: 2), child: child),
    );
  }
}

/// The query as a list (`ListView`): grouped and writable, a row is carried to another group as a board's card is.
class QueryList extends StatefulWidget {
  const QueryList({super.key, required this.look, required this.result, required this.acts, required this.state});

  final QueryLook look;
  final QueryResult result;
  final QueryActs acts;
  final QueryViewState state;

  @override
  State<QueryList> createState() => _QueryListState();
}

class _QueryListState extends State<QueryList> {
  late final LaneCarry _lanes = LaneCarry(context: () => context, redraw: () => setState(() {}));

  @override
  void dispose() {
    _lanes.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final look = widget.look;
    final result = widget.result;
    final acts = widget.acts;
    _lanes.update(result, acts, control: () => widget.state.controlPointer);
    final groups = <Widget>[];
    for (final (index, group) in result.groups.indexed) {
      // .groups { display: grid; gap: var(--glacier-space-3) }  .group + .group { margin-block-start: var(--glacier-space-2) }
      if (index > 0) groups.add(SizedBox(height: look.space(3) + look.space(2)));
      final gap = _lanes.gapIn(group);
      final rows = <Widget>[];
      for (final row in group.rows) {
        if (_lanes.hidden(row, group)) continue;
        final first = rows.isEmpty;
        Widget line(bool live) => QueryRowLine(look: look, row: row, acts: live ? acts : _still(acts), result: result, first: first);
        rows.add(_lanes.thing(row, group, key: ValueKey<String>('row ${row.key}'), look: look, copy: () => SizedBox(width: _lanes.carried?.size.width, child: line(false)), child: line(true)));
      }
      if (gap != null) rows.add(SizedBox(height: gap));
      groups.add(
        _lanes.lane(
          group,
          child: Part(
            'group',
            child: _GroupOver(
              look: look,
              over: _lanes.isOver(group),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[if (result.group != null) QueryGroupHead(look: look, group: group), Part('rows', child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: rows))],
              ),
            ),
          ),
        ),
      );
    }
    return Part('groups', child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: groups));
  }
}

/// The acts of a copy in the air: drawn as the thing, with nothing to press.
QueryActs _still(QueryActs acts) => QueryActs(today: acts.today, locale: acts.locale, editable: false, onOpen: (_) {}, onTick: (_) {}, onMove: (_, _) {}, pickable: (_, _) => false, pick: (_, _, _) {});

/// A table's column: as wide as its widest cell, and a share of what room is left in proportion to that, the way a
/// browser's automatic table layout hands the room out.
class _WidestColumn extends TableColumnWidth {
  const _WidestColumn([this.least = 0]);

  final double least;

  double _widest(Iterable<RenderBox> cells) {
    var most = least;
    for (final cell in cells) {
      most = math.max(most, cell.getMaxIntrinsicWidth(double.infinity));
    }
    return most;
  }

  @override
  double minIntrinsicWidth(Iterable<RenderBox> cells, double containerWidth) => _widest(cells);

  @override
  double maxIntrinsicWidth(Iterable<RenderBox> cells, double containerWidth) => _widest(cells);

  @override
  double? flex(Iterable<RenderBox> cells) => _widest(cells);
}

/// The query as a table (`TableView`).
class QueryTable extends StatefulWidget {
  const QueryTable({super.key, required this.look, required this.result, required this.acts, required this.state});

  final QueryLook look;
  final QueryResult result;
  final QueryActs acts;
  final QueryViewState state;

  @override
  State<QueryTable> createState() => _QueryTableState();
}

class _QueryTableState extends State<QueryTable> {
  late final LaneCarry _lanes = LaneCarry(context: () => context, redraw: () => setState(() {}));

  @override
  void dispose() {
    _lanes.dispose();
    super.dispose();
  }

  /// The look inside the table, where every figure is tabular.
  QueryLook get look => widget.look.tabled;

  /// A cell's padding and the half of the rule it shares with the row above or below it.
  // .table th, .table td { padding: var(--glacier-space-2) var(--glacier-space-3) var(--glacier-space-2) 0;
  //   border-block-end: 1px solid var(--app-rule); text-align: start; vertical-align: baseline; white-space: nowrap }
  Widget _cell(String name, Widget? child, {required double ends, required double above, required double below, bool fills = false}) => Part(
    name,
    child: Padding(
      padding: EdgeInsets.fromLTRB(0, above + ends, look.space(3), ends + below),
      child: Row(
        mainAxisSize: fills ? MainAxisSize.max : MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.baseline,
        textBaseline: TextBaseline.alphabetic,
        // A cell's line is the card's line however small what stands on it.
        children: <Widget>[PageWords('', look.sans(look.em), line: look.line), if (child != null) (fills ? Expanded(child: child) : child)],
      ),
    ),
  );

  /// A name's cell with a box in it stands on the box's foot, not on the name's letters: a flex container's baseline
  /// is its first item's, and a box has none but its own lower edge. The row's other cells come down to it.
  Widget _nameInner(bool boxed, Widget inner) => boxed ? Baselined(baseline: 0.15 * buttonType + QueryBox.size(), child: inner) : inner;

  Widget _table(QueryGroup group, {required bool foot}) {
    final result = widget.result;
    final acts = widget.acts;
    final totals = <String, String>{for (final total in result.totals) total.field: total.text};
    final rule = BorderSide(color: look.rule, width: look.hair);
    final keyed = result.columns.any((column) => column.field == 'id');
    final rows = <TableRow>[
      // .table thead th { padding-block: var(--glacier-space-1); font-size: var(--glacier-font-size-xs);
      //   font-weight: var(--glacier-font-weight-semibold); color: var(--app-ink-3) }
      TableRow(
        decoration: BoxDecoration(border: Border(bottom: rule)),
        children: <Widget>[
          for (final column in result.columns)
            Part(
              'th',
              child: Padding(
                padding: EdgeInsets.fromLTRB(0, look.space(1), look.space(3), look.space(1) + look.hair / 2),
                child: Part('thWords', child: PageWords(column.label, look.sans(look.xs, weight: 'semibold', color: look.ink3, tabular: true), line: look.lineXs, softWrap: false)),
              ),
            ),
        ],
      ),
    ];
    final shown = <QueryRow>[for (final row in group.rows) if (!_lanes.hidden(row, group)) row];
    final gap = _lanes.gapIn(group);
    for (final (at, row) in shown.indexed) {
      final quiet = row.category == StatusCategory.done || row.done == true;
      final last = at == shown.length - 1 && gap == null;
      List<Widget> cells(QueryActs acts) => <Widget>[
        for (final (index, column) in result.columns.indexed)
          if (index == result.opens)
            // .table .nameCell { min-inline-size: 10rem; font-weight: var(--glacier-font-weight-regular) }
            // .nameCellInner { display: flex; align-items: flex-start; gap: var(--glacier-space-2) }
            _cell(
              'nameCell',
              _nameInner(
                QueryBox.has(row),
                Part(
                  'nameCellInner',
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      // .nameCellInner .box { margin-block-start: 0.15em }
                      if (QueryBox.has(row)) ...<Widget>[QueryBox(look: look, row: row, acts: acts, drop: 0.15 * buttonType), SizedBox(width: look.space(2))],
                      QueryName(look: look, row: row, acts: acts, hideKey: column.field == 'title' && keyed, wrap: false),
                    ],
                  ),
                ),
              ),
              ends: look.space(2),
              above: look.hair / 2,
              below: last ? 0 : look.hair / 2,
              fills: true,
            )
          else
            _cell(
              'td',
              QueryPicked(
                look: look,
                row: row,
                column: column,
                cell: row.cells[index],
                acts: acts,
                child: cellView(look, row.cells[index], field: column.field, acts: acts, quiet: quiet, brief: false, workflow: row.workflow, parent: look.em) ?? const SizedBox.shrink(),
              ),
              ends: look.space(2),
              above: look.hair / 2,
              below: last ? 0 : look.hair / 2,
            ),
      ];
      rows.add(
        TableRow(
          key: ValueKey<String>('tr ${row.key}'),
          // .table tbody tr:last-child th, .table tbody tr:last-child td { border-block-end: 0 }
          decoration: last ? null : BoxDecoration(border: Border(bottom: rule)),
          children: <Widget>[
            for (final (index, cell) in cells(acts).indexed)
              _lanes.cell(row, group, index: index, columns: result.columns.length, copy: () => _lifted(cells(_still(acts))), child: cell),
          ],
        ),
      );
    }
    if (gap != null) rows.add(TableRow(children: <Widget>[SizedBox(height: gap), for (var index = 1; index < result.columns.length; index += 1) const SizedBox.shrink()]));
    if (foot) {
      // .table tfoot td { border-block-start: 1px solid var(--app-rule); border-block-end: 0; color: var(--app-ink-3) }
      rows.add(
        TableRow(
          decoration: BoxDecoration(border: Border(top: rule)),
          children: <Widget>[
            for (final (index, column) in result.columns.indexed)
              _cell(
                'td',
                totals.containsKey(column.field)
                    ? PageWords(totals[column.field]!, look.sans(look.em, weight: 'bold', color: look.ink3, tabular: true), line: look.line, softWrap: false)
                    : (index == 0 ? PageWords('Total', look.sans(look.em, color: look.ink3), line: look.line, softWrap: false) : null),
                ends: look.space(2),
                above: look.hair / 2,
                below: 0,
              ),
          ],
        ),
      );
    }
    final rem = look.t.lenOf('1rem');
    final columns = <int, TableColumnWidth>{
      for (final (index, _) in result.columns.indexed) index: _WidestColumn(index == result.opens ? 10 * rem : 0),
    };
    // .tableScroll { overflow-x: auto; margin-inline: calc(-1 * var(--glacier-space-3));
    //   padding-inline: var(--glacier-space-3) }
    // .table { inline-size: max-content; min-inline-size: 100%; border-collapse: collapse }
    return LayoutBuilder(
      builder: (context, constraints) => Part(
        'tableScroll',
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: EdgeInsets.symmetric(horizontal: look.space(3)),
          child: ConstrainedBox(
            constraints: BoxConstraints(minWidth: math.max(0, constraints.maxWidth - 2 * look.space(3))),
            child: Part(
              'table',
              child: Table(columnWidths: columns, defaultVerticalAlignment: TableCellVerticalAlignment.baseline, textBaseline: TextBaseline.alphabetic, children: rows),
            ),
          ),
        ),
      ),
    );
  }

  /// A row in the air: its cells in a row of their own, each as wide as it is in the table.
  Widget _lifted(List<Widget> cells) {
    final widths = _lanes.cellWidths;
    return DecoratedBox(
      decoration: BoxDecoration(color: look.paper2),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.baseline,
        textBaseline: TextBaseline.alphabetic,
        children: <Widget>[for (final (index, cell) in cells.indexed) SizedBox(width: index < widths.length ? widths[index] : null, child: cell)],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final result = widget.result;
    _lanes.update(result, widget.acts, control: () => widget.state.controlPointer);
    final totals = <String>{for (final total in result.totals) total.field};
    // A total for a field that is not a column is said under the table instead.
    final outside = <Total>[for (final total in result.totals) if (!result.columns.any((column) => column.field == total.field)) total];
    final foot = result.group == null && result.columns.any((column) => totals.contains(column.field));
    final under = result.group != null ? result.totals : outside;
    final groups = <Widget>[];
    for (final (index, group) in result.groups.indexed) {
      // .group + .group { margin-block-start: var(--glacier-space-2) }
      if (index > 0) groups.add(SizedBox(height: look.space(2)));
      final sides = EdgeInsets.symmetric(horizontal: look.space(3));
      groups.add(
        _lanes.lane(
          group,
          child: _GroupOver(
            look: look,
            over: _lanes.isOver(group),
            inset: look.space(3),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[if (result.group != null) Padding(padding: sides, child: QueryGroupHead(look: look, group: group)), _table(group, foot: foot)],
            ),
          ),
        ),
      );
    }
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[...groups, if (under.isNotEmpty) Padding(padding: EdgeInsets.symmetric(horizontal: look.space(3)), child: QueryTotals(look: look, totals: under))],
    );
  }
}

const List<String> _weekdays = <String>['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/// The query as a month (`CalendarView`): the month's weeks, a dot for each record on its day, and the day picked
/// listed under it. A calendar of to-dos is handed the calendars' events too ([events], docs/CALENDAR.md): each is a
/// ring beside the day's dots and a quiet line above the day's to-dos, its hours first.
class QueryCalendar extends StatefulWidget {
  const QueryCalendar({super.key, required this.look, required this.rows, required this.acts, this.events = const []});

  final QueryLook look;
  final List<QueryRow> rows;
  final QueryActs acts;

  /// The events on the month's days, as rows; drawn quieter than [rows], and never opened or ticked.
  final List<QueryRow> events;

  @override
  State<QueryCalendar> createState() => _QueryCalendarState();
}

class _QueryCalendarState extends State<QueryCalendar> {
  late String _month = openingMonth(widget.rows, widget.acts.today);
  String? _picked;

  void _turn(int by) => setState(() {
    _month = monthAfter(_month, by);
    _picked = null;
  });

  @override
  Widget build(BuildContext context) {
    final look = widget.look;
    final acts = widget.acts;
    final rows = widget.rows;
    final weeks = monthWeeks(_month, rows, acts.today);
    final days = <CalendarDay>[for (final week in weeks) ...week];
    // The events by day, from the same month: what each day's rings and quiet lines are.
    final eventsOn = <String, List<QueryRow>>{
      for (final week in widget.events.isEmpty ? const <List<CalendarDay>>[] : monthWeeks(_month, widget.events, acts.today))
        for (final day in week)
          if (day.rows.isNotEmpty) day.day: day.rows,
    };
    // The day whose records are listed under the month: the one picked, a day of the weeks either side included,
    // else today in today's month, else the first day with anything on it.
    CalendarDay? shown;
    bool busy(CalendarDay day) => day.rows.isNotEmpty || eventsOn.containsKey(day.day);
    for (final test in <bool Function(CalendarDay)>[(day) => day.day == _picked, (day) => day.today && day.inMonth && busy(day), (day) => day.inMonth && busy(day)]) {
      shown = days.where(test).firstOrNull;
      if (shown != null) break;
    }
    final undated = rows.where((row) => row.day == null).length;
    final name = monthName(_month, acts.locale);
    final gap = SizedBox(height: look.space(2));

    Widget cell(CalendarDay day) {
      final picked = shown?.day == day.day;
      final late = day.rows.any((row) => row.overdue);
      final count = day.rows.length;
      final booked = eventsOn[day.day]?.length ?? 0;
      final said = '${daySaid(day.day, acts.today, acts.locale)}${count > 0 ? ', $count ${count == 1 ? 'thing' : 'things'}' : ''}${booked > 0 ? ', $booked ${booked == 1 ? 'event' : 'events'}' : ''}';
      // .date { font-size: var(--glacier-font-size-xs); line-height: 1.6 }
      // .dayCell[data-today] .date { display: inline-grid; place-items: center; min-inline-size: 1.6em;
      //   block-size: 1.6em; border-radius: var(--glacier-radius-full); background: var(--app-ink);
      //   color: var(--app-paper); font-weight: var(--glacier-font-weight-semibold) }
      final dateLine = pageLine(look.xs, 1.6);
      final ink = day.inMonth ? look.ink : look.ink4;
      Widget date = PageWords('${day.date}', look.sans(look.xs, weight: day.today ? 'semibold' : 'regular', color: day.today ? look.paper : ink, tabular: true), line: dateLine, softWrap: false);
      if (day.today) {
        date = Container(
          constraints: BoxConstraints(minWidth: dateLine),
          height: dateLine,
          decoration: ShapeDecoration(color: look.ink, shape: const StadiumBorder()),
          child: Center(widthFactor: 1, child: date),
        );
      }
      // .dots { display: inline-flex; align-items: center; gap: 2px; font-size: 0.625rem; color: var(--app-ink-2) }
      // .pip { inline-size: 0.4rem; block-size: 0.4rem; border-radius: 50%; background: var(--app-ink-2) }
      // .dots[data-late] { color: var(--glacier-red-11) }  .dots[data-late] .pip { background: var(--glacier-red-9) }
      final rem = look.t.lenOf('1rem');
      final pip = 0.4 * rem;
      Widget? dots;
      // An event is a ring in the fourth ink, after the day's dots: there, and quieter than anything to do.
      final rings = booked == 0
          ? null
          : (booked > 2
              ? PageWords('+$booked', look.sans(0.625 * rem, color: look.ink4, tabular: true), line: pageLine(0.625 * rem, QueryLook.leading), softWrap: false)
              : Row(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    for (var index = 0; index < booked; index += 1) ...<Widget>[
                      if (index > 0) const SizedBox(width: 2),
                      Part('ring', child: Container(width: pip, height: pip, decoration: ShapeDecoration(shape: CircleBorder(side: BorderSide(color: look.ink4, width: 1))))),
                    ],
                  ],
                ));
      if (count > 3) {
        dots = PageWords('$count', look.sans(0.625 * rem, color: late ? look.t.color('glacier-red-11') : look.ink2, tabular: true), line: pageLine(0.625 * rem, QueryLook.leading), softWrap: false);
      } else if (count > 0) {
        dots = Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            for (var index = 0; index < count; index += 1) ...<Widget>[
              if (index > 0) const SizedBox(width: 2),
              Part('pip', child: Container(width: pip, height: pip, decoration: ShapeDecoration(color: late ? look.t.color('glacier-red-9') : look.ink2, shape: const CircleBorder()))),
            ],
          ],
        );
      }
      // .dayCell { display: grid; grid-template-rows: auto 1fr; justify-items: center; align-items: start; gap: 2px;
      //   min-block-size: var(--glacier-space-10); padding: var(--glacier-space-1) 0;
      //   border-radius: var(--glacier-radius-sm); background: var(--app-paper); color: var(--app-ink) }
      // .dayCell[data-out] { background: transparent; color: var(--app-ink-4) }
      // .dayCell[data-picked] { box-shadow: inset 0 0 0 1.5px var(--app-ink-2) }
      final radius = BorderRadius.circular(look.t.radius('sm'));
      return Expanded(
        child: Semantics(
          container: true,
          button: true,
          selected: picked,
          label: said,
          onTap: () => setState(() => _picked = day.day),
          excludeSemantics: true,
          child: GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: () => setState(() => _picked = day.day),
            child: Part(
              'dayCell',
              child: Container(
                constraints: BoxConstraints(minHeight: look.space(10)),
                padding: EdgeInsets.symmetric(vertical: look.space(1)),
                decoration: BoxDecoration(color: day.inMonth ? look.paper : null, borderRadius: radius),
                foregroundDecoration: picked ? BoxDecoration(borderRadius: radius, border: Border.all(color: look.ink2, width: 1.5)) : null,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    Part('date', child: date),
                    if (dots != null || rings != null) ...<Widget>[
                      const SizedBox(height: 2),
                      Part(
                        'dots',
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: <Widget>[?dots, if (dots != null && rings != null) const SizedBox(width: 2), if (rings != null) Part('rings', child: rings)],
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      );
    }

    Widget week(List<Widget> cells) => Part(
      'week',
      // .week { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 2px }
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            for (final (index, one) in cells.indexed) ...<Widget>[if (index > 0) const SizedBox(width: 2), one],
          ],
        ),
      ),
    );

    // .calendar { display: grid; gap: var(--glacier-space-2) }
    return Part(
      'calendar',
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          // .monthBar { display: flex; align-items: center; justify-content: space-between }
          Part(
            'monthBar',
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: <Widget>[
                _RoundButton(look: look, name: 'turn', icon: Lucide.chevronLeft, label: 'The month before', stroke: 2.4, onTap: () => _turn(-1)),
                // .monthName { display: inline-flex; align-items: baseline; gap: var(--glacier-space-2);
                //   font-weight: var(--glacier-font-weight-semibold) }
                Part(
                  'monthName',
                  child: Semantics(
                    liveRegion: true,
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.baseline,
                      textBaseline: TextBaseline.alphabetic,
                      children: <Widget>[
                        PageWords(name, look.sans(look.em, weight: 'semibold'), line: look.line, softWrap: false),
                        SizedBox(width: look.space(2)),
                        Part('count', child: PageWords('${inMonth(rows, _month)}', look.sans(look.xs, weight: 'semibold', color: look.ink3, tabular: true), line: look.lineXs, softWrap: false)),
                      ],
                    ),
                  ),
                ),
                _RoundButton(look: look, name: 'turn', icon: Lucide.chevronRight, label: 'The month after', stroke: 2.4, onTap: () => _turn(1)),
              ],
            ),
          ),
          gap,
          // .month { display: grid; gap: 2px }
          Part(
            'month',
            child: Semantics(
              container: true,
              label: name,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  week(<Widget>[
                    for (final day in _weekdays)
                      // .weekday { padding-block: var(--glacier-space-1); font-size: var(--glacier-font-size-xs);
                      //   text-align: center; color: var(--app-ink-3) }
                      Expanded(
                        child: Semantics(
                          label: day,
                          excludeSemantics: true,
                          child: Part(
                            'weekday',
                            child: Padding(
                              padding: EdgeInsets.symmetric(vertical: look.space(1)),
                              child: Center(heightFactor: 1, child: PageWords(day.substring(0, 1), look.sans(look.xs, color: look.ink3), line: look.lineXs, softWrap: false)),
                            ),
                          ),
                        ),
                      ),
                  ]),
                  for (final one in weeks) ...<Widget>[const SizedBox(height: 2), week(<Widget>[for (final day in one) cell(day)])],
                ],
              ),
            ),
          ),
          if (shown != null) ...<Widget>[
            gap,
            // .dayList { padding-block-start: var(--glacier-space-1) }
            // .dayListHead { margin: 0; font-weight: var(--glacier-font-weight-semibold); color: var(--app-ink-2) }
            Part(
              'dayList',
              child: Padding(
                padding: EdgeInsets.only(top: look.space(1)),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    Part('dayListHead', child: PageWords(daySaid(shown.day, acts.today, acts.locale), look.sans(look.em, weight: 'semibold', color: look.ink2), line: look.line)),
                    for (final event in eventsOn[shown.day] ?? const <QueryRow>[]) QueryEventLine(look: look, row: event),
                    if (shown.rows.isNotEmpty)
                      for (final (index, row) in shown.rows.indexed) QueryRowLine(look: look, row: row, acts: acts, first: index == 0, keyLine: false)
                    else if (!eventsOn.containsKey(shown.day))
                      Padding(
                        padding: EdgeInsets.symmetric(vertical: look.space(1)),
                        child: Part('empty', child: PageWords('Nothing on this day.', look.sans(look.em, color: look.ink3), line: look.line)),
                      ),
                  ],
                ),
              ),
            ),
          ],
          if (undated > 0) ...<Widget>[
            gap,
            Padding(
              padding: EdgeInsets.symmetric(vertical: look.space(1)),
              child: Part(
                'warning',
                child: PageWords(undated == 1 ? 'One has no day, and is not on the calendar.' : '$undated have no day, and are not on the calendar.', look.sans(look.em, color: look.ink3), line: look.line),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// An event on a calendar of to-dos' day list: its hours, then its title, in the third ink, a line to itself and
/// nothing to press (docs/CALENDAR.md). The hours are the row's `time` cell, where its query has one.
class QueryEventLine extends StatelessWidget {
  const QueryEventLine({super.key, required this.row, required this.look});

  final QueryRow row;
  final QueryLook look;

  /// What an event's line says before its title: its hours, or All day.
  static String hoursOf(QueryRow row) {
    for (final cell in row.cells) {
      if (cell is TextCell && RegExp(r'^\d{2}:\d{2}').hasMatch(cell.text)) return cell.text;
    }
    return 'All day';
  }

  @override
  Widget build(BuildContext context) {
    final quiet = look.sans(look.em, color: look.ink3);
    return Semantics(
      label: '${hoursOf(row)}, ${row.name}',
      excludeSemantics: true,
      child: Part(
        'event',
        child: Padding(
          padding: EdgeInsets.symmetric(vertical: look.space(1)),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: <Widget>[
              PageWords(hoursOf(row), look.sans(look.xs, color: look.ink4, tabular: true), line: look.lineXs, softWrap: false),
              SizedBox(width: look.space(2)),
              Expanded(child: PageWords(row.name, quiet, line: look.line)),
            ],
          ),
        ),
      ),
    );
  }
}

/// The query as a count (`CountView`): how many, in a big number, and each total after it.
class QueryCount extends StatelessWidget {
  const QueryCount({super.key, required this.look, required this.result});

  final QueryLook look;
  final QueryResult result;

  @override
  Widget build(BuildContext context) {
    final word = kindWords[result.kind]!.toLowerCase();
    final one = const <QueryKind, String>{QueryKind.notes: 'note', QueryKind.tickets: 'ticket', QueryKind.tasks: 'to-do', QueryKind.events: 'event'}[result.kind]!;
    // .countView { display: flex; align-items: baseline; flex-wrap: wrap; gap: var(--glacier-space-2); margin: 0 }
    // .bigNumber { font-size: var(--glacier-font-size-3xl, 2rem); font-weight: var(--glacier-font-weight-semibold);
    //   font-variant-numeric: tabular-nums; line-height: 1.1 }
    // .countWords { color: var(--app-ink-2) }  .countWords strong { color: var(--app-ink) }
    final big = look.t.fontSize('3xl');
    final quiet = look.sans(look.em, color: look.ink2);
    return Part(
      'countView',
      child: CssWrap(
        gap: look.space(2),
        rowGap: look.space(2),
        align: CssAlign.baseline,
        children: <Widget>[
          Part('bigNumber', child: PageWords('${result.matched}', look.sans(big, weight: 'semibold', tabular: true), line: pageLine(big, 1.1), softWrap: false)),
          Part('countWords', child: PageWords(result.matched == 1 ? one : word, quiet, line: look.line, softWrap: false)),
          for (final total in result.totals)
            Part(
              'countWords',
              child: PageWords.rich(
                TextSpan(children: <InlineSpan>[TextSpan(text: '· ${total.label} '), TextSpan(text: total.text, style: look.sans(look.em, weight: 'bold', color: look.ink, tabular: true))]),
                quiet,
                line: look.line,
                softWrap: false,
              ),
            ),
        ],
      ),
    );
  }
}
