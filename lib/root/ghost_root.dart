import 'dart:async';

import 'package:flutter/foundation.dart' show TargetPlatform, ValueListenable, defaultTargetPlatform, listEquals, setEquals, kIsWeb;
import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter/widgets.dart';
import 'package:glacier/glacier.dart';

import '../account/crypto.dart' show CoreCrypto;
import '../account/ui_state.dart';
import '../aside/aside.dart';
import '../aside/aside_history.dart';
import '../aside/aside_panel.dart';
import '../ai/available.dart' show AvailabilityController, modelFor, presentIds;
import '../ai/backend.dart' as engine show aiBackend, readDevice;
import '../ai/fills/queue.dart' show resumeParked, startFills;
import '../ai/meeting_sort.dart' show MeetingSorter, askMeetingSort, sortTitlesEach;
import '../ai/note_ai.dart' show NoteAi;
import '../ai/note_review.dart' show ReviewHost;
import '../ai/start.dart' as ai_start;
import '../ai/summaries.dart' show SummaryKind;
import '../ai/summary_keep.dart' show keptText, summaryUnchanged;
import '../ai/summary_text.dart' show summarySection;
import '../ai/support/runnable.dart' show cannotRun;
import '../art/art.dart';
import '../book/book_spot.dart' show whereLeft;
import '../calendar/calendar.dart' show calendar;
import '../book/chapter_number.dart' show chapterOf;
import '../book/entry_starts.dart' show pageBody;
import '../book/journal.dart' as journal;
import '../book/template_picker.dart' show EntryPlaceDevice;
import '../core/geocode.dart' show PlaceSearch;
import '../core/location.dart' show Locations, Locator, PlaceLookup;
import '../core/films.dart' show Films;
import '../core/phone_pictures.dart' show corePictureAdopter;
import '../core/place_tags.dart';
import '../editor/ai/blanks.dart' show openNoteBlanks;
import '../editor/editor.dart' as ed show Change, EditorViewLike, TransactionSpec;
import '../editor/items/field_menu.dart' show DayPicker;
import '../guide/guide_models.dart' show GuideModels, PhoneGuideModels;
import '../editor/media/clip_refs.dart' show TapeIds;
import '../editor/media/map_card.dart' show MapTilesBuilder;
import '../editor/media/rich_embeds/oembed.dart' show KeptEmbeds, OEmbedFetch, PictureFetch;
import '../book/journal_view.dart' show JournalPages;
import '../book/new_book_sheet.dart';
import '../book/tickets.dart';
import '../academy/academy_screen.dart';
import '../academy/banner.dart';
import '../canvas/how_canvas.dart' show howCanvasBody;
import '../canvas/json_canvas.dart' show Canvas, canvasNoteBody;
import '../canvas/sample_canvas.dart' show sampleCanvasBody;
import '../capture/meeting_live.dart' show MeetingLive;
import '../capture/place.dart' show Placing;
import '../capture/recorder.dart' show LibraryRecorderStore, SpokenAsk;
import '../capture/ui/capture_screen.dart';
import '../capture/ui/meeting_screen.dart';
import '../capture/voice_model.dart';
import '../commands/app_commands.dart';
import '../commands/command_bar.dart';
import '../comments/ask.dart';
import '../core/aliases.dart' show aliasesOfNote;
import '../core/backup.dart' show Backups;
import '../core/book.dart';
import '../core/canvas_body.dart';
import '../core/command_mutations.dart' show PendingCommandUndo;
import '../core/core_library.dart';
import '../core/export_all.dart' show ExportAll;
import '../export/ghostex_calls.dart';
import '../importer/importer.dart' show Importer;
import '../integrations/contacts/contacts.dart' show phoneContacts;
import '../integrations/webhooks/outgoing.dart' show webhooks;
import '../core/front_matter.dart' show frontMatterOffset;
import '../core/ids.dart' show randomId;
import '../core/images.dart';
import '../core/iphone_app.dart';
import '../core/kept_trash.dart';
import '../core/mac_app.dart' show runsAsMacApp;
import '../core/library_files.dart' show LibraryFiles;
import '../core/link_index.dart' show LinkIndexer, LinkPlace, Mention;
import '../core/library_folder.dart' show LibraryFolder;
import '../core/link_preview.dart' show KeptLinkPreviews, LinkOpener, LinkPreviewFetch;
import '../core/kept_workspaces.dart';
import '../core/native/core.dart';
import '../core/native/files.dart';
import '../core/native/ghost_core.dart' show GhostCore;
import '../core/native/device_paths.dart' show DevicePaths;
import '../core/shared_files.dart' show storeSharedFile;
import '../files/plus_files.dart' show scanToNewNote;
import '../core/note.dart';
import '../core/note_facts.dart' show NoteFacts;
import '../core/note_folders.dart';
import '../core/note_text.dart';
import '../core/search.dart' show searchNotes, searchWords;
import '../core/phone_connection.dart' show Connection;
import '../core/preferences.dart';
import '../core/properties.dart';
import '../core/query/query.dart' show TicketDraft;
import '../core/reset.dart' show resetLocalData;
import '../core/sample_library.dart';
import '../core/stored.dart';
import '../core/swipe.dart' show NoteSwipe;
import '../core/template.dart' show openEnd;
import '../core/trash.dart';
import '../core/untouched.dart';
import '../core/updates.dart';
import '../core/versions_record.dart';
import '../core/versions_share.dart';
import '../core/versions_store.dart';
import '../core/workspaces.dart';
import '../diag/built_report.dart';
import '../diag/scene_bench.dart' show showSceneBench;
import '../editor/queries/queries.dart' show NoteChange;
import '../format/device_facts.dart' show DeviceFactsController;
import '../format/gist.dart' show gistVisible, gistsCameBack, holdGistsFor, pauseGists, wakeGistsOn;
import '../guide/guide.dart';
import '../guide/guide_state.dart';
import '../guide/guidebook.dart';
import '../home/home_layout.dart';
import '../home/home_icons.dart' show HomeGlyph;
import '../home/home_screen.dart';
import '../home/note_peek.dart' show PeekPictures;
import '../launch/launch_screen.dart';
import '../links/graph_view.dart' show showGraph;
import '../links/links_panel.dart' show linkMention, unlinkMention;
import '../links/note_links.dart';
import '../note/land_at.dart' show atTape, atTranscript, opensAtTranscript;
import '../note/note_builder.dart';
import '../note/open_screen.dart';
import '../note/note_screen.dart' show withFrontMatterTitle;
import '../notes/all_notes_screen.dart';
import '../notes/collection_screen.dart';
import '../notes/folder_menu.dart';
import '../notes/new_sheet.dart';
import '../notes/note_actions.dart';
import '../notes/note_menu.dart';
import '../notes/note_templates.dart';
import '../notes/own_templates.dart' hide templateOf;
import '../notes/notes_drawer.dart';
import '../notes/notices.dart' as notices;
import '../notes/notifications_drawer.dart';
import '../notes/trash_sheet.dart';
import '../notes/workspace_sheet.dart';
import '../orgs/join_links.dart' show readJoinLink;
import '../orgs/ui/fed_notifications.dart';
import '../orgs/ui/join_sheet.dart';
import '../orgs/ui/new_organization_sheet.dart';
import '../orgs/ui/org_news.dart';
import '../home/home_organizations.dart' show OrgPresence;
import '../claude/claude_chat.dart';
import '../claude/claude_books.dart' show ClaudeBookProblem, ClaudeBooks, ClaudeShelf;
import '../claude/claude_folders.dart' show ClaudeFolders;
import '../claude/claude_bar.dart';
import '../claude/claude_dock.dart';
import '../claude/claude_ear.dart' show recorderEar;
import '../claude/claude_inbox.dart';
import '../claude/claude_run.dart' show ClaudeDesk;
import '../claude/claude_runner.dart';
import '../claude/claude_settings.dart' show claudeSettings;
import '../claude/claude_tools.dart' show ClaudeNotes, NoteBrief, NoteHit, NoteRead;
import '../claude/claude_voice.dart' show ClaudeVoice, ClaudeVoiceStage;
import '../claude/claude_voice_sheet.dart';
import '../live/follow.dart';
import '../live/presence.dart' show AiOnline, Seen, aiKey;
import '../orgs/types.dart' show OrgRow;
import '../orgs/ui/organization_log.dart';
import '../orgs/ui/organization_screen.dart';
import '../perf/frame_log.dart';
import '../plugins/calendar/calendar.dart' show calendarInUse, calendarManifest, calendarOn;
import '../plugins/claude/claude.dart' show claudeHandle, claudeInApp;
import '../plugins/contacts/contacts.dart' show contactsSwitch;
import '../plugins/discord/discord.dart' show MeetingDiscordPoster, discordCanShare, discordShareLink, meetingDiscordPoster;
import '../ai/summary_handoff.dart' show thisDevice;
import '../core/background_jobs.dart' show ChannelBackgroundJobs;
import '../note/note_banner.dart' show BannerLook, bannerLook;
import '../plugins/lovart/lovart.dart' show BannerClaims, BannerJob, BannerRun, LovartBanners, LovartHold, LovartMeetings, bannerRunEndWords, bannerRunLine, bannerToRedo, lovartBannerJob, lovartBannerRun, lovartPictureStore, stopBannerRun;
import '../plugins/registry.dart' show Registry, plugins;
import '../plugins/slack/meetings.dart' show MeetingSlackPoster, meetingSlackPoster;
import '../market/market_items.dart' show marketLanding;
import '../market/market_screen.dart';
import '../settings/panes/plugins_pane.dart' show pluginPageId;
import '../settings/organization_sheet.dart';
import '../settings/settings_screen.dart';
import '../scene/at_work.dart';
import '../settings/settings_sheet.dart';
import '../settings/tapes.dart' show oldTapes, tapeBytes;
import '../settings/tapes_here.dart';
import '../share/app_links.dart';
import '../share/share_in.dart';
import '../share/share_in_keep.dart';
import '../share/ui/share_in_sheet.dart';
import '../home_screen/home_host.dart' show PhoneHomeScreenHost;
import '../home_screen/phone_entries.dart';
import '../home_screen/raise_keyboard.dart' show raiseKeyboardSoon;
import '../plugins/places/places.dart' show placeRemindersId;
import '../reminders/place_host.dart' show PhonePlaceHost;
import '../reminders/reminder_host.dart' show PhoneReminderHost;
import '../reminders/tick_item.dart' show findItemNear;
import '../shell/account_gate.dart';
import '../shell/ai_chip.dart';
import '../shell/app_shell.dart';
import '../shell/page_dock.dart';
import '../shell/screen.dart';
import '../shell/top_bar.dart';
import '../shell/wide_screen.dart' show mobileDevice, mousePointer, splitFits;
import '../simple/simple_home.dart';
import '../simple/simple_todos.dart';
import '../core/query/tick.dart' show tickedBody;
import '../simple/simple_pane.dart';
import '../tapes/player.dart' show TapePlayer;
import '../tapes/previews.dart' show TapePreviews;
import '../watch/watch_link.dart' show WatchTake;
import '../watch/watch_claude.dart' show RunnerWatchClaude, watchRunOutcome;
import '../watch/watch_notes.dart' show WatchAskFailed, WatchAsked, WatchClaude;
import 'account_wiring.dart';
import 'capture_route.dart';
import 'desktop_wiring.dart';
import 'library_reads.dart';
import 'note_desk.dart';
import 'note_keeping.dart';
import 'opening.dart';
import 'organize.dart';
import 'phone_extras.dart';
import 'reset_wiring.dart';
import 'scene_play.dart';
import 'selected.dart';
import 'take_back.dart';
import 'iphone_wiring.dart';
import 'update_wiring.dart';
import 'voice_wiring.dart';

part 'root_claude.dart';
part 'root_commands.dart';
part 'root_parts.dart';
part 'root_voice.dart';

/// The app, put together: what the web app's `App.tsx` does once its screens exist. The launch screen over the
/// shell (lib/shell/app_shell.dart); in the shell the home page, the notes' sidebar as a card or docked, and the
/// notifications; over it Settings and a workspace's sheet; and the art in the seams each of them left for it.
///
/// What it stands on:
/// - **The library** is the Rust core's ([core], lib/core/core_library.dart): the notes are Markdown files in the app's
///   own folder, as the Tauri app keeps them; the workspaces and the trash are preferences; a fresh library is given
///   the starter notes once. Without a core (a test, a picture) it is the store screenshots' invented library in memory.
/// - **A note's own screen** is lib/note's, over the editor (lib/editor) with every piece of it, put together for
///   each open note by lib/root/note_desk.dart: its boards, queries and tickets, and the canvas, the notebook's index
///   and the journal's entries that take the page for a note that is not words. What those read of the library is
///   lib/root/library_reads.dart; what they ask of the app (a title opened in a notebook's tab, a page, a ticket or
///   a canvas made from an index, a journal's new entry, another note written from a query) is here, as it is in
///   App.tsx.
/// - **The +** opens the sheet of what it makes (lib/notes/new_sheet.dart): a note, opened ready to type on a blank
///   page that offers names and templates, a canvas, a notebook or a journal (lib/book/new_book_sheet.dart), or an
///   entry in the journal written in last.
/// - **The account** is made only where the build was told its service ([account], lib/root/account_wiring.dart):
///   then the shell, Settings and a note's sharing are under one [AccountScope], the organizations have their
///   pages, the notifications are the feed's, and the way in is the first thing on screen once. With none there
///   is no account object anywhere, and every screen is the signed-out one.
/// - **A link that opened the app** ([GhostRoot.links], lib/share/app_links.dart) is followed once the notes are
///   read, as `shell/useAppLinks.ts` does: a note opened where it was left, the notifications, an organization's
///   dashboard, an invitation asked about before anything is joined, and a shared link's copy saved and opened. And
///   an address tapped in a note is handed to the phone ([GhostRoot.openLink]).
/// - **Speak** ([GhostRoot.voiceMaking], lib/root/voice_wiring.dart) is the recorder over the core's Whisper and the
///   phone's microphone, and the phone's meeting service: the dock's microphone, the sidebar's, the palette's and a
///   note's own open the capture screen, the + sheet's Meeting and the card's "Meeting instead" start the service
///   with the meeting screen over it, and where each begins and ends is lib/root/capture_route.dart
///   (`shell/useCaptureRoute.ts`). Settings' Recording and AI pages have their real rows. No always-on microphone:
///   one is opened by a recorder's screen that is on screen. Without a core (a test, a picture) there is no voice
///   unless one is given ([GhostRoot.voice]).
class GhostRoot extends StatefulWidget {
  const GhostRoot({super.key, this.sheet, this.core, this.library, this.workspaces, this.stored, this.clock, this.launch = true, this.launchSeat, this.account, this.services, this.untouched, this.links, this.openLink, this.voice, this.voiceMaking, this.previewFetch, this.embedFetch, this.embedPictures, this.native, this.restart, this.guide, this.tapePlayer, this.clipPlayer, this.tapePreviews, this.updates, this.locator, this.placeLookup, this.placeSearch, this.mapTiles, this.picturePicker, this.films, this.dayPicker, this.connection, this.presence, this.follow, this.voiceLater, this.voiceWhen, this.testReport, this.shares});

