//! Live sync's relay (docs/LIVE.md): a WebSocket per device, passing sealed edits between one account's own devices
//! while they have the same note open.
//!
//! It knows accounts and rooms and nothing else. What passes through is ciphertext under a key it never sees - the
//! devices seal every message with the account key before sending - so it cannot read a word, and it keeps nothing:
//! no message is stored or logged. A room is a note id, which the sync feed already shows it.
//!
//! The protocol, all JSON text frames:
//!
//! ```text
//! client -> server   { t: "auth",  token }                 first frame, within AUTH_WAIT, or the socket is closed
//! server -> client   { t: "ready", id }                    this socket's connection id
//! client -> server   { t: "join",  room }
//! client -> server   { t: "leave", room }
//! client -> server   { t: "msg",   room, data, to? }       data: base64url ciphertext; to: one connection, or all
//! server -> client   { t: "joined", room, first, peers }   first: the room was empty until now (see LIVE.md, Seeding)
//! server -> client   { t: "peers",  room, peers }          another device came or went
//! server -> client   { t: "msg",    room, from, data }
//! server -> client   { t: "error",  message }              a frame refused, the socket kept
//! ```
//!
//! A browser cannot put an Authorization header on a WebSocket, so the token comes in the first frame rather than the
//! URL, where access logs would keep it.

