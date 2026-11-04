/// Header banners for notes, made by Lovart in the house's dotwork (Matt, 2026-10-26: "help me generate a pre-prompt
/// for generation of note summary header images generated with lovart, i want them to be banners at the top in a in
/// house style"; then, of the four offered, "I like the dotwork prompt, bake it into generating the header prompts and
/// add a setting to automatically generate header images for notes (turn it on by default when lovart is enabled)").
///
/// The style is the ghost's own (tauri/docs/GHOSTS.md): stipple dotwork on pure white, in full colour since Matt asked
/// for it (2026-10-26: "The dotwork pre prompts should be full color like the grocery store item from earlier"; they
/// were black ink only before, and lib/note/note_banner.dart draws each as it is), the mascot described
/// word for word as every ghost scene describes it, small on the right two-thirds doing what the note is about, the
/// left third left white, until 2026-11-02: no ghost since, and the scene fills the frame edge to edge. [bannerPrompt] is that pre-prompt with the note's title and its opening as the subject;
/// Lovart picks the one scene. The banner is the note's front matter `banner:` (lib/core/banner.dart), drawn across
/// the top of the page (lib/note/note_screen.dart, by [NoteBannerView]).
///
/// The rules for making one by itself ([LovartBanners.noteLeft]):
/// - **Only where asked.** The plugin on (Local only holds it off), both keys kept, and "Header images for notes" on
///   in its page ([bannersOn]: on until switched off, since adding the plugin is the asking).
/// - **When a note is left**, never while it is open: its words are still moving, and the picture is made from them.
///   So the notes that get one are the ones the person opens, and the library is not spent in one go.
/// - **Only real notes.** Not a ticket, a meeting Ghost was in or a written-up recording, a mail, a canvas, a
///   notebook, a journal or a template; not one with fewer than [bannerMinWords] words; not one with a banner.
/// - **Once per note.** Marked in the plugin's storage before Lovart is asked ([bannersDoneKey]), so a banner taken
///   off, or a failure, asks nothing more; "Header image" on the note's cog is there to make one again.
/// - **Into the note as it is then.** Read again once the picture is kept, written over the revision read; one that
///   moved on meanwhile is read again and written again, [_writeAttempts] times in all.
/// - **Never made twice.** A picture made and kept that still could not be written in (the note's editor stopped
///   saving, the note moving on under every attempt) is owed to the note ([bannersOwedKey]): said in the activity
///   tray, and written in the next time the note is left, with nothing more asked of Lovart (Matt, 2026-11-03:
///   "it's not showing the generated header image", the Columbus note, whose picture was paid for and never landed).
library;

import '../../core/metrics.dart' show trackPlugin;
import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../core/background_jobs.dart';
import '../../core/banner.dart';
import '../../core/front_matter.dart' show frontMatterEnd, frontMatterFence, frontMatterOffset;
import '../../core/images.dart' show PictureStore;
import '../../core/note.dart' show Note;
import '../../core/note_facts.dart' show NoteFacts;
import '../../core/note_text.dart' show hasTape, noteTitle;
import '../../core/summary_text.dart' show summarySection;
import '../../meet/meet_note.dart' show ghostLineStart;
import '../registry.dart' show pluginOn;
import '../types.dart';
import 'client.dart';
import 'figma_refs.dart';
import 'keep.dart';
import 'making.dart' show lovartPictureEnded, lovartPictureJob;
import 'manifest.dart';

/// How many of a note's opening characters tell Lovart what it is about, past its title.
const int bannerChars = 1500;

/// The fewest words a note has before it is given a banner by itself: a grocery list of two things is not yet one.
const int bannerMinWords = 25;

/// How many notes are remembered as given one: the newest.
const int _doneKept = 2000;

/// Where the note goes in a header image's prompt: [bannerStyle]'s, and a person's own ([bannerPromptKey]).
const String bannerNoteSlot = '{note}';

