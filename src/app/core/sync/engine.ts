import { convertFileSrc } from '@tauri-apps/api/core';
import { useSyncExternalStore } from 'react';
import { accountKey, accountState, resume, signOut } from '../account/account.ts';
import { ApiError } from '../account/api.ts';
import { keepWebImage, webImageBytes } from '../images.ts';
import { onPreferences, preferences, setPreferences } from '../preferences.ts';
import { announceNotesChanged, applyNote, deleteNote, getNote, listNotes, NOTE_SAVED, type Note } from '../store.ts';
import { invoke, isTauri } from '../tauri.ts';
import { toBase64Url, type Bytes } from './crypto.ts';
import { emptyState, mark, syncNotes, type FileKind, type LocalFiles, type LocalNotes, type SyncState } from './notes.ts';
import { syncPrefs, type PrefsState } from './prefs.ts';

/**
 * Sync as the app runs it: when, against which of this device's stores, and what the Account page shows about it.
 *
 * A sync runs when the app starts signed in, when it comes back to the front, a moment after a note or a setting
 * changes, and every few minutes while it is open. One runs at a time; a request while one is running queues exactly
 * one more. Nothing runs without an account key on the device, or with "Nothing leaves the phone" on.
 */

/** Native generation that has `store_apply` and `sync_put_file`. */
export const SYNC_GENERATION = 16;
const QUIET_MS = 4_000;
const EVERY_MS = 5 * 60_000;

// --- status ------------------------------------------------------------------------------

export interface SyncStatus {
  phase: 'off' | 'idle' | 'syncing' | 'error';
  /** When the last sync finished cleanly, in ms. */
  lastAt: number | null;
  message: string | null;
  /** Notes kept twice by the last sync because both sides had changed them. */
  conflicts: number;
}

let status: SyncStatus = { phase: 'off', lastAt: null, message: null, conflicts: 0 };
const listeners = new Set<() => void>();

function setStatus(next: Partial<SyncStatus>): void {
  status = { ...status, ...next };
  for (const listener of listeners) listener();
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => status,
  );
}

/** How long ago a sync finished, as the Account page says it. */
export function syncedWhen(ms: number): string {
  const minutes = Math.round((Date.now() - ms) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  return new Date(ms).toLocaleString(undefined, { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' });
}

/** The Account row's second line. */
export function syncSummary(signedIn: string | null, status: SyncStatus): string {
  if (!signedIn) return 'Not signed in';
  if (status.phase === 'syncing') return `${signedIn} · syncing`;
  if (status.phase === 'error') return `${signedIn} · not synced`;
  return status.lastAt ? `${signedIn} · synced ${syncedWhen(status.lastAt)}` : signedIn;
}

// --- what this device remembers -----------------------------------------------------------

function stateKey(accountId: number, part: string): string {
  return `glyph-sync-${accountId}-${part}`;
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? ({ ...fallback, ...(JSON.parse(raw) as T) } as T) : fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Full or private: the next sync starts from what was last kept, which only costs a longer sync.
  }
}

/**
 * Whether this device's copy of a note has changes the pass sync has not sent: its fingerprint against the one kept at
 * its last sync, or no record of it at all. Live sync asks when a device joins a note another device already has open
 * (docs/LIVE.md, Seeding): a device that was only behind adopts the room's words; one with changes of its own keeps
 * them as a copy. Signed out, nothing is pending.
 */
export function hasUnsyncedChanges(note: Note): boolean {
  const session = accountState().session;
  if (!session) return false;
  const known = load<SyncState>(stateKey(session.accountId, 'notes'), emptyState()).notes[note.id];
  return !known || known.mark !== mark(note);
}

/** Forgets what this device knew of an account's sync: for signing out. */
export function forgetSync(accountId: number): void {
  try {
    for (const part of ['notes', 'prefs']) localStorage.removeItem(stateKey(accountId, part));
  } catch {
    // Nothing kept.
  }
}

/** Signs out and forgets this device's sync bookkeeping for the account. The notes stay. */
export async function signOutHere(): Promise<void> {
  const session = accountState().session;
  await signOut();
  if (session) forgetSync(session.accountId);
  setStatus({ phase: 'off', message: null, lastAt: null, conflicts: 0 });
}

// --- this device's stores -------------------------------------------------------------------

const deviceNotes: LocalNotes = {
  list: listNotes,
  get: getNote,
  apply: applyNote,
  remove: deleteNote,
};

async function fetchLocal(url: string): Promise<Bytes | null> {
  try {
    const response = await fetch(url);
    return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

const deviceFiles: LocalFiles = {
  async read(kind: FileKind, name: string) {
    if (isTauri()) return fetchLocal(convertFileSrc(kind === 'recording' ? `${name}.wav` : name, kind === 'recording' ? 'rec' : 'img'));
    // A browser keeps pictures, and no recordings.
    return kind === 'image' ? webImageBytes(name).catch(() => null) : null;
  },
  async write(kind: FileKind, name: string, bytes: Bytes) {
    if (isTauri()) {
      // Standard base64, which is what Rust reads.
      const base64 = toBase64Url(bytes).replace(/-/g, '+').replace(/_/g, '/');
      await invoke('sync_put_file', { kind, name, base64: base64 + '='.repeat((4 - (base64.length % 4)) % 4) });
      return;
    }
    if (kind === 'image') await keepWebImage(name, bytes);
  },
};

let generation: number | null = null;

async function nativeReady(): Promise<boolean> {
  if (!isTauri()) return true;
  generation ??= await invoke<{ nativeGeneration?: number }>('ota_status').then(
    (s) => s.nativeGeneration ?? 0,
    () => 0,
  );
  return generation >= SYNC_GENERATION;
}

// --- running ----------------------------------------------------------------------------------

let running: Promise<void> | null = null;
let again = false;

/** Syncs now, or right after the sync already running. */
export function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        await once();
      } while (again);
    } catch (failure) {
      setStatus({ phase: 'error', message: failure instanceof Error ? failure.message : String(failure) });
    } finally {
      running = null;
    }
  })();
  return running;
}

