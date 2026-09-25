import { fromBase64Url, openBytes, sealBytes, toBase64Url, type Bytes } from '../sync/crypto.ts';

/**
 * What live sync says inside a sealed message (docs/LIVE.md). The relay carries these as base64url ciphertext and
 * never sees which is which: every kind is sealed alike, under the account key, bound to the note it belongs to.
 *
 * One byte of kind, then the payload - binary rather than JSON, because the payload is a Yjs update, and turning
 * bytes into text to put them in JSON and back would cost a third more on every keystroke.
 */
export const Kind = {
  /** "I have joined and have no document: send me yours." A device that was not first into the room sends it. */
  Query: 1,
  /** The whole document, sent to one device in answer to a query. The payload starts with the seed id. */
  State: 2,
  /** A change to the document: one keystroke, one paste. */
  Update: 3,
  /** Where a device's caret is. */
  Presence: 4,
} as const;
export type Kind = (typeof Kind)[keyof typeof Kind];

export interface Envelope {
  kind: Kind;
  /** Read, never kept: any bytes will do, a Yjs update's included (its buffer is not always a plain ArrayBuffer). */
  payload: Uint8Array;
}

const KINDS = new Set<number>(Object.values(Kind));

/** The associated data a note's live messages are sealed under: one sealed for another note will not open. */
export function liveContext(noteId: string): string {
  return `live:${noteId}`;
}

export function encode(envelope: Envelope): Bytes {
  const out = new Uint8Array(1 + envelope.payload.length);
  out[0] = envelope.kind;
  out.set(envelope.payload, 1);
  return out;
}

export function decode(bytes: Uint8Array): Envelope {
  const kind = bytes[0];
  if (kind === undefined || !KINDS.has(kind)) throw new Error('A live message of a kind this Ghost.md does not know.');
  return { kind: kind as Kind, payload: bytes.slice(1) };
}

/** An envelope sealed for the relay: what goes in a `msg` frame's `data`. */
export async function sealEnvelope(key: CryptoKey, noteId: string, envelope: Envelope): Promise<string> {
  return toBase64Url(await sealBytes(key, encode(envelope), liveContext(noteId)));
}

/**
 * A `msg` frame's `data` opened. Throws on the wrong key, a tampered message, or one sealed for another note - the
 * caller drops it and carries on, since a message it cannot read is one it should not act on.
 */
export async function openEnvelope(key: CryptoKey, noteId: string, data: string): Promise<Envelope> {
  return decode(await openBytes(key, fromBase64Url(data), liveContext(noteId)));
}

/** A seed id, and the document's state after it: how a `State` payload is laid out (docs/LIVE.md, Seeding). */
const SEED_BYTES = 16;

export function newSeed(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(SEED_BYTES)));
}

export function packState(seed: string, state: Uint8Array): Bytes {
  const id = fromBase64Url(seed);
  if (id.length !== SEED_BYTES) throw new Error('A seed id is sixteen bytes.');
  const out = new Uint8Array(SEED_BYTES + state.length);
  out.set(id, 0);
  out.set(state, SEED_BYTES);
  return out;
}

export function unpackState(payload: Uint8Array): { seed: string; state: Bytes } {
  if (payload.length < SEED_BYTES) throw new Error('A document state too short to carry its seed id.');
  return { seed: toBase64Url(payload.slice(0, SEED_BYTES)), state: payload.slice(SEED_BYTES) };
}
