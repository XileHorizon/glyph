/// Pictures shown in the editor. Ports `src/app/editor/images.ts`, the `.figure` rules of
/// `src/app/editor/markdown.module.css` and `src/app/editor/useNotePictures.ts`.
///
/// A line holding `![caption](image/<name>)` keeps its markdown, dimmed like every other mark and editable, and
/// the picture itself is a block widget under the line. Nothing is hidden or replaced, so the caret behaves as it
/// does on any line, deleting the line removes the picture, and the source a person sees is the source that is
/// saved.
///
/// A state field rather than a view plugin: a block widget's height has to be known before layout. The lines that
/// hold a picture are kept with the document's tree (lib/editor/view/line_facts.dart), where the page scans the
/// whole document on every change.
///
/// What differs:
/// - Where a picture is drawn from is a [PictureStore] (lib/core/images.dart), told to the editor through the
///   facet [pictureStore]; `IMAGE_READY` on `window` is the store's own telling. With no store, every picture is
///   waiting: a box at a small height in the paper's second tone.
/// - A picture decodes after it is asked for, as an `<img>` loads: until then the figure has no height, as the
///   page's has none, and it is laid out again when the picture's size is known.
/// - A PASTE. The page took the pictures out of the browser's paste event. Here the keyboard's paste reaches the
///   editor as words (`EditorEventHandlers.paste`), and reading a picture off the clipboard needs a plugin this
///   stage does not have: [pasteImages] is what the input layer calls with the pictures of a paste when it can
///   read them, and it does the rest as the page's handler did (each kept, each put in at the caret one after
///   another, a failure said through `onImageError`).
/// - `useNotePictures` was a React hook; [NotePictures] is the same thing as a `ChangeNotifier` the note screen
///   holds. The phone's picker is the seam [PicturePicker]; the light buzz after a picture lands is `onPlaced`.
/// - `loading="lazy"`, `decoding="async"` and `alt` are the browser's; the caption is the picture's label for a
///   screen reader.
library;

import 'dart:async';
import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/rendering.dart' show RenderProxyBox;
import 'package:flutter/widgets.dart' hide Decoration;
import 'package:glacier/glacier.dart';

import '../../activity/sync_mark.dart' show FileSendingBar;
import '../../core/background_jobs.dart' show JobKind;
import '../../core/images.dart';
import '../../sync/notes.dart' show FileKind;
import '../commands/inserts.dart';
import '../editor.dart';
import '../view/line_facts.dart';
import '../looks/look.dart';
import 'lovart_badge.dart';
import '../../plugins/lovart/keep.dart' show isSketch;
import '../view/editor_view.dart';

/// Where the editor's pictures are drawn from, and kept: the first one given.
final Facet<PictureStore, PictureStore?> pictureStore = Facet.define<PictureStore, PictureStore?>(combine: (values) => values.isEmpty ? null : values.first);

/// The store of the editor a widget is drawn in.
PictureStore? pictureStoreOf(BuildContext context) => EditorViewScope.maybeOf(context)?.state.facet(pictureStore);

/// The gutter of the editor a block is drawn in: `var(--app-gutter)`, which a card's preview sets for itself.
double gutterOf(BuildContext context) {
  final view = EditorViewScope.maybeOf(context);
  final env = view is EditorView ? view.look?.env : null;
  return env?.gutter ?? context.tokens.len('app-gutter');
}

/// What a failure says, as a sentence for the note (core/failure.ts `failureText`).
String failureWords(Object failure) {
  if (failure is StateError) return failure.message;
  if (failure is String) return failure;
  final said = failure.toString();
  return said.startsWith('Exception: ') ? said.substring('Exception: '.length) : said;
}

ImageProvider _providerOf(Picture picture) => picture.path != null ? FileImage(File(picture.path!)) : MemoryImage(picture.bytes!);

