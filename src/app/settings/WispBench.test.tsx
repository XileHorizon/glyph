import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { WispBench } from './WispBench.tsx';
import { floorVerdict, reportText, wearingOf, type Row } from './wispBenchRun.ts';

/**
 * The smoke bench, as a page: opens over the developer page, offers the three drawings, wears the one chosen, runs
 * the nine cells one surface at a time and puts them in a table. The frame times themselves are the clock's
 * (diag/frameClock.test.ts); jsdom's frames say nothing about any engine's, and nothing here reads them as if
 * they did.
 */

// The Glacier kit reads matchMedia as it loads; jsdom has none. Hoisted, so it is there before the imports run.
vi.hoisted(() => {
  window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
});

// The wisp hook watches the surface's size; jsdom has no observer and no sizes, so it sees a page that never scrolls.
class StillObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= StillObserver as unknown as typeof ResizeObserver;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function show(element: React.ReactElement): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(element));
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  localStorage.clear();
});

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"][aria-label="Smoke bench"]');
const surfaces = () => [...document.querySelectorAll<HTMLElement>('[data-draw]')].map((el) => el.dataset.draw);

/** A button, by its words. */
function pick(label: string): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>('button')].find((el) => el.textContent?.trim() === label);
  if (!found) throw new Error(`no button called ${label}`);
  return found;
}

/** One of the kit's segmented options: a native radio under a label, chosen by its value. */
function choose(value: string): void {
  const radio = document.querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`);
  if (!radio) throw new Error(`no drawing called ${value}`);
  act(() => radio.click());
}

const tiny = { quick: { frames: 2, wallMs: 2000 }, long: { frames: 2, wallMs: 2000 } };

describe('the smoke bench', () => {
  it('opens as a dialog wearing the filter, and closes on Escape', () => {
    const onClose = vi.fn();
    show(<WispBench open onClose={onClose} />);
    expect(dialog()).not.toBeNull();
    expect(surfaces()).toEqual(['filter']);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('is nothing while closed', () => {
    show(<WispBench open={false} onClose={() => {}} />);
    expect(dialog()).toBeNull();
  });

  it('wears the drawing chosen, one surface at a time, and all three side by side for looking', () => {
    show(<WispBench open onClose={() => {}} />);
    choose('mask');
    expect(surfaces()).toEqual(['mask']);
    choose('none');
    expect(surfaces()).toEqual(['none']);
    act(() => pick('Side by side').click());
    expect(surfaces()).toEqual(['filter', 'mask', 'none']);
    act(() => pick('One at a time').click());
    expect(surfaces()).toEqual(['none']);
  });

  it('runs the nine cells one surface at a time and puts them in a table with what each surface wore', async () => {
    show(<WispBench open onClose={() => {}} limits={tiny} settleMs={0} />);
    await act(async () => {
      pick('Run the bench').click();
    });
    // The run mounts one drawing after another; wait for it to say it is done (the table fills a moment before).
    const deadline = Date.now() + 5000;
    while (document.querySelector('[role="status"]') && Date.now() < deadline) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    }
    const cells = [...document.querySelectorAll<HTMLElement>('table tbody tr')].map((tr) => [...tr.querySelectorAll('td')].slice(0, 2).map((td) => td.textContent));
    // The page without smoke goes first: its floor decides whether the rest is worth running.
    expect(cells.slice(0, 3)).toEqual([
      ['No smoke', 'At rest'],
      ['No smoke', 'One repaint a frame'],
      ['No smoke', 'Scrolling'],
    ]);
    // jsdom's frames are whatever the machine gives them; on a quiet one the run goes on to the other six, on a busy
    // one it stops at the floor and says so. Either is the page doing its job.
    if (cells.length === 9) {
      expect(cells.slice(3)).toEqual([
        ['Filter', 'At rest'],
        ['Filter', 'One repaint a frame'],
        ['Filter', 'Scrolling'],
        ['Mask', 'At rest'],
        ['Mask', 'One repaint a frame'],
        ['Mask', 'Scrolling'],
      ]);
    } else {
      expect(cells).toHaveLength(3);
      expect(document.body.textContent).toContain('this machine was busy');
    }
    // Only one surface was ever on the page: the run switches them rather than adding them.
    expect(surfaces()).toHaveLength(1);
    // The run's mark is gone with it.
    expect(document.querySelectorAll('[class*="mark"]')).toHaveLength(0);
    expect(pick('Copy as text')).toBeTruthy();
  });

  it('tells the whole app which to draw, from the hook’s own key, and takes it back', () => {
    show(<WispBench open onClose={() => {}} />);
    choose('mask');
    act(() => pick('Use the mask app-wide').click());
    expect(localStorage.getItem('glyph-wisp-draw')).toBe('mask');
    act(() => pick('Back to the default').click());
    expect(localStorage.getItem('glyph-wisp-draw')).toBeNull();
    // No smoke is not a thing the app can be told to draw.
    choose('none');
    expect(() => pick('Use the none app-wide')).toThrow();
  });
});

describe('floorVerdict', () => {
  const row = (draw: Row['draw'], condition: Row['condition'], median: number): Row => ({ draw, condition, wearing: '', reading: { n: 10, median, p90: median, worst: median } });

  it('says nothing until the page without smoke has been measured', () => {
    expect(floorVerdict([])).toBeNull();
    expect(floorVerdict([row('filter', 'scroll', 3157)])).toBeNull();
  });

  it('throws the table away when the bare page cannot hold a frame, and licenses it when it can', () => {
    // The lane session's own table: a 17ms floor is what made the 585 beside it worth reading.
    expect(floorVerdict([row('none', 'idle', 16.7), row('none', 'scroll', 17.2)])?.ok).toBe(true);
    // The browser pane's throttle, or a machine at load 120: every number on the page is the machine's.
    const busy = floorVerdict([row('none', 'idle', 1016.7), row('none', 'scroll', 83.3)]);
    expect(busy?.ok).toBe(false);
    expect(busy?.words).toContain('this machine was busy');
    // The repaint cell is the page's own doing and is not the floor.
    expect(floorVerdict([row('none', 'idle', 16.7), row('none', 'repaint', 40)])?.ok).toBe(true);
  });
});

describe('wearingOf', () => {
  it('reads what the element wears rather than what was asked for', () => {
    const el = document.createElement('div');
    expect(wearingOf(el)).toBe('nothing');
    el.setAttribute('data-wisp-edge', '');
    el.setAttribute('data-wisp-foot', '');
    el.dataset.wispDraw = 'mask';
    expect(wearingOf(el)).toBe('mask: top + foot');
  });
});

describe('reportText', () => {
  it('is one line a cell, tab-separated, under where it ran', () => {
    const text = reportText('Ghost.md 1.5.0 · browser · Chromium · 1024x768 @2', [
      { draw: 'filter', condition: 'scroll', wearing: 'filter: top + foot', reading: { n: 3, median: 3157, p90: 6507, worst: 6507.4 } },
    ]);
    expect(text.split('\n')).toEqual([
      'Ghost.md 1.5.0 · browser · Chromium · 1024x768 @2',
      'draw\tcondition\twearing\tn\tmedian\tp90\tworst',
      'filter\tscroll\tfilter: top + foot\t3\t3157.0\t6507.0\t6507.4',
    ]);
  });

  it('carries the floor’s verdict under where it ran, so a pasted table cannot lose it', () => {
    const text = reportText('where', [{ draw: 'none', condition: 'idle', wearing: 'nothing', reading: { n: 7, median: 1016.7, p90: 1016.7, worst: 1016.7 } }]);
    expect(text.split('\n')[1]).toContain('this machine was busy');
  });
});
