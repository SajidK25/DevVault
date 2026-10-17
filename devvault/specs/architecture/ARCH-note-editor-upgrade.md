# Architecture: Note Editor Upgrade

> **Date:** 2026-06-26
> **Phase:** 2 of 5 (System Architecture)
> **Requirements source:** `devvault/specs/requirements/REQ-note-editor-upgrade.md`
> **Type:** feature

## Architecture Summary

The Notes section of `EntryEditor` is extracted into a self-contained `NoteEditor` component that owns all notes UI: a formatting toolbar (7 buttons), auto-growing textarea, edit/preview toggle, link popup, in-note search bar, and a custom undo/redo history stack. The markdown renderer (`markdown.ts`) receives three targeted fixes: non-markdown lines get `white-space: pre-wrap` to preserve ASCII art, links render as styled `<a data-url>` elements (no `href`) handled via event delegation, and a new `highlightHtml` export supports search highlighting in preview mode. A new Rust command `open_url` (backed by the `open` crate) opens confirmed URLs in the system browser, following the existing `invoke`-only IPC convention. No new frontend library or editor framework is introduced.

---

## High-Level Structure

```
EntryEditor.tsx  (modified — strips Notes block, passes value/onChange)
  └── NoteEditor.tsx  (new — owns all notes UI)
        ├── FormatToolbar     (inline JSX — 7 buttons + link popup anchor)
        ├── LinkPopup         (inline JSX — positioned near toolbar)
        ├── SearchBar         (inline JSX — docked below toolbar when open)
        ├── <textarea>        (edit mode — no-wrap, auto-grow, custom undo)
        └── <div preview>     (preview mode — event delegation for link clicks)

src/lib/markdown.ts     (modified — 3 targeted changes)
src/lib/ipc.ts          (modified — add openUrl)

src-tauri/src/commands.rs   (modified — add open_url command)
src-tauri/src/lib.rs        (modified — register open_url)
src-tauri/Cargo.toml        (modified — add `open` crate)
```

**Data flow — toolbar insertion:**
```
User selects text → clicks toolbar button
  → NoteEditor reads textareaRef: selectionStart, selectionEnd
  → builds newValue: prefix + syntax-wrapped selection + suffix
  → pushes newValue to historyRef (immediate, no debounce)
  → calls onChange(newValue)  →  React re-renders
  → useEffect fires: textarea.setSelectionRange(newStart, newEnd)
```

**Data flow — link open:**
```
User clicks <a data-url> in preview div
  → onClick handler: e.target.closest('[data-url]')
  → setConfirmUrl(url)  →  confirmation dialog renders
  → user confirms  →  ipc.openUrl(url)  →  invoke("open_url", { url })
  → Rust: validate http/https  →  open::that(url)
```

**Data flow — undo/redo:**
```
User types  →  onChange fires  →  push to historyRef (dedup)
Ctrl+Z      →  preventDefault  →  historyIndexRef--  →  onChange(history[index])
Ctrl+Y      →  preventDefault  →  historyIndexRef++  →  onChange(history[index])
```

**Data flow — search (edit mode):**
```
Ctrl+F  →  setSearchOpen(true)
User types query  →  find all match indices in value (escaped RegExp)
  →  setSearchMatches([{start,end}, ...])  →  setSearchIndex(0)
  →  textarea.setSelectionRange(match.start, match.end)
  →  show "1 of N" counter
Enter  →  advance index  →  repeat setSelectionRange
Escape →  setSearchOpen(false)  →  clear selection
```

**Data flow — search (preview mode):**
```
Ctrl+F  →  setSearchOpen(true)
User types query
  →  html = renderMarkdown(value)
  →  highlighted = highlightHtml(html, query)   ← wraps all text-node matches in <mark>
  →  dangerouslySetInnerHTML = { __html: highlighted }
  →  show "N matches" counter
Enter  →  previewRef.current.querySelectorAll('mark')[index].scrollIntoView()
Escape →  clear query  →  re-render without highlights
```

---

## Tech Choices

| Area | Decision | Alternatives Considered | Rationale |
|------|----------|------------------------|-----------|
| URL opening | `open` crate + custom `invoke` command | `tauri-plugin-opener` | Follows existing invoke-only IPC convention; no new frontend package; consistent with N2 |
| Auto-grow textarea | JS `scrollHeight` on every change | CSS `field-sizing: content` | `field-sizing` too new for WebKitGTK on most Linux distros; `scrollHeight` universally reliable |
| Undo/Redo | Custom `useRef` history stack | `document.execCommand` (deprecated) | No deprecated API; works correctly with React controlled state; predictable in Tauri WebKit |
| Toolbar implementation | Inline JSX in NoteEditor | Separate `FormatToolbar.tsx` component | No props/callbacks to thread; no reuse elsewhere; extra file adds complexity without benefit |
| Link rendering | `<a class="note-link" data-url="...">` + event delegation | `href` + `target=_blank` | CSP blocks external nav; Tauri WebView ignores `target=_blank`; delegation works with `dangerouslySetInnerHTML` |
| Search highlight (edit) | `textarea.setSelectionRange()` — select current match | Transparent overlay div | Textarea cannot contain HTML; overlay fragile with scroll sync |
| Search highlight (preview) | `highlightHtml(html, query)` post-processor | Highlight before HTML escaping | Post-processing splits on `<tag>`/text boundaries — safe, avoids injecting into HTML attributes |
| Format: no new editor library | Plain React + DOM APIs | TipTap, Quill, CodeMirror | N2 explicit requirement; scope doesn't need a full editor engine |

