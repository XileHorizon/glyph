/// Field sketches made (sketches.dart says where and what): as a note is left, where "Field sketches" is on in the
/// plugin's page ([LovartSketches.noteLeft]), and on the note's cog as **Add field sketches** ([makeSketches]).
///
/// One at a time, in the note's order, each written in as it lands, so the note fills in while it is read: a stand-in
/// waits under each paragraph until its sketch takes its place (lib/editor/ai/lovart_cues.dart, by [lovartSketching]).
/// Lovart declining one goes on to the next; keys, credits or a costly step waiting stop the rest, and so does Lovart
/// being busy or out of reach, which leaves the note to be asked again the next time it is left.
library;

import 'dart:async';
import 'dart:typed_data';

import '../../core/images.dart' show PictureStore;
import '../../core/metrics.dart' show trackPlugin;
import '../../core/note.dart' show Note;
import '../../core/note_text.dart' show noteTitle;
import '../registry.dart' show pluginOn;
import '../types.dart';
import 'banners.dart' show lovartExtra;
import 'client.dart';
import 'keep.dart';
import 'making.dart';
import 'manifest.dart';
import 'sketch_clear.dart';
import 'sketches.dart';

/// One sketch asked of [lovart] for [spot], its paper cleared and kept: its name, or null where Lovart gave none.
Future<String?> _sketch(LovartClient lovart, SketchSpot spot, String title, {PictureStore? into}) async {
  final images = await lovart.generate(sketchPrompt(spot, title: title, extra: lovartExtra()));
  if (images.isEmpty) return null;
  final clear = <Uint8List>[await clearPaper(images.first)];
  final names = await keepLovartImages(clear, into: into, prefix: sketchPrefix);
  return names.firstOrNull;
}

/// Gives notes their sketches as they are left.
class LovartSketches {
  LovartSketches({required this.getNote, required this.write, this.pictures, this.client, this.warn, PluginHost? via}) : _host = via;

  final Future<Note?> Function(String id) getNote;

  /// The note changed where it is now: through its editor while it is open (the root's `_changeNote`, as the banners
  /// are), so what the person is typing stays theirs.
  final Future<void> Function(String id, String Function(String body) change) write;
  final PictureStore? pictures;
  final LovartClient? Function()? client;
  final void Function(String message)? warn;
  final PluginHost? _host;

  PluginHost get _on => _host ?? host;

  /// The note [id] was left: given its sketches, where it is one to have them. Answers how many were written in.
  Future<int> noteLeft(String id) async {
    if (!sketchesOn(_on) || !pluginOn(manifest) || !hasLovartKeys(_on)) return 0;
    if ((pictures ?? lovartPictureStore) == null) return 0;
    if (sketchesGiven(_on).contains(id) || lovartSketching.value.containsKey(id)) return 0;
    final note = await getNote(id);
    if (note == null || !wantsSketches(note)) return 0;
    final spots = sketchSpots(note.body);
    // Nowhere yet: not marked, so a note that grows is looked at again.
    if (spots.isEmpty) return 0;
    final lovart = client != null ? client!() : (_host == null ? lovartClient() : LovartClient.kept(via: _host));
    if (lovart == null) return 0;
    // Marked before Lovart is asked: once per note, whatever happens next.
    markSketchesGiven(id, via: _on);
    // The anonymous usage stats (lib/core/metrics.dart): sketches begun as a note was left, how many as a bucket.
    trackPlugin('lovart', 'sketches_started', choice: 'left', count: spots.length);
    final title = noteTitle(note.body);
    final job = lovartPictureJob('lovart-sketches:$id', noteId: id, title: 'Field sketches for $title', person: false);
    for (final spot in spots) {
      markSketching(id, spot.lastText, true);
    }
    var made = 0;
    String? failed;
    try {
      for (final (index, spot) in spots.indexed) {
        job.progress(done: index, total: spots.length, unit: 'sketches');
        try {
          final name = await _sketch(lovart, spot, title, into: pictures);
          if (name == null) continue;
          var wrote = false;
          await write(id, (body) {
            final next = withSketch(body, spot, name);
            wrote = next != body;
            return next;
          });
          if (wrote) made += 1;
        } on LovartRefused catch (failure) {
          warn?.call('[lovart] no sketch for a paragraph: ${failure.message}');
        } on LovartFailure catch (failure) {
          warn?.call('[lovart] field sketches stopped: ${lovartSaidOf(failure)}');
          // Lovart busy or out of reach a moment: not this note's doing, so leaving it again asks again.
          if (failure.passing && made == 0) markSketchesGiven(id, given: false, via: _on);
          if (!failure.passing) failed = lovartSaidOf(failure);
          break;
        } catch (failure) {
          warn?.call('[lovart] a field sketch was not written into the note: $failure');
        } finally {
          markSketching(id, spot.lastText, false);
        }
      }
    } finally {
      for (final spot in spots) {
        markSketching(id, spot.lastText, false);
      }
      lovartPictureEnded(job, noteId: id, made: made, words: made == 1 ? 'Sketch ready' : '$made sketches ready', failed: made > 0 ? null : failed);
    }
    return made;
  }
}

