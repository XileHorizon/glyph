//! Accounts and sync, through the routes a device calls (docs/SYNC.md): a signup, the three ways in, a note written on
//! one device and read on another, a race lost and told what won, settings, recordings, and the limits.

use crate::accounts::{Accounts, RECOVERY_CODES};
use crate::store::Store;
use crate::{app_with, model, router};
use axum::body::{to_bytes, Body};
use axum::extract::connect_info::MockConnectInfo;
use axum::http::{header, Method, Request, StatusCode};
use axum::Router;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};
use serde_json::{json, Value};
use std::net::SocketAddr;
use std::sync::Arc;
use tower::ServiceExt;

const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

struct Harness {
    service: Router,
    _dir: TempDir,
}

struct TempDir(std::path::PathBuf);
impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn harness() -> Harness {
    let dir = std::env::temp_dir().join(format!("glyph-sync-{}-{}", std::process::id(), rand::random::<u64>()));
    std::fs::create_dir_all(&dir).unwrap();
    let accounts = Accounts::new(Arc::new(Store::in_memory(dir.join("recordings"))));
    let app = app_with(TOKEN.into(), model::Ollama::new("http://127.0.0.1:9", "test-model"));
    let service = router(app, Some(accounts)).layer(MockConnectInfo(SocketAddr::from(([127, 0, 0, 1], 40000))));
    Harness { service, _dir: TempDir(dir) }
}

/// A login half, as a device derives one: 64 hex characters.
fn login(seed: u8) -> String {
    format!("{seed:02x}").repeat(32)
}

/// A wrapped key, as a device writes one: base64url.
fn wrapped(label: &str) -> String {
    URL_SAFE_NO_PAD.encode(format!("wrapped:{label}"))
}

fn sheet() -> Vec<Value> {
    (0..RECOVERY_CODES).map(|i| json!({ "login": login(100 + i as u8), "wrapped": wrapped(&format!("code{i}")) })).collect()
}

impl Harness {
    async fn call(&self, method: Method, path: &str, token: Option<&str>, body: Option<Value>) -> (StatusCode, Value) {
        let mut request = Request::builder().method(method).uri(path);
        if let Some(token) = token {
            request = request.header(header::AUTHORIZATION, format!("Bearer {token}"));
        }
        let request = match body {
            Some(body) => request.header(header::CONTENT_TYPE, "application/json").body(Body::from(body.to_string())),
            None => request.body(Body::empty()),
        }
        .unwrap();
        let response = self.service.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
    }

    async fn raw(&self, method: Method, path: &str, token: &str, body: Vec<u8>) -> (StatusCode, Vec<u8>, Option<String>) {
        let request = Request::builder()
            .method(method)
            .uri(path)
            .header(header::AUTHORIZATION, format!("Bearer {token}"))
            .header(header::CONTENT_TYPE, "application/octet-stream")
            .body(Body::from(body))
            .unwrap();
        let response = self.service.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let rev = response.headers().get("x-glyph-rev").and_then(|v| v.to_str().ok()).map(str::to_string);
        (status, to_bytes(response.into_body(), usize::MAX).await.unwrap().to_vec(), rev)
    }

    /// A new account with a password, a device, and a recovery sheet; its token.
    async fn signup(&self, handle: &str, device: &SigningKey) -> String {
        let (status, body) = self
            .call(
                Method::POST,
                "/glyph/api/v1/signup",
                None,
                Some(json!({
                    "handle": handle,
                    "loginSecret": login(1),
                    "wrapped": wrapped("password"),
                    "devicePublicKey": URL_SAFE_NO_PAD.encode(device.verifying_key().to_bytes()),
                    "deviceLabel": "phone",
                    "recovery": sheet(),
                })),
            )
            .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        body["token"].as_str().unwrap().to_string()
    }
}

fn device() -> SigningKey {
    SigningKey::generate(&mut rand::rngs::OsRng)
}

