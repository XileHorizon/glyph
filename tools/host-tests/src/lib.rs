//! Runs the tauri-free modules' unit tests on a plain Linux host.
//!
//! WHY THIS EXISTS. `cargo test --lib` in src-tauri/ builds the whole crate,
//! and the whole crate pulls the desktop windowing stack: tauri ->
//! tauri-runtime-wry -> tao -> dbus -> libdbus-sys, whose build script needs
//! dbus-1.pc and the dbus headers. It also builds llama.cpp and whisper.cpp,
//! several minutes of C++ for tests that never load a model. On a machine
//! without libdbus-1-dev the build fails before a single test runs - which is
//! how `store::tests` and `llm::command::tests` came to be unverifiable on
//! Kevin's box (2026-09-15), even though neither module has a `tauri::` type in
//! it and neither links llama.cpp.
//!
//! `store.rs`, `library/mod.rs`, and `llm/command.rs` stay free of Tauri types;
//! the active 1.6.0 persistence contract lives in `library/mod.rs`. Those modules
//! contain no `tauri::` type, on purpose: the capture process runs them with no
//! webview around. That promise is what makes this harness possible, and
//! running it is what keeps the promise honest - if someone adds a `tauri::`
//! type or a llama.cpp call to either file, this crate stops compiling.
//!
//! `#[path]` points at the REAL files in src-tauri/src. Nothing is copied, so
//! there is no second version to drift.
//!
//! HOW TO RUN:
//!
//! ```sh
//! cd tools/host-tests && cargo test
//! ```
//!
//! WHAT THIS DOES NOT COVER: every module that does touch tauri, whisper or
//! llama.cpp - ai_commands.rs, commands.rs, llm/engine.rs. Those still need a
//! full `cargo test --lib` in src-tauri/ on a machine with libdbus-1-dev and
//! the clang headers, and the on-device work needs a phone. See
//! docs/instruction-voice-commands.md.

// Both are declared at the top level so each `#[path]` resolves against src/,
// one predictable base. A nested `mod llm { .. }` would resolve its inner path
// against src/llm/ instead, a directory that does not exist here.
#[path = "../../../src-tauri/src/store.rs"]
pub mod store;

#[path = "../../../src-tauri/src/library/mod.rs"]
pub mod library;

#[path = "../../../src-tauri/src/llm/command.rs"]
pub mod command;

#[path = "../../../src-tauri/src/llm/prompt.rs"]
pub mod prompt;
