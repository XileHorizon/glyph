//! The Tauri seam: four commands, and deliberately nothing else.
//!
//! `store.rs` owns the notes and has to stay free of `tauri::` types - its
//! header says why, and it is not a stylistic preference. This module is the
//! adapter that lets a webview reach them, and it is thin enough to read in
//! one screen on purpose: every command here takes the lock, calls one store
//! function, and turns a `StoreError` into a `String`. Anything more
//! interesting than that belongs on the other side of the seam, where the
//! Android capture process can reach it too.
//!
//! `Result<T, String>` rather than `Result<T, StoreError>` because Tauri needs
//! the error half to be `Serialize`, and a string is what arrives in
//! JavaScript regardless: `invoke()` rejects with whatever the error
//! serialised to. A page that has to destructure an error enum to decide which
//! toast to raise is a page carrying the store's shape around for no benefit -
//! and `StoreError`'s `Display` already writes the sentence a person should
//! read.
//!
//! `pending_captures` (DESIGN section 5) is not here yet. It has nothing to
//! report until the capture service exists, and a command that always answers
//! with an empty array is a command the page will be written against and then
//! have to be rewritten around.

use std::sync::Mutex;

use tauri::Manager;

use crate::library::Library;
use crate::store::{
    recording_file, CommandMutation, CommandMutationResult, CommandUndoResult, Note,
    PendingCommandUndo, RecordedSegment, Recording, Store,
};

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApplyCommandRequest {
    mutation_id: String,
    note_id: String,
    kind: String,
    before_revision: Option<i64>,
    before_body: Option<String>,
    after_body: String,
    source: String,
}

