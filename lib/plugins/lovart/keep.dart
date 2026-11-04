/// Where Lovart's images are kept: the device's pictures (lib/core/images.dart [PictureStore]), which the app's root
/// hands the plugin as it starts ([lovartPictureStore]). Kept before the picture's line is written, so a note never
/// names a picture this device does not have, and sync sends it with the note (lib/sync/notes.dart).
library;

import 'dart:typed_data';

import '../../core/ids.dart' show randomId;
import '../../core/images.dart' show PictureStore;
import 'client.dart' show LovartFailure, pictureExtension;

/// The device's pictures, set by the root; null where there is no core to keep them in (a test, or a build without).
PictureStore? lovartPictureStore;

/// What says no picture can be kept here.
const String cannotKeepLovart = 'This build can’t keep pictures, so Lovart’s images have nowhere to go.';

/// What a picture Lovart made is named with first: the editor draws Lovart's mark on its corner by it
/// (lib/editor/media/lovart_badge.dart), on every device the note reaches, whether the plugin is on there or not.
const String lovartPicturePrefix = 'lovart-';

/// Whether the picture [name] is one Lovart made.
bool madeByLovart(String name) => name.startsWith(lovartPicturePrefix);

/// What a field sketch's picture is named with first (sketches.dart): still [lovartPicturePrefix], so it wears the badge,
/// and the editor draws it small and unframed beside the words (lib/editor/media/images.dart).
const String sketchPrefix = 'lovart-sketch-';

/// Whether the picture [name] is a field sketch.
bool isSketch(String name) => name.startsWith(sketchPrefix);

/// Keeps [images] and answers their names, `lovart-<uuid>.png` and the like, by each one's own bytes: 43 characters
/// before the ending, well inside the 64 the service's file ids take (lib/sync/notes.dart `fileId`). [prefix], where
/// given, names them otherwise: still beginning [lovartPicturePrefix] (a field sketch's `lovart-sketch-`).
Future<List<String>> keepLovartImages(List<Uint8List> images, {PictureStore? into, String prefix = lovartPicturePrefix}) async {
  final store = into ?? lovartPictureStore;
  if (store == null) throw const LovartFailure(cannotKeepLovart);
  final names = <String>[];
  for (final bytes in images) {
    final ext = pictureExtension(bytes);
    if (ext == null) continue;
    final name = '$prefix${randomId('img')}.$ext';
    await store.keep(name, bytes);
    names.add(name);
  }
  return names;
}