  /// The app's token sheet, which the shell stamps its layout over: the theme's own unless given.
  final TokenSheet? sheet;

  /// The Rust core (lib/core/native): given, the notes are the real library's files, and the workspaces and the
  /// trash are kept in the preferences as on the web. Absent, everything is in memory over the invented library.
  final CoreInvoke? core;

  /// The notes, where a test brings its own.
  final NoteLibrary? library;
  final WorkspaceStore? workspaces;

  /// Where this device keeps how its sidebar was left; the app's own (core/stored.dart) unless given.
  final Stored? stored;

  /// The time, for a picture that must say the same "2 hr ago" every day.
  final int Function()? clock;

  /// Whether the app opens behind its launch screen. A test's picture of a screen does not.
  final bool launch;

  /// Where the root says what the launch screen reads of it, when that screen is drawn over the root by whoever
  /// holds it and was up before there was a root (lib/root/opening.dart). Given, the root draws none of its own.
  final LaunchSeat? launchSeat;

  /// Where this build's account service is, with the crypto to reach it (lib/root/account_wiring.dart). Absent,
  /// as in every build not given `GHOST_API`, there is no account at all. It needs the [core].
  final AccountMaking? account;

  /// The account's objects, where a test brings its own; then nothing is made from [account].
  final AccountServices? services;

  /// Where the links that opened the app come from: the phone's (lib/core/phone_links.dart) in the app. Absent, no
  /// link is followed.
  final LinkSource? links;

  /// Hands an address to the phone (lib/core/open_link.dart): a link's tap in a note, Settings' pages. Absent, a tap
  /// opens nothing.
  final LinkOpener? openLink;

  /// What other apps share into this one (lib/share/share_in.dart): the phone's on Android. Absent, nothing is.
  final ShareSource? shares;

  /// The whole core, for what is a job there and says the rest as events: Settings' Library folder, Backup and
  /// Export (lib/core/library_folder.dart, backup.dart, export_all.dart). Absent, as in a test, those pages say
  /// what a build without them says.
  final GhostCore? native;

  /// Builds the whole app anew, after a reset (`window.location.reload()`): whoever holds this root gives it. Absent,
  /// Developer's two resets cannot be pressed.
  final VoidCallback? restart;

  /// The welcome walkthrough's place in the app (lib/guide/guide_state.dart). The app over a core makes its own,
  /// which opens by itself on a first launch; a test brings one, or has none and is never walked through.
  final GuideController? guide;

  /// The app's one player of a note's recording (lib/tapes/phone_player.dart on a phone). Absent, a spoken note
  /// draws no tape.
  final TapePlayer? tapePlayer;

  /// The player of the voice memos left in a note: one of their own beside the tape's, as the page made an
  /// `<audio>` for a memo (lib/tapes/phone_player.dart `PhoneTapePlayer.clips`). Absent, a memo is a quiet mark.
  final TapePlayer? clipPlayer;

  /// The players the home page's shelf loads the cassettes in view into ahead, on the Mac (lib/tapes/previews.dart
  /// `TapePreviews.mac`), so a resting mouse only presses Play. Absent, every hover loads on [clipPlayer].
  final TapePreviews? tapePreviews;

  /// Where the phone is (lib/core/phone_position.dart on a phone), what names a place (lib/core/geocode.dart) and
  /// what draws a map's tiles (lib/editor/media/map_tiles.dart). With no [locator], as in a test, no note keeps a
  /// place: nothing is asked of anywhere, and a note draws only the tag its words carry.
  final Locator? locator;
  final PlaceLookup? placeLookup;
  final MapTilesBuilder? mapTiles;

  /// A place by its name, for Remind me at a place (lib/core/geocode.dart `geocodeSearch`); absent, as in a test,
  /// the sheet has no search.
  final PlaceSearch? placeSearch;

  /// The phone's picture chooser, given what keeps a chosen picture among the library's
  /// (lib/core/phone_pictures.dart `phonePicturePicker`). Absent, as in a test, no picture can be added.
  final PicturePicker Function(PictureAdopter adopt)? picturePicker;

  /// This phone's films: its picker, where each film stands and its player (lib/core/phone_films.dart). Absent, as
  /// in a test, a film in a note is its poster and none can be added.
  final Films? films;

  /// The calendar Pick a date opens (lib/core/phone_day.dart on a phone). Absent, a date is Today, Tomorrow or
  /// Next week.
  final DayPicker? dayPicker;

  /// Whether the phone has a connection, and the moment one comes back (lib/core/phone_connection.dart on a phone):
  /// a blank left "Waiting for a connection" goes on then. Absent, as in a test, there is always one as far as the
  /// app can tell, and such a blank waits for the queue's own look, a minute on.
  final Connection? connection;

  /// Who is in an organization's notes now, where a test brings its own account ([services]) and so has no live
  /// rooms to read; the app reads its own (lib/live/presence.dart).
  final List<Seen> Function(String orgId)? presence;

  /// The AIs online and Follow (lib/live/follow.dart), where a test brings its own account and so has no live rooms;
  /// the app's are its own live service's.
  final FollowAi? follow;

  /// Reads a linked page's title, site and summary (lib/core/link_preview.dart `linkPreviewFetch`). Absent, as in a
  /// test, a link's card says its site and its path and nothing is asked of anywhere.
  final LinkPreviewFetch? previewFetch;

  /// Asks YouTube, Spotify or Figma what a link of theirs is, and reads the picture they name
  /// (lib/editor/media/rich_embeds/oembed.dart `oEmbedFetch`, `pictureFetch`). Absent, as in a test, such a link's
  /// card is the plain one, and a tap opens it.
  final OEmbedFetch? embedFetch;
  final PictureFetch? embedPictures;

  /// Voice, where a test brings its own; then nothing is made from [voiceMaking].
  final Voice? voice;

  /// When a test's own [voice] is there to take: with the root unless given, and then only once this completes, as
  /// the app's own is made a moment after the notes are read (`Voice.make`) and a note can be on screen before it.
  final Future<void>? voiceWhen;

  /// The app's updates (lib/core/updates.dart), the process's own as the core is: made by whoever holds this root,
  /// and only in a build told where its releases are. Absent, as in every debug build and every test that brings
  /// none, no screen says anything of an update and nothing is asked of anywhere.
  final Updates? updates;

  /// The core and the phone's halves a [Voice] is made from (lib/root/voice_wiring.dart). Absent, as without a
  /// core, nothing records and Speak is offered nowhere. It needs the [core].
  final VoiceMaking? voiceMaking;

  /// The same, where the phone had not attached it by the first frame: taken when it comes, and null if it never
  /// does (lib/root/voice_wiring.dart `inTime`).
  final Future<VoiceMaking?>? voiceLater;

  /// The records of the notes nobody has written in yet (core/untouched.dart); the app's own unless a test brings
  /// its own.
  final UntouchedNotes? untouched;

  /// Reads the test report this build carries, for Settings › Test results: the build's own asset unless a test
  /// brings its own (lib/diag/built_report.dart).
  final Future<Map<String, Object?>?> Function()? testReport;

  @override
  State<GhostRoot> createState() => _GhostRootState();
}

/// The root's state is one class in four files, by what each is for (the audit's A1: it was one class of 2,600
/// lines doing four jobs).
/// - **Here**, what the app is made of and what it holds: the library, the trash, the workspaces, the account,
///   voice and the AI as fields; what each is listened to by, and the counts and the kept readings the parts on
///   screen are told by (lib/root/selected.dart); which sheet is open; and its start and its end.
/// - **lib/root/root_parts.dart**, what it puts on screen: the shell and every screen it is handed, Settings, the
///   palette, the sheets, the walkthrough and the launch screen, each a part that says what it reads.
/// - **lib/root/root_commands.dart**, what it does to the library: the making, opening, writing and renaming of
///   notes.
/// - **lib/root/root_voice.dart**, voice and the AI, made after the first frame, and what the recorder's and
///   Settings' screens ask of them.
///
/// The three others are parts of this library and their methods extensions on the state, so each reads these
/// fields as it would in the class. What is handed out to be compared (a listener, a press a widget keeps) is
/// declared here, where a method torn off twice is the same function.
class _GhostRootState extends State<GhostRoot> {
  late final bool _real = widget.core != null && widget.library == null;
  late final NoteLibrary _library = widget.library ?? (_real ? CoreLibrary(widget.core!) : SampleLibrary.seeded(now: DateTime.now().millisecondsSinceEpoch));
  late final Trash _trash = _real ? KeptTrash() : MemoryTrash();
  /// Where the real workspaces are kept, when the root makes them: it listens to the preferences, and is let go
  /// with the root.
  late final KeptWorkspaceStorage? _keptSpaces = widget.workspaces == null && _real ? KeptWorkspaceStorage() : null;
  late final WorkspaceStore _workspaces = widget.workspaces ??
      (_keptSpaces != null
          ? WorkspaceStore(storage: _keptSpaces, trash: _trash, onFiled: NoteFolders(_library, workspaces: () => _workspaces.value.list).fileNotesInFolder)
          : WorkspaceStore(storage: MemoryWorkspaceStorage(seedWorkspaces()), trash: _trash));
  late final VersionsStore _versionsStore = VersionsStore(widget.core, kept: _stored);
  // Who keeps a version here: the account's handle, read as each is kept (core/versions/record.ts `keeper`).
  // A note left is given its header banner by Lovart, where the plugin and its switch are on and it is a note to have
  // one (lib/plugins/lovart/banners.dart; Matt, 2026-10-26: "add a setting to automatically generate header images
  // for notes"). The note on screen is the one being left when the screen changes.
  // Written where the note is now: through its editor while it is open, so a banner made in the background never
  // costs what is being typed (`_changeNote`).
  late final LovartBanners _banners = LovartBanners(getNote: _library.get, update: _library.update, write: (id, change) => _changeNote(id, change, userEvent: 'lovart.banner'), warn: debugPrint);
  String? _bannerOpen;

  /// Settings › Lovart's header images for the recent notes, as the app's own job (lib/plugins/lovart/banner_run.dart;
  /// Matt, 2026-10-26: "Make the header generation async and a background task that runs while the app is generating
  /// the images"): the root's, so it goes on whatever page is up; claimed in the synced settings, so two of the
  /// account's devices never make the same notes' pictures; held up by the phone's foreground service and kept out of
  /// the Mac's App Nap while it runs; said by a toast as it ends.
  // Any other picture Lovart is making (a header as a note is left, an {image: …}, a moodboard) holds the device as
  // the run does, so the app is not frozen behind another (lib/plugins/lovart/lovart_hold.dart).
  late final LovartHold _lovartHold = LovartHold(background: ChannelBackgroundJobs());
  late final BannerJob _bannerJob = BannerJob(
    notes: () => _library.value,
    banners: _banners,
    claims: BannerClaims(
      device: thisDevice,
      preferences: () => preferences.value,
      setPreferences: preferences.update,
      syncNow: () async => await _services?.engine?.syncNow(),
      accountHeld: () => _services?.engine?.accountPrefs,
    ),
    background: ChannelBackgroundJobs(),
    // Which banners to make again when asked (black and white, or square), read from the pictures as the page reads
    // them; one whose picture is not here (not yet synced) is left as it is.
    redo: (name) async {
      final store = lovartPictureStore;
      if (store == null) return false;
      final look = await bannerLook(store, name);
      return !identical(look, BannerLook.unread) && bannerToRedo(colour: look.colour, aspect: look.aspect);
    },
    ended: _bannerRunEnded,
  );

  /// Whether the line for the run shows on home and in the sidebar (root_parts.dart `_bannerNotice`): while it runs,
  /// and once it stopped for a reason, until Hide ([_bannerHidden], the run hidden).
  bool _bannerShown = false;
  BannerRun? _bannerHidden;

  void _bannerMoved() {
    final run = lovartBannerRun.value;
    final shows = run != null && !identical(run, _bannerHidden) && (run.running || (run.stopped != null && !run.asked && run.total > 0));
    if (shows != _bannerShown && mounted) _told(() => _bannerShown = shows);
  }

