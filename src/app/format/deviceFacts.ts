import { useEffect, useState } from 'react';

/**
 * What the page can read about the phone on its own, for the AI card: the
 * cores, the memory class the browser rounds to, and the battery. An older
 * binary reports nothing from the engine, and this still shows the phone.
 */

interface DeviceFacts {
  cores: number | null;
  /** The device memory class in gigabytes, as the browser rounds it. */
  memoryGb: number | null;
  battery: { level: number; charging: boolean } | null;
}

interface BatteryLike extends EventTarget {
  level: number;
  charging: boolean;
}

export function useDeviceFacts(): DeviceFacts {
  const [facts, setFacts] = useState<DeviceFacts>(() => ({
    cores: typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : null,
    memoryGb: typeof navigator !== 'undefined' && 'deviceMemory' in navigator ? ((navigator as { deviceMemory?: number }).deviceMemory ?? null) : null,
    battery: null,
  }));

  useEffect(() => {
    const getBattery = (navigator as { getBattery?: () => Promise<BatteryLike> }).getBattery;
    if (typeof getBattery !== 'function') return undefined;
    let battery: BatteryLike | null = null;
    let alive = true;
    const read = () => {
      if (battery && alive) setFacts((previous) => ({ ...previous, battery: { level: battery!.level, charging: battery!.charging } }));
    };
    void getBattery.call(navigator).then((found) => {
      if (!alive) return;
      battery = found;
      read();
      found.addEventListener('levelchange', read);
      found.addEventListener('chargingchange', read);
    });
    return () => {
      alive = false;
      battery?.removeEventListener('levelchange', read);
      battery?.removeEventListener('chargingchange', read);
    };
  }, []);

  return facts;
}

