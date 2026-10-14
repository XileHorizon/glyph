//! The notes as a library of Markdown files (docs/LIBRARY.md), and NOT ONE
//! `tauri::` TYPE IN THIS MODULE, for the reason store.rs gives.
//!
//! The files are the truth; `.glyph/index.sqlite` is a cache that makes the
//! list instant, and it is rebuilt from the files whenever they disagree. A
//! `Library` answers the same calls the old `store::Store` did (list, get,
//! save, delete, pin, archive, recording, formatted version) with the same
//! `store::Note`, so the command layer and the page carry on unchanged: a note
//! is still an id and a body, and now it is also a file.
//!
//! - **Saving** writes the body under the note's front matter. Only the keys
//!   Glyph manages are touched (frontmatter.rs), and the file is renamed when
//!   its title changes (names.rs). A new note is written into `Inbox/`.
//! - **Pinning and archiving** change a front matter line and keep the file's
//!   modified time, so a pin doesn't move a note up the list.
//! - **What isn't text** (a recording's phrases, the formatted version) is
//!   `.glyph/notes/<id>.json`.
//! - **Reading** checks the files against the index first (`scan`). A file
//!   changed by another app is read again, a new one is indexed, and a
//!   vanished one leaves the list.

pub mod frontmatter;
pub mod names;
pub mod vault;

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::store::{
    CommandMutation, CommandMutationResult, CommandUndoResult, Note, PendingCommandUndo,
    RecordedSegment, Recording, Store,
};
use frontmatter::{join, split, FrontMatter, Value};
use names::{file_stem, title_of, unique_name};
use vault::{Entry, FsVault, Vault};

/// Where new notes go.
pub const INBOX: &str = "Inbox";
/// The index's shape. A different one is dropped and rebuilt: it is only a cache.
const INDEX_VERSION: i64 = 2;

const INDEX_SCHEMA: &str = "
    CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        body TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        modified_at INTEGER NOT NULL,
        size INTEGER NOT NULL,
        source TEXT NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0,
        archived_at INTEGER,
        id_in_file INTEGER NOT NULL DEFAULT 0,
        recording_ms INTEGER,
        formatted_for INTEGER,
        formatted_model TEXT,
        revision INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS command_mutations (
        id TEXT PRIMARY KEY,
        note_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        before_body TEXT,
        after_body TEXT NOT NULL,
        before_revision INTEGER,
        after_revision INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        undone_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS command_mutations_note ON command_mutations (note_id, created_at DESC);
";

#[derive(Debug)]
pub enum LibraryError {
    Io(std::io::Error),
    Index(rusqlite::Error),
    Store(String),
}

impl std::fmt::Display for LibraryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LibraryError::Io(e) => write!(f, "the library's files: {e}"),
            LibraryError::Index(e) => write!(f, "the library's index: {e}"),
            LibraryError::Store(e) => write!(f, "the old notes: {e}"),
        }
    }
}

impl std::error::Error for LibraryError {}

impl From<std::io::Error> for LibraryError {
    fn from(e: std::io::Error) -> Self {
        LibraryError::Io(e)
    }
}

impl From<rusqlite::Error> for LibraryError {
    fn from(e: rusqlite::Error) -> Self {
        LibraryError::Index(e)
    }
}

pub type Result<T> = std::result::Result<T, LibraryError>;

/// `.glyph/notes/<id>.json`: what a note has that isn't text.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Sidecar {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    recording_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    segments: Option<Vec<RecordedSegment>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    formatted: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    formatted_for: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    formatted_model: Option<String>,
}

impl Sidecar {
    fn is_empty(&self) -> bool {
        *self == Sidecar::default()
    }
}

/// `.glyph/library.json`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    version: u32,
    created: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    moved_from: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    moved_notes: Option<usize>,
}

struct Row {
    id: String,
    path: String,
    body: String,
    created_at: i64,
    modified_at: i64,
    source: String,
    pinned: bool,
    archived_at: Option<i64>,
    /// The id is written in the file's front matter, not only the index's (read by the index, kept for the rebuild tests).
    #[allow(dead_code)]
    id_in_file: bool,
    recording_ms: Option<i64>,
    formatted_for: Option<i64>,
    formatted_model: Option<String>,
    revision: i64,
}

const ROW_COLUMNS: &str = "id, path, body, created_at, modified_at, source, pinned, archived_at, id_in_file, recording_ms, formatted_for, formatted_model, revision";

