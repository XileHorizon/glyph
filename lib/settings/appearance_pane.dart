import 'package:flutter/widgets.dart';
import 'package:glacier/glacier.dart';

import '../core/preferences.dart';
import 'accent_swatch.dart';
import 'kit/settings_kit.dart';
import 'kit/settings_type.dart';
import 'layout_cards.dart';
import 'mode_cards.dart';
import 'scale_cards.dart';
import 'settings_screen.dart' show settingsSplitFits;
import 'settings_search.dart';
import 'theme_cards.dart';
import 'top_bar_cards.dart';
import 'typeface_cards.dart';
import 'words.dart';
import '../core/iphone_app.dart' show recordsVoice;

/// What Settings' search finds on Appearance (`findable`, src/app/settings/AppearancePane.findable.ts), by the names
/// the page draws, in its order. Type, Motion and Touch were pages of their own until docs/DESIGN.md §138: each
/// page's words are its card's now, so looking for "type" or "animations" still lands. So was Simple or advanced until
/// 2026-10-24, and its card is first here now in either mode ([experienceFindable]): "mode", "simple" and "advanced"
/// land on it.
///
/// Two rows are drawn only where they do something, and listed only there: the sidebar's choice on a window wide
/// enough for the sidebar, and the haptics where there is a motor. In Simple ([Preferences.simple]) the page is the
/// theme and the text size and nothing else, so that is all the search finds on it: "accent" typed in Simple finds
/// nothing, rather than a card that is not there.
List<SettingsFindable> appearanceFindable({required bool wide, required bool haptics, bool simple = false}) => [
      ...experienceFindable,
      const SettingsFindable('Page', 'theme light dark system dawn boreal ember'),
      const SettingsFindable('Marks', 'notes markdown margin formatted symbols hashes headings bullets view'),
      if (simple) ...[
        const SettingsFindable('Type', 'text font'),
        const SettingsFindable('Text size', 'font bigger smaller larger'),
      ] else ...appearanceFindableAdvanced(wide: wide, haptics: haptics),
    ];

/// What Advanced's page has after the theme: everything.
List<SettingsFindable> appearanceFindableAdvanced({required bool wide, required bool haptics}) => [
      const SettingsFindable('Home page', 'dashboard layout home cards list timeline spotlight grid'),
      const SettingsFindable('Top bar', 'header toolbar tabs bar ledger strip masthead islands thumb classic capsules'),
      const SettingsFindable('Accent', 'colour color highlight'),
      const SettingsFindable('Type', 'text font'),
      const SettingsFindable('Note font', 'font typeface body note editor maple fira mono monospace code coding ligatures inter noto plex'),
      const SettingsFindable('Interface font', 'font typeface ui app tabs menus inter noto plex'),
      const SettingsFindable('Text size', 'font bigger smaller larger'),
      const SettingsFindable('Scale', 'size zoom interface ui bigger smaller'),
      const SettingsFindable('Spacing', 'density compact padding roomy tight'),
      const SettingsFindable('Corners', 'rounding radius round square'),
      const SettingsFindable('Code', 'syntax highlighting colours colors'),
      if (wide) const SettingsFindable('Sidebar', 'dock column popover notes list'),
      const SettingsFindable('Motion', 'movement animations'),
      const SettingsFindable('Animation speed', 'motion fast slow'),
      const SettingsFindable('Ghostly typing', 'wisp letters blur'),
      // Smoke at the edges until 2026-10-24, when the smoke gave way to a blur: still found by the word.
      const SettingsFindable('Blur at the edges', 'wisp smoke fade scroll'),
      if (recordsVoice) const SettingsFindable('Ripples while recording', 'waves voice'),
      if (haptics) const SettingsFindable('Haptics', 'vibrate vibration buzz touch'),
    ];

/// A map of a preference's words as the options a segmented control takes, in the map's own order (`optionsOf`).
List<GlacierSegmentedOption> _options(Map<String, String> words) => [
      for (final entry in words.entries) GlacierSegmentedOption(value: entry.key, label: Text(entry.value)),
    ];