---

## Patterns & Conventions

- **Invoke-only IPC** — all Tauri calls go through typed wrappers in `src/lib/ipc.ts`. `openUrl` follows the same shape as every other function there.
- **Component extraction pattern** — new component takes `value: string` + `onChange: (v: string) => void`. Follows the prop shape of existing controlled inputs throughout the app.
- **Rust error handling** — commands return `Result<T, String>` (existing pattern in `commands.rs`). `open_url` follows the same shape.
- **Tailwind JIT** — all class strings must be full literals (no concatenation). See `SIZE_CLASS` in `EntryEditor.tsx` for the existing pattern. Any conditional classes in `NoteEditor` must follow this.
- **Security boundary** — all crypto/secrets stay in Rust. `open_url` adds a new Rust-side boundary: URL validation (`http`/`https` only) happens in Rust, not just in the frontend confirmation dialog.

---

## API Contracts / Interfaces

### NoteEditor component

**Boundary:** internal React component

| Prop | Type | Purpose |
|------|------|---------|
| `value` | `string` | Current notes content (controlled) |
| `onChange` | `(value: string) => void` | Called on every content change |

No other props. `showPreview`, undo state, search state, link popup state are all internal.

### markdown.ts exports

**Boundary:** internal TypeScript module

| Export | Signature | Purpose | Change |
|--------|-----------|---------|--------|
| `renderMarkdown` | `(src: string) => string` | Renders markdown to HTML | Modified — see below |
| `highlightHtml` | `(html: string, query: string) => string` | Wraps query matches in `<mark>` | **New** |

**`renderMarkdown` changes:**
1. Non-markdown lines: `<p>${inline(line)}</p>` → `<p style="white-space:pre-wrap">${inline(line)}</p>`
2. Links in `inline()`: `[text](url)` → `<a class="note-link text-sky-400 underline cursor-pointer" data-url="${url}">${text}</a>` (no `href`)

**`highlightHtml` algorithm:**
```
Split html on /<[^>]*>/ — alternates between tag tokens and text tokens
For text tokens: replace(escapedQueryRegex, '<mark class="bg-yellow-400/40 text-inherit">$&</mark>')
For tag tokens: pass through unchanged
Rejoin and return
```

### ipc.ts — new function

```typescript
export function openUrl(url: string): Promise<void> {
  return invoke<void>("open_url", { url });
}
```

### Rust — open_url command

**Boundary:** Tauri invoke command

```rust
// src-tauri/src/commands.rs
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("Only http and https URLs are permitted.".into());
    }
    open::that(&url).map_err(|e| e.to_string())
}
```

**Auth requirements:** No vault state required. Command is available when vault is locked or unlocked.

---

## Data Models

### NoteEditor internal history stack

**Purpose:** enables Ctrl+Z / Ctrl+Y over the notes string

**Shape (refs, not React state — avoids re-renders on every push):**

| Ref | Type | Notes |
|-----|------|-------|
| `historyRef` | `useRef<string[]>` | Snapshot array, max 200 entries; oldest dropped when cap hit |
| `historyIndexRef` | `useRef<number>` | Current position in stack; starts at 0 after first push |

**Lifecycle:**
- Mount: push `value` prop → index = 0
- `onChange`: push new value if different from `history[index]`; if index < length-1 (mid-undo), truncate future entries first
- Ctrl+Z: index-- (floor 0); call `onChange(history[index])`
- Ctrl+Y: index++ (ceil length-1); call `onChange(history[index])`
- Cap: when pushing and `history.length === 200`, shift oldest entry, keep index consistent

### NoteEditor internal search state

| State | Type | Notes |
|-------|------|-------|
| `searchOpen` | `boolean` | Whether search bar is visible |
| `searchQuery` | `string` | Current search input value |
| `searchMatches` | `{start: number, end: number}[]` | All match positions in raw `value` (edit mode) |
| `searchIndex` | `number` | Current active match (0-based) |

---

## Module Boundaries

| Module | Responsibility | Allowed Dependencies |
|--------|---------------|----------------------|
| `NoteEditor.tsx` | All notes editing UI and state | `markdown.ts`, `ipc.ts`, React |
| `EntryEditor.tsx` | Entry-level form, fields, save/cancel | `NoteEditor.tsx`, `ipc.ts`, `FieldRow.tsx` |
| `markdown.ts` | String → HTML rendering + search highlight | None (pure functions, no imports) |
| `ipc.ts` | Typed invoke wrappers | `@tauri-apps/api/core` only |
| `commands.rs` (open_url) | URL validation + system open | `open` crate |

`NoteEditor` must **not** import from `ipc.ts` directly for anything other than `openUrl`. It must **not** know about entry IDs, projects, or vault state — those belong in `EntryEditor`.

---

## Change Footprint

### New files / modules

