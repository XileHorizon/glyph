//! Live sync's relay (src/live.rs, docs/LIVE.md), over a real socket: the in-memory router the other tests drive cannot
//! upgrade a connection, so these start the service on a loopback port and talk to it as a device does.

use crate::accounts::{Accounts, RECOVERY_CODES};
use crate::live::{CLOSE_AUTH, MAX_FRAME};
use crate::store::Store;
use crate::{app_with, model, router};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::net::SocketAddr;
use std::time::Duration;
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

struct Server {
    addr: SocketAddr,
    _dir: TempDir,
}

struct TempDir(std::path::PathBuf);
impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

async fn server() -> Server {
    let dir = std::env::temp_dir().join(format!("glyph-live-{}-{}", std::process::id(), rand::random::<u64>()));
    std::fs::create_dir_all(&dir).unwrap();
    let accounts = Accounts::new(std::sync::Arc::new(Store::in_memory(dir.join("recordings"))));
    let app = app_with("0".repeat(64), model::Ollama::new("http://127.0.0.1:9", "test-model"));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, router(app, Some(accounts)).into_make_service_with_connect_info::<SocketAddr>()).await.unwrap();
    });
    Server { addr, _dir: TempDir(dir) }
}

impl Server {
    /// A new account, signed up the way a device does it; answers its token.
    async fn account(&self, handle: &str) -> String {
        let hex = |seed: u8| format!("{seed:02x}").repeat(32);
        let sheet: Vec<Value> = (0..RECOVERY_CODES)
            .map(|i| json!({ "login": hex(100 + i as u8), "wrapped": URL_SAFE_NO_PAD.encode(format!("code{i}")) }))
            .collect();
        let body: Value = reqwest::Client::new()
            .post(format!("http://{}/glyph/api/v1/signup", self.addr))
            .json(&json!({ "handle": handle, "loginSecret": hex(1), "wrapped": URL_SAFE_NO_PAD.encode("password"), "recovery": sheet }))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        body["token"].as_str().expect("a token").to_string()
    }

    fn url(&self) -> String {
        format!("ws://{}/glyph/api/v1/live", self.addr)
    }

    /// A device on the socket, signed in: answers it and its connection id.
    async fn device(&self, token: &str) -> (Socket, u64) {
        let (mut socket, _) = connect_async(self.url()).await.unwrap();
        send(&mut socket, json!({ "t": "auth", "token": token })).await;
        let ready = next(&mut socket).await;
        assert_eq!(ready["t"], "ready", "{ready}");
        (socket, ready["id"].as_u64().unwrap())
    }
}

async fn send(socket: &mut Socket, value: Value) {
    socket.send(Message::Text(value.to_string().into())).await.unwrap();
}

/// The next frame with words in it, skipping the relay's pings.
async fn next(socket: &mut Socket) -> Value {
    loop {
        let frame = tokio::time::timeout(Duration::from_secs(3), socket.next()).await.expect("a frame in time").expect("open").unwrap();
        match frame {
            Message::Text(text) => return serde_json::from_str(&text).unwrap(),
            Message::Close(frame) => return json!({ "closed": frame.map(|f| u16::from(f.code)) }),
            _ => continue,
        }
    }
}

/// Nothing arrives for a while - what a device should see of a message not meant for it.
async fn silent(socket: &mut Socket) {
    match tokio::time::timeout(Duration::from_millis(300), socket.next()).await {
        Err(_) => {}
        Ok(Some(Ok(Message::Ping(_) | Message::Pong(_)))) => {}
        Ok(other) => panic!("expected nothing, got {other:?}"),
    }
}

fn sealed(tag: &str) -> String {
    URL_SAFE_NO_PAD.encode(format!("ciphertext:{tag}"))
}