/// Port of `AppearancePane` (src/app/settings/AppearancePane.tsx): how the app looks, moves and feels. How much of
/// the app there is first ([modeSection]), then the page, then how the home page is laid out and how the top bar
/// is, each as cards that are the thing drawn small, then its one colour, then the type, how much air it gives
/// itself and how round its corners are, then the colours of code, then how it moves and how it answers a touch.
///
/// Every control writes the app's preferences ([store], the app's own unless a test brings one), and the app's theme
/// is built from them, so each choice is seen at once. The sidebar's choice is drawn only on a window wide enough
/// for the sidebar, and Touch only where there is a motor.
///
/// In Simple (GHST-103; Matt, 2026-10-18) the page is the mode, the theme cards and the text size alone: a new person
/// asked for less, and twelve cards of looks are the most of Settings there is. The rest comes back the moment
/// Advanced is chosen on the first card, with whatever was set on it before. The mode's card heads the page in
/// either mode (Matt, 2026-10-24: "move the simple or advanced toggle under appearance"); until then it was a page of
/// its own, and Simple's Appearance ended in a line, "More looks are in Advanced", whose word led there. With the
/// choice on the page itself the line had nowhere to send anyone, and went.
///
/// What differs from the web original:
/// - The first card, the mode, is the port's own: the web app has no mode.
/// - Controls whose feature has no Flutter port yet still write their preference and change nothing more: the home
///   page's layout and the top bar's style until those screens read them, the code colours, the sidebar's style,
///   the three Motion switches, and the note's face until there is a note to set in it.
/// - The faces Fira Code, Noto and Plex are not shipped yet, so choosing one draws in the fallback face.
/// - Scale reaches the app as a magnification of the whole window (lib/app/ghost_app.dart), where the page set the
///   root's font size; and the pace reaches the kit's duration tokens through the app's theme rather than inline.
class AppearancePane extends StatelessWidget {
  const AppearancePane({super.key, this.store, this.haptics, this.wide, this.hasMotor});

  /// The preferences to read and write; the app's own when null.
  final PreferencesStore? store;

  /// The haptics switch's flag; the app's own when null.
  final DeviceFlag? haptics;

  /// Whether the window has room for the sidebar; asked of the window when null.
  final bool? wide;

  /// Whether this device has a motor; asked of the platform when null.
  final bool? hasMotor;

