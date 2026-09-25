//! Live dictation as a state machine: samples in, partial and committed text
//! out, and no threads, no clock and no model in sight.
//!
//! `worker.rs` owns the thread and the timer, `engine.rs` owns whisper.cpp,
//! and the page owns what the words look like. This module owns every DECISION
//! in between: when a window is worth transcribing, when a phrase is finished,
//! where to cut it, and what the person is shown in the meantime. Those are the
//! parts that are easy to get subtly wrong and impossible to see going wrong on
//! a phone, so they live where a test can drive them one 250 ms chunk at a
//! time and get the same events every run.
//!
//! The shape is whisper.cpp's `stream` example - re-transcribe the uncommitted
//! audio every so often and show it as a guess; commit it when the speaker
//! pauses - with one change that is the reason this is a state machine at all.
//! In the example, and in the brief this was written from, "is there a pause?"
//! is asked of the trailing 600 ms at the moment the timer fires. That makes
//! the transcript depend on WHEN the timer fired: an inference that runs long
//! on a busy phone lets two seconds of audio pile up, a pause in the middle of
//! them is never trailing when anyone looks, and the phrase either side of it
//! is committed as one. Here every 20 ms frame is classified as it is FED, a
//! pause is recorded as a cut at the moment it happens in the audio, and `tick`
//! commits whatever cuts are waiting. Commits are a function of the audio
//! alone. Only partials depend on timing, and a partial is a guess by
//! definition.
//!
//! The rules, each with its constant below:
//!
//! - A PAUSE of 600 ms after at least 1.5 s of speech cuts a phrase. So does a
//!   pause of 1.2 s after any speech at all, so that "buy milk", said and then
//!   left alone, is committed rather than re-transcribed until the 20 s cap.
//! - The cut goes in the MIDDLE of the pause, not at its end: the committed
//!   window keeps 300 ms of trailing quiet (a soft final consonant below the
//!   threshold stays with its word) and the next window starts with 300 ms of
//!   lead-in.
//! - Twenty seconds without a pause forces a cut, at the quietest 200 ms of the
//!   last four. Whisper's window is 30 s and a window near it is slow to
//!   decode, and the quietest moment is the least likely to be inside a word.
//! - Audio with no speech in it is dropped after two seconds, keeping 300 ms,
//!   and is NEVER sent to the model. Whisper hallucinates on silence, and the
//!   only reliable defence is not asking.
//! - A partial runs when at least 1 s of uncommitted audio holds speech, 700 ms
//!   of new audio has arrived since the last one, and some of that new audio
//!   was speech. The last condition is what stops a speaker who has gone quiet
//!   from costing an inference every 700 ms to learn nothing new.
//! - Committed text only changes by REWIND. The person can wind the tape back
//!   to any moment and talk over it: every segment that ends after that moment
//!   is dropped, the audio between the last kept segment and the moment is
//!   transcribed again, and what is said next continues from there. So the
//!   whole recording is kept (as 16-bit PCM, ~1.9 MB a minute), not just the
//!   uncommitted window - without it there is nothing to re-transcribe.

use std::collections::VecDeque;

use serde::Serialize;

use super::vad::{self, Vad, FRAME};
use super::{ms_to_samples, samples_to_ms, text};

/// A phrase is finished when this much quiet follows it...
const PAUSE: usize = ms_to_samples(600);
/// ...provided at least this much speech came before the quiet.
const MIN_SPEECH: usize = ms_to_samples(1_500);
/// Quiet this long finishes ANY phrase, however short.
const LONG_PAUSE: usize = ms_to_samples(1_200);
/// Uncommitted audio never grows past this without a cut.
const FORCE_COMMIT: usize = ms_to_samples(20_000);
/// How far back from the force point to look for somewhere quiet to cut.
const FORCE_SEARCH: usize = ms_to_samples(4_000);
/// The quiet stretch a forced cut is centred in.
const FORCE_QUIET: usize = ms_to_samples(200);
/// Audio with no speech in it is dropped once it reaches this...
const SILENCE_DROP: usize = ms_to_samples(2_000);
/// ...keeping this much, as lead-in for whatever is said next.
const SILENCE_KEEP: usize = ms_to_samples(300);
/// The least uncommitted audio a partial is run on.
const PARTIAL_MIN: usize = ms_to_samples(1_000);
/// New audio between one partial and the next.
const PARTIAL_STEP: usize = ms_to_samples(700);
/// The longest window ever handed to the model: whisper's 30 s, less margin.
const WINDOW_CAP: usize = ms_to_samples(28_000);
/// How much committed text rides along as the prompt, after the cue
/// vocabulary. See `text::prompt`.
const PROMPT_CHARS: usize = 200;
/// Consecutive voiced frames before the VAD's opinion counts as speech: 40 ms.
/// One loud frame is a click, a tap on the glass, a key; no syllable is that
/// short.
const ONSET_FRAMES: usize = 2;

