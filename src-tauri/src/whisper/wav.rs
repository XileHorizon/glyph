//! A WAV file, as 16 kHz mono `f32` samples, or a sentence saying why not.
//!
//! Two readers: `transcribe_wav` (whole-file benchmarking on the phone, where
//! the Android capture service writes 16 kHz mono PCM16 to `<filesDir>/
//! captures/`), and the tests, which read a fixture `afconvert` wrote. Both
//! produce exactly the formats handled here, and nothing else is.
//!
//! Hand-written rather than `hound`, and on the same arithmetic as
//! `store.rs`'s error enum: RIFF is a chunk list with a four-byte tag and a
//! length, the two sample formats that arrive are sixteen-bit integers and
//! 32-bit floats, and a crate for sixty lines is a dependency whose whole
//! surface is one function. What it does NOT do is resample. A file at 44.1
//! kHz is refused with its rate in the message rather than quietly converted -
//! see `SAMPLE_RATE` for why that is the caller's problem.

use std::path::Path;

use super::SAMPLE_RATE;

/// PCM integer samples.
const FORMAT_PCM: u16 = 1;
/// IEEE float samples.
const FORMAT_FLOAT: u16 = 3;
/// WAVE_FORMAT_EXTENSIBLE, whose real format tag is the first two bytes of the
/// sub-format GUID. `afconvert` writes this for some layouts.
const FORMAT_EXTENSIBLE: u16 = 0xFFFE;

/// Reads a WAV file from disk. See `parse`.
pub fn read(path: &Path) -> Result<Vec<f32>, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    parse(&bytes).map_err(|e| format!("{}: {e}", path.display()))
}

/// The canonical 44-byte header this module writes: RIFF, a 16-byte `fmt `,
/// then `data`. Fixed so `append` can find the two length fields by offset.
const HEADER_LEN: usize = 44;

/// Writes `samples` (16 kHz mono 16-bit) to `path` as a WAV file, or adds them
/// to the end of the one already there when `append` is set and the file was
/// written by this function. Answers with the file's sample count afterwards -
/// the recording's length, on the timeline segment times use.
///
/// Appending is what a side-key capture that continues a note does: the note's
/// tape is one file, the new take after the old, so the words and the audio
/// stay one timeline. A file that is not ours (no such header) is replaced
/// rather than corrupted.
pub fn write_pcm16(path: &Path, samples: &[i16], append: bool) -> Result<usize, String> {
    use std::io::{Seek, SeekFrom, Write};
    let mut data = Vec::with_capacity(samples.len() * 2);
    for s in samples {
        data.extend_from_slice(&s.to_le_bytes());
    }
    let fail = |e: std::io::Error| format!("could not write the recording: {e}");

    let existing = if append { ours(path) } else { None };
    let (mut file, before) = match existing {
        Some(bytes) => (
            std::fs::OpenOptions::new()
                .write(true)
                .open(path)
                .map_err(fail)?,
            bytes,
        ),
        None => (std::fs::File::create(path).map_err(fail)?, 0),
    };
    file.seek(SeekFrom::Start((HEADER_LEN + before) as u64))
        .map_err(fail)?;
    file.write_all(&data).map_err(fail)?;
    let total = before + data.len();
    file.seek(SeekFrom::Start(0)).map_err(fail)?;
    file.write_all(&header(total)).map_err(fail)?;
    file.flush().map_err(fail)?;
    Ok(total / 2)
}

/** Move a recorder-owned WAV, or append it to another recorder-owned tape. */
pub fn move_or_append(from: &Path, to: &Path, append: bool) -> Result<usize, String> {
    if !from.is_file() {
        return Ok(0);
    }
    if !append || !to.is_file() {
        std::fs::rename(from, to).map_err(|e| format!("could not move the recording: {e}"))?;
        return ours(to)
            .ok_or_else(|| "the moved recording was not a recorder WAV".to_string())
            .map(|bytes| bytes / 2);
    }
    let bytes =
        std::fs::read(from).map_err(|e| format!("could not read the temporary recording: {e}"))?;
    let data = bytes
        .get(HEADER_LEN..)
        .ok_or_else(|| "the temporary recording was not a recorder WAV".to_string())?;
    let samples = data
        .chunks_exact(2)
        .map(|chunk| i16::from_le_bytes([chunk[0], chunk[1]]))
        .collect::<Vec<_>>();
    let total = write_pcm16(to, &samples, true)?;
    std::fs::remove_file(from)
        .map_err(|e| format!("could not remove the temporary recording: {e}"))?;
    Ok(total)
}