  @override
  Widget build(BuildContext context) {
    final store = this.store ?? preferences;
    final haptics = this.haptics ?? hapticsPref;
    final wide = this.wide ?? settingsSplitFits(context);
    return ListenableBuilder(
      listenable: Listenable.merge([store, haptics]),
      builder: (context, _) {
        final t = context.tokens;
        final prefs = store.value;
        final faces = prefs.faces;
        void set(Preferences Function(Preferences now) change) => store.update(change);

        Widget segments(String label, Map<String, String> words, String value, ValueChanged<String> onChange) => GlacierSegmentedControl(
              ariaLabel: label,
              fullWidth: true,
              size: GlacierSegmentedSize.sm,
              options: _options(words),
              value: value,
              onValueChange: onChange,
            );
        final density = GlacierDensityMode.values.firstWhere((mode) => mode.token == prefs.density, orElse: () => GlacierDensityMode.comfortable);
        final sampleSize = t.len('app-h1');
        final noteFonts = t.families('app-note-font');

        final page = PaneSection(
          title: 'Page',
          description: const Text('Ink on paper, paper on ink, or one of seven tinted themes. System follows the phone.'),
          children: [
            // The kit's theme cards: each is the page painted small in that theme, System split light and dark.
            SettingRowBox(child: ThemeCards(value: prefs.theme, onValueChange: (value) => set((now) => themeChoice(value, now)))),
          ],
        );
        // The size shown rather than described, in the note's own face, so it changes with the choice under it.
        final sample = ExcludeSemantics(
          child: Text(
            'Aa',
            key: const ValueKey('settings-sample'),
            style: pageText(t, sampleSize, weight: 'bold', height: 1, tracking: t.len('app-tracking-display', em: sampleSize), color: t.color('app-ink-3'), mono: true).copyWith(
                  fontFamily: noteFonts.isEmpty ? null : noteFonts.first,
                  fontFamilyFallback: [...noteFonts.skip(1), for (final family in noteFonts) ...?t.typography.fallbacks[family]],
                ),
          ),
        );
        final textSize = SettingRow(
          label: 'Text size',
          hint: const Text('The note, the list and the headings.'),
          layout: SettingRowLayout.stacked,
          control: segments('Text size', sizeWords, prefs.textSize, (value) => set((now) => now.copyWith(textSize: value))),
        );

        // How much of the app there is, first in either mode: in Simple it is the way to the rest of these cards.
        final mode = modeSection(prefs: prefs, store: store);

        // How a note shows its marks: in line (Markdown), in a column of their own left of the words (Margin), or
        // hidden (Formatted). Margin is Markdown with `marksInMargin` on, so the view stored stays one of the two.
        final marks = PaneSection(
          title: 'Notes',
          description: const Text("Markdown's marks say how a line looks. Keep them in the line, hang them in a margin so every line's words start at one edge, or hide them."),
          children: [
            SettingRow(
              label: 'Marks',
              layout: SettingRowLayout.stacked,
              control: segments(
                'Marks',
                const {'mixed': 'Markdown', 'margin': 'Margin', 'formatted': 'Formatted'},
                prefs.noteView == 'formatted' ? 'formatted' : (prefs.marksInMargin ? 'margin' : 'mixed'),
                (value) => set((now) => now.copyWith(noteView: value == 'formatted' ? 'formatted' : 'mixed', marksInMargin: value == 'margin' ? true : (value == 'mixed' ? false : null))),
              ),
            ),
          ],
        );

        if (prefs.simple) return PaneBody(children: [mode, page, marks, PaneSection(title: 'Type', description: sample, children: [textSize])]);

        return PaneBody(
          children: [
            mode,
            page,
            marks,
            // The home page's four layouts, each a card that is the page drawn small.
            PaneSection(
              title: 'Home page',
              description: const Text('How the home page lays out your notebooks and notes. The search and its filters stay on top whichever you pick.'),
              children: [
                SettingRowBox(child: LayoutCards(value: prefs.homeLayout, onValueChange: (homeLayout) => set((now) => now.copyWith(homeLayout: homeLayout, homeLayoutChosen: true)))),
              ],
            ),
            // The top bar's four ways, each a card that is the bar drawn small.
            PaneSection(
              title: 'Top bar',
              description: const Text("Where the controls and the open notes' tabs sit. The same on every screen, and on your other devices."),
              children: [
                SettingRowBox(child: TopBarCards(value: prefs.topBar, onValueChange: (topBar) => set((now) => now.copyWith(topBar: topBar)))),
              ],
            ),
            PaneSection(
              title: 'Accent',
              description: const Text("Colours the few things that mark a choice: a focus ring, a chosen segment. Ink is the app's own."),
              children: [AccentSwatch(accent: prefs.accent, onAccent: (accent) => set((now) => now.copyWith(accent: accent)))],
            ),
            PaneSection(
              title: 'Type',
              description: sample,
              children: [
                // Two faces: the note's, and the interface's.
                SettingRow(
                  label: 'Note font',
                  hint: const Text('The words of a note and its code. Maple Mono and Fira Code join pairs like -> and != into one sign.'),
                  layout: SettingRowLayout.stacked,
                  control: TypefaceCards(label: 'Note font', kind: TypefaceKind.note, faces: typefaces, value: faces.note, onValueChange: (noteFace) => set((now) => now.copyWith(noteFace: noteFace))),
                ),
                SettingRow(
                  label: 'Interface font',
                  hint: const Text('Tabs, lists, Settings and buttons.'),
                  layout: SettingRowLayout.stacked,
                  control: TypefaceCards(label: 'Interface font', kind: TypefaceKind.interface, faces: interfaceFaces, value: faces.ui, onValueChange: (typeface) => set((now) => now.copyWith(typeface: typeface))),
                ),
                textSize,
                // A card per step, each the same row of the app drawn at that size.
                SettingRow(
                  label: 'Scale',
                  hint: const Text('Everything, buttons and bars as well as words. Stays with this device.'),
                  layout: SettingRowLayout.stacked,
                  control: ScaleCards(value: prefs.uiScale, onValueChange: (uiScale) => set((now) => now.copyWith(uiScale: uiScale))),
                ),
              ],
            ),
            PaneSection(
              title: 'Spacing',
              description: const Text('The padding and gaps of everything the app draws. The words keep their own size.'),
              children: [
                // The kit's own density picker: a card per step, each showing how tightly it packs, in Ghost.md's words.
                SettingRowBox(
                  child: GlacierDensitySelector(
                    ariaLabel: 'Spacing',
                    value: density,
                    onValueChange: (mode) => set((now) => now.copyWith(density: mode.token)),
                    labels: {for (final mode in GlacierDensityMode.values) mode: Text(densityWords[mode.token]!)},
                  ),
                ),
              ],
            ),
            PaneSection(
              title: 'Corners',
              children: [
                SettingRow(
                  label: 'Rounding',
                  hint: const Text('Cards, fields and buttons. Pills stay pills.'),
                  layout: SettingRowLayout.stacked,
                  control: segments('Rounding', roundingWords, prefs.rounding, (value) => set((now) => now.copyWith(rounding: value))),
                ),
              ],
            ),
            PaneSection(
              title: 'Code',
              description: const Text("The colours of code in a code block. Ink keeps code in the page's own ink."),
              children: [
                SettingRow(
                  label: 'On the light page',
                  layout: SettingRowLayout.stacked,
                  control: segments('Code colours on the light page', codeLightWords, prefs.codeLight, (value) => set((now) => now.copyWith(codeLight: value, codeChosen: true))),
                ),
                SettingRow(
                  label: 'On the dark page',
                  layout: SettingRowLayout.stacked,
                  control: segments('Code colours on the dark page', codeDarkWords, prefs.codeDark, (value) => set((now) => now.copyWith(codeDark: value, codeChosen: true))),
                ),
              ],
            ),
            if (wide)
              PaneSection(
                title: 'Sidebar',
                children: [
                  SettingRow(
                    label: 'Sidebar',
                    // Since 2026-10-24 the notes' sidebar on a wide window is simple mode's list, a column beside the
                    // note whichever is chosen (Matt: "make the sidebar on advanced mode the same as simple but just
                    // hide it by default"); what is left to choose is the side panel's shell.
                    hint: const Text('The side panel over the note, or docked as a column beside it. Your notes open beside the note either way.'),
                    layout: SettingRowLayout.stacked,
                    control: segments('Sidebar', sidebarWords, prefs.sidebarStyle, (value) {
                      if (isSidebarStyle(value)) set((now) => now.copyWith(sidebarStyle: value));
                    }),
                  ),
                ],
              ),
            PaneSection(
              title: 'Motion',
              description: const Text("Your phone's own reduce motion setting comes first. With it on, Ghost.md holds still whatever is on here."),
              children: [
                SettingRow(
                  label: 'Animation speed',
                  hint: const Text('How quickly letters gather and screens and sheets move.'),
                  layout: SettingRowLayout.stacked,
                  control: segments('Animation speed', speedWords, prefs.motionSpeed, (value) => set((now) => now.copyWith(motionSpeed: value))),
                ),
                SettingRow(
                  label: 'Ghostly typing',
                  // Out of a blur, where the words came out of smoke until Matt, 2026-10-24: "replace the smoke effect with
                  // a gradient blur on all places that use the wisp smoke". The switch is the same one.
                  hint: const Text('Words you say come in out of a soft blur, and words you delete blur away. What you type appears at once.'),
                  control: GlacierSwitch(ariaLabel: 'Ghostly typing', checked: prefs.wisp, onCheckedChange: (wisp) => set((now) => now.copyWith(wisp: wisp))),
                ),
                SettingRow(
                  label: 'Blur at the edges',
                  hint: const Text('A page blurs softly as it passes under the header or the dock.'),
                  control: GlacierSwitch(ariaLabel: 'Blur at the edges', checked: prefs.wispEdge, onCheckedChange: (wispEdge) => set((now) => now.copyWith(wispEdge: wispEdge))),
                ),
                // Nothing is recorded on an iPhone ([recordsVoice]), so there is nothing to ripple.
                if (recordsVoice) SettingRow(
                  label: 'Ripples while recording',
                  hint: const Text('The newest words move with your voice as the phone hears it.'),
                  control: GlacierSwitch(ariaLabel: 'Ripples while recording', checked: prefs.ripples, onCheckedChange: (ripples) => set((now) => now.copyWith(ripples: ripples))),
                ),
              ],
            ),
            if (hasMotor ?? hapticsAvailable())
              PaneSection(
                title: 'Touch',
                children: [
                  SettingRow(
                    label: 'Haptics',
                    hint: const Text('A small tap when a style or a cue kicks in.'),
                    control: GlacierSwitch(ariaLabel: 'Haptics', checked: haptics.value, onCheckedChange: haptics.set),
                  ),
                ],
              ),
          ],
        );
      },
    );
  }
}
