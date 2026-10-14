//! The model files: which ones exist, what their bytes must hash to, where they
//! come from, and whether one is on this device.
//!
//! A model is a file in a directory the CALLER names, for the same reason
//! `store::open` takes a path: the app resolves `<app_data_dir>/models`, a JNI
//! caller will resolve its own from `filesDir`, and nothing in here can tell
//! which of them asked.
//!
//! THE ONE PROMISE: a file at a model's real name has been verified. The
//! download writes to `<name>.part`, hashes every byte as it arrives, and
//! renames only on a match; nothing else in the crate ever writes there. That
//! is what lets `status` answer "present" from a size check instead of hashing
//! 60 MB (or 190) every time the Record screen asks - and why a file whose size
//! is right but whose name was put there by hand is the one case this module
//! trusts wrongly.
//!
//! The hashes are Hugging Face's. Every file in ggerganov/whisper.cpp is a Git
//! LFS object, an LFS object id is the SHA-256 of the content, and these were
//! read from the repository's tree API on 2026-09-12 and confirmed against full
//! downloads the same day. `scripts/fetch-model.mjs` pins the same table; the
//! two must change together.

use std::path::{Path, PathBuf};

use serde::Serialize;

/// One model file and what it must be.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ModelSpec {
    pub file: &'static str,
    pub bytes: u64,
    pub sha256: &'static str,
}

/// base.en, 5-bit quantised: 59.7 MB, and the default (DESIGN section 6.2).
///
/// English-only because OpenAI's model card says the `.en` models do better on
/// English, "especially for the tiny.en and base.en models", and a dictation
/// language setting is a later problem. q5_1 because it is 40% of the F16
/// file's 148 MB - a download a person will wait for on a phone - with the
/// accuracy measured in `whisper/tests.rs` rather than assumed.
pub const BASE_EN_Q5_1: ModelSpec = ModelSpec {
    file: "ggml-base.en-q5_1.bin",
    bytes: 59_721_011,
    sha256: "4baf70dd0d7c4247ba2b81fafd9c01005ac77c2f9ef064e00dcf195d0e2fdd2f",
};

/// small.en, 5-bit quantised: 190 MB. The candidate to switch to once the
/// phone has been measured - see the benchmark in `whisper/tests.rs` for what
/// it costs on the desktop.
pub const SMALL_EN_Q5_1: ModelSpec = ModelSpec {
    file: "ggml-small.en-q5_1.bin",
    bytes: 190_098_681,
    sha256: "bfdff4894dcb76bbf647d56263ea2a96645423f1669176f4844a1bf8e478ad30",
};

/// THE model the app captures with. Switching is this one line: the download,
/// the status, the load and the page all follow it.
pub const ACTIVE: ModelSpec = BASE_EN_Q5_1;

/// The model that improves a saved recording after Done (0.6.0), in the
/// background, where it does not have to keep up with speech.
///
/// Measured 2026-09-13 on 73 LibriSpeech dev-clean clips, clean and with pink
/// noise (`tests::accuracy`): small.en makes 6.1% / 7.0% word errors against
/// base.en's 10.0% / 11.0%. It cannot run live - on the arm64 emulator it
/// streams at 0.21x real time - but a 59 s recording takes it 11.9 s there.
/// large-v3-turbo scored 3.6% and took 54 s for the same minute; medium.en
/// was no better than small at three times the cost.
pub const REFINE: ModelSpec = SMALL_EN_Q5_1;

/// Where models are fetched from, in order.
///
/// attack.fm first because it is ours: it cannot rename a file, rate-limit a
/// phone, or go down with somebody else's outage, and it is what the upload
/// from `models/` populates. Hugging Face second, because until that upload
/// has happened (and whenever attack.fm is unreachable) a first launch should
/// still be able to dictate. The hash is checked either way, so the order is
/// about reliability, never about trust.
pub const MIRRORS: [&str; 2] = [
    "https://attack.fm/glyph/models",
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main",
];

