import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, X } from '@glacier/icons';
import { SegmentedControl } from '@glacier/react';
import { useWispEdge } from '../art/wispEdge.ts';
import { WISP_DRAW_KEY, type WispDraw } from '../art/wispMask.ts';
import { useBack } from '../core/back.ts';
import { usePreferences } from '../core/preferences.ts';
import { isTauri } from '../core/tauri.ts';
import { FrameRing, ms, runCell, type CellLimits } from '../diag/frameClock.ts';
import { RowAction, SettingsCallout } from './kit/settingsKit.tsx';
import { CONDITIONS, DRAWS, floorVerdict, LONG_LIMITS, QUICK_LIMITS, reportText, SCROLLED_TO, wearingOf, whereItRuns, type Condition, type Draw, type Row } from './wispBenchRun.ts';
import styles from './WispBench.module.css';

/**
 * Settings › Developer › Smoke bench: the wisp edge drawn three ways on the same page, with its cost on the screen.
 *
 * Matt, of the Mac app: "the desktop app is incredibly laggy", and once the smoke was found to be the cost, "can we
 * fix the wisp animation to be more performant?". The filter (art/wispEdge.ts) is free at rest and hundreds of
 * milliseconds a repaint in WKWebView; the mask (art/wispMask.ts) is the same smoke drawn a way that engine can
 * cache. Which is cheaper, and by how much, was measured in a hand-built rig and relayed through three sessions.
 * This is the comparison made visible: a page that scrolls, wearing the filter, the mask, or nothing, with a
 * frame counter in its header while a hand scrolls it, and a run that drives it the three ways the rig did - at
 * rest, one repaint a frame, scrolling - and puts the numbers in a table anyone can read off the screen and copy.
 *
 * One surface at a time while measuring: a frame's length is the page's, so three surfaces at once would add up.
 * Side by side is for looking, and says so. The choice of drawing is the hook's own switch (`draw`), so each
 * surface wears exactly what the app's pages would wear with that switch, and nothing here draws smoke of its own.
 */

/** Waits for the page to settle: the hook flips on a scroll event, and its drift stops a moment after scrolling. */
function settle(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())), ms);
  });
}

const nothing = (): void => undefined;

/** A cell's driver: what to do to the surface each frame, and how to leave it. */
function driverFor(condition: Condition, el: HTMLElement): { drive: (frame: number) => void; done: () => void } {
  if (condition === 'idle') return { drive: nothing, done: nothing };
  if (condition === 'repaint') {
    // A mark in the page, toggled each frame: the smallest repaint the page can have.
    const mark = document.createElement('span');
    mark.className = styles.mark ?? '';
    mark.style.insetBlockStart = `${el.scrollTop + 120}px`;
    el.appendChild(mark);
    return {
      drive: (frame) => {
        mark.style.opacity = frame % 2 ? '1' : '0.5';
      },
      done: () => mark.remove(),
    };
  }
  // Scrolling: three pixels a frame, back and forth, never back to the top, so the header band stays on.
  const floor = 200;
  let direction = 1;
  return {
    drive: () => {
      const ceiling = el.scrollHeight - el.clientHeight - 3;
      if (el.scrollTop >= ceiling) direction = -1;
      else if (el.scrollTop <= floor) direction = 1;
      el.scrollTop += 3 * direction;
    },
    done: nothing,
  };
}

const PARAGRAPHS = [
  'This page exists to be scrolled. Every word on it is here so the surface has the height of a real note and the texture of one: headings, paragraphs of different lengths, the shapes the smoke has to bend or tear.',
  'What is being measured is not the words but the frame. Each time the page repaints, the engine draws it again, and a filter on the page means the whole of it goes through the filter’s graph on every one of those repaints, however small the change that caused it.',
  'A mask is a different bargain. The band’s shape is made once, as a picture, and the engine keeps that picture; scrolling under it moves the words, not the picture, so the frame costs what a frame of plain scrolling costs.',
  'The counter in the header is the last hundred and twenty frames, read as a median, a ninetieth percentile and a worst. Scroll by hand and watch it. A median that is fine and a p90 that is not is what lag feels like.',
  'The run below drives the surface the three ways the first rig did: left alone, a repaint each frame, and a scroll each frame. One drawing at a time, since a frame is the page’s and three surfaces would add up.',
  'Nothing here is a model of the app. The surface wears the hook the app’s pages wear, with the same switch, so what it costs here is what a note costs there.',
];

/** Enough of the same words to scroll a long way. */
const SECTIONS = 8;

function Prose() {
  return (
    <article className={styles.prose}>
      {Array.from({ length: SECTIONS }, (_, section) => (
        <div key={section}>
          <h3>{section === 0 ? 'A page to scroll' : `Section ${section + 1}`}</h3>
          {PARAGRAPHS.map((words, index) => (
            <p key={index}>{words}</p>
          ))}
        </div>
      ))}
    </article>
  );
}

