// Field sketches, pure (lib/plugins/lovart/sketches.dart, sketch_clear.dart): which paragraphs are given one, where the
// picture goes, what Lovart is asked, and the paper taken off a sketch that came back opaque.
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:ghost_md/plugins/lovart/banners.dart' show bannerPresets;
import 'package:ghost_md/plugins/lovart/keep.dart';
import 'package:ghost_md/plugins/lovart/sketch_clear.dart';
import 'package:ghost_md/plugins/lovart/sketches.dart';

/// A paragraph of [n] words about [what].
String para(String what, int n) => List<String>.generate(n, (i) => i == 0 ? what : 'word$i').join(' ');

void main() {
  group('spots', () {
    test('the longest paragraph of each section, in the note’s order, after its last line', () {
      final body = [
        '# Trip',
        '',
        para('Opening', 200),
        '',
        '## Market',
        '',
        para('Short', 10),
        '',
        para('Spices', 250),
        '',
        '## Harbour',
        '',
        para('Boats', 220),
      ].join('\n');
      final spots = sketchSpots(body);
      expect([for (final s in spots) s.heading], ['', 'Market', 'Harbour']);
      expect(spots[1].passage, startsWith('Spices'));
      expect(spots[1].line, 9);
      expect(body.split('\n')[spots[1].line - 1], spots[1].lastText);
    });

    test('one for every so many words, never more than the most, and spaced apart', () {
      // 180 words: room for one.
      expect(sketchSpots(['# A', para('One', 90), '', para('Two', 90)].join('\n')).length, 1);
      // Many long sections: never more than the most.
      final long = [for (var i = 0; i < 10; i += 1) '## S$i\n\n${para('Thing$i', 160)}\n'].join('\n');
      expect(sketchSpots(long).length, sketchMost);
      // Two long paragraphs close together in one section with room for two: the second is too near the first.
      final near = ['## Only', para('First', 500), '', para('Second', 40)].join('\n');
      expect(sketchSpots(near).length, 1);
    });

    test('never in code, tables, tasks, maths, cues, front matter or quiet sections, nor beside a picture', () {
      final body = [
        '---',
        'tags: [x]',
        '---',
        '# Note',
        '```',
        para('Code', 80),
        '```',
        '| ${para('Table', 80)} |',
        '- [ ] ${para('Task', 80)}',
        '\$\$ ${para('Maths', 80)}',
        '',
        '${para('Cue', 80)} {image: a cat}',
        '',
        para('Pictured', 80),
        '',
        '![](image/photo.png)',
        '',
        '## Transcript',
        para('Spoken', 300),
      ].join('\n');
      expect(sketchSpots(body), isEmpty);
    });

    test('sketches already there count, so asking again adds only where there is room', () {
      final body = ['# N', para('Alpha', 200), '', '![Field sketch](image/${sketchPrefix}a.png)', '', '## B', para('Beta', 200)].join('\n');
      // 400 words: room for one, and that one is there.
      expect(sketchSpots(body), isEmpty);
    });
  });

  group('writing', () {
    test('the sketch goes on its own line after the paragraph, a blank line between, captioned by its section', () {
      final body = ['# N', '## Garden', para('Roses', 60), '', 'After.'].join('\n');
      final spot = sketchSpots(body).single;
      final next = withSketch(body, spot, '${sketchPrefix}x.png');
      expect(next.split('\n').sublist(2, 6), [para('Roses', 60), '', '![Field sketch for Garden](image/${sketchPrefix}x.png)', '']);
      expect(isSketch('${sketchPrefix}x.png') && madeByLovart('${sketchPrefix}x.png'), isTrue);
    });

    test('follows the paragraph where it moved, and leaves the note be where it is gone or pictured', () {
      final body = ['# N', para('Roses', 60)].join('\n');
      final spot = sketchSpots(body).single;
      final moved = 'New first line\n\n$body';
      expect(withSketch(moved, spot, 's.png'), contains('${para('Roses', 60)}\n\n![Field sketch: Roses word1'));
      expect(withSketch('# N\nsomething else', spot, 's.png'), '# N\nsomething else');
      final pictured = '$body\n\n![](image/p.png)';
      expect(withSketch(pictured, spot, 's.png'), pictured);
    });
  });

  group('prompt', () {
    test('the sketch’s frame round the style, then how to choose the subject and the passage', () {
      final spot = sketchSpots(['# N', '## Kitchen', para('Cast-iron', 50)].join('\n')).single;
      final prompt = sketchPrompt(spot, title: 'Camp', style: 'In thick crayon.', extra: 'Muted colours.');
      expect(prompt, startsWith('Create one illustration of exactly ONE object: the subject chosen from the passage below.'));
      expect(prompt, contains('Style: In thick crayon.'));
      expect(prompt, contains('true alpha channel'));
      expect(prompt, contains('The passage is from a note titled “Camp”, in its section “Kitchen”.'));
      expect(prompt, contains('The passage:\n${spot.passage}'));
      expect(prompt, endsWith('Make one image.\n\nMuted colours.'));
    });

    test('every header style has a sketch style of its own, with none of the banner’s frame', () {
      for (final preset in bannerPresets) {
        expect(preset.sketch, isNotEmpty, reason: preset.id);
        expect(preset.sketch, isNot(contains('16:9')), reason: preset.id);
        expect(sketchFrame(preset.sketch), contains('Style: ${preset.sketch}'));
      }
    });
  });

  group('paper', () {
    Uint8List canvas(int w, int h, List<int> Function(int x, int y) at) {
      final px = Uint8List(w * h * 4);
      for (var y = 0; y < h; y += 1) {
        for (var x = 0; x < w; x += 1) {
          px.setRange((y * w + x) * 4, (y * w + x) * 4 + 4, at(x, y));
        }
      }
      return px;
    }

    test('white paper round a drawing is cleared; white inside the drawing stays', () {
      // A brown ring on white, white inside the ring.
      final px = canvas(20, 20, (x, y) {
        final d = (x - 10) * (x - 10) + (y - 10) * (y - 10);
        return d >= 16 && d <= 36 ? [110, 70, 40, 255] : [252, 251, 250, 255];
      });
      expect(clearPaperPixels(px, 20, 20), isTrue);
      expect(px[3], 0, reason: 'a corner');
      expect(px[(10 * 20 + 10) * 4 + 3], 255, reason: 'inside the ring');
      expect(px[(10 * 20 + 15) * 4 + 3], 255, reason: 'the ink');
    });

    test('a grey checkerboard is cleared too', () {
      final px = canvas(20, 20, (x, y) => (x - 10).abs() < 3 && (y - 10).abs() < 3 ? [60, 120, 60, 255] : ((x ~/ 4 + y ~/ 4).isEven ? [255, 255, 255, 255] : [204, 204, 204, 255]));
      expect(clearPaperPixels(px, 20, 20), isTrue);
      expect(px[3], 0);
      expect(px[(10 * 20 + 10) * 4 + 3], 255);
    });

    test('kept as made where its edges are already clear, or there is no paper', () {
      final clear = canvas(10, 10, (x, y) => [0, 0, 0, 0]);
      expect(clearPaperPixels(clear, 10, 10), isFalse);
      final painted = canvas(10, 10, (x, y) => [30, 90, 160, 255]);
      expect(clearPaperPixels(painted, 10, 10), isFalse);
      expect(painted[3], 255);
    });
  });
}
