import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../perf/frame_log.dart';
import 'tabs.dart' show TabGroups, mostTabs;

export 'tabs.dart' show TabGroup, TabGroups, mostTabs;

// Port of the web app's src/app/core/preferences.ts: the look-and-feel knobs, how they are kept, and how they reach
// the tokens.
//
// On the page an app stamps `data-*` attributes on `<html>` and the token CSS keys off them; here the same
// attributes are `GlacierTheme(attrs:)`, which [Preferences.attrs] answers. The one rule that is easy to get wrong is
// the same in both: a value equal to its default must LEAVE THE ATTRIBUTE OUT, because the `:root` block holds the
// defaults and an explicit `data-accent='blue'` matches no selector at all.
//
// Every preference's values are the web's own words (`'dark'`, `'extra-compact'`, `'one-dark'`), kept as strings as
// the TypeScript unions are, so what is stored is the web's stored shape to the letter and a store written by either
// app is read by the other.

// --- themes ------------------------------------------------------------------------------------------------------

/// A named theme of the kit (`THEME_PRESETS`): one side of the page, with the accent that comes with it.
class ThemePresetInfo {
  const ThemePresetInfo(this.scheme, this.accent);

  /// `light` or `dark`.
  final String scheme;
  final String accent;
}

/// The kit's named themes (`THEME_PRESETS`, vendor/@glacier/tokens `theme-presets.ts`).
const Map<String, ThemePresetInfo> themePresets = {
  'dawn': ThemePresetInfo('light', 'red'),
  'boreal': ThemePresetInfo('dark', 'green'),
  'ember': ThemePresetInfo('dark', 'amber'),
  // Four more for the Market (Matt, 2026-10-26: "include some more themes, fonts"): two light, two dark, each its
  // own tint and accent. Sakura's greys are rose, Meadow's sage, Tide's a deep blue-teal, Dusk's violet.
  'sakura': ThemePresetInfo('light', 'purple'),
  'meadow': ThemePresetInfo('light', 'green'),
  'tide': ThemePresetInfo('dark', 'teal'),
  'dusk': ThemePresetInfo('dark', 'purple'),
};

/// Every theme a person can choose (`THEMES`), in the order Settings offers them.
const List<String> themes = ['system', 'light', 'dark', 'dawn', 'boreal', 'ember', 'sakura', 'meadow', 'tide', 'dusk'];

bool isThemePreset(Object? theme) => theme is String && themePresets.containsKey(theme);

bool isTheme(Object? theme) => theme is String && themes.contains(theme);

/// Which side of the page a theme is (`themeScheme`): a named theme is always one, and System follows the device.
String themeScheme(String theme) => themePresets[theme]?.scheme ?? theme;

/// The preferences to set when a theme is chosen (`themeChoice`): the theme, and the accent that comes with a named
/// one. Going back to a plain theme takes the accent back to ink only if it is still the one the named theme put
/// there; an accent chosen on purpose afterwards is left alone.
Preferences themeChoice(String theme, Preferences now) {
  final preset = themePresets[theme];
  if (preset != null) return now.copyWith(theme: theme, accent: preset.accent);
  final was = themePresets[now.theme];
  if (was != null && now.accent == was.accent) return now.copyWith(theme: theme, accent: 'ink');
  return now.copyWith(theme: theme);
}

/// Whether a page in [theme] is dark now (`isDarkNow`), given the device's own brightness for System.
bool isDarkNow(String theme, {required bool platformDark}) {
  final scheme = themeScheme(theme);
  if (scheme == 'dark') return true;
  if (scheme == 'light') return false;
  return platformDark;
}

// --- the other choices -------------------------------------------------------------------------------------------

/// Interface size steps (`UI_SCALES`): every part of the app scaled together; 1 is the kit's own size.
const List<double> uiScales = [0.85, 0.925, 1, 1.1, 1.25];

bool isUiScale(Object? scale) => scale is num && uiScales.contains(scale.toDouble());

/// How the notes sidebar opens on a wide window (`SidebarStyle`).
const List<String> sidebarStyles = ['popover', 'docked'];

bool isSidebarStyle(Object? style) => style == 'popover' || style == 'docked';

/// How the home page lays out the notebooks and notes (`HOME_LAYOUT_IDS`).
const List<String> homeLayoutIds = ['spotlight', 'cards', 'timeline', 'list'];

bool isHomeLayout(Object? layout) => homeLayoutIds.contains(layout);

/// How the top bar is laid out (`TOP_BAR_IDS`). A Strip or a Thumb chosen before the cut reads as Classic.
const List<String> topBarIds = ['classic', 'ledger', 'masthead', 'islands'];

bool isTopBar(Object? style) => topBarIds.contains(style);

/// How much of the app is shown (GHST-103). Matt, 2026-10-17: "allow selecting between simple and advanced mode
/// where simple mode has a much more approachable UI with fancy features hidden behind more". `simple` keeps notes,
/// lists and to-dos in front and the rest behind More; `advanced` is the whole app, as it was before there was a
/// choice.
const List<String> experienceIds = ['simple', 'advanced'];

bool isExperience(Object? value) => experienceIds.contains(value);

/// The kit's density stops (`Density`), tightest first.
const List<String> densities = ['extra-compact', 'compact', 'comfortable', 'spacious', 'more-space'];

/// The accents the kit carries, and `ink`: the app's own, which is no accent at all (`ACCENTS`).
const List<String> accents = ['ink', 'graphite', 'red', 'amber', 'green', 'teal', 'purple'];

bool isAccent(Object? value) => value is String && accents.contains(value);

/// How round a corner is (`ROUNDINGS`): the kit's radius scale multiplied. `round` is the kit's own 1.
const List<String> roundings = ['square', 'soft', 'round', 'rounder'];

bool isRounding(Object? value) => value is String && roundings.contains(value);

/// The reader's dial on the type scale (`TextSize`); `large` is already large.
const List<String> textSizes = ['large', 'larger', 'largest'];

/// Every face the app can set (`TYPEFACES`): three coding faces, four sans and a serif. JetBrains Mono, Atkinson
/// Hyperlegible Next and Lora came with the Market (Matt, 2026-10-26: "include some more themes, fonts").
const List<String> typefaces = ['maple', 'fira', 'jetbrains', 'inter', 'noto', 'plex', 'atkinson', 'lora'];

/// The faces the interface can be set in (`INTERFACE_FACES`): the sans.
const List<String> interfaceFaces = ['inter', 'noto', 'plex', 'atkinson'];

bool isTypeface(Object? value) => value is String && typefaces.contains(value);