#[tokio::test]
async fn signs_up_and_in_by_password_and_is_given_the_wrapped_key() {
    let h = harness();
    h.signup("matt", &device()).await;
    let (status, body) = h.call(Method::POST, "/glyph/api/v1/login", None, Some(json!({ "handle": "Matt", "loginSecret": login(1) }))).await;
    assert_eq!(status, StatusCode::OK);
    assert!(body["token"].as_str().unwrap().starts_with("glyph1."));
    assert_eq!(body["wrapped"], json!(wrapped("password")));
    assert_eq!(body["account"]["handle"], json!("matt"));

    let (status, body) = h.call(Method::POST, "/glyph/api/v1/login", None, Some(json!({ "handle": "matt", "loginSecret": login(2) }))).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (_, unknown) = h.call(Method::POST, "/glyph/api/v1/login", None, Some(json!({ "handle": "nobody", "loginSecret": login(1) }))).await;
    assert_eq!(body, unknown, "a wrong password and an unknown handle read the same");
}

#[tokio::test]
async fn refuses_a_signup_it_cannot_keep() {
    let h = harness();
    h.signup("matt", &device()).await;
    let (status, _) = h
        .call(Method::POST, "/glyph/api/v1/signup", None, Some(json!({ "handle": "MATT", "loginSecret": login(1), "wrapped": wrapped("p"), "recovery": sheet() })))
        .await;
    assert_eq!(status, StatusCode::CONFLICT, "handles are the same whatever their case");
    let (status, _) = h.call(Method::POST, "/glyph/api/v1/signup", None, Some(json!({ "handle": "sam", "loginSecret": login(1), "wrapped": wrapped("p") }))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "no recovery sheet, no account: it is the only way back into the notes");
    let (status, _) = h
        .call(Method::POST, "/glyph/api/v1/signup", None, Some(json!({ "handle": "sam", "loginSecret": "hunter2", "wrapped": wrapped("p"), "recovery": sheet() })))
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "a password itself is never what arrives");
    let (status, _) = h.call(Method::POST, "/glyph/api/v1/signup", None, Some(json!({ "handle": "x", "recovery": sheet() }))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn signs_in_by_device_key_with_a_nonce_used_once() {
    let h = harness();
    let key = device();
    h.signup("matt", &key).await;
    let (_, challenge) = h.call(Method::POST, "/glyph/api/v1/login/challenge", None, Some(json!({ "handle": "matt" }))).await;
    let nonce = challenge["nonce"].as_str().unwrap().to_string();
    let signature = URL_SAFE_NO_PAD.encode(key.sign(nonce.as_bytes()).to_bytes());
    let body = json!({ "handle": "matt", "nonce": nonce, "signature": signature });
    let (status, signed) = h.call(Method::POST, "/glyph/api/v1/login/device", None, Some(body.clone())).await;
    assert_eq!(status, StatusCode::OK);
    assert!(signed["wrapped"].is_null(), "a device keeps its own key; nothing wrapped is handed out here");
    let (again, _) = h.call(Method::POST, "/glyph/api/v1/login/device", None, Some(body)).await;
    assert_eq!(again, StatusCode::UNAUTHORIZED, "a nonce is spent by its first use");

    // Another device's signature over a fresh nonce does not get in.
    let (_, challenge) = h.call(Method::POST, "/glyph/api/v1/login/challenge", None, Some(json!({ "handle": "matt" }))).await;
    let nonce = challenge["nonce"].as_str().unwrap().to_string();
    let stranger = URL_SAFE_NO_PAD.encode(device().sign(nonce.as_bytes()).to_bytes());
    let (status, _) = h.call(Method::POST, "/glyph/api/v1/login/device", None, Some(json!({ "handle": "matt", "nonce": nonce, "signature": stranger }))).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn a_recovery_code_gets_in_once_with_its_own_wrapped_key_and_a_new_password_follows() {
    let h = harness();
    h.signup("matt", &device()).await;
    let (status, body) = h.call(Method::POST, "/glyph/api/v1/login/recovery", None, Some(json!({ "handle": "matt", "login": login(103) }))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["wrapped"], json!(wrapped("code3")), "the key wrapped under that code, and no other");
    let token = body["token"].as_str().unwrap().to_string();
    let (status, _) = h.call(Method::POST, "/glyph/api/v1/login/recovery", None, Some(json!({ "handle": "matt", "login": login(103) }))).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED, "spent");
    let (_, left) = h.call(Method::GET, "/glyph/api/v1/recovery", Some(&token), None).await;
    assert_eq!(left["left"], json!(RECOVERY_CODES - 1));

    let (status, _) = h.call(Method::PUT, "/glyph/api/v1/password", Some(&token), Some(json!({ "loginSecret": login(9), "wrapped": wrapped("new") }))).await;
    assert_eq!(status, StatusCode::OK);
    let (status, body) = h.call(Method::POST, "/glyph/api/v1/login", None, Some(json!({ "handle": "matt", "loginSecret": login(9) }))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["wrapped"], json!(wrapped("new")));
    let (status, _) = h.call(Method::POST, "/glyph/api/v1/login", None, Some(json!({ "handle": "matt", "loginSecret": login(1) }))).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED, "the old password is gone");

    let (status, body) = h.call(Method::POST, "/glyph/api/v1/recovery", Some(&token), Some(json!({ "codes": sheet() }))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["left"], json!(RECOVERY_CODES), "a new sheet is whole again");
}

