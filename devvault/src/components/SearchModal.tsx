import { useEffect, useRef, useState } from "react";
import type { SearchHit } from "../types";
import { search } from "../lib/ipc";

interface Props {
  onClose: () => void;
  onPick: (hit: SearchHit) => void;
}

export default function SearchModal({ onClose, onPick }: Props) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced query.
  useEffect(() => {
    const id = setTimeout(() => {
      if (!query.trim()) {
        setHits([]);
        return;
      }
      search(query)
        .then((h) => {
          setHits(h);
          setActive(0);
        })
        .catch(() => setHits([]));
    }, 120);
    return () => clearTimeout(id);
  }, [query]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && hits[active]) {
      e.preventDefault();
      onPick(hits[active]);
    }
  }

  const badge = (h: SearchHit) =>
    h.matched_on === "project" ? "project" : h.matched_on;

  return (
    <div
      className="fixed inset-0 z-20 flex items-start justify-center bg-black/50 p-6 pt-24"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search projects, titles, tags, field labels…"
          className="w-full border-b border-slate-200 dark:border-slate-700 bg-transparent px-4 py-3 text-sm outline-none"
        />
        <ul className="max-h-80 overflow-y-auto">
          {query.trim() && hits.length === 0 && (
            <li className="px-4 py-3 text-sm text-slate-500 dark:text-slate-500">No matches.</li>
          )}
          {hits.map((h, i) => (
            <li key={`${h.project_id}-${h.entry_id ?? "proj"}-${i}`}>
              <button
                onMouseEnter={() => setActive(i)}
                onClick={() => onPick(h)}
                className={`flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm ${
                  i === active ? "bg-slate-200 dark:bg-slate-700" : "hover:bg-slate-200/50 dark:hover:bg-slate-700/50"
                }`}
              >
                <span className="rounded bg-slate-300 dark:bg-slate-600 px-1.5 py-0.5 text-[10px] uppercase">
                  {badge(h)}
                </span>
                <span className="flex-1 truncate">
                  {h.entry_title ?? h.project_name}
                  {h.entry_title && (
                    <span className="ml-2 text-xs text-slate-500 dark:text-slate-500">
                      {h.project_name}
                    </span>
                  )}
                </span>
                {h.matched_on !== "title" && h.matched_on !== "project" && (
                  <span className="truncate text-xs text-slate-500 dark:text-slate-500">
                    {h.snippet}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
        <div className="border-t border-slate-200 dark:border-slate-700 px-4 py-2 text-[11px] text-slate-500 dark:text-slate-500">
          ↑↓ navigate · ↵ open · esc close
        </div>
      </div>
    </div>
  );
}
