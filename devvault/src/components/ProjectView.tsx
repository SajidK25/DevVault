import { useCallback, useEffect, useState } from "react";
import type { EntryMeta, EntryType, Project } from "../types";
import { ENTRY_TYPES } from "../types";
import { deleteEntry, deleteProject, listEntries } from "../lib/ipc";
import EntryEditor from "./EntryEditor";

interface Props {
  project: Project;
  openEntryId?: string | null;
  onOpenConsumed?: () => void;
  onProjectsChanged: () => void;
  onProjectDeleted: () => void;
}

export default function ProjectView({
  project,
  openEntryId,
  onOpenConsumed,
  onProjectsChanged,
  onProjectDeleted,
}: Props) {
  const [entries, setEntries] = useState<EntryMeta[]>([]);
  const [filter, setFilter] = useState<EntryType | "all">("all");
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    listEntries(project.id)
      .then(setEntries)
      .catch((e) => setError(String(e)));
  }, [project.id]);

  useEffect(() => {
    setFilter("all");
    refresh();
  }, [refresh]);

  // Open the editor for an entry the user jumped to from search.
  useEffect(() => {
    if (openEntryId) {
      setEditing({ id: openEntryId });
      onOpenConsumed?.();
    }
  }, [openEntryId, onOpenConsumed]);

  const shown =
    filter === "all" ? entries : entries.filter((e) => e.type === filter);

  async function removeEntry(id: string) {
    if (!confirm("Delete this entry?")) return;
    await deleteEntry(id);
    refresh();
    onProjectsChanged(); // entry count changed
  }

  async function removeProject() {
    if (!confirm(`Delete project "${project.name}" and all its entries?`)) return;
    await deleteProject(project.id);
    onProjectDeleted();
  }

  return (
    <section className="flex h-full flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-6 py-3">
        <div className="flex items-center gap-2">
          <span
            className="h-3 w-3 rounded-full"
            style={{ backgroundColor: project.color ?? "#64748b" }}
          />
          <h1 className="text-lg font-semibold">{project.name}</h1>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setEditing({ id: null })}
            className="rounded-md bg-sky-600 px-3 py-1.5 text-sm hover:bg-sky-500"
          >
            + New entry
          </button>
          <button
            onClick={removeProject}
            className="rounded-md border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-sm text-red-400 hover:bg-red-950/40"
          >
            Delete project
          </button>
        </div>
      </header>

      <div className="flex gap-1.5 px-6 py-3">
        {(["all", ...ENTRY_TYPES.map((t) => t.value)] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-xs capitalize ${
              filter === f
                ? "bg-sky-600"
                : "border border-slate-300 dark:border-slate-600 hover:bg-slate-200 dark:hover:bg-slate-700"
            }`}
          >
            {f === "all" ? "All" : f.replace("_", " ")}
          </button>
        ))}
      </div>

      {error && <p className="px-6 text-sm text-red-400">{error}</p>}

      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {shown.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-500">
            No entries{filter !== "all" ? " of this type" : ""} yet.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {shown.map((e) => (
              <li
                key={e.id}
                className="group flex items-center gap-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white/40 dark:bg-slate-800/40 px-4 py-3"
              >
                <button
                  onClick={() => setEditing({ id: e.id })}
                  className="flex-1 text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{e.title}</span>
                    <span className="rounded bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 text-[10px] uppercase text-slate-700 dark:text-slate-300">
                      {e.type.replace("_", " ")}
                    </span>
                  </div>
                  {e.tags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {e.tags.map((t) => (
                        <span
                          key={t}
                          className="rounded bg-slate-200/60 dark:bg-slate-700/60 px-1.5 py-0.5 text-[10px] text-slate-600 dark:text-slate-400"
                        >
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
                <button
                  onClick={() => removeEntry(e.id)}
                  className="text-xs text-red-400 opacity-0 group-hover:opacity-100"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing && (
        <EntryEditor
          projectId={project.id}
          entryId={editing.id}
          onClose={() => setEditing(null)}
          onSaved={() => {
            refresh();
            onProjectsChanged();
          }}
        />
      )}
    </section>
  );
}