bool isInterfaceFace(Object? value) => value is String && interfaceFaces.contains(value);

/// Whether a face is one of the monospace coding faces, which set the note's code as well as its words.
bool isCodingFace(String face) => face == 'maple' || face == 'fira' || face == 'jetbrains';

/// The two faces a set of preferences draws with, whatever the store says (`facesOf`): the interface's is one of the
/// sans, and the note's any face. One face for everything was the setting until 2026-09-24, and a coding face chosen
/// then is the note's; the interface goes back to its own default. Takes anything, because a store can hold anything.
({String ui, String note}) facesOf({Object? typeface, Object? noteFace}) {
  final ui = isInterfaceFace(typeface) ? typeface as String : Preferences.defaults.typeface;
  final note = isTypeface(noteFace)
      ? noteFace as String
      : isTypeface(typeface) && isCodingFace(typeface as String)
          ? typeface
          : Preferences.defaults.noteFace;
  return (ui: ui, note: note);
}

/// How quickly things move (`MotionSpeed`), and how much longer (above 1) or shorter every animation runs at each
/// (`MOTION_SCALE`).
const Map<String, double> motionScales = {'relaxed': 1.6, 'normal': 1, 'brisk': 0.6};

/// Which recordings are summarised on their own (`SUMMARIES`).
const List<String> summariesChoices = ['meetings', 'long', 'off'];

bool isSummaries(Object? value) => value is String && summariesChoices.contains(value);

/// A voice note longer than this is a long one (`LONG_NOTE_MS`).
const int longNoteMs = 180000;

/// When a meeting is written up with the app closed (`WRITE_UPS`).
const List<String> writeUps = ['charging', 'now'];

bool isWriteUp(Object? value) => value is String && writeUps.contains(value);

/// Colours for code on the light page and on the dark one (editor/codeThemes.ts `CodeThemeLight`, `CodeThemeDark`).
const List<String> codeThemesLight = ['pastel', 'ink', 'github', 'solarized'];
const List<String> codeThemesDark = ['pastel', 'ink', 'one-dark', 'dracula', 'nord'];

bool isCodeThemeLight(Object? value) => codeThemesLight.contains(value);

bool isCodeThemeDark(Object? value) => codeThemesDark.contains(value);

/// How notes are shown (editor/viewMode.ts `NoteView`).
bool isNoteView(Object? value) => value == 'mixed' || value == 'formatted';

/// The kit's duration tokens, which its components and the app move by (`DURATIONS`).
const List<(String, int)> _durations = [
  ('--glacier-duration-instant', 75),
  ('--glacier-duration-fast', 150),
  ('--glacier-duration-normal', 250),
  ('--glacier-duration-slow', 400),
  ('--glacier-duration-slower', 600),
];

// --- the structures that travel with a person ----------------------------------------------------------------------

/// Which notifications reach the feed and the bell (`NotificationPrefs`): one switch per category, and the
/// organizations whose team news is muted.
@immutable
class NotificationPrefs {
  const NotificationPrefs({this.team = true, this.claude = true, this.summaries = true, this.conflicts = true, this.mutedOrgs = const []});

  /// Notification switches as stored, made whole (`readNotificationPrefs`): a switch is on unless it was written
  /// off, and only ids are muted.
  factory NotificationPrefs.fromJson(Object? raw) {
    final held = raw is Map ? raw : const <Object?, Object?>{};
    final muted = held['mutedOrgs'];
    return NotificationPrefs(
      team: held['team'] != false,
      claude: held['claude'] != false,
      summaries: held['summaries'] != false,
      conflicts: held['conflicts'] != false,
      mutedOrgs: muted is List ? List.unmodifiable(muted.whereType<String>()) : const [],
    );
  }

  final bool team;
  final bool claude;
  final bool summaries;
  final bool conflicts;

  /// Organizations whose team news is not drawn, by id.
  final List<String> mutedOrgs;

  /// The four switches, in the order the pane draws them (core/notifications/kinds.ts `CATEGORIES`).
  static const categories = ['team', 'claude', 'summaries', 'conflicts'];

  /// Whether [category]'s switch is on.
  bool isOn(String category) => switch (category) { 'team' => team, 'claude' => claude, 'summaries' => summaries, 'conflicts' => conflicts, _ => true };

  NotificationPrefs copyWith({bool? team, bool? claude, bool? summaries, bool? conflicts, List<String>? mutedOrgs}) => NotificationPrefs(
        team: team ?? this.team,
        claude: claude ?? this.claude,
        summaries: summaries ?? this.summaries,
        conflicts: conflicts ?? this.conflicts,
        mutedOrgs: mutedOrgs ?? this.mutedOrgs,
      );

  Map<String, Object?> toJson() => {'team': team, 'claude': claude, 'summaries': summaries, 'conflicts': conflicts, 'mutedOrgs': mutedOrgs};

  @override
  bool operator ==(Object other) => other is NotificationPrefs && _same(toJson(), other.toJson());

  @override
  int get hashCode => Object.hash(team, claude, summaries, conflicts, Object.hashAll(mutedOrgs));
}

/// A workspace as the preferences carry it: an id, a name, and a colour once it has one. Written structurally, as the
/// web's is, rather than as lib/core/workspaces.dart's own type, so the preferences do not depend on it.
@immutable
class KeptWorkspace {
  const KeptWorkspace({required this.id, required this.name, this.hue, this.parent});
  final String id;
  final String name;
  final String? hue;

  /// The workspace it is a folder inside, by id (lib/core/workspaces.dart `Workspace.parent`); null at the top.
  final String? parent;

  Map<String, Object?> toJson() => {'id': id, 'name': name, if (hue != null) 'hue': hue, if (parent != null) 'parent': parent};
}

/// The workspaces and which note is filed in each (`Preferences['workspaces']`).
@immutable
class KeptWorkspaces {
  const KeptWorkspaces({this.list = const [], this.notes = const {}});

  /// Workspaces from another build, or a half-written store: anything but the shape is no workspaces at all.
  factory KeptWorkspaces.fromJson(Object? raw) {
    final spaces = raw is Map ? raw : const <Object?, Object?>{};
    final rawList = spaces['list'], rawNotes = spaces['notes'];
    final list = <KeptWorkspace>[
      if (rawList is List)
        for (final w in rawList)
          if (w is Map && w['id'] is String && w['name'] is String)
            KeptWorkspace(id: w['id'] as String, name: w['name'] as String, hue: w['hue'] is String ? w['hue'] as String : null, parent: w['parent'] is String ? w['parent'] as String : null),
    ];
    final ids = {for (final w in list) w.id};
    return KeptWorkspaces(
      list: List.unmodifiable(list),
      notes: Map.unmodifiable({
        if (rawNotes is Map)
          for (final entry in rawNotes.entries)
            if (entry.key is String && entry.value is String && ids.contains(entry.value)) entry.key as String: entry.value as String,
      }),
    );
  }

