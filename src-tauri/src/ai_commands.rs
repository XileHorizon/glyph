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
//!
//! On iOS every command exists with the same signature and rejects, or answers
//! "not present": the model there will be Apple's, and a page written against
//! one surface needs no platform switch to load.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::llm::command::{self, CommandIntent};
use crate::llm::model::{self, LlmSpec};

#[cfg(not(target_os = "ios"))]
use crate::llm::engine::{Llm, Request};
#[cfg(not(target_os = "ios"))]
use std::sync::OnceLock;

#[cfg(target_os = "ios")]
const NOT_ON_IOS: &str = "Formatting on the phone is not available on iOS yet.";

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
}

fn default_temperature() -> f32 {
    0.3
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelProgress {
    id: String,
    received_bytes: u64,
    total_bytes: u64,
}

#[derive(Default)]
pub struct AiState {
    /// Started on the first generation, never before: a launch pays nothing
    /// for a feature it may not use.
    #[cfg(not(target_os = "ios"))]
    llm: OnceLock<Llm>,
    /// The cancel flag of every run in flight, by the page's id.
    runs: Mutex<HashMap<String, Arc<AtomicBool>>>,
    /// One download at a time: two would write the same `.part` at once.
    #[cfg(not(target_os = "ios"))]
    fetching: tauri::async_runtime::Mutex<()>,
}

impl AiState {
    #[cfg(not(target_os = "ios"))]
    fn llm(&self) -> &Llm {
        self.llm.get_or_init(Llm::start)
    }

    /// Raises every run's cancel flag.
    fn cancel_all(&self) {
        for flag in lock(&self.runs).values() {
            flag.store(true, Ordering::Relaxed);
        }
    }
}

/// Recovers a guard from a lock some earlier command panicked while holding;
/// the same reasoning as `NotesStore::lock`.
fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Hands the state to Tauri. Called once, from `setup`. Touches nothing.
pub fn install(app: &tauri::App) {
    app.manage(AiState::default());
}

/// Cancels every run and stops the worker, waiting for it. Called on
/// `RunEvent::Exit`, for the reason `capture_commands::shutdown` gives: C++
/// with static state must not be mid-decode when the process's destructors
/// run.
pub fn shutdown(app: &AppHandle) {
    if let Some(state) = app.try_state::<AiState>() {
        state.cancel_all();
        #[cfg(not(target_os = "ios"))]
        if let Some(llm) = state.llm.get() {
            llm.shutdown();
        }
    }
}

fn info(dir: Option<&std::path::Path>, spec: &LlmSpec) -> ModelInfo {
    let status = dir.map(|d| crate::whisper::model::status(d, &spec.spec));
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
    let dir = if cfg!(target_os = "ios") { None } else { crate::capture_commands::models_dir(&app).ok() };
    crate::llm::device::read(dir.as_deref())
}

/// The catalogue, with what is on this phone.
#[tauri::command]
pub fn ai_models(app: AppHandle) -> Vec<ModelInfo> {
    // No data directory (or iOS) is every model absent - and NOT a relative
    // path, which would answer for whatever sits in the working directory.
    let dir = if cfg!(target_os = "ios") { None } else { crate::capture_commands::models_dir(&app).ok() };
    model::CATALOGUE.iter().map(|spec| info(dir.as_deref(), spec)).collect()
}

/// Downloads a model into `<app_data_dir>/models/` if it is not there,
/// verifying its SHA-256. Progress arrives as `ai://model-progress`.
#[tauri::command]
pub async fn ai_fetch_model(app: AppHandle, state: State<'_, AiState>, id: String) -> Result<ModelInfo, String> {
    let spec = known(&id)?;
    #[cfg(target_os = "ios")]
    {
        let _ = (app, state, spec);
        Err(NOT_ON_IOS.to_string())
    }
    #[cfg(not(target_os = "ios"))]
    {
        use tauri::Emitter;
        let dir = crate::capture_commands::models_dir(&app)?;
        let _one_download = state.fetching.lock().await;
        let emitter = app.clone();
        let mirrors = model::mirrors_with(spec, &crate::ota::services(&app).model_mirrors);
        let name = spec.id.to_string();
        crate::whisper::model::fetch(&dir, &spec.spec, &mirrors, move |received, total| {
            let _ = emitter.emit(
                "ai://model-progress",
                ModelProgress {
                    id: name.clone(),
                    received_bytes: received,
                    total_bytes: total,
                },
            );
        })
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
    {
        let _ = (app, state, spec);
        Err(NOT_ON_IOS.to_string())
    }
    #[cfg(not(target_os = "ios"))]
    {
        let dir = crate::capture_commands::models_dir(&app)?;
        // A run on this model ends, and the engine lets go of the file, before
        // it is removed. Unlinking a mapped file is safe on Android and macOS
        // either way; this is about giving the space back.
        state.cancel_all();
        if let Some(llm) = state.llm.get() {
            llm.unload();
        }
        let path = crate::whisper::model::path_in(&dir, &spec.spec);
        for candidate in [path.clone(), path.with_extension("gguf.part")] {
            match std::fs::remove_file(&candidate) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(format!("cannot remove {}: {e}", candidate.display())),
            }
        }
        Ok(info(Some(&dir), spec))
    }
}

/// Formats: runs the page's prompt over the note with the model it names,
/// streaming `ai://progress`, and answers with the whole output at the end.
#[tauri::command]
pub async fn ai_generate(
    app: AppHandle,
    state: State<'_, AiState>,
    request: GenerateRequest,
) -> Result<crate::llm::engine::Output, String> {
    let spec = known(&request.model)?;
    #[cfg(target_os = "ios")]
    {
        let _ = (app, state, spec);
        Err(NOT_ON_IOS.to_string())
    }
    #[cfg(not(target_os = "ios"))]
    {
        use tauri::Emitter;
        let dir = crate::capture_commands::models_dir(&app)?;
        let status = crate::whisper::model::status(&dir, &spec.spec);
        if !status.present {
            return Err(format!("The model {} is not on this phone yet.", spec.id));
        }
        let cancel = Arc::new(AtomicBool::new(false));
        lock(&state.runs).insert(request.id.clone(), Arc::clone(&cancel));
        let emitter = app.clone();
        let engine_request = Request {
            id: request.id.clone(),
            system: request.system,
            context: request.context,
            prompt: request.prompt,
            max_tokens: request.max_tokens,
            temperature: request.temperature,
            think: request.think,
            think_budget: request.think_budget,
            grammar: None,
        };
        let answer = state.llm().generate(std::path::Path::new(&status.path), engine_request, cancel, move |progress| {
            let _ = emitter.emit("ai://progress", progress);
        });
        // The reply comes on a std channel from the worker thread; waiting on
        // it belongs on the blocking pool, not the async runtime.
        let result = tauri::async_runtime::spawn_blocking(move || answer.recv())
            .await
            .map_err(|e| format!("the formatting run did not finish: {e}"))?
            .map_err(|_| "the formatting engine went away".to_string())?;
        lock(&state.runs).remove(&request.id);
        result.map_err(|failure| failure.to_string())
    }
}

/// Stops a run. True if there was one to stop.
#[tauri::command]
pub fn ai_cancel(state: State<'_, AiState>, id: String) -> bool {
    match lock(&state.runs).get(&id) {
        Some(flag) => {
            flag.store(true, Ordering::Relaxed);
            true
        }
        None => false,
    }
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
        let dir = crate::capture_commands::models_dir(&app)?;
        let preferred = model::find(&request.preferred_model)
            .filter(|spec| crate::whisper::model::status(&dir, &spec.spec).present);
        let fallback = model::find("qwen3.5-2b")
            .filter(|spec| crate::whisper::model::status(&dir, &spec.spec).present);
        let Some(spec) = preferred.or(fallback) else {
            return Ok(CommandInferenceResult::Unavailable {
                reason: "No compatible installed model is available for instruction commands.".into(),
            });
        };
        let status = crate::whisper::model::status(&dir, &spec.spec);
        let cancel = Arc::new(AtomicBool::new(false));
        {
            let mut runs = lock(&state.runs);
            if !runs.is_empty() {
                return Ok(CommandInferenceResult::Unavailable { reason: "The on-device model is already working.".into() });
            }
            runs.insert(request.id.clone(), Arc::clone(&cancel));
        }
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
        };
        let answer = state.llm().generate(std::path::Path::new(&status.path), engine_request, cancel, |_| {});
        let received = tauri::async_runtime::spawn_blocking(move || answer.recv()).await;
        lock(&state.runs).remove(&request.id);
        let result = received
            .map_err(|e| format!("the command inference did not finish: {e}"))?
            .map_err(|_| "the command inference engine went away".to_string())?;
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
    /// "sort", or "plan" with the `kind` sorting found.
    pub stage: String,
    #[serde(default)]
    pub kind: Option<String>,
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
    let (system, grammar, kind, max_tokens): (&str, &'static str, Option<&str>, u32) = match (request.stage.as_str(), request.kind.as_deref()) {
        ("sort", _) => (command::SORT_SYSTEM, command::SORT_GRAMMAR, None, 16),
        ("plan", Some(kind @ ("add" | "new" | "mixed"))) => (command::PLAN_SYSTEM, command::PLAN_GRAMMAR, Some(kind), 640),
        _ => return Ok(VoiceStepResult::Unavailable { reason: "Unknown voice step.".into() }),
    };
    if command::refusal(transcript).is_some() {
        return Ok(VoiceStepResult::Refused { reason: "Deleting, clearing or sending notes by voice is not supported.".into() });
    }
    #[cfg(target_os = "ios")]
    {
        let _ = (app, state, system, grammar, kind, max_tokens);
        return Ok(VoiceStepResult::Unavailable { reason: "The on-device model is not available on iOS yet.".into() });
    }
    #[cfg(not(target_os = "ios"))]
    {
        let dir = crate::capture_commands::models_dir(&app)?;
        let preferred = model::find(&request.preferred_model)
            .filter(|spec| crate::whisper::model::status(&dir, &spec.spec).present);
        let fallback = model::find("qwen3.5-2b")
            .filter(|spec| crate::whisper::model::status(&dir, &spec.spec).present);
        let Some(spec) = preferred.or(fallback) else {
            return Ok(VoiceStepResult::Unavailable {
                reason: "No compatible installed model is available for voice commands.".into(),
            });
        };
        let status = crate::whisper::model::status(&dir, &spec.spec);
        let cancel = Arc::new(AtomicBool::new(false));
        {
            let mut runs = lock(&state.runs);
            if !runs.is_empty() {
                return Ok(VoiceStepResult::Unavailable { reason: "The on-device model is already working.".into() });
            }
            runs.insert(request.id.clone(), Arc::clone(&cancel));
        }
        let engine_request = Request {
            id: request.id.clone(),
            system: system.into(),
            context: None,
            prompt: command::voice_prompt(transcript, &request.titles, kind),
            max_tokens,
            temperature: 0.0,
            think: false,
            think_budget: 0,
            grammar: Some(grammar),
        };
        let answer = state.llm().generate(std::path::Path::new(&status.path), engine_request, cancel, |_| {});
        let received = tauri::async_runtime::spawn_blocking(move || answer.recv()).await;
        lock(&state.runs).remove(&request.id);
        let result = received
            .map_err(|e| format!("the voice step did not finish: {e}"))?
            .map_err(|_| "the voice step engine went away".to_string())?;
        match result {
            Ok(output) => match command::check_answer(&output.text, output.truncated) {
                Ok(answer) => Ok(VoiceStepResult::Answer { answer, raw: output.text, model: spec.id.into() }),
                Err(reason) => Ok(VoiceStepResult::Unavailable { reason: format!("{reason}: {}", output.text.chars().take(300).collect::<String>()) }),
            },
            Err(failure) => Ok(VoiceStepResult::Unavailable { reason: failure.to_string() }),
        }
    }
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

    #[test]
    fn an_unknown_model_is_refused_by_name() {
        assert!(known("gpt-4").unwrap_err().contains("gpt-4"));
        assert_eq!(known(model::DEFAULT.id).unwrap().id, model::DEFAULT.id);
    }
}
