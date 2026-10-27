/// Settings kept the same on every device (docs/SYNC.md). A port of `src/app/core/sync/prefs.ts`.
///
/// AttackFM's settings blob, one sealed object written from the revision last seen. A device that changed nothing
/// takes what another device wrote; a device that changed its settings sends them. When two did, each setting goes
/// to whichever changed it, measured from what this device last saw ([merged]): a tab opened here must not undo a
/// note filed there. Only when both changed the same setting does the one sending now win - settings are chosen, not
/// typed, and choosing again is a tap.
///
/// Only the settings that describe the person travel ([syncedPrefs]). Which model this phone has downloaded, and
/// whether this device talks to the network at all, stay with the device.
///
/// What differs, and it is the whole point of this file's second half:
/// - **The pass works on the settings as JSON**, the web's stored shape, never on the typed [Preferences]. The
///   page's `Preferences` is whatever object the store held, so a field a newer build added rides through a pass
///   untouched; the Dart type would drop it on the way in and the next push would erase it from every device.
///   [syncPrefs] therefore reads and writes maps, and [PrefsBridge] stands between it and the typed
///   [PreferencesStore]: it keeps what the account holds as it came off the wire, and gives the pass this device's
///   settings with everything the type does not model put back ([restored]). So a round trip through this app never
///   drops a field, a nested field, or a value this build cannot draw (test/sync/prefs_lossless_test.dart).
/// - The page's own `known` drops every top-level key of the blob it does not sync, and so loses a setting a newer
///   build syncs as soon as an older one writes. Here those keys are carried and sent back as they came
///   ([PrefsContext.carry], [PrefsContext.carried]).
/// - `fetch` and WebCrypto are the [Api] and the [AccountCrypto] the context is given.
library;

import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../account/api.dart';
import '../account/crypto_api.dart';
import '../ai/summary_handoff.dart' show mergedHandoffs, summaryHandoffsKey;
import '../core/preferences.dart';
import '../core/stored.dart';
import '../plugins/lovart/banner_run.dart' show bannerClaimKey, chosenBannerClaim;
import 'sealed_keys.dart' show mergedSealedKeys, sealedKeysKey;

