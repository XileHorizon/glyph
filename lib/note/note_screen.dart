/// One note, open: the words in their editor, and everything that floats over or beside them. A port of
/// `src/app/editor/NoteScreen.tsx` with `NoteScreen.module.css`.
///
/// This screen owns SAVING: the words are kept by a [NoteSaving] (lib/core/library.dart, the port of
/// `useNoteSaving`), saved on a debounce, and flushed on every way the app can go away and every way off the note
/// this screen offers. Everything that changes the open note goes through the editor's view or [_onChange], never
/// round them.
///
/// One screen shows several things in one place: the note's words, or, for a note that is a canvas or a book, the
/// canvas drawn or the book's index, with the JSON or Markdown behind the view switch. The editor stays mounted
/// behind whichever of the others is up, hidden, so nothing typed is lost and its caret keeps its place.
///
/// What is here, as on the page: the header's glass with the page's smoke under it; the page that scrolls, padded
/// by the header; the byline; the editor filling the page; the note's tools, in the app's bar where there is one
/// and in this header where there is not; the More sheet with its pages; saving; the look, the name and a version
/// put back, each written through the editor as one change; landing at an item (`at`); opening where the note was
/// left; two fingers pinching the text's size; the caret asked for in a note just made; the blank note's ghost.
///
/// What differs from the page:
/// - **The editor is a seam** (lib/note/note_editor.dart): the screen is given a [NoteEditorBuilder] and works
///   through the `EditorView` it is told of. Until piece D's widget is wired the builder is the stand-in, which
///   draws and takes the screen's own changes but has no caret.
/// - **What other pieces and stages own comes in through [NoteSeams]**, each nullable, each named for the web file
///   it ports: find, the bookmark, comments, sharing, the AI, plugins' links, the place and its map card, the
///   book's bar and foot, and the canvas, book and journal views, each drawn only where it is given (lib/root gives
///   all three). The tape is one of the rows of [NoteSeams.head], and its transcript [NoteSeams.transcript],
///   which takes the page under the tape while the tape plays and is not there at all otherwise, as on the page.
/// - **The blank page's names and template cards are a block after line 1 inside the editor**, as on the page
///   (editor/nameChips.ts; lib/editor/items/blank_offers.dart), so a line made under the first is under them too.
///   The screen keeps what the page's field kept, and tells the editor only whether the block is offered: they wait
///   for what the page's waited for, the editor focused and the page ready for words (a device with no keyboard on
///   the screen, the keyboard up, or a press of the person's own ended on the page). A map at the top's card is offered where the note keeps a place
///   ([NoteScreen.tags]).
/// - **A note keeping its place** is this screen's, as it is the page's, over what the app hands it
///   ([NoteScreen.tags], lib/core/place_tags.dart): the tag its words carry or the one waiting to be written, the
///   box held for a fix on its way, Add my location and Remove location, a name arriving. The card itself is a seam
///   ([NoteSeams.mapCard]), since the tiles and the way to the phone's maps are the app's.
/// - **The tools are handed to the bar**, not put there by a portal (shell/top_bar_tools.dart), so they listen to a
///   model this screen changes.
/// - **The page is a scroll view of slivers**: the page's padding, the byline and the editor are slivers of one
///   `CustomScrollView`, where the page was a flex column that scrolled. The scroll view is padded by what the
///   keyboard covers, since nothing above this screen shortens the window for it. The body's `flex: 1 0 auto` (the editor as
///   tall as the page at least) is a last sliver that fills what is left and gives the editor the focus on a tap.
/// - **`--wisp-under` is always the header's height**. The page falls back to 3.6rem with the smoke switched off,
///   which puts the byline under the bar (measured 2026-10-07: 79.9 against a pane 91.8 tall); that is not carried.
/// - **A note in the Trash** is [NoteScreen.readOnly]: its editor takes no typing and nothing is saved. The page
///   has no such state, since it never opens one.
/// - **A save refused for good** is said in the note's one line of problems (`.problem`), under the header, for as
///   long as the note is open; the page only logs it.
/// - **The note's one line of problems** ([NoteSeams.problem]) is drawn where the header's glass ends. On the page
///   it is the screen's first child in its column, which was under the header while the header was a strip; the
///   header is a pane laid over the page now (app.css `.app-headerPane`, `position: absolute`), so the page's line
///   is at the window's top behind the glass, where it cannot be read, and the page drops a line while it is said.
///   Neither is carried: the sentence is where the page's own comment says it is, under the header.
/// - The arrival (`noteRise`: the body rising 8px as it fades in) is drawn for the page as a whole.
/// - **Simple mode's chrome** (GHST-105; Matt: "it still is a bit complex with the tabs and such… build out a clean
///   simple UI", and for the note "‹ Notes, ⋯ and Done; the title in the page"). Where the app draws no bar over the
///   note, the header is [NoteSimpleHeader]: the way back as a word ([NoteScreen.backLabel]), ⋯ for the More sheet
///   and Done while the keyboard is up or the editor has the focus; no tools at all in it. The view switch, Pin and
///   Archive are rows of the sheet ([NoteSettings.viewSwitch]); the mic, the + and a picture are the Format bar's
///   tail ([FormatBar.onPicture], [FormatBar.onAdd], [FormatBar.onSpeak]); Find in note is the sheet's row. The
///   note hands the dock nothing of its own, so with the root's halo-only seam there is no dock. Advanced mode is
///   as it was, to the pixel.
/// - **The dock** (lib/shell/page_dock.dart, [NoteScreen.dock]), which the page has only on its home page: at the
///   bottom end corner, Claude (the chat with the note's `[[Title]]` in its field), and the note's own actions for
///   what is up. A note's words: Find in note, Speak into it, Add (the +'s list at the caret's line), and its ⋯ at
///   the foot. A canvas: Add a card and Fit (the canvas's own, offered by its view), and its ⋯. A notebook's index:
///   Add a page and Read straight through; a journal's, New entry; each with its ⋯. It steps aside while the keyboard
///   is up, so it never stands over the caret, and the page keeps room at its foot for it.
library;

import 'dart:async';

import 'package:flutter/foundation.dart' show ValueListenable, defaultTargetPlatform;
import 'package:flutter/gestures.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter/widgets.dart' hide Decoration;
import 'package:glacier/glacier.dart';

import '../app/iphone_page.dart' show IPhoneKeyboardBar, KeyboardBarOffer, KeyboardBarScope;
import '../art/art.dart';
import '../core/book.dart';
import '../core/boards/make.dart';
import '../core/canvas_body.dart';
import '../core/front_matter.dart';
import '../core/geotag.dart';
import '../core/library.dart';
import '../core/live_titles.dart';
import '../core/banner.dart' show bannerOf;
import '../core/look.dart';
import '../core/note.dart';
import '../core/note_names.dart';
import '../core/place_tags.dart';
import '../core/preferences.dart';
import '../core/stored.dart';
import '../core/unfold.dart';
import '../core/untouched.dart';
import '../core/versions_file.dart';
import '../core/versions_live.dart';
import '../core/versions_record.dart';
import '../core/workspaces.dart';
import '../book/book_spot.dart' show ChapterSpot, writeBookSpot;
import '../book/journal.dart' show JournalWriter, entryPlaceOf, templateOf, withEntryPlace, withJournal, withTemplate, withoutJournal;
import '../book/template_picker.dart' show EntryPlaceDevice;
import '../book/tickets.dart' show withNotebookKey;
import '../ai/note_review.dart' show onReviewHandedBack;
import '../core/location.dart' show whyLocateFailed;
import '../editor/ai/blanks.dart' show fillPlanOf;
import '../editor/editor.dart';
import '../editor/items/blank_offers.dart';
import '../editor/media/map_card.dart' show MapPicture, MapSize;
import '../editor/view/editor_view.dart';
import '../editor/view/view_mode.dart';
import '../core/page_scroll.dart' show pullRestPhysics;
import '../notes/note_templates.dart' show NoteTemplate, fillNoteTemplate;
import '../notes/pull_to_refresh.dart';
import '../notes/template_cards.dart';
import '../home/home_icons.dart' show HomeGlyph;
import '../shell/header_pane.dart';
import '../shell/page_dock.dart';
import '../shell/screen.dart' show Caret;
import '../shell/top_bar_tools.dart';
import '../sheet/css.dart';
import 'byline.dart';
import 'format_bar.dart';
import 'land_at.dart';
import 'note_editor.dart';
import 'note_place.dart';
import 'note_settings.dart';
import 'note_tools.dart';
import 'page_head.dart';
import 'pinch_zoom.dart';
import 'version_keeping.dart';

/// The links between notes, for this note (lib/links/note_links.dart): how many notes link here, worn on the
/// Links tool's ring; the More sheet's rows for them (Links, Outline, Local graph, Copy link to this line) with
/// their pages, given the editor, the page and the sheet's close; and the editor and the page handed over once both
/// are here, for the side panel's outline, answering the way to say they have gone.
@immutable
class NoteLinksSeam {
  const NoteLinksSeam({required this.count, required this.section, this.opened, this.asked});

  final ValueListenable<int> count;
  final NoteSheetSection Function(BuildContext context, EditorView? view, ScrollPosition? page) section;
  final VoidCallback Function(EditorView view, ScrollPosition page)? opened;

  /// Told when the Links page is asked for from outside the screen (the palette's Links to this note).
  final Listenable? asked;
}

/// What the screen is given by pieces and stages that are not its own. Every one is optional: left out, its row,
/// its tool or its drawing is simply not there, or is a card that says which stage draws it.
@immutable
class NoteSeams {
  const NoteSeams({
    this.onFind,
    this.onAdd,
    this.onAddImage,
    this.onShare,
    this.sharing,
    this.sharingSection,
    this.onComment,
    this.commentsSummary,
    this.onCommentsList,
    this.bookmark,
    this.writtenBookmark,
    this.onAi,
    this.aiRunning,
    this.linked,
    this.plugins,
    this.head,
    this.banner,
    this.transcript,
    this.saving,
    this.hasTape,
    this.beforeSpeak,
    this.sync,
    this.recordingChanged,
    this.cheatSheet,
    this.location,
    this.shareVersionsFile,
    this.mapCard,
    this.bookBar,
    this.bookFoot,
    this.canvas,
    this.book,
    this.journal,
    this.over,
    this.around,
    this.headRoom,
    this.problem,
    this.links,
  });

  /// Find and replace opened in the note with its first words (editor/FindBar.tsx, piece K).
  final void Function(EditorView view, String initial)? onFind;

  /// The +'s list opened for the caret's line (lib/editor/plus), from the dock's Add.
  final void Function(EditorView view)? onAdd;

  /// A picture put in the note, from the phone's own picker: the press-and-hold band's Add image
  /// (lib/editor/band/context_band.dart `onAddImage`), which simple mode's Format bar presses from its tail too.
  final FutureOr<void> Function()? onAddImage;

  /// The note's share link in a window of its own (share/ShareRows.tsx).
  final VoidCallback? onShare;

  /// Sharing's rows on the More sheet.
  final List<Widget> Function(BuildContext context)? sharing;

  /// Sharing as a section of its own, heading and group (lib/share/ui/share_rows.dart `ShareRows`), where
  /// [sharing] is the rows alone.
  final WidgetBuilder? sharingSection;

  /// A comment started on the caret's line (editor/useNoteComments.tsx), how many threads there are, and their list.
  final void Function(EditorView view)? onComment;
  final String? Function()? commentsSummary;
  final VoidCallback? onCommentsList;

  /// The bookmark (editor/useBookmark.ts): whether the note has one, and the press that sets, moves or removes it.
  final ({bool marked, VoidCallback onPress}) Function(EditorView view, ScrollPosition page)? bookmark;

  /// The bookmark written in the note's words, as a place to open at (editor/bookmarkLine.ts).
  final Place? Function(EditorView view)? writtenBookmark;

  /// A run of the AI on this note (editor/useNoteAi.ts).
  final void Function(EditorView view, String kind, [String? instruction])? onAi;

  /// The AI's kind of run on this note now, by its id, or null (`ai.runningKind`): its row in the More sheet is
  /// pressed, with a dot at its end.
  final String? Function()? aiRunning;

  /// What the note is linked to: plugins' rows (plugins/registry.ts), made elsewhere; and the plugins' own links
  /// and actions for the sheet to draw, each with its page ([NotePlugins]), given the note as an action changes it.
  final List<Widget> Function(BuildContext context)? linked;
  final NotePlugins? Function(EditorView view)? plugins;

  /// What sits at the top of a note of words, under its notebook's bar and its byline and over its words: the
  /// recording's tape (tapes/NoteTape.tsx) and what the note is linked to (plugins/LinkMarks.tsx), whose press is
  /// [openSettings], the note's More sheet.
  final List<Widget> Function(BuildContext context, VoidCallback openSettings)? head;

  /// The note's header banner, across the very top of a note of words: the picture its front matter's `banner:` names
  /// (lib/core/banner.dart), or null where it names none, which the seam may still draw something for (Lovart making
  /// one: lib/plugins/lovart/banners.dart). Drawn again whenever the banner the note names changes.
  final Widget Function(BuildContext context, String noteId, String? name)? banner;

  /// The phrases of the note's recording as they were spoken (tapes/NoteTape.tsx `TranscriptWords`), given while
  /// its tape plays and only then: playing takes the screen for the transcript, and the note waits under it
  /// (NoteScreen.tsx `shown`). Null at every other time, and the note is its words.
  final WidgetBuilder? transcript;

  /// Handed the way to save what is typed now ([NoteScreenState.flush]) as the screen is made: the AI flushes
  /// before a run, so the run's Undo has the note as it was.
  final void Function(VoidCallback flush)? saving;

  /// Whether the note wears its tape now (`tape.length > 0`): a spoken note is talked into from its tape's Add, so
  /// the note's own mic is in neither the bar nor the More sheet. And what is told as the note's own mic is
  /// pressed, before the recorder is asked for (`forgetRemoved`): a new take replaces a removed recording's file,
  /// so its Undo would no longer be true.
  final bool Function()? hasTape;
  final VoidCallback? beforeSpeak;