/// The house's banner, a realistic painterly illustration since 2026-11-03 (Matt: "Update the base prompt to be a
/// realistic painterly illustration style"; it was the ghost's dotwork), with [bannerNoteSlot] where the note's scene
/// goes (the default of "Header image prompt" on the plugin's page). No ghost in it since 2026-11-02 (Matt: "don't show the ghost itself in all the generated
/// images"): the mascot was described in every banner, word for word, and was in every one; now the things the note is
/// about tell it, looked up first so they are drawn as they really are (Matt, the same day: "have it do more research
/// online for the note and looking up what assets to include"). Lovart's design agent does the looking up: only the
/// words below and the note's go to Lovart, as before.
const String bannerStyleDefault = '''A wide 16:9 landscape illustration, 1920 by 1080 pixels, never square, for the header banner of a note in Ghost.md, a notes app. Fill the whole frame: the scene runs from the left edge to the right edge, with no empty margins or blank thirds, and its main subjects sit across the middle of the picture so a wider crop keeps them.

A realistic, painterly illustration, highly detailed: true-to-life forms, textures and light, rendered with visible, confident brushwork, like a fine editorial or travel-poster painting. Natural, rich colour and soft, believable lighting with depth and atmosphere; real materials (stone, wood, glass, fabric, food) painted with care. Elegant and calm, never cartoonish.

The scene: {note} Spread it across the full width of the frame, edge to edge.

Full colour, painted, not photographic and not flat vector art. No ghost, no mascot and no cartoon character: the things themselves tell the note. No text, no letters, no words, no logos, no watermark, no border.

Make one image.''';

/// The header image styles to choose from at the head of the plugin's page (Matt, 2026-11-04: "Please generate 4
/// prompts for the painter style. Colored pencil style, rough sketch and ultra HD non stylized versions ... and add the
/// ability to swap between prompt styles at the top of the lovart settings"). Each is a whole prompt, the house's framing
/// round a style of its own; choosing one writes it into "Header image prompt", where it can still be changed, and the
/// one whose words the prompt holds is the one shown chosen. Painterly is the house's ([bannerStyleDefault]).
class BannerPreset {
  const BannerPreset({required this.id, required this.name, required this.blurb, required this.words, required this.sketch});

  final String id;
  final String name;

  /// A line under its name.
  final String blurb;

  /// The whole prompt, with [bannerNoteSlot] where the note goes.
  final String words;

  /// The same style for one object on its own, for a field sketch beside a paragraph (sketches.dart; Kevin,
  /// 2026-11-04: "can we actually have the style of the thing follow the style for banners they select?"): how it is
  /// drawn, and nothing of the banner's frame or scene.
  final String sketch;

  /// Its sample picture, a street in Tokyo drawn in this style (assets/plugins/lovart/styles).
  String get sample => 'assets/plugins/lovart/styles/$id.webp';
}

String _preset(String style, String finish) => """A wide 16:9 landscape image, 1920 by 1080 pixels, never square, for the header banner of a note in Ghost.md, a notes app. Fill the whole frame: the scene runs from the left edge to the right edge, with no empty margins or blank thirds, and its main subjects sit across the middle of the picture so a wider crop keeps them.

$style

The scene: {note} Spread it across the full width of the frame, edge to edge.

$finish No ghost, no mascot and no cartoon character: the things themselves tell the note. No text, no letters, no words, no handwriting, no labels or annotations, no logos, no watermark, no border or frame.

Make one image.""";

