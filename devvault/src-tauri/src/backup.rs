//! Timestamped backups and encrypted export/import.
//!
//! A backup / `.vault` export is a standalone SQLite copy of the live database,
//! produced with SQLite's online backup API (so it is consistent even with WAL
//! writes in flight). Secret values inside it stay AES-GCM encrypted exactly as
//! on disk — the file is only as readable as the main vault (titles/tags/labels
//! plaintext, values encrypted). Plaintext export is separate and re-auth-gated.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, DatabaseName};
use serde::Serialize;

use crate::error::{Result, VaultError};

/// How many automatic backups to retain (spec §5, default 20).
const KEEP: usize = 20;

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// `~/.devvault/backups`, created if missing.
pub fn backups_dir() -> Result<PathBuf> {
    let dir = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".devvault")
        .join("backups");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

#[derive(Debug, Serialize)]
pub struct BackupInfo {
    pub path: String,
    pub filename: String,
    pub created_ms: u128,
    pub size_bytes: u64,
}

/// Copy the live DB to `dst` using the online backup API.
pub fn backup_to(conn: &Connection, dst: &Path) -> Result<()> {
    conn.backup(DatabaseName::Main, dst, None)
        .map_err(|e| VaultError::Db(format!("backup: {e}")))
}

/// Take a timestamped automatic backup and prune old ones. Returns the path.
pub fn backup_now(conn: &Connection) -> Result<String> {
    let dir = backups_dir()?;
    let path = dir.join(format!("devvault-{}.vault", now_millis()));
    backup_to(conn, &path)?;
    rotate(&dir)?;
    Ok(path.to_string_lossy().into_owned())
}

/// Best-effort auto-backup: never let a backup failure block the user's save.
pub fn auto_backup(conn: &Connection) {
    if let Err(e) = backup_now(conn) {
        eprintln!("auto-backup failed: {e}");
    }
}

fn rotate(dir: &Path) -> Result<()> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            p.extension().map(|x| x == "vault").unwrap_or(false)
                && p.file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| n.starts_with("devvault-"))
                    .unwrap_or(false)
        })
        .collect();
    // Filenames embed unix-millis, so lexical sort == chronological.
    files.sort();
    if files.len() > KEEP {
        for old in &files[..files.len() - KEEP] {
            let _ = std::fs::remove_file(old);
        }
    }
    Ok(())
}

pub fn list_backups() -> Result<Vec<BackupInfo>> {
    let dir = backups_dir()?;
    let mut out: Vec<BackupInfo> = Vec::new();
    for entry in std::fs::read_dir(&dir)? {
        let entry = entry?;
        let path = entry.path();
        let filename = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) if n.starts_with("devvault-") && n.ends_with(".vault") => n.to_string(),
            _ => continue,
        };
        let created_ms = filename
            .trim_start_matches("devvault-")
            .trim_end_matches(".vault")
            .parse::<u128>()
            .unwrap_or(0);
        let size_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
        out.push(BackupInfo {
            path: path.to_string_lossy().into_owned(),
            filename,
            created_ms,
            size_bytes,
        });
    }
    out.sort_by(|a, b| b.created_ms.cmp(&a.created_ms)); // newest first
    Ok(out)
}

/// Validate that `src` is a DevVault vault (has a vault_meta row), then restore
/// the live DB from it. Caller must lock the vault afterwards: the restored DB
/// has its own salt/verifier, so the current in-memory key no longer applies.
pub fn restore_from(conn: &mut Connection, src: &Path) -> Result<()> {
    if !src.exists() {
        return Err(VaultError::NotFound("backup file".into()));
    }
    // Validate without disturbing the live connection.
    {
        let probe = Connection::open(src)
            .map_err(|e| VaultError::Db(format!("open backup: {e}")))?;
        let ok: bool = probe
            .query_row(
                "SELECT COUNT(*) FROM vault_meta",
                [],
                |r| r.get::<_, i64>(0).map(|n| n > 0),
            )
            .map_err(|_| VaultError::Conflict("not a DevVault vault file".into()))?;
        if !ok {
            return Err(VaultError::Conflict("vault file has no master record".into()));
        }
    }
    conn.restore(DatabaseName::Main, src, None::<fn(rusqlite::backup::Progress)>)
        .map_err(|e| VaultError::Db(format!("restore: {e}")))
}
