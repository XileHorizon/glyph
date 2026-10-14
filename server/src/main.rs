//! glyph-api: the server half of Glyph's voice-note formatting.
//!
//! Matt holds the side key, talks, and Whisper on the phone transcribes him
//! live while cheap local rules turn the words into markdown. When he pauses,
//! the phone sends the plain transcript here, and this answers with
//! ANNOTATIONS - a title, phrases to bold, action items, enumerations, section
//! breaks - each one an exact piece of what he said. The phone applies them.
//! Nothing here returns prose, and nothing here can change a word of the note.
//!
//!   POST /glyph/api/format   { "text" }  ->  annotations, model, elapsedMs
//!   GET  /glyph/api/health                ->  { ok, model, ollama }
//!   /glyph/api/notion/*                    ->  Notion sign-in, see `notion.rs`
//!   /glyph/api/v1/*                        ->  accounts and end-to-end encrypted sync, see `accounts.rs`, `sync.rs`
//!   /glyph/api/v1/live                     ->  live sync's relay, a WebSocket passing sealed edits, see `live.rs`
//!
//! This file owns the wire: routes, CORS, the order the guards run in, and
//! what each failure looks like to the phone. `model.rs` owns the Ollama call,
//! `shape.rs` owns the verbatim rule, `guard.rs` owns tokens and rate limits,
//! and `bench.rs` measures the same pipeline from a shell on the box.
//!
//! A GUEST ON SOMEBODY ELSE'S BOX. The Ollama this calls is AttackFM's, and
//! AttackFM's enrichment, DJ and discovery loops use it all day - through a
//! runner with ONE slot (see `model.rs`). Everything below that looks
//! conservative - one model call at a time, a short queue, a rate limit, an
//! admission gate, a hard 45-second budget - is there so that a phone can
//! never hold that slot for long, and never at all while AttackFM is using
//! it. Caddy routes `/glyph/api/*` here; the prefix is not stripped, so the
//! routes carry it.

mod accounts;
mod bench;
mod guard;
mod identity;
mod model;
mod notion;
mod shape;
mod store;
mod live;
mod mcp_proxy;
mod shares;
mod sync;
#[cfg(test)]
mod sync_tests;
#[cfg(test)]
mod shares_tests;
#[cfg(test)]
mod live_tests;

use axum::body::{to_bytes, Body};
use axum::extract::{ConnectInfo, State};
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::Semaphore;
use tower_http::cors::{AllowOrigin, CorsLayer};

/// Loopback only. Caddy is the one door; a port open to the internet would be
/// a second one with no TLS and no access log.
const DEFAULT_BIND: &str = "127.0.0.1:8796";

const DEFAULT_OLLAMA: &str = "http://127.0.0.1:11434";

/// The contract's ceiling on the transcript itself, in UTF-8 bytes.
const TEXT_LIMIT: usize = 16 * 1024;

/// The ceiling on the raw request body, which is deliberately NOT the same
/// number. A 16 KB transcript is legal, and JSON-encoding it adds a
/// backslash to every newline and quote - so a body cap of exactly 16 KB
/// would answer 413 to a note the contract says is fine. Twice the text plus a
/// kilobyte is the worst a transcript can encode to (every character a newline
/// or a quote); the TEXT is still held to 16 KB after parsing, and 33 KB is
/// still nothing to buffer.
const BODY_LIMIT: usize = 2 * TEXT_LIMIT + 1024;

/// Per client address. A phone pausing every few seconds while dictating
/// sends well under this; a loop or a scraper hits it inside a minute.
const REQUESTS_PER_MINUTE: u32 = 20;

/// How long a request waits for the single model slot before giving up.
///
/// Short, because the phone re-sends at the next pause anyway, and a request
/// that waited half a minute would be annotating a transcript that has
/// already grown past it.
const QUEUE_WAIT: Duration = Duration::from_secs(8);

/// The whole budget for one request, counted from when it ARRIVED - queue
/// wait and every chunk together. The phone (`src/app/capture/annotate.ts`)
/// gives up at 45 seconds too, and a server whose clock started after the
/// queue could still be working on an answer nobody is waiting for.
const UPSTREAM_TIMEOUT: Duration = Duration::from_secs(45);

/// How long the endpoint stops asking the model after a call that was
/// admitted and still could not finish. See `guard::Breaker` for the numbers.
const BREAKER_COOLDOWN: Duration = Duration::from_secs(600);

