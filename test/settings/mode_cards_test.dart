import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ghost_md/core/preferences.dart';
import 'package:ghost_md/guide/pages/mode.dart' show experienceChoices;
import 'package:ghost_md/settings/accent_swatch.dart';
import 'package:ghost_md/settings/appearance_pane.dart';
import 'package:ghost_md/settings/choice_card.dart';
import 'package:ghost_md/settings/kit/settings_kit.dart';
import 'package:ghost_md/settings/mode_cards.dart';
import 'package:ghost_md/settings/panes/settings_host.dart';
import 'package:ghost_md/settings/settings_screen.dart';
import 'package:ghost_md/settings/settings_sections.dart';
import 'package:ghost_md/settings/settings_sheet.dart';
import 'package:glacier/glacier.dart';

import 'support.dart';

/// Simple or advanced in Settings (GHST-103; Matt, 2026-10-17: "allow selecting between simple and advanced mode
/// where simple mode has a much more approachable UI with fancy features hidden behind more"): the card that chooses,
/// first on Appearance since Matt, 2026-10-24 ("move the simple or advanced toggle under appearance and move appearnce
/// up in the settings to under account"), the old page's link landing on it, and what Simple does to Settings
/// itself, its list, its search, Appearance and About. Advanced's list is settings_sheet_test.dart's.

const Preferences _simple = Preferences(theme: 'light', experience: 'simple', experienceChosen: true);
const Preferences _advanced = Preferences(theme: 'light', experience: 'advanced', experienceChosen: true);

/// An Android phone's facts over [prefs]: nothing of what the table gates on besides the mode.
SettingsFacts _facts(Preferences prefs, {bool developer = false}) => SettingsFacts(prefs: prefs, wide: false, haptics: true, android: true, ios: false, developer: developer);

/// The ids of the sections the sheet would make of the table for [facts], listed or not.
List<String> _among(SettingsFacts facts) => [
      for (final spec in settingsSections)
        if (spec.where?.call(facts) ?? true) spec.id,
    ];

Future<void> _open(WidgetTester tester, {Preferences prefs = _simple, Size size = const Size(390, 1200), SettingsTarget? toPage}) =>
    pumpSettings(tester, SettingsSheet(open: true, onClose: () {}, toPage: toPage), size: size, prefs: prefs);

List<String?> _labels(WidgetTester tester) => [for (final text in tester.widgetList<Text>(find.byKey(const ValueKey('settings-row-label'), skipOffstage: false))) text.data];
String? _display(WidgetTester tester) {
  final found = find.byKey(const ValueKey('settings-display'));
  return found.evaluate().isEmpty ? null : tester.widget<Text>(found).data;
}

/// The line under a row of the list, by the row's label.
String? _line(WidgetTester tester, String label) {
  final row = find.ancestor(of: find.text(label, skipOffstage: false), matching: find.byType(GlacierPressable, skipOffstage: false)).first;
  final summary = find.descendant(of: row, matching: find.byKey(const ValueKey('settings-row-summary'), skipOffstage: false), skipOffstage: false);
  return summary.evaluate().isEmpty ? null : tester.widget<Text>(summary).data;
}

Finder _rowFor(String label) => find.ancestor(of: find.text(label), matching: find.byType(GlacierPressable)).first;
Finder _card(String name) => find.descendant(of: find.byType(ChoiceCards<String>), matching: find.text(name));
List<String?> _titles(WidgetTester tester) => [for (final card in tester.widgetList<PaneSection>(find.byType(PaneSection, skipOffstage: false))) card.title];

/// Whether the card named [name] is lit, as a search's find is.
bool _litCard(WidgetTester tester, String name) => SettingsFindableMark.isLit(tester.widget(find
    .descendant(of: find.byWidgetPredicate((w) => w is SettingsFindableMark && w.name == name), matching: find.byKey(SettingsFindableMark.lightKey))
    .first));

/// The listed sections for [facts] in cards, as the list draws them: consecutive rows of one group share a card.
List<List<String>> _cards(SettingsFacts facts) {
  final cards = <List<String>>[];
  int? group;
  for (final spec in settingsSections) {
    if (!(spec.where?.call(facts) ?? true) || !spec.listed) continue;
    if (spec.group != group) cards.add([]);
    group = spec.group;
    cards.last.add(spec.id);
  }
  return cards;
}

Finder get _mode => find.byWidgetPredicate((w) => w is ChoiceCards<String> && w.label == 'Mode');