/// The mirrors to try, most preferred first: any that a signed update manifest
/// has moved the app to, then the compiled-in [`MIRRORS`], without repeats.
///
/// Passed INTO [`fetch`] rather than read from inside it, because this module
/// takes no Tauri types (the capture service may drive it with no Tauri
/// runtime) and the moved mirrors live in the OTA layer's state. The compiled
/// list is always appended, never replaced: if the domain Glyph moved to dies
/// too, the one the APK shipped with is still tried, and Hugging Face after it.
/// Moving a mirror cannot weaken anything - the SHA-256 stays pinned in this
/// binary, so a mirror only ever decides where bytes come from, never which
/// bytes are accepted.
pub fn mirrors_with(preferred: &[String]) -> Vec<String> {
    let mut all: Vec<String> = Vec::new();
    for mirror in preferred.iter().map(String::as_str).chain(MIRRORS) {
        let mirror = mirror.trim_end_matches('/');
        if !mirror.is_empty() && !all.iter().any(|seen| seen == mirror) {
            all.push(mirror.to_string());
        }
    }
    all
}

/// What the Record screen needs to know before it offers to record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    pub present: bool,
    /// The file name, e.g. `ggml-base.en-q5_1.bin`.
    pub name: String,
    /// Where the file is, or will be once fetched.
    pub path: String,
    /// The model's full size - the download the page is asking a person to
    /// agree to, whether or not it has happened yet.
    pub bytes: u64,
}

/// Where `spec` lives (or will live) in `dir`.
pub fn path_in(dir: &Path, spec: &ModelSpec) -> PathBuf {
    dir.join(spec.file)
}

/// Whether `spec` is present in `dir`, by name and size. See the module header
/// for why the size is enough.
pub fn status(dir: &Path, spec: &ModelSpec) -> ModelStatus {
    let path = path_in(dir, spec);
    let present = std::fs::metadata(&path)
        .map(|meta| meta.is_file() && meta.len() == spec.bytes)
        .unwrap_or(false);
    ModelStatus {
        present,
        name: spec.file.to_string(),
        path: path.to_string_lossy().into_owned(),
        bytes: spec.bytes,
    }
}

/// Downloads `spec` into `dir` unless it is already there, verifying SHA-256,
/// and reports progress as `(received, total)` bytes.
///
/// Each mirror is tried in turn, and a mirror that answers with the wrong
/// bytes is treated exactly like one that does not answer: the `.part` is
/// deleted and the next is tried. The error, when every mirror fails, names
/// each one and what it did, because "download failed" on a phone with one
/// bar of signal and on a phone whose mirror is serving an HTML error page are
/// different problems for whoever reads it.
///
/// Progress is reported at most once per 1% of the file, and always at the
/// end, rather than per chunk: a 60 MB body arrives in thousands of chunks, and
/// each report becomes an IPC event and a React render on the far side. At
/// MOST, because a chunk can be bigger than 1% - measured against Hugging Face,
/// 75 reports for base.en, not 100 - so the page must draw a fraction, not
/// count ticks. A mirror that fails partway starts the count again from zero
/// for the next one.
///
/// Writes happen with `std::fs` on the async task, which is a deliberate
/// small sin: a chunk is at most several hundred kilobytes to local flash, a
/// millisecond or two, and the alternative is taking on tokio's `fs` feature to
/// move that millisecond to another thread.
#[cfg(not(target_os = "ios"))]
pub async fn fetch(
    dir: &Path,
    spec: &ModelSpec,
    mirrors: &[String],
    mut progress: impl FnMut(u64, u64),
) -> Result<ModelStatus, String> {
    let current = status(dir, spec);
    if current.present {
        return Ok(current);
    }
    std::fs::create_dir_all(dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;

    // A connect timeout and a READ timeout, never a total one: 190 MB over a
    // slow connection is legitimately minutes, but thirty seconds with no byte
    // arriving is a connection that has died without saying so.
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .read_timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("cannot start an HTTP client: {e}"))?;

    let mut failures = Vec::new();
    for mirror in mirrors {
        let url = format!("{mirror}/{}", spec.file);
        match download(&client, &url, dir, spec, &mut progress).await {
            Ok(()) => return Ok(status(dir, spec)),
            Err(e) => failures.push(format!("{url}: {e}")),
        }
    }
    Err(format!(
        "could not download {}. {}",
        spec.file,
        failures.join("; ")
    ))
}

