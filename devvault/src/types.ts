// Shared types mirroring the Rust IPC contract (spec §8).

export type EntryType = "credential" | "api_key" | "secret" | "note";

export const ENTRY_TYPES: { value: EntryType; label: string }[] = [
  { value: "credential", label: "Credential" },
  { value: "api_key", label: "API Key" },
  { value: "secret", label: "Secret" },
  { value: "note", label: "Note" },
];

export interface Project {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  created_at: string;
  updated_at: string;
  entry_count: number;
}

/** List row — no secret values (spec §8 EntryMeta). */
export interface EntryMeta {
  id: string;
  project_id: string;
  type: EntryType;
  title: string;
  tags: string[];
  updated_at: string;
}

export interface Field {
  label: string;
  value: string;
  secret: boolean;
}

/** Fully decrypted entry for the editor. */
export interface EntryFull {
  id: string;
  project_id: string;
  type: EntryType;
  title: string;
  tags: string[];
  notes: string;
  fields: Field[];
  created_at: string;
  updated_at: string;
}

export interface VaultStatus {
  is_setup: boolean;
  is_unlocked: boolean;
}

export interface BackupInfo {
  path: string;
  filename: string;
  created_ms: number;
  size_bytes: number;
}

export interface SearchHit {
  project_id: string;
  project_name: string;
  entry_id: string | null;
  entry_title: string | null;
  type: EntryType | null;
  matched_on: "title" | "tag" | "field" | "project";
  snippet: string;
}