#[tokio::test]
async fn a_socket_must_say_who_it_is_first() {
    let s = server().await;
    // A frame that is not a sign-in, and then a sign-in with a token that is not one: both closed with the code
    // a device reads as "sign in again".
    for first in [json!({ "t": "join", "room": "a" }), json!({ "t": "auth", "token": "glyph1.not.ours" })] {
        let (mut socket, _) = connect_async(s.url()).await.unwrap();
        send(&mut socket, first).await;
        assert_eq!(next(&mut socket).await, json!({ "closed": CLOSE_AUTH }));
    }
}

#[tokio::test]
async fn an_edit_reaches_the_accounts_other_device_and_not_its_own() {
    let s = server().await;
    let token = s.account("matt").await;
    let (mut phone, phone_id) = s.device(&token).await;
    let (mut mac, mac_id) = s.device(&token).await;

    send(&mut phone, json!({ "t": "join", "room": "note-1" })).await;
    assert_eq!(next(&mut phone).await, json!({ "t": "joined", "room": "note-1", "first": true, "peers": 0 }));
    send(&mut mac, json!({ "t": "join", "room": "note-1" })).await;
    // The second in is not first - it asks for the document rather than making one (LIVE.md, Seeding).
    assert_eq!(next(&mut mac).await, json!({ "t": "joined", "room": "note-1", "first": false, "peers": 1 }));
    assert_eq!(next(&mut phone).await, json!({ "t": "peers", "room": "note-1", "peers": 1 }));

    send(&mut phone, json!({ "t": "msg", "room": "note-1", "data": sealed("h") })).await;
    assert_eq!(next(&mut mac).await, json!({ "t": "msg", "room": "note-1", "from": phone_id, "data": sealed("h") }));
    silent(&mut phone).await;

    send(&mut mac, json!({ "t": "msg", "room": "note-1", "data": sealed("i") })).await;
    assert_eq!(next(&mut phone).await, json!({ "t": "msg", "room": "note-1", "from": mac_id, "data": sealed("i") }));
}

#[tokio::test]
async fn another_account_in_a_room_of_the_same_name_hears_nothing() {
    let s = server().await;
    let (mut mine, _) = s.device(&s.account("matt").await).await;
    let (mut theirs, _) = s.device(&s.account("someone").await).await;
    send(&mut mine, json!({ "t": "join", "room": "note-1" })).await;
    next(&mut mine).await;
    send(&mut theirs, json!({ "t": "join", "room": "note-1" })).await;
    // Rooms belong to an account: the other account opens its own, and is first in it.
    assert_eq!(next(&mut theirs).await, json!({ "t": "joined", "room": "note-1", "first": true, "peers": 0 }));
    send(&mut mine, json!({ "t": "msg", "room": "note-1", "data": sealed("secret") })).await;
    silent(&mut theirs).await;
}

#[tokio::test]
async fn a_message_can_go_to_one_device() {
    let s = server().await;
    let token = s.account("matt").await;
    let (mut a, _) = s.device(&token).await;
    let (mut b, b_id) = s.device(&token).await;
    let (mut c, _) = s.device(&token).await;
    for socket in [&mut a, &mut b, &mut c] {
        send(socket, json!({ "t": "join", "room": "n" })).await;
    }
    // Drain the joins and the peer counts they caused.
    for _ in 0..3 {
        next(&mut a).await;
    }
    for _ in 0..2 {
        next(&mut b).await;
    }
    next(&mut c).await;
    // A whole document for the device that asked for it, not for everyone in the room.
    send(&mut a, json!({ "t": "msg", "room": "n", "data": sealed("state"), "to": b_id })).await;
    assert_eq!(next(&mut b).await["data"], sealed("state"));
    silent(&mut c).await;
}

