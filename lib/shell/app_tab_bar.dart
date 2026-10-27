import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:glacier/glacier.dart';

import '../notes/tabs/bar_parts.dart';
import 'desktop/mac_drag_strip.dart';
import 'desktop/mac_lights.dart';
import 'desktop/windows_title_bar.dart';
import 'top_bar.dart';

/// The app's tab bar's own box, on the screens that have one: `.app-tabBar` of the web app's app.css, which App.tsx
/// draws once over whichever place is up. It sits under the notch, `--app-tabs` tall, and pads the bar by
/// `--app-bar-top` above and `--app-tab-bottom` below.
///
/// On a phone it paints nothing of its own: the screen's header pane under it is the glass (shell/header_pane.dart).
/// On a window in two panes it takes a ground right across the window - the same glass, from the window's top edge
/// so the strip behind the clock is the bar too, with a hairline under it; with tabs showing they are the bar's
/// bottom edge instead, and the hairline goes. In the Islands it paints none in either: the capsules carry their own.
///
/// Put it in a [Stack] over the screen. Differs from the web: the bar's gutters at either side
/// (`padding-inline: var(--app-bar-start) var(--app-bar-end)`) are kept by notes/note_tabs.dart, whose row of tabs
/// runs past them; and where the page let a press on the bar's empty ground through to the screen under it
/// (`pointer-events: none`), this lets through whatever its child does not take.
class AppTabBar extends StatelessWidget {
  const AppTabBar({super.key, required this.style, required this.child});

  final TopBarStyle style;

  /// notes/note_tabs.dart, which fills the box it is given.
  final Widget child;

  /// How tall the bar's box is, the notch included where the bar reaches the window's top.
  static double heightOf(Tokens t) => t.len('app-tabs') + (t.attrs.containsKey('split') ? t.len('app-inset-top') : 0);

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;
    final split = t.attrs.containsKey('split');
    final inset = t.len('app-inset-top');
    final hairline = t.len('glacier-hairline');
    final islands = style == TopBarStyle.islands;
    Widget bar = Padding(
      // The line under a split window's bar is inside its height, drawn or not.
      padding: EdgeInsets.only(top: t.len('app-bar-top') + (split ? inset : 0), bottom: t.len('app-tab-bottom') + (split ? hairline : 0)),
      child: child,
    );
    // The Mac app: the bar's row is the window's title bar, so its empty ground drags the window (`.app-dragBar`,
    // behind the controls, which still take their presses).
    if (titlebarOverlay(t)) {
      if (defaultTargetPlatform == TargetPlatform.windows) {
        bar = Stack(
          fit: StackFit.passthrough,
          children: [
            const Positioned.fill(child: WindowsDragStrip()),
            Padding(padding: const EdgeInsets.only(right: windowsCaptionControlsWidth), child: bar),
            Positioned(top: 0, right: 0, bottom: 0, child: WindowsCaptionControls(dark: t.isDark)),
          ],
        );
      } else {
        bar = Stack(fit: StackFit.passthrough, children: [const Positioned.fill(child: MacDragStrip()), bar]);
      }
    }
    if (split && !islands) {
      // With tabs showing, their own baseline takes over from the bar's hairline: two lines a pixel apart would
      // read as a double rule.
      final lined = t.attrs['tabs'] != 'rows';
      bar = BarGlass(
        child: DecoratedBox(
          position: DecorationPosition.foreground,
          decoration: BoxDecoration(
            border: Border(bottom: BorderSide(color: lined ? t.color('glacier-border-subtle') : const Color(0x00000000), width: hairline)),
          ),
          child: bar,
        ),
      );
    }
    return Positioned(top: split ? 0 : inset, left: 0, right: 0, height: heightOf(t), child: bar);
  }
}
