/// The row of the page's top bar that the Mac's three window buttons are set into (app.css `data-titlebar`,
/// NoteTabs.module.css `.top`; in the Tauri app, src/platform.rs `place_traffic_lights`).
///
/// The row keeps a gutter at its start for them (`--app-traffic-lights`, which lib/notes/note_tabs.dart pads by),
/// and this says where the row's centre is, so the window puts the buttons on it
/// (lib/shell/desktop/mac_window.dart): whichever of the bar's four styles is worn, whatever its height, the lights
/// are in line with the row's own buttons. The Tauri app held the number in Rust (`INSET`) and changed it by hand
/// each time the bar's padding moved.
library;

import 'package:flutter/foundation.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/widgets.dart';
import 'package:glacier/glacier.dart';

import 'mac_window.dart';

/// Whether the page is drawn under a desktop's overlaid title bar (`:root[data-titlebar='overlay']`).
bool titlebarOverlay(Tokens t) => t.attrs['titlebar'] == 'overlay';

/// The room the three lights take at the row's start (`--app-traffic-lights`), only on a Mac.
double trafficLightsRoom(Tokens t) => titlebarOverlay(t) && defaultTargetPlatform == TargetPlatform.macOS ? t.len('app-traffic-lights') : 0;

/// Where the first light begins, from the window's edge: src/platform.rs `INSET.0`.
const double trafficLightsStart = 16;

class MacLightsRow extends SingleChildRenderObjectWidget {
  const MacLightsRow({super.key, super.child, this.onPlaced});

  /// The window's, unless a test hands its own: the row's centre from the window's top.
  final void Function(double centre)? onPlaced;

  @override
  RenderObject createRenderObject(BuildContext context) => _RenderLightsRow(onPlaced);

  @override
  void updateRenderObject(BuildContext context, covariant RenderObject renderObject) => (renderObject as _RenderLightsRow).onPlaced = onPlaced;
}

class _RenderLightsRow extends RenderProxyBox {
  _RenderLightsRow(this.onPlaced);

  void Function(double centre)? onPlaced;
  double? _said;

  /// Every row in the tree now. More than one can be (the guide's bar over the app's): the last painted is the
  /// one the buttons sit on, and when it goes the others say where they are again.
  static final Set<_RenderLightsRow> _rows = <_RenderLightsRow>{};

  @override
  void attach(PipelineOwner owner) {
    super.attach(owner);
    _rows.add(this);
  }

  @override
  void detach() {
    _rows.remove(this);
    final left = _rows.toList();
    if (left.isNotEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        for (final row in left) {
          if (!row.attached) continue;
          row._said = null;
          row.markNeedsPaint();
        }
      });
      WidgetsBinding.instance.scheduleFrame();
    }
    super.detach();
  }

  @override
  void paint(PaintingContext context, Offset offset) {
    super.paint(context, offset);
    // Where it was painted is where it is: asked after the frame, when every transform above it is settled.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!attached || !hasSize) return;
      final centre = localToGlobal(size.center(Offset.zero)).dy;
      if (_said == centre) return;
      _said = centre;
      final placed = onPlaced;
      if (placed != null) {
        placed(centre);
      } else {
        MacWindow.instance.lights(x: trafficLightsStart, centre: centre);
      }
    });
  }
}
