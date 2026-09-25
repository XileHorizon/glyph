//! The Tauri seam for live dictation: eight commands, five events, and nothing
//! the engine does not already do.
//!
//! `whisper/` owns transcription and has to stay free of `tauri::` types for
//! the reason `store.rs` does - the Android capture process will drive it with
//! no Tauri running. This module is the adapter the webview reaches it
//! through: it resolves the app's data directory, holds the loaded model and
//! the one capture in progress in managed state, and turns engine events into
//! `app.emit` calls. Every decision about what to transcribe, when, and what
//! counts as silence is on the other side.
//!
//! THE CONTRACT WITH THE PAGE, which the page is written against:
//!
//! - `capture_model_status() -> ModelStatus`
//! - `capture_fetch_model() -> ModelStatus`, emitting `capture://model-progress`
//!   `{ receivedBytes, totalBytes }`
//! - `capture_start()`, then `capture_push(<raw bytes>)` repeatedly, then
//!   `capture_stop({ recordAs?, append? }) -> { transcript, recordedMs }` or
//!   `capture_cancel()`. With `recordAs` (a note id) the audio is kept: it is
//!   written to `<app_data_dir>/recordings/<id>.wav` - added to the end of that
//!   file when `append` is set - and `recordedMs` is the file's whole length.
//!   Decided at stop, not start, because which note a side-key capture belongs
//!   to is only known a moment after it has begun. Without `recordAs` nothing
//!   is kept and `recordedMs` is null.
//! - `http://rec.localhost/<id>.wav` (the `rec` scheme) serves a kept recording
//!   to an `<audio>` element, byte ranges included, so it can seek.
//! - `transcribe_wav(path) -> Transcript`
//! - `capture://partial { text }` REPLACES the partial line; an empty `text`
//!   clears it, and one follows every commit whose audio the partial described.
//! - `capture://segment { text, startMs, endMs }` appends.
//! - `capture_rewind(toMs)` winds the tape back: resolves once
//!   `capture://rewound { toMs, segments }` has been emitted, whose `segments`
//!   is every committed segment that still stands - the page REPLACES its list
//!   with it. Chain it after the pushes like one: it applies to the audio
//!   pushed before it, and what is pushed after it records from `toMs`.
//! - `capture://error { message }` means the capture stopped transcribing;
//!   `capture_stop` will then reject with the same message.
//!
//! Two rules the page has to keep, because nothing on this side can:
//!
//! AWAIT EACH `capture_push` BEFORE SENDING THE NEXT. PCM applied out of order
//! is noise, and invoke order is not execution order: on Android, wry hands
//! every IPC request to Rust from WebViewClient.shouldInterceptRequest, which
//! the platform calls off the UI thread, and two invokes in flight together
//! can run in either order whether the command is sync or async. A promise
//! chain costs one round trip per 250 ms of audio.
//!
//! AWAIT `capture_start` BEFORE THE FIRST PUSH. A push with no capture running
//! is rejected rather than buffered, because a buffer that outlives a capture
//! is how the tail of one dictation ends up at the head of the next.
//!
//! On iOS every command exists with the same signature and rejects (or, for the
//! status, answers "not present"): capture there will be Apple's
//! SpeechTranscriber, and a page written against one surface is a page that
//! does not need a platform switch to load.

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::whisper::model::{self, ModelStatus};

#[cfg(not(target_os = "ios"))]
use std::sync::{atomic::AtomicBool, Arc, Mutex};

#[cfg(not(target_os = "ios"))]
use tauri::Emitter;

#[cfg(not(target_os = "ios"))]
use crate::whisper::{
    engine::{Engine, Session},
    stream::Event,
    worker::Capture,
};

/// The directory under `app_data_dir()` that models are kept in.
const MODELS_DIR: &str = "models";

#[cfg(target_os = "ios")]
const NOT_ON_IOS: &str = "On-device transcription is not supported on iOS yet.";

/// What `transcribe_wav` measured.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Transcript {
    pub text: String,
    /// Length of the audio in the file.
    pub audio_ms: u64,
    /// Inference alone - not the WAV read and not the model load, which is
    /// `ModelStatus`'s business and happens once. The number to divide
    /// `audioMs` by for a real-time factor.
    pub elapsed_ms: u64,
    pub model: String,
}