  final List<KeptWorkspace> list;

  /// Note id to its workspace's id.
  final Map<String, String> notes;

  Map<String, Object?> toJson() => {'list': [for (final w in list) w.toJson()], 'notes': notes};

  @override
  bool operator ==(Object other) => other is KeptWorkspaces && _same(toJson(), other.toJson());

  @override
  int get hashCode => Object.hash(list.length, notes.length);
}

/// A note shared by a read-only link (share/share.ts): the share's id, its key, and what was last sent.
@immutable
class ShareEntry {
  const ShareEntry({required this.id, required this.key, this.sent = '', this.lacked, this.place = false, this.places = false});
  final String id;
  final String key;
  final String sent;

  /// Pictures the share went without; null where there were none.
  final List<String>? lacked;

  /// Whether the share carries where its note was written, and the places written in it: each only ever true in the
  /// store, never written false.
  final bool place;
  final bool places;

  Map<String, Object?> toJson() => {
        'id': id,
        'key': key,
        'sent': sent,
        if (lacked != null && lacked!.isNotEmpty) 'lacked': lacked,
        if (place) 'place': true,
        if (places) 'places': true,
      };
}

final RegExp _linkPart = RegExp(r'^[A-Za-z0-9_-]{16,64}$');

/// Shares from another build, or a half-written store: only entries with an id and a key a link can carry.
Map<String, ShareEntry> _readShares(Object? raw) {
  final shares = <String, ShareEntry>{};
  if (raw is Map) {
    for (final entry in raw.entries) {
      final k = entry.value;
      if (entry.key is! String || k is! Map) continue;
      final id = k['id'], key = k['key'];
      if (id is! String || key is! String || !_linkPart.hasMatch(id) || !_linkPart.hasMatch(key)) continue;
      final lacked = k['lacked'] is List ? (k['lacked'] as List).whereType<String>().toList() : null;
      shares[entry.key as String] = ShareEntry(
        id: id,
        key: key,
        sent: k['sent'] is String ? k['sent'] as String : '',
        lacked: lacked != null && lacked.isNotEmpty ? List.unmodifiable(lacked) : null,
        place: k['place'] == true,
        places: k['places'] == true,
      );
    }
  }
  return Map.unmodifiable(shares);
}

/// A map of ids kept only where each has a value of the right kind: the trash and the meetings (ids with a time), and
/// which notes keep versions (ids with a yes or a no).
Map<String, T> _readById<T>(Object? raw, bool Function(Object? value) keep) => Map.unmodifiable({
      if (raw is Map)
        for (final entry in raw.entries)
          if (entry.key is String && keep(entry.value)) entry.key as String: entry.value as T,
    });

bool _isTime(Object? at) => at is num && at.isFinite;

// --- the preferences ---------------------------------------------------------------------------------------------

/// Port of `Preferences` and `DEFAULT_PREFERENCES` (src/app/core/preferences.ts): everything a person chose about
/// how the app looks, moves and behaves, with the things that travel with them (their tabs, workspaces, trash,
/// shares). Immutable; [copyWith] makes the next one, [toJson] and [Preferences.fromJson] are the web's stored shape.
///
/// What differs from the web original:
/// - A field is typed, where the page's object holds whatever a store held. Reading ([Preferences.fromJson], the
///   page's `settle`) therefore also turns a switch that is not a yes or a no into its default, where the page kept
///   the odd value and treated it by its truthiness. `textSize` and `density` are still kept as any word, as on the
///   page, which does not settle them.
/// - Keys this build does not know are kept in [more] and written back, as the page's spread keeps them, so a
///   store from a newer build survives a visit here.
/// - What the page sets as inline styles on the root (the interface size as a font size, the pace as the duration
///   tokens) is [rootStyle], apart from [attrs]: the theme takes attributes only.
/// - Fields whose features are not in Flutter yet are stored and round-tripped, and read by nothing.
@immutable
class Preferences {
  const Preferences({
    this.theme = 'dark',
    this.uiScale = 1,
    this.sidebarStyle = 'popover',
    this.homeLayout = 'spotlight',
    this.homeLayoutChosen = false,
    this.experience = 'advanced',
    this.experienceChosen = false,
    this.topBar = 'classic',
    this.accent = 'ink',
    this.density = 'comfortable',
    this.rounding = 'round',
    this.assist = true,
    this.textSize = 'large',
    this.typeface = 'inter',
    this.noteFace = 'maple',
    this.refine = true,
    this.quietStop = false,
    this.review = true,
    this.summaries = 'meetings',
    this.writeUp = 'charging',
    this.syncMeetingRecordings = true,
    this.syncMeetingRecordingsChosen = false,
    this.meetingSound = false,
    this.localOnly = false,
    this.formatModel = 'qwen3.5-4b',
    this.codeLight = 'pastel',
    this.codeDark = 'pastel',
    this.codeChosen = false,
    this.noteView = 'mixed',
    this.marksInMargin = false,
    this.openNotes = const [],
    this.tabGroups = TabGroups.none,
    this.workspaces = const KeptWorkspaces(),
    this.trash = const {},
    this.meetings = const {},
    this.versions = const {},
    this.shares = const {},
    this.wisp = true,
    this.wispEdge = true,
    this.ripples = true,
    this.motionSpeed = 'normal',
    this.linkPreviews = true,
    this.canvasSnap = true,
    this.mapTiles = true,
    this.placeNames = true,
    this.tagNewNotes = true,
    this.lookUpBlanks = true,
    this.autoFill = true,
    this.notifications = const NotificationPrefs(),
    this.more = const {},
  });

  /// `DEFAULT_PREFERENCES`: a device that chose nothing yet.
  static const Preferences defaults = Preferences();