final List<BannerPreset> bannerPresets = [
  const BannerPreset(
    id: 'painterly',
    name: 'Painterly',
    blurb: 'Realistic, with visible brushwork',
    words: bannerStyleDefault,
    sketch: 'A realistic, painterly illustration, highly detailed: true-to-life form, texture and light, rendered with visible, confident brushwork, like a fine editorial painting. Natural, rich colour and soft, believable lighting that gives it volume; real materials (stone, wood, glass, fabric, food) painted with care. Elegant and calm, never cartoonish, not photographic and not flat vector art.',
  ),
  BannerPreset(
    id: 'pencil',
    name: 'Coloured pencil',
    blurb: 'Layered pencil on textured paper',
    words: _preset(
      'A simple, loose coloured-pencil and watercolour drawing with very little detail: a few soft, light washes of watercolour and quick coloured-pencil lines over them, shapes suggested rather than drawn out, no fine detail, no small textures and no crisp edges, lots of bare white paper left showing around and between things. A light, airy, gentle children\'s-book feel in a few soft colours, simple and calm, never busy.',
      'Light and simple, mostly white paper with soft pencil and watercolour: not detailed, not realistic, not photographic and not painted in oils.',
    ),
    sketch: 'A simple, loose coloured-pencil and watercolour drawing with very little detail: a few soft, light washes of watercolour and quick coloured-pencil lines over them, its shape suggested rather than drawn out, no fine detail, no small textures and no crisp edges. A light, airy, gentle children\'s-book feel in a few soft colours, simple and calm. Not realistic, not photographic and not painted in oils.',
  ),
  BannerPreset(
    id: 'journal',
    name: 'Field journal',
    blurb: 'Sepia ink and light watercolour',
    words: _preset(
      'A hand-drawn naturalist\'s field-journal sketch, like a page from a 19th-century explorer\'s sketchbook: fine warm sepia-brown pen-and-ink linework with delicate cross-hatching, stippling and varied line weight, finished with a few light, translucent watercolour washes in soft, earthy, naturalistic colours that let the warm paper show through. Careful observation and true proportions with the charm of imperfect hand-drawn strokes and slightly irregular pigment. Not cartoonish, not photographic, no digital gradients, no heavy outlines, no vector look.',
      'Sepia ink and light watercolour washes on warm paper.',
    ),
    // Kevin's naturalist prompt, the style it was first written in (2026-11-04).
    sketch: 'A hand-drawn naturalist\'s field-journal illustration, like one specimen from a 19th-century explorer\'s scientific sketchbook: traditional botanical and scientific illustration in fine sepia-brown pen-and-ink linework with delicate, layered watercolour washes. Meticulous observational detail, organic imperfections, fine cross-hatching, stippling and subtle variations in line weight. Rich but naturalistic colours, softly blended pigments, visible watercolour texture and warm earthy undertones, with minor irregularities in pigment and naturally imperfect ink strokes. Warm sepia ink for every outline, detail, hatch and stipple. Not cartoonish, not photographic, no digital gradients, no heavy outlines, no vector look, not overly polished.',
  ),
  BannerPreset(
    id: 'photo',
    name: 'Ultra HD',
    blurb: 'Photorealistic, no style',
    words: _preset(
      'An ultra high definition, photorealistic image with no stylisation at all: true-to-life detail, materials, colour and light, sharp focus, a believable camera perspective and natural depth of field, like a professional travel photograph taken in good light.',
      'Photorealistic and ultra HD: no illustration style, no painterly or sketch effects, no filters.',
    ),
    sketch: 'An ultra high definition, photorealistic image with no stylisation at all, like a professional studio product photograph cut out from its background: true-to-life detail, materials and colour, sharp focus, soft even light that gives it volume, a believable camera perspective. No illustration style, no painterly or sketch effects, no filters.',
  ),
];

/// The preset the header prompt is now, or null where it has been made a person's own.
BannerPreset? bannerPresetNow([PluginHost? via]) {
  final words = (bannerTemplate(via) ?? bannerStyleDefault).trim();
  for (final preset in bannerPresets) {
    if (preset.words.trim() == words) return preset;
  }
  return null;
}

/// Chooses [preset]: its words become the header prompt (the house's, for Painterly), on every device.
void chooseBannerPreset(BannerPreset preset, [PluginHost? via]) {
  setBannerTemplate(preset.words, via);
  // The anonymous usage stats (lib/core/metrics.dart): the style's id, from the list above; never a prompt typed.
  trackPlugin('lovart', 'style_chosen', choice: preset.id);
}

/// [template] with the note's [subject] where [bannerNoteSlot] is, or after it where the template has no slot; and
/// [extra], the words "Added to every image" holds, before its last line.
String bannerStyle(String subject, {String? template, String? extra}) {
  final words = (template == null || template.trim().isEmpty) ? bannerStyleDefault : template.trim();
  final filled = words.contains(bannerNoteSlot) ? words.replaceAll(bannerNoteSlot, subject) : '$words\n\nThe scene: $subject';
  return withLovartExtra(filled, extra);
}

