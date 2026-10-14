import { useSyncExternalStore } from 'react';
import { ApiError, call } from './api.ts';
import { deviceKeys, readSession, writeSession, type KeyStore, type Session } from './keystore.ts';
import {
  derive,
  newAccountKey,
  newDeviceKey,
  newSheet,
  normaliseCode,
  passwordSalt,
  publicKeyOf,
  recoverySalt,
  ROUNDS,
  settle,
  signNonce,
  unwrap,
  wrap,
} from '../sync/crypto.ts';

/**
 * A Glyph account on this device (docs/SYNC.md): making one, the three ways in, and what signing out takes away.
 *
 * AttackFM's flows (`src/app/servers/registry.ts`, `registrySession.tsx`), with the keys of end-to-end encryption
 * threaded through them: a password or a recovery code is split on the device, the half the service may see goes to
 * it, and the other half unwraps the account key, which then stays on the device and is never asked for again. A
 * device also registers its own signing key, so an expired session renews itself without the password.
 */

export interface AccountState {
  session: Session | null;
  /** Whether this device holds the account key, and so can read and write synced notes. */
  unlocked: boolean;
}

export interface Deps {
  keys: KeyStore;
  fetcher?: typeof fetch;
  /** PBKDF2 rounds: the real number, except in tests. */
  rounds: number;
}

const live: Deps = { keys: deviceKeys(), rounds: ROUNDS };

// --- the state the page shows ------------------------------------------------------

let state: AccountState = { session: readSession(), unlocked: false };
const listeners = new Set<() => void>();