/// What a failure is said as (lovart.dart's `lovartSaid`, here so this file needs nothing of that one).
String lovartSaidOf(LovartFailure failure) => failure is LovartNeedsConfirmation ? failure.said : failure.message;

/// The cog's **Add field sketches**: every spot of the open note now, one at a time, saying how far it is.
Future<void> makeSketches(NoteEditing editing) async {
  if (!hasLovartKeys()) return editing.say('Add your Lovart keys in Settings › Lovart first.');
  if (lovartPictureStore == null) return editing.say(cannotKeepLovart);
  final id = editing.noteId;
  if (lovartSketching.value.containsKey(id)) return;
  final spots = sketchSpots(editing.body());
  if (spots.isEmpty) return editing.say('No paragraph here is long enough for a sketch, or each already has a picture beside it.');
  final lovart = lovartClient();
  if (lovart == null) return;
  markSketchesGiven(id);
  trackPlugin('lovart', 'sketches_started', choice: 'asked', count: spots.length);
  final title = noteTitle(editing.body());
  final job = lovartPictureJob('lovart-sketches:$id', noteId: id, title: 'Field sketches for $title');
  // Every stand-in at once, so the note shows where each will go before the first lands.
  for (final spot in spots) {
    markSketching(id, spot.lastText, true);
  }
  var made = 0;
  String? failed;
  try {
    for (final (index, spot) in spots.indexed) {
      job.progress(done: index, total: spots.length, unit: 'sketches');
      editing.say(spots.length == 1 ? 'Lovart is sketching…' : 'Lovart is sketching ${index + 1} of ${spots.length}…');
      try {
        final name = await _sketch(lovart, spot, title);
        if (name == null) continue;
        final at = sketchLine(editing.body(), spot);
        if (at != null && editing.replaceLine((text, line) => line == at, (text) => sketchAfter(text, spot, name))) made += 1;
      } on LovartRefused catch (failure) {
        editing.say(failure.message);
      } on LovartFailure catch (failure) {
        editing.say(lovartSaidOf(failure));
        if (!failure.passing) failed = lovartSaidOf(failure);
        return;
      } finally {
        markSketching(id, spot.lastText, false);
      }
    }
    if (made > 0) editing.say(made == 1 ? 'Added 1 field sketch.' : 'Added $made field sketches.');
  } finally {
    for (final spot in spots) {
      markSketching(id, spot.lastText, false);
    }
    lovartPictureEnded(job, noteId: id, made: made, words: made == 1 ? 'Sketch ready' : '$made sketches ready', failed: made > 0 ? null : failed);
  }
}
