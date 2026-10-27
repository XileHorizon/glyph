//! The Tauri seam for formatting on the phone: five commands, two events, and
//! nothing the engine does not already do.
//!
//! `llm/` owns the model and stays free of `tauri::` types, like `whisper/`.
//! This module resolves the app's data directory, holds the engine and the
//! runs in progress in managed state, and turns progress into `app.emit`.
//! Which model, which prompt, how many tokens: every one of those is the
//! page's decision, sent with the request, so the prompt can be tuned over
//! the air without a new binary.
//!
//! THE CONTRACT WITH THE PAGE:
//!
//! - `ai_device() -> { totalRamBytes, availableRamBytes, cores, fastCores,
//!   chip, chipMaker, phone, phoneName, freeDiskBytes }`, facts for the page
//!   to judge which models fit (`llm/device.rs`).
//! - `ai_models() -> [{ id, file, bytes, present, path }]`, the catalogue with
//!   what is on this phone. Names and descriptions live on the page.
//! - `ai_fetch_model({ id }) -> ModelInfo`, emitting `ai://model-progress`
//!   `{ id, receivedBytes, totalBytes }`. One download at a time.
//! - `ai_delete_model({ id }) -> ModelInfo`: the file goes, and the engine
//!   drops it from memory if it was loaded.
//! - `ai_generate({ id, model, system, context?, prompt, maxTokens,
//!   temperature }) -> Output`, resolving when the run ends; while it runs,
//!   `ai://progress` carries `{ id, phase, partial, ... }` about every 120 ms
//!   with everything written so far, and last with phase `done`, `error` or
//!   `cancelled`. Runs queue: a second request waits for the first.
//! - `ai_cancel({ id }) -> bool`: the run stops within a chunk; its
//!   `ai_generate` then rejects with "cancelled".
//! - `ai_unload()`: the loaded model is dropped now rather than after the
//!   worker's five idle minutes, for the page to ask after a long summary
//!   (native generation 20).
//!
//! The worker itself is `llm::shared()`, a crate-level one rather than this
//! module's, because a meeting's write-up reaches it over JNI with no Tauri in
//! the process (`write_up.rs`) and there must be one model loaded, not two.
//!
//! On iOS every command exists with the same signature and rejects, or answers
//! "not present": the model there will be Apple's, and a page written against
//! one surface needs no platform switch to load.

// iOS answers every command here with its refusal (unsupported.rs), so the
// rest of the module is unused there by design, not by accident.
#![cfg_attr(target_os = "ios", allow(dead_code))]

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::llm::command::{self, CommandIntent};
use crate::llm::model::{self, LlmSpec};
// A lock some earlier command panicked while holding is recovered, not
// obeyed; see `crate::lock`.
use crate::lock::lock;
use crate::model_downloads;

#[cfg(not(target_os = "ios"))]
use crate::llm::engine::{Llm, Request};

#[cfg(target_os = "ios")]
use crate::unsupported::{on_ios, FORMATTING};

/// What the page asks for.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateRequest {
    pub id: String,
    pub model: String,
    pub system: String,
    #[serde(default)]
    pub context: Option<String>,
    pub prompt: String,
    pub max_tokens: u32,
    #[serde(default = "default_temperature")]
    pub temperature: f32,
    /// Let a model that can reason do so before it answers, and stream the
    /// reasoning with the answer (native generation 13). Absent means no:
    /// the empty thought goes in, as every formatting pass wants.
    #[serde(default)]
    pub think: bool,
    /// With `think`: the most tokens the thinking may run before it is closed
    /// for the model and the answer begins. 0 is no limit.
    #[serde(default)]
    pub think_budget: u32,
    /// Never sent by the page: a background job is a meeting's write-up, which
    /// comes in by its own door. Read so the request's shape is the engine's.
    #[serde(default)]
    pub background: bool,
}

fn default_temperature() -> f32 {
    0.3
}