#[cfg(not(target_os = "ios"))]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelProgress {
    received_bytes: u64,
    total_bytes: u64,
}

/// The loaded model and the capture in progress, for the life of the process.
///
/// The model is cached here rather than loaded per capture because a load is a
/// read of the whole file - 60 MB from flash on the first press after the page
/// cache has let it go - and a press that waits for that every time is a press
/// that loses the first word. See the benchmark in `whisper/tests.rs`. It is never
/// unloaded. That is ~60 MB of weights kept resident in the app process, which
/// on an 11 GB phone is the right trade against a load on every press, and is
/// the first thing to revisit if the OS starts killing the app in the
/// background.
#[derive(Default)]
pub struct CaptureState {
    #[cfg(not(target_os = "ios"))]
    engine: Mutex<Option<Arc<Engine>>>,
    #[cfg(not(target_os = "ios"))]
    capture: Mutex<Option<Capture>>,
    /// Held across a download so that two taps on "download" are one download:
    /// both would otherwise write the same `.part` file at once.
    #[cfg(not(target_os = "ios"))]
    fetching: tauri::async_runtime::Mutex<()>,
    /// The same, for the refine model's download.
    #[cfg(not(target_os = "ios"))]
    fetching_refine: tauri::async_runtime::Mutex<()>,
    /// Set by `capture_start` so a refine pass in progress stops within one
    /// graph computation: a person who has started talking again gets the CPU.
    #[cfg(not(target_os = "ios"))]
    refine_abort: Arc<AtomicBool>,
    /// Whether a refine pass is running; a second is refused, not queued.
    #[cfg(not(target_os = "ios"))]
    refining: AtomicBool,
}

/// Recovers a guard from a lock some earlier command panicked while holding -
/// the same reasoning as `NotesStore::lock`: every value behind these locks is
/// either whole or `None`, and refusing every capture for the rest of the
/// process over one panic is how a bug becomes a brick.
#[cfg(not(target_os = "ios"))]
fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Hands the capture state to Tauri. Called once, from `setup`.
///
/// Opens nothing and touches no file on the way: a first launch with no model
/// must still start, and resolving directories here would make a platform with
/// no data directory fail the whole app over a feature it may never use. The
/// one file job it starts runs afterwards, on its own, and cannot fail setup.
pub fn install(app: &tauri::App) {
    app.manage(CaptureState::default());
}

/// Cancels any capture in progress, waiting for its thread. Called on
/// `RunEvent::Exit`.
///
/// Not tidiness: whisper.cpp is C++ with static state, and a worker thread
/// still inside a decode while `exit()` runs the C++ static destructors is a
/// crash at quit - which on macOS is a crash-report dialog for an app that did
/// nothing wrong. The abort flag ends the decode within one graph computation,
/// so the join is short.
pub fn shutdown(app: &AppHandle) {
    #[cfg(not(target_os = "ios"))]
    if let Some(state) = app.try_state::<CaptureState>() {
        if let Some(capture) = lock(&state.capture).take() {
            capture.cancel();
        }
    }
    #[cfg(target_os = "ios")]
    let _ = app;
}

/// `<app_data_dir>/models`, where whisper's and the formatting models live.
pub(crate) fn models_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(MODELS_DIR))
        .map_err(|e| format!("no app data directory to keep models in: {e}"))
}

/// The cached engine, loading it on first use.
///
/// The load runs on the blocking pool: it is a 60 MB file read and tensor
/// setup (31 ms warm on an M5, unmeasured cold on the phone), and on the async
/// runtime it would stall every command queued behind it for that long. Two callers racing here can both load; the second
/// to finish wins the cache and the first's copy is dropped when its capture
/// ends, which is a wasted load in a case that takes two presses inside one
/// load time, and not worth a lock held across an await.
#[cfg(not(target_os = "ios"))]
async fn engine(app: &AppHandle, state: &CaptureState) -> Result<Arc<Engine>, String> {
    if let Some(engine) = lock(&state.engine).clone() {
        return Ok(engine);
    }
    let status = model::status(&models_dir(app)?, &model::ACTIVE);
    if !status.present {
        return Err(format!(
            "The transcription model ({}) has not been downloaded yet - call capture_fetch_model first.",
            status.name
        ));
    }
    let path = std::path::PathBuf::from(status.path);
    let engine = tauri::async_runtime::spawn_blocking(move || Engine::load(&path))
        .await
        .map_err(|e| format!("the model load did not finish: {e}"))??;
    let engine = Arc::new(engine);
    *lock(&state.engine) = Some(Arc::clone(&engine));
    Ok(engine)
}