| Path | Purpose | Pattern reference |
|------|---------|-------------------|
| `src/components/NoteEditor.tsx` | Self-contained notes editor component | `src/components/FieldRow.tsx` (controlled prop pattern) |

### Modified files / modules

| Path | What changes here |
|------|-----------------|
| `src/components/EntryEditor.tsx` | Replace lines 197-222 (Notes JSX block + `showPreview` state + `renderMarkdown` import) with `<NoteEditor value={notes} onChange={setNotes} />` |
| `src/lib/markdown.ts` | (1) `<p>` gains `white-space:pre-wrap`; (2) links render as `<a data-url>`; (3) export `highlightHtml` |
| `src/lib/ipc.ts` | Add `openUrl(url)` at end of file |
| `src-tauri/src/commands.rs` | Add `pub fn open_url` |
| `src-tauri/src/lib.rs` | Add `commands::open_url` to `generate_handler![]` |
| `src-tauri/Cargo.toml` | Add `open = "5"` under `[dependencies]` |

### Deleted / replaced

| Path | Reason |
|------|--------|
| _(none)_ | Notes block is replaced in-place; no file is deleted |

### Touched but not changed (silent-regression hotspots)

| Path | Why it matters |
|------|---------------|
| `src/lib/markdown.ts` (existing callers) | `renderMarkdown` output changes: `[text](url)` now renders a link; `<p>` gains inline style. All saved notes pass through this on preview. Visual change is intentional; raw string content in DB is unchanged. |
| `src/components/EntryEditor.tsx` — `notes` state + `save()` | `notes: string` still flows unchanged to `createEntry`/`updateEntry`. Refactor must not touch this path. |

---

## Areas of Impact

| Area | Impact | Risk | Why |
|------|--------|------|-----|
| All existing notes (preview) | `renderMarkdown` output changes — `pre-wrap` on `<p>`, link elements where plain text was before | M | Intentional visual change; content integrity unaffected; must verify no layout regressions in existing notes |
| EntryEditor layout | Notes section grows (min-height, toolbar row, search bar row) | L | Modal has `overflow-y-auto`; existing size controls (normal/large/full) absorb extra height |
| Rust `commands.rs` | New `open_url` command added | L | Isolated; no vault state access; no DB interaction |
| `open` crate (new Rust dep) | Adds OS shell-open capability | M | Security: URL validation in Rust is the hard boundary; `open::that()` must only fire after validation passes |
| `ipc.ts` existing callers | No existing function touched; additive only | L | Zero regression risk |

**Contract changes:** None. All existing Tauri command signatures unchanged. `renderMarkdown` signature unchanged (same `(src: string) => string`). `EntryEditor` props unchanged.

**Cross-cutting ripples:**
- `Cargo.toml` change → requires `cargo` rebuild; dev server restart needed after adding the dep.
- No migration needed — notes are stored as raw markdown strings; the renderer change is display-only.
- No capabilities file change needed — `open_url` calls `open::that()` which is a native Rust call, not a Tauri plugin permission.

---

## Cross-Cutting Concerns

- **Errors:** `openUrl` rejects → frontend catches → shows error message in or below the confirmation dialog. Toolbar insert errors are impossible (pure string ops). Search with no matches: counter shows "0 of 0", no selection made.
- **Logging & metrics:** None required. This is a local offline app with no telemetry.
- **Auth / authz:** `open_url` requires no vault state. It is intentionally available even when vault is locked (a locked note could still have visible links in preview). URL validation is the only gate.
- **Performance:** Search regex runs synchronously on every keystroke against the raw `value` string. At 1000+ lines (unusual for a notes field) this is still sub-millisecond. `highlightHtml` for preview runs on the already-rendered HTML string — same bound.
- **Security:**
  - `open_url` Rust validates `http://` / `https://` prefix before calling `open::that()`. Rejects `file://`, `javascript:`, `data:`, bare paths.
  - `highlightHtml` injects `<mark>` tags into already-escaped HTML — the query string is used only as a regex pattern against text nodes, never injected directly into HTML. Safe against XSS.
  - Link `data-url` attribute value is set by `renderMarkdown` which runs `escapeHtml` first — URL is HTML-escaped in the attribute. When read back in the click handler, it is passed as a plain string to `invoke`, not rendered into DOM.
- **Migrations / rollout:** No DB schema change. No backup/restore impact. Drop-in frontend change — restart dev server after adding `open` crate.

---

## Architecture Decisions Log

