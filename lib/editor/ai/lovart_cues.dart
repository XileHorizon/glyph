/// `{image: a prompt}` marked in the editor while the Lovart plugin is on (Matt, 2026-10-26: "include the lovart logo
/// … next to the syntax for prompting when the prompt is registered"). The port's own.
///
/// A cue is recognised once its closing brace is there and its prompt has words (lib/plugins/lovart/cues.dart
/// [imageCues]): its words get a faint wash, and Lovart's mark is drawn just after its `}`. A tap on the mark makes
/// that one cue into its picture; while it is being made the mark turns into a turning ring. Return at the end of a line
/// whose last words are a cue makes it too, the caret going on to the new line (Matt, 2026-10-26: "when hitting return
/// start to generate the image"); and while a cue is being made, a stand-in is drawn under its line, a blurred abstract
/// with Lovart's mark and a ring turning round it (lib/editor/media/lovart_pending.dart), until the picture takes the
/// cue's place. Nothing else changes: the cue is the note's own words, edited as any, and with the plugin off it is
/// plain text.
///
/// Read over the lines on screen, as the blanks are (blanks.dart), leaving code, an address, front matter, HTML and
/// maths as written. Plugins cannot add to the editor, so the note's screen adds this itself
/// (lib/root/note_desk.dart), fed by the plugin through [LovartCueHooks].
library;

import 'dart:async';

import 'package:flutter/widgets.dart' hide Decoration;
import 'package:glacier/glacier.dart';

import '../../art/app_icon.dart';
import '../../art/lucide.g.dart';
import '../../plugins/lovart/cues.dart' show ImageCue, imageCues;
import '../../plugins/lovart/inspiration.dart' show inspirationCount, inspirationInsert;
import '../../plugins/lovart/keep.dart' show sketchPrefix;
import '../../plugins/lovart/lovart_mark.dart';
import '../media/images.dart' show gutterOf, sketchMostWidth, sketchShare;
import '../media/lovart_pending.dart';
import '../editor.dart';
import '../looks/look.dart';
import '../looks/sheets.dart';
import '../syntax/syntax.dart';
import '../view/line.dart' show EditorRunScope;
import '../view/syntax_tree.dart';

/// What the note's screen gives the cues.
class LovartCueHooks {
  const LovartCueHooks({required this.on, required this.press, required this.making, this.inspiring, this.sketching, this.changes});

  /// Whether cues are marked: the plugin on. Read at each drawing.
  final bool Function() on;

  /// Makes that one cue into its picture.
  final void Function(ImageCue cue) press;

  /// Whether the cue written [cueText] is being made now.
  final bool Function(String cueText) making;

  /// Whether the note's inspiration moodboard is being made now: its four stand-ins wait where the pictures will go
  /// (Matt, 2026-11-02: "bring back the blurry image with the lovart logo with the spinner when generating images").
  final bool Function()? inspiring;

  /// The paragraphs of the note waiting for a field sketch now, by their last line's text: a stand-in waits under each,
  /// at the side the sketch will sit (lib/plugins/lovart/sketch_make.dart).
  final Set<String> Function()? sketching;

  /// Told when [on], [making], [inspiring] or [sketching] may answer otherwise: the cues are drawn again.
  final Listenable? changes;
}

final StateEffectType<Null> _redraw = StateEffect.define<Null>();

/// The cues on screen, leaving any in code or another quiet place as written.
List<ImageCue> _visibleCues(EditorViewLike view) {
  final out = <ImageCue>[];
  final doc = view.state.doc;
  final tree = syntaxTree(view.state);
  final seen = <int>{};
  for (final range in view.visibleRanges) {
    final first = doc.lineAt(range.from).number, last = doc.lineAt(range.to).number;
    for (var n = first; n <= last; n += 1) {
      final line = doc.line(n);
      if (!seen.add(n) || !line.text.contains('{')) continue;
      for (final cue in imageCues(line.text)) {
        final from = line.from + cue.from;
        if (inQuietText(tree, from)) continue;
        out.add(ImageCue(prompt: cue.prompt, text: cue.text, from: from, to: line.from + cue.to, line: n));
      }
    }
  }
  return out;
}

