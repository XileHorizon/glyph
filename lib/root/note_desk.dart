/// One open note's editor, put together: what `src/app/editor/NoteScreen.tsx` and `Editor.tsx` do between them
/// once every piece of the editor exists. The note's screen (lib/note/note_screen.dart) is given an editor builder
/// and its seams; this makes both for one note and keeps what they share for as long as the note is open.
///
/// What is here, each from its own piece:
/// - the editor that is typed in (lib/editor/editor_widget.dart `Editor`), over the view lib/note's host keeps,
///   with every piece's extensions in one list made once: the input, the twelve marks and the five effects with
///   typing's smoke, the inline items with links between notes and the hint in an open first heading, drawn tables,
///   boards drawn as boards (lib/editor/boards), a ticket's panel and its keys' titles (lib/editor/tickets), a
///   ```query drawn as what it finds (lib/editor/queries), links, pictures and media, the + beside an empty line,
///   and find's marks; the queries and the tickets are drawn again whenever the library changes;
/// - the press-and-hold band (lib/editor/band), opened by the editor's own hold, with the marks on its Style page,
///   a list item's fields as its pages, and its rows for boards;
/// - the + and its list (lib/editor/plus), with the effects as rows, every note's title for A note, and a board, a
///   database and Make this a ticket;
/// - what takes the page for a note that is not words: the canvas (lib/canvas), a notebook's index and a journal's
///   entries (lib/book), and the bar and the foot a notebook's page wears;
/// - a tapped chip's page: the band at the chip, on that field's choices (`useFieldTaps`, ContextMenu.tsx);
/// - find and replace (lib/editor/find_bar), from the More sheet and from the band, resting on the keyboard;
/// - the bookmark (lib/editor/items `NoteBookmark`), the cheat sheet's page, and a note's sharing where the build
///   has an account.
///
/// - what a recording just wrote into the note, said with an Undo for ten seconds (`editor/useLanding.ts`): the
///   Undo is an edit in this editor, taking out exactly the pieces the recording put in, what it wrote to other
///   notes is taken back through the library's guarded undo ([NoteDeskWorld.undoCommandMutation]), and the better
///   words wait to write the note while it is open, the editor being its one writer.
///
/// - the tape at the top of a note that has a recording (lib/tapes/note_tape.dart), played by the app's one player,
///   with Add (talk more into the note) and Remove with its Undo (`editor/useNoteTape.ts`), and while it plays the
///   phrases as they were spoken, in the words' place (lib/tapes/transcript_words.dart);
///
/// - the AI in the open note (lib/ai/note_ai.dart `NoteAi`, one to a desk): its extensions among the editor's own
///   (the blanks and their Fill pill, the panel a tap on one opens, what it writes arriving out of smoke, the tracked
///   changes), its layer over the page (the strip under the header, the fills' panel), a run from the More sheet,
///   a spoken instruction and a review the note was opened with, and the tape's Summarize;
///
/// - live typing (lib/live/open.dart): a team's note bound to its document for as long as it is open here, its room
///   held, the others' carets and selections drawn in their colours, and the organization told this device is
///   editing it; a note of the account's own live with the account's other devices where the switch is on;
///
/// What differs from the page:
/// - **A picture is added from the phone's chooser** ([NoteDeskWorld.pickPicture], lib/core/phone_pictures.dart):
///   the band's Add image, the +'s Picture and a canvas's picture card, each offered only where there is a
///   chooser. What goes wrong is said on the note's own line, as the page says it (`_sayOnNote`, the screen's
///   `problem`), and goes after six seconds. A picture copied to the clipboard is pasted in by the band's Paste,
///   read by the phone's own reader ([PhoneClipboard]).
/// - **A film is added from the phone's picker** ([NoteDeskWorld.films], lib/core/phone_films.dart): the +'s A
///   video, offered only where there is a picker, its place kept from the tap, "Adding the video." said a moment
///   after its copy starts, and a film copied for a note that was left thrown away (`addVideo`). Its card plays
///   it where it is on this phone (`VideoMode.play`), by the phone's own player.
/// - **A voice memo left in a spoken note is played where it sits** (lib/editor/media/clips.dart): the editor is
///   told the note's tape ([tapeSource], in a compartment so a take added or the recording removed is followed) and
///   given the app's one player as its [MediaSeams.clipPlayer] (lib/tapes/clip_player.dart).
/// - **A place from the +** (`addPlace`): a line of its own where the caret was, kept from the tap, written once the
///   fix has come and its name with it where one comes within three seconds, later only while the line is still
///   the newest change. `afterComposition` is not waited for, and a note's own tag landing meanwhile is not counted
///   out of the history's depth (`tagSteps`), so a name that comes late then is left as its coordinates.
/// - **The map at the top of a tagged note** is drawn here for the note's screen ([NoteSeams.mapCard]): the tiles
///   where the map switch is on and Local only is off, quiet otherwise and for a draft's waiting tag, its tap the
///   phone's maps. The tag itself, and Add my location, are the screen's own over [NoteDeskWorld.tags].
/// - **A link's tap** is handed to the phone where the build has a way to ([NoteDeskWorld.openLink], lib/core/open_link.dart);
///   a test, and a run with no phone half, opens nothing.
/// - **Pick a date is the phone's own calendar** ([NoteDeskWorld.dayPicker], lib/core/phone_day.dart), as the
///   page's was the WebView's: on a list item's date page, in a ticket's panel and in a query. Without one the row
///   is not offered, and Today, Tomorrow and Next week are.
/// - **A canvas has its comments** where it can be changed: its threads in the note's own sheet, a round on each
///   card in its author's colour ([CanvasComments], lib/canvas/canvas_comments.dart); one that cannot be changed
///   draws none. A team's canvas is drawn from and edited through its structure in the team's document, the other
///   members' pointers over its cards (lib/live/team_canvas.dart). A canvas is framed in a note from the +'s A
///   canvas, which lists every canvas among the notes (`AddConfig.canvases`).
/// - **The strip's room is kept clear by the page** (`NoteAiLayer.onRoom`, the page's `--ai-strip-room`): the desk
///   keeps what the layer says ([NoteSeams.headRoom]) and the note's page starts that much lower while the strip
///   is up, told after the frame it was measured in.
/// - **A board's card has no plugin's rows** (`drawnBoards(actions:)`).
/// - **A person who is a contact** (Settings › Contacts, lib/integrations/contacts): their chip's tap opens their
///   card, Call, Text, Email and Open in Contacts beside the chip's own Remove ([personCard]); the +'s A person and
///   Assign's pick one from the phone's contacts and write `@Sam-Ortiz` ([personPicker], `AddConfig.onPerson`).
/// - **The plugins reach the note through the editor** (lib/editor/items/note_plugins.dart): a swipe on a list item
///   and the quiet words after a line are asked of the app's registry as they are used, a linked to-do's box and
///   its task are kept in step, a linked row opens its menu, and what the note is linked to is drawn at its top
///   (lib/plugins/link_marks.dart), its press the note's More sheet, whose "Linked to" rows are the registry's
///   links and actions ([NoteSeams.plugins]): each link's page inside the sheet, each action run on the note
///   through its editor.
library;

import 'package:flutter/widgets.dart' hide Decoration;
import 'dart:async';

import 'package:flutter/scheduler.dart';
import 'package:flutter/foundation.dart' show ValueListenable, ValueNotifier, listEquals;
import 'package:glacier/glacier.dart';
import '../account/ui_state.dart';
import '../ai/available.dart' show AvailabilityController;
import '../ai/kinds.dart' show RunKind;
import '../ai/note_ai.dart';
import '../ai/note_review.dart' show ReviewHost;
import '../ai/review.dart' show ReviewHandoff;
import '../ai/runs.dart' show RunState, ended, useRun;
import '../ai/summaries.dart' show SummariesState, SummaryStarter;
import '../ai/summary_handoff.dart' show meetingWaitWords;
import '../ai/summary_keep.dart' show summaryBehind;
import '../capture/refine.dart' show RefineState;
import '../capture/recorder.dart' show SpokenAsk;
import '../format/device_facts.dart' show DeviceFacts;
import '../claude/live_typing.dart' show claudeTyping;
import '../live/editor_binding.dart' show liveBindingSlot;
import '../live/open.dart' show NoteLive, OpenLive, TeamBinding;
import '../live/team_canvas.dart' show TeamCanvasHost, TeamCanvasPeople;
import '../canvas/camera.dart' show CanvasCamera;
import '../canvas/geometry.dart' show Point;
import '../art/lucide.g.dart';
import '../book/book_nav.dart';
import '../book/book_view.dart';
import '../book/journal_view.dart';
import '../canvas/canvas_comments.dart';
import '../canvas/canvas_view.dart';
import '../capture/landing.dart';
import '../comments/ui/note_colours.dart';
import '../comments/ui/note_comments.dart';
import '../core/book.dart';
import '../core/canvas_body.dart';
import '../core/command_mutations.dart' show CommandUndoResult;
import '../core/films.dart';
import '../core/images.dart';
import 'iphone_wiring.dart';
import '../core/geotag.dart' show GeoTag, withGeoTag;
import '../core/link_preview.dart' show LinkOpener, LinkPreviewer, noLinkPreviews;
import '../core/location.dart' show LocateFailure, MapsApp, openPlace, tagOf, whyLocateFailed;
import '../core/place_tags.dart' show PlaceTags;
import '../editor/comments/comments.dart';
import '../editor/commands/inserts.dart' show insertLineAt, nameLater, releaseSpot, reserveSpot, spotAt;
import '../core/place_refs.dart' as place_refs;
import '../core/video_refs.dart' show videoMarkdown;
import '../core/note.dart';
import '../core/note_text.dart';
import '../core/preferences.dart';
import '../core/query/query.dart';
import '../editor/band/band.dart' as band;
import '../editor/boards/boards.dart' show drawnBoards;
import '../editor/diagrams/diagrams.dart' show drawnMermaid;
import '../editor/editor.dart';
import '../editor/editor_widget.dart';
import '../editor/find_bar/find_bar.dart';
import '../editor/find_bar/find_marks.dart';
import '../editor/items/items.dart';
import '../core/geocode.dart' show PlaceSearch;
import '../reminders/place_access.dart' show PlaceAccessFlow;
import '../reminders/place_host.dart' show phonePlaces;
import '../reminders/place_settings.dart' show placeSettings;
import '../reminders/place_sheet.dart';
import '../reminders/place_syntax.dart' show PlaceMark;
import '../reminders/remind_choices.dart' show phoneReminderPicker;
import '../reminders/reminder_host.dart' show phoneReminders;
import '../editor/marks/marks.dart';
import '../editor/media/canvas_frames.dart';
import '../editor/media/media.dart';
import '../editor/media/note_embeds.dart';
import '../editor/media/source_line.dart';
import '../links/note_links.dart' show NoteLinksHere;
import '../meet/meet_note.dart' show awaitsWriteUp;
import '../editor/plus/plus.dart';
import '../integrations/contacts/contact_card.dart' show PersonCardAction, showPersonCard;
import '../integrations/contacts/contact_match.dart' show mentionOf;
import '../integrations/contacts/contact_picker.dart' show pickContact;
import '../integrations/contacts/contacts.dart' show phoneContacts;
import '../editor/queries/queries.dart';
import '../editor/ai/blanks.dart' show blanks;
import '../editor/ai/lovart_cues.dart' show LovartCueHooks, lovartCues;
import '../editor/ai/wisp_arrivals.dart' show wispArrivals;
import '../editor/semantics/line_semantics.dart' show semanticsOpenLink;
import '../editor/spell/spell.dart' show PhoneSpellChecker, spellCheck;
import '../editor/suggestions/suggestions.dart' show suggestions;
import '../editor/tables/tables.dart';
import '../editor/tickets/tickets.dart';
import '../editor/view/editor_view.dart';
import '../editor/view/text_panel.dart' show EditorTextPanels, TextPanel, textPanels;
import '../files/attachment_store.dart' show KeptAttachment;
import '../files/files_kit.dart';
import '../files/plus_files.dart';
import '../note/note_editor.dart';
import '../note/note_place.dart';
import '../note/note_place.dart' as reading show caretPlace, placeOf;
import '../note/note_screen.dart';
import '../plugins/link_marks.dart';
import '../plugins/lovart/lovart.dart' show lovartBannerMaking, lovartCuesOn, lovartIsMaking, lovartMaking, makeCue;
import '../note/note_banner.dart';
import '../note/note_settings.dart' show NotePlugins;
import '../plugins/registry.dart' show plugins;
import '../plugins/types.dart' show NoteEditing;
import '../notes/note_templates.dart' show NoteTemplate;
import '../settings/panes/cheat_sheet.dart';
import '../shell/desktop/desktop_commands.dart';
import '../shell/screen.dart' show Keyed;
import '../shell/top_bar_tools.dart' show TopBarTools;
import '../share/ui/share_rows.dart';
import '../tapes/clip_player.dart';
import '../tapes/note_tape.dart';
import '../tapes/player.dart' as tape_player show Tape, TapePlayer;
import '../tapes/transcript_words.dart';

/// How long a place's name is waited for before its line is written with the coordinates (`NAME_WAIT_MS`).
const Duration placeNameWait = Duration(milliseconds: 3000);

/// Whether a document is a note of words, neither a canvas nor a notebook's index: asked by the + on every letter
/// and every move of the caret, and read once for each document.
final DocMemo<bool> _ofWords = DocMemo<bool>((doc) {
  final words = doc.toString();
  return !isCanvasBody(words) && !isBookBody(words);
});

