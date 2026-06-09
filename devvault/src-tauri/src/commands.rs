//! `#[tauri::command]` handlers exposed to the frontend (spec §8). For build
//! steps 1–4 this is the setup/unlock surface only.

use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::backup;
use crate::crypto::{self, KdfParams};
use crate::db::{self, EntryMeta, EntryRow, FieldRow, Project, VaultMeta};
use crate::error::{Result, VaultError};
use crate::vault::VaultState;

#[derive(Serialize)]
pub struct VaultStatus {
    pub is_setup: bool,
    pub is_unlocked: bool,
}

/// Unix-millis-as-string timestamp. Good enough for created_at without pulling
/// in a date library; later steps can format it for display.
fn now_string() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis().to_string())
        .unwrap_or_else(|_| "0".into())
}

#[tauri::command]
pub fn is_setup(state: State<VaultState>) -> Result<bool> {
    let conn = state.db.lock().unwrap();
    db::is_setup(&conn)
}

#[tauri::command]
pub fn is_unlocked(state: State<VaultState>) -> bool {
    state.is_unlocked()
}

#[tauri::command]
pub fn vault_status(state: State<VaultState>) -> Result<VaultStatus> {
    let conn = state.db.lock().unwrap();
    Ok(VaultStatus {
        is_setup: db::is_setup(&conn)?,
        is_unlocked: state.is_unlocked(),
    })
}

/// First-run: establish the master password. Derives the key, persists salt +
/// Argon2 params + verifier, and leaves the vault unlocked.
#[tauri::command]
pub fn setup_master(state: State<VaultState>, password: String) -> Result<()> {
    setup_master_impl(&state, &password)
}

/// Derive the key from the password and hold it in memory iff it matches the
/// stored verifier. Wrong passwords are throttled after repeated failures.
#[tauri::command]
pub fn unlock(state: State<VaultState>, password: String) -> Result<()> {
    unlock_impl(&state, &password)
}

#[tauri::command]
pub fn lock(state: State<VaultState>) {
    state.lock();
}

// ===========================================================================
// Projects (plaintext metadata; still gated on an unlocked vault)
// ===========================================================================