| # | Decision | Alternatives | Chosen Because | Satisfies REQs |
|---|----------|-------------|----------------|----------------|
| A1 | Extract `NoteEditor.tsx` component | Keep inline in EntryEditor | EntryEditor grows to ~350+ lines; NoteEditor is self-contained with distinct state | R1–R17 |
| A2 | `open` crate + custom invoke command | `tauri-plugin-opener` | Follows invoke-only IPC convention; no new frontend package; consistent with N2 spirit | N2, N3, R8 |
| A3 | Custom `useRef` history stack | `document.execCommand` (deprecated) | No deprecated API; correct with React controlled state; no WebKit-specific behaviour | R9, R10 |
| A4 | JS `scrollHeight` auto-grow | CSS `field-sizing: content` | `field-sizing` requires Chrome 123+ / very recent WebKitGTK; `scrollHeight` universally reliable | R1 |
| A5 | `<a data-url>` + event delegation | `href` + `target=_blank` | CSP blocks external nav; `target=_blank` unreliable in Tauri WebView; delegation works with `dangerouslySetInnerHTML` | R7, R8, N3 |
| A6 | Edit search = select-current-match; Preview = `<mark>` all | Overlay div over textarea | Textarea cannot contain HTML; overlay fragile with scroll sync | R13–R17 |
| A7 | URL validation in Rust (`http/https` only) | Frontend-only validation | Defense-in-depth; Rust is the security boundary per CLAUDE.md invariants | N3, R8 |
| A8 | `white-space: pre-wrap` on non-markdown `<p>` | Global `<pre>`; require fenced code | Preserves markdown rendering for headings/lists; fixes ASCII paste with zero friction | R11, R12 |
| A9 | Toolbar as inline JSX in NoteEditor | Separate `FormatToolbar.tsx` | No reuse elsewhere; no complex prop threading needed; extra file adds no value | R2, R3 |

---

## Risk & Stress-Test Scenarios

### Forward — runtime failure scenarios

| Scenario | How the design handles it |
|----------|--------------------------|
| `open::that()` fails — no `xdg-open` on minimal Linux | `open_url` returns `Err(String)` → `ipc.openUrl` rejects → NoteEditor catches → error message shown in confirmation dialog |
| Search query contains regex special chars (`C++`, `a.b`, `[bracket]`) | Query sanitised via `escapeRegex(q)` (replace `[\\^$.|?*+(){}]` with `\$&`) before `new RegExp` — prevents runtime error and false matches |
| Link popup: user submits empty URL | Inserts `[displayText]()` per REQ edge-case decision — visible, user can fix |
| History cap (200 entries) reached | Oldest entry shifted off array; `historyIndexRef` decremented by 1 to stay aligned |
| Ctrl+F while search already open | Handler checks `if (searchOpen) { searchInputRef.current?.focus(); return; }` — no second bar |
| Preview link `<a>` click — `e.target` is text child node, not `<a>` itself | Handler uses `(e.target as Element).closest('[data-url]')` — traverses up to `<a>` regardless of click target |

### Backward — regression risk per touched area

| Touched area | What could regress | Mitigation |
|-------------|-------------------|------------|
| `markdown.ts` — `renderMarkdown` output change | Existing notes with `[text](url)` previously showed plain text; now shows styled link. Any note with literal `[` and `]` patterns (non-link use) is unaffected — inline regex requires `](` to match. | Visual-only change; raw stored string unchanged. Manual spot-check of existing notes after deploy. |
| `markdown.ts` — `<p style="white-space:pre-wrap">` | Normal prose notes with single spaces: no visible change. Notes relying on `<p>` collapsing multiple spaces (unusual): will now show them. | Intentional fix; acceptable regression surface. |
| `EntryEditor.tsx` — `notes` state flow | If NoteEditor extraction accidentally wraps or transforms the string before calling `onChange`, saved notes could be corrupted. | `onChange` must be a pure pass-through — NoteEditor never transforms value before surfacing it. Encryption boundary is in Rust, unaffected. |

---

## Open Questions

- None — all decisions resolved.

## Out of Scope

- Underline formatting (not standard markdown; deferred from REQ)
- Find & Replace (deferred: scope)
- Toolbar button toggle / un-bold (requires markdown state parser; deferred)
- Syntax highlighting per language in code blocks (deferred)
- Spell check, export, print

---

# Tasks

## Task T1: Rust `open_url` Command

> **Status:** done
> **Effort:** xs
> **Priority:** high
> **Depends on:** None
> **Satisfies REQs:** R8, N3
> **Footprint slice:** Modified: `src-tauri/src/commands.rs` (add `validate_url` + `open_url`), `src-tauri/src/lib.rs` (register handler), `src-tauri/Cargo.toml` (add `open` crate)
> **High-risk areas touched:** `open` crate (M) — URL validation is the security boundary; `open::that()` must only fire after validation passes

### Description

Add the `open_url` Tauri command that validates a URL is `http://` or `https://` before opening it in the system browser via the `open` crate. This is the Rust-side security boundary for link opening; the frontend confirmation dialog is UX only. Extraction of `validate_url` as a separate pure function enables unit testing without spawning a real browser.

### Test Plan

#### Test File(s)
- `src-tauri/src/commands.rs` — inline `#[cfg(test)] mod tests` block (existing pattern)

#### Test Scenarios

##### URL Validation — rejection

- **rejects_file_url** — GIVEN url `"file:///etc/passwd"` WHEN `validate_url` called THEN returns `Err` whose message contains `"Only http"` _(A7, N3)_
- **rejects_javascript_url** — GIVEN url `"javascript:alert(1)"` WHEN `validate_url` called THEN returns `Err` _(A7)_
- **rejects_data_url** — GIVEN url `"data:text/html,<h1>x</h1>"` WHEN `validate_url` called THEN returns `Err` _(A7)_
- **rejects_bare_path** — GIVEN url `"/etc/passwd"` WHEN `validate_url` called THEN returns `Err` _(A7)_
- **rejects_empty_string** — GIVEN url `""` WHEN `validate_url` called THEN returns `Err` _(A7)_

