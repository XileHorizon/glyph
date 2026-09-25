/**
 * The keys and the ciphertext of end-to-end encrypted sync (docs/SYNC.md, "Keys").
 *
 * WebCrypto only, so the phone, the desktop and the browser run exactly this. Nothing here talks to the network: it
 * turns a password or a recovery code into the half the server may see and the half it may not, wraps the account key
 * under the second, and seals what is synced under the account key.
 *
 * - A **secret** (a password or a recovery code) becomes 64 bytes by PBKDF2-SHA-256, 600 000 rounds, salted with the
 *   handle. The first 32 are the **login** half, sent as hex in place of the secret; the last 32 are the **wrap key**,
 *   which never leaves the device.
 * - The **account key** is AES-256-GCM. It is kept on a device non-extractable, so a page script can use it but never
 *   read it out; an extractable copy exists only for as long as it takes to wrap it under a new password or code.
 * - A **sealed** blob is `1 ‖ iv(12) ‖ AES-GCM(plaintext)` as base64url, with what it is (`note:<id>`, `prefs`) as
 *   associated data, so a blob cannot be moved onto another note and still open.
 */

/** Bytes WebCrypto accepts: backed by a plain ArrayBuffer. */
export type Bytes = Uint8Array<ArrayBuffer>;

/** OWASP's floor for PBKDF2-SHA-256 as of 2023. Slow enough to matter to a guesser, quick enough on a phone. */
export const ROUNDS = 600_000;
const VERSION = 1;
const IV_BYTES = 12;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// --- bytes and text ---------------------------------------------------------------

export function toBase64Url(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Bytes {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function randomBytes(count: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(count));
}

// --- secrets ----------------------------------------------------------------------

/** What a password is salted with: the handle, the way the person types it, lower-cased. */
export function passwordSalt(handle: string): string {
  return `glyph/v1/${handle.trim().toLowerCase()}`;
}

/** What a recovery code is salted with. */
export function recoverySalt(handle: string): string {
  return `glyph/v1/recovery/${handle.trim().toLowerCase()}`;
}

/** A recovery code as it is compared: letters and digits only, upper case, so dashes and case do not matter. */
export function normaliseCode(code: string): string {
  return code.replace(/[^a-z0-9]/gi, '').toUpperCase();
}

export interface Derived {
  /** Sent to the server in place of the secret: 64 hex characters. */
  login: string;
  /** Wraps and unwraps the account key. Never leaves this device, and cannot be read out of this key object. */
  wrapKey: CryptoKey;
}

/** The two halves of a secret. */
export async function derive(secret: string, salt: string, rounds = ROUNDS): Promise<Derived> {
  const base = await crypto.subtle.importKey('raw', encoder.encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations: rounds }, base, 512));
  const wrapKey = await crypto.subtle.importKey('raw', bits.slice(32), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  const login = toHex(bits.slice(0, 32));
  bits.fill(0);
  return { login, wrapKey };
}

// --- the account key --------------------------------------------------------------

/** A new account key, extractable so it can be wrapped; kept on the device as a non-extractable copy (`settle`). */
export function newAccountKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

/** The account key wrapped under `wrapKey`: `iv ‖ AES-GCM(raw key)`, base64url. The key must be extractable. */
export async function wrap(accountKey: CryptoKey, wrapKey: CryptoKey): Promise<string> {
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', accountKey));
  const iv = randomBytes(IV_BYTES);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode('account-key') }, wrapKey, raw));
  raw.fill(0);
  return toBase64Url(concat(iv, sealed));
}

/**
 * The account key back out of `wrapped`. Fails, with WebCrypto's own error, on the wrong password or code: GCM's tag
 * is the check, so there is nothing to compare by hand.
 */
export async function unwrap(wrapped: string, wrapKey: CryptoKey, extractable = false): Promise<CryptoKey> {
  const bytes = fromBase64Url(wrapped);
  const raw = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, IV_BYTES), additionalData: encoder.encode('account-key') }, wrapKey, bytes.slice(IV_BYTES)),
  );
  const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, extractable, ['encrypt', 'decrypt']);
  raw.fill(0);
  return key;
}

/** A non-extractable copy of an extractable account key, the form a device keeps. */
export async function settle(accountKey: CryptoKey): Promise<CryptoKey> {
  if (!accountKey.extractable) return accountKey;
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', accountKey));
  const kept = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  raw.fill(0);
  return kept;
}

// --- sealed blobs -----------------------------------------------------------------

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** `bytes` sealed under the account key, bound to `context`. */
export async function sealBytes(accountKey: CryptoKey, bytes: Bytes, context: string): Promise<Bytes> {
  const iv = randomBytes(IV_BYTES);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(context) }, accountKey, bytes));
  return concat(Uint8Array.of(VERSION), iv, sealed);
}

/** The bytes back out of a sealed blob. Fails on the wrong key, a tampered blob, or a blob moved from another context. */
export async function openBytes(accountKey: CryptoKey, sealed: Bytes, context: string): Promise<Bytes> {
  if (sealed[0] !== VERSION) throw new Error('This was sealed by a newer Ghost.md. Update the app to read it.');
  const iv = sealed.slice(1, 1 + IV_BYTES);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(context) }, accountKey, sealed.slice(1 + IV_BYTES)));
}

/** A value sealed as base64url text: what a note or the settings go to the server as. */
export async function seal(accountKey: CryptoKey, value: unknown, context: string): Promise<string> {
  return toBase64Url(await sealBytes(accountKey, encoder.encode(JSON.stringify(value)), context));
}

export async function open<T>(accountKey: CryptoKey, blob: string, context: string): Promise<T> {
  return JSON.parse(decoder.decode(await openBytes(accountKey, fromBase64Url(blob), context))) as T;
}

// --- recovery codes ---------------------------------------------------------------

/** AttackFM's alphabet: no 0/O or 1/I. Thirty-two characters, so five random bits pick one with no bias. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODES = 8;

/** One code, `XXXX-XXXX-XXXX`: sixty bits. */
export function newRecoveryCode(): string {
  const picks = Array.from(randomBytes(12), (byte) => ALPHABET[byte & 31]).join('');
  return `${picks.slice(0, 4)}-${picks.slice(4, 8)}-${picks.slice(8, 12)}`;
}

export interface SheetEntry {
  login: string;
  wrapped: string;
}

/**
 * A recovery sheet: eight new codes, and for each what the server keeps - its login half, and the account key wrapped
 * under its wrap key. The codes themselves are shown to the person once and never sent.
 */
export async function newSheet(handle: string, accountKey: CryptoKey, rounds = ROUNDS): Promise<{ codes: string[]; entries: SheetEntry[] }> {
  const codes = Array.from({ length: CODES }, newRecoveryCode);
  const entries = await Promise.all(
    codes.map(async (code) => {
      const { login, wrapKey } = await derive(normaliseCode(code), recoverySalt(handle), rounds);
      return { login, wrapped: await wrap(accountKey, wrapKey) };
    }),
  );
  return { codes, entries };
}

// --- the device key ---------------------------------------------------------------

/** This device's signing key for password-free sign-in, as AttackFM makes one: Ed25519, never extractable. */
export function newDeviceKey(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']) as Promise<CryptoKeyPair>;
}

export async function publicKeyOf(pair: CryptoKeyPair): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
}

export async function signNonce(pair: CryptoKeyPair, nonce: string): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, encoder.encode(nonce))));
}
