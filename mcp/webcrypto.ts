import { webcrypto } from 'node:crypto';

/**
 * WebCrypto, whatever Node this is.
 *
 * Everything the server does with an account - deriving the password's halves, unwrapping the key, sealing a note -
 * goes through `crypto.subtle` (core/sync/crypto.ts, mcp/glyph.ts), and `globalThis.crypto` is only there without
 * asking from Node 19 on. The box runs 18.19, where it is undefined unless node is started with
 * `--experimental-global-webcrypto`, so the first thing anyone signing in met was the key import throwing and the
 * page saying "That is not an account key" - which was true of nothing except the process it was said in.
 *
 * Put here rather than in the unit's ExecStart so it travels with the file: a person running the one-file server on
 * their own Node 18 hits exactly the same wall, and neither of them should have to know this.
 */
export function ensureWebCrypto(): void {
  if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true, writable: true });
  }
}