  /// A stored set of preferences made whole, whatever build or half-written store it came from (`settle`). [raw] is
  /// what the store's JSON decoded to; anything but an object is a device that chose nothing.
  factory Preferences.fromJson(Object? raw) {
    const d = defaults;
    final map = raw is Map ? raw : const <Object?, Object?>{};
    // `{ ...DEFAULT_PREFERENCES, ...raw }`: a key the store has wins, whatever it holds; one it lacks is the default.
    Object? at(String key, Object? fallback) => map.containsKey(key) ? map[key] : fallback;
    bool flag(String key, bool fallback) => map[key] is bool ? map[key] as bool : fallback;
    // The page asks these two by their truthiness (`!loaded.codeChosen`).
    bool truthy(String key) {
      final value = map[key];
      return !(value == null || value == false || value == 0 || value == '' || (value is double && value.isNaN));
    }

    String word(String key, String fallback) => map[key] is String ? map[key] as String : fallback;

    final codeChosen = truthy('codeChosen');
    final marksInMargin = truthy('marksInMargin');
    final homeLayoutChosen = truthy('homeLayoutChosen');
    final experienceChosen = truthy('experienceChosen');
    final syncMeetingRecordingsChosen = truthy('syncMeetingRecordingsChosen');
    final experience = at('experience', d.experience);
    final codeLight = at('codeLight', d.codeLight), codeDark = at('codeDark', d.codeDark);
    final noteView = at('noteView', d.noteView), theme = at('theme', d.theme);
    final uiScale = at('uiScale', d.uiScale), sidebarStyle = at('sidebarStyle', d.sidebarStyle);
    final homeLayout = at('homeLayout', d.homeLayout), topBar = at('topBar', d.topBar);
    final openNotes = map['openNotes'];
    final ids = openNotes is List ? openNotes.whereType<String>().toList() : const <String>[];
    final motionSpeed = at('motionSpeed', d.motionSpeed), summaries = at('summaries', d.summaries), writeUp = at('writeUp', d.writeUp);
    final accent = at('accent', d.accent), rounding = at('rounding', d.rounding);
    // The two faces, settled: one face for everything, as a store from before the pair has it, is read as a pair.
    final faces = facesOf(typeface: at('typeface', d.typeface), noteFace: at('noteFace', d.noteFace));

    return Preferences(
      // A theme from a later build, or from a device with one this build lacks, reads as the default.
      theme: isTheme(theme) ? theme as String : d.theme,
      // A size that is not one of the steps - another build's, or a half-written store - is the kit's own.
      uiScale: isUiScale(uiScale) ? (uiScale as num).toDouble() : d.uiScale,
      sidebarStyle: isSidebarStyle(sidebarStyle) ? sidebarStyle as String : d.sidebarStyle,
      homeLayout: isHomeLayout(homeLayout) && homeLayoutChosen ? homeLayout as String : d.homeLayout,
      homeLayoutChosen: homeLayoutChosen,
      // Advanced until it is chosen: an install from before there was a choice is the whole app, as it was.
      experience: isExperience(experience) && experienceChosen ? experience as String : d.experience,
      experienceChosen: experienceChosen,
      topBar: isTopBar(topBar) ? topBar as String : d.topBar,
      // An accent or a rounding this build does not have is the app's own rather than a name nothing can draw.
      accent: isAccent(accent) ? accent as String : d.accent,
      density: word('density', d.density),
      rounding: isRounding(rounding) ? rounding as String : d.rounding,
      assist: flag('assist', d.assist),
      textSize: word('textSize', d.textSize),
      typeface: faces.ui,
      noteFace: faces.note,
      refine: flag('refine', d.refine),
      quietStop: flag('quietStop', d.quietStop),
      review: flag('review', d.review),
      summaries: isSummaries(summaries) ? summaries as String : d.summaries,
      writeUp: isWriteUp(writeUp) ? writeUp as String : d.writeUp,
      // On until it is chosen (GHST-112): every store from before 2026-10-23 holds the old default, off, that nobody
      // picked, so a meeting's audio syncs for an account that never touched the switch, and stays put for one that
      // turned it off since.
      syncMeetingRecordings: syncMeetingRecordingsChosen ? flag('syncMeetingRecordings', d.syncMeetingRecordings) : d.syncMeetingRecordings,
      syncMeetingRecordingsChosen: syncMeetingRecordingsChosen,
      meetingSound: flag('meetingSound', d.meetingSound),
      localOnly: flag('localOnly', d.localOnly),
      formatModel: word('formatModel', d.formatModel),
      // A theme a later build removed falls back to the default rather than to no colours at all.
      codeLight: isCodeThemeLight(codeLight) && codeChosen ? codeLight as String : d.codeLight,
      codeDark: isCodeThemeDark(codeDark) && codeChosen ? codeDark as String : d.codeDark,
      codeChosen: codeChosen,
      noteView: isNoteView(noteView) ? noteView as String : d.noteView,
      marksInMargin: marksInMargin,
      // Tabs from another build, or a half-written store: anything but a list of ids is no tabs at all.
      openNotes: List.unmodifiable(ids.length > mostTabs ? ids.sublist(ids.length - mostTabs) : ids),
      tabGroups: TabGroups.fromJson(map['tabGroups']),
      workspaces: KeptWorkspaces.fromJson(map['workspaces']),
      trash: _readById<num>(map['trash'], _isTime),
      meetings: _readById<num>(map['meetings'], _isTime),
      versions: _readById<bool>(map['versions'], (on) => on is bool),
      shares: _readShares(map['shares']),
      wisp: flag('wisp', d.wisp),
      wispEdge: flag('wispEdge', d.wispEdge),
      ripples: flag('ripples', d.ripples),
      motionSpeed: motionScales.containsKey(motionSpeed) ? motionSpeed as String : d.motionSpeed,
      linkPreviews: flag('linkPreviews', d.linkPreviews),
      canvasSnap: flag('canvasSnap', d.canvasSnap),
      mapTiles: flag('mapTiles', d.mapTiles),
      placeNames: flag('placeNames', d.placeNames),
      tagNewNotes: flag('tagNewNotes', d.tagNewNotes),
      lookUpBlanks: flag('lookUpBlanks', d.lookUpBlanks),
      autoFill: flag('autoFill', d.autoFill),
      notifications: NotificationPrefs.fromJson(map['notifications']),
      more: Map.unmodifiable({
        for (final entry in map.entries)
          if (entry.key is String && !_keys.contains(entry.key)) entry.key as String: entry.value,
      }),
    );
  }

  /// `system`, `light`, `dark`, or a named theme: `dawn`, `boreal`, `ember` (`ThemePref`).
  final String theme;

  /// Every part of the app scaled together ([uiScales]); 1 is the kit's own size. Kept to this device.
  final double uiScale;

  /// `popover` or `docked`. Kept to this device, since it is about this window's width.
  final String sidebarStyle;

  /// How the home page lays out the notebooks and notes ([homeLayoutIds]).
  final String homeLayout;

  /// Whether the home page's layout was picked in Settings; until it is, it follows the default.
  final bool homeLayoutChosen;

  /// How much of the app is shown ([experienceIds]): `simple` or `advanced`. Travels, so a phone and a Mac match.
  final String experience;

