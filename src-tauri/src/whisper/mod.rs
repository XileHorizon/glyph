//! Speech to text on the device, and NOT ONE `tauri::` TYPE IN THIS MODULE.
//!
//! The page owns the microphone: it captures in the webview and pushes raw PCM
//! across. `capture_commands.rs` owns the seam that PCM arrives through and the
//! events that go back out. `store.rs` owns what a transcript becomes once it
//! is a note. This module owns the part in between - turning a stream of
//! samples into text a phrase at a time - and, like `store.rs`, it knows
//! nothing about the process it is running in, for the same reason: the
//! Android side-key capture (DESIGN section 6.1) runs in a process with no
//! Tauri in it and will drive this over JNI. Everything here takes plain
//! slices, paths and callbacks.
//!
//! The rooms, in the order audio passes through them:
//!
//! - `vad` decides which 20 ms frames are somebody talking. Energy against an
//!   adaptive floor, nothing cleverer, because its only jobs are finding pauses
//!   and keeping silence away from a model that hallucinates on it.
//! - `stream` is the streaming core: a synchronous, deterministic state machine
//!   (`feed` samples, `tick` for events) with no threads and no clock in it.
//!   Every decision it makes is a function of the audio, so the tests can drive
//!   it with a fixture and get the same answer every run.
//! - `text` scrubs what whisper says about non-speech, builds the prompt (cue
//!   vocabulary plus committed tail) and removes the vocabulary if it echoes.
//! - `engine` is whisper.cpp itself: the loaded model, and a per-capture
//!   `Session` that implements `stream::Transcribe`.
//! - `worker` is the thin thread that drives a `Streamer` on a timer, so that
//!   pushing audio never waits for inference.
//! - `model` is the catalogue of model files, their pinned hashes, and the
//!   download.
//! - `wav` reads a WAV file, for whole-file benchmarking and the tests.
//!
//! Errors cross this module as `String`, not as an enum like `StoreError`, and
//! that is a measured choice rather than a lazy one: every error path out of
//! here ends as a sentence in a `capture://error` event or a rejected
//! `invoke`, and no caller - the command layer, the worker, the JNI path -
//! does anything with a failed transcription except say so. `StoreError`
//! keeps its `rusqlite::Error` because retrying a busy database is worth
//! something; retrying a model that could not decode a window is not.
//!
//! iOS compiles the pure half (`vad`, `stream`, `text`, `wav`, the model
//! catalogue) and none of whisper.cpp: capture there goes to Apple's
//! SpeechTranscriber (DESIGN section 6.3), and Cargo.toml does not build
//! whisper-rs or the HTTP client for that target at all.

pub mod model;
pub mod stream;
pub mod text;
pub mod vad;
pub mod wav;

#[cfg(not(target_os = "ios"))]
pub mod engine;
#[cfg(not(target_os = "ios"))]
pub mod worker;

#[cfg(all(test, not(target_os = "ios")))]
mod tests;
#[cfg(all(test, target_os = "macos"))]
mod suite;

/// The only sample rate anything in this module accepts: 16 kHz mono, which is
/// what whisper was trained on and what its mel front end assumes.
///
/// Resampling is deliberately the CALLER's job. The webview asks the browser
/// for 16 kHz and the Android `AudioRecord` opens at 16 kHz, so both sources
/// already agree, and a resampler in here would be code that exists to handle
/// a mistake somebody else should not make.
pub const SAMPLE_RATE: usize = 16_000;

/// Samples to whole milliseconds, which is the unit every event carries.
pub fn samples_to_ms(samples: usize) -> u64 {
    (samples as u64 * 1_000) / SAMPLE_RATE as u64
}

/// Milliseconds to samples, for the constants that are easier to read in time.
pub const fn ms_to_samples(ms: u64) -> usize {
    (ms as usize * SAMPLE_RATE) / 1_000
}
