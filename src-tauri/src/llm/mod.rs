//! The language model that formats notes ON THE PHONE, and NOT ONE `tauri::`
//! TYPE IN THIS MODULE - the same rule as `whisper`, for the same reason: the
//! engine is plain threads, paths and callbacks, and `ai_commands.rs` is the
//! only place that knows it is inside an app.
//!
//! Matt's direction (2026-09-13): "everything on here will be on device". The
//! model reads a note and writes it again - expanded, reorganised, formatted
//! as markdown - and the page shows the words as they arrive, so a person
//! watches the note change shape. Accuracy over speed: a bigger model taking a
//! minute is the trade he asked for. So what this module has to be good at is
//! a LONG answer to a long prompt on a phone CPU, streamed:
//!
//! - Generation is the cost. A rewrite is as long as the note, or longer, so
//!   every token arrives at whatever the phone's cores manage (measured on the
//!   Fold once it ships; 44 a second for Qwen3.5 2B on four Apple-silicon
//!   cores). The page is told about every ~120 ms with the text so far.
//! - The prompt prefix - the fixed instructions - is snapshotted after its
//!   first prefill and restored on every later run with the same prefix, so
//!   only the note's own tokens are paid for each time.
//! - The context is sized to the job, not to a maximum: a KV cache for 8,192
//!   tokens on a 9B model is over a gigabyte, and most notes need a quarter.
//!
//! The rooms:
//!
//! - `model` is the catalogue: which GGUFs, their pinned SHA-256s, where they
//!   come from. The download itself is whisper's (`whisper::model::fetch`),
//!   which takes any `ModelSpec`.
//! - `prompt` frames a request in the model's chat template with no model
//!   loaded, so its rules are unit tests.
//! - `device` reads what the phone has (memory, cores, chip, disk) so the
//!   page can judge which models fit.
//! - `engine` owns llama.cpp: one worker thread holding the model and its
//!   context, a queue of generations, progress callbacks, cancellation.
//!
//! ONE GGML. llama.cpp and whisper.cpp both vendor ggml, at different versions,
//! under the same library names, and two copies in one .so link without error
//! and crash at run time (measured: SIGBUS on Qwen3.5's first decode). Glyph
//! builds whisper.cpp against llama-cpp-sys-2's ggml; see the whisper-rs-sys
//! patch in Cargo.toml.

pub mod command;
pub mod device;
pub mod hardware;
pub mod model;
pub mod prompt;

#[cfg(not(target_os = "ios"))]
pub mod engine;

#[cfg(all(test, not(target_os = "ios")))]
mod tests;