  /// A sync, waited for a few seconds at most (core/sync/engine.ts `syncWithin`): what a pull down from the top of
  /// the note asks for between saving what is typed and reading the note again. Absent, as in a build with no
  /// account, the pull saves and reads all the same.
  final Future<void> Function()? sync;

  /// Hears that the phone's write-up changed this note (ai/summaries.ts `onRecordingChanged`, for this note alone),
  /// and answers the way to stop: the screen then reads the note and takes it, when nothing typed here is waiting
  /// to be saved; else the next save picks it up. Absent, the write-up is taken only as the note opens.
  final VoidCallback Function(VoidCallback changed)? recordingChanged;

  /// The formatting cheat sheet's page (guide/CheatSheet.tsx).
  final WidgetBuilder? cheatSheet;

  /// Where the note was written, for its row, where something other than the screen's own answers it (a test);
  /// with [NoteScreen.tags] the screen makes the row itself, as the page does.
  final NoteLocation Function(GeoTag? tag)? location;

  /// Shares a note's versions file (core/versions/share.ts).
  final Future<String?> Function(String noteId, String title)? shareVersionsFile;

  /// The map at the top of a tagged note (editor/MapCard.tsx): `header` for a map note, else the card. `quiet` for
  /// a tag still waiting for a draft's first words, which fetches no tiles; `arrive` for a card that just appeared
  /// on the open note and `leave` for one whose tag was just taken off, which calls `onLeft` once it has gone.
  final Widget Function(BuildContext context, GeoTag tag, {required bool header, required bool quiet, required bool arrive, required bool leave, VoidCallback? onLeft})? mapCard;

  /// A chapter's book, its place in it and the chapters either side, over and under the words (book/BookNav.tsx).
  final Widget Function(BuildContext context, BookPlace place)? bookBar;
  final Widget Function(BuildContext context, BookPlace place)? bookFoot;

  /// The three views that take the page for a note that is not words: canvas/CanvasView.tsx (stage 6),
  /// book/BookView.tsx and book/JournalView.tsx (stage 5). Each is handed the body and writes the note through
  /// `onChange`, as typing does.
  final Widget Function(BuildContext context, String body, ValueChanged<String> onChange)? canvas;

  /// The notebook's view is a sliver of the note's page, where the other two are boxes.
  final Widget Function(BuildContext context, String body, ValueChanged<String> onChange)? book;
  final Widget Function(BuildContext context, String body, ValueChanged<String> onChange)? journal;

  /// What floats over the page while the note's words are up: the press-and-hold band, the + list, the find bar.
  final List<Widget> Function(BuildContext context, EditorView view)? over;

  /// The room the page keeps clear under its header for what floats there, in pixels (`--ai-strip-room`,
  /// editor/useStripRoom.ts): the AI's strip's height and 8 more while it is up, 0 once it is gone. The page starts
  /// that much lower, so the strip never sits over the tape or the note's first line.
  final ValueListenable<double>? headRoom;

  /// The sentence on the note now, or null (editor/useNotePictures.ts `problem`): why a picture or a film did not
  /// come in, or what a plugin had to say of the note. The note's one place for a sentence about the note
  /// (`.problem`, `role="alert"`), said under the header and gone after six seconds, which is its holder's to count.
  final ValueListenable<String?>? problem;

  /// What stands round the page that scrolls, and so hears its scrolling: the + and its list (editor/plus
  /// `PlusLayer`), a chip's menu, the band. Given the page, it answers the page inside them. The view is null until
  /// the editor has one and while the note's words are not what is up; what it answers must keep the page in the
  /// same place in its tree either way, since a page that moves house takes a new scroll position, and the place
  /// keeper and a landing hold the one they were made with.
  final Widget Function(BuildContext context, EditorView? view, Widget page)? around;

  /// The links between notes: the Links tool and its count, and the More sheet's rows for them.
  final NoteLinksSeam? links;
}

class NoteScreen extends StatefulWidget {
  const NoteScreen({
    super.key,
    required this.note,
    required this.library,
    required this.workspaces,
    required this.onBack,
    required this.onDelete,
    required this.onPin,
    required this.onArchive,
    this.versions,
    this.preferences,
    this.device,
    this.untouched,
    this.liveTitles,
    this.onSpeak,
    this.onHistory,
    this.hinge,
    this.at,
    this.caret,
    this.book,
    this.takenTitles = const {},
    this.templates,
    this.onTemplates,
    this.onJournal,
    this.tags,
    this.reviewing = false,
    this.readOnly = false,
    this.editorBuilder = readOnlyNoteEditor,
    this.seams = const NoteSeams(),
    this.say,
    this.debounce = saveDebounce,
    this.lifecycle = true,
    this.clock,
    this.dock,
    this.backLabel = 'Notes',
    this.back = false,
  });

  final Note note;
  final NoteLibrary library;
  final WorkspaceStore workspaces;
  final VoidCallback onBack;

  /// A Back of its own at the start of its header, where the app's bar is not there to hold Home: simple mode's
  /// plain shell on a phone (GHST-105, lib/shell/app_shell.dart `_plain`). Nothing while the tools are in the bar's
  /// slot, and nothing beside a list pane, where the note is never the only thing on screen.
  final bool back;
  final ValueChanged<String> onDelete;

  /// Pin or unpin, given the note as it stands now (`onPin({...note, starred: pinned})`).
  final ValueChanged<Note> onPin;
  final ValueChanged<Note> onArchive;

  /// The versions; without them the note has no history rows.
  final VersionsRecord? versions;

  /// The preferences (the view, the smoke); the app's own unless given.
  final PreferencesStore? preferences;

  /// This device's memory, for the places, the zoom and the untouched records; the app's own unless given.
  final Stored? device;
  final UntouchedNotes? untouched;
  final LiveTitles? liveTitles;

  /// Talk into this note; left out where nothing records.
  final ValueChanged<String>? onSpeak;

  /// The history in a side panel, from the bar's History button; left out, the More sheet's page opens.
  final VoidCallback? onHistory;

  /// The hinge's angles, for the unfold; the phone's own unless given (core/unfold.dart `hingeAngles`).
  final Stream<double>? hinge;

  /// The item to land on when the note was opened by a link pointing inside it: `^anchor`, or `line:12`.
  final String? at;

  /// A note just made, to be written in: where the caret goes.
  final Caret? caret;

  /// The book this note is a chapter of, for the bar under its header.
  final BookPlace? book;

  /// Every note's title key, for the names a blank page offers.
  final Set<String> takenTitles;

  /// Your own templates, the pages of a Templates notebook, for the blank page's cards; null for the ones built in.
  final List<NoteTemplate>? templates;

  /// Your templates, the cards' last: the notebook they are kept in, made the first time. Left out, no such card.
  final VoidCallback? onTemplates;

  /// A journal open hands the app the way to write its index through this screen, and takes it back as it goes
  /// (`onJournal`).
  final ValueChanged<JournalWriter?>? onJournal;

  /// The places notes keep (lib/core/place_tags.dart): given, the note draws its tag or the one waiting for it,
  /// holds its map's box for a fix on its way, and its More sheet adds and removes its location. Absent, a note
  /// draws only what its words say.
  final PlaceTags? tags;

  /// Whether the review after a recording is live for this note as it opens: its tag waits until the review has
  /// handed back (`reviewing`).
  final bool reviewing;

  /// A note in the Trash: read, not written.
  final bool readOnly;

  final NoteEditorBuilder editorBuilder;
  final NoteSeams seams;

  /// A toast.
  final void Function(String message)? say;

  /// For a test: the saving's debounce, whether the app's comings and goings are listened to, and the time.
  final Duration debounce;
  final bool lifecycle;
  final DateTime Function()? clock;

  /// Claude and the halo for the page's dock (docs/DOCK.md); no dock where it is left out.
  final PageDockSeam? dock;

  /// The word on simple mode's way back ([NoteSimpleHeader]): where the note was opened from. "Notes" unless the
  /// root says otherwise ("To-dos" for a to-do opened from the list).
  final String backLabel;

  @override
  State<NoteScreen> createState() => NoteScreenState();
}

/// What the note says when its save was refused for good.
const String saveStoppedWords = 'This note changed somewhere else. What you write here now is not being saved.';

class NoteScreenState extends State<NoteScreen> with TickerProviderStateMixin {
  late final NoteSaving _saving;
  VersionKeeping? _versioning;
  VoidCallback? _liveGone;
  late final NoteZoom _zoom = NoteZoom(device: widget.device);
  final PinchTracker _pinch = PinchTracker();
  final ScrollController _scroll = ScrollController();
  final GlobalKey _page = GlobalKey();
  final GlobalKey _unfolding = GlobalKey();
  late final AnimationController _rise = AnimationController(vsync: this, duration: const Duration(milliseconds: 320));

  /// On a folding phone, the note flattens with the hinge as the phone opens (core/unfold.dart). Made once the
  /// tokens say whether motion is turned down.
  UnfoldDriver? _unfold;

  EditorView? _view;

  /// Simple mode's Format bar as the iPhone's keyboard bar is offered it (format_bar.dart), made once a view and
  /// kept: the bar hears a new offer at every change of what it is handed.
  Widget? _formatRow;
  EditorView? _formatRowFor;
  String? _formatRowTail;
  NotePlaceKeeper? _keeper;
  LandAt? _landing;
  Timer? _checking;

  GeoTag? _tag;
  Look? _look;
  String? _banner;

  /// The map's box held for a new note while its fix is on its way, or once it is known none is coming (`hold`).
  Held? _hold;

  /// The card just appeared on this open note: it arrives on the beat rather than at full height.
  bool _arriving = false;

  /// The tag just taken off, drawn a moment longer while its card leaves on the same beat; null otherwise.
  GeoTag? _leaving;
  late bool _reviewing = widget.reviewing;
  VoidCallback? _unwatchTag;
  VoidCallback? _unhearReview;
  late bool _wasBlank;

  /// Whether a refusal the device keeps still stands, read as the note opens: the blank page's map card says so.
  bool _refusalStands = false;

  /// The places, for a note that can be written.
  PlaceTags? get _tags => widget.readOnly ? null : widget.tags;
  late bool _pinned = widget.note.starred;
  late bool _drafted;
  late bool _untouched;
  late bool _fresh;
  bool _source = false;
  late String _typedBody = widget.note.body;
  bool _settingsOpen = false;
  NoteSettingsPage? _settingsAt;

  /// One of the links' pages to open the sheet at ([NoteLinksSeam]): Links, from its tool.
  String? _settingsItem;

  /// Says the editor and the page have gone, to the links' side panel.
  VoidCallback? _linksGone;
  bool _caretPlaced = false;
  bool _stopped = false;
  ({double distance, double zoom, int? pos, double y})? _pinching;
  ScrollHoldController? _held;

  /// The blank page's offers: whether the page is ready for words, whether the editor had the focus when last
  /// asked, the cards put away by a press elsewhere on the page, and the press that may be one.
  bool _ready = !(defaultTargetPlatform == TargetPlatform.android || defaultTargetPlatform == TargetPlatform.iOS);
  bool _focused = false;
  bool _cardsGone = false;
  ({int pointer, Offset at})? _armed;
  final GlobalKey _offers = GlobalKey();

  /// The editor's extensions that are this screen's own: the blank page's block after line 1, whose inside is
  /// drawn here ([_offersBlock]). One list for the screen's life: another would make the editor's view again.
  late final List<Extension> _ownExtensions = <Extension>[blankOffers(_offersBlock)];

  /// Told after a build of the screen while the block is offered, so its inside is drawn again from what the
  /// screen now has (the names at a new minute, the cards put away).
  final _Told _offersChanged = _Told();
  Timer? _minute;

  late final ValueNotifier<NoteToolsModel> _toolsModel = ValueNotifier(_model());
  late final Widget _tools = NoteTools(model: _toolsModel);
  late final Widget _more = NoteMore(onMore: _openMore);

  /// The rings a canvas, a notebook's index or a journal offers the dock (lib/shell/page_dock.dart): the screen is
  /// built again when what they look like changes, which is seldom (a notebook read straight through, a canvas
  /// that can no longer change), for the dock and the room its page keeps for it.
  late final DockOffers _dockOffers = DockOffers()..addListener(_offered);

  void _offered() {
    if (widget.dock != null) _redraw();
  }
  String _toolsKey = '';

  PreferencesStore get _prefs => widget.preferences ?? preferences;
  UntouchedNotes get _records => widget.untouched ?? untouchedNotes;
  LiveTitles get _live => widget.liveTitles ?? liveTitles;
  String get _id => widget.note.id;

  /// The editor's view, once it has one.
  EditorView? get view => _view;

  /// The live words.
  String get body => _saving.body;

  /// The note's name as its words say it.
  String get title => _saving.title;

  /// Whether a save was refused for good.
  bool get saveStopped => _stopped;

  // ---- what the note is ---------------------------------------------------------------------------------------------

  bool get _isCanvas => isCanvasBody(_typedBody);
  bool get _isBook => isBookBody(_typedBody);
  bool get _isJournal => isJournalBody(_typedBody);

  /// A canvas or a book: a note with a view of its own in front of its words.
  bool get _typed => _isCanvas || _isBook;
  bool get _drawing => _isCanvas && !_source;
  bool get _paging => _isBook && !_source;

  /// Whether the editor is what is showing.
  bool get _words => !_drawing && !_paging;