/// Which kind of inference a window is for. The engine tunes for speed on one
/// and for accuracy on the other; see `engine::Session`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Pass {
    /// A guess at uncommitted audio that will be superseded within a second.
    Partial,
    /// The text that will stand.
    Commit,
}

/// Anything that turns a window of 16 kHz mono audio into text.
///
/// A trait so that the state machine can be tested with a transcriber that
/// counts its calls and never loads a model - which is how the silence rule is
/// proved to send NOTHING to the model, rather than merely to hide what came
/// back.
pub trait Transcribe {
    fn transcribe(&mut self, audio: &[f32], prompt: &str, pass: Pass) -> Result<String, String>;
}

/// The best current guess at the uncommitted audio. Each one REPLACES the one
/// before; an empty `text` clears it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Partial {
    pub text: String,
}

/// Committed text. Revised only by a rewind, which drops whole segments. Times
/// are from the start of the capture on the recording's own timeline, and
/// consecutive segments never overlap.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub text: String,
    pub start_ms: u64,
    pub end_ms: u64,
}

/// Something failed and the capture has stopped transcribing. Never produced
/// by `Streamer` itself - its failures are `Err`s - but by the worker that
/// drives it, so the page has one stream of events to listen to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Failure {
    pub message: String,
}

/// The tape was wound back to `to_ms`. `segments` is EVERY committed segment
/// that still stands, in order - the page replaces its list with it rather
/// than counting, so a segment whose event was lost to an aborted tick cannot
/// leave the two sides disagreeing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rewound {
    pub to_ms: u64,
    pub segments: Vec<Segment>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    Partial(Partial),
    Segment(Segment),
    Rewound(Rewound),
    Error(Failure),
}

/// A committed segment and the exact sample its audio ends on. `Segment`'s
/// times are rounded to milliseconds; a rewind has to cut on the sample.
#[derive(Debug, Clone)]
struct Committed {
    segment: Segment,
    end: usize,
}

/// A decided cut: everything before `at` (an absolute sample index) is a
/// finished window. `speech` is false for a window that is only being dropped.
#[derive(Debug, Clone, Copy)]
struct Cut {
    at: usize,
    speech: bool,
}

/// One capture's worth of state. Create one per press of the side key.
pub struct Streamer<T: Transcribe> {
    transcriber: T,
    vad: Vad,

    /// The uncommitted audio. `audio[0]` is absolute sample `base`.
    audio: Vec<f32>,
    /// Per-frame RMS for every classified frame of `audio`, for finding the
    /// quietest place to force a cut.
    energy: Vec<f32>,
    base: usize,

    /// Absolute sample index up to which frames have been classified. Always
    /// a whole number of frames.
    classified: usize,
    /// Where the window being accumulated by the VAD starts: `base`, or the
    /// last cut decided but not yet committed.
    span_start: usize,
    /// Start of the first speech in that window, if there has been any.
    first_speech: Option<usize>,
    /// End of the most recent speech frame.
    last_speech_end: usize,
    voiced_streak: usize,
    quiet_run: usize,
    cuts: VecDeque<Cut>,

    /// End of the audio the last partial covered.
    partial_end: usize,
    /// Whether speech has been classified since that partial ran.
    speech_since_partial: bool,
    /// Whether the page is currently showing non-empty partial text.
    showing_partial: bool,