/// The engine's request for what the page asked. Never a grammar: a
/// constrained run is native-owned (`ai_infer_command`), so a formatting run
/// has none whatever the page's JSON carries.
#[cfg(not(target_os = "ios"))]
impl From<GenerateRequest> for Request {
    fn from(request: GenerateRequest) -> Request {
        Request {
            id: request.id,
            system: request.system,
            context: request.context,
            prompt: request.prompt,
            max_tokens: request.max_tokens,
            temperature: request.temperature,
            think: request.think,
            think_budget: request.think_budget,
            grammar: None,
            background: request.background,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommandInferenceRequest {
    pub id: String,
    pub utterance: String,
    /// The titles of the person's notes, so the model can tell which one was
    /// meant. Titles only: never a body or an id.
    #[serde(default)]
    pub titles: Vec<String>,
    pub preferred_model: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum CommandInferenceResult {
    Intent { intent: CommandIntent, model: String },
    Unavailable { reason: String },
}

/// The command model's standing instructions. Fixed text, so the llama KV
/// prefix snapshot after it stays valid across commands; the worked examples
/// are the phrasings people actually say ("my note labeled Go", "a list
/// with…"), which a 2B model follows far better than a rule alone.
const COMMAND_SYSTEM: &str = r#"Read what someone said into a notes app and work out whether they asked for a change to their notes, and if so what they want in the end. They talk naturally: the request can come after other talk ("so I was thinking… can you make me a list"), and a request someone else was given, or talk about adding things later, is not one. Answer with JSON. Allowed actions: append to an existing note, create a new note, or none.
- Their notes are listed first. For append, "target" should be one of those titles, allowing for misheard words.
- append: "target" is only the note's title as spoken, without words like "my", "the", "note", "list", "labeled", "called" or "named". "content" is only what to add, in the speaker's words, without the command or the title. "placement" is "list" when they ask for a list, items, bullets or points; "tasks" for tasks, to-dos or check boxes; "bugs" for bugs or issues; "notes" for a paragraph or a note; otherwise null.
- When they name several things to add (movies, places, groceries), placement is "list" even if they did not say "list".
- For "list" and "tasks", separate the items in "content" with "; " and keep each item whole: "Paris, Texas; Austin, Texas".
- create: "target" is the new note's title and "content" is its body, or null.
- "Make a list called X and add A and B" is one request: create X with content "A; B".
- none: destructive (delete, remove, clear) or unsupported requests; "unclear" when it is ordinary talk, not a request.
Never invent content or a title. Output exactly one object in the required schema.

Examples:
Notes: Go, Work
Said: add to my note labeled Go a list with Parkersburg West Virginia Marietta Ohio and Detroit Michigan
{"action":"append","target":"Go","content":"Parkersburg, West Virginia; Marietta, Ohio; Detroit, Michigan","placement":"list"}
Said: put call Sam and book the flights on my work to-do list
{"action":"append","target":"Work","content":"call Sam; book the flights","placement":"tasks"}
Said: add to the note called Weekend trip that we should book the ferry early
{"action":"append","target":"Weekend trip","content":"we should book the ferry early","placement":null}
Said: add eggs milk and bread to groceries
{"action":"append","target":"groceries","content":"eggs; milk; bread","placement":"list"}
Said: make a new note called Packing
{"action":"create","target":"Packing","content":null}
Said: ok so I was watching stuff last night, can you make me a list called movies with Jaws, Alien and Heat
{"action":"create","target":"Movies","content":"Jaws; Alien; Heat"}
Said: I told Sam I would add the photos to the album later
{"action":"none","reason":"unclear"}
Said: delete everything in my Go note
{"action":"none","reason":"destructive"}"#;

/// One model of the catalogue, with whether this phone has it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub file: String,
    pub bytes: u64,
    pub present: bool,
    pub path: String,
}

/// How long a voice step waits for the model, queueing and loading included,
/// before it gives up and lets the recording be saved as a note.
const STEP_WAIT: Duration = Duration::from_secs(120);
/// The polish is only an improvement on a draft that already works: it gets less time.
const POLISH_WAIT: Duration = Duration::from_secs(60);
/// Lines the diagnostics keep.
const EVENTS_KEPT: usize = 200;

/// One generation in flight.
struct Run {
    cancel: Arc<AtomicBool>,
    what: &'static str,
    started: Instant,
}

/// What `ai_diagnostics` says about one run in flight.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunInfo {
    id: String,
    what: String,
    age_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Event {
    /// Unix milliseconds.
    at: u64,
    line: String,
}

/// The engine as the page can see it, for the voice log: is a model in memory,
/// what is running or waiting, and the last things that happened.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostics {
    pub engine_started: bool,
    pub model_loaded: bool,
    pub runs: Vec<RunInfo>,
    pub events: Vec<Event>,
}

/// A run's entry in `AiState::runs`, removed when this drops: on success, on
/// an error, on a panic and when the command's future is dropped. Nothing else
/// removes it, so one failed request can never leave the engine looking busy.
struct RunGuard<'a> {
    state: &'a AiState,
    id: String,
    what: &'static str,
    started: Instant,
}

impl Drop for RunGuard<'_> {
    fn drop(&mut self) {
        lock(&self.state.runs).remove(&self.id);
        self.state.log(format!("{} {} finished after {} ms", self.what, self.id, self.started.elapsed().as_millis()));
    }
}