  /// Whether the mode was ever chosen (the walkthrough, home's one-time card, Settings); until it is, the app is
  /// advanced, and a new install is asked.
  final bool experienceChosen;

  /// Simple mode: the fancy features behind More, a Format bar in the editor, fewer Settings.
  bool get simple => experience == 'simple';

  /// The mode chosen, wherever it is chosen (the walkthrough, home's card, Settings). Simple also opens notes
  /// formatted rather than with their marks showing: the marks are what a new person finds hard to read, and the
  /// view switch in the note's bar brings them back.
  Preferences choosing(String mode) => copyWith(experience: mode, experienceChosen: true, noteView: mode == 'simple' ? 'formatted' : null);

  /// How the top bar is laid out ([topBarIds]).
  final String topBar;

  /// The one colour a person can choose ([accents]). `ink` is the app's own answer and the default: nothing is
  /// stamped, and every accent token stays mapped onto the grey scale.
  final String accent;

  /// The kit's density stop ([densities]).
  final String density;

  /// How round the app's corners are ([roundings]).
  final String rounding;

  /// Prose input aids in the editor: autocorrect, autocapitalisation, spellcheck.
  final bool assist;

  /// The reader's dial on the type scale ([textSizes]).
  final String textSize;

  /// The interface's face: tabs, lists, Settings, buttons ([interfaceFaces]).
  final String typeface;

  /// The note's face: its words and its code ([typefaces]).
  final String noteFace;

  /// Better words after recording: a larger, slower model goes over the kept recording in the background.
  final bool refine;

  /// Stop when I go quiet: a recording that has heard words saves itself after a few seconds of quiet.
  final bool quietStop;

  /// After Stop, the review: the slower speech model listens again and the language model checks the note.
  final bool review;

  /// Which recordings are summarised on their own ([summariesChoices]).
  final String summaries;

  /// When a meeting is written up with the app closed ([writeUps]).
  final String writeUp;

  /// Whether a meeting's audio goes to the account with its note, and to every member with a team's note (GHST-112).
  /// On by default; read as on until [syncMeetingRecordingsChosen].
  final bool syncMeetingRecordings;

  /// Whether the Sync meeting recordings switch was ever touched; until it is, [syncMeetingRecordings] is the default.
  final bool syncMeetingRecordingsChosen;

  /// A meeting records the device's own sound beside the microphone. Kept on this device.
  final bool meetingSound;

  /// Nothing leaves the phone and nothing arrives.
  final bool localOnly;

  /// Which model formats notes on the phone, by its id.
  final String formatModel;

  /// Colours for code on the light page and on the dark one; `ink` keeps code in the page's ink.
  final String codeLight;
  final String codeDark;

  /// Whether the code colours were picked in Settings; until they are, they follow the default (Pastel).
  final bool codeChosen;

  /// How notes are shown: `mixed` or `formatted`.
  final String noteView;

  /// Margin (lib/editor/view/margin_marks.dart): with [noteView] `mixed`, a line's leading mark hangs in a column left
  /// of the words. Its own key, as the Tauri app's `marksInMargin`, so a build that knows two views still reads one.
  final bool marksInMargin;

  /// The notes left open as tabs, oldest first, at most [mostTabs].
  final List<String> openNotes;

  /// Chrome-style groups over the open tabs.
  final TabGroups tabGroups;

  /// The workspaces and which note is filed in each.
  final KeptWorkspaces workspaces;

  /// The notes in the trash, by id, and when each went in (milliseconds).
  final Map<String, num> trash;

  /// The notes that are meetings, by id, and when each was started.
  final Map<String, num> meetings;

  /// Which notes keep a version history, by id.
  final Map<String, bool> versions;

  /// The notes shared by a read-only link, by note id.
  final Map<String, ShareEntry> shares;

  /// The app's movement, three switches under Settings › Appearance › Motion: the ghostly typing, the smoke where a
  /// page slips under its header, and the rings that answer a voice while recording.
  final bool wisp;
  final bool wispEdge;
  final bool ripples;

  /// The pace of all of it ([motionScales]).
  final String motionSpeed;

  /// A card under a line that is only a link, with the page's title.
  final bool linkPreviews;

  /// A canvas's cards land on its grid of dots.
  final bool canvasSnap;

  /// A map at the top of a tagged note, drawn from OpenStreetMap's tiles.
  final bool mapTiles;

  /// The name of the place a tagged note was written, asked of OpenStreetMap once.
  final bool placeNames;

  /// Every note made here starts with where the device was. Kept on the device.
  final bool tagNewNotes;

  /// A blank that needs live facts is looked up by the phone itself. Kept on the device.
  final bool lookUpBlanks;

  /// Fill the blanks on their own, a few seconds after the typing stops. Kept on the device.
  final bool autoFill;

  /// Which notifications are drawn and counted.
  final NotificationPrefs notifications;

  /// What a store held under keys this build does not know, written back as it was read.
  final Map<String, Object?> more;

  static const Set<String> _keys = {
    'theme', 'uiScale', 'sidebarStyle', 'homeLayout', 'homeLayoutChosen', 'experience', 'experienceChosen', 'topBar', 'accent', 'density', 'rounding', //
    'assist', 'textSize', 'typeface', //
    'noteFace', 'refine', 'quietStop', 'review', 'summaries', 'writeUp', 'syncMeetingRecordings', 'syncMeetingRecordingsChosen', 'meetingSound', 'localOnly', 'formatModel', 'codeLight', //
    'codeDark', 'codeChosen', 'noteView', 'marksInMargin', 'openNotes', 'tabGroups', 'workspaces', 'trash', 'meetings', 'versions', 'shares', 'wisp', 'wispEdge', 'ripples', //
    'motionSpeed', 'linkPreviews', 'canvasSnap', 'mapTiles', 'placeNames', 'tagNewNotes', 'lookUpBlanks', 'autoFill', 'notifications',
  };

