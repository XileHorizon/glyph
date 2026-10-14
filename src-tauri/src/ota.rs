//! Over-the-air updates: the web layer swapped without a new APK, and the
//! download half of installing one when the native layer changes.
//!
//! WHY THIS EXISTS. Glyph is sideloaded, so every change used to mean a 43 MB
//! APK, a browser download and an install prompt. Almost every change is to
//! the page, not the binary - so the binary now ships a frontend (the
//! "embedded" one, compiled in by `generate_context!`) and can also run a newer
//! one it downloaded, verified, and keeps under `<app_data_dir>/ota/`.
//!
//! HOW A DOWNLOADED FRONTEND REACHES THE WEBVIEW. Through a custom URI scheme,
//! `ota`, that serves the claimed bundle's files by their real relative paths:
//! `http://ota.localhost/assets/index-abc.js` on Android, `ota://localhost/...`
//! on Apple platforms. AttackFM does this with Tauri's `asset:` protocol
//! instead, and that protocol percent-encodes the whole file path into ONE URL
//! segment - so a relative `./chunk.js` or a CSS `url(./font.woff2)` resolves
//! to the protocol's root and 404s, and every AttackFM OTA build has to inline
//! every chunk, font and image into two fixed-name files. With real paths the
//! OTA bundle is simply `dist/`: the same build the website serves, hashed
//! names and all, and a font that did not change is not downloaded again.
//!
//! The document itself never moves. `index.html` is always the embedded one,
//! at the app's own origin, and its inline loader (see index.html) asks
//! `ota_claim_boot` what to run and adds the chosen bundle's module script and
//! stylesheets. The page's origin - and so its localStorage, its IPC access,
//! and the microphone permission - is the same whichever frontend runs.
//!
//! THE BOOT WAGER, and the part AttackFM learned the hard way (its comments
//! record five OTA versions lost to races around exactly this):
//!
//!  1. `ota_claim_boot` is the ONE call that changes state at launch. It stakes
//!     the bundle it hands out as `pending`, under a process-wide lock.
//!  2. The frontend that actually mounts calls `ota_boot_ok` with the build it
//!     is (or `None` for the embedded one). A matching build clears the stake.
//!     `None` clears it too, WITHOUT counting as a failure: the embedded
//!     frontend mounting means the loader fell back (a slow IPC answer, a
//!     timeout) and the bundle was never actually tried, which is not evidence
//!     against it. AttackFM's version left the stake standing in that case and
//!     quarantined good bundles.
//!  3. A stake still standing at the NEXT claim means a launch ran that bundle
//!     and never mounted. That is a strike; two strikes quarantine the build
//!     for good and fall back to the previous bundle, or to the embedded one.
//!     One strike is not enough because the phone killing the app in its first
//!     second is ordinary.
//!  4. `ota_boot_failed` is the loader's same-launch escape hatch: a bundle
//!     whose script or stylesheet will not load, or that has not mounted within
//!     its deadline, is quarantined at once and the embedded frontend mounts
//!     in the same launch. Nobody waits for a second bad start.
//!
//! NATIVE GENERATIONS. A bundle can only run on a binary that has the commands
//! it calls. `NATIVE_GENERATION` is what this binary provides; `BUNDLE_REQUIRES`
//! is what the page built from this tree needs, and it is the one stamped into
//! `ota.json` (vite.config.ts reads it out of this file). Bump both when the
//! page starts depending on a new command - and never stamp
//! `NATIVE_GENERATION`, which is how AttackFM once locked every older binary
//! out of every future update. A manifest needing more than this binary has is
//! reported as `needs-native`, which is the page's cue to offer the new APK.
//!
//! TRUST IS A KEY, NOT A DOMAIN. `ota.json` and `apk.json` are Ed25519-signed
//! (detached `.sig` files, scheme in scripts/ota-sign.mjs) and accepted only
//! if a key in src-tauri/ota-trusted-keys.txt signed them; every bundle file is
//! then checked against the manifest's SHA-256. So any host may serve updates,
//! an HTTP redirect cannot inject one, and a domain that lapses and changes
//! hands can stop updates but cannot ship code into the app.
//!
//! WHERE UPDATES COME FROM, and how that moves. The APK compiles in
//! src-tauri/ota-sources.txt. A verified manifest may carry `sources` (and
//! `services`, the other endpoints the app reaches); the app remembers the
//! newest such list and tries it first, the compiled list after. Publishing a
//! manifest that names a new domain is therefore how installed apps follow
//! Glyph to one - no new APK - and an older signed manifest can never roll the
//! list back. README "Moving to another domain" is the procedure.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use serde::{Deserialize, Serialize};
use tauri::http::{header, Response, StatusCode};
use tauri::{AppHandle, Manager, Runtime, State};

/// What this binary provides to a bundle. See the module header.
///
/// 2: signed manifests, remembered sources and services (0.3.0). A page may
/// read `sources`/`services` from `ota_status` but must treat them as optional
/// until BUNDLE_REQUIRES says 2. apk.json carries this number, which is how a
/// generation-1 app knows to offer the APK.
///
/// 3: `set_note_starred` / `set_note_archived`, the update-alert bridge (0.3.2).
/// The page feature-detects this through `ota_status` and hides swipe-to-star
/// and archive on older binaries rather than calling commands they lack.
///
/// 4: the on-device model (`ai_*`), `set_note_formatted` / `set_note_project`,
/// and `capture_rewind` (0.4.0). The Formatted view and the cassette's rewind
/// only appear where `ota_status` reports 4; on 3 the tape still pauses.
///
/// 5: handwriting - `GlyphHost.inkPrepare` / `inkRecognize` in the Android
/// shell, ML Kit digital ink (0.5.0). Removed again in 0.5.2 at Matt's call; the
/// number stays, because a generation never goes backwards, and no page reads
/// the ink bridge any more.
///
/// 6: the on-device model is REMOVED - no `ai_*`, no `set_note_formatted` /
/// `set_note_project` - along with projects and suggestions (0.6.0). A bump for
/// a removal, not an addition, so apk.json tells generation-4 and -5 phones
/// that a new APK exists. A page from before it cannot run on this binary
/// anyway: `ota_claim_boot` only keeps a stored bundle newer than the embedded
/// frontend, and this APK's embedded frontend is newer than any 0.5.x bundle.
///
/// 7: `capture_refine`, `capture_refine_model_status` and
/// `capture_fetch_refine_model` - a saved recording transcribed again with
/// small.en after Done (0.6.0).
///
/// 8: `save_image` and the `img` scheme - pictures in notes, adopted from the
/// shell's picker and drawn from `http://img.localhost/<name>` - and
/// `delete_note` removing the pictures a note took with it (0.7.0).
///
/// 9: `save_image_data` - a pasted picture, shrunk by the page and sent as
/// base64, kept only if its bytes are a JPEG, PNG or WebP (0.8.0).
///
/// 10: the on-device formatter is back - `ai_models`, `ai_fetch_model`,
/// `ai_delete_model`, `ai_generate`, `ai_cancel` - and the back gesture handed
/// to the page (0.9.0).
///
/// 11: `ai_device` (memory, cores, chip, free disk), `reset_local_data`, and
/// the hinge angle for the unfold (0.9.1).
///
/// 12: `GlyphHost.setCapturing` - the screen kept on while recording, and
/// `window.__glyph.screenOff` when it goes off anyway, which is the side key
/// pressed to stop - Notion: `notion_save_account`, `notion_account`,
/// `notion_disconnect`, `notion_request` - and `GlyphHost.readClipboard` for
/// the editor's Paste (1.0.0).
///
/// 13: `ai_generate` takes `think`, which leaves a reasoning model's thinking
/// on and streams it ahead of the answer, flagged `thinking` on progress and
/// output - for the review after a recording (1.1.0).
///
/// 14: `hardware` on the model's progress - memory, process CPU, cores, the
/// hottest readable thermal zone - for the AI card (1.2.0).
///
/// 15: notes are a library of Markdown files (library/, docs/LIBRARY.md) in the
/// app's storage, moved in from the old database on first launch; every note
/// carries its `path` (1.3.0).
///
/// 16: `store_apply`, a note written as another device has it, and
/// `sync_put_file`, a synced recording or picture, for sync (docs/SYNC.md).
///
/// 17: `link_preview`, a web page's title for the card under a link.
///
/// 18: revision-checked note create/update, guarded command mutation/undo,
/// and constrained local instruction inference.
pub const NATIVE_GENERATION: u32 = 18;

