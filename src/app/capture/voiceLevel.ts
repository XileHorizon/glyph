/**
 * The microphone's level while recording, for what draws it: 0 (silence) to 1
 * (talking up close), about five times a second (capture/audio.ts `onLevel`).
 *
 * The recorder already writes it to a custom property for the meter on Done.
 * Drawings that do more than scale with it (the side key's rings, which are
 * sent out by the voice) subscribe here instead of polling a style.
 */

const listeners = new Set<(level: number) => void>();

export function publishVoiceLevel(level: number): void {
  listeners.forEach((listener) => listener(level));
}

export function onVoiceLevel(listener: (level: number) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** One ring the voice sends out: how far it travels, how bright, how thick, how long. */
export interface RingShape {
  reach: number;
  opacity: number;
  stroke: number;
  durationMs: number;
}

export interface RingPacer {
  /** The level eased toward what the microphone last said, frame by frame. */
  smooth: number;
  lastRingAt: number;
}

/** Below this the voice is quiet, and the rings keep the slow resting beat. */
export const TALKING = 0.12;
const RESTING_GAP_MS = 2700;

/**
 * Frame by frame: ease the level, and decide whether a ring goes out now.
 * Talking sends rings out closer together the louder it is (every 220 ms at
 * full voice, 540 ms just above quiet), each wider, brighter and quicker; a
 * pause falls back to one faint ring every 2.7 seconds, so the screen still
 * shows it is listening.
 */
export function paceRings(pacer: RingPacer, level: number, now: number): RingShape | null {
  pacer.smooth += (level - pacer.smooth) * 0.25;
  const voice = Math.max(0, Math.min(1, pacer.smooth));
  const talking = voice > TALKING;
  const gap = talking ? 220 + (1 - voice) * 360 : RESTING_GAP_MS;
  if (now - pacer.lastRingAt < gap) return null;
  pacer.lastRingAt = now;
  const strength = talking ? voice : 0;
  return {
    reach: 0.5 + strength * 0.5,
    opacity: 0.16 + strength * 0.5,
    stroke: 1.5 + strength * 2.5,
    durationMs: 2700 - strength * 1000,
  };
}