async function once(): Promise<void> {
  const session = accountState().session;
  const key = session ? await accountKey().catch(() => null) : null;
  if (!session || !key || preferences().localOnly) {
    setStatus({ phase: 'off', message: null });
    return;
  }
  if (!(await nativeReady())) {
    setStatus({ phase: 'error', message: 'Sync needs the newest Ghost.md. Install it from attack.fm/glyph.' });
    return;
  }
  setStatus({ phase: 'syncing', message: null });
  try {
    const notesKey = stateKey(session.accountId, 'notes');
    const outcome = await syncNotes({
      token: session.token,
      key,
      notes: deviceNotes,
      files: deviceFiles,
      state: load<SyncState>(notesKey, emptyState()),
      save: (state) => store(notesKey, state),
    });
    if (outcome.changed) announceNotesChanged();

    const prefsKey = stateKey(session.accountId, 'prefs');
    applyingRemote = true;
    try {
      await syncPrefs({
        token: session.token,
        key,
        read: preferences,
        write: setPreferences,
        state: load<PrefsState>(prefsKey, { rev: 0, seen: null }),
        save: (state) => store(prefsKey, state),
      });
    } finally {
      applyingRemote = false;
    }
    setStatus({ phase: 'idle', lastAt: Date.now(), message: null, conflicts: outcome.conflicts });
  } catch (failure) {
    if (failure instanceof ApiError && failure.status === 401) {
      // The session lapsed mid-sync: renew it (with this device's key if need be) and go again next time.
      await resume().catch(() => undefined);
    }
    setStatus({ phase: 'error', message: failure instanceof Error ? failure.message : String(failure) });
  }
}

let quiet: ReturnType<typeof setTimeout> | null = null;
let applyingRemote = false;

/** A sync a moment from now, pushed back by every change in between. */
export function syncSoon(): void {
  if (quiet) clearTimeout(quiet);
  quiet = setTimeout(() => {
    quiet = null;
    void syncNow();
  }, QUIET_MS);
}

let started = false;

/**
 * Starts syncing for the life of the page: renews the session, syncs, and then syncs on the triggers above. Safe to
 * call more than once.
 */
export function startSync(): () => void {
  if (started) return () => undefined;
  started = true;
  // Nothing at all for a device that was never signed in; for one that was, all of it after first render, and
  // nothing it does can throw into the launch.
  const signedIn = accountState().session !== null;
  if (signedIn) {
    setTimeout(() => {
      void resume()
        .then(() => syncNow())
        .catch(() => undefined);
    }, 0);
  }
  const active = () => accountState().session !== null;
  const onVisible = () => {
    if (active() && document.visibilityState === 'visible') void syncNow();
  };
  const onChanged = () => {
    if (active()) syncSoon();
  };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener(NOTE_SAVED, onChanged);
  const unprefs = onPreferences(() => {
    if (active() && !applyingRemote) syncSoon();
  });
  const timer = setInterval(() => {
    if (active()) void syncNow();
  }, EVERY_MS);
  return () => {
    started = false;
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener(NOTE_SAVED, onChanged);
    unprefs();
    clearInterval(timer);
  };
}
