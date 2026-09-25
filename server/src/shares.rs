//! Shares: a note or a book, readable by anyone with its link, and nobody else - this service included (docs/SHARING.md).
//!
//! Matt: "share books and notes with people online and allow them to read only the notes and give them areas to fork
//! the note into their own Ghost.md app". A device seals what it shares under a key of its own, made for that share,
//! and puts the key in the link after the `#`, which a browser never sends: so the link reads the share, and the
//! service keeps only ciphertext it cannot open, the same promise sync makes. The owner writes it again as they edit
//! (the reader sees the edits), and takes it down to make the link go dead.
//!
//!   PUT    /glyph/api/v1/shares/{id}   { blob }  the owner's share, made or written again
//!   DELETE /glyph/api/v1/shares/{id}             the owner's share, taken down
//!   GET    /glyph/api/v1/shares                  the owner's shares: ids and when each was last written
//!   GET    /glyph/api/v1/shares/{id}             anyone: the ciphertext, and when it was written
//!
//! An id is the device's own - 128 random bits, base64url - so the link can be made before anything is sent, and one
//! share's id says nothing about another's. Reading is open, so it is rate-limited by address; writing is the owner's.

use crate::accounts::{error, now_secs, Accounts};
use crate::guard;
use crate::store::ShareWrite;
use axum::extract::{ConnectInfo, DefaultBodyLimit, Path, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Instant;

/// A share's ciphertext, as base64url: a book of its index and every chapter, generously.
const SHARE_LIMIT: usize = 6_000_000;
/// The most shares one account keeps up at once.
pub const SHARES_PER_ACCOUNT: i64 = 500;
/// Reads of shares, per address, per minute: a reader opening a book and its chapters, several times over.
const READS_PER_MINUTE: u32 = 240;

pub struct Shares {
    accounts: Arc<Accounts>,
    readers: Mutex<guard::RateLimiter>,
}

impl Shares {
    pub fn new(accounts: Arc<Accounts>) -> Arc<Self> {
        Arc::new(Self { accounts, readers: Mutex::new(guard::RateLimiter::new(READS_PER_MINUTE, Instant::now())) })
    }
}

/// A share's id, as a device makes one: 22 to 64 base64url characters.
fn valid_id(id: &str) -> bool {
    (22..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// What a device sends: base64url ciphertext, not empty, under the limit.
fn valid_blob(blob: &str) -> bool {
    !blob.is_empty() && blob.len() <= SHARE_LIMIT && blob.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

#[derive(Deserialize)]
struct ShareBody {
    blob: String,
}

async fn put_share(State(shares): State<Arc<Shares>>, headers: HeaderMap, Path(id): Path<String>, Json(body): Json<ShareBody>) -> Response {
    let who = match shares.accounts.caller(&headers) {
        Ok(who) => who,
        Err(refused) => return refused,
    };
    if !valid_id(&id) {
        return error(StatusCode::BAD_REQUEST, "That share's id could not be read.");
    }
    if !valid_blob(&body.blob) {
        return error(StatusCode::BAD_REQUEST, "That share is empty or too large.");
    }
    match shares.accounts.store.put_share(who.sub, &id, &body.blob, now_secs(), SHARES_PER_ACCOUNT) {
        Ok(updated) => Json(json!({ "id": id, "updated": updated })).into_response(),
        Err(ShareWrite::Taken) => error(StatusCode::CONFLICT, "That share belongs to someone else."),
        Err(ShareWrite::Full) => error(StatusCode::CONFLICT, "This account shares as much as it can: take a share down first."),
        Err(ShareWrite::Failed) => error(StatusCode::INTERNAL_SERVER_ERROR, "That share could not be kept."),
    }
}

async fn delete_share(State(shares): State<Arc<Shares>>, headers: HeaderMap, Path(id): Path<String>) -> Response {
    let who = match shares.accounts.caller(&headers) {
        Ok(who) => who,
        Err(refused) => return refused,
    };
    if !valid_id(&id) {
        return error(StatusCode::BAD_REQUEST, "That share's id could not be read.");
    }
    // Taking down what is not there, or not yours, answers the same as taking down your own: nothing to learn by asking.
    shares.accounts.store.delete_share(who.sub, &id);
    StatusCode::NO_CONTENT.into_response()
}

async fn list_shares(State(shares): State<Arc<Shares>>, headers: HeaderMap) -> Response {
    let who = match shares.accounts.caller(&headers) {
        Ok(who) => who,
        Err(refused) => return refused,
    };
    let list: Vec<_> = shares.accounts.store.shares_of(who.sub).into_iter().map(|(id, updated)| json!({ "id": id, "updated": updated })).collect();
    Json(json!({ "shares": list })).into_response()
}

async fn read_share(State(shares): State<Arc<Shares>>, ConnectInfo(peer): ConnectInfo<SocketAddr>, headers: HeaderMap, Path(id): Path<String>) -> Response {
    let ip = guard::client_ip(peer.ip(), headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()));
    if !shares.readers.lock().map(|mut l| l.take(ip, Instant::now())).unwrap_or(false) {
        return error(StatusCode::TOO_MANY_REQUESTS, "Too many reads in a minute. Try again shortly.");
    }
    if !valid_id(&id) {
        return error(StatusCode::NOT_FOUND, "Nothing is shared at that link.");
    }
    let Some((blob, updated)) = shares.accounts.store.share(&id) else {
        return error(StatusCode::NOT_FOUND, "Nothing is shared at that link. It may have been taken down.");
    };
    let mut response = Json(json!({ "blob": blob, "updated": updated })).into_response();
    // Always asked again: a reader should see the owner's latest edit, and a share taken down should go at once.
    response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

pub fn router(accounts: Arc<Accounts>) -> Router {
    Router::new()
        .route("/glyph/api/v1/shares", get(list_shares))
        .route(
            "/glyph/api/v1/shares/{id}",
            get(read_share).put(put_share).delete(delete_share).layer(DefaultBodyLimit::max(SHARE_LIMIT + 1024)),
        )
        .with_state(Shares::new(accounts))
}