/** A surface that wears one drawing of the smoke, and a counter of its frames in its header. */
function Surface({ draw, scroller, counting }: { draw: Draw; scroller: RefObject<HTMLDivElement | null>; counting: boolean }) {
  const header = useRef<HTMLDivElement>(null);
  const counter = useRef<HTMLSpanElement>(null);
  // A ref that is never attached: the hook sees no element and wears nothing.
  const nothing = useRef<HTMLDivElement>(null);
  useWispEdge(draw === 'none' ? nothing : scroller, draw, header, draw === 'none' ? { foot: true } : { foot: true, draw });

  // The live counter: every frame marked, the header's text written twice a second (a write in the header, over the
  // page, is not a repaint of the page). Not while a run is on, whose own clock is the one that counts then.
  useEffect(() => {
    if (!counting) return undefined;
    const ring = new FrameRing(120);
    let frame = 0;
    let wrote = 0;
    const tick = (now: number) => {
      ring.mark(now);
      if (now - wrote > 500 && counter.current) {
        wrote = now;
        const read = ring.read();
        counter.current.textContent = read.n ? `${ms(read.median)} · p90 ${ms(read.p90)} · worst ${ms(read.worst)}` : '…';
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [counting, draw]);

  const label = DRAWS.find((option) => option.value === draw)?.label ?? draw;
  return (
    <div className={styles.surface} data-draw={draw}>
      <div ref={header} className={styles.head}>
        <span>{label}</span>
        <span ref={counter} className={styles.counter} aria-label={`${label} frame times`}>
          …
        </span>
      </div>
      <div ref={scroller} className={styles.page} tabIndex={0} aria-label={`${label} page`}>
        <Prose />
      </div>
    </div>
  );
}

interface WispBenchProps {
  open: boolean;
  onClose: () => void;
  /** The run's limits; the tests shorten them. */
  limits?: { quick: CellLimits; long: CellLimits };
  /** How long to wait for a surface to settle before a cell; the tests don't wait. */
  settleMs?: number;
}

export function WispBench({ open, onClose, limits = { quick: QUICK_LIMITS, long: LONG_LIMITS }, settleMs = 600 }: WispBenchProps) {
  const [draw, setDraw] = useState<Draw>('filter');
  const [beside, setBeside] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [where, setWhere] = useState('');
  const [copied, setCopied] = useState(false);
  const smokeOn = usePreferences().wispEdge;
  const card = useRef<HTMLDivElement>(null);
  const scrollers: Record<Draw, RefObject<HTMLDivElement | null>> = {
    filter: useRef<HTMLDivElement>(null),
    mask: useRef<HTMLDivElement>(null),
    none: useRef<HTMLDivElement>(null),
  };
  /** What the whole app is told to draw from its next start, if anything (art/wispMask.ts). */
  const [appWide, setAppWide] = useState<WispDraw | null>(() => {
    try {
      const asked = localStorage.getItem(WISP_DRAW_KEY);
      return asked === 'filter' || asked === 'mask' ? asked : null;
    } catch {
      return null;
    }
  });
  const tellApp = (which: WispDraw | null) => {
    try {
      if (which) localStorage.setItem(WISP_DRAW_KEY, which);
      else localStorage.removeItem(WISP_DRAW_KEY);
    } catch {
      // Nowhere to keep it: the app keeps its default.
    }
    setAppWide(which);
  };

  useBack(open, onClose);
  useEffect(() => {
    if (!open) return undefined;
    card.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open, onClose]);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  /**
   * Every drawing, every condition, one surface at a time, and the numbers as they come. The page without smoke
   * goes first: if it cannot hold its frames the machine is busy, and the run stops there and says so rather than
   * fill the table with numbers that are not about the smoke (wispBenchRun.ts `floorVerdict`).
   */
  const run = async (long: boolean) => {
    const cell = long ? limits.long : limits.quick;
    const done: Row[] = [];
    setRows([]);
    setWhere(whereItRuns());
    setBeside(false);
    const order: Draw[] = ['none', 'filter', 'mask'];
    for (const which of order) {
      if (which !== 'none' && floorVerdict(done)?.ok === false) break;
      setRunning(`${which}…`);
      setDraw(which);
      await settle(settleMs);
      const el = scrollers[which].current;
      if (!el) continue;
      el.scrollTop = SCROLLED_TO;
      await settle(settleMs);
      const wearing = wearingOf(el);
      for (const { value: condition, label } of CONDITIONS) {
        setRunning(`${which}: ${label.toLowerCase()}…`);
        await settle(0);
        const driver = driverFor(condition, el);
        const reading = await runCell(driver.drive, cell);
        driver.done();
        done.push({ draw: which, condition, wearing, reading });
        setRows([...done]);
        el.scrollTop = SCROLLED_TO;
        await settle(settleMs);
      }
    }
    setRunning(null);
  };

  if (!open) return null;

  const report = reportText(where, rows);
  const verdict = floorVerdict(rows);
  const shown: Draw[] = beside && !running ? DRAWS.map((option) => option.value) : [draw];

  return createPortal(
    <div className={styles.over} role="dialog" aria-modal="true" aria-label="Smoke bench" ref={card} tabIndex={-1}>
      <div className={styles.bar}>
        <h2 className={styles.title}>Smoke bench</h2>
        <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <div className={styles.body}>
        <p className={styles.lede}>
          The same page wearing the smoke as a filter, as a mask, or not at all. Scroll it by hand and read the frames in its
          header, or run the bench: at rest, a repaint a frame, and scrolling, one drawing at a time. The numbers are the
          page&apos;s, so measuring is done on one surface; side by side is for looking.
        </p>
        {!smokeOn && (
          <SettingsCallout>The smoke is switched off under Animations, so every surface here wears nothing. Turn it on to compare.</SettingsCallout>
        )}
        <div className={styles.controls}>
          <div className={styles.choice}>
            <SegmentedControl
              aria-label="Drawing"
              fullWidth
              size="sm"
              options={DRAWS}
              value={draw}
              disabled={running !== null}
              onValueChange={(value) => setDraw(value as Draw)}
            />
          </div>
          <div className={styles.buttons}>
            <RowAction onPress={() => setBeside((was) => !was)} disabled={running !== null}>
              {beside ? 'One at a time' : 'Side by side'}
            </RowAction>
            <RowAction onPress={() => void run(false)} disabled={running !== null}>
              {running ? 'Running' : 'Run the bench'}
            </RowAction>
            <RowAction onPress={() => void run(true)} disabled={running !== null}>
              Run long
            </RowAction>
          </div>
        </div>
        {/* The whole app drawn one way from its next start: the hook's own override, so a page can be felt, not just read. */}
        <p className={styles.lede}>
          {appWide
            ? `The whole app draws the ${appWide} from its next start.`
            : `The whole app draws the ${isTauri() ? 'mask on a Mac and the filter elsewhere' : 'filter'} unless told otherwise.`}{' '}
          {draw !== 'none' && appWide !== draw && (
            <button type="button" className={styles.link} onClick={() => tellApp(draw)}>
              Use the {draw} app-wide
            </button>
          )}
          {appWide && (
            <button type="button" className={styles.link} onClick={() => tellApp(null)}>
              Back to the default
            </button>
          )}
        </p>
        <div className={styles.surfaces} data-beside={shown.length > 1 || undefined}>
          {shown.map((which) => (
            <Surface key={which} draw={which} scroller={scrollers[which]} counting={running === null} />
          ))}
        </div>
        {running && (
          <p className={styles.progress} role="status">
            {running}
          </p>
        )}
        {rows.length > 0 && (
          <div className={styles.results}>
            <p className={styles.meta}>{where}</p>
            {verdict && (verdict.ok ? <p className={styles.lede}>{verdict.words}</p> : <SettingsCallout>{verdict.words}</SettingsCallout>)}
            <table className={styles.table} aria-label="Bench results">
              <thead>
                <tr>
                  <th>Drawing</th>
                  <th>Condition</th>
                  <th>Wearing</th>
                  <th className={styles.num}>n</th>
                  <th className={styles.num}>Median</th>
                  <th className={styles.num}>p90</th>
                  <th className={styles.num}>Worst</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.draw}-${row.condition}`}>
                    <td>{DRAWS.find((option) => option.value === row.draw)?.label}</td>
                    <td>{CONDITIONS.find((option) => option.value === row.condition)?.label}</td>
                    <td className={styles.wearing}>{row.wearing}</td>
                    <td className={styles.num}>{row.reading.n}</td>
                    <td className={`${styles.num} ${row.reading.median > 100 ? styles.slow : ''}`}>{ms(row.reading.median)}</td>
                    <td className={`${styles.num} ${row.reading.p90 > 100 ? styles.slow : ''}`}>{ms(row.reading.p90)}</td>
                    <td className={`${styles.num} ${row.reading.worst > 100 ? styles.slow : ''}`}>{ms(row.reading.worst)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!running && (
              <div className={styles.buttons}>
                <RowAction
                  onPress={() => {
                    void navigator.clipboard?.writeText(report);
                    setCopied(true);
                  }}
                >
                  {copied ? (
                    <>
                      <Check size={14} /> Copied
                    </>
                  ) : (
                    <>
                      <Copy size={14} /> Copy as text
                    </>
                  )}
                </RowAction>
              </div>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
