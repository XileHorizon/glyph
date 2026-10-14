import { describe, expect, it } from 'vitest';
import { engineName, FrameRing, runCell, summarise, type Clock } from './frameClock.ts';

/**
 * The bench's clock, turned by hand. The two rules it exists for are the two that were learned the hard way in the
 * hand-built rig: a cell ends on the wall clock as well as on its frame count and says how many frames it got, and
 * the p90 stands beside the median.
 */

/** A clock whose frames are as long as the caller says, one after another. */
function clockOf(lengths: number[]): Clock {
  let now = 0;
  let started = false;
  let pending: ((now: number) => void) | null = null;
  const frames = [...lengths];
  const clock: Clock = {
    now: () => now,
    frame: (callback) => {
      pending = callback;
      // Run on a microtask so a run reads as asynchronous, as the real one does.
      void Promise.resolve().then(() => {
        const next = pending;
        pending = null;
        if (!next) return;
        // The first frame arrives at once; every later one after the next length in the list.
        if (started) now += frames.length ? (frames.shift() as number) : 16.7;
        started = true;
        next(now);
      });
    },
  };
  return clock;
}

describe('summarise', () => {
  it('reads the median, p90 and worst off a run, and the count', () => {
    const reading = summarise([16, 17, 16, 3000, 16, 17, 16, 16, 17, 16]);
    expect(reading.n).toBe(10);
    expect(reading.median).toBe(16);
    expect(reading.p90).toBe(3000);
    expect(reading.worst).toBe(3000);
  });

  it('reads nothing off no frames rather than NaN', () => {
    expect(summarise([])).toEqual({ n: 0, median: 0, p90: 0, worst: 0 });
  });
});

describe('runCell', () => {
  it('stops at the frame count when the frames are quick, and drives every frame', async () => {
    const driven: number[] = [];
    const reading = await runCell((frame) => driven.push(frame), { frames: 5, wallMs: 10_000 }, clockOf([16, 16, 16, 16, 16, 16]));
    expect(reading.n).toBe(5);
    expect(reading.median).toBe(16);
    // The first frame starts the run and isn't a reading; the five after it are.
    expect(driven).toEqual([0, 1, 2, 3, 4]);
  });

  it('stops on the wall clock when the frames are slow, and says how few it got', async () => {
    // Three-second frames against a ten-second wall: the rig's four-second cap gave one frame and no median.
    const reading = await runCell(() => {}, { frames: 120, wallMs: 10_000 }, clockOf([3000, 3000, 3000, 3000, 3000]));
    expect(reading.n).toBe(4);
    expect(reading.median).toBe(3000);
  });

  it('keeps the p90 apart from the median, since one slow frame in ten is what lag feels like', async () => {
    const lengths = [16, 16, 16, 16, 16, 16, 16, 16, 16, 6500];
    const reading = await runCell(() => {}, { frames: 10, wallMs: 60_000 }, clockOf(lengths));
    expect(reading.median).toBe(16);
    expect(reading.p90).toBe(6500);
  });
});

describe('FrameRing', () => {
  it('keeps only the last frames, and forgets them on reset', () => {
    const ring = new FrameRing(3);
    [0, 10, 20, 30, 1000].forEach((at) => ring.mark(at));
    // Four lengths were seen (10, 10, 10, 970); the ring holds the last three.
    expect(ring.read()).toEqual({ n: 3, median: 10, p90: 970, worst: 970 });
    ring.reset();
    expect(ring.read().n).toBe(0);
    // After a reset the next mark is a start, not a length.
    ring.mark(5000);
    expect(ring.read().n).toBe(0);
  });
});

describe('engineName', () => {
  it('tells the Mac app apart from the browser pane', () => {
    expect(engineName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)')).toBe('WebKit');
    expect(engineName('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36')).toBe('Chromium');
    expect(engineName('Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0')).toBe('Gecko');
    expect(engineName('curl/8.4')).toBe('unknown');
  });
});
