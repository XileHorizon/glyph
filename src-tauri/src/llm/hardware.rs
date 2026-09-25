//! What the phone is doing for the model, read with every progress report.
//!
//! Matt: "a better, consistent AI card that renders when it's thinking, and it
//! should render things like real phone hardware usage". The card
//! (src/app/format/AiCard.tsx) draws these; nothing here judges them. Every
//! number comes from a file an app may read without a permission: the
//! process's own resident memory from `/proc/self/statm`, the phone's total
//! and available memory from `/proc/meminfo` (parsed by `device`), the
//! process's CPU time from `/proc/self/stat` - turned into a percentage of one
//! core over the time since the last sample, so 640 is six and a half cores
//! busy - and the hottest thermal zone under `/sys/class/thermal`, where the
//! phone lets it be read (many do not, and then there is no reading rather
//! than a guess). Off Linux there is no `/proc`, and `sample` answers None.
//!
//! Reading three small files costs microseconds; a sample is taken at most
//! every report, which is about every 120 ms.

use serde::Serialize;
use std::path::PathBuf;
use std::time::Instant;

use super::device::parse_meminfo;

/// One reading of the phone under the model. Mirrored by `Hardware` in core/ai.ts.
#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Hardware {
    /// The app's resident memory.
    pub rss_bytes: u64,
    /// `MemAvailable`: what the phone could still give.
    pub free_bytes: u64,
    pub total_bytes: u64,
    /// Percent of one core, over the time since the last sample: 640 is six and a half cores busy.
    pub cpu_percent: f32,
    /// The threads the engine runs the model on, of the cores it has.
    pub threads: u32,
    pub cores: u32,
    /// The hottest thermal zone, in degrees Celsius, where the phone lets it be read.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temp_c: Option<f32>,
}

/// Samples the phone for one run. Keeps the last CPU time so each sample is a rate, not a total.
pub struct Sampler {
    last_cpu: Option<(u64, Instant)>,
    /// Thermal zone files that could be read, found once.
    zones: Vec<PathBuf>,
    ticks_per_second: f64,
}

impl Default for Sampler {
    fn default() -> Self {
        Self::new()
    }
}

impl Sampler {
    pub fn new() -> Sampler {
        Sampler {
            last_cpu: None,
            zones: thermal_zones(),
            ticks_per_second: clock_ticks_per_second(),
        }
    }

    /// The phone now, or None where there is no `/proc` to read.
    pub fn sample(&mut self, threads: u32) -> Option<Hardware> {
        let statm = std::fs::read_to_string("/proc/self/statm").ok()?;
        let stat = std::fs::read_to_string("/proc/self/stat").ok()?;
        let meminfo = std::fs::read_to_string("/proc/meminfo").unwrap_or_default();
        let rss_bytes = parse_statm_rss_pages(&statm)? * page_size();
        let (total_bytes, free_bytes) = parse_meminfo(&meminfo);
        let now = Instant::now();
        let ticks = parse_stat_cpu_ticks(&stat)?;
        let cpu_percent = match self.last_cpu {
            Some((was, at)) => {
                let seconds = now.duration_since(at).as_secs_f64();
                if seconds > 0.0 {
                    ((ticks.saturating_sub(was)) as f64 / self.ticks_per_second / seconds * 100.0) as f32
                } else {
                    0.0
                }
            }
            None => 0.0,
        };
        self.last_cpu = Some((ticks, now));
        Some(Hardware {
            rss_bytes,
            free_bytes: free_bytes.unwrap_or(0),
            total_bytes: total_bytes.unwrap_or(0),
            cpu_percent,
            threads,
            cores: std::thread::available_parallelism().map(|n| n.get() as u32).unwrap_or(0),
            temp_c: hottest(&self.zones),
        })
    }
}

/// `/proc/self/statm`: pages of size, resident, shared, … - the second is resident.
pub fn parse_statm_rss_pages(text: &str) -> Option<u64> {
    text.split_whitespace().nth(1)?.parse().ok()
}

