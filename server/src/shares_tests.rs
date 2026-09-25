//! Shares, through the routes a device and a reader call (docs/SHARING.md): the owner writes one, anyone reads it with
//! no account, the owner's edits reach the reader, nobody else can write or take it down, and a share taken down is
//! gone.

use crate::accounts::{Accounts, RECOVERY_CODES};
use crate::store::Store;
use crate::{app_with, model, router};
use axum::body::{to_bytes, Body};
use axum::extract::connect_info::MockConnectInfo;
use axum::http::{header, Method, Request, StatusCode};
use axum::Router;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ed25519_dalek::SigningKey;
use serde_json::{json, Value};
use std::net::SocketAddr;
use std::sync::Arc;
use tower::ServiceExt;

const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
/// A share id as a device makes one: 128 random bits, base64url.
const ID: &str = "AbCdEfGhIjKlMnOpQrStUv";

fn service() -> Router {
    let dir = std::env::temp_dir().join(format!("glyph-shares-{}-{}", std::process::id(), rand::random::<u64>()));
    let accounts = Accounts::new(Arc::new(Store::in_memory(dir.join("recordings"))));
    let app = app_with(TOKEN.into(), model::Ollama::new("http://127.0.0.1:9", "test-model"));
    router(app, Some(accounts)).layer(MockConnectInfo(SocketAddr::from(([127, 0, 0, 1], 40100))))
}

async fn call(service: &Router, method: Method, path: &str, token: Option<&str>, body: Option<Value>) -> (StatusCode, Value, Option<String>) {
    let mut request = Request::builder().method(method).uri(path);
    if let Some(token) = token {
        request = request.header(header::AUTHORIZATION, format!("Bearer {token}"));
    }
    let request = match body {
        Some(body) => request.header(header::CONTENT_TYPE, "application/json").body(Body::from(body.to_string())),
        None => request.body(Body::empty()),
    }
    .unwrap();
    let response = service.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let cache = response.headers().get(header::CACHE_CONTROL).and_then(|v| v.to_str().ok()).map(str::to_string);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null), cache)
}

async fn signup(service: &Router, handle: &str, seed: u8) -> String {
    let device = SigningKey::generate(&mut rand::rngs::OsRng);
    let login = |s: u8| format!("{s:02x}").repeat(32);
    let wrapped = |label: &str| URL_SAFE_NO_PAD.encode(format!("wrapped:{label}"));
    let sheet: Vec<Value> = (0..RECOVERY_CODES).map(|i| json!({ "login": login(100 + i as u8), "wrapped": wrapped(&format!("code{i}")) })).collect();
    let (status, body, _) = call(
        service,
        Method::POST,
        "/glyph/api/v1/signup",
        None,
        Some(json!({
            "handle": handle,
            "loginSecret": login(seed),
            "wrapped": wrapped("password"),
            "devicePublicKey": URL_SAFE_NO_PAD.encode(device.verifying_key().to_bytes()),
            "deviceLabel": "phone",
            "recovery": sheet,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body["token"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn the_owner_shares_anyone_reads_and_the_owner_s_edits_reach_the_reader() {
    let service = service();
    let owner = signup(&service, "sam", 1).await;
    let path = format!("/glyph/api/v1/shares/{ID}");
    let (status, _, _) = call(&service, Method::PUT, &path, Some(&owner), Some(json!({ "blob": "c2VhbGVk" }))).await;
    assert_eq!(status, StatusCode::OK);
    // No account, no token: the link is enough, and nothing between keeps a copy.
    let (status, body, cache) = call(&service, Method::GET, &path, None, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["blob"], "c2VhbGVk");
    assert_eq!(cache.as_deref(), Some("no-store"));
    // Written again as the owner edits: the reader sees the new one.
    let (status, _, _) = call(&service, Method::PUT, &path, Some(&owner), Some(json!({ "blob": "ZWRpdGVk" }))).await;
    assert_eq!(status, StatusCode::OK);
    let (_, body, _) = call(&service, Method::GET, &path, None, None).await;
    assert_eq!(body["blob"], "ZWRpdGVk");
    let (status, body, _) = call(&service, Method::GET, "/glyph/api/v1/shares", Some(&owner), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["shares"].as_array().unwrap().len(), 1);
    assert_eq!(body["shares"][0]["id"], ID);
}

#[tokio::test]
async fn nobody_else_can_write_it_or_take_it_down_and_taken_down_it_is_gone() {
    let service = service();
    let owner = signup(&service, "sam", 1).await;
    let other = signup(&service, "ali", 2).await;
    let path = format!("/glyph/api/v1/shares/{ID}");
    call(&service, Method::PUT, &path, Some(&owner), Some(json!({ "blob": "c2VhbGVk" }))).await;
    let (status, _, _) = call(&service, Method::PUT, &path, Some(&other), Some(json!({ "blob": "b3RoZXI" }))).await;
    assert_eq!(status, StatusCode::CONFLICT);
    // Another's delete answers as if it worked, and does nothing.
    let (status, _, _) = call(&service, Method::DELETE, &path, Some(&other), None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (_, body, _) = call(&service, Method::GET, &path, None, None).await;
    assert_eq!(body["blob"], "c2VhbGVk");
    let (status, _, _) = call(&service, Method::DELETE, &path, Some(&owner), None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _, _) = call(&service, Method::GET, &path, None, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (_, body, _) = call(&service, Method::GET, "/glyph/api/v1/shares", Some(&owner), None).await;
    assert_eq!(body["shares"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn a_share_needs_an_account_to_write_and_a_proper_id_and_blob() {
    let service = service();
    let owner = signup(&service, "sam", 1).await;
    let path = format!("/glyph/api/v1/shares/{ID}");
    let (status, _, _) = call(&service, Method::PUT, &path, None, Some(json!({ "blob": "c2VhbGVk" }))).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, _, _) = call(&service, Method::PUT, "/glyph/api/v1/shares/short", Some(&owner), Some(json!({ "blob": "c2VhbGVk" }))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _, _) = call(&service, Method::PUT, &path, Some(&owner), Some(json!({ "blob": "not base64!" }))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _, _) = call(&service, Method::GET, "/glyph/api/v1/shares/nothing-here-at-all-000", None, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}
