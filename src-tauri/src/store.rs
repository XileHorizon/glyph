//! The notes: SQLite on disk, and NOT ONE `tauri::` TYPE IN THIS FILE.
//!
//! `commands.rs` owns the seam a webview reaches through, and
//! `src/app/core/store.ts` owns the page's idea of a note. This module owns
//! the notes themselves - the file, the schema inside it, and every statement
//! that touches either - and it knows nothing whatever about the process it is
//! running in.
//!
//! That last part is load-bearing, and it is worth spelling out because the
//! obvious tidy-up breaks it. DESIGN section 6.1 planned for the side-key
//! capture to run in a separate process with no webview and no `tauri::Builder`,
//! writing its transcript by calling `append_capture` over JNI. That is not how
//! capture shipped - it runs in the app's own page (section 13) - but keeping
//! this module free of Tauri keeps that door open, and the update-alert worker
//! (update_alerts.rs) now walks through the same kind of door for `ota`. A `tauri::AppHandle` parameter anywhere in here would mean that
//! process cannot link the one function it exists to call - and the tempting
//! one is the convenience: an `open` that took a handle and found the app data
//! directory by itself. So the CALLER supplies the path instead. The command
//! layer resolves `app_data_dir()`, the capture service resolves its own
//! `filesDir` from Java, and neither has to agree with the other about how a
//! directory is found - only about which file it holds.
//!
//! Two processes writing one SQLite file is also why `open` sets
//! `journal_mode=WAL` and a busy timeout. WAL lets the reader in the app keep
//! drawing the list while the capture service commits a note, and the timeout
//! is what turns "the other process is mid-commit" from an error the page has
//! to explain into a wait nobody notices.
//!
//! What is deliberately NOT here: no debounce (the page owns that - DESIGN
//! section 5 debounces a save 400 ms after the last keystroke and this module
//! writes the moment it is asked), no background thread, no path discovery,
//! no JSON, and no idea which note is on screen.

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// How long a statement waits for the other process to let go of the write
/// lock before it gives up.
///
/// Five seconds is far longer than any write here can take - every statement
/// in this module is one row and there are no transactions held open across a
/// call - so in practice this is never reached. It is sized for the case it
/// exists for: the capture service committing a transcript at the same moment
/// the app saves a keystroke debounce, on a phone whose storage has just been
/// woken. The alternative to waiting is handing the page an
/// `SQLITE_BUSY` it can do nothing with except try again itself, more slowly
/// and with worse manners.
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

/// The columns every read in this module selects, in the order `row_to_note`
/// unpacks them.
///
/// One constant rather than the same five names written out four times: a
/// SELECT that grows a column in one query and not the others fails at the far
/// end of an `invoke`, in a `row_to_note` that is reading the wrong index,
/// which is a long way from the edit that caused it.
const NOTE_COLUMNS: &str = "id, body, created_at, updated_at, source, starred, archived_at, recording_ms, segments, formatted, formatted_for, formatted_model, revision";

/// `NOTE_COLUMNS` for the list: the same shape, with `segments` read as NULL.
/// A recording's segments are the text of every phrase with its timing - about
/// 10 KB for ten minutes of talk - and the list is fetched every time the app
/// comes to the front. The tapes need only the length; the player asks for
/// one note, and gets its segments from `get_note`.
const LIST_COLUMNS: &str = "id, body, created_at, updated_at, source, starred, archived_at, recording_ms, NULL, NULL, formatted_for, formatted_model, revision";