fn row_of(row: &rusqlite::Row<'_>) -> rusqlite::Result<Row> {
    Ok(Row {
        id: row.get(0)?,
        path: row.get(1)?,
        body: row.get(2)?,
        created_at: row.get(3)?,
        modified_at: row.get(4)?,
        source: row.get(5)?,
        pinned: row.get::<_, i64>(6)? != 0,
        archived_at: row.get(7)?,
        id_in_file: row.get::<_, i64>(8)? != 0,
        recording_ms: row.get(9)?,
        formatted_for: row.get(10)?,
        formatted_model: row.get(11)?,
        revision: row.get::<_, Option<i64>>(12)?.unwrap_or(1),
    })
}

pub fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

// ---- dates, as front matter writes them ---------------------------------------------------

/// Milliseconds since the epoch as `2026-09-14T10:32:10.123Z`.
pub fn iso(ms: i64) -> String {
    let secs = ms.div_euclid(1000);
    let millis = ms.rem_euclid(1000);
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    // Howard Hinnant's civil-from-days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{millis:03}Z", rem / 3600, rem / 60 % 60, rem % 60)
}

/// `2026-09-14`, `2026-09-14T10:32`, `…:10.123Z` or `…+02:00` as milliseconds since the epoch.
pub fn parse_iso(text: &str) -> Option<i64> {
    let text = text.trim();
    let (date, time) = text.split_once(['T', ' ']).unwrap_or((text, ""));
    let mut parts = date.split('-');
    let (year, month, day): (i64, i64, i64) = (parts.next()?.parse().ok()?, parts.next()?.parse().ok()?, parts.next()?.parse().ok()?);
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let mp = if month > 2 { month - 3 } else { month + 9 };
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    let (clock, offset_min) = match time.find(['Z', '+']).or_else(|| time.rfind('-').filter(|&at| at > 5)) {
        Some(at) => {
            let zone = &time[at..];
            let offset = if zone.starts_with('Z') {
                0
            } else {
                let sign = if zone.starts_with('-') { -1 } else { 1 };
                let digits: String = zone[1..].chars().filter(char::is_ascii_digit).collect();
                let hours: i64 = digits.get(0..2).and_then(|h| h.parse().ok()).unwrap_or(0);
                let minutes: i64 = digits.get(2..4).and_then(|m| m.parse().ok()).unwrap_or(0);
                sign * (hours * 60 + minutes)
            };
            (&time[..at], offset)
        }
        None => (time, 0),
    };
    let mut hms = clock.split(':');
    let hours: i64 = hms.next().filter(|h| !h.is_empty()).map_or(Some(0), |h| h.parse().ok())?;
    let minutes: i64 = hms.next().map_or(Some(0), |m| m.parse().ok())?;
    let (seconds, millis) = match hms.next() {
        Some(s) => {
            let (whole, frac) = s.split_once('.').unwrap_or((s, "0"));
            let frac: String = frac.chars().chain("000".chars()).take(3).collect();
            (whole.parse::<i64>().ok()?, frac.parse::<i64>().ok()?)
        }
        None => (0, 0),
    };
    Some(((days * 86_400 + hours * 3600 + minutes * 60 + seconds - offset_min * 60) * 1000) + millis)
}

// ---- the library ----------------------------------------------------------------------------

pub struct Library {
    vault: Box<dyn Vault>,
    index: Connection,
    /// New notes with no words yet, which have no file (docs/LIBRARY.md): a
    /// note opened and left empty would otherwise be an "Untitled.md" in the
    /// person's folder. The first words write the file.
    drafts: HashMap<String, Note>,
    /// Notes this process started as drafts: one whose words are all taken out
    /// again, with nothing else set on it, goes back to being a draft.
    drafted: HashSet<String>,
}

fn folder_of(path: &str) -> &str {
    path.rfind('/').map_or("", |at| &path[..at])
}

fn in_folder(folder: &str, name: &str) -> String {
    if folder.is_empty() { name.to_string() } else { format!("{folder}/{name}") }
}

/// Whether a path from another device can be a note's here: relative, `.md`, no dot folders or `..`.
fn library_path(path: &str) -> bool {
    path.to_ascii_lowercase().ends_with(".md") && path.split('/').all(|part| !part.is_empty() && !part.starts_with('.'))
}

/// Whether a file's name is already its title's: `Stem.md`, or `Stem 2.md` for a clash.
fn named_for(path: &str, stem: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path);
    let Some(bare) = name.strip_suffix(".md").or_else(|| name.strip_suffix(".MD")) else { return false };
    bare == stem || bare.strip_prefix(stem).and_then(|rest| rest.strip_prefix(' ')).is_some_and(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()))
}

impl Library {
    /// The library in a folder this process can reach with `std::fs`.
    pub fn open_fs(root: &Path) -> Result<Library> {
        Library::open(Box::new(FsVault::new(root)?))
    }