  Preferences copyWith({
    String? theme,
    double? uiScale,
    String? sidebarStyle,
    String? homeLayout,
    bool? homeLayoutChosen,
    String? experience,
    bool? experienceChosen,
    String? topBar,
    String? accent,
    String? density,
    String? rounding,
    bool? assist,
    String? textSize,
    String? typeface,
    String? noteFace,
    bool? refine,
    bool? quietStop,
    bool? review,
    String? summaries,
    String? writeUp,
    bool? syncMeetingRecordings,
    bool? syncMeetingRecordingsChosen,
    bool? meetingSound,
    bool? localOnly,
    String? formatModel,
    String? codeLight,
    String? codeDark,
    bool? codeChosen,
    String? noteView,
    bool? marksInMargin,
    List<String>? openNotes,
    TabGroups? tabGroups,
    KeptWorkspaces? workspaces,
    Map<String, num>? trash,
    Map<String, num>? meetings,
    Map<String, bool>? versions,
    Map<String, ShareEntry>? shares,
    bool? wisp,
    bool? wispEdge,
    bool? ripples,
    String? motionSpeed,
    bool? linkPreviews,
    bool? canvasSnap,
    bool? mapTiles,
    bool? placeNames,
    bool? tagNewNotes,
    bool? lookUpBlanks,
    bool? autoFill,
    NotificationPrefs? notifications,
    Map<String, Object?>? more,
  }) =>
      Preferences(
        theme: theme ?? this.theme,
        uiScale: uiScale ?? this.uiScale,
        sidebarStyle: sidebarStyle ?? this.sidebarStyle,
        homeLayout: homeLayout ?? this.homeLayout,
        homeLayoutChosen: homeLayoutChosen ?? this.homeLayoutChosen,
        experience: experience ?? this.experience,
        experienceChosen: experienceChosen ?? this.experienceChosen,
        topBar: topBar ?? this.topBar,
        accent: accent ?? this.accent,
        density: density ?? this.density,
        rounding: rounding ?? this.rounding,
        assist: assist ?? this.assist,
        textSize: textSize ?? this.textSize,
        typeface: typeface ?? this.typeface,
        noteFace: noteFace ?? this.noteFace,
        refine: refine ?? this.refine,
        quietStop: quietStop ?? this.quietStop,
        review: review ?? this.review,
        summaries: summaries ?? this.summaries,
        writeUp: writeUp ?? this.writeUp,
        syncMeetingRecordings: syncMeetingRecordings ?? this.syncMeetingRecordings,
        syncMeetingRecordingsChosen: syncMeetingRecordingsChosen ?? this.syncMeetingRecordingsChosen,
        meetingSound: meetingSound ?? this.meetingSound,
        localOnly: localOnly ?? this.localOnly,
        formatModel: formatModel ?? this.formatModel,
        codeLight: codeLight ?? this.codeLight,
        codeDark: codeDark ?? this.codeDark,
        codeChosen: codeChosen ?? this.codeChosen,
        noteView: noteView ?? this.noteView,
        marksInMargin: marksInMargin ?? this.marksInMargin,
        openNotes: openNotes ?? this.openNotes,
        tabGroups: tabGroups ?? this.tabGroups,
        workspaces: workspaces ?? this.workspaces,
        trash: trash ?? this.trash,
        meetings: meetings ?? this.meetings,
        versions: versions ?? this.versions,
        shares: shares ?? this.shares,
        wisp: wisp ?? this.wisp,
        wispEdge: wispEdge ?? this.wispEdge,
        ripples: ripples ?? this.ripples,
        motionSpeed: motionSpeed ?? this.motionSpeed,
        linkPreviews: linkPreviews ?? this.linkPreviews,
        canvasSnap: canvasSnap ?? this.canvasSnap,
        mapTiles: mapTiles ?? this.mapTiles,
        placeNames: placeNames ?? this.placeNames,
        tagNewNotes: tagNewNotes ?? this.tagNewNotes,
        lookUpBlanks: lookUpBlanks ?? this.lookUpBlanks,
        autoFill: autoFill ?? this.autoFill,
        notifications: notifications ?? this.notifications,
        more: more ?? this.more,
      );

  /// The web's stored shape: what `JSON.stringify` writes under [PreferencesStore.storageKey], key for key.
  Map<String, Object?> toJson() => {
        ...more,
        'theme': theme,
        'uiScale': _number(uiScale),
        'sidebarStyle': sidebarStyle,
        'homeLayout': homeLayout,
        'homeLayoutChosen': homeLayoutChosen,
        'experience': experience,
        'experienceChosen': experienceChosen,
        'topBar': topBar,
        'accent': accent,
        'density': density,
        'rounding': rounding,
        'assist': assist,
        'textSize': textSize,
        'typeface': typeface,
        'noteFace': noteFace,
        'refine': refine,
        'quietStop': quietStop,
        'review': review,
        'summaries': summaries,
        'writeUp': writeUp,
        'syncMeetingRecordings': syncMeetingRecordings,
        'syncMeetingRecordingsChosen': syncMeetingRecordingsChosen,
        'meetingSound': meetingSound,
        'localOnly': localOnly,
        'formatModel': formatModel,
        'codeLight': codeLight,
        'codeDark': codeDark,
        'codeChosen': codeChosen,
        'noteView': noteView,
        // Only when on: off, the stored shape is the web app's own, which has no such key.
        if (marksInMargin) 'marksInMargin': true,
        'openNotes': openNotes,
        'tabGroups': tabGroups.toJson(),
        'workspaces': workspaces.toJson(),
        'trash': trash,
        'meetings': meetings,
        'versions': versions,
        'shares': {for (final entry in shares.entries) entry.key: entry.value.toJson()},
        'wisp': wisp,
        'wispEdge': wispEdge,
        'ripples': ripples,
        'motionSpeed': motionSpeed,
        'linkPreviews': linkPreviews,
        'canvasSnap': canvasSnap,
        'mapTiles': mapTiles,
        'placeNames': placeNames,
        'tagNewNotes': tagNewNotes,
        'lookUpBlanks': lookUpBlanks,
        'autoFill': autoFill,
        'notifications': notifications.toJson(),
      };

  /// The two faces these preferences draw with ([facesOf]).
  ({String ui, String note}) get faces => facesOf(typeface: typeface, noteFace: noteFace);

  /// The chosen pace as a multiplier for a duration (`motionScale`): 1 at the normal speed.
  double get motionScale => motionScales[motionSpeed] ?? 1;

  /// The page's attributes for these choices, without the `data-` prefix: exactly what `applyPreferences` stamps on
  /// the root, and nothing it removes. `theme` is left out for System, where the theme follows the device's; a
  /// named theme is stamped twice, its side of the page as `theme` and its name as `theme-preset`.
  Map<String, String> get attrs {
    final scheme = themeScheme(theme);
    final faces = this.faces;
    return {
      if (scheme != 'system') 'theme': scheme,
      if (isThemePreset(theme)) 'theme-preset': theme,
      if (density != defaults.density) 'density': density,
      // The top bar's style, for the bar's heights and grounds; Classic stamps nothing.
      if (isTopBar(topBar) && topBar != 'classic') 'topbar': topBar,
      // Ink is no accent at all: nothing is stamped, and ink.css keeps every accent token on the grey scale.
      if (isAccent(accent) && accent != 'ink') 'accent': accent,
      if (isRounding(rounding) && rounding != defaults.rounding) 'rounding': rounding,
      if (textSize != defaults.textSize) 'text-size': textSize,
      // The interface's face is the token layer's own attribute; the note's is always stamped.
      if (faces.ui != defaults.typeface) 'font': faces.ui,
      'note-font': faces.note,
      // Both code themes are stamped; whichever side of the page is showing applies.
      'code-light': codeLight,
      'code-dark': codeDark,
    };
  }

