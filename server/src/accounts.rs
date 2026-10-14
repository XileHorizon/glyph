//! Glyph accounts: sign-up, sign-in, the devices and recovery codes that speak for an account, and the session
//! tokens every sync call carries (docs/SYNC.md).
//!
//! AttackFM's registry, copied in shape (`AttackFM/server/crates/registry/src/main.rs`): a handle, a password and/or
//! a device key, eight recovery codes, a signed token that lasts a week and is renewed with itself. Two things are
//! different, both because Glyph's notes are end-to-end encrypted:
//!
//! - **What arrives in place of a password is not the password.** A device derives two halves from it: a login
//!   secret, sent here and Argon2-hashed as AttackFM hashes a password, and a wrap key, which never leaves the device.
//!   The same split is made from each recovery code. So nothing this service stores or sees can unwrap the account
//!   key, and nothing it stores can read a note.
//! - **Sign-in is rate limited**, per address and per handle. AttackFM's registry has no limit on it.
//!
//!   GET  /glyph/api/v1/pubkey            the key tokens are signed with
//!   POST /glyph/api/v1/signup            a new account, with its wrapped key and its recovery sheet
//!   POST /glyph/api/v1/login             by password: the token, and the key wrapped under the password
//!   POST /glyph/api/v1/login/challenge   a nonce for a device to sign
//!   POST /glyph/api/v1/login/device      by device key: the token
//!   POST /glyph/api/v1/login/recovery    by recovery code, spent: the token, and the key wrapped under that code
//!   POST /glyph/api/v1/refresh           a fresh token for a live one
//!   POST /glyph/api/v1/device            another device for the signed-in account
//!   GET  /glyph/api/v1/keys              the key wrapped under the password
//!   PUT  /glyph/api/v1/password          a new password (a new login hash, the key wrapped anew)
//!   GET  /glyph/api/v1/recovery          how many codes are left
//!   POST /glyph/api/v1/recovery          a new sheet of codes

// A refusal here is the response itself, handed straight back from a handler; boxing it would only move it.
#![allow(clippy::result_large_err)]

use crate::guard;
use crate::identity::{Claims, Issuer};
use crate::store::Store;
use argon2::password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use axum::extract::{ConnectInfo, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::RngCore;
use serde::Deserialize;
use serde_json::json;
use sha2::Digest;
use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::{Arc, Mutex};
use std::time::Instant;

/// A token lives a week; the app renews it long before, as AttackFM's does.
const TOKEN_TTL_SECS: i64 = 7 * 24 * 3600;
/// A device-login challenge is good for two minutes.
const CHALLENGE_TTL_SECS: i64 = 120;
/// Sign-in attempts per address, and per handle, per minute.
const SIGN_IN_PER_ADDRESS: u32 = 20;
const SIGN_IN_PER_HANDLE: u32 = 10;
/// A recovery sheet is eight codes, as AttackFM's is.
pub const RECOVERY_CODES: usize = 8;
/// The signing key's name in the database's meta table.
const ISSUER_SECRET_KEY: &str = "issuer_secret_b64";
/// A wrapped key is a few dozen bytes of base64; this is a ceiling on a mistake, not on anything real.
const WRAPPED_LIMIT: usize = 512;

pub struct Accounts {
    pub store: Arc<Store>,
    issuer: Issuer,
    /// Outstanding device-login challenges: nonce -> (account id, issued at). In memory, as AttackFM keeps them: a
    /// challenge lost to a restart only means the device asks for another.
    challenges: Mutex<HashMap<String, (i64, i64)>>,
    by_address: Mutex<guard::RateLimiter<IpAddr>>,
    by_handle: Mutex<guard::RateLimiter<String>>,
}

impl Accounts {
    /// The accounts service over `store`, with the signing key it keeps, made on first use.
    pub fn new(store: Arc<Store>) -> Arc<Self> {
        let issuer = match store.meta(ISSUER_SECRET_KEY).and_then(|s| Issuer::from_secret_b64(&s)) {
            Some(issuer) => issuer,
            None => {
                let issuer = Issuer::generate();
                if let Err(e) = store.set_meta(ISSUER_SECRET_KEY, &issuer.secret_b64()) {
                    eprintln!("accounts: could not keep the signing key: {e}");
                }
                issuer
            }
        };
        let now = Instant::now();
        Arc::new(Self {
            store,
            issuer,
            challenges: Mutex::new(HashMap::new()),
            by_address: Mutex::new(guard::RateLimiter::new(SIGN_IN_PER_ADDRESS, now)),
            by_handle: Mutex::new(guard::RateLimiter::new(SIGN_IN_PER_HANDLE, now)),
        })
    }

    /// The account a bearer token speaks for, or why not.
    pub fn caller(&self, headers: &HeaderMap) -> Result<Claims, Response> {
        let raw = headers
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .ok_or_else(|| error(StatusCode::UNAUTHORIZED, "Sign in first."))?;
        self.claims(raw).ok_or_else(|| error(StatusCode::UNAUTHORIZED, "Your session has ended. Sign in again."))
    }

    /// The account a token speaks for, if it is one of ours and still current. The one check every way in uses: a
    /// header on the HTTP routes, the first frame on live sync's socket (src/live.rs), which cannot carry a header.
    pub fn claims(&self, raw: &str) -> Option<Claims> {
        self.issuer.verifier().verify(raw.trim(), now_secs()).ok()
    }

    fn issue(&self, id: i64, handle: &str) -> String {
        let now = now_secs();
        self.issuer.issue(&Claims { sub: id, handle: handle.to_string(), iat: now, exp: now + TOKEN_TTL_SECS })
    }

    /// One sign-in attempt, counted against the address and the handle. Refused with a 429 when either is spent.
    fn admit(&self, peer: IpAddr, headers: &HeaderMap, handle: &str) -> Result<(), Response> {
        let ip = guard::client_ip(peer, headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()));
        let now = Instant::now();
        let by_address = self.by_address.lock().map(|mut l| l.take(ip, now)).unwrap_or(false);
        let by_handle = self.by_handle.lock().map(|mut l| l.take(handle.trim().to_lowercase(), now)).unwrap_or(false);
        if by_address && by_handle {
            Ok(())
        } else {
            Err(error(StatusCode::TOO_MANY_REQUESTS, "Too many tries. Wait a minute and try again."))
        }
    }
}