  void _bannerRunEnded(BannerRun run) {
    if (!mounted) return;
    GlacierToast.of(context).toast(message: Text(bannerRunEndWords(run)), duration: const Duration(seconds: 6));
  }
  late final VersionsRecord _versions = VersionsRecord(store: _versionsStore, preferences: preferences, workspaces: _workspaces, keeper: () => _services?.session?.handle);

  /// The kept pictures, where there is a core to keep them.
  late final CorePictureStore? _pictures = widget.core == null ? null : CorePictureStore(CoreFiles(widget.core!), adopter: corePictureAdopter(CoreFiles(widget.core!)));

  /// A picture chosen on the phone and kept, where there is a chooser and a core to keep it in.
  late final PicturePicker? _pickPicture = widget.core == null ? null : widget.picturePicker?.call(corePictureAdopter(CoreFiles(widget.core!)));

  /// The account made for this build, where it was told its service and has a library of its own to sync.
  late final WiredAccount? _wired = widget.services == null && widget.account != null && _real
      ? WiredAccount.make(
          making: widget.account!,
          core: widget.core!,
          workspaces: _workspaces,
          versions: _versionsStore,
          // Matched rather than promoted: a late field is not promoted by every Dart the app is built with (CI's).
          touched: switch (_library) { final CoreLibrary core => core.touched, _ => null },
          // A pass that changed notes: the list read again, and an open tape its phrases (lib/root/note_desk.dart).
          refresh: () {
            _notesSynced.value += 1;
            return _library.refresh();
          },
          shownNotes: () => _shown,
          // A shared link follows the notes, by whichever hand they changed (lib/share/share.dart `follow`).
          notesChanged: _library,
          kept: _stored,
          onPicture: (name) => _pictures?.arrived(name),
          // A note of the account's own that met another device's while this one had changes unsent: this
          // device's words, kept beside the room's (lib/live/open.dart).
          keepCopy: (words) async {
            await _library.createNote(words);
          },
        )
      : null;
  late final AccountServices? _services = widget.services ?? _wired?.services;

  /// Whether the way into an account is up (shell/account_gate.dart): made once what this device kept is read.
  AccountGateState? _gate;
  AppLifecycleListener? _life;

  /// The calendars' own: read again when the app comes back to the front.
  AppLifecycleListener? _calendarLife;

  /// The outgoing webhooks' own: what is waiting is sent as the app goes behind another.
  AppLifecycleListener? _webhooksLife;

  /// A member's caret a note is about to be opened at (an organization's Jump to cursor), by note; its desk takes it.
  final Map<String, Map<String, Object?>> _jumps = {};

  /// Who is in an organization's notes now, as the live rooms have them (lib/live/presence.dart): none in a build
  /// with no account, and while signed out.
  List<OrgPresence> _seenIn(String orgId) => [
        for (final seen in _presenceIn(orgId))
          OrgPresence(
            client: '${seen.client}',
            handle: seen.handle,
            hue: seen.hue,
            editingNote: seen.at?.note,
            editingTitle: seen.at?.title,
            editingCanvas: seen.at?.kind == 'canvas',
            editingPlace: seen.at?.cursor != null || seen.at?.pointer != null,
            ai: seen.ai,
            via: seen.via,
            doing: seen.at == null ? null : (seen.at!.doing ?? 'editing'),
          ),
      ];

  /// Someone came, went, or opened another note: the home page's cards and the organization's rows say so, and
  /// nothing else is drawn again for it. A team's note says it has been left as its desk is let go, which is while
  /// the tree is being built or taken down: a part told then is drawn after that frame (lib/root/selected.dart),
  /// where asking at once threw inside the desk's `dispose` and left its listeners behind (seen on the emulator, on
  /// leaving a team's note).
  void _presenceChanged() {
    _presenceAt += 1;
    _tick.tell();
  }

  /// A note opened where a member is editing it (`onJump(at.note, at.cursor ?? at.pointer)`): at their caret, where
  /// the room has one, or at their pointer's spot on a canvas, which its desk centres on.
  void _jumpTo(AppShellState shell, String orgId, String noteId) {
    final place = jumpPlace(_presenceIn(orgId), noteId);
    if (place != null) _jumps[noteId] = place;
    shell.openNote(noteId);
  }

  /// Who is in an organization's notes now, as the live rooms have them; a test's own where it brings an account.
  List<Seen> _presenceIn(String orgId) => _wired?.live.presence.presenceIn(orgId) ?? widget.presence?.call(orgId) ?? const <Seen>[];

  /// The AIs online and Follow (docs/CLAUDE_LIVE.md): the live service's, or a test's.
  FollowAi? get _follow => _wired?.live.follow ?? widget.follow;

  /// Follow's way into a note (lib/live/follow.dart `open`): opened as a member's Jump to cursor opens one, but at
  /// no caret and without the keyboard, since Follow scrolls to the AI's caret itself. A note this device does not
  /// hold yet is not opened; it is tried again when the AI is next heard.
  bool _openForFollow(AiOnline ai, String noteId) {
    final shell = _shell.currentState;
    if (shell == null || _library.noteOf(noteId) == null) return false;
    if (shell.shown != noteId) shell.openNote(noteId);
    return true;
  }

  /// The chip's Open: the note an AI is on, at its caret, as Jump to cursor opens a member's.
  void _openForAi(AiOnline ai) {
    final shell = _shell.currentState, at = ai.at;
    if (shell == null || at == null) return;
    final place = at.cursor ?? at.pointer?.toJson();
    if (place != null) _jumps[at.note] = place;
    shell.openNote(at.note);
  }

  /// Follow, from an AI's row on an organization's page.
  void _followFrom(OrgPresence here) {
    final follow = _follow;
    final ai = follow?.find(aiKey(here.handle, here.via));
    if (follow != null && ai != null) follow.follow(ai);
  }

  /// "Claude is editing Roadmap", with Watch: an AI began on a note while nobody is followed.
  void _aiEditing(AiOnline ai) {
    if (!mounted) return;
    final title = ai.at?.title;
    GlacierToast.of(context).toast(
      message: Text('${ai.name} is editing ${title == null || title.isEmpty ? 'a note' : title}'),
      duration: const Duration(seconds: 8),
      action: GlacierToastAction(label: 'Watch', onPress: () => _follow?.follow(ai)),
    );
  }

  /// Follow told how the app opens a note and gives a notice; once, as the account starts.
  void _wireFollow(FollowAi follow) {
    follow
      ..open = _openForFollow
      ..onEditing = _aiEditing
      ..shown = () => _shell.currentState?.shown;
  }

  /// An organization's settings, and the sheet a new one is named in. Opened from Settings' own list or from the
  /// organization's dashboard, which the sheet's head says; from anywhere else (the home filters, a folder's "…",
  /// a workspace's sheet, All notes) it is opened from nowhere it goes back to.
  ({String id, OrganizationFrom? from})? _organization;
  bool _newOrganization = false;

  /// `closeOrganizationSettings`: left or deleted from its settings, its dashboard has nothing to show, so the way
  /// out is home.
  void _closeOrganizationSettings() {
    final id = _organization?.id;
    setState(() => _organization = null);
    final shell = _shell.currentState;
    final now = shell?.screen;
    if (id == null || shell == null || now is! ScreenOrganization || now.orgId != id) return;
    if (!(_services?.orgs?.orgsState().list.any((row) => row.id == id) ?? false)) shell.show(const Screen.list());
  }

  /// `openOrganizationSettings`: over whatever is up, the sidebar's card put away first.
  void _openOrganizationSettings(String id, [OrganizationFrom? from]) {
    _shell.currentState?.closeSidebar();
    setState(() => _organization = (id: id, from: from));
  }

  void _say(BuildContext context, String message) => GlacierToast.of(context).toast(message: Text(message));

  /// What the note on screen reads of the library, read once per change to the notes (lib/root/library_reads.dart).
  late final LibraryReads _reads = LibraryReads(shown: () => _shown, all: () => _library.value);
  late final Listenable _libraryChanges = Listenable.merge([_library, _trash]);

  /// The journal on screen, writing its own index (`journalWriter`), and New entry's half of the library.
  journal.JournalWriter? _journalWriter;
  late final UntouchedNotes _untouched = widget.untouched ?? untouchedNotes;
  late final JournalPages _pages = JournalPages(
    _library,
    untouched: _untouched,
    write: (journalId, change) {
      final writer = _journalWriter;
      if (writer == null || writer.id != journalId || _shell.currentState?.shown != journalId) return false;
      writer.write(change);
      return true;
    },
  );

  /// An entry, or a new note given a name or a template, that nobody wrote in, taken back once it is left
  /// (lib/root/take_back.dart). It stays while it is the note on screen, while a capture is aimed at it, and while
  /// its tab is open behind another note, a capture or a meeting (`stays`).
  late final TakeBack _takeBack = TakeBack(
    library: _library,
    trash: _trash,
    untouched: _untouched,
    stays: (id) {
      final shell = _shell.currentState;
      if (shell == null) return false;
      final now = shell.screen;
      if (now is ScreenNote && now.note.id == id) return true;
      if (now is ScreenCapture && now.noteId == id) return true;
      return shell.tabs.open.contains(id) && (now is ScreenNote || now is ScreenCapture || now is ScreenMeeting);
    },
    writeJournal: _pages.writeJournal,
    dropTab: (id) => _shell.currentState?.dropTab(id),
    forgetTag: (id) => _places?.setPendingTag(id, null),
  )..making = _pages.making;

  /// The places notes keep (lib/core/place_tags.dart), where the build can say where the phone is: the fix, the
  /// name asked of OpenStreetMap once, the tag that waits for a note's first words or a recording's better ones.
  late final PlaceTags? _places = widget.locator == null
      ? null
      : PlaceTags(
          locations: Locations(
            locator: widget.locator,
            lookup: widget.placeLookup,
            localOnly: () => preferences.value.localOnly,
            mapTiles: () => preferences.value.mapTiles,
            placeNames: () => preferences.value.placeNames,
          ),
          getNote: _library.get,
          updateNote: _library.update,
          refinePending: (id) => _voice?.recorder.refining?.refinePending(id) ?? false,
          untouched: _untouched,
          kept: _stored,
        );

  /// The first time a new note would be tagged on a phone that has never answered the location prompt, the app
  /// says what it is for, in its own words, and the prompt comes from the press (`introduceLocation`).
  void _introduceLocation(void Function() allow) => _introduce('New notes can keep where they were written.', allow);

  /// The first ask for where a journal's entries were written, from its own press (`introduceEntries`).
  Introduce _introduceEntries(String journal) => (allow) => _introduce('$journal keeps where each entry was written.', allow);

  void _introduce(String message, void Function() allow) {
    if (!mounted) return;
    GlacierToast.of(context).toast(message: Text(message), duration: const Duration(seconds: 10), action: GlacierToastAction(label: 'Allow location', onPress: allow));
  }

  /// Every tag still waiting for a note that is closed, written where it may now land; the notes are read again
  /// when one did (shell/useHousekeeping.ts).
  void _settleTags() {
    final places = _places;
    if (places == null) return;
    unawaited(places.settleWaitingTags().then<void>((landed) async {
      if (landed > 0) await _library.refresh();
    }, onError: (Object _) {}));
  }

  /// Voice, once it is made (lib/root/voice_wiring.dart), and where a capture begins and ends
  /// (lib/root/capture_route.dart). Null until then, and for good in a build with none: Speak is offered nowhere.
  Voice? _voice;
  CaptureRoute? _capture;
  VoidCallback? _unwatchMeeting;
  AppLifecycleListener? _voiceLife;
  final Completer<void> _notesRead = Completer<void>();

  /// The test report this build carries, read the first time Developer mode is on once the notes are read
  /// (lib/diag/built_report.dart): Settings is handed it, and is built again when it has come.
  late final BuiltTestReport _builtReport = BuiltTestReport(wanted: developerMode, read: widget.testReport)..addListener(_tick.tell);

  /// Done once this run's voice is known: made and held ([_voice]), or never to be (a build with none, a phone half
  /// that did not attach, a making that failed). What must go through voice's queues before it does anything waits
  /// here: a link to a note, whose write-up is put in before the note opens (lib/root/root_commands.dart).
  final Completer<void> _voiceKnown = Completer<void>();

  /// The meeting's state, whether the phone may notify or whether the AI can run here changed: the parts that read
  /// voice are told (the home page's recording, Settings' rows, the + sheet's meeting), after the frame where one
  /// is being built (lib/root/selected.dart).
  void _voiceChanged() {
    _voiceAt += 1;
    _tick.tell();
  }

  /// The models on this phone, or one's fetch: Settings' AI page and the walkthrough's model page.
  void _modelsChanged() {
    _modelsAt += 1;
    _tick.tell();
  }

  /// The app's updates: the notice above the notes and in the sidebar, About's rows, the launch screen's line.
  void _updatesChanged() {
    _updatesAt += 1;
    _tick.tell();
  }

  /// The AI of the note on screen, or its review's stage: the scene over the window.
  void _aiChanged() {
    _aiAt += 1;
    _tick.tell();
  }

  /// The AI, once voice has made its engine the app's (docs/STAGE8_AI.md, "At launch"): whether it can run here,
  /// the phone as the strip's card names it, and the fills' queue. Null in a build with no engine.
  AvailabilityController? _availability;
  DeviceFactsController? _deviceFacts;
  VoidCallback? _stopFills;

  /// Local only, listened to alone (`PreferencesStore.select`): it is read as the root begins to listen, so its first
  /// change is a change. Kept in a field read for the first time by the listener itself, it was read after it had
  /// moved, and the first switching off went unseen.
  late final ValueListenable<bool> _localOnly = preferences.select((prefs) => prefs.localOnly);