#[derive(Default)]
pub struct AiState {
    /// The cancel flag of every run in flight, by the page's id.
    runs: Mutex<HashMap<String, Run>>,
    /// The last [`EVENTS_KEPT`] things the engine did, for `ai_diagnostics`.
    events: Mutex<VecDeque<Event>>,
    /// One download at a time: two would write the same `.part` at once.
    #[cfg(not(target_os = "ios"))]
    fetching: tauri::async_runtime::Mutex<()>,
}

impl AiState {
    /// The shared worker (`llm::shared`), started on the first generation and
    /// never before: a launch pays nothing for a feature it may not use.
    #[cfg(not(target_os = "ios"))]
    fn llm(&self) -> &'static Llm {
        crate::llm::shared()
    }

    /// Raises every run's cancel flag.
    fn cancel_all(&self) {
        for run in lock(&self.runs).values() {
            run.cancel.store(true, Ordering::Relaxed);
        }
    }

    fn log(&self, line: impl Into<String>) {
        let at = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
        let mut events = lock(&self.events);
        if events.len() >= EVENTS_KEPT {
            events.pop_front();
        }
        events.push_back(Event { at, line: line.into() });
    }

    /// Records a run and says what it is queued behind.
    fn begin(&self, id: &str, what: &'static str, cancel: &Arc<AtomicBool>) -> RunGuard<'_> {
        let started = Instant::now();
        let ahead = {
            let mut runs = lock(&self.runs);
            let ahead = runs.len();
            runs.insert(id.to_string(), Run { cancel: Arc::clone(cancel), what, started });
            ahead
        };
        self.log(if ahead == 0 { format!("{what} {id} started") } else { format!("{what} {id} queued behind {ahead} run(s)") });
        RunGuard { state: self, id: id.to_string(), what, started }
    }
}

/// Hands the state to Tauri. Called once, from `setup`. Touches nothing.
pub fn install(app: &tauri::App) {
    app.manage(AiState::default());
}

/// How long Exit waits for a write-up in hand to let go: well under
/// `write_up::CANCEL_WAIT`, since the run hears the abort within one graph
/// computation and a quit that hangs is its own fault.
const EXIT_WAIT: std::time::Duration = std::time::Duration::from_secs(2);

/// Cancels every run and stops the worker, waiting for it. Called on
/// `RunEvent::Exit`, for the reason `capture_commands::shutdown` gives: C++
/// with static state must not be mid-decode when the process's destructors
/// run.
pub fn shutdown(app: &AppHandle) {
    if let Some(state) = app.try_state::<AiState>() {
        state.cancel_all();
    }
    // A write-up's piece ends too, so Exit does not join a whole one, and the
    // run is given a moment to let go: it runs on the meeting service's or the
    // worker's thread, which nobody joins, and a whisper decode still going
    // when C++'s static destructors run is the crash capture_commands::shutdown
    // joins its own capture to avoid.
    crate::guards::abort_with("shutdown");
    crate::guards::wait_for_no_job(EXIT_WAIT);
    #[cfg(not(target_os = "ios"))]
    if let Some(llm) = crate::llm::started() {
        llm.shutdown();
    }
}

