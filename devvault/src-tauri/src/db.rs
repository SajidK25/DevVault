//! SQLite layer. The DB *structure* is visible on disk, but every secret value
//! (`fields.value`, `entries.notes`) is an AES-GCM blob — nothing readable
//! (spec §4 encryption boundary). Titles, tags, labels and project names stay
//! plaintext so search works without a full decrypt.

use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;

use crate::crypto::KdfParams;
use crate::error::{Result, VaultError};

const SCHEMA: &str = r#"
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS vault_meta (
    id           INTEGER PRIMARY KEY CHECK (id = 1),
    salt         BLOB    NOT NULL,
    argon2_mem   INTEGER NOT NULL,
    argon2_iters INTEGER NOT NULL,
    argon2_par   INTEGER NOT NULL,
    verifier     BLOB    NOT NULL,
    created_at   TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    description TEXT,
    color       TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entries (
    id         TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    type       TEXT NOT NULL CHECK (type IN ('credential','api_key','secret','note')),
    title      TEXT NOT NULL,                 -- plaintext, searchable
    tags       TEXT NOT NULL DEFAULT '[]',    -- JSON array, plaintext, searchable
    notes      BLOB,                          -- encrypted markdown (nonce||ct)
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fields (
    id       TEXT    PRIMARY KEY,
    entry_id TEXT    NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    label    TEXT    NOT NULL,               -- plaintext, searchable
    value    BLOB    NOT NULL,               -- encrypted (nonce||ct)
    secret   INTEGER NOT NULL DEFAULT 0,     -- bool: masked in UI by default
    position INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_entries_project ON entries(project_id);
CREATE INDEX IF NOT EXISTS idx_fields_entry    ON fields(entry_id);
"#;

/// Open (creating if needed) the vault DB and apply the schema.
pub fn open(path: &std::path::Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.execute_batch(SCHEMA)?;
    Ok(conn)
}

/// Open an in-memory DB with the schema applied — used by tests.
#[cfg(test)]
pub fn open_in_memory() -> Result<Connection> {
    let conn = Connection::open_in_memory()?;
    conn.execute_batch(SCHEMA)?;
    Ok(conn)
}

/// The persisted root-of-trust material. Never contains the key or password.
#[derive(Debug, Clone)]
pub struct VaultMeta {
    pub salt: Vec<u8>,
    pub params: KdfParams,
    pub verifier: Vec<u8>,
}

/// True once a master password has been established.
pub fn is_setup(conn: &Connection) -> Result<bool> {
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM vault_meta", [], |r| r.get(0))?;
    Ok(n > 0)
}

/// Read the single vault_meta row, if present.
pub fn read_meta(conn: &Connection) -> Result<Option<VaultMeta>> {
    let meta = conn
        .query_row(
            "SELECT salt, argon2_mem, argon2_iters, argon2_par, verifier
             FROM vault_meta WHERE id = 1",
            [],
            |row| {
                Ok(VaultMeta {
                    salt: row.get(0)?,
                    params: KdfParams {
                        mem_kib: row.get::<_, i64>(1)? as u32,
                        iters: row.get::<_, i64>(2)? as u32,
                        parallelism: row.get::<_, i64>(3)? as u32,
                    },
                    verifier: row.get(4)?,
                })
            },
        )
        .optional()?;
    Ok(meta)
}

/// Insert the vault_meta row on first-run setup.
pub fn write_meta(conn: &Connection, meta: &VaultMeta, created_at: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO vault_meta
            (id, salt, argon2_mem, argon2_iters, argon2_par, verifier, created_at)
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            meta.salt,
            meta.params.mem_kib as i64,
            meta.params.iters as i64,
            meta.params.parallelism as i64,
            meta.verifier,
            created_at,
        ],
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Projects (all columns plaintext)
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub entry_count: i64,
}

/// Map a UNIQUE-constraint violation on project name to a friendly error.
fn map_unique(e: rusqlite::Error, friendly: &str) -> VaultError {
    let msg = e.to_string();
    if msg.contains("UNIQUE") {
        VaultError::Conflict(friendly.to_string())
    } else {
        VaultError::Db(msg)
    }
}

pub fn create_project(
    conn: &Connection,
    id: &str,
    name: &str,
    description: Option<&str>,
    color: Option<&str>,
    now: &str,
) -> Result<()> {
    conn.execute(
        "INSERT INTO projects (id, name, description, color, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        rusqlite::params![id, name, description, color, now],
    )
    .map_err(|e| map_unique(e, "a project with that name already exists"))?;
    Ok(())
}

pub fn list_projects(conn: &Connection) -> Result<Vec<Project>> {
    let mut stmt = conn.prepare(
        "SELECT p.id, p.name, p.description, p.color, p.created_at, p.updated_at,
                (SELECT COUNT(*) FROM entries e WHERE e.project_id = p.id)
         FROM projects p
         ORDER BY p.name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Project {
            id: r.get(0)?,
            name: r.get(1)?,
            description: r.get(2)?,
            color: r.get(3)?,
            created_at: r.get(4)?,
            updated_at: r.get(5)?,
            entry_count: r.get(6)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn update_project(
    conn: &Connection,
    id: &str,
    name: &str,
    description: Option<&str>,
    color: Option<&str>,
    now: &str,
) -> Result<()> {
    let n = conn
        .execute(
            "UPDATE projects SET name = ?2, description = ?3, color = ?4, updated_at = ?5
             WHERE id = ?1",
            rusqlite::params![id, name, description, color, now],
        )
        .map_err(|e| map_unique(e, "a project with that name already exists"))?;
    if n == 0 {
        return Err(VaultError::NotFound("project".into()));
    }
    Ok(())
}

pub fn delete_project(conn: &Connection, id: &str) -> Result<()> {
    // entries + fields cascade via FK.
    let n = conn.execute("DELETE FROM projects WHERE id = ?1", [id])?;
    if n == 0 {
        return Err(VaultError::NotFound("project".into()));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Entries & fields. `value` / `notes` are raw AES-GCM blobs — the db layer
// never encrypts or decrypts; callers (commands) own the key.
// ---------------------------------------------------------------------------

/// Lightweight list row — no secrets, no notes (spec §8 `EntryMeta`).
#[derive(Debug, Serialize)]
pub struct EntryMeta {
    pub id: String,
    pub project_id: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub title: String,
    pub tags: Vec<String>,
    pub updated_at: String,
}

/// Raw entry row as stored (notes still encrypted).
pub struct EntryRow {
    pub id: String,
    pub project_id: String,
    pub type_: String,
    pub title: String,
    pub tags: Vec<String>,
    pub notes: Option<Vec<u8>>,
    pub created_at: String,
    pub updated_at: String,
}

/// Raw field row as stored (value still encrypted). Storage order is the slice
/// order on insert; reads come back ordered by the `position` column.
pub struct FieldRow {
    pub label: String,
    pub value: Vec<u8>,
    pub secret: bool,
}

fn tags_to_json(tags: &[String]) -> String {
    serde_json::to_string(tags).unwrap_or_else(|_| "[]".into())
}

fn tags_from_json(s: &str) -> Vec<String> {
    serde_json::from_str(s).unwrap_or_default()
}

pub fn list_entry_meta(conn: &Connection, project_id: &str) -> Result<Vec<EntryMeta>> {
    let mut stmt = conn.prepare(
        "SELECT id, project_id, type, title, tags, updated_at
         FROM entries WHERE project_id = ?1
         ORDER BY updated_at DESC",
    )?;
    let rows = stmt.query_map([project_id], |r| {
        let tags_json: String = r.get(4)?;
        Ok(EntryMeta {
            id: r.get(0)?,
            project_id: r.get(1)?,
            type_: r.get(2)?,
            title: r.get(3)?,
            tags: tags_from_json(&tags_json),
            updated_at: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn get_entry_row(conn: &Connection, id: &str) -> Result<EntryRow> {
    let row = conn
        .query_row(
            "SELECT id, project_id, type, title, tags, notes, created_at, updated_at
             FROM entries WHERE id = ?1",
            [id],
            |r| {
                let tags_json: String = r.get(4)?;
                Ok(EntryRow {
                    id: r.get(0)?,
                    project_id: r.get(1)?,
                    type_: r.get(2)?,
                    title: r.get(3)?,
                    tags: tags_from_json(&tags_json),
                    notes: r.get(5)?,
                    created_at: r.get(6)?,
                    updated_at: r.get(7)?,
                })
            },
        )
        .optional()?;
    row.ok_or(VaultError::NotFound("entry".into()))
}

pub fn get_entry_fields(conn: &Connection, entry_id: &str) -> Result<Vec<FieldRow>> {
    let mut stmt = conn.prepare(
        "SELECT label, value, secret, position FROM fields
         WHERE entry_id = ?1 ORDER BY position",
    )?;
    let rows = stmt.query_map([entry_id], |r| {
        Ok(FieldRow {
            label: r.get(0)?,
            value: r.get(1)?,
            secret: r.get::<_, i64>(2)? != 0,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Insert an entry and its fields atomically.
pub fn insert_entry(conn: &mut Connection, row: &EntryRow, fields: &[FieldRow]) -> Result<()> {
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO entries (id, project_id, type, title, tags, notes, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        rusqlite::params![
            row.id,
            row.project_id,
            row.type_,
            row.title,
            tags_to_json(&row.tags),
            row.notes,
            row.created_at,
        ],
    )?;
    insert_fields(&tx, &row.id, fields)?;
    tx.commit()?;
    Ok(())
}

/// Replace an entry's mutable data and all its fields atomically.
pub fn update_entry(conn: &mut Connection, row: &EntryRow, fields: &[FieldRow]) -> Result<()> {
    let tx = conn.transaction()?;
    let n = tx.execute(
        "UPDATE entries SET type = ?2, title = ?3, tags = ?4, notes = ?5, updated_at = ?6
         WHERE id = ?1",
        rusqlite::params![
            row.id,
            row.type_,
            row.title,
            tags_to_json(&row.tags),
            row.notes,
            row.updated_at,
        ],
    )?;
    if n == 0 {
        return Err(VaultError::NotFound("entry".into()));
    }
    tx.execute("DELETE FROM fields WHERE entry_id = ?1", [&row.id])?;
    insert_fields(&tx, &row.id, fields)?;
    tx.commit()?;
    Ok(())
}

fn insert_fields(tx: &rusqlite::Transaction, entry_id: &str, fields: &[FieldRow]) -> Result<()> {
    let mut stmt = tx.prepare(
        "INSERT INTO fields (id, entry_id, label, value, secret, position)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )?;
    for (i, f) in fields.iter().enumerate() {
        stmt.execute(rusqlite::params![
            uuid::Uuid::new_v4().to_string(),
            entry_id,
            f.label,
            f.value,
            f.secret as i64,
            i as i64,
        ])?;
    }
    Ok(())
}

pub fn delete_entry(conn: &Connection, id: &str) -> Result<()> {
    let n = conn.execute("DELETE FROM entries WHERE id = ?1", [id])?;
    if n == 0 {
        return Err(VaultError::NotFound("entry".into()));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Search — operates only on plaintext columns (project name, entry title,
// tags, field labels). Secret values are never indexed or matched.
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct SearchHit {
    pub project_id: String,
    pub project_name: String,
    pub entry_id: Option<String>,
    pub entry_title: Option<String>,
    #[serde(rename = "type")]
    pub entry_type: Option<String>,
    /// Where the match landed: "title" | "tag" | "field" | "project".
    pub matched_on: String,
    pub snippet: String,
}

/// Match priority — lower wins when the same entry matches multiple ways.
fn priority(matched: &str) -> u8 {
    match matched {
        "title" => 0,
        "tag" => 1,
        _ => 2, // field
    }
}

pub fn search(conn: &Connection, query: &str) -> Result<Vec<SearchHit>> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    // Escape LIKE wildcards in the user query, then wrap.
    let escaped = q
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    let pattern = format!("%{}%", escaped);
    let q_lower = q.to_lowercase();

    use std::collections::HashMap;
    let mut by_entry: HashMap<String, SearchHit> = HashMap::new();

    let mut upsert = |hit: SearchHit| {
        let id = hit.entry_id.clone().unwrap();
        match by_entry.get(&id) {
            Some(existing) if priority(&existing.matched_on) <= priority(&hit.matched_on) => {}
            _ => {
                by_entry.insert(id, hit);
            }
        }
    };

    // Field-label matches.
    {
        let mut stmt = conn.prepare(
            "SELECT e.id, e.project_id, e.type, e.title, p.name, f.label
             FROM fields f
             JOIN entries e ON e.id = f.entry_id
             JOIN projects p ON p.id = e.project_id
             WHERE f.label LIKE ?1 ESCAPE '\\'",
        )?;
        let rows = stmt.query_map([&pattern], |r| {
            Ok(SearchHit {
                entry_id: Some(r.get::<_, String>(0)?),
                project_id: r.get(1)?,
                entry_type: Some(r.get::<_, String>(2)?),
                entry_title: Some(r.get::<_, String>(3)?),
                project_name: r.get(4)?,
                matched_on: "field".into(),
                snippet: r.get(5)?,
            })
        })?;
        for h in rows {
            upsert(h?);
        }
    }

    // Title + tag matches (one pass over entries that match either).
    {
        let mut stmt = conn.prepare(
            "SELECT e.id, e.project_id, e.type, e.title, e.tags, p.name
             FROM entries e
             JOIN projects p ON p.id = e.project_id
             WHERE e.title LIKE ?1 ESCAPE '\\' OR e.tags LIKE ?1 ESCAPE '\\'",
        )?;
        let rows = stmt.query_map([&pattern], |r| {
            let id: String = r.get(0)?;
            let project_id: String = r.get(1)?;
            let type_: String = r.get(2)?;
            let title: String = r.get(3)?;
            let tags_json: String = r.get(4)?;
            let project_name: String = r.get(5)?;
            Ok((id, project_id, type_, title, tags_json, project_name))
        })?;
        for row in rows {
            let (id, project_id, type_, title, tags_json, project_name) = row?;
            let title_match = title.to_lowercase().contains(&q_lower);
            if title_match {
                upsert(SearchHit {
                    entry_id: Some(id.clone()),
                    project_id: project_id.clone(),
                    entry_type: Some(type_.clone()),
                    entry_title: Some(title.clone()),
                    project_name: project_name.clone(),
                    matched_on: "title".into(),
                    snippet: title.clone(),
                });
            } else {
                let tag = tags_from_json(&tags_json)
                    .into_iter()
                    .find(|t| t.to_lowercase().contains(&q_lower))
                    .unwrap_or_else(|| q.to_string());
                upsert(SearchHit {
                    entry_id: Some(id),
                    project_id,
                    entry_type: Some(type_),
                    entry_title: Some(title),
                    project_name,
                    matched_on: "tag".into(),
                    snippet: tag,
                });
            }
        }
    }

    let mut hits: Vec<SearchHit> = by_entry.into_values().collect();

    // Project-name matches (no specific entry).
    {
        let mut stmt =
            conn.prepare("SELECT id, name FROM projects WHERE name LIKE ?1 ESCAPE '\\'")?;
        let rows = stmt.query_map([&pattern], |r| {
            let id: String = r.get(0)?;
            let name: String = r.get(1)?;
            Ok(SearchHit {
                project_id: id,
                project_name: name.clone(),
                entry_id: None,
                entry_title: None,
                entry_type: None,
                matched_on: "project".into(),
                snippet: name,
            })
        })?;
        for h in rows {
            hits.push(h?);
        }
    }

    // Stable-ish ordering: projects first, then entries by title.
    hits.sort_by(|a, b| {
        let ka = (
            a.entry_id.is_some(),
            a.entry_title.clone().unwrap_or_default(),
        );
        let kb = (
            b.entry_id.is_some(),
            b.entry_title.clone().unwrap_or_default(),
        );
        ka.cmp(&kb)
    });
    Ok(hits)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_db_is_not_setup() {
        let conn = open_in_memory().unwrap();
        assert!(!is_setup(&conn).unwrap());
        assert!(read_meta(&conn).unwrap().is_none());
    }

    #[test]
    fn write_then_read_meta_round_trips() {
        let conn = open_in_memory().unwrap();
        let meta = VaultMeta {
            salt: vec![1, 2, 3, 4],
            params: KdfParams::default(),
            verifier: vec![9, 8, 7],
        };
        write_meta(&conn, &meta, "2026-06-06T00:00:00Z").unwrap();

        assert!(is_setup(&conn).unwrap());
        let got = read_meta(&conn).unwrap().unwrap();
        assert_eq!(got.salt, meta.salt);
        assert_eq!(got.verifier, meta.verifier);
        assert_eq!(got.params.mem_kib, meta.params.mem_kib);
        assert_eq!(got.params.iters, meta.params.iters);
        assert_eq!(got.params.parallelism, meta.params.parallelism);
    }

    #[test]
    fn meta_row_is_singleton() {
        let conn = open_in_memory().unwrap();
        let meta = VaultMeta {
            salt: vec![1],
            params: KdfParams::default(),
            verifier: vec![2],
        };
        write_meta(&conn, &meta, "t").unwrap();
        // Second insert must fail (id=1 primary key already taken).
        assert!(write_meta(&conn, &meta, "t").is_err());
    }
}
