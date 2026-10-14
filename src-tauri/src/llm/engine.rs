//! llama.cpp: one worker thread, one model, generations one at a time.
//!
//! WHY A THREAD OF ITS OWN. A llama.cpp context borrows its model, so the two
//! cannot live side by side in a struct without unsafe code; on a thread's
//! stack they are two locals, and the context is dropped before the model by
//! the language. The thread also keeps a generation - a minute of CPU on a
//! phone - off the async runtime that serves every other command.
//!
//! The loop is two loops. The outer one loads a model for the job in hand; the
//! inner one serves jobs with it until one names a different file, nothing has
//! arrived for [`IDLE`], the app asks for it to be unloaded, or the engine is
//! shut down. Leaving the inner loop drops the context and then the model,
//! which is how gigabytes of mapped weights and a KV cache go back to a phone
//! that has stopped formatting.
//!
//! THE CONTEXT IS SIZED TO THE JOB. A KV cache is allocated for the whole
//! window when a context is made, and 8,192 tokens on a 9B model is over a
//! gigabyte - on a phone, memory the rest of the app and the OS want. So a
//! context is made for what the job needs (prompt plus the most it may
//! write, rounded up), kept for the next job if it fits, and remade when one
//! needs more. The prefix snapshot survives a remake: it is the model's KV
//! data for sequence 0, and it restores into any context of that model with
//! room for it.
//!
//! C++ EXCEPTIONS END THE PROCESS. Rust cannot catch one, and llama.cpp throws
//! from a few places given bad input - so every count is checked here before
//! it reaches C++.

use std::num::NonZeroU32;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::context::LlamaContext;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaChatMessage, LlamaModel};
use llama_cpp_2::sampling::LlamaSampler;
use llama_cpp_2::token::LlamaToken;
use llama_cpp_2::{LlamaStateSeqFlags, LogOptions, SeqState};
use serde::Serialize;

use super::hardware::{Hardware, Sampler};
use super::prompt;

/// The most tokens a context is ever made for. A long note and a long
/// rewrite together; past this the page is told the note is too long.
pub const MAX_CONTEXT_TOKENS: u32 = 8192;

/// The most a caller may ask to generate in one run.
pub const MAX_OUTPUT_TOKENS: u32 = 4096;

/// Contexts are made in steps of this many tokens, so two notes of nearly the
/// same length share one context rather than remaking it.
const CONTEXT_STEP: u32 = 512;

/// The smallest context worth making.
const MIN_CONTEXT_TOKENS: u32 = 1024;

/// Prompt tokens decoded per `llama_decode` call. Small enough that
/// cancellation and the progress bar move within about a second on a phone
/// (llama-cpp-2 exposes no abort hook, so a call cannot be interrupted), large
/// enough that the matrix kernels still batch. Also the ubatch size, which
/// sizes the compute buffer: 128 keeps it far below the ~500 MB that 512 took.
const CHUNK: usize = 128;

/// How long a loaded model waits for another job before it is dropped.
pub const IDLE: Duration = Duration::from_secs(5 * 60);

/// Progress is reported at most this often, besides every change of phase.
/// Every report carries the whole text so far and becomes an IPC event and a
/// render; 120 ms is a word or two at a phone's pace.
const REPORT_EVERY: Duration = Duration::from_millis(120);

/// The sampling that keeps a rewrite faithful. Close to greedy: a rewrite has
/// few right answers and heat only adds ways to drift. A mild repeat penalty
/// over the recent window, because greedy decoding of a long answer is how a
/// small model falls into a loop.
const TOP_K: i32 = 40;
const TOP_P: f32 = 0.9;
const MIN_P: f32 = 0.05;
const REPEAT_LAST_N: i32 = 256;
const REPEAT_PENALTY: f32 = 1.05;
const SEED: u32 = 42;