/// What the page built from THIS tree needs. vite.config.ts reads this line
/// with a regex and stamps it into `ota.json`, so keep it a literal. Nothing in
/// Rust reads it but the test that keeps it at or under `NATIVE_GENERATION`.
#[allow(dead_code)]
pub const BUNDLE_REQUIRES: u32 = 18;

/// The public keys a manifest must be signed by (any one of them). Compiled in:
/// trust belongs to whoever holds a private key, never to whichever domain
/// happens to answer. See scripts/ota-sign.mjs for the scheme and the keys.
const TRUSTED_KEYS: &str = include_str!("../ota-trusted-keys.txt");

/// Where this APK looks for updates when it knows no better, most preferred
/// first. A verified manifest's `sources` list is remembered and tried before
/// these - that is how installs follow Glyph to a new domain. The same file
/// deploy-ota.mjs stamps into the manifest; see its header.
const COMPILED_SOURCES: &str = include_str!("../ota-sources.txt");

/// `GLYPH_OTA_BASE` at COMPILE time replaces the compiled sources with one test
/// server - an emulator reaching the host at `http://10.0.2.2:8787`, say - and
/// is the only thing that permits plain http. A compile-time switch on purpose:
/// a runtime one would let anything that can write the app's storage choose
/// where its code comes from. (Signatures would still refuse a foreign bundle,
/// but a test knob has no business in a shipped binary's attack surface.)
const TEST_SOURCE: Option<&str> = option_env!("GLYPH_OTA_BASE");

/// `GLYPH_STAGING` at COMPILE time (the same switch build.gradle.kts reads):
/// a staging build runs beside the real app under its own id and never checks
/// for updates, so the page it was built with is the page that runs.
pub const STAGING: bool = option_env!("GLYPH_STAGING").is_some();

/// Signature contexts, so a signature over one kind of file cannot be replayed
/// as another. They must match scripts/ota-sign.mjs byte for byte.
#[cfg(not(target_os = "ios"))]
const CONTEXT_MANIFEST: &[u8] = b"glyph-ota\0";
#[cfg(not(target_os = "ios"))]
const CONTEXT_APK: &[u8] = b"glyph-apk\0";

/// No manifest may name more than this many sources or mirrors.
const MAX_URLS: usize = 8;

/// The URI scheme the claimed bundle is served under.
pub const SCHEME: &str = "ota";

/// Consecutive launches that ran a bundle and never mounted it before it is quarantined.
const STRIKES_TO_QUARANTINE: u32 = 2;

/// The manifest's own name, in `dist/`, on the server, and inside every bundle directory.
const MANIFEST_FILE: &str = "ota.json";

// ---- shapes -------------------------------------------------------------------

/// `ota.json`, as the build writes it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub schema: u32,
    /// UTC `YYYYMMDDHHMMSS`. Digits only, so it is also a safe directory name
    /// and compares as a number.
    pub build: String,
    pub version: String,
    /// The native generation this bundle needs.
    pub native: u32,
    /// The module script, relative to the bundle root.
    pub entry: String,
    pub styles: Vec<String>,
    pub files: Vec<ManifestFile>,
    /// Where to look for updates from now on, most preferred first. Optional,
    /// so manifests from before signing still parse; remembered only from a
    /// manifest whose signature verified.
    #[serde(default)]
    pub sources: Vec<String>,
    /// Other services the app reaches, so they can move with the domain too.
    #[serde(default)]
    pub services: Services,
    /// What changed, in a sentence or two - the text of an update alert.
    #[serde(default)]
    pub notes: Option<String>,
}

/// Service endpoints a signed manifest can move. Every field is optional; a
/// consumer uses what is here and falls back to its own compiled-in default.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Services {
    /// The formatting endpoint (src/app/capture/annotate.ts).
    pub format: Option<String>,
    /// Base URLs the Whisper model files are served under, most preferred first
    /// (src-tauri/src/whisper/model.rs). Hashes stay pinned in the binary.
    pub model_mirrors: Vec<String>,
}

/// `sources.json`: the newest signed word on where updates and services live.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Known {
    sources: Vec<String>,
    services: Services,
    /// The build whose manifest set these, so an older signed manifest - a
    /// stale mirror, or one replayed on purpose - can never roll them back.
    build: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestFile {
    pub path: String,
    pub sha256: String,
    pub bytes: u64,
}

/// `state.json`: which bundle runs, which one it replaced, and what has failed.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Stored {
    active: Option<String>,
    previous: Option<String>,
    pending: Option<String>,
    strikes: u32,
    quarantined: Vec<String>,
}

/// What the loader needs to run a bundle, or `bundle: None` for the embedded frontend.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootState {
    pub bundle: Option<BootBundle>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootBundle {
    pub build: String,
    pub version: String,
    /// Absolute URL prefix the entry and styles are relative to.
    pub base: String,
    pub entry: String,
    pub styles: Vec<String>,
}

/// Everything Settings shows about versions.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub native_version: String,
    pub native_generation: u32,
    pub embedded_build: Option<String>,
    pub embedded_version: Option<String>,
    pub active_build: Option<String>,
    pub active_version: Option<String>,
    /// The build this process is serving right now, which lags `active` until a reload.
    pub running_build: Option<String>,
    pub quarantined: Vec<String>,
    /// Where updates are looked for, in the order they are tried.
    pub sources: Vec<String>,
    pub services: Services,
}