  /// Switched off, the fills parked while nothing could leave the phone are pressed again, where the queue was
  /// started.
  void _localOnlyMoved() {
    if (!_localOnly.value && _stopFills != null) resumeParked();
  }

  /// The phone's models as the walkthrough's model page reads them (lib/guide/guide_models.dart): where there is an
  /// engine to run one. Null before voice is made and in a build with none, and the page then says nothing of
  /// downloads.
  PhoneGuideModels? _guideModels;
  GuideModels? get _modelsForGuide {
    final models = _voice?.models;
    if (models == null || !engine.aiBackend.available) return null;
    return _guideModels ??= PhoneGuideModels(models, offered: !kIsWeb && defaultTargetPlatform != TargetPlatform.iOS);
  }

  /// A line for each note that wants one, written by the smallest model while nothing else has the cores
  /// (lib/format/gist.dart). The pages ask for their own first cards and each card hears its own line
  /// (lib/home/home_screen.dart, lib/notes/all_notes_screen.dart): the root says only when the runner must stand
  /// aside, whether the app is on screen, and that the models on the phone changed.
  VoidCallback? _stopGistHold;
  VoidCallback? _stopGistModels;

  /// The AI of the note on screen, told by its desk: the scene over the window is drawn from it.
  String? _noteAiId;
  NoteAi? _noteAi;

  /// Told once the engine is up and a desk's AI can be made (lib/root/root_voice.dart `_aiUp`, `_aiWorld`): a note
  /// opened before then takes its AI as it comes, where it had none until it was opened again. Heard by the open
  /// note's desk and by nothing else.
  final ValueNotifier<bool> _aiReady = ValueNotifier<bool>(false);

  /// A Speak button (`speak`): a capture into a new note, or the note its first command names.
  void _speak() => unawaited(_capture?.start(false));

  /// A pull down from the top of the home page or All notes (docs/DESIGN.md §152; `pullRefresh`): a sync, waited for
  /// a few seconds at most, and the notes read again whatever it answered. With no account the notes are read.
  Future<void> _pullRefresh() async {
    // The calendars too, without waiting on them: a slow calendar never holds the pull.
    unawaited(calendar.syncNow());
    await _services?.engine?.syncWithin().then<void>((_) {}, onError: (Object _) {});
    await _library.refresh();
  }

  /// Settings' three pages over the core and the phone's pickers: where the library is and the calls that move it,
  /// the drives a backup goes to, and everything as one zip. Made once, where the build has the whole core.
  late final GhostCore? _native = _real ? widget.native : null;
  late final LibraryFolder? _libraryFolder = _native == null
      ? null
      : LibraryFolder(invoke: _native.invoke, onNotesChanged: () => unawaited(_library.refresh().catchError((Object _) {})));
  late final Backups? _backups = _native == null ? null : Backups.overCore(invoke: _native.invoke, startJob: _native.startJob, events: _native.events);
  late final ExportAll? _export = _native == null ? null : ExportAll.overCore(invoke: _native.invoke, startJob: _native.startJob, events: _native.events);

  /// Settings › Import: an Obsidian vault or Evernote's exports, into a workspace of their own (lib/importer/).
  late final Importer? _importer = _native == null ? null : Importer.overLibrary(library: _library, workspaces: _workspaces, invoke: _native.invoke);

  /// Settings › Account › Export everything and Settings › Import › A .ghostex file (lib/export/ghostex_calls.dart):
  /// the file named for the account, and sealed by the account's own crypto (its second lane where `main` made one).
  late final Ghostex? _ghostex = _native == null
      ? null
      : Ghostex.overCore(library: _library, workspaces: _workspaces, invoke: _native.invoke, crypto: widget.account?.crypto ?? CoreCrypto(_native.invoke), handle: () => _services?.session?.handle);

  /// The notes' folder in the phone's Files app, for the sidebar's Browse files (lib/core/library_files.dart): the
  /// phone is asked the first time a sidebar is built, and the tool is there once it has said it can.
  late final LibraryFiles _files = LibraryFiles();
  VoidCallback? get _browseFiles => _files.offered(() {
        if (mounted) setState(() => _canBrowse = true);
      });

  /// Whether the phone has said it can show the folder: what a sidebar is drawn again for.
  bool _canBrowse = false;

  /// Which tapes' audio is on this device (lib/settings/tapes_here.dart): each tape's file is asked through the
  /// player as Settings' Tapes card is put up, as the page's card asked the `rec` scheme (`headStatus`).
  late final TapesHere _tapes = TapesHere(widget.tapePlayer?.onDevice);

  /// The room the tapes on this device take, and the old ones among them: only the tapes whose audio is here, not
  /// one the row removed nor one whose file says it is elsewhere. Read once per change to the notes or to what is
  /// known of the tapes, and the same answer while the room and the old ones are the same: Settings is handed it
  /// open or shut, and is not built again for a save that touched no tape.
  ({int bytes, List<String> old}) get _tapeFacts {
    final all = _library.value;
    if (identical(all, _tapedOf) && _tapesAt == _tapedAt) return _taped;
    _tapedOf = all;
    _tapedAt = _tapesAt;
    final taped = _tapes.here(all);
    final old = [for (final note in oldTapes(taped, DateTime.now().millisecondsSinceEpoch)) note.id];
    final bytes = tapeBytes(taped);
    return bytes == _taped.bytes && listEquals(old, _taped.old) ? _taped : _taped = (bytes: bytes, old: old);
  }

  List<Note>? _tapedOf;
  int _tapedAt = -1;
  ({int bytes, List<String> old}) _taped = (bytes: 0, old: const []);

  /// The walkthrough (shell/useGuide.ts): open by itself on the first launch that is not the side key's capture,
  /// and from Settings and the palette after. Made as the root is, the device's memory having been read by then.
  late final GuideController? _guide = widget.guide ??
      (_real ? GuideController(launchedByKey: (widget.voiceMaking?.assistant ?? false) && widget.voiceMaking?.launch == 'capture') : null);

  /// The titles of linked pages, kept on this device (`core/linkPreview.ts`): asked only with Link previews on and
  /// "Nothing leaves the phone" off.
  late final KeptLinkPreviews _previews = KeptLinkPreviews(
    _stored,
    fetch: widget.previewFetch,
    canAsk: () => preferences.value.linkPreviews && !preferences.value.localOnly,
  );

  /// What YouTube, Spotify and Figma said of their links, kept on this device as the titles are, and asked, shown
  /// and played under the same two switches: Link previews on and "Nothing leaves the phone" off.
  late final KeptEmbeds _embeds = KeptEmbeds(
    _stored,
    fetch: widget.embedFetch,
    pictures: widget.embedPictures,
    allowed: () => preferences.value.linkPreviews && !preferences.value.localOnly,
  );

  /// Following the links that opened the app, from the notes' first read until the app is gone.
  void Function()? _stopLinks;

  /// The same for what other apps share in: each share waits here for its sheet (lib/share/ui/share_in_sheet.dart),
  /// one at a time, the oldest first.
  void Function()? _stopShares;
  final List<SharedIn> _sharing = [];

  /// Writes a share into the library: a picture as the editor's own Add a picture keeps one, any other file beside
  /// the pictures (lib/share/share_in_keep.dart).
  late final ShareKeeper _shareKeeper = ShareKeeper(
    library: _library,
    workspaces: _workspaces,
    adoptPicture: widget.core == null ? null : corePictureAdopter(CoreFiles(widget.core!)),
    keepFile: (source, name) async => storeSharedFile(source, name: name, dataDir: (await DevicePaths.find()).dataDir),
    kept: _stored,
  );

  /// An invite link that arrived, each arrival asked about again (`joinRequest`).
  JoinRequest? _joinRequest;
  void _joinFromLink(String code) {
    if (mounted) setState(() => _joinRequest = JoinRequest(code, DateTime.now().microsecondsSinceEpoch));
  }

  late final AppLinkDoor _door = _RootDoor(this);

  /// Reminders, the home screen's widgets and the icon's shortcuts (lib/root/phone_extras.dart): on Android, over the
  /// real library, and nowhere else. Begun once the notes are read.
  late final PhoneExtras? _extras = _real && !kIsWeb && defaultTargetPlatform == TargetPlatform.android
      ? PhoneExtras(library: _library, trash: _trash, reminders: PhoneReminderHost(), places: PhonePlaceHost(), placesOn: () => plugins.isEnabled(placeRemindersId), placesSwitch: plugins, home: const PhoneHomeScreenHost(), kept: _stored, openView: (id) => openNoteScreen(_shell.currentContext, id)?.view, events: calendar.events, calendarOn: calendarOn, scheme: () => themeScheme(preferences.value.theme), lookChanged: preferences, workspaces: _workspaces, claudeOn: () => _claudeOn, claudeKey: () => claudeSettings.hasKey, claudeChanged: Listenable.merge([_pluginsHeard, claudeSettings]))
      : null;

  /// The links the home screen, the icon and the tile open the app with (lib/home_screen/phone_entries.dart).
  late final PhoneEntryDoor _phoneDoor = _PhoneDoor(this);

  /// The + sheet, the workspace it makes into where it was an organization's +, and the New notebook sheet with its
  /// own.
  bool _newSheet = false;

  /// The chat with Claude is up (lib/root/root_claude.dart), the agent it was opened for, if any, and the words its
  /// field starts with: what the page whose dock opened it is about.
  bool _askClaude = false;
  String? _chatAgent;
  String? _chatInitial;

  /// An ask said aloud to Claude, while its sheet is up (lib/root/root_claude.dart `_startTalk`), and whether the
  /// phone's assistant started it, whose launch over the lock screen is taken back as it ends.
  ClaudeVoice? _talk;
  bool _talkFromAssistant = false;

  /// The app's own Claude, with the person's API key (docs/CLAUDE_APP.md): made on first use.
  late final ClaudeFolders _claudeFolders = ClaudeFolders(_workspaces);
  late final ClaudeRunner _claude = ClaudeRunner(settings: claudeSettings, notes: _RootClaudeNotes(this), desk: _RootClaudeDesk(this), allowed: claudeInApp, folders: _claudeFolders, books: ClaudeBooks(_RootClaudeShelf(this), _claudeFolders));

  /// The "Ask Claude" note, worked through as requests are written in it.
  late final ClaudeInbox _claudeInbox = ClaudeInbox(
    runner: _claude,
    body: _claudeInboxBody,
    // The notes, and the Claude plugin's switch: switched on again, the inbox looks at once.
    changes: Listenable.merge([_libraryChanges, _pluginsHeard]),
    write: (id, change) => _RootClaudeDesk(this).change(id, change),
    caretLine: _claudeInboxCaretLine,
    on: claudeInApp,
  );

  /// The registry the root hears (lib/plugins/registry.dart): the app's as the root came up.
  final Registry _pluginsHeard = plugins;

  /// Whether the app's own Claude is on, as the parts last read it (the Claude plugin's switch).
  bool get _claudeOn => claudeInApp();

  /// Whether Claude is shown: on, and an Anthropic API key entered on this device (Matt, 2026-10-19: "the claude icon
  /// should only show up if the user has entered the antrhopic api key"). The dock's Claude and Talk to Claude rings
  /// and Claude's bar wait for the key; Settings › Claude is where it is entered.
  bool get _claudeShown => _claudeOn && claudeSettings.hasKey;

  /// Whether a key was there when the parts last read it, so a key entered or removed draws them again.
  bool _claudeKeyed = false;

  void _claudeKeyMoved() {
    if (!mounted || claudeSettings.hasKey == _claudeKeyed) return;
    _claudeKeyed = claudeSettings.hasKey;
    _pluginsMoved();
    // The parts read again only when the tick says so (lib/root/selected.dart).
    _tick.tell();
  }

  /// A plugin was switched on or off, or Local only held some off: the parts that draw Claude (every dock, the chat,
  /// the bar) read again, and the app's Claude switched off closes its chat and stops what it was doing.
  void _pluginsMoved() {
    if (!mounted) return;
    _told(() {
      if (!_claudeOn) {
        _askClaude = false;
        _claude.stop();
        _talk?.cancel();
      }
    });
  }

  /// The inbox: the account's own note titled "Ask Claude", never an organization's, its words as its editor has
  /// them where it is open.
  ({String id, String body})? _claudeInboxBody() {
    for (final note in _shown) {
      if (note.archivedAt != null || (note.path ?? '').startsWith('orgs/')) continue;
      if (noteTitle(note.body).trim().toLowerCase() != inboxTitle.toLowerCase()) continue;
      final open = openNoteScreen(_shell.currentContext, note.id)?.view;
      return (id: note.id, body: open?.state.doc.toString() ?? note.body);
    }
    return null;
  }

  /// The line the person's caret is on in the inbox, where it is open.
  int? _claudeInboxCaretLine(String id) {
    final view = openNoteScreen(_shell.currentContext, id)?.view;
    if (view == null) return null;
    final state = view.state;
    return state.doc.lineAt(state.selection.main.head).number - 1;
  }
  String? _newInto;
  NewBookKind? _bookSheet;
  String? _bookInto;

  /// What the aside holds for the screen that is up (App.tsx `asideBody`): asked once for a library and a note.
  AsideContent? _asideOf(AppShellState shell) {
    final id = shell.shown;
    final notes = shell.notes;
    if (!identical(notes, _asideNotes) || id != _asideFor) {
      _asideNotes = notes;
      _asideFor = id;
      Note? open;
      if (id != null) {
        for (final note in notes) {
          if (note.id == id) open = note;
        }
      }
      _aside = asideContent(notes, open);
    }
    return _aside;
  }