/// The settings that travel (`SYNCED_PREFS`), in the page's order, which is the order they are written in.
const List<String> syncedPrefs = [
  'theme',
  // The home page's layout: a way of looking at the same notes, chosen once for every device.
  'homeLayout',
  'homeLayoutChosen',
  // Simple or advanced (GHST-103): one choice for the person, so a phone and a Mac match (Matt, 2026-10-18).
  'experience',
  'experienceChosen',
  'topBar',
  'density',
  'assist',
  'textSize',
  'typeface',
  'noteFace',
  'refine',
  'quietStop',
  'review',
  'summaries',
  // When a meeting is written up, and whether its audio syncs: the person's choices, whichever device made it.
  'writeUp',
  'syncMeetingRecordings',
  // Whether that switch was ever touched: until it is, a meeting's audio syncs (GHST-112), whatever an older build
  // wrote.
  'syncMeetingRecordingsChosen',
  'codeLight',
  'codeDark',
  'codeChosen',
  'noteView',
  'marksInMargin',
  'wisp',
  'wispEdge',
  'ripples',
  'motionSpeed',
  'linkPreviews',
  // Whether a canvas's cards land on its dots: a way of working, the same on every device.
  'canvasSnap',
  // Where a note was written: the map and the place names describe the person, so they travel. Tagging new notes
  // does not: it makes this device ask for its position, and whether a device talks to the network stays with it.
  'mapTiles',
  'placeNames',
  // The notes left open: they belong to the person, so the tabs are the same wherever they pick the app up.
  'openNotes',
  'tabGroups',
  // The workspaces themselves, and which note is filed in each. Which one is being looked at stays on the device.
  'workspaces',
  // What is in the trash: thrown away on one device, in the trash on every one.
  'trash',
  // Which notes are meetings: recorded on one device, a meeting on every one.
  'meetings',
  // Which note each meeting Ghost was in became (lib/meet/meet_in.dart `meetingNotesKey`): filed on one device, opened
  // from a meeting plugin's page on every one.
  'meetingNotes',
  // Whether a meeting written up is sorted into a workspace's Meetings folder by the AI, and which meetings the app
  // filed and which have been sorted (lib/ai/meeting_sort.dart): the person's, so a meeting is sorted once, on
  // whichever device writes it up.
  'sortMeetings',
  'meetingSorts',
  // Which meetings have been posted to Slack (lib/plugins/slack/meetings.dart): marked by the device that writes one
  // up, so no other device, and no summary made again, posts it twice. Where they go stays with the device, as the
  // channels do.
  'slackMeetingPosts',
  // And to Discord (lib/plugins/discord/meetings.dart; Matt, 2026-10-26), on a mark of its own: a meeting posted to
  // both is posted once to each.
  'discordMeetingPosts',
  // The meetings waiting for a summary another device can write, who claimed each and which are done
  // (lib/ai/summary_handoff.dart): marked on the device that could not, claimed and written on one that can. Merged an
  // entry at a time, and an entry both devices changed by its own rule (`mergedHandoffs`), so it is claimed once.
  'summaryHandoffs',
  // Which device is making Lovart's header images for the recent notes, and how far it is
  // (lib/plugins/lovart/banner_run.dart; Matt, 2026-10-26): claimed before a run starts, so two of the account's
  // devices never spend Lovart credits on the same notes. Where both changed it, a live claim of another device's
  // that the account held stands (`chosenBannerClaim`).
  bannerClaimKey,
  // The notes shared by a link, with their keys: listed, followed and stopped from any device.
  'shares',
  // Which notifications are drawn and counted, and which organizations are muted: chosen once for every device.
  'notifications',
  // Searches kept by name (lib/core/smart_notebooks.dart), and where today's note goes and what it starts from
  // (lib/notes/daily_notes.dart): the person's, on every device.
  'smartNotebooks',
  'dailyNotes',
  // The calendars read (lib/calendar/setup.dart, docs/CALENDAR.md): the iCal addresses and Google's sign-in, sealed
  // with the rest, so a calendar added on one device is on every one. What each device fetched stays with it.
  'calendars',
  // The webhooks (lib/integrations/webhooks/setup.dart, docs/INTEGRATIONS.md): each outgoing hook's URL, events, scope
  // and secret, and each incoming hook's default note, sealed with the rest. How each hook last went stays with the
  // device that sent it.
  'webhooks',
  // The keys and connections that follow the account (lib/sync/sealed_keys.dart; Matt, 2026-10-26: "things like the
  // Claude tokens and other stuff is kept in sync across all instances of ghost logged in to my account"): Claude's
  // key and its choices, the Slack and Discord channels with their webhooks, the GitHub token. Each value sealed again on its own,
  // so the settings kept on a device in the clear hold none of them readable; merged an entry at a time, the later
  // change winning (`mergedSealedKeys`).
  sealedKeysKey,
];

/// The settings this build syncs: [syncedPrefs], or the list a test gives to be an older build
/// ([syncedPrefsAsOlderBuild]).
List<String> _synced = syncedPrefs;

/// For the tests: this app as an older build that syncs only [keys], or as itself again for null.
@visibleForTesting
// ignore: avoid_setters_without_getters
set syncedPrefsAsOlderBuild(List<String>? keys) => _synced = keys ?? syncedPrefs;

typedef _Entries = Map<String, Object?>;

/// The synced settings out of a whole set (`pickSynced`), in [syncedPrefs]' order. A key the set does not have is
/// left out, as `JSON.stringify` leaves out an `undefined`.
Map<String, Object?> pickSynced(Map<String, Object?> prefs) => {
      for (final key in _synced)
        if (prefs.containsKey(key)) key: prefs[key],
    };

_Entries? _entries(Object? value) => value is Map ? value.cast<String, Object?>() : null;

/// Only the known keys, from a blob a newer or older build may have written (`known`).
Map<String, Object?> _known(Object? value) {
  final map = _entries(value);
  if (map == null) return {};
  return {
    for (final key in _synced)
      if (map.containsKey(key)) key: map[key],
  };
}

