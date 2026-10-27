import { DensitySelector, SegmentedControl, Switch } from '@glacier/react';
import { hapticsAvailable, setHapticsPref, useHapticsPref } from '../core/haptics.ts';
import { facesOf, INTERFACE_FACES, isSidebarStyle, setPreferences, themeChoice, TYPEFACES, usePreferences, type MotionSpeed, type Rounding, type SidebarStyle, type TextSize } from '../core/preferences.ts';
import { useSidebar } from '../core/useWideScreen.ts';
import { shownView, type NoteDisplay } from '../editor/viewMode.ts';
import { CODE_THEMES_DARK, CODE_THEMES_LIGHT, type CodeThemeDark, type CodeThemeLight } from '../editor/codeThemes.ts';
import { AccentSwatch } from './AccentSwatch.tsx';
import { PaneSection, SettingRow } from './kit/settingsKit.tsx';
import { LayoutCards } from './LayoutCards.tsx';
import { ScaleCards } from './ScaleCards.tsx';
import { ThemeCards } from './ThemeCards.tsx';
import { TopBarCards } from './TopBarCards.tsx';
import { TypefaceCards } from './TypefaceCards.tsx';
import { DENSITY_WORDS, optionsOf, ROUNDING_WORDS, SIZE_WORDS, SPEED_WORDS } from './words.ts';

/**
 * Appearance: how the app looks, moves and feels (Matt: "Change theme to be appearance settings and add the density
 * controller, the accent color picker and the rounding control in there as well as the other existing theme
 * options"). The page first, then how the home page is laid out and how the top bar is, each as cards that are the
 * thing drawn small (LayoutCards.tsx, TopBarCards.tsx; docs/DESIGN.md §178), then its one colour, then the type, how
 * much air it gives itself and how round its corners are, then the colours of code, then how it moves and how it
 * answers a touch.
 *
 * Type, Motion and Touch were pages of their own until Matt asked to "clean up / streamline settings a bit"
 * (docs/DESIGN.md §138): Type (the faces and the text size, which sat on another page from the Size that scales
 * everything, and a paragraph telling the two apart), and Feel, which had taken in Animations (§136). Each is a card
 * here now, since this is the one page a person enters to fiddle with looks. The two size dials sit together in the
 * Type card, so their hints say the difference. Link previews went to Account's Privacy card: it reads a title from
 * another site.
 *
 * Spacing is the kit's own density stops, which Glyph always stamped on the root and never offered (Matt: "Bring over
 * preferences from Attack.FM including themes, density options and more, since we use the same UI kit the settings
 * should port straight over"). The sidebar's choice is drawn only on a window wide enough for the sidebar, the one place
 * App.tsx reads it, and Touch only where there is a motor (core/haptics.ts `hapticsAvailable`). The movement is on by
 * default, because it is what the app looks like; a phone set to reduce motion is obeyed whatever is chosen here, and
 * switching one off leaves the thing itself working, only still.
 *
 * What the search finds here is AppearancePane.findable.ts, in this page's order.
 */

const ROUNDINGS = optionsOf(ROUNDING_WORDS);
const TEXT_SIZES = optionsOf(SIZE_WORDS);
const SPEEDS = optionsOf(SPEED_WORDS);

/**
 * How a note shows its marks, the header's view switch with the Margin look between its two (editor/viewMode.ts).
 * Margin is Markdown with `marksInMargin` on, so the header's switch goes between Formatted and whichever of the two
 * marked looks was chosen here.
 */
const NOTE_VIEWS: { value: NoteDisplay; label: string }[] = [
  { value: 'mixed', label: 'Markdown' },
  { value: 'margin', label: 'Margin' },
  { value: 'formatted', label: 'Formatted' },
];

const NOTE_VIEW_HINTS: Record<NoteDisplay, string> = {
  mixed: 'The marks sit in the line beside the words they style.',
  margin: 'A line’s #, - or > hangs in a column to the left, so the words keep one edge. Still editable.',
  formatted: 'Just the formatted words. A line shows its marks while the caret is on it.',
};

function chooseNoteView(value: NoteDisplay) {
  if (value === 'formatted') setPreferences({ noteView: 'formatted' });
  else setPreferences({ noteView: 'mixed', marksInMargin: value === 'margin' });
}

