import type { SettingsFindable } from './settingsSearch.ts';

/**
 * What Settings' search finds on Appearance (settings/AppearancePane.tsx), by the names the page draws, in its order.
 * Type, Motion and Touch were pages of their own (Type, and Feel, which had taken in Animations) until docs/DESIGN.md
 * §138: each page's words are its card's now, so looking for "type" or "animations" still lands.
 *
 * Two rows are drawn only where they do something, and listed only there: the sidebar's choice on a window wide
 * enough for the sidebar (App.tsx reads it only then), and the haptics where there is a motor.
 */
export function findable({ wide, haptics }: { wide: boolean; haptics: boolean }): SettingsFindable[] {
  return [
    { name: 'Page', words: 'theme light dark system dawn boreal ember sakura meadow tide dusk' },
    { name: 'Notes', words: 'markdown marks margin gutter formatted view symbols simple editor' },
    { name: 'Marks', words: 'markdown margin gutter formatted view symbols hash heading list align' },
    { name: 'Home page', words: 'dashboard layout home cards list timeline spotlight grid' },
    { name: 'Top bar', words: 'header toolbar tabs bar ledger strip masthead islands thumb classic capsules' },
    { name: 'Accent', words: 'colour color highlight' },
    { name: 'Type', words: 'text font' },
    { name: 'Note font', words: 'font typeface body note editor maple fira mono monospace code coding ligatures inter noto plex' },
    { name: 'Interface font', words: 'font typeface ui app tabs menus inter noto plex' },
    { name: 'Text size', words: 'font bigger smaller larger' },
    { name: 'Scale', words: 'size zoom interface ui bigger smaller' },
    { name: 'Spacing', words: 'density compact padding roomy tight' },
    { name: 'Corners', words: 'rounding radius round square' },
    { name: 'Code', words: 'syntax highlighting colours colors' },
    ...(wide ? [{ name: 'Sidebar', words: 'dock column popover notes list' }] : []),
    { name: 'Motion', words: 'movement animations' },
    { name: 'Animation speed', words: 'motion fast slow' },
    { name: 'Ghostly typing', words: 'wisp letters' },
    { name: 'Smoke at the edges', words: 'wisp fade scroll' },
    { name: 'Ripples while recording', words: 'waves voice' },
    ...(haptics ? [{ name: 'Haptics', words: 'vibrate vibration buzz touch' }] : []),
  ];
}
