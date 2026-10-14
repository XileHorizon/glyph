//! "Sign in with Notion" for Ghost.md: the half of Notion's OAuth that needs a
//! secret, and nothing else.
//!
//! A public Notion integration signs a person in with a code that has to be
//! swapped for a token using the integration's client secret, and a secret
//! cannot ship inside an app. So the phone opens `start` in a browser; Notion
//! sends the browser back to `callback` with the code; this service swaps it
//! and holds the answer for a few minutes; and the phone collects it from
//! `claim`. The token itself never travels in a URL: `claim` answers only to
//! the phone that started the sign-in, which proves it with a verifier whose
//! SHA-256 it sent to `start` (the PKCE shape: `challenge` is the unpadded
//! base64url of SHA-256 of `verifier`). Nothing is written to disk and nothing
//! about a workspace is logged. `refresh` swaps a refresh token the same way.
//!
//!   GET  /glyph/api/notion/start?state&challenge  -> 302 to Notion
//!   GET  /glyph/api/notion/callback?code&state     -> a page to go back to Ghost.md
//!   POST /glyph/api/notion/claim  { state, verifier }  -> tokens | 202 pending | 404
//!   POST /glyph/api/notion/refresh { refreshToken }    -> tokens
//!
//! Configured by NOTION_CLIENT_ID and NOTION_CLIENT_SECRET in the service's
//! root-owned environment file; without them every route says sign-in is not
//! set up yet, and the rest of glyph-api is unaffected.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::extract::{ConnectInfo, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{Html, IntoResponse, Redirect, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::net::SocketAddr;

use crate::guard;

const AUTHORIZE: &str = "https://api.notion.com/v1/oauth/authorize";
const TOKEN: &str = "https://api.notion.com/v1/oauth/token";
const DEFAULT_REDIRECT: &str = "https://attack.fm/glyph/api/notion/callback";

/// How long a sign-in can take from `start` to `claim`.
const PENDING_TTL: Duration = Duration::from_secs(10 * 60);
/// Sign-ins in flight at once: a person signs in once, so this only ever
/// matters to something hammering `start`.
const MAX_PENDING: usize = 256;
const REQUESTS_PER_MINUTE: u32 = 30;

pub struct Notion {
    client_id: String,
    client_secret: String,
    redirect_uri: String,
    http: reqwest::Client,
    pending: Mutex<HashMap<String, Pending>>,
    limiter: Mutex<guard::RateLimiter>,
}

struct Pending {
    challenge: String,
    created: Instant,
    outcome: Option<Result<Value, String>>,
}

impl Notion {
    pub fn new(client_id: String, client_secret: String, redirect_uri: String) -> Arc<Self> {
        Arc::new(Notion {
            client_id,
            client_secret,
            redirect_uri,
            http: reqwest::Client::builder().timeout(Duration::from_secs(20)).build().unwrap_or_default(),
            pending: Mutex::new(HashMap::new()),
            limiter: Mutex::new(guard::RateLimiter::new(REQUESTS_PER_MINUTE, Instant::now())),
        })
    }

    /// From the environment. Missing client credentials leave sign-in off.
    pub fn from_env() -> Arc<Self> {
        let var = |name: &str| std::env::var(name).unwrap_or_default().trim().to_string();
        let redirect = std::env::var("NOTION_REDIRECT_URI").unwrap_or_else(|_| DEFAULT_REDIRECT.into());
        Notion::new(var("NOTION_CLIENT_ID"), var("NOTION_CLIENT_SECRET"), redirect)
    }

    fn configured(&self) -> bool {
        !self.client_id.is_empty() && !self.client_secret.is_empty()
    }

    fn allowed(&self, peer: SocketAddr, headers: &HeaderMap) -> bool {
        let ip = guard::client_ip(peer.ip(), headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()));
        self.limiter.lock().map(|mut l| l.take(ip, Instant::now())).unwrap_or(false)
    }

    fn prune(pending: &mut HashMap<String, Pending>, now: Instant) {
        pending.retain(|_, p| now.duration_since(p.created) < PENDING_TTL);
    }

    async fn exchange(&self, body: Value) -> Result<Value, String> {
        let response = self
            .http
            .post(TOKEN)
            .basic_auth(&self.client_id, Some(&self.client_secret))
            .header("Notion-Version", "2022-06-28")
            .json(&body)
            .send()
            .await
            .map_err(|_| "Notion could not be reached.".to_string())?;
        let status = response.status();
        let answer: Value = response.json().await.map_err(|_| "Notion answered with something unreadable.".to_string())?;
        if !status.is_success() {
            let reason = answer.get("error_description").or_else(|| answer.get("error")).and_then(Value::as_str).unwrap_or("refused");
            return Err(format!("Notion said no: {reason}"));
        }
        Ok(tokens(&answer))
    }
}

