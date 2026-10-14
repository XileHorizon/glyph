//! Sync: an account's notes, settings and recordings, as ciphertext, kept the same on every device (docs/SYNC.md).
//!
//! AttackFM's two shapes, copied: its library's change feed (a revision counter, deletions kept as markers, paged),
//! and its settings blob (written from a revision, refused with the winner when stale). The one difference is that
//! every device writes notes here, not only the server, so a note is written from the revision it was last seen at,
//! exactly as the settings blob is.
//!
//!   GET    /glyph/api/v1/notes?since=&limit=   the feed: every note written after `since`
//!   PUT    /glyph/api/v1/notes/{id}            { base, blob } a note, or 409 with the one that won
//!   DELETE /glyph/api/v1/notes/{id}            { base } a deletion, the same way
//!   GET    /glyph/api/v1/prefs                 the settings
//!   PUT    /glyph/api/v1/prefs                 { base, blob }
//!   GET    /glyph/api/v1/recordings/{id}       a recording's bytes, its revision in `x-glyph-rev`
//!   PUT    /glyph/api/v1/recordings/{id}?base= a recording's bytes
//!
//! Every body here is something a device encrypted. The service checks sizes and shapes, never content.

use crate::accounts::{error, now_secs, Accounts};
use crate::store::{NoteRow, WriteError};
use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, Path, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;

/// A note's ciphertext, as base64: a megabyte of note and its encoding.
const NOTE_LIMIT: usize = 1_400_000;
/// Settings, as base64.
const PREFS_LIMIT: usize = 350_000;
/// A recording's ciphertext. A long voice note at 16 kHz mono is a few megabytes; this is well past any of them.
const RECORDING_LIMIT: usize = 64 * 1024 * 1024;
/// The most notes one page of the feed carries.
const PAGE_LIMIT: i64 = 500;