/// [prompt] with [extra] added: the person's words for every image Lovart makes ([lovartExtraKey]).
String withLovartExtra(String prompt, String? extra) {
  final more = extra?.trim() ?? '';
  return more.isEmpty ? prompt : '$prompt\n\n$more';
}

String _opening(String body) {
  var words = body.substring(frontMatterOffset(body)).replaceAll(RegExp(r'!\[[^\]]*\]\([^)]*\)'), ' ').replaceAll(RegExp(r'\s+'), ' ').trim();
  if (words.length > bannerChars) words = '${words.substring(0, bannerChars).trimRight()}…';
  return words;
}

/// The note's own headings below its title, for what to look up: "Flights, Where we stay, Food".
List<String> _sections(String body) => [
  for (final line in body.substring(frontMatterOffset(body)).split('\n'))
    if (RegExp(r'^#{2,3}\s+\S').hasMatch(line)) line.replaceFirst(RegExp(r'^#+\s+'), '').trim(),
].take(12).toList();

/// The prompt for [body]'s banner: the house style or the person's own ([template]), with the note as the subject:
/// what to look up and a collage of three to six of its places and things, then the note itself, and [extra] on the end.
String bannerPrompt(String body, {String? template, String? extra}) {
  final title = noteTitle(body);
  final opening = _opening(body);
  final sections = _sections(body);
  final subject = [
    // The looking up and the collage are the note's part, whatever the style (Matt, 2026-11-03, with a prompt of his own:
    // "the dotwork was removed now but the prompt doesn't have a collage of multiple places from the note now"): they
    // were the house style's own paragraph, so a person's style left them out and the scene was one place.
    'a collage of the places and things this note is about. Research before you draw: search online for the real places, buildings, products, tools, organisations, foods, plants, animals or events it names, and what each really looks like (its shape, colours, materials, landmarks, packaging). Then choose three to six of them that best stand for the note and compose them together across the frame, each drawn true to the real thing: the actual landmark, the actual dish, the actual kind of device, not a generic one.',
    if (title.isNotEmpty) 'The note is titled “$title”.',
    if (sections.isNotEmpty) 'Its sections: ${sections.join('; ')}.',
    if (opening.isNotEmpty) 'It reads: $opening',
  ].join(' ');
  return bannerStyle(subject, template: template, extra: extra);
}

/// The person's own header image prompt, or null for the house's ([bannerStyleDefault]).
String? bannerTemplate([PluginHost? via]) {
  final Object? kept = (via ?? host).storage.get<Object?>(bannerPromptKey, null);
  return kept is String && kept.trim().isNotEmpty ? kept : null;
}

/// Keeps it; empty, or the house's own words, is the house's again.
void setBannerTemplate(String? words, [PluginHost? via]) {
  final on = via ?? host;
  final trimmed = words?.trim() ?? '';
  if (trimmed.isEmpty || trimmed == bannerStyleDefault.trim()) {
    on.storage.remove(bannerPromptKey);
  } else {
    on.storage.set(bannerPromptKey, trimmed);
  }
}

/// The words added to every image Lovart makes from this app: a header image, an {image: …} and inspiration.
String? lovartExtra([PluginHost? via]) {
  final Object? kept = (via ?? host).storage.get<Object?>(lovartExtraKey, null);
  return kept is String && kept.trim().isNotEmpty ? kept : null;
}

void setLovartExtra(String? words, [PluginHost? via]) {
  final on = via ?? host;
  final trimmed = words?.trim() ?? '';
  trimmed.isEmpty ? on.storage.remove(lovartExtraKey) : on.storage.set(lovartExtraKey, trimmed);
}

/// The notes being given a banner now, by id: their banner's place draws Lovart at work while one is here.
final ValueNotifier<Set<String>> lovartBannerMaking = ValueNotifier<Set<String>>(const {});

void _making(String id, bool on) {
  final next = {...lovartBannerMaking.value};
  if (on ? next.add(id) : next.remove(id)) lovartBannerMaking.value = Set.unmodifiable(next);
}

