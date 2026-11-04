/// The Lovart plugin: images made by Lovart's design agent, from a note (Matt, 2026-10-26: "I'd like to build a
/// Lovart.ai plugin into the app. They have a API for OpenClaw and I think we can build a wrapper around that in order
/// to create images automatically based on notes and with some custom inline syntax. For example during design
/// meetings the Lovart.ai plugin can generate inspo images and such"). docs/LOVART.md says what Lovart's API is and
/// how it was found.
///
/// Where it shows, once added in Settings › Plugins (off until then: it spends the person's Lovart credits):
/// - **`{image: a prompt}`** anywhere in a note (cues.dart). The editor marks a cue with Lovart's mark while the plugin
///   is on (lib/editor/ai/lovart_cues.dart), and tapping the mark makes that one; **Make images** on the note's cog
///   makes every cue, in order. Each becomes `![the prompt](image/lovart-….png)`.
/// - **Inspiration images** on the note's cog: a moodboard of four from the note, under `## Inspiration`
///   (inspiration.dart).
/// - **Inspiration for design meetings**, a switch on its page: a meeting that reads as a design meeting gets the same,
///   once, as soon as it is written up (meetings.dart).
/// - **Header images**: a banner across the top of a note in the ghost's dotwork, made as a note is left where its
///   switch is on (on by default), and on the note's cog (banners.dart); and for the hundred most recent notes at
///   once, from its page, as a job of the app's own that goes on in the background (banner_run.dart).
/// - **Field sketches** (sketches.dart, sketch_make.dart; Kevin, 2026-11-04): small field-journal drawings beside the
///   paragraphs they belong to, made as a note is left where their switch is on (off by default), and on the note's cog.
/// - Its page in Settings: the two keys, checked before they are kept, and the switch (lovart_pane.dart).
/// - **Its setup** (lovart_setup.dart; Matt, 2026-10-28: "For each of the plugins add a small onboarding flow start
///   with the lovart and Claude plugins"): an account, the keys, a check that they work, and a first thing to try,
///   offered as Lovart is added in the Market and from Set up at the head of its page.
///
/// A picture Lovart made carries Lovart's mark at its corner wherever it is drawn (lib/editor/media/lovart_badge.dart),
/// by its name, plugin on or not.
library;



import '../../core/banner.dart' show bannerOf;
import '../../core/book.dart' show isBookBody, isJournalBody;
import '../../core/note_text.dart' show noteTitle;
import '../registry.dart' show pluginOn;
import '../types.dart';
import 'banner_run.dart';
import 'banners.dart';
import 'client.dart';
import 'cues.dart';
import 'figma_refs.dart';
import 'inspiration.dart';
import 'keep.dart';
import 'making.dart';
import 'lovart_mark.dart';
import 'lovart_pane.dart';
import 'lovart_setup.dart';
import 'manifest.dart';
import 'sketch_make.dart';
import 'sketches.dart';
import '../../sounds/sound_pack.dart' show SoundEvent;
import '../../sounds/sounds.dart' show sounds;

export 'banner_run.dart';
export 'banners.dart';
export 'client.dart';
export 'cues.dart';
export 'inspiration.dart';
export 'keep.dart';
export 'lovart_hold.dart';
export 'lovart_mark.dart';
export 'lovart_pane.dart';
export 'lovart_setup.dart';
export 'manifest.dart' show accessKeySecret, secretKeySecret, meetingsKey, projectKey, bannersKey, bannersDoneKey, bannersOwedKey, bannerRunKey;
export 'making.dart';
export 'meetings.dart';
export 'sketch_make.dart';
export 'sketches.dart';

/// What the person is told when Lovart cannot be asked here.
String? lovartUnready() {
  if (!hasLovartKeys()) return 'Add your Lovart keys in Settings › Lovart first.';
  if (lovartPictureStore == null) return cannotKeepLovart;
  return null;
}

/// What a failure is said as.
String lovartSaid(LovartFailure failure) => failure is LovartNeedsConfirmation ? failure.said : failure.message;

/// Writes the pictures [names] where the cue [cue] is in the open note now (cues.dart [cueEdits]), each line through
/// its editor. Answers whether the cue was still there.
bool placeCue(NoteEditing editing, ImageCue cue, List<String> names) {
  final edits = cueEdits(editing.body(), cue, names);
  for (final edit in edits) {
    editing.replaceLine((text, line) => line == edit.line, (_) => edit.text);
  }
  return edits.isNotEmpty;
}