/// What a blob holds beside the settings this build syncs: a newer build's, carried and not read.
Map<String, Object?> _unknown(Object? value) {
  final map = _entries(value);
  if (map == null) return {};
  return {
    for (final entry in map.entries)
      if (!_synced.contains(entry.key)) entry.key: entry.value,
  };
}

/// A value as `JSON.stringify` writes it, with a key that is not there told apart from one that holds null.
String _said(_Entries map, String key) => map.containsKey(key) ? jsonEncode(map[key]) : '\u0000';

/// One map, entry by entry: an entry changed here since [base] stays as it is here, and every other is theirs
/// (`mergedEntries`).
_Entries _mergedEntries(_Entries base, _Entries mine, _Entries theirs) {
  final out = <String, Object?>{};
  for (final key in {...theirs.keys, ...mine.keys}) {
    final from = _said(mine, key) == _said(base, key) ? theirs : mine;
    if (from.containsKey(key)) out[key] = from[key];
  }
  return out;
}

/// A list of things with ids, the same way: theirs in their order, with what was added or changed here
/// (`mergedList`).
List<Object?> _mergedList(List<Object?> base, List<Object?> mine, List<Object?> theirs) {
  _Entries byId(List<Object?> list) => {
        for (final each in list)
          if (each is Map) '${each['id']}': each,
      };
  final kept = _mergedEntries(byId(base), byId(mine), byId(theirs));
  final order = <String>{
    for (final each in [...theirs, ...mine])
      if (each is Map) '${each['id']}',
  };
  return [
    for (final id in order)
      if (kept.containsKey(id)) kept[id],
  ];
}

/// The merged workspaces with a colour put back on a folder both devices made since [base]: the one here, kept as
/// what both changed is, from a note's path in a team pass, which knows no colour, and theirs by hand, in the colour
/// the person chose (2026-10-23: a folder's id is its place's, lib/core/workspaces.dart, so the two meet as one).
/// Only a colour is taken, and only onto one that has none: a folder that was here before has its own.
List<Object?> _madeOnBoth(List<Object?> base, List<Object?> theirs, List<Object?> list) {
  final before = {for (final each in base) if (each is Map) '${each['id']}'};
  final hues = {
    for (final each in theirs)
      if (each is Map && each['hue'] is String && !before.contains('${each['id']}')) '${each['id']}': each['hue'],
  };
  if (hues.isEmpty) return list;
  return [
    for (final each in list)
      if (each is Map && each['hue'] == null && hues.containsKey('${each['id']}')) {...each, 'hue': hues['${each['id']}']} else each,
  ];
}

/// This device's settings and another's, both changed since [base] (`merged`). A setting only one of them changed is
/// that one's. The maps (which note is filed where, what is in the trash) are merged an entry at a time, since a
/// filing made on one device and another made elsewhere are two changes, not one. What both changed stays as it is
/// here - but for a meeting's summary claimed on both ([summaryHandoffsKey]), where the account's live claim stands, and
/// the header images' run claimed on both ([bannerClaimKey]), likewise.
/// [now] is when a claim is judged live at, the clock's unless a test says.
Map<String, Object?> merged(Map<String, Object?> base, Map<String, Object?> mine, Map<String, Object?> theirs, {int? now}) {
  final out = <String, Object?>{...mine};
  for (final key in _synced) {
    if (!theirs.containsKey(key)) continue;
    final b = _entries(base[key]), m = _entries(mine[key]), t = _entries(theirs[key]);
    if (_said(mine, key) == _said(base, key)) {
      out[key] = theirs[key];
    } else if (_said(theirs, key) == _said(base, key) || _said(theirs, key) == _said(mine, key)) {
      continue;
    } else if (key == 'workspaces' && b != null && m != null && t != null && [b, m, t].every((each) => each['list'] is List && each['notes'] is Map)) {
      final list = _madeOnBoth(b['list'] as List, t['list'] as List, _mergedList(b['list'] as List, m['list'] as List, t['list'] as List));
      final notes = _mergedEntries(_entries(b['notes'])!, _entries(m['notes'])!, _entries(t['notes'])!);
      // A note filed in a workspace the other device removed is in none.
      notes.removeWhere((note, space) => !list.any((each) => each is Map && each['id'] == space));
      out[key] = {...m, 'list': list, 'notes': notes};
    } else if (key == sealedKeysKey && m != null && t != null) {
      // The later change of each key stands, a removal among them (lib/sync/sealed_keys.dart).
      out[key] = mergedSealedKeys(b ?? const {}, m, t);
    } else if (key == bannerClaimKey) {
      // A run claimed on another device first is that device's to make.
      final chosen = chosenBannerClaim(mine[key], theirs[key], now: now);
      if (chosen == null) {
        out.remove(key);
      } else {
        out[key] = chosen;
      }
    } else if (key == summaryHandoffsKey && m != null && t != null) {
      // A live claim the account already held is kept over this device's: a meeting's summary is claimed once.
      out[key] = mergedHandoffs(b ?? const {}, m, t, now: now);
    } else if (b != null && m != null && t != null) {
      out[key] = _mergedEntries(b, m, t);
    }
  }
  return out;
}

