import { useEffect, useState } from 'react';
import { BookOpen, CircleUser, FlaskConical, Info, Mic, Puzzle, Sparkles, SunMoon, Terminal, Type, Vibrate, Waves } from '@glacier/icons';
import { useAccount } from '../core/account/account.ts';
import { syncSummary, useSyncStatus } from '../core/sync/engine.ts';
import { AccountPane } from './AccountPane.tsx';
import { gb, modelName, MODELS, useModels } from '../core/ai.ts';
import { hapticsAvailable, useHapticsPref } from '../core/haptics.ts';
import { isAndroid } from '../core/platform.ts';
import type { Updates } from '../core/ota.ts';
import { usePreferences } from '../core/preferences.ts';
import { isTauri } from '../core/tauri.ts';
import { useDeveloperMode } from './developerMode.ts';
import { CheatSheet } from '../guide/CheatSheet.tsx';
import { FormattingPane } from './FormattingPane.tsx';
import { PluginsPane } from '../plugins/PluginsPane.tsx';
import { usePlugins } from '../plugins/registry.ts';
import { AboutPane, AnimationsPane, DeveloperPane, FeelPane, RecordingPane, AppearancePane, TypePane } from './panes.tsx';
import { SettingsScreen, type SettingsSection } from './SettingsScreen.tsx';
import { TestResultsPane } from './TestResultsPane.tsx';
import { reportSummary } from '../diag/testReport.ts';

/**
 * Settings: the sections and their live one-line readings, handed to the
 * screen that lists them (SettingsScreen). The readings come from the same
 * stores the panes edit, so a row can never disagree with its pane.
 *
 * Five clusters: how it looks (Type, Theme), how it works (Recording,
 * Formatting, Feel), the plugins (each switched-on plugin's own page, then
 * Plugins to switch them), the app itself (Updates, About), and the hidden
 * page (Developer). Recording only where there is a side key, Feel only where
 * there is a motor, Developer only once unlocked.
 */

interface SettingsSheetProps {
  open: boolean;
  onClose: () => void;
  updates: Updates;
  /** Open the walkthrough, on its first page or a given one (Guide's page indexes). */
  onGuide: (page?: number) => void;
  /** Make the sample note, the one with every mark in it (core/seed.ts), and open it. */
  onSample: () => void;
  /** Adds the example board (core/boardNote.ts). */
  onBoard: () => void;
  /** Adds the example canvas (canvas/sampleCanvas.ts). */
  onCanvas: () => void;
  /** Adds the canvas that says how Glyph works (canvas/howCanvas.ts). */
  onHowCanvas: () => void;
  /** Opens Glyph Academy (academy/AcademyScreen.tsx). */
  onAcademy: () => void;
  /**
   * Asked from outside to open at the cheat sheet - the Academy's summary sends people there for the marks it has
   * not taught yet. The moment it was asked for, so asking twice opens it twice; 0 for not asked.
   */
  toCheatSheet?: number;
}

const SIZE_WORDS: Record<string, string> = { large: 'Large', larger: 'Larger', largest: 'Largest' };
const FACE_WORDS: Record<string, string> = { inter: 'Inter', noto: 'Noto', plex: 'Plex' };
// Only said in the row's reading when it is not the one the app is drawn at.
const DENSITY_WORDS: Record<string, string> = {
  'extra-compact': 'Tightest',
  compact: 'Tight',
  comfortable: 'Comfortable',
  spacious: 'Roomy',
  'more-space': 'Roomiest',
};
const THEME_WORDS: Record<string, string> = { system: 'System', light: 'Light', dark: 'Dark' };
const ACCENT_WORDS: Record<string, string> = { graphite: 'Graphite', red: 'Red', amber: 'Amber', green: 'Green', teal: 'Teal', purple: 'Purple' };
const ROUNDING_WORDS: Record<string, string> = { square: 'Square', soft: 'Soft', round: 'Round', rounder: 'Roundest' };