/// One generation, as the page asks for it.
#[derive(Debug, Clone)]
pub struct Request {
    pub id: String,
    pub system: String,
    pub context: Option<String>,
    pub prompt: String,
    pub max_tokens: u32,
    /// 0 is greedy. The page sends 0.3 for a rewrite.
    pub temperature: f32,
    /// Leave reasoning on for a model whose template has it: no empty thought.
    pub think: bool,
    /// Thinking tokens before the thought is closed for the model (0: no limit).
    pub think_budget: u32,
    /// Native-owned constrained output, never accepted from an IPC request.
    pub grammar: Option<&'static str>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Output {
    pub text: String,
    pub prompt_tokens: u32,
    pub output_tokens: u32,
    /// Wall time for the whole run, load included.
    pub ms: u64,
    /// Prompt tokens restored from the prefix snapshot rather than decoded.
    pub cached_tokens: u32,
    pub prefill_ms: u64,
    pub load_ms: u64,
    /// Generation speed alone, tokens a second.
    pub tokens_per_second: f32,
    /// Stopped by `max_tokens` rather than by the model finishing.
    pub truncated: bool,
    /// The text starts with the model's reasoning, up to `</think>`: thinking
    /// was asked for and the model's template has it.
    pub thinking: bool,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Loading,
    Prefill,
    Generating,
    Done,
    Error,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub id: String,
    pub phase: Phase,
    pub prompt_tokens: u32,
    pub prompt_tokens_done: u32,
    pub output_tokens: u32,
    pub tokens_per_second: f32,
    pub elapsed_ms: u64,
    /// Everything written so far.
    pub partial: String,
    /// `partial` starts with reasoning (see `Output::thinking`).
    pub thinking: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    /// The phone under the model at this report (hardware.rs); None where it cannot be read.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hardware: Option<Hardware>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Failure {
    Cancelled,
    Error(String),
}

impl std::fmt::Display for Failure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Failure::Cancelled => f.write_str("cancelled"),
            Failure::Error(message) => f.write_str(message),
        }
    }
}

type ProgressFn = Box<dyn FnMut(Progress) + Send>;

struct Job {
    model: PathBuf,
    request: Request,
    cancel: Arc<AtomicBool>,
    progress: ProgressFn,
    reply: Sender<Result<Output, Failure>>,
}

enum Message {
    Run(Box<Job>),
    /// Drop the loaded model now rather than after [`IDLE`]: Settings is
    /// deleting its file, or the app wants the memory back.
    Unload,
    Shutdown,
}

/// The engine: a handle to the worker thread.
pub struct Llm {
    jobs: Sender<Message>,
    loaded: Arc<AtomicBool>,
    thread: Mutex<Option<JoinHandle<()>>>,
}

impl Llm {
    /// Starts the worker. Nothing is loaded until the first job.
    pub fn start() -> Llm {
        let (jobs, inbox) = mpsc::channel();
        let loaded = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&loaded);
        let thread = std::thread::Builder::new()
            .name("glyph-llm".into())
            .spawn(move || serve(inbox, flag))
            .expect("the OS starts a thread");
        Llm {
            jobs,
            loaded,
            thread: Mutex::new(Some(thread)),
        }
    }

    /// Queues a generation with the model at `model`, answering on the
    /// returned channel. Progress is delivered from the worker thread.
    pub fn generate(
        &self,
        model: &Path,
        request: Request,
        cancel: Arc<AtomicBool>,
        progress: impl FnMut(Progress) + Send + 'static,
    ) -> Receiver<Result<Output, Failure>> {
        let (reply, answer) = mpsc::channel();
        let job = Job {
            model: model.to_path_buf(),
            request,
            cancel,
            progress: Box::new(progress),
            reply,
        };
        if let Err(mpsc::SendError(Message::Run(job))) = self.jobs.send(Message::Run(Box::new(job))) {
            let _ = job.reply.send(Err(Failure::Error("the formatting engine has stopped".into())));
        }
        answer
    }

    /// Whether a model is in memory right now.
    pub fn loaded(&self) -> bool {
        self.loaded.load(Ordering::Relaxed)
    }

    /// Drops the loaded model after the job it is on (cancel that first).
    pub fn unload(&self) {
        let _ = self.jobs.send(Message::Unload);
    }

    /// Stops the worker after the job it is on, and waits for it. Cancel that
    /// job first (its flag) for this to be quick.
    pub fn shutdown(&self) {
        let _ = self.jobs.send(Message::Shutdown);
        let thread = self.thread.lock().unwrap_or_else(|p| p.into_inner()).take();
        if let Some(thread) = thread {
            let _ = thread.join();
        }
    }
}