    committed: Vec<Committed>,
    /// Every sample fed since the capture began, sample 0 first, as 16-bit PCM.
    recording: Vec<i16>,
}

impl<T: Transcribe> Streamer<T> {
    pub fn new(transcriber: T) -> Streamer<T> {
        Streamer {
            transcriber,
            vad: Vad::new(),
            audio: Vec::new(),
            energy: Vec::new(),
            base: 0,
            classified: 0,
            span_start: 0,
            first_speech: None,
            last_speech_end: 0,
            voiced_streak: 0,
            quiet_run: 0,
            cuts: VecDeque::new(),
            partial_end: 0,
            speech_since_partial: false,
            showing_partial: false,
            committed: Vec::new(),
            recording: Vec::new(),
        }
    }

    /// Appends audio and classifies every whole frame of it. Never transcribes.
    ///
    /// This is where pauses are found and cuts are decided - see the module
    /// header for why that happens here and not in `tick`.
    pub fn feed(&mut self, samples: &[f32]) {
        self.recording.extend(samples.iter().map(|&s| to_pcm(s)));
        self.take_in(samples);
    }

    /// Adds audio to the uncommitted window and classifies it, without
    /// recording it: `feed` for new audio, and a rewind for audio re-heard.
    fn take_in(&mut self, samples: &[f32]) {
        self.audio.extend_from_slice(samples);
        let end = self.base + self.audio.len();
        while self.classified + FRAME <= end {
            let from = self.classified - self.base;
            let (voiced, rms) = self.vad.frame(&self.audio[from..from + FRAME]);
            self.energy.push(rms);
            let frame_start = self.classified;
            self.classified += FRAME;
            self.classify(frame_start, voiced);
        }
    }

    fn classify(&mut self, frame_start: usize, voiced: bool) {
        self.voiced_streak = if voiced { self.voiced_streak + 1 } else { 0 };
        if self.voiced_streak >= ONSET_FRAMES {
            if self.first_speech.is_none() {
                // The onset began with the first frame of the streak, which
                // was provisionally counted as quiet.
                let onset = frame_start - (ONSET_FRAMES - 1) * FRAME;
                self.first_speech = Some(onset.max(self.span_start));
            }
            self.last_speech_end = self.classified;
            self.quiet_run = 0;
            self.speech_since_partial = true;
        } else {
            self.quiet_run += FRAME;
        }

        let now = self.classified;
        match self.first_speech {
            Some(first) => {
                let speech = self.last_speech_end - first;
                let paused = (self.quiet_run >= PAUSE && speech >= MIN_SPEECH)
                    || self.quiet_run >= LONG_PAUSE;
                if paused {
                    self.decide(self.last_speech_end + PAUSE / 2, true);
                } else if now - self.span_start >= FORCE_COMMIT {
                    let at = self.quietest_cut(now);
                    self.decide(at, true);
                    // Speech after the forced cut starts the next window's
                    // count; the cut is mid-speech by definition.
                    if self.last_speech_end > at {
                        self.first_speech = Some(at);
                    }
                }
            }
            None if now - self.span_start >= SILENCE_DROP => {
                self.decide(now - SILENCE_KEEP, false);
            }
            None => {}
        }
    }

    fn decide(&mut self, at: usize, speech: bool) {
        self.cuts.push_back(Cut { at, speech });
        self.span_start = at;
        self.first_speech = None;
    }

    /// The middle of the quietest `FORCE_QUIET` in the last `FORCE_SEARCH`
    /// before `now`, on a frame boundary.
    fn quietest_cut(&self, now: usize) -> usize {
        let window = FORCE_QUIET / FRAME;
        let first_frame = (now - FORCE_SEARCH - self.base) / FRAME;
        let last_frame = (now - self.base) / FRAME - window;
        let mut best = (f32::INFINITY, first_frame);
        let mut sum: f32 = self.energy[first_frame..first_frame + window].iter().sum();
        for start in first_frame..=last_frame {
            if start > first_frame {
                sum += self.energy[start + window - 1] - self.energy[start - 1];
            }
            if sum < best.0 {
                best = (sum, start);
            }
        }
        self.base + (best.1 + window / 2) * FRAME
    }