/// Makes the cue [cue] of the open note into its picture: asked, kept, then written where the cue still is. Answers
/// whether it was; says why not on the note.
Future<bool> makeCue(NoteEditing editing, ImageCue cue) async {
  final unready = lovartUnready();
  if (unready != null) {
    editing.say(unready);
    return false;
  }
  final lovart = lovartClient();
  if (lovart == null) return false;
  final key = makingKey(editing.noteId, cue.text);
  if (lovartMaking.value.contains(key)) return false;
  markMaking(key, true);
  final job = lovartPictureJob('lovart-cue:$key', noteId: editing.noteId, title: 'Image for ${noteTitle(editing.body())}');
  var made = 0;
  String? failed;
  try {
    final names = await keepLovartImages(await lovart.generate(withLovartExtra(cuePrompt(cue.prompt), lovartExtra())));
    if (names.isEmpty) return false;
    final written = placeCue(editing, cue, names);
    if (!written) editing.say('The image was made, but its {image: …} was gone from the note.');
    // Lovart's picture is ready (Settings › Sounds; Matt, 2026-10-27).
    if (written) sounds.play(SoundEvent.lovartReady);
    if (written) made = names.length;
    return written;
  } on LovartFailure catch (failure) {
    editing.say(lovartSaid(failure));
    if (!failure.passing && failure is! LovartRefused) failed = lovartSaid(failure);
    return false;
  } finally {
    markMaking(key, false);
    lovartPictureEnded(job, noteId: editing.noteId, made: made, failed: failed);
  }
}

/// Every cue of the open note, in order, saying how far it is. A key refused, credits spent or a costly step waiting
/// stops the rest; Lovart declining one goes on to the next.
Future<void> makeAllCues(NoteEditing editing) async {
  final unready = lovartUnready();
  if (unready != null) return editing.say(unready);
  final cues = imageCues(editing.body());
  var made = 0;
  // One job for them all: the ring's arc fills as each lands, and one chip as the last does.
  final job = lovartPictureJob('lovart-cues:${editing.noteId}', noteId: editing.noteId, title: 'Images for ${noteTitle(editing.body())}');
  String? failed;
  try {
    for (final (index, cue) in cues.indexed) {
      job.progress(done: index, total: cues.length, unit: 'images');
      editing.say(cues.length == 1 ? 'Lovart is making the image…' : 'Lovart is making image ${index + 1} of ${cues.length}…');
      final lovart = lovartClient();
      if (lovart == null) return;
      final key = makingKey(editing.noteId, cue.text);
      markMaking(key, true);
      try {
        final names = await keepLovartImages(await lovart.generate(withLovartExtra(cuePrompt(cue.prompt), lovartExtra())));
        if (names.isNotEmpty && placeCue(editing, cue, names)) made += 1;
      } on LovartRefused catch (failure) {
        editing.say(failure.message);
      } on LovartFailure catch (failure) {
        editing.say(lovartSaid(failure));
        if (!failure.passing) failed = lovartSaid(failure);
        return;
      } finally {
        markMaking(key, false);
      }
    }
    if (made > 0) {
      editing.say(made == 1 ? 'Made 1 image with Lovart.' : 'Made $made images with Lovart.');
      sounds.play(SoundEvent.lovartReady);
    }
  } finally {
    lovartPictureEnded(job, noteId: editing.noteId, made: made, words: made == 1 ? 'Image ready' : '$made images ready', failed: made > 0 ? null : failed);
  }
}

/// A moodboard of four for the open note, under its `## Inspiration`.
Future<void> makeInspiration(NoteEditing editing) async {
  final unready = lovartUnready();
  if (unready != null) return editing.say(unready);
  final lovart = lovartClient();
  if (lovart == null) return;
  editing.say('Lovart is making inspiration images…');
  markInspiring(editing.noteId, true);
  final job = lovartPictureJob('lovart-inspiration:${editing.noteId}', noteId: editing.noteId, title: 'Inspiration for ${noteTitle(editing.body())}');
  var made = 0;
  String? failed;
  try {
    // The Figma frames the note links to, where that is switched on (figma_refs.dart).
    final references = await figmaRefsFor(editing.body());
    final prompt = withLovartExtra(withFigmaRefs(inspirationPrompt(editing.body()), references.length, banner: false), lovartExtra());
    final names = await keepLovartImages(await lovart.generate(prompt, references: references));
    if (names.isEmpty) return;
    final at = inspirationInsert(editing.body(), names);
    editing.replaceLine((text, line) => line == at.line, (text) => '$text${at.add}');
    editing.say(names.length == 1 ? 'Added 1 inspiration image.' : 'Added ${names.length} inspiration images.');
    if (lovart.dropped.isNotEmpty) editing.say(figmaRefsDroppedWords(lovart.dropped));
    made = names.length;
  } on LovartFailure catch (failure) {
    editing.say(lovartSaid(failure));
    if (!failure.passing && failure is! LovartRefused) failed = lovartSaid(failure);
  } finally {
    markInspiring(editing.noteId, false);
    lovartPictureEnded(job, noteId: editing.noteId, made: made, words: 'Inspiration ready', failed: failed);
  }
}

/// What an image row from the +'s list leaves to write over.
const String lovartInsertWords = 'what to draw';