  List<Note>? _asideNotes;
  String? _asideFor;
  AsideContent? _aside;

  /// The open note's version history, in the aside on a desktop (App.tsx `asideHistory`; Matt: "make a sidebar that
  /// can be expanded on desktop to see the version history"): a window wide enough for two panes, and not a phone,
  /// which keeps its history in the More sheet. Not for a canvas, whose words are JSON and have no line history
  /// worth reading.
  ({String noteId, String title})? _asideHistoryOf(BuildContext context, AppShellState shell) {
    final screen = shell.screen;
    if (screen is! ScreenNote || mobileDevice || !splitFits(MediaQuery.sizeOf(context), mouse: mousePointer)) return null;
    if (isCanvasBody(screen.note.body)) return null;
    return (noteId: screen.note.id, title: noteTitle(screen.note.body));
  }

  /// The aside's History tab for that note (aside/aside_history.dart), where there is one.
  AsideHistoryBuilder? _asideHistory(BuildContext context, AppShellState shell) {
    final history = _asideHistoryOf(context, shell);
    if (history == null) return null;
    return (context) => AsideHistory(
          key: ValueKey('aside-history-of:${history.noteId}'),
          noteId: history.noteId,
          title: history.title,
          record: _versions,
          onShareFile: (id, title) => shareVersionsFile(_versionsStore, id, title, files: _files),
          say: (message) => _say(context, message),
        );
  }

  /// The bar's History button: the side panel opened at its History tab, or turned to it if it was open already
  /// (`openHistoryAside`).
  void _openHistoryAside(AppShellState shell) {
    showAsideTab(AsideTab.history, _stored);
    shell.showAside();
  }

  /// Whether your templates are being made now (`_openTemplates`): a second press meanwhile is the same press.
  bool _seeding = false;

  /// Smart notebooks, the Tags page, a tag renamed and today's note (lib/root/organize.dart).
  late final Organize _organize = Organize(
    library: _library,
    workspaces: _workspaces,
    shell: () => _shell.currentState,
    notes: () => _shown,
    make: (body, {caret, into}) => _showMade(body, caret: caret, into: into),
    screenOf: (id) => _shell.currentState?.shown == id ? openNoteScreen(_shell.currentContext, id) : null,
    templates: () => _reads.ownTemplates,
    say: (message) {
      if (mounted) _say(context, message);
    },
  );

  late final NoteDeskWorld _desk = NoteDeskWorld(
    titles: () => [
      for (final note in _shown)
        if (noteTitle(note.body).isNotEmpty) noteTitle(note.body),
      // The names a note answers to besides its title (lib/core/aliases.dart): a link to one opens the note.
      for (final note in _shown) ...aliasesOfNote(note),
    ],
    known: (title) => _reads.titled(title) != null,
    open: _openTitle,
    live: _wired?.noteLive,
    takeJump: (id) => _jumps.remove(id),
    bodyOf: (title) => _reads.titled(title)?.body,
    pictures: _pictures,
    films: widget.films,
    services: _services,
    changes: _libraryChanges,
    queryNotes: () => _reads.queryNotes,
    // The calendars' events (lib/calendar, docs/CALENDAR.md): `from: events`, and a calendar of to-dos.
    queryEvents: calendar.queryEvents,
    eventsChanged: calendar.events,
    // A note a query listed, opened: the note itself, or a to-do's note at its line.
    openAt: (id, line) => _shell.currentState?.openNote(id, at: line == null ? null : 'line:${line + 1}'),
    write: (id, change) => unawaited(_writeNote(id, change)),
    addTicket: _addFromQuery,
    // `[[GHO-12]]` finds the ticket by its key too.
    tickets: (id) => _reads.ticketOptions(id, open: _openTitle),
    openWithin: _openTitleWithin,
    openCanvas: _openCanvasWithin,
    openPage: _openPageWithin,
    openTicket: _openTicketWithin,
    ticketTemplates: () => _reads.ticketTemplates,
    pageTitles: _pageTitles,
    noteOf: (title) => _reads.titled(title),
    newEntry: (id, template) => unawaited(_newEntry(id, template)),
    openLink: widget.openLink,
    previewer: _previews,
    embeds: _embeds,
    ai: _aiWorld,
    tapePlayer: widget.tapePlayer,
    clipPlayer: widget.clipPlayer,
    noteById: _library.noteOf,
    getNote: _library.get,
    // A tape's length and its name are the library's and this device's own, whether or not voice is made yet: a
    // note opened before it (the app started by a link to it) has both, as the page reads `tapeId` with no recorder.
    setNoteRecording: (id, ms, segments) => LibraryRecorderStore(_library).setNoteRecording(id, ms, segments),
    tapes: TapeIds(_stored),
    // Not where nothing records (an iPhone): a tape synced from another device then offers no Add.
    onSpeak: recordsVoice ? (id) => unawaited(_speakInto(id)) : null,
    pickPicture: _pickPicture,
    dayPicker: widget.dayPicker,
    mapTiles: widget.mapTiles,
    tags: _places,
    placeSearch: widget.placeSearch,
    openTag: (tag) => _organize.showTag(tag),
    forgetTag: (id) => _places?.setPendingTag(id, null),
    holdNote: (id, on) => _voice?.recorder.refining?.holdNote(id, on),
    dropRefine: (id, fromMs) => _voice?.recorder.refining?.dropRefine(id, fromMs),
    // A landing's Undo takes back what the recording wrote to other notes (`undoCommandMutation`).
    undoCommandMutation: _library.undoCommandMutation,
    // What a note's tape says of its summary: the two queues, once voice has made them.
    summaries: () => _voice?.summaries?.useSummaries,
    refining: () => _voice?.recorder.refining?.refining,
    onRecordingChanged: (listener) {
      _recordingHeard.add(listener);
      return () => _recordingHeard.remove(listener);
    },
    notesSynced: _notesSynced,
    aiReady: _aiReady,
    // A note pulled down from its top syncs before it is read again.
    syncWithin: () => _services?.engine?.syncWithin() ?? Future<void>.value(),
    // Version history's Share the versions file: copied as text on the phone, which is what its page does there.
    shareVersionsFile: (id, title) => shareVersionsFile(_versionsStore, id, title, files: _files),
    // A note's links, its outline and its graph (lib/links/note_links.dart).
    links: (noteId) => NoteLinksHere(app: _linksApp, noteId: noteId),
  );

  /// Which notes link to which, kept with the library (lib/core/link_index.dart): read whole off the UI isolate
  /// once, then a note at a time as each changes. Made as the root starts; what it reads is what every screen shows.
  late final LinkIndexer _linkIndex;

  /// What every open note's links are given (lib/links/note_links.dart).
  late final NoteLinksApp _linksApp = NoteLinksApp(
    indexer: _linkIndex,
    openAt: (id, line) => _shell.currentState?.openNote(id, at: 'line:${line + 1}'),
    link: _linkMention,
    localGraph: (id, title) => _showGraph(focus: id, title: title),
    say: (message) => _say(context, message),
  );

  /// The graph of the notes over the app (lib/links/graph_view.dart): the whole library's, or the notes round
  /// [focus]. A note opened from it opens where it was left. Archived notes are put away, and left out.
  void _showGraph({String? focus, String? title}) {
    final shell = _shell.currentState;
    if (shell == null) return;
    unawaited(showGraph(
      context,
      indexer: _linkIndex,
      focus: focus,
      focusTitle: title,
      hueOf: (id) => _workspaces.workspaceOf(id)?.hue,
      keep: (id) => id == focus || (_library.noteOf(id)?.archivedAt ?? 0) == 0,
      onOpen: (id) => _openWhereLeft(shell, id),
    ));
  }

  /// "Mentioned in"'s Link: the words in the other note made a `[[link]]`, through the library as a query's tick
  /// is, and said with an Undo that takes the brackets off again while they are still there.
  Future<bool> _linkMention(Mention mention, LinkPlace place) async {
    String? made;
    await _writeNote(mention.id, (body) => made = linkMention(body, place.from, place.to, mention.name));
    final linked = made;
    if (!mounted) return linked != null;
    if (linked == null) {
      _say(context, 'That mention has changed. Open ${mention.title.isEmpty ? 'the note' : mention.title} to link it.');
      return false;
    }
    final words = linked.substring(place.from + 2, linked.indexOf(']]', place.from));
    GlacierToast.of(context).toast(
      message: Text('Linked in ${mention.title.isEmpty ? 'Untitled' : mention.title}.'),
      action: GlacierToastAction(label: 'Undo', onPress: () => unawaited(_writeNote(mention.id, (body) => unlinkMention(body, place.from, words)))),
    );
    return true;
  }

  /// The palette's Links to this note: the side panel at its Links tab where there is room for it, else the note's
  /// More sheet at its Links page.
  void _openNoteLinks(String id) {
    final shell = _shell.currentState;
    if (shell == null) return;
    if (splitFits(MediaQuery.sizeOf(context), mouse: mousePointer)) {
      showAsideTab(AsideTab.links, _stored);
      shell.showAside();
      return;
    }
    NoteLinksHere.of(id)?.openLinks();
  }

  /// The open note's links and outline, in the side panel where the window has room for two panes (a Fold
  /// opened, a Mac): a note of words, not a canvas or a notebook's index.
  ({String noteId, String title})? _asideLinksOf(BuildContext context, AppShellState shell) {
    final screen = shell.screen;
    if (screen is! ScreenNote || !splitFits(MediaQuery.sizeOf(context), mouse: mousePointer)) return null;
    final note = _library.noteOf(screen.note.id) ?? screen.note;
    if (isCanvasBody(note.body) || isBookBody(note.body)) return null;
    return (noteId: note.id, title: noteTitle(note.body));
  }

  AsideHistoryBuilder? _asideLinks(BuildContext context, AppShellState shell) {
    final of = _asideLinksOf(context, shell);
    if (of == null) return null;
    return (context) => asideLinks(context, app: _linksApp, noteId: of.noteId, title: of.title);
  }

  AsideHistoryBuilder? _asideOutline(BuildContext context, AppShellState shell) {
    final of = _asideLinksOf(context, shell);
    if (of == null) return null;
    return (context) => AsideOutline(noteId: of.noteId, body: () => _library.noteOf(of.noteId)?.body ?? '');
  }

  /// Who hears that the phone's write-up changed a note (ai/summaries.dart `onRecordingChanged`): the open notes'
  /// screens, told through here so that a note opened before voice was made hears too.
  final Set<void Function(String noteId)> _recordingHeard = <void Function(String noteId)>{};
  VoidCallback? _unhearRecordings;

  /// Meetings posted to Slack once written up (lib/plugins/slack/meetings.dart), once voice is made.
  MeetingSlackPoster? _slackMeetings;

  /// And to Discord (lib/plugins/discord/meetings.dart), beside them.
  MeetingDiscordPoster? _discordMeetings;

  /// A note's share link for the Discord plugin's cut of a long note: the link the note's Share sheet copies, made or
  /// found again by the app's share.
  Future<String> _discordShare(String noteId) async {
    final shares = _services?.shares;
    final note = await _library.get(noteId);
    if (shares == null || note == null) throw StateError('no share to make here');
    return shares.shareNote(note, await shares.listNotes());
  }

  NoteActions? _made;

  /// Pin, archive, delete and their Undo (notes/note_actions.dart); made once there is a toast to say them with.
  /// A tag waiting for a note goes with it to the trash, and with it for good (`forgetKept`).
  NoteActions get _actions => _made ??= NoteActions(
        library: _library,
        workspaces: _workspaces,
        trash: _trash,
        say: NoteActions.toaster(context),
        // The ticks under the finger (`fireNativeHaptic`): a warning as a note goes to the Trash or for good, a
        // success on pin, archive, restore and Undo. Read as each is felt, so the Haptics switch is followed.
        haptic: ([kind = HapticKind.light]) {
          if (mounted) HapticsProvider.of(context)(kind);
        },
        // Deleted for good: its gist, its runs, its marks, its kept summary and the job to write one go with it.
        onForget: (id) => forgetKept(id, summaries: _voice?.summaries, places: _places),
        // A meeting's write-up stops as its note goes into the trash, and is asked for again as it comes out.
        onTrashed: (note) {
          meetingTrashed(note, prefs: preferences.value, cancelWriteUp: _voice?.cancelWriteUp, summaries: _voice?.summaries);
          _places?.setPendingTag(note.id, null);
        },
        onRestored: (note) => unawaited(resumeWriteUp(note, prefs: preferences.value, summaries: _voice?.summaries)),
      )..addListener(_changed);

  /// The note actions (a delete waiting on its Undo), the walkthrough or the way into an account changed.
  void _changed() {
    _reads.changed();
    // The notes changed: a meeting's note may have been written by the service, and a write-up's result may wait.
    _voice?.notesChanged();
    _tick.tell();
  }

  // ---- what changed, and who is told (lib/root/selected.dart) ---------------------------------------------------

  /// Told by everything the root is told by. Each part of the app the root puts on screen listens to it and asks,
  /// each time, whether what it reads is another value: the part that reads it is built again, and no other.
  final RootTick _tick = RootTick();

  /// Counted up each time a sync pass changed notes, for an open tape to read its phrases again: phrases that came
  /// alone change nothing the list holds (Matt, 2026-10-24: "when clicking on meetings it doesn't load the
  /// transcript").
  final ValueNotifier<int> _notesSynced = ValueNotifier<int>(0);