  /// NoteScreen.tsx `shown`: `'transcript'` while the note's tape plays, when the transcript has the page under
  /// the tape and the words wait hidden; `'raw'` at every other time. What the page asks `shown === 'raw'` of
  /// (the bookmark, find, a comment, the look, history, a board made of it, the view's switch, the pinch, the +
  /// and the band, the map, the notebook's foot, and where the note was left) asks [_raw].
  bool get _listening => widget.seams.transcript != null;
  bool get _raw => !_listening;
  NoteKind get _kind => _isCanvas ? NoteKind.canvas : (_isBook ? NoteKind.book : NoteKind.words);
  bool get _onPage => _typed ? !_source : _prefs.value.noteView == 'formatted';

  /// Simple mode (GHST-103, GHST-105): the plain chrome, with the tools in the sheet and the Format bar.
  bool get _simple => _prefs.value.simple;

  /// Whether a + may show beside an empty line, which is also when a blank page offers its names
  /// (`plusAllowed`): the note is words being written.
  bool get plusAllowed => !_typed && !widget.readOnly && _raw;

  /// Whether the blank page offers names and templates (`offering`): a note made in this run, with no words.
  bool get offering => _fresh && _saving.blank && plusAllowed;

  /// The names on offer now, or null where none are (core/note_names.dart).
  List<NameOffer>? get names => offering ? nameOffers(widget.clock?.call() ?? DateTime.now(), widget.takenTitles) : null;

  /// Whether the names are drawn now (`offersShown`): offered, the editor focused, the page ready for words.
  bool get offersShown => offering && _focused && _ready && _words;

  /// Whether the template cards are drawn under them (`cardsShown`).
  bool get cardsShown => offersShown && !_cardsGone;

  @override
  void initState() {
    super.initState();
    final note = widget.note;
    _saving = NoteSaving(widget.library, note, onExternalChange: _external, debounce: widget.debounce, lifecycle: widget.lifecycle && !widget.readOnly)..addListener(_saved);
    _tag = geoTagOf(note.body) ?? _tags?.pendingTag(note.id);
    _look = lookOf(note.body);
    _banner = bannerOf(note.body);
    _wasBlank = _saving.blank;
    final tags = _tags;
    if (tags != null) {
      _hold = tags.heldFor(note.id);
      _unwatchTag = tags.watchTag(note.id, _tagEvent);
      if (_records.isFresh(note.id)) {
        unawaited(tags.refusalStanding().then((standing) {
          if (mounted && standing != _refusalStands) setState(() => _refusalStands = standing);
        }));
      }
      _unhearReview = onReviewHandedBack((noteId) {
        if (noteId != _id) return;
        _reviewing = false;
        _settleTag();
      });
    }
    _drafted = _records.recordOf(_id) != null;
    _untouched = _drafted && _records.isUntouched(_id, note.body, recordingMs: note.recordingMs, starred: note.starred, archivedAt: note.archivedAt);
    widget.seams.saving?.call(flush);
    if (!widget.readOnly) _unhearRecording = widget.seams.recordingChanged?.call(_recordingChanged);
    _fresh = _records.isFresh(_id);
    final versions = widget.versions;
    if (versions != null && !widget.readOnly) _versioning = VersionKeeping(versions, _id, () => _saving.body, lifecycle: widget.lifecycle)..addListener(_redraw);
    // The history in the desktop's aside (lib/aside/aside_history.dart) reads the editor's words and restores through
    // it, as the More sheet's does: said for as long as this note is on screen (lib/core/versions_live.dart).
    if (versions != null && !widget.readOnly) _liveGone = liveNoteOpened(_id, LiveNote(current: () => _view?.state.doc.toString() ?? _saving.body, restore: restoreVersion));
    _prefs.addListener(_redraw);
    widget.seams.headRoom?.addListener(_redraw);
    widget.seams.links?.count.addListener(_redraw);
    widget.seams.links?.asked?.addListener(_linksAsked);
    widget.workspaces.addListener(_redraw);
    _zoom.addListener(_redraw);
    _caretPlaced = widget.caret == null;
    FocusManager.instance.addListener(_focusMoved);
    // A chapter open is where its book was left, so the book opens here again from outside it (book/bookSpot.ts).
    // Not a journal's entry: a journal always opens on itself, where New entry is.
    final book = widget.book;
    if (book != null && !book.journal) writeBookSpot(book.book.id, ChapterSpot(_saving.title), on: widget.device);
    if (_isJournal) _tellJournal();
    // After the frame: the tab row listens, and a listener outside this screen may not be told while the tree is
    // being built (a note opened by the shell is mounted in the middle of the shell's own build).
    if (SchedulerBinding.instance.schedulerPhase == SchedulerPhase.persistentCallbacks) {
      SchedulerBinding.instance.addPostFrameCallback((_) {
        if (mounted) _live.set(_id, _saving.title);
      });
    } else {
      _live.set(_id, _saving.title);
    }
    _rise.forward();
  }

  /// A pull down from the top of the note (notes/PullToRefresh.tsx, docs/DESIGN.md §152; `pullNote`): what is typed
  /// saved first, a sync waited for a few seconds at most, and the note as the library has it then taken, when
  /// nothing here is unsaved.
  Future<void> _pullNote() async {
    await _saving.settled();
    await widget.seams.sync?.call().then<void>((_) {}, onError: (Object _) {});
    final stored = await widget.library.get(_id).then<Note?>((note) => note, onError: (Object _) => null);
    if (stored != null && mounted) _saving.adopt(stored);
  }

  /// Whether a pull has the page: it does not scroll under one (the page's `preventDefault`). Read by the page's
  /// physics as a drag is applied, so the scroller keeps the one position it was made with: other physics would be
  /// another position, and the place keeper and a landing hold the first.
  bool _pulled = false;
  late final ScrollPhysics _pagePhysics = _HeldUnderPull(() => _pulled, parent: pullRestPhysics());

  /// The phone's write-up changed this note: its transcript is read and shown, when nothing typed here is waiting to
  /// be saved; else the next save picks it up (NoteScreen.tsx's `onRecordingChanged` effect).
  VoidCallback? _unhearRecording;
  void _recordingChanged() {
    unawaited(widget.library.get(_id).then<void>((fresh) {
      if (fresh != null && mounted) _saving.adopt(fresh);
    }, onError: (Object _) {}));
  }

  @override
  void dispose() {
    // A new note left without a word leaves nothing behind, its waiting tag included.
    if (_saving.blank && geoTagOf(_saving.body) == null) _tags?.setPendingTag(_id, null);
    _unhearRecording?.call();
    _unwatchTag?.call();
    _unhearReview?.call();
    _slowFix?.cancel();
    FocusManager.instance.removeListener(_focusMoved);
    _minute?.cancel();
    _offersChanged.dispose();
    if (_toldJournal) {
      final told = widget.onJournal;
      // After the frame: whoever listens may be building.
      if (told != null) SchedulerBinding.instance.addPostFrameCallback((_) => told(null));
    }
    _checking?.cancel();
    _keeper?.dispose();
    _landing?.dispose();
    _versioning
      ?..removeListener(_redraw)
      ..dispose();
    _liveGone?.call();
    _prefs.removeListener(_redraw);
    widget.seams.headRoom?.removeListener(_redraw);
    widget.seams.links?.count.removeListener(_redraw);
    widget.seams.links?.asked?.removeListener(_linksAsked);
    _linksGone?.call();
    widget.workspaces.removeListener(_redraw);
    _zoom
      ..removeListener(_redraw)
      ..dispose();
    _saving
      ..removeListener(_saved)
      ..dispose();
    _toolsModel.dispose();
    _dockOffers.dispose();
    _scroll.dispose();
    _rise.dispose();
    _unfold?.dispose();
    super.dispose();
  }

  /// A change of state that may be asked for while the tree is building (the editor told of words from outside).
  void _redraw([VoidCallback? change]) {
    if (!mounted) return change?.call();
    if (SchedulerBinding.instance.schedulerPhase == SchedulerPhase.persistentCallbacks) {
      change?.call();
      SchedulerBinding.instance.addPostFrameCallback((_) {
        if (mounted) setState(() {});
      });
      return;
    }
    setState(() => change?.call());
  }

  // ---- the blank page's offers --------------------------------------------------------------------------------------

  /// The focus moved somewhere: the names are drawn only while the editor has it.
  void _focusMoved() {
    // After the frame: the editor is told of its focus by its own listener, which may come after this one.
    SchedulerBinding.instance.addPostFrameCallback((_) {
      final focused = _view?.hasFocus ?? false;
      if (mounted && focused != _focused) setState(() => _focused = focused);
    });
    SchedulerBinding.instance.ensureVisualUpdate();
  }