  /// What `applyPreferences` writes as inline styles on the root, by property: the root's own size for an interface
  /// size other than the kit's (`font-size: 110.0%`), the kit's durations stretched or shortened for a pace other
  /// than normal, and `--app-motion-scale`. [still] is the device asking for less motion, which the pace leaves
  /// alone: the kit's own reduced-motion rule sets the durations then.
  Map<String, String> rootStyle({bool still = false}) {
    final size = isUiScale(uiScale) ? uiScale : 1.0;
    final scale = motionScale;
    return {
      // Written as `110.0%`, which the page keeps as `110%`.
      if (size != 1) 'font-size': '${_number(double.parse((size * 100).toStringAsFixed(1)))}%',
      if (scale != 1 && !still)
        for (final (name, ms) in _durations) name: '${(ms * scale).round()}ms',
      '--app-motion-scale': '${_number(still ? 1.0 : scale)}',
    };
  }

  /// The same choices, all the way down: told by writing both out, which is why the same object is asked first.
  @override
  bool operator ==(Object other) => identical(this, other) || other is Preferences && _same(toJson(), other.toJson());

  @override
  int get hashCode => Object.hash(theme, uiScale, accent, density, rounding, textSize, typeface, noteFace, motionSpeed, openNotes.length);

  @override
  String toString() => 'Preferences(${jsonEncode(toJson())})';
}

/// A number as JavaScript writes it: 1, not 1.0.
num _number(double value) => value == value.roundToDouble() ? value.toInt() : value;

/// Whether two decoded JSON values are the same, all the way down.
bool _same(Object? a, Object? b) {
  if (a is Map && b is Map) {
    if (a.length != b.length) return false;
    for (final key in a.keys) {
      if (!b.containsKey(key) || !_same(a[key], b[key])) return false;
    }
    return true;
  }
  if (a is List && b is List) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (!_same(a[i], b[i])) return false;
    }
    return true;
  }
  if (a is num && b is num) return a == b;
  return a == b;
}

// --- kept, and told to everyone following ---------------------------------------------------------------------------

/// Whether this is the phone app, the only place a motor exists (core/platform.ts `isNativeMobile`).
bool get isNativeMobile => !kIsWeb && (defaultTargetPlatform == TargetPlatform.android || defaultTargetPlatform == TargetPlatform.iOS);

/// Port of the store in preferences.ts (`preferences`, `setPreferences`, `reloadPreferences`, `onPreferences`,
/// `usePreferences`): the chosen preferences, kept under the web's own key as the web's own JSON, and told to
/// everyone listening.
///
/// The app listens to it as a [ValueListenable] and puts [Preferences.attrs] on its theme, which is what
/// `applyPreferences` does to the page. [load] reads what was kept, before the first frame; until then, and where
/// storage refuses, it holds the defaults, and a choice made is held for this run.
///
/// What differs from the web original:
/// - The page's storage is synchronous and this one's is not, so there is a [load] to wait for; and nothing is
///   "applied" on a change, since the theme rebuilds from the value.
/// - **Nothing is kept before what was kept has been read.** The workspaces, the trash, the open tabs and every
///   choice are one value under one key, and the app can be drawn before a slow device has answered (lib/main.dart
///   waits two seconds and goes on). A change made meanwhile is a change to the defaults; written whole when storage
///   answered, as it was, it replaced everything the person had with them. So a change made before the load has
///   landed is made again over what was kept, once it is read, and that is what is kept: the page's own
///   `setPreferences(partial)`, which was always the kept preferences with a part replaced.
/// - **A change is kept a moment later, once** ([keepAfter]): every change encoded the whole of them and handed
///   them to storage in the middle of whatever made it (a tab opened, a note filed), and ten notes filed were ten
///   writes. [flush] keeps what is waiting now: the app asks as it is hidden.
/// - **One preference can be listened to alone** ([select]): its listeners are told when it is another value and
///   not when a tab was opened.
class PreferencesStore extends ValueNotifier<Preferences> {
  PreferencesStore({this.keepAfter = const Duration(milliseconds: 150)}) : super(Preferences.defaults);

  /// The key the web app keeps its preferences under in localStorage (`STORAGE_KEY`).
  static const storageKey = 'glyph-preferences';

  /// How long after a change the preferences are written, every change made meanwhile with it.
  final Duration keepAfter;

  SharedPreferences? _kept;
  bool _loaded = false;
  Future<void>? _loading;

  /// The changes made before what was kept was read, in order: each is made again over what was kept.
  final List<Preferences Function(Preferences kept)> _early = [];

  /// The write that is waiting, and whether anything is.
  Timer? _keeping;
  bool _unkept = false;

  /// Whether [load] has finished, kept or refused.
  bool get loaded => _loaded;

  /// Reads what is kept. Asked more than once, it reads once. A choice made before it finished is made again over
  /// what was stored, and kept.
  Future<void> load() => _loading ??= _load();

  Future<void> _load() async {
    try {
      final kept = await SharedPreferences.getInstance();
      _kept = kept;
      DeviceFlag._storage = kept;
      for (final flag in DeviceFlag._all) {
        flag._attach(kept);
      }
      var read = _read();
      if (_early.isEmpty) {
        super.value = read;
      } else {
        for (final change in _early) {
          read = change(read);
        }
        _early.clear();
        super.value = read;
        _keepSoon();
      }
    } catch (_) {
      // Storage that refuses is a device that cannot remember, not an error (core/stored.ts): the defaults stand,
      // with whatever was chosen meanwhile.
      _early.clear();
    }
    _loaded = true;
  }

  /// What is kept, or the defaults: nothing kept, or nothing that reads as JSON, is a device that chose nothing yet.
  Preferences _read() {
    final text = _kept?.getString(storageKey);
    if (text == null) return Preferences.defaults;
    try {
      return Preferences.fromJson(jsonDecode(text));
    } catch (_) {
      return Preferences.defaults;
    }
  }

  /// Whether what was kept has yet to be read: a change made now is a change to the defaults.
  bool get _unread => !_loaded && _kept == null;