fn info(dir: Option<&std::path::Path>, spec: &LlmSpec) -> ModelInfo {
    let status = dir.map(|d| crate::model_files::status(d, &spec.spec));
    ModelInfo {
        id: spec.id.to_string(),
        file: spec.spec.file.to_string(),
        bytes: spec.spec.bytes,
        present: status.as_ref().is_some_and(|s| s.present),
        path: status.map(|s| s.path).unwrap_or_default(),
    }
}

fn known(id: &str) -> Result<&'static LlmSpec, String> {
    model::find(id).ok_or_else(|| format!("Glyph does not know a model called {id}."))
}

/// What this phone has to run a model with: memory, cores, chip, free disk.
/// The page decides what fits.
#[tauri::command]
pub fn ai_device(app: AppHandle) -> crate::llm::device::Device {
    crate::llm::device::read(model_downloads::models_here(&app).as_deref())
}

/// The catalogue, with what is on this phone.
#[tauri::command]
pub fn ai_models(app: AppHandle) -> Vec<ModelInfo> {
    // No data directory (or iOS) is every model absent: see
    // `model_downloads::models_here`.
    let dir = model_downloads::models_here(&app);
    model::CATALOGUE.iter().map(|spec| info(dir.as_deref(), spec)).collect()
}

/// Downloads a model into `<app_data_dir>/models/` if it is not there,
/// verifying its SHA-256. Progress arrives as `ai://model-progress`.
#[tauri::command]
pub async fn ai_fetch_model(app: AppHandle, state: State<'_, AiState>, id: String) -> Result<ModelInfo, String> {
    let spec = known(&id)?;
    #[cfg(target_os = "ios")]
    return on_ios(FORMATTING, (app, state, spec));
    #[cfg(not(target_os = "ios"))]
    {
        let dir = crate::paths::models_dir(&app)?;
        model_downloads::fetch_reporting(
            &app,
            &dir,
            &state.fetching,
            &spec.spec,
            |preferred| model::mirrors_with(spec, preferred),
            "ai://model-progress",
            Some(spec.id),
        )
        .await?;
        Ok(info(Some(&dir), spec))
    }
}

/// Removes a model's file (and a half-downloaded one), unloading it first if
/// the engine has it in memory. Answers with the model, now absent.
#[tauri::command]
pub async fn ai_delete_model(app: AppHandle, state: State<'_, AiState>, id: String) -> Result<ModelInfo, String> {
    let spec = known(&id)?;
    #[cfg(target_os = "ios")]
    return on_ios(FORMATTING, (app, state, spec));
    #[cfg(not(target_os = "ios"))]
    {
        let dir = crate::paths::models_dir(&app)?;
        // A run on this model ends, and the engine lets go of the file, before
        // it is removed. Unlinking a mapped file is safe on Android and macOS
        // either way; this is about giving the space back.
        state.cancel_all();
        if let Some(llm) = crate::llm::started() {
            llm.unload();
        }
        for candidate in [crate::model_files::path_in(&dir, &spec.spec), crate::model_files::part_path(&dir, &spec.spec)] {
            crate::fsx::remove_file_if_present(&candidate).map_err(|e| format!("cannot remove {}: {e}", candidate.display()))?;
        }
        Ok(info(Some(&dir), spec))
    }
}

/// What formatting answers with: the engine's output, or on iOS, where there is no engine (`llm::engine` isn't built),
/// nothing, as the command only ever refuses there.
#[cfg(not(target_os = "ios"))]
type GenerateOutput = crate::llm::engine::Output;
#[cfg(target_os = "ios")]
type GenerateOutput = ();

