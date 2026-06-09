import { useState } from "react";
import type { Project } from "../types";
import type { Theme } from "../hooks/useTheme";
import { createProject } from "../lib/ipc";

const COLORS = ["#0ea5e9", "#22c55e", "#eab308", "#ef4444", "#a855f7", "#f97316"];

interface Props {
  projects: Project[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onChanged: () => void;
  onLock: () => void;
  onOpenBackups: () => void;
  theme: Theme;
  onToggleTheme: () => void;
}

export default function Sidebar({
  projects,
  selectedId,
  onSelect,
  onChanged,
  onLock,
  onOpenBackups,
  theme,
  onToggleTheme,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const p = await createProject(name.trim(), null, color);
      setName("");
      setAdding(false);
      setError(null);
      onChanged();
      onSelect(p.id);
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <aside className="flex h-full w-64 flex-col border-r border-slate-200 dark:border-slate-700 bg-white/40 dark:bg-slate-800/40">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="font-semibold">Projects</span>
        <button
          onClick={() => setAdding((v) => !v)}
          className="rounded-md border border-slate-300 dark:border-slate-600 px-2 py-1 text-xs hover:bg-slate-200 dark:hover:bg-slate-700"
        >
          + New
        </button>
      </div>

      {adding && (
        <form onSubmit={submit} className="px-4 pb-3">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Project name"
            className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-900 px-2 py-1 text-sm outline-none focus:border-sky-500"
          />
          <div className="mt-2 flex gap-1.5">
            {COLORS.map((c) => (
              <button
                type="button"
                key={c}
                onClick={() => setColor(c)}
                style={{ backgroundColor: c }}
                className={`h-5 w-5 rounded-full ${
                  color === c ? "ring-2 ring-white" : ""
                }`}
              />
            ))}
          </div>
          {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
          <button
            type="submit"
            className="mt-2 w-full rounded-md bg-sky-600 py-1 text-sm hover:bg-sky-500"
          >
            Create
          </button>
        </form>
      )}

      <nav className="flex-1 overflow-y-auto px-2">
        {projects.length === 0 && (
          <p className="px-2 py-4 text-sm text-slate-500 dark:text-slate-500">No projects yet.</p>
        )}
        {projects.map((p) => (
          <button
            key={p.id}
            onClick={() => onSelect(p.id)}
            className={`mb-0.5 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm ${
              selectedId === p.id ? "bg-slate-200 dark:bg-slate-700" : "hover:bg-slate-200/50 dark:hover:bg-slate-700/50"
            }`}
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: p.color ?? "#64748b" }}
            />
            <span className="flex-1 truncate">{p.name}</span>
            <span className="text-xs text-slate-500 dark:text-slate-500">{p.entry_count}</span>
          </button>
        ))}
      </nav>

      <div className="m-3 flex gap-2">
        <button
          onClick={onOpenBackups}
          className="flex-1 rounded-md border border-slate-300 dark:border-slate-600 py-2 text-sm hover:bg-slate-200 dark:hover:bg-slate-700"
        >
          Backups
        </button>
        <button
          onClick={onToggleTheme}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          className="rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm hover:bg-slate-200 dark:hover:bg-slate-700"
        >
          {theme === "dark" ? "☀" : "☾"}
        </button>
        <button
          onClick={onLock}
          className="flex-1 rounded-md border border-slate-300 dark:border-slate-600 py-2 text-sm hover:bg-slate-200 dark:hover:bg-slate-700"
        >
          Lock
        </button>
      </div>
    </aside>
  );
}