/// What a device remembers of the account's settings (`PrefsState`).
@immutable
class PrefsState {
  const PrefsState({this.rev = 0, this.seen});

  /// A state as kept, forgivingly (`{ ...fallback, ...raw }`).
  factory PrefsState.fromJson(Object? raw) {
    final map = raw is Map ? raw : const <Object?, Object?>{};
    final rev = map['rev'], seen = map['seen'];
    return PrefsState(rev: rev is num ? rev.toInt() : 0, seen: seen is String ? seen : null);
  }

  final int rev;

  /// The synced settings as they were at [rev], as JSON: what "changed here" is measured from.
  final String? seen;

  Map<String, Object?> toJson() => {'rev': rev, 'seen': seen};
}

/// What a pass of the settings works with (`PrefsContext`).
class PrefsContext {
  PrefsContext({
    required this.token,
    required this.key,
    required this.read,
    required this.write,
    required this.state,
    required this.save,
    required this.api,
    required this.crypto,
    this.carried,
    this.carry,
  });

  final String token;
  final SealKey key;

  /// This device's settings, whole, in the web's stored shape.
  final Map<String, Object?> Function() read;

  /// Lays [next] over this device's settings (`setPreferences(partial)`).
  final void Function(Map<String, Object?> next) write;
  PrefsState state;
  final void Function(PrefsState state) save;
  final Api api;
  final AccountCrypto crypto;

  /// What the account's blob held beside the settings this build syncs, sent back with every write.
  final Map<String, Object?> Function()? carried;

  /// Told what a blob just opened held beside them, to be [carried] from then on.
  final void Function(Map<String, Object?> unknown)? carry;
}