/// The APK the server offers, as `deploy:ota --apk` describes it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApkInfo {
    pub version: String,
    pub version_code: u64,
    pub native: u32,
    pub sha256: String,
    pub bytes: u64,
    /// Relative to the APK description's own URL.
    pub url: String,
}

/// The answer to "is there anything new?"
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    /// `current`, `installed` (reload to run it), `needs-native`, `quarantined`, or `offline`.
    pub web: &'static str,
    pub web_build: Option<String>,
    pub web_version: Option<String>,
    pub apk: Option<ApkInfo>,
    /// Why the web half could not be checked, when `web` is `offline`.
    pub error: Option<String>,
    /// The source that answered with a verified manifest.
    pub source: Option<String>,
}

// ---- managed state ----------------------------------------------------------------

pub struct OtaState {
    /// Around every read-modify-write of `state.json`.
    lock: Mutex<()>,
    /// The bundle directory the `ota` scheme serves. Set by each claim and by
    /// nothing else, so a bundle installed mid-run is not served until the page
    /// reloads and claims it - half an old frontend and half a new one is the
    /// failure this prevents.
    serving: Mutex<Option<(String, PathBuf)>>,
    /// One install at a time; a check that finds one running waits for it.
    #[cfg(not(target_os = "ios"))]
    installing: tauri::async_runtime::Mutex<()>,
    /// The embedded manifest, read once.
    embedded: Mutex<Option<Option<Manifest>>>,
}

pub fn install<R: Runtime>(app: &tauri::App<R>) {
    app.manage(OtaState {
        lock: Mutex::new(()),
        serving: Mutex::new(None),
        #[cfg(not(target_os = "ios"))]
        installing: tauri::async_runtime::Mutex::new(()),
        embedded: Mutex::new(None),
    });
}

/// A poisoned lock is recovered: every write below is a whole file, so a panic
/// mid-command leaves either the old state or the new one, never half.
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

// ---- disk -----------------------------------------------------------------------

fn root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data directory: {e}"))?
        .join("ota");
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    Ok(dir)
}

