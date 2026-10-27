/// The Windows window frame drawn in Ghost.md's own top row.
library;

import 'package:flutter/widgets.dart';
import 'package:window_manager/window_manager.dart';

/// Three standard Windows caption buttons, each 46 logical pixels wide.
const double windowsCaptionControlsWidth = 138;

/// Empty top-row ground that moves the frameless window and toggles maximize on double click.
class WindowsDragStrip extends StatelessWidget {
  const WindowsDragStrip({super.key});

  @override
  Widget build(BuildContext context) =>
      DragToMoveArea(child: const SizedBox.expand());
}

/// Native-shaped minimize, maximize/restore, and close controls at the right of the app's top row.
class WindowsCaptionControls extends StatefulWidget {
  const WindowsCaptionControls({super.key, required this.dark});

  final bool dark;

  @override
  State<WindowsCaptionControls> createState() => _WindowsCaptionControlsState();
}

class _WindowsCaptionControlsState extends State<WindowsCaptionControls>
    with WindowListener {
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
      children: [
        WindowCaptionButton.minimize(
          brightness: brightness,
          onPressed: windowManager.minimize,
        ),
        if (_maximized)
          WindowCaptionButton.unmaximize(
            brightness: brightness,
            onPressed: windowManager.unmaximize,
          )
        else
          WindowCaptionButton.maximize(
            brightness: brightness,
            onPressed: windowManager.maximize,
          ),
        WindowCaptionButton.close(
          brightness: brightness,
          onPressed: windowManager.close,
        ),
      ],
    );
  }
}
