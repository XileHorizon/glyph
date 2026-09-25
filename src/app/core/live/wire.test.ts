import { describe, expect, it } from 'vitest';
import { settle } from '../sync/crypto.ts';
import { Kind, decode, encode, newSeed, openEnvelope, packState, sealEnvelope, unpackState } from './wire.ts';

/** An account key as a device holds one: made, then settled into a non-extractable key. */
async function accountKey(): Promise<CryptoKey> {
  const raw = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  return settle(raw);
}

describe('a live message', () => {
  it('comes back as it went, through the seal', async () => {
    const key = await accountKey();
    const payload = new Uint8Array([1, 2, 3, 250]);
    const data = await sealEnvelope(key, 'note-a', { kind: Kind.Update, payload });
    // What the relay carries: base64url and nothing it could read.
    expect(data).toMatch(/^[A-Za-z0-9_-]+$/);
    const back = await openEnvelope(key, 'note-a', data);
    expect(back.kind).toBe(Kind.Update);
    expect([...back.payload]).toEqual([...payload]);
  });

  it('will not open in another note, so it cannot be replayed into one', async () => {
    const key = await accountKey();
    const data = await sealEnvelope(key, 'note-a', { kind: Kind.Update, payload: new Uint8Array([7]) });
    await expect(openEnvelope(key, 'note-b', data)).rejects.toThrow();
  });

  it('will not open under another account key', async () => {
    const data = await sealEnvelope(await accountKey(), 'note-a', { kind: Kind.Query, payload: new Uint8Array() });
    await expect(openEnvelope(await accountKey(), 'note-a', data)).rejects.toThrow();
  });

  it('refuses a kind it does not know rather than guessing', () => {
    expect(() => decode(new Uint8Array([99, 1]))).toThrow();
    expect(() => decode(new Uint8Array())).toThrow();
    expect(decode(encode({ kind: Kind.Presence, payload: new Uint8Array([5]) })).kind).toBe(Kind.Presence);
  });

  it('carries a document with its seed id in front', () => {
    const seed = newSeed();
    const state = new Uint8Array([9, 8, 7]);
    const unpacked = unpackState(packState(seed, state));
    expect(unpacked.seed).toBe(seed);
    expect([...unpacked.state]).toEqual([9, 8, 7]);
    expect(newSeed()).not.toBe(seed);
  });
});