/// The schema, exactly as DESIGN.md section 5 specifies it, applied on every
/// open.
///
/// `IF NOT EXISTS` rather than a version table and a migration step, because
/// there is no leader here to run the migration. The app and the capture
/// service each open this file whenever the OS wakes them, in either order,
/// and quite possibly at the same moment; a step that has to happen exactly
/// once needs somebody to be first, and nobody is. When the schema does have
/// to change, this is where that argument gets made, and it will have to be
/// made in statements a second opener can repeat harmlessly.
///
/// `captures` is created even though nothing in this build reads it. Having
/// the table already standing is cheaper than two processes racing to create
/// it on the evening milestone 6 lands, and an empty table costs a page.
///
/// The index exists because the list screen is the app's front door and it is
/// ALWAYS `ORDER BY updated_at DESC`. Without it that is a full sort of the
/// table every time the app is resumed.
const SCHEMA: &str = "
    CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        body TEXT NOT NULL,
        created_at INTEGER,
        updated_at INTEGER,
        source TEXT
    );
    CREATE TABLE IF NOT EXISTS captures (
        id TEXT PRIMARY KEY,
        note_id TEXT,
        audio_path TEXT,
        model TEXT,
        duration_ms INTEGER,
        state TEXT
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
    CREATE INDEX IF NOT EXISTS notes_updated_at ON notes (updated_at DESC);
    CREATE INDEX IF NOT EXISTS command_mutations_note ON command_mutations (note_id, created_at DESC);
";

/// Columns added after the first schema, each with the DDL that adds it.
///
/// This is where `SCHEMA`'s argument ("statements a second opener can repeat
/// harmlessly") gets made for the first time. SQLite has no `ADD COLUMN IF NOT
/// EXISTS`, so each is added only when `PRAGMA table_info` says it is missing -
/// and a "duplicate column" error is taken as success, because it means another
/// opener added it between our look and our statement. Every added column is
/// NULLable or has a DEFAULT, so a row written by a build that has never heard
/// of it still reads back.
///
/// - `starred`: pinned to the top of the list by a swipe (0.3.2).
/// - `archived_at`: when it was swiped away into the archive, NULL for a note
///   in the list. A time rather than a flag so the archive can sort by it.
/// - `formatted`: the version the on-device model wrote from the body -
///   expanded, reorganised, as markdown (0.4.0; retired in 0.6.0; back in
///   0.9.0). The body is never touched by it.
/// - `formatted_for`: a hash of the exact body `formatted` was made from, so
///   the page can tell a formatted version is stale once the note is edited.
///   The page computes it; this column only keeps it.
/// - `project_id`: RETIRED with 0.6.0 (the project a note was formatted with).
///   Still added, so a database any build opens has the same shape; never read.
/// - `formatted_model`: which model wrote `formatted` (0.9.0), for the line
///   under the Formatted view.
/// - `recording_ms`: how long the kept recording of a spoken note is, NULL for a
///   note with none (0.6.0). The audio itself is a file beside the database,
///   `recordings/<id>.wav`, written by the capture layer; see `recording_file`.
/// - `segments`: the recording's committed phrases as JSON,
///   `[{"text", "startMs", "endMs"}]`, so the player can follow the words.
const ADDED_COLUMNS: &[(&str, &str)] = &[
    ("starred", "ALTER TABLE notes ADD COLUMN starred INTEGER NOT NULL DEFAULT 0"),
    ("archived_at", "ALTER TABLE notes ADD COLUMN archived_at INTEGER"),
    ("formatted", "ALTER TABLE notes ADD COLUMN formatted TEXT"),
    ("formatted_for", "ALTER TABLE notes ADD COLUMN formatted_for INTEGER"),
    ("project_id", "ALTER TABLE notes ADD COLUMN project_id TEXT"),
    ("recording_ms", "ALTER TABLE notes ADD COLUMN recording_ms INTEGER"),
    ("segments", "ALTER TABLE notes ADD COLUMN segments TEXT"),
    ("formatted_model", "ALTER TABLE notes ADD COLUMN formatted_model TEXT"),
    ("revision", "ALTER TABLE notes ADD COLUMN revision INTEGER NOT NULL DEFAULT 1"),
];

fn add_missing_columns(conn: &Connection) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare("PRAGMA table_info(notes)")?;
    let present: Vec<String> = stmt.query_map([], |row| row.get::<_, String>(1))?.collect::<rusqlite::Result<_>>()?;
    for (column, ddl) in ADDED_COLUMNS {
        if present.iter().any(|p| p == column) {
            continue;
        }
        match conn.execute(ddl, []) {
            Ok(_) => {}
            Err(rusqlite::Error::SqliteFailure(_, Some(message))) if message.contains("duplicate column") => {}
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

/// What can go wrong in here, which is SQLite and nothing else.
///
/// A hand-written enum rather than `thiserror`, which is already in this tree
/// twice (1.0.69 and 2.0.20, both arriving under tauri) and would therefore
/// compile no new code. It would still put a derive macro between the reader
/// and two `write!` calls, and the entire error surface of this module is two
/// variants that differ only in which sentence a person should read first: the
/// database would not open at all, or one statement failed. A dependency that
/// saves four lines and costs a layer of indirection is not a saving.
///
/// Both variants carry the `rusqlite::Error` rather than a flattened string,
/// so a caller that wants to tell `SQLITE_BUSY` from a corrupt file still can.
/// The command layer does not - it calls `to_string()` - but the JNI entry
/// point will need to know whether retrying is worth anything.
#[derive(Debug)]
pub enum StoreError {
    /// The file could not be opened, or the schema could not be applied to it.
    /// Nothing else in the module can have run.
    Open(rusqlite::Error),
    /// One statement failed against a database that opened cleanly.
    Query(rusqlite::Error),
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StoreError::Open(e) => write!(f, "the notes database could not be opened: {e}"),
            StoreError::Query(e) => write!(f, "the notes database refused a statement: {e}"),
        }
    }
}

impl std::error::Error for StoreError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            StoreError::Open(e) | StoreError::Query(e) => Some(e),
        }
    }
}

/// `?` inside this module means `Query`, and `open` says `Open` by hand.
///
/// The conversion is deliberately one-directional like this rather than
/// symmetric: there are two dozen fallible statements and exactly one open, so
/// the common case is the one that gets the operator and the rare case is the
/// one that gets spelled out.
impl From<rusqlite::Error> for StoreError {
    fn from(error: rusqlite::Error) -> Self {
        StoreError::Query(error)
    }
}

pub type Result<T> = std::result::Result<T, StoreError>;

/// One note, in the shape the page already expects.
///
/// The `camelCase` rename is the reason this is a struct and not a row. SQLite
/// spells a column `created_at`, TypeScript reads `createdAt`, and the
/// translation happens once here instead of in the command layer, the page's
/// `store.ts`, and again in the localStorage fallback that has to produce the
/// identical shape for `npm run dev` in a browser (DESIGN section 5). Three
/// copies of a naming convention is three chances for one of them to drift.
///
/// `Deserialize` is not for the page - nothing sends a note back in whole -
/// but for the localStorage fallback's fixtures and for the capture service,
/// which will hand a note across the JNI boundary as JSON because that is the
/// only shape both sides of it agree on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub body: String,
    /// Milliseconds since the epoch. Set once, when the note is first written.
    pub created_at: i64,
    /// Milliseconds since the epoch. Moved by every save.
    pub updated_at: i64,
    /// Where the note came from - "editor", "capture", and whatever the side
    /// key learns to say about itself. A birth fact: see `create_note`.
    pub source: String,
    /// Pinned to the top of the list.
    pub starred: bool,
    /// Milliseconds since the epoch when archived; `None` for a note in the list.
    pub archived_at: Option<i64>,
    /// The length of the note's kept recording; `None` when it has none.
    pub recording_ms: Option<i64>,
    /// The recording's phrases and their timing. Only `get_note` fills this;
    /// in `list_notes` it is always `None` (see `LIST_COLUMNS`).
    pub segments: Option<Vec<RecordedSegment>>,
    /// The on-device model's version of the body. Only `get_note` fills this;
    /// the list carries `formatted_for` and `formatted_model` and not the text.
    pub formatted: Option<String>,
    /// The page's hash of the body `formatted` was written from.
    pub formatted_for: Option<i64>,
    /// The model that wrote it, by the page's id.
    pub formatted_model: Option<String>,
    /// Where the note's file is in the library (library/), relative to it: `Inbox/AttackFM.md`.
    /// None for a note read from the old database.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// Monotonic body version. Command mutations compare this before writing,
    /// so a preview can never overwrite an edit made after it was shown.
    #[serde(default = "default_revision")]
    pub revision: i64,
}

fn default_revision() -> i64 {
    1
}

/// One atomic command write. `before_revision = None` creates a note; a
/// number updates exactly that version. The caller supplies final Markdown,
/// but only deterministic application code is allowed to construct it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandMutation {
    pub id: String,
    pub note_id: String,
    pub kind: String,
    pub before_revision: Option<i64>,
    pub before_body: Option<String>,
    pub after_body: String,
    pub source: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum CommandMutationResult {
    Applied { mutation_id: String, note: Note },
    Conflict { current: Option<Note> },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum CommandUndoResult {
    Undone { mutation_id: String, note: Option<Note> },
    Conflict { current: Option<Note> },
    AlreadyUndone,
    NotFound,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingCommandUndo {
    pub mutation_id: String,
    pub note_id: String,
    pub kind: String,
    pub created_at: i64,
}

/// One committed phrase of a recording, as the page's `Segment` has it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordedSegment {
    pub text: String,
    pub start_ms: u64,
    pub end_ms: u64,
}

/// A recording's length and phrases, checked. Only [`Recording::new`] makes
/// one, so the store never holds a recording that is not.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Recording {
    ms: i64,
    segments: Vec<RecordedSegment>,
}