/// A kept picture, drawn at its own size within the room it is given: `display: block; max-inline-size: 100%`
/// and a most height, its shape kept. Until the store has it and it has decoded, [waiting] is drawn in its place
/// (nothing, by default: an `<img>` with no picture yet has no height).
class KeptPicture extends StatefulWidget {
  const KeptPicture({super.key, required this.name, required this.store, this.label = '', this.maxHeight = double.infinity, this.minWidth = 0, this.minHeight = 0, this.radius = 0, this.background, this.waiting, this.onSize, this.badge = true});

  final String name;
  final PictureStore? store;
  final String label;
  final double maxHeight;
  final double minWidth;
  final double minHeight;
  final double radius;
  final Color? background;
  final Widget? waiting;

  /// Told the picture's own size once it has decoded (`naturalWidth`, `naturalHeight`).
  final void Function(Size natural)? onSize;

  /// Whether Lovart's mark is drawn on a picture Lovart made: off where the one drawing it puts the mark itself (a
  /// note's banner, lib/note/note_banner.dart, which scales the picture and would scale the mark with it).
  final bool badge;

  @override
  State<KeptPicture> createState() => _KeptPictureState();
}

class _KeptPictureState extends State<KeptPicture> {
  Picture? _picture;
  ImageStream? _stream;
  ImageStreamListener? _listener;
  ui.Image? _image;

  @override
  void initState() {
    super.initState();
    widget.store?.addListener(_look);
    _look();
  }

  @override
  void didUpdateWidget(KeptPicture old) {
    super.didUpdateWidget(old);
    if (!identical(old.store, widget.store)) {
      old.store?.removeListener(_look);
      widget.store?.addListener(_look);
    }
    if (!identical(old.store, widget.store) || old.name != widget.name) _look();
  }

  void _look() {
    final picture = widget.store?.pictureOf(widget.name);
    if (picture == _picture) return;
    _picture = picture;
    _unlisten();
    if (picture == null) {
      if (_image != null && mounted) setState(() => _image = null);
      return;
    }
    final provider = _providerOf(picture);
    // A picture that landed again is another file under the same name: the cache's copy is the old one.
    if (picture.version > 0) unawaited(provider.evict());
    final stream = _stream = provider.resolve(ImageConfiguration.empty);
    final listener = _listener = ImageStreamListener(
      (info, _) {
        if (!mounted) return;
        setState(() => _image = info.image);
        widget.onSize?.call(Size(info.image.width.toDouble(), info.image.height.toDouble()));
      },
      // A file that is not a picture after all: it stays as a picture not yet here.
      onError: (_, _) {},
    );
    stream.addListener(listener);
  }

  void _unlisten() {
    if (_stream != null && _listener != null) _stream!.removeListener(_listener!);
    _stream = null;
    _listener = null;
  }

