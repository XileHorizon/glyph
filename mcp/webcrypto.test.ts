// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { fromBase64Url, toBase64Url } from '../src/app/core/sync/crypto.ts';
import { ensureWebCrypto } from './webcrypto.ts';

/**
 * The wall a Node without WebCrypto puts in front of anyone signing in, and the one line that takes it away.
 *
 * `globalThis.crypto` is only there unasked from Node 19 on. The box runs 18.19, so every account operation in the
 * hosted server - the password's halves, the key unwrapped, a note sealed - threw at its first `crypto.subtle`, and
 * the sign-in page reported the only thing the route knew how to say: "That is not an account key." The key was
 * fine. This pins both halves: that the failure looks exactly like a bad key, which is why it cost an evening, and
 * that `ensureWebCrypto()` answers it whatever Node it runs on.
 */

const real = globalThis.crypto;
const withoutWebCrypto = (): void => {
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true, writable: true });
};

afterEach(() => {
  Object.defineProperty(globalThis, 'crypto', { value: real, configurable: true, writable: true });
});

/** What the hosted server does with what the sign-in page hands it (mcp/hosted.ts, `/authorize/complete`). */
async function takeTheKey(accountKey: string): Promise<CryptoKey> {
  const raw = fromBase64Url(accountKey);
  if (raw.length !== 32) throw new Error('not 32 bytes');
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

describe('a Node without WebCrypto', () => {
  it('refuses a perfectly good account key, which is what made this so hard to see', async () => {
    const key = toBase64Url(new Uint8Array(32).fill(7));
    // With WebCrypto it is taken.
    await expect(takeTheKey(key)).resolves.toBeTruthy();
    // Without it, the same key throws - and the route above this reads that as the key being wrong.
    withoutWebCrypto();
    await expect(takeTheKey(key)).rejects.toBeTruthy();
  });

  it('is answered by ensureWebCrypto, and leaves a Node that has it alone', async () => {
    withoutWebCrypto();
    expect(globalThis.crypto).toBeUndefined();
    ensureWebCrypto();
    expect(globalThis.crypto?.subtle).toBeTruthy();
    await expect(takeTheKey(toBase64Url(new Uint8Array(32).fill(7)))).resolves.toBeTruthy();

    // Called where WebCrypto is already there, it changes nothing.
    const had = globalThis.crypto;
    ensureWebCrypto();
    expect(globalThis.crypto).toBe(had);
  });

  it('still refuses a key that really is the wrong size', async () => {
    ensureWebCrypto();
    await expect(takeTheKey(toBase64Url(new Uint8Array(16).fill(7)))).rejects.toThrow('not 32 bytes');
  });
});