/// Whether notes are given banners by themselves on this device: on until switched off.
bool bannersOn([PluginHost? via]) => (via ?? host).storage.get<Object?>(bannersKey, true) != false;

/// Switches it.
void setBanners(bool on, [PluginHost? via]) => (via ?? host).storage.set(bannersKey, on);

List<String> _done(PluginHost on) {
  final Object? kept = on.storage.get<Object?>(bannersDoneKey, const <Object?>[]);
  return kept is List ? [for (final id in kept) if (id is String) id] : <String>[];
}

/// The notes this device has given a banner to, or asked Lovart for one: never asked again by themselves.
List<String> bannersGiven([PluginHost? via]) => _done(via ?? host);

/// [ids] taken off that list: a run cut short before their pictures came asks for them again (banner_run.dart).
void forgetBannersGiven(Iterable<String> ids, [PluginHost? via]) {
  final on = via ?? host;
  final gone = ids.toSet();
  final done = _done(on);
  if (!done.any(gone.contains)) return;
  on.storage.set(bannersDoneKey, [for (final id in done) if (!gone.contains(id)) id]);
}

/// What the activity tray says of a header image made that could not be written into its note.
const String bannerUnwrittenWords = 'The header image was made but could not be put in the note. Leaving the note again puts it in, with nothing more asked of Lovart.';

/// How many times a banner is written into its note, reading it again before each, before it is owed instead.
const int _writeAttempts = 4;

Map<String, String> _owed(PluginHost on) {
  final Object? kept = on.storage.get<Object?>(bannersOwedKey, null);
  return kept is Map ? {for (final MapEntry(:key, :value) in kept.entries) if (key is String && value is String) key: value} : <String, String>{};
}

/// The picture made for the note [id] and not yet written into it, or null.
String? bannerOwed(String id, [PluginHost? via]) => _owed(via ?? host)[id];

void _owe(PluginHost on, String id, String? name) {
  final owed = _owed(on);
  if (name == null ? owed.remove(id) == null : owed[id] == name) return;
  if (name != null) owed[id] = name;
  owed.isEmpty ? on.storage.remove(bannersOwedKey) : on.storage.set(bannersOwedKey, owed);
}

void _markDone(PluginHost on, String id) {
  final done = _done(on);
  if (done.contains(id)) return;
  final next = [...done, id];
  on.storage.set(bannersDoneKey, next.length > _doneKept ? next.sublist(next.length - _doneKept) : next);
}

final RegExp _word = RegExp(r'[\p{L}\p{N}]+', unicode: true);

/// Whether [note] is one a banner is made for by itself (the rules above), banner and keys aside. [replacing], one
/// that may have one already: a run's Redo black-and-white headers in colour (banner_run.dart). A note that says
/// `banner: none` (lib/core/banner.dart `bannerDeclined`: one taken off on purpose, which a restore must not undo)
/// wants none, unless the run asked for notes whose header was taken off ([takenOff]).
bool wantsBanner(Note note, {bool replacing = false, bool takenOff = false}) {
  if (note.archivedAt != null) return false;
  final body = note.body;
  if (!replacing && bannerOf(body) != null) return false;
  if (!takenOff && bannerDeclined(body)) return false;
  final facts = NoteFacts.read(body);
  if (facts.isTicket || facts.isCanvas || facts.isTemplatePage || facts.isTemplatesBook) return false;
  // A notebook's index is its cover, and has one (Matt, 2026-10-27: "The root index of a book doesn't have the header
  // image attached and isn't generatable"), however few words it says of its own; a journal's is a list of days.
  if (facts.isBook) return !facts.isJournal;
  // A mail as it arrived, and a meeting: Ghost's own, or a recording written up.
  if (facts.value('from') != null) return false;
  if (body.contains(ghostLineStart)) return false;
  if (hasTape(note) && summarySection(body) != null) return false;
  return _word.allMatches(body.substring(frontMatterOffset(body))).length >= bannerMinWords;
}

