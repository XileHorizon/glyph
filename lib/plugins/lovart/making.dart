/// What Lovart is making on this device now, besides the run over the recent notes (banner_run.dart keeps its own
/// queue): the `{image: …}` cues and the inspiration moodboards. The cue's chip draws its spinner by [lovartMaking],
/// and Settings › Lovart's Queue lists both (lovart_queue.dart).
library;

import 'package:flutter/foundation.dart';

import '../../core/background_jobs.dart';
import 'manifest.dart' as lovart;

/// The cues being made now, by note and cue (`noteId\ncue`): the chip by each draws a spinner while it is here.
final ValueNotifier<Set<String>> lovartMaking = ValueNotifier<Set<String>>(const {});

/// The key a cue is kept under in [lovartMaking].
String makingKey(String noteId, String cueText) => '$noteId\n$cueText';

/// Whether the cue [cueText] of [noteId] is being made.
bool lovartIsMaking(String noteId, String cueText) => lovartMaking.value.contains(makingKey(noteId, cueText));

/// Marks the cue [key] made now, or done.
void markMaking(String key, bool on) {
  final next = {...lovartMaking.value};
  if (on ? next.add(key) : next.remove(key)) lovartMaking.value = Set.unmodifiable(next);
}

/// The notes an inspiration moodboard is being made for now: asked on the note's cog, or a design meeting's.
final ValueNotifier<Set<String>> lovartInspiring = ValueNotifier<Set<String>>(const {});

/// Marks [noteId]'s moodboard made now, or done.
void markInspiring(String noteId, bool on) {
  final next = {...lovartInspiring.value};
  if (on ? next.add(noteId) : next.remove(noteId)) lovartInspiring.value = Set.unmodifiable(next);
}

/// The field sketches being drawn now (sketch_make.dart), by note: the last line of each paragraph waiting for one, so
/// the editor draws a stand-in under it until the sketch lands (lib/editor/ai/lovart_cues.dart).
final ValueNotifier<Map<String, Set<String>>> lovartSketching = ValueNotifier<Map<String, Set<String>>>(const {});

/// Marks the paragraph ending [lastText] of [noteId] being sketched now, or done.
void markSketching(String noteId, String lastText, bool on) {
  final now = lovartSketching.value[noteId] ?? const <String>{};
  if (now.contains(lastText) == on) return;
  final next = on ? {...now, lastText} : {...now}..remove(lastText);
  final all = {...lovartSketching.value};
  next.isEmpty ? all.remove(noteId) : all[noteId] = Set.unmodifiable(next);
  lovartSketching.value = Map.unmodifiable(all);
}

/// How many sketches are being drawn now, every note's.
int lovartSketchingCount() => lovartSketching.value.values.fold(0, (sum, lines) => sum + lines.length);

/// A picture Lovart makes for the note [noteId] outside the run (a cue, a moodboard, a header from the note's cog),
/// as a job on the app's record of running work (lib/core/background_jobs.dart; docs/ACTIVITY.md): in the ring and the
/// tray while Lovart draws, and a chip as it lands while the note is not on screen, wearing Lovart's mark. [person]
/// where it was asked for.
JobHandle lovartPictureJob(String id, {required String noteId, required String title, bool person = true}) =>
    activity.begin(id, kind: JobKind.images, title: title, personStarted: person, shownHere: activityRoutes.noteShown(noteId), plugin: lovart.manifest.id);

/// How such a job ended: [made] pictures written into [noteId] ("Image ready · View"), or what Lovart said ([failed])
/// where it is the person's to fix, or nothing where it went quietly.
void lovartPictureEnded(JobHandle job, {required String noteId, int made = 0, String words = 'Image ready', String? failed}) {
  if (made > 0) {
    job.done(result: JobResult(words, onOpen: activityRoutes.noteOpener(noteId)), tally: JobTally('picture', 'pictures', made));
  } else if (failed != null) {
    job.failed(failed, fix: JobFix(JobFixKind.open, () => activityRoutes.openPlugin?.call('lovart'), label: 'Lovart settings'));
  } else {
    job.stopped();
  }
}