/// An error and everything underneath it, joined with ": ".
///
/// `reqwest::Error`'s own message stops at the outermost layer, and on the Fold
/// that outermost layer was the whole diagnosis available: "error sending
/// request for url (...)" for two unrelated hosts, which says a request failed
/// and nothing about whether DNS, the TCP connection, or the TLS handshake is
/// what refused it. The cause lives in `source()`, and a download failure that
/// a person reads on a phone has to carry it or it cannot be acted on.
#[cfg(not(target_os = "ios"))]
fn with_causes(error: &(dyn std::error::Error + 'static)) -> String {
    let mut message = error.to_string();
    let mut next = error.source();
    while let Some(cause) = next {
        let text = cause.to_string();
        // hyper and reqwest often repeat the inner message in the outer one.
        if !message.contains(&text) {
            message.push_str(": ");
            message.push_str(&text);
        }
        next = cause.source();
    }
    message
}

/// How many times a download that keeps being cut is picked up again before the mirror is given up on. Counted
/// from the last time bytes arrived, so a 5.7 GB model over a connection that drops every few minutes still
/// finishes, and one that has stopped sending altogether does not retry forever.
#[cfg(not(target_os = "ios"))]
const RESUMES: u32 = 8;

/// A mirror that does not answer at all is tried this many times before the next one.
#[cfg(not(target_os = "ios"))]
const FIRST_TRIES: u32 = 2;

/// A little longer between each try, up to ten seconds.
#[cfg(not(target_os = "ios"))]
async fn pause(tries: u32) {
    let wait = std::time::Duration::from_secs(u64::from(tries.min(5)) * 2);
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(wait)).await;
}

/// Whether `response` carries the file from byte `from`: a 206 whose range starts there.
#[cfg(not(target_os = "ios"))]
fn resumes_at(response: &reqwest::Response, from: u64) -> bool {
    response.status() == reqwest::StatusCode::PARTIAL_CONTENT
        && response
            .headers()
            .get(reqwest::header::CONTENT_RANGE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|range| range.trim().starts_with(&format!("bytes {from}-")))
}