/// Applies only the already-previewed deterministic Markdown. Inference never
/// reaches this command and cannot provide ids, revisions, or note bodies.
#[tauri::command]
pub fn apply_command_mutation(
    store: tauri::State<'_, NotesStore>,
    request: ApplyCommandRequest,
) -> std::result::Result<CommandMutationResult, String> {
    let plain_id = |id: &str| {
        !id.is_empty()
            && id.len() <= 128
            && id
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    };
    if !plain_id(&request.mutation_id) || !plain_id(&request.note_id) {
        return Err("a command mutation needs plain bounded ids".into());
    }
    if !matches!(request.source.as_str(), "editor" | "capture") {
        return Err("a command mutation has an unsupported source".into());
    }
    if !matches!(request.kind.as_str(), "append" | "create") {
        return Err("only append and create command mutations are supported".into());
    }
    if request.kind == "create" && (request.before_revision.is_some() || request.before_body.is_some()) {
        return Err("a create command cannot replace an existing note".into());
    }
    if request.kind == "append" && (request.before_revision.is_none() || request.before_body.is_none()) {
        return Err("an append command needs the previewed note revision".into());
    }
    store
        .lock()
        .apply_command(&CommandMutation {
            id: request.mutation_id,
            note_id: request.note_id,
            kind: request.kind,
            before_revision: request.before_revision,
            before_body: request.before_body,
            after_body: request.after_body,
            source: request.source,
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn undo_command_mutation(
    store: tauri::State<'_, NotesStore>,
    mutation_id: String,
) -> std::result::Result<CommandUndoResult, String> {
    store.lock().undo_command(&mutation_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn latest_command_mutation(
    store: tauri::State<'_, NotesStore>,
) -> std::result::Result<Option<PendingCommandUndo>, String> {
    store.lock().latest_command_undo(10 * 60 * 1_000).map_err(|e| e.to_string())
}

/// Keeps the on-device model's formatted version of a note, or clears it with
/// `null`. `formattedFor` is the page's hash of the body it was made from and
/// `model` the page's id for the model that wrote it. Native generation 10.
#[tauri::command]
pub fn set_note_formatted(
    store: tauri::State<'_, NotesStore>,
    id: String,
    formatted: Option<String>,
    formatted_for: Option<i64>,
    model: Option<String>,
) -> std::result::Result<Option<Note>, String> {
    store
        .lock()
        .set_formatted(&id, formatted.as_deref(), formatted_for, model.as_deref())
        .map_err(|e| e.to_string())
}

/// The database file, under whatever `app_data_dir()` resolves to on the
/// platform. Named in DESIGN section 5; the Android capture service derives
/// the same filename from its own `filesDir`, so this string and the Kotlin
/// one have to agree.
const DB_FILE: &str = "glyph.sqlite";

/// The one connection, opened in `setup` and held for the life of the process.
///
/// Rather than opening a connection per command, which is the shape that looks
/// pleasingly stateless. Every open pays for the file open, the WAL handshake
/// and the three `CREATE ... IF NOT EXISTS` statements, and - the part that
/// actually matters - throws away SQLite's page cache between one debounced
/// save and the next, on a device where the editor saves 400 ms after the last
/// keystroke and the list re-reads on every resume. One connection behind a
/// `Mutex` costs one uncontended lock per command, on statements that are
/// single rows.
///
/// A `Mutex` rather than a connection pool because `rusqlite::Connection` is
/// `Send` and not `Sync`, and because the webview invokes from one place
/// anyway. The CROSS-PROCESS contention - the capture service writing while
/// this connection reads - is not what this lock is for; that one is SQLite's,
/// through WAL and the busy timeout.
pub struct NotesStore(pub Mutex<Library>);

impl NotesStore {
    /// The guard, recovered if some earlier command panicked while holding it.
    ///
    /// A poisoned `Mutex` means a previous call died mid-statement. The
    /// connection is not the casualty: every statement in `store.rs` stands
    /// alone, there is no transaction left half-applied, and SQLite has either
    /// committed the row or not. So the real choice is between recovering the
    /// guard and refusing every note operation for the rest of the process's
    /// life because one of them once panicked - which is how an app goes from
    /// having a bug to being a brick.
    pub(crate) fn lock(&self) -> std::sync::MutexGuard<'_, Library> {
        self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Opens the store and hands it to Tauri's managed state. Called once, from
/// `setup`.
///
/// This is where `app_data_dir()` is resolved, and it is the ONLY place in the
/// crate that does: `store::open` takes a path precisely so that this
/// resolution - which needs an `AppHandle`, and therefore a running Tauri -
/// stays on this side of the seam.
///
/// The directory is created rather than assumed. On a first launch nothing has
/// written there yet, and `Connection::open` creates a missing file but not a
/// missing directory.
///
/// An error here fails `setup`, which fails the launch. That is the honest
/// outcome and the alternative was considered: starting with no store, letting
/// every command answer with an error, and showing an empty list. A notes app
/// that opens on an empty list invites the person to type into it, and
/// silently dropping what they then write is worse than not starting - a crash
/// is at least a fact they can act on.
pub fn install(app: &tauri::App) -> std::result::Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data directory to keep notes in: {e}"))?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    let library = open_library(&dir)?;
    app.manage(NotesStore(Mutex::new(library)));
    Ok(())
}

/// The library folder in the app's own storage (docs/LIBRARY.md, phase 1).
const LIBRARY_DIR: &str = "Library";

/// Opens the library, and the first time, moves every note of the old
/// database into it as a file. The old database is kept, renamed
/// `glyph.sqlite.moved`, and only once every note is written out: a move that
/// stops halfway (the app killed, the storage full) leaves the database where
/// it was, and the next launch finishes it, because a note already in the
/// library is never written twice.
fn open_library(dir: &std::path::Path) -> std::result::Result<Library, String> {
    let mut library = Library::open_fs(&dir.join(LIBRARY_DIR)).map_err(|e| e.to_string())?;
    let old = dir.join(DB_FILE);
    if old.exists() && !library.moved_in() {
        let store = Store::open(&old).map_err(|e| e.to_string())?;
        match library.move_in(&store) {
            Ok(moved) => {
                drop(store);
                library.mark_moved_in(DB_FILE, moved).map_err(|e| e.to_string())?;
                for suffix in ["", "-wal", "-shm"] {
                    let from = dir.join(format!("{DB_FILE}{suffix}"));
                    if from.exists() {
                        let _ = std::fs::rename(&from, dir.join(format!("{DB_FILE}.moved{suffix}")));
                    }
                }
                eprintln!("[glyph] moved {moved} notes from {DB_FILE} into the library");
            }
            Err(e) => eprintln!("[glyph] the move into the library stopped, and will finish next launch: {e}"),
        }
    }
    Ok(library)
}

/// Every note, newest edit first. What the list screen draws.
#[tauri::command]
pub fn list_notes(store: tauri::State<'_, NotesStore>) -> std::result::Result<Vec<Note>, String> {
    store.lock().list_notes().map_err(|e| e.to_string())
}

/// One note, or `null` when nothing answers to that id - which the editor
/// treats as "it was deleted elsewhere", not as a failure.
#[tauri::command]
pub fn get_note(
    store: tauri::State<'_, NotesStore>,
    id: String,
) -> std::result::Result<Option<Note>, String> {
    store.lock().get_note(&id).map_err(|e| e.to_string())
}

/// Creates a note only while its id is unused.
///
/// The id comes from the page rather than being minted here, because the page
/// has to have one before the first save lands: a new note is routed to and
/// drawn as soon as it is tapped, and an id that only exists after a 400 ms
/// debounce is an id the editor spends its first keystrokes without.
///
#[tauri::command]
pub fn create_note(
    store: tauri::State<'_, NotesStore>,
    id: String,
    body: String,
    source: String,
) -> std::result::Result<Note, String> {
    store.lock().create_note(&id, &body, &source).map_err(|e| e.to_string())?
        .ok_or_else(|| "the note id already exists".to_string())
}

/// Updates exactly an existing revision. A deleted row is a conflict, never
/// an invitation to insert it again.
#[tauri::command]
pub fn update_note(
    store: tauri::State<'_, NotesStore>,
    id: String,
    body: String,
    expected_revision: i64,
) -> std::result::Result<Note, String> {
    store.lock().update_note(&id, &body, expected_revision).map_err(|e| e.to_string())?
        .ok_or_else(|| "the note was deleted or changed".to_string())
}

/// Removes a note, answering `true` when a row actually went and `false` when
/// it had already gone - and its kept recording with it.
///
/// The recording goes whether or not the row was still there: a file whose note
/// is gone is a recording nothing can play, and nothing else would ever remove
/// it. A file that cannot be removed does not fail the delete; the note is
/// gone, which is what was asked. The pictures the body refers to go the same
/// way, except one another note still shows.
#[tauri::command]
pub fn delete_note(
    app: tauri::AppHandle,
    store: tauri::State<'_, NotesStore>,
    id: String,
) -> std::result::Result<bool, String> {
    let mut store = store.lock();
    // The body is read before the row goes: it is the only list of the
    // pictures the note had. They go after it, so a failed delete never
    // leaves a note pointing at pictures that are gone, and one another note
    // also shows (a copied line) is kept.
    let body = store.get_note(&id).ok().flatten().map(|note| note.body);
    let removed = store.delete_note(&id).map_err(|e| e.to_string())?;
    if let Some(body) = body {
        crate::images::remove_unreferenced(&app, &store, &body);
    }
    drop(store);
    if let Some(file) = recordings_dir(&app).and_then(|dir| recording_file(&dir, &id)) {
        let _ = std::fs::remove_file(file);
    }
    Ok(removed)
}

/// `<app_data_dir>/recordings`, where the capture layer keeps each spoken
/// note's audio as `<id>.wav`.
pub fn recordings_dir(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|dir| dir.join("recordings"))
}

/// Keeps a spoken note's recording length and phrases (`recordingMs` with
/// `segments`), or forgets both with `recordingMs: null`. Answers with the note,
/// or `null` if it has gone. Not an edit: `updatedAt` does not move. Native
/// generation 6.
#[tauri::command]
pub fn set_note_recording(
    store: tauri::State<'_, NotesStore>,
    id: String,
    recording_ms: Option<i64>,
    segments: Option<Vec<RecordedSegment>>,
) -> std::result::Result<Option<Note>, String> {
    let recording = match recording_ms {
        Some(ms) => Some(Recording::new(ms, segments.unwrap_or_default())?),
        None => None,
    };
    store.lock().set_recording(&id, recording.as_ref()).map_err(|e| e.to_string())
}

/// Writes a note as another device has it, for sync (docs/SYNC.md): its own
/// times, pin, archive, folder, recording phrases and formatted version.
/// Answers with the note as it now is here. Native generation 16.
#[tauri::command]
pub fn store_apply(store: tauri::State<'_, NotesStore>, note: Note) -> std::result::Result<Note, String> {
    if let Some(segments) = &note.segments {
        Recording::new(note.recording_ms.unwrap_or(0), segments.clone())?;
    }
    store.lock().apply_note(&note).map_err(|e| e.to_string())
}

/// Keeps a file that arrived by sync (docs/SYNC.md): a note's recording under
/// the note's id (`kind` "recording", WAV bytes), or a picture under its own
/// name (`kind` "image"). Written whole or not at all. Native generation 16.
#[tauri::command]
pub fn sync_put_file(app: tauri::AppHandle, kind: String, name: String, base64: String) -> std::result::Result<(), String> {
    match kind.as_str() {
        "image" => {
            let images = crate::images::images_dir(&app).ok_or_else(|| "There is no room to keep pictures.".to_string())?;
            crate::images::place(&images, &name, &base64)
        }
        "recording" => {
            use base64::Engine as _;
            let dir = recordings_dir(&app).ok_or_else(|| "There is no room to keep recordings.".to_string())?;
            let file = recording_file(&dir, &name).ok_or_else(|| "That is not a note id.".to_string())?;
            let bytes = base64::engine::general_purpose::STANDARD.decode(base64.trim()).map_err(|_| "That recording could not be read.".to_string())?;
            if !bytes.starts_with(b"RIFF") {
                return Err("That is not a recording Glyph can keep.".to_string());
            }
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            let part = dir.join(format!(".{name}.part"));
            std::fs::write(&part, &bytes).and_then(|()| std::fs::rename(&part, &file)).map_err(|e| {
                let _ = std::fs::remove_file(&part);
                format!("The recording could not be saved: {e}")
            })
        }
        _ => Err(format!("Nothing is kept as {kind}.")),
    }
}

/// Stars or unstars a note from the list's swipe. Answers with the note, or
/// `null` if it has gone. Native generation 3.
#[tauri::command]
pub fn set_note_starred(
    store: tauri::State<'_, NotesStore>,
    id: String,
    starred: bool,
) -> std::result::Result<Option<Note>, String> {
    store.lock().set_starred(&id, starred).map_err(|e| e.to_string())
}

/// Archives a note, or brings it back. Answers with the note, or `null` if it
/// has gone. Native generation 3.
#[tauri::command]
pub fn set_note_archived(
    store: tauri::State<'_, NotesStore>,
    id: String,
    archived: bool,
) -> std::result::Result<Option<Note>, String> {
    store.lock().set_archived(&id, archived).map_err(|e| e.to_string())
}

