import { useEffect, useRef, useState } from "react";
import type { EntryType, Field } from "../types";
import { ENTRY_TYPES } from "../types";
import { createEntry, getEntry, updateEntry } from "../lib/ipc";
import FieldRow from "./FieldRow";
import NoteEditor from "./NoteEditor";

interface Props {
  projectId: string;
  entryId: string | null; // null = create new
  onClose: () => void;
  onSaved: () => void;
}

type Size = "normal" | "large" | "full";
type SaveStatus = "idle" | "saving" | "saved" | "error";

const AUTOSAVE_DEBOUNCE_MS = 900;

// Full literal class strings (NOT concatenated) so Tailwind's JIT scanner emits
// them. `normal` matches the pre-resize modal exactly.
const SIZE_CLASS: Record<Size, string> = {
  normal: "w-full max-w-2xl max-h-full",
  large: "w-full max-w-5xl max-h-full",
  full: "w-full max-w-none h-full",
};
const SIZE_ORDER: Size[] = ["normal", "large", "full"];

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
  const [size, setSize] = useState<Size>("normal"); // resets each open (modal unmounts on close)
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(entryId !== null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  // Mutable id: starts as the prop, but flips from null -> real id once
  // autosave creates a brand-new entry. A ref (not state) so the autosave
  // effect below doesn't re-run just because the id changed.
  const entryIdRef = useRef<string | null>(entryId);
  // Guards against autosaving the very first render after `getEntry`
  // populates state (that's a load, not an edit).
  const skipNextAutosaveRef = useRef(entryId !== null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  /** Creates or updates the entry, tracking status. Used by both autosave and the explicit Save button. */
  async function persist(): Promise<boolean> {
    if (!title.trim()) return false;
    setSaveStatus("saving");
    try {
      const tags = parseTags();
      if (entryIdRef.current === null) {
        const created = await createEntry(
          projectId,
          type,
          title.trim(),
          tags,
          notes,
          fields
        );
        entryIdRef.current = created.id;
      } else {
        await updateEntry(entryIdRef.current, type, title.trim(), tags, notes, fields);
      }
      setError(null);
      setSaveStatus("saved");
      onSaved();
      return true;
    } catch (err) {
      setError(String(err));
      setSaveStatus("error");
      return false;
    }
  }

  // Debounced autosave: fires ~900ms after the last edit to title/tags/notes/fields.
  useEffect(() => {
    if (loading) return;
    if (skipNextAutosaveRef.current) {
      skipNextAutosaveRef.current = false;
      return;
    }
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      void persist();
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, type, title, tagsInput, notes, fields]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    setBusy(true);
    const ok = await persist();
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/50 p-6">
      <form
        onSubmit={save}
        className={`flex flex-col overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-2xl ${SIZE_CLASS[size]}`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-5 py-3">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">
              {entryId === null ? "New entry" : "Edit entry"}
            </h2>
            <span className="text-xs text-slate-500 dark:text-slate-500">
              {!title.trim()
                ? "Add a title to save"
                : saveStatus === "saving"
                ? "Saving…"
                : saveStatus === "saved"
                ? "Saved"
                : saveStatus === "error"
                ? "Save failed"
                : null}
            </span>
          </div>
          <div className="flex items-center gap-1 text-slate-600 dark:text-slate-400">
            {size !== "normal" && (
              <button
                type="button"
                onClick={() => setSize("normal")}
                title="Restore size"
                className="rounded px-1 hover:text-slate-800 dark:hover:text-slate-200"
              >
                ⤡
              </button>
            )}
            {size !== "full" && (
              <button
                type="button"
                onClick={() =>
                  setSize((s) => SIZE_ORDER[SIZE_ORDER.indexOf(s) + 1])
                }
                title="Enlarge"
                className="rounded px-1 hover:text-slate-800 dark:hover:text-slate-200"
              >
                ⤢
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              title="Close"
              className="rounded px-1 hover:text-slate-800 dark:hover:text-slate-200"
            >
              ✕
            </button>
          </div>
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

            <NoteEditor value={notes} onChange={setNotes} />

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
            Close
          </button>
          <button
            type="submit"
            disabled={busy || loading || !title.trim()}
            className="rounded-md bg-sky-600 px-4 py-2 text-sm hover:bg-sky-500 disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save & close"}
          </button>
        </div>
      </form>
    </div>
  );
}