#[cfg(not(target_os = "ios"))]
fn emit(app: &AppHandle, event: Event) {
    // An event the webview is not there to hear (reloading, or closed) is not
    // a failure of the capture.
    let _ = match event {
        Event::Partial(partial) => app.emit("capture://partial", partial),
        Event::Segment(segment) => app.emit("capture://segment", segment),
        Event::Rewound(rewound) => app.emit("capture://rewound", rewound),
        Event::Error(failure) => app.emit("capture://error", failure),
    };
}

/// Whether the refine model (`model::REFINE`) is on this device.
#[tauri::command]
pub fn capture_refine_model_status(app: AppHandle) -> ModelStatus {
    let absent = ModelStatus {
        present: false,
        name: model::REFINE.file.to_string(),
        path: String::new(),
        bytes: model::REFINE.bytes,
    };
    if cfg!(target_os = "ios") {
        return absent;
    }
    match models_dir(&app) {
        Ok(dir) => model::status(&dir, &model::REFINE),
        Err(_) => absent,
    }
}

/// Downloads the refine model, from the same mirrors as the live one, and
/// answers with its status. Progress arrives as
/// `capture://refine-model-progress { receivedBytes, totalBytes }`.
#[tauri::command]
pub async fn capture_fetch_refine_model(
    app: AppHandle,
    state: State<'_, CaptureState>,
) -> Result<ModelStatus, String> {
    #[cfg(target_os = "ios")]
    {
        let _ = (app, state);
        Err(NOT_ON_IOS.to_string())
    }
    #[cfg(not(target_os = "ios"))]
    {
        let dir = models_dir(&app)?;
        let _one_download = state.fetching_refine.lock().await;
        let emitter = app.clone();
        let mirrors = model::mirrors_with(&crate::ota::services(&app).model_mirrors);
        model::fetch(&dir, &model::REFINE, &mirrors, move |received, total| {
            let _ = emitter.emit(
                "capture://refine-model-progress",
                ModelProgress {
                    received_bytes: received,
                    total_bytes: total,
                },
            );
        })
        .await
    }
}

#[cfg(not(target_os = "ios"))]
#[derive(Debug, Clone, Serialize)]
struct RefineProgress {
    id: String,
    percent: i32,
}

