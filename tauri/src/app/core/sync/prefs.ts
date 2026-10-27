import { ApiError, call } from '../account/api.ts';
import type { Preferences } from '../preferences.ts';
import { open, seal } from './crypto.ts';

/**
 * Settings kept the same on every device (docs/SYNC.md): AttackFM's settings blob, one sealed object written from the
 * revision last seen. A device that changed nothing takes what another device wrote; a device that changed its
 * settings sends them. When two did, each setting goes to whichever changed it, measured from what this device last
 * saw (`merged`): a tab opened here must not undo a note filed there. Only when both changed the same setting does
 * the one sending now win - settings are chosen, not typed, and choosing again is a tap.
 *
 * Only the settings that describe the person travel. Which model this phone has downloaded, and whether this device
 * talks to the network at all, stay with the device.
 */

const SYNCED_PREFS = [
  'theme',
  // The home page's layout: a way of looking at the same notes, chosen once for every device.
  'homeLayout',
  'homeLayoutChosen',
  'topBar',
  'density',
  'assist',
  'textSize',
  'typeface',
  'noteFace',
  'refine',
  'quietStop',
  'review',
  'summaries',
  // When a meeting is written up, and whether its audio syncs: the person's choices, whichever device made the meeting.
  'writeUp',
  'syncMeetingRecordings',
  'codeLight',
  'codeDark',
  'codeChosen',
  'noteView',
  'marksInMargin',
  'wisp',
  'wispEdge',
  'ripples',
  'motionSpeed',
  'linkPreviews',
  // Whether a canvas's cards land on its dots: a way of working, the same on every device.
  'canvasSnap',
  // Where a note was written: the map and the place names describe the person, as link previews do, so they travel.
  // Tagging new notes does not: it makes this device ask for its position (a network lookup on a phone or in a
  // browser), and whether a device talks to the network stays with the device, as Local only does. A switch turned
  // on elsewhere must not make a browser tab here raise a location prompt at its next new note (core/location.ts).
  'mapTiles',
  'placeNames',
  // The notes left open: they belong to the person, so the tabs are the same wherever they pick the app up.
  'openNotes',
  'tabGroups',
  // The workspaces themselves, and which note is filed in each. Which one is being looked at stays on the device.
  'workspaces',
  // What is in the trash: thrown away on one device, in the trash on every one.
  'trash',
  // Which notes are meetings: recorded on one device, a meeting on every one (docs/DESIGN.md §127).
  'meetings',
  // The notes shared by a link, with their keys: listed, followed and stopped from any device (share/share.ts).
  'shares',
  // Which notifications are drawn and counted, and which organizations are muted: chosen once for every device.
  'notifications',
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

type Entries = Record<string, unknown>;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const entries = (value: unknown): value is Entries => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** One map, entry by entry: an entry changed here since `base` stays as it is here, and every other is theirs. */
function mergedEntries(base: Entries, mine: Entries, theirs: Entries): Entries {
  const out: Entries = {};
  for (const key of new Set([...Object.keys(theirs), ...Object.keys(mine)])) {
    const value = same(mine[key], base[key]) ? theirs[key] : mine[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** A list of things with ids, the same way: theirs in their order, with what was added or changed here. */
function mergedList(base: unknown[], mine: unknown[], theirs: unknown[]): unknown[] {
  const byId = (list: unknown[]) => Object.fromEntries(list.filter(entries).map((each) => [String(each.id), each]));
  const kept = mergedEntries(byId(base), byId(mine), byId(theirs));
  const order = [...theirs, ...mine].filter(entries).map((each) => String(each.id));
  return [...new Set(order)].filter((id) => id in kept).map((id) => kept[id]);
}

/**
 * This device's settings and another's, both changed since `base`. A setting only one of them changed is that
 * one's. The maps (which note is filed where, what is in the trash) are merged an entry at a time, since a filing
 * made on one device and another made elsewhere are two changes, not one. What both changed stays as it is here.
 */
export function merged(base: Partial<SyncedPrefs>, mine: SyncedPrefs, theirs: Partial<SyncedPrefs>): SyncedPrefs {
  const out: Entries = { ...mine };
  for (const key of SYNCED_PREFS) {
    if (!(key in theirs)) continue;
    const [b, m, t] = [base[key], mine[key], theirs[key]] as unknown[];
    if (same(m, b)) out[key] = t;
    else if (same(t, b) || same(t, m)) continue;
    else if (key === 'workspaces' && entries(b) && entries(m) && entries(t) && [b, m, t].every((each) => Array.isArray(each.list) && entries(each.notes))) {
      const list = mergedList(b.list as unknown[], m.list as unknown[], t.list as unknown[]) as Entries[];
      const notes = mergedEntries(b.notes as Entries, m.notes as Entries, t.notes as Entries);
      // A note filed in a workspace the other device removed is in none.
      for (const [note, space] of Object.entries(notes)) if (!list.some((each) => each.id === space)) delete notes[note];
      out[key] = { ...m, list, notes };
    } else if (entries(b) && entries(m) && entries(t)) out[key] = mergedEntries(b, m, t);
  }
  return out as SyncedPrefs;
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

  let sending = mine;
  if (rev !== ctx.state.rev && blob && ctx.state.seen !== null) {
    // Both wrote: what the other device changed and this one did not is taken before this one's are sent.
    const theirs = known(await open<unknown>(ctx.key, blob, 'prefs'));
    ctx.write(merged(JSON.parse(ctx.state.seen) as Partial<SyncedPrefs>, pickSynced(ctx.read()), theirs));
    sending = JSON.stringify(pickSynced(ctx.read()));
    took = sending !== mine;
  }
  try {
    const sealed = await seal(ctx.key, pickSynced(ctx.read()), 'prefs');
    const written = await call<{ rev: number }>('PUT', 'prefs', { token: ctx.token, fetcher: ctx.fetcher, body: { base: rev, blob: sealed } });
    ctx.state = { rev: written.rev, seen: sending };
    ctx.save(ctx.state);
  } catch (failure) {
    // Written by another device between the read and the write: read again, once.
    if (retry && failure instanceof ApiError && failure.status === 409) return (await syncPrefs(ctx, false)) || took;
    throw failure;
  }
  return took;
}
