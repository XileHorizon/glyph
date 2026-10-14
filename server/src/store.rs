//! The accounts database: who has an account, the keys that speak for them, and the encrypted copies of what they
//! keep in sync (docs/SYNC.md).
//!
//! One SQLite file, as AttackFM's registry keeps one (`AttackFM/server/crates/registry/src/db.rs`), with the signing
//! key in it, so the accounts and the key that vouches for them are one file and one backup. Recordings are the one
//! thing not in it: they are files beside it, because they are megabytes each.
//!
//! Nothing in here can be read by this service. A note, a settings blob, a recording and the account key are all
//! ciphertext made on a device; the service stores them, counts them, and hands them back.

use rusqlite::{params, Connection, OptionalExtension};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS accounts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    handle     TEXT NOT NULL UNIQUE COLLATE NOCASE,
    -- Argon2 of the login secret a device derives from the password; empty for a device-key-only account.
    login_hash TEXT NOT NULL DEFAULT '',
    -- The account key, wrapped under the password's wrap key. Ciphertext; empty with no password.
    wrapped    TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    seen_at    INTEGER NOT NULL DEFAULT 0,
    -- The account's write counter: every note, settings or recording write takes the next value.
    rev        INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS device_keys (
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    public_key TEXT NOT NULL,
    label      TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (account_id, public_key)
);
CREATE TABLE IF NOT EXISTS recovery_codes (
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    slot       INTEGER NOT NULL,
    -- SHA-256 of the code's login half. The code itself, and its wrap half, never reach the service.
    login_hash TEXT NOT NULL,
    -- The account key wrapped under this code's wrap key.
    wrapped    TEXT NOT NULL,
    used_at    INTEGER,
    PRIMARY KEY (account_id, slot)
);
CREATE TABLE IF NOT EXISTS notes (
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    id         TEXT NOT NULL,
    rev        INTEGER NOT NULL,
    deleted    INTEGER NOT NULL DEFAULT 0,
    blob       TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (account_id, id)
);
CREATE INDEX IF NOT EXISTS notes_by_rev ON notes(account_id, rev);
CREATE TABLE IF NOT EXISTS prefs (
    account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    rev        INTEGER NOT NULL,
    blob       TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
-- A note or a book shared by its link (server/src/shares.rs): the owner, and ciphertext sealed under a key only the
-- link carries. Taken down with its owner's account.
CREATE TABLE IF NOT EXISTS shares (
    id         TEXT PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    blob       TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS shares_by_owner ON shares(account_id);
CREATE TABLE IF NOT EXISTS recordings (
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    id         TEXT NOT NULL,
    rev        INTEGER NOT NULL,
    size       INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (account_id, id)
);
"#;

pub struct Account {
    pub id: i64,
    pub handle: String,
    pub login_hash: String,
    pub wrapped: String,
}

/// A note as the service holds it: an id, where it is in the account's history, and its ciphertext.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NoteRow {
    pub id: String,
    pub rev: i64,
    pub deleted: bool,
    pub blob: Option<String>,
}

/// Why a write did not happen.
#[derive(Debug, PartialEq, Eq)]
pub enum WriteError {
    /// The write was made from an older revision than the one stored; the stored one is the winner.
    Stale(NoteRow),
    /// Something below the rules failed.
    Db(String),
}

/// Why a share was not written.
#[derive(Debug, PartialEq, Eq)]
pub enum ShareWrite {
    /// The id is another account's share.
    Taken,
    /// The account already keeps as many shares as it may.
    Full,
    /// Something below the rules failed.
    Failed,
}

impl From<rusqlite::Error> for WriteError {
    fn from(e: rusqlite::Error) -> Self {
        WriteError::Db(e.to_string())
    }
}

pub struct Store {
    conn: Mutex<Connection>,
    recordings: PathBuf,
}

impl Store {
    /// Opens the database in `dir`, making it on first use, with the recordings folder beside it.
    pub fn open(dir: &Path) -> rusqlite::Result<Self> {
        std::fs::create_dir_all(dir).map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        let conn = Connection::open(dir.join("glyph-accounts.sqlite3"))?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self { conn: Mutex::new(conn), recordings: dir.join("recordings") })
    }

    /// A database in memory, with recordings in a fresh folder: for the tests.
    #[cfg(test)]
    pub fn in_memory(recordings: PathBuf) -> Self {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        Self { conn: Mutex::new(conn), recordings }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Connection> {
        // A panic while the lock was held leaves the connection as it was; SQLite's own transactions kept it whole.
        self.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    // --- meta -------------------------------------------------------------------

    pub fn meta(&self, key: &str) -> Option<String> {
        self.lock().query_row("SELECT value FROM meta WHERE key = ?1", params![key], |r| r.get(0)).optional().ok().flatten()
    }

    pub fn set_meta(&self, key: &str, value: &str) -> rusqlite::Result<()> {
        self.lock().execute("INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params![key, value])?;
        Ok(())
    }

    // --- accounts ---------------------------------------------------------------

    fn account_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Account> {
        Ok(Account { id: r.get(0)?, handle: r.get(1)?, login_hash: r.get(2)?, wrapped: r.get(3)? })
    }

    pub fn account_by_handle(&self, handle: &str) -> Option<Account> {
        self.lock()
            .query_row("SELECT id, handle, login_hash, wrapped FROM accounts WHERE handle = ?1", params![handle], Self::account_row)
            .optional()
            .ok()
            .flatten()
    }

    pub fn account_by_id(&self, id: i64) -> Option<Account> {
        self.lock()
            .query_row("SELECT id, handle, login_hash, wrapped FROM accounts WHERE id = ?1", params![id], Self::account_row)
            .optional()
            .ok()
            .flatten()
    }

    /// A new account with everything it starts with, in one transaction: a signup is all there or not there at all.
    pub fn create_account(
        &self,
        handle: &str,
        login_hash: &str,
        wrapped: &str,
        device: Option<(&str, &str)>,
        codes: &[(String, String)],
        now: i64,
    ) -> rusqlite::Result<Account> {
        let mut conn = self.lock();
        let tx = conn.transaction()?;
        tx.execute(
            "INSERT INTO accounts (handle, login_hash, wrapped, created_at, seen_at) VALUES (?1, ?2, ?3, ?4, ?4)",
            params![handle, login_hash, wrapped, now],
        )?;
        let id = tx.last_insert_rowid();
        if let Some((key, label)) = device {
            tx.execute("INSERT INTO device_keys (account_id, public_key, label, created_at) VALUES (?1, ?2, ?3, ?4)", params![id, key, label, now])?;
        }
        for (slot, (hash, code_wrapped)) in codes.iter().enumerate() {
            tx.execute(
                "INSERT INTO recovery_codes (account_id, slot, login_hash, wrapped) VALUES (?1, ?2, ?3, ?4)",
                params![id, slot as i64, hash, code_wrapped],
            )?;
        }
        tx.commit()?;
        Ok(Account { id, handle: handle.to_string(), login_hash: login_hash.to_string(), wrapped: wrapped.to_string() })
    }

    pub fn touch_seen(&self, id: i64, now: i64) {
        let _ = self.lock().execute("UPDATE accounts SET seen_at = ?2 WHERE id = ?1", params![id, now]);
    }

    /// A new password: a new login hash, and the account key wrapped under the new wrap key, together.
    pub fn set_password(&self, id: i64, login_hash: &str, wrapped: &str) -> rusqlite::Result<()> {
        self.lock().execute("UPDATE accounts SET login_hash = ?2, wrapped = ?3 WHERE id = ?1", params![id, login_hash, wrapped])?;
        Ok(())
    }

    // --- devices ----------------------------------------------------------------

    pub fn add_device_key(&self, id: i64, key: &str, label: &str, now: i64) -> rusqlite::Result<()> {
        self.lock().execute(
            "INSERT INTO device_keys (account_id, public_key, label, created_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(account_id, public_key) DO UPDATE SET label = excluded.label",
            params![id, key, label, now],
        )?;
        Ok(())
    }

    pub fn device_keys(&self, id: i64) -> Vec<String> {
        let conn = self.lock();
        let Ok(mut stmt) = conn.prepare("SELECT public_key FROM device_keys WHERE account_id = ?1") else {
            return Vec::new();
        };
        stmt.query_map(params![id], |r| r.get(0)).map(|rows| rows.filter_map(Result::ok).collect()).unwrap_or_default()
    }

    // --- recovery codes ---------------------------------------------------------

    /// Spends the code whose login half hashes to `hash`, and answers the account key wrapped under it.
    pub fn use_recovery_code(&self, id: i64, hash: &str, now: i64) -> Option<String> {
        let conn = self.lock();
        let found: Option<(i64, String)> = conn
            .query_row(
                "SELECT slot, wrapped FROM recovery_codes WHERE account_id = ?1 AND login_hash = ?2 AND used_at IS NULL",
                params![id, hash],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .ok()
            .flatten();
        let (slot, wrapped) = found?;
        conn.execute("UPDATE recovery_codes SET used_at = ?3 WHERE account_id = ?1 AND slot = ?2", params![id, slot, now]).ok()?;
        Some(wrapped)
    }

    /// A fresh sheet of codes in place of the old one.
    pub fn replace_recovery_codes(&self, id: i64, codes: &[(String, String)]) -> rusqlite::Result<()> {
        let mut conn = self.lock();
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM recovery_codes WHERE account_id = ?1", params![id])?;
        for (slot, (hash, wrapped)) in codes.iter().enumerate() {
            tx.execute("INSERT INTO recovery_codes (account_id, slot, login_hash, wrapped) VALUES (?1, ?2, ?3, ?4)", params![id, slot as i64, hash, wrapped])?;
        }
        tx.commit()
    }

    pub fn recovery_codes_left(&self, id: i64) -> i64 {
        self.lock()
            .query_row("SELECT COUNT(*) FROM recovery_codes WHERE account_id = ?1 AND used_at IS NULL", params![id], |r| r.get(0))
            .unwrap_or(0)
    }

    // --- notes ------------------------------------------------------------------

    /// Everything written after `since`, oldest first, at most `limit`; and whether there is more.
    pub fn notes_since(&self, id: i64, since: i64, limit: i64) -> rusqlite::Result<(Vec<NoteRow>, bool, i64)> {
        let conn = self.lock();
        let mut stmt = conn.prepare("SELECT id, rev, deleted, blob FROM notes WHERE account_id = ?1 AND rev > ?2 ORDER BY rev LIMIT ?3")?;
        let mut rows: Vec<NoteRow> = stmt
            .query_map(params![id, since, limit + 1], |r| Ok(NoteRow { id: r.get(0)?, rev: r.get(1)?, deleted: r.get::<_, i64>(2)? != 0, blob: r.get(3)? }))?
            .filter_map(Result::ok)
            .collect();
        let more = rows.len() as i64 > limit;
        rows.truncate(limit as usize);
        let head: i64 = conn.query_row("SELECT rev FROM accounts WHERE id = ?1", params![id], |r| r.get(0))?;
        Ok((rows, more, head))
    }

    fn note_in(tx: &rusqlite::Transaction<'_>, account: i64, note: &str) -> rusqlite::Result<Option<NoteRow>> {
        tx.query_row(
            "SELECT id, rev, deleted, blob FROM notes WHERE account_id = ?1 AND id = ?2",
            params![account, note],
            |r| Ok(NoteRow { id: r.get(0)?, rev: r.get(1)?, deleted: r.get::<_, i64>(2)? != 0, blob: r.get(3)? }),
        )
        .optional()
    }

    fn next_rev(tx: &rusqlite::Transaction<'_>, account: i64) -> rusqlite::Result<i64> {
        tx.execute("UPDATE accounts SET rev = rev + 1 WHERE id = ?1", params![account])?;
        tx.query_row("SELECT rev FROM accounts WHERE id = ?1", params![account], |r| r.get(0))
    }

    /// Stores a note written from revision `base`, or refuses it when the stored note has moved on since.
    ///
    /// A note the service has never seen is taken whatever its base: there is nothing it could overwrite.
    pub fn put_note(&self, account: i64, note: &str, base: i64, blob: Option<&str>, now: i64) -> Result<i64, WriteError> {
        let mut conn = self.lock();
        let tx = conn.transaction()?;
        if let Some(current) = Self::note_in(&tx, account, note)? {
            if current.rev != base {
                return Err(WriteError::Stale(current));
            }
        }
        let rev = Self::next_rev(&tx, account)?;
        tx.execute(
            "INSERT INTO notes (account_id, id, rev, deleted, blob, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(account_id, id) DO UPDATE SET rev = excluded.rev, deleted = excluded.deleted, blob = excluded.blob, updated_at = excluded.updated_at",
            params![account, note, rev, i64::from(blob.is_none()), blob, now],
        )?;
        tx.commit()?;
        Ok(rev)
    }

    // --- settings ---------------------------------------------------------------

    pub fn prefs(&self, account: i64) -> Option<(i64, String)> {
        self.lock()
            .query_row("SELECT rev, blob FROM prefs WHERE account_id = ?1", params![account], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()
            .ok()
            .flatten()
    }

    /// Stores settings written from `base`: 0 for "never seen any". Refused, with the stored ones, when stale.
    pub fn put_prefs(&self, account: i64, base: i64, blob: &str, now: i64) -> Result<i64, Option<(i64, String)>> {
        let mut conn = self.lock();
        let tx = conn.transaction().map_err(|_| None)?;
        let current: Option<(i64, String)> = tx
            .query_row("SELECT rev, blob FROM prefs WHERE account_id = ?1", params![account], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()
            .map_err(|_| None)?;
        let stored_rev = current.as_ref().map(|(rev, _)| *rev).unwrap_or(0);
        if stored_rev != base {
            return Err(current);
        }
        let rev = Self::next_rev(&tx, account).map_err(|_| None)?;
        tx.execute(
            "INSERT INTO prefs (account_id, rev, blob, updated_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(account_id) DO UPDATE SET rev = excluded.rev, blob = excluded.blob, updated_at = excluded.updated_at",
            params![account, rev, blob, now],
        )
        .map_err(|_| None)?;
        tx.commit().map_err(|_| None)?;
        Ok(rev)
    }

    // --- shares -----------------------------------------------------------------

    /// Writes an account's share: made if new, written again if it is theirs; refused if it is another's, or if a new
    /// one would take the account past `most`. Answers when it was written.
    pub fn put_share(&self, account: i64, id: &str, blob: &str, now: i64, most: i64) -> Result<i64, ShareWrite> {
        let mut conn = self.lock();
        let tx = conn.transaction().map_err(|_| ShareWrite::Failed)?;
        let owner: Option<i64> = tx
            .query_row("SELECT account_id FROM shares WHERE id = ?1", params![id], |r| r.get(0))
            .optional()
            .map_err(|_| ShareWrite::Failed)?;
        match owner {
            Some(owner) if owner != account => return Err(ShareWrite::Taken),
            Some(_) => {
                tx.execute("UPDATE shares SET blob = ?1, updated_at = ?2 WHERE id = ?3", params![blob, now, id]).map_err(|_| ShareWrite::Failed)?;
            }
            None => {
                let kept: i64 = tx
                    .query_row("SELECT COUNT(*) FROM shares WHERE account_id = ?1", params![account], |r| r.get(0))
                    .map_err(|_| ShareWrite::Failed)?;
                if kept >= most {
                    return Err(ShareWrite::Full);
                }
                tx.execute(
                    "INSERT INTO shares (id, account_id, blob, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
                    params![id, account, blob, now],
                )
                .map_err(|_| ShareWrite::Failed)?;
            }
        }
        tx.commit().map_err(|_| ShareWrite::Failed)?;
        Ok(now)
    }

    /// A share's ciphertext and when it was last written, for anyone who has its id.
    pub fn share(&self, id: &str) -> Option<(String, i64)> {
        self.lock()
            .query_row("SELECT blob, updated_at FROM shares WHERE id = ?1", params![id], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()
            .ok()
            .flatten()
    }

    /// Takes down an account's share; another's, or none, is left as it is. Answers whether one went.
    pub fn delete_share(&self, account: i64, id: &str) -> bool {
        self.lock().execute("DELETE FROM shares WHERE id = ?1 AND account_id = ?2", params![id, account]).map(|n| n > 0).unwrap_or(false)
    }

    /// An account's shares, newest written first: their ids and when each was written.
    pub fn shares_of(&self, account: i64) -> Vec<(String, i64)> {
        let conn = self.lock();
        let Ok(mut statement) = conn.prepare("SELECT id, updated_at FROM shares WHERE account_id = ?1 ORDER BY updated_at DESC") else {
            return Vec::new();
        };
        statement
            .query_map(params![account], |r| Ok((r.get(0)?, r.get(1)?)))
            .map(|rows| rows.filter_map(Result::ok).collect())
            .unwrap_or_default()
    }

    // --- recordings -------------------------------------------------------------

    fn recording_path(&self, account: i64, id: &str) -> PathBuf {
        self.recordings.join(account.to_string()).join(format!("{id}.bin"))
    }

    pub fn recording_rev(&self, account: i64, id: &str) -> Option<i64> {
        self.lock()
            .query_row("SELECT rev FROM recordings WHERE account_id = ?1 AND id = ?2", params![account, id], |r| r.get(0))
            .optional()
            .ok()
            .flatten()
    }

    /// Stores a recording written from `base`. The bytes go to a side file and are renamed into place only once the
    /// row is ready, so a reader never gets half a recording.
    pub fn put_recording(&self, account: i64, id: &str, base: i64, bytes: &[u8], now: i64) -> Result<i64, Option<i64>> {
        let dir = self.recordings.join(account.to_string());
        std::fs::create_dir_all(&dir).map_err(|_| None)?;
        let dest = self.recording_path(account, id);
        let part = dest.with_extension("part");
        std::fs::write(&part, bytes).map_err(|_| None)?;
        let mut conn = self.lock();
        let tx = conn.transaction().map_err(|_| None)?;
        let current: Option<i64> = tx
            .query_row("SELECT rev FROM recordings WHERE account_id = ?1 AND id = ?2", params![account, id], |r| r.get(0))
            .optional()
            .map_err(|_| None)?;
        if let Some(stored) = current {
            if stored != base {
                let _ = std::fs::remove_file(&part);
                return Err(Some(stored));
            }
        }
        let rev = Self::next_rev(&tx, account).map_err(|_| None)?;
        tx.execute(
            "INSERT INTO recordings (account_id, id, rev, size, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(account_id, id) DO UPDATE SET rev = excluded.rev, size = excluded.size, updated_at = excluded.updated_at",
            params![account, id, rev, bytes.len() as i64, now],
        )
        .map_err(|_| None)?;
        std::fs::rename(&part, &dest).map_err(|_| None)?;
        tx.commit().map_err(|_| None)?;
        Ok(rev)
    }

    pub fn recording(&self, account: i64, id: &str) -> Option<(i64, Vec<u8>)> {
        let rev = self.recording_rev(account, id)?;
        let bytes = std::fs::read(self.recording_path(account, id)).ok()?;
        Some((rev, bytes))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (Store, tempdir::TempDir) {
        let dir = tempdir::TempDir::new();
        (Store::in_memory(dir.path().join("recordings")), dir)
    }

    /// A folder under the system temp directory, removed when the test ends.
    mod tempdir {
        pub struct TempDir(std::path::PathBuf);
        impl TempDir {
            pub fn new() -> Self {
                let path = std::env::temp_dir().join(format!("glyph-store-{}-{}", std::process::id(), rand::random::<u64>()));
                std::fs::create_dir_all(&path).unwrap();
                Self(path)
            }
            pub fn path(&self) -> &std::path::Path {
                &self.0
            }
        }
        impl Drop for TempDir {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
    }

    fn account(s: &Store) -> Account {
        let codes = vec![("hash-a".to_string(), "wrap-a".to_string()), ("hash-b".to_string(), "wrap-b".to_string())];
        s.create_account("matt", "login-hash", "wrapped-key", Some(("device-key", "phone")), &codes, 100).unwrap()
    }

    #[test]
    fn a_signup_keeps_everything_it_came_with() {
        let (s, _dir) = store();
        let a = account(&s);
        let found = s.account_by_handle("MATT").expect("handles match without case");
        assert_eq!(found.id, a.id);
        assert_eq!(found.wrapped, "wrapped-key");
        assert_eq!(s.device_keys(a.id), vec!["device-key".to_string()]);
        assert_eq!(s.recovery_codes_left(a.id), 2);
        assert!(s.create_account("Matt", "", "", None, &[], 101).is_err(), "a handle is taken whatever its case");
    }

    #[test]
    fn a_recovery_code_answers_its_own_wrapped_key_once() {
        let (s, _dir) = store();
        let a = account(&s);
        assert_eq!(s.use_recovery_code(a.id, "hash-b", 200).as_deref(), Some("wrap-b"));
        assert_eq!(s.use_recovery_code(a.id, "hash-b", 201), None, "spent");
        assert_eq!(s.use_recovery_code(a.id, "nope", 202), None);
        assert_eq!(s.recovery_codes_left(a.id), 1);
    }

    #[test]
    fn notes_are_written_from_the_revision_they_saw() {
        let (s, _dir) = store();
        let a = account(&s);
        let first = s.put_note(a.id, "n1", 0, Some("v1"), 1).unwrap();
        let second = s.put_note(a.id, "n1", first, Some("v2"), 2).unwrap();
        assert!(second > first);
        // A device that only saw the first version lost the race: it is told what won.
        match s.put_note(a.id, "n1", first, Some("v2-elsewhere"), 3) {
            Err(WriteError::Stale(winner)) => assert_eq!((winner.rev, winner.blob.as_deref()), (second, Some("v2"))),
            other => panic!("expected a stale write, got {other:?}"),
        }
    }

    #[test]
    fn a_note_never_seen_is_taken_whatever_it_claims() {
        let (s, _dir) = store();
        let a = account(&s);
        assert!(s.put_note(a.id, "new", 42, Some("v"), 1).is_ok());
    }

    #[test]
    fn the_feed_carries_writes_and_deletions_in_order_with_paging() {
        let (s, _dir) = store();
        let a = account(&s);
        let r1 = s.put_note(a.id, "a", 0, Some("a1"), 1).unwrap();
        s.put_note(a.id, "b", 0, Some("b1"), 2).unwrap();
        s.put_note(a.id, "a", r1, None, 3).unwrap();
        let (page, more, head) = s.notes_since(a.id, 0, 2).unwrap();
        assert_eq!(page.iter().map(|n| n.id.as_str()).collect::<Vec<_>>(), vec!["b", "a"]);
        assert!(!more);
        assert!(page[1].deleted && page[1].blob.is_none());
        assert_eq!(head, page[1].rev);
        let (rest, _, _) = s.notes_since(a.id, page[0].rev, 10).unwrap();
        assert_eq!(rest.len(), 1);
        let (one, more, _) = s.notes_since(a.id, 0, 1).unwrap();
        assert_eq!(one.len(), 1);
        assert!(more);
    }

    #[test]
    fn one_account_never_sees_another() {
        let (s, _dir) = store();
        let a = account(&s);
        let b = s.create_account("other", "", "", Some(("k2", "d")), &[], 1).unwrap();
        s.put_note(a.id, "mine", 0, Some("secret"), 1).unwrap();
        assert!(s.notes_since(b.id, 0, 10).unwrap().0.is_empty());
        assert!(s.put_note(b.id, "mine", 0, Some("theirs"), 2).is_ok(), "the same id in another account is another note");
        assert_eq!(s.notes_since(a.id, 0, 10).unwrap().0[0].blob.as_deref(), Some("secret"));
    }

    #[test]
    fn settings_are_written_from_the_revision_they_saw() {
        let (s, _dir) = store();
        let a = account(&s);
        let first = s.put_prefs(a.id, 0, "p1", 1).unwrap();
        assert_eq!(s.put_prefs(a.id, 0, "stale", 2), Err(Some((first, "p1".to_string()))));
        let second = s.put_prefs(a.id, first, "p2", 3).unwrap();
        assert_eq!(s.prefs(a.id), Some((second, "p2".to_string())));
    }

    #[test]
    fn recordings_are_whole_files_with_their_own_revision() {
        let (s, _dir) = store();
        let a = account(&s);
        let rev = s.put_recording(a.id, "n1", 0, b"audio-1", 1).unwrap();
        assert_eq!(s.recording(a.id, "n1"), Some((rev, b"audio-1".to_vec())));
        assert_eq!(s.put_recording(a.id, "n1", 0, b"stale", 2), Err(Some(rev)));
        assert_eq!(s.recording(a.id, "n1").unwrap().1, b"audio-1".to_vec(), "a refused write leaves the file alone");
        let next = s.put_recording(a.id, "n1", rev, b"audio-2", 3).unwrap();
        assert_eq!(s.recording(a.id, "n1"), Some((next, b"audio-2".to_vec())));
    }

    #[test]
    fn a_new_password_replaces_the_hash_and_the_wrapped_key_together() {
        let (s, _dir) = store();
        let a = account(&s);
        s.set_password(a.id, "new-hash", "new-wrap").unwrap();
        let after = s.account_by_id(a.id).unwrap();
        assert_eq!((after.login_hash.as_str(), after.wrapped.as_str()), ("new-hash", "new-wrap"));
    }
}