/// Transcribes a saved recording again with the refine model, from `fromMs` to
/// its end, and answers with its phrases: `[{ text, startMs, endMs }]`, times on
/// the recording's own timeline. The page decides what to do with them.
///
/// `promptTail` is the note's committed text before this take (empty for a
/// first take); it rides after the cue vocabulary so a take that continues a
/// sentence continues its casing. Progress arrives as
/// `capture://refine-progress { id, percent }`.
///
/// Refused with "busy" while a capture runs or another refine does, with "model
/// missing" before the refine model is downloaded, and ends with "cancelled"
/// when `capture_start` runs mid-pass. The refine engine is loaded for the pass
/// and dropped after it: 190 MB is not kept resident for something that runs
/// once a recording.
#[tauri::command]
pub async fn capture_refine(
    app: AppHandle,
    state: State<'_, CaptureState>,
    id: String,
    from_ms: u64,
    prompt_tail: String,
) -> Result<Vec<crate::store::RecordedSegment>, String> {
    #[cfg(target_os = "ios")]
    {
        let _ = (app, state, id, from_ms, prompt_tail);
        Err(NOT_ON_IOS.to_string())
    }
    #[cfg(not(target_os = "ios"))]
    {
        use std::sync::atomic::{AtomicI32, Ordering};

        if lock(&state.capture).is_some() {
            return Err("busy".into());
        }
        let dir = models_dir(&app)?;
        let status = model::status(&dir, &model::REFINE);
        if !status.present {
            return Err("model missing".into());
        }
        let recording = crate::commands::recordings_dir(&app)
            .and_then(|recordings| crate::store::recording_file(&recordings, &id))
            .ok_or_else(|| "no such recording".to_string())?;
        if state.refining.swap(true, Ordering::SeqCst) {
            return Err("busy".into());
        }
        struct Done<'a>(&'a AtomicBool);
        impl Drop for Done<'_> {
            fn drop(&mut self) {
                self.0.store(false, Ordering::SeqCst);
            }
        }
        let _done = Done(&state.refining);

        let abort = Arc::clone(&state.refine_abort);
        abort.store(false, Ordering::Relaxed);
        let worker_abort = Arc::clone(&abort);
        let model_path = std::path::PathBuf::from(&status.path);
        let prompt = crate::whisper::text::prompt(&prompt_tail, 200);
        let emitter = app.clone();
        let job = id.clone();
        let result = tauri::async_runtime::spawn_blocking(
            move || -> Result<Vec<crate::store::RecordedSegment>, String> {
                let audio = crate::whisper::wav::read(&recording)?;
                let from = crate::whisper::ms_to_samples(from_ms).min(audio.len());
                if audio.len() - from < crate::whisper::ms_to_samples(100) {
                    return Ok(Vec::new());
                }
                let engine = Arc::new(Engine::load(&model_path)?);
                let mut session = Session::new(engine, worker_abort)?;
                let progress = AtomicI32::new(0);
                let finished = AtomicBool::new(false);
                // A watcher beside the pass turns whisper.cpp's percentage into
                // events a few times a second; the pass itself never waits on IPC.
                std::thread::scope(|scope| {
                    scope.spawn(|| {
                        let mut last = -1;
                        while !finished.load(Ordering::Relaxed) {
                            let percent = progress.load(Ordering::Relaxed);
                            if percent != last {
                                last = percent;
                                let _ = emitter.emit(
                                    "capture://refine-progress",
                                    RefineProgress {
                                        id: job.clone(),
                                        percent,
                                    },
                                );
                            }
                            std::thread::sleep(std::time::Duration::from_millis(250));
                        }
                    });
                    let timed = session.transcribe_timed(&audio[from..], &prompt, &progress);
                    finished.store(true, Ordering::Relaxed);
                    timed
                })
                .map(|timed| offset_segments(timed, from_ms))
            },
        )
        .await
        .map_err(|e| format!("the refine pass stopped: {e}"))?;

        match result {
            Err(_) if abort.load(Ordering::Relaxed) => Err("cancelled".into()),
            Ok(segments) => {
                let _ = app.emit(
                    "capture://refine-progress",
                    RefineProgress { id, percent: 100 },
                );
                Ok(segments)
            }
            Err(e) => Err(e),
        }
    }
}

/// Timed phrases from a pass over `[from_ms, end)`, moved onto the whole
/// recording's timeline.
#[cfg(not(target_os = "ios"))]
fn offset_segments(
    timed: Vec<crate::whisper::engine::TimedText>,
    from_ms: u64,
) -> Vec<crate::store::RecordedSegment> {
    timed
        .into_iter()
        .map(|t| crate::store::RecordedSegment {
            text: t.text,
            start_ms: t.start_ms + from_ms,
            end_ms: t.end_ms + from_ms,
        })
        .collect()
}

/// Whether the active model is on this device, where, and how big it is.
#[tauri::command]
pub fn capture_model_status(app: AppHandle) -> ModelStatus {
    let absent = ModelStatus {
        present: false,
        name: model::ACTIVE.file.to_string(),
        path: String::new(),
        bytes: model::ACTIVE.bytes,
    };
    if cfg!(target_os = "ios") {
        return absent;
    }
    // No data directory is a model that cannot be present - and NOT a
    // relative path, which would answer for whatever file happens to sit in
    // the process's working directory.
    match models_dir(&app) {
        Ok(dir) => model::status(&dir, &model::ACTIVE),
        Err(_) => absent,
    }
}