/// Formats: runs the page's prompt over the note with the model it names,
/// streaming `ai://progress`, and answers with the whole output at the end.
#[tauri::command]
pub async fn ai_generate(
    app: AppHandle,
    state: State<'_, AiState>,
    request: GenerateRequest,
) -> Result<GenerateOutput, String> {
    let spec = known(&request.model)?;
    #[cfg(target_os = "ios")]
    return on_ios(FORMATTING, (app, state, spec));
    #[cfg(not(target_os = "ios"))]
    {
        use tauri::Emitter;
        let dir = crate::paths::models_dir(&app)?;
        let status = crate::model_files::status(&dir, &spec.spec);
        if !status.present {
            return Err(format!("The model {} is not on this phone yet.", spec.id));
        }
        let cancel = Arc::new(AtomicBool::new(false));
        let _run = state.begin(&request.id, "format", &cancel);
        let id = request.id.clone();
        let emitter = app.clone();
        let answer = state.llm().generate(std::path::Path::new(&status.path), Request::from(request), cancel, move |progress| {
            let _ = emitter.emit("ai://progress", progress);
        });
        // The reply comes on a std channel from the worker thread; waiting on
        // it belongs on the blocking pool, not the async runtime.
        let joined = tauri::async_runtime::spawn_blocking(move || answer.recv()).await;
        // The run's guard (`_run`) removes it from the table when this returns, however it ends.
        let result = joined
            .map_err(|e| format!("the formatting run did not finish: {e}"))?
            .map_err(|_| "the formatting engine went away".to_string())?;
        if let Err(failure) = &result {
            state.log(format!("format {id} failed: {failure}"));
        }
        result.map_err(|failure| failure.to_string())
    }
}

/// Drops the loaded model now: the page asks after a summary of a long tape,
/// where the five idle minutes would keep a KV cache and gigabytes of mapped
/// weights on a phone that has finished. Nothing to drop is nothing to do, and
/// a worker never started is not started for this. Native generation 20.
#[tauri::command]
pub fn ai_unload() -> Result<(), String> {
    #[cfg(not(target_os = "ios"))]
    if let Some(llm) = crate::llm::started() {
        llm.unload();
    }
    Ok(())
}

/// Stops a run. True if there was one to stop.
#[tauri::command]
pub fn ai_cancel(state: State<'_, AiState>, id: String) -> bool {
    match lock(&state.runs).get(&id) {
        Some(run) => {
            run.cancel.store(true, Ordering::Relaxed);
            true
        }
        None => false,
    }
}

/// The engine's state and last events, for the voice log. Reads only.
#[tauri::command]
pub fn ai_diagnostics(state: State<'_, AiState>) -> Diagnostics {
    #[cfg(not(target_os = "ios"))]
    let (engine_started, model_loaded) = (crate::llm::started().is_some(), crate::llm::started().is_some_and(|llm| llm.loaded()));
    #[cfg(target_os = "ios")]
    let (engine_started, model_loaded) = (false, false);
    let mut runs: Vec<RunInfo> = lock(&state.runs)
        .iter()
        .map(|(id, run)| RunInfo { id: id.clone(), what: run.what.to_string(), age_ms: run.started.elapsed().as_millis() as u64 })
        .collect();
    runs.sort_by(|a, b| b.age_ms.cmp(&a.age_ms));
    let events = lock(&state.events).iter().cloned().collect();
    Diagnostics { engine_started, model_loaded, runs, events }
}