Future<void> _tap(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.pump();
  await tester.tap(finder);
  await tester.pump();
  await settleSettings(tester);
}

void main() {
  setUpAll(loadAppFonts);

  group('the table', () {
    test('in Simple is Account, Notifications, Appearance and About with its cheat sheet, and in Advanced everything', () {
      expect(_among(_facts(_simple)), ['account', 'notifications', 'theme', 'about', 'cheatsheet']);
      // The hidden pages answer to their own switch, in either mode.
      expect(_among(_facts(_simple, developer: true)), ['account', 'notifications', 'theme', 'about', 'cheatsheet', 'developer', 'test-results']);
      // The meeting plugins' pages, which were Meetings, are kept in Simple too, but listed only for an account whose
      // service has Ghost in meetings, and these facts have no account (test/plugins/meetings_test.dart lists them).
      // Recording with them, for the Meetings card every kind shares (test/meet/meeting_sorting_test.dart).
      expect(_among(_facts(_simple, developer: true)).toSet(), simpleSections.difference({'plugin:google-meet', 'plugin:zoom', 'recording'}));
      const everything = ['account', 'organizations', 'workspaces', 'daily', 'notifications', 'theme', 'library', 'backup', 'export', 'import', 'recording', 'ai', 'market', 'about', 'cheatsheet', 'spec', 'examples'];
      expect(_among(_facts(_advanced)), everything);
      // Until the choice is made the app is advanced, and so is Settings.
      expect(_among(_facts(const Preferences(theme: 'light'))), everything);
      expect(const Preferences(theme: 'light').simple, isFalse);
    });

    test('has no page for the mode, and Appearance, where it is, is never put away', () {
      expect(settingsSections.map((spec) => spec.id), isNot(contains('experience')));
      expect(simpleSections, isNot(contains('experience')));
      final appearance = settingsSections.singleWhere((spec) => spec.id == 'theme');
      expect(appearance.where, isNull);
      expect(simpleSections, contains('theme'));
    });

    test('puts Appearance on a card of its own right after Account’s, in Simple and in Advanced', () {
      for (final prefs in [_simple, _advanced, const Preferences(theme: 'light')]) {
        for (final developer in [false, true]) {
          final cards = _cards(_facts(prefs, developer: developer));
          expect(cards.first.first, 'account', reason: '${prefs.experience} $developer');
          expect(cards[1], ['theme'], reason: '${prefs.experience} $developer');
        }
      }
      expect(settingsSections.singleWhere((spec) => spec.id == 'theme').group, appearanceGroup);
      expect(_cards(_facts(_simple)), [
        ['account', 'notifications'],
        ['theme'],
        ['about'],
      ]);
    });

    test('says the mode first on Appearance’s row, and the search finds the card by it', () {
      expect(experienceSummary(_simple), 'Simple');
      expect(experienceSummary(_advanced), 'Advanced');
      expect(experienceSummary(const Preferences()), 'Advanced');
      final appearance = settingsSections.singleWhere((spec) => spec.id == 'theme');
      expect(appearance.summary!(_facts(_simple)), 'Simple · Light · Maple Mono');
      expect(appearance.summary!(_facts(_advanced)), 'Advanced · Light · Maple Mono');
      expect(experienceFindable.map((f) => f.name), ['Mode']);
      expect(appearanceFindable(wide: true, haptics: true, simple: true).map((f) => f.name), ['Mode', 'Page', 'Marks', 'Type', 'Text size']);
      expect(appearanceFindable(wide: true, haptics: true).map((f) => f.name).take(2), ['Mode', 'Page']);
      // The card's words are the walkthrough's, so the two say the same thing.
      expect(experienceChoices.map((c) => c.label), ['Simple', 'Advanced']);
    });

    test('lands the old page’s id on Appearance’s Mode card, and leaves every other id as it was', () {
      final landed = settingsLanding(const SettingsTarget('experience', nonce: 7));
      expect((landed.id, landed.setting, landed.nonce), ('theme', 'Mode', 7));
      // A link that named a card of its own keeps it.
      final named = settingsLanding(const SettingsTarget('experience', setting: 'Page', nonce: 8));
      expect((named.id, named.setting), ('theme', 'Page'));
      const theme = SettingsTarget('theme', setting: 'Accent', nonce: 9);
      expect(identical(settingsLanding(theme), theme), isTrue);
    });
  });

  group('the sheet', () {
    testWidgets('lists the short list in Simple with Appearance under Account’s card, and the rest comes back with Advanced', (tester) async {
      await _open(tester);
      expect(_labels(tester), ['Account', 'Notifications', 'Appearance', 'About']);
      expect(_line(tester, 'Appearance'), 'Simple · Light · Maple Mono');
      expect(find.text('Simple or advanced', skipOffstage: false), findsNothing);
      // Another device, or the walkthrough, choosing Advanced: the list is read from the preferences, live.
      preferences.update((now) => now.choosing('advanced'));
      await tester.pump();
      expect(_labels(tester), ['Account', 'Organizations', 'Workspaces', 'Notifications', 'Appearance', 'Library folder', 'Backup', 'Export', 'Recording', 'AI', 'Market', 'About']);
      expect(_line(tester, 'Appearance'), 'Advanced · Light · Maple Mono');
      await endSettings(tester);
    });

    testWidgets('Appearance’s first card is the two modes with the walkthrough’s words, lit as the app is, and a tap writes the choice the one way', (tester) async {
      // Before any choice: advanced, and Advanced is what is lit.
      await _open(tester, prefs: const Preferences(theme: 'light'), size: const Size(390, 1600), toPage: const SettingsTarget('theme', nonce: 1));
      expect(_display(tester), 'Appearance');
      expect(_titles(tester).take(2), ['Mode', 'Page']);
      final cards = tester.widget<ChoiceCards<String>>(_mode);
      expect(cards.values, ['simple', 'advanced']);
      expect(cards.values.map(cards.nameOf), ['Simple', 'Advanced']);
      expect(cards.value, 'advanced');
      for (final choice in experienceChoices) {
        expect(_card(choice.hint), findsOneWidget, reason: choice.value);
      }
      expect(find.text('Boards, databases, canvases, AI, teams and most settings wait behind Advanced. Nothing is lost: switch back any time.'), findsOneWidget);
      expect(tester.getSemantics(find.bySemanticsLabel('Advanced')), isSemantics(label: 'Advanced', hasCheckedState: true, isChecked: true, isInMutuallyExclusiveGroup: true, hasTapAction: true, isFocusable: true, hasFocusAction: true));
      expect(tester.getSemantics(find.bySemanticsLabel('Simple')), isSemantics(label: 'Simple', hasCheckedState: true, isChecked: false, isInMutuallyExclusiveGroup: true, hasTapAction: true, isFocusable: true, hasFocusAction: true));

      // Simple: chosen, and the notes opened formatted with it, as Preferences.choosing has it everywhere. The page
      // is Simple's under the finger, the mode still first.
      await _tap(tester, _card('Simple'));
      expect((preferences.value.experience, preferences.value.experienceChosen, preferences.value.noteView), ('simple', true, 'formatted'));
      expect(tester.widget<ChoiceCards<String>>(_mode).value, 'simple');
      expect(_titles(tester), ['Mode', 'Page', 'Notes', 'Type']);
      // Back on the list, Settings is already the short list, and Appearance's row says so.
      testBack.goBack();
      await tester.pump();
      await settleSettings(tester);
      expect(_display(tester), isNull);
      expect(_labels(tester), ['Account', 'Notifications', 'Appearance', 'About']);
      expect(_line(tester, 'Appearance'), 'Simple · Light · Maple Mono');

      // And back again, from the same card.
      await _tap(tester, _rowFor('Appearance'));
      await _tap(tester, _card('Advanced'));
      expect((preferences.value.experience, preferences.value.experienceChosen), ('advanced', true));
      expect(_titles(tester).take(3), ['Mode', 'Page', 'Notes']);
      testBack.goBack();
      await tester.pump();
      await settleSettings(tester);
      expect(_labels(tester), hasLength(12));
      await endSettings(tester);
    });

    for (final prefs in [_simple, _advanced]) {
      testWidgets('the old page’s link lands on Appearance at the Mode card, lit as a search’s find is, in ${prefs.experience}', (tester) async {
        await pumpSettings(tester, SettingsSheet(open: true, onClose: () {}, toPage: const SettingsTarget('experience', nonce: 1)), size: const Size(390, 1200), prefs: prefs, settle: false);
        await tester.pump(const Duration(milliseconds: 16));
        expect(_display(tester), 'Appearance');
        expect(_litCard(tester, 'Mode'), isTrue);
        expect(_litCard(tester, 'Page'), isFalse);
        await tester.pump(const Duration(milliseconds: 1700));
        await tester.pump();
        expect(_litCard(tester, 'Mode'), isFalse);
        await endSettings(tester);
      });
    }

    testWidgets('a page’s own word for the old id lands there too', (tester) async {
      await _open(tester, toPage: const SettingsTarget('about', nonce: 1));
      expect(_display(tester), 'About');
      SettingsHost.maybeOf(tester.element(find.byType(PaneSection).first))!.go('experience');
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 16));
      expect(_display(tester), 'Appearance');
      expect(_litCard(tester, 'Mode'), isTrue);
      await tester.pump(const Duration(milliseconds: 1700));
      await endSettings(tester);
    });

    for (final prefs in [_simple, _advanced]) {
      testWidgets('the search finds the Mode card on Appearance by mode, simple and advanced, in ${prefs.experience}', (tester) async {
        await _open(tester, prefs: prefs);
        final field = find.byType(EditableText);
        for (final word in ['mode', 'simple', 'advanced', 'beginner']) {
          await tester.enterText(field, word);
          await tester.pump();
          expect(find.byKey(const ValueKey('hit theme/Mode')), findsOneWidget, reason: word);
        }
        await tester.enterText(field, 'mode');
        await tester.pump();
        await _tap(tester, find.byKey(const ValueKey('hit theme/Mode')));
        expect(_display(tester), 'Appearance');
        expect(_titles(tester).first, 'Mode');
        await endSettings(tester);
      });
    }

    testWidgets('finds nothing of what Simple put away, on the list or inside a page', (tester) async {
      await _open(tester);
      final field = find.byType(EditableText);
      // Not "backup": Account's own Export everything answers to it, in either mode.
      for (final word in ['accent', 'usb', 'smoke', 'plugins', 'workspace', 'examples', 'model']) {
        await tester.enterText(field, word);
        await tester.pump();
        expect(find.text('Nothing in Settings matches “$word”.'), findsOneWidget, reason: word);
      }
      // What stays is found as before: by its name, its words, and a setting inside it.
      for (final (word, hit) in [('mode', 'Mode'), ('theme', 'Appearance'), ('text size', 'Text size'), ('cheat', 'Cheat sheet'), ('sign', 'Account')]) {
        await tester.enterText(field, word);
        await tester.pump();
        expect(_labels(tester), contains(hit), reason: word);
      }
      await endSettings(tester);
    });

    testWidgets('Appearance in Simple is the mode, the theme cards and the text size, and no line to elsewhere', (tester) async {
      await _open(tester, size: const Size(390, 1600), toPage: const SettingsTarget('theme', nonce: 1));
      expect(_titles(tester), ['Mode', 'Page', 'Notes', 'Type']);
      expect([for (final row in tester.widgetList<SettingRow>(find.byType(SettingRow))) row.label], ['Marks', 'Text size']);
      expect(find.byType(AccentSwatch), findsNothing);
      expect(find.text('Accent'), findsNothing);
      expect(find.text('ACCENT'), findsNothing);
      expect(find.text('Home page'), findsNothing);
      expect(find.byKey(const ValueKey('settings-sample')), findsOneWidget);
      // The two that are there still write.
      await _tap(tester, find.text('Largest'));
      expect(preferences.value.textSize, 'largest');
      await _tap(tester, find.descendant(of: find.byWidgetPredicate((w) => w is ChoiceCards<String> && w.label == 'Theme'), matching: find.text('Dark')));
      expect(preferences.value.theme, 'dark');
      // The search's list of the page is the page's.
      expect(appearanceFindable(wide: true, haptics: true, simple: true).map((f) => f.name), ['Mode', 'Page', 'Marks', 'Type', 'Text size']);
      expect(appearanceFindable(wide: true, haptics: true).map((f) => f.name), containsAll(['Accent', 'Sidebar', 'Haptics']));
      // The footnote that led to the mode's page went with the page: the mode is on this one.
      expect(find.byKey(const ValueKey('appearance-more-looks')), findsNothing);
      expect(find.byType(GoWord), findsNothing);
      await endSettings(tester);
    });

    testWidgets('About’s Help in Simple keeps the cheat sheet and leaves out the Specification and the Examples', (tester) async {
      await _open(tester, toPage: const SettingsTarget('about', nonce: 1));
      expect(_display(tester), 'About');
      expect(find.text('Cheat sheet'), findsOneWidget);
      expect(find.text('Specification'), findsNothing);
      expect(find.text('Examples'), findsNothing);
      await _tap(tester, _rowFor('Cheat sheet'));
      expect(_display(tester), 'Cheat sheet');
      await endSettings(tester);
    });
  });
}