String _summary() => hasLovartKeys() ? 'Keys kept' : 'Not set up';

/// Whether the cues of notes are marked in the editor: the plugin on.
bool lovartCuesOn() => pluginOn(manifest);

final GlyphPlugin lovartPlugin = GlyphPlugin(
  manifest: manifest,
  icon: 'palette',
  setup: lovartSetup,
  settings: PluginSettings(
    pane: (context) => const LovartPane(),
    hue: 'purple',
    settings: lovartFindable,
    summary: _summary,
  ),
  // The +'s More: an image by Lovart, written as its cue with what to draw selected to write over.
  inserts: [
    PluginInsert(id: 'lovart-image', words: 'An image by Lovart', text: '{image: $lovartInsertWords}', select: (from: 8, to: 8 + lovartInsertWords.length), icon: lovartIcon),
  ],
  noteActions: [
    NoteAction(
      id: 'lovart-cues',
      label: 'Make images',
      icon: lovartIcon,
      visible: (noteId, body) => imageCues(body).isNotEmpty,
      hint: (noteId, body) {
        final unready = lovartUnready();
        if (unready != null) return unready;
        final count = imageCues(body).length;
        return '$count {image: …} ${count == 1 ? 'becomes a picture' : 'become pictures'}, made by Lovart with your credits.';
      },
      enabled: (noteId, body) => lovartUnready() == null && imageCues(body).isNotEmpty,
      run: (editing, [choice]) => makeAllCues(editing),
    ),
    // The header taken off on purpose: `banner: none` in the note's own words (lib/core/banner.dart), so neither a run
    // nor a library restored from its files gives it one again (docs/MARKDOWN_FIRST.md §5, gap 13).
    NoteAction(
      id: 'lovart-no-banner',
      label: 'Remove header image',
      icon: lovartIcon,
      visible: (noteId, body) => bannerOf(body) != null,
      hint: (noteId, body) => 'The banner comes off, and this note is left without one until you ask for one.',
      enabled: (noteId, body) => !lovartBannerMaking.value.contains(noteId),
      run: (editing, [choice]) => removeBanner(editing),
    ),
    NoteAction(
      id: 'lovart-banner',
      label: 'Header image',
      icon: lovartIcon,
      visible: (noteId, body) => body.trim().isNotEmpty,
      hint: (noteId, body) => bannerUnready() ?? '${bannerOf(body) == null ? 'A banner' : 'A new banner'} across the top of this note, in your header prompt’s style, made by Lovart with your credits: ${aboutCredits(1)}.',
      enabled: (noteId, body) => bannerUnready() == null && !lovartBannerMaking.value.contains(noteId),
      run: (editing, [choice]) => makeBanner(editing),
    ),
    // Header images for every page of a notebook, as the app's own job (banner_run.dart; Matt, 2026-10-26: "Also add a
    // feature to add header images to all pages in a book"). Its choices are the question asked before anything is
    // spent: how many pages, and about how many credits.
    NoteAction(
      id: 'lovart-book-banners',
      label: 'Header images for every page',
      icon: lovartIcon,
      visible: (noteId, body) => lovartBannerJob != null && isBookBody(body) && !isJournalBody(body),
      hint: (noteId, body) => bannerUnready() ?? 'A banner across the top of each of this notebook’s pages, made by Lovart in the background with your credits.',
      enabled: (noteId, body) => bannerUnready() == null && lovartBannerJob?.running != true,
      choices: bookBannerChoices,
      run: (editing, [choice]) => makeBookBanners(editing, choice),
    ),
    NoteAction(
      id: 'lovart-sketches',
      label: 'Add field sketches',
      icon: lovartIcon,
      visible: (noteId, body) => body.trim().isNotEmpty,
      hint: (noteId, body) {
        final unready = lovartUnready();
        if (unready != null) return unready;
        final count = sketchSpots(body).length;
        if (count == 0) return 'No paragraph here is long enough for a sketch, or each already has a picture beside it.';
        return '${count == 1 ? 'A field-journal sketch' : '$count field-journal sketches'} beside the paragraphs ${count == 1 ? 'it belongs' : 'they belong'} to, made by Lovart with your credits: ${aboutCredits(count)}.';
      },
      enabled: (noteId, body) => lovartUnready() == null && !lovartSketching.value.containsKey(noteId) && sketchSpots(body).isNotEmpty,
      run: (editing, [choice]) => makeSketches(editing),
    ),
    NoteAction(
      id: 'lovart-inspiration',
      label: 'Inspiration images',
      icon: lovartIcon,
      visible: (noteId, body) => body.trim().isNotEmpty,
      hint: (noteId, body) => lovartUnready() ?? 'A moodboard of $inspirationCount from this note, under Inspiration, made by Lovart with your credits.',
      enabled: (noteId, body) => lovartUnready() == null,
      run: (editing, [choice]) => makeInspiration(editing),
    ),
  ],
);