  /// The editor is told whether the blank page's block is offered (`setOffers`), after the frame and only when
  /// what it was last told is otherwise; and the block, where it is drawn, is drawn again from what the screen has.
  void _tellOffers(bool offered) {
    final view = _view;
    if (view == null || (!offered && !blankOffered(view.state))) return;
    SchedulerBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !identical(view, _view)) return;
      if (blankOffered(view.state) != offered) view.dispatch(TransactionSpec(effects: setBlankOffers.of(offered)));
      if (offered) _offersChanged.tell();
    });
  }

  /// The inside of the blank page's block (`OffersWidget`): the names, the template cards while they are shown,
  /// and the ghost, from what the screen has now.
  Widget _offersBlock(BuildContext context) => ListenableBuilder(
        listenable: _offersChanged,
        builder: (context, _) {
          final prefs = _prefs.value;
          return _BlankOffers(
            key: _offers,
            names: names ?? const <NameOffer>[],
            onName: nameIt,
            cards: cardsShown
                ? TemplateCards(at: widget.clock?.call() ?? DateTime.now(), taken: widget.takenTitles, onChoose: startFrom, templates: widget.templates, onYours: widget.onTemplates, localOnly: prefs.localOnly, canLocate: _tags != null && _tags!.locations.cannotLocateHere == null, refused: _refusalStands ? _tags?.allowLocationWhere() : null, mapHeader: _tags == null ? null : (context) => const MapPicture(size: MapSize.header, pin: true))
                : null,
          );
        },
      );

  /// The names follow the clock: read again at the turn of each minute while they are offered (`useMinute`).
  void _watchMinute(bool on) {
    if (!on) {
      _minute?.cancel();
      _minute = null;
      return;
    }
    if (_minute != null) return;
    final now = DateTime.now();
    _minute = Timer(Duration(seconds: 60 - now.second, milliseconds: 50), () {
      _minute = null;
      if (mounted) setState(() {});
    });
  }

  /// The page back at its top, where the note now starts (`backToTop`): a card lower down is pressed with the page
  /// scrolled, which keeps its scroll as the cards go. Once the words are laid out, and only then the caret asked
  /// into view: from the top, that only ever brings it up from below, where asked first it left the heading under
  /// the header (seen on the emulator, 2026-10-08).
  void _backToTop(EditorView editor) {
    void top() {
      if (_scroll.hasClients) _scroll.jumpTo(_scroll.position.minScrollExtent);
    }

    top();
    SchedulerBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !identical(editor, _view)) return;
      top();
      editor.dispatch(const TransactionSpec(scrollIntoView: true));
    });
  }

  /// A card pressed: the blank note becomes that template, as one change, so one undo takes it back to the blank
  /// page with its names and cards. Its record first, so a note left without a word of the person's own is taken
  /// back; its name settled against every other note's; the caret in its first open line, the focus kept; and the
  /// page back at its top, where the note now starts (`startFrom`).
  void startFrom(NoteTemplate template) {
    final editor = _view;
    if (editor == null || !_records.isFresh(_id) || editor.state.doc.toString().trim().isNotEmpty) return;
    final now = widget.clock?.call() ?? DateTime.now();
    final filled = fillNoteTemplate(template, now, widget.takenTitles);
    _records.remember(_id, UntouchedRecord(title: filled.title, words: filled.words, at: now.millisecondsSinceEpoch));
    _drafted = true;
    setState(() => _untouched = true);
    editor.dispatch(TransactionSpec(changes: ChangeSpec(from: 0, to: editor.state.doc.length, insert: filled.body), selection: EditorSelection.single(filled.caret.clamp(0, filled.body.length)), userEvent: 'input.template'));
    _backToTop(editor);
    flush();
    editor.focus();
    HapticsProvider.of(context)(HapticKind.selection);
    // A map at the top: the card's press is the choice to keep a place, and its box is held from now.
    final tags = _tags;
    if (tags != null && template.look == Look.map && geoTagOf(_saving.body) == null && tags.pendingTag(_id) == null && tags.heldFor(_id) != Held.waiting) {
      tags.holdFor([_id]);
      unawaited(tags.tagEntryIfWanted([_id], (reviewing: false)));
    }
  }

  // ---- a notebook's index written from outside ----------------------------------------------------------------------

  bool _toldJournal = false;

  void _tellJournal() {
    final told = widget.onJournal;
    if (told == null) return;
    _toldJournal = true;
    final writer = JournalWriter(id: _id, write: writeNotebook);
    // After the frame: whoever listens may be building.
    SchedulerBinding.instance.addPostFrameCallback((_) {
      if (mounted) told(writer);
    });
  }

  /// A change to a notebook's or a journal's index made by the app (an entry's line put in or taken out): through
  /// this screen, whose next save would otherwise write the old index back, and kept at once (`writeIndex`).
  void writeNotebook(String Function(String body) change) {
    final next = change(_saving.body);
    if (next == _saving.body) return;
    // Into the editor kept behind a notebook as well, so it (and, in a team's notebook, the team's document bound to
    // it) holds what the notebook writes, and a change that comes through it later is made to these words.
    if (_view != null && (_source || _isBook)) {
      _external(next);
      // An editor that answered with nothing (no listener yet) has its words kept here all the same.
      if (_saving.body != next) _onChange(next);
    } else {
      _onChange(next);
    }
    if (mounted) setState(() => _typedBody = next);
    flush();
  }

  // ---- saving -------------------------------------------------------------------------------------------------------

  /// The tab says the note's name as line 1 is written (core/liveTitles.ts), and the header its title.
  void _saved() {
    _live.set(_id, _saving.title);
    _redraw();
  }

  /// Words that arrived from outside the editor - a meeting's transcript - are put into it whole.
  void _external(String next) {
    final editor = _view;
    if (editor == null) return;
    final now = editor.state.doc.toString();
    if (now == next) return;
    // Only the stretch that differs: in a team's note the editor is bound to the team's document, where the whole
    // words taken out and put back would be every line deleted and typed again over anyone else's at the same time.
    var start = 0;
    while (start < now.length && start < next.length && now.codeUnitAt(start) == next.codeUnitAt(start)) {
      start += 1;
    }
    var endNow = now.length, endNext = next.length;
    while (endNow > start && endNext > start && now.codeUnitAt(endNow - 1) == next.codeUnitAt(endNext - 1)) {
      endNow -= 1;
      endNext -= 1;
    }
    editor.dispatch(TransactionSpec(changes: ChangeSpec(from: start, to: endNow, insert: next.substring(start, endNext))));
  }

  /// Saves what is waiting, and looks at whether the library is still taking this screen's words.
  void flush() {
    if (widget.readOnly) return;
    _saving.flush();
    _watch();
  }

  /// After the next save has been answered: a save refused for good is said on the note.
  void _watch() {
    _checking?.cancel();
    _checking = Timer(widget.debounce + const Duration(milliseconds: 60), () {
      unawaited(_saving.settled().whenComplete(() {
        if (mounted && !_saving.writable && !_stopped) setState(() => _stopped = true);
      }));
    });
  }

  /// Every change to the words passes through here (`onChange`).
  void _onChange(String next) {
    if (widget.readOnly) return;
    _saving.onChange(next);
    // A notebook's or a canvas's view draws its own copy of the words and writes them back whole: a change that came
    // through the editor kept behind it (a header image written in, a team member's edit arriving, a plugin's) is
    // that copy's too, or the view's next write puts the old words back over it (Matt, 2026-10-27: a notebook's
    // header image "disappeared after generation").
    if (_isBook && !_source && next != _typedBody) _redraw(() => _typedBody = next);
    _watch();
    _versioning?.changed();
    final tag = geoTagOf(next) ?? _tags?.pendingTag(_id);
    final look = lookOf(next);
    final banner = bannerOf(next);
    final wasBlank = _wasBlank, wasUntouched = _untouched;
    _wasBlank = _saving.blank;
    var fresh = _fresh, untouched = _untouched;
    if (_fresh) {
      _records.keepFresh(_id, next);
      fresh = _records.isFresh(_id);
    }
    if (_drafted) {
      untouched = _records.isUntouched(_id, next);
      if (!untouched) {
        // Its first own words make it the person's there and then: the record goes on the keystroke.
        _records.forget(_id);
        _drafted = false;
      }
    }
    if (tag != _tag || look != _look || banner != _banner || fresh != _fresh || untouched != _untouched) {
      _redraw(() {
        _tag = tag;
        _look = look;
        _banner = banner;
        _fresh = fresh;
        _untouched = untouched;
      });
    }
    // A new note's first words, or an entry's first of its own: the tag waiting for them lands. After this change
    // has been taken, since landing it is a change of its own.
    if (_tags != null && !_saving.blank && !untouched && (wasBlank || wasUntouched)) scheduleMicrotask(_settleTag);
  }

  // ---- the note's place (core/location.ts, NoteScreen.tsx) ------------------------------------------------------------

  void _tagEvent(TagEvent event) {
    if (!mounted) return;
    switch (event) {
      case TagPlace(:final place, :final lat, :final lon):
        _namePlace(place, lat, lon);
      case TagHeld():
        _redraw(() => _hold = _tags?.heldFor(_id));
      case TagPending():
        _settleTag();
    }
  }

  /// A tag waiting for this note lands once it may (`settle`): the better words in, the note with words. Until
  /// then the card is drawn from it. A note that says where it was written already keeps what it says.
  void _settleTag() {
    final tags = _tags;
    if (tags == null || !mounted) return;
    final waiting = tags.pendingTag(_id);
    if (waiting == null) return;
    if (geoTagOf(_saving.body) != null) {
      tags.setPendingTag(_id, null);
      return;
    }
    if (tags.settleTag(_id, _saving.body, reviewing: _reviewing) != null && writeTag(waiting)) {
      // In the note now, so its name may be asked (this device made it; lib/core/place_tags.dart decides whether).
      tags.wantPlace(_id, waiting);
      return;
    }
    if (_tag != waiting) _redraw(() => _tag = waiting);
  }

  /// A name that came for the note's tag: written into the note, or onto the tag still waiting (`namePlace`).
  void _namePlace(String place, double lat, double lon) {
    final tags = _tags;
    if (tags == null) return;
    final inBody = geoTagOf(_saving.body);
    if (inBody != null && inBody.place == null && inBody.lat == lat && inBody.lon == lon) {
      writeTag(inBody.named(place));
      return;
    }
    final waiting = tags.pendingTag(_id);
    if (waiting != null && waiting.lat == lat && waiting.lon == lon) {
      final named = waiting.named(place);
      if (waiting.place != place) tags.setPendingTag(_id, named);
      if (_tag != named) _redraw(() => _tag = named);
    }
  }

  Timer? _slowFix;

  GlacierToastController? _toaster() {
    try {
      return GlacierToast.of(context);
    } catch (_) {
      // A picture of the screen alone has nowhere to say it.
      return null;
    }
  }

  /// Add my location, from the More sheet: the fix, the tag into the note (or waiting), and its name asked for
  /// (`addLocation`).
  void addLocation() {
    final tags = _tags;
    if (tags == null) return;
    flush();
    setState(() => _settingsOpen = false);
    final toasts = _toaster();
    final haptics = HapticsProvider.of(context);
    var said = false;
    // The card arriving is the feedback; a slow fix says so after a moment.
    _slowFix?.cancel();
    final slow = _slowFix = Timer(const Duration(milliseconds: 600), () {
      said = true;
      toasts?.toast(message: const Text('Finding where you are.'), duration: const Duration(days: 1));
    });
    tags.locations.locate().then<void>((fix) {
      slow.cancel();
      if (said) toasts?.dismiss();
      tags.forgetRefusal();
      final next = tagOfFix(fix);
      // Left while the fix was coming: the tag is kept for the note and written into it where it may land.
      if (!mounted) return tags.landTag(_id, next);
      tags.setPendingTag(_id, next);
      setState(() {
        _tag = next;
        _arriving = true;
        _leaving = null;
      });
      // Into the note now (and its name asked), or waiting for the better words with the card drawn from it.
      _settleTag();
    }, onError: (Object failure) {
      slow.cancel();
      if (said) toasts?.dismiss();
      if (!mounted) return;
      final why = whyLocateFailed(failure);
      // Refused here is refused: new notes are not asked for again until location is allowed.
      tags.rememberRefusal(why);
      haptics(HapticKind.warning);
      toasts?.toast(
        message: Text(noFix[why]!),
        action: why == LocateFailure.blocked && tags.locations.onPhone ? GlacierToastAction(label: 'Open settings', onPress: () => unawaited(tags.locations.openSettings())) : null,
      );
    });
  }

  /// Where the note was written, for the More sheet's row (`location`).
  NoteLocation? _location(Preferences prefs) {
    final tags = _tags;
    if (tags == null) return null;
    final tag = _tag;
    return NoteLocation(
      tag: tag,
      cannot: tags.locations.cannotLocate,
      asksName: prefs.placeNames && !prefs.localOnly,
      refused: tag != null ? null : tags.refusedFor(widget.note.createdAt),
      onPhone: tags.locations.onPhone,
      onAdd: addLocation,
      onRemove: removeLocation,
    );
  }

  /// Remove location: the card leaves on its beat, and both keys go as one undo step (`removeLocation`).
  void removeLocation() {
    flush();
    final was = _tag;
    setState(() {
      _settingsOpen = false;
      _arriving = false;
      _leaving = was;
    });
    writeTag(null);
    _tags?.setPendingTag(_id, null);
    if (_tag != null) setState(() => _tag = null);
  }

  void _back() {
    flush();
    widget.onBack();
  }

  /// Simple mode's Done (GHST-105): the keyboard put away and the editor's focus given up, what is typed saved
  /// first; the note stays open. The same as the iPhone keyboard bar's Done does, on every platform.
  void _done() {
    flush();
    IPhoneKeyboardBar.lowerKeyboard();
    if (_focused) setState(() => _focused = false);
  }

  /// The phone's way back from the note, for whoever holds the back gesture: what is typed is saved first.
  void leave() => _back();

  // ---- the transcript taking the page -------------------------------------------------------------------------------

  @override
  void didUpdateWidget(NoteScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    final was = oldWidget.seams.transcript != null;
    if (was != _listening) _listeningChanged();
  }

  /// The tape began to play, or stopped. `useNotePlace(note.id, page, view, shown === 'raw' && !at)`: where the
  /// note was left is written as the words go behind the transcript, from the last scroll of the person's own, and
  /// is gone back to as they return. The page under the transcript holds still at its top, and the editor, hidden,
  /// has neither the focus nor the keyboard.
  void _listeningChanged() {
    final view = _view;
    if (_listening) {
      _keeper?.dispose();
      _keeper = null;
      // Not `jumpTo`: this is the build, and the page is laid out again for its new slivers anyway.
      if (_scroll.hasClients) _scroll.position.correctPixels(0);
      if (view != null && view.hasFocus) FocusManager.instance.primaryFocus?.unfocus();
      return;
    }
    // After the frame: a page that may scroll again is given a new position by its scroll view, and the place is
    // kept on that one.
    SchedulerBinding.instance.addPostFrameCallback((_) {
      final view = _view, at = widget.at;
      if (!mounted || _listening || _keeper != null || view == null || !_scroll.hasClients || (at != null && at.isNotEmpty)) return;
      _keeper = NotePlaceKeeper(noteId: _id, view: view, page: _scroll.position, places: NotePlaces(widget.device), writtenBookmark: widget.seams.writtenBookmark, lifecycle: widget.lifecycle);
    });
  }

  // ---- the editor arriving ------------------------------------------------------------------------------------------

  void _onView(EditorView view) {
    if (!mounted) return;
    final first = _view == null;
    setState(() {
      _view = view;
      _focused = view.hasFocus;
    });
    // Words the store had newer than the copy this screen was opened with can be taken before the editor is here
    // to be handed them (the page's store answers later than its editor mounts): they are put in now.
    if (first && !(_typed && _source) && view.state.doc.toString() != _saving.body) _external(_saving.body);
    // On opening, once the editor is here: a tag waiting lands if it may, and a name that came while the note was
    // closed is written. After the frame, since the editor is told of its view while it builds.
    final tags = _tags;
    if (first && tags != null) {
      SchedulerBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        _settleTag();
        final now = geoTagOf(_saving.body);
        final known = now == null || now.place != null ? null : tags.placeFor(now);
        if (now != null && known != null) _namePlace(known, now.lat, now.lon);
      });
    }
    if (!_scroll.hasClients) return;
    final page = _scroll.position;
    final opened = widget.seams.links?.opened;
    if (opened != null) {
      _linksGone?.call();
      _linksGone = opened(view, page);
    }
    _keeper?.dispose();
    _keeper = null;
    _landing?.dispose();
    _landing = null;
    final at = widget.at;
    if (atItsTape(at)) {
      // Opened at its tape: the top of the page, where the tape is, rather than where it was left last time.
      if (page.hasPixels && page.pixels != 0) page.jumpTo(0);
    } else if (at != null && at.isNotEmpty) {
      // Opened at an item, the note goes to that line rather than back to where it was left last time.
      _landing = LandAt(at: at, view: view, page: page, headerBottom: _headerBottom);
    } else {
      _keeper = NotePlaceKeeper(noteId: _id, view: view, page: page, places: NotePlaces(widget.device), writtenBookmark: widget.seams.writtenBookmark, lifecycle: widget.lifecycle);
    }
    // A note just made, to be written in: the caret where it was asked for, once the editor is here, and the focus.
    if (first && !_caretPlaced) {
      _caretPlaced = true;
      final length = view.state.doc.length;
      final asked = widget.caret?.offset;
      view.dispatch(TransactionSpec(selection: EditorSelection.single(asked == null ? length : asked.clamp(0, length)), scrollIntoView: true));
      view.focus();
    }
  }

  /// A tap on the paper under a short note: the caret at the end of its words, as a tap under the last line of a
  /// page puts it, and the keyboard. A note that cannot be written only takes the focus.
  void _tapUnder() {
    final editor = _view;
    if (editor == null) return;
    if (!widget.readOnly) editor.dispatch(TransactionSpec(selection: EditorSelection.single(editor.state.doc.length), scrollIntoView: true, userEvent: 'select.pointer'));
    editor.focus();
  }

  double _headerBottom() {
    final box = context.findRenderObject();
    final top = box is RenderBox && box.hasSize ? box.localToGlobal(Offset.zero).dy : 0.0;
    return top + _headerHeight(context.tokens, TopBarTools.maybeOf(context) != null);
  }

  // ---- what the screen writes through the editor --------------------------------------------------------------------

  /// A change to the front matter alone, as one undo step, the caret kept with the words: a caret in the block, or
  /// at its end, goes to the start of the words; one in the words moves by what the block grew.
  bool _writeFrontMatter(String Function(String doc) change, String userEvent, {bool scroll = false}) {
    final editor = _view;
    if (editor == null || !mounted || !_words) return false;
    final doc = editor.state.doc.toString();
    final after = change(doc);
    if (after == doc) return false;
    final was = frontMatterOffset(doc), now = frontMatterOffset(after);
    int place(int pos) => pos <= was ? now : pos + now - was;
    final selection = EditorSelection.create([for (final range in editor.state.selection.ranges) EditorSelection.range(place(range.anchor), place(range.head))], editor.state.selection.mainIndex);
    editor.dispatch(TransactionSpec(changes: ChangeSpec(from: 0, to: was, insert: after.substring(0, now)), selection: selection, scrollIntoView: scroll, userEvent: userEvent));
    return true;
  }

  /// The More sheet's Look: the key written into the front matter through the editor, as one undo step; Plain takes
  /// it off. The person's own doing, so a note given its words by the app is theirs from here (`chooseLook`).
  void chooseLook(Look? next) {
    if (!_writeFrontMatter((doc) => withLook(doc, next), 'input.look')) return;
    _records.forget(_id);
    _records.spoilFresh(_id);
    _drafted = false;
    setState(() {
      _untouched = false;
      _fresh = false;
    });
    HapticsProvider.of(context)(HapticKind.selection);
  }

  /// The tag written into the note, or taken out, as one undo step; where the editor is hidden behind a canvas or a
  /// book's index, through the words as a rename is (`writeTag`).
  bool writeTag(GeoTag? next) {
    if (_typed && !_source) {
      final after = withGeoTag(_saving.body, next);
      if (after != _saving.body) {
        _onChange(after);
        _typedBody = after;
      }
    } else if (!_writeFrontMatter((doc) => withGeoTag(doc, next), 'input.location', scroll: true)) {
      if (geoTagOf(_saving.body) == next) return true;
      return false;
    }
    setState(() => _tag = next);
    _tags?.setPendingTag(_id, null);
    return true;
  }

  /// A notebook's own keys written from the More sheet (its ticket key; kept as a journal, its template and its
  /// place switch): as the notebook's own changes are, and into the editor where its Markdown is the view, so the
  /// next keystroke there does not write the old keys back (`writeNotebook`).
  void _writeKeys(String Function(String was) change) {
    final next = change(_saving.body);
    if (next == _saving.body) return;
    final editor = _view;
    if (_source && editor != null) {
      _external(change(editor.state.doc.toString()));
    } else {
      _onChange(next);
    }
    setState(() => _typedBody = next);
    // Kept as a journal while it is open: the app is handed the way to write its index, as a journal opened is.
    if (_isJournal && !_toldJournal) _tellJournal();
  }

  /// The notebook's rows of the More sheet are a notebook's alone, and never the Guide's: a manual is not a diary,
  /// and has no tickets (`journalRows`).
  bool get _notebookRows => _isBook && !widget.readOnly && !isGuideBook(widget.note.copyWith(body: _typedBody));

  /// The name typed in the More sheet, into the front matter; the index takes it too (`renameHere`).
  void renameHere(String next) {
    final named = withFrontMatterTitle(_saving.body, next);
    if (named == _saving.body) return;
    if (_source && _view != null) {
      _external(named);
    } else {
      _onChange(named);
    }
    setState(() => _typedBody = named);
  }

  /// A version put back: the words as they are now kept as a version first, then the version's words put in
  /// through the editor as one change, and kept as a version of their own, named for where they came from. So the
  /// history only grows, as `git revert` does (`restoreVersion`).
  void restoreVersion(String text, Version version) {
    final editor = _view;
    final versions = widget.versions;
    if (editor == null || versions == null) return;
    final now = editor.state.doc.toString();
    if (now == text) return;
    unawaited(versions.keepVersion(_id, now).then<void>((_) {}, onError: (Object _) {}));
    editor.dispatch(TransactionSpec(changes: ChangeSpec(from: 0, to: now.length, insert: text), userEvent: 'input.restore', scrollIntoView: true));
    unawaited(versions.keepVersion(_id, text, label: 'Back to version ${version.n}').then<void>((_) {}, onError: (Object _) {}));
    widget.say?.call('Back to version ${version.n}.');
    HapticsProvider.of(context)(HapticKind.success);
  }

  /// The note's list laid out as a board: one change, so one Undo puts the note back as it was (`makeBoard`).
  void makeBoard() {
    final editor = _view;
    if (editor == null) return;
    final made = boardFrom(editor.state.doc.toString());
    setState(() => _settingsOpen = false);
    if (made == null) return;
    editor.dispatch(TransactionSpec(changes: ChangeSpec(from: 0, to: editor.state.doc.length, insert: made.doc), userEvent: 'input.board'));
    HapticsProvider.of(context)(HapticKind.success);
    widget.say?.call('${made.cards} ${made.cards == 1 ? 'item is' : 'items are'} now cards${made.done != 0 ? ', ${made.done} in Done' : ''}.');
  }

  /// A name tapped on the blank page: the note's heading, and the caret on the line under it. Its record first, so a
  /// note named and left without a word of the person's own is taken back. One change, so one undo takes it back to
  /// a blank page with the names on it (`nameIt`).
  void nameIt(String name) {
    final editor = _view;
    if (editor == null || !_records.isFresh(_id)) return;
    final words = '# $name\n\n';
    _records.remember(_id, UntouchedRecord(title: name, words: words, at: DateTime.now().millisecondsSinceEpoch));
    _drafted = true;
    setState(() => _untouched = true);
    final from = frontMatterOffset(editor.state.doc.toString());
    editor.dispatch(TransactionSpec(changes: ChangeSpec(from: from, to: editor.state.doc.length, insert: words), selection: EditorSelection.single(from + words.length), userEvent: 'input.name'));
    _backToTop(editor);
    // Kept now, not on typing's beat: a note named and left at once is looked at by its take-back from the store.
    flush();
    editor.focus();
    HapticsProvider.of(context)(HapticKind.selection);
  }

  // ---- the tools ----------------------------------------------------------------------------------------------------

  void _chooseView(NoteView value) {
    if (_prefs.value.noteView == value.name) return;
    _prefs.update((now) => now.copyWith(noteView: value.name));
    HapticsProvider.of(context)(HapticKind.selection);
  }

  /// A canvas's or a book's own switch, between its page and its source (`showSource`).
  void _showSource(bool next) {
    if (next == _source) return;
    setState(() {
      if (!next) _typedBody = _saving.body;
      _source = next;
    });
    HapticsProvider.of(context)(HapticKind.selection);
  }

  void _switchView() => _typed ? _showSource(_onPage) : _chooseView(_onPage ? NoteView.mixed : NoteView.formatted);

  void _openMore() => _openSettings();

  /// The More sheet at its Links page, asked for from outside the screen.
  void _linksAsked() {
    if (mounted && !_typed) _openSettings(null, 'links');
  }

  void _openSettings([NoteSettingsPage? at, String? item]) => setState(() {
        _settingsAt = at;
        _settingsItem = item;
        _settingsOpen = true;
      });

  /// Pin or unpin, from the bar or from More (`togglePin`).
  void togglePin() {
    flush();
    widget.onPin(_noteNow(starred: _pinned));
    setState(() {
      _pinned = !_pinned;
      _settingsOpen = false;
    });
    HapticsProvider.of(context)(HapticKind.selection);
  }

  void _archive() {
    flush();
    setState(() => _settingsOpen = false);
    widget.onArchive(_noteNow(starred: _pinned));
  }

  void _remove() {
    // No confirmation: it goes to the trash, with an Undo, and is only deleted for good from there.
    setState(() => _settingsOpen = false);
    HapticsProvider.of(context)(HapticKind.warning);
    flush();
    widget.onDelete(_id);
  }

  Note _noteNow({required bool starred}) {
    final note = widget.note;
    return Note(
      id: note.id,
      body: _saving.body,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      source: note.source,
      sourceName: note.sourceName,
      starred: starred,
      archivedAt: note.archivedAt,
      recordingMs: note.recordingMs,
      segments: note.segments,
      formatted: note.formatted,
      formattedFor: note.formattedFor,
      formattedModel: note.formattedModel,
      path: note.path,
      revision: note.revision,
    );
  }

  ({bool marked, VoidCallback onPress})? _bookmark() {
    final view = _view;
    final ask = widget.seams.bookmark;
    return view == null || ask == null || !_scroll.hasClients ? null : ask(view, _scroll.position);
  }

  void _speak() {
    widget.seams.beforeSpeak?.call();
    flush();
    widget.onSpeak?.call(_id);
  }

  /// `tape.length > 0 || !speakHere ? null : …`: a note with a tape has its Add there, and no mic of its own.
  String? get _speakWords => widget.onSpeak == null || (widget.seams.hasTape?.call() ?? false) ? null : (_isJournal ? 'Speak an entry' : 'Talk into this note');

  /// What comes out of More into the bar while there is room, in this order: Share, History, Comment, Bookmark,
  /// Pin/Unpin, Archive, Speak (`actions`). Each is there only where More would have it, and stays in More too.
  List<ToolAction> _actions() {
    final seams = widget.seams;
    final view = _view;
    final mark = _bookmark();
    final history = widget.versions != null && !_isCanvas && !widget.readOnly;
    final speak = _speakWords;
    // Simple mode (GHST-103, GHST-105): nothing comes out of More. Pin and Archive are the sheet's rows, the mic is
    // the Format bar's tail, and sharing, versions, links, comments and the bookmark are behind the sheet's More
    // with the rest of the "fancy features" (Matt: "pin/archive/view switch move into ⋯").
    final simple = _simple;
    if (simple) return const [];
    return [
      if (seams.onShare != null && !simple) ToolAction(id: 'share', label: 'Share', icon: Lucide.share2, onPress: seams.onShare!),
      if (history && _raw && !simple) ToolAction(id: 'history', label: 'Version history', icon: Lucide.history, onPress: () => widget.onHistory != null ? widget.onHistory!() : _openSettings(NoteSettingsPage.history)),
      // The notes that link here, their count on the ring (lib/links/note_links.dart).
      if (seams.links case final links? when !_typed && _raw && !simple)
        ToolAction(
          id: 'links',
          label: switch (links.count.value) { 0 => 'Links', 1 => 'Linked from 1 note', final n => 'Linked from $n notes' },
          icon: Lucide.link2,
          count: links.count.value,
          onPress: () => _openSettings(null, 'links'),
        ),
      if (seams.onComment != null && !_typed && view != null && _raw && !simple) ToolAction(id: 'comment', label: 'Comment', icon: Lucide.messageSquarePlus, onPress: () => seams.onComment!(view)),
      if (mark != null && _raw && !simple) ToolAction(id: 'bookmark', label: mark.marked ? 'Move or remove the bookmark' : 'Bookmark this line', icon: mark.marked ? Lucide.bookmarkCheck : Lucide.bookmark, onPress: mark.onPress, on: mark.marked),
      if (!widget.readOnly) ...[
        ToolAction(id: 'pin', label: _pinned ? 'Unpin' : 'Pin to the top', icon: _pinned ? Lucide.pinOff : Lucide.pin, onPress: togglePin, on: _pinned),
        ToolAction(id: 'archive', label: 'Archive', icon: Lucide.archive, onPress: _archive),
      ],
      if (speak != null && !widget.readOnly) ToolAction(id: 'speak', label: speak, icon: Lucide.mic, onPress: _speak),
    ];
  }

  NoteToolsModel _model({bool more = true}) => NoteToolsModel(kind: _kind, page: _onPage, switchable: _raw, onSwitch: _switchView, onMore: _openMore, more: more, actions: _actions());

  /// The tools follow the screen: handed a new model after the frame, when what they draw has changed.
  void _syncTools({required bool more}) {
    final model = _model(more: more);
    final key = '${model.kind.name}|${model.page}|${model.more}|${model.switchable}|${[for (final action in model.actions) '${action.id}:${action.label}:${action.on}'].join(',')}';
    if (key == _toolsKey) return;
    _toolsKey = key;
    SchedulerBinding.instance.addPostFrameCallback((_) {
      if (mounted) _toolsModel.value = model;
    });
  }

  // ---- two fingers --------------------------------------------------------------------------------------------------

  void _pointerDown(PointerDownEvent event) {
    // The person's own touch ends a restore of where the note was left.
    _keeper?.touched();
    // A press that starts while the cards are shown, and not on them, may be the tap that puts them away.
    _armed = cardsShown && !_onOffers(event.position) ? (pointer: event.pointer, at: event.position) : null;
    if (event.kind != PointerDeviceKind.touch) return;
    _pinch.put(event.pointer, event.position);
    final view = _view;
    final mid = _pinch.middle;
    if (!_pinch.pinching || mid == null || view == null || !_words || !_raw) return;
    final pos = view.posAtCoords(mid, precise: false);
    final at = pos == null ? null : view.coordsAtPos(pos);
    _pinching = (distance: _pinch.apart, zoom: _zoom.value, pos: at == null ? null : pos, y: at?.top ?? mid.dy);
    // Two fingers are a pinch, not a scroll: the page is held where it is, and the drag the first finger began is over.
    if (_scroll.hasClients) _held = _scroll.position.hold(() => _held = null);
  }

  void _pointerMove(PointerMoveEvent event) {
    if (event.kind != PointerDeviceKind.touch) return;
    _pinch.put(event.pointer, event.position);
    final start = _pinching;
    if (start == null || !_pinch.pinching) return;
    final wanted = pinched(start.zoom, start.distance, _pinch.apart);
    if (wanted == _zoom.value) return;
    _zoom.value = wanted;
    // The words that were under the fingers go back under them as the lines reflow.
    SchedulerBinding.instance.addPostFrameCallback((_) => _holdUnderFingers(start));
  }

  void _holdUnderFingers(({double distance, double zoom, int? pos, double y}) start) {
    final view = _view;
    final pos = start.pos;
    if (!mounted || view == null || pos == null || !_scroll.hasClients) return;
    final at = view.coordsAtPos(pos);
    if (at == null) return;
    final page = _scroll.position;
    final to = (page.pixels + at.top - start.y).clamp(page.minScrollExtent, page.maxScrollExtent < page.minScrollExtent ? page.minScrollExtent : page.maxScrollExtent);
    if ((to - page.pixels).abs() > 0.01) page.jumpTo(to);
  }

  /// Whether a point on the screen is on the blank page's names or cards.
  bool _onOffers(Offset at) {
    final box = _offers.currentContext?.findRenderObject();
    return box is RenderBox && box.attached && box.hasSize && (box.localToGlobal(Offset.zero) & box.size).contains(at);
  }

  void _pointerUp(PointerEvent event) {
    if (event is PointerUpEvent) {
      final armed = _armed;
      final tapped = armed != null && armed.pointer == event.pointer && (event.position - armed.at).distance <= kTouchSlop;
      // A tap elsewhere on the page says the page is to be written on as it is: the cards go. And any press of the
      // person's own that ends on the page makes it ready for words.
      if ((tapped && !_cardsGone) || !_ready) {
        setState(() {
          if (tapped) _cardsGone = true;
          _ready = true;
        });
      }
    }
    _armed = null;
    if (event.kind != PointerDeviceKind.touch) return;
    _pinch.lift(event.pointer);
    final start = _pinching;
    if (start == null || _pinch.fingers >= 2) return;
    _holdUnderFingers(start);
    _zoom.keep();
    _pinching = null;
    _held?.cancel();
    _held = null;
    _view?.requestMeasure<void>();
  }

  // ---- drawing ------------------------------------------------------------------------------------------------------

  /// How tall the header's glass is: with the tools in the app's bar it holds nothing and is exactly the bar
  /// (`.header:empty`); with its own row, the row and its padding.
  static double _headerHeight(Tokens t, bool inBar) => inBar ? t.len('app-safe-top') : t.len('app-safe-top') + t.space(1) + t.len('app-bar-ring') + t.space(2);

  /// What the note is drawn as in place of its words: its canvas, its journal's months or its notebook's index, as
  /// the desk's seams draw them. The widget is kept while it is for the same seams and the same words: the screen
  /// builds itself again for reasons of its own that change nothing here (the editor's view arriving a frame after
  /// the note opens, each save landing, the keyboard), and handed the widget it already has, the framework leaves
  /// the view as it is, where a new one each time built the canvas and every card of it again. Other seams (the
  /// desk built again: another note changed, a team joined, a spot to go to) or other words make another.
  Widget _view0(BuildContext context) {
    final kind = _drawing ? _OtherKind.canvas : (_isJournal ? _OtherKind.journal : _OtherKind.book);
    final kept = _other;
    if (kept != null && identical(kept.seams, widget.seams) && kept.kind == kind && kept.body == _typedBody) return kept;
    return _other = _OtherView(seams: widget.seams, body: _typedBody, kind: kind, write: _writeTyped);
  }

  _OtherView? _other;

  /// What the view wrote: the note's words from here, saved as typing is.
  void _writeTyped(String next) {
    // A notebook's own write goes through the editor kept behind it, as [writeNotebook]'s does; a canvas's as before.
    if (_isBook && _view != null) {
      _external(next);
      if (_saving.body != next) _onChange(next);
    } else {
      _onChange(next);
    }
    setState(() => _typedBody = next);
  }

  /// The Format bar for [look], with its tail (GHST-105): the band's Add image, the +'s list for the caret's line,
  /// and the note's mic, or Claude's Talk in the mic's place where the dock has it (one microphone, GHST-104).
  FormatBar _formatBar(EditorView view, FormatBarLook look) {
    final seams = widget.seams;
    final speak = _speakWords;
    final talk = widget.dock?.talk;
    return FormatBar(
      view: view,
      look: look,
      onPicture: seams.onAddImage == null ? null : () => unawaited(Future<void>.sync(() => seams.onAddImage!())),
      onAdd: seams.onAdd == null || !plusAllowed ? null : () => seams.onAdd!(view),
      onSpeak: speak == null || widget.readOnly || talk != null ? null : _speak,
      speakLabel: speak ?? 'Talk into this note',
      talk: talk == null || widget.readOnly ? null : talk(() => _saving.title),
    );
  }

  /// What the tail is made of, for the row to be made again only when that changes.
  String get _formatTailKey => '${widget.seams.onAddImage != null}|${widget.seams.onAdd != null && plusAllowed}|${_speakWords ?? ''}|${widget.dock?.talk != null}|${widget.readOnly}';

  /// The Format bar's row for the iPhone's keyboard bar, the same widget for as long as the view and its tail are.
  Widget _formatTools(EditorView view) {
    final tail = _formatTailKey;
    if (!identical(_formatRowFor, view) || _formatRow == null || _formatRowTail != tail) {
      _formatRowFor = view;
      _formatRowTail = tail;
      _formatRow = _formatBar(view, FormatBarLook.row);
    }
    return _formatRow!;
  }

  /// What the note is, in the dock's words for its ⋯.
  String get _dockKind => _isCanvas ? 'Canvas' : (_isJournal ? 'Journal' : (_isBook ? 'Notebook' : 'Note'));

  /// The dock's rings for what is up (docs/DOCK.md), each one the screen already has: for a note's words, Find in
  /// note, Speak into it and the +'s list; for a canvas, a notebook's index or a journal, what its view offers; and
  /// the ⋯, the More sheet, at the foot.
  List<DockAction> _dockRings() {
    final seams = widget.seams;
    final view = _view;
    // Simple mode (GHST-105) hands the dock nothing of the note's: Find is the sheet's row, the + and the mic are
    // the Format bar's, and ⋯ is the header's.
    if (_simple) return const [];
    if (!_words) return _dockOffers.actions;
    final speak = _speakWords;
    return [
      if (seams.onFind != null && view != null && _raw) DockAction(id: 'note-find', label: 'Find in note', icon: Lucide.search, motion: DockMotion.lean, onPressed: () => seams.onFind!(view, '')),
      // One microphone only (GHST-104): where Talk to Claude is on this dock, the note's own mic is not, and what is
      // said about the note goes to Claude (Matt, 2026-10-18: "there should only be one microphone icon").
      if (speak != null && !widget.readOnly && widget.dock?.talk == null) DockAction(id: 'note-speak', label: speak, glyph: HomeGlyph.mic, ink: true, onPressed: _speak),
      if (seams.onAdd != null && view != null && plusAllowed) DockAction(id: 'note-add', label: 'Add to this line', tip: 'Add', glyph: HomeGlyph.plus, motion: DockMotion.turn, onPressed: () => seams.onAdd!(view)),
    ];
  }

  DockAction get _dockFoot => DockAction(id: 'note-options', label: '$_dockKind options', icon: Lucide.ellipsis, onPressed: _openMore);

  /// The dock's seam as this note takes it: in simple mode a seam with nothing of its own to draw (the root's
  /// halo-only seam) is no dock at all, since the note adds no rings to it; an empty pill is not drawn.
  PageDockSeam? get _dock {
    final dock = widget.dock;
    return dock == null || (_simple && dock.claude == null && dock.talk == null) ? null : dock;
  }

  /// How many rings the dock has now, for the room the page keeps at its foot.
  int get _dockCount {
    final dock = _dock;
    if (dock == null) return 0;
    if (_simple) return (dock.claude != null ? 1 : 0) + (dock.talk != null ? 1 : 0);
    return (dock.claude != null ? 1 : 0) + _dockRings().length + 1;
  }

  /// The page under its dock, stepping aside while the keyboard is up.
  Widget _docked(PageDockSeam dock, Widget page) => PageDockFrame(
        seam: dock,
        subject: () => _saving.title,
        actions: _dockRings(),
        foot: _simple ? null : _dockFoot,
        stepAside: true,
        label: '$_dockKind actions',
        child: page,
      );

  @override
  Widget build(BuildContext context) => _KeyboardWatch(child: LayoutBuilder(builder: (context, box) => _build(context, box.maxWidth)));

  Widget _build(BuildContext context, double pageWidth) {
    final t = context.tokens;
    final prefs = _prefs.value;
    final seams = widget.seams;
    final bar = TopBarTools.maybeOf(context);
    final inBar = bar != null;
    _syncTools(more: !inBar);

    final headerHeight = _headerHeight(t, inBar);
    // `--wisp-under`: the header's height as the page reads it, a whole pixel (`offsetHeight`).
    final under = headerHeight.roundToDouble();
    // `.header:empty ~ .page`: the room the header's padding used to be, kept by the page.
    final padTop = inBar ? under + t.space(1) + t.space(2) : under;
    final gutter = t.len('app-gutter');
    final look = _typed ? null : _look;
    // `.page[data-look='reading'] > .byline`: the column's own left edge, from 600px: half of what the page has past
    // 36rem, or the gutter where it has less.
    final past = (pageWidth - t.lenOf('36rem')) / 2;
    final columnStart = look == Look.reading && MediaQuery.sizeOf(context).width >= 600 ? (gutter > past ? gutter : past) : null;
    final blurs = footBlurs(prefs.wispEdge);
    final authors = authorsOf(widget.note.body);
    final view = _view;
    final tag = _tag;
    final book = widget.book;

    // The keyboard up is the page ready for words, and once ready it stays ready.
    final keyboardUp = _KeyboardUp.of(context);
    if (!_ready && keyboardUp) _ready = true;
    final offered = offersShown ? names : null;
    // Simple mode's Format bar (format_bar.dart), on a note of words that can be written: above the soft keyboard
    // while it is up (the iPhone's own bar takes it, beside Done; elsewhere a strip the page ends above), and on a
    // wide window with the keyboard down a pill at the foot beside the dock. Advanced mode has none.
    final formatting = prefs.simple && view != null && _words && _raw && !widget.readOnly;
    final keyboardBar = KeyboardBarScope.maybeOf(context);
    // Wide is the page's own room, not the window's: beside simple mode's list column (GHST-105) a Fold opened out
    // leaves the note 404 wide, where the pill stood past the dock's room and over the edge.
    final wide = pageWidth >= 600;
    final Widget? formatStrip = formatting && keyboardUp && keyboardBar == null ? _formatBar(view, FormatBarLook.strip) : null;
    final formatPill = formatting && !keyboardUp && wide;
    _watchMinute(offering);

    final spec = NoteEditorSpec(
      // A canvas's JSON or a book's Markdown, once asked for, is what the view has written by now.
      value: _typed && _source ? _saving.body : widget.note.body,
      onChange: _onChange,
      onView: _onView,
      display: _typed ? NoteView.mixed : shownView(prefs.noteView, marksInMargin: prefs.marksInMargin),
      readOnly: widget.readOnly,
      look: look?.name,
      zoom: _zoom.value,
      pageWidth: pageWidth,
      headClear: headerHeight,
      pageHead: padTop + (seams.headRoom?.value ?? 0),
      // The line being typed stays above the page's foot blur, where there is a blur to keep clear of.
      footClear: !_isCanvas && blurs ? blurEdgeFootClear : 0,
      meHue: null,
      // Behind a canvas, a journal or an index the editor is kept and not drawn: its words are not read there.
      shown: _words,
      extensions: _ownExtensions,
    );
    _tellOffers(offered != null);

    final dockRings = _dockCount;
    final words = CustomScrollView(
      key: _page,
      controller: _scroll,
      // A canvas is not a column of words: it takes the whole page and moves under the fingers rather than scrolling.
      // Nor does the page move under the transcript, which scrolls inside itself under a tape that stays.
      physics: _drawing || _listening ? const NeverScrollableScrollPhysics() : _pagePhysics,
      slivers: [
        // `padding-block-start: calc(var(--wisp-under) + … + var(--ai-strip-room, 0px))`
        SliverToBoxAdapter(child: SizedBox(height: padTop + (seams.headRoom?.value ?? 0))),
        // A chapter's book, its place in it and the chapters either side (docs/BOOKS.md).
        if (book != null && seams.bookBar != null) SliverToBoxAdapter(child: seams.bookBar!(context, book)),
        // Its banner, across the top: a picture made for it, under the header's wisp.
        // A notebook's index has one too, over its chapters, as its cover; a canvas and a journal do not.
        if (seams.banner != null && (_words || (_isBook && !_isJournal && !_drawing))) SliverToBoxAdapter(child: seams.banner!(context, _id, _banner)),
        // Who wrote it, when it names anyone: a book says so for all its pages, in its index.
        if (!_paging && authors.isNotEmpty) SliverToBoxAdapter(child: NoteByline(authors: authors, start: columnStart)),
        // Where it was written: the map at the top of the note, where the page scrolls with the words.
        if (_words && seams.head != null)
          for (final row in seams.head!(context, _openSettings)) SliverToBoxAdapter(child: row),
        if ((tag ?? _leaving) != null && _words && _raw && seams.mapCard != null)
          SliverToBoxAdapter(
            child: _MapPlace(
              header: look == Look.map,
              columnStart: columnStart,
              child: seams.mapCard!(
                context,
                (tag ?? _leaving)!,
                header: look == Look.map,
                // A new note's tag still waiting for its first words is drawn quiet: a draft that may never be kept
                // fetches no tiles. So is an untouched entry's, which is taken back if it is left as it is.
                quiet: (_saving.blank || _untouched) && geoTagOf(_saving.body) == null,
                arrive: tag != null && _arriving,
                leave: tag == null,
                onLeft: () => setState(() => _leaving = null),
              ),
            ),
          )
        else if ((_hold != null || look == Look.map) && _words && _raw && seams.mapCard != null)
          // The box held for a new note's fix: the same box, empty, until the tag arrives in it or the note is left.
          // A map note's header is its shape, so it is drawn with no place too, saying why.
          SliverToBoxAdapter(
            child: _MapPlace(
              header: look == Look.map,
              columnStart: columnStart,
              child: MapPicture(size: look == Look.map ? MapSize.header : MapSize.card, why: _hold == Held.waiting ? null : (prefs.localOnly ? 'Local only is on.' : 'No place yet.')),
            ),
          ),
        // A canvas fills what is left of the page; a journal is one box of it; a notebook's view is slivers of its own
        // (lib/book/book_view.dart), so reading its pages straight through lays out what is near the window. The
        // notebook's is told the room the page keeps at its top: what sticks there (the way back and the rail of a
        // notebook read straight through) stops under the header.
        if (_drawing)
          SliverFillRemaining(hasScrollBody: true, child: _view0(context))
        else if (!_words)
          _isJournal ? SliverToBoxAdapter(child: _view0(context)) : PageHead(height: padTop + (seams.headRoom?.value ?? 0), child: _view0(context)),
        // The editor stays mounted behind a canvas or an index, hidden, so its caret keeps its place.
        // And behind the transcript while the tape plays (`hidden={shown !== 'raw' || drawing || paging}`).
        // Behind a canvas or an index it is made the frame after the note's screen is: nobody sees it, and the
        // frame a canvas or a notebook opens in made the canvas or the index and this editor too, its state and
        // every extension of the note's resolved (tool/perf.sh mac, canvas-open and notebook-open: 3 to 4 ms of the
        // opening frame's 12).
        _EditorBehind(hidden: !_words || _listening, later: !_words, builder: (context) => widget.editorBuilder(context, spec)),
        // A notebook's index and a journal end clear of the dock, as a note's words do.
        if (!_words && !_drawing && dockRings > 0) SliverToBoxAdapter(child: SizedBox(height: t.len('app-safe-bottom') + pageDockRoom(t, dockRings))),
        // `{shown === 'transcript' ? <div className={styles.body}><TranscriptWords tape={tape} /></div> : null}`:
        // the rest of the page, `.body { flex: 1; min-block-size: 0; padding-block-end: var(--app-safe-bottom) }`,
        // arriving as a body does (`noteRise`).
        if (_listening)
          SliverFillRemaining(
            hasScrollBody: true,
            child: Padding(
              padding: EdgeInsets.only(bottom: t.len('app-safe-bottom')),
              child: _BodyRise(child: seams.transcript!(context)),
            ),
          ),
        if (_words && _raw) ...[
          // A new note's blank page (the names under its first line, the template cards under them, and the ghost
          // under those) is a block inside the editor, after line 1 ([_offersBlock]).
          // `.body { padding-block-end: var(--app-safe-bottom) }`, and the room the dock stands in where it is.
          SliverToBoxAdapter(child: SizedBox(height: t.len('app-safe-bottom') + pageDockRoom(t, dockRings))),
          if (book != null && seams.bookFoot != null) SliverToBoxAdapter(child: seams.bookFoot!(context, book)),
          // `.page[data-scrolls] > .body { flex: 1 0 auto }`: the editor is the rest of the page, and a tap there is a tap in it.
          SliverFillRemaining(
            hasScrollBody: false,
            child: GestureDetector(behavior: HitTestBehavior.translucent, onTap: _tapUnder, child: const SizedBox.expand()),
          ),
        ],
      ],
    );

    final around = seams.around?.call(context, _words && _raw ? view : null, words) ?? words;
    // A pull down from the page's top refreshes the note; not a canvas, which moves under the fingers, and not
    // while its transcript has the page (`enabled={shown === 'raw' && !drawing}`). The page
    // itself is handed over as it is, so a pull draws the ring and moves the page and builds nothing of the note.
    final scroller = PullToRefresh(
      controller: _scroll,
      onRefresh: _pullNote,
      enabled: _raw && !_drawing,
      top: padTop + (seams.headRoom?.value ?? 0),
      builder: (context, pull) {
        _pulled = pull.physics is NeverScrollableScrollPhysics;
        return PullLowered(pull: pull, child: around);
      },
    );
    final unfold = _unfold ??= UnfoldDriver(vsync: this, still: t.reducedMotion, angles: widget.hinge);

    // `noteRise`: 320ms ease-out, rising 8px as it fades in.
    final curve = CurvedAnimation(parent: _rise, curve: Curves.easeOut);
    final page = t.reducedMotion
        ? scroller
        : AnimatedBuilder(
            animation: curve,
            builder: (context, child) => Opacity(opacity: curve.value, child: Transform.translate(offset: Offset(0, 8 * (1 - curve.value)), child: child)),
            child: scroller,
          );

    final dock = _dock;
    final layers = <Widget>[
      TopBarFill(
        tools: inBar ? _tools : null,
        tail: inBar ? _more : null,
        child: Listener(
          onPointerDown: _pointerDown,
          onPointerMove: _pointerMove,
          onPointerUp: _pointerUp,
          onPointerCancel: _pointerUp,
          onPointerSignal: (_) => _keeper?.touched(),
          // The note goes soft as it slips behind the header, and off the bottom where the dock is; not a canvas,
          // which is not a page that scrolls off its foot.
          // The page ends where the keyboard begins, as the web's does (its activity lays the page out above the
          // keyboard): the line being typed can always be scrolled clear of it, and the foot's blur rests on it.
          child: _AboveKeyboard(
            foot: formatStrip,
            child: BlurEdge(
              under: under,
              foot: !_isCanvas,
              // No scrollbar of a desktop's own on a note: the page's note has none (art/blur_edge.dart).
              scrollbar: false,
              // `.screen[data-unfolding] .body`: paper folded down its middle, foreshortened, flattening as the
              // hinge does. Only the note moves; the header and the app's own bar are the phone's.
              child: ValueListenableBuilder<double?>(
                valueListenable: unfold.progress,
                child: page,
                builder: (context, at, child) => at == null
                    ? KeyedSubtree(key: _unfolding, child: child!)
                    : Transform(
                        alignment: Alignment.center,
                        transform: Matrix4.diagonal3Values(0.72 + 0.28 * at, 0.965 + 0.035 * at, 1),
                        child: KeyedSubtree(key: _unfolding, child: child!),
                      ),
              ),
            ),
          ),
        ),
      ),
      // The crease's shadow while the note unfolds; nothing the rest of the time (`.crease`).
      ValueListenableBuilder<double?>(
        valueListenable: unfold.progress,
        builder: (context, at, _) => at == null ? const SizedBox.shrink() : IgnorePointer(child: UnfoldCrease(at: at, ink: t.color('app-ink'))),
      ),
      // A note with no words yet: the ghost with its pen, a little under the first line, gone at the first word.
      if (_saving.blank && !_typed && offered == null) _BlankGhost(scroll: _scroll, top: padTop + (authors.isEmpty ? 0 : t.space(2) + 1.5 * 0.85 * t.fontSize('sm')) + t.lenOf('9rem')),
      // The Format pill at the page's foot, to the dock's start where there is a dock, on the dock's own step up
      // from the bottom (docs/DOCK.md): read under the dock's frame, which says how far in the dock stands.
      if (formatPill)
        Builder(
          builder: (context) {
            final room = PageDockRoom.maybeOf(context);
            final end = room == null ? t.len('app-safe-right') + t.space(4) : room.end + t.space(2);
            return Padding(
              padding: EdgeInsetsDirectional.only(end: end, bottom: t.len('app-safe-bottom') + t.space(4)),
              child: Align(alignment: AlignmentDirectional.bottomEnd, child: _formatBar(view, FormatBarLook.pill)),
            );
          },
        ),
      // On an iPhone the keyboard's bar draws the six beside its Done, so nothing stands over the page for them.
      if (keyboardBar != null) Positioned(width: 0, height: 0, child: KeyboardBarOffer(tools: formatting ? _formatTools(view) : null)),
      // The header: glass over the page, holding the note's own controls where the app's bar is not there to. In
      // simple mode (GHST-105) those are the way back, ⋯ and Done, and no tool: the title is the page's own first
      // heading, as Matt asked ("‹ Notes, ⋯ and Done; the title in the page").
      HeaderPane(
        child: inBar
            ? null
            : Padding(
                // `.header { padding-inline: gutters; padding-block: safe-top + space-1, space-2 }`
                padding: EdgeInsets.fromLTRB(t.len('app-gutter-start'), t.space(1), t.len('app-gutter-end'), t.space(2)),
                child: prefs.simple
                    // Simple mode's own header (GHST-105): ‹ Notes, ⋯ and Done; the shell's plain path draws no bar.
                    // Back only where the shell asks for it (a phone, one window): beside the list there is none.
                    ? NoteSimpleHeader(backLabel: widget.back ? widget.backLabel : null, onBack: _back, onMore: _openMore, onDone: keyboardUp || _focused ? _done : null)
                    : LayoutBuilder(
                  builder: (context, box) => widget.back
                      // Simple mode's plain shell (GHST-105) has no bar and so no Home: the note's own Back at the
                      // row's start, and the tools in what room is left past it.
                      ? Row(
                          children: [
                            NoteToolButton(key: const ValueKey('note-back'), icon: Lucide.arrowLeft, label: 'Back to your notes', onPressed: _back, turns: false),
                            const Spacer(),
                            // The tools count what fits a frame after they are laid out: on the frame a window
                            // narrows (a phone folded shut) they are drawn for the room they had, scaled down to
                            // the room there is rather than past the edge.
                            Flexible(
                              child: FittedBox(
                                fit: BoxFit.scaleDown,
                                alignment: AlignmentDirectional.centerEnd,
                                child: NoteTools(model: _toolsModel, room: (box.maxWidth - t.len('app-bar-ring') - t.space(2)).clamp(0.0, double.infinity)),
                              ),
                            ),
                          ],
                        )
                      : Row(mainAxisAlignment: MainAxisAlignment.end, children: [NoteTools(model: _toolsModel, room: box.maxWidth)]),
                ),
              ),
      ),
      // The note's one line of problems: the sentence said of the note now (`pictures.problem`), and under it
      // in time a save refused for good.
      if (_stopped || seams.problem != null)
        Positioned(
          top: headerHeight,
          left: 0,
          right: 0,
          child: _ProblemLine(said: seams.problem, standing: _stopped ? saveStoppedWords : null, gutter: gutter),
        ),
    ];

    return DockOfferScope(
      offers: _dockOffers,
      child: ColoredBox(
        color: t.color('glacier-bg'),
        child: Stack(
          fit: StackFit.expand,
          children: [
            // The dock over the page, under what floats over the words and under the More sheet.
            if (dock == null) ...layers else Positioned.fill(child: _docked(dock, Stack(fit: StackFit.expand, children: layers))),
            if (view != null && _words && seams.over != null) ...seams.over!(context, view),
            if (_settingsOpen) _settings(context),
          ],
        ),
      ),
    );
  }

  Widget _settings(BuildContext context) {
    final seams = widget.seams;
    final view = _view;
    final versions = widget.versions;
    final mark = _bookmark();
    final speak = _speakWords;
    final words = !_typed || _source;
    void close() => setState(() => _settingsOpen = false);
    return NoteSettings(
      noteId: _id,
      title: _saving.title,
      pinned: _pinned,
      workspaces: widget.workspaces,
      onClose: close,
      onPin: togglePin,
      onArchive: _archive,
      onDelete: _remove,
      marked: mark?.marked ?? false,
      onBookmark: mark == null || !_raw
          ? null
          : () {
              close();
              mark.onPress();
            },
      onFind: seams.onFind == null || view == null || !_raw
          ? null
          : () {
              close();
              seams.onFind!(view, '');
            },
      onMakeBoard: !widget.readOnly && words && _raw && boardFrom(view?.state.doc.toString() ?? _saving.body) != null ? makeBoard : null,
      name: _typed && !widget.readOnly ? NoteName(value: _saving.title, onChange: renameHere, kind: _isCanvas ? 'canvas' : (_isJournal ? 'journal' : 'notebook')) : null,
      // A notebook kept as a journal, or a journal's template and place switch (docs/DESIGN.md §142).
      journal: _notebookRows
          ? NoteJournal(
              on: _isJournal,
              template: templateOf(_typedBody),
              place: entryPlaceOf(_typedBody),
              keep: (template, place) => _writeKeys((was) => withJournal(was, template, place)),
              setTemplate: (text) => _writeKeys((was) => withTemplate(was, text)),
              setPlace: (on) => _writeKeys((was) => withEntryPlace(was, on)),
              unkeep: () => _writeKeys(withoutJournal),
              placeDefault: _prefs.value.tagNewNotes,
              device: switch (_tags) {
                final tags? => EntryPlaceDevice(cannot: () => tags.locations.cannotLocate, refused: tags.autoTagRefusal, allowWhere: tags.allowLocationWhere(), ask: tags.askFromPress),
                _ => const EntryPlaceDevice(),
              },
            )
          : null,
      // A notebook's ticket key (docs/DESIGN.md §157), written as its other keys are. Not a journal's.
      ticketKey: _notebookRows && !_isJournal ? NoteTicketKey(value: frontMatterValue(_typedBody, 'key') ?? '', onChange: (typed) => _writeKeys((was) => withNotebookKey(was, typed))) : null,
      onSpeak: speak == null || widget.readOnly ? null : _speak,
      speakLabel: speak ?? 'Talk into this note',
      look: !_typed && !widget.readOnly && _raw ? NoteLook(value: _look, canMap: _tag != null || _look == Look.map, onChange: chooseLook) : null,
      onAi: seams.onAi == null || view == null ? null : (kind, [instruction]) => seams.onAi!(view, kind, instruction),
      running: seams.aiRunning?.call(),
      // What Fill the blanks would take, read while the sheet is up (`settingsOpen && view ? fillPlanOf(view.state)`).
      blanks: view == null ? (count: 0, online: const <String>[]) : fillPlanOf(view.state),
      onComment: seams.onComment == null || view == null || _typed || !_raw ? null : () => seams.onComment!(view),
      commentsSummary: _raw ? seams.commentsSummary?.call() : null,
      onCommentsList: _raw ? seams.onCommentsList : null,
      sharing: seams.sharing?.call(context),
      sharingSection: seams.sharingSection?.call(context),
      linked: seams.linked?.call(context),
      plugins: view == null || widget.readOnly ? null : seams.plugins?.call(view),
      location: seams.location?.call(_tag) ?? _location(_prefs.value),
      history: versions != null && !_isCanvas && !widget.readOnly && _raw
          ? NoteHistory(record: versions, keeps: _versioning?.keeps ?? versions.keepsVersions(_id), current: () => _view?.state.doc.toString() ?? _saving.body, onRestore: restoreVersion, onShareFile: seams.shareVersionsFile)
          : null,
      startAt: _settingsAt,
      // The sheet reads the mode from the store this screen reads, which is the app's own unless a test hands in
      // another: a sheet asking the app's store under a screen on a test's would be in the other mode.
      simple: _simple,
      // Simple mode's view switch, a row where advanced has the header's ring (GHST-105).
      viewSwitch: _raw ? NoteViewSwitch(kind: _kind, page: _onPage, onSwitch: _switchView) : null,
      cheatSheet: seams.cheatSheet,
      say: widget.say,
      around: _typed ? null : seams.links?.section(context, view, _scroll.hasClients ? _scroll.position : null),
      startAtItem: _settingsItem,
    );
  }
}