/// Downloads the active model into `<app_data_dir>/models/` if it is not there,
/// verifying its SHA-256, and answers with its status. Progress arrives as
/// `capture://model-progress`.
#[tauri::command]
pub async fn capture_fetch_model(
    app: AppHandle,
    state: State<'_, CaptureState>,
) -> Result<ModelStatus, String> {
    #[cfg(target_os = "ios")]
    {
        let _ = (app, state);
        Err(NOT_ON_IOS.to_string())
    }
    #[cfg(not(target_os = "ios"))]
    {
        let dir = models_dir(&app)?;
        let _one_download = state.fetching.lock().await;
        let emitter = app.clone();
        // Mirrors a signed update manifest has moved come first; the compiled
        // ones follow. See model::mirrors_with.
        let mirrors = model::mirrors_with(&crate::ota::services(&app).model_mirrors);
        model::fetch(&dir, &model::ACTIVE, &mirrors, move |received, total| {
            let _ = emitter.emit(
                "capture://model-progress",
                ModelProgress {
                    received_bytes: received,
                    total_bytes: total,
                },
            );
        })
        .await
    }
}

/// What `capture_stop` answers with.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Finished {
    pub transcript: String,
    /// The kept recording's whole length, or null when nothing was kept.
    pub recorded_ms: Option<u64>,
}

/// The scheme a kept recording is played through: `http://rec.localhost/<id>.wav`
/// on Android, `rec://localhost/<id>.wav` elsewhere - the same shape as `ota`.
pub const RECORDINGS_SCHEME: &str = "rec";

/// Serves `<app_data_dir>/recordings/<id>.wav` to the page's `<audio>`, with
/// byte ranges, because a WebView's media element seeks by asking for them and
/// treats a server without `Accept-Ranges` as unseekable. The id is confined
/// the same way the store confines it (`store::recording_file`).
pub fn serve_recording<R: tauri::Runtime>(
    app: &AppHandle<R>,
    request: &tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    use tauri::http::{header, Response, StatusCode};
    let respond = |status: StatusCode, body: Vec<u8>, extra: Vec<(header::HeaderName, String)>| {
        let mut builder = Response::builder()
            .status(status)
            .header(header::CONTENT_TYPE, "audio/wav")
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .header(header::ACCEPT_RANGES, "bytes")
            .header(header::CACHE_CONTROL, "no-store");
        for (name, value) in extra {
            builder = builder.header(name, value);
        }
        builder
            .body(body)
            .unwrap_or_else(|_| Response::new(Vec::new()))
    };
    let path = request.uri().path().trim_start_matches('/');
    let Some(id) = path.strip_suffix(".wav") else {
        return respond(StatusCode::NOT_FOUND, Vec::new(), Vec::new());
    };
    let file = app
        .path()
        .app_data_dir()
        .ok()
        .and_then(|dir| crate::store::recording_file(&dir.join("recordings"), id));
    let Some(bytes) = file.and_then(|f| std::fs::read(f).ok()) else {
        return respond(StatusCode::NOT_FOUND, Vec::new(), Vec::new());
    };
    let total = bytes.len();
    let range = request
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("bytes="))
        .and_then(|v| {
            let (a, b) = v.split_once('-')?;
            let start: usize = a.parse().ok()?;
            let end: usize = if b.is_empty() {
                total.saturating_sub(1)
            } else {
                b.parse().ok()?
            };
            (start <= end && end < total).then_some((start, end))
        });
    match range {
        Some((start, end)) => respond(
            StatusCode::PARTIAL_CONTENT,
            bytes[start..=end].to_vec(),
            vec![
                (
                    header::CONTENT_RANGE,
                    format!("bytes {start}-{end}/{total}"),
                ),
                (header::CONTENT_LENGTH, (end - start + 1).to_string()),
            ],
        ),
        None => respond(
            StatusCode::OK,
            bytes,
            vec![(header::CONTENT_LENGTH, total.to_string())],
        ),
    }
}