##### URL Validation — acceptance

- **allows_http_url** — GIVEN url `"http://example.com"` WHEN `validate_url` called THEN returns `Ok(())` _(R8, N3)_
- **allows_https_url** — GIVEN url `"https://example.com"` WHEN `validate_url` called THEN returns `Ok(())` _(R8, N3)_

### Implementation Notes

- **Module:** `src-tauri/src/commands.rs`
- **Pattern reference:** all existing commands in `commands.rs` — same `pub fn`, `#[tauri::command]`, `Result<T, String>` return shape
- **Key decisions:** A2 (invoke-only IPC, no plugin), A7 (validation in Rust not frontend)
- **Libraries:** `open = "5"` added to `Cargo.toml`; call site is `open::that(&url).map_err(|e| e.to_string())`
- **High-risk callout:** `open` crate (M risk) — `open::that()` must only be called after `validate_url` returns `Ok`. Tests cover all rejection paths. The `Ok` path calls the real OS opener — not testable in unit tests; trust the `open` crate.
- **Implementation shape:**
  ```
  fn validate_url(url: &str) -> Result<(), String>  // pure, testable
  pub fn open_url(url: String) -> Result<(), String> // calls validate_url then open::that()
  ```
- Register `commands::open_url` in `lib.rs` `generate_handler![]` — follow the existing list format exactly

### Scope Boundaries

- Do NOT add any Tauri plugin or capability file entry — `open::that()` is a native Rust call, not a plugin permission
- Do NOT add URL-reachability checks or HEAD requests — validation is prefix-only
- Do NOT modify any existing command signatures
- Only implement the `open_url` command and its `validate_url` helper

### Files Expected

**New files:** _(none)_

**Modified files:**
- `src-tauri/Cargo.toml` (add `open = "5"` under `[dependencies]`)
- `src-tauri/src/commands.rs` (add `validate_url` fn + `open_url` command + tests)
- `src-tauri/src/lib.rs` (add `commands::open_url` to `generate_handler![]`)

**Must NOT modify:**
- `src-tauri/capabilities/default.json` (no capability change needed — not a plugin)
- Any existing command function

---

## Task T2: `markdown.ts` Upgrades

> **Status:** done
> **Effort:** s
> **Priority:** high
> **Depends on:** None
> **Satisfies REQs:** R7, R11, R12, R14, R16, N1, N3
> **Footprint slice:** Modified: `src/lib/markdown.ts` (3 targeted changes + new export). New: `src/lib/markdown.test.ts`, vitest devDep + test script
> **High-risk areas touched:** All existing notes (preview) (M) — `renderMarkdown` output changes for all saved notes; regression guards cover existing markdown elements

### Description

Apply three targeted fixes to `markdown.ts` and add a `highlightHtml` export for search highlighting. Changes: non-markdown `<p>` lines get `white-space:pre-wrap` (fixes ASCII art in preview), links render as `<a data-url>` with no `href` (enables safe clickable links), and `highlightHtml` post-processes rendered HTML to wrap query matches in `<mark>` tags without injecting into HTML attributes. Add vitest as a devDependency and write unit tests covering all changes plus regression guards for existing markdown behavior.

### Test Plan

#### Test File(s)
- `src/lib/markdown.test.ts` (new)

#### Setup Required
- `npm install --save-dev vitest` in `devvault/`
- Add `"test": "vitest run"` to `scripts` in `package.json`
- No vitest config file needed (zero-config with Vite project)

#### Test Scenarios

##### renderMarkdown — whitespace preservation

- **plain line gets pre-wrap style** — GIVEN `"hello   world"` WHEN `renderMarkdown` THEN output contains `style="white-space:pre-wrap"` _(R12)_
- **heading does NOT get pre-wrap** — GIVEN `"# Heading"` WHEN `renderMarkdown` THEN output does NOT contain `pre-wrap` _(R12 — per-line detection only)_
- **list item does NOT get pre-wrap** — GIVEN `"- item"` WHEN `renderMarkdown` THEN `<li>` present, output does NOT contain `pre-wrap` _(R12)_
- **code fence does NOT get pre-wrap** — GIVEN `"```\ncode\n```"` WHEN `renderMarkdown` THEN `<pre>` present, fence lines do NOT contain `pre-wrap` _(R12)_

##### renderMarkdown — link rendering

- **link renders with data-url, no href** — GIVEN `"[text](https://ex.com)"` WHEN `renderMarkdown` THEN output contains `data-url="https://ex.com"` AND does NOT contain `href=` _(R7, N3, A5)_
- **link display text correct** — GIVEN `"[click here](https://ex.com)"` WHEN `renderMarkdown` THEN output contains `>click here<` _(R7)_
- **link URL is HTML-escaped** — GIVEN `"[t](<script>alert(1)</script>)"` WHEN `renderMarkdown` THEN raw `<script>` tag NOT present in output _(security)_

##### highlightHtml — correctness