/// What the person is told where a banner cannot be asked for here, or null.
String? bannerUnready() {
  if (!hasLovartKeys()) return 'Add your Lovart keys in Settings › Lovart first.';
  if (lovartPictureStore == null) return cannotKeepLovart;
  return null;
}

/// Gives notes their banners as they are left.
class LovartBanners {
  LovartBanners({required this.getNote, required this.update, this.write, this.pictures, this.client, this.warn, this.done, this.retryPause = const Duration(milliseconds: 600), PluginHost? via}) : _host = via;

  final Future<Note?> Function(String id) getNote;
  final Future<Note> Function(String id, String body, int expectedRevision) update;

  /// The note changed where it is now, where given (Matt, 2026-10-26: "Make the header generation async and a
  /// background task that runs while the app is generating the images"): the root's, which hands the change to the
  /// note's editor while the note is open, as Claude's writes go (lib/root/root_commands.dart `_changeNote`), and
  /// writes it where it is kept otherwise. A banner made while the note is open then lands as an edit of its front
  /// matter alone, and what the person is typing stays theirs: a write behind the editor would be refused at its
  /// next save and stop its saving. Without it, [getNote] and [update], from the revision read.
  final Future<void> Function(String id, String Function(String body) change)? write;

  /// Where the pictures are kept: the root's ([lovartPictureStore]) unless given.
  final PictureStore? pictures;

  /// The client to ask; the one with the kept keys unless given.
  final LovartClient? Function()? client;
  final void Function(String message)? warn;

  /// Told the note a banner was written into.
  final void Function(String id)? done;

  /// How long a refused write waits, times the attempt, before the note is read again: a sync or an editor's save
  /// landing on it a moment before is done by then.
  final Duration retryPause;
  final PluginHost? _host;

  PluginHost get _on => _host ?? host;

  /// The note [id] was left: given its banner, where it is one to have. Answers whether it was.
  Future<bool> noteLeft(String id) async {
    if (!bannersOn(_on)) return false;
    return make(id);
  }

  /// Gives the note [id] its banner, where it is one to have, the switch aside. Answers whether it was. A failure is
  /// said to the log, or thrown where [rethrowStopping] and it is one that stops a run (anything but Lovart declining).
  ///
  /// Asked by a run the person started, two more ways (Matt, 2026-10-26: "remove the header banner images on the
  /// docs as we will regenerate them"): [again], a note given one before whose banner was taken off, made once more
  /// although it is marked given; and [replacing], the black-and-white banner of that name made again in colour and
  /// put in its place. Either way only while the note still has what it had: a banner given by hand meanwhile, or a
  /// different one, stands. Leaving a note never asks either: there a banner taken off stays off.
  ///
  /// One made on its own, not in a run, is a job on the app's record of running work (lib/core/background_jobs.dart;
  /// docs/ACTIVITY.md): "Header image for Plan" in the ring and the tray while Lovart draws it, and "Banner ready · View"
  /// as it lands while the note is not on screen. A run is one job of its own (banner_run.dart), so its banners are not.
  Future<bool> make(String id, {bool rethrowStopping = false, bool again = false, String? replacing}) async {
    if (rethrowStopping) return _make(id, rethrowStopping: true, again: again, replacing: replacing);
    JobHandle? job;
    LovartFailure? refused;
    var unwritten = false;
    try {
      final made = await _make(
        id,
        again: again,
        replacing: replacing,
        started: (title) => job = activity.begin('banner:$id', kind: JobKind.images, title: title.isEmpty ? 'Header image' : 'Header image for $title', shownHere: activityRoutes.noteShown(id), plugin: manifest.id),
        refused: (failure) => refused = failure,
        unwritten: () => unwritten = true,
      );
      final failure = refused;
      if (made) {
        job?.done(result: JobResult('Banner ready', onOpen: activityRoutes.noteOpener(id)), tally: const JobTally('banner', 'banners'));
      } else if (unwritten) {
        job?.failed(bannerUnwrittenWords);
      } else if (failure != null && !failure.passing && failure is! LovartRefused) {
        // Credits, keys, a go-ahead: the person's to fix. Lovart busy or out of reach a moment is not: leaving the note
        // again asks again, so that goes quietly.
        job?.failed(failure is LovartNeedsConfirmation ? failure.said : failure.message, fix: failure.badKeys ? activityRoutes.signIn(manifest.id) : (failure.status == 402 || failure.code == 2012 || failure is LovartNeedsConfirmation) ? activityRoutes.topUp(Uri.parse(lovartBillingUrl), label: failure is LovartNeedsConfirmation ? 'Open Lovart' : null) : null);
      } else {
        job?.stopped();
      }
      return made;
    } catch (failure) {
      job?.stopped();
      rethrow;
    }
  }