/// The webview origins Glyph actually runs under.
///
/// Verified in tauri-2.11.5 `src/manager/mod.rs` (`tauri_protocol_url`):
/// Android and Windows serve the app from `http://tauri.localhost`, or
/// `https://tauri.localhost` when a window sets `useHttpsScheme` - Glyph's
/// `tauri.conf.json` does not, so the phone is the http one today, and the
/// https one is here so flipping that flag does not silently break formatting.
/// iOS and macOS use `tauri://localhost`. The last is the Vite dev server
/// (`vite.config.ts`, port 5250). The web build at attack.fm/glyph/ is
/// same-origin and needs no entry.
const ORIGINS: &[&str] = &["http://tauri.localhost", "https://tauri.localhost", "tauri://localhost"];

/// Whether a page may call this service from the browser: one of `ORIGINS`,
/// or a dev server on this machine at any port (`http://localhost:5255`,
/// `http://127.0.0.1:5251`), since several run side by side and each takes the
/// next free port. A dev page is the person's own; the token it would need
/// lives in its own storage, not in the origin.
fn allowed_origin(origin: &[u8]) -> bool {
    let Ok(origin) = std::str::from_utf8(origin) else { return false };
    if ORIGINS.contains(&origin) {
        return true;
    }
    ["http://localhost:", "http://127.0.0.1:"].iter().any(|host| {
        origin.strip_prefix(host).is_some_and(|port| (1..=5).contains(&port.len()) && port.bytes().all(|b| b.is_ascii_digit()))
    })
}

struct App {
    token: String,
    ollama: model::Ollama,
    limiter: Mutex<guard::RateLimiter>,
    breaker: Mutex<guard::Breaker>,
    /// `UPSTREAM_TIMEOUT` and `model::ADMISSION_WAIT` in production; fields
    /// only so a test can hold the service to milliseconds instead of minutes.
    budget: Duration,
    admission: Duration,
    /// ONE permit, so this service never has two requests in Ollama's queue at
    /// once. Two would take AttackFM's single slot twice in a row.
    slot: Semaphore,
}

#[derive(Deserialize)]
struct FormatRequest {
    text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Formatted {
    #[serde(flatten)]
    annotations: shape::Annotations,
    model: String,
    elapsed_ms: u64,
}

fn error(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({ "error": message }))).into_response()
}

async fn health(State(app): State<Arc<App>>) -> Json<serde_json::Value> {
    Json(json!({ "ok": true, "model": app.ollama.model(), "ollama": app.ollama.reachable().await }))
}