fn ensure_unlocked(state: &VaultState) -> Result<()> {
    if state.is_unlocked() {
        Ok(())
    } else {
        Err(VaultError::Locked)
    }
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

#[tauri::command]
pub fn list_projects(state: State<VaultState>) -> Result<Vec<Project>> {
    ensure_unlocked(&state)?;
    let conn = state.db.lock().unwrap();
    db::list_projects(&conn)
}

#[tauri::command]
pub fn create_project(
    state: State<VaultState>,
    name: String,
    description: Option<String>,
    color: Option<String>,
) -> Result<Project> {
    ensure_unlocked(&state)?;
    let id = new_id();
    let now = now_string();
    let conn = state.db.lock().unwrap();
    db::create_project(&conn, &id, &name, description.as_deref(), color.as_deref(), &now)?;
    Ok(Project {
        id,
        name,
        description,
        color,
        created_at: now.clone(),
        updated_at: now,
        entry_count: 0,
    })
}

#[tauri::command]
pub fn update_project(
    state: State<VaultState>,
    id: String,
    name: String,
    description: Option<String>,
    color: Option<String>,
) -> Result<()> {
    ensure_unlocked(&state)?;
    let now = now_string();
    let conn = state.db.lock().unwrap();
    db::update_project(&conn, &id, &name, description.as_deref(), color.as_deref(), &now)
}

#[tauri::command]
pub fn delete_project(state: State<VaultState>, id: String) -> Result<()> {
    ensure_unlocked(&state)?;
    let conn = state.db.lock().unwrap();
    db::delete_project(&conn, &id)
}

// ===========================================================================
// Entries (field values + notes encrypted with the in-memory key)
// ===========================================================================

#[derive(Deserialize)]
pub struct FieldInput {
    pub label: String,
    pub value: String,
    pub secret: bool,
}

#[derive(Serialize)]
pub struct FieldOutput {
    pub label: String,
    pub value: String,
    pub secret: bool,
}

/// Fully decrypted entry for the editor (spec §8 `get_entry`).
#[derive(Serialize)]
pub struct EntryFull {
    pub id: String,
    pub project_id: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub title: String,
    pub tags: Vec<String>,
    pub notes: String,
    pub fields: Vec<FieldOutput>,
    pub created_at: String,
    pub updated_at: String,
}

#[tauri::command]
pub fn list_entries(state: State<VaultState>, project_id: String) -> Result<Vec<EntryMeta>> {
    ensure_unlocked(&state)?;
    let conn = state.db.lock().unwrap();
    db::list_entry_meta(&conn, &project_id)
}

#[tauri::command]
pub fn get_entry(state: State<VaultState>, id: String) -> Result<EntryFull> {
    let key = state.current_key().ok_or(VaultError::Locked)?;
    let conn = state.db.lock().unwrap();
    let row = db::get_entry_row(&conn, &id)?;
    let field_rows = db::get_entry_fields(&conn, &id)?;
    drop(conn);

    let notes = match &row.notes {
        Some(blob) => String::from_utf8_lossy(&crypto::decrypt(&key, blob)?).into_owned(),
        None => String::new(),
    };
    let mut fields = Vec::with_capacity(field_rows.len());
    for f in &field_rows {
        let value = String::from_utf8_lossy(&crypto::decrypt(&key, &f.value)?).into_owned();
        fields.push(FieldOutput {
            label: f.label.clone(),
            value,
            secret: f.secret,
        });
    }

    Ok(EntryFull {
        id: row.id,
        project_id: row.project_id,
        type_: row.type_,
        title: row.title,
        tags: row.tags,
        notes,
        fields,
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

/// Encrypt the supplied fields/notes into raw blob rows.
fn encrypt_payload(
    key: &crypto::Key32,
    notes: &str,
    fields: &[FieldInput],
) -> Result<(Option<Vec<u8>>, Vec<FieldRow>)> {
    let notes_blob = if notes.is_empty() {
        None
    } else {
        Some(crypto::encrypt(key, notes.as_bytes())?)
    };
    let mut rows = Vec::with_capacity(fields.len());
    for f in fields {
        rows.push(FieldRow {
            label: f.label.clone(),
            value: crypto::encrypt(key, f.value.as_bytes())?,
            secret: f.secret,
        });
    }
    Ok((notes_blob, rows))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn create_entry(
    state: State<VaultState>,
    project_id: String,
    r#type: String,
    title: String,
    tags: Vec<String>,
    notes: String,
    fields: Vec<FieldInput>,
) -> Result<EntryMeta> {
    let key = state.current_key().ok_or(VaultError::Locked)?;
    let (notes_blob, field_rows) = encrypt_payload(&key, &notes, &fields)?;

    let id = new_id();
    let now = now_string();
    let row = EntryRow {
        id: id.clone(),
        project_id: project_id.clone(),
        type_: r#type.clone(),
        title: title.clone(),
        tags: tags.clone(),
        notes: notes_blob,
        created_at: now.clone(),
        updated_at: now.clone(),
    };

    let mut conn = state.db.lock().unwrap();
    db::insert_entry(&mut conn, &row, &field_rows)?;
    backup::auto_backup(&conn); // automatic backup on every save (spec §5)

    Ok(EntryMeta {
        id,
        project_id,
        type_: r#type,
        title,
        tags,
        updated_at: now,
    })
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn update_entry(
    state: State<VaultState>,
    id: String,
    r#type: String,
    title: String,
    tags: Vec<String>,
    notes: String,
    fields: Vec<FieldInput>,
) -> Result<EntryMeta> {
    let key = state.current_key().ok_or(VaultError::Locked)?;
    let (notes_blob, field_rows) = encrypt_payload(&key, &notes, &fields)?;

    let now = now_string();
    let row = EntryRow {
        id: id.clone(),
        project_id: String::new(), // unchanged; not written by update_entry
        type_: r#type.clone(),
        title: title.clone(),
        tags: tags.clone(),
        notes: notes_blob,
        created_at: String::new(), // unchanged; not written by update_entry
        updated_at: now.clone(),
    };

    let mut conn = state.db.lock().unwrap();
    db::update_entry(&mut conn, &row, &field_rows)?;
    backup::auto_backup(&conn);

    Ok(EntryMeta {
        id,
        project_id: String::new(),
        type_: r#type,
        title,
        tags,
        updated_at: now,
    })
}

#[tauri::command]
pub fn delete_entry(state: State<VaultState>, id: String) -> Result<()> {
    ensure_unlocked(&state)?;
    let conn = state.db.lock().unwrap();
    db::delete_entry(&conn, &id)?;
    backup::auto_backup(&conn);
    Ok(())
}

// ===========================================================================
// Search (plaintext columns only — never touches encrypted values)
// ===========================================================================

#[tauri::command]
pub fn search(state: State<VaultState>, query: String) -> Result<Vec<db::SearchHit>> {
    ensure_unlocked(&state)?;
    let conn = state.db.lock().unwrap();
    db::search(&conn, &query)
}

// ===========================================================================
// Backups & export / import (spec §5, §8)
// ===========================================================================

#[tauri::command]
pub fn backup_now(state: State<VaultState>) -> Result<String> {
    ensure_unlocked(&state)?;
    let conn = state.db.lock().unwrap();
    backup::backup_now(&conn)
}

#[tauri::command]
pub fn list_backups(state: State<VaultState>) -> Result<Vec<backup::BackupInfo>> {
    ensure_unlocked(&state)?;
    backup::list_backups()
}

/// Restore the live vault from a previous automatic backup. Locks afterwards —
/// the restored vault may have a different master password.
#[tauri::command]
pub fn restore_backup(state: State<VaultState>, path: String) -> Result<()> {
    ensure_unlocked(&state)?;
    {
        let mut conn = state.db.lock().unwrap();
        backup::restore_from(&mut conn, std::path::Path::new(&path))?;
    }
    state.lock();
    Ok(())
}

/// Export the encrypted vault to a user-chosen `.vault` file.
#[tauri::command]
pub fn export_encrypted(state: State<VaultState>, path: String) -> Result<()> {
    ensure_unlocked(&state)?;
    let conn = state.db.lock().unwrap();
    backup::backup_to(&conn, std::path::Path::new(&path))
}

/// Import (replace) the vault from an encrypted `.vault` file. Locks afterwards.
#[tauri::command]
pub fn import_encrypted(state: State<VaultState>, path: String) -> Result<()> {
    ensure_unlocked(&state)?;
    {
        let mut conn = state.db.lock().unwrap();
        backup::restore_from(&mut conn, std::path::Path::new(&path))?;
    }
    state.lock();
    Ok(())
}

/// Export everything decrypted to a plaintext JSON file. Requires re-entering
/// the master password (spec §5) — the in-memory unlock is not enough.
#[tauri::command]
pub fn export_plaintext(
    state: State<VaultState>,
    path: String,
    master_password: String,
) -> Result<()> {
    // Re-authenticate against the stored verifier.
    let meta = {
        let conn = state.db.lock().unwrap();
        db::read_meta(&conn)?.ok_or(VaultError::NotSetup)?
    };
    let key = crypto::derive_key(&master_password, &meta.salt, meta.params)?;
    if !crypto::verify_key(&key, &meta.verifier) {
        return Err(VaultError::BadPassword);
    }

    let conn = state.db.lock().unwrap();
    let projects = db::list_projects(&conn)?;
    let mut projects_json = Vec::with_capacity(projects.len());
    for p in &projects {
        let metas = db::list_entry_meta(&conn, &p.id)?;
        let mut entries_json = Vec::with_capacity(metas.len());
        for m in &metas {
            let row = db::get_entry_row(&conn, &m.id)?;
            let field_rows = db::get_entry_fields(&conn, &m.id)?;
            let notes = match &row.notes {
                Some(b) => String::from_utf8_lossy(&crypto::decrypt(&key, b)?).into_owned(),
                None => String::new(),
            };
            let mut fields = Vec::with_capacity(field_rows.len());
            for f in &field_rows {
                let value = String::from_utf8_lossy(&crypto::decrypt(&key, &f.value)?).into_owned();
                fields.push(serde_json::json!({
                    "label": f.label, "value": value, "secret": f.secret
                }));
            }
            entries_json.push(serde_json::json!({
                "type": row.type_, "title": row.title, "tags": row.tags,
                "notes": notes, "fields": fields
            }));
        }
        projects_json.push(serde_json::json!({
            "name": p.name, "description": p.description, "color": p.color,
            "entries": entries_json
        }));
    }
    let doc = serde_json::json!({
        "format": "devvault-plaintext-v1",
        "exported_at_ms": now_string(),
        "warning": "Contains all secrets in clear text. Store securely or delete.",
        "projects": projects_json
    });
    std::fs::write(
        &path,
        serde_json::to_vec_pretty(&doc).map_err(|e| VaultError::Io(e.to_string()))?,
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::error::VaultError;
    use crate::vault::VaultState;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_db_path() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("devvault-test-{}-{}.db", std::process::id(), nanos))
    }

    fn cleanup(path: &PathBuf) {
        let _ = std::fs::remove_file(path);
        let _ = std::fs::remove_file(format!("{}-wal", path.display()));
        let _ = std::fs::remove_file(format!("{}-shm", path.display()));
    }

    const PW: &str = "correct horse battery staple";

    #[test]
    fn setup_persists_and_unlock_round_trips_across_reopen() {
        let path = temp_db_path();

        // First "session": set up, then exercise lock / wrong / right.
        {
            let state = VaultState::new(db::open(&path).unwrap());
            assert!(!state.is_unlocked());

            setup_master_impl(&state, PW).unwrap();
            assert!(state.is_unlocked(), "setup should leave vault unlocked");

            // Second setup must be rejected.
            assert!(matches!(
                setup_master_impl(&state, "other"),
                Err(VaultError::AlreadySetup)
            ));

            state.lock();
            assert!(!state.is_unlocked());

            assert!(matches!(
                unlock_impl(&state, "wrong password"),
                Err(VaultError::BadPassword)
            ));
            assert!(!state.is_unlocked(), "bad password must not unlock");

            unlock_impl(&state, PW).unwrap();
            assert!(state.is_unlocked(), "correct password must unlock");
        }

        // Second "session": fresh in-memory state over the same file. Proves the
        // master password survives a full app restart (acceptance: kill & reopen).
        {
            let state = VaultState::new(db::open(&path).unwrap());
            assert!(!state.is_unlocked());
            assert!(matches!(
                unlock_impl(&state, "still wrong"),
                Err(VaultError::BadPassword)
            ));
            unlock_impl(&state, PW).unwrap();
            assert!(state.is_unlocked());
        }

        cleanup(&path);
    }

    #[test]
    fn no_plaintext_password_or_verifier_marker_on_disk() {
        let path = temp_db_path();
        {
            let state = VaultState::new(db::open(&path).unwrap());
            setup_master_impl(&state, PW).unwrap();
            // Flush WAL into the main DB so we inspect the full on-disk image.
            state
                .db
                .lock()
                .unwrap()
                .pragma_update(None, "wal_checkpoint", "TRUNCATE")
                .unwrap();
        }

        let mut bytes = std::fs::read(&path).unwrap();
        if let Ok(wal) = std::fs::read(format!("{}-wal", path.display())) {
            bytes.extend_from_slice(&wal);
        }

        // Acceptance §10: nothing readable on disk. The master password must
        // never appear, and the verifier's known plaintext must stay encrypted.
        assert!(
            !contains(&bytes, PW.as_bytes()),
            "master password found in DB file"
        );
        assert!(
            !contains(&bytes, b"devvault-verify-v1"),
            "verifier plaintext found in DB file"
        );

        cleanup(&path);
    }

    fn contains(haystack: &[u8], needle: &[u8]) -> bool {
        haystack.windows(needle.len()).any(|w| w == needle)
    }

    #[test]
    fn entry_secret_round_trips_but_stays_encrypted_on_disk() {
        let path = temp_db_path();
        let key = crypto::derive_key(
            "pw",
            &[1u8; 16],
            crypto::KdfParams {
                mem_kib: 4096,
                iters: 1,
                parallelism: 1,
            },
        )
        .unwrap();
        let secret_value = "sk_live_SUPERSECRET_value_123";
        let notes_text = "rotate this key every 90 days";

        {
            let mut conn = db::open(&path).unwrap();
            db::create_project(&conn, "p1", "Acme", None, Some("#0ea5e9"), "t").unwrap();

            let fields = vec![
                FieldInput {
                    label: "API Key".into(),
                    value: secret_value.into(),
                    secret: true,
                },
                FieldInput {
                    label: "Endpoint".into(),
                    value: "https://api.acme.test".into(),
                    secret: false,
                },
            ];
            let (notes_blob, rows) = encrypt_payload(&key, notes_text, &fields).unwrap();
            let row = EntryRow {
                id: "e1".into(),
                project_id: "p1".into(),
                type_: "api_key".into(),
                title: "Stripe prod".into(),
                tags: vec!["billing".into(), "prod".into()],
                notes: notes_blob,
                created_at: "t".into(),
                updated_at: "t".into(),
            };
            db::insert_entry(&mut conn, &row, &rows).unwrap();
            conn.pragma_update(None, "wal_checkpoint", "TRUNCATE").unwrap();

            // Decrypt round-trip via the stored blobs.
            let frows = db::get_entry_fields(&conn, "e1").unwrap();
            assert_eq!(frows.len(), 2);
            let dec = crypto::decrypt(&key, &frows[0].value).unwrap();
            assert_eq!(String::from_utf8(dec).unwrap(), secret_value);

            // EntryMeta exposes plaintext title/tags, no secrets.
            let meta = db::list_entry_meta(&conn, "p1").unwrap();
            assert_eq!(meta.len(), 1);
            assert_eq!(meta[0].title, "Stripe prod");
            assert_eq!(meta[0].tags, vec!["billing".to_string(), "prod".to_string()]);

            // Project entry_count reflects the insert.
            let projs = db::list_projects(&conn).unwrap();
            assert_eq!(projs[0].entry_count, 1);
        }

        let mut bytes = std::fs::read(&path).unwrap();
        if let Ok(w) = std::fs::read(format!("{}-wal", path.display())) {
            bytes.extend_from_slice(&w);
        }
        // Secret value + notes must be encrypted on disk...
        assert!(
            !contains(&bytes, secret_value.as_bytes()),
            "secret field value leaked to disk"
        );
        assert!(
            !contains(&bytes, notes_text.as_bytes()),
            "notes plaintext leaked to disk"
        );
        // ...but title and tags stay plaintext so search works without decrypt.
        assert!(contains(&bytes, b"Stripe prod"), "title should be plaintext");
        assert!(contains(&bytes, b"billing"), "tag should be plaintext");

        cleanup(&path);
    }

    #[test]
    fn search_matches_plaintext_not_secret_values() {
        let path = temp_db_path();
        let key = crypto::derive_key(
            "pw",
            &[2u8; 16],
            crypto::KdfParams {
                mem_kib: 4096,
                iters: 1,
                parallelism: 1,
            },
        )
        .unwrap();
        {
            let mut conn = db::open(&path).unwrap();
            db::create_project(&conn, "p1", "Acme Corp", None, None, "t").unwrap();

            let fields = vec![FieldInput {
                label: "API Key".into(),
                value: "topsecretvalue".into(),
                secret: true,
            }];
            let (notes_blob, rows) = encrypt_payload(&key, "", &fields).unwrap();
            let row = EntryRow {
                id: "e1".into(),
                project_id: "p1".into(),
                type_: "api_key".into(),
                title: "Stripe prod".into(),
                tags: vec!["billing".into()],
                notes: notes_blob,
                created_at: "t".into(),
                updated_at: "t".into(),
            };
            db::insert_entry(&mut conn, &row, &rows).unwrap();

            // Title match.
            let hits = db::search(&conn, "stripe").unwrap();
            assert_eq!(hits.len(), 1);
            assert_eq!(hits[0].matched_on, "title");
            assert_eq!(hits[0].entry_id.as_deref(), Some("e1"));

            // Tag match.
            assert_eq!(db::search(&conn, "billing").unwrap()[0].matched_on, "tag");
            // Field-label match.
            assert_eq!(db::search(&conn, "api key").unwrap()[0].matched_on, "field");
            // Project-name match (no entry).
            let proj = db::search(&conn, "acme").unwrap();
            assert!(proj.iter().any(|h| h.matched_on == "project" && h.entry_id.is_none()));

            // Secret VALUE must never be found by search.
            assert!(db::search(&conn, "topsecret").unwrap().is_empty());
            // Empty query returns nothing.
            assert!(db::search(&conn, "  ").unwrap().is_empty());
        }
        cleanup(&path);
    }

    #[test]
    fn deleting_project_cascades_to_entries() {
        let path = temp_db_path();
        {
            let mut conn = db::open(&path).unwrap();
            db::create_project(&conn, "p1", "Acme", None, None, "t").unwrap();
            let row = EntryRow {
                id: "e1".into(),
                project_id: "p1".into(),
                type_: "note".into(),
                title: "n".into(),
                tags: vec![],
                notes: None,
                created_at: "t".into(),
                updated_at: "t".into(),
            };
            db::insert_entry(&mut conn, &row, &[]).unwrap();
            db::delete_project(&conn, "p1").unwrap();
            assert!(db::list_entry_meta(&conn, "p1").unwrap().is_empty());
        }
        cleanup(&path);
    }

    #[test]
    fn backup_and_restore_round_trips() {
        let live = temp_db_path();
        let bak = temp_db_path();
        {
            let mut conn = db::open(&live).unwrap();
            db::write_meta(
                &conn,
                &db::VaultMeta {
                    salt: vec![1, 2, 3],
                    params: crypto::KdfParams::default(),
                    verifier: vec![9],
                },
                "t",
            )
            .unwrap();
            db::create_project(&conn, "p1", "Acme", None, None, "t").unwrap();

            backup::backup_to(&conn, &bak).unwrap();

            // Mutate the live DB, then restore from the backup.
            db::delete_project(&conn, "p1").unwrap();
            assert!(db::list_projects(&conn).unwrap().is_empty());

            backup::restore_from(&mut conn, &bak).unwrap();
            let ps = db::list_projects(&conn).unwrap();
            assert_eq!(ps.len(), 1);
            assert_eq!(ps[0].name, "Acme");
        }
        cleanup(&live);
        let _ = std::fs::remove_file(&bak);
    }

    #[test]
    fn restore_rejects_vault_without_master_record() {
        let live = temp_db_path();
        let empty = temp_db_path();
        {
            let mut conn = db::open(&live).unwrap();
            // `empty` has the schema but no vault_meta row.
            let _ = db::open(&empty).unwrap();
            assert!(backup::restore_from(&mut conn, &empty).is_err());
        }
        cleanup(&live);
        cleanup(&empty);
    }
}

// --- Testable implementations (no Tauri State wrapper) ---------------------
// The `#[command]` handlers above are thin shims; the real logic lives here so
// it can be driven directly by integration tests.

pub(crate) fn setup_master_impl(state: &VaultState, password: &str) -> Result<()> {
    let conn = state.db.lock().unwrap();
    if db::is_setup(&conn)? {
        return Err(VaultError::AlreadySetup);
    }

    let params = KdfParams::default();
    let salt = crypto::generate_salt();
    let key = crypto::derive_key(password, &salt, params)?;
    let verifier = crypto::make_verifier(&key)?;

    let meta = VaultMeta {
        salt: salt.to_vec(),
        params,
        verifier,
    };
    db::write_meta(&conn, &meta, &now_string())?;
    drop(conn);

    state.unlock_with(key);
    Ok(())
}

pub(crate) fn unlock_impl(state: &VaultState, password: &str) -> Result<()> {
    let meta = {
        let conn = state.db.lock().unwrap();
        db::read_meta(&conn)?.ok_or(VaultError::NotSetup)?
    };

    let key = crypto::derive_key(password, &meta.salt, meta.params)?;
    if crypto::verify_key(&key, &meta.verifier) {
        state.unlock_with(key);
        Ok(())
    } else {
        state.throttle_then_record_failure();
        Err(VaultError::BadPassword)
    }
}