  Future<bool> _make(String id, {bool rethrowStopping = false, bool again = false, String? replacing, void Function(String title)? started, void Function(LovartFailure failure)? refused, void Function()? unwritten}) async {
    if (!pluginOn(manifest) || !hasLovartKeys(_on)) return false;
    final store = pictures ?? lovartPictureStore;
    if (store == null) return false;
    final asked = again || replacing != null;
    // A picture made before and never written in: that one, not another asked of Lovart.
    var owed = asked ? null : _owed(_on)[id];
    if ((!asked && owed == null && _done(_on).contains(id)) || lovartBannerMaking.value.contains(id)) return false;
    final note = await getNote(id);
    if (note == null || !wantsBanner(note, replacing: replacing != null, takenOff: again) || bannerOf(note.body) != replacing) {
      // Gone, given one by hand, or taken off meanwhile: the picture owed is not wanted any more.
      if (owed != null) _owe(_on, id, null);
      return false;
    }
    if (owed != null && await store.bytesOf(owed).then((bytes) => bytes == null, onError: (Object _) => true)) {
      _owe(_on, id, null);
      owed = null;
    }
    // Marked before Lovart is asked: once per note, whatever happens next.
    _markDone(_on, id);
    final lovart = owed != null ? null : (client != null ? client!() : (_host == null ? lovartClient() : LovartClient.kept(via: _host)));
    if (owed == null && lovart == null) return false;
    _making(id, true);
    started?.call(noteTitle(note.body));
    try {
      final String name;
      if (owed != null) {
        name = owed;
      } else {
        final List<Uint8List> images;
        try {
          // The Figma frames the note links to, where that is switched on (figma_refs.dart).
          final references = await figmaRefsFor(note.body, via: _host);
          images = await lovart!.generate(withFigmaRefs(bannerPrompt(note.body, template: bannerTemplate(), extra: lovartExtra()), references.length, banner: true), references: references);
          if (lovart.dropped.isNotEmpty) warn?.call('[lovart] ${figmaRefsDroppedWords(lovart.dropped)}');
        } on LovartFailure catch (failure) {
          refused?.call(failure);
          if (rethrowStopping && failure is! LovartRefused) {
            // Not this note's fault: a run started again later tries it again. One asked again was given one before,
            // and stays so for leaving it.
            if (!asked) _on.storage.set(bannersDoneKey, [for (final done in _done(_on)) if (done != id) done]);
            rethrow;
          }
          // Lovart at its limit of jobs at once, or out of reach a moment: not this note's doing, so leaving it again
          // asks again.
          if (failure.passing && !asked) _on.storage.set(bannersDoneKey, [for (final done in _done(_on)) if (done != id) done]);
          warn?.call('[lovart] no banner for the note: ${failure is LovartNeedsConfirmation ? failure.said : failure.message}');
          return false;
        }
        final names = await keepLovartImages(images.take(1).toList(), into: pictures);
        if (names.isEmpty) return false;
        name = names.first;
      }
      // Whether the note, as it is now, still takes it: a banner given by hand meanwhile (or, one being replaced,
      // another one) stands, and so does one taken off meanwhile.
      bool takes(String body) => bannerOf(body) == replacing && (again || !bannerDeclined(body));
      Object? last;
      for (var attempt = 0; attempt < _writeAttempts; attempt += 1) {
        if (attempt > 0) await Future<void>.delayed(retryPause * attempt);
        try {
          final into = write;
          if (into != null) {
            var wrote = false;
            await into(id, (body) {
              if (!takes(body)) return body;
              wrote = true;
              return withBanner(body, name);
            });
            _owe(_on, id, null);
            if (wrote) done?.call(id);
            return wrote;
          }
          final now = await getNote(id);
          if (now == null || !takes(now.body)) {
            _owe(_on, id, null);
            return false;
          }
          await update(id, withBanner(now.body, name), now.revision);
          _owe(_on, id, null);
          done?.call(id);
          return true;
        } catch (failure) {
          last = failure;
        }
      }
      // Made, kept and paid for, and still not in the note: owed to it, for the next time it is left, and said.
      _owe(_on, id, name);
      warn?.call('[lovart] the banner was not written into the note: $last');
      unwritten?.call();
      return false;
    } finally {
      _making(id, false);
    }
  }
}

