// Typed wrappers around Tauri `invoke`. The frontend talks to the Rust
// backend only through these functions — it never touches crypto or the DB.
import { invoke } from "@tauri-apps/api/core";
import type {
  BackupInfo,
  EntryFull,
  EntryMeta,
  EntryType,
  Field,
  Project,
  SearchHit,
  VaultStatus,
} from "../types";

/** Whether a master password has ever been set (vault_meta row exists). */
export function isSetup(): Promise<boolean> {
  return invoke<boolean>("is_setup");
}

/** Whether the in-memory key is currently held (vault unlocked). */
export function isUnlocked(): Promise<boolean> {
  return invoke<boolean>("is_unlocked");
}

/** Combined status in one round-trip. */
export function vaultStatus(): Promise<VaultStatus> {
  return invoke<VaultStatus>("vault_status");
}

/** First-run only: create the master password, derive + store salt/verifier. */
export function setupMaster(password: string): Promise<void> {
  return invoke<void>("setup_master", { password });
}

/** Derive the key from the password and hold it in memory if correct. */
export function unlock(password: string): Promise<void> {
  return invoke<void>("unlock", { password });
}

/** Drop the in-memory key (zeroized backend-side). */
export function lock(): Promise<void> {
  return invoke<void>("lock");
}

// --- Projects --------------------------------------------------------------

export function listProjects(): Promise<Project[]> {
  return invoke<Project[]>("list_projects");
}

export function createProject(
  name: string,
  description: string | null,
  color: string | null
): Promise<Project> {
  return invoke<Project>("create_project", { name, description, color });
}

export function updateProject(
  id: string,
  name: string,
  description: string | null,
  color: string | null
): Promise<void> {
  return invoke<void>("update_project", { id, name, description, color });
}

export function deleteProject(id: string): Promise<void> {
  return invoke<void>("delete_project", { id });
}

// --- Entries ---------------------------------------------------------------

export function listEntries(projectId: string): Promise<EntryMeta[]> {
  return invoke<EntryMeta[]>("list_entries", { projectId });
}

export function getEntry(id: string): Promise<EntryFull> {
  return invoke<EntryFull>("get_entry", { id });
}

export function createEntry(
  projectId: string,
  type: EntryType,
  title: string,
  tags: string[],
  notes: string,
  fields: Field[]
): Promise<EntryMeta> {
  return invoke<EntryMeta>("create_entry", {
    projectId,
    type,
    title,
    tags,
    notes,
    fields,
  });
}

export function updateEntry(
  id: string,
  type: EntryType,
  title: string,
  tags: string[],
  notes: string,
  fields: Field[]
): Promise<EntryMeta> {
  return invoke<EntryMeta>("update_entry", {
    id,
    type,
    title,
    tags,
    notes,
    fields,
  });
}

export function deleteEntry(id: string): Promise<void> {
  return invoke<void>("delete_entry", { id });
}

// --- Search ----------------------------------------------------------------

export function search(query: string): Promise<SearchHit[]> {
  return invoke<SearchHit[]>("search", { query });
}

// --- Backups & export/import -----------------------------------------------

export function backupNow(): Promise<string> {
  return invoke<string>("backup_now");
}

export function listBackups(): Promise<BackupInfo[]> {
  return invoke<BackupInfo[]>("list_backups");
}

/** Restores the vault from a backup; the backend locks afterwards. */
export function restoreBackup(path: string): Promise<void> {
  return invoke<void>("restore_backup", { path });
}

export function exportEncrypted(path: string): Promise<void> {
  return invoke<void>("export_encrypted", { path });
}

/** Imports/replaces the vault; the backend locks afterwards. */
export function importEncrypted(path: string): Promise<void> {
  return invoke<void>("import_encrypted", { path });
}

export function exportPlaintext(
  path: string,
  masterPassword: string
): Promise<void> {
  return invoke<void>("export_plaintext", { path, masterPassword });
}