    /// Does whatever inference is due: every decided cut is committed, then a
    /// partial if one is warranted. Returns the events in the order the page
    /// should apply them.
    ///
    /// Cheap when nothing is due, so the worker can call it on a short timer.
    /// When it is not cheap it is exactly one inference per decided cut plus
    /// at most one partial, and it does not return until they are done.
    pub fn tick(&mut self) -> Result<Vec<Event>, String> {
        let mut events = Vec::new();
        let committed_any = self.commit_decided(&mut events)?;
        let partial_ran = self.maybe_partial(&mut events)?;
        if committed_any && !partial_ran {
            self.clear_partial(&mut events);
        }
        Ok(events)
    }

    /// Commits everything left, including the audio after the last cut, and
    /// clears the partial. What a press of Stop runs.
    ///
    /// The final window is transcribed only if it holds speech - the silence
    /// rule does not relax because the person has stopped talking.
    pub fn finish(&mut self) -> Result<Vec<Event>, String> {
        let mut events = Vec::new();
        self.commit_decided(&mut events)?;
        let end = self.base + self.audio.len();
        if end > self.base {
            let speech = self.first_speech.is_some();
            self.commit(Cut { at: end, speech }, &mut events)?;
        }
        self.clear_partial(&mut events);
        Ok(events)
    }

    /// Everything committed so far, as one string.
    pub fn transcript(&self) -> String {
        self.committed
            .iter()
            .map(|c| c.segment.text.as_str())
            .collect::<Vec<_>>()
            .join(" ")
    }

    /// Winds the tape back to `to_ms` so what is said next records over what
    /// came after it.
    ///
    /// Segments are dropped WHOLE: one that ends after the moment is gone, and
    /// the audio from the last segment that stands up to the moment goes back
    /// into the uncommitted window, to be transcribed again as the start of
    /// whatever is said next. Cutting a segment's text mid-way would mean
    /// guessing which words were said before the moment, and whisper's word
    /// times are not good enough to guess with.
    ///
    /// The window state is rebuilt at that segment's end, as though the
    /// capture had just committed it, and the VAD is primed with the few
    /// seconds before it so its noise floor matches the room rather than
    /// starting from nothing. A moment past the end of the recording is the end
    /// of the recording. Never transcribes.
    pub fn rewind(&mut self, to_ms: u64) -> Vec<Event> {
        let mut events = Vec::new();
        let to = ms_to_samples(to_ms).min(self.recording.len()) / FRAME * FRAME;
        let kept = self.committed.iter().take_while(|c| c.end <= to).count();
        self.committed.truncate(kept);
        let from = self.committed.last().map_or(0, |c| c.end);
        self.recording.truncate(to);
        self.clear_partial(&mut events);

        self.vad = Vad::new();
        let prime_from = from.saturating_sub(vad::MEMORY) / FRAME * FRAME;
        self.vad.prime(&from_pcm(&self.recording[prime_from..from]));
        self.audio.clear();
        self.energy.clear();
        self.base = from;
        self.classified = from;
        self.span_start = from;
        self.first_speech = None;
        self.last_speech_end = from;
        self.voiced_streak = 0;
        self.quiet_run = 0;
        self.cuts.clear();
        self.partial_end = from;
        self.speech_since_partial = false;
        let again = from_pcm(&self.recording[from..to]);
        self.take_in(&again);

        events.push(Event::Rewound(Rewound {
            to_ms: samples_to_ms(to),
            segments: self.committed.iter().map(|c| c.segment.clone()).collect(),
        }));
        events
    }

    /// Milliseconds of audio recorded, on the timeline segment times use.
    pub fn recorded_ms(&self) -> u64 {
        samples_to_ms(self.recording.len())
    }

    /// The whole recording, 16 kHz mono 16-bit, leaving none behind. What a
    /// finished capture keeps as the note's tape.
    pub fn take_recording(&mut self) -> Vec<i16> {
        std::mem::take(&mut self.recording)
    }