- **wraps text match in mark** — GIVEN html `"<p>hello world</p>"`, query `"hello"` WHEN `highlightHtml` THEN output contains `<mark` and `>hello</mark>` _(R14)_
- **skips tag attribute content** — GIVEN html `'<a data-url="hello">link</a>'`, query `"hello"` WHEN `highlightHtml` THEN `"hello"` inside `data-url` attribute NOT wrapped in mark _(security, A5)_
- **case-insensitive matching** — GIVEN html `"<p>Hello World</p>"`, query `"hello"` WHEN `highlightHtml` THEN `"Hello"` wrapped in mark _(R16)_
- **multiple occurrences all wrapped** — GIVEN html `"<p>foo bar foo</p>"`, query `"foo"` WHEN `highlightHtml` THEN both occurrences wrapped _(R14)_
- **empty query no-op** — GIVEN any html, query `""` WHEN `highlightHtml` THEN output contains no `<mark>` tags _(edge case)_

##### highlightHtml — resilience

- **handles regex special chars in query** — GIVEN html `"<p>C++ code</p>"`, query `"C++"` WHEN `highlightHtml` THEN does NOT throw; `"C++"` wrapped in mark _(ARCH forward stress-test: escapeRegex)_
- **handles bracket chars in query** — GIVEN html `"<p>[note]</p>"`, query `"[note]"` WHEN `highlightHtml` THEN does NOT throw; match wrapped _(ARCH forward stress-test)_

##### Regression guards

- **bold still renders** — GIVEN `"**bold**"` WHEN `renderMarkdown` THEN output contains `<strong>bold</strong>` _(guards markdown.ts backward-regression)_
- **italic still renders** — GIVEN `"*italic*"` WHEN `renderMarkdown` THEN output contains `<em>italic</em>` _(guards backward-regression)_
- **inline code still renders** — GIVEN `` "`code`" `` WHEN `renderMarkdown` THEN output contains `<code` _(guards backward-regression)_
- **renderMarkdown signature unchanged** — `renderMarkdown` takes one `string` arg and returns `string` — TypeScript compiler enforces this _(N1)_

### Implementation Notes

- **Module:** `src/lib/markdown.ts` — pure functions, no imports, no browser APIs
- **Pattern reference:** existing `inline()` function in `markdown.ts` for the link regex change; existing `escapeHtml()` for the XSS safety pattern
- **Key decisions:** A8 (`white-space:pre-wrap` on non-markdown `<p>` only), A5 (`data-url` not `href`), ARCH `highlightHtml` algorithm (split on `/<[^>]*>/` — alternates tag/text tokens)
- **Libraries:** vitest only (devDep for tests)
- **High-risk callout:** All existing notes (M risk) — `renderMarkdown` changes affect every note preview. Regression guard tests cover bold, italic, inline code. The `pre-wrap` and link changes are intentional visual-only changes; raw stored strings are unaffected.
- **`highlightHtml` algorithm:**
  ```
  1. escapeRegex(query) — escape all regex special chars before building RegExp
  2. Split html on /(<[^>]*>)/g — produces alternating [text, tag, text, tag, ...] tokens
  3. For tag tokens: pass through unchanged
  4. For text tokens: replace(escapedQueryRegex with 'gi' flag, '<mark class="bg-yellow-400/40 text-inherit">$&</mark>')
  5. Rejoin all tokens
  ```
- **`escapeRegex` helper** (add as unexported function in `markdown.ts`):
  ```
  function escapeRegex(s: string): string {
    return s.replace(/[\\^$.|?*+(){}[\]]/g, '\\$&');
  }
  ```

### Scope Boundaries

- Do NOT modify `renderMarkdown`'s function signature — still `(src: string) => string`
- Do NOT add `href` attributes to link anchors — `data-url` only (N3, A5)
- Do NOT apply `white-space:pre-wrap` globally — only to non-markdown `<p>` lines (A8)
- Do NOT implement syntax highlighting per language in code blocks (Out of Scope)
- Only modify `markdown.ts`; do not touch any component files

### Files Expected

**New files:**
- `src/lib/markdown.test.ts` (vitest unit tests for all changes + regression guards)

**Modified files:**
- `src/lib/markdown.ts` (3 changes: `<p>` pre-wrap, link `<a data-url>`, export `highlightHtml`)
- `package.json` (add `vitest` devDep + `"test"` script)

**Must NOT modify:**
- `src/components/EntryEditor.tsx` (silent-regression hotspot — `renderMarkdown` is called here; behavior covered by regression guards but file not touched in this task)
- Any component file

---

## Task T3: NoteEditor Component + EntryEditor Wiring

> **Status:** done
> **Effort:** l
> **Priority:** high
> **Depends on:** T1, T2
> **Satisfies REQs:** R1–R6, R9–R11, R13–R17, N1, N2
> **Footprint slice:** New: `src/components/NoteEditor.tsx`. Modified: `src/components/EntryEditor.tsx` (replace Notes block), `src/lib/ipc.ts` (add `openUrl`)
> **High-risk areas touched:** All existing notes / EntryEditor layout (M) — `renderMarkdown` output already changed by T2; this task wires it into the component. `EntryEditor.tsx` notes state + save() flow must not be touched.

### Description

