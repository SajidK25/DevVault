# Project Spec: **DevVault (Tauri Edition)** — Local Encrypted Credential & Notes Manager

> A single-machine desktop application for a freelance software engineer to securely store per-project login credentials, API keys, secrets, and instruction notes. Replaces scattered plain-text files.

---

## 1. Goal

Build a local, offline, encrypted desktop app that organizes credentials and notes **by project**, with strong search, zero plaintext-on-disk, and local automatic backups.

Each problem from the user maps to a feature:

| Problem | Solution |
|---|---|
| 1. Hard to find files | Single app, projects in a sidebar, instant search |
| 2. No security | AES-256-GCM encryption at rest; nothing readable on disk |
| 3. Long files hard to scan | Structured entries (fields + tags), not freeform blobs |
| 4. No backup / no recovery | Automatic timestamped encrypted backups + manual export |
| 5. Many files open at once | One window, tabbed/sidebar project switching |
| 6. No search | Full-text search across titles, fields, notes, tags |

---

## 2. Tech Stack (recommended)

- **Framework:** Tauri 2.x (Rust backend + web frontend). Chosen over Electron for a much smaller binary, lower memory, and a Rust crypto layer kept out of the JS context.
- **Frontend:** React + TypeScript + Vite.
- **Styling:** Tailwind CSS.
- **Local storage:** SQLite (via `rusqlite` or `sqlx`) storing a **single encrypted blob column** — DB structure is visible but all secret values are encrypted before insert. (Alternative: SQLCipher for full-DB encryption — see §4.)
- **Crypto (Rust side):** `ring` or `aes-gcm` + `argon2` crates.
- **Search:** in-memory index built after decrypt (e.g. small fuzzy matcher), since the dataset is personal-scale.

> If the build environment can't compile Rust/Tauri easily, fall back to **Electron + React + better-sqlite3 + Node `crypto`**. Keep the same architecture.

---

## 3. Security Model (recommended)

**Master password + OS keychain (hybrid), with master password as the root of trust.**

- On first launch, user sets a **master password**. Never stored anywhere.
- Derive an encryption key from it with **Argon2id** (memory-hard; params e.g. 64 MB, 3 iterations, parallelism 1 — tune for ~250ms). Store only the **salt** and Argon2 params in the DB, never the key.
- Encrypt every secret value with **AES-256-GCM** (unique random 96-bit nonce per value; store nonce + ciphertext + tag).
- **Optional "Remember on this device":** store the derived key in the **OS keychain** (Tauri: keyring crate / Electron: `keytar`) so the app can unlock via OS biometrics/login without retyping. Master password remains the recovery path.
- **Auto-lock:** clear the in-memory key after N minutes idle (default 10) and on window blur/minimize (configurable). Require master password (or keychain unlock) to re-open.
- **No telemetry, no network calls.** App must function fully offline.
- Clipboard: when copying a secret, **auto-clear clipboard after 30s**.

**Threat model note for the README:** protects against disk theft, accidental file sharing, and casual access. Does **not** protect against malware running as the logged-in user while the vault is unlocked.

---

## 4. Data Model

```
Project
  id            (uuid)
  name          (string, unique)
  description   (string, optional)
  color         (string, for sidebar tag)
  created_at, updated_at

Entry  (belongs to a Project)
  id            (uuid)
  project_id    (fk)
  type          (enum: credential | api_key | secret | note)
  title         (string)               -- searchable, plaintext
  tags          (string[])             -- searchable, plaintext
  fields        (Field[])              -- values encrypted
  notes         (encrypted markdown)
  created_at, updated_at

Field
  label         (string, e.g. "Username", "API Key", "Endpoint")  -- plaintext
  value         (encrypted string)
  secret        (bool — if true, masked in UI by default)
```

**Encryption boundary:** `Field.value` and `Entry.notes` are always encrypted before persistence. Titles, tags, labels, project names stay plaintext so search works without a full decrypt — **except** if user enables "Encrypt everything" mode, in which case switch the storage layer to **SQLCipher** (whole-DB encryption) and rebuild the search index in memory after unlock.

Implement the simpler per-value model first; offer SQLCipher as a config flag.

---

## 5. Core Features (MVP)

1. **First-run setup:** create master password, show password-strength meter, confirm, generate salt.
2. **Unlock screen:** master password entry (+ keychain/biometric unlock if enabled). Wrong-password rate limiting (small delay after 5 fails).
3. **Sidebar:** list of projects with color dots, entry counts, "+ New Project".
4. **Project view:** entries grouped/filterable by type, sortable by name/updated.
5. **Entry editor:**
   - Pick type, set title + tags.
   - Add arbitrary labeled fields; mark any field as secret (masked, with show/copy buttons).
   - Markdown notes field with live preview.