/// One pass of the settings (`syncPrefs`). Answers whether this device's settings were changed by another's.
Future<bool> syncPrefs(PrefsContext ctx, {bool retry = true}) async {
  final answer = await ctx.api.callMap('GET', 'prefs', token: ctx.token);
  final rev = answer['rev'] is num ? (answer['rev'] as num).toInt() : 0;
  final blob = answer['blob'] is String && (answer['blob'] as String).isNotEmpty ? answer['blob'] as String : null;
  final mine = jsonEncode(pickSynced(ctx.read()));
  final changedHere = ctx.state.seen != mine;
  var took = false;

  Future<Map<String, Object?>> open(String sealed) async {
    final whole = await ctx.crypto.open(ctx.key, sealed, 'prefs');
    ctx.carry?.call(_unknown(whole));
    return _known(whole);
  }

  if (rev != ctx.state.rev && blob != null && (!changedHere || ctx.state.seen == null)) {
    // Another device wrote, and this one has nothing of its own to say - or has never synced, in which case the
    // account's settings are the ones a person signing in expects to see.
    final theirs = await open(blob);
    ctx.write(theirs);
    final after = pickSynced(ctx.read());
    final now = jsonEncode(after);
    took = now != mine;
    // Keys this device holds and an account that never had any does not: this device's to send, so not counted as
    // seen, and the next pass sends them (lib/sync/sealed_keys.dart). Any other setting the account lacks stays as
    // it always has.
    final unsent = !theirs.containsKey(sealedKeysKey) && after.containsKey(sealedKeysKey);
    ctx.state = PrefsState(rev: rev, seen: unsent ? jsonEncode({...after}..remove(sealedKeysKey)) : now);
    ctx.save(ctx.state);
    return took;
  }
  if (!changedHere && rev == ctx.state.rev) return false;

  var sending = mine;
  final seen = ctx.state.seen;
  if (rev != ctx.state.rev && blob != null && seen != null) {
    // Both wrote: what the other device changed and this one did not is taken before this one's are sent.
    final theirs = await open(blob);
    final base = _entries(jsonDecode(seen)) ?? const <String, Object?>{};
    ctx.write(merged(base, pickSynced(ctx.read()), theirs));
    sending = jsonEncode(pickSynced(ctx.read()));
    took = sending != mine;
  }
  try {
    final sealed = await ctx.crypto.seal(ctx.key, {...pickSynced(ctx.read()), ..._unknown(ctx.carried?.call())}, 'prefs');
    final written = await ctx.api.callMap('PUT', 'prefs', token: ctx.token, body: {'base': rev, 'blob': sealed});
    ctx.state = PrefsState(rev: written['rev'] is num ? (written['rev'] as num).toInt() : rev, seen: sending);
    ctx.save(ctx.state);
  } on ApiError catch (failure) {
    // Written by another device between the read and the write: read again, once.
    if (retry && failure.status == 409) return await syncPrefs(ctx, retry: false) || took;
    rethrow;
  }
  return took;
}

// --- the typed store, and what it does not model ---------------------------------------------------------------------

/// Whether two decoded JSON values say the same thing, whatever order their keys came in.
bool _alike(Object? a, Object? b) {
  if (a is Map && b is Map) {
    if (a.length != b.length) return false;
    for (final key in a.keys) {
      if (!b.containsKey(key) || !_alike(a[key], b[key])) return false;
    }
    return true;
  }
  if (a is List && b is List) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i += 1) {
      if (!_alike(a[i], b[i])) return false;
    }
    return true;
  }
  return a == b;
}

/// A list of things with ids, by id; null for a list that is not one.
Map<String, Object?>? _listById(List<Object?> list) {
  final out = <String, Object?>{};
  for (final each in list) {
    if (each is! Map || each['id'] is! String) return null;
    out[each['id'] as String] = each;
  }
  return out;
}

/// One setting as this device should say it to the account: [mine], the typed store's value, with everything the
/// type does not model put back from [raw], the value as the account holds it. [read] is how this build's type read
/// [raw] (so what it kept of it).
///
/// Unchanged here (the type still reads [raw] as [mine]): [raw], to the letter. Changed here: [mine], and inside a
/// map or a list of things with ids the same question is asked of each entry, with whatever the type left out of
/// [raw] entirely - a field a newer build added - carried over. An entry the type did read and this device no longer
/// has was taken out here, and stays out.
Object? restored(Object? raw, Object? read, Object? mine) {
  if (_alike(read, mine)) return raw;
  if (raw is Map && read is Map && mine is Map) {
    return <String, Object?>{
      for (final entry in mine.entries)
        entry.key as String: raw.containsKey(entry.key) && read.containsKey(entry.key) ? restored(raw[entry.key], read[entry.key], entry.value) : entry.value,
      for (final entry in raw.entries)
        if (!read.containsKey(entry.key) && !mine.containsKey(entry.key)) entry.key as String: entry.value,
    };
  }
  if (raw is List && read is List && mine is List) {
    final rawById = _listById(raw), readById = _listById(read), mineById = _listById(mine);
    if (rawById != null && readById != null && mineById != null) {
      return [
        for (final each in mine)
          () {
            final id = (each as Map)['id'] as String;
            return rawById.containsKey(id) && readById.containsKey(id) ? restored(rawById[id], readById[id], each) : each;
          }(),
      ];
    }
  }
  return mine;
}

