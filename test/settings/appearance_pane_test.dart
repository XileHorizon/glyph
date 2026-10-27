import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ghost_md/art/app_icon.dart';
import 'package:ghost_md/core/preferences.dart';
import 'package:ghost_md/settings/accent_swatch.dart';
import 'package:ghost_md/settings/appearance_pane.dart';
import 'package:ghost_md/settings/choice_card.dart';
import 'package:ghost_md/settings/kit/settings_kit.dart';
import 'package:ghost_md/settings/scale_cards.dart';
import 'package:ghost_md/settings/settings_screen.dart';
import 'package:ghost_md/settings/settings_sheet.dart';
import 'package:ghost_md/settings/theme_cards.dart';
import 'package:ghost_md/settings/typeface_cards.dart';
import 'package:glacier/glacier.dart';

import 'support.dart';

/// Appearance's page: the web app's src/app/settings/AppearancePane.test.tsx, appearanceCards.test.tsx and
/// AccentSwatch.test.tsx on the Flutter port, with each control held to what the app then draws, and the page held
/// to the rects the web page measured (390 x 844, light, 2026-10-07). Drawn through the real sheet, over the app's
/// real preferences, on a window tall enough to hold the whole page.
///
/// The page's first card is the port's own since 2026-10-24, the mode (Matt: "move the simple or advanced toggle
/// under appearance"; mode_cards_test.dart): the web's page begins with Page, so each of the web's measures is held
/// that card and its gap further down ([_modeAbove]), and the card itself where Page stood.

const Size _tall = Size(390, 6700);

/// How far the mode's card puts the web's page down: from its top to Page's, its height and the gap between cards.
double _modeAbove(WidgetTester tester) {
  double top(String title) => tester.getRect(find.byWidgetPredicate((w) => w is PaneSection && w.title == title)).top;
  return top('Page') - top('Mode');
}

/// What Margin's Notes card (Kevin, 2026-10-27), which the web's page did not have, adds under Page: the card and
/// its gap, and every card from Home page down that much further.
double _notesAbove(WidgetTester tester) {
  double top(String title) => tester.getRect(find.byWidgetPredicate((w) => w is PaneSection && w.title == title)).top;
  return top('Home page') - top('Notes');
}

/// What the Market's themes and faces (Matt, 2026-10-26: "include some more themes, fonts") add to the web's page,
/// which was measured with six themes, five note faces and three interface faces: the rows of cards they make, each
/// as tall as a card and the gap under it here. `page` is Page's growth, `type` Type's.
({double page, double type}) _marketRows(WidgetTester tester) {
  double extra(String group, int had) {
    final radios = _within(group, find.byWidgetPredicate((w) => w is Semantics && w.properties.inMutuallyExclusiveGroup == true));
    final cards = [for (var i = 0; i < radios.evaluate().length; i++) tester.getRect(radios.at(i))];
    // System spans its row, the theme cards' first: the rest are as many to a row as fit.
    final spans = cards.length > 1 && cards.first.width > cards[1].width + 0.5;
    final rest = spans ? cards.skip(1).toList() : cards;
    final columns = rest.where((c) => (c.top - rest.first.top).abs() < 0.5).length;
    final pitch = cards.firstWhere((c) => c.top > cards.first.top + 0.5).top - cards.first.top;
    int rows(int n) => (spans ? 1 : 0) + (n - (spans ? 1 : 0) + columns - 1) ~/ columns;
    return (rows(cards.length) - rows(had)) * pitch;
  }

  return (page: extra('Theme', 6), type: extra('Note font', 5) + extra('Interface font', 3));
}

Future<void> _open(WidgetTester tester, {Preferences prefs = const Preferences(theme: 'light'), Size size = _tall}) =>
    pumpSettings(tester, SettingsSheet(open: true, onClose: () {}, toPage: const SettingsTarget('theme', nonce: 1)), size: size, prefs: prefs);

/// The page alone in a made-up screen, for the two cards that are drawn only where they do something.
Future<void> _alone(WidgetTester tester, AppearancePane pane) => pumpSettings(
      tester,
      SettingsScreen(
        open: true,
        onClose: () {},
        sections: [SettingsSection(id: 'theme', label: 'Appearance', icon: const SizedBox.shrink(), group: 0, content: (context) => pane)],
        goTo: const SettingsTarget('theme', nonce: 1),
      ),
      size: _tall,
    );

List<String?> _titles(WidgetTester tester) => [for (final card in tester.widgetList<PaneSection>(find.byType(PaneSection))) card.title];
List<String> _labels(WidgetTester tester, String card) => [
      for (final row in tester.widgetList<SettingRow>(find.descendant(of: find.byWidgetPredicate((w) => w is PaneSection && w.title == card), matching: find.byType(SettingRow)))) row.label,
    ];