Create `NoteEditor.tsx` as a self-contained controlled component (`value` / `onChange` props) that owns all notes UI: auto-grow textarea, formatting toolbar (7 buttons), link popup, link-open confirmation dialog, in-note search bar (Ctrl+F), and custom undo/redo stack (Ctrl+Z / Ctrl+Y). Replace the existing Notes JSX block in `EntryEditor.tsx` (lines 197–222) with `<NoteEditor value={notes} onChange={setNotes} />`. Add `openUrl` to `ipc.ts`. Verification is manual against the REQ acceptance checklist below.

### Test Plan

#### Test File(s)
- No automated test file — manual acceptance checklist run against the live app (`npm run tauri dev`)

#### Acceptance Checklist

Run `npm run tauri dev` from `devvault/`. Create or open an entry and navigate to the Notes field for all checks.

##### Spacious textarea (R1)
- [ ] Empty note: textarea min-height is visibly at least 16 rows
- [ ] Adding lines: textarea grows; never clips content without scrollbar

##### Toolbar visibility (R2)
- [ ] Toolbar row visible above textarea in Edit mode
- [ ] Toolbar row hidden when Preview mode is active

##### Toolbar buttons present (R3)
- [ ] All 7 buttons present: **B** (Bold), _I_ (Italic), `•` (Bullet), `1.` (Numbered), `` ` `` (Inline code), ` ``` ` (Fenced code), `🔗` (Link)

##### Toolbar insertion — cursor and selection (R4, R5)
- [ ] **Bold — selection:** select "hello", click Bold → `**hello**` in textarea
- [ ] **Bold — no selection:** click Bold → `****` inserted, cursor between the markers
- [ ] **Italic:** same pattern with `*`
- [ ] **Inline code:** same pattern with single backtick
- [ ] **Fenced code:** inserts triple-backtick block on its own lines regardless of cursor position
- [ ] **Bullet:** prefixes current line with `- `; multi-line selection prefixes each line
- [ ] **Numbered:** prefixes current line with `1. `

##### Link popup (R6)
- [ ] Click Link with text selected → popup opens; URL input present; display text pre-filled
- [ ] Click Link with no selection → popup opens; URL input present
- [ ] Enter URL and confirm → `[displayText](url)` inserted at cursor
- [ ] Cancel → nothing inserted, popup closes
- [ ] Submit empty URL → `[displayText]()` inserted (visible placeholder)

##### Link in preview (R7, R8)
- [ ] Switch to Preview → link renders as sky-coloured underlined text
- [ ] Click link in Preview → confirmation dialog appears showing the URL
- [ ] Confirm → system browser opens (or error message shown if browser unavailable)
- [ ] Cancel in dialog → nothing happens, dialog closes

##### Undo / Redo (R9, R10)
- [ ] Type several words, Ctrl+Z → each undo removes last pushed state
- [ ] Insert Bold via toolbar, Ctrl+Z → `**` syntax removed
- [ ] Ctrl+Z then Ctrl+Y → state restored

##### No-wrap + horizontal scroll (R11)
- [ ] Paste a 120+ character single line → line stays on one line in textarea
- [ ] Horizontal scrollbar appears when content exceeds textarea width

##### ASCII / terminal content in preview (R12)
- [ ] Paste ASCII table (box-drawing or space-aligned) in Edit mode
- [ ] Switch to Preview → column alignment preserved (no collapsed spaces)

##### In-note search — Edit mode (R13–R16)
- [ ] Ctrl+F → search bar appears below toolbar
- [ ] Type query → "X of N" counter shown; current match is selected (browser highlight) in textarea
- [ ] Enter → next match selected
- [ ] Shift+Enter → previous match selected
- [ ] Search `"TABLE"` finds `"table"` in content (case-insensitive)
- [ ] Ctrl+F while search bar open → focuses search input, no second bar appears

##### In-note search — Preview mode (R13–R16)
- [ ] Switch to Preview, Ctrl+F → search bar appears
- [ ] Type query → all occurrences highlighted with yellow mark
- [ ] Enter → scrolls to next mark
- [ ] Search `"TABLE"` finds `"table"` (case-insensitive)

##### Search close (R17)
- [ ] Escape closes search bar
- [ ] Highlights cleared after close

##### Edge cases
- [ ] Click Bold twice on same selection → `****selection****` (double-wrap, no toggle — per REQ decision)
- [ ] Link popup: Escape dismisses without inserting
- [ ] Search with regex-special query (`C++`, `[bracket]`) → no crash, correct matches found

##### Regression guards (N1, backward-regression)
- [ ] Open existing entry that has notes with bold/italic/headers → Preview renders correctly, no corruption
- [ ] Edit existing note, Save → reopen entry → content string identical (ipc.ts pass-through intact)
- [ ] EntryEditor Cancel button still dismisses modal
- [ ] EntryEditor Save button still persists entry
- [ ] Entry with no notes still saves and reopens cleanly
- [ ] Existing note with `[text](url)` now shows styled link in Preview (intentional visual change — verify the raw stored string is unchanged)

### Implementation Notes

