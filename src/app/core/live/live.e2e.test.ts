// @vitest-environment node
// Node's own environment, not jsdom's: a real socket is needed here, and under jsdom the socket builds its events
// with jsdom's Event class and then refuses them ("must be an instance of Event. Received an instance of Event"), so it
// never opens. Node carries its own WebSocket and localStorage, which is all the sign-in and the relay need.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { accountState, signIn, signUp, type Deps } from '../account/account.ts';
import { API_BASE } from '../account/api.ts';
import { memoryKeys } from '../account/keystore.ts';
import { LiveSession } from './session.ts';
import { WebSocketTransport, liveUrl } from './transport.ts';

/**
 * Two devices typing into one note through a real relay (server/src/live.rs), with real sockets and real sealing:
 *
 *   GLYPH_LIVE_E2E=<the server's data folder> VITE_GLYPH_API=http://127.0.0.1:<port>/glyph/api npx vitest run live.e2e
 *
 * Skipped otherwise. Every run makes a fresh account.
 */

const DATA = process.env.GLYPH_LIVE_E2E;
const FAST = 1_000;


interface Device {
  deps: Deps;
  token: string;
  key: CryptoKey | null;
}

interface Open {
  session: LiveSession;
  transport: WebSocketTransport;
  shown: Promise<string>;
  copies: string[];
}

const opened: Open[] = [];

/** A note live on a device, wired the way core/live/hub.ts wires it: the relay's events to the note's session. */
function open(device: Device, noteId: string, words: string, unsynced = false): Open {
  let show!: (words: string) => void;
  const shown = new Promise<string>((done) => (show = done));
  const copies: string[] = [];
  const transport = new WebSocketTransport({
    url: liveUrl(API_BASE),
    token: () => device.token,
    events: {
      ready: () => undefined,
      joined: (_room, first, peers) => session.joined(first, peers),
      peers: (_room, peers) => session.peersChanged(peers),
      message: (_room, from, data) => void session.message(from, data),
      down: () => undefined,
    },
  });
  // Declared after the transport whose events use it: they only ever arrive later, off the network.
  const session = new LiveSession(noteId, words, { transport, key: device.key!, hasUnsynced: () => unsynced, keepCopy: async (_id, kept) => void copies.push(kept) }, { ready: show, peers: () => undefined });
  const one = { session, transport, shown, copies };
  opened.push(one);
  return one;
}

function shut(one: Open): void {
  one.session.close();
  one.transport.close();
}

/** Until `check` holds, or fail after a while: the network is real, so nothing here is instant. */
async function until(check: () => boolean, what: string, ms = 5000): Promise<number> {
  const start = performance.now();
  while (!check()) {
    if (performance.now() - start > ms) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((done) => setTimeout(done, 2));
  }
  return performance.now() - start;
}

describe.skipIf(!DATA)('a note live on two devices, through the relay', () => {
  const handle = `l${Date.now().toString(36)}`;
  const phone: Device = { deps: { keys: memoryKeys(), rounds: FAST }, token: '', key: null };
  const mac: Device = { deps: { keys: memoryKeys(), rounds: FAST }, token: '', key: null };

  afterAll(() => opened.forEach(shut));

  it('signs the two devices into one account, each holding the same key', async () => {
    await signUp(handle, 'correct horse', phone.deps);
    phone.token = accountState().session!.token;
    phone.key = await phone.deps.keys.accountKey();
    await signIn(handle, 'correct horse', mac.deps);
    mac.token = accountState().session!.token;
    mac.key = await mac.deps.keys.accountKey();
    expect(phone.key && mac.key).toBeTruthy();
  });

  it('is made on the phone and adopted on the Mac, not built twice', async () => {
    const a = open(phone, 'note-trip', 'Weekend trip');
    expect(await a.shown).toBe('Weekend trip');
    const b = open(mac, 'note-trip', 'Weekend trip');
    expect(await b.shown).toBe('Weekend trip');
    expect(b.session.seed).toBe(a.session.seed);
    expect(b.session.text.toString()).toBe('Weekend trip');
  });

  it('carries each keystroke across, and says how long one takes', async () => {
    const [a, b] = opened.slice(-2) as [Open, Open];
    const times: number[] = [];
    for (const letter of ' to the coast') {
      const want = a.session.text.toString() + letter;
      a.session.text.insert(a.session.text.length, letter);
      times.push(await until(() => b.session.text.toString() === want, `"${letter}" on the Mac`));
    }
    expect(b.session.text.toString()).toBe('Weekend trip to the coast');
    times.sort((x, y) => x - y);
    console.log(`a keystroke reached the other device in ${times[Math.floor(times.length / 2)]!.toFixed(1)} ms (median), ${times[times.length - 1]!.toFixed(1)} ms at worst, over ${times.length}`);

    b.session.text.insert(0, '# ');
    await until(() => a.session.text.toString() === '# Weekend trip to the coast', 'the Mac’s edit on the phone');
  });

  it('keeps both people typing into the same spot at once', async () => {
    const [a, b] = opened.slice(-2) as [Open, Open];
    const at = a.session.text.toString().indexOf('coast');
    a.session.text.insert(at, 'PHONE ');
    b.session.text.insert(at, 'MAC ');
    await until(() => a.session.text.toString() === b.session.text.toString() && a.session.text.toString().includes('PHONE') && a.session.text.toString().includes('MAC'), 'both edits on both devices');
  });

  it('lets a device that went away come back and catch up', async () => {
    const [a, b] = opened.slice(-2) as [Open, Open];
    shut(b);
    a.session.text.insert(a.session.text.length, '. Leave at eight.');
    const back = open(mac, 'note-trip', 'stale words', false);
    const shown = await back.shown;
    expect(shown).toBe(a.session.text.toString());
    expect(back.copies).toEqual([]);
  });

  it('never gives the relay the words', () => {
    const files = readdirSync(DATA!).filter((f) => f.startsWith('glyph-accounts.sqlite3'));
    const bytes = files.map((f) => readFileSync(join(DATA!, f)).toString('latin1')).join('');
    for (const word of ['Weekend', 'coast', 'Leave at eight']) expect(bytes).not.toContain(word);
  });
});