/// The page's own physics, with the page held still while a pull to refresh has it: the same physics object for the
/// life of the screen, which asks whether it is held as each drag arrives.
class _HeldUnderPull extends ScrollPhysics {
  const _HeldUnderPull(this.held, {super.parent});

  final bool Function() held;

  @override
  _HeldUnderPull applyTo(ScrollPhysics? ancestor) => _HeldUnderPull(held, parent: buildParent(ancestor));

  @override
  double applyPhysicsToUserOffset(ScrollMetrics position, double offset) => held() ? 0 : super.applyPhysicsToUserOffset(position, offset);
}

/// `.body { animation: noteRise 320ms var(--glacier-ease-out) both; animation-delay: 90ms }`: a body put on the
/// page rises 8px as it fades in, a beat after the tape. Still under reduced motion.
class _BodyRise extends StatefulWidget {
  const _BodyRise({required this.child});

  final Widget child;

  @override
  State<_BodyRise> createState() => _BodyRiseState();
}

class _BodyRiseState extends State<_BodyRise> with SingleTickerProviderStateMixin {
  // The delay and the rise as one run: 90 ms of nothing, then 320 ms.
  late final AnimationController _rise = AnimationController(vsync: this, duration: const Duration(milliseconds: 410));
  bool _begun = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_begun) return;
    _begun = true;
    if (context.tokens.reducedMotion) {
      _rise.value = 1;
    } else {
      _rise.forward();
    }
  }

  @override
  void dispose() {
    _rise.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ease = context.tokens.curve('glacier-ease-out');
    return AnimatedBuilder(
      animation: _rise,
      builder: (context, child) {
        final at = ease.transform(((_rise.value * 410 - 90) / 320).clamp(0.0, 1.0));
        return Opacity(opacity: at, child: Transform.translate(offset: Offset(0, 8 * (1 - at)), child: child));
      },
      child: widget.child,
    );
  }
}

