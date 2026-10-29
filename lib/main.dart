import 'dart:async';
import 'dart:ui' show PlatformDispatcher;

import 'package:flutter/foundation.dart' show TargetPlatform, defaultTargetPlatform, kIsWasm, kIsWeb;
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:screen_retriever/screen_retriever.dart';
import 'package:window_manager/window_manager.dart';

import 'account/crypto.dart';
import 'app/front_frames.dart';
import 'app/ghost_app.dart';
import 'app/token_sheet.g.dart';
import 'account/device_keys.dart' show deviceSecureStore;
import 'carry/iphone_carry.dart';
import 'carry/mac_carry.dart';
import 'carry/tauri_carry.dart';
import 'core/native/core.dart';
import 'core/mac_app.dart';
import 'core/native/device_paths.dart';
import 'core/native/ghost_core.dart';
import 'core/locale_dates.dart';
import 'core/phone_dates.dart';
import 'core/phone_zones.dart';
import 'core/geocode.dart';
import 'core/iphone_app.dart';
import 'core/keep_keyboard.dart';
import 'core/films.dart';
import 'core/open_link.dart';
import 'core/phone_battery.dart';
import 'format/battery.dart' show useBatterySource;
import 'core/phone_connection.dart';
import 'core/phone_films.dart';
import 'core/phone_day.dart';
import 'core/phone_pictures.dart';
import 'core/phone_position.dart';
import 'editor/media/map_tiles.dart';
import 'core/phone_links.dart';
import 'core/preferences.dart';
import 'core/stored.dart';
import 'core/stored_device.dart';
import 'core/updates.dart';
import 'diag/error_log.dart';
import 'files/files_kit.dart';
import 'root/account_wiring.dart';
import 'core/link_preview.dart' show linkPreviewFetch;
import 'editor/media/rich_embeds/oembed.dart' show oEmbedFetch, pictureFetch;
import 'perf/frame_log.dart';
import 'perf/perf_run.dart';
import 'perf/perf_seed.dart';
import 'root/ghost_root.dart';
import 'root/opening.dart';
import 'root/iphone_wiring.dart';
import 'root/plugin_ground.dart';
import 'root/voice_wiring.dart';
import 'share/share_in.dart' show PhoneShares;
import 'shell/desktop/desktop_commands.dart';
import 'shell/desktop/mac_tour.dart';
import 'shell/desktop/mac_window.dart';
import 'shell/phone_tour.dart';
import 'tapes/phone_player.dart';
import 'tapes/previews.dart';
import 'core/host_platform.dart';
import 'web/too_old.dart';
import 'web/web_opening.dart';