/// The switched-on plugins' inline formattings (`plugins.formats()`, Editor.tsx): what the editor's parser reads and
/// its marks draw. Where nothing was ever put in the registry (a test that builds a note without the app's launch,
/// which is what puts the five that ship there: lib/root/plugin_ground.dart), the app's own marks, which is what
/// the page's registry always holds.
List<GlyphFormat> noteFormats() => plugins.all().isEmpty ? marks : plugins.formats();

/// The marks as the band's Style page lists them, read as the band is drawn (`StyleItems.tsx`): each switched-on
/// plugin's formattings, under its own icon (`format.icon ?? plugin.icon ?? Type`).
List<band.BandFormat> bandFormats() => plugins.all().isEmpty
    ? <band.BandFormat>[for (final mark in marks) band.BandFormat.of(mark, Lucide.all[mark.icon] ?? Lucide.type, mark.about)]
    : <band.BandFormat>[
        for (final plugin in plugins.enabled())
          // With the plugin's own line on what the mark is for, as the cheat sheet has it, for the Style page's hint.
          for (final format in plugin.formats) band.BandFormat.of(format, Lucide.all[format.icon ?? plugin.icon] ?? Lucide.type, format.about),
      ];

/// The effects as the +'s list offers them, at More's end, read as the list is (`addRows.ts` `readGates`).
List<PlusEffect> plusEffects() => <PlusEffect>[
      for (final mark in noteFormats())
        if (mark.look is EffectLook) PlusEffect(name: mark.name, delimiter: mark.delimiter, cue: mark.cue, icon: Lucide.all[mark.icon]),
    ];

/// A list item's fields as the band's pages: lib/editor/items' rows (`fieldItems`), drawn as the band's own.
final band.BandFields bandFields = band.BandFields(
  // Remind me, where the phone reminds: the editor was given its calendar and clock.
  reminds: (view) => view.state.facet(reminderPicker) != null,
  // Remind me at a place, where the phone watches places and the Place reminders plugin is on.
  places: placesOffered,
  atPlace: (view, line, refocus) => unawaited(pickLinePlace(view, line, refocus: refocus)),
  items: (context, request) {
    final page = switch (request.page) {
      band.FieldDatePage(:final key) => DatePage(key),
      band.FieldPriorityPage() => const PriorityPage(),
      band.FieldPersonPage(:final name) => PersonPage(name),
      band.FieldAssignPage() => const AssignPage(),
      band.FieldRemindPage() => const RemindPage(),
      band.FieldPlacePage() => const PlacePage(),
    };
    final items = fieldItems(request.view, request.line, page, onBack: request.onBack, onClose: request.onClose, refocus: request.refocus, redraw: request.redraw, today: request.view.state.facet(fieldsToday)?.call());
    return <Widget>[
      for (final (at, item) in (items ?? const <FieldItem>[]).indexed)
        Builder(
          key: ValueKey<String>(at == 0 && request.onBack != null ? 'back' : 'field:${item.label}'),
          builder: (context) => band.BandItemBox(
            icon: item.icon,
            label: item.label,
            name: item.name,
            lit: item.lit ?? false,
            checkbox: item.lit != null,
            onPress: () {
              final box = context.findRenderObject();
              item.onPress(box is RenderBox && box.attached ? box.localToGlobal(Offset.zero) & box.size : Rect.zero);
            },
          ),
        ),
    ];
  },
);

/// What a desk asks of the app: the notes by their titles, and what the build can do.
@immutable
class NoteDeskWorld {
  const NoteDeskWorld({
    required this.titles,
    required this.known,
    required this.open,
    this.live,
    this.takeJump,
    this.bodyOf,
    this.pictures,
    this.services,
    this.changes,
    this.queryNotes,
    this.queryEvents,
    this.eventsChanged,
    this.openAt,
    this.write,
    this.addTicket,
    this.tickets,
    this.openWithin,
    this.openCanvas,
    this.openPage,
    this.openTicket,
    this.ticketTemplates,
    this.pageTitles,
    this.noteOf,
    this.newEntry,
    this.openLink,
    this.previewer,
    this.embeds,
    this.holdNote,
    this.dropRefine,
    this.tapePlayer,
    this.clipPlayer,
    this.noteById,
    this.getNote,
    this.setNoteRecording,
    this.tapes,
    this.onSpeak,
    this.ai,
    this.aiReady,
    this.pickPicture,
    this.films,
    this.dayPicker,
    this.mapTiles,
    this.tags,
    this.placeSearch,
    this.forgetTag,
    this.undoCommandMutation,
    this.summaries,
    this.refining,
    this.onRecordingChanged,
    this.notesSynced,
    this.shareVersionsFile,
    this.syncWithin,
    this.links,
    this.openTag,
  });

  /// A tag's page, from a tap on its chip in a note (lib/editor/items/tags.dart `tagOpener`); absent, a tap on a tag
  /// is the editor's.
  final void Function(String tag)? openTag;

  /// Every note's title, for the +'s A note.
  final List<String> Function() titles;

  /// Whether a note by that title exists, and the way to it, made first where there is none.
  final bool Function(String title) known;
  final void Function(String title, [String? anchor]) open;

  /// A note's words by its title, for what a link draws of it.
  final String? Function(String title)? bodyOf;

  /// The kept pictures; null where there is no core to keep them.
  final PictureStore? pictures;

  /// The account, where the build has one: a note's sharing is drawn with it.
  final AccountServices? services;

  /// What makes an open note live (lib/live/open.dart), where the build has an account: a team's note bound to its
  /// document, its room held and the others' carets drawn; a note of the account's own, with the switch on.
  final NoteLive? live;

  /// A member's caret a note was opened at (the organization's Jump to cursor), handed over once.
  final Map<String, Object?>? Function(String noteId)? takeJump;

  /// Says when the library changed: every query and every ticket's panel in the open note is drawn again.
  final Listenable? changes;

  /// The library a ```query reads (lib/root/library_reads.dart); absent, a query is drawn as its lines.
  final List<QueryNote> Function()? queryNotes;

  /// The calendars' events a query reads (`from: events`, and a calendar of to-dos; docs/CALENDAR.md), and what
  /// says they changed, when every query in the open note is drawn again. Absent, there are none.
  final List<QueryEvent> Function()? queryEvents;
  final Listenable? eventsChanged;

  /// A note a query listed, opened: the note itself, or a to-do's note at its line, from 0.
  final void Function(String noteId, int? line)? openAt;

  /// Another note's words changed from this one: a to-do ticked in a query, a card dragged to another lane, a
  /// page's status picked in its notebook's index.
  final void Function(String noteId, NoteChange change)? write;

  /// A ticket typed at the + of a lane of a query's board (App.tsx `addFromQuery`).
  final Future<bool> Function(TicketDraft draft, String title, String? from)? addTicket;

  /// What a ticket's panel and a `[[GHO-12]]` are drawn with, for the note by that id; absent, the front matter is
  /// folded as any note's is.
  final TicketOptions Function(String noteId)? tickets;

  /// A title opened from inside a notebook, in its tab's place (`openTitleWithin`); [open] where it is left out.
  final void Function(String title)? openWithin;

  /// A canvas, a page from a template and a ticket made from a notebook's index and opened in its tab
  /// (`openCanvasWithin`, `openPageWithin`, `openTicketWithin`, which is handed the notebook's words).
  final void Function(String title)? openCanvas;
  final void Function(String title, String template)? openPage;
  final void Function(String title, String notebook, NoteTemplate? template)? openTicket;

  /// The templates New ticket offers.
  final List<NoteTemplate> Function()? ticketTemplates;

  /// What can be a page of a notebook: every title but a journal's entries'; [titles] where it is left out.
  final List<String> Function()? pageTitles;

  /// The note by its title, for a journal's entries: when each was written, where, and how it starts.
  final Note? Function(String title)? noteOf;

  /// A journal's New entry, from the template chosen for it.
  final void Function(String journalId, String template)? newEntry;

  /// Hands a web address to the phone (`openLink`): a link card's tap, and a canvas's link card. Absent, a tap
  /// opens nothing.
  final LinkOpener? openLink;

  /// What knows the titles of linked pages (lib/core/link_preview.dart `KeptLinkPreviews`); absent, a link's card
  /// says its site and its path.
  final LinkPreviewer? previewer;

  /// What YouTube, Spotify and Figma said of their links (lib/editor/media/rich_embeds/oembed.dart `KeptEmbeds`);
  /// absent, such a link's card is the plain one and plays nothing.
  final EmbedSource? embeds;

  /// The better words' queue told a note is open, so it waits to write it, and told to drop what it has queued for
  /// words an Undo took out (lib/capture/refine.dart `holdNote`, `dropRefine`). Absent, there is no queue.
  final void Function(String noteId, bool on)? holdNote;
  final void Function(String noteId, int fromMs)? dropRefine;

  /// The app's one player of a recording (lib/tapes/phone_player.dart); absent, a spoken note draws no tape.
  final tape_player.TapePlayer? tapePlayer;

  /// The player of a note's voice memos, which is not the tape's (`src/app/editor/clips.ts` made an `<audio>` of
  /// its own for a memo); absent, a memo is a quiet mark.
  final tape_player.TapePlayer? clipPlayer;

  /// The note by its id as the library has it now, and read whole from the store (its phrases with it).
  final Note? Function(String id)? noteById;
  final Future<Note?> Function(String id)? getNote;

  /// A tape's length and its phrases written beside its note (`setNoteRecording`), and the tape each note holds.
  final Future<Note?> Function(String id, int? recordingMs, List<Segment> segments)? setNoteRecording;
  final TapeIds? tapes;

  /// Talk more into this note (the tape's Add); absent where nothing records.
  final void Function(String noteId)? onSpeak;

  /// Lets the person choose a picture, keeps it and answers its name (lib/core/phone_pictures.dart); absent, no
  /// picture can be added.
  final PicturePicker? pickPicture;

  /// This phone's films (lib/core/films.dart): the picker where there is one, where each film stands and what
  /// plays it. Absent, a film's line is its poster and its length, and none is added.
  final Films? films;

  /// The calendar Pick a date opens (lib/core/phone_day.dart); absent, no such row.
  final DayPicker? dayPicker;

  /// What draws a map's tiles (lib/editor/media/map_tiles.dart); absent, every map is its quiet card.
  final MapTilesBuilder? mapTiles;

  /// The places notes keep (lib/core/place_tags.dart), where the app can say where the phone is: the map card is
  /// drawn only then, and the + offers A place.
  final PlaceTags? tags;

  /// A place by its name, for Remind me at a place (lib/core/geocode.dart `geocodeSearch`); absent, the sheet has
  /// no search.
  final PlaceSearch? placeSearch;

  /// A place waiting for the note, let go: a landing's Undo took the words it waited for (`setPendingTag(id, null)`).
  final void Function(String noteId)? forgetTag;

  /// Takes back a write a recording made to another note, only while that note is exactly what the write left
  /// (`undoCommandMutation`, lib/core/library.dart). Absent, a landing's Undo leaves such a write and says so.
  final Future<CommandUndoResult> Function(String mutationId)? undoCommandMutation;

  /// What the summary queue and the better words' queue say now (the page's `useSummaries()` and `useRefining()`),
  /// asked as a tape is drawn: the tape reads them of its own note. Null where the build has neither.
  final ValueListenable<SummariesState>? Function()? summaries;
  final ValueListenable<RefineState>? Function()? refining;

  /// Hears that the phone's write-up changed a note, by its id (ai/summaries.dart `onRecordingChanged`), and answers
  /// the way to stop: the open note takes its transcript the moment it lands.
  final VoidCallback Function(void Function(String noteId) listener)? onRecordingChanged;

  /// Told when a sync pass changed notes (lib/sync/engine.dart `onNotesChanged`): an open tape reads its phrases
  /// again, since phrases that came alone change nothing the list holds (lib/core/core_library.dart `_put`).
  final Listenable? notesSynced;

  /// Hands a note's versions file to the person and answers what to say (lib/core/versions_share.dart); absent, the
  /// history's row is off.
  final Future<String?> Function(String noteId, String title)? shareVersionsFile;

  /// A sync, waited for a few seconds at most (lib/sync/engine.dart `syncWithin`), for a note's pull to refresh;
  /// absent in a build with no account.
  final Future<void> Function()? syncWithin;

  /// The links between notes for the note by that id (lib/links/note_links.dart): its Links tool and the More
  /// sheet's Links, Outline, Local graph and Copy link to this line. Made once for a desk and let go with it.
  final NoteLinksHere Function(String noteId)? links;

  /// What the AI in a note stands on, asked as a desk is made: null where the build has no engine (a test, a
  /// picture) and the desk then has no AI at all, and null before the engine is up, when the desk waits for
  /// [aiReady] and takes its AI as it comes.
  final NoteAiWorld? Function()? ai;

  /// Says that [ai] answers now, where it did not when a desk was made: a note opened before the engine was up (a
  /// launch straight into a note, a slow phone) has its AI from then, in the editor it already has.
  final Listenable? aiReady;
}

/// What a desk's [NoteAi] is given of the app (lib/ai/note_ai.dart's own list).
@immutable
class NoteAiWorld {
  const NoteAiWorld({required this.availability, this.deviceFacts, this.reviewHost, this.openForSummaries, this.onGetModel, this.summarize, this.summaryEdited, this.opened});