#[tokio::test]
async fn a_note_written_on_one_device_is_read_on_another_and_a_race_is_told_who_won() {
    let h = harness();
    let token = h.signup("matt", &device()).await;
    let id = "7c1e0d9a-3f4b-4c55-9a51-2d6f1f0e8b13";
    let path = format!("/glyph/api/v1/notes/{id}");

    let (status, first) = h.call(Method::PUT, &path, Some(&token), Some(json!({ "base": 0, "blob": "Y2lwaGVyMQ" }))).await;
    assert_eq!(status, StatusCode::OK);
    let first = first["rev"].as_i64().unwrap();

    // The other device reads the feed from the start.
    let (status, feed) = h.call(Method::GET, "/glyph/api/v1/notes?since=0", Some(&token), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(feed["items"][0]["id"], json!(id));
    assert_eq!(feed["items"][0]["blob"], json!("Y2lwaGVyMQ"));
    assert_eq!(feed["rev"], json!(first));
    assert_eq!(feed["more"], json!(false));

    let (_, second) = h.call(Method::PUT, &path, Some(&token), Some(json!({ "base": first, "blob": "Y2lwaGVyMg" }))).await;
    let second = second["rev"].as_i64().unwrap();
    let (status, winner) = h.call(Method::PUT, &path, Some(&token), Some(json!({ "base": first, "blob": "bG9zdA" }))).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(winner["rev"], json!(second));
    assert_eq!(winner["blob"], json!("Y2lwaGVyMg"));

    let (status, gone) = h.call(Method::DELETE, &path, Some(&token), Some(json!({ "base": second }))).await;
    assert_eq!(status, StatusCode::OK);
    let (_, feed) = h.call(Method::GET, &format!("/glyph/api/v1/notes?since={second}"), Some(&token), None).await;
    assert_eq!(feed["items"][0]["deleted"], json!(true));
    assert!(feed["items"][0]["blob"].is_null());
    assert_eq!(feed["rev"], gone["rev"]);
}

#[tokio::test]
async fn the_feed_pages() {
    let h = harness();
    let token = h.signup("matt", &device()).await;
    for i in 0..5 {
        h.call(Method::PUT, &format!("/glyph/api/v1/notes/n-{i}"), Some(&token), Some(json!({ "base": 0, "blob": "YQ" }))).await;
    }
    let (_, page) = h.call(Method::GET, "/glyph/api/v1/notes?since=0&limit=2", Some(&token), None).await;
    assert_eq!(page["items"].as_array().unwrap().len(), 2);
    assert_eq!(page["more"], json!(true));
    let cursor = page["rev"].as_i64().unwrap();
    assert_eq!(cursor, page["items"][1]["rev"].as_i64().unwrap(), "with more to come, the cursor is the last note given");
    let (_, rest) = h.call(Method::GET, &format!("/glyph/api/v1/notes?since={cursor}&limit=10"), Some(&token), None).await;
    assert_eq!(rest["items"].as_array().unwrap().len(), 3);
    assert_eq!(rest["more"], json!(false));
}

#[tokio::test]
async fn nothing_is_read_or_written_without_a_token_or_across_accounts() {
    let h = harness();
    let mine = h.signup("matt", &device()).await;
    let theirs = h.signup("sam", &device()).await;
    h.call(Method::PUT, "/glyph/api/v1/notes/n-1", Some(&mine), Some(json!({ "base": 0, "blob": "c2VjcmV0" }))).await;

    for (method, path) in [(Method::GET, "/glyph/api/v1/notes"), (Method::GET, "/glyph/api/v1/prefs"), (Method::GET, "/glyph/api/v1/keys")] {
        let (status, _) = h.call(method, path, None, None).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{path}");
    }
    let (status, _) = h.call(Method::GET, "/glyph/api/v1/notes", Some("glyph1.forged.token"), None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (_, feed) = h.call(Method::GET, "/glyph/api/v1/notes", Some(&theirs), None).await;
    assert!(feed["items"].as_array().unwrap().is_empty(), "another account's notes are not in this feed");
}

#[tokio::test]
async fn refuses_what_it_cannot_store() {
    let h = harness();
    let token = h.signup("matt", &device()).await;
    let (status, _) = h.call(Method::PUT, "/glyph/api/v1/notes/..%2Fescape", Some(&token), Some(json!({ "blob": "YQ" }))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "an id is never a path");
    let (status, _) = h.call(Method::PUT, "/glyph/api/v1/notes/n-1", Some(&token), Some(json!({ "blob": "not base64!" }))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "a note is ciphertext, never plain words");
    let (status, _) = h.call(Method::PUT, "/glyph/api/v1/notes/n-1", Some(&token), Some(json!({ "base": 0 }))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn settings_are_one_blob_written_from_the_revision_seen() {
    let h = harness();
    let token = h.signup("matt", &device()).await;
    let (_, none) = h.call(Method::GET, "/glyph/api/v1/prefs", Some(&token), None).await;
    assert_eq!((none["rev"].clone(), none["blob"].clone()), (json!(0), Value::Null));
    let (_, first) = h.call(Method::PUT, "/glyph/api/v1/prefs", Some(&token), Some(json!({ "base": 0, "blob": "cHJlZnM" }))).await;
    let (status, winner) = h.call(Method::PUT, "/glyph/api/v1/prefs", Some(&token), Some(json!({ "base": 0, "blob": "c3RhbGU" }))).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!((winner["rev"].clone(), winner["blob"].clone()), (first["rev"].clone(), json!("cHJlZnM")));
}

#[tokio::test]
async fn recordings_go_up_and_come_back_byte_for_byte() {
    let h = harness();
    let token = h.signup("matt", &device()).await;
    let audio: Vec<u8> = (0..200_000u32).map(|i| (i % 251) as u8).collect();
    let (status, body, _) = h.raw(Method::PUT, "/glyph/api/v1/recordings/n-1?base=0", &token, audio.clone()).await;
    assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&body));
    let rev: Value = serde_json::from_slice(&body).unwrap();
    let (status, back, header_rev) = h.raw(Method::GET, "/glyph/api/v1/recordings/n-1", &token, Vec::new()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(back, audio);
    assert_eq!(header_rev, Some(rev["rev"].to_string()));
    let (status, _, _) = h.raw(Method::PUT, "/glyph/api/v1/recordings/n-1?base=0", &token, vec![1, 2, 3]).await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _, _) = h.raw(Method::GET, "/glyph/api/v1/recordings/none", &token, Vec::new()).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn sign_in_is_rate_limited_per_handle() {
    let h = harness();
    h.signup("matt", &device()).await;
    let mut refused = false;
    for _ in 0..15 {
        let (status, _) = h.call(Method::POST, "/glyph/api/v1/login", None, Some(json!({ "handle": "matt", "loginSecret": login(7) }))).await;
        if status == StatusCode::TOO_MANY_REQUESTS {
            refused = true;
            break;
        }
    }
    assert!(refused, "guessing at one account runs out of tries");
}

#[tokio::test]
async fn a_browser_may_put_and_delete_and_read_the_recording_revision() {
    let h = harness();
    let request = Request::builder()
        .method(Method::OPTIONS)
        .uri("/glyph/api/v1/notes/n-1")
        .header(header::ORIGIN, "tauri://localhost")
        .header(header::ACCESS_CONTROL_REQUEST_METHOD, "DELETE")
        .body(Body::empty())
        .unwrap();
    let response = h.service.clone().oneshot(request).await.unwrap();
    let allowed = response.headers().get(header::ACCESS_CONTROL_ALLOW_METHODS).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    assert!(allowed.contains("PUT") && allowed.contains("DELETE"), "{allowed}");
}