- **Module:** `src/components/NoteEditor.tsx` — follows `src/components/FieldRow.tsx` for controlled prop pattern
- **Pattern reference:** `FieldRow.tsx` (value/onChange props); `EntryEditor.tsx` SIZE_CLASS pattern for full-literal Tailwind classes; existing `showPreview` toggle logic in `EntryEditor.tsx` (moving into NoteEditor)
- **Key decisions:** A1 (extract component), A3 (custom `useRef` history stack), A4 (`scrollHeight` auto-grow), A5 (`data-url` event delegation), A6 (select-current in edit; `<mark>` all in preview), A9 (toolbar inline JSX)
- **Libraries:** `renderMarkdown` + `highlightHtml` from `src/lib/markdown.ts` (T2); `openUrl` from `src/lib/ipc.ts`
- **History stack mechanics:**
  - `historyRef: useRef<string[]>([])` + `historyIndexRef: useRef<number>(-1)`
  - On mount: push initial `value`, set index to 0
  - On `onChange`: if new value !== `history[index]`, truncate entries after index, push, advance index. Cap at 200: shift oldest, decrement index.
  - Ctrl+Z `keydown`: `preventDefault`, index--, call `onChange(history[index])` (floor 0)
  - Ctrl+Y `keydown`: `preventDefault`, index++, call `onChange(history[index])` (ceil length-1)
- **Auto-grow:** `useEffect` on `value` → `el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'`. Min-height via Tailwind class `min-h-64` (≈16rem).
- **No-wrap:** textarea class includes `whitespace-nowrap overflow-x-auto` (full literal strings per Tailwind JIT rule)
- **Toolbar insertion helper** (pure function, defined in NoteEditor):
  ```
  insertSyntax(textarea, prefix, suffix, newlineMode?)
    → reads selectionStart/selectionEnd
    → builds newValue
    → calls onChange(newValue)
    → schedules setSelectionRange via useEffect ref
  ```
- **Link popup:** small absolutely-positioned `<div>` rendered near toolbar; saved selection stored in `savedSelectionRef` before popup opens so it can be restored on cancel
- **Confirmation dialog:** React state `confirmUrl: string | null`; renders modal overlay when non-null; on confirm calls `openUrl(confirmUrl).catch(err => setConfirmError(err))`
- **Search — edit mode:** `escapeRegex(query)` → `new RegExp(escapedQuery, 'gi')` → collect all `{start, end}` matches from `value` → `setSearchMatches` + `setSearchIndex(0)` → `textarea.setSelectionRange(match.start, match.end)` + `textarea.focus()`
- **Search — preview mode:** `highlightHtml(renderMarkdown(value), query)` → `dangerouslySetInnerHTML`; `previewRef.current.querySelectorAll('mark')[searchIndex]?.scrollIntoView({block:'nearest'})`
- **Event delegation for link clicks:** `onClick` on preview container div → `(e.target as Element).closest('[data-url]')` → `setConfirmUrl(url)`
- **High-risk callout:** `EntryEditor.tsx` notes state + save() (M) — `onChange={setNotes}` must be a pure pass-through; NoteEditor must NEVER transform the value string before surfacing it. The `notes` string flows directly to `createEntry`/`updateEntry` unchanged.

### Scope Boundaries

- Do NOT add `href` attributes to links anywhere — `data-url` + confirmation only (N3)
- Do NOT implement underline formatting (Out of Scope)
- Do NOT implement find-and-replace (Out of Scope)
- Do NOT implement toolbar toggle (un-bold, Out of Scope)
- Do NOT import anything from `ipc.ts` other than `openUrl` into NoteEditor
- Do NOT touch `notes` state declaration or `save()` function in `EntryEditor.tsx`
- Do NOT add spell check, export, or print features
- Only remove the Notes JSX block (lines 197–222), `showPreview` state, and `renderMarkdown` import from `EntryEditor.tsx` — nothing else

### Files Expected

**New files:**
- `src/components/NoteEditor.tsx` (full notes editor; mirrors `FieldRow.tsx` prop pattern)

**Modified files:**
- `src/components/EntryEditor.tsx` (replace Notes block lines 197–222 with `<NoteEditor value={notes} onChange={setNotes} />`; remove `showPreview` state; remove `renderMarkdown` import)
- `src/lib/ipc.ts` (add `openUrl(url: string): Promise<void>` at end of file)

**Must NOT modify:**
- `src/lib/markdown.ts` (owned by T2 — already updated)
- `src-tauri/src/commands.rs` (owned by T1 — already updated)
- `src/components/EntryEditor.tsx` — `notes` state, `save()`, `createEntry`/`updateEntry` calls (silent-regression hotspot — covered by regression guards in checklist)

### TDD Sequence

Implement in this order to keep each step runnable:

1. `ipc.ts` — add `openUrl` (one line; unblocks NoteEditor compile)
2. `NoteEditor.tsx` skeleton — props + auto-grow textarea + Edit/Preview toggle (replaces existing block; app runs)
3. Formatting toolbar — all 7 buttons + `insertSyntax` helper
4. Link popup + confirmation dialog + `openUrl` call
5. Undo/redo history stack (Ctrl+Z / Ctrl+Y)
6. In-note search bar — edit mode (Ctrl+F + setSelectionRange)
7. In-note search bar — preview mode (`highlightHtml` + scrollIntoView)
8. Run full acceptance checklist