use crate::accounts::{now_secs, Accounts};
use axum::extract::ws::{CloseFrame, Message, Utf8Bytes, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::mpsc;

/// How long a new socket has to say who it is.
const AUTH_WAIT: Duration = Duration::from_secs(10);
/// A ping this often keeps phone networks and proxies from dropping a socket that is only listening.
const PING_EVERY: Duration = Duration::from_secs(25);
/// Devices live at once on one account: more than anyone has, fewer than a runaway client would open.
pub const SOCKETS_PER_ACCOUNT: usize = 16;
/// Notes one device can have live at once.
pub const ROOMS_PER_SOCKET: usize = 64;
/// The largest frame, a whole note's document as it joins included.
pub const MAX_FRAME: usize = 64 * 1024;
/// Messages waiting to go out to one device. A device that falls this far behind is closed rather than fed forever:
/// it comes back, asks for the document, and is whole again.
const QUEUE: usize = 128;
/// Frames a device may send: a burst, and a steady rate. Typing is a few a second; a caret moving, a few more.
const BURST: f64 = 200.0;
const PER_SECOND: f64 = 100.0;

/// Close codes. 4000-4999 are the application's own; a client reconnects after all of these but CLOSE_AUTH.
pub const CLOSE_AUTH: u16 = 4401;
pub const CLOSE_BUSY: u16 = 4429;
pub const CLOSE_BAD: u16 = 4400;
pub const CLOSE_BEHIND: u16 = 4408;

pub struct Live {
    accounts: Arc<Accounts>,
    hub: Mutex<Hub>,
    next: AtomicU64,
}

/// Who is where. Members are kept in the order they joined, and a room with none is removed.
#[derive(Default)]
struct Hub {
    rooms: HashMap<(i64, String), Vec<Member>>,
    sockets: HashMap<i64, usize>,
}

#[derive(Clone)]
struct Member {
    id: u64,
    out: mpsc::Sender<Message>,
}

#[derive(Deserialize)]
#[serde(tag = "t", rename_all = "lowercase")]
enum Incoming {
    Join { room: String },
    Leave { room: String },
    Msg { room: String, data: String, to: Option<u64> },
}

#[derive(Deserialize)]
struct Auth {
    t: String,
    token: String,
}

pub fn router(accounts: Arc<Accounts>) -> Router {
    let live = Arc::new(Live { accounts, hub: Mutex::new(Hub::default()), next: AtomicU64::new(1) });
    Router::new().route("/glyph/api/v1/live", get(upgrade)).with_state(live)
}

/// A WebSocket is not covered by CORS, so a page's origin is checked here: the apps' own origins, as the HTTP routes
/// allow them, or the site the service is served from.
///
/// That second half matters and is easy to miss. A browser sends `Origin` on EVERY WebSocket, same-origin included,
/// unlike a same-origin fetch, which is why the HTTP routes' list has no `https://attack.fm` in it - and a check made
/// from that list alone would refuse the web version of Glyph at its own address. So the page's origin is also let in
/// when it names the very host it connected to (behind Caddy, the `Host` it passes on). A client that sends no origin
/// at all - the phone's and the Mac's own networking, a test - is let through: the token is what admits a device, and
/// a page elsewhere never has one.
async fn upgrade(State(live): State<Arc<Live>>, headers: HeaderMap, ws: WebSocketUpgrade) -> Response {
    if let Some(origin) = headers.get("origin") {
        let host = headers.get("host").and_then(|h| h.to_str().ok());
        if !crate::allowed_origin(origin.as_bytes()) && !same_site(origin.to_str().unwrap_or(""), host) {
            return StatusCode::FORBIDDEN.into_response();
        }
    }
    ws.max_message_size(MAX_FRAME).max_frame_size(MAX_FRAME).on_upgrade(move |socket| serve(live, socket))
}

/// A page served over HTTPS from the host this socket reached.
fn same_site(origin: &str, host: Option<&str>) -> bool {
    host.is_some_and(|host| origin.strip_prefix("https://") == Some(host))
}

fn text(value: Value) -> Message {
    Message::Text(Utf8Bytes::from(value.to_string()))
}

fn close(code: u16, reason: &'static str) -> Message {
    Message::Close(Some(CloseFrame { code, reason: Utf8Bytes::from_static(reason) }))
}

/// One room name: a note id, or anything else shaped like one. Kept short and plain so a room is never a way in.
fn valid_room(room: &str) -> bool {
    (1..=64).contains(&room.len()) && room.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// Ciphertext as base64url, and nothing else: the relay only ever carries sealed bytes it cannot read.
fn valid_data(data: &str) -> bool {
    !data.is_empty() && data.len() <= MAX_FRAME && data.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// A token bucket: `BURST` frames at once, refilled at `PER_SECOND`.
struct Bucket {
    tokens: f64,
    at: Instant,
}

impl Bucket {
    fn new(now: Instant) -> Self {
        Bucket { tokens: BURST, at: now }
    }
    fn take(&mut self, now: Instant) -> bool {
        self.tokens = (self.tokens + now.duration_since(self.at).as_secs_f64() * PER_SECOND).min(BURST);
        self.at = now;
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

impl Live {
    fn hub(&self) -> std::sync::MutexGuard<'_, Hub> {
        // A panic while holding the lock leaves the map as it was; carrying on is better than refusing every device.
        self.hub.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Counts a socket against its account, or refuses it.
    fn admit(&self, account: i64) -> bool {
        let mut hub = self.hub();
        let count = hub.sockets.entry(account).or_insert(0);
        if *count >= SOCKETS_PER_ACCOUNT {
            return false;
        }
        *count += 1;
        true
    }

    fn release(&self, account: i64) {
        let mut hub = self.hub();
        if let Some(count) = hub.sockets.get_mut(&account) {
            *count = count.saturating_sub(1);
            if *count == 0 {
                hub.sockets.remove(&account);
            }
        }
    }

    /// Puts a socket in a room. Answers whether it opened the room, and the devices already there, each of which is
    /// told the new count.
    fn join(&self, account: i64, room: &str, member: Member) -> (bool, usize) {
        let mut hub = self.hub();
        let members = hub.rooms.entry((account, room.to_string())).or_default();
        if members.iter().any(|m| m.id == member.id) {
            return (false, members.len() - 1);
        }
        let first = members.is_empty();
        members.push(member);
        let peers = members.len() - 1;
        let told = json!({ "t": "peers", "room": room, "peers": peers });
        for other in members.iter().take(members.len() - 1) {
            let _ = other.out.try_send(text(told.clone()));
        }
        (first, peers)
    }

    /// Takes a socket out of a room, telling whoever is left.
    fn leave(&self, account: i64, room: &str, id: u64) {
        let mut hub = self.hub();
        let key = (account, room.to_string());
        let Some(members) = hub.rooms.get_mut(&key) else { return };
        members.retain(|m| m.id != id);
        if members.is_empty() {
            hub.rooms.remove(&key);
            return;
        }
        let told = text(json!({ "t": "peers", "room": room, "peers": members.len() - 1 }));
        for other in members.iter() {
            let _ = other.out.try_send(told.clone());
        }
    }

    /// Passes a sealed message to the room's other devices, or to one of them. A device whose queue is full has fallen
    /// too far behind to catch up message by message: it is taken out and closed, and comes back whole.
    fn relay(&self, account: i64, room: &str, from: u64, data: &str, to: Option<u64>) {
        let message = text(json!({ "t": "msg", "room": room, "from": from, "data": data }));
        let behind: Vec<Member> = {
            let hub = self.hub();
            let Some(members) = hub.rooms.get(&(account, room.to_string())) else { return };
            members
                .iter()
                .filter(|m| m.id != from && to.is_none_or(|to| m.id == to))
                .filter(|m| matches!(m.out.try_send(message.clone()), Err(mpsc::error::TrySendError::Full(_))))
                .cloned()
                .collect()
        };
        for member in behind {
            self.drop_everywhere(account, member.id);
            // Queued behind what it has not read yet: it arrives when the backlog does, and then the socket ends.
            tokio::spawn(async move {
                let _ = member.out.send(close(CLOSE_BEHIND, "Fell behind. Reconnect.")).await;
            });
        }
    }

    fn drop_everywhere(&self, account: i64, id: u64) {
        let rooms: Vec<String> = {
            let hub = self.hub();
            hub.rooms
                .iter()
                .filter(|((a, _), members)| *a == account && members.iter().any(|m| m.id == id))
                .map(|((_, room), _)| room.clone())
                .collect()
        };
        for room in rooms {
            self.leave(account, &room, id);
        }
    }
}

async fn serve(live: Arc<Live>, mut socket: WebSocket) {
    // Who this is: the first frame, a token, checked by the one verifier every route uses.
    let claims = match tokio::time::timeout(AUTH_WAIT, socket.recv()).await {
        Ok(Some(Ok(Message::Text(frame)))) => serde_json::from_str::<Auth>(&frame)
            .ok()
            .filter(|auth| auth.t == "auth")
            .and_then(|auth| live.accounts.claims(&auth.token)),
        _ => None,
    };
    let Some(claims) = claims else {
        let _ = socket.send(close(CLOSE_AUTH, "Sign in first.")).await;
        return;
    };
    if !live.admit(claims.sub) {
        let _ = socket.send(close(CLOSE_BUSY, "Too many devices are live at once.")).await;
        return;
    }
    let account = claims.sub;
    let id = live.next.fetch_add(1, Ordering::Relaxed);
    let (out, mut outbox) = mpsc::channel::<Message>(QUEUE);
    let (mut sink, mut stream) = socket.split();

    // Everything to this device goes through one queue, so the room's messages and the pings never interleave badly.
    let writer = tokio::spawn(async move {
        let mut ping = tokio::time::interval(PING_EVERY);
        ping.tick().await;
        loop {
            tokio::select! {
                next = outbox.recv() => match next {
                    Some(message) => {
                        let ending = matches!(message, Message::Close(_));
                        if sink.send(message).await.is_err() || ending {
                            break;
                        }
                    }
                    None => break,
                },
                _ = ping.tick() => {
                    if sink.send(Message::Ping(Default::default())).await.is_err() {
                        break;
                    }
                }
            }
        }
    });

    let _ = out.send(text(json!({ "t": "ready", "id": id }))).await;
    let mut rooms: HashSet<String> = HashSet::new();
    let mut bucket = Bucket::new(Instant::now());
    // The socket lasts as long as the token does; the device comes back with a fresh one.
    let ends = tokio::time::sleep(Duration::from_secs(u64::try_from((claims.exp - now_secs()).max(0)).unwrap_or(0)));
    tokio::pin!(ends);

    loop {
        let frame = tokio::select! {
            frame = stream.next() => frame,
            () = &mut ends => {
                let _ = out.send(close(CLOSE_AUTH, "Your session has ended. Sign in again.")).await;
                break;
            }
        };
        let Some(Ok(frame)) = frame else { break };
        let frame = match frame {
            Message::Text(frame) => frame,
            Message::Close(_) => break,
            // Pings are answered by the socket itself; a pong is just the device still being there.
            Message::Ping(_) | Message::Pong(_) => continue,
            Message::Binary(_) => {
                let _ = out.send(close(CLOSE_BAD, "Text frames only.")).await;
                break;
            }
        };
        if !bucket.take(Instant::now()) {
            let _ = out.send(close(CLOSE_BUSY, "Too many messages. Slow down.")).await;
            break;
        }
        let refuse = |message: &'static str| text(json!({ "t": "error", "message": message }));
        match serde_json::from_str::<Incoming>(&frame) {
            Ok(Incoming::Join { room }) => {
                if !valid_room(&room) {
                    let _ = out.try_send(refuse("That room name could not be read."));
                } else if !rooms.contains(&room) && rooms.len() >= ROOMS_PER_SOCKET {
                    let _ = out.try_send(refuse("Too many notes live at once on this device."));
                } else {
                    let (first, peers) = live.join(account, &room, Member { id, out: out.clone() });
                    rooms.insert(room.clone());
                    let _ = out.try_send(text(json!({ "t": "joined", "room": room, "first": first, "peers": peers })));
                }
            }
            Ok(Incoming::Leave { room }) => {
                if rooms.remove(&room) {
                    live.leave(account, &room, id);
                }
            }
            Ok(Incoming::Msg { room, data, to }) => {
                if !rooms.contains(&room) {
                    let _ = out.try_send(refuse("Join the room first."));
                } else if !valid_data(&data) {
                    let _ = out.try_send(refuse("That message could not be read."));
                } else {
                    live.relay(account, &room, id, &data, to);
                }
            }
            Err(_) => {
                let _ = out.try_send(refuse("That frame could not be read."));
            }
        }
    }

    for room in &rooms {
        live.leave(account, room, id);
    }
    live.release(account);
    // Let a close already queued go out before the writer is stopped.
    drop(out);
    let _ = tokio::time::timeout(Duration::from_secs(2), writer).await;
}
