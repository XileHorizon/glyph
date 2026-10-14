/**
 * How live sync's sealed messages travel (docs/LIVE.md, "The transport").
 *
 * One interface, so the relay is one way to carry them and a peer-to-peer data channel can be another later: nothing
 * above this file knows which it has. `WebSocketTransport` is the relay: one socket per device, signed in with its
 * first frame, its rooms rejoined whenever it comes back.
 */

export interface LiveEvents {
  /** Signed in: this socket's connection id, which is what `from` means on a message. */
  ready(id: number): void;
  /** In a room. `first`: the room was empty until now, so this device makes the document (LIVE.md, Seeding). */
  joined(room: string, first: boolean, peers: number): void;
  /** Another device came into a room or left it: how many others are there now. */
  peers(room: string, peers: number): void;
  /** A sealed message from another device, not yet opened. */
  message(room: string, from: number, data: string): void;
  /** The connection is gone. `signIn`: the relay refused the token, so there is no point trying again until it changes. */
  down(why: 'signIn' | 'network'): void;
}

export interface LiveTransport {
  join(room: string): void;
  leave(room: string): void;
  /** To every other device in the room, or to one of them. Dropped while disconnected: a room is whole again on rejoin. */
  send(room: string, data: string, to?: number): void;
  close(): void;
}

/** The relay's address, from the service's: `https://attack.fm/glyph/api` becomes `wss://attack.fm/glyph/api/v1/live`. */
export function liveUrl(apiBase: string): string {
  return `${apiBase.replace(/^http(s?):\/\//, (_, secure: string) => `ws${secure}://`)}/v1/live`;
}

/** The close code the relay sends when the token is refused or has run out (server/src/live.rs CLOSE_AUTH). */
const CLOSE_SIGN_IN = 4401;

/** Waits between attempts: quick at first, since a phone on a train drops and comes back often, then no faster than this. */
const FIRST_WAIT_MS = 500;
const LONGEST_WAIT_MS = 30_000;

type Socket = Pick<WebSocket, 'send' | 'close' | 'readyState'> & {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
};

export interface WebSocketTransportOptions {
  url: string;
  /** The session token now, or null when signed out. Read at every connect, so a renewed token is picked up. */
  token: () => string | null;
  events: LiveEvents;
  /** A WebSocket constructor, for tests; the page's own otherwise. */
  socket?: new (url: string) => Socket;
  /** For tests: when to try again, so a test need not wait out real backoff. */
  schedule?: (run: () => void, ms: number) => unknown;
}

export class WebSocketTransport implements LiveTransport {
  private socket: Socket | null = null;
  private open = false;
  private closed = false;
  private attempt = 0;
  private retry: unknown = null;
  private readonly rooms = new Set<string>();
  private readonly options: WebSocketTransportOptions;
  private readonly wake = () => this.soon();

  constructor(options: WebSocketTransportOptions) {
    this.options = options;
    // A phone that wakes or finds its network again should not wait out a backoff meant for a flaky line.
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.wake);
      document.addEventListener('visibilitychange', this.wake);
    }
    this.connect();
  }

  join(room: string): void {
    this.rooms.add(room);
    this.frame({ t: 'join', room });
  }

  leave(room: string): void {
    if (!this.rooms.delete(room)) return;
    this.frame({ t: 'leave', room });
  }

  send(room: string, data: string, to?: number): void {
    if (!this.rooms.has(room)) return;
    this.frame(to === undefined ? { t: 'msg', room, data } : { t: 'msg', room, data, to });
  }

  close(): void {
    this.closed = true;
    this.clearRetry();
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.wake);
      document.removeEventListener('visibilitychange', this.wake);
    }
    this.socket?.close();
    this.socket = null;
    this.open = false;
  }

  private frame(value: object): void {
    if (this.open && this.socket) this.socket.send(JSON.stringify(value));
  }

  private connect(): void {
    if (this.closed || this.socket) return;
    const token = this.options.token();
    if (!token) {
      this.options.events.down('signIn');
      return;
    }
    const Make = this.options.socket ?? (WebSocket as unknown as new (url: string) => Socket);
    const socket = new Make(this.options.url);
    this.socket = socket;
    socket.onopen = () => socket.send(JSON.stringify({ t: 'auth', token }));
    socket.onmessage = (event) => this.receive(event.data);
    socket.onerror = () => {
      // onclose follows and decides what happens next.
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.open = false;
      if (this.closed) return;
      if (event.code === CLOSE_SIGN_IN) {
        this.options.events.down('signIn');
        return;
      }
      this.options.events.down('network');
      this.later();
    };
  }

  private receive(raw: unknown): void {
    let frame: { t?: string; id?: number; room?: string; first?: boolean; peers?: number; from?: number; data?: string };
    try {
      frame = JSON.parse(String(raw));
    } catch {
      return;
    }
    const { events } = this.options;
    switch (frame.t) {
      case 'ready':
        this.open = true;
        this.attempt = 0;
        events.ready(Number(frame.id));
        // Back in every room it was in. The relay answers each with `joined`, and the document above catches up.
        for (const room of this.rooms) this.frame({ t: 'join', room });
        break;
      case 'joined':
        if (frame.room) events.joined(frame.room, Boolean(frame.first), Number(frame.peers ?? 0));
        break;
      case 'peers':
        if (frame.room) events.peers(frame.room, Number(frame.peers ?? 0));
        break;
      case 'msg':
        if (frame.room && typeof frame.data === 'string') events.message(frame.room, Number(frame.from), frame.data);
        break;
      default:
        // `error` frames say a request was refused; the socket stays, and there is nothing a device can do about one.
        break;
    }
  }

  private later(): void {
    this.clearRetry();
    const wait = Math.min(LONGEST_WAIT_MS, FIRST_WAIT_MS * 2 ** this.attempt);
    this.attempt += 1;
    // Jittered, so a relay restart is not met by every device at the same instant.
    const ms = wait / 2 + Math.random() * (wait / 2);
    this.retry = (this.options.schedule ?? setTimeout)(() => {
      this.retry = null;
      this.connect();
    }, ms);
  }

  /** Now rather than after the backoff: the page came back into view, or the network did. */
  private soon(): void {
    if (this.closed || this.socket) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    this.clearRetry();
    this.attempt = 0;
    this.connect();
  }

  private clearRetry(): void {
    if (this.retry !== null) clearTimeout(this.retry as ReturnType<typeof setTimeout>);
    this.retry = null;
  }
}
