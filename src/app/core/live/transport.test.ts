import { describe, expect, it } from 'vitest';
import { WebSocketTransport, liveUrl, type LiveEvents } from './transport.ts';

/** A socket that records what a device sends and lets the test play the relay. */
class FakeSocket {
  static made: FakeSocket[] = [];
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.made.push(this);
  }
  send(text: string) {
    this.sent.push(JSON.parse(text));
  }
  close() {
    this.readyState = 3;
  }
  // The relay's side.
  opens() {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }
  says(frame: object) {
    this.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent);
  }
  drops(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code } as CloseEvent);
  }
}

function recorder() {
  const heard: string[] = [];
  const events: LiveEvents = {
    ready: (id) => heard.push(`ready ${id}`),
    joined: (room, first, peers) => heard.push(`joined ${room} first=${first} peers=${peers}`),
    peers: (room, peers) => heard.push(`peers ${room} ${peers}`),
    message: (room, from, data) => heard.push(`msg ${room} from=${from} ${data}`),
    down: (why) => heard.push(`down ${why}`),
  };
  return { heard, events };
}

function transport(events: LiveEvents, token: () => string | null = () => 'tok') {
  FakeSocket.made = [];
  const retries: (() => void)[] = [];
  const t = new WebSocketTransport({
    url: 'wss://example/live',
    token,
    events,
    socket: FakeSocket as never,
    schedule: (run) => retries.push(run),
  });
  return { t, retries, socket: () => FakeSocket.made[FakeSocket.made.length - 1]! };
}

describe('the relay transport', () => {
  it('finds the relay beside the service', () => {
    expect(liveUrl('https://attack.fm/glyph/api')).toBe('wss://attack.fm/glyph/api/v1/live');
    expect(liveUrl('http://127.0.0.1:8796/glyph/api')).toBe('ws://127.0.0.1:8796/glyph/api/v1/live');
  });

  it('signs in with its first frame, and says nothing else until the relay is ready', () => {
    const { heard, events } = recorder();
    const { t, socket } = transport(events);
    t.join('note');
    socket().opens();
    // The join asked for before the relay was ready is not sent early: only the sign-in is.
    expect(socket().sent).toEqual([{ t: 'auth', token: 'tok' }]);
    socket().says({ t: 'ready', id: 7 });
    expect(socket().sent[1]).toEqual({ t: 'join', room: 'note' });
    socket().says({ t: 'joined', room: 'note', first: true, peers: 0 });
    socket().says({ t: 'msg', room: 'note', from: 9, data: 'abc' });
    expect(heard).toEqual(['ready 7', 'joined note first=true peers=0', 'msg note from=9 abc']);
  });

  it('comes back after a drop and rejoins every room it was in', () => {
    const { heard, events } = recorder();
    const { t, retries, socket } = transport(events);
    t.join('a');
    t.join('b');
    socket().opens();
    socket().says({ t: 'ready', id: 1 });
    socket().drops();
    expect(heard).toContain('down network');
    expect(retries).toHaveLength(1);
    retries[0]!();
    const again = socket();
    again.opens();
    again.says({ t: 'ready', id: 2 });
    expect(again.sent).toEqual([{ t: 'auth', token: 'tok' }, { t: 'join', room: 'a' }, { t: 'join', room: 'b' }]);
  });

  it('does not keep knocking once the relay has refused the token', () => {
    const { heard, events } = recorder();
    const { retries, socket } = transport(events);
    socket().opens();
    socket().drops(4401);
    expect(heard).toEqual(['down signIn']);
    expect(retries).toHaveLength(0);
  });

  it('does not connect at all while signed out', () => {
    const { heard, events } = recorder();
    transport(events, () => null);
    expect(FakeSocket.made).toHaveLength(0);
    expect(heard).toEqual(['down signIn']);
  });

  it('sends only into rooms it is in, and nothing while down', () => {
    const { events } = recorder();
    const { t, socket } = transport(events);
    socket().opens();
    socket().says({ t: 'ready', id: 1 });
    t.send('not-joined', 'x');
    t.join('n');
    t.send('n', 'y', 4);
    t.leave('n');
    t.send('n', 'z');
    expect(socket().sent.slice(1)).toEqual([
      { t: 'join', room: 'n' },
      { t: 'msg', room: 'n', data: 'y', to: 4 },
      { t: 'leave', room: 'n' },
    ]);
  });
});