/// A 16 kHz mono PCM16 header for `data_len` bytes of samples.
fn header(data_len: usize) -> [u8; HEADER_LEN] {
    let mut out = [0u8; HEADER_LEN];
    out[0..4].copy_from_slice(b"RIFF");
    out[4..8].copy_from_slice(&((HEADER_LEN - 8 + data_len) as u32).to_le_bytes());
    out[8..12].copy_from_slice(b"WAVE");
    out[12..16].copy_from_slice(b"fmt ");
    out[16..20].copy_from_slice(&16u32.to_le_bytes());
    out[20..22].copy_from_slice(&FORMAT_PCM.to_le_bytes());
    out[22..24].copy_from_slice(&1u16.to_le_bytes());
    out[24..28].copy_from_slice(&(SAMPLE_RATE as u32).to_le_bytes());
    out[28..32].copy_from_slice(&(SAMPLE_RATE as u32 * 2).to_le_bytes());
    out[32..34].copy_from_slice(&2u16.to_le_bytes());
    out[34..36].copy_from_slice(&16u16.to_le_bytes());
    out[36..40].copy_from_slice(b"data");
    out[40..44].copy_from_slice(&(data_len as u32).to_le_bytes());
    out
}

/// The data length of a file this module wrote, or None for anything else.
///
/// Measured from the bytes on disk, not the header: an append writes the
/// samples first and the header second, and a process killed between the two
/// leaves a file longer than its header says. That tail is real audio that was
/// recorded, so it is kept - only whole samples - and the header is put right
/// by the next write. Trusting the header instead would have made the next
/// continuation replace the file and lose every earlier take. Only the header
/// is read; a long tape is not pulled into memory to check 44 bytes.
fn ours(path: &Path) -> Option<usize> {
    use std::io::Read;
    let mut file = std::fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len() as usize;
    let mut head = [0u8; HEADER_LEN];
    file.read_exact(&mut head).ok()?;
    if &head[0..4] != b"RIFF" || &head[12..16] != b"fmt " || &head[36..40] != b"data" {
        return None;
    }
    let declared = u32::from_le_bytes([head[40], head[41], head[42], head[43]]) as usize;
    let actual = (len - HEADER_LEN) & !1;
    (declared <= actual).then_some(actual)
}

/// Decodes a WAV held in memory to 16 kHz mono `f32` in [-1, 1].
///
/// Stereo (or more) is averaged to mono rather than refused: a file recorded
/// on a desktop for a benchmark is usually stereo, and averaging two copies of
/// one microphone costs nothing a transcript can hear.
///
/// Chunks other than `fmt ` and `data` are stepped over, padding byte and all,
/// because `afconvert` puts a `FLLR` chunk between them and a reader that
/// assumed `data` came next would read the filler as audio.
pub fn parse(bytes: &[u8]) -> Result<Vec<f32>, String> {
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("not a RIFF/WAVE file".to_string());
    }
    let mut format: Option<(u16, u16, u32, u16)> = None;
    let mut at = 12;
    while at + 8 <= bytes.len() {
        let tag = &bytes[at..at + 4];
        let len = u32::from_le_bytes([bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]])
            as usize;
        let body_start = at + 8;
        // A `data` length past the end of the file is what a recorder killed
        // mid-write leaves behind; the samples that DID land are still worth
        // reading, so the length is clamped rather than refused.
        let body_end = body_start.saturating_add(len).min(bytes.len());
        let body = &bytes[body_start..body_end];

        match tag {
            b"fmt " => {
                if body.len() < 16 {
                    return Err("fmt chunk too short".to_string());
                }
                let mut tag = u16::from_le_bytes([body[0], body[1]]);
                let channels = u16::from_le_bytes([body[2], body[3]]);
                let rate = u32::from_le_bytes([body[4], body[5], body[6], body[7]]);
                let bits = u16::from_le_bytes([body[14], body[15]]);
                if tag == FORMAT_EXTENSIBLE && body.len() >= 26 {
                    tag = u16::from_le_bytes([body[24], body[25]]);
                }
                format = Some((tag, channels, rate, bits));
            }
            b"data" => {
                let (tag, channels, rate, bits) =
                    format.ok_or("data chunk before any fmt chunk")?;
                if rate as usize != SAMPLE_RATE {
                    return Err(format!(
                        "sample rate is {rate} Hz; transcription needs {SAMPLE_RATE} Hz mono"
                    ));
                }
                if channels == 0 {
                    return Err("zero channels".to_string());
                }
                return decode(body, tag, channels as usize, bits);
            }
            _ => {}
        }
        // Chunks are word-aligned: an odd length is followed by a pad byte.
        at = body_start.saturating_add(len).saturating_add(len & 1);
    }
    Err("no data chunk".to_string())
}

