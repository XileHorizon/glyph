import * as Y from 'yjs';
import { markShared } from './shared.ts';
import type { LiveTransport } from './transport.ts';
import { Kind, newSeed, openEnvelope, packState, sealEnvelope, unpackState, type Envelope } from './wire.ts';

/**
 * One note, live on this device (docs/LIVE.md): its CRDT document, how it came to be, and what goes out and comes in.
 *
 * The document is made once, by the first device into the room, and adopted by every other - never built twice, since
 * two documents built from the same words merge into the words twice. The session only moves bytes and decides
 * whose document stands; the editor binds to `text` once `ready` says the document holds the note.
 */

/** A change that came from another device: applied, but not sent back out. */
export const REMOTE = Symbol('live: from another device');

export interface SessionDeps {
  transport: LiveTransport;
  key: CryptoKey;
  /** Whether this device's copy of the note has changes the pass sync has not sent yet (its fingerprint moved). */
  hasUnsynced(noteId: string): boolean | Promise<boolean>;
  /** Keeps this device's words as a note of their own: the conflict rule, a copy and never a loss. */
  keepCopy(noteId: string, words: string): Promise<void>;
  /** For tests: when to ask again for a document that has not come. */
  schedule?: (run: () => void, ms: number) => unknown;
}

export type SessionState = 'joining' | 'waiting' | 'ready' | 'closed';

export interface SessionListener {
  /** The document holds the note: bind the editor to `text`, whose words may differ from what the editor shows. */
  ready(words: string): void;
  /** How many other devices have the note open right now. */
  peers(count: number): void;
}

/** How long a device that was not first waits for a document before asking again. */
const ASK_AGAIN_MS = 2500;
const ASKS = 3;

export class LiveSession {
  readonly doc = new Y.Doc();
  readonly text = this.doc.getText('body');
  state: SessionState = 'joining';
  seed: string | null = null;
  private others = 0;
  private asks = 0;
  private retry: unknown = null;
  /** Outgoing messages, one after another: sealing is asynchronous, and the order they were made in is kept. */
  private sending: Promise<void> = Promise.resolve();

  constructor(
    readonly noteId: string,
    /** The note as this device has it, when the session began. */
    private readonly words: string,
    private readonly deps: SessionDeps,
    private readonly listener: SessionListener,
  ) {
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE || this.state !== 'ready') return;
      this.post({ kind: Kind.Update, payload: update });
    });
    deps.transport.join(noteId);
  }

  get peers(): number {
    return this.others;
  }

  /** The relay put this device in the room: the first seeds, the rest ask. Also on every rejoin after a drop. */
  joined(first: boolean, peers: number): void {
    this.setPeers(peers);
    if (this.state === 'ready') {
      // Back after a drop. Alone, the document here is the room's; with others, trade whole documents, which Yjs
      // merges exactly when they share a seed (and `message` below handles the case where they do not).
      if (!first) {
        this.post({ kind: Kind.Query, payload: new Uint8Array() });
        this.post({ kind: Kind.State, payload: packState(this.seed!, Y.encodeStateAsUpdate(this.doc)) });
      }
      return;
    }
    if (first) {
      this.seedHere();
      return;
    }
    this.state = 'waiting';
    this.ask();
  }

  /** Another device came or went. The last one leaving while this one waits makes it the first after all. */
  peersChanged(peers: number): void {
    this.setPeers(peers);
    if (this.state === 'waiting' && peers === 0) this.seedHere();
  }

  /** A sealed message from another device. One that will not open is dropped: it is not ours to act on. */
  async message(from: number, data: string): Promise<void> {
    let envelope: Envelope;
    try {
      envelope = await openEnvelope(this.deps.key, this.noteId, data);
    } catch {
      return;
    }
    if (this.state === 'closed') return;
    switch (envelope.kind) {
      case Kind.Query:
        if (this.state === 'ready') {
          this.post({ kind: Kind.State, payload: packState(this.seed!, Y.encodeStateAsUpdate(this.doc)) }, from);
        }
        break;
      case Kind.State:
        await this.stateFrom(envelope.payload);
        break;
      case Kind.Update:
        // Safe before the document has come: Yjs holds a change whose history it has not seen until that history
        // arrives, and then applies both.
        Y.applyUpdate(this.doc, envelope.payload, REMOTE);
        break;
      default:
        break;
    }
  }

  close(): void {
    if (this.state === 'closed') return;
    this.state = 'closed';
    markShared(this.noteId, false);
    this.clearRetry();
    this.deps.transport.leave(this.noteId);
    this.doc.destroy();
  }

  private async stateFrom(payload: Uint8Array): Promise<void> {
    const { seed, state } = unpackState(payload);
    if (this.state === 'ready' && seed === this.seed) {
      // The same history: whatever the other device has that this one does not simply merges in.
      Y.applyUpdate(this.doc, state, REMOTE);
      return;
    }
    if (this.state !== 'waiting' && this.state !== 'ready') return;
    if (this.state === 'ready') {
      // A different history met after a drop: the room was made again while this device was away. Merging two
      // histories doubles the words, so it is not done; this device's session ends and the editor opens a new one,
      // which joins fresh and follows the rules of a first meeting.
      this.close();
      return;
    }
    this.clearRetry();
    // Adopt the room's document, whole.
    Y.applyUpdate(this.doc, state, REMOTE);
    this.seed = seed;
    const roomWords = this.text.toString();
    // This device's words were only behind, or carry changes of their own: the second keeps them, as a note beside.
    if (roomWords !== this.words && (await this.deps.hasUnsynced(this.noteId))) {
      await this.deps.keepCopy(this.noteId, this.words);
    }
    this.state = 'ready';
    this.share();
    this.listener.ready(roomWords);
  }

  private seedHere(): void {
    this.clearRetry();
    this.seed = newSeed();
    this.doc.transact(() => this.text.insert(0, this.words), REMOTE);
    this.state = 'ready';
    this.share();
    this.listener.ready(this.words);
  }

  private ask(): void {
    if (this.state !== 'waiting') return;
    if (this.asks >= ASKS) {
      // Nobody has answered. With nobody there, this device makes the document; with somebody there who will not
      // answer, it stays out of the room rather than risk a second history.
      if (this.others === 0) this.seedHere();
      return;
    }
    this.asks += 1;
    this.post({ kind: Kind.Query, payload: new Uint8Array() });
    this.retry = (this.deps.schedule ?? setTimeout)(() => {
      this.retry = null;
      this.ask();
    }, ASK_AGAIN_MS);
  }

  private post(envelope: Envelope, to?: number): void {
    const { transport, key } = this.deps;
    this.sending = this.sending
      .then(async () => {
        if (this.state === 'closed') return;
        transport.send(this.noteId, await sealEnvelope(key, this.noteId, envelope), to);
      })
      .catch(() => {
        // A message that could not be sealed is one fewer keystroke on the other device, not a reason to stop; the
        // next whole-document exchange carries it.
      });
  }

  private setPeers(peers: number): void {
    this.others = peers;
    this.listener.peers(peers);
    this.share();
  }

  /** Tells the pass sync whether to leave this note alone: ready, and another device in it (core/live/shared.ts). */
  private share(): void {
    markShared(this.noteId, this.state === 'ready' && this.others > 0);
  }

  private clearRetry(): void {
    if (this.retry !== null) clearTimeout(this.retry as ReturnType<typeof setTimeout>);
    this.retry = null;
  }
}