  /// Whether the AI can run here: the app's one controller.
  final AvailabilityController availability;

  /// The phone as the app knows it, for the strip's card.
  final ValueListenable<DeviceFacts>? deviceFacts;

  /// What the review after a recording asks of the app, and the summary queue's door for an open note.
  final ReviewHost? reviewHost;
  final void Function(String id, SummaryStarter? starter)? openForSummaries;

  /// Settings at the Model card, for a press that needs a model on the phone.
  final VoidCallback? onGetModel;

  /// The tape's Summarize: asks the queue for the note's summary, over a section the person edited with `replace`;
  /// and whether the section in these words is no longer the one the app wrote.
  final void Function(String noteId, bool replace)? summarize;
  final bool Function(String noteId, String body)? summaryEdited;

  /// Told the AI of the note on a desk as it is made, and null as it goes: the root draws the scene over the
  /// window from it (lib/scene/at_work.dart).
  final void Function(String noteId, NoteAi? ai)? opened;
}

/// Builds a note's screen with the editor and the seams the desk made for it.
typedef NoteDeskBuilder = Widget Function(BuildContext context, NoteEditorBuilder editor, NoteSeams seams);

/// The editor and everything round it for one open note. Keyed by the note by whoever builds it, so each note
/// has its own.
class NoteDesk extends StatefulWidget {
  const NoteDesk({super.key, required this.noteId, required this.title, required this.world, required this.say, required this.builder, this.prefs, this.readOnly = false, this.landing, this.ask, this.review, this.playTape = false, this.showTranscript = false});

  final String noteId;

  /// The note's own title, which its + does not link to.
  final String title;
  final NoteDeskWorld world;

  /// A toast.
  final void Function(String message) say;
  final NoteDeskBuilder builder;

  /// The preferences; the app's own unless given.
  final PreferencesStore? prefs;

  /// A note in the Trash: its canvas and its index are read, not changed.
  final bool readOnly;

  /// What a recording just wrote into this note (a [CaptureLanding]), with the number that tells one landing from
  /// the next: said with its Undo as the note opens.
  final Keyed? landing;

  /// A spoken instruction about this note and the review a recording handed it, as the note was opened with them.
  final Keyed? ask;
  final Keyed? review;

  /// Opened at its tape, from a cassette on the home page's shelf: the tape plays once it is here, and its transcript
  /// has the page.
  final bool playTape;

  /// Opened at its transcript, a meeting from anywhere but the shelf (lib/note/land_at.dart `atTranscript`): the
  /// transcript has the page under the tape, which stays still (Matt, 2026-10-24: "when clicking on meetings it
  /// doesn't load the transcript"). [playTape] shows it too.
  final bool showTranscript;

  @override
  State<NoteDesk> createState() => NoteDeskState();
}

class NoteDeskState extends State<NoteDesk> {
  final EditorController _editor = EditorController();
  final band.ContextBandController _band = band.ContextBandController();
  late final PlusController _plus = PlusController(allowed: _plusAllowed);

  EditorView? _view;
  NoteBookmark? _bookmark;

  /// The note as it is live in this editor, while it is (lib/live/open.dart), and a team's note's document and
  /// room once they are made: what its canvas is drawn and edited through.
  OpenLive? _live;
  TeamBinding? _team;

  /// A member's spot on this canvas to centre on, where the note was opened at one (`goTo`).
  Point? _goTo;

  /// Find and replace, while it is up: what it opened searching for, and which opening it is.
  ({String initial, int nonce})? _finding;
  int _finds = 0;

  PreferencesStore get _prefs => widget.prefs ?? preferences;
  NoteDeskWorld get _world => widget.world;

  /// The editor's controller, for a test or a diagnostic.
  EditorController get editor => _editor;

  /// The links between notes for this note, made once.
  late final NoteLinksHere? _links = _world.links?.call(widget.noteId);

  /// The band's controller.
  band.ContextBandController get bandController => _band;

  /// Whether find and replace is up.
  bool get finding => _finding != null;

  /// The AI in this note, where the app has an engine: made with the desk and let go with it.
  /// Made as the desk is where the engine is up by then, and as the engine comes up where it was not
  /// ([_aiArrived]): the page's note always has its `useNoteAi`, whose model arrives when it does.
  NoteAiWorld? _aiWorld;
  NoteAi? _ai;

  NoteAi _makeAi(NoteAiWorld world) => NoteAi(
        noteId: widget.noteId,
        flush: () => _flush?.call(),
        body: () => _view?.state.doc.toString() ?? '',
        wisp: () => _prefs.value.wisp,
        toast: _aiToast,
        onGetModel: world.onGetModel,
        availability: world.availability,
        reviewHost: world.reviewHost,
        openForSummaries: world.openForSummaries,
      )
        ..addListener(_aiSaid)
        ..addListener(_aiRan);

  /// What the desk's own seams draw of the AI, as the desk was last built: the run that is on (the dot on its row
  /// in More) and whether the AI can run here (the tape's Summarize word). The AI tells its listeners of more than
  /// those - its marks' count, a review, the editor's view it was just given, which it says once as every note
  /// opens - and all of that is drawn by its own layer, which listens for itself (lib/ai/note_ai.dart
  /// `NoteAiLayer`). Built again at every word of the AI's, the desk built the note's screen a third time at
  /// every opening, and its canvas or its notebook's index with it.
  (RunKind?, bool)? _aiDrawn;

  void _aiSaid() {
    final ai = _ai;
    if ((ai?.runningKind, ai?.canSummarize ?? false) != _aiDrawn) _redraw();
  }

  /// The AI's part of the editor, in a slot of its own so that it can be put in an editor that was made before
  /// there was an engine: the blanks, the arrivals out of smoke and the tracked changes with an AI; without one,
  /// what the person takes out still leaves as smoke (Ghostly typing), and an iPhone's blanks are drawn.
  final Compartment _aiSlot = Compartment();

  /// Whether the editor's extensions were made with the AI's in the slot; and, where they were not, the editor
  /// the AI's have been put in since.
  bool _aiFromStart = false;
  EditorView? _aiIn;

  Extension _aiAtStart() {
    _aiFromStart = _ai != null;
    return _aiPart();
  }

  /// An editor made before the engine was up has the AI's extensions put in it, once.
  void _aiInto(EditorView view) {
    if (_ai == null || _aiFromStart || identical(_aiIn, view)) return;
    _aiIn = view;
    view.dispatch(TransactionSpec(effects: _aiSlot.reconfigure(_aiPart())));
  }

  Extension _aiPart() {
    final ai = _ai;
    if (ai != null) return Extension.list(noteAiExtensions(ai, still: _still, wispTyping: _ghostly));
    return Extension.list(<Extension>[
      // Claude's words arrive out of smoke, settled by the arrivals' own plugin: departures alone kept every arrival
      // in the field unsettled. What the person takes out leaves as smoke only with Ghostly typing on, read as the
      // editor is made (`wispTyping={prefs.wisp}`). The arrivals bring the departures themselves: given twice, every
      // ghost is drawn twice.
      wispArrivals(typing: _ghostly),
      // With no AI a note's blanks are still drawn, as squares with no Fill: the page's `blankSquares(null)`
      // (Editor.tsx), which every note has. An iPhone's say why there is no Fill when one is pressed
      // (iphone_wiring.dart).
      ...switch (iPhoneBlanks(noteId: () => widget.noteId, say: (message) => _toasts?.toast(message: Text(message)), still: _still)) {
        final List<Extension> phone when phone.isNotEmpty => phone,
        _ => <Extension>[blanks(null, still: _still)],
      },
    ]);
  }

  /// The engine is up: this note has its AI from here, in the editor it has, with what was typed meanwhile and
  /// what it was opened with (a spoken instruction, a review) run now.
  void _aiArrived() {
    if (_ai != null || !mounted || _leaving) return;
    final world = _world.ai?.call();
    if (world == null) return;
    _world.aiReady?.removeListener(_aiArrived);
    _aiWorld = world;
    final ai = _ai = _makeAi(world);
    final view = _view;
    if (view != null) {
      _aiInto(view);
      ai.attach(view);
    }
    world.opened?.call(widget.noteId, ai);
    _handed();
    _redraw();
  }

  /// The + looks again as a run starts and as it ends (`plusAllowed`, which reads `ai.runningKind`): asked at no
  /// other word of the AI's.
  RunKind? _ran;
  void _aiRan() {
    final now = _ai?.runningKind;
    if (now == _ran) return;
    _ran = now;
    final view = _view;
    if (view != null && mounted && !_leaving) _plus.recheck(view);
  }

  /// Saves what is typed now, handed over by the note's screen as it is made.
  VoidCallback? _flush;

  /// The note's comments (editor/useNoteComments.tsx): what the drawing opens, what Comment starts, and their
  /// sheet; and whose colour each wears where the note is filed.
  late final NoteColours _wears = NoteColours(
    _world.services,
    widget.noteId,
    // The editor's rounds and washes drawn again in them; and a canvas's rounds, which the desk's own build hands
    // their colours.
    onChange: () {
      _comments.recolour();
      _redraw();
    },
  );
  late final ScreenComments _comments = ScreenComments(noteId: widget.noteId, view: () => _view, say: widget.say, colours: () => _wears.now, account: _world.services?.account)..addListener(_redraw);

  /// A line for the person, as the AI asks for one.
  void _aiToast(AiToast said) {
    if (!mounted) return;
    final action = said.onAction;
    _toasts?.toast(
      message: Text(said.message),
      duration: said.duration == null ? null : Duration(milliseconds: said.duration!),
      action: said.actionLabel == null || action == null ? null : GlacierToastAction(label: said.actionLabel!, onPress: action),
    );
  }

  /// What the note was opened with (lib/root/capture_route.dart `finished`): a spoken instruction, run once the
  /// editor and the AI are ready, and the review a recording handed it.
  void _handed() {
    final ai = _ai;
    if (ai == null) return;
    final ask = widget.ask;
    final said = ask?.value;
    if (ask != null && said is SpokenAsk) ai.ask(NoteAsk(kind: RunKind.of(said.kind) ?? RunKind.ask, instruction: said.instruction, key: ask.key));
    final review = widget.review;
    final handoff = review?.value;
    if (review != null && handoff is ReviewHandoff) ai.review(handoff, review.key);
  }

  /// Reduced motion and the Motion setting's pace, read as the editor is first made (a state field has neither a
  /// context nor a window to ask).
  late final bool _still = context.tokens.reducedMotion;
  late final double _pace = _prefs.value.motionScale;

  /// Appearance › Motion › Ghostly typing, as it stood when this note's editor was made.
  late final bool _ghostly = _prefs.value.wisp;

  /// The inline formattings this note's editor parses and draws: the switched-on plugins', read as the editor is
  /// made, as the page's is (a plugin switched on or off is in the next note opened).
  late final List<GlyphFormat> _formats = noteFormats();