  /// The root draws nothing that changes: what it puts on screen is made once ([_whole]) and each part of it is
  /// built again by itself. So a change to what the root holds (a sheet opened, voice made) is not a build of the
  /// root, which would build nothing: the parts are told, and the ones that read it draw it.
  @override
  void setState(VoidCallback fn) {
    fn();
    _tick.tell();
    // A frame follows, as one followed every setState: what waits for the next frame (`_afterFrame`) is not left
    // waiting where no part had anything to draw.
    if (mounted) WidgetsBinding.instance.ensureVisualUpdate();
  }

  /// What has no one value to compare is counted, and a part that reads it selects its count: the account (who is
  /// signed in, the organizations, the feed, the shares), where the sync stands, who is in an organization's notes,
  /// voice (a meeting's state, whether the phone may notify, whether the AI can run), the models and their
  /// fetches, the app's updates, the AI of the note on screen, and what is known of the tapes on this device.
  int _accountAt = 0, _syncAt = 0, _presenceAt = 0, _voiceAt = 0, _modelsAt = 0, _updatesAt = 0, _aiAt = 0, _tapesAt = 0;

  /// Any preference at all, for the two parts that hand the whole of them on (a note's desk, the palette): the
  /// others select the fields they read. Counted, not compared: two sets of preferences are told apart by writing
  /// both out.
  int _prefsAt = 0;

  void _prefsChanged() {
    _prefsAt += 1;
    _tick.tell();
    // Advanced chosen: the example notes, for a library that began with the sample alone (GHST-103).
    unawaited(_settleStarterExamples());
  }

  void _accountChanged() {
    _accountAt += 1;
    _tick.tell();
  }

  /// Where the sync stands changes twice for every save it sends: it is the launch screen's line and the account's
  /// own sheets', and no screen of notes reads it.
  void _syncChanged() {
    _syncAt += 1;
    _tick.tell();
    // A pass finished: the trash is as the account has it, so what has waited its thirty days may go.
    if (_services?.engine?.status.value.phase == 'idle') _purgeTrash();
  }

  /// What the account is listened to by, less where its sync stands (`AccountServices.changes` is all of them).
  static List<Listenable?> _accountSays(AccountServices services) => [services.account, services.orgs, services.orgKeys, services.feed, services.shares, services.liveTyping];

  /// The notes every screen shows: none in the Trash, none a pending delete is holding back. The same list for as
  /// long as the library's, the trash and what is held back are the same, and while the notes in it are.
  List<Note> get _shown {
    final all = _library.value;
    final held = _trash.value;
    final hidden = _made?.hidden ?? const <String>{};
    if (identical(all, _shownOf) && identical(held, _shownLess) && identical(hidden, _shownHid)) return _shownNow;
    _shownOf = all;
    _shownLess = held;
    _shownHid = hidden;
    final next = [
      for (final note in outOfTrash(all, held))
        if (!hidden.contains(note.id)) note,
    ];
    var same = next.length == _shownNow.length;
    for (var i = 0; same && i < next.length; i += 1) {
      same = identical(next[i], _shownNow[i]);
    }
    return same ? _shownNow : _shownNow = List.unmodifiable(next);
  }

  List<Note>? _shownOf;
  TrashHeld? _shownLess;
  Set<String>? _shownHid;
  List<Note> _shownNow = const [];

  /// Whether [now] is [was] but for the note [id], which is in both: every other note the same object as it was
  /// and in the order it was. An open note saved is this: it is another object, at the head of the list now.
  static bool _sameButFor(List<Note> was, List<Note> now, String id) {
    if (was.length != now.length) return false;
    var i = 0, j = 0, found = 0;
    while (i < was.length || j < now.length) {
      if (i < was.length && was[i].id == id) {
        i += 1;
        found |= 1;
      } else if (j < now.length && now[j].id == id) {
        j += 1;
        found |= 2;
      } else if (i < was.length && j < now.length && identical(was[i], now[j])) {
        i += 1;
        j += 1;
      } else {
        return false;
      }
    }
    return found == 3;
  }

  /// A number that is another whenever any note but [id] changed, came or went, and the same through a change to
  /// [id] alone: what the screen of the note [id] reads of the library.
  int _notesBut(String id) {
    final all = _library.value;
    final was = _butOf;
    if (id != _butFor || was == null) {
      _butFor = id;
      _butAt += 1;
    } else if (!identical(all, was) && !_sameButFor(was, all, id)) {
      _butAt += 1;
    }
    _butOf = all;
    return _butAt;
  }

  String? _butFor;
  List<Note>? _butOf;
  int _butAt = 0;

  /// The notes the shell was last built with, and what it drew of the one on screen: its title, and whether it is
  /// a canvas or a notebook (a tab's name, and whether its menu offers Rename). Read from the note as that build
  /// had it, the first time a change is measured against it.
  List<Note> _shellNotes = const [];
  ({List<Note> of, String id, String title, bool named})? _shellDrew;

  ({List<Note> of, String id, String title, bool named})? _drewOf(List<Note> built, String id) {
    final had = _shellDrew;
    if (had != null && identical(had.of, built) && had.id == id) return had;
    for (final note in built) {
      if (note.id != id) continue;
      // Read and not kept: the reading kept for this note is of its words as they are now.
      final facts = NoteFacts.read(note.body);
      return _shellDrew = (of: built, id: id, title: facts.title, named: facts.isBook || facts.isCanvas);
    }
    return _shellDrew = null;
  }

  /// The notes as the shell is to draw them: the ones a screen shows, but the list it was last built with while
  /// that differs only by the note on screen, saved, and the shell draws nothing of the difference. Its tab says
  /// the title its editor has (lib/core/live_titles.dart), so a save that leaves the title and the kind of note as
  /// they were changes no tab; and with no index beside the note (it is no notebook, no page of one, no numbered
  /// chapter) the aside has nothing to read of it. The shell is handed the notes as they now are all the same,
  /// without a build ([AppShellState.takeNotes]): what its screens list, and a note it is asked to open, are never
  /// behind. The page's own list is not read again for an editor's save at all.
  List<Note> get _shellDraws {
    final shown = _shown;
    final built = _shellNotes;
    if (identical(shown, built)) return built;
    final shell = _shell.currentState;
    final on = shell?.shown;
    if (shell == null || on == null || _asideFor != on || _aside != null || !_sameButFor(built, shown, on)) return shown;
    final drew = _drewOf(built, on);
    final now = _library.noteOf(on);
    if (drew == null || now == null || drew.named || chapterOf(drew.title) != null) return shown;
    final facts = NoteFacts.of(now);
    if (facts.title != drew.title || facts.isBook || facts.isCanvas) return shown;
    shell.takeNotes(shown);
    return built;
  }

  /// The notes in the Trash, read once per change to the notes or to the trash.
  List<Note> get _trashed {
    final all = _library.value;
    final held = _trash.value;
    if (identical(all, _trashedOf) && identical(held, _trashedIn)) return _trashedNow;
    _trashedOf = all;
    _trashedIn = held;
    return _trashedNow = inTrash(all, held);
  }

  List<Note>? _trashedOf;
  TrashHeld? _trashedIn;
  List<Note> _trashedNow = const [];

  /// The notes made in this run that have no file yet (`CoreLibrary.isDraft`): the core leaves them out of its
  /// list. Read once per change to the notes, and the same set while the same notes are drafts.
  Set<String> get _drafts {
    final library = _library;
    if (library is! CoreLibrary) return const {};
    final all = library.value;
    if (identical(all, _draftsOf)) return _draftsNow;
    _draftsOf = all;
    final next = {
      for (final note in all)
        if (library.isDraft(note.id)) note.id,
    };
    return setEquals(next, _draftsNow) ? _draftsNow : _draftsNow = next;
  }

  List<Note>? _draftsOf;
  Set<String> _draftsNow = const {};

  /// The note of the meeting being recorded now. As last known: asking the service afresh tells its listeners.
  String? get _recordingNow {
    final meeting = _voice?.live?.state;
    return (meeting?.recording ?? false) ? meeting?.noteId : null;
  }

  late final Stored _stored = widget.stored ?? stored;

  final GlobalKey<AppShellState> _shell = GlobalKey<AppShellState>();
  final GlobalKey<CommandBarState> _commands = GlobalKey<CommandBarState>();

  /// Settings asked for at a page, by when it was asked (settings/settings_sheet.dart `toPage`).
  SettingsTarget? _settingsPage;

  /// Which list simple mode's home page is on, Notes or To-dos (GHST-105, lib/simple/simple_home.dart): this
  /// device's own, never synced, and not kept across a launch.
  SimpleTab _simpleTab = SimpleTab.notes;

  void _search() => _commands.currentState?.show();

  /// A note's menu, from a long press or a right-click on it in any list (notes/note_menu.dart).
  final NoteMenuController _menu = NoteMenuController();

  late bool _launching = widget.launch && widget.launchSeat == null;

  /// What the launch screen reads of the root, where it is drawn over it from outside (`GhostRoot.launchSeat`).
  LaunchFacts _launchFacts() => (loading: _launchLoading, notes: _launchNotes, sync: _launchSync, recording: _meetingRecording);

  /// Whether the launch screen is still opening the notes: until they are read, and, in a build with an account,
  /// until what this device kept of it has been read too (`_account`, a moment later). The screen waits for a
  /// signed-in device's sync, and until the kept session is read nobody can say whether there is one to wait for:
  /// with the notes read first, it had begun to leave before the sync's line was there.
  bool get _launchLoading => !_read || (_services != null && _gate == null);

  /// How many notes the launch screen says there are: every one the library holds that is not in the archive
  /// (App.tsx: `notes.filter((n) => !n.archivedAt).length`, of the library's notes, the Trash's among them).
  int get _launchNotes {
    var count = 0;
    for (final note in _library.value) {
      if ((note.archivedAt ?? 0) == 0) count += 1;
    }
    return count;
  }

  /// Where the account's sync stands, as the launch screen's third line says it (`syncStatus.phase`): the engine's
  /// own word, and, until it has said one, that a signed-in device is syncing.
  ///
  /// The page's engine is started with the page: its session is read from the page's own storage at once, it is
  /// renewed and the pass begun, and "Syncing your devices" is on the launch screen within its first moments, ticked
  /// "In sync" when the pass ends. Here the same pass is begun after the library's core has opened, the root has
  /// been made under the launch screen and the kept session has been read from the phone's secure store, each of
  /// them a wait; the engine's first word came when the screen was already leaving or gone, and a signed-in launch
  /// showed the notes' line and nothing else (Matt, on his phone, 2026-10-11: "it only shows a check and the note
  /// count now"). The launch pass is not in doubt once a session is in hand, the key with it, and nothing says
  /// local only: it is the engine's first act (lib/sync/engine.dart `start`). So from then the line says what is
  /// happening, and from the engine's first word on it says the engine's.
  SyncPhase get _launchSync {
    final services = _services;
    final engine = services?.engine;
    if (services == null || engine == null) return SyncPhase.off;
    final said = launchSyncOf(engine.status.value.phase);
    if (said != SyncPhase.off) {
      _syncSaid = true;
      return said;
    }
    if (_syncSaid) return SyncPhase.off;
    return services.signedIn && services.unlocked && !preferences.value.localOnly ? SyncPhase.syncing : SyncPhase.off;
  }

  /// Whether the engine has said where its sync stands since the root was made.
  bool _syncSaid = false;

  bool _meetingRecording() => _voice?.live?.state?.recording ?? false;
  bool get _read => !_library.loading;
  bool _settings = false;

  /// Stops answering the desktop's keys and menu (lib/root/desktop_wiring.dart).
  VoidCallback? _stopDesktop;

  /// The workspace sheet: shut, a new one (inside [parent] from a folders' strip's New folder, GHST-107), or one
  /// to change.
  ({Workspace? editing, String? parent, bool deleting})? _workspace;

  /// The Trash's sheet (lib/notes/trash_sheet.dart): shut, open on its list, or on one note's page ([note]).
  ({String? note})? _trashSheet;

  /// When the trash last let go of the notes whose thirty days were up, in this run ([_purgeTrash]).
  int? _purgedAt;

  /// The blur at the edges is the art's own switch (lib/art/blur_edge.dart), which follows the preference.
  late final ValueListenable<bool> _wispEdge = preferences.select((prefs) => prefs.wispEdge);
  void _smoke() => BlurEdgeSettings.instance.wanted = _wispEdge.value;

