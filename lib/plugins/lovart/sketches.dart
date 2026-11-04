/// Field sketches: a note's words given small illustrations where they read best (Kevin, 2026-11-04: "an optional
/// toggle for image enrichment where when it is adding images it parses the text to find natural spots to add in
/// generated images that relate to the text section in pretty spots so it looks alive and sorta magical"). Pure: which
/// paragraphs get one ([sketchSpots]), what Lovart is asked for each ([sketchPrompt]), where the picture goes
/// ([withSketch]), and the switch and the prompt the plugin's page keeps. Making them is sketch_make.dart's.
///
/// - **The look.** One object on a transparent ground, 4:5 ([sketchFrame], from Kevin's own prompt), drawn in the header
///   image style chosen on the plugin's page ([sketchStyleNow]), so a note's banner and its sketches match. Lovart's
///   agent reads the passage and chooses the one thing to draw, so no other model is asked first.
/// - **The spots.** Paragraphs of prose (and lists of words, not of tasks) of [sketchMinWords] or more, at most one
///   to a section and [sketchGapWords] words from any picture, the longest first, up to one for every
///   [sketchWordsEach] words of the note and never more than [sketchMost]. Not in code, tables, maths, HTML, front
///   matter, the inspiration moodboard or a transcript; not right before a picture already there.
/// - **The picture.** `![Field sketch for <section>](image/lovart-sketch-….png)` on its own line after the paragraph,
///   a blank line between. The name says it is a sketch, so the editor draws it small and unframed, beside the words
///   and alternating sides (lib/editor/media/images.dart), and any other reader of the Markdown still sees a picture.
library;

import '../../core/front_matter.dart' show frontMatterEnd;
import '../../core/images.dart' show imageMarkdown;
import '../../core/note.dart' show Note;
import '../../core/note_facts.dart' show NoteFacts;
import '../types.dart' show PluginHost;
import 'banners.dart' show bannerPresetNow, bannerPresets, wantsBanner, withLovartExtra;
import 'cues.dart' show imageCuePattern, pictureCaption;
import 'keep.dart' show isSketch;
import 'manifest.dart';

/// The fewest words a paragraph has before it is given a sketch.
const int sketchMinWords = 35;

/// The fewest words between two pictures, a sketch or any other.
const int sketchGapWords = 140;

/// One sketch for every this many words of the note.
const int sketchWordsEach = 220;

/// The most sketches a note is given.
const int sketchMost = 4;

/// The fewest words a note has before it is given sketches by itself as it is left.
const int sketchMinNoteWords = 120;

/// How much of a passage goes to Lovart.
const int sketchPassageChars = 700;

/// The style a sketch is drawn in when the header prompt is a person's own and names no style of the list: the
/// field journal's, the style Kevin's prompt was written in.
const String _sketchStyleFallback = 'journal';

/// The style field sketches are drawn in now: the header image style chosen at the head of the plugin's page
/// (banners.dart [bannerPresetNow]; Kevin, 2026-11-04: "can we actually have the style of the thing follow the style for
/// banners they select?"), so a note's banner and its sketches look one set; the field journal's where the header
/// prompt is a person's own.
String sketchStyleNow([PluginHost? via]) => (bannerPresetNow(via) ?? bannerPresets.firstWhere((p) => p.id == _sketchStyleFallback)).sketch;

/// What every sketch is asked as, round its [style] (Kevin's prompt, 2026-11-04, its style taken out to follow the
/// header's): one whole object, isolated on a transparent ground, 4:5, no words.
String sketchFrame(String style) => """Create one illustration of exactly ONE object: the subject chosen from the passage below. It is a small picture that sits beside that paragraph in a note, so it must read as a single isolated object.

Style: $style

Composition:
- Show exactly one instance of the subject, in a natural three-quarter view that clearly shows its form and defining characteristics, as a single, complete, standalone object occupying about 70 to 80 percent of the frame.
- Centre it with generous transparent space around its silhouette; never crop, truncate or hide any part of it.
- Keep natural proportions, accurate structure and recognisable materials and textures.
- No additional illustrations, alternative views, detail studies, close-ups, duplicates, cutaways, fragments or supplementary objects; no collection, reference sheet, diagram, collage or panels; no environment, props, pedestals or surfaces beneath it. The picture is the one subject and nothing else.
- Keep the same visual language, density, lighting and placement across every subject, so the pictures of different objects feel like one cohesive collection.

Text: no text, lettering, handwriting, captions, labels, titles, numbers, scientific names or annotations anywhere, except lettering that is genuinely, physically part of the subject itself (printed packaging, engraved markings), reproduced accurately and never invented.

Background and output:
- A fully transparent background with a true alpha channel (RGBA); the subject completely isolated against transparency.
- No paper, coloured backdrop, cast shadow on a surface, checkerboard pattern, background texture, border or frame; no simulated transparency or solid-colour background.
- Keep delicate edges and fine details clean against the transparency.
- Portrait 4:5 aspect ratio, high resolution, with transparent padding on every side.""";

