//! `/glyph/api/mcp` handed on to the hosted MCP server (mcp/hosted.ts, docs/MCP.md), which runs beside this
//! service on loopback as `glyph-mcp.service`.
//!
//! Caddy sends everything under `/glyph/api/` here, and the Caddyfile is shared by four sites and edited by hand
//! with care (scripts/deploy-server.mjs says why), so the MCP server is reached through this route rather than a
//! route of its own: the request goes on as it came, with its method, path, query, headers and body, and the answer
//! comes back the same way, streamed. The hosted server's own sign-in pages, discovery documents and tokens all live
//! under this prefix, which is what lets the whole thing stand without a change to Caddy.

use axum::{
    body::{to_bytes, Body},
    extract::{Request, State},
    http::{header, HeaderName, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::any,
    Router,
};
use std::sync::Arc;

/// Where the hosted MCP server listens: `GLYPH_MCP_UPSTREAM`, `http://127.0.0.1:18820` unless set.
pub const DEFAULT_UPSTREAM: &str = "http://127.0.0.1:18820";

/// A request body larger than this is refused before it is read: a note is under 1.4 MB sealed, and a tool call
/// carries at most one.
const MOST_BYTES: usize = 4 * 1024 * 1024;

/// Headers that belong to one hop and are never carried across: RFC 9110 §7.6.1, plus the two the next hop sets itself.
const HOP_BY_HOP: &[&str] = &["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "host", "content-length"];

pub struct Upstream {
    pub base: String,
    pub client: reqwest::Client,
}

impl Upstream {
    pub fn from_env() -> Arc<Upstream> {
        let base = std::env::var("GLYPH_MCP_UPSTREAM").unwrap_or_else(|_| DEFAULT_UPSTREAM.into());
        Arc::new(Upstream::at(&base))
    }

    pub fn at(base: &str) -> Upstream {
        Upstream {
            base: base.trim_end_matches('/').to_string(),
            // No overall timeout: a tool call waits on the sync service, and the connect timeout is what guards against a
            // server that is not there at all.
            client: reqwest::Client::builder().connect_timeout(std::time::Duration::from_secs(3)).build().expect("a client"),
        }
    }
}

pub fn router(upstream: Arc<Upstream>) -> Router {
    Router::new().route("/glyph/api/mcp", any(forward)).route("/glyph/api/mcp/{*rest}", any(forward)).with_state(upstream)
}

fn refused(status: StatusCode, words: &str) -> Response {
    (status, [(header::CONTENT_TYPE, "application/json")], format!("{{\"error\":{}}}", serde_json::to_string(words).unwrap_or_default())).into_response()
}

async fn forward(State(up): State<Arc<Upstream>>, request: Request) -> Response {
    let (parts, body) = request.into_parts();
    let path_and_query = parts.uri.path_and_query().map(|p| p.as_str()).unwrap_or("/");
    let url = format!("{}{}", up.base, path_and_query);
    let bytes = match to_bytes(body, MOST_BYTES).await {
        Ok(bytes) => bytes,
        Err(_) => return refused(StatusCode::PAYLOAD_TOO_LARGE, "that request is too large"),
    };
    let mut outgoing = up.client.request(parts.method.clone(), &url);
    for (name, value) in parts.headers.iter() {
        if HOP_BY_HOP.contains(&name.as_str()) {
            continue;
        }
        outgoing = outgoing.header(name, value);
    }
    let answer = match outgoing.body(bytes).send().await {
        Ok(answer) => answer,
        Err(_) => return refused(StatusCode::BAD_GATEWAY, "Claude's server is not running here right now"),
    };
    let mut response = Response::builder().status(answer.status());
    for (name, value) in answer.headers().iter() {
        if HOP_BY_HOP.contains(&name.as_str()) {
            continue;
        }
        if let (Ok(name), Ok(value)) = (HeaderName::from_bytes(name.as_ref()), HeaderValue::from_bytes(value.as_bytes())) {
            response = response.header(name, value);
        }
    }
    response.body(Body::from_stream(answer.bytes_stream())).unwrap_or_else(|_| refused(StatusCode::BAD_GATEWAY, "Claude's server answered in a way that could not be passed on"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{routing::post, Json};
    use tokio::net::TcpListener;

    /// A stand-in for the hosted server: it answers with what it was sent, so the proxy's fidelity shows.
    async fn stand_in() -> String {
        async fn echo(headers: axum::http::HeaderMap, body: String) -> Response {
            let auth = headers.get("authorization").and_then(|v| v.to_str().ok()).unwrap_or("none").to_string();
            (StatusCode::CREATED, [("x-seen-auth", auth), ("www-authenticate", "Bearer resource_metadata=\"x\"".to_string())], Json(serde_json::json!({ "got": body }))).into_response()
        }
        let app = Router::new().route("/glyph/api/mcp", post(echo)).route("/glyph/api/mcp/{*rest}", any(|req: Request| async move { format!("path {}", req.uri()) }));
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        format!("http://{addr}")
    }

    async fn proxied(upstream: &str) -> String {
        let app = router(Arc::new(Upstream::at(upstream)));
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        format!("http://{addr}")
    }

    #[tokio::test]
    async fn carries_the_request_and_the_answer_across_whole() {
        let front = proxied(&stand_in().await).await;
        let client = reqwest::Client::new();
        let answer = client.post(format!("{front}/glyph/api/mcp")).header("authorization", "Bearer tok").body("{\"hello\":1}").send().await.unwrap();
        assert_eq!(answer.status(), StatusCode::CREATED);
        assert_eq!(answer.headers().get("x-seen-auth").unwrap(), "Bearer tok");
        assert_eq!(answer.headers().get("www-authenticate").unwrap(), "Bearer resource_metadata=\"x\"");
        assert_eq!(answer.text().await.unwrap(), "{\"got\":\"{\\\"hello\\\":1}\"}");
        let under = client.get(format!("{front}/glyph/api/mcp/.well-known/openid-configuration?x=1")).send().await.unwrap();
        assert_eq!(under.text().await.unwrap(), "path /glyph/api/mcp/.well-known/openid-configuration?x=1");
    }

    #[tokio::test]
    async fn says_so_when_the_server_is_not_there() {
        let front = proxied("http://127.0.0.1:1").await;
        let answer = reqwest::Client::new().post(format!("{front}/glyph/api/mcp")).send().await.unwrap();
        assert_eq!(answer.status(), StatusCode::BAD_GATEWAY);
        assert!(answer.text().await.unwrap().contains("not running"));
    }
}