  @override
  void dispose() {
    _stopDesktop?.call();
    _claude.stop();
    _talk?.dispose();
    _claudeInbox.dispose();
    _claude.dispose();
    _organize.dispose();
    _wispEdge.removeListener(_smoke);
    _localOnly.removeListener(plugins.preferencesChanged);
    _localOnly.removeListener(_localOnlyMoved);
    _pluginsHeard.removeListener(_pluginsMoved);
    claudeSettings.removeListener(_claudeKeyMoved);
    _guide?.removeListener(_changed);
    // The updates are the process's, as the core is: let go of, never disposed.
    widget.updates?.removeListener(_updatesChanged);
    if (widget.guide == null) _guide?.dispose();
    _stopLinks?.call();
    _stopShares?.call();
    _extras?.dispose();
    _previews.dispose();
    _embeds.dispose();
    _unwatchMeeting?.call();
    _unhearRecordings?.call();
    if (identical(meetingSlackPoster, _slackMeetings)) meetingSlackPoster = null;
    if (identical(meetingDiscordPoster, _discordMeetings)) meetingDiscordPoster = null;
    // A method's tear-off is equal to another of it, never the same object.
    if (discordShareLink == _discordShare) {
      discordShareLink = null;
      discordCanShare = () => discordShareLink != null;
    }
    if (_pictures != null && identical(lovartPictureStore, _pictures)) lovartPictureStore = null;
    if (identical(lovartBannerJob, _bannerJob)) lovartBannerJob = null;
    lovartBannerRun.removeListener(_bannerMoved);
    _bannerJob.dispose();
    _lovartHold.dispose();
    _aiReady.dispose();
    _builtReport.dispose();
    _stopFills?.call();
    _guideModels?.dispose();
    _stopGistHold?.call();
    _stopGistModels?.call();
    _availability?.removeListener(_voiceChanged);
    _availability?.dispose();
    _deviceFacts?.dispose();
    _voice?.live?.canNotify.removeListener(_voiceChanged);
    _voice?.models?.removeListener(_modelsChanged);
    _voice?.recorder.voiceModel.removeListener(_tick.tell);
    _noteAi?.removeListener(_aiChanged);
    _noteAi?.reviewStage.removeListener(_aiChanged);
    _voiceLife?.dispose();
    _capture?.dispose();
    // A voice a test brought is the test's to let go.
    if (widget.voice == null) _voice?.dispose();
    _libraryChanges.removeListener(_reads.changed);
    _linkIndex.dispose();
    _calendarLife?.dispose();
    calendar.stop();
    _webhooksLife?.dispose();
    webhooks.stop();
    _library.removeListener(_tick.tell);
    _workspaces.removeListener(_tick.tell);
    _trash.removeListener(_tick.tell);
    preferences.removeListener(_prefsChanged);
    final services = _services;
    if (services != null) {
      for (final says in _accountSays(services)) {
        says?.removeListener(_accountChanged);
      }
      services.engine?.status.removeListener(_syncChanged);
    }
    _life?.dispose();
    _gate?.dispose();
    _wired?.live.presence.removeListener(_presenceChanged);
    _wired?.dispose();
    _pictures?.dispose();
    widget.launchSeat?.rise(_launchFacts);
    _made?.dispose();
    _menu.removeListener(_tick.tell);
    _menu.dispose();
    _tick.dispose();
    _notesSynced.dispose();
    // What the root made that is listened to from outside it, or listens: let go, so a root started over (a reset)
    // does not leave the last one's library reading the notes at every return to the app, nor its trash and
    // workspaces following the preferences. Each is safe to ask after: a save still on its way when the root goes
    // lands in a library that tells nobody. The library and the workspaces a test handed in are the test's; and
    // the ones made in memory hold nothing outside themselves, and are left to be asked by whatever is still
    // finishing.
    _versionsStore.dispose();
    _keptSpaces?.dispose();
    final trash = _trash;
    if (trash is KeptTrash) trash.dispose();
    final library = _library;
    if (widget.library == null && library is CoreLibrary) library.dispose();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    _smoke();
    _wispEdge.addListener(_smoke);
    // Local only turning on or off changes which plugins are on without a switch moving: the registry is told of
    // that, and not of a tab opened or a note filed, which told everything that draws a plugin to draw again.
    _localOnly.addListener(plugins.preferencesChanged);
    // And lets the fills that were parked under it go on (ai/fills/queue.ts `resumeParked`).
    _localOnly.addListener(_localOnlyMoved);
    // Who Claude's page in Settings reads as signed in (plugins/claude): this build's account, where it has one.
    claudeHandle = () => _services?.session?.handle;
    // Where Lovart's images are kept before their lines are written (lib/plugins/lovart/keep.dart).
    if (_pictures != null) lovartPictureStore = _pictures;
    // Settings › Lovart's run over the recent notes, the root's job: one the app went under goes on, once Lovart is
    // on and its keys are read.
    lovartBannerJob = _bannerJob;
    lovartBannerRun.addListener(_bannerMoved);
    _bannerMoved();
    unawaited(_bannerJob.resume(changes: _pluginsHeard));
    _lovartHold.start();
    // A note too long for one Discord message is cut with its share link, made by the app's own share, where this
    // build has an account signed in (lib/plugins/discord/discord.dart).
    discordShareLink = _discordShare;
    discordCanShare = () => _services?.shares != null && (_services?.signedIn ?? false);
    // The plugins' switches, for what the root draws of them: Claude on every dock, its chat and its bar.
    _pluginsHeard.addListener(_pluginsMoved);
    _claudeKeyed = claudeSettings.hasKey;
    claudeSettings.addListener(_claudeKeyMoved);
    _guide?.addListener(_changed);
    _libraryChanges.addListener(_reads.changed);
    // The app's own Claude: its settings read, and the "Ask Claude" note heard (docs/CLAUDE_APP.md).
    _startClaude();
    _linkIndex = LinkIndexer(notes: () => _shown, changes: _libraryChanges);
    // The calendars, read for the life of the app (lib/calendar/calendar.dart, docs/CALENDAR.md): now, on their
    // beats, and when the app comes back to the front; the to-dos a pass puts on Google's are the library's.
    // Only while the Calendar plugin is on (lib/plugins/calendar), which a device that had a calendar before it was a
    // plugin finds on. Where the registry has no such plugin (a test's), the calendars are read as they always were.
    final calendarHere = _pluginsHeard.byId(calendarManifest.id) != null;
    if (calendarHere) _pluginsHeard.adopt(calendarManifest.id, inUse: calendarInUse(calendar));
    calendar.start(notes: () => _reads.queryNotes, notesChanged: _library, on: calendarHere ? calendarOn : null, switched: _pluginsHeard);
    _calendarLife = AppLifecycleListener(onResume: calendar.resumed);
    // The Contacts plugin (lib/plugins/contacts, lib/integrations/contacts): the phone's contacts read where it is
    // on, and the people the notes name, for its page. Its switch is the plugin's.
    phoneContacts.start(bodies: () => [for (final note in _reads.queryNotes) note.body], switched: contactsSwitch());
    // The outgoing webhooks (lib/integrations/webhooks, docs/INTEGRATIONS.md): what this device changes in a note,
    // told to their URLs; a send still waiting goes as the app goes behind another. Matched rather than promoted, as
    // the sync engine's touched is.
    if (_library case final CoreLibrary core) {
      webhooks.start(saves: core.savedHere, notes: () => _shown);
      _webhooksLife = AppLifecycleListener(onHide: () => unawaited(webhooks.flush()));
    }
    // What the parts on screen read, each told as it changes (lib/root/selected.dart): after the reads above have
    // been told, so a part built again reads the library as it now is.
    _library.addListener(_tick.tell);
    // A note's menu opening: its part is built with the notes as they are now, before the menu looks its note up.
    _menu.addListener(_tick.tell);
    _workspaces.addListener(_tick.tell);
    _trash.addListener(_tick.tell);
    preferences.addListener(_prefsChanged);
    final services = _services;
    if (services != null) {
      for (final says in _accountSays(services)) {
        says?.addListener(_accountChanged);
      }
      services.engine?.status.addListener(_syncChanged);
    }
    // The updates: drawn again as they change, not while a meeting or a take records, and looked for from now
    // (`useUpdates`).
    widget.updates
      ?..addListener(_updatesChanged)
      ..recording = (() => _voice?.live?.state?.recording ?? false)
      ..taking = (() => _shell.currentState?.screen.isRecording ?? false)
      ..start();
    // The launch screen over the root, where there is one, reads the root from here on.
    widget.launchSeat?.sit(_launchFacts, _tick);
    _open();
    unawaited(_account());
    unawaited(_speakUp());
    // A desktop's keys and the Mac's menu bar (lib/root/desktop_wiring.dart): Command-N, Command-R, the palette, Settings.
    _stopDesktop = wireDesktopCommands(
      onPlace: () => _shell.currentState?.screen.isPlace ?? false,
      covered: () => _settings || _newSheet || (_commands.currentState?.isOpen ?? false),
      newNote: _new,
      refresh: () async {
        await _library.refresh();
        await _services?.engine?.syncNow();
      },
      status: () {
        final now = _services?.engine?.status.value;
        return (phase: now?.phase ?? 'idle', message: now?.message);
      },
      say: (message) {
        if (mounted) _say(context, message);
      },
      palette: () => _commands.currentState?.show(),
      today: () => _organize.today(),
      settings: () {
        if (mounted) setState(() => _settings = true);
      },
    );
  }

  /// What this device kept of an account, then the sync for as long as the app is open, and the way in where it is
  /// due. Nothing at all in a build with no account.
  Future<void> _account() async {
    final services = _services;
    if (services == null) return;
    final wired = _wired;
    if (wired != null) {
      await wired.start();
      // The relay's socket goes while the app is behind another, and is back with it.
      _life = AppLifecycleListener(onResume: wired.resumed, onPause: wired.paused);
      wired.live.presence.addListener(_presenceChanged);
    }
    final follow = _follow;
    if (follow != null) _wireFollow(follow);
    if (!mounted) return;
    // Not on an open by the side key, whose person is already mid-sentence: the recording comes first, as it does
    // for the guide (shell/useAccountGate.ts).
    final byKey = (widget.voice?.assistant ?? widget.voiceMaking?.assistant ?? false) && (widget.voice?.launch ?? widget.voiceMaking?.launch) == 'capture';
    setState(() => _gate = AccountGateState(services: services, launchedByKey: byKey, kept: _stored)..addListener(_changed));
  }

  void _toAccount() => setState(() {
        _settings = true;
        _settingsPage = SettingsTarget('account', nonce: DateTime.now().microsecondsSinceEpoch);
      });

  /// Reads the library, and gives a fresh one the starter notes once (core/seed.ts: `glyph-sample-note`).
  Future<void> _open() async {
    await _library.load();
    if (!_notesRead.isCompleted) _notesRead.complete();
    // The build's test report, from here on, for whoever has Developer mode on: never ahead of the notes.
    if (mounted) _builtReport.start();
    // At launch, which opens on the home page: what the phone let go of before it was left.
    if (mounted) unawaited(_takeBack.look());
    // And a voice command's Undo, which went with the app if it was stopped inside the toast's ten seconds.
    if (mounted) unawaited(_offerCommandUndo());
    // And the tags that waited for a pass or a note's first words while the app was away.
    if (mounted) _settleTags();
    // And the notes whose thirty days in the Trash are up, on a device that does not sync: one that does waits for
    // its first pass, so a note brought back on another device is not deleted here before the news of it lands.
    if (mounted && _services?.session == null) _purgeTrash();
    // The links that opened the app wait for the notes to be read, so a copy lands in a library that is there and
    // a note opened is one the list has.
    final links = widget.links;
    if (mounted && links != null) {
      _stopLinks = followAppLinks((link) {
        // A .ghostex the Mac's Finder opened (macos/Runner/GhostChannels.swift `arrived`): read back as Settings asks.
        final finder = runsAsMacApp && _ghostex != null ? ghostexLinked(link) : null;
        if (finder != null) return _readGhostex(finder);
        // A new note, a voice note, today's, the palette, or a note at a line: the phone's own ways in.
        if (followPhoneEntry(link, _phoneDoor)) return;
        // The kind and never the link: a share's link carries its key.
        debugPrint('[glyph] a link opened the app: ${readAppLink(link)?.runtimeType ?? 'none of the app\'s'}');
        openAppLink(link, _door, onError: (failure) => debugPrint('[glyph] could not follow the link that opened the app: $failure'));
      }, links);
    }
    // And what another app shared, which waits for the notes for the same reasons: its sheet offers them to add to.
    final shares = widget.shares;
    if (mounted && shares != null) {
      _stopShares = followShares((share) {
        // A .ghostex opened from Files, or shared here: Settings › Import reads it back, as the person chooses.
        final opened = _ghostex != null ? ghostexShared(share) : null;
        if (opened != null) return _readGhostex(opened);
        setState(() => _sharing.add(share));
      }, shares);
    }
    // Reminders and the home screen, kept in step with the notes from here on.
    if (mounted) _extras?.start();
    if (!_real || !mounted) return;
    final seeded = _stored.flag('glyph-sample-note', unreadable: true);
    final examples = _stored.flag(starterExamplesKey, unreadable: true);
    if (seeded.isMarked) {
      // An install from before there was a choice (GHST-103) was given every starter at once: never again.
      if (!examples.isMarked) examples.mark();
      return;
    }
    seeded.mark();
    if (_library.value.isNotEmpty) {
      examples.mark();
      return;
    }
    // The sample note alone (Matt, 2026-10-18: "a simple install starts with the sample note only"); the tickets, the
    // board, the notebook and the journal come with Advanced (_settleStarterExamples), chosen on the walkthrough's
    // page after this.
    for (final note in starterNotes(DateTime.now().millisecondsSinceEpoch, examples: false)) {
      // The sample note, made last, with its picture (`addSampleNote`).
      await _library.createNote(identical(note.body, sampleNoteBody) ? sampleNoteWith(await _samplePicture()) : note.body);
    }
    await _settleStarterExamples();
  }

  /// The key that says the example notes were given, or passed over (GHST-103).
  static const String starterExamplesKey = 'glyph-starter-examples';

  /// The example notes, once Advanced is chosen (the walkthrough, home's card, Settings) for a library that began
  /// with the sample alone: the three tickets and their notebook, the board, the journal. Given once, and only to a
  /// library that still holds nothing but the sample: a person with notes of their own, or an account's notes just
  /// arrived, is not handed examples they never asked for.
  Future<void> _settleStarterExamples() async {
    if (!_real || !mounted || !_notesRead.isCompleted) return;
    final now = preferences.value;
    if (!now.experienceChosen || now.simple) return;
    final examples = _stored.flag(starterExamplesKey, unreadable: true);
    if (examples.isMarked) return;
    examples.mark();
    if (_library.value.length > 1) return;
    for (final note in starterExamples(DateTime.now().millisecondsSinceEpoch)) {
      await _library.createNote(note.body);
    }
  }