function publish(next: AccountState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function accountState(): AccountState {
  return state;
}

export function useAccount(): AccountState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

/** Tells the page what this device holds now: the session, and whether the account key is here. */
async function settleState(deps: Deps, session: Session | null): Promise<void> {
  writeSession(session);
  publish({ session, unlocked: Boolean(session && (await deps.keys.accountKey())) });
}

// --- the rules ---------------------------------------------------------------------

/** The service's handle rule, checked here too so a mistake is said before a round trip. */
export function handleProblem(handle: string): string | null {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{2,23}$/.test(handle.trim())
    ? null
    : 'A handle is 3 to 24 letters, digits, . _ or -, starting with a letter or digit.';
}

export function passwordProblem(password: string): string | null {
  return password.length >= 8 ? null : 'A password is at least 8 characters.';
}

function deviceLabel(): string {
  const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (/Android/i.test(agent)) return 'Android';
  if (/iPhone|iPad/i.test(agent)) return 'iPhone';
  if (/Macintosh/i.test(agent)) return 'Mac';
  if (/Windows/i.test(agent)) return 'Windows';
  return 'Web';
}

interface SignedIn {
  token: string;
  account: { id: number; handle: string };
  wrapped?: string;
}

function sessionOf(answer: SignedIn): Session {
  return { token: answer.token, handle: answer.account.handle, accountId: answer.account.id };
}

/** This device's signing key, made and registered on the account if it has none. */
async function enrolDevice(deps: Deps, token: string): Promise<void> {
  if (await deps.keys.deviceKey()) return;
  const pair = await newDeviceKey();
  await call('POST', 'device', { token, fetcher: deps.fetcher, body: { devicePublicKey: await publicKeyOf(pair), label: deviceLabel() } });
  await deps.keys.setDeviceKey(pair);
}

// --- the flows ---------------------------------------------------------------------

export interface Made {
  /** The recovery sheet: shown to the person once, never kept on the device or sent anywhere. */
  codes: string[];
}

/** A new account on this device, and its recovery sheet. */
export async function signUp(handle: string, password: string, deps: Deps = live): Promise<Made> {
  const problem = handleProblem(handle) ?? passwordProblem(password);
  if (problem) throw new ApiError(400, problem);
  const accountKey = await newAccountKey();
  const { login, wrapKey } = await derive(password, passwordSalt(handle), deps.rounds);
  const device = await newDeviceKey();
  const sheet = await newSheet(handle, accountKey, deps.rounds);
  const answer = await call<SignedIn>('POST', 'signup', {
    fetcher: deps.fetcher,
    body: {
      handle: handle.trim(),
      loginSecret: login,
      wrapped: await wrap(accountKey, wrapKey),
      devicePublicKey: await publicKeyOf(device),
      deviceLabel: deviceLabel(),
      recovery: sheet.entries,
    },
  });
  await deps.keys.setAccountKey(await settle(accountKey));
  await deps.keys.setDeviceKey(device);
  await settleState(deps, sessionOf(answer));
  return { codes: sheet.codes };
}

/** In with a password: the account key is unwrapped here and kept. */
export async function signIn(handle: string, password: string, deps: Deps = live): Promise<void> {
  const { login, wrapKey } = await derive(password, passwordSalt(handle), deps.rounds);
  const answer = await call<SignedIn>('POST', 'login', { fetcher: deps.fetcher, body: { handle: handle.trim(), loginSecret: login } });
  if (!answer.wrapped) throw new ApiError(500, 'The service answered without this account’s key.');
  const accountKey = await unwrap(answer.wrapped, wrapKey).catch(() => {
    throw new ApiError(500, 'This account’s key would not open with that password.');
  });
  await deps.keys.setAccountKey(accountKey);
  await enrolDevice(deps, answer.token);
  await settleState(deps, sessionOf(answer));
}

/**
 * In with a recovery code, which is spent, and a new password set at once - the old one is presumably what was lost.
 * A code used is a code gone, so a fresh sheet is made too, and answered for the person to keep.
 */
export async function recover(handle: string, code: string, newPassword: string, deps: Deps = live): Promise<Made> {
  const problem = passwordProblem(newPassword);
  if (problem) throw new ApiError(400, problem);
  const { login, wrapKey } = await derive(normaliseCode(code), recoverySalt(handle), deps.rounds);
  const answer = await call<SignedIn>('POST', 'login/recovery', { fetcher: deps.fetcher, body: { handle: handle.trim(), login } });
  if (!answer.wrapped) throw new ApiError(500, 'The service answered without this account’s key.');
  const accountKey = await unwrap(answer.wrapped, wrapKey, true);
  const next = await derive(newPassword, passwordSalt(handle), deps.rounds);
  await call('PUT', 'password', { token: answer.token, fetcher: deps.fetcher, body: { loginSecret: next.login, wrapped: await wrap(accountKey, next.wrapKey) } });
  const sheet = await newSheet(handle, accountKey, deps.rounds);
  await call('POST', 'recovery', { token: answer.token, fetcher: deps.fetcher, body: { codes: sheet.entries } });
  await deps.keys.setAccountKey(await settle(accountKey));
  await enrolDevice(deps, answer.token);
  await settleState(deps, sessionOf(answer));
  return { codes: sheet.codes };
}

/** The account key under a new password. Needs the current one: the key has to be opened to be wrapped again. */
export async function changePassword(current: string, next: string, deps: Deps = live): Promise<void> {
  const session = state.session;
  if (!session) throw new ApiError(401, 'Sign in first.');
  const problem = passwordProblem(next);
  if (problem) throw new ApiError(400, problem);
  const accountKey = await openWithPassword(session, current, deps);
  const derived = await derive(next, passwordSalt(session.handle), deps.rounds);
  await call('PUT', 'password', { token: session.token, fetcher: deps.fetcher, body: { loginSecret: derived.login, wrapped: await wrap(accountKey, derived.wrapKey) } });
}

/** A new recovery sheet in place of the old. Needs the password, for the same reason. */
export async function newRecoveryCodes(password: string, deps: Deps = live): Promise<Made> {
  const session = state.session;
  if (!session) throw new ApiError(401, 'Sign in first.');
  const accountKey = await openWithPassword(session, password, deps);
  const sheet = await newSheet(session.handle, accountKey, deps.rounds);
  await call('POST', 'recovery', { token: session.token, fetcher: deps.fetcher, body: { codes: sheet.entries } });
  return { codes: sheet.codes };
}

async function openWithPassword(session: Session, password: string, deps: Deps): Promise<CryptoKey> {
  const { wrapped } = await call<{ wrapped: string }>('GET', 'keys', { token: session.token, fetcher: deps.fetcher });
  const { wrapKey } = await derive(password, passwordSalt(session.handle), deps.rounds);
  return unwrap(wrapped, wrapKey, true).catch(() => {
    throw new ApiError(401, 'That is not the password.');
  });
}

/**
 * On launch: the session renewed, and, if it had lapsed, renewed again with this device's own key - the way a
 * signed-in phone stays signed in without anyone typing anything. A session that cannot be renewed either way is
 * signed out, keys and all.
 */
export async function resume(deps: Deps = live): Promise<void> {
  const session = readSession();
  if (!session) return settleState(deps, null);
  try {
    const answer = await call<SignedIn>('POST', 'refresh', { token: session.token, fetcher: deps.fetcher });
    return await settleState(deps, sessionOf(answer));
  } catch (failure) {
    // Offline, or the service is down: still signed in, as it was, until it can be asked.
    if (!(failure instanceof ApiError) || failure.status !== 401) return settleState(deps, session);
  }
  const device = await deps.keys.deviceKey();
  if (device) {
    try {
      const { nonce } = await call<{ nonce: string }>('POST', 'login/challenge', { fetcher: deps.fetcher, body: { handle: session.handle } });
      const answer = await call<SignedIn>('POST', 'login/device', {
        fetcher: deps.fetcher,
        body: { handle: session.handle, nonce, signature: await signNonce(device, nonce) },
      });
      return await settleState(deps, sessionOf(answer));
    } catch {
      // Falls through to signing out.
    }
  }
  await signOut(deps);
}

/** Off this device: the session and both keys. Notes on the device stay; only what made it an account goes. */
export async function signOut(deps: Deps = live): Promise<void> {
  await deps.keys.setAccountKey(null);
  await deps.keys.setDeviceKey(null);
  await settleState(deps, null);
}

/** The account key, for sync: null when this device has none. */
export function accountKey(deps: Deps = live): Promise<CryptoKey | null> {
  return deps.keys.accountKey();
}
