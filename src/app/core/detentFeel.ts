/**
 * Feeling a detent coming: light ticks while a drag closes on it, further
 * apart far off and closer and closer together as it nears, then the firm
 * click of arriving (the swipe's own).
 *
 * Matt: "make the haptics that I feel speed up as we get closer to a detent so
 * we can kind of feel them out". A click only at the detent says you have
 * arrived; it doesn't say how far is left. The ticks do, the way a Geiger
 * counter speeds up: none in the first third of the way, one every 240 ms from
 * there, down to one every 40 ms just short of it. Only on the way out: backing
 * off is quiet until the detent's own soft click. Pure, so the pacing is a test.
 */

/** How far along the way a drag must be before the ticks begin. */
export const APPROACH_FROM = 0.35;
const SLOWEST_MS = 240;
const FASTEST_MS = 40;

/**
 * Where a drag at `distance` is between detents: the detent it is heading for,
 * and how far along it is from the one before it (or from rest), 0 to 1. Null
 * past the last. `detents` are nearest first, as fractions of the width.
 */
export function approach(detents: readonly number[], distance: number): { index: number; progress: number } | null {
  let from = 0;
  for (let index = 0; index < detents.length; index += 1) {
    const to = detents[index] ?? 0;
    if (distance < to) return { index, progress: to > from ? Math.max(0, (distance - from) / (to - from)) : 0 };
    from = to;
  }
  return null;
}

/** The gap between ticks at `progress`, or null where there are none. */
export function tickGap(progress: number): number | null {
  if (progress < APPROACH_FROM || progress >= 1) return null;
  const near = (progress - APPROACH_FROM) / (1 - APPROACH_FROM);
  // Eased, so most of the speeding up is in the last stretch, where it helps.
  return Math.round(SLOWEST_MS - (SLOWEST_MS - FASTEST_MS) * near * near);
}

export interface Approaching {
  lastTickAt: number;
  lastDistance: number;
}

/** Whether to tick now, for a drag at `distance` heading for `detents`. Moves `state` on. */
export function tickNow(state: Approaching, detents: readonly number[], distance: number, now: number): boolean {
  const outward = distance > state.lastDistance;
  state.lastDistance = distance;
  if (!outward) return false;
  const heading = approach(detents, distance);
  const gap = heading ? tickGap(heading.progress) : null;
  if (gap === null || now - state.lastTickAt < gap) return false;
  state.lastTickAt = now;
  return true;
}