const SIDEBAR_MODES: { value: SidebarStyle; label: string }[] = [
  { value: 'popover', label: 'Popover' },
  { value: 'docked', label: 'Docked' },
];

export function AppearancePane() {
  const prefs = usePreferences();
  const faces = facesOf(prefs);
  const haptics = useHapticsPref();
  const wide = useSidebar();
  return (
    <>
      <PaneSection title="Page" description="Ink on paper, paper on ink, or one of seven tinted themes. System follows the phone.">
        {/* The kit's theme cards (ThemeCards.tsx): each is the page painted small in that theme, System split light and dark. */}
        <div className="setk-row">
          <ThemeCards value={prefs.theme} onValueChange={(value) => setPreferences(themeChoice(value, prefs))} />
        </div>
      </PaneSection>
      <PaneSection title="Notes" description="How a note shows its Markdown marks. The view switch in a note’s header flips between Formatted and the one picked here.">
        <SettingRow
          label="Marks"
          hint={NOTE_VIEW_HINTS[shownView(prefs)]}
          layout="stacked"
          control={
            <SegmentedControl
              aria-label="Marks"
              fullWidth
              size="sm"
              options={NOTE_VIEWS}
              value={shownView(prefs)}
              onValueChange={(value) => chooseNoteView(value as NoteDisplay)}
            />
          }
        />
      </PaneSection>
      {/* The home page's four layouts (home/homeLayout.ts; docs/DESIGN.md §147, §148, §178), each a card that is the page drawn small. */}
      <PaneSection title="Home page" description="How the home page lays out your notebooks and notes. The search and its filters stay on top whichever you pick.">
        <div className="setk-row">
          <LayoutCards value={prefs.homeLayout} onValueChange={(homeLayout) => setPreferences({ homeLayout, homeLayoutChosen: true })} />
        </div>
      </PaneSection>
      {/* The top bar's six ways (shell/topBar.ts, notes/NoteTabs.tsx; §178), each a card that is the bar drawn small. */}
      <PaneSection title="Top bar" description="Where the controls and the open notes' tabs sit. The same on every screen, and on your other devices.">
        <div className="setk-row">
          <TopBarCards value={prefs.topBar} onValueChange={(topBar) => setPreferences({ topBar })} />
        </div>
      </PaneSection>
      <PaneSection title="Accent" description="Colours the few things that mark a choice: a focus ring, a chosen segment. Ink is the app's own.">
        <AccentSwatch accent={prefs.accent} onAccent={(accent) => setPreferences({ accent })} />
      </PaneSection>
      <PaneSection
        title="Type"
        // The size shown rather than described, in the note's own face, so it changes with the choice under it.
        description={
          <span className="settingsScreen__sample" aria-hidden="true">
            Aa
          </span>
        }
      >
        {/* Two faces (Matt: "font pairs ... make both kinds of fonts pickable"): the note's, and the interface's. */}
        <SettingRow
          label="Note font"
          hint="The words of a note and its code. Maple Mono and Fira Code join pairs like -> and != into one sign."
          layout="stacked"
          control={<TypefaceCards label="Note font" kind="note" faces={TYPEFACES} value={faces.note} onValueChange={(noteFace) => setPreferences({ noteFace })} />}
        />
        <SettingRow
          label="Interface font"
          hint="Tabs, lists, Settings and buttons."
          layout="stacked"
          control={<TypefaceCards label="Interface font" kind="interface" faces={INTERFACE_FACES} value={faces.ui} onValueChange={(typeface) => setPreferences({ typeface })} />}
        />
        <SettingRow
          label="Text size"
          hint="The note, the list and the headings."
          layout="stacked"
          control={
            <SegmentedControl
              aria-label="Text size"
              fullWidth
              size="sm"
              options={TEXT_SIZES}
              value={prefs.textSize}
              onValueChange={(value) => setPreferences({ textSize: value as TextSize })}
            />
          }
        />
        {/* A card per step, each the same row of the app drawn at that size (ScaleCards.tsx). */}
        <SettingRow
          label="Scale"
          hint="Everything, buttons and bars as well as words. Stays with this device."
          layout="stacked"
          control={<ScaleCards value={prefs.uiScale} onValueChange={(uiScale) => setPreferences({ uiScale })} />}
        />
      </PaneSection>
      <PaneSection title="Spacing" description="The padding and gaps of everything the app draws. The words keep their own size.">
        {/* The kit's own density picker: a card per step, each showing how tightly it packs, in Glyph's words. */}
        <div className="setk-row">
          <DensitySelector aria-label="Spacing" value={prefs.density} onValueChange={(value) => setPreferences({ density: value })} labels={DENSITY_WORDS} />
        </div>
      </PaneSection>
      <PaneSection title="Corners">
        <SettingRow
          label="Rounding"
          hint="Cards, fields and buttons. Pills stay pills."
          layout="stacked"
          control={
            <SegmentedControl
              aria-label="Rounding"
              fullWidth
              size="sm"
              options={ROUNDINGS}
              value={prefs.rounding}
              onValueChange={(value) => setPreferences({ rounding: value as Rounding })}
            />
          }
        />
      </PaneSection>
      <PaneSection title="Code" description="The colours of code in a code block. Ink keeps code in the page's own ink.">
        <SettingRow
          label="On the light page"
          layout="stacked"
          control={
            <SegmentedControl
              aria-label="Code colours on the light page"
              fullWidth
              size="sm"
              options={CODE_THEMES_LIGHT}
              value={prefs.codeLight}
              onValueChange={(value) => setPreferences({ codeLight: value as CodeThemeLight, codeChosen: true })}
            />
          }
        />
        <SettingRow
          label="On the dark page"
          layout="stacked"
          control={
            <SegmentedControl
              aria-label="Code colours on the dark page"
              fullWidth
              size="sm"
              options={CODE_THEMES_DARK}
              value={prefs.codeDark}
              onValueChange={(value) => setPreferences({ codeDark: value as CodeThemeDark, codeChosen: true })}
            />
          }
        />
      </PaneSection>
      {wide ? (
        <PaneSection title="Sidebar">
          <SettingRow
            label="Sidebar"
            hint="Your notes over the note, or docked as a column beside it."
            layout="stacked"
            control={
              <SegmentedControl
                aria-label="Sidebar"
                fullWidth
                size="sm"
                options={SIDEBAR_MODES}
                value={prefs.sidebarStyle}
                onValueChange={(value) => {
                  if (isSidebarStyle(value)) setPreferences({ sidebarStyle: value });
                }}
              />
            }
          />
        </PaneSection>
      ) : null}
      <PaneSection title="Motion" description="Your phone's own reduce motion setting comes first. With it on, Ghost.md holds still whatever is on here.">
        <SettingRow
          label="Animation speed"
          hint="How quickly letters gather and screens and sheets move."
          layout="stacked"
          control={
            <SegmentedControl
              aria-label="Animation speed"
              fullWidth
              size="sm"
              options={SPEEDS}
              value={prefs.motionSpeed}
              onValueChange={(value) => setPreferences({ motionSpeed: value as MotionSpeed })}
            />
          }
        />
        <SettingRow
          label="Ghostly typing"
          hint="Words you say arrive as smoke, and words you delete leave as smoke. What you type appears at once."
          control={<Switch aria-label="Ghostly typing" checked={prefs.wisp} onCheckedChange={(wisp) => setPreferences({ wisp })} />}
        />
        <SettingRow
          label="Smoke at the edges"
          hint="A page turns to smoke as it passes under the header or the dock."
          control={<Switch aria-label="Smoke at the edges" checked={prefs.wispEdge} onCheckedChange={(wispEdge) => setPreferences({ wispEdge })} />}
        />
        <SettingRow
          label="Ripples while recording"
          hint="The newest words move with your voice as the phone hears it."
          control={<Switch aria-label="Ripples while recording" checked={prefs.ripples} onCheckedChange={(ripples) => setPreferences({ ripples })} />}
        />
      </PaneSection>
      {hapticsAvailable() ? (
        <PaneSection title="Touch">
          <SettingRow label="Haptics" hint="A small tap when a style or a cue kicks in." control={<Switch aria-label="Haptics" checked={haptics} onCheckedChange={setHapticsPref} />} />
        </PaneSection>
      ) : null}
    </>
  );
}