fn read_stored(root: &Path) -> Stored {
    std::fs::read(root.join("state.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

/// Around every read-modify-write of `installed.json` and `sources.json`. Those
/// two are written from outside the command lock too: by the background update
/// check (update_alerts.rs), which WorkManager runs on its own thread in the
/// SAME process as an open app - so without this, the worker and the app's own
/// check can both read the old file and the older write can land last.
static FILES: Mutex<()> = Mutex::new(());

/// Write `name` under `root` via a uniquely named temporary file and a rename,
/// so a process killed mid-write leaves the previous file rather than a
/// truncated one, and two writers at once never share - and garble - one
/// temporary file.
fn write_atomically(root: &Path, name: &str, bytes: &[u8]) -> std::io::Result<()> {
    let temp = root.join(format!(".{name}.{}.tmp", uuid::Uuid::new_v4().simple()));
    std::fs::write(&temp, bytes)?;
    std::fs::rename(&temp, root.join(name)).inspect_err(|_| {
        let _ = std::fs::remove_file(&temp);
    })
}

/// A truncated state reads back as "no bundle, nothing quarantined", which is
/// why this goes through `write_atomically`.
fn write_stored(root: &Path, stored: &Stored) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(stored).map_err(|e| e.to_string())?;
    write_atomically(root, "state.json", &bytes).map_err(|e| format!("cannot write OTA state: {e}"))
}

/// A build id is 14 digits and nothing else: it becomes a directory name.
fn build_number(build: &str) -> Option<u64> {
    (build.len() == 14 && build.bytes().all(|b| b.is_ascii_digit()))
        .then(|| build.parse().ok())
        .flatten()
}

/// A path inside a bundle: relative, no `..`, and only the characters Vite
/// names files with. Anything else is refused rather than escaped - there is
/// no legitimate file a bundle could need that fails this.
fn safe_relative(path: &str) -> Option<&str> {
    let ok = !path.is_empty()
        && !path.starts_with('/')
        && path
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-' | b'/'))
        && path.split('/').all(|part| !part.is_empty() && part != "." && part != "..");
    ok.then_some(path)
}

/// A base URL a manifest may point the app at: https (http only in a test
/// build), no whitespace or fragments, no trailing slash, and short.
fn valid_url(url: &str) -> bool {
    let secure = url.starts_with("https://") || (TEST_SOURCE.is_some() && url.starts_with("http://"));
    secure
        && url.len() <= 512
        && !url.ends_with('/')
        && !url.bytes().any(|b| b.is_ascii_whitespace() || b.is_ascii_control() || matches!(b, b'#' | b'"' | b'\\'))
        && url.split("://").nth(1).is_some_and(|rest| !rest.is_empty())
}

/// The non-comment lines of a compiled-in list file (the same parse as ota-sign.mjs).
fn list(text: &str) -> impl Iterator<Item = &str> {
    text.lines().map(|line| line.split('#').next().unwrap_or("").trim()).filter(|line| !line.is_empty())
}

fn compiled_sources() -> Vec<String> {
    match TEST_SOURCE {
        Some(test) => vec![test.trim_end_matches('/').to_string()],
        None => list(COMPILED_SOURCES).map(str::to_string).collect(),
    }
}

fn read_known(root: &Path) -> Known {
    std::fs::read(root.join("sources.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

/// The remembered sources first, then the compiled ones, without repeats. The
/// compiled list is never dropped: if every new domain dies, the one the APK
/// was built with is still tried.
fn effective_sources(known: &Known) -> Vec<String> {
    let mut all: Vec<String> = Vec::new();
    for source in known.sources.iter().cloned().chain(compiled_sources()) {
        if valid_url(&source) && !all.contains(&source) {
            all.push(source);
        }
    }
    all
}

/// The service endpoints the newest verified manifest announced. For other
/// modules: each falls back to its own default for anything absent.
pub fn services<R: Runtime>(app: &AppHandle<R>) -> Services {
    root(app).map(|r| read_known(&r).services).unwrap_or_default()
}

fn validate(manifest: &Manifest) -> Result<(), String> {
    if manifest.notes.as_ref().is_some_and(|n| n.len() > 2000) {
        return Err("notes longer than 2000 bytes".to_string());
    }
    if manifest.sources.len() > MAX_URLS || manifest.services.model_mirrors.len() > MAX_URLS {
        return Err("too many sources or mirrors".to_string());
    }
    let urls = manifest.sources.iter().chain(&manifest.services.model_mirrors).chain(&manifest.services.format);
    if let Some(bad) = urls.into_iter().find(|u| !valid_url(u)) {
        return Err(format!("unacceptable URL {bad:?}"));
    }
    if manifest.schema != 1 {
        return Err(format!("unknown manifest schema {}", manifest.schema));
    }
    build_number(&manifest.build).ok_or_else(|| format!("bad build id {:?}", manifest.build))?;
    let listed: std::collections::HashSet<&str> = manifest.files.iter().map(|f| f.path.as_str()).collect();
    for file in &manifest.files {
        safe_relative(&file.path).ok_or_else(|| format!("unsafe path {:?}", file.path))?;
        if file.sha256.len() != 64 || !file.sha256.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(format!("{}: bad sha256", file.path));
        }
    }
    // The loader asks for these by name; a bundle without them boots blank.
    for needed in std::iter::once(&manifest.entry).chain(&manifest.styles) {
        if !listed.contains(needed.as_str()) {
            return Err(format!("the manifest names {needed} but does not ship it"));
        }
    }
    Ok(())
}

/// A bundle directory's manifest, if the directory is complete.
fn bundle_manifest(dir: &Path) -> Option<Manifest> {
    let manifest: Manifest = serde_json::from_slice(&std::fs::read(dir.join(MANIFEST_FILE)).ok()?).ok()?;
    validate(&manifest).ok()?;
    let complete = manifest.files.iter().all(|f| {
        std::fs::metadata(dir.join(&f.path))
            .map(|m| m.len() == f.bytes)
            .unwrap_or(false)
    });
    complete.then_some(manifest)
}

fn embedded_manifest<R: Runtime>(app: &AppHandle<R>, state: &OtaState) -> Option<Manifest> {
    let mut cached = lock(&state.embedded);
    if let Some(known) = cached.as_ref() {
        return known.clone();
    }
    // The resolver answers a missing path with index.html, so a parse failure
    // here is how "this build has no ota.json" reads - e.g. a dev build.
    let found = app
        .asset_resolver()
        .get(MANIFEST_FILE.to_string())
        .and_then(|asset| serde_json::from_slice::<Manifest>(&asset.bytes).ok())
        .filter(|m| validate(m).is_ok());
    *cached = Some(found.clone());
    found
}

fn remove_bundle(root: &Path, build: &str) {
    if build_number(build).is_some() {
        let _ = std::fs::remove_dir_all(root.join(build));
    }
}

/// `installed.json`: the newest frontend build this install can already run,
/// embedded or downloaded. The background update check (update_alerts.rs) runs
/// with no Tauri in the process and so cannot read the embedded manifest; it
/// compares against this instead, so it never announces what is already here.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Installed {
    build: Option<String>,
}

fn record_installed(root: &Path, build: &str) {
    let _files = lock(&FILES);
    let had = std::fs::read(root.join("installed.json"))
        .ok()
        .and_then(|b| serde_json::from_slice::<Installed>(&b).ok())
        .and_then(|i| i.build)
        .as_deref()
        .and_then(build_number)
        .unwrap_or(0);
    if build_number(build).unwrap_or(0) <= had {
        return;
    }
    if let Ok(bytes) = serde_json::to_vec(&Installed { build: Some(build.to_string()) }) {
        let _ = write_atomically(root, "installed.json", &bytes);
    }
}

fn read_installed(root: &Path) -> Option<String> {
    std::fs::read(root.join("installed.json"))
        .ok()
        .and_then(|b| serde_json::from_slice::<Installed>(&b).ok())
        .and_then(|i| i.build)
}

/// The scheme's URL prefix on this platform. Android and Windows route custom
/// schemes through `http://<scheme>.localhost`; everything else uses the scheme.
fn scheme_base() -> String {
    if cfg!(any(target_os = "android", target_os = "windows")) {
        format!("http://{SCHEME}.localhost/")
    } else {
        format!("{SCHEME}://localhost/")
    }
}

// ---- commands -----------------------------------------------------------------

/// Decide what this launch runs, and stake it. Called once per page load, by
/// the loader in index.html and by nothing else.
#[tauri::command]
pub fn ota_claim_boot<R: Runtime>(app: AppHandle<R>, state: State<'_, OtaState>) -> BootState {
    let embedded = embedded_manifest(&app, &state);
    let Ok(root) = root(&app) else {
        *lock(&state.serving) = None;
        return BootState { bundle: None };
    };
    let _guard = lock(&state.lock);
    let mut stored = read_stored(&root);
    let before = serde_json::to_string(&stored).unwrap_or_default();

    // 1. The last launch staked a bundle and nothing ever said it mounted.
    if let Some(failed) = stored.pending.take() {
        stored.strikes += 1;
        if stored.strikes >= STRIKES_TO_QUARANTINE && stored.active.as_deref() == Some(failed.as_str()) {
            quarantine(&root, &mut stored, &failed);
        }
    }

    // 2. Drop an active bundle this binary should not run: incomplete on disk,
    //    needing a newer native layer, or no newer than the frontend compiled
    //    in. The last case is a new APK installed over an old OTA bundle - the
    //    APK's own frontend is the fresher one, and a stale download must not
    //    hide it (AttackFM's `reclaimEmbeddedIfNewer`).
    let embedded_build = embedded.as_ref().and_then(|m| build_number(&m.build)).unwrap_or(0);
    let mut chosen = None;
    while let Some(active) = stored.active.clone() {
        let dir = root.join(&active);
        match bundle_manifest(&dir) {
            Some(m) if m.native <= NATIVE_GENERATION && build_number(&m.build).unwrap_or(0) > embedded_build => {
                chosen = Some((m, dir));
                break;
            }
            _ => {
                remove_bundle(&root, &active);
                stored.active = stored.previous.take();
                stored.strikes = 0;
            }
        }
    }

    if let Some(embedded) = embedded.as_ref() {
        record_installed(&root, &embedded.build);
    }

    // 3. Stake it.
    let boot = match chosen {
        Some((manifest, dir)) => {
            stored.pending = Some(manifest.build.clone());
            *lock(&state.serving) = Some((manifest.build.clone(), dir));
            BootState {
                bundle: Some(BootBundle {
                    base: scheme_base(),
                    build: manifest.build,
                    version: manifest.version,
                    entry: manifest.entry,
                    styles: manifest.styles,
                }),
            }
        }
        None => {
            *lock(&state.serving) = None;
            BootState { bundle: None }
        }
    };

    if serde_json::to_string(&stored).unwrap_or_default() != before {
        // A state that cannot be written is a stake that will not be there
        // next launch: the bundle runs unwagered, which is the lesser failure.
        let _ = write_stored(&root, &stored);
    }
    boot
}

fn quarantine(root: &Path, stored: &mut Stored, build: &str) {
    if !stored.quarantined.iter().any(|q| q == build) {
        stored.quarantined.push(build.to_string());
    }
    if stored.active.as_deref() == Some(build) {
        stored.active = stored.previous.take().filter(|p| p != build);
    }
    if stored.previous.as_deref() == Some(build) {
        stored.previous = None;
    }
    if stored.pending.as_deref() == Some(build) {
        stored.pending = None;
    }
    stored.strikes = 0;
    remove_bundle(root, build);
}

/// The frontend that mounted reports in. `None` is the embedded frontend.
#[tauri::command]
pub fn ota_boot_ok<R: Runtime>(app: AppHandle<R>, state: State<'_, OtaState>, build: Option<String>) -> Result<(), String> {
    let root = root(&app)?;
    let _guard = lock(&state.lock);
    let mut stored = read_stored(&root);
    match (&build, &stored.pending) {
        (Some(ran), Some(pending)) if ran == pending => {
            stored.pending = None;
            stored.strikes = 0;
        }
        // The embedded frontend mounted: the staked bundle was never tried,
        // which is neither a pass nor a strike.
        (None, Some(_)) => stored.pending = None,
        _ => return Ok(()),
    }
    write_stored(&root, &stored)
}

/// The loader's same-launch verdict: this bundle would not load or mount.
#[tauri::command]
pub fn ota_boot_failed<R: Runtime>(app: AppHandle<R>, state: State<'_, OtaState>, build: String, reason: String) -> Result<(), String> {
    build_number(&build).ok_or("bad build id")?;
    // The page logs the reason to the console, which is what reaches logcat.
    let _ = reason;
    let root = root(&app)?;
    let _guard = lock(&state.lock);
    let mut stored = read_stored(&root);
    quarantine(&root, &mut stored, &build);
    *lock(&state.serving) = None;
    write_stored(&root, &stored)
}

#[tauri::command]
pub fn ota_status<R: Runtime>(app: AppHandle<R>, state: State<'_, OtaState>) -> Status {
    let embedded = embedded_manifest(&app, &state);
    let stored = root(&app).map(|r| read_stored(&r)).unwrap_or_default();
    let known = root(&app).map(|r| read_known(&r)).unwrap_or_default();
    let active_version = root(&app)
        .ok()
        .zip(stored.active.as_ref())
        .and_then(|(r, a)| bundle_manifest(&r.join(a)))
        .map(|m| m.version);
    Status {
        native_version: app.package_info().version.to_string(),
        native_generation: NATIVE_GENERATION,
        embedded_build: embedded.as_ref().map(|m| m.build.clone()),
        embedded_version: embedded.map(|m| m.version),
        active_build: stored.active,
        active_version,
        running_build: lock(&state.serving).as_ref().map(|(build, _)| build.clone()),
        quarantined: stored.quarantined,
        sources: effective_sources(&known),
        services: known.services,
    }
}

/// Forget every downloaded bundle; the next load runs the embedded frontend.
#[tauri::command]
pub fn ota_revert<R: Runtime>(app: AppHandle<R>, state: State<'_, OtaState>) -> Result<(), String> {
    let root = root(&app)?;
    let _guard = lock(&state.lock);
    let mut stored = read_stored(&root);
    for build in [stored.active.take(), stored.previous.take(), stored.pending.take()].into_iter().flatten() {
        remove_bundle(&root, &build);
    }
    stored.strikes = 0;
    write_stored(&root, &stored)
}

// ---- the scheme ------------------------------------------------------------------

fn mime_for(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("") {
        "js" | "mjs" => "text/javascript",
        "css" => "text/css",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "wasm" => "application/wasm",
        "html" => "text/html",
        _ => "application/octet-stream",
    }
}

/// Serves the claimed bundle. Every response carries `Access-Control-Allow-Origin`
/// because the page's origin is the app's, not this scheme's, and module
/// scripts and fonts are fetched in CORS mode: without the header the entry
/// script is refused and the page stays blank. `no-store` because a WebView
/// cache keyed on a path that now holds a different build is a stale frontend.
pub fn serve<R: Runtime>(app: &AppHandle<R>, request: &tauri::http::Request<Vec<u8>>) -> Response<Vec<u8>> {
    let respond = |status: StatusCode, mime: &str, body: Vec<u8>| {
        Response::builder()
            .status(status)
            .header(header::CONTENT_TYPE, mime)
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .header(header::CACHE_CONTROL, "no-store")
            .body(body)
            .unwrap_or_else(|_| Response::new(Vec::new()))
    };
    let path = request.uri().path().trim_start_matches('/');
    let Some(path) = safe_relative(path) else {
        return respond(StatusCode::BAD_REQUEST, "text/plain", b"bad path".to_vec());
    };
    let Some(state) = app.try_state::<OtaState>() else {
        return respond(StatusCode::SERVICE_UNAVAILABLE, "text/plain", Vec::new());
    };
    let Some((_, dir)) = lock(&state.serving).clone() else {
        return respond(StatusCode::NOT_FOUND, "text/plain", b"no bundle claimed".to_vec());
    };
    match std::fs::read(dir.join(path)) {
        Ok(bytes) => respond(StatusCode::OK, mime_for(path), bytes),
        Err(_) => respond(StatusCode::NOT_FOUND, "text/plain", b"not in this bundle".to_vec()),
    }
}

// ---- checking and installing (not on iOS: no reqwest there) --------------------------

#[cfg(not(target_os = "ios"))]
fn client() -> Result<reqwest::Client, String> {
    // Connect and read timeouts, never a total one: a 43 MB APK over a slow
    // connection is legitimately minutes (the same reasoning as model.rs).
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .read_timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("cannot start an HTTP client: {e}"))
}

#[cfg(not(target_os = "ios"))]
async fn fetch_bytes(client: &reqwest::Client, url: &str) -> Result<Vec<u8>, String> {
    let response = client
        .get(url)
        .header(header::CACHE_CONTROL.as_str(), "no-cache")
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|e| format!("{url}: {e}"))?;
    response.bytes().await.map(|b| b.to_vec()).map_err(|e| format!("{url}: {e}"))
}

/// Whether any of `keys` (raw 32-byte Ed25519 keys, base64) signed context + bytes.
#[cfg(not(target_os = "ios"))]
fn verify_with<'a>(keys: impl IntoIterator<Item = &'a str>, context: &[u8], bytes: &[u8], signature: &str) -> bool {
    use base64::Engine;
    use ring::signature::{UnparsedPublicKey, ED25519};
    let engine = base64::engine::general_purpose::STANDARD;
    let Ok(signature) = engine.decode(signature.trim()) else {
        return false;
    };
    let mut message = Vec::with_capacity(context.len() + bytes.len());
    message.extend_from_slice(context);
    message.extend_from_slice(bytes);
    keys.into_iter().any(|key| {
        engine
            .decode(key)
            .is_ok_and(|raw| raw.len() == 32 && UnparsedPublicKey::new(&ED25519, raw).verify(&message, &signature).is_ok())
    })
}

