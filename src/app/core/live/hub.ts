import { accountKey, accountState } from '../account/account.ts';
import { API_BASE } from '../account/api.ts';
import { liveEnabled } from './enabled.ts';
import { LiveSession, type SessionListener } from './session.ts';
import { WebSocketTransport, liveUrl, type LiveTransport } from './transport.ts';

/**
 * Live sync's one connection on this device, shared by every note that is live on it (docs/LIVE.md): made when the
 * first note goes live, closed when the last one does, and the relay's messages handed to the note they belong to.
 */

/** What the pass sync knows that a joining note needs: whether it has unsent changes, and how to keep a copy. */
export interface SyncHooks {
  hasUnsynced(noteId: string): boolean | Promise<boolean>;
  keepCopy(noteId: string, words: string): Promise<void>;
}

let transport: LiveTransport | null = null;
const sessions = new Map<string, LiveSession>();

function connect(): LiveTransport {
  if (transport) return transport;
  transport = new WebSocketTransport({
    url: liveUrl(API_BASE),
    token: () => accountState().session?.token ?? null,
    events: {
      ready: () => {
        // The connection id means something to the relay, which stamps it on messages; nothing here needs it.
      },
      joined: (room, first, peers) => sessions.get(room)?.joined(first, peers),
      peers: (room, peers) => sessions.get(room)?.peersChanged(peers),
      message: (room, from, data) => void sessions.get(room)?.message(from, data),
      down: () => {
        // Nothing to do: the transport comes back by itself and rejoins, and each session catches up on `joined`.
      },
    },
  });
  return transport;
}

/**
 * Makes a note live on this device, or answers null when it will not be: the switch is off, the device is signed out,
 * or it does not hold the account key (it could not seal a word). `words` is the note as the editor has it now.
 */
export async function openLive(noteId: string, words: string, listener: SessionListener, hooks: SyncHooks): Promise<LiveSession | null> {
  if (!liveEnabled() || !accountState().session) return null;
  const key = await accountKey();
  if (!key) return null;
  sessions.get(noteId)?.close();
  const session = new LiveSession(noteId, words, { transport: connect(), key, ...hooks }, listener);
  sessions.set(noteId, session);
  return session;
}

/** Takes a note out of live sync. The connection goes with the last one, so a device with nothing open holds no socket. */
export function closeLive(noteId: string): void {
  sessions.get(noteId)?.close();
  sessions.delete(noteId);
  if (sessions.size === 0) {
    transport?.close();
    transport = null;
  }
}