/// A day of audio. A capture is minutes; this only refuses nonsense.
const MAX_RECORDING_MS: i64 = 24 * 60 * 60 * 1000;
/// Ten hours at the engine's phrase rate, far past any note.
const MAX_SEGMENTS: usize = 20_000;
const MAX_SEGMENT_CHARS: usize = 10_000;

impl Recording {
    pub fn new(ms: i64, segments: Vec<RecordedSegment>) -> std::result::Result<Recording, String> {
        if !(0..=MAX_RECORDING_MS).contains(&ms) {
            return Err(format!("a recording of {ms} ms is not a length"));
        }
        if segments.len() > MAX_SEGMENTS {
            return Err(format!("{} segments is more than a recording can have", segments.len()));
        }
        for (index, segment) in segments.iter().enumerate() {
            if segment.start_ms > segment.end_ms {
                return Err(format!("segment {index} ends before it starts"));
            }
            if segment.text.chars().count() > MAX_SEGMENT_CHARS {
                return Err(format!("segment {index} is too long to be one phrase"));
            }
        }
        Ok(Recording { ms, segments })
    }

    /// The recording's length in milliseconds.
    pub fn ms(&self) -> i64 {
        self.ms
    }

    /// Its phrases, in order.
    pub fn segments(&self) -> &[RecordedSegment] {
        &self.segments
    }
}

/// Where note `id`'s recording lives inside `recordings`, or `None` for an id
/// that is not a plain name. Ids reach this from the page, and one that is not
/// letters, digits, `-` and `_` - a `../`, a slash - must never become a path
/// to write or delete.
pub fn recording_file(recordings: &Path, id: &str) -> Option<std::path::PathBuf> {
    let plain = !id.is_empty() && id.len() <= 128 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    plain.then(|| recordings.join(format!("{id}.wav")))
}

/// The wall clock in milliseconds, which is what a phone's list of notes
/// actually sorts by.
///
/// Milliseconds rather than seconds because two saves a second apart are
/// common and two saves in the same second are not rare - a debounced editor
/// save landing next to a capture is exactly that. Milliseconds are not fine
/// enough to separate two writes inside one tick either, which is why
/// `list_notes` carries a tiebreak and why the tests in this file space their
/// writes deliberately.
///
/// A clock set before 1970 answers 0 rather than panicking. That is a phone
/// with no battery-backed clock at first boot, and the honest outcome is a
/// note that sorts to the bottom until it is next edited, not a capture
/// service that dies holding a transcript.
fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|since| since.as_millis() as i64)
        .unwrap_or(0)
}

/// A fresh note id: a UUIDv4, in the hyphenated form the page compares as a
/// string.
///
/// Random, not sequential and not time-based, because the capture process
/// mints ids without ever asking the app what the last one was - there is no
/// shared counter to ask. Nothing may read meaning out of an id; the order is
/// `updated_at`'s job.
fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Unpacks a row selected as `NOTE_COLUMNS`.
///
/// `created_at`, `updated_at` and `source` are nullable in the schema (that is
/// DESIGN section 5's DDL, kept verbatim) even though nothing in this module
/// ever writes a NULL into them. Reading them as optional and defaulting is
/// three characters of tolerance that keeps a row written by some future
/// migration - or by hand, during a capture bring-up - from failing the whole
/// list.
fn row_to_note(row: &rusqlite::Row<'_>) -> rusqlite::Result<Note> {
    Ok(Note {
        id: row.get(0)?,
        body: row.get(1)?,
        created_at: row.get::<_, Option<i64>>(2)?.unwrap_or(0),
        updated_at: row.get::<_, Option<i64>>(3)?.unwrap_or(0),
        source: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
        starred: row.get::<_, Option<i64>>(5)?.unwrap_or(0) != 0,
        archived_at: row.get::<_, Option<i64>>(6)?,
        recording_ms: row.get::<_, Option<i64>>(7)?,
        // Unreadable JSON reads as no segments rather than failing the note:
        // the words are in the body either way.
        segments: row
            .get::<_, Option<String>>(8)?
            .and_then(|json| serde_json::from_str(&json).ok()),
        formatted: row.get::<_, Option<String>>(9)?,
        formatted_for: row.get::<_, Option<i64>>(10)?,
        formatted_model: row.get::<_, Option<String>>(11)?,
        path: None,
        revision: row.get::<_, Option<i64>>(12)?.unwrap_or(1),
    })
}

/// An open database, and the only thing in this module that holds state.
pub struct Store {
    conn: Connection,
}

impl Store {
    /// Opens (creating if absent) the database at `path` and makes sure the
    /// schema is there.
    ///
    /// The path is a parameter rather than something this function works out,
    /// and that is the module header's whole argument in one signature: the
    /// app passes `<app_data_dir>/glyph.sqlite`, the Android capture service
    /// passes a path it derived from `filesDir` in Java, and this function
    /// cannot tell which of them called it.
    ///
    /// WAL is asked for with a query rather than a `PRAGMA` execute because
    /// `journal_mode` answers with a row, and an unconsumed row is an error in
    /// rusqlite. The answer is then not checked, on purpose: a filesystem that
    /// cannot support WAL (no shared memory - a network mount, some sandboxed
    /// container) leaves SQLite on a rollback journal, where the two writers
    /// still take turns correctly through `BUSY_TIMEOUT`, just less
    /// concurrently. Refusing to open the notes at all over that would trade a
    /// slower app for no app.
    ///
    /// The schema is applied on every open, not on first run. See `SCHEMA`.
    pub fn open(path: &Path) -> Result<Store> {
        let conn = Connection::open(path).map_err(StoreError::Open)?;
        conn.query_row("PRAGMA journal_mode=WAL", [], |row| row.get::<_, String>(0))
            .map_err(StoreError::Open)?;
        conn.busy_timeout(BUSY_TIMEOUT).map_err(StoreError::Open)?;
        conn.execute_batch(SCHEMA).map_err(StoreError::Open)?;
        add_missing_columns(&conn).map_err(StoreError::Open)?;
        Ok(Store { conn })
    }