/// Fetch `url` and `url.sig`, and parse the file only if a trusted key signed
/// exactly those bytes. Parsing comes AFTER verifying on purpose: a JSON parser
/// never sees a byte an attacker chose.
#[cfg(not(target_os = "ios"))]
async fn fetch_signed<T: serde::de::DeserializeOwned>(client: &reqwest::Client, url: &str, context: &[u8]) -> Result<T, String> {
    let body = fetch_bytes(client, url).await?;
    let signature = fetch_bytes(client, &format!("{url}.sig")).await?;
    let signature = String::from_utf8_lossy(&signature);
    if !verify_with(list(TRUSTED_KEYS), context, &body, &signature) {
        return Err(format!("{url}: the signature did not verify against any trusted key"));
    }
    serde_json::from_slice::<T>(&body).map_err(|e| format!("{url}: {e}"))
}

/// The first source, in order, that serves a verified, valid manifest.
#[cfg(not(target_os = "ios"))]
async fn find_manifest(client: &reqwest::Client, sources: &[String]) -> Result<(String, Manifest), String> {
    let mut failures = Vec::new();
    for source in sources {
        match fetch_signed::<Manifest>(client, &format!("{source}/{MANIFEST_FILE}"), CONTEXT_MANIFEST)
            .await
            .and_then(|m| validate(&m).map(|()| m))
        {
            Ok(manifest) => return Ok((source.clone(), manifest)),
            Err(error) => failures.push(error),
        }
    }
    Err(if failures.is_empty() { "no update sources".to_string() } else { failures.join("; ") })
}