/// One place in a note a sketch goes: after the paragraph whose last line is [line] (1-based), written [lastText].
class SketchSpot {
  const SketchSpot({required this.line, required this.lastText, required this.passage, required this.heading, required this.words, required this.at});

  final int line;
  final String lastText;

  /// The paragraph's words, its Markdown taken off, at most [sketchPassageChars] characters.
  final String passage;

  /// The section it is under, or empty above the first heading below the title.
  final String heading;

  /// How many words the paragraph has, and how many come before the sketch in the note: its place, where the gap
  /// to another picture is measured from.
  final int words;
  final int at;

  @override
  String toString() => 'SketchSpot(line $line, $words words, “$heading”)';
}

final RegExp _word = RegExp(r'[\p{L}\p{N}]+', unicode: true);
final RegExp _heading = RegExp(r'^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$');
final RegExp _fence = RegExp(r'^\s*(```|~~~)');
final RegExp _picture = RegExp(r'^\s*(?:[-*+]\s+|>\s*)?!\[[^\]]*\]\([^)]*\)\s*$');
final RegExp _quiet = RegExp(r'^\s*(?:\||<|\$\$|\[\^|(?:-{3,}|\*{3,}|_{3,})\s*$)');
final RegExp _task = RegExp(r'^\s*[-*+]\s+\[[ xX]\]');

/// The sections whose words are not for drawing: a moodboard's, a transcript, lists of things to do or read.
const Set<String> _quietSections = {'inspiration', 'transcript', 'action items', 'tasks', 'to do', 'todo', 'to-do', 'links', 'references', 'sources'};

int _wordsIn(String text) => _word.allMatches(text).length;

/// A paragraph's lines as plain words: markers, links, emphasis and code ticks taken off.
String _plain(List<String> lines) {
  final text = [for (final line in lines) line.replaceFirst(RegExp(r'^\s*(?:[-*+]\s+|\d+[.)]\s+|>\s*)'), '')]
      .join(' ')
      .replaceAll(RegExp(r'!\[[^\]]*\]\([^)]*\)'), ' ')
      .replaceAllMapped(RegExp(r'\[([^\]]*)\]\([^)]*\)'), (m) => m[1]!)
      .replaceAll(RegExp(r'\[\[([^\]|]*)(?:\|([^\]]*))?\]\]'), r' $1 ')
      .replaceAll(RegExp(r'[*_`~]+'), '')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();
  return text.length <= sketchPassageChars ? text : '${text.substring(0, sketchPassageChars - 1).trimRight()}…';
}