    /// Every note, newest edit first.
    ///
    /// The ordering is not a convenience for one caller, it is the list
    /// screen's only order, which is why the index in `SCHEMA` matches it
    /// exactly. `id` breaks a tie so that a list drawn twice from unchanged
    /// data is the same list; two notes saved inside one millisecond would
    /// otherwise come back in whatever order the page cache happened to be
    /// holding them, and a row that swaps places on a refresh looks like a bug
    /// to the person watching it.
    ///
    /// Whole bodies, not previews. A `substr` here is the obvious economy and
    /// it is deliberately not taken: v1 has one list with no paging, and a
    /// store that hands back half a note is a store whose every caller has to
    /// remember which half it is holding. The moment a real library is
    /// measured slow this is the first place to look - and the fix is a
    /// preview column, with `get_note` already standing to fetch the rest.
    pub fn list_notes(&self) -> Result<Vec<Note>> {
        let sql = format!("SELECT {LIST_COLUMNS} FROM notes ORDER BY updated_at DESC, id");
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map([], row_to_note)?;
        let mut notes = Vec::new();
        for note in rows {
            notes.push(note?);
        }
        Ok(notes)
    }

    /// One note, or `None` when nothing answers to that id.
    ///
    /// A missing note is `None` rather than an error because the caller asking
    /// is usually holding a stale list: the capture service can delete nothing,
    /// but a second window, a restore, or the user on another screen can, and
    /// "it is not there" is an answer the page can draw. An error would make
    /// the routine case indistinguishable from a database that has actually
    /// broken.
    pub fn get_note(&self, id: &str) -> Result<Option<Note>> {
        let sql = format!("SELECT {NOTE_COLUMNS} FROM notes WHERE id = ?1");
        let note = self
            .conn
            .query_row(&sql, [id], row_to_note)
            .optional()?;
        Ok(note)
    }

    /// Creates a note only while its id is unused. Existing-note writers must
    /// call [`Store::update_note`]: separating birth from update is what makes
    /// deletion final. A stale editor, capture draft, or refine job can still
    /// hold an id after the row is deleted, but it has no API that can insert
    /// that id again.
    ///
    /// `created_at` and `source` are facts about this birth. `update_note`
    /// changes neither, so a note dictated at the side key still says it came
    /// from capture after it is edited in the app.
    pub fn create_note(&self, id: &str, body: &str, source: &str) -> Result<Option<Note>> {
        let now = now_ms();
        let inserted = self.conn.execute(
            "INSERT INTO notes (id, body, created_at, updated_at, source)
             VALUES (?1, ?2, ?3, ?3, ?4)
             ON CONFLICT(id) DO NOTHING",
            rusqlite::params![id, body, now, source],
        )?;
        if inserted == 0 { return Ok(None); }
        self.get_note(id)
    }

    /// Updates exactly the revision an existing writer read. Missing and
    /// changed rows both answer `None`; neither case inserts. In particular,
    /// a queued autosave that wakes after Delete cannot resurrect the note.
    pub fn update_note(&self, id: &str, body: &str, expected_revision: i64) -> Result<Option<Note>> {
        let changed = self.conn.execute(
            "UPDATE notes SET body = ?2, updated_at = ?3, revision = revision + 1
             WHERE id = ?1 AND revision = ?4",
            rusqlite::params![id, body, now_ms(), expected_revision],
        )?;
        if changed == 0 { return Ok(None); }
        self.get_note(id)
    }

    /// Fixture convenience; absent from production so app code cannot upsert.
    #[cfg(test)]
    pub(crate) fn save_note(&self, id: &str, body: &str, source: &str) -> Result<Note> {
        if let Some(current) = self.get_note(id)? {
            return self.update_note(id, body, current.revision)?
                .ok_or_else(|| StoreError::Query(rusqlite::Error::QueryReturnedNoRows));
        }
        self.create_note(id, body, source)?
            .ok_or_else(|| StoreError::Query(rusqlite::Error::QueryReturnedNoRows))
    }

    /// Applies a confirmed command and records enough to undo it after a
    /// restart. The note write and undo record commit together.
    pub fn apply_command(&self, change: &CommandMutation) -> Result<CommandMutationResult> {
        let tx = self.conn.unchecked_transaction()?;
        let current = {
            let sql = format!("SELECT {NOTE_COLUMNS} FROM notes WHERE id = ?1");
            tx.query_row(&sql, [&change.note_id], row_to_note).optional()?
        };
        let matches = match (&current, change.before_revision) {
            (None, None) => true,
            (Some(note), Some(expected)) => note.revision == expected && change.before_body.as_deref() == Some(note.body.as_str()),
            _ => false,
        };
        if !matches {
            return Ok(CommandMutationResult::Conflict { current });
        }

        let now = now_ms();
        let after_revision = change.before_revision.unwrap_or(0) + 1;
        match &current {
            Some(_) => {
                let changed = tx.execute(
                    "UPDATE notes SET body = ?2, updated_at = ?3, revision = ?4 WHERE id = ?1 AND revision = ?5",
                    rusqlite::params![change.note_id, change.after_body, now, after_revision, change.before_revision],
                )?;
                if changed != 1 {
                    return Ok(CommandMutationResult::Conflict { current: self.get_note(&change.note_id)? });
                }
            }
            None => {
                tx.execute(
                    "INSERT INTO notes (id, body, created_at, updated_at, source, revision) VALUES (?1, ?2, ?3, ?3, ?4, ?5)",
                    rusqlite::params![change.note_id, change.after_body, now, change.source, after_revision],
                )?;
            }
        }
        tx.execute(
            "INSERT INTO command_mutations
             (id, note_id, kind, before_body, after_body, before_revision, after_revision, created_at, undone_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL)",
            rusqlite::params![
                change.id,
                change.note_id,
                change.kind,
                change.before_body,
                change.after_body,
                change.before_revision,
                after_revision,
                now
            ],
        )?;
        tx.commit()?;
        let note = self.get_note(&change.note_id)?.ok_or_else(|| StoreError::Query(rusqlite::Error::QueryReturnedNoRows))?;
        Ok(CommandMutationResult::Applied { mutation_id: change.id.clone(), note })
    }