/// Remember a verified manifest's sources and services, unless a newer build already set them.
#[cfg(not(target_os = "ios"))]
fn remember(root: &Path, manifest: &Manifest) {
    if manifest.sources.is_empty() {
        return;
    }
    let _files = lock(&FILES);
    let known = read_known(root);
    let newer = known
        .build
        .as_deref()
        .and_then(build_number)
        .is_none_or(|had| build_number(&manifest.build).unwrap_or(0) >= had);
    if !newer || (known.sources == manifest.sources && known.services == manifest.services) {
        return;
    }
    let next = Known { sources: manifest.sources.clone(), services: manifest.services.clone(), build: Some(manifest.build.clone()) };
    if let Ok(bytes) = serde_json::to_vec_pretty(&next) {
        let _ = write_atomically(root, "sources.json", &bytes);
    }
}

#[cfg(not(target_os = "ios"))]
fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

/// Look for a newer web bundle and install it; report the published APK alongside.
///
/// Installing does not run the bundle. It lands in `active`, and the next page
/// load claims it - the page offers a reload when the person is somewhere a
/// reload costs nothing, and a cold start picks it up regardless.
#[tauri::command]
pub async fn ota_check<R: Runtime>(app: AppHandle<R>, state: State<'_, OtaState>) -> Result<CheckResult, String> {
    #[cfg(target_os = "ios")]
    {
        let _ = (app, state);
        Err("Over-the-air updates are Android-only.".to_string())
    }
    #[cfg(not(target_os = "ios"))]
    {
        if STAGING {
            return Ok(CheckResult { web: "current", web_build: None, web_version: None, apk: None, error: None, source: None });
        }
        let client = client()?;
        let root = root(&app)?;
        let sources = effective_sources(&read_known(&root));
        let (source, manifest) = match find_manifest(&client, &sources).await {
            Ok(found) => found,
            Err(error) => {
                return Ok(CheckResult { web: "offline", web_build: None, web_version: None, apk: None, error: Some(error), source: None });
            }
        };
        remember(&root, &manifest);
        // The APK description is advisory, and comes from the same source as
        // the manifest; its absence or a bad signature is not a failed check.
        let apk = fetch_signed::<ApkInfo>(&client, &format!("{source}/apk.json"), CONTEXT_APK).await.ok();
        let result = |web: &'static str| CheckResult {
            web,
            web_build: Some(manifest.build.clone()),
            web_version: Some(manifest.version.clone()),
            apk: apk.clone(),
            error: None,
            source: Some(source.clone()),
        };

        let _one_install = state.installing.lock().await;
        let embedded = embedded_manifest(&app, &state);
        let stored = {
            let _guard = lock(&state.lock);
            read_stored(&root)
        };
        let offered = build_number(&manifest.build).unwrap_or(0);
        let have = stored
            .active
            .as_deref()
            .and_then(build_number)
            .into_iter()
            .chain(embedded.as_ref().and_then(|m| build_number(&m.build)))
            .max()
            .unwrap_or(0);
        if offered <= have {
            return Ok(result("current"));
        }
        if stored.quarantined.contains(&manifest.build) {
            return Ok(result("quarantined"));
        }
        if manifest.native > NATIVE_GENERATION {
            return Ok(result("needs-native"));
        }

        install_bundle(&app, &client, &root, &manifest, stored.active.as_deref(), &source).await?;

        let _guard = lock(&state.lock);
        let mut stored = read_stored(&root);
        if stored.quarantined.contains(&manifest.build) {
            // Quarantined while it downloaded (a same-launch failure report).
            remove_bundle(&root, &manifest.build);
            return Ok(result("quarantined"));
        }
        if stored.active.as_deref() != Some(manifest.build.as_str()) {
            stored.previous = stored.active.take();
        }
        stored.active = Some(manifest.build.clone());
        stored.strikes = 0;
        // Everything but the new bundle, its predecessor, and whatever this
        // process is serving right now goes.
        let serving = lock(&state.serving).as_ref().map(|(b, _)| b.clone());
        let keep: Vec<&str> = [stored.active.as_deref(), stored.previous.as_deref(), serving.as_deref()]
            .into_iter()
            .flatten()
            .collect();
        prune(&root, &keep);
        write_stored(&root, &stored)?;
        record_installed(&root, &manifest.build);
        Ok(result("installed"))
    }
}

/// What the published update looks like, for the background alert check.
#[cfg(not(target_os = "ios"))]
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Peek {
    pub web_build: String,
    pub web_version: String,
    pub notes: Option<String>,
    pub installed_build: Option<String>,
    pub apk_version: Option<String>,
    pub apk_version_code: Option<u64>,
    pub apk_native: Option<u32>,
}

/// Look at what is published, verified exactly as `ota_check` does - same
/// signatures, same remembered sources - without installing anything. Blocking,
/// and free of `AppHandle`, because its caller is a WorkManager job in a
/// process where Tauri may never have started. `root` is `<app_data_dir>/ota`.
#[cfg(not(target_os = "ios"))]
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub fn peek(root: &Path) -> Result<Peek, String> {
    std::fs::create_dir_all(root).map_err(|e| format!("cannot create {}: {e}", root.display()))?;
    tauri::async_runtime::block_on(async {
        let client = client()?;
        let (source, manifest) = find_manifest(&client, &effective_sources(&read_known(root))).await?;
        remember(root, &manifest);
        let apk = fetch_signed::<ApkInfo>(&client, &format!("{source}/apk.json"), CONTEXT_APK).await.ok();
        Ok(Peek {
            web_build: manifest.build,
            web_version: manifest.version,
            notes: manifest.notes,
            installed_build: read_installed(root),
            apk_version: apk.as_ref().map(|a| a.version.clone()),
            apk_version_code: apk.as_ref().map(|a| a.version_code),
            apk_native: apk.as_ref().map(|a| a.native),
        })
    })
}