  void _keepSoon() {
    // Not kept, the choice still applies for this run.
    if (_kept == null) return;
    _unkept = true;
    _keeping ??= Timer(keepAfter, flush);
  }

  /// Keeps what is waiting to be kept, now: as the app is hidden, and before whatever reads the stored preferences
  /// itself.
  void flush() {
    _keeping?.cancel();
    _keeping = null;
    final kept = _kept;
    if (kept == null || !_unkept) return;
    _unkept = false;
    final began = ghostPerf ? Perf.now() : 0;
    unawaited(kept.setString(storageKey, jsonEncode(value.toJson())).catchError((Object _) => false));
    if (ghostPerf) Perf.add('prefs.write', began);
  }

  /// [next] as a change to [was], made over [kept]: each of its top-level keys that is another value than [was]
  /// had, and no other.
  static Preferences _carried(Preferences was, Preferences next, Preferences kept) {
    final before = was.toJson(), after = next.toJson(), over = kept.toJson();
    var moved = false;
    for (final key in {...before.keys, ...after.keys}) {
      if (_same(before[key], after[key])) continue;
      moved = true;
      if (after.containsKey(key)) {
        over[key] = after[key];
      } else {
        over.remove(key);
      }
    }
    return moved ? Preferences.fromJson(jsonDecode(jsonEncode(over))) : kept;
  }

  /// Told to everyone following, then kept (`setPreferences`, given the whole next value). Before what was kept
  /// has been read it is taken as the choices that differ from the ones now, which is what it can only be.
  @override
  set value(Preferences next) {
    final was = super.value;
    if (identical(next, was)) return;
    if (_unread) _early.add((kept) => _carried(was, next, kept));
    super.value = next;
    _keepSoon();
  }

  /// `setPreferences(partial)`: the next preferences made from the ones now.
  void update(Preferences Function(Preferences now) change) {
    final was = super.value;
    final next = change(was);
    if (identical(next, was)) return;
    if (_unread) _early.add(change);
    super.value = next;
    _keepSoon();
  }

  /// One preference, or a few, for whatever reads no others: told when what [pick] answers is another value, and
  /// not for any other change. [same] says when two answers are one (a list or a map compared by what is in it);
  /// left out, it is `==`. It listens to the preferences only while something listens to it.
  ValueListenable<T> select<T>(T Function(Preferences prefs) pick, {bool Function(T a, T b)? same}) => _Picked<T>(this, pick, same);

  /// Reads the stored preferences again (`reloadPreferences`): after a reset, and in tests. A change not yet kept
  /// is let go: what is stored is what stands.
  void reload() {
    _keeping?.cancel();
    _keeping = null;
    _unkept = false;
    super.value = _read();
  }

  /// A device with no storage at all, already read: the defaults, and a choice held for this run. For a test that
  /// draws the app and keeps nothing, without a storage plugin to wait for.
  @visibleForTesting
  void startWithoutStorage() {
    forget();
    _loaded = true;
    _loading = Future<void>.value();
  }

  /// Forgets what was loaded, for a test that starts another launch.
  @visibleForTesting
  void forget() {
    _keeping?.cancel();
    _keeping = null;
    _unkept = false;
    _early.clear();
    _kept = null;
    _loaded = false;
    _loading = null;
    super.value = Preferences.defaults;
    DeviceFlag._storage = null;
    for (final flag in DeviceFlag._all) {
      flag._forget();
    }
  }
}

/// What [PreferencesStore.select] answers.
class _Picked<T> extends ChangeNotifier implements ValueListenable<T> {
  _Picked(this._store, this._pick, this._same);

  final PreferencesStore _store;
  final T Function(Preferences prefs) _pick;
  final bool Function(T a, T b)? _same;
  late T _value;

  @override
  T get value => hasListeners ? _value : _pick(_store.value);

  void _heard() {
    final now = _pick(_store.value);
    if (_same?.call(now, _value) ?? now == _value) return;
    _value = now;
    notifyListeners();
  }

  @override
  void addListener(VoidCallback listener) {
    if (!hasListeners) {
      _value = _pick(_store.value);
      _store.addListener(_heard);
    }
    super.addListener(listener);
  }

  @override
  void removeListener(VoidCallback listener) {
    super.removeListener(listener);
    if (!hasListeners) _store.removeListener(_heard);
  }

  @override
  void dispose() {
    _store.removeListener(_heard);
    super.dispose();
  }
}

/// The app's preferences (`preferences()`, `setPreferences`, `usePreferences`).
final PreferencesStore preferences = PreferencesStore();

/// Port of src/app/core/deviceFlag.ts: a switch that belongs to this device and to no other (the haptics, developer
/// mode), kept apart from the preferences, which travel to the account's other devices. Kept as `on` or `off`, and
/// as nothing where the flag is off by default and off: the form the web app writes.
///
/// What differs from the web original: the page asks storage on every read; this holds the value, read once when
/// the preferences load ([PreferencesStore.load]), since reading here is not synchronous.
class DeviceFlag extends ValueNotifier<bool> {
  DeviceFlag(this.key, {bool Function()? fallback})
      : _fallback = fallback ?? _off,
        super((fallback ?? _off)()) {
    _all.add(this);
    // A flag first asked for after the preferences were read finds storage already there.
    final storage = _storage;
    if (storage != null) _attach(storage);
  }

  static bool _off() => false;
  static final List<DeviceFlag> _all = [];
  static SharedPreferences? _storage;

  /// The key in storage: `glyph-<thing>`, as the web app's.
  final String key;
  final bool Function() _fallback;
  SharedPreferences? _kept;

  void _attach(SharedPreferences kept) {
    _kept = kept;
    final text = kept.getString(key);
    super.value = text == 'on'
        ? true
        : text == 'off'
            ? false
            : _fallback();
  }

  void _forget() {
    _kept = null;
    super.value = _fallback();
  }

  /// Switches it, and keeps it.
  void set(bool on) => value = on;

  @override
  set value(bool on) {
    final text = on
        ? 'on'
        : _fallback()
            ? 'off'
            : null;
    final kept = _kept;
    if (kept != null) unawaited((text == null ? kept.remove(key) : kept.setString(key, text)).catchError((Object _) => false));
    super.value = on;
  }
}

/// Whether presses buzz (core/haptics.ts `useHapticsPref`, `setHapticsPref`): this device's own, on by default
/// where there is a motor.
final DeviceFlag hapticsPref = DeviceFlag('glyph-haptics', fallback: () => isNativeMobile);

/// Whether this device has a motor at all (core/haptics.ts `hapticsAvailable`): a switch for something that cannot
/// happen is worse than no switch.
bool hapticsAvailable() => isNativeMobile;