/// llama.cpp's process-wide backend, initialised once and never freed:
/// `LlamaBackend::init` refuses a second call in the same process, and freeing
/// it while whisper shares its ggml would pull buffers from under a capture.
fn backend() -> Result<&'static LlamaBackend, String> {
    static BACKEND: OnceLock<Result<LlamaBackend, String>> = OnceLock::new();
    BACKEND
        .get_or_init(|| {
            // Silence llama.cpp's per-tensor load chatter. Failures still come
            // back as errors, which is where they are read.
            llama_cpp_2::send_logs_to_tracing(LogOptions::default().with_logs_enabled(false));
            LlamaBackend::init().map_err(|e| format!("cannot start llama.cpp: {e}"))
        })
        .as_ref()
        .map_err(Clone::clone)
}

/// How many cores generation uses. The emulator has four; the Fold has eight,
/// two of them small. Six keeps off the little cores and leaves one for the
/// page to stay responsive on.
fn threads() -> i32 {
    std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).clamp(2, 6) as i32
}

/// The prompt prefix already decoded, and the state that decoding left.
struct Snapshot {
    tokens: Vec<LlamaToken>,
    state: SeqState,
}

fn serve(inbox: Receiver<Message>, loaded: Arc<AtomicBool>) {
    let mut next: Option<Box<Job>> = None;
    loop {
        let mut job = match next.take() {
            Some(job) => job,
            None => match inbox.recv() {
                Ok(Message::Run(job)) => job,
                Ok(Message::Unload) => continue,
                Ok(Message::Shutdown) | Err(_) => return,
            },
        };

        let started = Instant::now();
        let mut report = Reporter::new(&job.request.id, started);
        report.send(&mut job.progress, Phase::Loading, Counts::default(), None);
        let loading = (|| -> Result<(&'static LlamaBackend, LlamaModel), String> {
            let backend = backend()?;
            let params = LlamaModelParams::default().with_n_gpu_layers(0);
            let model = LlamaModel::load_from_file(backend, &job.model, &params)
                .map_err(|e| format!("cannot load the model at {}: {e}", job.model.display()))?;
            Ok((backend, model))
        })();
        let (backend, model) = match loading {
            Ok(pair) => pair,
            Err(message) => {
                fail(job, &mut report, Failure::Error(message), Counts::default());
                continue;
            }
        };
        let load_ms = started.elapsed().as_millis() as u64;
        loaded.store(true, Ordering::Relaxed);

        let model_path = job.model.clone();
        // The context, made for the first job and remade when one needs more.
        let mut ctx: Option<LlamaContext<'_>> = None;
        let mut snapshot: Option<Snapshot> = None;
        let mut current = Some((job, report, started, load_ms));
        loop {
            let (mut job, mut report, started, load_ms) = match current.take() {
                Some(first) => first,
                None => match inbox.recv_timeout(IDLE) {
                    Ok(Message::Run(job)) if job.model != model_path => {
                        next = Some(job);
                        break;
                    }
                    Ok(Message::Run(job)) => {
                        let started = Instant::now();
                        let report = Reporter::new(&job.request.id, started);
                        (job, report, started, 0)
                    }
                    Ok(Message::Unload) | Err(RecvTimeoutError::Timeout) => break,
                    Ok(Message::Shutdown) | Err(RecvTimeoutError::Disconnected) => {
                        loaded.store(false, Ordering::Relaxed);
                        return;
                    }
                },
            };
            let mut counts = Counts::default();
            let result = generate(backend, &model, &mut ctx, &mut snapshot, &mut job, &mut report, &mut counts, started, load_ms);
            match result {
                Ok(output) => {
                    report.send(&mut job.progress, Phase::Done, counts, Some(output.text.clone()));
                    let _ = job.reply.send(Ok(output));
                }
                Err(failure) => fail(job, &mut report, failure, counts),
            }
        }
        loaded.store(false, Ordering::Relaxed);
        // `ctx` and then `model` drop here, in reverse order of declaration.
    }
}

fn fail(mut job: Box<Job>, report: &mut Reporter, failure: Failure, counts: Counts) {
    let phase = if failure == Failure::Cancelled { Phase::Cancelled } else { Phase::Error };
    report.message = Some(failure.to_string());
    report.send(&mut job.progress, phase, counts, None);
    let _ = job.reply.send(Err(failure));
}