/// `/proc/self/stat`: after the parenthesised command name, `utime` and `stime`
/// are the 12th and 13th fields (in clock ticks); their sum is the CPU time.
pub fn parse_stat_cpu_ticks(text: &str) -> Option<u64> {
    let after = &text[text.rfind(')')? + 1..];
    let mut fields = after.split_whitespace();
    let utime: u64 = fields.nth(11)?.parse().ok()?;
    let stime: u64 = fields.next()?.parse().ok()?;
    Some(utime + stime)
}

/// A thermal zone's `temp` is millidegrees; anything outside 0 to 150 °C is not a reading.
pub fn parse_millidegrees(text: &str) -> Option<f32> {
    let value: i64 = text.trim().parse().ok()?;
    let celsius = value as f32 / 1000.0;
    (0.0 < celsius && celsius < 150.0).then_some(celsius)
}

fn hottest(zones: &[PathBuf]) -> Option<f32> {
    zones
        .iter()
        .filter_map(|zone| std::fs::read_to_string(zone).ok())
        .filter_map(|text| parse_millidegrees(&text))
        .fold(None, |best, t| Some(best.map_or(t, |b: f32| b.max(t))))
}

/// The `temp` files under `/sys/class/thermal` that can be read right now.
fn thermal_zones() -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir("/sys/class/thermal") else { return Vec::new() };
    entries
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_name().to_string_lossy().starts_with("thermal_zone"))
        .map(|entry| entry.path().join("temp"))
        .filter(|path| std::fs::read_to_string(path).ok().and_then(|t| parse_millidegrees(&t)).is_some())
        .collect()
}

fn page_size() -> u64 {
    // SAFETY: sysconf reads a constant; it has no preconditions.
    let size = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
    if size > 0 { size as u64 } else { 4096 }
}

fn clock_ticks_per_second() -> f64 {
    // SAFETY: as above.
    let ticks = unsafe { libc::sysconf(libc::_SC_CLK_TCK) };
    if ticks > 0 { ticks as f64 } else { 100.0 }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_resident_pages_from_a_real_statm() {
        assert_eq!(parse_statm_rss_pages("1053244 812345 20481 12 0 401230 0\n"), Some(812_345));
        assert_eq!(parse_statm_rss_pages("garbage"), None);
    }

    #[test]
    fn reads_cpu_time_from_a_real_stat_with_a_command_name_holding_spaces_and_brackets() {
        // pid (comm) state ppid pgrp session tty tpgid flags minflt cminflt majflt cmajflt utime stime …
        let line = "12345 (glyph (main)) S 1 12345 12345 0 -1 4194560 88000 0 0 0 3140 260 0 0 20 0 9 0 5000 2000000000 250000 …\n";
        assert_eq!(parse_stat_cpu_ticks(line), Some(3140 + 260));
        assert_eq!(parse_stat_cpu_ticks("no parenthesis here"), None);
    }

    #[test]
    fn takes_a_thermal_reading_only_within_reason() {
        assert_eq!(parse_millidegrees("41230\n"), Some(41.23));
        assert_eq!(parse_millidegrees("-40000"), None);
        assert_eq!(parse_millidegrees("200000"), None);
        assert_eq!(parse_millidegrees("N/A"), None);
    }

    #[test]
    fn samples_the_phone_where_there_is_a_proc_and_answers_none_elsewhere() {
        let mut sampler = Sampler::new();
        let first = sampler.sample(4);
        if cfg!(target_os = "linux") {
            let reading = first.expect("Linux has /proc");
            assert!(reading.rss_bytes > 0 && reading.total_bytes > 0 && reading.cores > 0);
            assert_eq!(reading.threads, 4);
            let second = sampler.sample(4).expect("still there");
            assert!(second.cpu_percent >= 0.0);
        } else {
            assert!(first.is_none());
        }
    }
}
