/**
 * Frame times read off the page itself, for the smoke bench (settings/WispBench.tsx).
 *
 * The Mac app's lag (Matt: "the desktop app is incredibly laggy") was measured by hand, in a rig that posted
 * requestAnimationFrame marks from the WKWebView to a collector, and relayed. This is the same clock made a thing
 * the app can run on itself and show, so the numbers are read off the screen by whoever is looking at it rather
 * than passed along: a run drives a surface one way for one cell - nothing, a repaint a frame, a scroll a frame -
 * and keeps every frame's length until the frames or the wall clock run out.
 *
 * Two lessons from the rig are rules here. A cell is capped by wall clock as well as frames, and says how many
 * frames it got: a four-second cap on a three-second frame gave one frame and no median, which is why the first
 * readings were bounds rather than numbers. And the p90 is reported beside the median: the filter's median while
 * scrolling was 3157ms against a p90 of 6507, and an effect that is usually fine and now and then six seconds is
 * what "laggy" feels like.
 */

/** What a cell measured: how many frames, and their lengths in milliseconds at three points. */
export interface Reading {
  n: number;
  median: number;
  p90: number;
  worst: number;
}

/** The three points of a run of frame lengths; an empty run reads as nothing rather than NaN. */
export function summarise(deltas: readonly number[]): Reading {
  if (deltas.length === 0) return { n: 0, median: 0, p90: 0, worst: 0 };
  const sorted = [...deltas].sort((a, b) => a - b);
  const at = (share: number) => sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] ?? 0;
  return {
    n: sorted.length,
    median: at(0.5),
    p90: at(0.9),
    worst: at(1),
  };
}

/** One frame's number, in ms with one decimal; the frame count as it is. */
export function ms(value: number): string {
  return value.toFixed(1);
}

export interface CellLimits {
  /** Stop after this many frames... */
  frames: number;
  /** ...or after this long, whichever comes first, so an expensive cell still ends. */
  wallMs: number;
}

/** What a run uses for a frame and for the time, so a test can turn the clock by hand. */
export interface Clock {
  frame: (callback: (now: number) => void) => void;
  now: () => number;
}

const REAL_CLOCK: Clock = {
  frame: (callback) => requestAnimationFrame(callback),
  now: () => performance.now(),
};

/**
 * Runs one cell: `drive` is called once per frame with the frame's index (to move or repaint the surface, or to do
 * nothing) and the frame's length is kept, until the limits say stop. The first frame's length is not kept, since
 * it measures the wait for the run to start rather than a frame of the driving.
 */
export function runCell(drive: (frame: number) => void, limits: CellLimits, clock: Clock = REAL_CLOCK): Promise<Reading> {
  return new Promise((resolve) => {
    const deltas: number[] = [];
    const started = clock.now();
    let last = -1;
    let index = 0;
    const tick = (now: number) => {
      if (last >= 0) deltas.push(now - last);
      last = now;
      if (deltas.length >= limits.frames || now - started >= limits.wallMs) {
        resolve(summarise(deltas));
        return;
      }
      drive(index++);
      clock.frame(tick);
    };
    clock.frame(tick);
  });
}

/**
 * A rolling read of the frames as they come, for the live counter beside a surface someone is scrolling by hand:
 * every frame's length goes in, the last `keep` are summarised on demand.
 */
export class FrameRing {
  private readonly deltas: number[] = [];
  private last = -1;
  constructor(private readonly keep = 120) {}

  /** A frame happened at `now`. */
  mark(now: number): void {
    if (this.last >= 0) {
      this.deltas.push(now - this.last);
      if (this.deltas.length > this.keep) this.deltas.shift();
    }
    this.last = now;
  }

  /** Forgets the frames so far (when the surface changes, the old frames say nothing about the new one). */
  reset(): void {
    this.deltas.length = 0;
    this.last = -1;
  }

  read(): Reading {
    return summarise(this.deltas);
  }
}

/** Which engine is drawing, from the only thing the page can see of it. */
export function engineName(userAgent: string): 'WebKit' | 'Chromium' | 'Gecko' | 'unknown' {
  if (/Firefox\//.test(userAgent)) return 'Gecko';
  if (/Chrome\/|Chromium\/|CriOS\//.test(userAgent)) return 'Chromium';
  if (/AppleWebKit\//.test(userAgent)) return 'WebKit';
  return 'unknown';
}
