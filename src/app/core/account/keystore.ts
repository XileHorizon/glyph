/**
 * Where a device keeps what makes it a signed-in device (docs/SYNC.md): the session token, and two keys - the account
 * key that opens every synced note, and this device's own signing key for password-free sign-in.
 *
 * The keys are CryptoKey objects, stored as themselves in IndexedDB, which is the one place a browser keeps a key it
 * will not let anybody read the bytes of. The token is a string and lives in localStorage, as AttackFM keeps its own.
 * Tests, and a browser with no IndexedDB, get the same interface in memory.
 */

export interface Session {
  token: string;
  handle: string;
  accountId: number;
}

export interface KeyStore {
  accountKey(): Promise<CryptoKey | null>;
  setAccountKey(key: CryptoKey | null): Promise<void>;
  deviceKey(): Promise<CryptoKeyPair | null>;
  setDeviceKey(pair: CryptoKeyPair | null): Promise<void>;
}

const SESSION_KEY = 'glyph-account-session';
const DB = 'glyph-account';
const STORE = 'keys';

export function readSession(): Session | null {
  try {
    const value = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') as Partial<Session> | null;
    return value && typeof value.token === 'string' && typeof value.handle === 'string' && typeof value.accountId === 'number'
      ? { token: value.token, handle: value.handle, accountId: value.accountId }
      : null;
  } catch {
    return null;
  }
}

export function writeSession(session: Session | null): void {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // No storage: signed in for as long as the page is open.
  }
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB failed'));
  });
}

let opened: Promise<IDBDatabase> | null = null;

function database(): Promise<IDBDatabase> {
  opened ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB would not open'));
  });
  return opened;
}

async function get<T>(name: string): Promise<T | null> {
  const db = await database();
  return ((await request(db.transaction(STORE, 'readonly').objectStore(STORE).get(name))) as T | undefined) ?? null;
}

async function put(name: string, value: unknown): Promise<void> {
  const db = await database();
  const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
  if (value === null) await request(store.delete(name));
  else await request(store.put(value, name));
}

/** The device's keys in IndexedDB. */
export const indexedKeys: KeyStore = {
  accountKey: () => get<CryptoKey>('account'),
  setAccountKey: (key) => put('account', key),
  deviceKey: () => get<CryptoKeyPair>('device'),
  setDeviceKey: (pair) => put('device', pair),
};

/** The same, held in memory: for tests, and for a browser with no IndexedDB (a private window, say). */
export function memoryKeys(): KeyStore {
  let account: CryptoKey | null = null;
  let device: CryptoKeyPair | null = null;
  return {
    accountKey: async () => account,
    setAccountKey: async (key) => {
      account = key;
    },
    deviceKey: async () => device,
    setDeviceKey: async (pair) => {
      device = pair;
    },
  };
}

/** Where this device keeps its keys: IndexedDB where there is one. */
export function deviceKeys(): KeyStore {
  return typeof indexedDB === 'undefined' ? fallback : indexedKeys;
}

const fallback = memoryKeys();
