# Live sync

A note open on two devices at once, typed into on either, arriving on the other a character at a time. Matt's brief
(2026-09-18): "make sure notes will be in sync in real time character by character over websockets p2p if possible".
His choice: **a relay on glyph-api now, peer-to-peer later behind the same interface**. It sits on top of the sync in
[SYNC.md](SYNC.md), which stays the durable layer - offline, recordings, pictures, every note that is not open right
now. Live sync is only for what two devices have open at the same moment.

## What it promises

- **Characters, not saves.** A keystroke on one device shows on the others in the time a message takes to cross the
  relay - tens of milliseconds, not the seconds a pass waits.
- **Nothing lost, nothing doubled.** Two people typing in the same line at once both keep what they typed. That is the
  job of a CRDT: [Yjs](https://yjs.dev), with its CodeMirror binding, `y-codemirror.next`.
- **End-to-end encrypted, like everything else.** Every message is sealed with the account key before it leaves the
  device. The relay passes ciphertext it cannot read.

## The pieces

**The relay** - `server/src/live.rs`, a WebSocket at `/glyph/api/v1/live`. It knows accounts and rooms and nothing
else. A browser cannot put an `Authorization` header on a WebSocket, so the socket authenticates with its first frame,
`{ "t": "auth", "token": … }`, checked by the same verifier every other route uses - and a token never rides in a URL,
where logs would keep it. After that:

```
client -> server   { t: "join",  room }                  join a room (a note), and be told who is there
client -> server   { t: "leave", room }
client -> server   { t: "msg",   room, data }            data: base64url ciphertext, passed on untouched
server -> client   { t: "joined", room, first, peers }   first: this socket opened the room (see "Seeding")
server -> client   { t: "peers",  room, peers }          someone came or went
server -> client   { t: "msg",    room, from, data }     from: the sending connection, never the account
```

Rooms belong to an account: a socket only ever reaches its own account's devices. Nothing is stored, and no message
is logged. Limits, so a stuck client cannot hurt anyone else: 16 sockets an account, 64 rooms a socket, 64 KB a
frame, a token bucket of messages per socket, a ping every 25 seconds, and a socket closed when its token expires (the
client comes back with a fresh one).

**The transport** - `src/app/core/live/transport.ts`. One interface (join, leave, send, and what arrives), and a
WebSocket implementation that reconnects with backoff and rejoins its rooms. **Peer-to-peer is a second implementation
of the same interface**: a WebRTC data channel per pair of devices, with the relay carrying the offer, answer and ICE
candidates (sealed like everything else), and falling back to the relay whenever the direct link will not form, which
on phone networks is often. Nothing above the transport changes when it lands.

**The seal** - every message is `crypto.ts`'s AES-256-GCM under the account key, with `live:<note id>` as associated
data, so a message cannot be replayed into another note. The relay sees sizes and timing.

**The document** - `src/app/core/live/doc.ts`. A `Y.Doc` per note in a live session, its text in a `Y.Text`. Inside
the sealed messages: `state` (the whole document, for a device joining), `update` (a change), and `presence` (a caret).

**The binding** - the note's CodeMirror editor gets `yCollab` while a session is live. The editor's own extensions
(boards, marks, the wisp arrivals) read the CodeMirror document as ever and do not know. Undo becomes Yjs's, so one
person's undo takes back their own typing and not the other device's.

## Seeding: the trap

Two devices that each build a `Y.Doc` from the same text get the same words under different CRDT identities, and
merging them **doubles the note**. So a document is made once, by one device, and everyone else adopts it:

1. The relay serialises joins, so exactly one socket opens a room, and `joined` says so (`first: true`).
2. **The first device seeds** the document from its note as it is, and stamps it with a random **seed id**.
3. **Every later device asks for `state`** and adopts the room's document instead of building its own. What it does
   with its own words depends on whether they carry anything the room lacks, which the pass sync already knows (the
   note's fingerprint against the one recorded at its last sync):
   - **Nothing unsynced here:** its words are only behind. It adopts the room's document and that is all.
   - **Changes made here and not yet synced:** a real concurrent edit. It adopts the room's document **and keeps its
     own version as a note of its own** - the rule the pass sync already lives by, a conflict makes a copy, never a
     loss.
   A tempting shortcut is wrong here: diffing the room's words against this device's and replaying the difference.
   When this device is merely behind, that "difference" is the other devices' newer typing, and replaying it undoes
   their work.
4. When the last device leaves, the room is gone; the next to open it seeds again, with a new seed id.
5. **A device that was away** - asleep, off the network - rejoins and exchanges whole documents with the room. If they
   share a seed id they share a history, and Yjs merges them exactly. If the seed ids differ, the room was made again
   while it was gone, and it is treated as joining fresh (step 3), never merged into a lineage it does not share.

## Living with the pass sync

The pass sync makes a conflict copy when a note was changed on two devices and the words differ. While two people type,
their words differ by a few characters in flight at every instant - so a pass in the middle of a session would split the
note in two. **A note in a live session with another device is left out of the pass**, pushed and merged by neither
half. When the session goes quiet, both devices hold the same words (the CRDT's promise), the pass pushes them, the other
device pulls words identical to its own, and nothing is copied.

## What the relay learns

Which account has a note open live, when, on how many devices, and the size and timing of messages. Room names are note
ids, which the sync feed already shows it. Never a word.

## Switched off until it works

Off by default, and on by hand per device under **Settings › Account › Sync › Live typing (trial)** (`core/live/
enabled.ts`, kept on the device and never in the synced settings, so trying it on one device never turns it on for
another). It applies to the next note opened. Off, none of it is even loaded: the note screen imports the live code on
demand (`core/live/open.ts`), so Yjs and its binding are not in the app everyone downloads - measured in the browser,
with the switch off no live module is fetched at all, and undo works exactly as it did.

While a note is live with another device, the top bar shows a small **Live** with a green dot (editor/NoteScreen.tsx),
so a person trying it can see the two are joined up.

The wisp arrivals livelock (editor/wispArrivals.ts), which a paragraph pasted on another device could have set off,
was fixed before this shipped.

## Where the pieces are

| | |
| --- | --- |
| `server/src/live.rs` | the relay: auth by first frame, rooms per account, an origin check that allows the site's own page |
| `core/live/wire.ts` | the sealed envelope: kind byte, payload, AES-GCM under the account key, `live:<note id>` bound in |
| `core/live/transport.ts` | the WebSocket: sign-in, rejoin after a drop, backoff with jitter, reconnect on wake or network |
| `core/live/session.ts` | one note's Yjs document: seed or adopt, the conflict-copy rule, whole-document catch-up |
| `core/live/hub.ts` | one connection for the device, shared by every live note, closed with the last |
| `core/live/shared.ts` | which notes are live with another device, for the pass sync to skip - no Yjs in it |
| `core/live/open.ts` | the one door the note screen uses, loaded only when the switch is on |
| `editor/liveBinding.ts`, `editor/undoSlot.ts` | `yCollab` on the editor, and undo in a slot so Yjs's can stand in |

## How it was proven

- **The relay** (`server/src/live_tests.rs`, over a real socket): sign-in first or closed with 4401; an edit reaches
  the account's other device and not its own; another account in a room of the same name hears nothing; a message to
  one device; leaving told to the others; bad frames refused without dropping the socket; an oversized frame ends it;
  a foreign origin refused, the site's own and the apps' let in. Two of these were proven able to fail by breaking
  what they guard and watching them go red.
- **The document** (`core/live/session.test.ts`, through a relay in memory): made once and adopted, never built twice;
  typing both ways; two people typing into one spot both kept; behind adopts with no copy; unsynced changes kept as a
  copy; the first to go leaves the next to make it. Making every device seed its own - the trap - fails five of them.
- **The whole path** (`core/live/live.e2e.test.ts`, two devices through a local glyph-api running the code on the box):
  a keystroke crossed in **2.8 ms median** on one machine (sealing, the relay, opening, applying); concurrent typing,
  a device away and back, and the server's database never holding a word.
- **The app** (two browser windows as two devices, against the same local glyph-api): the note carried from one to the
  other by the ordinary pass sync, **Live** on both, typing at 40 ms a key arriving as it was typed in both directions,
  both editors reading the same, and **Cmd-Z on one undoing only that device's own typing**.
- **The box**: the relay deployed with glyph-api and checked from outside - the site's origin and the apps' upgraded
  (101), a foreign one refused (403), a made-up token closed with 4401.

What none of that can be is two real devices on real networks, which is the last step before it goes on for everyone.