/// Loads the model if it is not already loaded and starts a capture.
///
/// A capture already running is cancelled, not refused. The case that
/// produces one is a webview that reloaded mid-dictation (a dev reload, or the
/// OS recreating the activity) and so never called stop, and refusing would
/// leave the Record screen unable to record until the app is killed.
#[tauri::command]
pub async fn capture_start(app: AppHandle, state: State<'_, CaptureState>) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        let _ = (app, state);
        Err(NOT_ON_IOS.to_string())
    }
    #[cfg(not(target_os = "ios"))]
    {
        state
            .refine_abort
            .store(true, std::sync::atomic::Ordering::Relaxed);
        let engine = engine(&app, &state).await?;
        let abort = Arc::new(AtomicBool::new(false));
        let session = Session::new(engine, Arc::clone(&abort))?;
        let emitter = app.clone();
        let capture = Capture::start(session, abort, move |event| emit(&emitter, event));
        let previous = lock(&state.capture).replace(capture);
        if let Some(previous) = previous {
            // Joined off the async runtime; see `Capture::cancel`.
            tauri::async_runtime::spawn_blocking(move || previous.cancel());
        }
        Ok(())
    }
}

/// Appends audio to the running capture: little-endian `f32` samples, 16 kHz
/// mono. Returns at once; inference never runs here.
///
/// The samples arrive in either of two envelopes, and the second is the one the
/// phone actually uses. Raw bytes (`InvokeBody::Raw`) are the natural shape and
/// work on the desktop. On ANDROID THEY NEVER ARRIVE: Android's WebView gives
/// `shouldInterceptRequest` no access to a request's body, so Tauri carries
/// every payload across the JavaScript bridge as JSON instead, and a
/// `Uint8Array` handed to `invoke` shows up here as a JSON value. The first
/// version accepted only raw bytes, and on the Fold it rejected every chunk -
/// measured with the page's real invoke, 2026-09-12 - which means a held side
/// key would have opened a capture screen that transcribed nothing, ever. So
/// the page sends `{ "pcm": "<base64 of the bytes>" }`, which is the same
/// bytes in a string both bridges carry, and raw bytes stay accepted.
///
/// Sync rather than `async` because the whole of its work is a decode and a
/// lock held for a `Vec::extend` - microseconds - and a hop to the async
/// runtime would cost more than the work. See the module header for the
/// ordering rule the page must keep.
#[tauri::command]
pub fn capture_push(
    request: tauri::ipc::Request<'_>,
    state: State<'_, CaptureState>,
) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        let _ = (request, state);
        Err(NOT_ON_IOS.to_string())
    }
    #[cfg(not(target_os = "ios"))]
    {
        use base64::Engine as _;
        let decoded;
        let bytes: &[u8] = match request.body() {
            tauri::ipc::InvokeBody::Raw(bytes) => bytes,
            tauri::ipc::InvokeBody::Json(value) => {
                let Some(pcm) = value.get("pcm").and_then(|pcm| pcm.as_str()) else {
                    return Err(
                        "capture_push takes raw bytes or { \"pcm\": base64 } of little-endian f32 PCM".to_string(),
                    );
                };
                decoded = base64::engine::general_purpose::STANDARD
                    .decode(pcm)
                    .map_err(|e| format!("capture_push got pcm that is not valid base64: {e}"))?;
                &decoded
            }
        };
        if !bytes.len().is_multiple_of(4) {
            return Err(format!(
                "capture_push got {} bytes, which is not a whole number of f32 samples",
                bytes.len()
            ));
        }
        let samples: Vec<f32> = bytes
            .chunks_exact(4)
            .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
            .collect();
        match lock(&state.capture).as_ref() {
            Some(capture) => {
                capture.push(&samples);
                Ok(())
            }
            None => {
                Err("No capture is running - await capture_start before pushing audio.".to_string())
            }
        }
    }
}