/// The one route that costs anything.
///
/// The guards run cheapest first, and the rate limit runs BEFORE the token
/// check on purpose: a client guessing tokens is a client making requests,
/// and should run out of them at the same rate as anyone else.
///
/// If the phone gives up - it sends a newer transcript, or Matt locks the
/// screen - Caddy drops the upstream connection, axum drops this future, and
/// with it the in-flight request to Ollama, which stops generating when its
/// client goes away. Dropping IS the cancellation; nothing needs to be told.
async fn format(
    State(app): State<Arc<App>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    let started = Instant::now();
    let ip = guard::client_ip(peer.ip(), headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()));

    let allowed = app.limiter.lock().map(|mut l| l.take(ip, started)).unwrap_or(false);
    if !allowed {
        eprintln!("format 429 rate limited");
        return error(StatusCode::TOO_MANY_REQUESTS, "rate limited: at most 20 requests a minute");
    }

    let authorization = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok());
    if !guard::bearer_matches(authorization, &app.token) {
        eprintln!("format 401");
        return error(StatusCode::UNAUTHORIZED, "missing or wrong bearer token");
    }

    // Any failure to buffer is reported as too large. The other way to fail
    // here is a client that hung up mid-body, and nobody reads that response.
    let Ok(bytes) = to_bytes(body, BODY_LIMIT).await else {
        eprintln!("format 413 body over {BODY_LIMIT} bytes");
        return error(StatusCode::PAYLOAD_TOO_LARGE, "request body is too large");
    };
    let Ok(request) = serde_json::from_slice::<FormatRequest>(&bytes) else {
        eprintln!("format 400 malformed");
        return error(StatusCode::BAD_REQUEST, "expected a JSON body of the form { \"text\": string }");
    };
    if request.text.len() > TEXT_LIMIT {
        eprintln!("format 413 text {} bytes", request.text.len());
        return error(StatusCode::PAYLOAD_TOO_LARGE, "text is over 16 KB");
    }

    let respond = |annotations| {
        let elapsed_ms = started.elapsed().as_millis() as u64;
        Json(Formatted { annotations, model: app.ollama.model().to_string(), elapsed_ms }).into_response()
    };

    // Silence is a legal transcript (the key was held and nothing was said),
    // and it does not need a model to know there is nothing in it.
    if request.text.trim().is_empty() {
        return respond(shape::Annotations::default());
    }

    let resting = app.breaker.lock().map(|b| b.is_open(Instant::now()).then(|| b.remaining(Instant::now()))).unwrap_or(None);
    if let Some(left) = resting {
        eprintln!("format 503 breaker open for another {}s", left.as_secs());
        return error(
            StatusCode::SERVICE_UNAVAILABLE,
            &format!("the model could not finish inside the budget recently; not asking again for {}s", left.as_secs()),
        );
    }

    let Ok(Ok(_permit)) = tokio::time::timeout(QUEUE_WAIT, app.slot.acquire()).await else {
        eprintln!("format 503 busy after {}ms in the queue", QUEUE_WAIT.as_millis());
        return error(StatusCode::SERVICE_UNAVAILABLE, "busy: another note is being formatted");
    };

    match model::annotate(&app.ollama, &request.text, started + app.budget, app.admission).await {
        Ok(outcome) => {
            // Counts and timings only. The transcript is somebody's voice
            // note, and the journal is not the place for it.
            eprintln!(
                "format 200 {}ms bytes={} chunks={}/{} proposed={} dropped={} lists_dropped={} prompt_tokens={} eval_tokens={}{}",
                started.elapsed().as_millis(),
                request.text.len(),
                outcome.completed,
                outcome.chunks,
                outcome.tally.proposed,
                outcome.tally.dropped,
                outcome.tally.lists_dropped,
                outcome.timing.prompt_tokens,
                outcome.timing.eval_tokens,
                if outcome.completed < outcome.chunks { " PARTIAL" } else { "" },
            );
            respond(outcome.annotations)
        }
        Err(failure) => {
            if matches!(failure, model::Failure::TimedOut) {
                if let Ok(mut breaker) = app.breaker.lock() {
                    breaker.overran(Instant::now());
                }
            }
            eprintln!("format 503 {}ms {failure}", started.elapsed().as_millis());
            error(StatusCode::SERVICE_UNAVAILABLE, &failure.to_string())
        }
    }
}

async fn not_found() -> Response {
    error(StatusCode::NOT_FOUND, "no such route")
}

async fn method_not_allowed() -> Response {
    error(StatusCode::METHOD_NOT_ALLOWED, "method not allowed")
}

fn router(app: Arc<App>, accounts: Option<Arc<accounts::Accounts>>) -> Router {
    // The layer wraps every route, so a preflight is answered before method
    // routing sees it (an OPTIONS to a POST-only route would otherwise be a
    // 405), and the 401s and 429s carry CORS headers too - without them the
    // webview hides the status and the phone cannot tell "wrong token" from
    // "network down".
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(|origin: &HeaderValue, _| allowed_origin(origin.as_bytes())))
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE])
        // A recording's revision rides in a header, and a page cannot read one it was not told it may.
        .expose_headers([header::HeaderName::from_static("x-glyph-rev")])
        .max_age(Duration::from_secs(600));
    let notion = notion::Notion::from_env();
    let mut routes = Router::new()
        .route("/glyph/api/health", get(health))
        .route("/glyph/api/format", post(format))
        .with_state(app)
        .merge(notion::router(notion));
    // Accounts and sync, when the service has somewhere to keep them.
    if let Some(accounts) = accounts {
        routes = routes
            .merge(accounts::router(accounts.clone()))
            .merge(sync::router(accounts.clone()))
            // Notes and books shared by their links (docs/SHARING.md): the same accounts own them.
            .merge(shares::router(accounts.clone()))
            // Live sync's relay (docs/LIVE.md): the same accounts, a socket instead of requests.
            .merge(live::router(accounts));
    }
    // Claude's hosted MCP server (mcp/hosted.ts, docs/MCP.md), running beside this service, reached through it.
    routes = routes.merge(mcp_proxy::router(mcp_proxy::Upstream::from_env()));
    routes
        .fallback(not_found)
        .method_not_allowed_fallback(method_not_allowed)
        .layer(cors)
}

fn app_with(token: String, ollama: model::Ollama) -> Arc<App> {
    app_bounded(token, ollama, UPSTREAM_TIMEOUT, model::ADMISSION_WAIT)
}