/// Ids are the app's own: UUIDs, or its older `n-…` form. Anything else is refused before it reaches a path.
fn valid_id(id: &str) -> bool {
    (1..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// A blob is base64url, as a device writes it.
fn valid_blob(blob: &str, limit: usize) -> bool {
    !blob.is_empty() && blob.len() <= limit && blob.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn note_json(note: &NoteRow) -> serde_json::Value {
    json!({ "id": note.id, "rev": note.rev, "deleted": note.deleted, "blob": note.blob })
}

#[derive(Deserialize)]
struct FeedQuery {
    #[serde(default)]
    since: i64,
    limit: Option<i64>,
}

async fn feed(State(accounts): State<Arc<Accounts>>, headers: HeaderMap, Query(query): Query<FeedQuery>) -> Response {
    let who = match accounts.caller(&headers) {
        Ok(who) => who,
        Err(refused) => return refused,
    };
    let limit = query.limit.unwrap_or(PAGE_LIMIT).clamp(1, PAGE_LIMIT);
    match accounts.store.notes_since(who.sub, query.since.max(0), limit) {
        Ok((notes, more, head)) => {
            // The cursor is the last note given when there is more to come, and the account's head when there is not,
            // so a device that has everything also knows it has seen every write up to now.
            let rev = if more { notes.last().map(|n| n.rev).unwrap_or(head) } else { head };
            Json(json!({ "rev": rev, "items": notes.iter().map(note_json).collect::<Vec<_>>(), "more": more })).into_response()
        }
        Err(_) => error(StatusCode::INTERNAL_SERVER_ERROR, "The notes could not be read."),
    }
}

#[derive(Deserialize)]
struct NoteBody {
    #[serde(default)]
    base: i64,
    #[serde(default)]
    blob: Option<String>,
}

fn written(result: Result<i64, WriteError>) -> Response {
    match result {
        Ok(rev) => Json(json!({ "rev": rev })).into_response(),
        // 409 with the winner, so the device can merge and try again rather than guess what it collided with.
        Err(WriteError::Stale(winner)) => (StatusCode::CONFLICT, Json(note_json(&winner))).into_response(),
        Err(WriteError::Db(_)) => error(StatusCode::INTERNAL_SERVER_ERROR, "That note could not be stored."),
    }
}

async fn put_note(State(accounts): State<Arc<Accounts>>, headers: HeaderMap, Path(id): Path<String>, Json(body): Json<NoteBody>) -> Response {
    let who = match accounts.caller(&headers) {
        Ok(who) => who,
        Err(refused) => return refused,
    };
    if !valid_id(&id) {
        return error(StatusCode::BAD_REQUEST, "That note id could not be read.");
    }
    let Some(blob) = body.blob.as_deref().filter(|b| valid_blob(b, NOTE_LIMIT)) else {
        return error(StatusCode::BAD_REQUEST, "That note is empty or too large to sync.");
    };
    written(accounts.store.put_note(who.sub, &id, body.base, Some(blob), now_secs()))
}

async fn delete_note(State(accounts): State<Arc<Accounts>>, headers: HeaderMap, Path(id): Path<String>, Json(body): Json<NoteBody>) -> Response {
    let who = match accounts.caller(&headers) {
        Ok(who) => who,
        Err(refused) => return refused,
    };
    if !valid_id(&id) {
        return error(StatusCode::BAD_REQUEST, "That note id could not be read.");
    }
    written(accounts.store.put_note(who.sub, &id, body.base, None, now_secs()))
}

async fn get_prefs(State(accounts): State<Arc<Accounts>>, headers: HeaderMap) -> Response {
    let who = match accounts.caller(&headers) {
        Ok(who) => who,
        Err(refused) => return refused,
    };
    // Rev 0 and no blob says "nothing has ever been stored": a device keeps what it has and pushes it.
    let (rev, blob) = accounts.store.prefs(who.sub).map_or((0, None), |(rev, blob)| (rev, Some(blob)));
    Json(json!({ "rev": rev, "blob": blob })).into_response()
}

#[derive(Deserialize)]
struct PrefsBody {
    #[serde(default)]
    base: i64,
    blob: String,
}

async fn put_prefs(State(accounts): State<Arc<Accounts>>, headers: HeaderMap, Json(body): Json<PrefsBody>) -> Response {
    let who = match accounts.caller(&headers) {
        Ok(who) => who,
        Err(refused) => return refused,
    };
    if !valid_blob(&body.blob, PREFS_LIMIT) {
        return error(StatusCode::BAD_REQUEST, "Those settings are empty or too large to sync.");
    }
    match accounts.store.put_prefs(who.sub, body.base, &body.blob, now_secs()) {
        Ok(rev) => Json(json!({ "rev": rev })).into_response(),
        Err(Some((rev, blob))) => (StatusCode::CONFLICT, Json(json!({ "rev": rev, "blob": blob }))).into_response(),
        Err(None) => error(StatusCode::INTERNAL_SERVER_ERROR, "Those settings could not be stored."),
    }
}

async fn get_recording(State(accounts): State<Arc<Accounts>>, headers: HeaderMap, Path(id): Path<String>) -> Response {
    let who = match accounts.caller(&headers) {
        Ok(who) => who,
        Err(refused) => return refused,
    };
    if !valid_id(&id) {
        return error(StatusCode::BAD_REQUEST, "That recording id could not be read.");
    }
    match accounts.store.recording(who.sub, &id) {
        Some((rev, bytes)) => {
            let mut response = (StatusCode::OK, bytes).into_response();
            let headers = response.headers_mut();
            headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("application/octet-stream"));
            headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
            if let Ok(value) = HeaderValue::from_str(&rev.to_string()) {
                headers.insert("x-glyph-rev", value);
            }
            response
        }
        None => error(StatusCode::NOT_FOUND, "No recording by that id."),
    }
}

#[derive(Deserialize)]
struct RecordingQuery {
    #[serde(default)]
    base: i64,
}

async fn put_recording(State(accounts): State<Arc<Accounts>>, headers: HeaderMap, Path(id): Path<String>, Query(query): Query<RecordingQuery>, body: Bytes) -> Response {
    let who = match accounts.caller(&headers) {
        Ok(who) => who,
        Err(refused) => return refused,
    };
    if !valid_id(&id) {
        return error(StatusCode::BAD_REQUEST, "That recording id could not be read.");
    }
    if body.is_empty() {
        return error(StatusCode::BAD_REQUEST, "That recording is empty.");
    }
    match accounts.store.put_recording(who.sub, &id, query.base, &body, now_secs()) {
        Ok(rev) => Json(json!({ "rev": rev })).into_response(),
        Err(Some(rev)) => (StatusCode::CONFLICT, Json(json!({ "rev": rev }))).into_response(),
        Err(None) => error(StatusCode::INTERNAL_SERVER_ERROR, "That recording could not be stored."),
    }
}

pub fn router(accounts: Arc<Accounts>) -> Router {
    Router::new()
        .route("/glyph/api/v1/notes", get(feed))
        .route("/glyph/api/v1/notes/{id}", axum::routing::put(put_note).delete(delete_note))
        .route("/glyph/api/v1/prefs", get(get_prefs).put(put_prefs))
        .route(
            "/glyph/api/v1/recordings/{id}",
            get(get_recording).put(put_recording).layer(DefaultBodyLimit::max(RECORDING_LIMIT)),
        )
        .with_state(accounts)
}