/// Commits whatever audio remains, waits for that last inference, and answers
/// with the whole committed transcript.
#[tauri::command]
pub async fn capture_stop(
    app: AppHandle,
    state: State<'_, CaptureState>,
    record_as: Option<String>,
    append: Option<bool>,
) -> Result<Finished, String> {
    #[cfg(target_os = "ios")]
    {
        let _ = (app, state, record_as, append);
        Err(NOT_ON_IOS.to_string())
    }
    #[cfg(not(target_os = "ios"))]
    {
        let capture = lock(&state.capture)
            .take()
            .ok_or("No capture is running.")?;
        let append = append.unwrap_or(false);
        let stopped = tauri::async_runtime::spawn_blocking(move || capture.stop())
            .await
            .map_err(|e| format!("the capture did not stop cleanly: {e}"))??;

        // The tape, kept beside the note. Written off the async runtime: a
        // minute of audio is two megabytes, and a phone's flash is not fast.
        let mut recorded_ms = None;
        if let Some(id) = record_as {
            if !stopped.recording.is_empty() {
                let dir = crate::commands::recordings_dir(&app)
                    .ok_or("no app data directory to keep recordings in")?;
                let path = crate::store::recording_file(&dir, &id).ok_or("not a note id")?;
                let recording = stopped.recording;
                let samples = tauri::async_runtime::spawn_blocking(move || {
                    std::fs::create_dir_all(&dir)
                        .map_err(|e| format!("could not make the recordings folder: {e}"))?;
                    crate::whisper::wav::write_pcm16(&path, &recording, append)
                })
                .await
                .map_err(|e| format!("the recording was not written: {e}"))??;
                recorded_ms = Some(crate::whisper::samples_to_ms(samples));
            }
        }
        Ok(Finished {
            transcript: stopped.transcript,
            recorded_ms,
        })
    }
}

/// Move a stopped temporary capture to the note whose mutation was confirmed.
#[tauri::command]
pub async fn capture_reassign_recording(
    app: AppHandle,
    from_id: String,
    to_id: String,
    append: Option<bool>,
) -> Result<Option<u64>, String> {
    #[cfg(target_os = "ios")]
    {
        let _ = (app, from_id, to_id, append);
        Err(NOT_ON_IOS.to_string())
    }
    #[cfg(not(target_os = "ios"))]
    {
        let dir = crate::commands::recordings_dir(&app)
            .ok_or("no app data directory to keep recordings in")?;
        let from = crate::store::recording_file(&dir, &from_id).ok_or("not a note id")?;
        let to = crate::store::recording_file(&dir, &to_id).ok_or("not a note id")?;
        let count = tauri::async_runtime::spawn_blocking(move || {
            crate::whisper::wav::move_or_append(&from, &to, append.unwrap_or(false))
        })
        .await
        .map_err(|e| format!("the recording did not move cleanly: {e}"))??;
        Ok((count > 0).then_some(crate::whisper::samples_to_ms(count)))
    }
}

/// Remove a stopped capture that was rejected or cancelled before it had a note.
#[tauri::command]
pub async fn capture_discard_recording(app: AppHandle, id: String) -> Result<(), String> {
    let dir = crate::commands::recordings_dir(&app)
        .ok_or("no app data directory to keep recordings in")?;
    let path = crate::store::recording_file(&dir, &id).ok_or("not a note id")?;
    tauri::async_runtime::spawn_blocking(move || match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("could not remove the temporary recording: {e}")),
    })
    .await
    .map_err(|e| format!("the temporary recording did not clean up: {e}"))?
}

/// Winds the running capture back to `to_ms`, so what is pushed next records
/// over everything after it. Resolves once `capture://rewound` has gone out.
#[tauri::command]
pub async fn capture_rewind(state: State<'_, CaptureState>, to_ms: u64) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        let _ = (state, to_ms);
        Err(NOT_ON_IOS.to_string())
    }
    #[cfg(not(target_os = "ios"))]
    {
        // Asked for under the lock, waited for outside it, so pushes and a
        // cancel are never held up behind a rewind.
        let heard = lock(&state.capture)
            .as_ref()
            .ok_or("No capture is running.")?
            .rewind(to_ms)?;
        tauri::async_runtime::spawn_blocking(move || {
            heard.recv_timeout(std::time::Duration::from_secs(15))
        })
        .await
        .map_err(|e| format!("the rewind did not finish: {e}"))?
        .map_err(|_| "The capture ended before the rewind could happen.".to_string())
    }
}

/// Ends the capture without committing anything further. Cancelling when
/// nothing is running succeeds: the page wanted no capture, and has none.
#[tauri::command]
pub async fn capture_cancel(state: State<'_, CaptureState>) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        let _ = state;
        Err(NOT_ON_IOS.to_string())
    }
    #[cfg(not(target_os = "ios"))]
    {
        let Some(capture) = lock(&state.capture).take() else {
            return Ok(());
        };
        tauri::async_runtime::spawn_blocking(move || capture.cancel())
            .await
            .map_err(|e| format!("the capture did not cancel cleanly: {e}"))
    }
}

