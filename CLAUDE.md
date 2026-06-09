# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

DevVault — local, offline, encrypted credential & notes manager. Tauri 2 (Rust) + React + TypeScript + Vite + Tailwind. The app lives in the **`devvault/` subdirectory**; sessions start one level up at the repo root.

## Commands

Rust is installed via rustup and is **not on the default PATH** — source it first in any shell that runs cargo/tauri:

```
. "$HOME/.cargo/env"
```

- Run the app (dev): `cd devvault && npm run tauri dev` — use the npm script, **not** `cargo tauri` (the cargo subcommand isn't installed).
- Backend tests: `cd devvault/src-tauri && cargo test`
- Frontend typecheck + bundle: `cd devvault && npm run build`
- Release build: `cd devvault && npm run tauri build -- --bundles deb` — use `--bundles deb`; AppImage bundling needs network and fails in this offline env.

Vault DB lives at `~/.devvault/devvault.db` (WAL mode); automatic backups in `~/.devvault/backups/`.

## Security invariants (do not break)

- **All encryption/decryption happens in Rust** (`src-tauri/src/crypto.rs`). The frontend passes the master password once to `unlock` and never sees the derived key.
- **Encryption boundary:** `fields.value` and `entries.notes` are AES-256-GCM encrypted before persistence. Titles, tags, field labels, and project names are stored plaintext (so search works without decrypting). Never put a secret value in those plaintext columns.
- Key derivation is Argon2id; only the salt, params, and an encrypted verifier are stored — never the key or password.

## Gotchas

- WebKitGTK on Linux crash-respawns with the default GPU renderer. `src-tauri/src/lib.rs` sets `WEBKIT_DISABLE_DMABUF_RENDERER` / `WEBKIT_DISABLE_COMPOSITING_MODE` at startup — keep that.
- Auto-lock (`src/hooks/useAutoLock.ts`): 10-min idle clears the in-memory key and returns to the unlock screen. Lock-on-blur is **off** by default (Linux WMs fire spurious blur events that bounce the user to login). Restore/import also lock the vault by design.
- Only one dev server at a time — it binds port 1420; a stale instance causes `Port 1420 is already in use`.

## Version control

Not under git yet. When initialized: use feature branches and conventional commit messages.
