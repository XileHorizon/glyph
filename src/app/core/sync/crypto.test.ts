import { describe, expect, it } from 'vitest';
import {
  CODES,
  derive,
  fromBase64Url,
  newAccountKey,
  newDeviceKey,
  newRecoveryCode,
  newSheet,
  normaliseCode,
  open,
  openBytes,
  passwordSalt,
  publicKeyOf,
  recoverySalt,
  seal,
  sealBytes,
  settle,
  signNonce,
  toBase64Url,
  unwrap,
  wrap,
} from './crypto.ts';

/** A handful of rounds: the tests are about what goes where, not about being slow. */
const FAST = 1_000;

describe('a secret', () => {
  it('becomes a login half and a wrap key, the same every time for the same secret and handle', async () => {
    const one = await derive('correct horse', passwordSalt('Matt'), FAST);
    const two = await derive('correct horse', passwordSalt('matt'), FAST);
    expect(one.login).toMatch(/^[0-9a-f]{64}$/);
    expect(one.login).toBe(two.login);
    // The wrap key is the other half: it is never the login half, and cannot be read out.
    expect(one.wrapKey.extractable).toBe(false);
  });

  it('gives another login for another password, or the same password under another handle', async () => {
    const base = await derive('correct horse', passwordSalt('matt'), FAST);
    expect((await derive('correct horsf', passwordSalt('matt'), FAST)).login).not.toBe(base.login);
    expect((await derive('correct horse', passwordSalt('sam'), FAST)).login).not.toBe(base.login);
    expect((await derive('correct horse', recoverySalt('matt'), FAST)).login).not.toBe(base.login);
  });
});

describe('the account key', () => {
  it('wraps under a password and comes back only under the same one', async () => {
    const key = await newAccountKey();
    const right = await derive('correct horse', passwordSalt('matt'), FAST);
    const wrong = await derive('wrong horse', passwordSalt('matt'), FAST);
    const wrapped = await wrap(key, right.wrapKey);
    expect(wrapped).toMatch(/^[A-Za-z0-9_-]+$/);

    const back = await unwrap(wrapped, right.wrapKey);
    expect(back.extractable).toBe(false);
    const sealed = await seal(key, { words: 'hello' }, 'note:a');
    expect(await open(back, sealed, 'note:a')).toEqual({ words: 'hello' });

    await expect(unwrap(wrapped, wrong.wrapKey)).rejects.toThrow();
  });

  it('is kept non-extractable, and still seals and opens', async () => {
    const key = await newAccountKey();
    const kept = await settle(key);
    expect(kept.extractable).toBe(false);
    expect(await open(kept, await seal(key, [1, 2, 3], 'prefs'), 'prefs')).toEqual([1, 2, 3]);
    await expect(wrap(kept, (await derive('x', passwordSalt('m'), FAST)).wrapKey)).rejects.toThrow();
  });
});

describe('a sealed blob', () => {
  it('opens only under its own key and its own context', async () => {
    const key = await newAccountKey();
    const other = await newAccountKey();
    const blob = await seal(key, { body: '# Weekend trip' }, 'note:one');
    await expect(open(other, blob, 'note:one')).rejects.toThrow();
    await expect(open(key, blob, 'note:two')).rejects.toThrow();
    expect(await open(key, blob, 'note:one')).toEqual({ body: '# Weekend trip' });
  });

  it('never repeats itself for the same words, and never carries them in the clear', async () => {
    const key = await newAccountKey();
    const one = await seal(key, 'the deposit is four hundred', 'note:a');
    const two = await seal(key, 'the deposit is four hundred', 'note:a');
    expect(one).not.toBe(two);
    const bytes = new TextDecoder().decode(fromBase64Url(one));
    expect(bytes).not.toContain('deposit');
  });

  it('is refused when tampered with', async () => {
    const key = await newAccountKey();
    const sealed = await sealBytes(key, new Uint8Array([1, 2, 3, 4]), 'recording:a');
    sealed[sealed.length - 1]! ^= 1;
    await expect(openBytes(key, sealed, 'recording:a')).rejects.toThrow();
  });

  it('carries bytes of any size, a recording included', async () => {
    const key = await newAccountKey();
    const audio = crypto.getRandomValues(new Uint8Array(60_000));
    expect(await openBytes(key, await sealBytes(key, audio, 'recording:a'), 'recording:a')).toEqual(audio);
  });

  it('says so when it was sealed by a newer version', async () => {
    const key = await newAccountKey();
    const sealed = await sealBytes(key, new Uint8Array([1]), 'prefs');
    sealed[0] = 9;
    await expect(openBytes(key, sealed, 'prefs')).rejects.toThrow(/newer Ghost.md/);
  });
});

describe('recovery codes', () => {
  it('are three groups of four, from an alphabet with no 0, O, 1 or I', () => {
    for (let i = 0; i < 50; i += 1) expect(newRecoveryCode()).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(normaliseCode('abcd-efgh ijkl')).toBe('ABCDEFGHIJKL');
  });

  it('come as a sheet whose every code unwraps the account key, typed however it is typed', async () => {
    const key = await newAccountKey();
    const { codes, entries } = await newSheet('matt', key, FAST);
    expect(codes).toHaveLength(CODES);
    expect(new Set(codes).size).toBe(CODES);
    expect(entries.every((entry) => /^[0-9a-f]{64}$/.test(entry.login))).toBe(true);
    const code = codes[3]!;
    const typed = code.toLowerCase().replace(/-/g, ' ');
    const { login, wrapKey } = await derive(normaliseCode(typed), recoverySalt('matt'), FAST);
    expect(login).toBe(entries[3]!.login);
    const back = await unwrap(entries[3]!.wrapped, wrapKey);
    expect(await open(back, await seal(key, 'ok', 'prefs'), 'prefs')).toBe('ok');
  });
});

describe('the device key', () => {
  it('signs a nonce the server can check with the public half', async () => {
    const pair = await newDeviceKey();
    const publicKey = await publicKeyOf(pair);
    expect(fromBase64Url(publicKey)).toHaveLength(32);
    const signature: BufferSource = fromBase64Url(await signNonce(pair, 'nonce-1'));
    const verified = await crypto.subtle.verify({ name: 'Ed25519' }, pair.publicKey, signature, new TextEncoder().encode('nonce-1'));
    expect(verified).toBe(true);
  });
});

describe('base64url', () => {
  it('round-trips every byte, with no padding and no + or /', () => {
    const bytes = new Uint8Array(256).map((_, i) => i);
    const text = toBase64Url(bytes);
    expect(text).not.toMatch(/[+/=]/);
    expect(fromBase64Url(text)).toEqual(bytes);
  });
});