Future<void> main() async {
  // The web build's copy in JavaScript, for a browser without WebAssembly's garbage collection: it says what the
  // browser needs and opens nothing, since its numbers cannot be the phone's (lib/web/too_old.dart, docs/WEB.md).
  if (kIsWeb && !kIsWasm) return runApp(const TooOldBrowser());
  // Flutter's binding, which draws nothing while Android is taking the app from the front (app/front_frames.dart).
  GhostBinding.ensureInitialized();
  // Windows has no native title bar: the app's own top row carries the drag area and window controls.
  // Configure that frame before the first Flutter view is shown, so startup never flashes a second title bar.
  if (!kIsWeb && Platform.isWindows) {
    await windowManager.ensureInitialized();
    // As large as it was made to open, but never larger than the screen's room: on a small screen a centred window
    // taller than it put its title strip, and the window's buttons, off the top.
    final room = (await screenRetriever.getPrimaryDisplay()).visibleSize;
    final options = WindowOptions(
      size: room == null ? const Size(1280, 760) : Size(room.width < 1280 ? room.width : 1280, room.height < 760 ? room.height : 760),
      minimumSize: const Size(760, 560),
      center: true,
      title: 'Ghost.md',
      titleBarStyle: TitleBarStyle.hidden,
      windowButtonVisibility: false,
    );
    await windowManager.waitUntilReadyToShow(options, () async {
      await windowManager.show();
      await windowManager.focus();
    });
  }
  // A build made to be measured times its own start and every frame after (lib/perf); any other does none of it.
  PerfLaunch.begin();
  // Every error nobody catches, from here on, is kept and said (lib/diag/error_log.dart), and in a debug build
  // still written out in full.
  installErrorLog();
  // The keyboard that was up when the app was left is up again when it is come back to (core/keep_keyboard.dart).
  KeepKeyboard.install();
  // Every date in the phone's own words and order, as the page's Intl writes them (core/locale_dates.dart): the
  // phone's language is heard now, and its own words for a date asked for below (core/phone_dates.dart).
  final locale = PlatformDispatcher.instance.locale;
  useLocaleOf(locale.languageCode, locale.countryCode);
  // The phone's own time zone and clocks, for a blank that asks the time somewhere (core/phone_zones.dart): asked
  // now and waited for by nothing.
  unawaited(usePhoneZones());
  // The Mac app's window (its menu bar, its three lights) and a desktop's keys: nothing on a phone.
  MacWindow.instance.attach();
  DesktopKeys.attach();
  // The app's token sheet, worked out as the app was built (lib/app/token_sheet.g.dart, tool/token_sheet.dart): no
  // stylesheet is read or parsed here, which was the longest wait of a quiet start.
  final sheet = appTokenSheet();
  PerfLaunch.step('sheet');
  // The library's core, begun now and not waited for: the first frame is the launch screen, which says "Opening
  // your notes" while it opens, and the app is put under it as soon as it has (lib/root/opening.dart). It opens in
  // an isolate of its own, so the launch screen's first frames are not held by it.
  final opening = _opened();
  // The things the first frame does wait for, and none of them for another: begun together.
  final (_, _, locator, _) = await (
    // Edge to edge, as the web app's page is under Android's bars: the page pads itself by the safe areas.
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge).whenComplete(() => PerfLaunch.step('chrome')),
    _remembered(),
    // Where the phone is, for a note keeping its place: asked only from a press, or for a new note with tagging on.
    // The place's name is OpenStreetMap's, asked once as the app itself; so are a tagged note's tiles.
    PhoneLocator().attach().whenComplete(() => PerfLaunch.step('located')),
    // The phone's words for a date, where its language is not American or British English: asked of the phone's
    // own ICU, and waited for a moment at most. Those two are not asked at all.
    usePhoneDates(locale.languageCode, locale.countryCode),
  ).wait;
  // Whether the phone has a connection, and the moment one comes back (Android's own; anywhere else there is
  // always one as far as the app can tell). Not waited for: it answers when the phone does.
  // A browser on an Android phone is not the Android app: none of the phone's own halves are asked there.
  final android = !kIsWeb && defaultTargetPlatform == TargetPlatform.android;
  final connection = android ? PhoneConnection().start() : null;
  // And its battery, for the AI card's Battery reading (the page's `navigator.getBattery`).
  if (android) useBatterySource(phoneBattery());
  // The app's updates, only in a build told where its own releases are (`--dart-define=GHOST_UPDATES=https://…`)
  // and never in a debug build (lib/core/updates.dart): with none, nothing is asked of anywhere. One for the
  // process, as the core is, and made before the core has opened, since the launch screen asks it to look as it
  // comes up: what it asks of the core (to read what it fetched) waits for the core. It begins its own rounds once
  // the root is up.
  final updates = Updates.forBuild(invoke: (command, [args = const {}]) async => ((await opening).core ?? _noCore)(command, args), localOnly: () => preferences.value.localOnly);
  if (updates != null) debugPrint('[ghost] this build looks for updates at ${updates.config.source}');
  // One PhoneLinks for the life of the app: it holds the channel the activity says `arrived` on.
  final links = PhoneLinks();
  // And one for what other apps share in, on the phone that has a share sheet (lib/share/share_in.dart).
  final shares = android ? PhoneShares() : null;
  // And one player of a note's recording, the phone's own.
  final tapes = PhoneTapePlayer();
  // And one more for the voice memos left in a note, so a memo never takes the tape's playhead.
  final clips = PhoneTapePlayer.clips();
  // And on the Mac, a few for the home page's shelf, which loads the cassettes in view into them ahead so a
  // resting mouse only presses Play (Matt, 2026-10-24). The other computers have no player of a recording yet.
  final previews = !kIsWeb && defaultTargetPlatform == TargetPlatform.macOS ? TapePreviews.mac() : null;
  PerfLaunch.step('runApp');
  final placeLookup = geocodePlace(geocodeFetcher(), lang: () => PlatformDispatcher.instance.locale.toLanguageTag());
  // A place by its name, for Remind me at a place: asked as the app, a second apart, never under Local only.
  final placeSearch = geocodeSearch(geocodeFetcher(), lang: () => PlatformDispatcher.instance.locale.toLanguageTag());
  final mapTiles = MapTiles().builder;
  runApp(GhostApp(
    sheet: sheet,
    home: GhostOpening<_Opened>(
      opened: opening,
      updates: updates,
      onStep: PerfLaunch.step,
      builder: (context, opened, seat, restart) => GhostRoot(
        core: opened.core,
        native: opened.whole,
        account: opened.account,
        voiceMaking: opened.voice,
        voiceLater: opened.voiceLater,
        links: links,
        shares: shares,
        openLink: openLink,
        previewFetch: iPhoneLinkPreviews() ? linkPreviewFetch() : null,
        embedFetch: oEmbedFetch(),
        embedPictures: pictureFetch(),
        restart: restart,
        launchSeat: seat,
        tapePlayer: tapes,
        clipPlayer: clips,
        tapePreviews: previews,
        // With no core there is nothing to read an update with, and none is looked for.
        updates: opened.core == null ? null : updates,
        locator: locator,
        placeLookup: placeLookup,
        placeSearch: placeSearch,
        mapTiles: mapTiles,
        picturePicker: kIsWeb ? null : phonePicturePicker,
        films: opened.films,
        dayPicker: android || runsAsIPhoneApp ? phoneDayPicker : null,
        connection: connection,
      ),
    ),
  ));
  // A measured build takes its walk (lib/perf/perf_run.dart).
  unawaited(runPerf());
  // A debug build of the Mac app started with a script walks itself (lib/shell/desktop/mac_tour.dart).
  unawaited(runMacTour());
  // And of the iPhone app, in its simulator (lib/shell/phone_tour.dart).
  unawaited(runPhoneTour());
}