    fn commit_decided(&mut self, events: &mut Vec<Event>) -> Result<bool, String> {
        let mut any = false;
        while let Some(cut) = self.cuts.pop_front() {
            if let Err(e) = self.commit(cut, events) {
                // Put it back: a transient failure must not silently drop a
                // phrase, and the worker decides whether there is a retry.
                self.cuts.push_front(cut);
                return Err(e);
            }
            any = true;
        }
        Ok(any)
    }

    fn commit(&mut self, cut: Cut, events: &mut Vec<Event>) -> Result<(), String> {
        let len = cut.at - self.base;
        if cut.speech {
            let prompt = text::prompt(&self.transcript(), PROMPT_CHARS);
            let window = &self.audio[..len.min(WINDOW_CAP)];
            let raw = self.transcriber.transcribe(window, &prompt, Pass::Commit)?;
            let words = text::without_prompt_echo(&text::clean(&raw));
            if !words.is_empty() {
                let segment = Segment {
                    text: words,
                    start_ms: samples_to_ms(self.base),
                    end_ms: samples_to_ms(cut.at),
                };
                events.push(Event::Segment(segment.clone()));
                self.committed.push(Committed { segment, end: cut.at });
            }
        }
        self.audio.drain(..len);
        self.energy.drain(..(len / FRAME).min(self.energy.len()));
        self.base = cut.at;
        if self.span_start < self.base {
            self.span_start = self.base;
        }
        // The next partial is due as soon as there is anything to guess at:
        // the one on screen described audio that has just been committed.
        self.partial_end = self.base;
        self.speech_since_partial = self.first_speech.is_some();
        Ok(())
    }

    fn maybe_partial(&mut self, events: &mut Vec<Event>) -> Result<bool, String> {
        let end = self.base + self.audio.len();
        let due = self.cuts.is_empty()
            && self.first_speech.is_some()
            && self.speech_since_partial
            && end - self.base >= PARTIAL_MIN
            && end - self.partial_end >= PARTIAL_STEP;
        if !due {
            return Ok(false);
        }
        let prompt = text::prompt(&self.transcript(), PROMPT_CHARS);
        let window = &self.audio[..(end - self.base).min(WINDOW_CAP)];
        let raw = self.transcriber.transcribe(window, &prompt, Pass::Partial)?;
        let words = text::without_prompt_echo(&text::clean(&raw));
        self.partial_end = end;
        self.speech_since_partial = false;
        if !words.is_empty() || self.showing_partial {
            self.showing_partial = !words.is_empty();
            events.push(Event::Partial(Partial { text: words }));
        }
        Ok(true)
    }

    fn clear_partial(&mut self, events: &mut Vec<Event>) {
        if self.showing_partial {
            self.showing_partial = false;
            events.push(Event::Partial(Partial { text: String::new() }));
        }
    }
}