/// One mirror's download of `spec` into `<dir>/<file>.part`, renamed into place once every byte hashes right.
///
/// A connection cut partway is picked up where it stopped: the next request asks for the rest with a `Range`, the
/// bytes already written and hashed stay, and the hash carries on over the rest. Matt's Fold could not get Qwen3.5
/// 4B: Hugging Face closed the connection somewhere in its 2.7 GB ("peer closed connection without sending TLS
/// close_notify"), and every try started again from nothing, so a model that size had to arrive in one unbroken
/// connection or not at all. A server that answers a `Range` with the whole file again (a 200) is started over from
/// the first byte, so the hash is always over the file in order. An HTTP error (a 404 from a mirror without the
/// file) is never retried: it will say the same thing again.
#[cfg(not(target_os = "ios"))]
async fn download(
    client: &reqwest::Client,
    url: &str,
    dir: &Path,
    spec: &ModelSpec,
    progress: &mut impl FnMut(u64, u64),
) -> Result<(), String> {
    use sha2::{Digest, Sha256};
    use std::io::{Seek, SeekFrom, Write};

    let part = dir.join(format!("{}.part", spec.file));
    // Removes the partial file on every exit that is not the rename. A `.part`
    // left behind is harmless to `status` (wrong name), but it is 60 MB of a
    // phone's storage that nothing will ever read.
    struct Discard<'a>(&'a Path, bool);
    impl Drop for Discard<'_> {
        fn drop(&mut self) {
            if !self.1 {
                // Nothing to remove, or nothing to be done about it.
                let _ = std::fs::remove_file(self.0);
            }
        }
    }
    let mut guard = Discard(&part, false);

    let mut file: Option<std::fs::File> = None;
    let mut hash = Sha256::new();
    let mut received: u64 = 0;
    let step = (spec.bytes / 100).max(1);
    let mut next_report = 0;
    // Tries since bytes last arrived, and whether any ever have.
    let mut tries: u32 = 0;
    let mut started = false;

    'connection: loop {
        let mut request = client.get(url);
        if received > 0 {
            request = request.header(reqwest::header::RANGE, format!("bytes={received}-"));
        }
        let mut response = match request.send().await {
            Ok(response) => match response.error_for_status() {
                Ok(response) => response,
                Err(e) => return Err(with_causes(&e)),
            },
            Err(e) => {
                tries += 1;
                if tries >= if started { RESUMES } else { FIRST_TRIES } {
                    return Err(format!("{} (tried {tries} times)", with_causes(&e)));
                }
                pause(tries).await;
                continue 'connection;
            }
        };

        if received > 0 && !resumes_at(&response, received) {
            // The whole file again, not the rest of it: start over, so the hash is over the bytes in order.
            received = 0;
            hash = Sha256::new();
            next_report = 0;
            if let Some(open) = file.as_mut() {
                open.set_len(0).and_then(|()| open.seek(SeekFrom::Start(0)).map(|_| ())).map_err(|e| format!("cannot write {}: {e}", part.display()))?;
            }
        }
        if file.is_none() {
            file = Some(std::fs::File::create(&part).map_err(|e| format!("cannot write {}: {e}", part.display()))?);
        }
        let open = file.as_mut().expect("opened above");

        loop {
            match response.chunk().await {
                Ok(Some(chunk)) => {
                    started = true;
                    tries = 0;
                    received += chunk.len() as u64;
                    if received > spec.bytes {
                        return Err(format!("sent more than the expected {} bytes", spec.bytes));
                    }
                    hash.update(&chunk);
                    open.write_all(&chunk).map_err(|e| format!("cannot write {}: {e}", part.display()))?;
                    if received >= next_report {
                        progress(received, spec.bytes);
                        next_report = received + step;
                    }
                }
                Ok(None) if received < spec.bytes => {
                    // The body ended early without an error: the rest is asked for like any other cut.
                    tries += 1;
                    if tries >= RESUMES {
                        return Err(format!("ended after {received} of {} bytes (tried {tries} times)", spec.bytes));
                    }
                    pause(tries).await;
                    continue 'connection;
                }
                Ok(None) => break 'connection,
                Err(e) => {
                    tries += 1;
                    if tries >= RESUMES {
                        return Err(format!("{} after {received} of {} bytes (tried {tries} times)", with_causes(&e), spec.bytes));
                    }
                    pause(tries).await;
                    continue 'connection;
                }
            }
        }
    }

    let open = file.take().expect("a body was read");
    open.sync_all().map_err(|e| format!("cannot flush {}: {e}", part.display()))?;
    drop(open);

    if received != spec.bytes {
        return Err(format!("ended after {received} of {} bytes", spec.bytes));
    }
    let actual: String = hash.finalize().iter().map(|b| format!("{b:02x}")).collect();
    if actual != spec.sha256 {
        return Err(format!("SHA-256 {actual} does not match {}", spec.sha256));
    }
    std::fs::rename(&part, path_in(dir, spec))
        .map_err(|e| format!("cannot move {} into place: {e}", part.display()))?;
    guard.1 = true;
    progress(received, spec.bytes);
    Ok(())
}