export function SettingsSheet({ open, onClose, updates, onGuide, onSample, onBoard, onCanvas, onHowCanvas, onAcademy, toCheatSheet = 0 }: SettingsSheetProps) {
  const prefs = usePreferences();
  const account = useAccount();
  const syncStatus = useSyncStatus();
  const haptics = useHapticsPref();
  const devMode = useDeveloperMode();
  const { all: allPlugins, enabled: plugins } = usePlugins();
  const { models } = useModels();
  const [goTo, setGoTo] = useState<{ id: string; nonce: number } | null>(null);
  // Opened from the Academy: the sheet comes up on the cheat sheet itself rather than on the list of sections.
  useEffect(() => {
    if (toCheatSheet) setGoTo({ id: 'cheatsheet', nonce: toCheatSheet });
  }, [toCheatSheet]);

  const chosenModel = MODELS.find((m) => m.id === prefs.formatModel);
  const modelHere = models.find((m) => m.id === prefs.formatModel)?.present ?? false;
  const formattingSummary = !isTauri()
    ? 'Runs on the phone'
    : `${modelName(prefs.formatModel)} · ${modelHere ? 'on the phone' : `${gb(chosenModel?.bytes ?? 0)} to get`}`;

  let updatesSummary: string;
  if (!isTauri()) updatesSummary = 'Web version';
  else if (updates.checking) updatesSummary = 'Checking';
  else if (updates.apk.kind === 'available') updatesSummary = `${updates.apk.info.version} ready to install`;
  else if (updates.ready) updatesSummary = 'New version downloaded';
  else if (updates.lastError) updatesSummary = "Couldn't check";
  else updatesSummary = updates.lastChecked ? 'Up to date' : 'Not checked yet';

  const sections: SettingsSection[] = [
    // Who you are, first and on its own card (Matt: "move account to top of settings section"): it is what a person
    // opens Settings for on a new phone, and everything below it is how the app behaves once they are in.
    {
      id: 'account',
      label: 'Account',
      icon: <CircleUser size={16} />,
      content: <AccountPane />,
      summary: syncSummary(account.session?.handle ?? null, syncStatus),
      group: 5,
    },
    {
      id: 'type',
      label: 'Type',
      icon: <Type size={16} />,
      content: <TypePane />,
      // Spacing moved to Appearance, where the rest of how the app is drawn lives.
      summary: `${SIZE_WORDS[prefs.textSize] ?? prefs.textSize} · ${FACE_WORDS[prefs.typeface] ?? prefs.typeface}`,
      group: 0,
    },
    {
      id: 'theme',
      label: 'Appearance',
      icon: <SunMoon size={16} />,
      content: <AppearancePane />,
      // The page, then anything else that has been moved off its default: the colour, the air, the corners.
      summary: [
        THEME_WORDS[prefs.theme] ?? prefs.theme,
        prefs.accent === 'ink' ? null : ACCENT_WORDS[prefs.accent] ?? prefs.accent,
        prefs.density === 'comfortable' ? null : DENSITY_WORDS[prefs.density] ?? prefs.density,
        prefs.rounding === 'round' ? null : ROUNDING_WORDS[prefs.rounding] ?? prefs.rounding,
      ]
        .filter(Boolean)
        .join(' · '),
      group: 0,
    },
    ...(isAndroid
      ? [
          {
            id: 'recording',
            label: 'Recording',
            icon: <Mic size={16} />,
            content: <RecordingPane />,
            summary: prefs.refine ? 'A note a take · better words' : 'A note a take',
            group: 1,
          },
        ]
      : []),
    {
      id: 'formatting',
      label: 'Formatting',
      icon: <Sparkles size={16} />,
      content: <FormattingPane />,
      summary: formattingSummary,
      group: 1,
    },
    ...(hapticsAvailable()
      ? [
          {
            id: 'feel',
            label: 'Feel',
            icon: <Vibrate size={16} />,
            content: <FeelPane />,
            summary: haptics ? 'Haptics on' : 'Haptics off',
            group: 1,
          },
        ]
      : []),
    ...plugins.flatMap((plugin) => {
      const settings = plugin.settings;
      if (!settings) return [];
      const Icon = plugin.icon;
      return [
        {
          id: `plugin:${plugin.manifest.id}`,
          label: plugin.manifest.name,
          icon: <Icon size={16} />,
          content: <settings.Pane />,
          summary: settings.summary(),
          group: 2,
        },
      ];
    }),
    {
      id: 'plugins',
      label: 'Plugins',
      icon: <Puzzle size={16} />,
      // A card's row lands on that plugin's own page (plugins/PluginsPane.tsx).
      content: <PluginsPane onOpen={(id) => setGoTo({ id, nonce: Date.now() })} />,
      summary: `${plugins.length} of ${allPlugins.length} on`,
      group: 2,
    },
    {
      id: 'animations',
      label: 'Animations',
      icon: <Waves size={16} />,
      content: <AnimationsPane />,
      summary:
        [prefs.wisp ? 'Ghostly typing' : null, prefs.wispEdge ? 'smoke' : null, prefs.ripples ? 'ripples' : null, prefs.motionSpeed !== 'normal' ? prefs.motionSpeed : null]
          .filter(Boolean)
          .join(' · ') || 'All still',
      group: 1,
    },
    {
      id: 'cheatsheet',
      label: 'Cheat sheet',
      icon: <BookOpen size={16} />,
      content: <CheatSheet />,
      summary: 'Every mark and every cue',
      group: 3,
    },
    {
      id: 'about',
      label: 'About',
      icon: <Info size={16} />,
      content: (
        <AboutPane
          updates={updates}
          onGuide={onGuide}
          onSample={onSample}
          onBoard={onBoard}
          onCanvas={onCanvas}
          onHowCanvas={onHowCanvas}
          onAcademy={onAcademy}
          onCheatSheet={() => setGoTo({ id: 'cheatsheet', nonce: Date.now() })}
          onDeveloper={() => setGoTo({ id: 'developer', nonce: Date.now() })}
        />
      ),
      // The version and where it stands, now that updates live on this page too.
      summary: `${updates.version} · ${updatesSummary}`,
      group: 3,
    },
    ...(devMode
      ? [
          {
            id: 'developer',
            label: 'Developer',
            icon: <Terminal size={16} />,
            content: <DeveloperPane onGuide={onGuide} />,
            summary: 'Set-up, reset',
            group: 4,
          },
          {
            id: 'test-results',
            label: 'Test results',
            icon: <FlaskConical size={16} />,
            content: <TestResultsPane />,
            summary: reportSummary(),
            group: 4,
          },
        ]
      : []),
  ];

  return <SettingsScreen open={open} onClose={onClose} sections={sections} goTo={goTo} />;
}
