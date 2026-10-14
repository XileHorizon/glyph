//! The voice test suite's audio (voice-tests/suite.json), heard the way the phone hears it.
//!
//! Each recording in `~/Desktop/glyph-voice-tests` (or `GLYPH_VOICE_DIR`) is converted to 16 kHz mono with macOS's
//! `afconvert`, streamed through the same `Streamer` and model the recorder uses in quarter-second chunks, and what
//! was committed is written to `.heard/<name>.json` beside it: the phrases with their times, and the length of the
//! audio. The page's side of the suite (src/app/capture/voiceSuite.test.ts) replays those phrases through the
//! recorder's logic and checks the notes.
//!
//! Ignored, because it needs the recordings and takes a while. Run it with `npm run voice:suite`, or:
//!
//! `cargo test --release whisper::suite -- --ignored --nocapture`

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use serde::Serialize;

use super::engine::{Engine, Session};
use super::model;
use super::stream::{Event, Segment, Streamer};
use super::{ms_to_samples, samples_to_ms, wav};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Heard {
    segments: Vec<Segment>,
    audio_ms: u64,
}

fn voice_dir() -> PathBuf {
    std::env::var_os("GLYPH_VOICE_DIR").map(PathBuf::from).unwrap_or_else(|| {
        let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
        home.join("Desktop").join("glyph-voice-tests")
    })
}

fn models_dir() -> PathBuf {
    std::env::var_os("GLYPH_MODELS_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("models"))
}

/// The recording as 16 kHz mono samples, converted beside it in a temporary file.
fn samples(audio: &Path) -> Result<Vec<f32>, String> {
    let wav_path = std::env::temp_dir().join(format!("glyph-suite-{}.wav", uuid::Uuid::new_v4()));
    let converted = Command::new("afconvert")
        .args(["-f", "WAVE", "-d", "LEI16@16000", "-c", "1"])
        .arg(audio)
        .arg(&wav_path)
        .status()
        .map_err(|e| format!("afconvert: {e}"))?;
    if !converted.success() {
        return Err(format!("afconvert could not read {}", audio.display()));
    }
    let read = wav::read(&wav_path);
    let _ = std::fs::remove_file(&wav_path);
    read
}

/// What the streaming recorder commits for `audio`, as the phone would.
fn hear(engine: &Arc<Engine>, audio: &[f32]) -> Result<Vec<Segment>, String> {
    let session = Session::new(Arc::clone(engine), Arc::new(AtomicBool::new(false)))?;
    let mut streamer = Streamer::new(session);
    let mut committed = Vec::new();
    let mut take = |events: Vec<Event>| -> Result<(), String> {
        for event in events {
            match event {
                Event::Segment(segment) => committed.push(segment),
                Event::Error(failure) => return Err(failure.message),
                _ => {}
            }
        }
        Ok(())
    };
    for chunk in audio.chunks(ms_to_samples(250)) {
        streamer.feed(chunk);
        take(streamer.tick()?)?;
    }
    take(streamer.finish()?)?;
    Ok(committed)
}

#[test]
#[ignore]
fn hear_every_recording() {
    let dir = voice_dir();
    let status = model::status(&models_dir(), &model::BASE_EN_Q5_1);
    assert!(status.present, "{} is not in {} - run `npm run fetch:model`", model::BASE_EN_Q5_1.file, models_dir().display());
    let engine = Arc::new(Engine::load(Path::new(&status.path)).expect("the model loads"));
    let out = dir.join(".heard");
    std::fs::create_dir_all(&out).expect("the .heard folder can be made");
    let only = std::env::var("GLYPH_VOICE_ONLY").ok();
    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("no recordings in {}: {e}", dir.display()))
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .filter(|path| matches!(path.extension().and_then(|e| e.to_str()), Some("mp3" | "wav" | "m4a" | "aiff")))
        .filter(|path| {
            let name = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
            name.len() > 4 && name.as_bytes()[..3].iter().all(u8::is_ascii_digit) && only.as_deref().is_none_or(|o| name.starts_with(o))
        })
        .collect();
    files.sort();
    assert!(!files.is_empty(), "no numbered recordings in {}", dir.display());
    for path in files {
        let name = path.file_stem().and_then(|s| s.to_str()).unwrap_or_default().to_string();
        let audio = match samples(&path) {
            Ok(audio) => audio,
            Err(e) => {
                eprintln!("{name}: {e}");
                continue;
            }
        };
        // Four seconds of quiet after the file, as a recorder left running would hear before Done.
        let mut padded = audio.clone();
        padded.extend(std::iter::repeat_n(0.0f32, ms_to_samples(4000)));
        let segments = hear(&engine, &padded).unwrap_or_else(|e| panic!("{name}: {e}"));
        eprintln!("{name}: {}", segments.iter().map(|s| format!("[{}-{}] {}", s.start_ms, s.end_ms, s.text)).collect::<Vec<_>>().join(" | "));
        let heard = Heard { segments, audio_ms: samples_to_ms(audio.len()) };
        std::fs::write(out.join(format!("{name}.json")), serde_json::to_string_pretty(&heard).unwrap()).expect("written");
    }
}