/// What this device chose and how it left things, before anything is drawn. Storage that will not answer is not
/// waited for: the app opens on its defaults, and what was kept is read over them when it comes
/// (lib/core/preferences.dart). Then the plugins that ship, on the phone's own memory, secure store and network
/// (lib/root/plugin_ground.dart): before the first screen, since Settings' rows, the editor's parser and the
/// Academy's lessons read them.
Future<void> _remembered() async {
  // What the Tauri app's page kept, brought into this app's own store the first time this app wakes in that app's
  // folder (lib/carry/tauri_carry.dart): before a preference is read, so the first screen is the person's own.
  await (await _carry)?.settings();
  try {
    await preferences.load().timeout(const Duration(seconds: 2));
    useStored(await DeviceStored.open().timeout(const Duration(seconds: 2)));
  } catch (_) {
    // Refused (core/stored.dart): a device that cannot remember, not an error.
  }
  installPlugins();
  PerfLaunch.step('stored');
}

/// The carry from the Tauri app: on a phone, and in the Mac app and the iPhone app that replace the Tauri ones
/// (any other Mac or iPhone build has a folder of its own and nothing to do with that app's; a measured build
/// fills a library of its own). One for the launch, since its halves are asked from two places. Null where there is
/// none, or where the device will not say where its files are or open its store.
final Future<TauriCarry?> _carry = () async {
  // Never the Mac App Store's build: a sandboxed app cannot read another app's folder or its Keychain item, so
  // it carries nothing and starts as a new install (lib/core/mac_app.dart `macAppStore`).
  final mac = runsAsMacApp && replacesTauriApp && !macAppStore;
  final iPhone = runsAsIPhoneApp && replacesTauriApp;
  if (kIsWeb || (defaultTargetPlatform != TargetPlatform.android && !mac && !iPhone) || ghostPerf) return null;
  try {
    final dirs = await DevicePaths.find();
    final kept = await DeviceCarryPrefs.open().timeout(const Duration(seconds: 2));
    // The Mac's is over other ground: a folder of this app's own, with the Tauri app's copied into it
    // (lib/carry/mac_carry.dart). `GHOST_CARRY_LIBRARY` names a folder to take for `~/Library`, for a run over a
    // copy of somebody's data (docs/CUTOVER.md, section 7).
    if (mac) return macCarry(ownDataDir: dirs.dataDir, prefs: kept, secure: deviceSecureStore(), standIn: Platform.environment['GHOST_CARRY_LIBRARY']);
    // An iPhone's is the Mac's, inside the container the update left this app in (lib/carry/iphone_carry.dart).
    if (iPhone) return iPhoneCarry(ownDataDir: dirs.dataDir, prefs: kept, secure: deviceSecureStore());
    return TauriCarry(dataDir: dirs.dataDir, prefs: kept, secure: deviceSecureStore(), device: const ChannelCarryDevice());
  } catch (failure) {
    debugPrint('[carry] not begun: $failure');
    return null;
  }
}();