final Decoration _wash = Decoration.mark(className: 'cm-lovartCue');

DecorationSet _decorate(EditorViewLike view, LovartCueHooks hooks) {
  if (!hooks.on()) return Decoration.none;
  final found = <Range<Decoration>>[];
  for (final cue in _visibleCues(view)) {
    found
      ..add(_wash.range(cue.from, cue.to))
      ..add(Decoration.widget(widget: LovartCueWidget(cue.text, cue.prompt, hooks.making(cue.text)), side: 1).range(cue.to));
  }
  return Decoration.set(found, true);
}

class _Cues extends PluginValue {
  _Cues(this.view, this.hooks) : decorations = _decorate(view, hooks) {
    hooks.changes?.addListener(_heard);
  }

  final EditorViewLike view;
  final LovartCueHooks hooks;
  DecorationSet decorations;
  bool _told = false;
  bool _gone = false;

  void _heard() {
    if (_told) return;
    _told = true;
    scheduleMicrotask(() {
      _told = false;
      if (!_gone) view.dispatch(TransactionSpec(effects: _redraw.of(null)));
    });
  }

  @override
  void update(ViewUpdate update) {
    _enterAfterCue(update);
    if (update.docChanged || update.viewportChanged || update.transactions.any((tr) => tr.effects.any((e) => e.isOf(_redraw))) || !identical(syntaxTree(update.startState), syntaxTree(update.state))) {
      decorations = _decorate(update.view, hooks);
    }
  }

  /// Return typed at the end of a line that ends in a cue: that cue is made, once the update is done.
  void _enterAfterCue(ViewUpdate update) {
    if (!update.docChanged || !hooks.on()) return;
    final lines = <int>[];
    for (final tr in update.transactions) {
      if (!tr.isUserEvent('input')) continue;
      tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) {
        if (fromA != toA || !inserted.toString().startsWith('\n')) return;
        final before = tr.startState.doc.lineAt(fromA);
        if (fromA != before.to || !before.text.contains('{')) return;
        final cues = imageCues(before.text);
        if (cues.isEmpty || before.text.substring(cues.last.to).trim().isNotEmpty) return;
        lines.add(before.number);
      });
    }
    if (lines.isEmpty) return;
    final state = update.state;
    final tree = syntaxTree(state);
    final ready = <ImageCue>[];
    for (final n in lines) {
      if (n > state.doc.lines) continue;
      final line = state.doc.line(n);
      final found = imageCues(line.text);
      if (found.isEmpty) continue;
      final cue = found.last;
      final from = line.from + cue.from;
      if (inQuietText(tree, from) || hooks.making(cue.text)) continue;
      ready.add(ImageCue(prompt: cue.prompt, text: cue.text, from: from, to: line.from + cue.to, line: n));
    }
    // Not inside the update: making it changes what the view draws.
    if (ready.isNotEmpty) {
      scheduleMicrotask(() {
        if (_gone) return;
        for (final cue in ready) {
          hooks.press(cue);
        }
      });
    }
  }

  @override
  void destroy() {
    _gone = true;
    hooks.changes?.removeListener(_heard);
  }
}

final LookSheet _theme = LookSheet('editor/lovartCues', <LookRule>[
  // A cue: a faint wash of the page's ink behind its words, as an AI's added words have (ai_changes.dart).
  LookRule('cm-lovartCue', classes: 2, (p, e) {
    final wash = e.t.colorOf('color-mix(in oklch, var(--app-ink, currentColor) 8%, transparent)', current: p.color);
    p.background = (_) => wash;
  }),
]);

/// The mark after a cue: a tap makes it.
class LovartCueWidget extends EditorWidget {
  const LovartCueWidget(this.cueText, this.prompt, this.busy);

  final String cueText;
  final String prompt;
  final bool busy;

  @override
  bool eq(LovartCueWidget other) => other.cueText == cueText && other.busy == busy;