    /// Reverses a command only while its exact result is still current. A
    /// later editor save or command turns Undo into a conflict, never data loss.
    pub fn undo_command(&self, mutation_id: &str) -> Result<CommandUndoResult> {
        let tx = self.conn.unchecked_transaction()?;
        let record = tx
            .query_row(
                "SELECT note_id, before_body, after_body, before_revision, after_revision, undone_at
                 FROM command_mutations WHERE id = ?1",
                [mutation_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, Option<i64>>(3)?,
                        row.get::<_, i64>(4)?,
                        row.get::<_, Option<i64>>(5)?,
                    ))
                },
            )
            .optional()?;
        let Some((note_id, before_body, after_body, before_revision, after_revision, undone_at)) = record else {
            return Ok(CommandUndoResult::NotFound);
        };
        if undone_at.is_some() {
            return Ok(CommandUndoResult::AlreadyUndone);
        }
        let current = {
            let sql = format!("SELECT {NOTE_COLUMNS} FROM notes WHERE id = ?1");
            tx.query_row(&sql, [&note_id], row_to_note).optional()?
        };
        let unchanged = current
            .as_ref()
            .is_some_and(|note| note.revision == after_revision && note.body == after_body);
        if !unchanged {
            return Ok(CommandUndoResult::Conflict { current });
        }

        let note = if let (Some(body), Some(_revision)) = (before_body, before_revision) {
            tx.execute(
                "UPDATE notes SET body = ?2, updated_at = ?3, revision = ?4 WHERE id = ?1 AND revision = ?5",
                rusqlite::params![note_id, body, now_ms(), after_revision + 1, after_revision],
            )?;
            let sql = format!("SELECT {NOTE_COLUMNS} FROM notes WHERE id = ?1");
            Some(tx.query_row(&sql, [&note_id], row_to_note)?)
        } else {
            tx.execute("DELETE FROM notes WHERE id = ?1 AND revision = ?2", rusqlite::params![note_id, after_revision])?;
            None
        };
        tx.execute("UPDATE command_mutations SET undone_at = ?2 WHERE id = ?1", rusqlite::params![mutation_id, now_ms()])?;
        tx.commit()?;
        Ok(CommandUndoResult::Undone { mutation_id: mutation_id.to_string(), note })
    }

    /// The newest recent command whose exact result is still current. This is
    /// how an Undo interrupted by a process restart is offered again.
    pub fn latest_command_undo(&self, max_age_ms: i64) -> Result<Option<PendingCommandUndo>> {
        let cutoff = now_ms().saturating_sub(max_age_ms.max(0));
        self.conn
            .query_row(
                "SELECT m.id, m.note_id, m.kind, m.created_at
                 FROM command_mutations m
                 JOIN notes n ON n.id = m.note_id
                 WHERE m.undone_at IS NULL AND m.created_at >= ?1
                   AND n.revision = m.after_revision AND n.body = m.after_body
                 ORDER BY m.created_at DESC, m.id DESC LIMIT 1",
                [cutoff],
                |row| {
                    Ok(PendingCommandUndo {
                        mutation_id: row.get(0)?,
                        note_id: row.get(1)?,
                        kind: row.get(2)?,
                        created_at: row.get(3)?,
                    })
                },
            )
            .optional()
            .map_err(StoreError::Query)
    }

    /// Removes a note, answering whether a row actually went.
    ///
    /// Deleting a note that is already gone is not an error. The page deletes
    /// from a list it drew some time ago, and by the time the tap lands the
    /// row can have been removed on another screen or by a restore - an outcome
    /// the user asked for and got. A boolean lets a caller that cares tell the
    /// two apart without making the ordinary case a failure.
    pub fn delete_note(&self, id: &str) -> Result<bool> {
        let removed = self.conn.execute("DELETE FROM notes WHERE id = ?1", [id])?;
        Ok(removed > 0)
    }

    /// Whether any note still refers to the picture `name` as `(image/<name>)`.
    /// `instr` rather than `LIKE`, where the `_` in a name would be a wildcard.
    pub fn image_in_use(&self, name: &str) -> Result<bool> {
        let needle = format!("(image/{name})");
        Ok(self
            .conn
            .query_row("SELECT EXISTS(SELECT 1 FROM notes WHERE instr(body, ?1) > 0)", [needle], |row| row.get::<_, i64>(0))?
            != 0)
    }

    /// Keeps (or with `None`, forgets) a note's recording length and phrases,
    /// answering with the note - or `None` if it is gone. Not an edit, like a
    /// star: the words were saved when they were said.
    pub fn set_recording(&self, id: &str, recording: Option<&Recording>) -> Result<Option<Note>> {
        let (ms, json) = match recording {
            Some(r) => (Some(r.ms), Some(serde_json::to_string(&r.segments).unwrap_or_else(|_| "[]".into()))),
            None => (None, None),
        };
        self.conn.execute(
            "UPDATE notes SET recording_ms = ?2, segments = ?3 WHERE id = ?1",
            rusqlite::params![id, ms, json],
        )?;
        self.get_note(id)
    }

    /// Keeps (or with `None`, forgets) the formatted version of a note: the
    /// text, the page's hash of the body it came from, and which model wrote
    /// it. Not an edit: the body and `updated_at` stand.
    pub fn set_formatted(
        &self,
        id: &str,
        formatted: Option<&str>,
        formatted_for: Option<i64>,
        model: Option<&str>,
    ) -> Result<Option<Note>> {
        self.conn.execute(
            "UPDATE notes SET formatted = ?2, formatted_for = ?3, formatted_model = ?4 WHERE id = ?1",
            rusqlite::params![id, formatted, formatted_for, model],
        )?;
        self.get_note(id)
    }

    /// Stars or unstars a note, answering with it - or `None` if it is gone.
    ///
    /// NOT an edit: `updated_at` does not move. The list sorts starred notes
    /// first and everything else by when it was last WRITTEN, and a star that
    /// counted as a write would shuffle a note up the list for having been
    /// touched rather than changed.
    pub fn set_starred(&self, id: &str, starred: bool) -> Result<Option<Note>> {
        self.conn.execute("UPDATE notes SET starred = ?2 WHERE id = ?1", rusqlite::params![id, starred as i64])?;
        self.get_note(id)
    }

    /// Archives a note (stamping when) or brings it back, answering with it -
    /// or `None` if it is gone. Not an edit, for the same reason as a star.
    pub fn set_archived(&self, id: &str, archived: bool) -> Result<Option<Note>> {
        let at = archived.then(now_ms);
        self.conn.execute("UPDATE notes SET archived_at = ?2 WHERE id = ?1", rusqlite::params![id, at])?;
        self.get_note(id)
    }

    /// Removes every note, and the captures table with them. The reset in
    /// developer settings; nothing else calls it. The schema stays, so the
    /// next save is an ordinary insert into an empty table.
    pub fn clear(&self) -> Result<()> {
        self.conn.execute_batch("DELETE FROM command_mutations; DELETE FROM notes; DELETE FROM captures;")?;
        Ok(())
    }

    /// A transcript becomes a note. THIS IS WHAT THE ANDROID CAPTURE SERVICE
    /// CALLS.
    ///
    /// It is a thin thing on purpose - an id and a `create_note` - but it is the
    /// named entry point rather than an instruction to the JNI layer to mint a
    /// uuid and call `create_note` itself, because the JNI layer is the one
    /// caller that cannot be unit tested from here and is the one running in a
    /// process with no app around it. Everything it needs to get right lives
    /// on this side of the boundary, where the tests are.
    ///
    /// `source` is the caller's to choose and survives every later edit, which
    /// is what lets a note say it came from the side key
    /// rather than from a Quick Settings tile long after both are forgotten.
    pub fn append_capture(&self, body: &str, source: &str) -> Result<Note> {
        self.create_note(&new_id(), body, source)?
            .ok_or_else(|| StoreError::Query(rusqlite::Error::QueryReturnedNoRows))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A database of its own per test, swept up when the test ends however it
    /// ends.
    ///
    /// A temp path and a `Drop` rather than the `tempfile` crate: this is the
    /// only place in the crate that wants one, and the crate would be a
    /// dependency bought for six lines. `Drop` rather than a tidy-up at the
    /// bottom of each test because a failing assertion panics straight past
    /// the last line, and a run that leaves its databases behind every time it
    /// catches a bug is a temp directory that fills up while you are fixing
    /// one.
    ///
    /// The sidecars matter: WAL means `-wal` and `-shm` sit beside the file,
    /// and deleting only the database leaves a journal for the next test that
    /// happens to draw the same name.
    struct TempDb {
        store: Store,
        path: std::path::PathBuf,
    }

    impl TempDb {
        fn new() -> TempDb {
            let path = std::env::temp_dir().join(format!("glyph-store-test-{}.sqlite", new_id()));
            let store = Store::open(&path).expect("a fresh database in the temp directory opens");
            TempDb { store, path }
        }
    }

    impl Drop for TempDb {
        fn drop(&mut self) {
            for suffix in ["", "-wal", "-shm"] {
                let mut name = self.path.clone().into_os_string();
                name.push(suffix);
                let _ = std::fs::remove_file(std::path::PathBuf::from(name));
            }
        }
    }

    /// Puts daylight between two writes.
    ///
    /// `updated_at` is a millisecond clock, and two saves inside one tick
    /// carry the same stamp - which is a fact about the clock, not a fault in
    /// the store, and is why `list_notes` has a tiebreak at all. A test that
    /// asserts one save is newer than another has to actually make it so.
    fn tick() {
        std::thread::sleep(Duration::from_millis(2));
    }

    fn segment(text: &str, start_ms: u64, end_ms: u64) -> RecordedSegment {
        RecordedSegment { text: text.into(), start_ms, end_ms }
    }

    #[test]
    fn a_picture_is_in_use_while_a_note_refers_to_it() {
        let db = TempDb::new();
        db.store.save_note("n1", "![](image/a_1.jpg)\nand ![](image/b.jpg)", "editor").unwrap();
        db.store.save_note("n2", "![](image/b.jpg)", "editor").unwrap();
        assert!(db.store.image_in_use("a_1.jpg").unwrap());
        // `_` is not a wildcard, and a name is matched whole.
        assert!(!db.store.image_in_use("a-1.jpg").unwrap());
        assert!(!db.store.image_in_use("1.jpg").unwrap());
        db.store.delete_note("n1").unwrap();
        assert!(!db.store.image_in_use("a_1.jpg").unwrap());
        assert!(db.store.image_in_use("b.jpg").unwrap());
    }

    #[test]
    fn a_stale_existing_note_write_cannot_resurrect_a_deleted_note() {
        let db = TempDb::new();
        let original = db.store.create_note("deleted", "Brofries", "capture").unwrap().unwrap();
        assert_eq!(db.store.create_note(&original.id, "replacement", "editor").unwrap(), None);
        assert!(db.store.delete_note(&original.id).unwrap());
        assert_eq!(
            db.store.update_note(&original.id, "Brofries\n\nold and new speech", original.revision).unwrap(),
            None
        );
        assert_eq!(db.store.get_note(&original.id).unwrap(), None);
    }

    #[test]
    fn a_recording_is_kept_beside_the_note_and_the_list_leaves_its_segments_out() {
        let db = TempDb::new();
        let saved = db.store.save_note("n1", "call sam", "capture").unwrap();
        assert_eq!((saved.recording_ms, saved.segments.clone()), (None, None));
        tick();

        let recording = Recording::new(4200, vec![segment("Call Sam.", 0, 1800), segment("About Friday.", 1800, 4200)]).unwrap();
        let kept = db.store.set_recording("n1", Some(&recording)).unwrap().unwrap();
        assert_eq!(kept.recording_ms, Some(4200));
        assert_eq!(kept.segments.as_deref().map(<[_]>::len), Some(2));
        assert_eq!(kept.updated_at, saved.updated_at, "keeping a recording is not an edit");

        let listed = db.store.list_notes().unwrap();
        assert_eq!(listed[0].recording_ms, Some(4200), "the list carries the length");
        assert_eq!(listed[0].segments, None, "and not the segments");

        let forgotten = db.store.set_recording("n1", None).unwrap().unwrap();
        assert_eq!((forgotten.recording_ms, forgotten.segments), (None, None));
        assert_eq!(db.store.set_recording("gone", Some(&recording)).unwrap(), None);
    }

    #[test]
    fn a_recording_that_is_not_one_is_refused() {
        assert!(Recording::new(-1, vec![]).is_err());
        assert!(Recording::new(MAX_RECORDING_MS + 1, vec![]).is_err());
        assert!(Recording::new(1000, vec![segment("backwards", 900, 100)]).is_err());
        assert!(Recording::new(1000, vec![segment(&"x".repeat(MAX_SEGMENT_CHARS + 1), 0, 1)]).is_err());
        assert!(Recording::new(0, vec![]).is_ok(), "a key held and nothing said is still a recording");
    }

    #[test]
    fn a_recording_path_is_only_ever_inside_the_recordings_directory() {
        let dir = Path::new("/data/recordings");
        assert_eq!(recording_file(dir, "0f8e-uuid_1"), Some(dir.join("0f8e-uuid_1.wav")));
        for id in ["", "../notes", "a/b", "a\\b", "..", "n1.wav", "a b"] {
            assert_eq!(recording_file(dir, id), None, "{id:?}");
        }
    }

    #[test]
    fn a_formatted_version_is_kept_beside_the_note_and_the_list_leaves_its_text_out() {
        let db = TempDb::new();
        let saved = db.store.save_note("n1", "call the plumber", "capture").unwrap();
        assert_eq!(saved.formatted, None);
        tick();

        let kept = db.store.set_formatted("n1", Some("# Plumber\n\n- [ ] Call the plumber\n"), Some(4_503_599_627_370_495), Some("qwen3.5-4b")).unwrap().unwrap();
        assert_eq!(kept.formatted.as_deref(), Some("# Plumber\n\n- [ ] Call the plumber\n"));
        assert_eq!(kept.formatted_for, Some(4_503_599_627_370_495), "a 52-bit hash round-trips");
        assert_eq!(kept.formatted_model.as_deref(), Some("qwen3.5-4b"));
        assert_eq!(kept.updated_at, saved.updated_at, "keeping a formatted version is not an edit");

        // The list carries the hash and the model, not the text again.
        let listed = db.store.list_notes().unwrap().into_iter().find(|n| n.id == "n1").unwrap();
        assert_eq!(listed.formatted, None);
        assert_eq!(listed.formatted_for, Some(4_503_599_627_370_495));
        assert_eq!(listed.formatted_model.as_deref(), Some("qwen3.5-4b"));

        // An edit keeps it: the page tells staleness by the hash, not by absence.
        let edited = db.store.save_note("n1", "call the plumber tomorrow", "editor").unwrap();
        assert!(edited.formatted.is_some());
        assert_eq!(db.store.set_formatted("n1", None, None, None).unwrap().unwrap().formatted, None);
        assert_eq!(db.store.set_formatted("gone", Some("x"), Some(1), None).unwrap(), None);
    }

    #[test]
    fn clearing_removes_every_note_and_the_store_still_works() {
        let db = TempDb::new();
        db.store.save_note("n1", "one", "editor").unwrap();
        db.store.save_note("n2", "two", "capture").unwrap();
        db.store.clear().unwrap();
        assert!(db.store.list_notes().unwrap().is_empty());
        assert_eq!(db.store.get_note("n1").unwrap(), None);
        let again = db.store.save_note("n3", "three", "editor").unwrap();
        assert_eq!(db.store.list_notes().unwrap(), vec![again]);
    }

    #[test]
    fn stars_and_archiving_are_not_edits() {
        let db = TempDb::new();
        let saved = db.store.save_note("n1", "one", "editor").unwrap();
        assert!(!saved.starred);
        assert_eq!(saved.archived_at, None);
        tick();

        let starred = db.store.set_starred("n1", true).unwrap().unwrap();
        assert!(starred.starred);
        assert_eq!(starred.updated_at, saved.updated_at, "a star must not re-sort the note");

        let archived = db.store.set_archived("n1", true).unwrap().unwrap();
        assert!(archived.archived_at.is_some());
        assert_eq!(archived.updated_at, saved.updated_at);
        // An edit keeps the flags: saving a body is not un-starring it.
        let edited = db.store.save_note("n1", "one, edited", "editor").unwrap();
        assert!(edited.starred && edited.archived_at.is_some());

        assert_eq!(db.store.set_archived("n1", false).unwrap().unwrap().archived_at, None);
        assert_eq!(db.store.set_starred("gone", true).unwrap(), None);
    }

    #[test]
    fn a_database_from_before_stars_gains_the_columns_and_keeps_its_notes() {
        let path = std::env::temp_dir().join(format!("glyph-store-old-{}.sqlite", new_id()));
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT NOT NULL, created_at INTEGER, updated_at INTEGER, source TEXT);
                 INSERT INTO notes VALUES ('old', 'from 0.3.1', 1, 1, 'editor');",
            )
            .unwrap();
        }
        let store = Store::open(&path).unwrap();
        let note = store.get_note("old").unwrap().unwrap();
        assert_eq!(note.body, "from 0.3.1");
        assert!(!note.starred);
        assert_eq!(note.archived_at, None);
        // Opening again - the next launch - repeats the migration harmlessly.
        drop(store);
        let again = Store::open(&path).unwrap();
        assert!(again.set_starred("old", true).unwrap().unwrap().starred);
        drop(again);
        for suffix in ["", "-wal", "-shm"] {
            let mut name = path.clone().into_os_string();
            name.push(suffix);
            let _ = std::fs::remove_file(std::path::PathBuf::from(name));
        }
    }

    #[test]
    fn a_saved_note_comes_back_out_of_the_list() {
        let db = TempDb::new();
        let saved = db.store.save_note("n1", "# Kettle\nDescale it", "editor").unwrap();
        assert_eq!(saved.id, "n1");
        assert_eq!(saved.body, "# Kettle\nDescale it");
        assert_eq!(saved.source, "editor");
        // Both stamps are set on an insert, and to the same instant.
        assert!(saved.created_at > 0);
        assert_eq!(saved.created_at, saved.updated_at);

        let listed = db.store.list_notes().unwrap();
        assert_eq!(listed, vec![saved.clone()]);
        assert_eq!(db.store.get_note("n1").unwrap(), Some(saved));
        // A note nobody wrote is absent, not an error - the whole reason
        // get_note answers with an Option.
        assert_eq!(db.store.get_note("never-written").unwrap(), None);
    }

    #[test]
    fn saving_an_id_twice_is_an_edit_and_not_a_second_note() {
        let db = TempDb::new();
        let first = db.store.save_note("n1", "draft", "editor").unwrap();
        tick();
        let second = db.store.save_note("n1", "draft, revised", "editor").unwrap();

        assert_eq!(second.body, "draft, revised");
        // The birth stamp is the one thing an edit must not touch: this is
        // what "created 3 days ago, edited just now" is drawn from.
        assert_eq!(second.created_at, first.created_at);
        assert!(
            second.updated_at > first.updated_at,
            "an edit has to move updated_at or the list stops re-sorting"
        );
        assert_eq!(db.store.list_notes().unwrap().len(), 1);
        assert_eq!(second.revision, first.revision + 1);
    }

    fn command(id: &str, note: &Note, after: &str) -> CommandMutation {
        CommandMutation {
            id: id.into(),
            note_id: note.id.clone(),
            kind: "append".into(),
            before_revision: Some(note.revision),
            before_body: Some(note.body.clone()),
            after_body: after.into(),
            source: note.source.clone(),
        }
    }

    #[test]
    fn a_command_compares_the_revision_and_never_overwrites_a_stale_edit() {
        let db = TempDb::new();
        let shown = db.store.save_note("n1", "# Bugs\n\n- One", "editor").unwrap();
        let edited = db.store.save_note("n1", "# Bugs\n\n- One\n- Typed elsewhere", "editor").unwrap();
        let result = db.store.apply_command(&command("c1", &shown, "# Bugs\n\n- One\n- Voice")).unwrap();
        assert_eq!(result, CommandMutationResult::Conflict { current: Some(edited.clone()) });
        assert_eq!(db.store.get_note("n1").unwrap(), Some(edited));
    }

    #[test]
    fn an_applied_command_can_be_undone_after_reopening_the_store() {
        let path = std::env::temp_dir().join(format!("glyph-command-test-{}.sqlite", new_id()));
        let store = Store::open(&path).unwrap();
        let before = store.save_note("n1", "# Bugs\n\n- One", "editor").unwrap();
        let applied = store.apply_command(&command("c1", &before, "# Bugs\n\n- One\n- Voice")).unwrap();
        let CommandMutationResult::Applied { note, .. } = applied else { panic!("command was not applied") };
        assert_eq!(note.body, "# Bugs\n\n- One\n- Voice");
        drop(store);

        let reopened = Store::open(&path).unwrap();
        let undone = reopened.undo_command("c1").unwrap();
        assert!(matches!(undone, CommandUndoResult::Undone { note: Some(ref note), .. } if note.body == before.body));
        assert_eq!(reopened.undo_command("c1").unwrap(), CommandUndoResult::AlreadyUndone);
        drop(reopened);
        for suffix in ["", "-wal", "-shm"] {
            let mut name = path.clone().into_os_string();
            name.push(suffix);
            let _ = std::fs::remove_file(std::path::PathBuf::from(name));
        }
    }

    #[test]
    fn undo_refuses_to_replace_a_later_edit_and_create_undo_removes_only_unchanged_note() {
        let db = TempDb::new();
        let before = db.store.save_note("n1", "one", "editor").unwrap();
        let CommandMutationResult::Applied { note: applied, .. } = db.store.apply_command(&command("c1", &before, "two")).unwrap() else {
            panic!("command was not applied")
        };
        let later = db.store.save_note("n1", "three", "editor").unwrap();
        assert_eq!(db.store.undo_command("c1").unwrap(), CommandUndoResult::Conflict { current: Some(later.clone()) });
        assert_eq!(later.revision, applied.revision + 1);

        let create = CommandMutation {
            id: "c2".into(), note_id: "new".into(), kind: "create".into(), before_revision: None,
            before_body: None, after_body: "Apartment stuff".into(), source: "capture".into(),
        };
        assert!(matches!(db.store.apply_command(&create).unwrap(), CommandMutationResult::Applied { .. }));
        assert!(matches!(db.store.undo_command("c2").unwrap(), CommandUndoResult::Undone { note: None, .. }));
        assert_eq!(db.store.get_note("new").unwrap(), None);
    }

    #[test]
    fn a_recent_unchanged_command_is_recoverable_after_an_interruption() {
        let db = TempDb::new();
        let before = db.store.save_note("n1", "one", "editor").unwrap();
        db.store.apply_command(&command("recover", &before, "two")).unwrap();
        assert_eq!(db.store.latest_command_undo(60_000).unwrap().unwrap().mutation_id, "recover");
        db.store.save_note("n1", "later", "editor").unwrap();
        assert_eq!(db.store.latest_command_undo(60_000).unwrap(), None);
    }

    #[test]
    fn deleting_takes_the_note_and_says_whether_it_was_there() {
        let db = TempDb::new();
        db.store.save_note("n1", "one", "editor").unwrap();
        db.store.save_note("n2", "two", "editor").unwrap();

        assert!(db.store.delete_note("n1").unwrap());
        assert_eq!(db.store.get_note("n1").unwrap(), None);
        assert_eq!(db.store.list_notes().unwrap().len(), 1);
        // Deleting what is already gone is the answer the user wanted, not a
        // failure: a second tap on a stale list must not raise an error.
        assert!(!db.store.delete_note("n1").unwrap());
    }

    #[test]
    fn the_list_is_newest_edit_first_not_newest_note_first() {
        let db = TempDb::new();
        db.store.save_note("oldest", "first written", "editor").unwrap();
        tick();
        db.store.save_note("middle", "second written", "editor").unwrap();
        tick();
        db.store.save_note("newest", "third written", "editor").unwrap();

        let order: Vec<String> =
            db.store.list_notes().unwrap().into_iter().map(|n| n.id).collect();
        assert_eq!(order, ["newest", "middle", "oldest"]);

        tick();
        db.store.save_note("oldest", "first written, touched", "editor").unwrap();
        let order: Vec<String> =
            db.store.list_notes().unwrap().into_iter().map(|n| n.id).collect();
        assert_eq!(
            order,
            ["oldest", "newest", "middle"],
            "editing an old note must lift it to the top - the list sorts by updated_at, \
             and an index on the wrong column would still pass every other test here"
        );
    }

    #[test]
    fn a_capture_arrives_as_a_new_note_that_remembers_where_it_came_from() {
        let db = TempDb::new();
        let one = db.store.append_capture("milk, bread, and a new kettle", "capture").unwrap();
        let two = db.store.append_capture("ring the plumber back", "capture").unwrap();

        // Two captures from a process that never asked what the last id was.
        assert_ne!(one.id, two.id);
        assert_eq!(uuid::Uuid::parse_str(&one.id).unwrap().get_version_num(), 4);
        assert_eq!(one.source, "capture");
        assert_eq!(db.store.list_notes().unwrap().len(), 2);
        assert_eq!(db.store.get_note(&one.id).unwrap(), Some(one.clone()));

        // The provenance survives the editor. If the fixture save ever starts writing
        // `source` on a conflict, this is the line that goes red.
        tick();
        let edited = db.store.save_note(&one.id, "milk, bread, kettle", "editor").unwrap();
        assert_eq!(edited.source, "capture");
        assert_eq!(edited.created_at, one.created_at);
    }
}