  /// Every piece's extensions, once: another list would be another editor (lib/note/note_editor.dart).
  late final List<Extension> _extensions = <Extension>[
    // NoteScreen.tsx `assist={prefs.assist}`: the keyboard's aids and the spell checker, on unless the preference
    // says otherwise, read as the editor is made.
    editorInput(assist: _prefs.value.assist),
    // Empty until the note is live: then the binding to its document, and the others' carets.
    liveBindingSlot(),
    markExtensions(_formats),
    wispStill.of(_still),
    wispPace.of(_pace),
    // The AI's own, or what a note without one has in their place; changed for the AI's when the engine comes up
    // after the editor was made.
    _aiSlot.of(_aiAtStart()),
    itemExtensions(
      wiki: WikiOptions(known: (title) => _world.known(title), open: (title, [anchor]) => _world.open(title, anchor), body: (title) => _world.bodyOf?.call(title)),
      openHeading: true,
      // A swipe on an item, and the words offered after a line: the plugins', asked as they are used, so one
      // switched on or off is followed without another editor.
      swipe: () => itemSend(widget.noteId, _editing),
      suggest: (body) => lineOffers(widget.noteId, _editing, body),
      doneSyncs: true,
    ),
    drawnTables(),
    // A clip's `source:` as a line under its title (lib/editor/media/source_line.dart).
    sourceLine(open: _world.openLink),
    // A tap on a tag's chip opens the tag's page (lib/notes/collection_screen.dart).
    if (_world.openTag != null) tagOpener.of(_world.openTag!),
    // Pick a date, on a list item's date page, in a ticket's panel and in a query: the phone's calendar.
    if (_world.dayPicker != null) dayPicker.of(_world.dayPicker!),
    // A reminder's day and time, where the phone reminds (lib/reminders): its calendar, then its clock.
    if (phoneReminders.value case final reminders?) reminderPicker.of(phoneReminderPicker(reminders, _world.dayPicker)),
    // A person who is a contact opens their card, and Assign picks one (Settings › Contacts), each asked as it is used.
    personCard.of(_personCard),
    personPicker.of(PersonPicking(offered: () => phoneContacts.ready && !widget.readOnly, pick: (_) => _pickPerson())),
    // Remind me at a place, where the phone watches places (lib/reminders/place_sheet.dart).
    if (phonePlaces.value != null) placePicker.of(_askPlace),
    // Boards drawn as boards, the fence still there to edit (Editor.tsx `drawnBoards()`).
    drawnBoards(),
    // A ```mermaid fence drawn as its diagram (Editor.tsx `drawnMermaid()`).
    drawnMermaid(),
    // A ticket's front matter as its properties, and a [[GHO-12]] with the ticket's title.
    if (_world.tickets != null) tickets(() => _world.tickets?.call(widget.noteId)),
    // A ```query fence drawn as what it finds in the library: its lines where there is none.
    if (_world.queryNotes != null) queries(() => _queries),
    // ![[A canvas]] on a line of its own draws that canvas in a frame (Editor.tsx `canvasFrames`).
    if (_world.bodyOf != null)
      canvasFrames(FrameOptions(body: (title) => _world.bodyOf?.call(title), known: (title) => _world.known(title), open: (title, [anchor]) => _world.open(title, anchor))),
    // Any other note, a section of one, a named line or a picture, embedded the same way and drawn in place
    // (lib/editor/media/note_embeds.dart).
    if (_world.bodyOf != null) noteEmbeds(EmbedOptions(body: (title) => _world.bodyOf?.call(title), open: (title, [anchor]) => _world.open(title, anchor), formats: _formats)),
    // Each `[^c1]` a round in its author's colour, and the ```comments fence drawn as its threads (Editor.tsx
    // `noteComments`).
    noteComments(() => _comments.hooks),
    // Claude's suggested edits in CriticMarkup, with Keep and Revert (docs/CLAUDE_LIVE.md, "Suggest mode").
    suggestions(),
    // `{image: a prompt}` with Lovart's mark after it while the Lovart plugin is on, a tap making that one
    // (lib/editor/ai/lovart_cues.dart): drawn again as the plugin is switched and as a cue is being made.
    if (!widget.readOnly)
      lovartCues(LovartCueHooks(
        on: lovartCuesOn,
        press: (cue) => unawaited(makeCue(_editing, cue)),
        making: (cueText) => lovartIsMaking(widget.noteId, cueText),
        changes: Listenable.merge(<Listenable>[lovartMaking, plugins]),
      )),
    // Claude typing as it writes, with its caret (lib/claude/live_typing.dart, docs/CLAUDE_APP.md).
    claudeTyping,
    mediaExtensions(
      seams: _mediaSeams,
      // A place in the words draws its map under its line, as the note's own tag does at its top.
      places: PlaceMode.live,
      // A film plays in its note's own screen, where it is on this phone.
      videos: _world.films == null ? VideoMode.still : VideoMode.play,
    ),
    // The note's recording, for the voice memos in it: changed when a take is added or the recording removed.
    _tapeSlot.of(tapeSource.of(_tapeFor = _memoTape())),
    _plus.extension,
    findBarExtensions,
    // The phone's spell checker, asked about the words near the caret a moment after the person stops, and a red
    // wave under each it would have otherwise (lib/editor/spell; the page's `spellcheck="true"`). Nothing on a
    // device whose engine has no checker to ask.
    if (const PhoneSpellChecker().supported) spellCheck(),
    // A link a screen reader activates is opened as a tap on it is (lib/editor/semantics/line_semantics.dart).
    if (_world.openLink != null) semanticsOpenLink.of((url) => unawaited(_world.openLink!(url))),
    // The bookmark's button follows the words where they changed under it and not by its own press: an undo, a
    // redo, words from another device. Never a keystroke's, which would read the whole note for every letter.
    EditorViewLike.updateListener.of((update) {
      if (!update.docChanged || _bookmark == null) return;
      if (!update.transactions.any((tr) => tr.isUserEvent('undo') || tr.isUserEvent('redo') || tr.annotation(Transaction.userEvent) == null)) return;
      SchedulerBinding.instance.addPostFrameCallback((_) {
        if (mounted) _bookmark?.sync();
      });
      SchedulerBinding.instance.ensureVisualUpdate();
    }),
  ];

  /// Where the words' pictures, places, films and links are drawn from and opened, for this note's editor and its
  /// notebook's words alike.
  late final MediaSeams _mediaSeams = MediaSeams(
    pictures: _world.pictures,
    openLink: _world.openLink,
    linkMenus: LinkMenus(say: (message) => widget.say(message)),
    previewer: _world.previewer ?? noLinkPreviews,
    embeds: _world.embeds ?? noEmbeds,
    linkPreviews: () => _prefs.value.linkPreviews,
    switches: _prefs,
    placeSwitches: () => (localOnly: _prefs.value.localOnly, mapTiles: _prefs.value.mapTiles),
    onOpenPlace: _openPlace,
    mapTiles: _world.mapTiles,
    clipPlayer: _clips,
    films: FilmSeams(films: _world.films),
  );

  /// What a notebook's or a journal's own words, and its pages read straight through, draw (lib/book/book_view.dart
  /// `BookDrawing`): what this note's editor draws, read only, and none of what edits, listens or follows a caret.
  /// A `[[link]]` there opens in this tab, as the index's own rows do.
  late final BookDrawing _bookDrawing = BookDrawing(
    formats: _formats,
    extensions: <Extension>[
      markExtensions(_formats),
      itemExtensions(wiki: WikiOptions(known: (title) => _world.known(title), open: (title, [anchor]) => _openWithin(title), body: (title) => _world.bodyOf?.call(title))),
      drawnTables(),
      if (_world.openTag != null) tagOpener.of(_world.openTag!),
      drawnBoards(),
      drawnMermaid(),
      if (_world.queryNotes != null) queries(() => _bookQueries),
      if (_world.bodyOf != null)
        canvasFrames(FrameOptions(body: (title) => _world.bodyOf?.call(title), known: (title) => _world.known(title), open: (title, [anchor]) => _openWithin(title))),
      if (_world.bodyOf != null) noteEmbeds(EmbedOptions(body: (title) => _world.bodyOf?.call(title), open: (title, [anchor]) => _openWithin(title), formats: _formats)),
      suggestions(),
      mediaExtensions(seams: _mediaSeams, places: PlaceMode.live, videos: _world.films == null ? VideoMode.still : VideoMode.play),
      if (_world.openLink != null) semanticsOpenLink.of((url) => unawaited(_world.openLink!(url))),
    ],
    // Drawn again as the library changes, as this note's own editor's are (`_libraryChanged`): the board over a
    // notebook's index shows a card where it was dropped.
    changes: _world.changes,
    told: (state) => <StateEffect<Object?>>[
      if (_world.queryNotes != null && queryFencesOf(state.doc).isNotEmpty) refreshQueries.of(null),
      if (_world.bodyOf != null && hasFrames(state.doc)) refreshCanvasFrames.of(null),
    ],
  );

  /// What plays a voice memo: the memos' own player of a recording, where there is one. Never the tape's: a memo
  /// played must leave the tape's playhead where it was (docs/PARITY.md, Differs 17).
  late final TapeClipPlayer? _clips = _world.clipPlayer == null ? null : TapeClipPlayer(_world.clipPlayer!);
  final Compartment _tapeSlot = Compartment();
  Tape _tapeFor = Tape.none;

  /// The tape the note's memos are stretches of (Editor.tsx's `tape` and `tapeId`): the note's own recording, by
  /// its id, where it has one and there is a player; none otherwise, and its memos are then quiet marks.
  Tape _memoTape() {
    final note = _world.noteById?.call(widget.noteId);
    if (_world.clipPlayer == null || note == null || (note.recordingMs ?? 0) <= 0) return Tape.none;
    return Tape(src: widget.noteId, id: _world.tapes?.tapeId(widget.noteId));
  }

  /// The note as a plugin changes it: through the editor, so each change is one undo and saves like typing.
  NoteEditing get _editing => noteEditing(widget.noteId, _view, () => _view?.state.doc.toString() ?? '', _sayOnNote);

  /// What the open note's queries read and do (shell/useQueries.ts): the library, a row opened, another note's
  /// to-do ticked or its field set, and a ticket typed at a lane's +.
  late final QueryOptions? _queries = _world.queryNotes == null
      ? null
      : QueryOptions(
          notes: () => _world.queryNotes!(),
          noteId: widget.noteId,
          open: (id, line) => _world.openAt?.call(id, line),
          write: (id, change) => _world.write?.call(id, change),
          add: _world.addTicket == null ? null : (draft, title, from) => _world.addTicket!(draft, title, from),
          events: _world.queryEvents,
        );

  /// What a notebook's own words' queries read and do: [_queries] with no note read as typed. The words there are
  /// the preface alone, without the front matter that makes the note a notebook and names it, and read as this
  /// note's body they took the notebook out of the library: `from: tasks [[Baby on the way]]` in that notebook's
  /// own words said "No note is called". The notebook as it was last saved is the one they read.
  ///
  /// The words are drawn read only, and what their queries list is written all the same, where this note can be
  /// (Matt, 2026-10-27: "I can't drag items around in the query tickets for hello trade"): a ticket carried to
  /// another lane of the board over the index, a to-do ticked, a field picked, each in its own note through the
  /// screen's one writer, the library's (`_writeNote`), as the index's own status button writes a page. The
  /// notebook itself is not written from here: its words are its screen's, kept behind it, and a write through the
  /// library under them would be refused at their next save.
  late final QueryOptions? _bookQueries = _world.queryNotes == null
      ? null
      : QueryOptions(
          notes: () => _world.queryNotes!(),
          noteId: null,
          open: (id, line) => _world.openAt?.call(id, line),
          write: (id, change) {
            if (id != widget.noteId) _world.write?.call(id, change);
          },
          add: _world.addTicket == null ? null : (draft, title, from) => _world.addTicket!(draft, title, from),
          events: _world.queryEvents,
          listedWritable: () => !widget.readOnly && _world.write != null,
        );

  @override
  void initState() {
    super.initState();
    _world.changes?.addListener(_libraryChanged);
    _world.notesSynced?.addListener(_phrasesMayHaveMoved);
    _unhearRecording = _world.onRecordingChanged?.call(_recordingHeard);
    _world.eventsChanged?.addListener(_eventsChanged);
    plugins.addListener(_pluginsChanged);
    // While the note is open the better words wait to write it: the editor is its one writer.
    _world.holdNote?.call(widget.noteId, true);
    _land();
    if (_world.ai?.call() case final world?) {
      _aiWorld = world;
      _ai = _makeAi(world);
    } else {
      // No engine yet: the note takes its AI as one comes up.
      _world.aiReady?.addListener(_aiArrived);
    }
    _aiWorld?.opened?.call(widget.noteId, _ai);
    _handed();
    // A desktop's Command-F, and the Mac's Edit › Find: this note's find bar, with what is selected in it.
    _stopFind = desktopCommands.on(DesktopCommand.find, () {
      final view = _view;
      if (view == null || !mounted || _leaving) return false;
      final picked = view.state.selection.main;
      _openFind(view, picked.empty ? '' : view.state.sliceDoc(picked.from, picked.to));
      return true;
    });
  }

  VoidCallback? _stopFind;

  /// The note's tape, once it has a recording and there is a player to play it.
  tape_player.Tape? _tape;

  /// Whether the tape this note was opened at has been started ([NoteDesk.playTape]): once, so a pause stays.
  bool _tapePlayed = false;

  /// The transcript has the page with the tape still: the note was opened at it ([NoteDesk.showTranscript],
  /// [NoteDesk.playTape]), or the strip's Transcript was pressed; its Note puts the words back.
  late bool _reading = widget.showTranscript || widget.playTape;

  /// Whether the strip has said where this device has no audio for the tape, once the transcript is read.
  bool _audioLooked = false;

  /// `tape.length && tape.playing`: the tape is playing, so the transcript has the page; or it is being read.
  bool get _listening {
    final tape = _tape;
    return tape != null && tape.length > 0 && (tape.playing || _reading);
  }

  /// The strip's Transcript and Note.
  void _toggleTranscript() => setState(() => _reading = !_reading);

  /// Whether the note is one of the meetings (`prefs.meetings`), whose strip offers its transcript.
  bool get _meeting => _prefs.value.meetings.containsKey(widget.noteId);

  /// The phrases read again, where the note has a tape: a sync pass changed notes, or the phone's write-up this one.
  void _phrasesMayHaveMoved() => _tape?.reread();
  void _recordingHeard(String id) {
    if (id == widget.noteId) _phrasesMayHaveMoved();
  }

  VoidCallback? _unhearRecording;

  /// Where the note's write-up is, for the transcript's place while it is still to come (Matt, 2026-10-24): this
  /// device's own, with how far it has got ("Writing up… 42%") or what it waits for; or, with none here, the note's
  /// first line still saying it is to come (lib/meet/meet_note.dart `awaitsWriteUp`), another device's.
  String? _writeUpLine(Note note) {
    final id = widget.noteId;
    final summaries = _heardSummaries?.value;
    if (summaries != null && summaries.native.contains(id)) {
      final percent = summaries.writingUp[id];
      return percent == null || percent <= 0 ? 'Writing up…' : 'Writing up… ${percent.clamp(0, 100).round()}%';
    }
    if (summaries != null && summaries.waiting.contains(id)) return 'The write-up waits for the phone to charge.';
    // A meeting says what to do, or where it is being written (lib/ai/summary_handoff.dart; Matt, 2026-10-26).
    if (_meetingWait(summaries) case final words?) return words;
    if (summaries != null && summaries.needsModel.contains(id)) return 'The write-up needs a model.';
    if (awaitsWriteUp(note.body)) return 'Being written up on another device.';
    return null;
  }

  tape_player.Tape? _tapeNow() {
    final player = _world.tapePlayer;
    final note = _world.noteById?.call(widget.noteId);
    if (player == null || note == null) return _tape;
    final tape = _tape;
    if (tape == null) {
      if ((note.recordingMs ?? 0) <= 0) return null;
      return _tape = tape_player.Tape(note, player: player, getNote: _world.getNote)..addListener(_redraw);
    }
    if (!identical(tape.note, note)) tape.note = note;
    return tape;
  }

