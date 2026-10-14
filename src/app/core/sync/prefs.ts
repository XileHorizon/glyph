import { ApiError, call } from '../account/api.ts';
import type { Preferences } from '../preferences.ts';
import { open, seal } from './crypto.ts';

/**
 * Settings kept the same on every device (docs/SYNC.md): AttackFM's settings blob, one sealed object written from the
 * revision last seen. A device that changed nothing takes what another device wrote; a device that changed its
 * settings sends them, and when two did, the one sending now wins - settings are chosen, not typed, and choosing again
 * is a tap.
 *
 * Only the settings that describe the person travel. Which model this phone has downloaded, and whether this device
 * talks to the network at all, stay with the device.
 */

export const SYNCED_PREFS = [
  'theme',
  'density',
  'assist',
  'textSize',
  'typeface',
  'refine',
  'quietStop',
  'commandWord',
  'review',
  'codeLight',
  'codeDark',
  'codeChosen',
  'noteView',
  'wisp',
  'wispEdge',
  'ripples',
  'motionSpeed',
  'linkPreviews',
  // The notes left open: they belong to the person, so the tabs are the same wherever they pick the app up.
  'openNotes',
  'tabGroups',
  // The workspaces themselves, and which note is filed in each. Which one is being looked at stays on the device.
  'workspaces',
  // What is in the trash: thrown away on one device, in the trash on every one.
  'trash',
] as const satisfies readonly (keyof Preferences)[];

export type SyncedPrefs = Pick<Preferences, (typeof SYNCED_PREFS)[number]>;

export function pickSynced(prefs: Preferences): SyncedPrefs {
  const out: Partial<SyncedPrefs> = {};
  for (const key of SYNCED_PREFS) (out as Record<string, unknown>)[key] = prefs[key];
  return out as SyncedPrefs;
}

/** Only the known keys, from a blob a newer or older build may have written. */
function known(value: unknown): Partial<SyncedPrefs> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const key of SYNCED_PREFS) if (key in value) out[key] = (value as Record<string, unknown>)[key];
  return out as Partial<SyncedPrefs>;
}

export interface PrefsState {
  rev: number;
  /** The synced settings as they were at `rev`, as JSON: what "changed here" is measured from. */
  seen: string | null;
}

export interface PrefsContext {
  token: string;
  key: CryptoKey;
  read(): Preferences;
  write(next: Partial<Preferences>): void;
  state: PrefsState;
  save(state: PrefsState): void;
  fetcher?: typeof fetch;
}

/** Answers whether this device's settings were changed by another's. */
export async function syncPrefs(ctx: PrefsContext, retry = true): Promise<boolean> {
  const { rev, blob } = await call<{ rev: number; blob: string | null }>('GET', 'prefs', { token: ctx.token, fetcher: ctx.fetcher });
  const mine = JSON.stringify(pickSynced(ctx.read()));
  const changedHere = ctx.state.seen !== mine;
  let took = false;

  if (rev !== ctx.state.rev && blob && (!changedHere || ctx.state.seen === null)) {
    // Another device wrote, and this one has nothing of its own to say - or has never synced, in which case the
    // account's settings are the ones a person signing in expects to see.
    const theirs = known(await open<unknown>(ctx.key, blob, 'prefs'));
    ctx.write(theirs);
    const now = JSON.stringify(pickSynced(ctx.read()));
    took = now !== mine;
    ctx.state = { rev, seen: now };
    ctx.save(ctx.state);
    return took;
  }
  if (!changedHere && rev === ctx.state.rev) return false;

  try {
    const sealed = await seal(ctx.key, pickSynced(ctx.read()), 'prefs');
    const written = await call<{ rev: number }>('PUT', 'prefs', { token: ctx.token, fetcher: ctx.fetcher, body: { base: rev, blob: sealed } });
    ctx.state = { rev: written.rev, seen: mine };
    ctx.save(ctx.state);
  } catch (failure) {
    // Written by another device between the read and the write: read again, once.
    if (retry && failure instanceof ApiError && failure.status === 409) return syncPrefs(ctx, false);
    throw failure;
  }
  return took;
}