    pub fn open(vault: Box<dyn Vault>) -> Result<Library> {
        let glyph = vault.glyph_dir();
        std::fs::create_dir_all(glyph.join("notes"))?;
        let manifest = glyph.join("library.json");
        if !manifest.exists() {
            let fresh = Manifest { version: 1, created: iso(now_ms()), moved_from: None, moved_notes: None };
            std::fs::write(&manifest, serde_json::to_string_pretty(&fresh).unwrap_or_default())?;
        }
        let index = Connection::open(glyph.join("index.sqlite"))?;
        let _: String = index.query_row("PRAGMA journal_mode=WAL", [], |row| row.get(0))?;
        index.busy_timeout(std::time::Duration::from_secs(5))?;
        let version: i64 = index.query_row("PRAGMA user_version", [], |row| row.get(0))?;
        if version != INDEX_VERSION {
            index.execute_batch("DROP TABLE IF EXISTS notes; DROP TABLE IF EXISTS command_mutations;")?;
            index.execute_batch(INDEX_SCHEMA)?;
            index.execute_batch(&format!("PRAGMA user_version = {INDEX_VERSION};"))?;
        }
        let mut library = Library { vault, index, drafts: HashMap::new(), drafted: HashSet::new() };
        library.scan()?;
        Ok(library)
    }

