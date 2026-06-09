# DevVault

A local, offline, encrypted desktop app that organizes per-project login
credentials, API keys, secrets, and instruction notes — with strong search,
zero plaintext-on-disk for secret values, and automatic local backups.

Built with **Tauri 2** (Rust backend) + **React + TypeScript + Vite** +
**Tailwind CSS**. All cryptography runs in Rust; the web frontend never sees the
master password beyond passing it once to `unlock`, and never sees the derived
key.

## Features

- **Master-password vault.** Set once on first run; never stored anywhere.
- **Projects & entries.** Organize credentials/API keys/secrets/notes by
  project. Each entry has a type, title, tags, arbitrary labeled fields (any
  field markable secret), and markdown notes with live preview.
- **Encryption at rest.** Every secret field value and entry note is encrypted
  with AES-256-GCM before it touches disk.
- **Search (⌘/Ctrl+K).** Fuzzy/substring search across project names, entry
  titles, tags, and field labels — never over secret values.
- **Auto-lock.** Clears the in-memory key after 10 minutes idle and on window
  blur/minimize.
- **Clipboard hygiene.** Copying a secret auto-clears the clipboard after 30s.
- **Backups.** Automatic timestamped backups on every save and on app close
  (keeps the last 20). Manual encrypted export/import (`.vault`) and re-auth-
  gated plaintext export (JSON).
- **Themes.** Dark (default) / light toggle.
- **Password generator.** Per-field secure generator (length + charset).
- **No telemetry, no network.** Functions fully offline.

## Security model

- The master password is the **root of trust** and is never persisted.
- An encryption key is derived from it with **Argon2id** (memory-hard;
  ~64 MB, 3 iterations). Only the random **salt** and Argon2 parameters are
  stored — never the key, never the password.
- Each secret value is encrypted with **AES-256-GCM** using a unique random
  96-bit nonce; the stored blob is `nonce ‖ ciphertext ‖ tag`.
- Correct-password detection uses an encrypted **verifier** token: unlock
  succeeds only if the derived key authenticates it (GCM tag check).
- Repeated wrong-password attempts are throttled after 5 failures.

### Encryption boundary

Secret **values** (`fields.value`) and **notes** are always encrypted. Titles,
tags, field labels, and project names are stored in **plaintext** so search
works without decrypting the whole vault. A `.vault` export/backup is therefore
only as private as the live database: secret values stay encrypted, but the
structure (titles/tags/labels/project names) is readable. Full-database
encryption (SQLCipher "encrypt everything" mode) is a planned option, not yet
implemented.

### Threat model

DevVault protects against **disk theft, accidental file sharing, and casual
access** to the machine — secret values are unreadable without the master
password. It does **not** protect against malware running as the logged-in user
while the vault is unlocked, nor against an attacker who knows your master
password. If you forget the master password, your data is unrecoverable **by
design**.

## Data locations

- Vault database: `~/.devvault/devvault.db`
- Automatic backups: `~/.devvault/backups/devvault-<unixmillis>.vault`

## Build & run

Prerequisites: a recent Rust toolchain, Node 18+, and the Tauri Linux system
dependencies (`webkit2gtk-4.1`, `gtk-3`, `libsoup-3`, etc.).

```bash
npm install          # install frontend deps (includes the local Tauri CLI)
npm run tauri dev    # run the app in development
npm run tauri build  # produce a release bundle
```

Backend tests:

```bash
cd src-tauri && cargo test
```

## Acceptance criteria

- [x] No secret value is readable in the SQLite file via a hex/text viewer.
- [x] Forgetting the master password makes all secrets unrecoverable (by design).
- [x] Killing the app and reopening restores all data after unlock.
- [x] Deleting an entry and restoring a backup recovers it.
- [x] Search returns entries by project name, title, tag, or field label.
- [x] Zero network requests (CSP `default-src 'self'`; no network code).
- [x] Idle / window-blur re-locks the vault.
- [x] Copied secret is cleared from the clipboard after 30s.

## Project layout

```
src-tauri/src/
  crypto.rs    # Argon2id derive, AES-GCM encrypt/decrypt, nonce mgmt
  db.rs        # SQLite schema + CRUD + search (encrypted blobs)
  vault.rs     # unlock/lock state, in-memory key, fail throttle
  backup.rs    # timestamped backups, rotation, export/import
  commands.rs  # #[tauri::command] handlers exposed to the frontend
  error.rs, lib.rs, main.rs
src/
  components/  # Sidebar, ProjectView, EntryEditor, FieldRow,
               # SearchModal, BackupsModal, UnlockScreen, SetupScreen, VaultHome
  hooks/       # useAutoLock, useTheme
  lib/         # ipc, crypto-adjacent helpers (clipboard, generate, markdown, strength)
  types.ts
```