/// What a failed fix says (`NO_FIX`).
const Map<LocateFailure, String> noFix = <LocateFailure, String>{
  LocateFailure.refused: 'Ghost.md wasn’t allowed to know where you are.',
  LocateFailure.blocked: 'Location is off for Ghost.md.',
  LocateFailure.unavailable: 'Couldn’t find where you are. Try again with location on, or outside.',
  LocateFailure.timeout: 'Couldn’t find where you are. Try again with location on, or outside.',
  LocateFailure.none: 'This browser can’t say where you are.',
  LocateFailure.mac: 'This Mac can’t say where it is yet.',
  LocateFailure.ios: 'Ghost.md can’t find where you are on this device yet.',
  LocateFailure.localOnly: 'Local only is on.',
};

/// `.mapCard`: the card's place on the page, a little under what is above it and in from the page's edges; a map
/// note's header is the page's whole width on a phone, and a reading page's card starts at its column.
class _MapPlace extends StatelessWidget {
  const _MapPlace({required this.header, required this.columnStart, required this.child});

  final bool header;
  final double? columnStart;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;
    final gutter = t.len('app-gutter');
    final wide = MediaQuery.sizeOf(context).width >= 600;
    final inset = header && !wide ? 0.0 : gutter;
    return Padding(
      padding: EdgeInsetsDirectional.only(top: t.space(2), start: columnStart ?? inset, end: inset),
      child: Align(alignment: AlignmentDirectional.centerStart, child: child),
    );
  }
}

