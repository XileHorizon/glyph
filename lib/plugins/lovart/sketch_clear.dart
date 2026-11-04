/// A field sketch's paper taken away: the prompt asks Lovart for a transparent ground, but not every model it picks can
/// give one, and some paint white paper or a grey checkerboard instead. A sketch that comes back opaque has the pale,
/// colourless ground around it made clear, reached from its edges, so the drawing sits on the page as ink would; pale
/// parts inside the drawing, not reached from an edge, stay. One already clear at its edges is kept as made.
library;

import 'dart:typed_data';
import 'dart:ui' as ui;

/// How light a ground pixel is at least (its darkest channel), and how little colour it has (its channels' spread).
const int _paperLight = 196;
const int _paperSpread = 24;

/// Below this light, a pixel at the drawing's edge keeps all of its ink.
const int _edgeLight = 150;

bool _paper(Uint8List px, int i) {
  final r = px[i], g = px[i + 1], b = px[i + 2], a = px[i + 3];
  if (a < 200) return false;
  final low = r < g ? (r < b ? r : b) : (g < b ? g : b);
  final high = r > g ? (r > b ? r : b) : (g > b ? g : b);
  return low >= _paperLight && high - low <= _paperSpread;
}

/// Clears [px], straight RGBA of [width] by [height], in place. Answers whether it changed anything: false where the
/// edges are already clear or there is no paper round the drawing.
bool clearPaperPixels(Uint8List px, int width, int height) {
  if (width < 3 || height < 3 || px.length < width * height * 4) return false;
  final border = <int>[
    for (var x = 0; x < width; x += 1) ...[x, (height - 1) * width + x],
    for (var y = 1; y < height - 1; y += 1) ...[y * width, y * width + width - 1],
  ];
  final clearAlready = border.where((p) => px[p * 4 + 3] < 200).length;
  if (clearAlready * 5 > border.length) return false;

  final cleared = Uint8List(width * height);
  final queue = <int>[for (final p in border) if (_paper(px, p * 4)) p];
  for (final p in queue) {
    cleared[p] = 1;
  }
  for (var head = 0; head < queue.length; head += 1) {
    final p = queue[head];
    final x = p % width, y = p ~/ width;
    for (final n in [if (x > 0) p - 1, if (x < width - 1) p + 1, if (y > 0) p - width, if (y < height - 1) p + width]) {
      if (cleared[n] == 0 && _paper(px, n * 4)) {
        cleared[n] = 1;
        queue.add(n);
      }
    }
  }
  // Not a ground round a drawing: a pale corner, or a picture that is all paper.
  if (queue.length * 20 < width * height || queue.length == width * height) return false;

  for (final p in queue) {
    px[p * 4 + 3] = 0;
  }
  // The drawing's own edge, where a wash fades into the paper: as clear as it is pale, so no white fringe is left.
  for (var p = 0; p < width * height; p += 1) {
    if (cleared[p] == 1) continue;
    final x = p % width, y = p ~/ width;
    final touches = (x > 0 && cleared[p - 1] == 1) || (x < width - 1 && cleared[p + 1] == 1) || (y > 0 && cleared[p - width] == 1) || (y < height - 1 && cleared[p + width] == 1);
    if (!touches) continue;
    final i = p * 4;
    final low = [px[i], px[i + 1], px[i + 2]].reduce((a, b) => a < b ? a : b);
    if (low <= _edgeLight) continue;
    final keep = (255 - low) / (255 - _edgeLight);
    px[i + 3] = (px[i + 3] * keep).round().clamp(0, 255);
  }
  return true;
}

/// [bytes], a picture, with its paper cleared ([clearPaperPixels]) as a PNG; as given where it needs none or cannot be
/// read here.
Future<Uint8List> clearPaper(Uint8List bytes) async {
  try {
    final codec = await ui.instantiateImageCodec(bytes);
    final frame = await codec.getNextFrame();
    final image = frame.image;
    final width = image.width, height = image.height;
    final data = await image.toByteData(format: ui.ImageByteFormat.rawStraightRgba);
    image.dispose();
    codec.dispose();
    if (data == null) return bytes;
    final px = Uint8List.fromList(data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes));
    if (!clearPaperPixels(px, width, height)) return bytes;
    // Drawn from premultiplied pixels, as the engine takes them; PNG keeps them straight again.
    for (var i = 0; i < px.length; i += 4) {
      final a = px[i + 3];
      if (a == 255) continue;
      px[i] = px[i] * a ~/ 255;
      px[i + 1] = px[i + 1] * a ~/ 255;
      px[i + 2] = px[i + 2] * a ~/ 255;
    }
    final buffer = await ui.ImmutableBuffer.fromUint8List(px);
    final descriptor = ui.ImageDescriptor.raw(buffer, width: width, height: height, pixelFormat: ui.PixelFormat.rgba8888);
    final drawn = await (await descriptor.instantiateCodec()).getNextFrame();
    final png = await drawn.image.toByteData(format: ui.ImageByteFormat.png);
    drawn.image.dispose();
    descriptor.dispose();
    buffer.dispose();
    return png == null ? bytes : png.buffer.asUint8List(png.offsetInBytes, png.lengthInBytes);
  } catch (_) {
    return bytes;
  }
}