/// The typed [PreferencesStore] as [syncPrefs] reads and writes it, with nothing lost in between.
///
/// It keeps [held]: the synced settings as the account has them, as JSON off the wire, with whatever a newer build
/// put in them; and [unknown], the blob's keys this build does not sync at all. [read] is the store's settings with
/// [restored] run over every synced key, so what goes back to the account is what came, changed only where this
/// device changed it. [write] lays the account's settings into the store through `Preferences.fromJson`, the same
/// door a kept store comes in by, and leaves everything that is not synced - this device's own keys, and the store's
/// own unknown ones in [Preferences.more] - exactly as it was.
///
/// One thing the type cannot tell: a value it could not draw and read as its default (a theme from a later build,
/// read as `dark`) and the person choosing that very default. So the bridge follows the store: a synced setting that
/// is a single value and changes here while [applying] is false is this device's from then on, and what the account
/// held for it is let go.
class PrefsBridge {
  /// [kept] is this device's memory and [key] where the bridge keeps [held] and [unknown] in it (per account, so a
  /// second account never sends the first one's); neither, and they are held for this run only.
  PrefsBridge({required this.store, Stored? kept, String? key})
      : _kept = kept,
        _key = key {
    _load();
    _typed = store.value.toJson();
    store.addListener(_heard);
  }

  final PreferencesStore store;
  final Stored? _kept;
  final String? _key;

  Map<String, Object?> _held = {};
  Map<String, Object?> _carried = {};
  late Map<String, Object?> _typed;

  /// Whether the change now landing in the store is the account's, not the person's (`applyingRemote`).
  bool applying = false;

  /// The synced settings as the account holds them, as far as this device has seen.
  Map<String, Object?> get held => _held;

  /// What the account's blob holds beside them.
  Map<String, Object?> get unknown => _carried;

  void _load() {
    final kept = _kept, key = _key;
    if (kept == null || key == null) return;
    final raw = kept.read<Object?>(key, null);
    if (raw is! Map) return;
    _held = _entries(raw['synced']) ?? {};
    _carried = _entries(raw['unknown']) ?? {};
  }

  void _keep() {
    final kept = _kept, key = _key;
    if (kept == null || key == null) return;
    kept.write(key, _held.isEmpty && _carried.isEmpty ? null : {'synced': _held, 'unknown': _carried});
  }

  void _heard() {
    final now = store.value.toJson();
    if (!applying) {
      var let = false;
      for (final key in _synced) {
        final was = _held[key];
        if (!_held.containsKey(key) || was is Map || was is List) continue;
        if (!_alike(now[key], _typed[key])) {
          _held.remove(key);
          let = true;
        }
      }
      if (let) _keep();
    }
    _typed = now;
  }

  /// This device's settings, whole, as the account should hear them (`PrefsContext.read`).
  Map<String, Object?> read() {
    final typed = store.value.toJson();
    if (_held.isEmpty) return typed;
    final asRead = Preferences.fromJson({...typed, ..._held}).toJson();
    return {
      for (final entry in typed.entries)
        entry.key: _held.containsKey(entry.key) && _synced.contains(entry.key) ? restored(_held[entry.key], asRead[entry.key], entry.value) : entry.value,
    };
  }

  /// The account's settings laid over this device's (`PrefsContext.write`).
  void write(Map<String, Object?> next) {
    for (final key in _synced) {
      if (next.containsKey(key)) _held[key] = next[key];
    }
    _keep();
    final was = applying;
    applying = true;
    try {
      store.value = Preferences.fromJson({...store.value.toJson(), ...next});
    } finally {
      applying = was;
    }
    _typed = store.value.toJson();
  }

  /// The pass kept its state (`PrefsContext.save`): what it saw is what the account holds now, taken or sent.
  void saved(PrefsState state) {
    final seen = state.seen;
    if (seen == null) return;
    final map = _entries(jsonDecode(seen));
    if (map == null) return;
    _held = map;
    _keep();
  }

  /// `PrefsContext.carried`.
  Map<String, Object?> carried() => _carried;

  /// `PrefsContext.carry`.
  void carry(Map<String, Object?> unknown) {
    _carried = unknown;
    _keep();
  }

  /// Forgets what the account held: for signing out.
  void forget() {
    _held = {};
    _carried = {};
    _keep();
  }

  void dispose() => store.removeListener(_heard);
}