fn decode(body: &[u8], tag: u16, channels: usize, bits: u16) -> Result<Vec<f32>, String> {
    let interleaved: Vec<f32> = match (tag, bits) {
        (FORMAT_PCM, 16) => body
            .chunks_exact(2)
            .map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0)
            .collect(),
        (FORMAT_FLOAT, 32) => body
            .chunks_exact(4)
            .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
            .collect(),
        _ => {
            return Err(format!(
                "unsupported sample format (tag {tag}, {bits}-bit); expected 16-bit PCM or 32-bit float"
            ))
        }
    };
    if channels == 1 {
        return Ok(interleaved);
    }
    Ok(interleaved
        .chunks_exact(channels)
        .map(|frame| frame.iter().sum::<f32>() / channels as f32)
        .collect())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A 16 kHz PCM16 WAV of `samples`, with a filler chunk between `fmt ` and
    /// `data` the way `afconvert` writes one, and an odd-length chunk to prove
    /// the pad byte is honoured.
    pub(crate) fn encode(samples: &[f32], channels: u16) -> Vec<u8> {
        let mut data = Vec::new();
        for s in samples {
            let v = (s.clamp(-1.0, 1.0) * 32767.0) as i16;
            for _ in 0..channels {
                data.extend_from_slice(&v.to_le_bytes());
            }
        }
        let mut out = Vec::new();
        out.extend_from_slice(b"RIFF\0\0\0\0WAVE");
        out.extend_from_slice(b"fmt ");
        out.extend_from_slice(&16u32.to_le_bytes());
        out.extend_from_slice(&FORMAT_PCM.to_le_bytes());
        out.extend_from_slice(&channels.to_le_bytes());
        out.extend_from_slice(&(SAMPLE_RATE as u32).to_le_bytes());
        out.extend_from_slice(&(SAMPLE_RATE as u32 * 2 * channels as u32).to_le_bytes());
        out.extend_from_slice(&(2 * channels).to_le_bytes());
        out.extend_from_slice(&16u16.to_le_bytes());
        out.extend_from_slice(b"FLLR");
        out.extend_from_slice(&3u32.to_le_bytes());
        out.extend_from_slice(&[0, 0, 0, 0]); // three bytes and the pad byte
        out.extend_from_slice(b"data");
        out.extend_from_slice(&(data.len() as u32).to_le_bytes());
        out.extend_from_slice(&data);
        let riff_len = (out.len() - 8) as u32;
        out[4..8].copy_from_slice(&riff_len.to_le_bytes());
        out
    }

    #[test]
    fn a_written_recording_reads_back_and_appends_onto_itself() {
        let dir = std::env::temp_dir().join(format!("glyph-wav-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("take.wav");
        let first: Vec<i16> = (0..1600).map(|i| (i % 200) as i16 * 100).collect();
        assert_eq!(write_pcm16(&path, &first, false).unwrap(), 1600);
        let second: Vec<i16> = vec![1234; 800];
        assert_eq!(
            write_pcm16(&path, &second, true).unwrap(),
            2400,
            "appending adds to the count"
        );
        let back = read(&path).unwrap();
        assert_eq!(back.len(), 2400);
        assert!((back[2399] - 1234.0 / 32768.0).abs() < 1e-3);
        // A write cut short between the samples and the header: the next
        // append keeps what was on disk and puts the header right.
        let mut bytes = std::fs::read(&path).unwrap();
        bytes[40..44].copy_from_slice(&(1600u32 * 2).to_le_bytes());
        std::fs::write(&path, &bytes).unwrap();
        assert_eq!(
            write_pcm16(&path, &second, true).unwrap(),
            3200,
            "the orphaned tail counts"
        );
        assert_eq!(read(&path).unwrap().len(), 3200);
        // Not ours: replaced, not corrupted.
        std::fs::write(&path, b"not a wav").unwrap();
        assert_eq!(write_pcm16(&path, &second, true).unwrap(), 800);
        assert_eq!(read(&path).unwrap().len(), 800);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn pcm16_comes_back_as_the_samples_that_went_in() {
        let samples: Vec<f32> = (0..1600).map(|i| ((i as f32) * 0.01).sin() * 0.5).collect();
        let decoded = parse(&encode(&samples, 1)).unwrap();
        assert_eq!(decoded.len(), samples.len());
        for (a, b) in decoded.iter().zip(&samples) {
            assert!((a - b).abs() < 1e-4);
        }
    }

    #[test]
    fn stereo_is_averaged_to_mono() {
        let samples = vec![0.25f32; 800];
        let decoded = parse(&encode(&samples, 2)).unwrap();
        assert_eq!(decoded.len(), 800);
        assert!((decoded[0] - 0.25).abs() < 1e-4);
    }

    #[test]
    fn the_wrong_sample_rate_is_refused_with_the_rate_in_the_sentence() {
        let mut bytes = encode(&[0.0; 16], 1);
        bytes[24..28].copy_from_slice(&44_100u32.to_le_bytes());
        let error = parse(&bytes).unwrap_err();
        assert!(error.contains("44100"), "{error}");
    }
}