/// A group of choice cards, by its name.
ChoiceCards<T> _cards<T>(WidgetTester tester, String group) => tester.widget(find.byWidgetPredicate((w) => w is ChoiceCards<T> && w.label == group));
Finder _within(String group, Finder what) => find.descendant(of: find.byWidgetPredicate((w) => w is ChoiceCards && w.label == group), matching: what);

Future<void> _tap(WidgetTester tester, Finder finder) async {
  await tester.tap(finder);
  await tester.pump();
  await settleSettings(tester);
}

/// The page's own tokens, as the app's theme has them now.
Tokens _root(WidgetTester tester) => tokensAt(tester, find.byType(SettingsSheet));

void main() {
  setUpAll(loadAppFonts);

  group('the Appearance page', () {
    testWidgets('holds the look, the type, the motion and, on a phone, the touch, in that order', (tester) async {
      await _open(tester);
      expect(_titles(tester), ['Mode', 'Page', 'Notes', 'Home page', 'Top bar', 'Accent', 'Type', 'Spacing', 'Corners', 'Code', 'Motion', 'Touch']);
      await endSettings(tester);
    });

    testWidgets('keeps the two size dials together in Type, beside the two faces', (tester) async {
      await _open(tester);
      expect(_labels(tester, 'Type'), ['Note font', 'Interface font', 'Text size', 'Scale']);
      expect(_labels(tester, 'Motion'), ['Animation speed', 'Ghostly typing', 'Blur at the edges', 'Ripples while recording']);
      // The sample in the card's head, in the note's own face at the headings' size.
      final sample = tester.widget<Text>(find.byKey(const ValueKey('settings-sample')));
      expect(sample.data, 'Aa');
      expect(sample.style!.fontFamily, 'Maple Mono');
      expect(sample.style!.fontSize, closeTo(36.6157, 0.01));
      expect(sample.style!.letterSpacing, closeTo(-1.6477, 0.001));
      expect(sample.style!.fontWeight, FontWeight.w700);
      expect(tester.getRect(find.byKey(const ValueKey('settings-sample'))), rectNear(31.23, 2297.75 + _modeAbove(tester) + _notesAbove(tester) + _marketRows(tester).page, 327.53, 36.61, 2.5));
      await endSettings(tester);
    });

    testWidgets('has no Touch where there is no motor, and no Sidebar on a phone, where it changes nothing', (tester) async {
      await _alone(tester, const AppearancePane(hasMotor: false));
      expect(_titles(tester), ['Mode', 'Page', 'Notes', 'Home page', 'Top bar', 'Accent', 'Type', 'Spacing', 'Corners', 'Code', 'Motion']);
      expect(find.text('Haptics'), findsNothing);
      expect(find.text('Sidebar'), findsNothing);
      expect(appearanceFindable(wide: false, haptics: false).map((f) => f.name), isNot(anyOf(contains('Sidebar'), contains('Haptics'))));
      expect(appearanceFindable(wide: true, haptics: true).map((f) => f.name), containsAll(['Sidebar', 'Haptics']));
      await endSettings(tester);
    });

    testWidgets('offers the home page’s four layouts as cards, Spotlight chosen at first, and writes the one picked as picked', (tester) async {
      await _open(tester);
      final cards = _cards<String>(tester, 'Home page layout');
      expect(cards.values.map(cards.nameOf), ['Spotlight', 'Cards', 'Timeline', 'List']);
      expect(cards.value, 'spotlight');
      expect(preferences.value.homeLayoutChosen, isFalse);
      await _tap(tester, _within('Home page layout', find.text('Cards')));
      expect((preferences.value.homeLayout, preferences.value.homeLayoutChosen), ('cards', true));
      expect(_cards<String>(tester, 'Home page layout').value, 'cards');
      expect(tester.getSemantics(find.bySemanticsLabel('Cards')), isSemantics(label: 'Cards', hasCheckedState: true, isChecked: true, isInMutuallyExclusiveGroup: true, hasTapAction: true, isFocusable: true, hasFocusAction: true));
      expect(tester.getSemantics(find.bySemanticsLabel('Spotlight')), isSemantics(label: 'Spotlight', hasCheckedState: true, isChecked: false, isInMutuallyExclusiveGroup: true, hasTapAction: true, isFocusable: true, hasFocusAction: true));
      await endSettings(tester);
    });

    testWidgets('offers the top bar’s four ways as cards, Classic chosen at first, and writes the one picked', (tester) async {
      await _open(tester);
      final cards = _cards<String>(tester, 'Top bar');
      expect(cards.values.map(cards.nameOf), ['Classic', 'Ledger', 'Masthead', 'Islands']);
      expect(cards.value, 'classic');
      await _tap(tester, _within('Top bar', find.text('Islands')));
      expect(preferences.value.topBar, 'islands');
      expect(_cards<String>(tester, 'Top bar').value, 'islands');
      // Stamped on the page for the bar's own stylesheets, and taken off again for Classic.
      expect(_root(tester).attrs['topbar'], 'islands');
      await _tap(tester, _within('Top bar', find.text('Classic')));
      expect(_root(tester).attrs.containsKey('topbar'), isFalse);
      await endSettings(tester);
    });

    testWidgets('offers the sidebar’s choice on a window wide enough for the sidebar, and writes it', (tester) async {
      await _alone(tester, const AppearancePane(wide: true));
      expect(_titles(tester), contains('Sidebar'));
      await _tap(tester, find.text('Docked'));
      expect(preferences.value.sidebarStyle, 'docked');
      await endSettings(tester);
    });

    testWidgets('writes each switch to what the app reads', (tester) async {
      await _open(tester);
      Finder toggle(String row) => find.descendant(of: find.widgetWithText(SettingRow, row), matching: find.byType(GlacierSwitch));
      for (final (row, read) in <(String, bool Function(Preferences))>[('Ghostly typing', (p) => p.wisp), ('Blur at the edges', (p) => p.wispEdge), ('Ripples while recording', (p) => p.ripples)]) {
        expect(read(preferences.value), isTrue);
        await _tap(tester, toggle(row));
        expect(read(preferences.value), isFalse, reason: row);
        expect(tester.widget<GlacierSwitch>(toggle(row)).checked, isFalse);
      }
      // The haptics are this device's own switch, and the motor's.
      expect(hapticsPref.value, isTrue);
      expect(hapticsEnabled(), isTrue);
      await _tap(tester, toggle('Haptics'));
      expect(hapticsPref.value, isFalse);
      expect(hapticsEnabled(), isFalse);
      expect(tester.widget<GlacierSwitch>(toggle('Haptics')).checked, isFalse);
      await endSettings(tester);
    });

    testWidgets('writes the text size and the scale, each its own preference, and the app is drawn by both', (tester) async {
      await _open(tester);
      final title = _root(tester).len('app-title');
      await _tap(tester, find.text('Largest'));
      expect(preferences.value.textSize, 'largest');
      expect(_root(tester).attrs['text-size'], 'largest');
      // The reader's dial: what is read grows, the taps stay where they are.
      expect(_root(tester).len('app-title'), greaterThan(title));
      expect(tester.widget<Text>(find.byKey(const ValueKey('settings-display'))).style!.fontSize, closeTo(_root(tester).len('app-title'), 0.001));

      final preview = _within('Interface size', find.byType(ClipRect)).first;
      expect(tester.getRect(preview).height, closeTo(52, 1));
      await _tap(tester, _within('Interface size', find.text('110%')));
      expect(preferences.value.uiScale, 1.1);
      expect(preferences.value.textSize, 'largest');
      // Everything is drawn a tenth larger: a window 3.25rem high is 57.2 pixels of the screen, and the page is laid
      // out in a window that much smaller.
      expect(tester.getRect(preview).height, closeTo(52 * 1.1, 1.2));
      expect(MediaQuery.sizeOf(tester.element(find.byType(SettingsSheet))).width, closeTo(390 / 1.1, 0.01));
      expect(tester.getRect(find.byType(SettingsSheet)).size, _tall);
      await endSettings(tester);
    });

    testWidgets('has no Link previews: that is Account’s Privacy card now', (tester) async {
      await _open(tester);
      expect(find.text('Link previews'), findsNothing);
      await endSettings(tester);
    });

    testWidgets('writes the spacing, the corners, the pace and the colours of code, and the kit’s tokens follow', (tester) async {
      await _open(tester);
      final space = _root(tester).space(3), radius = _root(tester).radius('lg');
      // Spacing: the kit's density picker in Ghost.md's words.
      expect(find.text('Comfortable'), findsOneWidget);
      await _tap(tester, find.text('Tight'));
      expect(preferences.value.density, 'compact');
      expect(_root(tester).attrs['density'], 'compact');
      expect(_root(tester).space(3), lessThan(space));
      await _tap(tester, find.text('Comfortable'));
      expect(_root(tester).attrs.containsKey('density'), isFalse);
      expect(_root(tester).space(3), space);

      await _tap(tester, find.text('Square'));
      expect(preferences.value.rounding, 'square');
      expect(_root(tester).radius('lg'), lessThan(radius));
      await _tap(tester, find.text('Roundest'));
      expect(preferences.value.rounding, 'rounder');
      expect(_root(tester).radius('lg'), greaterThan(radius));
      // Pills stay pills.
      expect(_root(tester).radius('full'), 9999);

      expect(_root(tester).duration('glacier-duration-fast'), const Duration(milliseconds: 150));
      await _tap(tester, find.text('Brisk'));
      expect(preferences.value.motionSpeed, 'brisk');
      expect(_root(tester).duration('glacier-duration-fast'), const Duration(milliseconds: 90));
      expect(_root(tester).len('app-motion-scale'), 0.6);
      await _tap(tester, find.text('Relaxed'));
      expect(_root(tester).duration('glacier-duration-slower'), const Duration(milliseconds: 960));
      await _tap(tester, find.text('Normal'));
      expect(_root(tester).duration('glacier-duration-fast'), const Duration(milliseconds: 150));
      expect(_root(tester).len('app-motion-scale'), 1);

      expect(preferences.value.codeChosen, isFalse);
      await _tap(tester, find.text('GitHub'));
      await _tap(tester, find.text('Nord'));
      expect((preferences.value.codeLight, preferences.value.codeDark, preferences.value.codeChosen), ('github', 'nord', true));
      expect(_root(tester).attrs, allOf(containsPair('code-light', 'github'), containsPair('code-dark', 'nord')));
      await endSettings(tester);
    });

    testWidgets('writes the two faces, each its own, and stamps each', (tester) async {
      await _open(tester);
      final note = _cards<String>(tester, 'Note font'), ui = _cards<String>(tester, 'Interface font');
      expect(note.values.map(note.nameOf), ['Maple Mono', 'Fira Code', 'JetBrains Mono', 'Inter', 'Noto', 'Plex', 'Atkinson', 'Lora']);
      expect(ui.values.map(ui.nameOf), ['Inter', 'Noto', 'Plex', 'Atkinson']);
      expect((note.value, ui.value), ('maple', 'inter'));
      await _tap(tester, _within('Note font', find.text('Inter')));
      expect(preferences.value.noteFace, 'inter');
      expect(_root(tester).attrs['note-font'], 'inter');
      // The sample over the card follows the note's face.
      expect(tester.widget<Text>(find.byKey(const ValueKey('settings-sample'))).style!.fontFamily, 'Inter Variable');
      await _tap(tester, _within('Interface font', find.text('Plex')));
      expect(preferences.value.typeface, 'plex');
      expect(_root(tester).attrs['font'], 'plex');
      await _tap(tester, _within('Interface font', find.text('Inter')));
      expect(_root(tester).attrs.containsKey('font'), isFalse);
      await endSettings(tester);
    });

    testWidgets('leaves a drag across its radios and its sliding controls to them, and swipes back anywhere else', (tester) async {
      await _open(tester, size: phone);
      Future<void> swipeFrom(Offset at) async {
        final gesture = await tester.startGesture(at);
        await gesture.moveBy(const Offset(140, 0));
        await gesture.up();
        await tester.pump();
        await settleSettings(tester);
      }

      // Across the theme cards: nothing.
      await swipeFrom(tester.getCenter(find.text('Follows the phone')));
      expect(find.byKey(const ValueKey('settings-display')), findsOneWidget);
      // Across the page's own words: back to the list.
      await swipeFrom(tester.getCenter(find.text('PAGE')));
      expect(find.byKey(const ValueKey('settings-display')), findsNothing);
      await endSettings(tester);
    });
  });

  group('the theme cards', () {
    testWidgets('offer every theme the app has, System first and split into its light and dark halves', (tester) async {
      await _open(tester);
      final t = _root(tester);
      final options = themeOptions(t);
      expect(options.map((o) => o.value), themes);
      expect(options.first.alternatePalette!.background, sameColor(inkDark(t).background));
      expect(options.first.palette.background, sameColor(inkLight(t).background));
      expect(options.map((o) => o.description), [
        'Follows the phone', 'Ink on paper', 'Paper on ink', 'Light, with red', 'Dark, with green', 'Dark, with amber', //
        'Light, with purple', 'Light, with green', 'Dark, with teal', 'Dark, with purple',
      ]);
      await endSettings(tester);
    });

    testWidgets('paint Light and Dark in Ghost.md’s own ink, no hue anywhere, with the accent left to the app', (tester) async {
      await _open(tester);
      final t = _root(tester);
      for (final palette in [inkLight(t), inkDark(t)]) {
        for (final colour in [palette.background, palette.sidebar, palette.surface, palette.border, palette.text, palette.muted]) {
          expect((colour.r - colour.g).abs() + (colour.g - colour.b).abs(), lessThan(0.005));
        }
        expect(palette.accent, t.color('glacier-accent-solid'));
      }
      await endSettings(tester);
    });

    testWidgets('paint a named theme as the kit does, with the accent that comes with it', (tester) async {
      await _open(tester);
      final t = _root(tester);
      // What the page's cards computed for each, measured there.
      final dawn = presetPalette(t, 'dawn');
      expect(dawn.text, sameColor(t.colorOf('oklch(0.303 0.0165 46)')));
      expect(dawn.muted, sameColor(t.colorOf('oklch(0.498 0.0255 46)')));
      expect(dawn.border, sameColor(t.colorOf('oklch(0.87 0.021 46)')));
      expect(dawn.surface, sameColor(t.colorOf('oklch(0.995 0 0)')));
      expect(dawn.accent, sameColor(t.colorOf('oklch(0.627 0.19 25)')));
      final boreal = presetPalette(t, 'boreal');
      expect(boreal.background, sameColor(t.colorOf('oklch(0.14 0.0039 165)')));
      expect(boreal.sidebar, sameColor(t.colorOf('oklch(0.17 0.0056 165)')));
      expect(boreal.border, sameColor(t.colorOf('oklch(0.33 0.0196 165)')));
      expect(boreal.text, sameColor(t.colorOf('oklch(0.935 0.0118 165)')));
      expect(boreal.muted, sameColor(t.colorOf('oklch(0.805 0.0238 165)')));
      // And the same whatever the page is wearing itself.
      await endSettings(tester);
      await _open(tester, prefs: const Preferences(theme: 'ember', accent: 'amber'));
      final under = presetPalette(_root(tester), 'dawn');
      expect(under.text, sameColor(dawn.text));
      expect(under.accent, sameColor(dawn.accent));
      await endSettings(tester);
    });

    testWidgets('are radios: the chosen one is checked and ringed, and choosing another dresses the app in it', (tester) async {
      await _open(tester, prefs: const Preferences(theme: 'dark'));
      final cards = _cards<String>(tester, 'Theme');
      expect(cards.values.map(cards.nameOf), ['System', 'Light', 'Dark', 'Dawn', 'Boreal', 'Ember', 'Sakura', 'Meadow', 'Tide', 'Dusk']);
      expect(cards.value, 'dark');
      expect(tester.getSemantics(find.bySemanticsLabel('Dark')), isSemantics(label: 'Dark', hasCheckedState: true, isChecked: true, isInMutuallyExclusiveGroup: true, hasTapAction: true, isFocusable: true, hasFocusAction: true));
      expect(_root(tester).isDark, isTrue);
      final ink = _root(tester).color('app-ink');

      // A named theme brings its side of the page, its tinted greys and its accent.
      await _tap(tester, _within('Theme', find.text('Ember')));
      expect((preferences.value.theme, preferences.value.accent), ('ember', 'amber'));
      expect(_root(tester).attrs, allOf(containsPair('theme', 'dark'), containsPair('theme-preset', 'ember'), containsPair('accent', 'amber')));
      expect(_root(tester).color('app-ink'), isNot(sameColor(ink)));
      expect(tester.widget<AccentSwatch>(find.byType(AccentSwatch)).accent, 'amber');
      // Back to a plain theme: the accent it brought goes with it.
      await _tap(tester, _within('Theme', find.text('Light')));
      expect((preferences.value.theme, preferences.value.accent), ('light', 'ink'));
      expect(_root(tester).attrs.keys, isNot(anyOf(contains('theme-preset'), contains('accent'))));
      expect(_root(tester).isDark, isFalse);
      expect(_root(tester).color('glacier-bg'), sameColor(cssColor(tester, 'oklch(0.995 0 0)')));
      // System follows the device: nothing is stamped, and a dark phone is a dark page.
      await _tap(tester, _within('Theme', find.text('System')));
      expect(preferences.value.theme, 'system');
      expect(preferences.value.attrs.containsKey('theme'), isFalse);
      tester.platformDispatcher.platformBrightnessTestValue = Brightness.dark;
      addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
      await tester.pump();
      expect(_root(tester).isDark, isTrue);
      await endSettings(tester);
    });

    testWidgets('are the page’s cards to the pixel', (tester) async {
      await _open(tester);
      final down = _modeAbove(tester);
      Rect card(String name) => tester.getRect(find.ancestor(of: _within('Theme', find.text(name)), matching: find.byType(AnimatedContainer)).first);
      // Measured on the page: System across the card, then the others in pairs, 13.39 apart.
      expect(card('System'), rectNear(35.7, 208.13 + down, 318.59, 170.56, 0.6));
      expect(card('Light'), rectNear(35.7, 392.08 + down, 152.59, 170.56, 0.8));
      expect(card('Dark'), rectNear(201.69, 392.08 + down, 152.61, 170.56, 0.8));
      expect(card('Dawn'), rectNear(35.7, 576.03 + down, 152.59, 170.56, 1.2));
      // The miniature: 6.5rem with its hairline, the words 13.39 in from the card's edge, the tick 20 across.
      final system = find.ancestor(of: _within('Theme', find.text('System')), matching: find.byType(AnimatedContainer)).first;
      final miniature = find.descendant(of: system, matching: find.byWidgetPredicate((w) => w is Container && w.constraints?.maxHeight == 104));
      expect(tester.getRect(miniature), rectNear(36.7, 209.13 + down, 316.59, 104, 0.3));
      expect(tester.getRect(find.text('System')).topLeft.dx, closeTo(50.09, 0.1));
      expect(tester.getRect(find.text('System')).topLeft.dy, closeTo(326.52 + down, 0.3));
      expect(tester.getRect(find.descendant(of: system, matching: find.byType(ChoiceTick))), rectNear(319.91, 335.41 + down, 20, 20, 0.5));
      final look = tester.widget<AnimatedContainer>(system).decoration! as BoxDecoration;
      expect(look.borderRadius, BorderRadius.circular(16));
      expect(look.border, Border.all(color: cssColor(tester, 'oklch(0.925 0 0)')));
      expect(look.color, sameColor(cssColor(tester, 'oklch(0.995 0 0)')));
      // The chosen one: the accent's line, and a ring of it a pixel out.
      final chosen = tester.widget<AnimatedContainer>(find.ancestor(of: _within('Theme', find.text('Light')), matching: find.byType(AnimatedContainer)).first).decoration! as BoxDecoration;
      expect((chosen.border! as Border).top.color, sameColor(cssColor(tester, 'oklch(0.16 0 0)')));
      expect(chosen.boxShadow!.single.spreadRadius, 1);
      expect(chosen.boxShadow!.single.color, sameColor(cssColor(tester, 'oklch(0.16 0 0)')));
      await endSettings(tester);
    });
  });

  group('the accent swatch', () {
    testWidgets('names every accent, ticks the chosen one, and is one stop for the Tab key', (tester) async {
      await _open(tester, prefs: const Preferences(theme: 'light', accent: 'teal'));
      Finder dot(String one) => find.byKey(ValueKey('accent-dot-$one'));
      for (final one in accents) {
        final name = {'ink': 'Ink', 'graphite': 'Graphite', 'red': 'Red', 'amber': 'Amber', 'green': 'Green', 'teal': 'Teal', 'purple': 'Purple'}[one]!;
        expect(tester.getSemantics(find.ancestor(of: dot(one), matching: find.bySemanticsLabel(name)).first), isSemantics(label: name, hasCheckedState: true, isChecked: one == 'teal', isInMutuallyExclusiveGroup: true, hasTapAction: true, isFocusable: true, hasFocusAction: true));
        // Ticked as well as ringed, so it is never colour alone that says which is picked.
        expect(find.descendant(of: dot(one), matching: find.byType(AppIcon)), one == 'teal' ? findsOneWidget : findsNothing);
      }
      // Each dot is drawn in the ramp choosing it would put on the app, measured on the page; Ink is the page's own.
      Color fill(String one) => (tester.widget<AnimatedContainer>(dot(one)).decoration! as BoxDecoration).color!;
      expect(fill('ink'), sameColor(cssColor(tester, 'oklch(0.16 0 0)')));
      expect(fill('graphite'), sameColor(cssColor(tester, 'oklch(0.627 0.012 260)')));
      expect(fill('red'), sameColor(cssColor(tester, 'oklch(0.627 0.19 25)')));
      // 2rem dots sharing the card's width: 32 across, 46.28 from one to the next.
      expect(tester.getRect(dot('ink')).left, closeTo(40.16, 0.1));
      expect(tester.getRect(dot('graphite')).left - tester.getRect(dot('ink')).left, closeTo(46.28, 0.05));
      expect(tester.getRect(dot('red')).size, const Size(32, 32));
      await endSettings(tester);
    });

    testWidgets('chooses the one pressed, and the app’s accent is it', (tester) async {
      await _open(tester);
      final solid = _root(tester).color('glacier-accent-solid');
      expect(solid, sameColor(_root(tester).color('app-ink')));
      await _tap(tester, find.byKey(const ValueKey('accent-dot-red')));
      expect(preferences.value.accent, 'red');
      expect(_root(tester).attrs['accent'], 'red');
      expect(_root(tester).color('glacier-accent-solid'), isNot(sameColor(solid)));
      // The cards follow the swatch: the chosen theme card's ring is the accent now.
      final ring = tester.widget<AnimatedContainer>(find.ancestor(of: _within('Theme', find.text('Light')), matching: find.byType(AnimatedContainer)).first).decoration! as BoxDecoration;
      expect((ring.border! as Border).top.color, sameColor(_root(tester).color('glacier-accent-solid')));
      await _tap(tester, find.byKey(const ValueKey('accent-dot-ink')));
      expect(_root(tester).attrs.containsKey('accent'), isFalse);
      await endSettings(tester);
    });

    testWidgets('steps with the arrows, round from the last to the first and back', (tester) async {
      final picked = <String>[];
      var accent = 'purple';
      late StateSetter set;
      await pumpSettings(
        tester,
        StatefulBuilder(builder: (context, setState) {
          set = setState;
          return Align(alignment: Alignment.topLeft, child: SizedBox(width: 345, child: AccentSwatch(accent: accent, onAccent: (next) => set(() => picked.add(accent = next)))));
        }),
      );
      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
      await tester.pump();
      expect(picked.last, 'ink');
      await tester.sendKeyEvent(LogicalKeyboardKey.arrowUp);
      await tester.pump();
      expect(picked.last, 'purple');
      await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
      await tester.pump();
      expect(picked.last, 'graphite');
      expect(picked, ['ink', 'purple', 'ink', 'graphite']);
      // Any other key is the page's.
      final before = picked.length;
      await tester.sendKeyEvent(LogicalKeyboardKey.keyA);
      expect(picked.length, before);
      await endSettings(tester);
    });
  });

  group('the size cards', () {
    testWidgets('draw the same piece of the app at every step, sized by the step, and choose by radio', (tester) async {
      await _open(tester);
      final cards = _cards<double>(tester, 'Interface size');
      expect(cards.values, uiScales);
      // A radio is named in words, not by its value: "85%", not "0.85".
      expect(cards.values.map(cards.nameOf), ['85%', '93%', 'Default', '110%', '125%']);
      expect(cards.value, 1);
      expect(find.descendant(of: find.byType(ScaleCards), matching: find.text('Default')), findsOneWidget);
      // Measured on the page: five cards 56.58 x 84.08, 8.93 apart; and the piece's icon 0.7em of each step.
      final first = find.ancestor(of: _within('Interface size', find.text('85%')), matching: find.byType(AnimatedContainer)).first;
      expect(tester.getRect(first), rectNear(35.7, 3530.88 + _modeAbove(tester) + _notesAbove(tester) + _marketRows(tester).page + _marketRows(tester).type, 56.58, 84.08, 3.5));
      expect(tester.getRect(first).size.width, closeTo(56.58, 0.05));
      expect(tester.getRect(first).size.height, closeTo(84.08, 0.6));
      final icons = tester.widgetList<Container>(_within('Interface size', find.byWidgetPredicate((w) => w is Container && w.decoration is BoxDecoration && (w.decoration! as BoxDecoration).borderRadius != null && w.constraints?.maxWidth == w.constraints?.maxHeight && (w.constraints?.maxWidth ?? 99) < 16)));
      expect([for (final icon in icons) icon.constraints!.maxWidth], [for (final step in uiScales) closeTo(0.7 * 16 * step, 0.001)]);
      await _tap(tester, _within('Interface size', find.text('125%')));
      expect(preferences.value.uiScale, 1.25);
      await endSettings(tester);
    });
  });

  group('the typeface cards', () {
    testWidgets('set a scrap of a note, or of the app, in each face, as the page does', (tester) async {
      await _open(tester);
      final maple = find.ancestor(of: _within('Note font', find.text('Maple Mono')), matching: find.byType(AnimatedContainer)).first;
      // Measured on the page: one card to a row on a phone, 318.59 x 89.33, the next 8.93 under it.
      expect(tester.getRect(maple).size.width, closeTo(318.59, 0.05));
      expect(tester.getRect(maple).size.height, closeTo(89.33, 0.8));
      final heading = tester.widget<Text>(find.descendant(of: maple, matching: find.byType(Text)).first);
      expect(heading.textSpan!.toPlainText(), '# Quick & Foxy');
      expect(heading.style!.fontFamily, 'Maple Mono');
      expect(heading.style!.fontSize, closeTo(15.2, 0.001));
      expect(heading.style!.fontWeight, FontWeight.w700);
      // A coding face as the app sets it: its own features, so `->` joins.
      expect(heading.style!.fontFeatures, const [FontFeature('calt'), FontFeature('liga')]);
      // Every face is the app's own file (pubspec.yaml), so each card is set in its face: Fira Code as a coding
      // face with its features, Plex as a sans with the page's.
      expect(shippedFamilies, containsAll(typefaceFamilies.values));
      final fira = find.ancestor(of: _within('Note font', find.text('Fira Code')), matching: find.byType(AnimatedContainer)).first;
      final firaHeading = tester.widget<Text>(find.descendant(of: fira, matching: find.byType(Text)).first).style!;
      expect(firaHeading.fontFamily, 'Fira Code Variable');
      expect(firaHeading.fontFeatures, const [FontFeature('calt'), FontFeature('liga')]);
      final plex = find.ancestor(of: _within('Note font', find.text('Plex')), matching: find.byType(AnimatedContainer)).first;
      expect(tester.widget<Text>(find.descendant(of: plex, matching: find.byType(Text)).first).style!.fontFamily, 'IBM Plex Sans');
      // An interface face's card: a title and a row of tabs, the open one on a patch of the ink.
      final today = tester.getRect(_within('Interface font', find.text('Today')).first);
      expect(today.height, closeTo(14.976, 0.6));
      final pill = tester.getRect(find.ancestor(of: _within('Interface font', find.text('Today')).first, matching: find.byType(Container)).first);
      expect(pill.width, closeTo(46.06, 0.5));
      expect(pill.left, closeTo(45.63, 0.1));
      await endSettings(tester);
    });
  });

  group('the page as the web page measured it', () {
    testWidgets('lays its cards out where the page’s are', (tester) async {
      await _open(tester);
      Rect card(String title) => tester.getRect(find.byWidgetPredicate((w) => w is PaneSection && w.title == title));
      // The page's word, then each card: its top and its height on the web page. A line with a height of its own
      // (20.09px for a caption) is a whole number of pixels here, so a card may be a pixel or two off and the page
      // three by its foot; nothing more.
      expect(tester.getRect(find.byKey(const ValueKey('settings-display'))), rectNear(22.31, 62.45, 345.38, 29.05, 0.1));
      // The mode's card where the web's first card stood, as wide; the web's cards that much further down.
      expect(card('Mode').top, closeTo(122.73, 3.5));
      expect(card('Mode').left, closeTo(22.31, 0.05));
      expect(card('Mode').width, closeTo(345.38, 0.05));
      final down = _modeAbove(tester);
      // Its title, its words, the two cards and the line under them, and the gap to the next card: a figure of the
      // port's own, so held loosely, and the web's cards to it.
      expect(down, inInclusiveRange(250, 450));
      final web = {
        'Page': (122.73, 821.2),
        'Home page': (961.78, 569.66),
        'Top bar': (1549.28, 554.63),
        'Accent': (2121.75, 135.23),
        'Type': (2274.83, 1353.52),
        'Spacing': (3646.19, 226.7),
        'Corners': (3890.73, 143.56),
        'Code': (4052.14, 269.34),
        'Motion': (4339.33, 523.86),
      };
      // The Market's themes and faces, which the web's page did not have then: Page and Type that many rows taller,
      // and every card under each that much further down.
      final market = _marketRows(tester);
      expect(market.page, greaterThan(0));
      expect(market.type, greaterThan(0));
      const order = ['Page', 'Home page', 'Top bar', 'Accent', 'Type', 'Spacing', 'Corners', 'Code', 'Motion'];
      for (final entry in web.entries) {
        final rect = card(entry.key);
        final at = order.indexOf(entry.key);
        final grown = entry.key == 'Page' ? market.page : entry.key == 'Type' ? market.type : 0.0;
        final below = (at > 0 ? market.page + _notesAbove(tester) : 0.0) + (at > order.indexOf('Type') ? market.type : 0.0);
        expect(rect.left, closeTo(22.31, 0.05), reason: entry.key);
        expect(rect.width, closeTo(345.38, 0.05), reason: entry.key);
        expect(rect.height, closeTo(entry.value.$2 + grown, 2), reason: '${entry.key}’s height');
        expect(rect.top, closeTo(entry.value.$1 + down + below, 3.5), reason: '${entry.key}’s top');
      }
      // The segmented controls: the kit's small size, on the deeper track a card gives them.
      final size = find.ancestor(of: find.text('Largest'), matching: find.byType(GlacierSegmentedControl));
      expect(tester.getRect(size).size.width, closeTo(318.59, 0.05));
      expect(tester.getRect(size).size.height, closeTo(38, 0.05));
      expect(tokensAt(tester, size).color('glacier-segment-track'), sameColor(cssColor(tester, 'oklch(0.895 0 0)')));
      // The home page cards: 152.59 across, the picture 6.2rem with its hairline.
      final spotlight = find.ancestor(of: _within('Home page layout', find.text('Spotlight')), matching: find.byType(AnimatedContainer)).first;
      expect(tester.getRect(spotlight).width, closeTo(152.59, 0.05));
      expect(tester.getRect(spotlight).left, closeTo(35.7, 0.05));
      final picture = find.descendant(of: spotlight, matching: find.byWidgetPredicate((w) => w is Container && w.constraints?.maxHeight != null && (w.constraints!.maxHeight - 99.2).abs() < 0.01));
      expect(tester.getRect(picture).size, const Size(150.59, 99.2).within(0.05));
      await endSettings(tester);
    });
  });
}

extension on Size {
  Matcher within(double by) => predicate<Size>((s) => (s.width - width).abs() <= by && (s.height - height).abs() <= by, 'a size within $by of $this');
}