/// Interprets one wake-word-qualified utterance using only an already installed
/// model, a native fixed prompt, and a native fixed grammar.
#[tauri::command]
pub async fn ai_infer_command(
    app: AppHandle,
    state: State<'_, AiState>,
    request: CommandInferenceRequest,
) -> Result<CommandInferenceResult, String> {
    let utterance = request.utterance.trim();
    if request.id.is_empty() || utterance.is_empty() || utterance.chars().count() > 4_000 {
        return Ok(CommandInferenceResult::Unavailable { reason: "The command was empty or too long.".into() });
    }
    if let Some(reason) = command::refusal(utterance) {
        return Ok(CommandInferenceResult::Intent { intent: CommandIntent::None { reason }, model: String::new() });
    }
    #[cfg(target_os = "ios")]
    {
        let _ = (app, state);
        return Ok(CommandInferenceResult::Unavailable {
            reason: "Instruction inference is not available on iOS; Glyph’s built-in commands still work.".into(),
        });
    }
    #[cfg(not(target_os = "ios"))]
    {
        let dir = crate::paths::models_dir(&app)?;
        let preferred = model::find(&request.preferred_model)
            .filter(|spec| crate::model_files::status(&dir, &spec.spec).present);
        let fallback = model::find("qwen3.5-2b")
            .filter(|spec| crate::model_files::status(&dir, &spec.spec).present);
        let Some(spec) = preferred.or(fallback) else {
            return Ok(CommandInferenceResult::Unavailable {
                reason: "No compatible installed model is available for instruction commands.".into(),
            });
        };
        let status = crate::model_files::status(&dir, &spec.spec);
        let cancel = Arc::new(AtomicBool::new(false));
        let _run = state.begin(&request.id, "command", &cancel);
        let engine_request = Request {
            id: request.id.clone(),
            system: COMMAND_SYSTEM.into(),
            context: None,
            prompt: command::user_prompt(utterance, &request.titles),
            // Room for a spoken list of a dozen places; a truncated answer fails closed.
            max_tokens: 384,
            temperature: 0.0,
            think: false,
            think_budget: 0,
            grammar: Some(command::GRAMMAR),
            // A voice command is the person waiting: it goes before, and preempts, a write-up's piece.
            background: false,
        };
        let answer = state.llm().generate(std::path::Path::new(&status.path), engine_request, Arc::clone(&cancel), |_| {});
        let received = tauri::async_runtime::spawn_blocking(move || answer.recv_timeout(STEP_WAIT)).await;
        let result = match received.map_err(|e| format!("the command inference did not finish: {e}"))? {
            Ok(result) => result,
            Err(why) => return Ok(CommandInferenceResult::Unavailable { reason: waited_in_vain(&state, &request.id, &cancel, why, STEP_WAIT) }),
        };
        match result {
            Ok(output) => match command::parse(&output.text, output.truncated) {
                Ok(intent) => Ok(CommandInferenceResult::Intent { intent, model: spec.id.into() }),
                Err(reason) => Ok(CommandInferenceResult::Unavailable { reason }),
            },
            Err(failure) => Ok(CommandInferenceResult::Unavailable { reason: failure.to_string() }),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VoiceStepRequest {
    pub id: String,
    /// The whole finished recording.
    pub transcript: String,
    /// The titles of the person's notes: never a body or an id.
    #[serde(default)]
    pub titles: Vec<String>,
    /// "sort", "plan" with the `kind` sorting found, or "polish" with a `draft`.
    pub stage: String,
    #[serde(default)]
    pub kind: Option<String>,
    /// For "polish": the app's draft, as the plan's JSON.
    #[serde(default)]
    pub draft: Option<String>,
    pub preferred_model: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum VoiceStepResult {
    /// The model's JSON, checked to be one whole object, and its raw text for the voice log.
    Answer { answer: serde_json::Value, raw: String, model: String },
    /// A destructive request: not given to the model at all.
    Refused { reason: String },
    Unavailable { reason: String },
}

/// One step of reading a finished recording (llm/command.rs): "sort" says what
/// kind of thing it is, "plan" turns it into actions with real item lists.
/// Only an installed model, a native fixed prompt and a native fixed grammar.
#[tauri::command]
pub async fn ai_voice_step(
    app: AppHandle,
    state: State<'_, AiState>,
    request: VoiceStepRequest,
) -> Result<VoiceStepResult, String> {
    let transcript = request.transcript.trim();
    if request.id.is_empty() || transcript.is_empty() || transcript.chars().count() > 4_000 {
        return Ok(VoiceStepResult::Unavailable { reason: "The recording was empty or too long.".into() });
    }
    let draft = request.draft.as_deref().map(str::trim).filter(|draft| !draft.is_empty() && draft.chars().count() <= 6_000);
    let (system, grammar, kind, max_tokens, what, wait): (&str, &'static str, Option<&str>, u32, &'static str, Duration) = match (request.stage.as_str(), request.kind.as_deref()) {
        ("sort", _) => (command::SORT_SYSTEM, command::SORT_GRAMMAR, None, 16, "voice sort", STEP_WAIT),
        ("plan", Some(kind @ ("add" | "new" | "mixed"))) => (command::PLAN_SYSTEM, command::PLAN_GRAMMAR, Some(kind), 640, "voice plan", STEP_WAIT),
        ("polish", _) if draft.is_some() => (command::POLISH_SYSTEM, command::PLAN_GRAMMAR, None, 640, "voice polish", POLISH_WAIT),
        _ => return Ok(VoiceStepResult::Unavailable { reason: "Unknown voice step.".into() }),
    };
    if command::refusal(transcript).is_some() {
        return Ok(VoiceStepResult::Refused { reason: "Deleting, clearing or sending notes by voice is not supported.".into() });
    }
    #[cfg(target_os = "ios")]
    {
        let _ = (app, state, system, grammar, kind, max_tokens, what, wait, draft);
        return Ok(VoiceStepResult::Unavailable { reason: "The on-device model is not available on iOS yet.".into() });
    }
    #[cfg(not(target_os = "ios"))]
    {
        let dir = crate::paths::models_dir(&app)?;
        let preferred = model::find(&request.preferred_model)
            .filter(|spec| crate::model_files::status(&dir, &spec.spec).present);
        let fallback = model::find("qwen3.5-2b")
            .filter(|spec| crate::model_files::status(&dir, &spec.spec).present);
        let Some(spec) = preferred.or(fallback) else {
            return Ok(VoiceStepResult::Unavailable {
                reason: "No compatible installed model is available for voice commands.".into(),
            });
        };
        let status = crate::model_files::status(&dir, &spec.spec);
        let cancel = Arc::new(AtomicBool::new(false));
        let _run = state.begin(&request.id, what, &cancel);
        let engine_request = Request {
            id: request.id.clone(),
            system: system.into(),
            context: None,
            prompt: match draft {
                Some(draft) if request.stage == "polish" => command::polish_prompt(transcript, draft),
                _ => command::voice_prompt(transcript, &request.titles, kind),
            },
            max_tokens,
            temperature: 0.0,
            think: false,
            think_budget: 0,
            grammar: Some(grammar),
            // A voice command is the person waiting: it goes before, and preempts, a write-up's piece.
            background: false,
        };
        let answer = state.llm().generate(std::path::Path::new(&status.path), engine_request, Arc::clone(&cancel), |_| {});
        let received = tauri::async_runtime::spawn_blocking(move || answer.recv_timeout(wait)).await;
        let result = match received.map_err(|e| format!("the voice step did not finish: {e}"))? {
            Ok(result) => result,
            Err(why) => return Ok(VoiceStepResult::Unavailable { reason: waited_in_vain(&state, &request.id, &cancel, why, wait) }),
        };
        match result {
            Ok(output) => {
                state.log(format!(
                    "voice step {} ran: load {} ms, prefill {} ms ({} cached), {} tokens at {:.1}/s, {} ms in all",
                    request.id, output.load_ms, output.prefill_ms, output.cached_tokens, output.output_tokens, output.tokens_per_second, output.ms
                ));
                match command::check_answer(&output.text, output.truncated) {
                    Ok(answer) => Ok(VoiceStepResult::Answer { answer, raw: output.text, model: spec.id.into() }),
                    Err(reason) => Ok(VoiceStepResult::Unavailable { reason: format!("{reason}: {}", output.text.chars().take(300).collect::<String>()) }),
                }
            }
            Err(failure) => {
                state.log(format!("voice step {} failed: {failure}", request.id));
                Ok(VoiceStepResult::Unavailable { reason: failure.to_string() })
            }
        }
    }
}

/// A step whose answer did not come: cancels it so a queued job does not run
/// later for nobody, and says why in words for the log.
#[cfg(not(target_os = "ios"))]
fn waited_in_vain(state: &AiState, id: &str, cancel: &AtomicBool, why: std::sync::mpsc::RecvTimeoutError, wait: Duration) -> String {
    cancel.store(true, Ordering::Relaxed);
    let reason = match why {
        std::sync::mpsc::RecvTimeoutError::Timeout => format!("The on-device model did not answer within {} seconds.", wait.as_secs()),
        std::sync::mpsc::RecvTimeoutError::Disconnected => "The on-device model engine went away.".to_string(),
    };
    state.log(format!("step {id}: {reason}"));
    reason
}

#[cfg(not(target_os = "ios"))]
impl Drop for AiState {
    fn drop(&mut self) {
        self.cancel_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_request_reads_from_the_pages_json_with_a_default_temperature() {
        let json = r#"{"id":"r1","model":"qwen3.5-4b","system":"Format.","prompt":"hi","maxTokens":200}"#;
        let request: GenerateRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.max_tokens, 200);
        assert_eq!(request.temperature, 0.3);
        assert_eq!(request.context, None);
        assert!(!request.think, "a formatting pass that says nothing about thinking gets none");
        let thinking: GenerateRequest = serde_json::from_str(r#"{"id":"r2","model":"qwen3.5-4b","system":"Review.","prompt":"hi","maxTokens":900,"think":true}"#).unwrap();
        assert!(thinking.think);
    }

    #[cfg(not(target_os = "ios"))]
    #[test]
    fn a_pages_grammar_is_dropped_on_reading_and_the_mapping_never_adds_one() {
        // `GenerateRequest` has no `grammar` field and does not deny unknown
        // ones, so a page that sends one is still read - without it - and the
        // mapping to the engine's request sets none of its own.
        let json = r#"{"id":"r1","model":"qwen3.5-4b","system":"Format.","context":"c","prompt":"hi","maxTokens":200,"think":true,"thinkBudget":64,"grammar":"root ::= \"x\""}"#;
        let request = Request::from(serde_json::from_str::<GenerateRequest>(json).expect("an extra key is not an error"));
        assert_eq!(request.grammar, None);
        assert_eq!((request.id.as_str(), request.context.as_deref(), request.max_tokens, request.think_budget), ("r1", Some("c"), 200, 64));
        assert!(request.think && (request.temperature - 0.3).abs() < f32::EPSILON);
        assert!(!request.background, "the page's requests are foreground ones");
    }

    #[test]
    fn a_run_leaves_the_map_when_its_guard_drops_however_it_ends() {
        let state = AiState::default();
        let cancel = Arc::new(AtomicBool::new(false));
        {
            let _first = state.begin("a", "format", &cancel);
            let _second = state.begin("b", "voice sort", &cancel);
            assert_eq!(lock(&state.runs).len(), 2);
        }
        assert!(lock(&state.runs).is_empty(), "a finished or failed run must never leave the engine looking busy");
        assert!(lock(&state.events).iter().any(|event| event.line.contains("b queued behind 1 run(s)")));
    }

    #[test]
    fn the_event_log_keeps_only_the_latest_lines() {
        let state = AiState::default();
        for n in 0..EVENTS_KEPT + 10 {
            state.log(format!("line {n}"));
        }
        let events = lock(&state.events);
        assert_eq!(events.len(), EVENTS_KEPT);
        assert_eq!(events.back().map(|e| e.line.clone()), Some(format!("line {}", EVENTS_KEPT + 9)));
    }

    #[test]
    fn an_unknown_model_is_refused_by_name() {
        assert!(known("gpt-4").unwrap_err().contains("gpt-4"));
        assert_eq!(known(model::DEFAULT.id).unwrap().id, model::DEFAULT.id);
    }
}