/// What the phone keeps from Notion's answer: the tokens and how to name the workspace.
fn tokens(answer: &Value) -> Value {
    json!({
        "accessToken": answer.get("access_token"),
        "refreshToken": answer.get("refresh_token"),
        "botId": answer.get("bot_id"),
        "workspaceId": answer.get("workspace_id"),
        "workspaceName": answer.get("workspace_name"),
        "workspaceIcon": answer.get("workspace_icon"),
    })
}

/// A state or a challenge: base64url, long enough not to be guessed.
fn well_formed(value: &str) -> bool {
    (32..=128).contains(&value.len()) && value.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// The PKCE S256 transform: the challenge a verifier proves.
pub fn challenge_of(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// The page a browser lands on after Notion: one sentence, in Ghost.md's ink.
fn page(status: StatusCode, heading: &str, line: &str) -> Response {
    let body = format!(
        "<!doctype html><meta charset=utf-8><meta name=viewport content=\"width=device-width,initial-scale=1\"><title>Ghost.md</title>\
         <style>body{{margin:0;min-height:100vh;display:grid;place-items:center;background:#000;color:#f5f5f5;font:17px/1.4 system-ui,sans-serif}}\
         main{{max-width:22rem;padding:2rem}}h1{{font-size:2rem;margin:0 0 .5rem;letter-spacing:-.02em}}p{{color:#9a9a9a;margin:0}}</style>\
         <main><h1>{}</h1><p>{}</p></main>",
        escape(heading),
        escape(line)
    );
    (status, Html(body)).into_response()
}

fn error(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({ "error": message }))).into_response()
}

#[derive(Deserialize)]
struct StartQuery {
    state: String,
    challenge: String,
}

async fn start(State(notion): State<Arc<Notion>>, ConnectInfo(peer): ConnectInfo<SocketAddr>, headers: HeaderMap, Query(query): Query<StartQuery>) -> Response {
    if !notion.allowed(peer, &headers) {
        return page(StatusCode::TOO_MANY_REQUESTS, "Slow down", "Too many sign-ins in a minute. Try again shortly.");
    }
    if !notion.configured() {
        return page(StatusCode::SERVICE_UNAVAILABLE, "Not set up yet", "Sign in with Notion isn't switched on for Ghost.md yet.");
    }
    if !well_formed(&query.state) || !well_formed(&query.challenge) {
        return page(StatusCode::BAD_REQUEST, "That link is broken", "Start the sign-in again from Ghost.md.");
    }
    let now = Instant::now();
    {
        let Ok(mut pending) = notion.pending.lock() else {
            return page(StatusCode::INTERNAL_SERVER_ERROR, "Something went wrong", "Start the sign-in again from Ghost.md.");
        };
        Notion::prune(&mut pending, now);
        if pending.len() >= MAX_PENDING && !pending.contains_key(&query.state) {
            return page(StatusCode::TOO_MANY_REQUESTS, "Busy", "Too many sign-ins at once. Try again in a few minutes.");
        }
        pending.insert(query.state.clone(), Pending { challenge: query.challenge, created: now, outcome: None });
    }
    let mut url = reqwest::Url::parse(AUTHORIZE).expect("a fixed URL parses");
    url.query_pairs_mut()
        .append_pair("client_id", &notion.client_id)
        .append_pair("response_type", "code")
        .append_pair("owner", "user")
        .append_pair("redirect_uri", &notion.redirect_uri)
        .append_pair("state", &query.state);
    Redirect::to(url.as_str()).into_response()
}

#[derive(Deserialize)]
struct CallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

