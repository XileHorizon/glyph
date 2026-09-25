/**
 * The rings the side key's edge sends out (SideKeyWaves.tsx): when one goes,
 * how it grows and fades, and how its outline wavers. Pure, so each is a test.
 *
 * Matt: "make the pulsing waves wobbly and have them react to the phone's
 * microphone". At rest one faint ring every 0.95 s; talking sends them out
 * closer together the louder it is, each wider, brighter and quicker, with
 * a bigger wobble; the level is eased frame by frame so a word does not
 * make a ring jump. The wobble is three slow sines around the outline at
 * different rates, so the ring wavers like something seen through water
 * rather than shivering.
 */

export interface Ring {
  born: number;
  /** How long it lives, ms. */
  life: number;
  /** How far it reaches, as a multiple of the resting reach. */
  reach: number;
  /** How bright at its brightest, 0..1. */
  alpha: number;
  /** Stroke width, px. */
  width: number;
  /** A phase of its own, so no two rings wobble alike. */
  seed: number;
}

export interface Pacer {
  /** The level eased toward what the microphone last said. */
  smooth: number;
  lastAt: number;
}

/** Below this the voice is quiet and the rings keep the resting beat. */
export const TALKING = 0.12;
export const REST_GAP_MS = 950;
export const REST_LIFE_MS = 3800;

const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** Frame by frame: ease the level, and the ring to send now, if it is time. */
export function paceWaves(pacer: Pacer, level: number, now: number, seed = Math.random() * Math.PI * 2): Ring | null {
  pacer.smooth += (clamp(level) - pacer.smooth) * 0.25;
  const voice = clamp(pacer.smooth);
  const strength = voice > TALKING ? (voice - TALKING) / (1 - TALKING) : 0;
  const gap = strength > 0 ? 260 + (1 - strength) * 420 : REST_GAP_MS;
  if (now - pacer.lastAt < gap) return null;
  pacer.lastAt = now;
  return {
    born: now,
    life: REST_LIFE_MS - strength * 1500,
    reach: 1 + strength * 0.45,
    alpha: 0.55 + strength * 0.4,
    width: 1.5 + strength * 1.5,
    seed,
  };
}

/** How far a ring has grown at `t` in 0..1: quickly out of the edge, slowly at the end. */
export function grown(t: number): number {
  return 1 - Math.pow(1 - clamp(t), 2.4);
}

/** How bright a ring is at `t`: up in the first tenth, then fading to nothing. */
export function shining(t: number): number {
  const at = clamp(t);
  return at < 0.12 ? at / 0.12 : 1 - (at - 0.12) / 0.88;
}

/** The wobble at angle `theta` (radians) and time `seconds`, in -1..1. */
export function wobbleAt(theta: number, seconds: number, seed: number): number {
  return 0.5 * Math.sin(3 * theta + seed + seconds * 1.1) + 0.3 * Math.sin(5 * theta - 2 * seed - seconds * 0.7) + 0.2 * Math.sin(8 * theta + seed * 0.5 + seconds * 1.9);
}

/** How far the outline wobbles, as a fraction of the radius: a little at rest, more with the voice. */
export function wobbleAmount(voice: number): number {
  return 0.035 + clamp(voice) * 0.13;
}