  @override
  void dispose() {
    widget.store?.removeListener(_look);
    _unlisten();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final image = _image;
    if (image == null) return widget.waiting ?? const SizedBox.shrink();
    // Sized by a box of its own rather than a LayoutBuilder, so a row that asks its cards their heights before laying
    // them out (lib/home/note_card.dart `CardRow`, two cards across on an opened Fold) is told the picture's height:
    // a LayoutBuilder cannot answer that, and a card with a picture threw, or in a release build came out cut short.
    return Semantics(
      image: true,
      label: widget.label,
      child: FitPictureBox(
        natural: Size(image.width.toDouble(), image.height.toDouble()),
        maxHeight: widget.maxHeight,
        minWidth: widget.minWidth,
        minHeight: widget.minHeight,
        // Lovart's mark on its corner where Lovart made it (lovart_badge.dart).
        child: LovartBadged(
          name: widget.badge ? widget.name : '',
          child: ClipRRect(
            borderRadius: BorderRadius.circular(widget.radius),
            child: Stack(
              fit: StackFit.passthrough,
              children: [
                ColoredBox(
                  color: widget.background ?? const Color(0x00000000),
                  child: RawImage(image: image, fit: BoxFit.fill, filterQuality: FilterQuality.medium),
                ),
                // While it goes to the account, a thin bar along its foot in the pictures' colour (docs/ACTIVITY.md,
                // In place): nothing otherwise.
                PositionedDirectional(start: 0, end: 0, bottom: 0, child: FileSendingBar(file: FileKind.image, name: widget.name, kind: JobKind.images)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// A picture's box: [fitPicture]'s size in whatever width it is given, and that same size when it is only asked
/// (its intrinsic heights and its dry layout), which a LayoutBuilder cannot say. Its child fills it.
class FitPictureBox extends SingleChildRenderObjectWidget {
  const FitPictureBox({super.key, required this.natural, this.maxHeight = double.infinity, this.minWidth = 0, this.minHeight = 0, super.child});

  final Size natural;
  final double maxHeight;
  final double minWidth;
  final double minHeight;

  @override
  RenderObject createRenderObject(BuildContext context) => _RenderFitPicture(natural, maxHeight, minWidth, minHeight);

  @override
  void updateRenderObject(BuildContext context, covariant RenderObject renderObject) {
    (renderObject as _RenderFitPicture).set(natural, maxHeight, minWidth, minHeight);
  }
}

class _RenderFitPicture extends RenderProxyBox {
  _RenderFitPicture(this._natural, this._maxHeight, this._minWidth, this._minHeight);

  Size _natural;
  double _maxHeight, _minWidth, _minHeight;

  void set(Size natural, double maxHeight, double minWidth, double minHeight) {
    if (natural == _natural && maxHeight == _maxHeight && minWidth == _minWidth && minHeight == _minHeight) return;
    _natural = natural;
    _maxHeight = maxHeight;
    _minWidth = minWidth;
    _minHeight = minHeight;
    markNeedsLayout();
  }

  Size _fit(double maxWidth) => fitPicture(_natural, maxWidth: maxWidth, maxHeight: _maxHeight, minWidth: _minWidth, minHeight: _minHeight);

  @override
  double computeMinIntrinsicHeight(double width) => _fit(width).height;

  @override
  double computeMaxIntrinsicHeight(double width) => _fit(width).height;

  @override
  double computeMinIntrinsicWidth(double height) => _minWidth;

  @override
  double computeMaxIntrinsicWidth(double height) => _fit(double.infinity).width;

  @override
  Size computeDryLayout(BoxConstraints constraints) => constraints.constrain(_fit(constraints.maxWidth));

  @override
  void performLayout() {
    final fitted = _fit(constraints.maxWidth);
    final inner = constraints.tighten(width: fitted.width, height: fitted.height);
    final child = this.child;
    if (child != null) {
      child.layout(inner, parentUsesSize: true);
      size = child.size;
    } else {
      size = inner.constrain(fitted);
    }
  }
}

/// A picture's size on the page: its own, made smaller to fit the most width and height with its shape kept, as
/// CSS sizes a replaced element with `max-inline-size` and `max-block-size` (and a least, which wins).
Size fitPicture(Size natural, {required double maxWidth, double maxHeight = double.infinity, double minWidth = 0, double minHeight = 0}) {
  if (natural.width <= 0 || natural.height <= 0) return Size(minWidth, minHeight);
  var scale = 1.0;
  if (natural.width * scale > maxWidth) scale = maxWidth / natural.width;
  if (natural.height * scale > maxHeight) scale = maxHeight / natural.height;
  var width = natural.width * scale, height = natural.height * scale;
  if (width < minWidth) {
    width = minWidth;
    height = (minWidth * natural.height / natural.width).clamp(0, maxHeight).toDouble();
  }
  if (height < minHeight) {
    height = minHeight;
    width = (minHeight * natural.width / natural.height).clamp(minWidth, maxWidth).toDouble();
  }
  return Size(layoutUnit(width), layoutUnit(height));
}

/// The picture under its line.
class ImageWidget extends EditorWidget {
  const ImageWidget(this.name, this.caption, this.generation, {this.sketchEnd = false});

  final String name;
  final String caption;

  /// Bumped when a picture becomes loadable, so the widget is rebuilt.
  final int generation;

  /// For a field sketch (lib/plugins/lovart/sketches.dart), whether it sits at the line's end: the note's sketches
  /// take turns, the first at the end, the next at the start.
  final bool sketchEnd;

  @override
  bool eq(ImageWidget other) => other.name == name && other.caption == caption && other.generation == generation && other.sketchEnd == sketchEnd;

  @override
  bool takesPointer(_) => false;

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;
    if (isSketch(name)) return _sketch(context);
    final store = pictureStoreOf(context);
    final radius = t.radius('md');
    final paper = t.color('app-paper-2');
    final waiting = store?.pictureOf(name) == null;
    // '.figure': { margin: var(--glacier-space-2) 0 var(--glacier-space-3); padding: 0 var(--app-gutter) }
    return Padding(
      padding: EdgeInsets.only(top: t.space(2), bottom: t.space(3)),
      child: Padding(
        key: ValueKey<String>(waiting ? 'figure-waiting' : 'figure'),
        padding: EdgeInsets.symmetric(horizontal: gutterOf(context)),
        child: Align(
          alignment: AlignmentDirectional.topStart,
          // '.figure img': { display: block; max-inline-size: 100%; max-block-size: 60vh;
          //   border-radius: var(--glacier-radius-md); background: var(--app-paper-2) }
          child: KeptPicture(
            key: ValueKey<String>(waiting ? 'figure-img-waiting' : 'figure-img'),
            name: name,
            store: store,
            label: caption,
            maxHeight: MediaQuery.sizeOf(context).height * 0.6,
            radius: radius,
            background: paper,
            // '.figure[data-waiting]::before': { content: ''; display: block; min-block-size: 3rem;
            //   border-radius: var(--glacier-radius-md); background: var(--app-paper-2) }
            waiting: waiting
                ? DecoratedBox(
                    decoration: BoxDecoration(color: paper, borderRadius: BorderRadius.circular(radius)),
                    child: SizedBox(width: double.infinity, height: t.lenOf('3rem')),
                  )
                : null,
          ),
        ),
      ),
    );
  }

  /// A field sketch: a specimen on the page, not a figure. No ground and no corners, since its paper is clear; about two
  /// fifths of the column wide and no taller than a third of the screen, at one side, so it sits beside the words it
  /// belongs to as a drawing in a naturalist's journal does.
  Widget _sketch(BuildContext context) {
    final t = context.tokens;
    final store = pictureStoreOf(context);
    final waiting = store?.pictureOf(name) == null;
    return Padding(
      padding: EdgeInsets.only(top: t.space(1), bottom: t.space(2)).add(EdgeInsets.symmetric(horizontal: gutterOf(context))),
      child: LayoutBuilder(
        builder: (context, box) {
          final width = (box.maxWidth * sketchShare).clamp(120.0, sketchMostWidth).toDouble();
          return Align(
            key: ValueKey<String>(waiting ? 'sketch-waiting' : 'sketch'),
            alignment: sketchEnd ? AlignmentDirectional.topEnd : AlignmentDirectional.topStart,
            child: SizedBox(
              width: width,
              child: KeptPicture(
                name: name,
                store: store,
                label: caption,
                maxHeight: MediaQuery.sizeOf(context).height * 0.34,
                waiting: waiting ? SizedBox(width: width, height: width * 1.25) : null,
              ),
            ),
          );
        },
      ),
    );
  }
}

/// How much of the column a field sketch takes, and the most it is wide.
const double sketchShare = 0.42;
const double sketchMostWidth = 300;

/// A picture became loadable (the store said so): rebuild the widgets.
final StateEffectType<Null> refreshImages = StateEffect.define<Null>();
int _generation = 0;

/// A picture under each line that holds one. A film's line holds its poster as a picture, and its card draws that
/// poster (videos.dart), so the picture steps aside there rather than drawing it twice. The lines are the tree's
/// own keeping (`pictureFacts`): a keystroke reads the lines it changed for a picture, not the note.
DecorationSet _decorate(EditorState state) {
  final builder = RangeSetBuilder<Decoration>();
  var sketches = 0;
  for (final line in pictureFacts.of(state.doc)) {
    final sketch = isSketch(line.fact.name);
    builder.add(line.to, line.to, Decoration.widget(widget: ImageWidget(line.fact.name, line.fact.caption, _generation, sketchEnd: sketch && sketches.isEven), block: true, side: 1));
    if (sketch) sketches += 1;
  }
  return builder.finish();
}

final StateField<DecorationSet> _imageField = StateField.define<DecorationSet>(
  create: _decorate,
  update: (decorations, tr) {
    if (tr.docChanged || tr.effects.any((e) => e.isOf(refreshImages))) return _decorate(tr.state);
    return decorations;
  },
  provide: (field) => EditorViewLike.decorations.from<DecorationSet>(field),
);

/// Hears a picture arrive from the store and asks the field to look again.
class _ImageReady extends PluginValue {
  _ImageReady(this.view) {
    _store = view.state.facet(pictureStore);
    _store?.addListener(_onReady);
  }

  final EditorViewLike view;
  PictureStore? _store;
  bool _told = false;
  bool _gone = false;

  void _onReady() {
    // A store tells from inside whatever asked it, which may be the view's own build: told a turn later, once.
    if (_told) return;
    _told = true;
    scheduleMicrotask(() {
      _told = false;
      if (_gone) return;
      _generation += 1;
      view.dispatch(TransactionSpec(effects: refreshImages.of(null)));
    });
  }

  @override
  void update(ViewUpdate update) {
    final store = update.state.facet(pictureStore);
    if (identical(store, _store)) return;
    _store?.removeListener(_onReady);
    _store = store;
    _store?.addListener(_onReady);
  }

  @override
  void destroy() {
    _gone = true;
    _store?.removeListener(_onReady);
  }
}

final ViewPlugin<_ImageReady> _imageReady = ViewPlugin.define<_ImageReady>(_ImageReady.new);

/// Remembers the caret now, for a picture that will arrive later. Answers a handle for [insertImageAt].
int reserveImageSpot(EditorViewLike view) {
  final kept = reserveSpot(view.state);
  view.dispatch(kept.tr);
  return kept.spot;
}

/// Puts a picture where [reserveImageSpot] was called, however the note changed since.
void insertImageAt(EditorViewLike view, int spot, String name) {
  insertImage(view, name, spotAt(view.state, spot) ?? view.state.selection.main.head);
  releaseImageSpot(view, spot);
}

/// Forgets a reserved place, when the picture never came.
void releaseImageSpot(EditorViewLike view, int spot) => view.dispatch(releaseSpot(view.state, spot));

/// A picture off the clipboard: its bytes and the type it says it is.
typedef PastedPicture = ({Uint8List bytes, String type});

/// A pasted picture, or several: each kept, and put in at the caret the same way Photo does, one after another.
/// Text in the same paste is the caller's to drop: the picture is what was meant. What is not a picture is left
/// out; a paste with no picture answers false and is left to the editor as usual. What goes wrong is reported
/// through `onError`. Answers once every picture has landed or failed.
Future<bool> pasteImages(EditorViewLike view, List<PastedPicture> files, {void Function(String message)? onError}) async {
  final pictures = files.where((file) => file.type.startsWith('image/')).toList();
  if (pictures.isEmpty) return false;
  final store = view.state.facet(pictureStore);
  final spot = reserveImageSpot(view);
  for (final file in pictures) {
    try {
      if (store == null) throw StateError(cannotAddPictures);
      insertImageAt(view, spot, await store.save(file.bytes, type: file.type));
      // A second picture in the same paste goes after the first.
      view.dispatch(TransactionSpec(effects: markSpot.of((id: spot, pos: view.state.selection.main.head))));
    } catch (failure) {
      onError?.call(failureWords(failure));
    }
  }
  releaseImageSpot(view, spot);
  return true;
}

/// Pictures in the editor: shown under their lines from `store`. (Pasting is [pasteImages], which the input layer
/// calls; `onImageError` is kept in the signature's place for it there.)
Extension inlineImages({PictureStore? store}) => Extension.list(<Extension>[_imageField, _imageReady, insertSpots, if (store != null) pictureStore.of(store)]);

/// Puts a picture into the note on a line of its own at the line holding `at` (the caret by default), and leaves
/// the caret on the line after it so typing carries on below the picture: inserts.dart's rule for a thing drawn on
/// a line of its own. A line is never split: a caret in the middle of a sentence, or of another picture's
/// markdown, puts the picture after that whole line. A line with nothing on it but a lead gives way, and a blank
/// line keeps the picture out of a list, a quote or a table above it.
void insertImage(EditorViewLike view, String name, [int? at]) {
  final plan = ownLinePlan(view.state, at ?? view.state.selection.main.head, imageMarkdown(name));
  view.dispatch(TransactionSpec(changes: plan.changes, selection: plan.editorSelection, scrollIntoView: true, annotations: isolateHistory.of('full')));
  view.focus();
}

// ---- useNotePictures.ts --------------------------------------------------------------------------------------------

/// How long a sentence stays on the note before it gets out of the way.
const Duration saidFor = Duration(milliseconds: 6000);

/// Pictures put into the open note, and the line under the header that says when one did not come in
/// (`useNotePictures`).
///
/// A picture goes in at the caret on its own line: from the phone's picker (the press-and-hold menu's Add image),
/// or one the shell copied out of the clipboard (the menu's Paste). The line is the note's one place for a
/// sentence about the note, said once and then out of the way.
class NotePictures extends ChangeNotifier {
  NotePictures({required EditorViewLike? Function() view, PicturePicker? pick, PictureStore? store, this.onPlaced}) : _view = view, _pick = pick, _store = store;

  final EditorViewLike? Function() _view;
  final PicturePicker? _pick;
  final PictureStore? _store;

  /// A picture landed: the page's light buzz.
  final VoidCallback? onPlaced;

  String? _problem;
  Timer? _timer;

  /// The sentence on the note now, or null.
  String? get problem => _problem;

  /// Puts a sentence on the note, or null to take it off.
  void say(String? message) {
    _timer?.cancel();
    _timer = null;
    if (message != null && message.isNotEmpty) _timer = Timer(saidFor, () => say(null));
    if (_problem == message) return;
    _problem = message;
    notifyListeners();
  }

  Future<void> _place(Future<String?> Function() fetch) async {
    say(null);
    final view = _view();
    // The place is taken now: the picker leaves the app, and the caret is not guaranteed to be where it was when
    // it comes back.
    final spot = view != null ? reserveImageSpot(view) : null;
    try {
      final name = await fetch();
      if (name != null && view != null && spot != null) {
        insertImageAt(view, spot, name);
        onPlaced?.call();
      }
    } catch (failure) {
      say(failureWords(failure));
    } finally {
      if (view != null && spot != null) releaseImageSpot(view, spot);
    }
  }

  /// Opens the phone's picker and puts what is chosen at the caret.
  Future<void> addPhoto() => _place(() {
    final pick = _pick;
    if (pick == null) throw StateError(cannotAddPictures);
    return pick();
  });

  /// Puts in the picture the shell copied out of the clipboard, by its path.
  Future<void> pasteImage(String path) => _place(() {
    final store = _store;
    if (store == null) throw StateError(cannotAddPictures);
    return store.adopt(path);
  });

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }
}