async fn callback(State(notion): State<Arc<Notion>>, ConnectInfo(peer): ConnectInfo<SocketAddr>, headers: HeaderMap, Query(query): Query<CallbackQuery>) -> Response {
    if !notion.allowed(peer, &headers) {
        return page(StatusCode::TOO_MANY_REQUESTS, "Slow down", "Too many sign-ins in a minute. Try again shortly.");
    }
    let Some(state) = query.state.filter(|s| well_formed(s)) else {
        return page(StatusCode::BAD_REQUEST, "That link is broken", "Start the sign-in again from Ghost.md.");
    };
    // Decided and the lock let go before the network call below: a guard held
    // across an await would make this handler unsendable.
    let known = notion
        .pending
        .lock()
        .map(|mut p| {
            Notion::prune(&mut p, Instant::now());
            p.get(&state).is_some_and(|p| p.outcome.is_none())
        })
        .unwrap_or(false);
    if !known {
        return page(StatusCode::GONE, "This sign-in has expired", "Start it again from Ghost.md.");
    }

    let outcome = match (query.error, query.code) {
        (Some(_), _) => Err("You cancelled the sign-in.".to_string()),
        (None, Some(code)) if !code.is_empty() => {
            notion
                .exchange(json!({ "grant_type": "authorization_code", "code": code, "redirect_uri": notion.redirect_uri }))
                .await
        }
        _ => Err("Notion didn't send a sign-in code.".to_string()),
    };
    let workspace = outcome.as_ref().ok().and_then(|t| t.get("workspaceName")).and_then(Value::as_str).unwrap_or("Notion").to_string();
    let succeeded = outcome.is_ok();
    let reason = outcome.as_ref().err().cloned();
    if let Ok(mut pending) = notion.pending.lock() {
        if let Some(entry) = pending.get_mut(&state) {
            entry.outcome = Some(outcome);
        }
    }
    eprintln!("notion callback {}", if succeeded { "ok" } else { "failed" });
    if succeeded {
        page(StatusCode::OK, "Connected", &format!("Ghost.md can use {workspace} now. Go back to Ghost.md to choose a board."))
    } else {
        page(StatusCode::OK, "Not connected", &reason.unwrap_or_else(|| "Sign-in didn't finish.".into()))
    }
}

#[derive(Deserialize)]
struct ClaimRequest {
    state: String,
    verifier: String,
}

