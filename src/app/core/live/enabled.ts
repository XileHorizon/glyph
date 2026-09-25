import { useSyncExternalStore } from 'react';

/**
 * Whether live sync runs on this device (docs/LIVE.md, "Switched off until it works").
 *
 * Off by default, and on by hand under Settings > Account > Sync ("Live typing"), while it is still being tried on real
 * devices - the Fold and the Mac typing into one note together. It takes effect on the next note opened: a note
 * already open keeps working the way it opened.
 *
 * Kept on the device rather than in the synced settings, so trying it on one device never turns it on for another, and
 * in its own file rather than the preferences, so it can be turned on for everyone by changing one line here.
 */
const KEY = 'glyph-live';
const listeners = new Set<() => void>();

export function liveEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on';
  } catch {
    // Storage the page cannot reach - a locked-down webview, a private window - is not a device that asked for it.
    return false;
  }
}

export function setLiveEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, 'on');
    else localStorage.removeItem(KEY);
  } catch {
    // Nowhere to keep it: it stays as it was, and the switch shows as much.
  }
  for (const listener of listeners) listener();
}

export function useLiveEnabled(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    liveEnabled,
    () => false,
  );
}