  /// This note's latest run (`useRun(note.id)`), and the two queues as the tape hears them: one listenable for as long
  /// as the app's queues are the same ones, so the tape and nothing else is drawn again when they speak.
  late final ValueListenable<RunState?> _run = useRun(widget.noteId);
  ValueListenable<SummariesState>? _heardSummaries;
  ValueListenable<RefineState>? _heardRefining;
  Listenable? _tapeHears;

  Listenable _queues() {
    final summaries = _world.summaries?.call(), refining = _world.refining?.call();
    final heard = _tapeHears;
    if (heard != null && identical(summaries, _heardSummaries) && identical(refining, _heardRefining)) return heard;
    _heardSummaries = summaries;
    _heardRefining = refining;
    return _tapeHears = Listenable.merge([summaries, refining, _run]);
  }

  /// What a meeting waiting for its summary says, here or on another device (lib/ai/summary_handoff.dart
  /// `meetingWaitWords`); null for a note that is no meeting, or waits for none.
  String? _meetingWait(SummariesState? summaries) {
    final id = widget.noteId;
    final prefs = preferences.value;
    if (!prefs.meetings.containsKey(id)) return null;
    return meetingWaitWords(prefs, id, needsModelHere: summaries?.needsModel.contains(id) ?? false);
  }

  /// What the queues say of this note (tapes/NoteTape.tsx): Summarizing, "Needs a model.", "The summary didn't
  /// come.", "The summary comes after the better words."
  TapeQueue _tapeQueue() {
    final id = widget.noteId;
    final summaries = _heardSummaries?.value;
    final run = _run.value;
    return TapeQueue(
      pending: summaries?.pending.contains(id) ?? false,
      needsModel: summaries?.needsModel.contains(id) ?? false,
      waitWords: _meetingWait(summaries),
      failed: summaries?.failed.contains(id) ?? false,
      claudeHeld: summaries?.claudeHeld.contains(id) ?? false,
      failedWhy: summaries?.reasons[id],
      refining: _heardRefining?.value.pending.contains(id) ?? false,
      running: run != null && run.kind == RunKind.summarize && !ended(run),
    );
  }

  /// The recording just removed, while its Undo still means something: let go when the note is spoken into or left
  /// (`removed`, `forgetRemoved`).
  Object? _removed;

  /// Talk more into this note, from its tape's Add or its own mic (`speakHere`): a removed recording's Undo is
  /// forgotten, and what is typed is saved, before the recorder is asked for.
  void _beforeSpeak() {
    _removed = null;
    _flush?.call();
  }

  /// The recording taken off the note, with an Undo that puts it back (`removeRecording`). The words stay: only
  /// the length and the phrases go, and the tape the note's voice memos play from is unnamed until the Undo.
  Future<void> _removeRecording() async {
    final tape = _tape;
    final write = _world.setNoteRecording;
    if (tape == null || write == null) return;
    final id = widget.noteId;
    final memos = hasClips(_view?.state.doc.toString() ?? '');
    await tape.player.pause().then<void>((_) {}, onError: (Object _) {});
    final full = await _world.getNote?.call(id).then<Note?>((note) => note, onError: (Object _) => null);
    final ms = tape.length;
    final segments = full?.segments ?? tape.segments ?? const <Segment>[];
    final held = _world.tapes?.tapeId(id);
    _world.tapes?.setTapeId(id, null);
    final removed = _removed = Object();
    try {
      await write(id, null, const <Segment>[]);
    } catch (failure) {
      if (identical(_removed, removed)) _removed = null;
      _world.tapes?.setTapeId(id, held);
      widget.say('The recording couldn’t be removed: $failure');
      return;
    }
    if (!mounted) return;
    _toasts?.toast(
      message: Text(memos ? 'Recording removed. Its voice memos are quiet until you undo.' : 'Recording removed.'),
      duration: const Duration(seconds: 5),
      action: GlacierToastAction(
        label: 'Undo',
        onPress: () {
          // Spoken into since, or left: a new take replaced the removed recording's file, and the Undo is not true.
          if (!identical(_removed, removed)) return;
          _removed = null;
          _world.tapes?.setTapeId(id, held);
          unawaited(write(id, ms, segments).then<void>((_) {}, onError: (Object _) {}));
        },
      ),
    );
  }