6. **Global search bar (`Cmd/Ctrl+K`):** fuzzy search across project names, titles, tags, field labels. Results jump to the entry.
7. **Copy-to-clipboard** per field, with 30s auto-clear and a toast.
8. **Auto-lock** on idle/blur.
9. **Backups:**
   - Automatic encrypted backup on every save and on app close, into `~/.devvault/backups/` as timestamped files; keep last N (default 20).
   - Manual **Export** (encrypted `.vault` file) and **Import**/restore.
   - **Plaintext export** allowed only after re-entering master password, with a clear warning.

---

## 6. Nice-to-have (Phase 2)

- Password/secret generator (length, charset).
- Per-entry "last used" timestamp.
- Quick-filter by tag chips.
- Dark/light theme.
- API key expiry reminders (local notification).
- CLI companion (`devvault get <project> <entry>`) reading the same encrypted DB.
- Drag-to-reorder projects.

---

## 7. File / Project Layout (Tauri)

```
devvault/
  src-tauri/
    src/
      main.rs
      crypto.rs        # argon2 derive, aes-gcm encrypt/decrypt, nonce mgmt
      db.rs            # sqlite schema + CRUD, encrypted blobs
      vault.rs         # unlock/lock state, in-memory key, auto-lock timer
      backup.rs        # timestamped encrypted backups, rotation
      keychain.rs      # optional OS keychain integration
      commands.rs      # #[tauri::command] handlers exposed to frontend
    Cargo.toml
    tauri.conf.json
  src/
    main.tsx
    App.tsx
    components/  (Sidebar, ProjectView, EntryEditor, SearchModal, UnlockScreen, FieldRow)
    hooks/       (useVault, useSearch, useAutoLock)
    lib/         (ipc.ts — typed wrappers around tauri invoke)
    types.ts
  package.json
```

**Key rule for Claude Code:** all encryption/decryption happens in **Rust** (`crypto.rs`). The frontend never sees the master password beyond passing it once to the `unlock` command; it never sees the derived key. Decrypted values are returned to the UI only on demand (per field reveal/copy).

---

## 8. Rust Command Surface (IPC contract)

```rust
unlock(master_password: String) -> Result<(), Error>      // derives key, holds in memory
lock()
is_unlocked() -> bool
setup_master(password: String)                            // first run

list_projects() -> Vec<Project>
create_project(name, description, color) -> Project
update_project(...) / delete_project(id)

list_entries(project_id) -> Vec<EntryMeta>                // titles/tags only, no secrets
get_entry(id) -> Entry                                    // decrypts fields/notes
create_entry(...) / update_entry(...) / delete_entry(id)

search(query: String) -> Vec<SearchHit>                   // plaintext index
copy_field(entry_id, field_index)                         // returns value; FE handles 30s clear

backup_now() / list_backups() / restore_backup(path)
export_encrypted(path) / import_encrypted(path)
export_plaintext(path, master_password)                   // re-auth required
```

---

## 9. Build Order (suggested for Claude Code)

1. Scaffold Tauri + React + Tailwind; get an empty window running.
2. `crypto.rs`: implement + unit-test Argon2 derive and AES-GCM round-trip.
3. `db.rs`: SQLite schema + migrations.
4. Setup + Unlock flow end-to-end (no entries yet).
5. Projects CRUD + Sidebar.
6. Entries CRUD + Entry editor with secret fields.
7. Search (`Cmd+K`).
8. Auto-lock + clipboard auto-clear.
9. Backups + export/import.
10. Polish: themes, password generator, README with the threat-model note.

---

## 10. Acceptance Criteria

- [ ] No secret value is readable in the SQLite file via a hex/text viewer.
- [ ] Forgetting to enter the right master password makes all secrets unrecoverable (by design — document this).
- [ ] Killing the app and reopening restores all data after unlock.
- [ ] Deleting an entry and restoring the latest backup recovers it.
- [ ] Search returns the right entry by project name, title, tag, or field label.
- [ ] App makes zero network requests (verify in build).
- [ ] Idle for the configured timeout re-locks the vault.
- [ ] Copied secret is gone from the clipboard after 30s.

---

### First prompt to give Claude Code

> "Read `vault-app-spec.md`. Scaffold the Tauri 2 + React + TypeScript + Tailwind project as described, then implement build steps 1–4 (scaffold, crypto.rs with tests, db.rs schema, and the setup/unlock flow). Stop after unlock works end-to-end so I can review before you continue."
