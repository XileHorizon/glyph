import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { show } from '../../test/render.tsx';

// The kit asks the window's resolution as it loads, before any of the imports below reach it.
await vi.hoisted(async () => (await import('../../test/stubs.ts')).stubMatchMedia());

// On a phone, where there is a motor, or in a browser or on the Mac, where there is none.
let phone = true;
vi.mock('../core/platform.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../core/platform.ts')>()),
  get isNativeMobile() {
    return phone;
  },
}));
// A window wide enough for the sidebar, or a phone's.
let wide = false;
vi.mock('../core/useWideScreen.ts', () => ({ useSidebar: () => wide }));

const { AppearancePane } = await import('./AppearancePane.tsx');
const { preferences, setPreferences, DEFAULT_PREFERENCES } = await import('../core/preferences.ts');
const { hapticsPref } = await import('../core/haptics.ts');

/**
 * Appearance's page (docs/DESIGN.md §138): how it looks, moves and feels, with Type, Motion (Feel's Speed and
 * Movement, which were Animations) and Touch as cards where they were pages, each switch writing what the app reads.
 */

beforeEach(() => {
  phone = true;
  wide = false;
  localStorage.clear();
  setPreferences(DEFAULT_PREFERENCES);
});

const titles = (host: HTMLElement) => [...host.querySelectorAll('.setk__title')].map((title) => title.textContent);
const labels = (host: HTMLElement, card: string) =>
  [...[...host.querySelectorAll('section')].find((s) => s.querySelector('.setk__title')?.textContent === card)!.querySelectorAll('.setk-row__label')].map((l) => l.textContent);

describe('the Appearance page', () => {
  it('holds the look, the type, the motion and, on a phone, the touch, in that order', () => {
    expect(titles(show(<AppearancePane />))).toEqual(['Page', 'Notes', 'Home page', 'Top bar', 'Accent', 'Type', 'Spacing', 'Corners', 'Code', 'Motion', 'Touch']);
  });

  it('keeps the two size dials together in Type, beside the two faces', () => {
    const host = show(<AppearancePane />);
    expect(labels(host, 'Type')).toEqual(['Note font', 'Interface font', 'Text size', 'Scale']);
    expect(labels(host, 'Motion')).toEqual(['Animation speed', 'Ghostly typing', 'Smoke at the edges', 'Ripples while recording']);
    // The sample in the card's head, where the paragraph that told the two sizes apart was.
    expect(host.querySelector('section .setk__desc .settingsScreen__sample')?.textContent).toBe('Aa');
    expect(host.textContent).not.toContain('Text size, under Type');
  });

  it('has no Touch where there is no motor, and no Sidebar on a phone, where it changes nothing', () => {
    phone = false;
    const host = show(<AppearancePane />);
    expect(titles(host)).toEqual(['Page', 'Notes', 'Home page', 'Top bar', 'Accent', 'Type', 'Spacing', 'Corners', 'Code', 'Motion']);
    expect(host.querySelector('[aria-label="Haptics"]')).toBeNull();
    expect(host.querySelector('[aria-label="Sidebar"]')).toBeNull();
  });

  it('sets how a note shows its marks: Markdown, Margin or Formatted, Margin being Markdown with the marks hung in a column', () => {
    const host = show(<AppearancePane />);
    const options = () => [...host.querySelectorAll<HTMLInputElement>('[aria-label="Marks"] input[type="radio"]')];
    expect(options().map((o) => o.closest('label')?.textContent)).toEqual(['Markdown', 'Margin', 'Formatted']);
    act(() => options()[1]!.click());
    expect(preferences()).toMatchObject({ noteView: 'mixed', marksInMargin: true });
    act(() => options()[2]!.click());
    // Formatted keeps the margin choice, so the header's switch comes back to it.
    expect(preferences()).toMatchObject({ noteView: 'formatted', marksInMargin: true });
    act(() => options()[0]!.click());
    expect(preferences()).toMatchObject({ noteView: 'mixed', marksInMargin: false });
  });

  // Each choice a card that is the thing drawn small (LayoutCards.tsx, TopBarCards.tsx; docs/DESIGN.md §178).
  const cards = (host: HTMLElement, group: string) => [...host.querySelectorAll<HTMLInputElement>(`[role="radiogroup"][aria-label="${group}"] input[type="radio"]`)];
  const chosen = (host: HTMLElement, group: string) => cards(host, group).filter((r) => r.checked).map((r) => r.getAttribute('aria-label'));

  it('offers the home page’s four layouts as cards, Spotlight chosen at first, and writes the one picked as picked (docs/DESIGN.md §178)', () => {
    const host = show(<AppearancePane />);
    expect(cards(host, 'Home page layout').map((r) => r.getAttribute('aria-label'))).toEqual(['Spotlight', 'Cards', 'Timeline', 'List']);
    expect(chosen(host, 'Home page layout')).toEqual(['Spotlight']);
    expect(preferences().homeLayoutChosen).toBe(false);
    act(() => cards(host, 'Home page layout')[1]!.click());
    expect(preferences()).toMatchObject({ homeLayout: 'cards', homeLayoutChosen: true });
    expect(chosen(host, 'Home page layout')).toEqual(['Cards']);
    expect(host.querySelector('[role="radiogroup"][aria-label="Home page layout"] [data-selected]')?.textContent).toContain('Cards');
  });

  it('offers the top bar’s four ways as cards, Classic chosen at first, and writes the one picked', () => {
    const host = show(<AppearancePane />);
    expect(cards(host, 'Top bar').map((r) => r.getAttribute('aria-label'))).toEqual(['Classic', 'Ledger', 'Masthead', 'Islands']);
    expect(chosen(host, 'Top bar')).toEqual(['Classic']);
    act(() => cards(host, 'Top bar')[3]!.click());
    expect(preferences().topBar).toBe('islands');
    expect(chosen(host, 'Top bar')).toEqual(['Islands']);
    expect(document.documentElement.dataset.topbar).toBe('islands');
    act(() => cards(host, 'Top bar')[0]!.click());
    expect(document.documentElement.dataset.topbar).toBeUndefined();
  });

  it('offers the sidebar’s choice on a window wide enough for the sidebar, and writes it', () => {
    wide = true;
    const host = show(<AppearancePane />);
    expect(titles(host)).toContain('Sidebar');
    act(() => host.querySelector<HTMLInputElement>('input[type="radio"][value="docked"]')!.click());
    expect(preferences().sidebarStyle).toBe('docked');
  });

  it('writes each switch to what the app reads', () => {
    const host = show(<AppearancePane />);
    const wisp = preferences().wisp;
    act(() => host.querySelector<HTMLElement>('[aria-label="Ghostly typing"]')!.click());
    expect(preferences().wisp).toBe(!wisp);
    const haptics = hapticsPref();
    act(() => host.querySelector<HTMLElement>('[aria-label="Haptics"]')!.click());
    expect(hapticsPref()).toBe(!haptics);
  });

  it('writes the text size and the scale, each its own preference', () => {
    const host = show(<AppearancePane />);
    act(() => host.querySelector<HTMLInputElement>('input[type="radio"][value="largest"]')!.click());
    expect(preferences().textSize).toBe('largest');
    act(() => host.querySelector<HTMLInputElement>('input[name="ui-scale"][value="1.1"]')!.click());
    expect(preferences().uiScale).toBe(1.1);
    expect(preferences().textSize).toBe('largest');
  });

  it('has no Link previews: that is Account’s Privacy card now', () => {
    expect(show(<AppearancePane />).querySelector('[aria-label="Link previews"]')).toBeNull();
  });
});
