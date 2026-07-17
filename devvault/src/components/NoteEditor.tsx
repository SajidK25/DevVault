import { useEffect, useRef, useState } from "react";
import { highlightHtml, renderMarkdown } from "../lib/markdown";
import { openUrl } from "../lib/ipc";

interface NoteEditorProps {
  value: string;
  onChange: (value: string) => void;
}

function escapeRegex(s: string): string {
  return s.replace(/[\\^$.|?*+(){}[\]]/g, "\\$&");
}

export default function NoteEditor({ value, onChange }: NoteEditorProps) {
  const [showPreview, setShowPreview] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatches, setSearchMatches] = useState<{ start: number; end: number }[]>([]);
  const [searchIndex, setSearchIndex] = useState(0);
  const [linkPopupOpen, setLinkPopupOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkDisplayText, setLinkDisplayText] = useState("");
  const [confirmUrl, setConfirmUrl] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const historyRef = useRef<string[]>([value]);
  const historyIndexRef = useRef<number>(0);
  const pendingSelectionRef = useRef<{ start: number; end: number } | null>(null);
  const savedSelectionRef = useRef<{ start: number; end: number } | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  // Auto-grow textarea height
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [value, showPreview]);

  // Restore cursor after toolbar insertion
  useEffect(() => {
    if (pendingSelectionRef.current && textareaRef.current) {
      const { start, end } = pendingSelectionRef.current;
      textareaRef.current.setSelectionRange(start, end);
      pendingSelectionRef.current = null;
    }
  });

  // Compute search matches in edit mode
  useEffect(() => {
    if (!searchOpen || showPreview || !searchQuery) {
      setSearchMatches([]);
      return;
    }
    const matches: { start: number; end: number }[] = [];
    const re = new RegExp(escapeRegex(searchQuery), "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(value)) !== null) {
      matches.push({ start: m.index, end: m.index + m[0].length });
    }
    setSearchMatches(matches);
    setSearchIndex(0);
  }, [searchQuery, value, searchOpen, showPreview]);

  // Select current match in textarea (edit mode)
  useEffect(() => {
    if (!searchOpen || showPreview || searchMatches.length === 0) return;
    const match = searchMatches[searchIndex];
    if (!match || !textareaRef.current) return;
    textareaRef.current.focus();
    textareaRef.current.setSelectionRange(match.start, match.end);
  }, [searchIndex, searchMatches, searchOpen, showPreview]);

  // Scroll to current mark in preview mode
  useEffect(() => {
    if (!searchOpen || !showPreview || !previewRef.current) return;
    const marks = previewRef.current.querySelectorAll("mark");
    if (marks[searchIndex]) {
      marks[searchIndex].scrollIntoView({ block: "nearest" });
    }
  }, [searchIndex, searchOpen, showPreview]);

  // ---- History stack -------------------------------------------------------

  function pushHistory(newValue: string) {
    const history = historyRef.current;
    const index = historyIndexRef.current;
    if (newValue === history[index]) return;
    const truncated = history.slice(0, index + 1);
    truncated.push(newValue);
    if (truncated.length > 200) {
      truncated.shift();
    }
    historyIndexRef.current = truncated.length - 1;
    historyRef.current = truncated;
  }

  function handleChange(newValue: string) {
    pushHistory(newValue);
    onChange(newValue);
  }

  // ---- Search helpers ------------------------------------------------------

  function openSearch() {
    if (searchOpen) {
      searchInputRef.current?.focus();
    } else {
      setSearchOpen(true);
      setTimeout(() => searchInputRef.current?.focus(), 0);
    }
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setSearchOpen(false);
      setSearchQuery("");
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (showPreview) {
        const total = previewRef.current?.querySelectorAll("mark").length ?? 0;
        if (total === 0) return;
        setSearchIndex((i) =>
          e.shiftKey ? (i - 1 + total) % total : (i + 1) % total
        );
      } else {
        if (searchMatches.length === 0) return;
        setSearchIndex((i) =>
          e.shiftKey
            ? (i - 1 + searchMatches.length) % searchMatches.length
            : (i + 1) % searchMatches.length
        );
      }
    }
  }

  // ---- Keyboard handlers ---------------------------------------------------

  function handleTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.ctrlKey && e.key === "z") {
      e.preventDefault();
      const index = historyIndexRef.current;
      if (index > 0) {
        historyIndexRef.current = index - 1;
        onChange(historyRef.current[historyIndexRef.current]);
      }
    } else if (e.ctrlKey && e.key === "y") {
      e.preventDefault();
      const index = historyIndexRef.current;
      if (index < historyRef.current.length - 1) {
        historyIndexRef.current = index + 1;
        onChange(historyRef.current[historyIndexRef.current]);
      }
    } else if (e.ctrlKey && e.key === "f") {
      e.preventDefault();
      openSearch();
    }
  }

  function handlePreviewKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.ctrlKey && e.key === "f") {
      e.preventDefault();
      openSearch();
    }
  }

  // ---- Toolbar insertion ---------------------------------------------------

  function insertSyntax(
    prefix: string,
    suffix: string,
    opts?: { linePrefix?: boolean; blockMode?: boolean }
  ) {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = value.slice(start, end);

    let newValue: string;
    let newStart: number;
    let newEnd: number;

    if (opts?.blockMode) {
      newValue = value.slice(0, start) + "```\n" + selected + "\n```" + value.slice(end);
      newStart = start + 4;
      newEnd = newStart + selected.length;
    } else if (opts?.linePrefix) {
      const before = value.slice(0, start);
      const lineStart = before.lastIndexOf("\n") + 1;
      if (start === end) {
        newValue = value.slice(0, lineStart) + prefix + value.slice(lineStart);
        newStart = newEnd = start + prefix.length;
      } else {
        const selText = value.slice(lineStart, end);
        const lines = selText.split("\n");
        const prefixed = lines.map((l) => prefix + l).join("\n");
        newValue = value.slice(0, lineStart) + prefixed + value.slice(end);
        newStart = start + prefix.length;
        newEnd = end + prefix.length * lines.length;
      }
    } else if (selected) {
      newValue = value.slice(0, start) + prefix + selected + suffix + value.slice(end);
      newStart = start + prefix.length;
      newEnd = end + prefix.length;
    } else {
      newValue = value.slice(0, start) + prefix + suffix + value.slice(end);
      newStart = newEnd = start + prefix.length;
    }

    pendingSelectionRef.current = { start: newStart, end: newEnd };
    pushHistory(newValue);
    onChange(newValue);
  }

  // ---- Link popup ----------------------------------------------------------

  function handleLinkButtonClick() {
    const el = textareaRef.current;
    if (el) {
      savedSelectionRef.current = { start: el.selectionStart, end: el.selectionEnd };
      setLinkDisplayText(value.slice(el.selectionStart, el.selectionEnd));
    }
    setLinkUrl("");
    setLinkPopupOpen(true);
  }

  function confirmLink() {
    const display = linkDisplayText || linkUrl;
    const syntax = `[${display}](${linkUrl})`;
    const saved = savedSelectionRef.current ?? { start: value.length, end: value.length };
    const newValue = value.slice(0, saved.start) + syntax + value.slice(saved.end);
    pendingSelectionRef.current = {
      start: saved.start + syntax.length,
      end: saved.start + syntax.length,
    };
    setLinkPopupOpen(false);
    pushHistory(newValue);
    onChange(newValue);
  }

  // ---- Preview link click --------------------------------------------------

  function handlePreviewClick(e: React.MouseEvent) {
    const target = (e.target as Element).closest("[data-url]");
    if (target) {
      setConfirmUrl((target as HTMLElement).dataset.url ?? "");
      setConfirmError(null);
    }
  }

  async function confirmOpenUrl() {
    if (!confirmUrl) return;
    try {
      await openUrl(confirmUrl);
      setConfirmUrl(null);
    } catch (err) {
      setConfirmError(String(err));
    }
  }

  // ---- Derived render values -----------------------------------------------

  const previewHtml =
    searchOpen && searchQuery
      ? highlightHtml(renderMarkdown(value), searchQuery)
      : renderMarkdown(value);

  const previewMatchCount = searchOpen && searchQuery
    ? (previewHtml.match(/<mark/g) ?? []).length
    : 0;

  // ---- Render --------------------------------------------------------------

  return (
    <div>
      {/* Toolbar — Edit mode only */}
      {!showPreview && (
        <div className="mb-1 flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => insertSyntax("**", "**")}
            className="rounded border border-slate-300 dark:border-slate-600 px-2 py-0.5 text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-700"
            title="Bold"
          >
            B
          </button>
          <button
            type="button"
            onClick={() => insertSyntax("*", "*")}
            className="rounded border border-slate-300 dark:border-slate-600 px-2 py-0.5 text-xs italic hover:bg-slate-200 dark:hover:bg-slate-700"
            title="Italic"
          >
            I
          </button>
          <button
            type="button"
            onClick={() => insertSyntax("- ", "", { linePrefix: true })}
            className="rounded border border-slate-300 dark:border-slate-600 px-2 py-0.5 text-xs hover:bg-slate-200 dark:hover:bg-slate-700"
            title="Bullet list"
          >
            •
          </button>
          <button
            type="button"
            onClick={() => insertSyntax("1. ", "", { linePrefix: true })}
            className="rounded border border-slate-300 dark:border-slate-600 px-2 py-0.5 text-xs hover:bg-slate-200 dark:hover:bg-slate-700"
            title="Numbered list"
          >
            1.
          </button>
          <button
            type="button"
            onClick={() => insertSyntax("`", "`")}
            className="rounded border border-slate-300 dark:border-slate-600 px-2 py-0.5 text-xs font-mono hover:bg-slate-200 dark:hover:bg-slate-700"
            title="Inline code"
          >
            `
          </button>
          <button
            type="button"
            onClick={() => insertSyntax("", "", { blockMode: true })}
            className="rounded border border-slate-300 dark:border-slate-600 px-2 py-0.5 text-xs font-mono hover:bg-slate-200 dark:hover:bg-slate-700"
            title="Fenced code block"
          >
            ```
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={handleLinkButtonClick}
              className="rounded border border-slate-300 dark:border-slate-600 px-2 py-0.5 text-xs hover:bg-slate-200 dark:hover:bg-slate-700"
              title="Link"
            >
              🔗
            </button>
            {linkPopupOpen && (
              <div className="absolute left-0 top-7 z-20 w-64 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 p-3 shadow-xl">
                {linkDisplayText && (
                  <p className="mb-1 text-xs text-slate-500 dark:text-slate-400">
                    Text: <span className="font-mono">{linkDisplayText}</span>
                  </p>
                )}
                <input
                  autoFocus
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      confirmLink();
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setLinkPopupOpen(false);
                    }
                  }}
                  placeholder="https://…"
                  className="w-full rounded border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-900 px-2 py-1 text-xs outline-none focus:border-sky-500"
                />
                <div className="mt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setLinkPopupOpen(false)}
                    className="rounded px-2 py-1 text-xs hover:bg-slate-200 dark:hover:bg-slate-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={confirmLink}
                    className="rounded bg-sky-600 px-2 py-1 text-xs text-white hover:bg-sky-500"
                  >
                    Insert
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Search bar */}
      {searchOpen && (
        <div className="mb-1 flex items-center gap-2 rounded-md border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-900 px-2 py-1">
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSearchIndex(0);
            }}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search…"
            className="flex-1 bg-transparent text-sm outline-none"
          />
          <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
            {showPreview
              ? `${previewMatchCount} matches`
              : searchMatches.length > 0
              ? `${searchIndex + 1} of ${searchMatches.length}`
              : "0 of 0"}
          </span>
          <button
            type="button"
            onClick={() => {
              setSearchOpen(false);
              setSearchQuery("");
            }}
            className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          >
            ✕
          </button>
        </div>
      )}

      {/* Notes label + Edit/Preview toggle */}
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
          ref={previewRef}
          tabIndex={0}
          onKeyDown={handlePreviewKeyDown}
          className="min-h-64 rounded-md border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-900 p-3 text-sm overflow-x-auto outline-none"
          dangerouslySetInnerHTML={{ __html: previewHtml }}
          onClick={handlePreviewClick}
        />
      ) : (
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleTextareaKeyDown}
          placeholder="Markdown notes…"
          className="w-full min-h-64 rounded-md border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-900 px-3 py-2 font-mono text-sm outline-none focus:border-sky-500 whitespace-nowrap overflow-x-auto resize-none"
          style={{ height: "auto" }}
        />
      )}

      {/* Link confirmation dialog */}
      {confirmUrl !== null && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-2xl">
            <p className="mb-1 text-sm font-medium">Open link?</p>
            <p className="mb-4 break-all text-xs text-slate-500 dark:text-slate-400">
              {confirmUrl}
            </p>
            {confirmError && (
              <p className="mb-3 rounded bg-red-950/60 px-3 py-2 text-xs text-red-300">
                {confirmError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setConfirmUrl(null);
                  setConfirmError(null);
                }}
                className="rounded-md border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-sm hover:bg-slate-200 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmOpenUrl}
                className="rounded-md bg-sky-600 px-3 py-1.5 text-sm text-white hover:bg-sky-500"
              >
                Open
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
