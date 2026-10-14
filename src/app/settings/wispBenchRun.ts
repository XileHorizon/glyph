import type { WispDraw } from '../art/wispMask.ts';
import { isTauri } from '../core/tauri.ts';
import { engineName, ms, type CellLimits, type Reading } from '../diag/frameClock.ts';

/**
 * The smoke bench's plain parts (WispBench.tsx): what it can draw, how it drives a surface, and how it says what it
 * found. Apart from the page so the page is only a component (the plugins page keeps its reach line the same way).
 */

export type Draw = WispDraw | 'none';

export const DRAWS: { value: Draw; label: string }[] = [
  { value: 'filter', label: 'Filter' },
  { value: 'mask', label: 'Mask' },
  { value: 'none', label: 'No smoke' },
];

export type Condition = 'idle' | 'repaint' | 'scroll';

export const CONDITIONS: { value: Condition; label: string }[] = [
  { value: 'idle', label: 'At rest' },
  { value: 'repaint', label: 'One repaint a frame' },
  { value: 'scroll', label: 'Scrolling' },
];

/** The default run: enough frames for a median at 60Hz, and a wall that ends a cell whose frames are seconds. */
export const QUICK_LIMITS: CellLimits = { frames: 180, wallMs: 8000 };
/** A long run, for cells whose frames are seconds, so they get more than a couple. */
export const LONG_LIMITS: CellLimits = { frames: 180, wallMs: 30_000 };

/**
 * The floor: what a frame of the page WITHOUT smoke may take before the whole table is thrown away. A display draws
 * at 60Hz (16.7ms) or 120Hz (8.3ms); a page with nothing on it that cannot hold a frame under this is on a machine
 * that is busy, and nothing measured beside it is a measurement of the smoke. The lane session's rule, from its own
 * table: the clean "no filter" floor of 17ms is what licensed the 585 next to it. So the run does the no-smoke
 * cells first, and stops there rather than spend eight cells on numbers that would sit next to real ones.
 */
export const FLOOR_MS = 25;

/** Whether the table can be read at all, from its no-smoke rows; and the words for it either way. */
export function floorVerdict(rows: readonly Row[]): { ok: boolean; words: string } | null {
  const bare = rows.filter((row) => row.draw === 'none' && row.condition !== 'repaint');
  if (bare.length === 0) return null;
  const worst = Math.max(...bare.map((row) => row.reading.median));
  if (worst > FLOOR_MS) {
    return {
      ok: false,
      words: `The page without smoke could not hold a frame (median ${ms(worst)}ms): this machine was busy, and nothing here is a measurement of the smoke. Run it again when the machine is quiet.`,
    };
  }
  return { ok: true, words: `The page without smoke held its frames (median ${ms(worst)}ms), so the rest can be read against it.` };
}

/** Where the surface sits while it is measured: off its top, so both bands are on. */
export const SCROLLED_TO = 400;

export interface Row {
  draw: Draw;
  condition: Condition;
  /** What the surface was wearing when the cell ran, read from the element, not assumed from the choice. */
  wearing: string;
  reading: Reading;
}

/** What is being measured on, for the top of the table. */
export function whereItRuns(): string {
  const app = isTauri() ? 'Ghost.md app' : 'browser';
  const engine = engineName(navigator.userAgent);
  const size = `${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio}`;
  return `Ghost.md ${__GLYPH_VERSION__} · ${app} · ${engine} · ${size}`;
}

/** What the element is wearing right now, in the words the CSS uses. */
export function wearingOf(el: HTMLElement): string {
  const ends = [el.hasAttribute('data-wisp-edge') ? 'top' : null, el.hasAttribute('data-wisp-foot') ? 'foot' : null].filter(Boolean);
  if (ends.length === 0) return 'nothing';
  const filter = getComputedStyle(el).filter;
  const drawn = el.dataset.wispDraw ?? (filter && filter !== 'none' ? 'filter' : 'mask');
  return `${drawn}: ${ends.join(' + ')}${filter && filter !== 'none' ? ` (${filter})` : ''}`;
}

/** The table as text, for pasting to whoever is not looking at the screen. */
export function reportText(where: string, rows: readonly Row[]): string {
  const head = ['draw', 'condition', 'wearing', 'n', 'median', 'p90', 'worst'].join('\t');
  const lines = rows.map((row) =>
    [row.draw, row.condition, row.wearing, String(row.reading.n), ms(row.reading.median), ms(row.reading.p90), ms(row.reading.worst)].join('\t'),
  );
  const verdict = floorVerdict(rows);
  return [where, ...(verdict ? [verdict.words] : []), head, ...lines].join('\n');
}