/// What the app is made over, once it has opened.
typedef _Opened = ({CoreInvoke? core, GhostCore? whole, AccountMaking? account, VoiceMaking? voice, Future<VoiceMaking?>? voiceLater, Films? films});

/// What is asked of a core that would not open answers.
Future<Object?> _noCore(String command, [Map<String, Object?> args = const {}]) => Future<Object?>.error(const CoreError('Ghost.md\'s core would not open.'));

/// The notes library and what is made over it: the web app's own Rust, asked across FFI (lib/core/native). A phone
/// where it will not load still opens, on the invented library, rather than on nothing: then every part is null.
/// It never fails: the app is put up when it completes.
Future<_Opened> _opened() async {
  CoreInvoke? core;
  GhostCore? whole;
  AccountMaking? account;
  VoiceMaking? voice;
  Films? films;
  Future<VoiceMaking?>? voiceLater;
  // In a browser the library is the page's and its core a worker's (lib/web, docs/WEB.md): no voice, no films, and
  // the account made over the same. A browser whose core will not open opens on the invented library.
  if (kIsWeb) {
    try {
      final opened = await openInBrowser(base: accountBase(ghostApiDefine));
      core = opened.core;
      account = opened.account;
      if (account != null) debugPrint('[ghost] this build has an account service: ${account.base}');
    } catch (failure) {
      debugPrint('[ghost] the library would not open in this browser: $failure');
    }
    return (core: core, whole: null, account: account, voice: null, voiceLater: null, films: null);
  }
  try {
    // A debug build in the iPhone's simulator, asked for the store pictures' invented notes, opens no core
    // (lib/shell/phone_tour.dart). Never true in a release: the compiler folds it to false.
    if (await tourWantsInventedLibrary() || macTourWantsInventedLibrary()) throw StateError('the tour asked for the invented library');
    // The library's code and where this device keeps things: asked together.
    final (native, dirs) = await (GhostCore.open(), _folders()).wait;
    // On a Mac the Tauri app's library is copied into this app's folder before the core is opened on it
    // (lib/carry/mac_carry.dart), and on an iPhone the same inside its container (lib/carry/iphone_carry.dart). An
    // Android phone has no such half: its library is where the core already looks.
    if (runsAsMacApp || runsAsIPhoneApp) await (await _carry)?.copied();
    await native.init(dataDir: dirs.dataDir, cacheDir: dirs.cacheDir);
    core = native.invoke;
    whole = native;
    // Files in notes, scans and the words read in them (lib/files/files_kit.dart): not on an iPhone yet.
    if (defaultTargetPlatform != TargetPlatform.iOS) FilesKit.start(dataDir: dirs.dataDir, invoke: native.invoke);
    PerfLaunch.step('core');
    // A measured build's library is brought up to a real one's size before the app reads it (lib/perf/perf_seed.dart).
    if (ghostPerf && ghostPerfSeed > 0) {
      final made = await seedPerfLibrary(native.invoke, ghostPerfSeed);
      if (made > 0) debugPrint('[perf] made $made notes for the walk; this start is not one to time');
    }
    // Voice: the phone's meeting service attached and what this launch was for read, before the first frame. A
    // model is only ever fetched from where this build was told (`--dart-define=GHOST_MODELS=http://…`), and never
    // from the real mirrors by a build that is not a release. No microphone is opened here, or by anything but a
    // recorder's screen. Not on an iPhone, which records nothing and runs no model, as the real iPhone app does
    // not (lib/core/iphone_app.dart `recordsVoice`): its core is built without the engines, and nothing is made.
    // Begun before the account's crypto is waited for: neither needs the other. Waited for three seconds and no
    // longer: a phone slower than that opens without it, and has it when it comes (`voiceLater`).
    final attaching = !recordsVoice
        ? null
        : inTime(VoiceMaking.attach(native, dataDir: dirs.dataDir, mirrors: voiceMirrors(ghostModelsDefine)), failed: (failure) => debugPrint('[ghost] voice is off for this run: $failure'));
    // The account, only in a build told where its service is (`--dart-define=GHOST_API=http://…`), and never the
    // real service from a debug build (docs/STAGE7.md). With none, nothing of the account is made at all.
    // The session, the keys and the plugins' secrets the Tauri app kept, into the phone's secure store before
    // anything asks it who is signed in (lib/carry/tauri_carry.dart): the core is loaded, which is all it needs.
    await (await _carry)?.secrets(native.invoke);
    final base = accountBase(ghostApiDefine);
    if (base != null) {
      account = AccountMaking(base: base, crypto: await CoreCrypto.withLane(native), dataDir: dirs.dataDir);
      debugPrint('[ghost] this build has an account service: $base');
    } else if (ghostApiDefine.isNotEmpty) {
      debugPrint('[ghost] GHOST_API was refused: a development build never talks to the real service, and a base must be an http address.');
    }
    final attached = await attaching;
    voice = attached?.now;
    voiceLater = attached?.later;
    if (voiceLater != null) debugPrint('[ghost] voice was not attached in three seconds: the app opens without it, and takes it when it comes');
    PerfLaunch.step('voice');
    // A film in a note: the phone's picker, the core that keeps it and the phone's player (Android only, as the
    // page's was).
    if (defaultTargetPlatform == TargetPlatform.android) {
      final invoke = native.invoke;
      Films? made;
      films = made = Films(device: PhoneFilmDevice(invoke), pick: phoneFilmPicker(invoke, kept: (video) => made?.kept(video)));
    }
  } catch (failure) {
    debugPrint('[ghost] the library would not open: $failure');
  }
  return (core: core, whole: whole, account: account, voice: voice, voiceLater: voiceLater, films: films);
}

Future<DevicePaths> _folders() async {
  final dirs = PerfLaunch.dirs() ?? await DevicePaths.find();
  PerfLaunch.step('paths');
  return dirs;
}