#[derive(Debug, Clone, Copy, Default)]
struct Counts {
    /// Reasoning is on for this run and the stream begins with it.
    thinking: bool,
    prompt_tokens: u32,
    prompt_tokens_done: u32,
    output_tokens: u32,
    tokens_per_second: f32,
}

struct Reporter {
    id: String,
    started: Instant,
    last: Option<(Phase, Instant)>,
    message: Option<String>,
    /// The phone's readings, one per report.
    sampler: Sampler,
}

impl Reporter {
    fn new(id: &str, started: Instant) -> Reporter {
        Reporter {
            id: id.to_string(),
            started,
            last: None,
            message: None,
            sampler: Sampler::new(),
        }
    }

    /// Reports unless the same phase was reported under [`REPORT_EVERY`] ago.
    fn tick(&mut self, progress: &mut ProgressFn, phase: Phase, counts: Counts, partial: &str) {
        if let Some((last_phase, at)) = self.last {
            if last_phase == phase && at.elapsed() < REPORT_EVERY {
                return;
            }
        }
        self.send(progress, phase, counts, Some(partial.to_string()));
    }

    fn send(&mut self, progress: &mut ProgressFn, phase: Phase, counts: Counts, partial: Option<String>) {
        self.last = Some((phase, Instant::now()));
        progress(Progress {
            id: self.id.clone(),
            phase,
            prompt_tokens: counts.prompt_tokens,
            prompt_tokens_done: counts.prompt_tokens_done,
            output_tokens: counts.output_tokens,
            tokens_per_second: counts.tokens_per_second,
            elapsed_ms: self.started.elapsed().as_millis() as u64,
            partial: partial.unwrap_or_default(),
            thinking: counts.thinking,
            message: self.message.clone(),
            hardware: self.sampler.sample(threads() as u32),
        });
    }
}

/// The window a job needs: its prompt, the most it may write, a little slack,
/// rounded up to a step - capped by the model's own training window.
fn context_for(prompt_tokens: u32, max_tokens: u32, model: &LlamaModel) -> u32 {
    let need = prompt_tokens + max_tokens + 16;
    let stepped = need.div_ceil(CONTEXT_STEP) * CONTEXT_STEP;
    stepped.clamp(MIN_CONTEXT_TOKENS, MAX_CONTEXT_TOKENS.min(model.n_ctx_train().max(MIN_CONTEXT_TOKENS)))
}