fn to_pcm(sample: f32) -> i16 {
    (sample.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16
}

fn from_pcm(samples: &[i16]) -> Vec<f32> {
    samples.iter().map(|&s| s as f32 / i16::MAX as f32).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::whisper::SAMPLE_RATE;

    /// Answers every window with a word per second of audio it was given, and
    /// remembers every call - so a test can say exactly what the model would
    /// have been asked, and prove what it was never asked.
    #[derive(Default)]
    struct Counting {
        calls: Vec<(usize, Pass)>,
        prompts: Vec<String>,
    }

    impl Transcribe for Counting {
        fn transcribe(&mut self, audio: &[f32], prompt: &str, pass: Pass) -> Result<String, String> {
            self.calls.push((audio.len(), pass));
            self.prompts.push(prompt.to_string());
            let words = (audio.len() / SAMPLE_RATE).max(1);
            Ok(vec!["word"; words].join(" "))
        }
    }

    /// Syllables: 160 ms of loud noise, 60 ms of a dip, repeated - speech as
    /// the VAD sees it, with the gaps between syllables that keep the room
    /// honest.
    fn speech(ms: usize) -> Vec<f32> {
        let mut state = 0x2545_f491_u32;
        (0..ms_to_samples(ms as u64))
            .map(|i| {
                state ^= state << 13;
                state ^= state >> 17;
                state ^= state << 5;
                let noise = (state as f32 / u32::MAX as f32) * 2.0 - 1.0;
                let in_dip = (i % ms_to_samples(220)) >= ms_to_samples(160);
                noise * if in_dip { 0.004 } else { 0.2 }
            })
            .collect()
    }

    fn silence(ms: usize) -> Vec<f32> {
        vec![0.0; ms_to_samples(ms as u64)]
    }

    /// Feeds `audio` in 250 ms chunks, ticking after each, the way the worker
    /// does - and returns every event, finish included.
    fn run(streamer: &mut Streamer<Counting>, audio: &[f32]) -> Vec<Event> {
        let mut events = Vec::new();
        for chunk in audio.chunks(ms_to_samples(250)) {
            streamer.feed(chunk);
            events.extend(streamer.tick().unwrap());
        }
        events.extend(streamer.finish().unwrap());
        events
    }

    fn segments(events: &[Event]) -> Vec<&Segment> {
        events
            .iter()
            .filter_map(|e| match e {
                Event::Segment(s) => Some(s),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn silence_never_reaches_the_model_and_is_not_hoarded() {
        let mut streamer = Streamer::new(Counting::default());
        let mut events = Vec::new();
        let mut most_held = 0;
        for chunk in silence(30_000).chunks(ms_to_samples(250)) {
            streamer.feed(chunk);
            events.extend(streamer.tick().unwrap());
            most_held = most_held.max(streamer.audio.len());
        }
        events.extend(streamer.finish().unwrap());
        assert!(events.is_empty(), "{events:?}");
        assert!(
            streamer.transcriber.calls.is_empty(),
            "thirty seconds of silence cost {} inferences; it must cost none",
            streamer.transcriber.calls.len()
        );
        // Thirty seconds is 480,000 samples; a person who presses the key and
        // then thinks for a minute must not be paying for it in memory.
        assert!(most_held <= SILENCE_DROP + ms_to_samples(250), "held {most_held} samples");
    }

    #[test]
    fn a_pause_after_a_phrase_commits_it_and_the_cut_is_in_the_pause() {
        let mut streamer = Streamer::new(Counting::default());
        let mut audio = silence(500);
        audio.extend(speech(2_400));
        audio.extend(silence(1_000));
        audio.extend(speech(2_400));
        audio.extend(silence(500));
        let events = run(&mut streamer, &audio);

        let segs = segments(&events);
        assert_eq!(segs.len(), 2, "{events:?}");
        // The first cut sits 300 ms into the 1 s pause that starts at 2.9 s,
        // give or take the 20 ms a frame is and the 160 ms dip that ends a
        // syllable.
        assert_eq!(segs[0].start_ms, 0);
        assert!((3_000..=3_260).contains(&segs[0].end_ms), "{:?}", segs[0]);
        assert_eq!(segs[1].start_ms, segs[0].end_ms, "segments must tile, never overlap");
        assert_eq!(streamer.transcript(), format!("{} {}", segs[0].text, segs[1].text));
    }

    #[test]
    fn every_window_is_prompted_with_the_cue_vocabulary_then_what_was_committed() {
        let mut streamer = Streamer::new(Counting::default());
        let mut audio = silence(500);
        audio.extend(speech(2_400));
        audio.extend(silence(1_000));
        audio.extend(speech(2_400));
        audio.extend(silence(500));
        let events = run(&mut streamer, &audio);
        let first = segments(&events)[0].text.clone();

        let prompts = &streamer.transcriber.prompts;
        assert_eq!(prompts[0], text::prompt("", PROMPT_CHARS), "nothing committed yet");
        let after = text::prompt(&first, PROMPT_CHARS);
        assert!(prompts.contains(&after), "{prompts:#?}");
        assert!(prompts.iter().all(|p| p.starts_with(text::CUE_VOCABULARY)), "{prompts:#?}");
    }

    #[test]
    fn partials_appear_while_talking_and_are_cleared_when_their_audio_commits() {
        let mut streamer = Streamer::new(Counting::default());
        let mut audio = speech(4_000);
        audio.extend(silence(1_500));
        let events = run(&mut streamer, &audio);

        let partials: Vec<&Partial> = events
            .iter()
            .filter_map(|e| match e {
                Event::Partial(p) => Some(p),
                _ => None,
            })
            .collect();
        assert!(partials.len() >= 3, "4 s of speech should show several guesses: {events:?}");
        // The last word on the partial line after a commit is the empty one:
        // otherwise the page shows the committed text twice.
        let last_segment = events.iter().rposition(|e| matches!(e, Event::Segment(_))).unwrap();
        let after: Vec<&Event> = events[last_segment..].iter().collect();
        assert!(
            matches!(after.last(), Some(Event::Partial(p)) if p.text.is_empty()),
            "{after:?}"
        );
    }

    #[test]
    fn a_speaker_who_has_gone_quiet_costs_no_more_partials() {
        let mut streamer = Streamer::new(Counting::default());
        let mut audio = speech(1_000);
        audio.extend(silence(5_000));
        run(&mut streamer, &audio);
        let partials = streamer
            .transcriber
            .calls
            .iter()
            .filter(|(_, pass)| *pass == Pass::Partial)
            .count();
        assert!(partials <= 2, "{partials} partials for one second of speech");
    }

    #[test]
    fn a_short_phrase_left_alone_is_committed_by_the_long_pause() {
        let mut streamer = Streamer::new(Counting::default());
        let mut audio = speech(700);
        audio.extend(silence(2_000));
        let mut events = Vec::new();
        for chunk in audio.chunks(ms_to_samples(250)) {
            streamer.feed(chunk);
            events.extend(streamer.tick().unwrap());
        }
        // Committed WITHOUT finish(): nobody pressed stop, the speaker just
        // said "buy milk" and waited.
        assert_eq!(segments(&events).len(), 1, "{events:?}");
    }

    #[test]
    fn twenty_seconds_without_a_pause_is_cut_anyway_and_never_past_the_window() {
        let mut streamer = Streamer::new(Counting::default());
        let events = run(&mut streamer, &speech(45_000));
        let segs = segments(&events);
        assert!(segs.len() >= 3, "{segs:?}");
        for pair in segs.windows(2) {
            assert_eq!(pair[0].end_ms, pair[1].start_ms);
        }
        for (len, _) in &streamer.transcriber.calls {
            assert!(*len <= WINDOW_CAP);
        }
        for s in &segs[..segs.len() - 1] {
            assert!(s.end_ms - s.start_ms <= 20_000, "{s:?}");
        }
    }

    #[test]
    fn commits_do_not_depend_on_how_often_tick_runs() {
        let mut audio = speech(2_000);
        audio.extend(silence(800));
        audio.extend(speech(2_000));
        audio.extend(silence(800));
        audio.extend(speech(2_000));

        let mut eager = Streamer::new(Counting::default());
        let eager_segments: Vec<Segment> =
            segments(&run(&mut eager, &audio)).into_iter().cloned().collect();

        // A worker stuck behind a slow inference: all the audio arrives before
        // the first tick.
        let mut starved = Streamer::new(Counting::default());
        starved.feed(&audio);
        let mut events = starved.tick().unwrap();
        events.extend(starved.finish().unwrap());
        let starved_segments: Vec<Segment> = segments(&events).into_iter().cloned().collect();

        assert_eq!(eager_segments.len(), 3);
        assert_eq!(eager_segments, starved_segments);
    }

    fn rewound(events: &[Event]) -> Option<&Rewound> {
        events.iter().find_map(|e| match e {
            Event::Rewound(r) => Some(r),
            _ => None,
        })
    }

    /// Two phrases with a pause between, ticked in as the worker would, and not
    /// finished - the tape is still running.
    fn two_phrases(streamer: &mut Streamer<Counting>) -> Vec<Segment> {
        let mut audio = silence(500);
        audio.extend(speech(2_400));
        audio.extend(silence(1_000));
        audio.extend(speech(2_400));
        audio.extend(silence(1_400));
        let mut events = Vec::new();
        for chunk in audio.chunks(ms_to_samples(250)) {
            streamer.feed(chunk);
            events.extend(streamer.tick().unwrap());
        }
        let segs: Vec<Segment> = segments(&events).into_iter().cloned().collect();
        assert_eq!(segs.len(), 2, "{events:?}");
        segs
    }

    #[test]
    fn a_rewind_drops_every_segment_after_the_moment_and_what_follows_tiles_on() {
        let mut streamer = Streamer::new(Counting::default());
        let segs = two_phrases(&mut streamer);

        // Into the middle of the second phrase.
        let moment = segs[1].start_ms + 1_000;
        let events = streamer.rewind(moment);
        let rewound = rewound(&events).expect("a rewind says so");
        assert_eq!(rewound.segments, vec![segs[0].clone()]);
        assert_eq!(rewound.to_ms, moment);
        assert_eq!(streamer.recorded_ms(), moment, "the audio after the moment is gone");
        assert_eq!(streamer.transcript(), segs[0].text);

        // Talking over it: the second phrase is re-heard from where it started,
        // and the new speech follows it on the same timeline.
        let mut audio = speech(2_000);
        audio.extend(silence(1_500));
        let events = run(&mut streamer, &audio);
        let again = segments(&events);
        assert!(!again.is_empty(), "{events:?}");
        assert_eq!(again[0].start_ms, segs[0].end_ms, "re-recorded speech must tile onto what was kept");
        for pair in again.windows(2) {
            assert_eq!(pair[0].end_ms, pair[1].start_ms);
        }
    }

    #[test]
    fn the_next_prompt_follows_the_transcript_as_it_now_stands() {
        let mut streamer = Streamer::new(Counting::default());
        let segs = two_phrases(&mut streamer);
        streamer.rewind(segs[1].start_ms);
        let before = streamer.transcriber.prompts.len();
        let mut audio = speech(2_000);
        audio.extend(silence(1_500));
        run(&mut streamer, &audio);
        let after = &streamer.transcriber.prompts[before..];
        let expected = text::prompt(&segs[0].text, PROMPT_CHARS);
        assert!(after.iter().all(|p| *p == expected), "{after:#?}");
    }

    #[test]
    fn a_rewind_to_the_start_starts_the_note_over() {
        let mut streamer = Streamer::new(Counting::default());
        two_phrases(&mut streamer);
        let events = streamer.rewind(0);
        assert!(rewound(&events).unwrap().segments.is_empty());
        assert_eq!(streamer.transcript(), "");
        let mut audio = speech(2_000);
        audio.extend(silence(1_500));
        let events = run(&mut streamer, &audio);
        assert_eq!(segments(&events)[0].start_ms, 0);
    }

    #[test]
    fn a_rewind_clears_the_guess_on_screen() {
        let mut streamer = Streamer::new(Counting::default());
        let mut events = Vec::new();
        for chunk in speech(3_000).chunks(ms_to_samples(250)) {
            streamer.feed(chunk);
            events.extend(streamer.tick().unwrap());
        }
        assert!(streamer.showing_partial, "{events:?}");
        let events = streamer.rewind(1_000);
        assert!(matches!(events.first(), Some(Event::Partial(p)) if p.text.is_empty()), "{events:?}");
        assert!(matches!(events.last(), Some(Event::Rewound(_))), "{events:?}");
    }

    #[test]
    fn a_rewind_past_the_end_is_the_end_and_loses_nothing() {
        let mut streamer = Streamer::new(Counting::default());
        let segs = two_phrases(&mut streamer);
        let recorded = streamer.recorded_ms();
        let events = streamer.rewind(recorded + 60_000);
        assert_eq!(rewound(&events).unwrap().segments, segs);
        assert_eq!(streamer.recorded_ms(), recorded / 20 * 20);
    }

    #[test]
    fn a_click_in_a_pause_is_not_speech() {
        let mut streamer = Streamer::new(Counting::default());
        let mut audio = silence(1_000);
        // One loud 20 ms frame.
        audio.extend(vec![0.5; FRAME]);
        audio.extend(silence(3_000));
        let events = run(&mut streamer, &audio);
        assert!(events.is_empty(), "{events:?}");
        assert!(streamer.transcriber.calls.is_empty());
    }
}
