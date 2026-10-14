import { describe, expect, it } from 'vitest';
import { settle } from '../sync/crypto.ts';
import { LiveSession, type SessionDeps } from './session.ts';
import type { LiveTransport } from './transport.ts';

/**
 * A relay in memory that keeps the real one's promises (server/src/live.rs): rooms per account, the first into a room
 * told so, a count of the others on every join and leave, messages to everyone else or to one device - and delivered
 * a turn later, as a network would, never in the same breath they were sent.
 */
class Relay {
  private rooms = new Map<string, Device[]>();
  private next = 1;
  device(): Device {
    return new Device(this, this.next++);
  }
  join(device: Device, room: string) {
    const members = this.rooms.get(room) ?? [];
    const first = members.length === 0;
    members.push(device);
    this.rooms.set(room, members);
    later(() => device.session?.joined(first, members.length - 1));
    for (const other of members) if (other !== device) later(() => other.session?.peersChanged(members.length - 1));
  }
  leave(device: Device, room: string) {
    const members = (this.rooms.get(room) ?? []).filter((m) => m !== device);
    this.rooms.set(room, members);
    for (const other of members) later(() => other.session?.peersChanged(members.length - 1));
  }
  send(device: Device, room: string, data: string, to?: number) {
    for (const other of this.rooms.get(room) ?? []) {
      if (other === device || (to !== undefined && other.id !== to)) continue;
      later(() => other.session?.message(device.id, data));
    }
  }
}

class Device implements LiveTransport {
  session: LiveSession | null = null;
  constructor(
    private relay: Relay,
    readonly id: number,
  ) {}
  join(room: string) {
    this.relay.join(this, room);
  }
  leave(room: string) {
    this.relay.leave(this, room);
  }
  send(room: string, data: string, to?: number) {
    this.relay.send(this, room, data, to);
  }
  close() {}
}

/** What the relay has in flight: every delivery scheduled and not yet done, the opening of a message included. */
let inFlight = 0;
const later = (run: () => void | Promise<void>) => {
  inFlight++;
  setTimeout(() => {
    Promise.resolve()
      .then(run)
      .finally(() => inFlight--);
  }, 0);
};
/**
 * Lets every message in flight arrive, sealing and opening included. The relay is asked rather than given a fixed
 * wait: the 60ms this used to sleep was less than the WebCrypto work took on a loaded machine, and a different test
 * in this file failed on each full run, stopping deploys at the test step. Quiet for a while, not merely quiet once,
 * since a device that has just opened a message may be sealing its answer before anything is sent.
 */
const settleDown = async () => {
  const tick = () => new Promise((done) => setTimeout(done, 15));
  const until = Date.now() + 5000;
  let quiet = 0;
  while (Date.now() < until) {
    await tick();
    quiet = inFlight === 0 ? quiet + 1 : 0;
    if (quiet >= 6) return;
  }
};

async function accountKey(): Promise<CryptoKey> {
  return settle(await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']));
}

interface Opened {
  session: LiveSession;
  ready: string | null;
  copies: string[];
}

function open(relay: Relay, key: CryptoKey, words: string, unsynced = false): Opened {
  const device = relay.device();
  const opened: Opened = { session: null as unknown as LiveSession, ready: null, copies: [] };
  const deps: SessionDeps = {
    transport: device,
    key,
    hasUnsynced: () => unsynced,
    keepCopy: async (_id, kept) => void opened.copies.push(kept),
    schedule: () => null,
  };
  opened.session = new LiveSession('note-1', words, deps, {
    ready: (shown) => (opened.ready = shown),
    peers: () => {},
  });
  device.session = opened.session;
  return opened;
}

describe('a note live on two devices', () => {
  it('is made by the first device and adopted by the second, never built twice', async () => {
    const relay = new Relay();
    const key = await accountKey();
    const phone = open(relay, key, 'Groceries\n- milk');
    await settleDown();
    const mac = open(relay, key, 'Groceries\n- milk');
    await settleDown();
    expect(phone.ready).toBe('Groceries\n- milk');
    expect(mac.ready).toBe('Groceries\n- milk');
    // The trap this avoids: two documents each built from the same words, merged, hold the words twice.
    expect(mac.session.text.toString()).toBe('Groceries\n- milk');
    expect(mac.session.seed).toBe(phone.session.seed);
  });

  it('carries typing both ways, a character at a time', async () => {
    const relay = new Relay();
    const key = await accountKey();
    const phone = open(relay, key, 'Plan');
    await settleDown();
    const mac = open(relay, key, 'Plan');
    await settleDown();
    for (const letter of ' for Friday') {
      phone.session.text.insert(phone.session.text.length, letter);
    }
    await settleDown();
    expect(mac.session.text.toString()).toBe('Plan for Friday');
    mac.session.text.insert(0, '# ');
    await settleDown();
    expect(phone.session.text.toString()).toBe('# Plan for Friday');
  });

  it('keeps both people typing into the same spot at the same moment', async () => {
    const relay = new Relay();
    const key = await accountKey();
    const phone = open(relay, key, 'ab');
    await settleDown();
    const mac = open(relay, key, 'ab');
    await settleDown();
    // Both insert between a and b before either hears of the other.
    phone.session.text.insert(1, 'PHONE');
    mac.session.text.insert(1, 'MAC');
    await settleDown();
    const words = phone.session.text.toString();
    expect(mac.session.text.toString()).toBe(words);
    expect(words).toContain('PHONE');
    expect(words).toContain('MAC');
    expect(words.startsWith('a') && words.endsWith('b')).toBe(true);
  });

  it('adopts the room when this device was only behind, and keeps no copy', async () => {
    const relay = new Relay();
    const key = await accountKey();
    open(relay, key, 'Newer words from the phone');
    await settleDown();
    const mac = open(relay, key, 'Older words', false);
    await settleDown();
    expect(mac.ready).toBe('Newer words from the phone');
    expect(mac.copies).toEqual([]);
  });

  it('keeps this device’s own unsent changes as a copy, rather than losing them or undoing the room', async () => {
    const relay = new Relay();
    const key = await accountKey();
    open(relay, key, 'What the phone has');
    await settleDown();
    const mac = open(relay, key, 'What the Mac typed offline', true);
    await settleDown();
    // The room's words stand, untouched...
    expect(mac.ready).toBe('What the phone has');
    // ...and the Mac's are kept beside them, not replayed over the phone's.
    expect(mac.copies).toEqual(['What the Mac typed offline']);
  });

  it('makes the document itself when everyone else left before answering', async () => {
    const relay = new Relay();
    const key = await accountKey();
    const phone = open(relay, key, 'x');
    await settleDown();
    const mac = open(relay, key, 'Mac words');
    // The phone goes before the Mac's question reaches it.
    phone.session.close();
    await settleDown();
    expect(mac.ready).toBe('Mac words');
    expect(mac.session.state).toBe('ready');
  });

  it('ignores a message it cannot open', async () => {
    const relay = new Relay();
    const phone = open(relay, await accountKey(), 'Mine');
    await settleDown();
    await phone.session.message(99, 'not-a-sealed-message');
    expect(phone.session.text.toString()).toBe('Mine');
  });
});