#[allow(clippy::too_many_arguments)]
fn generate<'m>(
    backend: &'static LlamaBackend,
    model: &'m LlamaModel,
    ctx_slot: &mut Option<LlamaContext<'m>>,
    snapshot: &mut Option<Snapshot>,
    job: &mut Job,
    report: &mut Reporter,
    counts: &mut Counts,
    started: Instant,
    load_ms: u64,
) -> Result<Output, Failure> {
    let request = &job.request;
    let cancelled = || job.cancel.load(Ordering::Relaxed);
    let error = |what: &str, e: &dyn std::fmt::Display| Failure::Error(format!("{what}: {e}"));

    // Frame the conversation and tokenize the two halves separately, so the
    // prefix's tokens are the same run to run whatever the note is.
    let template = model.chat_template(None).map_err(|e| error("the model has no chat template", &e))?;
    let thinks = model
        .meta_val_str("tokenizer.chat_template")
        .map(|source| source.contains("<think>"))
        .unwrap_or(false);
    let messages = [
        LlamaChatMessage::new("system".into(), prompt::system_text(&request.system, request.context.as_deref()))
            .map_err(|e| error("the system prompt", &e))?,
        LlamaChatMessage::new("user".into(), prompt::SENTINEL.into()).map_err(|e| error("the note", &e))?,
    ];
    let rendered = model
        .apply_chat_template(&template, &messages, true)
        .map_err(|e| error("cannot apply the chat template", &e))?;
    // An empty thought switches reasoning off; a request that wants it gets none.
    let framed = prompt::frame(&rendered, thinks && !request.think).map_err(Failure::Error)?;
    counts.thinking = thinks && request.think;
    let prefix = model
        .str_to_token(&framed.prefix, AddBos::Never)
        .map_err(|e| error("cannot tokenize the prompt", &e))?;
    let rest = model
        .str_to_token(&format!("{}{}", request.prompt, framed.suffix), AddBos::Never)
        .map_err(|e| error("cannot tokenize the note", &e))?;

    let max_tokens = request.max_tokens.clamp(1, MAX_OUTPUT_TOKENS);
    counts.prompt_tokens = (prefix.len() + rest.len()) as u32;
    // A thought closed for the model adds its closing words to the window.
    let closing_room = if request.think && request.think_budget > 0 { 64 } else { 0 };
    let n_ctx = context_for(counts.prompt_tokens, max_tokens + closing_room, model);
    if counts.prompt_tokens + 64 > n_ctx {
        return Err(Failure::Error(format!(
            "This note is too long to format on the phone: {} tokens of prompt, and the window is {n_ctx}. Try a shorter note, or split it.",
            counts.prompt_tokens
        )));
    }
    // The most the model may write inside this window.
    let max_tokens = max_tokens.min(n_ctx - counts.prompt_tokens - 8 - closing_room);

    // A context that fits, made or remade.
    let remake = match ctx_slot.as_ref() {
        Some(ctx) => ctx.n_ctx() < n_ctx || (ctx.n_ctx() > n_ctx * 2 && ctx.n_ctx() > 2 * MIN_CONTEXT_TOKENS),
        None => true,
    };
    if remake {
        *ctx_slot = None;
        let params = LlamaContextParams::default()
            .with_n_ctx(NonZeroU32::new(n_ctx))
            .with_n_batch(CHUNK as u32)
            .with_n_ubatch(CHUNK as u32)
            .with_n_threads(threads())
            .with_n_threads_batch(threads());
        let ctx = model
            .new_context(backend, params)
            .map_err(|e| error(&format!("cannot make a {n_ctx}-token context"), &e))?;
        *ctx_slot = Some(ctx);
    }
    let ctx = ctx_slot.as_mut().expect("a context was just ensured");

    // Prefill: the immutable system/template prefix from its snapshot when it
    // matches, else decoded and snapshotted; then the per-job user remainder.
    // This clear is the session boundary: generated tokens and the previous
    // request's user text leave the live KV before any snapshot is restored.
    // The snapshot is captured before `rest`, so it cannot contain an earlier
    // utterance (prompt.rs tests that boundary).
    let prefill_started = Instant::now();
    ctx.clear_kv_cache();
    let mut batch = LlamaBatch::new(CHUNK, 1);
    let mut cached_tokens = 0;
    let restored = match snapshot.as_ref() {
        Some(saved) if saved.tokens == prefix => ctx.state_seq_set(&saved.state, 0).is_ok(),
        _ => false,
    };
    if restored {
        cached_tokens = prefix.len() as u32;
        counts.prompt_tokens_done = cached_tokens;
    } else {
        *snapshot = None;
        ctx.clear_kv_cache();
        decode_prompt(ctx, &mut batch, &prefix, 0, false, &job.cancel, &mut job.progress, report, counts, prefill_started)?;
        if let Ok(state) = ctx.state_seq_get(0, LlamaStateSeqFlags::empty()) {
            *snapshot = Some(Snapshot { tokens: prefix.clone(), state });
        }
    }
    decode_prompt(ctx, &mut batch, &rest, prefix.len(), true, &job.cancel, &mut job.progress, report, counts, prefill_started)?;
    let prefill_ms = prefill_started.elapsed().as_millis() as u64;

    // Generate. A command grammar is compiled from this binary's allowlist,
    // never from web input. Free-form formatting keeps its existing sampler.
    let mut sampler = if let Some(grammar) = request.grammar {
        let grammar = LlamaSampler::grammar(model, grammar, "root")
            .map_err(|e| error("cannot compile the command grammar", &e))?;
        LlamaSampler::chain_simple([grammar, LlamaSampler::greedy()])
    } else if request.temperature <= 0.0 {
        LlamaSampler::chain_simple([
            LlamaSampler::penalties(model.n_vocab(), REPEAT_LAST_N, REPEAT_PENALTY, 0.0, 0.0),
            LlamaSampler::greedy(),
        ])
    } else {
        LlamaSampler::chain_simple([
            LlamaSampler::penalties(model.n_vocab(), REPEAT_LAST_N, REPEAT_PENALTY, 0.0, 0.0),
            LlamaSampler::top_k(TOP_K),
            LlamaSampler::top_p(TOP_P, 1),
            LlamaSampler::min_p(MIN_P, 1),
            LlamaSampler::temp(request.temperature),
            LlamaSampler::dist(SEED),
        ])
    };
    let generate_started = Instant::now();
    let mut decoder = encoding_rs::UTF_8.new_decoder();
    let mut text = String::new();
    let mut logits_at = batch.n_tokens() - 1;
    let mut position = (prefix.len() + rest.len()) as i32;
    let mut truncated = false;
    // Still inside the thought (only when thinking is on), and whether it was closed for the model.
    let mut in_thought = counts.thinking;
    counts.tokens_per_second = 0.0;
    report.send(&mut job.progress, Phase::Generating, *counts, Some(String::new()));
    loop {
        if cancelled() {
            return Err(Failure::Cancelled);
        }
        if counts.output_tokens >= max_tokens {
            truncated = true;
            break;
        }
        let token = sampler.sample(ctx, logits_at);
        if model.is_eog_token(token) {
            break;
        }
        let piece = model
            .token_to_piece(token, &mut decoder, false, None)
            .map_err(|e| error("cannot decode a token", &e))?;
        text.push_str(&piece);
        counts.output_tokens += 1;
        counts.tokens_per_second = counts.output_tokens as f32 / generate_started.elapsed().as_secs_f32().max(1e-3);
        report.tick(&mut job.progress, Phase::Generating, *counts, &text);
        if in_thought && text.contains("</think>") {
            in_thought = false;
        }

        batch.clear();
        batch.add(token, position, &[0], true).map_err(|e| error("cannot queue a token", &e))?;
        position += 1;
        // A thought past its budget is closed in the model's own voice, and the
        // answer is sampled after the close as if the model had written it.
        let over_budget = in_thought && request.think_budget > 0 && counts.output_tokens >= request.think_budget;
        if over_budget {
            in_thought = false;
            let cutoff = model
                .str_to_token(prompt::THOUGHT_CUTOFF, AddBos::Never)
                .map_err(|e| error("cannot tokenize the thought's close", &e))?;
            for (i, closing) in cutoff.iter().enumerate() {
                batch.add(*closing, position, &[0], i + 1 == cutoff.len()).map_err(|e| error("cannot queue a token", &e))?;
                position += 1;
            }
            text.push_str(prompt::THOUGHT_CUTOFF);
        }
        ctx.decode(&mut batch).map_err(|e| error("decoding failed", &e))?;
        logits_at = batch.n_tokens() - 1;
    }

    Ok(Output {
        text,
        prompt_tokens: counts.prompt_tokens,
        output_tokens: counts.output_tokens,
        ms: started.elapsed().as_millis() as u64,
        cached_tokens,
        prefill_ms,
        load_ms,
        tokens_per_second: counts.tokens_per_second,
        truncated,
        thinking: counts.thinking,
    })
}