  /// A voice command applied just before the app was stopped: its Undo was a toast that went with the app, so it is
  /// offered once more as the app opens, for ten seconds (shell/useHousekeeping.ts). The store offers the guarded undo
  /// only while the note is exactly what the command left; a later edit makes the press a conflict, never a loss.
  Future<void> _offerCommandUndo() async {
    final PendingCommandUndo? pending;
    try {
      pending = await _library.latestCommandMutation();
    } catch (_) {
      return;
    }
    if (pending == null || !mounted) return;
    GlacierToast.of(context).toast(
      message: Text(pending.kind == 'create' ? 'Voice command created a note.' : 'Voice command changed a note.'),
      duration: const Duration(seconds: 10),
      action: GlacierToastAction(
        label: 'Undo',
        onPress: () => unawaited(_library.undoCommandMutation(pending!.mutationId).then<void>((_) => _library.refresh(), onError: (Object _) {})),
      ),
    );
  }

  /// The screen or the open tabs changed: a look at what was left (`takeBack`'s effect). After the frame, when the
  /// shell says where the person is now.
  bool _looking = false;
  void _left() {
    if (_looking) return;
    _looking = true;
    WidgetsBinding.instance.ensureVisualUpdate();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _looking = false;
      if (mounted) unawaited(_takeBack.look());
    });
  }

  void _delete(String id) {
    final note = _library.noteOf(id);
    if (note != null) _actions.remove(note);
  }

  /// The + (`setNewSheet(true)`): the sheet of what it makes, one for every +, so the choice reads the same
  /// wherever it is offered. From an organization's +, what is made is filed in its workspace ([into]); and from any
  /// + while an organization's workspace or a folder inside it is chosen, in that, so the sheet offers only what may
  /// be the team's (no Today, no journal entry, no copy of a shared link), as the dashboard's + does.
  void _plus([String? into]) => setState(() {
        final chosen = _workspaces.value.current?.id;
        _newInto = into ?? (chosen != null && _workspaces.orgOf(chosen) != null ? chosen : null);
        _newSheet = true;
      });

  /// A notebook from the +, or a journal from the same sheet with Journal chosen (`newBook`, `newJournal`).
  void _newBook(NewBookKind kind, [String? into]) => setState(() {
        _bookInto = into;
        _bookSheet = kind;
      });

  List<String> _notesIn(String workspaceId) => [
        for (final note in _library.value)
          if (_workspaces.value.of[note.id] == workspaceId) note.id,
      ];

  @override
  Widget build(BuildContext context) {
    if (ghostPerf) Perf.count('root.build');
    // A note drawn small anywhere under here (a card on the home page, a row of the sidebar) draws its pictures and
    // a film's still from the app's own (lib/home/note_peek.dart).
    return PeekPictures(store: _pictures, child: _whole);
  }

  /// Whether something unread and wanted waits, as last counted (`_unread`, lib/root/root_parts.dart).
  int _unreadAt = -1;
  NotificationPrefs? _unreadFor;
  bool _unreadNow = false;

  /// A change to what the root holds, and the parts told: for the root's code in its other files
  /// (lib/root/root_commands.dart, root_voice.dart, root_parts.dart), since `setState` is the framework's to call
  /// from the class itself.
  void _told(VoidCallback change) => setState(change);

  void _openSettings() => setState(() => _settings = true);

  /// Settings at [page], and at [setting] on it when one is named. A page that was the plugins' (`plugins`,
  /// `plugins/<id>`) is the Market now, and the link lands there instead ([marketLanding]).
  void _openSettingsAt(String page, {String? setting}) {
    final market = marketLanding(page);
    if (market != null) return _showMarket(plugin: market.plugin);
    setState(() {
      _settings = true;
      _settingsPage = SettingsTarget(page, setting: setting, nonce: DateTime.now().microsecondsSinceEpoch);
    });
  }

  /// The Market (lib/market/market_screen.dart), at [plugin]'s page when one is named: Settings shut first, from its
  /// row or a link that once went to its Plugins.
  void _showMarket({String? plugin}) {
    if (_settings) _closeSettings();
    _shell.currentState?.showMarket(plugin: plugin);
  }

  void _closeSettings() => setState(() => _settings = false);

  /// A `ghostmd://market` link that came in Simple mode, where the Market is not shown: a word saying where it is,
  /// and the way to Appearance's Mode card to choose Advanced ([_RootDoor.openPlace]).
  void _marketInSimple() {
    if (!mounted) return;
    GlacierToast.of(context).toast(
      message: const Text('The Market is part of Advanced mode.'),
      duration: const Duration(seconds: 8),
      action: GlacierToastAction(label: 'Mode', onPress: () => _openSettingsAt('experience')),
    );
  }

  /// A .ghostex opened from the phone's Files or the Mac's Finder: Settings › Import, where it waits for the person
  /// ([ghostexWaiting], lib/settings/panes/ghostex_cards.dart).
  void _readGhostex(GhostexChosen chosen) {
    ghostexWaiting.value = chosen;
    _openSettingsAt('import');
  }

  void _trashNotes(Iterable<String> ids) => ids.forEach(_trash.trashNote);

  /// The Trash, as a section of its own (lib/notes/trash_sheet.dart), on its list or on [note]'s page.
  void _openTrash([String? note]) => setState(() => _trashSheet = (note: note));

  /// Whether a note is an organization's: filed in its workspace or a folder under it.
  bool _isTeamNote(String id) {
    final space = _workspaces.workspaceOf(id);
    return space != null && _workspaces.orgOf(space.id) != null;
  }

  /// The notes that have waited [trashKeeps] in the Trash, deleted for good (lib/core/trash.dart `expiredInTrash`):
  /// at launch on a device that does not sync, after a pass on one that does, and at most once an hour. An
  /// organization's note waits for the person's own Empty: deleting it for good deletes it for the whole team.
  void _purgeTrash() {
    final now = widget.clock?.call() ?? DateTime.now().millisecondsSinceEpoch;
    final last = _purgedAt;
    if (_library.loading || (last != null && now - last < Duration.millisecondsPerHour)) return;
    _purgedAt = now;
    final due = expiredInTrash(_trashed, _trash.value, now, kept: _isTeamNote);
    if (due.isNotEmpty) unawaited(_actions.purge(due));
  }

  void _organizationSettings(String id) => _openOrganizationSettings(id, OrganizationFrom.settings);

  /// Everything the root puts on screen, made once: the shell, and over it Settings, the palette, a note's menu,
  /// the sheets, the walkthrough and the launch screen. Each is a part, built again when what it reads changed; one
  /// that is not there (a sheet that is shut, the launch screen once the app is open) is nothing, in its place.
  late final Widget _whole = _wholeOf();
}

/// Where a member is in note [noteId], for Jump to cursor (`at.cursor ?? at.pointer`): their caret, or their
/// pointer's spot on a canvas as the desk reads one (`{x, y}`); null where nobody there has a place in it.
Map<String, Object?>? jumpPlace(List<Seen> seen, String noteId) {
  Map<String, Object?>? place;
  for (final each in seen) {
    final at = each.at;
    if (at == null || at.note != noteId) continue;
    place = at.cursor ?? at.pointer?.toJson() ?? place;
  }
  return place;
}

/// What the app does with each kind of link that opened it (`useAppLinks`' `fork`, `openNote`, `openPlace`, `join`).
class _RootDoor implements AppLinkDoor {
  const _RootDoor(this.root);
  final _GhostRootState root;

  @override
  Future<void> fork(String link) => root._forkFromLink(link);

  @override
  Future<void> openNote(String id) => root._openNoteFromLink(id);

  /// The notifications drawer, or an organization's dashboard, which only a build with an account has, or the Market
  /// where a `ghostmd://market` link lands (the website's market page, landing/market.html). The Market is Advanced
  /// mode's, as every way into it is (lib/market/market_screen.dart): in Simple the link is answered with a word
  /// saying so and the way to the Mode card, and the mode is the person's to change, never the link's.
  @override
  void openPlace(LinkedPlace place) {
    final shell = root._shell.currentState;
    if (shell == null) return;
    switch (place) {
      case NotificationsPlace():
        shell.showNotifications();
      case OrganizationPlace(:final orgId):
        if (root._services != null) shell.openOrganization(orgId);
      case MarketPlace():
        if (preferences.value.simple) return root._marketInSimple();
        if (root._settings) root._closeSettings();
        shell.showMarket(link: place);
    }
  }

  @override
  void join(String code) => root._joinFromLink(code);
}

/// What the app does with the phone's own ways in (lib/home_screen/phone_entries.dart): each once the notes are read,
/// which is when a link is followed at all.
class _PhoneDoor implements PhoneEntryDoor {
  const _PhoneDoor(this.root);
  final _GhostRootState root;

  /// Once the shell is there to be asked (a link that started the app may be followed under the launch screen), and
  /// with what covered it put away: Settings, a sheet, an organization's settings, the notes' card and the
  /// notifications. The person asked for a note from outside the app, and is to see it.
  void _withShell(void Function(AppShellState shell) then) {
    void go(AppShellState shell) {
      if (root._settings || root._newSheet || root._bookSheet != null || root._organization != null || root._newOrganization) {
        root._told(() {
          root._settings = false;
          root._newSheet = false;
          root._bookSheet = null;
          root._organization = null;
          root._newOrganization = false;
        });
      }
      shell
        ..closeSidebar()
        ..closeNotifications();
      then(shell);
    }

    final shell = root._shell.currentState;
    if (shell != null) return go(shell);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final later = root._shell.currentState;
      if (root.mounted && later != null) go(later);
    });
  }

  /// A new note, ready to type in: the caret in line 1 and the keyboard up, asked for again once the app is in front.
  @override
  void newNote() => _withShell((_) {
        root._new();
        raiseKeyboardSoon();
      });

  /// A new note filed in [workspaceId], as the folder browser's New note files one in the level it shows (an
  /// organization's folder's note is the team's by that filing); a plain new note where the workspace is gone.
  @override
  void newNoteIn(String workspaceId) => _withShell((_) {
        root._new(root._workspaces.value.list.any((w) => w.id == workspaceId) ? workspaceId : null);
        raiseKeyboardSoon();
      });

  /// A new note from the built-in "A checklist", as its card on a new note's blank page makes one: the caret in its
  /// name, a to-do under it, and taken back if it is left without a word of the person's own.
  @override
  void checklist() => _withShell((_) {
        root._new(null, builtIns.firstWhere((template) => template.kind == TemplateId.checklist));
        raiseKeyboardSoon();
      });

  /// Talk to Claude, as the dock's orange microphone opens it: where Claude is shown (on, and a key on this device)
  /// and something can hear; the chat where Claude is shown and nothing can hear (or the recorder holds the
  /// microphone); Claude's settings where it is not shown, where both are put right. Voice and the key are read a
  /// moment after the app opens, so a tap that started it waits for them, three seconds at most.
  @override
  void talk() => unawaited(() async {
        await root._voiceKnown.future.timeout(const Duration(seconds: 3), onTimeout: () {});
        await claudeSettings.load().catchError((Object _) {});
        if (!root.mounted) return;
        _withShell((_) {
          if (root._startTalk()) return;
          if (root._claudeShown) return root._openAskClaude();
          root._openSettingsAt('plugin:claude');
        });
      }());

  /// The chat with Claude, as the dock's orange ring opens it; Claude's settings where Claude is not shown.
  @override
  void chat() => unawaited(() async {
        await claudeSettings.load().catchError((Object _) {});
        if (!root.mounted) return;
        _withShell((_) => root._claudeShown ? root._openAskClaude() : root._openSettingsAt('plugin:claude'));
      }());

  /// A new note being recorded into, as the dock's microphone does: the microphone opens on this tap and not before.
  /// Voice is made a moment after the notes are read, so a tap that started the app waits for it, three seconds at
  /// most; a build or a phone with none opens a new note to type in instead.
  @override
  void voiceNote() => unawaited(() async {
        await root._voiceKnown.future.timeout(const Duration(seconds: 3), onTimeout: () {});
        if (!root.mounted) return;
        if (root._capture == null) return newNote();
        _withShell((_) => root._speak());
      }());

  /// Today's note: the daily note the + sheet's Today row and the palette open (lib/root/organize.dart).
  @override
  void today() => _withShell((_) => root._organize.today());

  /// The palette, to type a note's name or a command in.
  @override
  void search() => _withShell((_) => WidgetsBinding.instance.addPostFrameCallback((_) => root._search()));

  /// The icon's Scan document: Google's scanner, then a new note holding the PDF it made, opened
  /// (lib/files/plus_files.dart `scanToNewNote`). Nothing on a device that cannot scan, or when the scanner is left.
  @override
  void scan() => unawaited(() async {
        final String? body;
        try {
          body = await scanToNewNote();
        } catch (failure) {
          debugPrint('[files] the scan was not kept: $failure');
          return;
        }
        if (body == null || !root.mounted) return;
        final note = await root._library.createNote(body);
        if (root.mounted) _withShell((shell) => shell.openNote(note.id));
      }());

  /// A note at a line (a reminder, a Today or Pinned row, a recent note): the line where the item now is, by its
  /// words where lines were written above it since; a note gone or in the Trash opens nothing.
  @override
  void openNoteAt(String noteId, int line, String find) => _withShell((shell) {
        final note = root._library.noteOf(noteId);
        if (note == null || root._trash.isTrashed(noteId)) return;
        final at = line > 0 ? (find.isEmpty ? line : findItemNear(note.body, line, find)) : null;
        if (at == null || at <= 0) return root._openWhereLeft(shell, noteId);
        shell.openNote(noteId, at: 'line:$at');
      });
}