#[tokio::test]
async fn a_device_leaving_is_told_to_the_others() {
    let s = server().await;
    let token = s.account("matt").await;
    let (mut a, _) = s.device(&token).await;
    let (mut b, _) = s.device(&token).await;
    send(&mut a, json!({ "t": "join", "room": "n" })).await;
    next(&mut a).await;
    send(&mut b, json!({ "t": "join", "room": "n" })).await;
    next(&mut b).await;
    next(&mut a).await;
    send(&mut b, json!({ "t": "leave", "room": "n" })).await;
    assert_eq!(next(&mut a).await, json!({ "t": "peers", "room": "n", "peers": 0 }));
    // And a socket that simply goes, as a phone does when it sleeps.
    send(&mut b, json!({ "t": "join", "room": "n" })).await;
    next(&mut b).await;
    next(&mut a).await;
    drop(b);
    assert_eq!(next(&mut a).await, json!({ "t": "peers", "room": "n", "peers": 0 }));
}

#[tokio::test]
async fn it_refuses_what_it_should_not_carry_and_keeps_the_socket() {
    let s = server().await;
    let (mut a, _) = s.device(&s.account("matt").await).await;
    // Not in the room yet.
    send(&mut a, json!({ "t": "msg", "room": "n", "data": sealed("x") })).await;
    assert_eq!(next(&mut a).await["t"], "error");
    // A room name that is not one.
    send(&mut a, json!({ "t": "join", "room": "../../etc" })).await;
    assert_eq!(next(&mut a).await["t"], "error");
    // Words rather than sealed bytes: the relay only carries base64url it cannot read.
    send(&mut a, json!({ "t": "join", "room": "n" })).await;
    next(&mut a).await;
    send(&mut a, json!({ "t": "msg", "room": "n", "data": "plain words, not ciphertext" })).await;
    assert_eq!(next(&mut a).await["t"], "error");
    // Still open after all that.
    send(&mut a, json!({ "t": "leave", "room": "n" })).await;
    send(&mut a, json!({ "t": "join", "room": "m" })).await;
    assert_eq!(next(&mut a).await["t"], "joined");
}

#[tokio::test]
async fn a_frame_past_the_limit_ends_the_socket() {
    let s = server().await;
    let (mut a, _) = s.device(&s.account("matt").await).await;
    send(&mut a, json!({ "t": "join", "room": "n" })).await;
    next(&mut a).await;
    let too_big = "A".repeat(MAX_FRAME + 1);
    let _ = a.send(Message::Text(json!({ "t": "msg", "room": "n", "data": too_big }).to_string().into())).await;
    let ended = tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            match a.next().await {
                None | Some(Err(_)) => return true,
                Some(Ok(Message::Close(_))) => return true,
                Some(Ok(_)) => continue,
            }
        }
    })
    .await
    .unwrap_or(false);
    assert!(ended, "a frame over MAX_FRAME must end the socket");
}

#[tokio::test]
async fn a_page_from_elsewhere_cannot_open_one() {
    let s = server().await;
    let mut request = s.url().into_client_request().unwrap();
    request.headers_mut().insert("origin", HeaderValue::from_static("https://evil.example"));
    assert!(connect_async(request).await.is_err(), "an origin the HTTP routes refuse must be refused here too");
    // The Mac and phone apps' own origin is let in.
    let mut request = s.url().into_client_request().unwrap();
    request.headers_mut().insert("origin", HeaderValue::from_static("tauri://localhost"));
    assert!(connect_async(request).await.is_ok());
    // And the page served from this very host: a browser sends Origin on every WebSocket, same-origin included, so
    // without this the web version would be refused at its own address.
    let mut request = s.url().into_client_request().unwrap();
    let own = format!("https://{}", s.addr);
    request.headers_mut().insert("origin", HeaderValue::from_str(&own).unwrap());
    assert!(connect_async(request).await.is_ok(), "the site's own page must be let in");
    // But not a page that merely names a host of its own.
    let mut request = s.url().into_client_request().unwrap();
    request.headers_mut().insert("origin", HeaderValue::from_static("https://attack.fm.evil.example"));
    assert!(connect_async(request).await.is_err());
}