#[allow(clippy::too_many_arguments)]
fn decode_prompt(
    ctx: &mut LlamaContext<'_>,
    batch: &mut LlamaBatch,
    tokens: &[LlamaToken],
    offset: usize,
    logits_for_last: bool,
    cancel: &AtomicBool,
    progress: &mut ProgressFn,
    report: &mut Reporter,
    counts: &mut Counts,
    prefill_started: Instant,
) -> Result<(), Failure> {
    for (index, chunk) in tokens.chunks(CHUNK).enumerate() {
        if cancel.load(Ordering::Relaxed) {
            return Err(Failure::Cancelled);
        }
        batch.clear();
        let base = offset + index * CHUNK;
        let last_chunk = (index + 1) * CHUNK >= tokens.len();
        for (i, token) in chunk.iter().enumerate() {
            let logits = logits_for_last && last_chunk && i + 1 == chunk.len();
            batch
                .add(*token, (base + i) as i32, &[0], logits)
                .map_err(|e| Failure::Error(format!("cannot queue the prompt: {e}")))?;
        }
        ctx.decode(batch).map_err(|e| Failure::Error(format!("prefill failed: {e}")))?;
        counts.prompt_tokens_done += chunk.len() as u32;
        counts.tokens_per_second = counts.prompt_tokens_done as f32 / prefill_started.elapsed().as_secs_f32().max(1e-3);
        report.tick(progress, Phase::Prefill, *counts, "");
    }
    Ok(())
}
