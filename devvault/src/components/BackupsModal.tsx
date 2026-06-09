import { useEffect, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { BackupInfo } from "../types";
import {
  backupNow,
  exportEncrypted,
  exportPlaintext,
  importEncrypted,
  listBackups,
  restoreBackup,
} from "../lib/ipc";

interface Props {
  onClose: () => void;
  /** Called after restore/import — backend has locked the vault. */
  onLocked: () => void;
}

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleString();
}
function fmtSize(b: number): string {
  return b < 1024 ? `${b} B` : `${(b / 1024).toFixed(1)} KB`;
}

export default function BackupsModal({ onClose, onLocked }: Props) {
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plainPw, setPlainPw] = useState("");
  const [showPlain, setShowPlain] = useState(false);

  function refresh() {
    listBackups()
      .then(setBackups)
      .catch((e) => setError(String(e)));
  }
  useEffect(refresh, []);

  function wrap<T>(p: Promise<T>, ok: string) {
    setError(null);
    setStatus(null);
    return p
      .then((r) => {
        setStatus(ok);
        return r;
      })
      .catch((e) => {
        setError(String(e));
        throw e;
      });
  }

  async function doBackup() {
    await wrap(backupNow(), "Backup created.").catch(() => {});
    refresh();
  }

  async function doRestore(path: string) {
    if (!confirm("Restore this backup? Current vault will be replaced and locked."))
      return;
    await wrap(restoreBackup(path), "Restored.").then(onLocked).catch(() => {});
  }

  async function doExportEncrypted() {
    const path = await save({
      defaultPath: "devvault-export.vault",
      filters: [{ name: "DevVault", extensions: ["vault"] }],
    });
    if (!path) return;
    await wrap(exportEncrypted(path), "Encrypted vault exported.").catch(() => {});
  }

  async function doImport() {
    const picked = await open({
      multiple: false,
      filters: [{ name: "DevVault", extensions: ["vault"] }],
    });
    const path = Array.isArray(picked) ? picked[0] : picked;
    if (!path) return;
    if (!confirm("Import this vault? Current vault will be replaced and locked."))
      return;
    await wrap(importEncrypted(path), "Imported.").then(onLocked).catch(() => {});
  }

  async function doExportPlaintext() {
    if (!plainPw) {
      setError("Enter your master password to confirm plaintext export.");
      return;
    }
    const path = await save({
      defaultPath: "devvault-PLAINTEXT.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!path) return;
    await wrap(
      exportPlaintext(path, plainPw),
      "Plaintext exported — handle that file carefully."
    )
      .then(() => {
        setPlainPw("");
        setShowPlain(false);
      })
      .catch(() => {});
  }

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-5 py-3">
          <h2 className="font-semibold">Backups &amp; export</h2>
          <button onClick={onClose} className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200">
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={doBackup}
              className="rounded-md bg-sky-600 px-3 py-1.5 text-sm hover:bg-sky-500"
            >
              Backup now
            </button>
            <button
              onClick={doExportEncrypted}
              className="rounded-md border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-sm hover:bg-slate-200 dark:hover:bg-slate-700"
            >
              Export encrypted…
            </button>
            <button
              onClick={doImport}
              className="rounded-md border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-sm hover:bg-slate-200 dark:hover:bg-slate-700"
            >
              Import…
            </button>
            <button
              onClick={() => setShowPlain((v) => !v)}
              className="rounded-md border border-amber-700/60 px-3 py-1.5 text-sm text-amber-300 hover:bg-amber-950/30"
            >
              Export plaintext…
            </button>
          </div>

          {showPlain && (
            <div className="rounded-md border border-amber-700/60 bg-amber-950/20 p-3">
              <p className="text-xs text-amber-300">
                ⚠ This writes <strong>all secrets in clear text</strong> to a JSON
                file. Re-enter your master password to confirm.
              </p>
              <div className="mt-2 flex gap-2">
                <input
                  type="password"
                  value={plainPw}
                  onChange={(e) => setPlainPw(e.target.value)}
                  placeholder="Master password"
                  className="flex-1 rounded-md border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-900 px-2 py-1.5 text-sm outline-none focus:border-amber-500"
                />
                <button
                  onClick={doExportPlaintext}
                  className="rounded-md bg-amber-600 px-3 py-1.5 text-sm hover:bg-amber-500"
                >
                  Export
                </button>
              </div>
            </div>
          )}

          {status && (
            <p className="rounded bg-green-950/40 px-3 py-2 text-sm text-green-300">
              {status}
            </p>
          )}
          {error && (
            <p className="rounded bg-red-950/60 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}

          <div>
            <h3 className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-300">
              Automatic backups ({backups.length})
            </h3>
            {backups.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-500">No backups yet.</p>
            ) : (
              <ul className="space-y-1">
                {backups.map((b) => (
                  <li
                    key={b.path}
                    className="flex items-center gap-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white/40 dark:bg-slate-800/40 px-3 py-2 text-sm"
                  >
                    <span className="flex-1">
                      {fmtDate(b.created_ms)}
                      <span className="ml-2 text-xs text-slate-500 dark:text-slate-500">
                        {fmtSize(b.size_bytes)}
                      </span>
                    </span>
                    <button
                      onClick={() => doRestore(b.path)}
                      className="rounded-md border border-slate-300 dark:border-slate-600 px-2 py-1 text-xs hover:bg-slate-200 dark:hover:bg-slate-700"
                    >
                      Restore
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
