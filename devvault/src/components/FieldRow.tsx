import { useState } from "react";
import type { Field } from "../types";
import { CLIPBOARD_CLEAR_SECONDS, copyWithAutoClear } from "../lib/clipboard";
import { DEFAULT_GEN, generatePassword, type GenOptions } from "../lib/generate";

interface Props {
  field: Field;
  onChange: (f: Field) => void;
  onRemove: () => void;
}

export default function FieldRow({ field, onChange, onRemove }: Props) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [gen, setGen] = useState<GenOptions>(DEFAULT_GEN);

  const masked = field.secret && !revealed;

  async function copy() {
    try {
      await copyWithAutoClear(field.value);
      setCopied(true);
      setTimeout(() => setCopied(false), CLIPBOARD_CLEAR_SECONDS * 1000);
    } catch {
      /* clipboard may be unavailable; ignore */
    }
  }

  function runGenerate() {
    onChange({ ...field, value: generatePassword(gen) });
    setRevealed(true);
    setGenOpen(false);
  }

  const charsets: { key: keyof GenOptions; label: string }[] = [
    { key: "lower", label: "a-z" },
    { key: "upper", label: "A-Z" },
    { key: "digits", label: "0-9" },
    { key: "symbols", label: "!@#" },
  ];

  return (
    <div className="flex items-center gap-2">
      <input
        value={field.label}
        onChange={(e) => onChange({ ...field, label: e.target.value })}
        placeholder="Label"
        className="w-32 rounded-md border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-900 px-2 py-1.5 text-sm outline-none focus:border-sky-500"
      />
      <input
        type={masked ? "password" : "text"}
        value={field.value}
        onChange={(e) => onChange({ ...field, value: e.target.value })}
        placeholder="Value"
        className="flex-1 rounded-md border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-900 px-2 py-1.5 text-sm outline-none focus:border-sky-500"
      />

      {field.secret && (
        <button
          type="button"
          onClick={() => setRevealed((v) => !v)}
          title={revealed ? "Hide" : "Reveal"}
          className="rounded-md border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-xs hover:bg-slate-200 dark:hover:bg-slate-700"
        >
          {revealed ? "Hide" : "Show"}
        </button>
      )}

      <div className="relative">
        <button
          type="button"
          onClick={() => setGenOpen((v) => !v)}
          title="Generate a random value"
          className="rounded-md border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-xs hover:bg-slate-200 dark:hover:bg-slate-700"
        >
          Gen
        </button>
        {genOpen && (
          <div className="absolute right-0 z-30 mt-1 w-56 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 p-3 shadow-xl">
            <label className="flex items-center justify-between text-xs">
              Length
              <input
                type="number"
                min={4}
                max={128}
                value={gen.length}
                onChange={(e) =>
                  setGen((g) => ({ ...g, length: Number(e.target.value) || 0 }))
                }
                className="ml-2 w-16 rounded border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-900 px-1.5 py-1 text-right"
              />
            </label>
            <div className="mt-2 grid grid-cols-2 gap-1">
              {charsets.map((c) => (
                <label key={c.key} className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={gen[c.key] as boolean}
                    onChange={(e) =>
                      setGen((g) => ({ ...g, [c.key]: e.target.checked }))
                    }
                  />
                  {c.label}
                </label>
              ))}
            </div>
            <button
              type="button"
              onClick={runGenerate}
              className="mt-2 w-full rounded-md bg-sky-600 py-1 text-xs text-white hover:bg-sky-500"
            >
              Generate
            </button>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={copy}
        title={`Copy value (clears in ${CLIPBOARD_CLEAR_SECONDS}s)`}
        className="rounded-md border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-xs hover:bg-slate-200 dark:hover:bg-slate-700"
      >
        {copied ? `✓ ${CLIPBOARD_CLEAR_SECONDS}s` : "Copy"}
      </button>

      <label className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400">
        <input
          type="checkbox"
          checked={field.secret}
          onChange={(e) => onChange({ ...field, secret: e.target.checked })}
        />
        secret
      </label>

      <button
        type="button"
        onClick={onRemove}
        title="Remove field"
        className="rounded-md px-2 py-1.5 text-xs text-red-500 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-950/40"
      >
        ✕
      </button>
    </div>
  );
}
