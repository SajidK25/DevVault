# Project Spec: **DevVault (Electron Edition)** — Local Encrypted Credential & Notes Manager

> A single-machine desktop application for a freelance software engineer to securely store per-project login credentials, API keys, secrets, and instruction notes. Replaces scattered plain-text files. **100% JavaScript/TypeScript — no Rust.**

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
| 5. Many files open at once | One window, sidebar project switching |
| 6. No search | Full-text search across titles, fields, notes, tags |

---

## 2. Tech Stack

- **Framework:** Electron (latest stable).
- **Frontend:** React + TypeScript + Vite (via `electron-vite` for clean main/preload/renderer separation).
- **Styling:** Tailwind CSS.
- **Local storage:** SQLite via **`better-sqlite3`** (synchronous, fast, native module). Single encrypted blob per secret value; DB structure visible but all secret values encrypted before insert.
- **Crypto:** Node.js built-in **`crypto`** module (`scryptSync`/Argon2 via `argon2` npm pkg, `createCipheriv`/`createDecipheriv` with `aes-256-gcm`). No external crypto service.
- **OS keychain (optional unlock):** `keytar`.
- **Search:** in-memory fuzzy index (e.g. `fuse.js`) built after decrypt; personal-scale dataset.

> **Native module note:** `better-sqlite3` and `keytar` are native modules. Use `electron-rebuild` (or `@electron/rebuild`) after install so they match Electron's Node ABI. Document this in the README.

---

## 3. Process Architecture (critical for security)

Electron has three contexts — keep secrets out of the renderer:

- **Main process (Node):** owns ALL crypto, the master key (in memory only), the SQLite DB, backups, keychain, and the auto-lock timer.
- **Preload script:** exposes a typed, minimal API to the renderer via `contextBridge` — only the specific IPC channels listed in §8. `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- **Renderer (React):** pure UI. Never imports `crypto`, never holds the master password beyond passing it once over IPC to `unlock`, never sees the derived key. Decrypted values arrive only on demand (per field reveal/copy).

This mirrors the Tauri edition's "all crypto in the backend" rule — here the "backend" is the **main process**.

---

## 4. Security Model (recommended)

**Master password + OS keychain (hybrid), master password is the root of trust.**

- First launch: user sets a **master password**. Never stored anywhere.
- Derive key with **Argon2id** (`argon2` npm pkg; memory-hard, e.g. 64 MB, 3 iterations, parallelism 1 — tune for ~250ms). If avoiding native Argon2, `scrypt` from built-in `crypto` is an acceptable fallback (N=2^17, r=8, p=1). Store only **salt** + params in the DB, never the key.
- Encrypt every secret value with **AES-256-GCM**: unique random 12-byte IV per value; store `iv + ciphertext + authTag`.
- **Optional "Remember on this device":** store derived key in **OS keychain** via `keytar` for biometric/login unlock without retyping. Master password remains the recovery path.
- **Auto-lock:** clear in-memory key after N minutes idle (default 10) and on window blur/minimize (configurable). Require master password (or keychain) to reopen.
- **No telemetry, no network calls.** Fully offline. Set a strict Content-Security-Policy; disable remote content loading.
- **Clipboard:** auto-clear after 30s when a secret is copied.

**Threat model note for the README:** protects against disk theft, accidental file sharing, and casual access. Does **not** protect against malware running as the logged-in user while the vault is unlocked.

---

## 5. Data Model

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

**Encryption boundary:** `Field.value` and `Entry.notes` are always encrypted before persistence. Titles, tags, labels, project names stay plaintext so search works without a full decrypt — **except** if user enables "Encrypt everything" mode, in which case encrypt all columns and rebuild the search index in memory after unlock. Implement the per-value model first.

---

## 6. Core Features (MVP)

1. **First-run setup:** create master password, strength meter, confirm, generate salt.
2. **Unlock screen:** master password entry (+ keychain/biometric unlock if enabled). Rate-limit wrong attempts (small delay after 5 fails).
3. **Sidebar:** projects with color dots, entry counts, "+ New Project".
4. **Project view:** entries grouped/filterable by type, sortable by name/updated.
5. **Entry editor:** pick type, set title + tags; add arbitrary labeled fields; mark any field secret (masked, with show/copy); markdown notes with live preview.
6. **Global search (`Cmd/Ctrl+K`):** fuzzy search across project names, titles, tags, field labels; jump to entry.
7. **Copy-to-clipboard** per field, 30s auto-clear, toast.
8. **Auto-lock** on idle/blur.
9. **Backups:** automatic encrypted backup on every save and on app quit → `app.getPath('userData')/backups/` as timestamped files, keep last N (default 20). Manual **Export** (encrypted `.vault`), **Import**/restore. **Plaintext export** only after re-entering master password, with a warning.

---

## 7. Nice-to-have (Phase 2)

- Password/secret generator (length, charset).
- Per-entry "last used" timestamp.
- Quick-filter by tag chips.
- Dark/light theme.
- API key expiry reminders (local `Notification`).
- CLI companion reading the same encrypted DB (shared Node module).
- Drag-to-reorder projects.

---

## 8. File / Project Layout (electron-vite)

```
devvault/
  electron/
    main/
      index.ts          # app lifecycle, window, CSP, auto-lock timer
      crypto.ts         # argon2 derive, aes-256-gcm encrypt/decrypt, IV mgmt
      db.ts             # better-sqlite3 schema + CRUD, encrypted blobs
      vault.ts          # unlock/lock state, in-memory key
      backup.ts         # timestamped encrypted backups, rotation
      keychain.ts       # optional keytar integration
      ipc.ts            # ipcMain handlers (the §9 command surface)
    preload/
      index.ts          # contextBridge.exposeInMainWorld('vault', {...})
  src/                  # renderer (React)
    main.tsx
    App.tsx
    components/  (Sidebar, ProjectView, EntryEditor, SearchModal, UnlockScreen, FieldRow)
    hooks/       (useVault, useSearch, useAutoLock)
    lib/         (api.ts — typed wrappers around window.vault.*)
    types.ts
  electron.vite.config.ts
  package.json
  tsconfig.json