/// The places in [body] a sketch goes now, in the note's order: the rules at the head of this file. Sketches already
/// there count against [sketchMost] and keep the others away, so asking again adds only where there is room.
List<SketchSpot> sketchSpots(String body) {
  final lines = body.split('\n');
  final start = frontMatterEnd(lines);
  final candidates = <SketchSpot>[];
  final pictures = <int>[];
  var sketches = 0;
  var words = 0;
  var fenced = false;
  var heading = '';
  var quietSection = false;
  var titled = false;
  final block = <String>[];
  var blockEnd = 0;

  bool pictureNext(int from) {
    for (var i = from; i < lines.length; i += 1) {
      if (lines[i].trim().isEmpty) continue;
      return _picture.hasMatch(lines[i]);
    }
    return false;
  }

  void close() {
    if (block.isEmpty) return;
    final count = _wordsIn(block.join(' '));
    final quiet = quietSection || _quiet.hasMatch(block.first) || block.any(_task.hasMatch) || block.any((l) => imageCuePattern.hasMatch(l));
    if (!quiet && count >= sketchMinWords && !pictureNext(blockEnd)) {
      candidates.add(SketchSpot(line: blockEnd, lastText: lines[blockEnd - 1], passage: _plain(block), heading: heading, words: count, at: words + count));
    }
    words += count;
    block.clear();
  }

  for (var i = start; i < lines.length; i += 1) {
    final line = lines[i];
    if (_fence.hasMatch(line)) {
      close();
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    final title = _heading.firstMatch(line);
    if (title != null) {
      close();
      final text = title[2]!.trim();
      // The note's own title is not a section: the words under it are the note's opening.
      if (!titled && title[1] == '#') {
        titled = true;
      } else {
        heading = text;
        quietSection = _quietSections.contains(text.toLowerCase().replaceAll(RegExp(r'[^a-z -]'), '').trim());
      }
      continue;
    }
    if (_picture.hasMatch(line)) {
      close();
      pictures.add(words);
      final name = RegExp(r'\(image/([^)]+)\)').firstMatch(line)?[1] ?? '';
      if (isSketch(name)) sketches += 1;
      continue;
    }
    if (line.trim().isEmpty) {
      close();
      continue;
    }
    block.add(line);
    blockEnd = i + 1;
  }
  close();

  final room = (words ~/ sketchWordsEach).clamp(1, sketchMost) - sketches;
  if (room <= 0 || candidates.isEmpty) return const [];
  bool clear(SketchSpot spot, Iterable<int> taken) => taken.every((at) => (spot.at - at).abs() >= sketchGapWords);
  final chosen = <SketchSpot>[];
  final sections = <String>{};
  final longest = [...candidates]..sort((a, b) => b.words.compareTo(a.words));
  // The longest in each section first, then the next longest where a section has room for two.
  for (final pass in [true, false]) {
    for (final spot in longest) {
      if (chosen.length >= room) break;
      if (chosen.contains(spot) || (pass && sections.contains(spot.heading))) continue;
      if (!clear(spot, [...pictures, for (final c in chosen) c.at])) continue;
      chosen.add(spot);
      sections.add(spot.heading);
    }
  }
  return chosen..sort((a, b) => a.line.compareTo(b.line));
}

/// What a sketch's picture is captioned: its section, or the paragraph's first words.
String sketchCaption(SketchSpot spot) {
  if (spot.heading.isNotEmpty) return pictureCaption('Field sketch for ${spot.heading}');
  final first = spot.passage.split(' ').take(6).join(' ');
  return pictureCaption('Field sketch: $first…');
}

/// What Lovart is asked for [spot]: the sketch's frame round [style] (else the one chosen now, [sketchStyleNow]), then
/// how to choose the subject and the passage, the note's [title] for context, and [extra] on the end.
String sketchPrompt(SketchSpot spot, {String title = '', String? style, String? extra}) {
  final where = [if (title.isNotEmpty) 'a note titled “$title”', if (spot.heading.isNotEmpty) 'its section “${spot.heading}”'].join(', in ');
  return withLovartExtra(
    [
      sketchFrame(style ?? sketchStyleNow()),
      '',
      'Choosing the subject: read the passage below and pick the single concrete, physical thing it names or most strongly evokes: an object, a tool, a plant, an animal, a dish, a building detail or an artifact. Where it names a real, specific thing, look up what that thing really looks like and draw it true to life. Where the passage is abstract, choose one tangible object that stands for its idea. Draw only that one thing.',
      if (where.isNotEmpty) 'The passage is from $where.',
      '',
      'The passage:',
      spot.passage,
      '',
      'Make one image.',
    ].join('\n'),
    extra,
  );
}

/// The line the sketch [spot] goes after in [body] as it is now: its own where it still reads as it did, else the
/// first that does; null where the paragraph is gone, or a picture already follows it.
int? sketchLine(String body, SketchSpot spot) {
  final lines = body.split('\n');
  var i = spot.line - 1;
  if (i >= lines.length || lines[i] != spot.lastText) i = lines.indexOf(spot.lastText);
  if (i < 0) return null;
  for (var j = i + 1; j < lines.length; j += 1) {
    if (lines[j].trim().isEmpty) continue;
    if (_picture.hasMatch(lines[j])) return null;
    break;
  }
  return i + 1;
}

/// What the paragraph's last line becomes with the sketch [name] after it.
String sketchAfter(String text, SketchSpot spot, String name) => '$text\n\n${imageMarkdown(name, sketchCaption(spot))}';

/// [body] with the sketch [name] after [spot]'s paragraph, or as it was where that paragraph is gone ([sketchLine]).
String withSketch(String body, SketchSpot spot, String name) {
  final at = sketchLine(body, spot);
  if (at == null) return body;
  final lines = body.split('\n');
  lines[at - 1] = sketchAfter(lines[at - 1], spot, name);
  return lines.join('\n');
}

/// Whether [note] is given sketches by itself as it is left: a note a banner could be made for by those rules
/// (banners.dart [wantsBanner], its banner aside), not a notebook's cover, of [sketchMinNoteWords] words or more.
bool wantsSketches(Note note) {
  if (!wantsBanner(note, replacing: true, takenOff: true)) return false;
  if (NoteFacts.read(note.body).isBook) return false;
  final lines = note.body.split('\n');
  return _word.allMatches(lines.sublist(frontMatterEnd(lines)).join('\n')).length >= sketchMinNoteWords;
}

/// Whether notes are given sketches by themselves on this device: off until switched on, since each costs credits.
bool sketchesOn([PluginHost? via]) => (via ?? host).storage.get<Object?>(sketchesKey, false) == true;

/// Switches it.
void setSketches(bool on, [PluginHost? via]) => (via ?? host).storage.set(sketchesKey, on);

/// How many notes are remembered as given sketches: the newest.
const int _doneKept = 2000;

/// The notes this device has given sketches to by themselves: never given them again as they are left.
List<String> sketchesGiven([PluginHost? via]) {
  final Object? kept = (via ?? host).storage.get<Object?>(sketchesDoneKey, const <Object?>[]);
  return kept is List ? [for (final id in kept) if (id is String) id] : <String>[];
}

/// Marks [id] given them, or forgets it ([given] false), so leaving it asks again.
void markSketchesGiven(String id, {bool given = true, PluginHost? via}) {
  final on = via ?? host;
  final done = sketchesGiven(on);
  if (done.contains(id) == given) return;
  final next = given ? [...done, id] : [for (final d in done) if (d != id) d];
  on.storage.set(sketchesDoneKey, next.length > _doneKept ? next.sublist(next.length - _doneKept) : next);
}