  @override
  Widget build(BuildContext context) {
    final view = EditorViewScope.maybeOf(context);
    final hooks = view?.state.facet(_hooks);
    return LovartCueChip(
      busy: busy,
      prompt: prompt,
      onPress: view == null || hooks == null
          ? null
          : () {
              // Found again where it stands now: the note may have moved since the chip was drawn.
              final cue = _visibleCues(view).where((c) => c.text == cueText).firstOrNull;
              if (cue != null) hooks.press(cue);
            },
    );
  }
}

/// Lovart's mark, a step smaller than the words, on a faint round ground; a turning ring while the cue is made.
class LovartCueChip extends StatelessWidget {
  const LovartCueChip({super.key, required this.busy, required this.prompt, required this.onPress});

  final bool busy;
  final String prompt;
  final VoidCallback? onPress;

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;
    final scope = EditorRunScope.maybeOf(context);
    final em = scope?.look.fontSize ?? t.len('app-body');
    final ink = scope?.look.style.color ?? t.color('app-ink');
    final size = (em * 0.95).roundToDouble();
    final ground = t.colorOf('color-mix(in oklch, currentColor 10%, transparent)', current: ink);
    final mark = busy ? _Turning(child: AppIcon(Lucide.loaderCircle, size: size * 0.8, color: ink)) : LovartMark(size: size * 0.8, color: ink);
    return Semantics(
      button: true,
      enabled: !busy,
      label: busy ? 'Lovart is making this image' : 'Make this image with Lovart',
      onTap: busy ? null : onPress,
      child: ExcludeSemantics(
        child: Padding(
          padding: EdgeInsetsDirectional.only(start: em * 0.25),
          child: GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: busy ? null : onPress,
            child: Container(
              key: ValueKey<String>(busy ? 'lovart-cue-busy' : 'lovart-cue'),
              width: size,
              height: size,
              alignment: Alignment.center,
              decoration: BoxDecoration(color: ground, borderRadius: BorderRadius.circular(size * 0.3)),
              child: mark,
            ),
          ),
        ),
      ),
    );
  }
}

class _Turning extends StatefulWidget {
  const _Turning({required this.child});

  final Widget child;

  @override
  State<_Turning> createState() => _TurningState();
}

class _TurningState extends State<_Turning> with SingleTickerProviderStateMixin {
  late final AnimationController _turn = AnimationController(vsync: this, duration: const Duration(milliseconds: 1200));
  bool _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) return;
    _started = true;
    if (!context.tokens.reducedMotion) _turn.repeat();
  }

  @override
  void dispose() {
    _turn.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => RotationTransition(turns: _turn, child: widget.child);
}

/// The stand-in under the line of each cue being made: a block, so a state field, read from the hooks the view plugin
/// keeps in step ([_redraw] when they say otherwise).
DecorationSet _pendingOf(EditorState state) {
  final hooks = state.facet(_hooks);
  if (hooks == null || !hooks.on()) return Decoration.none;
  final found = <Range<Decoration>>[];
  final doc = state.doc;
  for (var n = 1; n <= doc.lines; n += 1) {
    final line = doc.line(n);
    if (!line.text.contains('{')) continue;
    for (final cue in imageCues(line.text)) {
      if (hooks.making(cue.text)) found.add(Decoration.widget(widget: LovartPendingWidget(cue.prompt), block: true, side: 1).range(line.to));
    }
  }
  // A moodboard being made: its stand-ins after the line its pictures will follow (inspiration.dart
  // `inspirationInsert`: under an `## Inspiration` there already is, else after the note's last line of words).
  if (hooks.inspiring?.call() ?? false) {
    final at = inspirationInsert(doc.toString(), const []).line.clamp(1, doc.lines);
    found.add(Decoration.widget(widget: const LovartMoodboardPendingWidget(), block: true, side: 2).range(doc.line(at).to));
  }
  // Field sketches being drawn: a small stand-in under each paragraph waiting for one, taking turns with the sketches
  // already there for its side, as they will (images.dart `ImageWidget.sketchEnd`).
  final sketching = hooks.sketching?.call() ?? const <String>{};
  if (sketching.isNotEmpty) {
    var sketches = 0;
    for (var n = 1; n <= doc.lines; n += 1) {
      final text = doc.line(n).text;
      if (text.contains('(image/$sketchPrefix')) sketches += 1;
      if (!sketching.contains(text)) continue;
      found.add(Decoration.widget(widget: LovartSketchPendingWidget(text, end: sketches.isEven), block: true, side: 3).range(doc.line(n).to));
      sketches += 1;
    }
  }
  return found.isEmpty ? Decoration.none : Decoration.set(found, true);
}