/// Download (or reuse) every file into a staging directory, verify, then rename into place.
///
/// A file is REUSED when the running bundle or the embedded frontend already
/// has those exact bytes. Vite names files by content hash, so a release that
/// only touched the page's code downloads its JS and CSS and nothing else -
/// the fonts are most of `dist/` by size and almost never change.
#[cfg(not(target_os = "ios"))]
async fn install_bundle<R: Runtime>(
    app: &AppHandle<R>,
    client: &reqwest::Client,
    root: &Path,
    manifest: &Manifest,
    active: Option<&str>,
    base: &str,
) -> Result<(), String> {
    let staging = root.join(format!(".staging-{}", manifest.build));
    let _ = std::fs::remove_dir_all(&staging);
    let cleanup = scopeguard(&staging);
    let active_dir = active.map(|a| root.join(a));
    let mut reused = 0usize;
    let mut fetched = 0usize;

    for file in &manifest.files {
        let target = staging.join(&file.path);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("cannot stage {}: {e}", file.path))?;
        }
        let local = active_dir
            .as_ref()
            .and_then(|dir| std::fs::read(dir.join(&file.path)).ok())
            .filter(|bytes| sha256_hex(bytes) == file.sha256.to_ascii_lowercase())
            .or_else(|| {
                app.asset_resolver()
                    .get(file.path.clone())
                    .map(|asset| asset.bytes)
                    .filter(|bytes| sha256_hex(bytes) == file.sha256.to_ascii_lowercase())
            });
        let bytes = match local {
            Some(bytes) => {
                reused += 1;
                bytes
            }
            None => {
                let url = format!("{base}/{}", file.path);
                let body = client
                    .get(&url)
                    .send()
                    .await
                    .and_then(reqwest::Response::error_for_status)
                    .map_err(|e| format!("{}: {e}", file.path))?
                    .bytes()
                    .await
                    .map_err(|e| format!("{}: {e}", file.path))?;
                if body.len() as u64 != file.bytes || sha256_hex(&body) != file.sha256.to_ascii_lowercase() {
                    return Err(format!("{}: the download did not match the manifest", file.path));
                }
                fetched += 1;
                body.to_vec()
            }
        };
        std::fs::write(&target, bytes).map_err(|e| format!("cannot write {}: {e}", file.path))?;
    }
    let json = serde_json::to_vec_pretty(manifest).map_err(|e| e.to_string())?;
    std::fs::write(staging.join(MANIFEST_FILE), json).map_err(|e| format!("cannot write the manifest: {e}"))?;
    bundle_manifest(&staging).ok_or("the staged bundle is incomplete")?;

    let target = root.join(&manifest.build);
    let _ = std::fs::remove_dir_all(&target);
    std::fs::rename(&staging, &target).map_err(|e| format!("cannot place the bundle: {e}"))?;
    cleanup.disarm();
    let _ = (fetched, reused);
    Ok(())
}

/// Removes a staging directory on every exit that is not the final rename.
#[cfg(not(target_os = "ios"))]
struct StagingGuard<'a> {
    dir: &'a Path,
    armed: std::cell::Cell<bool>,
}

#[cfg(not(target_os = "ios"))]
fn scopeguard(dir: &Path) -> StagingGuard<'_> {
    StagingGuard { dir, armed: std::cell::Cell::new(true) }
}

#[cfg(not(target_os = "ios"))]
impl StagingGuard<'_> {
    fn disarm(&self) {
        self.armed.set(false);
    }
}

#[cfg(not(target_os = "ios"))]
impl Drop for StagingGuard<'_> {
    fn drop(&mut self) {
        if self.armed.get() {
            let _ = std::fs::remove_dir_all(self.dir);
        }
    }
}