/// `withFrontMatterTitle` (core/frontMatter.ts): the body named by a `title:` key, first in its front matter, or
/// with the key taken out where the name is empty, and a block that held nothing else with it.
String withFrontMatterTitle(String body, String title) {
  final clean = title.trim();
  final named = clean.isEmpty ? null : 'title: ${quotedTitle(clean, clean)}';
  final lines = body.split('\n');
  final end = frontMatterEnd(lines);
  if (end == 0) return named != null ? '---\n$named\n---\n$body' : body;
  final own = RegExp(r'^\s*title\s*:', caseSensitive: false);
  final keys = [
    ?named,
    for (final key in lines.sublist(1, end - 1))
      if (!own.hasMatch(key)) key,
  ];
  final rest = lines.sublist(end);
  if (keys.isEmpty) return rest.join('\n');
  return [lines[0], ...keys, lines[end - 1], ...rest].join('\n');
}

/// `.blankGhost`: the ghost on a note with no words, in the middle of the column, [top] down the page and going up
/// with it. Nothing to tap, so the editor under it still takes the finger.
class _BlankGhost extends StatelessWidget {
  const _BlankGhost({required this.scroll, required this.top});
  final ScrollController scroll;
  final double top;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: scroll,
      builder: (context, child) => Positioned(top: top - (scroll.hasClients && scroll.position.hasPixels ? scroll.position.pixels : 0), left: 0, right: 0, child: child!),
      child: const IgnorePointer(child: Ghost(scene: GhostScene.newNote, align: GhostAlign.center)),
    );
  }
}

