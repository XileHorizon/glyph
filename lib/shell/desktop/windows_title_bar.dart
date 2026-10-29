/// The Windows window's frame: a thin title strip across the top of the whole window, in the page's own ground,
/// that drags the window and holds minimize, maximize and close at its right.
///
/// The Mac sets its three lights into whichever top row a screen has (mac_lights.dart, and each screen's room for
/// them), so every screen and both modes carry them. Windows has one strip over all of them instead (Kevin,
/// 2026-10-29: in Simple there were "no close buttons"), so no screen has to know about the window: the home in
/// Simple, Settings, the recorder and the guide get the same controls as the note's top bar.
library;

import 'dart:io' show Platform;

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/widgets.dart';
import 'package:glacier/glacier.dart';
import 'package:window_manager/window_manager.dart';

/// Whether this is the Windows app, whose window has no frame of the system's (main.dart `TitleBarStyle.hidden`).
final bool runsAsWindowsApp = !kIsWeb && Platform.isWindows && !Platform.environment.containsKey('FLUTTER_TEST');

/// The strip's height: a Windows 11 caption's.
const double windowsTitleHeight = 32;

/// The app under the Windows title strip; the app alone anywhere else.
class WindowsFrame extends StatelessWidget {
  const WindowsFrame({super.key, required this.child, this.windows});

  final Widget child;

  /// For a test: draw the strip whatever the platform.
  final bool? windows;

  @override
  Widget build(BuildContext context) {
    if (!(windows ?? runsAsWindowsApp)) return child;
    final t = context.tokens;
    return ColoredBox(
      color: t.color('glacier-bg'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            height: windowsTitleHeight,
            child: Row(
              children: [
                // The empty ground moves the window, and a double click maximizes or restores it.
                const Expanded(child: DragToMoveArea(child: SizedBox.expand())),
                WindowsCaptionControls(dark: t.isDark),
              ],
            ),
          ),
          // The page below the strip, whose own top insets are not the strip's.
          Expanded(child: MediaQuery.removePadding(context: context, removeTop: true, child: child)),
        ],
      ),
    );
  }
}

/// Native-shaped minimize, maximize/restore and close at the right of the strip.
class WindowsCaptionControls extends StatefulWidget {
  const WindowsCaptionControls({super.key, required this.dark});

  final bool dark;

  @override
  State<WindowsCaptionControls> createState() => _WindowsCaptionControlsState();
}

class _WindowsCaptionControlsState extends State<WindowsCaptionControls> with WindowListener {
  bool _maximized = false;

  @override
  void initState() {
    super.initState();
    windowManager.addListener(this);
    windowManager.isMaximized().then((value) {
      if (mounted) setState(() => _maximized = value);
    });
  }

  @override
  void dispose() {
    windowManager.removeListener(this);
    super.dispose();
  }

  @override
  void onWindowMaximize() => setState(() => _maximized = true);

  @override
  void onWindowUnmaximize() => setState(() => _maximized = false);

  @override
  Widget build(BuildContext context) {
    final brightness = widget.dark ? Brightness.dark : Brightness.light;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        WindowCaptionButton.minimize(brightness: brightness, onPressed: windowManager.minimize),
        if (_maximized)
          WindowCaptionButton.unmaximize(brightness: brightness, onPressed: windowManager.unmaximize)
        else
          WindowCaptionButton.maximize(brightness: brightness, onPressed: windowManager.maximize),
        WindowCaptionButton.close(brightness: brightness, onPressed: windowManager.close),
      ],
    );
  }
}