    fn sidecar_path(&self, id: &str) -> Option<std::path::PathBuf> {
        (!id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')).then(|| self.vault.glyph_dir().join("notes").join(format!("{id}.json")))
    }

    fn sidecar(&self, id: &str) -> Sidecar {
        self.sidecar_path(id)
            .and_then(|path| std::fs::read_to_string(path).ok())
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    }

    fn write_sidecar(&self, id: &str, sidecar: &Sidecar) -> Result<()> {
        let Some(path) = self.sidecar_path(id) else { return Ok(()) };
        if sidecar.is_empty() {
            let _ = std::fs::remove_file(path);
            return Ok(());
        }
        let part = path.with_extension("json.part");
        std::fs::write(&part, serde_json::to_string(sidecar).unwrap_or_default())?;
        std::fs::rename(part, path)?;
        Ok(())
    }

    fn row(&self, id: &str) -> Result<Option<Row>> {
        Ok(self.index.query_row(&format!("SELECT {ROW_COLUMNS} FROM notes WHERE id = ?1"), [id], row_of).optional()?)
    }

    fn row_at(&self, path: &str) -> Result<Option<Row>> {
        Ok(self.index.query_row(&format!("SELECT {ROW_COLUMNS} FROM notes WHERE path = ?1"), [path], row_of).optional()?)
    }

    /// The files against the index: changed files read again, new ones indexed, vanished ones dropped.
    pub fn scan(&mut self) -> Result<()> {
        let entries = self.vault.markdown()?;
        let known: HashMap<String, (i64, i64)> = {
            let mut stmt = self.index.prepare("SELECT path, modified_at, size FROM notes")?;
            let rows = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, (row.get::<_, i64>(1)?, row.get::<_, i64>(2)?))))?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        let present: HashSet<&str> = entries.iter().map(|e| e.path.as_str()).collect();
        let gone: Vec<String> = known.keys().filter(|path| !present.contains(path.as_str())).cloned().collect();
        for path in gone {
            self.index.execute("DELETE FROM notes WHERE path = ?1", [&path])?;
        }
        for entry in &entries {
            if known.get(&entry.path) == Some(&(entry.modified_ms, entry.size as i64)) {
                continue;
            }
            self.index_file(entry)?;
        }
        Ok(())
    }

    /// One file read into the index.
    fn index_file(&mut self, entry: &Entry) -> Result<()> {
        let Ok(text) = self.vault.read(&entry.path) else { return Ok(()) };
        let (front, body) = split(&text);
        let front = front.unwrap_or_default();
        let at_path = self.row_at(&entry.path)?;
        let named = front.text("id").filter(|id| !id.trim().is_empty());
        let (id, id_in_file) = match named {
            Some(id) => match self.row(&id)? {
                // The same id at another path that still exists: this file is a copy, and gets its own.
                Some(other) if other.path != entry.path && self.vault.exists(&other.path) => (uuid::Uuid::new_v4().to_string(), false),
                _ => (id, true),
            },
            None => (at_path.as_ref().map(|r| r.id.clone()).unwrap_or_else(|| uuid::Uuid::new_v4().to_string()), false),
        };
        let previous = self.row(&id)?;
        let prior_revision = previous
            .as_ref()
            .or(at_path.as_ref())
            .map(|row| if row.body == body { row.revision } else { row.revision.saturating_add(1) })
            .unwrap_or(1);
        let created_at = front
            .text("created")
            .and_then(|t| parse_iso(&t))
            .or(previous.as_ref().map(|r| r.created_at))
            .or(at_path.as_ref().map(|r| r.created_at))
            .unwrap_or(entry.modified_ms);
        let archived_at = front.text("archived").and_then(|t| parse_iso(&t)).or_else(|| front.flag("archived").then_some(entry.modified_ms));
        let sidecar = self.sidecar(&id);
        self.index.execute("DELETE FROM notes WHERE path = ?1 OR id = ?2", rusqlite::params![entry.path, id])?;
        self.index.execute(
            &format!("INSERT INTO notes ({ROW_COLUMNS}, title, size) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)"),
            rusqlite::params![
                id,
                entry.path,
                body,
                created_at,
                entry.modified_ms,
                front.text("source").unwrap_or_else(|| "editor".to_string()),
                front.flag("pinned") as i64,
                archived_at,
                id_in_file as i64,
                sidecar.recording_ms,
                sidecar.formatted_for,
                sidecar.formatted_model,
                prior_revision,
                title_of(body),
                entry.size as i64,
            ],
        )?;
        Ok(())
    }

    fn note_of(&self, row: Row, full: bool) -> Note {
        let sidecar = if full { self.sidecar(&row.id) } else { Sidecar::default() };
        Note {
            id: row.id,
            body: row.body,
            created_at: row.created_at,
            updated_at: row.modified_at,
            source: row.source,
            starred: row.pinned,
            archived_at: row.archived_at,
            recording_ms: row.recording_ms,
            segments: if full { sidecar.segments } else { None },
            formatted: if full { sidecar.formatted } else { None },
            formatted_for: row.formatted_for,
            formatted_model: row.formatted_model,
            path: Some(row.path),
            revision: row.revision,
        }
    }

    pub fn list_notes(&mut self) -> Result<Vec<Note>> {
        self.scan()?;
        let rows: Vec<Row> = {
            let mut stmt = self.index.prepare(&format!("SELECT {ROW_COLUMNS} FROM notes ORDER BY modified_at DESC, id"))?;
            let rows = stmt.query_map([], row_of)?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        Ok(rows.into_iter().map(|row| self.note_of(row, false)).collect())
    }

    pub fn get_note(&mut self, id: &str) -> Result<Option<Note>> {
        let Some(row) = self.row(id)? else { return Ok(self.drafts.get(id).cloned()) };
        // The file may have been changed, moved or removed by another app since the index last looked.
        if !self.vault.exists(&row.path) {
            self.scan()?;
            return Ok(self.row(id)?.map(|row| self.note_of(row, true)));
        }
        let text = self.vault.read(&row.path)?;
        let (_, body) = split(&text);
        if body != row.body {
            self.scan()?;
            return Ok(self.row(id)?.map(|row| self.note_of(row, true)));
        }
        Ok(Some(self.note_of(row, true)))
    }

    /// Writes `body` as the note's text. A new id is a new file in `Inbox/`; `source` is only read then.
    pub fn save_note(&mut self, id: &str, body: &str, source: &str) -> Result<Note> {
        let blank = body.trim().is_empty();
        let row = self.row(id)?;
        if blank {
            match &row {
                None => return Ok(self.draft(id, body, source)),
                Some(row) if self.drafted.contains(id) && self.undraftable(row)? => {
                    let draft = Note { source: row.source.clone(), created_at: row.created_at, ..self.draft(id, body, source) };
                    self.drafts.insert(id.to_string(), draft.clone());
                    self.delete_file(id, &row.path)?;
                    return Ok(draft);
                }
                Some(_) => {}
            }
        }
        let draft = self.drafts.remove(id);
        let stem = file_stem(&title_of(body));
        let (path, front, created_at, previous_text) = match row {
            Some(row) => {
                let text = self.vault.read(&row.path).unwrap_or_default();
                let (front, _) = split(&text);
                (row.path, front.unwrap_or_default(), row.created_at, Some(text))
            }
            None => {
                let source = draft.as_ref().map_or(source, |d| d.source.as_str());
                let mut front = FrontMatter::new();
                if source != "editor" {
                    front.set("source", Some(Value::Text(source.to_string())));
                }
                let name = unique_name(&stem, |name| self.vault.exists(&in_folder(INBOX, name)));
                (in_folder(INBOX, &name), front, draft.as_ref().map_or_else(now_ms, |d| d.created_at), None)
            }
        };
        let mut front = front;
        front.set("id", Some(Value::Text(id.to_string())));
        if front.get("created").is_none() {
            front.set("created", Some(Value::Text(iso(created_at))));
        }
        let mut path = path;
        if previous_text.is_some() && !named_for(&path, &stem) {
            let folder = folder_of(&path).to_string();
            let name = unique_name(&stem, |name| self.vault.exists(&in_folder(&folder, name)));
            let to = in_folder(&folder, &name);
            self.vault.rename(&path, &to)?;
            self.index.execute("UPDATE notes SET path = ?2 WHERE id = ?1", rusqlite::params![id, to])?;
            path = to;
        }
        let text = join(Some(&front), body);
        let entry = if previous_text.as_deref() == Some(text.as_str()) { None } else { Some(self.vault.write(&path, &text)?) };
        match entry {
            Some(entry) => self.index_file(&entry)?,
            None => {
                let entry = self.vault.stat(&path)?;
                self.index_file(&entry)?;
            }
        }
        self.row(id)?
            .map(|row| self.note_of(row, true))
            .ok_or_else(|| LibraryError::Index(rusqlite::Error::QueryReturnedNoRows))
    }

    /// Creates a note only while its id is unused. This is the only normal
    /// insertion path; queued writers use `update_note` and cannot recreate a
    /// deleted file.
    pub fn create_note(&mut self, id: &str, body: &str, source: &str) -> Result<Option<Note>> {
        if self.row(id)?.is_some() || self.drafts.contains_key(id) {
            return Ok(None);
        }
        self.save_note(id, body, source).map(Some)
    }

    /// Updates exactly the revision the caller read. Missing or changed notes
    /// are conflicts and never become new files.
    pub fn update_note(&mut self, id: &str, body: &str, expected_revision: i64) -> Result<Option<Note>> {
        let Some(current) = self.get_note(id)? else { return Ok(None) };
        if current.revision != expected_revision {
            return Ok(None);
        }
        let mut saved = self.save_note(id, body, &current.source)?;
        let revision = expected_revision.saturating_add(1);
        if saved.path.is_some() {
            self.index.execute("UPDATE notes SET revision = ?2 WHERE id = ?1", rusqlite::params![id, revision])?;
            saved = self.get_note(id)?.ok_or_else(|| LibraryError::Index(rusqlite::Error::QueryReturnedNoRows))?;
        } else if let Some(draft) = self.drafts.get_mut(id) {
            draft.revision = revision;
            saved = draft.clone();
        }
        Ok(Some(saved))
    }

    /// Applies a confirmed preview only while its exact base is current, then
    /// records enough for guarded undo.
    pub fn apply_command(&mut self, change: &CommandMutation) -> Result<CommandMutationResult> {
        let current = self.get_note(&change.note_id)?;
        let matches = match (&current, change.before_revision) {
            (None, None) => true,
            (Some(note), Some(revision)) => note.revision == revision && change.before_body.as_deref() == Some(note.body.as_str()),
            _ => false,
        };
        if !matches {
            return Ok(CommandMutationResult::Conflict { current });
        }
        let note = match change.before_revision {
            Some(revision) => self
                .update_note(&change.note_id, &change.after_body, revision)?
                .ok_or_else(|| LibraryError::Store("the note changed during the command".into()))?,
            None => self
                .create_note(&change.note_id, &change.after_body, &change.source)?
                .ok_or_else(|| LibraryError::Store("the note id already exists".into()))?,
        };
        self.index.execute(
            "INSERT INTO command_mutations
             (id, note_id, kind, before_body, after_body, before_revision, after_revision, created_at, undone_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL)",
            rusqlite::params![change.id, change.note_id, change.kind, change.before_body, change.after_body, change.before_revision, note.revision, now_ms()],
        )?;
        Ok(CommandMutationResult::Applied { mutation_id: change.id.clone(), note })
    }

    /// Reverses a command only while its exact result is still current.
    pub fn undo_command(&mut self, mutation_id: &str) -> Result<CommandUndoResult> {
        let record = self.index.query_row(
            "SELECT note_id, before_body, after_body, before_revision, after_revision, undone_at
             FROM command_mutations WHERE id = ?1",
            [mutation_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?, row.get::<_, String>(2)?, row.get::<_, Option<i64>>(3)?, row.get::<_, i64>(4)?, row.get::<_, Option<i64>>(5)?)),
        ).optional()?;
        let Some((note_id, before_body, after_body, before_revision, after_revision, undone_at)) = record else {
            return Ok(CommandUndoResult::NotFound);
        };
        if undone_at.is_some() {
            return Ok(CommandUndoResult::AlreadyUndone);
        }
        let current = self.get_note(&note_id)?;
        if !current.as_ref().is_some_and(|note| note.revision == after_revision && note.body == after_body) {
            return Ok(CommandUndoResult::Conflict { current });
        }
        let note = if let (Some(body), Some(_)) = (before_body, before_revision) {
            self.update_note(&note_id, &body, after_revision)?
        } else {
            self.delete_note(&note_id)?;
            None
        };
        self.index.execute(
            "UPDATE command_mutations SET undone_at = ?2 WHERE id = ?1",
            rusqlite::params![mutation_id, now_ms()],
        )?;
        Ok(CommandUndoResult::Undone { mutation_id: mutation_id.to_string(), note })
    }

    pub fn latest_command_undo(&mut self, max_age_ms: i64) -> Result<Option<PendingCommandUndo>> {
        let cutoff = now_ms().saturating_sub(max_age_ms.max(0));
        let rows: Vec<(String, String, String, i64, String, i64)> = {
            let mut stmt = self.index.prepare(
                "SELECT id, note_id, kind, created_at, after_body, after_revision
                 FROM command_mutations WHERE undone_at IS NULL AND created_at >= ?1
                 ORDER BY created_at DESC, id DESC",
            )?;
            let mapped = stmt.query_map([cutoff], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)))?;
            mapped.collect::<rusqlite::Result<_>>()?
        };
        for (mutation_id, note_id, kind, created_at, after_body, after_revision) in rows {
            if self.get_note(&note_id)?.is_some_and(|note| note.revision == after_revision && note.body == after_body) {
                return Ok(Some(PendingCommandUndo { mutation_id, note_id, kind, created_at }));
            }
        }
        Ok(None)
    }

    /// A blank note with no file, held until it has words.
    fn draft(&mut self, id: &str, body: &str, source: &str) -> Note {
        let now = now_ms();
        let draft = self.drafts.entry(id.to_string()).or_insert_with(|| Note {
            id: id.to_string(),
            body: String::new(),
            created_at: now,
            updated_at: now,
            source: source.to_string(),
            starred: false,
            archived_at: None,
            recording_ms: None,
            segments: None,
            formatted: None,
            formatted_for: None,
            formatted_model: None,
            path: None,
            revision: 1,
        });
        draft.body = body.to_string();
        draft.updated_at = now;
        let draft = draft.clone();
        self.drafted.insert(id.to_string());
        draft
    }

    /// Whether a note's file holds nothing a person set: no pin, no archive,
    /// no recording or formatting, no front matter but what a new note is given.
    fn undraftable(&self, row: &Row) -> Result<bool> {
        if row.pinned || row.archived_at.is_some() || !self.sidecar(&row.id).is_empty() {
            return Ok(false);
        }
        let text = self.vault.read(&row.path)?;
        let (front, _) = split(&text);
        Ok(front.is_none_or(|front| front.only(&["id", "created", "source"])))
    }

    /// A draft pinned, archived or given a recording becomes a file, even without words.
    fn written(&mut self, id: &str) -> Result<bool> {
        if self.row(id)?.is_some() {
            return Ok(true);
        }
        let Some(draft) = self.drafts.get(id).cloned() else { return Ok(false) };
        self.drafted.remove(id);
        self.drafts.remove(id);
        let mut front = FrontMatter::new();
        if draft.source != "editor" {
            front.set("source", Some(Value::Text(draft.source.clone())));
        }
        front.set("id", Some(Value::Text(id.to_string())));
        front.set("created", Some(Value::Text(iso(draft.created_at))));
        let name = unique_name(&file_stem(&title_of(&draft.body)), |name| self.vault.exists(&in_folder(INBOX, name)));
        let entry = self.vault.write(&in_folder(INBOX, &name), &join(Some(&front), &draft.body))?;
        self.index_file(&entry)?;
        Ok(true)
    }

    fn delete_file(&mut self, id: &str, path: &str) -> Result<()> {
        self.vault.remove(path)?;
        if let Some(sidecar) = self.sidecar_path(id) {
            let _ = std::fs::remove_file(sidecar);
        }
        self.index.execute("DELETE FROM notes WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn delete_note(&mut self, id: &str) -> Result<bool> {
        self.drafted.remove(id);
        let Some(row) = self.row(id)? else { return Ok(self.drafts.remove(id).is_some()) };
        self.delete_file(id, &row.path)?;
        Ok(true)
    }

    pub fn image_in_use(&self, name: &str) -> Result<bool> {
        let needle = format!("(image/{name})");
        Ok(self.index.query_row("SELECT EXISTS(SELECT 1 FROM notes WHERE instr(body, ?1) > 0)", [needle], |row| row.get::<_, i64>(0))? != 0)
    }

    /// Changes front matter only, keeping the file's modified time: a pin is not an edit.
    fn set_front(&mut self, id: &str, change: impl FnOnce(&mut FrontMatter)) -> Result<Option<Note>> {
        self.written(id)?;
        let Some(row) = self.row(id)? else { return Ok(None) };
        let text = self.vault.read(&row.path)?;
        let (front, body) = split(&text);
        let mut front = front.unwrap_or_default();
        change(&mut front);
        let written = join(Some(&front), body);
        if written != text {
            let entry = self.vault.write(&row.path, &written)?;
            let kept = self.vault.keep_modified(&row.path, row.modified_at).unwrap_or(entry);
            self.index_file(&kept)?;
        }
        self.get_note(id)
    }

    pub fn set_starred(&mut self, id: &str, starred: bool) -> Result<Option<Note>> {
        self.set_front(id, |front| front.set("pinned", starred.then_some(Value::Bool(true))))
    }

    pub fn set_archived(&mut self, id: &str, archived: bool) -> Result<Option<Note>> {
        let at = archived.then(|| Value::Text(iso(now_ms())));
        self.set_front(id, |front| front.set("archived", at))
    }

    pub fn set_recording(&mut self, id: &str, recording: Option<&Recording>) -> Result<Option<Note>> {
        if !self.written(id)? {
            return Ok(None);
        }
        let mut sidecar = self.sidecar(id);
        sidecar.recording_ms = recording.map(|r| r.ms());
        sidecar.segments = recording.map(|r| r.segments().to_vec());
        self.write_sidecar(id, &sidecar)?;
        self.index.execute("UPDATE notes SET recording_ms = ?2 WHERE id = ?1", rusqlite::params![id, sidecar.recording_ms])?;
        self.get_note(id)
    }

    pub fn set_formatted(&mut self, id: &str, formatted: Option<&str>, formatted_for: Option<i64>, model: Option<&str>) -> Result<Option<Note>> {
        if !self.written(id)? {
            return Ok(None);
        }
        let mut sidecar = self.sidecar(id);
        sidecar.formatted = formatted.map(str::to_string);
        sidecar.formatted_for = formatted_for;
        sidecar.formatted_model = model.map(str::to_string);
        self.write_sidecar(id, &sidecar)?;
        self.index.execute("UPDATE notes SET formatted_for = ?2, formatted_model = ?3 WHERE id = ?1", rusqlite::params![id, formatted_for, model])?;
        self.get_note(id)
    }

    /// Every note gone: the files, what isn't text, the index. For a reset of a library in the app's own storage.
    pub fn clear(&mut self) -> Result<()> {
        for entry in self.vault.markdown()? {
            self.vault.remove(&entry.path)?;
        }
        let notes = self.vault.glyph_dir().join("notes");
        let _ = std::fs::remove_dir_all(&notes);
        std::fs::create_dir_all(&notes)?;
        self.index.execute("DELETE FROM notes", [])?;
        self.drafts.clear();
        self.drafted.clear();
        Ok(())
    }

    /// A note exactly as another device has it (docs/SYNC.md): its words, times,
    /// pin, archive, source, recording phrases and formatted version, in the
    /// folder it is in there when that folder is free here. Unlike a save, the
    /// times are the note's own: a note synced in is not a note edited now.
    /// Front matter this device added that Glyph doesn't manage stays.
    pub fn apply_note(&mut self, note: &Note) -> Result<Note> {
        self.drafts.remove(&note.id);
        self.drafted.remove(&note.id);
        let stem = file_stem(&title_of(&note.body));
        let wanted = note.path.as_deref().filter(|p| library_path(p));
        let (mut path, front) = match self.row(&note.id)? {
            Some(row) => {
                let text = self.vault.read(&row.path).unwrap_or_default();
                (row.path, split(&text).0.unwrap_or_default())
            }
            None => {
                let folder = wanted.map_or(INBOX, folder_of).to_string();
                let name = unique_name(&stem, |name| self.vault.exists(&in_folder(&folder, name)));
                (in_folder(&folder, &name), FrontMatter::new())
            }
        };
        match wanted {
            Some(to) if to != path && !self.vault.exists(to) => {
                if self.vault.exists(&path) {
                    self.vault.rename(&path, to)?;
                }
                path = to.to_string();
            }
            _ if !named_for(&path, &stem) => {
                let folder = folder_of(&path).to_string();
                let name = unique_name(&stem, |name| self.vault.exists(&in_folder(&folder, name)));
                let to = in_folder(&folder, &name);
                if self.vault.exists(&path) {
                    self.vault.rename(&path, &to)?;
                }
                path = to;
            }
            _ => {}
        }
        let mut front = front;
        front.set("id", Some(Value::Text(note.id.clone())));
        front.set("created", Some(Value::Text(iso(note.created_at))));
        front.set("source", (note.source != "editor").then(|| Value::Text(note.source.clone())));
        front.set("pinned", note.starred.then_some(Value::Bool(true)));
        front.set("archived", note.archived_at.map(|at| Value::Text(iso(at))));
        self.vault.write(&path, &join(Some(&front), &note.body))?;
        self.write_sidecar(
            &note.id,
            &Sidecar {
                recording_ms: note.recording_ms,
                segments: note.segments.clone(),
                formatted: note.formatted.clone(),
                formatted_for: note.formatted_for,
                formatted_model: note.formatted_model.clone(),
            },
        )?;
        let entry = self.vault.keep_modified(&path, note.updated_at)?;
        self.index_file(&entry)?;
        self.index.execute("UPDATE notes SET revision = ?2 WHERE id = ?1", rusqlite::params![note.id, note.revision])?;
        self.row(&note.id)?
            .map(|row| self.note_of(row, true))
            .ok_or_else(|| LibraryError::Index(rusqlite::Error::QueryReturnedNoRows))
    }

    pub fn append_capture(&mut self, body: &str, source: &str) -> Result<Note> {
        self.create_note(&uuid::Uuid::new_v4().to_string(), body, source)?
            .ok_or_else(|| LibraryError::Store("a generated note id already exists".into()))
    }

    // ---- moving in from the old database -----------------------------------------------------

    fn manifest(&self) -> Manifest {
        std::fs::read_to_string(self.vault.glyph_dir().join("library.json")).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
    }

    /// Whether the old database's notes were already written out.
    pub fn moved_in(&self) -> bool {
        self.manifest().moved_from.is_some()
    }

    /// Every note of the old database as a file in `Inbox/`, keeping its id, times, pin, archive, source,
    /// recording phrases and formatted version. A note already in the library is left alone, so a move
    /// that stopped halfway finishes the next time. Answers how many notes are in the library from it.
    pub fn move_in(&mut self, old: &Store) -> Result<usize> {
        let notes = old.list_notes().map_err(|e| LibraryError::Store(e.to_string()))?;
        let mut moved = 0;
        for listed in notes {
            if self.row(&listed.id)?.is_some() {
                moved += 1;
                continue;
            }
            let Some(note) = old.get_note(&listed.id).map_err(|e| LibraryError::Store(e.to_string()))? else { continue };
            // The old app saved a new note the moment it opened, so a note opened and left
            // has no words and nothing set: it isn't brought in as an empty "Untitled.md".
            let untouched = note.body.trim().is_empty() && !note.starred && note.archived_at.is_none() && note.recording_ms.is_none() && note.formatted.is_none();
            if untouched {
                continue;
            }
            let mut front = FrontMatter::new();
            front.set("id", Some(Value::Text(note.id.clone())));
            front.set("created", Some(Value::Text(iso(note.created_at))));
            if note.source != "editor" {
                front.set("source", Some(Value::Text(note.source.clone())));
            }
            if note.starred {
                front.set("pinned", Some(Value::Bool(true)));
            }
            if let Some(at) = note.archived_at {
                front.set("archived", Some(Value::Text(iso(at))));
            }
            let stem = file_stem(&title_of(&note.body));
            let name = unique_name(&stem, |name| self.vault.exists(&in_folder(INBOX, name)));
            let path = in_folder(INBOX, &name);
            self.vault.write(&path, &join(Some(&front), &note.body))?;
            let sidecar = Sidecar {
                recording_ms: note.recording_ms,
                segments: note.segments.clone(),
                formatted: note.formatted.clone(),
                formatted_for: note.formatted_for,
                formatted_model: note.formatted_model.clone(),
            };
            self.write_sidecar(&note.id, &sidecar)?;
            // The list keeps its order: the file says it was last changed when the note was.
            let entry = self.vault.keep_modified(&path, note.updated_at)?;
            self.index_file(&entry)?;
            moved += 1;
        }
        Ok(moved)
    }

    /// Records that the old database was moved in, so it is never moved twice.
    pub fn mark_moved_in(&self, from: &str, notes: usize) -> Result<()> {
        let mut manifest = self.manifest();
        if manifest.version == 0 {
            manifest.version = 1;
            manifest.created = iso(now_ms());
        }
        manifest.moved_from = Some(from.to_string());
        manifest.moved_notes = Some(notes);
        std::fs::write(self.vault.glyph_dir().join("library.json"), serde_json::to_string_pretty(&manifest).unwrap_or_default())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests;