  GlacierToastController? _toasts;
  int? _landed;
  bool _saidLanding = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _toasts = GlacierToast.of(context);
    _haptic = HapticsProvider.of(context);
  }

  /// A note opened by the recording that just wrote into it: "Added to House TODOs", with an Undo, for ten seconds
  /// (`useLanding`). One toast for each landing, told apart by its key; said once the first frame is drawn.
  void _land() {
    final keyed = widget.landing;
    final landing = keyed?.value;
    if (keyed == null || landing is! CaptureLanding || keyed.key == _landed) return;
    _landed = keyed.key;
    if (landing.noteId != widget.noteId || (landing.blocks.isEmpty && landing.others.isEmpty)) return;
    SchedulerBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _saidLanding = true;
      _toasts?.toast(
        message: Text(landingLine(landing)),
        duration: const Duration(seconds: 10),
        action: GlacierToastAction(label: 'Undo', onPress: () => unawaited(_undoLanding(landing))),
      );
    });
  }

  /// The Undo: exactly the pieces of text the recording put in, found where they were written and taken out as one
  /// edit, which the note's own saving writes like typing and the editor's undo can bring back. A piece edited
  /// since is left alone, and the toast says so. Writes the recording made to other notes are reversed through the
  /// library's `undo_command`, which checks each is still as it left it; one that is not is left alone and counted
  /// with the pieces. The tape is never touched.
  Future<void> _undoLanding(CaptureLanding landing) async {
    var missing = 0;
    var removed = false;
    final view = _view;
    if (landing.blocks.isNotEmpty) {
      if (view != null) {
        final doc = view.state.doc.toString();
        final out = takeOut(doc, landing.blocks);
        missing = out.missing;
        if (out.changes.isNotEmpty) {
          // A note left with nothing but where it was written (lib/core/geotag.dart) is not left behind: its tag goes
          // in the same step, so one undo brings the words and the tag back together.
          var rest = doc;
          for (final change in [...out.changes]..sort((a, b) => b.from.compareTo(a.from))) {
            rest = rest.substring(0, change.from) + rest.substring(change.to);
          }
          final untagged = withGeoTag(rest, null);
          final bare = rest.trim().isNotEmpty && untagged.trim().isEmpty ? untagged : null;
          view.dispatch(TransactionSpec(
            changes: bare != null
                ? ChangeSpec(from: 0, to: doc.length, insert: bare)
                : ChangeSet.of([for (final change in out.changes) ChangeSpec(from: change.from, to: change.to, insert: '')], doc.length),
            userEvent: 'delete',
          ));
          removed = true;
        }
      } else {
        missing = landing.blocks.length;
      }
    }
    final undo = _world.undoCommandMutation;
    for (final mutationId in landing.others) {
      final undone = undo == null ? null : await undo(mutationId).then<CommandUndoResult?>((result) => result, onError: (Object _) => null);
      if (undone?.status != 'undone' && undone?.status != 'already-undone') missing += 1;
    }
    // Only for words taken out of this note: the better words of what stays in it still come.
    final fromMs = landing.fromMs;
    if (removed && fromMs != null) _world.dropRefine?.call(widget.noteId, fromMs.toInt());
    // And a tag that waited for those words is let go with them.
    if (removed) _world.forgetTag?.call(widget.noteId);
    // After the pressed toast has gone, which pressing its action does just after this returns. Said by the app's
    // toasts, so a note left while its other notes were asked is still told of, as on the page.
    await Future<void>.value();
    if (missing > 0) _toasts?.toast(message: Text('${landing.title} has changed since, so it was left as it is.'), duration: const Duration(seconds: 5));
  }

  @override
  void didUpdateWidget(NoteDesk oldWidget) {
    super.didUpdateWidget(oldWidget);
    _land();
    // Opened at its transcript again while it was open with its words: the transcript has the page.
    if ((widget.showTranscript && !oldWidget.showTranscript) || (widget.playTape && !oldWidget.playTape)) _reading = true;
    if (!identical(oldWidget.world.notesSynced, _world.notesSynced)) {
      oldWidget.world.notesSynced?.removeListener(_phrasesMayHaveMoved);
      _world.notesSynced?.addListener(_phrasesMayHaveMoved);
    }
    // After the frame, as the page's effect is: a run started on a note already open (the palette's) tells the scene
    // over the window, which may not be told while the tree is being built.
    if (oldWidget.ask?.key != widget.ask?.key || oldWidget.review?.key != widget.review?.key) {
      SchedulerBinding.instance.addPostFrameCallback((_) {
        if (mounted) _handed();
      });
    }
    if (!identical(oldWidget.world.eventsChanged, _world.eventsChanged)) {
      oldWidget.world.eventsChanged?.removeListener(_eventsChanged);
      _world.eventsChanged?.addListener(_eventsChanged);
    }
    if (identical(oldWidget.world.changes, _world.changes)) return;
    oldWidget.world.changes?.removeListener(_libraryChanged);
    _world.changes?.addListener(_libraryChanged);
  }

  /// The library changed: any note changed may change what a query finds, and another ticket closed or a person
  /// named changes a panel (Editor.tsx's two effects). Told after the frame where one is being built.
  ///
  /// Told only of what the open note reads. Every change of the library used to be sent into the editor as three
  /// effects and drawn as a whole build of the desk, and the commonest change of all is this note's own save, a
  /// few times a second while it is typed in: a note with no query, no ticket's panel or key and no framed canvas
  /// reads nothing of the library and is told nothing; one that reads it is told when another note changed, or
  /// its own times where a query reads those ([_libraryMoved]); and the desk is drawn again only when the note's
  /// recording changed, which is all of the library it draws.
  void _libraryChanged() {
    void tell() {
      final view = _view;
      // The tape follows its note: a take added, the recording removed or put back.
      if (mounted && _world.tapePlayer != null && _recordingMoved()) setState(() {});
      if (!mounted || view == null) return;
      final tape = _memoTape();
      final retaped = tape != _tapeFor;
      if (retaped) {
        _tapeFor = tape;
        _clips?.stop();
      }
      final queried = _world.queryNotes != null && queryFencesOf(view.state.doc).isNotEmpty;
      final ticketed = _world.tickets != null && readsTickets(view.state);
      // A canvas framed in this note may have been drawn on: its frame is looked at again.
      final framed = _world.bodyOf != null && hasFrames(view.state.doc);
      final moved = (queried || ticketed || framed) && _libraryMoved(ownTimes: queried);
      final effects = <StateEffect<Object?>>[
        if (queried && moved) refreshQueries.of(null),
        if (ticketed && moved) refreshTickets.of(null),
        if (framed && moved) refreshCanvasFrames.of(null),
        if (retaped) _tapeSlot.reconfigure(tapeSource.of(tape)),
      ];
      if (effects.isNotEmpty) view.dispatch(TransactionSpec(effects: effects));
    }

    if (SchedulerBinding.instance.schedulerPhase == SchedulerPhase.idle) {
      tell();
    } else {
      SchedulerBinding.instance.addPostFrameCallback((_) => tell());
    }
  }

  /// The calendars' events changed: a note with a query in it draws its queries again, after the frame where one is
  /// being built. A note with none is told nothing.
  void _eventsChanged() {
    void tell() {
      final view = _view;
      if (!mounted || view == null || _world.queryNotes == null || queryFencesOf(view.state.doc).isEmpty) return;
      view.dispatch(TransactionSpec(effects: [refreshQueries.of(null)]));
    }

    if (SchedulerBinding.instance.schedulerPhase == SchedulerPhase.idle) {
      tell();
    } else {
      SchedulerBinding.instance.addPostFrameCallback((_) => tell());
    }
  }

  /// A plugin was switched on or off: the words offered after the note's lines are asked for again, which the
  /// editor otherwise keeps for the words they were read for (lib/editor/items/suggestions.dart). Told after the
  /// frame where one is being built.
  void _pluginsChanged() {
    void tell() {
      if (mounted) _view?.dispatch(TransactionSpec(effects: suggestionsStale.of(null)));
    }

    if (SchedulerBinding.instance.schedulerPhase == SchedulerPhase.idle) {
      tell();
    } else {
      SchedulerBinding.instance.addPostFrameCallback((_) => tell());
    }
  }

  /// The note's recording as the desk last drew it: its length and its phrases, which is all the tape reads of its
  /// note beside what never changes.
  ({int? ms, List<Segment>? segments})? _recording;

  bool _recordingMoved() {
    final note = _world.noteById?.call(widget.noteId);
    final was = _recording;
    _recording = (ms: note?.recordingMs, segments: note?.segments);
    if (was == null) return true;
    return was.ms != note?.recordingMs || !(identical(was.segments, note?.segments) || listEquals(was.segments, note?.segments));
  }

  /// The library as the editor's pieces were last told of it: the notes a query reads, each by its id, its words
  /// and its times; and this note as the library held it then.
  List<QueryNote>? _toldOf;
  Note? _ownTold;

  /// Whether the library differs, in what the open note's editor reads of it, from when its pieces were last told.
  /// The note's own words never count (the editor's own are read in their place), and its own times only where a
  /// query in it reads them ([ownTimes]). A change that left this note as it was is another note's, shown or put
  /// away, and counts.
  bool _libraryMoved({required bool ownTimes}) {
    final read = _world.queryNotes;
    if (read == null) return true;
    final now = read();
    final was = _toldOf;
    _toldOf = now;
    final own = _world.noteById?.call(widget.noteId);
    final ownMoved = _world.noteById != null && !identical(own, _ownTold);
    _ownTold = own;
    if (was == null || !ownMoved) return true;
    if (identical(was, now)) return false;
    final id = widget.noteId;
    var a = 0, b = 0;
    for (;;) {
      if (!ownTimes) {
        while (a < was.length && was[a].id == id) {
          a += 1;
        }
        while (b < now.length && now[b].id == id) {
          b += 1;
        }
      }
      if (a == was.length || b == now.length) return a != was.length || b != now.length;
      final x = was[a], y = now[b];
      if (x.id != y.id || x.updatedAt != y.updatedAt || x.createdAt != y.createdAt) return true;
      if (x.id != id && !identical(x.body, y.body) && x.body != y.body) return true;
      a += 1;
      b += 1;
    }
  }

  /// Pictures put into the open note from the phone's chooser, where there is one (`useNotePictures`).
  late final NotePictures? _pictures = _world.pickPicture == null || widget.readOnly
      ? null
      : (NotePictures(view: () => _view, pick: _world.pickPicture, store: _world.pictures, onPlaced: () => _haptic?.call(HapticKind.light))..addListener(_pictureSaid));
  HapticFn? _haptic;

  /// A picture that did not come in says why, on the note's line; and the line is cleared as the next is chosen.
  void _pictureSaid() {
    if (mounted) _sayOnNote(_pictures?.problem);
  }

  /// The sentence on the note now (`useNotePictures`' `problem`, which is the page's `NoteEditing.say` too): the
  /// note's one place for a sentence about the note, under its header, said once and then out of the way after
  /// six seconds (`SAID_MS`). Why a picture or a film did not come in, and what a plugin has to say.
  final ValueNotifier<String?> _problem = ValueNotifier<String?>(null);
  Timer? _problemGoes;

  void _sayOnNote(String? message) {
    _problemGoes?.cancel();
    _problemGoes = null;
    final words = message == null || message.isEmpty ? null : message;
    if (words != null) _problemGoes = Timer(saidFor, () => _sayOnNote(null));
    _problem.value = words;
  }

  /// The clipboard as the phone's own reader has it, which copies a picture out for the note to adopt.
  static const band.BandClipboard _clipboard = band.PhoneClipboard();

  /// A paste from the keyboard (Ctrl-V) with a picture on the clipboard (editor/images.ts `pasteImages`): the picture
  /// is taken out of the paste, kept, and put in at the caret the way the band's Paste puts one, and words in the
  /// same paste are dropped. True when the paste was a picture's, or one that could not be read, which is said;
  /// false leaves the paste to the editor as words.
  Future<bool> _pastePicture() async {
    final pictures = _pictures;
    if (pictures == null) return false;
    final band.ClipRead read;
    try {
      read = await _clipboard.read();
    } catch (_) {
      return false;
    }
    if (!mounted) return true;
    final path = read.clip.path;
    if (path != null) {
      await pictures.pasteImage(path);
      return true;
    }
    final error = read.clip.error;
    if (error == null) return false;
    widget.say(error);
    return true;
  }

  /// A + may show: a note of words that can be written, with find put away, and no run writing into it
  /// (`ai.runningKind === null || ai.runningKind === 'fill'`). A fill holds no landing bookmark an insert could
  /// cross: its answers go only where its blanks are, so the + stays while one runs.
  bool _plusAllowed() {
    final view = _view;
    if (view == null || view.state.readOnly || _finding != null) return false;
    final running = _ai?.runningKind;
    if (running != null && running != RunKind.fill) return false;
    return _ofWords.of(view.state.doc);
  }

  /// The desk is being let go: what its pieces say as they close is not drawn.
  bool _leaving = false;

  @override
  void dispose() {
    _leaving = true;
    _removed = null;
    _stopFind?.call();
    _links?.dispose();
    _world.holdNote?.call(widget.noteId, false);
    _world.aiReady?.removeListener(_aiArrived);
    _live?.close();
    if (_ai case final ai?) {
      _aiWorld?.opened?.call(widget.noteId, null);
      ai.attach(null);
      ai.removeListener(_aiSaid);
      ai.removeListener(_aiRan);
      ai.dispose();
    }
    _comments.removeListener(_redraw);
    _comments.dispose();
    _problemGoes?.cancel();
    _problem.dispose();
    _wears.dispose();
    _pictures?.removeListener(_pictureSaid);
    _pictures?.dispose();
    // A memo still sounding stops with its note.
    _clips?.stop();
    _clips?.dispose();
    _tape?.removeListener(_redraw);
    _tape?.dispose();
    // Leaving the note takes its toast with it: an Undo for words no longer on screen would undo them unseen.
    if (_saidLanding) _toasts?.dismiss();
    _world.changes?.removeListener(_libraryChanged);
    _world.eventsChanged?.removeListener(_eventsChanged);
    _world.notesSynced?.removeListener(_phrasesMayHaveMoved);
    _unhearRecording?.call();
    plugins.removeListener(_pluginsChanged);
    _bookmark?.dispose();
    _stripRoom.dispose();
    _band.dispose();
    _plus.dispose();
    super.dispose();
  }

  /// The view the editor's host made, or the seams were last handed: what belongs to a view is made again for
  /// another. Taken from the host the moment it has one ([_buildEditor]), before the note's screen is told of it
  /// and builds itself: what the seams read of the view (the tape's memos, a spot to go to, the bookmark) is then
  /// there for that build. It was taken in the middle of that build, after the screen had already asked the
  /// seams, and what they read was put right only because the AI, given the view, told the desk to build again.
  void _adopt(EditorView view) {
    if (identical(view, _view)) return;
    _view = view;
    // A new note takes the focus as it is built, before the desk has its view, and the + asked then is refused
    // (`_plusAllowed`): asked again once the frame is over, so the + stands beside the blank first line from the
    // start, as on the page.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !identical(_view, view)) return;
      _plus.recheck(view);
      // "Add a comment" from the note's menu in a list, asked before the editor was here; and the colours the
      // rounds were first drawn without.
      _comments.takeAsk();
      _comments.recolour();
    });
    // Where the note was opened at (the dashboard's Jump to cursor): a member's caret, which the live note puts the
    // selection at, or their spot on a canvas, which the canvas is centred on.
    final jump = widget.readOnly ? null : _world.takeJump?.call(widget.noteId);
    if (jump != null && jump['x'] is num && jump['y'] is num) {
      _goTo = (x: (jump['x']! as num).toDouble(), y: (jump['y']! as num).toDouble());
      // The canvas is drawn by the desk's seams and was built before there was a view to adopt: built again, it
      // is centred on the spot.
      _redraw();
    }
    // Live in this editor from here on: a note in the Trash is read, not typed in with anyone.
    _live?.close();
    _live = widget.readOnly
        ? null
        : _world.live?.open(view, widget.noteId, jump: jump, onTeam: (team) {
            // Told as the team's binding is made, and as it goes with the note's being taken out of the team; and
            // as the desk itself goes, when there is nothing left to draw.
            if (mounted && !_leaving) setState(() => _team = team);
          });
    // An editor made before the engine was up and handed over after: the AI's extensions are put in it now.
    _aiInto(view);
    _ai?.attach(view);
    _bookmark?.dispose();
    // The line being read is the caret's own where it is on screen, else the one at the top of the page
    // (`caretPlace(view, scroller) ?? placeOf(view, scroller)`): a bookmark marks the words being read.
    _bookmark = NoteBookmark(
      view: view,
      say: widget.say,
      here: () {
        final page = _page;
        if (page == null || !page.hasPixels) return null;
        return (reading.caretPlace(view, page) ?? reading.placeOf(view, page))?.pos;
      },
    )..addListener(_redraw);
  }

  /// The note's page, as its screen last handed it over with the bookmark's asking.
  ScrollPosition? _page;

  /// Drawn again, after the frame where one is being built: the tape tells of its note while the note's screen is
  /// laying its page out (a take added, the recording removed), and the desk is over that build, not under it.
  void _redraw() {
    if (!mounted) return;
    if (SchedulerBinding.instance.schedulerPhase == SchedulerPhase.persistentCallbacks) {
      SchedulerBinding.instance.addPostFrameCallback((_) {
        if (mounted) setState(() {});
      });
      return;
    }
    setState(() {});
  }

  void _openFind(EditorView view, String initial) {
    _band.close();
    _plus.close();
    setState(() => _finding = (initial: initial, nonce: _finds += 1));
    _plus.recheck(view);
  }

  /// The dock's Add (docs/DOCK.md): the +'s list for the caret's line, as a press on the + opens it, placed against
  /// the caret, which is brought into view first. Nothing where the + is not allowed now: find up, a run writing, the
  /// note read only.
  void _openAdd(EditorView view) {
    if (!mounted || _leaving || !_plusAllowed()) return;
    _band.close();
    final head = view.state.selection.main.head;
    view.dispatch(const TransactionSpec(scrollIntoView: true));
    _plus.hooks.onOpen(
      PlusOpening(
        rect: () {
          final at = head < view.state.doc.length ? head : view.state.doc.length;
          final coords = view.coordsAtPos(at);
          if (coords == null) return null;
          return Rect.fromLTWH(coords.left, coords.top, 0, coords.height < 1 ? 1 : coords.height);
        },
        line: view.state.doc.lineAt(head).number,
        by: PlusBy.pointer,
      ),
    );
  }

  void _closeFind() {
    if (_finding == null || !mounted) return;
    setState(() => _finding = null);
    final view = _view;
    if (view != null) _plus.recheck(view);
  }

  Widget _buildEditor(BuildContext context, NoteEditorSpec spec) => NoteEditorHost(
        spec: spec,
        formats: _formats,
        extensions: _extensions,
        onView: _adopt,
        draw: (context, view, env) => Editor(
          view: view,
          controller: _editor,
          env: env,
          meHue: spec.meHue,
          footClear: spec.footClear,
          headerInset: spec.pageHead ?? spec.headClear,
          // The paper under a short note is the screen's own last sliver (lib/note/note_screen.dart), which puts the
          // caret at the end; were the editor to fill the page too, the page's foot would make a short note scroll.
          fill: false,
          // A press held: the note's own menu over the caret, in place of the phone's.
          onHold: (held) => _band.open(band.Held(x: held.x, y: held.y, from: held.from, to: held.to)),
          // A keyboard's paste with a picture on the clipboard: the picture, kept and put in at the caret.
          pastePicture: _pictures == null ? null : _pastePicture,
        ),
      );

  /// A chip of a to-do's field tapped (a day, a priority, a person): the note's band opens at the chip on that
  /// field's page, as the page's menu does (`setFields({ page, line, back: false, refocus })`, `setOpen` at the
  /// chip), with no Back, since nothing led to it.
  void _chipTapped(EditorViewLike view, FieldTap tap) {
    if (!mounted || _leaving) return;
    _plus.close();
    _band.openFields(
      view,
      page: switch (tap.page) {
        DatePage(:final key) => band.FieldDatePage(key),
        PriorityPage() => const band.FieldPriorityPage(),
        PersonPage(:final name) => band.FieldPersonPage(name),
        AssignPage() => const band.FieldAssignPage(),
        RemindPage() => const band.FieldRemindPage(),
        PlacePage() => const band.FieldPlacePage(),
      },
      line: tap.line,
      at: Offset(tap.x, tap.y),
    );
  }

  /// A chip of a person who is a contact tapped: their card, at the chip, with the chip's own Remove. False for a
  /// person who is no contact, whose page the band opens as before.
  bool _personCard(EditorViewLike view, FieldTap tap, String name) {
    if (!mounted || _leaving) return false;
    final contact = phoneContacts.contactOf(name);
    if (contact == null) return false;
    _plus.close();
    showPersonCard(
      context,
      contact: contact,
      name: name,
      at: Rect.fromLTWH(tap.x, tap.y, 0, context.tokens.len('app-body') * 1.35),
      actions: <PersonCardAction>[
        if (!view.state.readOnly) PersonCardAction(icon: Lucide.userMinus, label: 'Remove', name: 'Take ${personShown(name)} off', onPress: () => setLinePerson(view, tap.line, name, false)),
      ],
    );
    return true;
  }

  /// A contact picked from the phone's, as the name a note writes for them (`Sam-Ortiz`); null for none.
  Future<String?> _pickPerson() async {
    if (!mounted) return null;
    final contact = await pickContact(context);
    return contact == null ? null : mentionOf(contact);
  }

  /// The +'s A person: the one picked written where the caret was, and the note has the focus back.
  Future<void> _addPerson(EditorViewLike view) async {
    final name = await _pickPerson();
    if (name == null || !mounted || _leaving) return;
    if (writePerson(view, name)) view.focus();
  }

  /// The page inside the layers that hear it scroll. The same widgets with a view and without, so the page keeps
  /// its place in the tree (and its scroll position) when the editor's view arrives.
  Widget _around(BuildContext context, EditorView? view, Widget page) {
    if (view != null) _adopt(view);
    return FieldMenuHost(
      view: view,
      // The note has its band: a chip's page is the band's, at the chip.
      onTap: _chipTapped,
      child: PlusLayer(
        view: view,
        controller: _plus,
        config: AddConfig(
          titles: _world.titles,
          own: widget.title,
          localOnly: _prefs.value.localOnly,
          effects: plusEffects(),
          // Every canvas among the notes, for the +'s A canvas: a frame of it drawn in the words.
          canvases: _world.bodyOf == null ? null : () => <String>[for (final title in _world.titles()) if (isCanvasBody(_world.bodyOf!(title) ?? '')) title],
          boards: true,
          databases: _world.queryNotes != null,
          tickets: _world.tickets != null,
          // A question for the AI where its answer belongs: writing one needs no model, so the row is always there,
          // and under a table with an empty cell, a blank in every one (editor/addRows.ts).
          blanks: true,
          // Simple mode (GHST-103): the basics first, the rest behind More.
          simple: _prefs.value.simple,
          // Not on an iPhone, where the page's + has no picture (iphone_wiring.dart); the band's Add image stays.
          onPicture: _pictures == null || !plusOffersPicture() ? null : () => unawaited(_pictures.addPhoto()),
          onVideo: _world.films?.pick == null || widget.readOnly || view == null ? null : () => unawaited(_addVideo(view)),
          // Any file, and a document scanned into a PDF (lib/files/), where the device can.
          onFile: FilesKit.current?.picks != true || widget.readOnly || view == null ? null : () => unawaited(_putFile(view, FilesKit.current!.pick)),
          onScan: FilesKit.current?.scans != true || widget.readOnly || view == null ? null : () => unawaited(_putFile(view, () => FilesKit.current!.scan(name: scanName(DateTime.now())))),
          // Someone from the phone's contacts, where Settings › Contacts is on.
          onPerson: !phoneContacts.on || widget.readOnly || view == null ? null : () => unawaited(_addPerson(view)),
          // A row that can never work is not drawn: only where the phone can say where it is at all.
          onPlace: _world.tags != null && _world.tags!.locations.cannotLocateHere == null && view != null ? () => unawaited(_addPlace(view)) : null,
        ),
        child: band.ContextBand(
          view: view,
          controller: _band,
          say: widget.say,
          onFind: view == null ? null : (text) => _openFind(view, text),
          // The same send a swipe on the item does, where a plugin takes this note's items (a Notion board, a GitHub
          // issue).
          send: switch (itemSend(widget.noteId, _editing)) {
            final send? => band.BandSend(label: send.label, run: send.run),
            _ => null,
          },
          // Comment, on the selection the band was opened over or on the caret's line (ContextMenu.tsx).
          onComment: _comments.start,
          formats: bandFormats(),
          fields: bandFields,
          onAddImage: _pictures?.addPhoto,
          // The phone's own reader, which copies a picture out of the clipboard for the note to adopt.
          clipboard: _clipboard,
          onPasteImage: _pictures?.pasteImage,
          boards: true,
          // The note's own scroll is heard here, where the page's editor heard its scroller.
          child: NotificationListener<ScrollUpdateNotification>(onNotification: (scrolled) => _scrolled(view, scrolled), child: page),
        ),
      ),
    );
  }

  /// The note scrolled: an answer's panel, a mark's note and a footnote's words are put away (the page's
  /// `EditorView.domEventHandlers({ scroll })` in fillPanel.ts and textPanel.ts). Only the page's own scroll: a
  /// table or a board moved sideways inside it leaves them.
  bool _scrolled(EditorView? view, ScrollUpdateNotification scrolled) {
    if (view == null || scrolled.depth != 0 || scrolled.scrollDelta == 0) return false;
    _ai?.closePanels();
    final panels = textPanels(view);
    if (panels.value.isNotEmpty) panels.value = const <TextPanel>[];
    return false;
  }

  List<Widget> _over(BuildContext context, EditorView view) {
    _adopt(view);
    final finding = _finding;
    final ai = _ai;
    final t = context.tokens;
    // Where the header ends, as the note's screen counts it: the bar's own tools, or the header's ring under the
    // phone's status bar.
    final inBar = TopBarTools.maybeOf(context) != null;
    final headerEnd = inBar ? t.len('app-safe-top') + t.space(1) + t.space(2) : t.len('app-safe-top') + t.space(1) + t.len('app-bar-ring') + t.space(2);
    return <Widget>[
      // The panels a view shows beside its words (lib/editor/view/text_panel.dart): a result under its line.
      Positioned.fill(child: EditorTextPanels(view: view)),
      // The AI's one layer: the strip under the header and the panel a tap on a blank opens.
      if (ai != null) Positioned.fill(child: NoteAiLayer(ai: ai, top: headerEnd, onRoom: _roomFor, deviceFacts: _aiWorld?.deviceFacts, canUndo: !widget.readOnly)),
      // The comments' sheet, while one is open: drawn over the window, taking no room here.
      ?_comments.sheet(context),
      // `finding !== null && view && shown === 'raw'`: no find bar over the transcript.
      if (finding != null && !_listening)
        Positioned(
          left: 0,
          right: 0,
          bottom: 0,
          // On top of the keyboard: the page does not shorten for it, so the bar is lifted by what it covers. How
          // much that is is asked here, where it is used: asked with the screen's own context, as it was, the
          // note's whole screen was built again at every frame of the keyboard's rise once find had been opened.
          child: Builder(
            builder: (context) => Padding(
              padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
              child: FindBar(key: ValueKey<int>(finding.nonce), view: view, initial: finding.initial, onClose: _closeFind),
            ),
          ),
        ),
    ];
  }

  /// The room the AI's strip takes under the header, as its layer measures it: the page pads itself by it.
  final ValueNotifier<double> _stripRoom = ValueNotifier<double>(0);

  /// Told while the strip is being laid out, so kept after the frame: the page is one of its listeners.
  void _roomFor(double room) {
    if (room == _stripRoom.value) return;
    SchedulerBinding.instance.addPostFrameCallback((_) {
      if (mounted) _stripRoom.value = room;
    });
    SchedulerBinding.instance.ensureVisualUpdate();
  }

  ({bool marked, VoidCallback onPress}) _bookmarkOf(EditorView view, ScrollPosition page) {
    _adopt(view);
    _page = page;
    final mark = _bookmark!;
    return (marked: mark.marked, onPress: mark.press);
  }

  /// The bookmark written in the note, as the place to open at: the top of its line.
  Place? _writtenBookmark(EditorView view) {
    final line = bookmarkLineOf(view.state.doc);
    if (line == null || line > view.state.doc.lines) return null;
    return Place(view.state.doc.line(line).from, 0);
  }

  /// A map's tap: the place in the phone's maps, by its name or its coordinates and never the note's title.
  void _openPlace(place_refs.GeoTag tag) {
    final open = _world.openLink;
    if (open != null) unawaited(openPlace(tag, open, MapsApp.androidGeo));
  }

  /// A place from the + beside the line (`addPlace`): a line of its own where the caret was, a link to a `geo:`
  /// address that draws its map card, apart from the note's own tag above. The place is kept from the tap, the fix
  /// is found (said after a moment), and the name is asked while it is and waited for a few seconds, so the place
  /// and its name land as one write and one Undo. A note left before the fix, or a place let go, writes nothing.
  Future<void> _addPlace(EditorView editor) async {
    final tags = _world.tags;
    if (tags == null) return;
    final toasts = _toasts;
    final haptics = HapticsProvider.of(context);
    final kept = reserveSpot(editor.state);
    editor.dispatch(kept.tr);
    var spot = kept.spot;
    var said = false;
    final slow = Timer(const Duration(milliseconds: 600), () {
      said = true;
      toasts?.toast(message: const Text('Finding where you are.'), duration: const Duration(days: 1));
    });
    void quiet() {
      slow.cancel();
      if (said) toasts?.dismiss();
    }

    bool here() => mounted && identical(_view, editor);
    void letGo() {
      if (here()) editor.dispatch(releaseSpot(editor.state, spot));
    }

    final place_refs.GeoTag tag;
    try {
      tag = tagOf(await tags.locations.locate());
    } catch (failure) {
      quiet();
      letGo();
      if (!mounted) return;
      final why = whyLocateFailed(failure);
      tags.rememberRefusal(why);
      haptics(HapticKind.warning);
      toasts?.toast(
        message: Text(noFix[why]!),
        action: why == LocateFailure.blocked && tags.locations.onPhone ? GlacierToastAction(label: 'Open settings', onPress: () => unawaited(tags.locations.openSettings())) : null,
      );
      return;
    }
    tags.forgetRefusal();
    // Left while the fix was coming, or the place was let go: nothing is asked for and nothing is written.
    if (!here() || spotAt(editor.state, spot) == null) {
      quiet();
      letGo();
      return;
    }
    String? name;
    Future<String?>? late;
    if (tags.locations.canAskPlace) {
      final asked = tags.locations.placeName(tag);
      final waited = await Future.any<Object?>(<Future<Object?>>[asked, Future<Object?>.delayed(placeNameWait, () => #waited)]);
      if (waited == #waited) {
        late = asked;
      } else {
        name = waited as String?;
      }
    }
    if (!here()) {
      quiet();
      return;
    }
    final line = place_refs.placeMarkdown(tag, name);
    final landed = insertLineAt(editor.state, spot, line, userEvent: 'input.plus.drawn', apart: true);
    editor.dispatch(landed.tr);
    letGo();
    final next = reserveSpot(editor.state, landed.lineStart);
    editor.dispatch(next.tr);
    spot = next.spot;
    final depth = undoDepth(editor.state);
    quiet();
    haptics(HapticKind.light);
    if (late == null) return letGo();
    final named = await late;
    if (named != null && here()) {
      final write = nameLater(editor.state, spot, depth, line, place_refs.placeMarkdown(tag, named));
      if (write != null) editor.dispatch(write);
    }
    letGo();
  }

  /// A film from the + beside the line (NoteScreen.tsx `addVideo`): picked with the phone's picker, copied with its
  /// poster and kept, then written as a line of its own where the caret was, its poster linked to it, which draws
  /// its card. The place is kept from the tap, since the picker leaves the app and a long film takes a while to
  /// copy; "Adding the video." says so a moment after the copy starts, and not while the picker is still up. A
  /// film copied for a note that was left, or whose place went, is thrown away rather than kept for nothing.
  Future<void> _addVideo(EditorView editor) async {
    final films = _world.films;
    final pick = films?.pick;
    if (pick == null) return;
    final toasts = _toasts;
    final haptics = HapticsProvider.of(context);
    final kept = reserveSpot(editor.state);
    editor.dispatch(kept.tr);
    final spot = kept.spot;
    var said = false;
    Timer? slow;
    void copying() {
      slow?.cancel();
      slow = Timer(const Duration(milliseconds: 600), () {
        said = true;
        toasts?.toast(message: const Text('Adding the video.'), duration: const Duration(days: 1));
      });
    }

    void quiet() {
      slow?.cancel();
      if (said) toasts?.dismiss();
    }

    bool wanted() => mounted && identical(_view, editor) && spotAt(editor.state, spot) != null;
    try {
      final film = await pick(keep: wanted, copying: copying);
      quiet();
      if (film == null || !wanted()) return;
      filmAdded(film.poster, film.width, film.height);
      final landed = insertLineAt(editor.state, spot, videoMarkdown(film.poster, film.video, film.ms), userEvent: 'input.plus.drawn', apart: true);
      editor.dispatch(landed.tr);
      haptics(HapticKind.light);
    } catch (failure) {
      quiet();
      if (!mounted) return;
      haptics(HapticKind.warning);
      _sayOnNote(failureWords(failure));
    } finally {
      if (mounted && identical(_view, editor)) editor.dispatch(releaseSpot(editor.state, spot));
    }
  }

  /// A file the + brought in, written where the caret was (lib/files/plus_files.dart).
  Future<void> _putFile(EditorView editor, Future<KeptAttachment?> Function() get) {
    final haptics = HapticsProvider.of(context);
    return putFileIn(editor, get, still: () => mounted && identical(_view, editor), say: (message) {
      haptics(HapticKind.warning);
      _sayOnNote(message);
    }, landed: () => haptics(HapticKind.light));
  }

  /// The map at the top of a tagged note (editor/MapCard.tsx as NoteScreen.tsx draws it).
  Widget _mapCard(BuildContext context, GeoTag tag, {required bool header, required bool quiet, required bool arrive, required bool leave, VoidCallback? onLeft}) {
    final prefs = _prefs.value;
    final tiles = !prefs.localOnly && prefs.mapTiles;
    return MapCard(
      tag: place_refs.GeoTag(lat: tag.lat, lon: tag.lon, place: tag.place, rough: tag.rough),
      size: header ? MapSize.header : MapSize.card,
      mode: tiles && !quiet ? MapCardMode.map : MapCardMode.quiet,
      quietWhy: prefs.localOnly ? QuietWhy.localOnly : (!prefs.mapTiles ? QuietWhy.off : null),
      arrive: arrive,
      leave: leave,
      onLeft: onLeft,
      onOpen: _openPlace,
      tiles: _world.mapTiles,
    );
  }

  void _openWithin(String title) => (_world.openWithin ?? _world.open)(title);

  /// A page's ticket status picked in its notebook's index, written into that page through the queries' writer
  /// (lib/core/query/move.dart), which reads the library again after.
  void _setStatus(String page, String? status) {
    final key = titleKey(page);
    for (final note in _world.queryNotes?.call() ?? const <QueryNote>[]) {
      if (titleKey(noteTitle(note.body)) != key) continue;
      _world.write?.call(note.id, (body) => movedBody(body, -1, '', RecordKind.ticket, 'status', status));
      return;
    }
  }

  /// A notebook's index (book/BookView.tsx), in place of its Markdown.
  Widget _book(BuildContext context, String body, ValueChanged<String> onChange) => BookView(
        body: body,
        title: noteTitle(body),
        known: _world.known,
        open: _openWithin,
        openCanvas: widget.readOnly ? null : _world.openCanvas,
        openNew: widget.readOnly ? null : _world.openPage,
        openTicket: widget.readOnly || _world.openTicket == null ? null : (title, template) => _world.openTicket!(title, body, template),
        ticketTemplates: _world.ticketTemplates?.call() ?? const <NoteTemplate>[],
        titles: _world.pageTitles ?? _world.titles,
        bodyOf: _world.bodyOf,
        spot: widget.noteId,
        setStatus: widget.readOnly || _world.write == null ? null : _setStatus,
        readOnly: widget.readOnly,
        onChange: onChange,
        drawing: _bookDrawing,
      );

  /// A journal's entries by month (book/JournalView.tsx).
  Widget _journal(BuildContext context, String body, ValueChanged<String> onChange) => JournalView(
        body: body,
        noteOf: (title) => _world.noteOf?.call(title),
        known: _world.known,
        open: _openWithin,
        onNewEntry: widget.readOnly || _world.newEntry == null ? null : (template) => _world.newEntry!(widget.noteId, template),
        onChange: onChange,
        drawing: _bookDrawing,
      );

  @override
  Widget build(BuildContext context) {
    final services = _world.services;
    final ai = _ai;
    _aiDrawn = (ai?.runningKind, ai?.canSummarize ?? false);
    // The tape first, so a note opened at its transcript has it on the page from its first frame.
    final taped = _tapeNow();
    if (_reading && !widget.playTape && !_audioLooked && taped != null && taped.length > 0) {
      _audioLooked = true;
      // Read without Play: the strip says now where the audio is not on this device, not at a Play that fails.
      SchedulerBinding.instance.addPostFrameCallback((_) {
        if (mounted) unawaited(taped.sayWhereAudioIs());
      });
    }
    final seams = NoteSeams(
      links: _links?.seam,
      saving: (flush) => _flush = flush,
      // A note that wears its tape is talked into from the tape's Add: its own mic steps out.
      hasTape: () => (_tapeNow()?.length ?? 0) > 0 && _world.onSpeak != null,
      beforeSpeak: _beforeSpeak,
      sync: _world.syncWithin,
      // The phone's write-up changed this note: its screen reads it again.
      recordingChanged: _world.onRecordingChanged == null
          ? null
          : (changed) => _world.onRecordingChanged!((id) {
                if (id == widget.noteId) changed();
              }),
      // The More sheet's AI rows: a run of that kind on this note.
      // On an iPhone, which has no AI, the rows are drawn all the same and a press says so (iphone_wiring.dart).
      onAi: ai == null || widget.readOnly ? (widget.readOnly ? null : iPhoneAiRows((message) => _toasts?.toast(message: Text(message)))) : (view, kind, [instruction]) {
              final run = RunKind.of(kind);
              if (run != null) ai.runAi(run, instruction);
            },
      // The run that is on wears a dot on its row.
      aiRunning: ai == null ? null : () => ai.runningKind?.id,
      onFind: _openFind,
      // The dock's Add: the +'s list for the caret's line.
      onAdd: _openAdd,
      // Simple mode's Format bar puts a picture in from its tail, as the band's Add image does (GHST-105).
      onAddImage: _pictures?.addPhoto,
      // Comment in the bar and in More, and More's "3 comments, 1 open" with their list.
      onComment: (view) => _comments.start(),
      commentsSummary: _comments.summary,
      onCommentsList: _comments.openList,
      // The More sheet's "Linked to": each plugin's link and its page, and each action, run through this editor.
      plugins: (view) {
        _adopt(view);
        return NotePlugins(links: plugins.noteLinks(), actions: plugins.noteActions(), editing: _editing);
      },
      bookmark: _bookmarkOf,
      writtenBookmark: _writtenBookmark,
      cheatSheet: (context) => const CheatSheet(),
      shareVersionsFile: _world.shareVersionsFile,
      // The bar's Share and the More sheet's Sharing are there signed in or out, as on the page (NoteScreen.tsx
      // `actions`, NoteSettings): without an account, or in a build with no service, the row says to sign in first.
      onShare: () => setState(() => _sharing = true),
      sharingSection: (context) => ShareRows(services: services, noteId: widget.noteId, kind: _shareKind),
      // A page's notebook, its place in it and the pages either side, over and under its words.
      bookBar: (context, place) => BookBar(place: place, open: _openWithin),
      bookFoot: (context, place) => BookFoot(place: place, open: _openWithin),
      // A change to the canvas is a change to the note: written into the body as the spec's JSON, and saved the way
      // typing is.
      canvas: (context, body, onChange) {
        Widget view(BuildContext context, String body, ValueChanged<String>? onChange, [CanvasCamera? camera, TeamCanvasPeople? people]) {
          final readOnly = widget.readOnly || onChange == null;
          Widget drawn(CanvasThreads? threads, String Function(String handle)? hue) => canvasSeam(
                wiki: CanvasWiki(known: _world.known, open: _world.open, body: _world.bodyOf, titles: _world.titles),
                pictures: _world.pictures,
                pickPicture: widget.readOnly ? null : _world.pickPicture,
                openLink: _world.openLink,
                threads: threads,
                threadHue: hue,
                readOnly: readOnly,
                camera: camera,
                // Jump to cursor from an organization's dashboard: a member's spot on the canvas.
                goTo: _goTo,
                onEditing: people?.onEditing,
                editedBy: people?.editedBy,
                team: people != null,
              )(context, body, onChange ?? (_) {});
          // A canvas that cannot change draws no rounds and has no Comment; one that can has its threads in the
          // note's own sheet, each round in its author's colour (canvas/useCanvasComments.tsx).
          if (readOnly) return drawn(null, null);
          return CanvasComments(body: body, colours: () => _wears.now, account: _world.services?.account, builder: (context, threads, hue) => drawn(threads, hue));
        }

        // A team's canvas is its structure in the team's document, drawn and edited through it, with the other
        // members' pointers over its cards (lib/live/team_canvas.dart); any other is the note's own, whole.
        final team = widget.readOnly ? null : _team;
        return team == null ? view(context, body, onChange) : TeamCanvasHost(key: ObjectKey(team.doc), team: team, body: body, onChange: onChange, draw: view);
      },
      // Its header banner (lib/note/note_banner.dart), or Lovart at work on one while it is made.
      banner: (context, noteId, name) => ValueListenableBuilder<Set<String>>(
        valueListenable: lovartBannerMaking,
        builder: (context, making, _) => NoteBannerView(
          name: name,
          store: _world.pictures,
          making: making.contains(noteId),
          prompt: noteId,
        ),
      ),
      // What the note is linked to, at its top; pressed, the note's More sheet, where a link is changed.
      head: (context, openSettings) {
        final tape = _tapeNow();
        final speak = _world.onSpeak;
        if (widget.playTape && !_tapePlayed && tape != null && tape.length > 0) {
          _tapePlayed = true;
          // After the frame: the tape is drawn first, and a press of Play is what starts it.
          SchedulerBinding.instance.addPostFrameCallback((_) {
            if (mounted && !tape.playing) unawaited(tape.toggle());
          });
        }
        return <Widget>[
          // Only a spoken note has a tape.
          if (tape != null && tape.length > 0)
            // The tape hears the queues itself, and is the one thing drawn again when they speak.
            ListenableBuilder(
              listenable: _queues(),
              builder: (context, _) => NoteTape(
                note: tape.note,
                title: widget.title.isEmpty ? 'Untitled' : widget.title,
                tape: tape,
                onSpeak: speak == null || widget.readOnly
                    ? null
                    : () {
                        _beforeSpeak();
                        speak(widget.noteId);
                      },
                onRemove: () => unawaited(_removeRecording()),
                hasMemos: hasClips(_view?.state.doc.toString() ?? ''),
                queue: _tapeQueue(),
                // A meeting's, or one opened at its transcript: Transcript and Note, while the tape is still.
                onTranscript: _meeting || _reading ? _toggleTranscript : null,
                transcriptShown: _reading,
                // The recording's summary: queued from here, and landed in this editor as a run. Only where the AI
                // can run.
                summary: (_ai?.canSummarize ?? false) && _aiWorld?.summarize != null
                    ? TapeSummary(
                        ask: (replace) {
                          _flush?.call();
                          _aiWorld!.summarize!(widget.noteId, replace);
                        },
                        edited: () => _aiWorld?.summaryEdited?.call(widget.noteId, _view?.state.doc.toString() ?? '') ?? false,
                        // A take added since the summary was written: "Summary is from before the last take."
                        behind: summaryBehind(widget.noteId, tape.length),
                      )
                    : null,
              ),
            ),
          LinkMarks(noteId: widget.noteId, onPress: openSettings),
        ];
      },
      // Playing takes the screen for the transcript; the note waits under it (NoteScreen.tsx `shown`). So does a
      // meeting opened at it, with its tape still; and while its write-up is to come, the place says how far it is.
      transcript: _listening
          ? (context) => ListenableBuilder(
                listenable: _queues(),
                builder: (context, _) => TranscriptWords(tape: _tape!, writeUp: _writeUpLine(_tape!.note)),
              )
          : null,
      mapCard: _world.tags != null ? _mapCard : null,
      book: _book,
      journal: _journal,
      around: _around,
      over: _over,
      headRoom: _ai == null ? null : _stripRoom,
      problem: _problem,
    );
    final built = widget.builder(context, _buildEditor, seams);
    // The note's share link, from the bar's Share: the More sheet's rows in a window of their own (NoteScreen.tsx
    // `sharing`). The sheet draws in the app's overlay and takes no room here.
    return Stack(
      fit: StackFit.passthrough,
      children: [
        built,
        if (_sharing) ShareSheet(services: services, noteId: widget.noteId, title: widget.title, kind: _shareKind, onClose: () => setState(() => _sharing = false)),
        if (_placeAsk case final ask?)
          PlaceSheet(
            key: ValueKey<Object>(ask),
            body: _view?.state.doc.toString() ?? '',
            current: ask.current,
            localOnly: _prefs.value.localOnly,
            search: _prefs.value.localOnly ? null : _world.placeSearch,
            here: _here(),
            hereWhy: _prefs.value.localOnly ? 'Off while Local only is on.' : null,
            onDone: (mark) {
              setState(() => _placeAsk = null);
              if (!ask.done.isCompleted) ask.done.complete(mark);
            },
          ),
        if (_allowAsk case final ask?)
          PlaceAllowSheet(
            key: ValueKey<Object>(ask),
            place: ask.place,
            onDone: (go) {
              setState(() => _allowAsk = null);
              if (!ask.done.isCompleted) ask.done.complete(go);
            },
          ),
      ],
    );
  }

  /// Remind me at a place's sheet, while it is up: the line's place, and who waits for the one picked.
  ({PlaceMark? current, Completer<PlaceMark?> done})? _placeAsk;

  /// The sheet before Android's "Allow all the time", while it is up.
  ({String? place, Completer<bool> done})? _allowAsk;

  /// The sheet for a line's place; the place picked, or null. The first place reminder made on this phone asks it
  /// for the location it needs, saying why first (lib/reminders/place_access.dart); after that the plugin's page
  /// offers the way (lib/plugins/places).
  Future<PlaceMark?> _askPlace(int line, PlaceMark? current) async {
    if (!mounted || _leaving) return null;
    if (_placeAsk case final open? when !open.done.isCompleted) open.done.complete(null);
    final done = Completer<PlaceMark?>();
    setState(() => _placeAsk = (current: current, done: done));
    final mark = await done.future;
    if (mark != null && placeSettings.firstMade()) {
      final host = phonePlaces.value;
      if (host != null) unawaited(PlaceAccessFlow(host: host, explain: () => _explainAllow(mark.name)).run());
    }
    return mark;
  }

  /// The app's own words before Android's "Allow all the time": true for Continue.
  Future<bool> _explainAllow(String? place) {
    if (!mounted || _leaving) return Future<bool>.value(false);
    if (_allowAsk case final open? when !open.done.isCompleted) open.done.complete(false);
    final done = Completer<bool>();
    setState(() => _allowAsk = (place: place, done: done));
    return done.future;
  }

  /// Where the phone is now as a place, its name where one may be asked: null where this device cannot say or Local
  /// only is on.
  HerePlace? _here() {
    final tags = _world.tags;
    if (tags == null || tags.locations.cannotLocate != null) return null;
    return () async {
      final tag = tagOf(await tags.locations.locate());
      String? name;
      if (tags.locations.canAskPlace) name = await tags.locations.placeName(tag).timeout(placeNameWait, onTimeout: () => null);
      return PlaceMark(tag.named(name));
    };
  }

  /// The bar's Share was pressed, and its sheet is up.
  bool _sharing = false;

  /// `isJournal ? 'journal' : isBook ? 'notebook' : 'note'`.
  ShareKind get _shareKind {
    final doc = _view?.state.doc.toString() ?? '';
    return isJournalBody(doc) ? ShareKind.journal : (isBookBody(doc) ? ShareKind.notebook : ShareKind.note);
  }
}