/// The one line of the open note [body] to change for its banner to be [name], and what it becomes: the banner's own
/// line where there is one, the front matter's closing fence where there is front matter, else the first line with
/// front matter put before it.
({int line, String Function(String text) next}) bannerEdit(String body, String name) {
  final lines = body.split('\n');
  final value = '$bannerKey: ${bannerValue(name)}';
  if (frontMatterOffset(body) > 0) {
    final end = lines.indexWhere(frontMatterFence.hasMatch, 1);
    final key = RegExp('^\\s*$bannerKey\\s*:', caseSensitive: false);
    for (var i = 1; i < end; i += 1) {
      if (key.hasMatch(lines[i])) return (line: i + 1, next: (_) => value);
    }
    // Last of its keys, as [withBanner] adds it: before the closing fence.
    return (line: end + 1, next: (text) => '$value\n$text');
  }
  return (line: 1, next: (text) => '---\n$value\n---\n$text');
}

/// The note's banner taken off on purpose: its `banner:` line in the front matter becomes `banner: none`
/// (lib/core/banner.dart `withoutBanner`), through the editor's line writer so it is one step of the note's history.
Future<void> removeBanner(NoteEditing editing) async {
  final lines = editing.body().split('\n');
  final end = frontMatterEnd(lines);
  final replaced = end > 0 && editing.replaceLine((text, line) => line < end && _bannerLine.hasMatch(text), (_) => '$bannerKey: $bannerNone');
  editing.say(replaced ? 'Header image removed. This note stays without one.' : 'This note has no header image.');
}

final RegExp _bannerLine = RegExp(r'^\s*banner\s*:', caseSensitive: false);

/// A banner for the open note, made now: the cog's "Header image", which makes one again where there is one.
Future<void> makeBanner(NoteEditing editing) async {
  final unready = bannerUnready();
  if (unready != null) return editing.say(unready);
  final lovart = lovartClient();
  if (lovart == null) return;
  final id = editing.noteId;
  if (lovartBannerMaking.value.contains(id)) return;
  _markDone(host, id);
  _making(id, true);
  editing.say('Lovart is making a header image…');
  final job = lovartPictureJob('banner:$id', noteId: id, title: 'Header image for ${noteTitle(editing.body())}');
  var made = 0;
  String? failed;
  try {
    // The Figma frames the note links to, where that is switched on (figma_refs.dart).
    final references = await figmaRefsFor(editing.body());
    final prompt = withFigmaRefs(bannerPrompt(editing.body(), template: bannerTemplate(), extra: lovartExtra()), references.length, banner: true);
    final names = await keepLovartImages((await lovart.generate(prompt, references: references)).take(1).toList());
    if (names.isEmpty) return;
    final edit = bannerEdit(editing.body(), names.first);
    editing.replaceLine((text, line) => line == edit.line, edit.next);
    made = 1;
    if (lovart.dropped.isNotEmpty) editing.say(figmaRefsDroppedWords(lovart.dropped));
  } on LovartFailure catch (failure) {
    editing.say(failure is LovartNeedsConfirmation ? failure.said : failure.message);
    if (!failure.passing && failure is! LovartRefused) failed = failure is LovartNeedsConfirmation ? failure.said : failure.message;
  } finally {
    _making(id, false);
    lovartPictureEnded(job, noteId: id, made: made, words: 'Banner ready', failed: failed);
  }
}