```

**Key rule for Claude Code:** all encryption/decryption happens in the **main process** (`crypto.ts`). The renderer never sees the master password beyond passing it once to `unlock`, never sees the derived key. Decrypted values are returned to the UI only on demand.

---

## 9. IPC Command Surface (preload contract)

Exposed on `window.vault` via `contextBridge`; each maps to an `ipcMain.handle`:

```ts
unlock(masterPassword: string): Promise<void>      // derives key, holds in memory
lock(): Promise<void>
isUnlocked(): Promise<boolean>
setupMaster(password: string): Promise<void>        // first run

listProjects(): Promise<Project[]>
createProject(name, description, color): Promise<Project>
updateProject(...): Promise<void>
deleteProject(id): Promise<void>

listEntries(projectId): Promise<EntryMeta[]>         // titles/tags only, no secrets
getEntry(id): Promise<Entry>                         // decrypts fields/notes
createEntry(...): Promise<Entry>
updateEntry(...): Promise<void>
deleteEntry(id): Promise<void>

search(query: string): Promise<SearchHit[]>          // plaintext index
copyField(entryId, fieldIndex): Promise<string>      // returns value; renderer handles 30s clear

backupNow(): Promise<void>
listBackups(): Promise<BackupInfo[]>
restoreBackup(path): Promise<void>
exportEncrypted(path): Promise<void>
importEncrypted(path): Promise<void>
exportPlaintext(path, masterPassword): Promise<void> // re-auth required
```

---

## 10. Build Order (suggested for Claude Code)

1. Scaffold electron-vite + React + Tailwind; empty window running.
2. `crypto.ts`: implement + unit-test Argon2/scrypt derive and AES-GCM round-trip (run with Vitest in Node).
3. `db.ts`: better-sqlite3 schema + migrations; wire up `electron-rebuild`.
4. Setup + Unlock flow end-to-end over IPC (no entries yet).
5. Projects CRUD + Sidebar.
6. Entries CRUD + Entry editor with secret fields.
7. Search (`Cmd+K`).
8. Auto-lock + clipboard auto-clear.
9. Backups + export/import.
10. Polish: themes, password generator, README with threat-model note + native-rebuild instructions.

---

## 11. Acceptance Criteria

- [ ] No secret value is readable in the SQLite file via a hex/text viewer.
- [ ] Wrong master password makes all secrets unrecoverable (by design — document this).
- [ ] Killing the app and reopening restores all data after unlock.
- [ ] Deleting an entry and restoring the latest backup recovers it.
- [ ] Search returns the right entry by project name, title, tag, or field label.
- [ ] App makes zero network requests (verify; CSP blocks remote content).
- [ ] `contextIsolation` on, `nodeIntegration` off, `sandbox` on — verify renderer cannot access Node APIs.
- [ ] Idle for the configured timeout re-locks the vault.
- [ ] Copied secret is gone from the clipboard after 30s.

---

### First prompt to give Claude Code

> "Read `devvault-spec-electron.md`. Scaffold the electron-vite + React + TypeScript + Tailwind project as described, with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Then implement build steps 1–4 (scaffold, crypto.ts with Vitest tests, db.ts schema with electron-rebuild wired up, and the setup/unlock flow over IPC). Stop after unlock works end-to-end so I can review before you continue."
