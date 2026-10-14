import { describe, expect, it } from 'vitest';
import { UNKNOWN, watchCharging, type BatteryLike } from './charging.ts';

/** A phone whose plug can be pulled in a test. */
function fakeBattery(charging: boolean, level = 0.5): BatteryLike & { plug(on: boolean): void } {
  const listeners = new Set<() => void>();
  const battery = {
    charging,
    level,
    addEventListener: (_type: 'chargingchange' | 'levelchange', listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: 'chargingchange' | 'levelchange', listener: () => void) => listeners.delete(listener),
    plug(on: boolean) {
      battery.charging = on;
      listeners.forEach((listener) => listener());
    },
  };
  return battery;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('watching the charger', () => {
  it('says now, and again when the phone is plugged in or unplugged', async () => {
    const battery = fakeBattery(false, 0.4);
    const heard: (boolean | null)[] = [];
    const stop = watchCharging((state) => heard.push(state.charging), () => Promise.resolve(battery));
    await tick();
    battery.plug(true);
    battery.plug(false);
    stop();
    battery.plug(true);
    expect(heard).toEqual([false, true, false]);
  });

  it('answers unknown where the phone will not say', () => {
    const heard: unknown[] = [];
    watchCharging((state) => heard.push(state), null);
    expect(heard).toEqual([UNKNOWN]);
  });

  it('answers unknown when the battery cannot be read', async () => {
    const heard: unknown[] = [];
    watchCharging((state) => heard.push(state), () => Promise.reject(new Error('no')));
    await tick();
    expect(heard).toEqual([UNKNOWN]);
  });
});