fn app_bounded(token: String, ollama: model::Ollama, budget: Duration, admission: Duration) -> Arc<App> {
    Arc::new(App {
        token,
        ollama,
        limiter: Mutex::new(guard::RateLimiter::new(REQUESTS_PER_MINUTE, Instant::now())),
        breaker: Mutex::new(guard::Breaker::new(BREAKER_COOLDOWN)),
        budget,
        admission,
        slot: Semaphore::new(1),
    })
}

async fn shutdown() {
    let interrupt = async {
        // A process that cannot hear ctrl-c still hears SIGTERM below.
        let _ = tokio::signal::ctrl_c().await;
    };
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    };
    tokio::select! {
        () = interrupt => {}
        () = terminate => {}
    }
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("bench") {
        std::process::exit(bench::run(&args[2..]).await);
    }


    let token = std::env::var("GLYPH_API_TOKEN").unwrap_or_default();
    // Refuse to start rather than serve with a token anyone could guess. The
    // deploy writes 64 hex characters; 32 is the floor for a hand-set one.
    if token.len() < 32 {
        eprintln!("GLYPH_API_TOKEN is missing or shorter than 32 characters; refusing to start");
        std::process::exit(2);
    }
    let bind = std::env::var("GLYPH_API_BIND").unwrap_or_else(|_| DEFAULT_BIND.into());
    let model = std::env::var("GLYPH_API_MODEL").unwrap_or_else(|_| model::MODEL.into());
    let base = std::env::var("OLLAMA_URL").unwrap_or_else(|_| DEFAULT_OLLAMA.into());

    let app = app_with(token, model::Ollama::new(&base, &model));
    // Where accounts and synced notes are kept (docs/SYNC.md). Unset, the service runs as it did, without them.
    let accounts = match std::env::var("GLYPH_API_DATA").ok().filter(|d| !d.is_empty()) {
        Some(dir) => match store::Store::open(std::path::Path::new(&dir)) {
            Ok(store) => {
                eprintln!("glyph-api accounts in {dir}");
                Some(accounts::Accounts::new(Arc::new(store)))
            }
            Err(e) => {
                eprintln!("cannot open the accounts database in {dir}: {e}");
                std::process::exit(1);
            }
        },
        None => None,
    };
    let listener = match tokio::net::TcpListener::bind(&bind).await {
        Ok(listener) => listener,
        Err(e) => {
            eprintln!("cannot bind {bind}: {e}");
            std::process::exit(1);
        }
    };
    eprintln!("glyph-api listening on {bind}, model {model} via {base}");
    let served = axum::serve(listener, router(app, accounts).into_make_service_with_connect_info::<SocketAddr>())
        .with_graceful_shutdown(shutdown())
        .await;
    if let Err(e) = served {
        eprintln!("server error: {e}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::extract::connect_info::MockConnectInfo;
    use axum::http::Request;
    use tower::ServiceExt;

    const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    /// Ollama pointed at a port nothing listens on, so a test that reaches the
    /// model gets a refused connection in microseconds instead of a real call.
    fn service() -> Router {
        router(app_with(TOKEN.into(), model::Ollama::new("http://127.0.0.1:9", "test-model")), None)
            .layer(MockConnectInfo(SocketAddr::from(([127, 0, 0, 1], 40000))))
    }

    fn post(body: impl Into<Body>, token: Option<&str>) -> Request<Body> {
        let mut request = Request::post("/glyph/api/format").header(header::CONTENT_TYPE, "application/json");
        if let Some(token) = token {
            request = request.header(header::AUTHORIZATION, format!("Bearer {token}"));
        }
        request.body(body.into()).unwrap()
    }

    async fn json_of(response: Response) -> serde_json::Value {
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn refuses_a_missing_or_wrong_token_with_401() {
        let response = service().oneshot(post(r#"{"text":"hi"}"#, None)).await.unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert!(json_of(response).await["error"].is_string(), "errors are {{ error: string }}");

        let response = service().oneshot(post(r#"{"text":"hi"}"#, Some("wrong"))).await.unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn refuses_an_oversized_body_and_an_oversized_text_with_413() {
        let huge = format!(r#"{{"text":"{}"}}"#, "a".repeat(BODY_LIMIT));
        let response = service().oneshot(post(huge, Some(TOKEN))).await.unwrap();
        assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);

        let over = format!(r#"{{"text":"{}"}}"#, "a".repeat(TEXT_LIMIT + 1));
        let response = service().oneshot(post(over, Some(TOKEN))).await.unwrap();
        assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE, "the text cap holds inside the envelope room");
    }

    #[tokio::test]
    async fn a_legal_16kb_transcript_full_of_newlines_is_not_a_413() {
        // Every newline and quote doubles in JSON. This is the worst legal note,
        // and the reason the body cap is not the text cap.
        let text = "\"\n".repeat(TEXT_LIMIT / 2);
        let body = serde_json::to_string(&json!({ "text": text })).unwrap();
        assert!(body.len() > 2 * TEXT_LIMIT, "the fixture really does double once encoded");
        let response = service().oneshot(post(body, Some(TOKEN))).await.unwrap();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE, "it reached the (absent) model");
    }

    #[tokio::test]
    async fn malformed_json_is_400() {
        for body in ["not json", r#"{"words":"hi"}"#, r#"{"text":42}"#] {
            let response = service().oneshot(post(body, Some(TOKEN))).await.unwrap();
            assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{body}");
        }
    }

    #[tokio::test]
    async fn an_unreachable_ollama_is_503() {
        let response = service().oneshot(post(r#"{"text":"call the plumber"}"#, Some(TOKEN))).await.unwrap();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert!(json_of(response).await["error"].as_str().unwrap().contains("unavailable"));
    }

    /// An Ollama that ADMITS a chat - headers and a first line straight away -
    /// and then never finishes it, which is what a CPU generating four tokens
    /// a second looks like from inside a 45-second budget. Speaks raw HTTP/1.1
    /// because the point is a stream that stalls mid-body. Counts chats.
    async fn admits_then_stalls() -> (String, Arc<std::sync::atomic::AtomicUsize>) {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let chats = Arc::new(AtomicUsize::new(0));
        let counter = chats.clone();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else { return };
                let counter = counter.clone();
                tokio::spawn(async move {
                    let mut pending = Vec::new();
                    loop {
                        let mut buf = [0u8; 4096];
                        let Ok(n) = socket.read(&mut buf).await else { return };
                        if n == 0 {
                            return;
                        }
                        pending.extend_from_slice(&buf[..n]);
                        let Some(end) = pending.windows(4).position(|w| w == b"\r\n\r\n") else { continue };
                        let head = String::from_utf8_lossy(&pending[..end]).to_string();
                        let length: usize = head
                            .lines()
                            .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse().unwrap_or(0)))
                            .unwrap_or(0);
                        if pending.len() < end + 4 + length {
                            continue;
                        }
                        pending.drain(..end + 4 + length);
                        if head.starts_with("POST /api/show") {
                            let body = r#"{"capabilities":["completion"]}"#;
                            let reply = format!("HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n{body}", body.len());
                            let _ = socket.write_all(reply.as_bytes()).await;
                        } else {
                            counter.fetch_add(1, Ordering::SeqCst);
                            let line = "{\"message\":{\"content\":\"{\"},\"done\":false}\n";
                            let reply = format!(
                                "HTTP/1.1 200 OK\r\ncontent-type: application/x-ndjson\r\ntransfer-encoding: chunked\r\n\r\n{:x}\r\n{line}\r\n",
                                line.len()
                            );
                            let _ = socket.write_all(reply.as_bytes()).await;
                            tokio::time::sleep(Duration::from_secs(60)).await;
                            return;
                        }
                    }
                });
            }
        });
        (format!("http://{address}"), chats)
    }

    #[tokio::test]
    async fn an_admitted_call_that_overruns_rests_the_model_instead_of_retrying_it() {
        use std::sync::atomic::Ordering;
        let (base, chats) = admits_then_stalls().await;
        let app = app_bounded(TOKEN.into(), model::Ollama::new(&base, "test-model"), Duration::from_millis(800), Duration::from_millis(400));
        let service = router(app, None).layer(MockConnectInfo(SocketAddr::from(([127, 0, 0, 1], 40000))));

        let response = service.clone().oneshot(post(r#"{"text":"call the plumber"}"#, Some(TOKEN))).await.unwrap();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert!(json_of(response).await["error"].as_str().unwrap().contains("timed out"));

        let started = Instant::now();
        let response = service.clone().oneshot(post(r#"{"text":"call the plumber"}"#, Some(TOKEN))).await.unwrap();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert!(json_of(response).await["error"].as_str().unwrap().contains("not asking again"));
        assert!(started.elapsed() < Duration::from_millis(200), "answered without Ollama");
        assert_eq!(chats.load(Ordering::SeqCst), 1, "the second request never reached the model");
    }

    #[tokio::test]
    async fn silence_is_answered_without_a_model() {
        let response = service().oneshot(post(r#"{"text":"  \n\n "}"#, Some(TOKEN))).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = json_of(response).await;
        assert_eq!(body["title"], serde_json::Value::Null);
        assert_eq!(body["emphasis"], json!([]));
        assert_eq!(body["model"], "test-model");
        assert!(body["elapsedMs"].is_u64(), "camelCase on the wire: {body}");
    }

    #[tokio::test]
    async fn the_twenty_first_request_in_a_minute_is_429() {
        let service = service();
        for i in 0..REQUESTS_PER_MINUTE {
            let response = service.clone().oneshot(post(r#"{"text":""}"#, Some(TOKEN))).await.unwrap();
            assert_eq!(response.status(), StatusCode::OK, "request {i}");
        }
        let response = service.clone().oneshot(post(r#"{"text":""}"#, Some(TOKEN))).await.unwrap();
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    }

    #[tokio::test]
    async fn answers_the_preflight_the_authorization_header_triggers() {
        let preflight = Request::builder()
            .method(Method::OPTIONS)
            .uri("/glyph/api/format")
            .header(header::ORIGIN, "http://tauri.localhost")
            .header(header::ACCESS_CONTROL_REQUEST_METHOD, "POST")
            .header(header::ACCESS_CONTROL_REQUEST_HEADERS, "authorization,content-type")
            .body(Body::empty())
            .unwrap();
        let response = service().oneshot(preflight).await.unwrap();
        assert!(response.status().is_success(), "{}", response.status());
        let headers = response.headers();
        assert_eq!(headers[header::ACCESS_CONTROL_ALLOW_ORIGIN], "http://tauri.localhost");
        let allowed = headers[header::ACCESS_CONTROL_ALLOW_HEADERS].to_str().unwrap().to_ascii_lowercase();
        assert!(allowed.contains("authorization") && allowed.contains("content-type"), "{allowed}");
    }

    #[tokio::test]
    async fn a_foreign_origin_gets_no_cors_grant_and_errors_carry_one_for_ours() {
        let foreign = Request::get("/glyph/api/health").header(header::ORIGIN, "https://evil.example").body(Body::empty()).unwrap();
        let response = service().oneshot(foreign).await.unwrap();
        assert!(response.headers().get(header::ACCESS_CONTROL_ALLOW_ORIGIN).is_none());

        let mut ours = post(r#"{"text":"hi"}"#, None);
        ours.headers_mut().insert(header::ORIGIN, HeaderValue::from_static("tauri://localhost"));
        let response = service().oneshot(ours).await.unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(response.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN], "tauri://localhost", "so the phone can READ the 401");
    }

    #[test]
    fn any_local_dev_port_is_an_origin_and_nothing_that_only_looks_like_one() {
        for ok in ["tauri://localhost", "http://tauri.localhost", "http://localhost:5250", "http://localhost:5255", "http://127.0.0.1:5251"] {
            assert!(allowed_origin(ok.as_bytes()), "{ok}");
        }
        for no in ["https://evil.example", "http://localhost", "http://localhost:", "http://localhost:5250.evil.example", "http://localhost:123456", "http://localhost.evil.example:5250", "https://localhost:5250", "null"] {
            assert!(!allowed_origin(no.as_bytes()), "{no}");
        }
    }

    #[tokio::test]
    async fn a_dev_server_on_another_port_is_granted_too() {
        let mut request = post(r#"{"text":"hi"}"#, None);
        request.headers_mut().insert(header::ORIGIN, HeaderValue::from_static("http://localhost:5255"));
        let response = service().oneshot(request).await.unwrap();
        assert_eq!(response.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN], "http://localhost:5255");
    }

    #[tokio::test]
    async fn health_needs_no_token_and_reports_ollama_honestly() {
        let response = service().oneshot(Request::get("/glyph/api/health").body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(json_of(response).await, json!({ "ok": true, "model": "test-model", "ollama": false }));
    }

    #[tokio::test]
    async fn unknown_routes_and_methods_answer_in_json() {
        let response = service().oneshot(Request::get("/glyph/api/nope").body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        let response = service().oneshot(Request::get("/glyph/api/format").body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
        assert!(json_of(response).await["error"].is_string());
    }
}
