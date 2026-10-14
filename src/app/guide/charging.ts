import { useEffect, useState } from 'react';

/**
 * Whether the phone is on charge, live, from the browser's Battery API.
 *
 * For the hot phone on the heads-up page (Matt: "if you've been idle on the
 * page for a bit have the phone ask to be plugged in and then thank the user
 * if they actually do plug the phone in"): the drawn phone asks, and the real
 * phone answers. The API is there in Android's WebView and in Chrome; where it
 * isn't (Safari, a browser that hides it, jsdom), the state is null and the
 * asking is simply never answered.
 *
 * `watchCharging` is the pure part, with the battery source injectable, so a
 * test can plug the phone in.
 */

export interface Charging {
  /** On charge, off charge, or null when the phone won't say. */
  charging: boolean | null;
  /** 0 to 1, or null. */
  level: number | null;
}

/** The slice of the Battery API this uses. */
export interface BatteryLike {
  charging: boolean;
  level: number;
  addEventListener(type: 'chargingchange' | 'levelchange', listener: () => void): void;
  removeEventListener(type: 'chargingchange' | 'levelchange', listener: () => void): void;
}

type GetBattery = () => Promise<BatteryLike>;

/** The page's battery source, or null where there is none. */
export function batterySource(): GetBattery | null {
  if (typeof navigator === 'undefined') return null;
  const getBattery = (navigator as Navigator & { getBattery?: GetBattery }).getBattery;
  return typeof getBattery === 'function' ? getBattery.bind(navigator) : null;
}

export const UNKNOWN: Charging = { charging: null, level: null };

/**
 * Tells `listener` the charging state now and whenever it changes. Answers
 * the way to stop listening. With no source, the listener hears `UNKNOWN`
 * once and nothing more.
 */
export function watchCharging(listener: (state: Charging) => void, source: GetBattery | null = batterySource()): () => void {
  if (!source) {
    listener(UNKNOWN);
    return () => undefined;
  }
  let battery: BatteryLike | null = null;
  let stopped = false;
  const tell = () => {
    if (battery && !stopped) listener({ charging: battery.charging, level: battery.level });
  };
  source()
    .then((found) => {
      if (stopped) return;
      battery = found;
      battery.addEventListener('chargingchange', tell);
      battery.addEventListener('levelchange', tell);
      tell();
    })
    .catch(() => {
      if (!stopped) listener(UNKNOWN);
    });
  return () => {
    stopped = true;
    battery?.removeEventListener('chargingchange', tell);
    battery?.removeEventListener('levelchange', tell);
  };
}

/** The charging state, kept current for a component. */
export function useCharging(): Charging {
  const [state, setState] = useState<Charging>(UNKNOWN);
  useEffect(() => watchCharging(setState), []);
  return state;
}