pub fn error(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({ "error": message }))).into_response()
}

pub fn now_secs() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

// --- the rules --------------------------------------------------------------------

/// AttackFM's handle rule: 3 to 24 letters, digits, `.`, `_` or `-`, starting with a letter or digit.
pub fn valid_handle(handle: &str) -> bool {
    let n = handle.chars().count();
    (3..=24).contains(&n)
        && handle.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
        && handle.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
}

/// A login half is 32 bytes a device derived, as 64 hex characters. Anything else is not one.
fn valid_login(login: &str) -> bool {
    login.len() == 64 && login.bytes().all(|b| b.is_ascii_hexdigit())
}

fn valid_wrapped(wrapped: &str) -> bool {
    !wrapped.is_empty() && wrapped.len() <= WRAPPED_LIMIT && wrapped.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn hash_login(login: &str) -> Result<String, Response> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(login.to_lowercase().as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|_| error(StatusCode::INTERNAL_SERVER_ERROR, "Could not store that password."))
}

fn verify_login(login: &str, hash: &str) -> bool {
    !hash.is_empty()
        && PasswordHash::new(hash).map(|parsed| Argon2::default().verify_password(login.to_lowercase().as_bytes(), &parsed).is_ok()).unwrap_or(false)
}

/// A recovery code's login half, as it is kept: SHA-256. The half is already 32 random-looking bytes, so a fast hash
/// is enough, and it can be looked up directly.
fn hash_code(login: &str) -> String {
    sha2::Sha256::digest(login.to_lowercase().as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

#[derive(Deserialize)]
struct CodeBody {
    login: String,
    wrapped: String,
}

/// A recovery sheet, checked and made ready to store: eight codes, each a login half and a wrapped key.
fn sheet(codes: &[CodeBody]) -> Result<Vec<(String, String)>, Response> {
    if codes.len() != RECOVERY_CODES {
        return Err(error(StatusCode::BAD_REQUEST, "A recovery sheet is eight codes."));
    }
    codes
        .iter()
        .map(|code| {
            if valid_login(&code.login) && valid_wrapped(&code.wrapped) {
                Ok((hash_code(&code.login), code.wrapped.clone()))
            } else {
                Err(error(StatusCode::BAD_REQUEST, "A recovery code could not be read."))
            }
        })
        .collect()
}

fn signed_in(accounts: &Accounts, id: i64, handle: &str, wrapped: Option<&str>) -> Response {
    let mut body = json!({ "token": accounts.issue(id, handle), "account": { "id": id, "handle": handle } });
    if let Some(wrapped) = wrapped {
        body["wrapped"] = json!(wrapped);
    }
    Json(body).into_response()
}

// --- routes -----------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SignupBody {
    handle: String,
    #[serde(default)]
    login_secret: String,
    #[serde(default)]
    wrapped: String,
    #[serde(default)]
    device_public_key: String,
    #[serde(default)]
    device_label: String,
    #[serde(default)]
    recovery: Vec<CodeBody>,
}

/// `POST v1/signup`. Open, like AttackFM's: anyone may make an account.
async fn signup(State(accounts): State<Arc<Accounts>>, ConnectInfo(peer): ConnectInfo<SocketAddr>, headers: HeaderMap, Json(body): Json<SignupBody>) -> Response {
    let handle = body.handle.trim().to_string();
    if let Err(refused) = accounts.admit(peer.ip(), &headers, &handle) {
        return refused;
    }
    if !valid_handle(&handle) {
        return error(StatusCode::BAD_REQUEST, "A handle is 3 to 24 letters, digits, . _ or -, starting with a letter or digit.");
    }
    let has_password = !body.login_secret.is_empty();
    let device = body.device_public_key.trim();
    if !has_password && device.is_empty() {
        return error(StatusCode::BAD_REQUEST, "Set a password, or sign up from a device.");
    }
    if has_password && (!valid_login(&body.login_secret) || !valid_wrapped(&body.wrapped)) {
        return error(StatusCode::BAD_REQUEST, "That password could not be read.");
    }
    // End to end, the recovery sheet is the only way back into notes whose every device and password are gone, so an
    // account is not made without one.
    let codes = match sheet(&body.recovery) {
        Ok(codes) => codes,
        Err(refused) => return refused,
    };
    if accounts.store.account_by_handle(&handle).is_some() {
        return error(StatusCode::CONFLICT, "That handle is taken.");
    }
    let login_hash = if has_password {
        match hash_login(&body.login_secret) {
            Ok(hash) => hash,
            Err(refused) => return refused,
        }
    } else {
        String::new()
    };
    let label = if body.device_label.trim().is_empty() { "device" } else { body.device_label.trim() };
    let device = (!device.is_empty()).then_some((device, label));
    let wrapped = if has_password { body.wrapped.as_str() } else { "" };
    match accounts.store.create_account(&handle, &login_hash, wrapped, device, &codes, now_secs()) {
        Ok(account) => signed_in(&accounts, account.id, &account.handle, None),
        // The UNIQUE index is the real gate: a signup racing this one lands here.
        Err(_) => error(StatusCode::CONFLICT, "That handle is taken."),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoginBody {
    handle: String,
    login_secret: String,
}

/// `POST v1/login`. The same answer for a wrong handle and a wrong password, as AttackFM gives.
async fn login(State(accounts): State<Arc<Accounts>>, ConnectInfo(peer): ConnectInfo<SocketAddr>, headers: HeaderMap, Json(body): Json<LoginBody>) -> Response {
    if let Err(refused) = accounts.admit(peer.ip(), &headers, &body.handle) {
        return refused;
    }
    match accounts.store.account_by_handle(body.handle.trim()).filter(|a| verify_login(&body.login_secret, &a.login_hash)) {
        Some(account) => {
            accounts.store.touch_seen(account.id, now_secs());
            signed_in(&accounts, account.id, &account.handle, Some(&account.wrapped))
        }
        None => error(StatusCode::UNAUTHORIZED, "Wrong handle or password."),
    }
}

#[derive(Deserialize)]
struct ChallengeBody {
    handle: String,
}

/// `POST v1/login/challenge`. A nonce whether or not the handle exists, so this says nothing about which do.
async fn challenge(State(accounts): State<Arc<Accounts>>, ConnectInfo(peer): ConnectInfo<SocketAddr>, headers: HeaderMap, Json(body): Json<ChallengeBody>) -> Response {
    if let Err(refused) = accounts.admit(peer.ip(), &headers, &body.handle) {
        return refused;
    }
    let account = accounts.store.account_by_handle(body.handle.trim()).map(|a| a.id).unwrap_or(-1);
    let mut bytes = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut bytes);
    let nonce = URL_SAFE_NO_PAD.encode(bytes);
    let now = now_secs();
    if let Ok(mut challenges) = accounts.challenges.lock() {
        challenges.retain(|_, (_, issued)| now - *issued < CHALLENGE_TTL_SECS);
        challenges.insert(nonce.clone(), (account, now));
    }
    Json(json!({ "nonce": nonce })).into_response()
}

#[derive(Deserialize)]
struct DeviceLoginBody {
    handle: String,
    nonce: String,
    signature: String,
}

/// `POST v1/login/device`. The nonce is spent by the attempt, whether or not the signature holds.
async fn login_device(State(accounts): State<Arc<Accounts>>, ConnectInfo(peer): ConnectInfo<SocketAddr>, headers: HeaderMap, Json(body): Json<DeviceLoginBody>) -> Response {
    if let Err(refused) = accounts.admit(peer.ip(), &headers, &body.handle) {
        return refused;
    }
    let now = now_secs();
    let claimed = accounts.challenges.lock().ok().and_then(|mut c| c.remove(&body.nonce));
    let Some((account_id, issued)) = claimed.filter(|(_, issued)| now - issued < CHALLENGE_TTL_SECS) else {
        return error(StatusCode::UNAUTHORIZED, "That sign-in took too long. Try again.");
    };
    let _ = issued;
    let verified = accounts.store.account_by_handle(body.handle.trim()).filter(|a| a.id == account_id).filter(|a| {
        accounts
            .store
            .device_keys(a.id)
            .iter()
            .any(|key| crate::identity::verify_detached(key, body.nonce.as_bytes(), &body.signature))
    });
    match verified {
        Some(account) => {
            accounts.store.touch_seen(account.id, now);
            signed_in(&accounts, account.id, &account.handle, None)
        }
        None => error(StatusCode::UNAUTHORIZED, "This device could not be verified."),
    }
}

#[derive(Deserialize)]
struct RecoveryLoginBody {
    handle: String,
    login: String,
}

/// `POST v1/login/recovery`. The code is spent, and what comes back is the key wrapped under that code alone.
async fn login_recovery(State(accounts): State<Arc<Accounts>>, ConnectInfo(peer): ConnectInfo<SocketAddr>, headers: HeaderMap, Json(body): Json<RecoveryLoginBody>) -> Response {
    if let Err(refused) = accounts.admit(peer.ip(), &headers, &body.handle) {
        return refused;
    }
    let now = now_secs();
    let found = accounts.store.account_by_handle(body.handle.trim()).and_then(|a| {
        let wrapped = valid_login(&body.login).then(|| accounts.store.use_recovery_code(a.id, &hash_code(&body.login), now)).flatten()?;
        Some((a, wrapped))
    });
    match found {
        Some((account, wrapped)) => {
            accounts.store.touch_seen(account.id, now);
            signed_in(&accounts, account.id, &account.handle, Some(&wrapped))
        }
        None => error(StatusCode::UNAUTHORIZED, "Wrong handle or code, or a code already used."),
    }
}

/// `POST v1/refresh`. A fresh token for a live one.
async fn refresh(State(accounts): State<Arc<Accounts>>, headers: HeaderMap) -> Response {
    let who = match accounts.caller(&headers) {
        Ok(who) => who,
        Err(refused) => return refused,
    };
    match accounts.store.account_by_id(who.sub) {
        Some(account) => signed_in(&accounts, account.id, &account.handle, None),
        None => error(StatusCode::UNAUTHORIZED, "That account is gone."),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddDeviceBody {
    device_public_key: String,
    #[serde(default)]
    label: String,
}

/// `POST v1/device`. Another device for the signed-in account, so it can sign in without the password.
async fn add_device(State(accounts): State<Arc<Accounts>>, headers: HeaderMap, Json(body): Json<AddDeviceBody>) -> Response {
    let who = match accounts.caller(&headers) {
        Ok(who) => who,
        Err(refused) => return refused,
    };
    let key = body.device_public_key.trim();
    if key.is_empty() || key.len() > 64 {
        return error(StatusCode::BAD_REQUEST, "That device key could not be read.");
    }
    let label = if body.label.trim().is_empty() { "device" } else { body.label.trim() };
    match accounts.store.add_device_key(who.sub, key, label, now_secs()) {
        Ok(()) => Json(json!({ "ok": true })).into_response(),
        Err(_) => error(StatusCode::BAD_REQUEST, "That device key could not be stored."),
    }
}

/// `GET v1/keys`. The account key wrapped under the password, for a signed-in device that needs to unlock it.
async fn keys(State(accounts): State<Arc<Accounts>>, headers: HeaderMap) -> Response {
    let who = match accounts.caller(&headers) {
        Ok(who) => who,
        Err(refused) => return refused,
    };
    match accounts.store.account_by_id(who.sub) {
        Some(account) => Json(json!({ "wrapped": account.wrapped })).into_response(),
        None => error(StatusCode::UNAUTHORIZED, "That account is gone."),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PasswordBody {
    login_secret: String,
    wrapped: String,
}

/// `PUT v1/password`. A new password: set after a recovery code, or changed on a signed-in device.
async fn password(State(accounts): State<Arc<Accounts>>, headers: HeaderMap, Json(body): Json<PasswordBody>) -> Response {
    let who = match accounts.caller(&headers) {
        Ok(who) => who,
        Err(refused) => return refused,
    };
    if !valid_login(&body.login_secret) || !valid_wrapped(&body.wrapped) {
        return error(StatusCode::BAD_REQUEST, "That password could not be read.");
    }
    let hash = match hash_login(&body.login_secret) {
        Ok(hash) => hash,
        Err(refused) => return refused,
    };
    match accounts.store.set_password(who.sub, &hash, &body.wrapped) {
        Ok(()) => Json(json!({ "ok": true })).into_response(),
        Err(_) => error(StatusCode::INTERNAL_SERVER_ERROR, "That password could not be stored."),
    }
}

/// `GET v1/recovery`. How many unused codes are left, for Settings.
async fn recovery_left(State(accounts): State<Arc<Accounts>>, headers: HeaderMap) -> Response {
    match accounts.caller(&headers) {
        Ok(who) => Json(json!({ "left": accounts.store.recovery_codes_left(who.sub) })).into_response(),
        Err(refused) => refused,
    }
}

#[derive(Deserialize)]
struct RecoverySheetBody {
    codes: Vec<CodeBody>,
}

/// `POST v1/recovery`. A new sheet in place of the old: the device made the codes, and sends only their login halves
/// and the key wrapped under each.
async fn recovery_replace(State(accounts): State<Arc<Accounts>>, headers: HeaderMap, Json(body): Json<RecoverySheetBody>) -> Response {
    let who = match accounts.caller(&headers) {
        Ok(who) => who,
        Err(refused) => return refused,
    };
    let codes = match sheet(&body.codes) {
        Ok(codes) => codes,
        Err(refused) => return refused,
    };
    match accounts.store.replace_recovery_codes(who.sub, &codes) {
        Ok(()) => Json(json!({ "left": RECOVERY_CODES })).into_response(),
        Err(_) => error(StatusCode::INTERNAL_SERVER_ERROR, "Those codes could not be stored."),
    }
}

/// `GET v1/pubkey`. The key tokens are checked against, published as AttackFM publishes its own.
async fn pubkey(State(accounts): State<Arc<Accounts>>) -> Response {
    Json(json!({ "alg": "ed25519", "publicKey": accounts.issuer.public_b64() })).into_response()
}

pub fn router(accounts: Arc<Accounts>) -> Router {
    Router::new()
        .route("/glyph/api/v1/pubkey", get(pubkey))
        .route("/glyph/api/v1/signup", post(signup))
        .route("/glyph/api/v1/login", post(login))
        .route("/glyph/api/v1/login/challenge", post(challenge))
        .route("/glyph/api/v1/login/device", post(login_device))
        .route("/glyph/api/v1/login/recovery", post(login_recovery))
        .route("/glyph/api/v1/refresh", post(refresh))
        .route("/glyph/api/v1/device", post(add_device))
        .route("/glyph/api/v1/keys", get(keys))
        .route("/glyph/api/v1/password", put(password))
        .route("/glyph/api/v1/recovery", get(recovery_left).post(recovery_replace))
        .with_state(accounts)
}