/// Transcribes a whole 16 kHz WAV file in one pass, for benchmarking on the
/// device. Uses the cached model, loading it first if it has to.
#[tauri::command]
pub async fn transcribe_wav(
    app: AppHandle,
    state: State<'_, CaptureState>,
    path: String,
) -> Result<Transcript, String> {
    #[cfg(target_os = "ios")]
    {
        let _ = (app, state, path);
        Err(NOT_ON_IOS.to_string())
    }
    #[cfg(not(target_os = "ios"))]
    {
        use crate::whisper::{samples_to_ms, wav};
        let engine = engine(&app, &state).await?;
        tauri::async_runtime::spawn_blocking(move || {
            let audio = wav::read(std::path::Path::new(&path))?;
            let mut session = Session::new(Arc::clone(&engine), Arc::new(AtomicBool::new(false)))?;
            let started = std::time::Instant::now();
            let text = session.transcribe_all(&audio)?;
            Ok(Transcript {
                text,
                audio_ms: samples_to_ms(audio.len()),
                elapsed_ms: started.elapsed().as_millis() as u64,
                model: engine.name().to_string(),
            })
        })
        .await
        .map_err(|e| format!("the transcription did not finish: {e}"))?
    }
}

/// The model download against the real mirrors. Ignored by default because
/// they need the network and one of them downloads 60 MB; run them with
/// `cargo test capture_commands -- --ignored`. They live here rather than in
/// `whisper/model.rs` only because reqwest needs an async runtime, and the one
/// already in this crate is Tauri's.
#[cfg(all(test, not(target_os = "ios")))]
mod tests {
    use super::offset_segments;
    use crate::whisper::engine::TimedText;
    use crate::whisper::model::{self, ModelSpec};

    #[test]
    fn a_refined_take_lands_on_the_whole_recordings_timeline() {
        let timed = vec![
            TimedText {
                text: "Fresh bread.".into(),
                start_ms: 0,
                end_ms: 1200,
            },
            TimedText {
                text: "On the way home.".into(),
                start_ms: 1200,
                end_ms: 2600,
            },
        ];
        let segments = offset_segments(timed, 45_000);
        assert_eq!((segments[0].start_ms, segments[0].end_ms), (45_000, 46_200));
        assert_eq!((segments[1].start_ms, segments[1].end_ms), (46_200, 47_600));
        assert_eq!(segments[1].text, "On the way home.");
    }

    fn temp_dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("glyph-fetch-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    #[ignore]
    fn the_active_model_downloads_through_the_mirrors_and_verifies() {
        let dir = temp_dir();
        let mut reports = Vec::new();
        let status = tauri::async_runtime::block_on(model::fetch(
            &dir,
            &model::ACTIVE,
            &model::mirrors_with(&[]),
            |got, of| reports.push((got, of)),
        ))
        .unwrap();
        assert!(status.present);
        // At most one report per 1% (plus the final one), rising, and ending
        // on the whole file - the page draws receivedBytes / totalBytes.
        assert!(
            (10..=102).contains(&reports.len()),
            "{} progress reports",
            reports.len()
        );
        assert!(reports
            .windows(2)
            .all(|pair| pair[0].0 < pair[1].0 || pair[1].0 == model::ACTIVE.bytes));
        assert_eq!(
            reports.last(),
            Some(&(model::ACTIVE.bytes, model::ACTIVE.bytes))
        );
        assert!(!dir.join(format!("{}.part", model::ACTIVE.file)).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    #[ignore]
    fn bytes_with_the_wrong_hash_are_refused_by_every_mirror_and_leave_nothing_behind() {
        // A real 3,196-byte file that is certainly not the hash below.
        let spec = ModelSpec {
            file: "README.md",
            bytes: 3_196,
            sha256: "0000000000000000000000000000000000000000000000000000000000000000",
        };
        let dir = temp_dir();
        let error = tauri::async_runtime::block_on(model::fetch(
            &dir,
            &spec,
            &model::mirrors_with(&[]),
            |_, _| {},
        ))
        .unwrap_err();
        eprintln!("{error}");
        assert!(error.contains("does not match"), "{error}");
        assert_eq!(
            std::fs::read_dir(&dir).unwrap().count(),
            0,
            "a refused download left a file behind"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