final StateField<DecorationSet> _pending = StateField.define<DecorationSet>(
  create: _pendingOf,
  update: (decorations, tr) {
    if (tr.docChanged || tr.effects.any((e) => e.isOf(_redraw))) return _pendingOf(tr.state);
    return decorations;
  },
  provide: (field) => EditorViewLike.decorations.from<DecorationSet>(field),
);

/// The stand-in, at a picture's place and width (images.dart `ImageWidget`).
class LovartPendingWidget extends EditorWidget {
  const LovartPendingWidget(this.prompt);

  final String prompt;

  @override
  bool eq(LovartPendingWidget other) => other.prompt == prompt;

  @override
  bool takesPointer(_) => false;

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;
    return Padding(
      padding: EdgeInsets.only(top: t.space(2), bottom: t.space(3)).add(EdgeInsets.symmetric(horizontal: gutterOf(context))),
      child: LovartPending(prompt: prompt, maxHeight: MediaQuery.sizeOf(context).height * 0.4),
    );
  }
}

/// A field sketch's stand-in, at the sketch's side and size (images.dart `ImageWidget`), while Lovart draws it.
class LovartSketchPendingWidget extends EditorWidget {
  const LovartSketchPendingWidget(this.lastText, {required this.end});

  final String lastText;
  final bool end;

  @override
  bool eq(LovartSketchPendingWidget other) => other.lastText == lastText && other.end == end;

  @override
  bool takesPointer(_) => false;

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;
    return Padding(
      key: const ValueKey<String>('lovart-sketch-pending'),
      padding: EdgeInsets.only(top: t.space(1), bottom: t.space(2)).add(EdgeInsets.symmetric(horizontal: gutterOf(context))),
      child: LayoutBuilder(
        builder: (context, box) {
          final width = (box.maxWidth * sketchShare).clamp(120.0, sketchMostWidth).toDouble();
          return Align(
            alignment: end ? AlignmentDirectional.topEnd : AlignmentDirectional.topStart,
            child: SizedBox(width: width, child: LovartPending(prompt: lastText, height: width * 1.25)),
          );
        },
      ),
    );
  }
}

/// A moodboard's four stand-ins, two across, at a picture's place, while Lovart makes them.
class LovartMoodboardPendingWidget extends EditorWidget {
  const LovartMoodboardPendingWidget();

  @override
  bool eq(LovartMoodboardPendingWidget other) => true;

  @override
  bool takesPointer(_) => false;

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;
    final gap = t.space(2);
    return Padding(
      key: const ValueKey<String>('lovart-moodboard-pending'),
      padding: EdgeInsets.only(top: t.space(2), bottom: t.space(3)).add(EdgeInsets.symmetric(horizontal: gutterOf(context))),
      child: LayoutBuilder(
        builder: (context, box) {
          final width = (box.maxWidth - gap) / 2;
          return Wrap(
            spacing: gap,
            runSpacing: gap,
            children: [
              for (var i = 1; i <= inspirationCount; i += 1) SizedBox(width: width, child: LovartPending(prompt: 'inspiration $i', maxHeight: MediaQuery.sizeOf(context).height * 0.25)),
            ],
          );
        },
      ),
    );
  }
}

final Facet<LovartCueHooks?, LovartCueHooks?> _hooks = Facet.define<LovartCueHooks?, LovartCueHooks?>(combine: (values) => values.where((v) => v != null).firstOrNull);

/// The cues of a note, marked and pressable while [hooks] says Lovart is on.
Extension lovartCues(LovartCueHooks hooks) => Extension.list(<Extension>[
      _hooks.of(hooks),
      _pending,
      ViewPlugin.define<_Cues>((view) => _Cues(view, hooks), decorations: (value) => value.decorations),
      baseTheme(_theme),
    ]);