/// A server that cuts its first answer partway, then serves the rest to a `Range` (or, with `ranges` off, the whole
/// file again): the downloader must still end with every byte, hashed right.
#[cfg(all(test, not(target_os = "ios")))]
mod resume_tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    fn serve(body: Vec<u8>, ranges: bool) -> (String, Arc<AtomicUsize>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/model.bin", listener.local_addr().unwrap());
        let requests = Arc::new(AtomicUsize::new(0));
        let count = Arc::clone(&requests);
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let n = count.fetch_add(1, Ordering::SeqCst);
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut from = 0usize;
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                        break;
                    }
                    if let Some(range) = line.to_ascii_lowercase().strip_prefix("range: bytes=") {
                        from = range.trim().trim_end_matches('-').parse().unwrap_or(0);
                    }
                }
                let resuming = ranges && from > 0;
                let rest = if resuming { &body[from..] } else { &body[..] };
                let head = if resuming {
                    format!("HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nContent-Range: bytes {from}-{}/{}\r\nConnection: close\r\n\r\n", rest.len(), body.len() - 1, body.len())
                } else {
                    format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", rest.len())
                };
                let _ = stream.write_all(head.as_bytes());
                // The first answer is cut a third of the way in.
                let sent = if n == 0 { rest.len() / 3 } else { rest.len() };
                let _ = stream.write_all(&rest[..sent]);
                let _ = stream.flush();
            }
        });
        (url, requests)
    }

    fn fetch_from(ranges: bool) -> (Result<(), String>, Vec<u8>, Vec<u8>, usize) {
        let body: Vec<u8> = (0..300_000u32).map(|i| (i % 251) as u8).collect();
        let sha: String = Sha256::digest(&body).iter().map(|b| format!("{b:02x}")).collect();
        let spec = ModelSpec { file: "model.bin", bytes: body.len() as u64, sha256: Box::leak(sha.into_boxed_str()) };
        let dir = std::env::temp_dir().join(format!("glyph-resume-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let (url, requests) = serve(body.clone(), ranges);
        let client = reqwest::Client::builder().read_timeout(std::time::Duration::from_secs(5)).build().unwrap();
        let result = tauri::async_runtime::block_on(async { download(&client, &url, &dir, &spec, &mut |_, _| {}).await });
        let written = std::fs::read(dir.join("model.bin")).unwrap_or_default();
        let _ = std::fs::remove_dir_all(&dir);
        (result, written, body, requests.load(Ordering::SeqCst))
    }

    #[test]
    fn a_cut_download_carries_on_from_where_it_stopped() {
        let (result, written, body, requests) = fetch_from(true);
        assert_eq!(result, Ok(()));
        assert_eq!(requests, 2, "one cut, one resume");
        assert!(written == body, "every byte, in order");
    }

    #[test]
    fn a_server_that_ignores_the_range_is_started_over_and_still_hashes_right() {
        let (result, written, body, _) = fetch_from(false);
        assert_eq!(result, Ok(()));
        assert!(written == body, "every byte, in order");
    }
}

#[cfg(test)]
mod mirror_tests {
    use super::*;

    #[test]
    fn with_nothing_moved_it_is_the_compiled_list() {
        assert_eq!(mirrors_with(&[]), MIRRORS.map(String::from).to_vec());
    }

    #[test]
    fn moved_mirrors_come_first_and_the_compiled_ones_are_never_dropped() {
        let moved = vec!["https://glyph.example/models/".to_string(), MIRRORS[0].to_string()];
        let all = mirrors_with(&moved);
        assert_eq!(all[0], "https://glyph.example/models", "trailing slash trimmed, moved mirror first");
        assert_eq!(all.len(), 3, "the compiled attack.fm mirror is not repeated: {all:?}");
        assert!(MIRRORS.iter().all(|m| all.iter().any(|a| a == m)), "every compiled mirror stays: {all:?}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_file_of_the_wrong_size_is_not_present() {
        let dir = std::env::temp_dir().join(format!("glyph-model-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(!status(&dir, &ACTIVE).present);
        std::fs::write(path_in(&dir, &ACTIVE), b"not a model").unwrap();
        let answer = status(&dir, &ACTIVE);
        assert!(!answer.present, "a truncated download must not read as a model");
        assert_eq!(answer.name, "ggml-base.en-q5_1.bin");
        assert_eq!(answer.bytes, 59_721_011);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