#[cfg(not(target_os = "ios"))]
fn prune(root: &Path, keep: &[&str]) {
    let Ok(entries) = std::fs::read_dir(root) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let stale_build = build_number(&name).is_some() && !keep.contains(&name.as_str());
        if stale_build || name.starts_with(".staging-") {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApkProgress {
    received: u64,
    total: u64,
}

/// Download the published APK into the cache directory the FileProvider
/// exposes, verified, and answer with its path for `GlyphHost.installApk`.
///
/// Rust does the download rather than the page because the page cannot: a
/// `fetch` from the app's origin to attack.fm needs CORS headers Caddy's file
/// server does not send, and 43 MB through IPC as base64 would be absurd
/// anyway. Progress arrives as `ota://apk-progress`.
#[tauri::command]
pub async fn ota_fetch_apk<R: Runtime>(app: AppHandle<R>, state: State<'_, OtaState>) -> Result<String, String> {
    #[cfg(target_os = "ios")]
    {
        let _ = (app, state);
        Err("There is no APK on iOS.".to_string())
    }
    #[cfg(not(target_os = "ios"))]
    {
        use std::io::Write;
        use tauri::Emitter;

        let _one_install = state.installing.lock().await;
        let client = client()?;
        let root = root(&app)?;
        let mut failures = Vec::new();
        let mut found = None;
        for source in effective_sources(&read_known(&root)) {
            match fetch_signed::<ApkInfo>(&client, &format!("{source}/apk.json"), CONTEXT_APK).await {
                Ok(info) => {
                    found = Some((source, info));
                    break;
                }
                Err(error) => failures.push(error),
            }
        }
        let (base, info) = found.ok_or_else(|| failures.join("; "))?;
        // A relative name is served beside apk.json; an absolute https URL (a
        // release asset on another host) is allowed too. Either way the signed
        // SHA-256 decides, and Android refuses an APK signed by another key.
        let download = if valid_url(&info.url) {
            info.url.clone()
        } else {
            let file = safe_relative(&info.url).filter(|f| !f.contains('/')).ok_or("bad APK name")?;
            format!("{base}/{file}")
        };
        let dir = app
            .path()
            .app_cache_dir()
            .map_err(|e| format!("no cache directory: {e}"))?
            .join("updates");
        std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
        let target = dir.join(format!("glyph-{}.apk", info.version_code));

        if std::fs::read(&target).map(|b| sha256_hex(&b) == info.sha256.to_ascii_lowercase()).unwrap_or(false) {
            // Already here from an earlier tap (the one that stopped for the
            // install permission, usually). Say so, or the page sits on "0 of 44 MB".
            let _ = app.emit("ota://apk-progress", ApkProgress { received: info.bytes, total: info.bytes });
            return Ok(target.to_string_lossy().into_owned());
        }
        // Old downloads are 40 MB each; only the one being fetched stays.
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let _ = std::fs::remove_file(entry.path());
            }
        }

        let mut response = client
            .get(&download)
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map_err(|e| format!("APK download: {e}"))?;
        let part = dir.join("download.part");
        let mut out = std::fs::File::create(&part).map_err(|e| format!("cannot write the APK: {e}"))?;
        let mut hasher = <sha2::Sha256 as sha2::Digest>::new();
        let mut received = 0u64;
        let mut next_report = 0u64;
        while let Some(chunk) = response.chunk().await.map_err(|e| format!("APK download: {e}"))? {
            received += chunk.len() as u64;
            if received > info.bytes {
                let _ = std::fs::remove_file(&part);
                return Err("the server sent more than the published APK size".to_string());
            }
            sha2::Digest::update(&mut hasher, &chunk);
            out.write_all(&chunk).map_err(|e| format!("cannot write the APK: {e}"))?;
            if received >= next_report {
                let _ = app.emit("ota://apk-progress", ApkProgress { received, total: info.bytes });
                next_report = received + 512 * 1024;
            }
        }
        drop(out);
        let digest: String = sha2::Digest::finalize(hasher).iter().map(|b| format!("{b:02x}")).collect();
        if received != info.bytes || digest != info.sha256.to_ascii_lowercase() {
            let _ = std::fs::remove_file(&part);
            return Err("the APK did not match its published checksum".to_string());
        }
        std::fs::rename(&part, &target).map_err(|e| format!("cannot place the APK: {e}"))?;
        let _ = app.emit("ota://apk-progress", ApkProgress { received, total: info.bytes });
        Ok(target.to_string_lossy().into_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A tree whose page needs more than its own binary provides would publish
    /// bundles that no install of that binary could ever run. Checked at compile
    /// time: the constants are constants, so the build itself fails.
    #[test]
    fn the_page_never_needs_more_than_this_binary_provides() {
        const { assert!(BUNDLE_REQUIRES <= NATIVE_GENERATION) };
    }

    /// A vector signed by Node's crypto with a throwaway key, exactly as
    /// scripts/ota-sign.mjs signs: the two halves must agree on every byte.
    #[test]
    fn signatures_from_the_deploy_script_verify_and_nothing_else_does() {
        let key = "EnYQkB2cQwgpjgjkuGdCa0yccOhrQMURHVwZUI2t1yU=";
        let body = br#"{"schema":1}"#;
        let sig = "0X3peDVYhcHRgB0Pzj4tWKv8ZjaZrAFNLQC2VdcO9qHz0xVbfNZEJ1vom+dUzSFdatqpsR3sHnNBSb7Ewt03Aw==";
        assert!(verify_with([key], CONTEXT_MANIFEST, body, sig));
        assert!(!verify_with([key], CONTEXT_APK, body, sig), "a manifest signature must not pass as an APK one");
        assert!(!verify_with([key], CONTEXT_MANIFEST, br#"{"schema":2}"#, sig), "tampered bytes");
        assert!(!verify_with(["+lGP9TU8jcvUCrDjPwD5W33HsJn/Bhxm3gH4TK5CvkM="], CONTEXT_MANIFEST, body, sig), "another key");
        assert!(!verify_with([key], CONTEXT_MANIFEST, body, "not base64!"));
    }

    #[test]
    fn the_app_trusts_at_least_one_key_and_one_source() {
        assert!(list(TRUSTED_KEYS).count() >= 1);
        assert!(list(COMPILED_SOURCES).all(valid_url));
        assert!(list(COMPILED_SOURCES).count() >= 1);
    }

    #[test]
    fn a_manifest_can_only_point_at_https() {
        if TEST_SOURCE.is_some() {
            return;
        }
        assert!(valid_url("https://attack.fm/glyph"));
        assert!(!valid_url("http://attack.fm/glyph"));
        assert!(!valid_url("https://attack.fm/glyph/"));
        assert!(!valid_url("https://"));
        assert!(!valid_url("file:///etc"));
        assert!(!valid_url("https://a.b/c d"));
    }

    #[test]
    fn remembered_sources_come_first_and_the_compiled_ones_stay() {
        let known = Known { sources: vec!["https://new.example/glyph".into()], ..Known::default() };
        let all = effective_sources(&known);
        assert_eq!(all.first().map(String::as_str), Some("https://new.example/glyph"));
        assert!(all.iter().any(|s| compiled_sources().contains(s)));
    }

    #[test]
    fn an_older_manifest_cannot_roll_the_sources_back() {
        let dir = std::env::temp_dir().join(format!("glyph-ota-sources-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let mut newer = manifest("20260920000000");
        newer.sources = vec!["https://new.example/glyph".into()];
        remember(&dir, &newer);
        let mut older = manifest("20260912000000");
        older.sources = vec!["https://old.example/glyph".into()];
        remember(&dir, &older);
        assert_eq!(read_known(&dir).sources, vec!["https://new.example/glyph".to_string()]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_installed_record_only_moves_forward() {
        let dir = std::env::temp_dir().join(format!("glyph-ota-installed-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        record_installed(&dir, "20260912230000");
        record_installed(&dir, "20260901000000");
        assert_eq!(read_installed(&dir).as_deref(), Some("20260912230000"));
        record_installed(&dir, "20260913000000");
        assert_eq!(read_installed(&dir).as_deref(), Some("20260913000000"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn build_ids_are_fourteen_digits() {
        assert_eq!(build_number("20260912221530"), Some(20_260_912_221_530));
        assert_eq!(build_number("2026091222153"), None);
        assert_eq!(build_number("20260912../530"), None);
    }

    #[test]
    fn bundle_paths_cannot_escape() {
        assert!(safe_relative("assets/index-abc.js").is_some());
        assert!(safe_relative("../state.json").is_none());
        assert!(safe_relative("assets/../../x").is_none());
        assert!(safe_relative("/etc/passwd").is_none());
        assert!(safe_relative("assets//x.js").is_none());
        assert!(safe_relative("assets/x%2e.js").is_none());
    }

    fn manifest(build: &str) -> Manifest {
        Manifest {
            schema: 1,
            build: build.into(),
            version: "0.2.0".into(),
            native: 1,
            entry: "assets/index.js".into(),
            styles: vec!["assets/index.css".into()],
            files: vec![
                ManifestFile { path: "assets/index.js".into(), sha256: "a".repeat(64), bytes: 1 },
                ManifestFile { path: "assets/index.css".into(), sha256: "b".repeat(64), bytes: 1 },
            ],
            sources: vec![],
            services: Services::default(),
            notes: None,
        }
    }

    #[test]
    fn a_manifest_must_ship_what_the_loader_asks_for() {
        assert!(validate(&manifest("20260912221530")).is_ok());
        let mut missing = manifest("20260912221530");
        missing.files.pop();
        assert!(validate(&missing).is_err());
        let mut escaping = manifest("20260912221530");
        escaping.files[0].path = "../../evil.js".into();
        assert!(validate(&escaping).is_err());
    }

    #[test]
    fn quarantine_steps_back_to_the_previous_bundle() {
        let dir = std::env::temp_dir().join(format!("glyph-ota-test-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let mut stored = Stored {
            active: Some("20260912221530".into()),
            previous: Some("20260911000000".into()),
            pending: Some("20260912221530".into()),
            strikes: 1,
            quarantined: vec![],
        };
        quarantine(&dir, &mut stored, "20260912221530");
        assert_eq!(stored.active.as_deref(), Some("20260911000000"));
        assert_eq!(stored.previous, None);
        assert_eq!(stored.pending, None);
        assert_eq!(stored.strikes, 0);
        assert_eq!(stored.quarantined, vec!["20260912221530".to_string()]);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
