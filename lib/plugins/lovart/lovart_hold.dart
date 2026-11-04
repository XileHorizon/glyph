/// Keeps the app going while Lovart makes any picture, not only the header run (Matt, 2026-10-27: "The lovart
/// generation stops when the app is not in focus please background the task").
///
/// The header run holds the device itself (banner_run.dart, lib/core/background_jobs.dart): Android's foreground
/// service, the Mac out of App Nap. A header made as a note is left, one from a note's Header image, an `{image: …}`
/// and a moodboard did not, so a phone put the app behind another froze it mid-picture: on the Fold at 09:16 Lovart and
/// the sync were "couldn't be reached" twelve seconds after Ghost.md went behind another app, and the picture was lost.
///
/// This hears what is being made ([lovartBannerMaking], [lovartMaking], [lovartInspiring]) and, while any of it is
/// and the header run is not going (it holds the device with words of its own), tells the device of a job of its own,
/// [lovartWorkJobId]: "Making pictures with Lovart", how many. When the last is made it lets the device go quietly,
/// with no notification of its own: the pictures are in their notes.
library;

import 'package:flutter/foundation.dart';

import '../../core/background_jobs.dart';
import 'banner_run.dart' show lovartBannerJob, lovartBannerRun;
import 'banners.dart' show lovartBannerMaking;
import 'making.dart';

/// The device's name for the pictures being made outside the header run.
const String lovartWorkJobId = 'lovart-work';

/// Holds the device while Lovart works outside the header run.
class LovartHold {
  LovartHold({required this.background, bool Function()? runGoing}) : _runGoing = runGoing ?? (() => lovartBannerJob?.running ?? false);

  final BackgroundJobs background;
  final bool Function() _runGoing;
  late final Listenable _heard = Listenable.merge([lovartBannerMaking, lovartMaking, lovartInspiring, lovartSketching, lovartBannerRun]);
  bool _holding = false;
  int _said = -1;
  bool _started = false;

  /// How many pictures are being made now, outside the run.
  static int making() => lovartBannerMaking.value.length + lovartMaking.value.length + lovartInspiring.value.length + lovartSketchingCount();

  /// Starts hearing.
  void start() {
    if (_started) return;
    _started = true;
    _heard.addListener(_look);
    _look();
  }

  void _look() {
    final count = making();
    // The run says its own words, and lets the device go itself as it ends.
    if (count > 0 && !_runGoing()) {
      if (_holding && count == _said) return;
      _holding = true;
      _said = count;
      background.running(lovartWorkJobId, title: 'Making pictures with Lovart', text: count == 1 ? '1 picture' : '$count pictures');
    } else if (_holding) {
      _holding = false;
      _said = -1;
      background.ended(lovartWorkJobId, title: 'Pictures made', quiet: true);
    }
  }

  void dispose() {
    if (!_started) return;
    _heard.removeListener(_look);
    if (_holding) background.ended(lovartWorkJobId, title: 'Pictures made', quiet: true);
    _holding = false;
  }
}
