import { useEffect, useState } from "react";
import type { EntryType, Field } from "../types";
import { ENTRY_TYPES } from "../types";
import { createEntry, getEntry, updateEntry } from "../lib/ipc";
import { renderMarkdown } from "../lib/markdown";
import FieldRow from "./FieldRow";

interface Props {
  projectId: string;
  entryId: string | null; // null = create new
  onClose: () => void;
  onSaved: () => void;
}

export default function EntryEditor({
  projectId,
  entryId,
  onClose,
  onSaved,
}: Props) {
  const [type, setType] = useState<EntryType>("credential");
  const [title, setTitle] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [notes, setNotes] = useState("");
  const [fields, setFields] = useState<Field[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(entryId !== null);

  useEffect(() => {
    if (entryId === null) return;
    getEntry(entryId)
      .then((e) => {
        setType(e.type);
        setTitle(e.title);
        setTagsInput(e.tags.join(", "));
        setNotes(e.notes);
        setFields(e.fields);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [entryId]);

  function parseTags(): string[] {
    return tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const tags = parseTags();
      if (entryId === null) {
        await createEntry(projectId, type, title.trim(), tags, notes, fields);
      } else {
        await updateEntry(entryId, type, title.trim(), tags, notes, fields);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/50 p-6">
      <form
        onSubmit={save}
        className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-5 py-3">
          <h2 className="font-semibold">
            {entryId === null ? "New entry" : "Edit entry"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <div className="p-8 text-center text-slate-600 dark:text-slate-400">Decrypting…</div>
        ) : (
          <div className="flex-1 space-y-4 overflow-y-auto p-5">
            <div className="flex gap-3">
              <select
                value={type}
                onChange={(e) => setType(e.target.value as EntryType)}
                className="rounded-md border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-900 px-2 py-2 text-sm outline-none focus:border-sky-500"
              >
                {ENTRY_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title"
                className="flex-1 rounded-md border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-900 px-3 py-2 text-sm outline-none focus:border-sky-500"
              />
            </div>

            <input
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="Tags (comma separated)"
              className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-900 px-3 py-2 text-sm outline-none focus:border-sky-500"
            />

            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Fields</span>
                <button
                  type="button"
                  onClick={() =>
                    setFields((f) => [
                      ...f,
                      { label: "", value: "", secret: true },
                    ])
                  }
                  className="rounded-md border border-slate-300 dark:border-slate-600 px-2 py-1 text-xs hover:bg-slate-200 dark:hover:bg-slate-700"
                >
                  + Field
                </button>
              </div>
              <div className="space-y-2">
                {fields.map((f, i) => (
                  <FieldRow
                    key={i}
                    field={f}
                    onChange={(nf) =>
                      setFields((arr) => arr.map((x, j) => (j === i ? nf : x)))
                    }
                    onRemove={() =>
                      setFields((arr) => arr.filter((_, j) => j !== i))
                    }
                  />
                ))}
                {fields.length === 0 && (
                  <p className="text-xs text-slate-500 dark:text-slate-500">No fields yet.</p>
                )}
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Notes</span>
                <button
                  type="button"
                  onClick={() => setShowPreview((v) => !v)}
                  className="rounded-md border border-slate-300 dark:border-slate-600 px-2 py-1 text-xs hover:bg-slate-200 dark:hover:bg-slate-700"
                >
                  {showPreview ? "Edit" : "Preview"}
                </button>
              </div>
              {showPreview ? (
                <div
                  className="min-h-[8rem] rounded-md border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-900 p-3 text-sm"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(notes) }}
                />
              ) : (
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Markdown notes…"
                  rows={6}
                  className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-900 px-3 py-2 font-mono text-sm outline-none focus:border-sky-500"
                />
              )}
            </div>

            {error && (
              <p className="rounded bg-red-950/60 px-3 py-2 text-sm text-red-300">
                {error}
              </p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-slate-200 dark:border-slate-700 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 dark:border-slate-600 px-4 py-2 text-sm hover:bg-slate-200 dark:hover:bg-slate-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || loading}
            className="rounded-md bg-sky-600 px-4 py-2 text-sm hover:bg-sky-500 disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