/// `.problem`: the note's one line for a sentence about the note, `role="alert"`. [said] while there is one, else
/// what is [standing].
class _ProblemLine extends StatelessWidget {
  const _ProblemLine({required this.said, required this.standing, required this.gutter});

  final ValueListenable<String?>? said;
  final String? standing;
  final double gutter;

  Widget _line(BuildContext context, String? words) {
    if (words == null || words.isEmpty) return const SizedBox.shrink();
    final t = context.tokens;
    return Semantics(
      liveRegion: true,
      child: ColoredBox(
        color: t.color('glacier-bg'),
        child: Padding(
          // `.problem { padding: var(--glacier-space-1) var(--app-gutter) 0; font-size: sm; color: var(--app-ink-3) }`
          padding: EdgeInsets.fromLTRB(gutter, t.space(1), gutter, t.space(1)),
          child: Text(words, style: pageText(t, t.fontSize('sm'), color: t.color('app-ink-3'))),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final said = this.said;
    if (said == null) return _line(context, standing);
    return ValueListenableBuilder<String?>(valueListenable: said, builder: (context, now, _) => _line(context, now == null || now.isEmpty ? standing : now));
  }
}

/// A notifier the screen may tell from outside it.
class _Told extends ChangeNotifier {
  void tell() => notifyListeners();
}

/// `.cm-blankOffers`: what a new note's blank page offers under its first line. The names it can be given, a row of
/// quiet chips that wraps (`.cm-nameChips`, editor/nameChips.ts); under them the template cards, while they are
/// shown; and under those the ghost (`.offersGhost`).
class _BlankOffers extends StatelessWidget {
  const _BlankOffers({super.key, required this.names, required this.onName, this.cards});

  final List<NameOffer> names;
  final ValueChanged<String> onName;
  final Widget? cards;

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;
    final gutter = t.len('app-gutter');
    return Padding(
      // `padding-block-start: 0.75rem; padding-inline: var(--app-gutter)`: the gap under line 1 is padding, so a tap
      // aimed at the line lands on the line.
      padding: EdgeInsets.fromLTRB(gutter, t.lenOf('0.75rem'), gutter, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (names.isNotEmpty)
            Semantics(
              container: true,
              label: 'Names for this note',
              // `display: flex; flex-wrap: wrap; gap: var(--glacier-space-2)`
              child: Wrap(spacing: t.space(2), runSpacing: t.space(2), children: [for (final offer in names) _NameChip(offer: offer, onName: onName)]),
            ),
          ?cards,
          // `.offersGhost { padding-block: var(--glacier-space-8) var(--glacier-space-4); pointer-events: none }`
          IgnorePointer(
            child: Padding(
              padding: EdgeInsets.only(top: t.space(8), bottom: t.space(4)),
              child: const Ghost(scene: GhostScene.newNote, align: GhostAlign.center),
            ),
          ),
        ],
      ),
    );
  }
}

/// `.cm-nameChip`: one name. Quiet: the interface's face, the third ink and a hairline, a size under the words. Its
/// press takes no focus, so the caret stays where it is and the keyboard stays up.
class _NameChip extends StatelessWidget {
  const _NameChip({required this.offer, required this.onName});

  final NameOffer offer;
  final ValueChanged<String> onName;

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;
    final sm = t.fontSize('sm');
    return GlacierPressable(
      key: ValueKey('name-${offer.kind.name}'),
      semanticLabel: offer.label,
      excludeSemantics: true,
      canRequestFocus: false,
      onPressed: () => onName(offer.name),
      builder: (context, state) {
        final lit = state.hovered || state.focused;
        return GlacierFocusRing(
          visible: state.focused,
          radius: t.radius('full'),
          child: Container(
            // `padding: var(--glacier-space-1) var(--glacier-space-3); border: hairline solid var(--app-rule);
            // border-radius: full; line-height: 1.5; white-space: nowrap`
            padding: EdgeInsets.symmetric(vertical: t.space(1), horizontal: t.space(3)),
            decoration: BoxDecoration(
              border: Border.all(color: lit ? t.color('app-ink-3') : t.color('app-rule'), width: t.len('glacier-hairline')),
              borderRadius: BorderRadius.circular(t.radius('full')),
            ),
            child: Text(offer.name, maxLines: 1, softWrap: false, style: pageText(t, sm, height: 1.5, color: lit ? t.color('app-ink-2') : t.color('app-ink-3'))),
          ),
        );
      },
    );
  }
}

enum _OtherKind { canvas, journal, book }

/// A note's view in place of its words ([NoteScreenState._view0]), asked of the seam with this widget's own place
/// in the tree: what the view reads of the page around it (the sizes, whether the keyboard is up) builds this
/// again and not the note's whole screen.
class _OtherView extends StatelessWidget {
  const _OtherView({required this.seams, required this.body, required this.kind, required this.write});

  final NoteSeams seams;
  final String body;
  final _OtherKind kind;
  final ValueChanged<String> write;

  @override
  Widget build(BuildContext context) {
    switch (kind) {
      case _OtherKind.canvas:
        // `<div class="body canvasBody">`: the canvas is in a body too, and `.body { padding-block-end:
        // var(--app-safe-bottom) }` ends it above the phone's own bar, so its tools and its map stand clear of it as
        // the dock does. Without it the tool pill sat 84px lower than the dock's lift on a phone with a bar.
        // With the keyboard up there is no bar under the page to keep clear of (the keys are over it), as home has it:
        // kept, the card being written stood 84px too high and its bar went under the card, over the tools.
        return Padding(
          padding: EdgeInsets.only(bottom: _KeyboardUp.of(context) ? 0 : context.tokens.len('app-safe-bottom')),
          child: seams.canvas?.call(context, body, write) ?? const SizedBox.shrink(),
        );
      case _OtherKind.journal:
        return seams.journal?.call(context, body, write) ?? const SizedBox.shrink();
      case _OtherKind.book:
        return seams.book?.call(context, body, write) ?? const SliverToBoxAdapter(child: SizedBox.shrink());
    }
  }
}

/// The note's editor in the page: as itself where the words are shown, and kept out of sight behind a canvas, an
/// index or a transcript ([hidden]). [later], it is made a frame after this is, and from then on is there: what a
/// note opens to is drawn first, and the editor nobody sees is made while that is looked at. Shown, it is made at
/// once.
class _EditorBehind extends StatefulWidget {
  const _EditorBehind({required this.hidden, required this.later, required this.builder});

  final bool hidden;
  final bool later;
  final WidgetBuilder builder;

  @override
  State<_EditorBehind> createState() => _EditorBehindState();
}

class _EditorBehindState extends State<_EditorBehind> {
  late bool _made = !widget.later;

  @override
  void initState() {
    super.initState();
    if (_made) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && !_made) setState(() => _made = true);
    });
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.later) _made = true;
    return SliverOffstage(offstage: widget.hidden, sliver: _made ? widget.builder(context) : const SliverToBoxAdapter(child: SizedBox.shrink()));
  }
}

/// Whether the keyboard is up, said to the note's screen as a yes or a no ([_KeyboardUp]). The screen asked the
/// window for the keyboard's height itself, which is another number at every frame of the keyboard's rise and
/// fall, and so was built again whole at each of them, a canvas and its cards with it; what it wants to know
/// (whether to keep room for the phone's bar, whether the page is ready for words) changes twice a keyboard.
class _KeyboardWatch extends StatelessWidget {
  const _KeyboardWatch({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) => _KeyboardUp(up: MediaQuery.viewInsetsOf(context).bottom > 0, child: child);
}

class _KeyboardUp extends InheritedWidget {
  const _KeyboardUp({required this.up, required super.child});

  final bool up;

  static bool of(BuildContext context) => context.dependOnInheritedWidgetOfExactType<_KeyboardUp>()?.up ?? false;

  @override
  bool updateShouldNotify(_KeyboardUp oldWidget) => oldWidget.up != up;
}

/// The page ending where the keyboard begins: the keyboard's height is asked here, where it is used, so its rise
/// lays the page out again and builds nothing of the note's screen. [foot], where given, stands between the page
/// and the keyboard, the page ending above it: simple mode's Format strip (format_bar.dart).
class _AboveKeyboard extends StatelessWidget {
  const _AboveKeyboard({required this.child, this.foot});

  final Widget child;
  final Widget? foot;

  @override
  Widget build(BuildContext context) {
    final foot = this.foot;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: foot == null ? child : Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: <Widget>[Expanded(child: child), foot]),
    );
  }
}