async fn claim(State(notion): State<Arc<Notion>>, ConnectInfo(peer): ConnectInfo<SocketAddr>, headers: HeaderMap, Json(request): Json<ClaimRequest>) -> Response {
    // No bearer token: the web build Ghost.md's phone runs has none to send (the
    // public bundle is built without it), and none is needed. Only the phone
    // that started this sign-in has the verifier that answers its challenge.
    if !notion.allowed(peer, &headers) {
        return error(StatusCode::TOO_MANY_REQUESTS, "rate limited");
    }
    let Ok(mut pending) = notion.pending.lock() else {
        return error(StatusCode::INTERNAL_SERVER_ERROR, "try again");
    };
    Notion::prune(&mut pending, Instant::now());
    let Some(entry) = pending.get(&request.state) else {
        return error(StatusCode::NOT_FOUND, "no sign-in with that state, or it expired");
    };
    // The proof is checked before anything about the sign-in is revealed,
    // even whether it has finished.
    if challenge_of(&request.verifier) != entry.challenge {
        return error(StatusCode::FORBIDDEN, "the verifier does not match");
    }
    match &entry.outcome {
        None => (StatusCode::ACCEPTED, Json(json!({ "pending": true }))).into_response(),
        Some(_) => match pending.remove(&request.state).and_then(|p| p.outcome) {
            Some(Ok(tokens)) => Json(tokens).into_response(),
            Some(Err(reason)) => error(StatusCode::BAD_REQUEST, &reason),
            None => error(StatusCode::INTERNAL_SERVER_ERROR, "try again"),
        },
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RefreshRequest {
    refresh_token: String,
}

async fn refresh(State(notion): State<Arc<Notion>>, ConnectInfo(peer): ConnectInfo<SocketAddr>, headers: HeaderMap, Json(request): Json<RefreshRequest>) -> Response {
    // No bearer token, for the same reason as `claim`: a refresh token is itself
    // the secret, and Notion refuses one it did not issue.
    if !notion.allowed(peer, &headers) {
        return error(StatusCode::TOO_MANY_REQUESTS, "rate limited");
    }
    if !notion.configured() {
        return error(StatusCode::SERVICE_UNAVAILABLE, "Sign in with Notion isn't set up yet.");
    }
    match notion.exchange(json!({ "grant_type": "refresh_token", "refresh_token": request.refresh_token })).await {
        Ok(tokens) => Json(tokens).into_response(),
        Err(reason) => error(StatusCode::BAD_GATEWAY, &reason),
    }
}

/// The four routes, with their own state; merged into glyph-api's router.
pub fn router(notion: Arc<Notion>) -> Router {
    Router::new()
        .route("/glyph/api/notion/start", get(start))
        .route("/glyph/api/notion/callback", get(callback))
        .route("/glyph/api/notion/claim", post(claim))
        .route("/glyph/api/notion/refresh", post(refresh))
        .with_state(notion)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::{to_bytes, Body};
    use axum::extract::connect_info::MockConnectInfo;
    use axum::http::{header, Request};
    use tower::ServiceExt;
    const STATE: &str = "state-0123456789abcdefghijklmnopqrstuv";
    const VERIFIER: &str = "verifier-0123456789abcdefghijklmnopqrstuvwxyz";

    fn service(notion: Arc<Notion>) -> Router {
        router(notion).layer(MockConnectInfo(SocketAddr::from(([127, 0, 0, 1], 40001))))
    }

    fn configured() -> Arc<Notion> {
        Notion::new("client-id".into(), "client-secret".into(), DEFAULT_REDIRECT.into())
    }

    fn claim_request(verifier: &str) -> Request<Body> {
        Request::post("/glyph/api/notion/claim")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(json!({ "state": STATE, "verifier": verifier }).to_string()))
            .unwrap()
    }

    #[test]
    fn the_challenge_is_pkce_s256() {
        // RFC 7636 appendix B's example verifier and challenge.
        assert_eq!(challenge_of("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[tokio::test]
    async fn start_says_so_when_sign_in_is_not_set_up() {
        let notion = Notion::new(String::new(), String::new(), DEFAULT_REDIRECT.into());
        let uri = format!("/glyph/api/notion/start?state={STATE}&challenge={}", challenge_of(VERIFIER));
        let response = service(notion).oneshot(Request::get(uri).body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    }

    #[tokio::test]
    async fn start_sends_the_browser_to_notion_with_the_state() {
        let uri = format!("/glyph/api/notion/start?state={STATE}&challenge={}", challenge_of(VERIFIER));
        let response = service(configured()).oneshot(Request::get(uri).body(Body::empty()).unwrap()).await.unwrap();
        assert!(response.status().is_redirection());
        let location = response.headers().get(header::LOCATION).unwrap().to_str().unwrap();
        assert!(location.starts_with(AUTHORIZE), "{location}");
        assert!(location.contains("client_id=client-id") && location.contains(STATE) && location.contains("owner=user"), "{location}");
        assert!(!location.contains("client-secret"));
    }

    #[tokio::test]
    async fn claim_waits_for_the_callback_and_answers_only_the_right_verifier() {
        let notion = configured();
        let uri = format!("/glyph/api/notion/start?state={STATE}&challenge={}", challenge_of(VERIFIER));
        service(notion.clone()).oneshot(Request::get(uri).body(Body::empty()).unwrap()).await.unwrap();

        let wrong = service(notion.clone()).oneshot(claim_request("someone-else-0123456789abcdefghijklmnop")).await.unwrap();
        assert_eq!(wrong.status(), StatusCode::FORBIDDEN);

        let waiting = service(notion.clone()).oneshot(claim_request(VERIFIER)).await.unwrap();
        assert_eq!(waiting.status(), StatusCode::ACCEPTED);

        // What the callback leaves behind once Notion has answered.
        notion.pending.lock().unwrap().get_mut(STATE).unwrap().outcome = Some(Ok(json!({ "accessToken": "secret-token", "workspaceName": "AttackFM" })));
        let answered = service(notion.clone()).oneshot(claim_request(VERIFIER)).await.unwrap();
        assert_eq!(answered.status(), StatusCode::OK);
        let body: Value = serde_json::from_slice(&to_bytes(answered.into_body(), usize::MAX).await.unwrap()).unwrap();
        assert_eq!(body["workspaceName"], "AttackFM");

        // Once only.
        let again = service(notion).oneshot(claim_request(VERIFIER)).await.unwrap();
        assert_eq!(again.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn a_callback_for_an_unknown_sign_in_is_told_it_expired() {
        let uri = format!("/glyph/api/notion/callback?code=abc&state={STATE}");
        let response = service(configured()).oneshot(Request::get(uri).body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(response.status(), StatusCode::GONE);
    }
}
