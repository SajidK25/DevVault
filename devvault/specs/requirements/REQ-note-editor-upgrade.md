# Requirements: Note Editor Upgrade

> **Date:** 2026-06-26
> **Type:** feature
> **Source:** devvault/docs/brief_1.md
> **Phase:** 1 of 5 (Requirement Engineering)

## Summary

Upgrade the Notes section of the entry editor from a minimal textarea into a capable plain-text editor with a markdown formatting toolbar, in-note search, proper monospace layout for terminal-pasted content, and undo/redo support. The editor stays markdown-based (raw syntax in edit, rendered in preview); no WYSIWYG engine is introduced.

## Problem & Motivation

The current Notes field is a small 6-row textarea with no formatting assistance and no way to preserve ASCII tables or terminal-copied art. Users who paste box-drawing characters, aligned columns, or multi-line terminal output see their content scrambled in both edit and preview modes. The lack of a formatting toolbar forces users to remember markdown syntax, and there is no in-editor search.

## Users & Consumers

- **Solo developer (app owner)** — pastes terminal output, writes structured notes, needs formatting shortcuts and reliable content fidelity.

## Functional Requirements

| ID  | Requirement | Acceptance Criterion |
|-----|-------------|----------------------|
| R1  | Notes textarea auto-grows with content and has a larger minimum height | Textarea height increases as lines are added; minimum visible height is at least 16 rows; never clips content without scroll |
| R2  | Formatting toolbar appears above the textarea in Edit mode | Toolbar is visible when Edit mode is active; hidden in Preview mode |
| R3  | Toolbar buttons: Bold, Italic, Bullet list, Numbered list, Inline code, Fenced code block, Link | All 7 buttons present and labelled/iconised |
| R4  | Each toolbar button inserts the correct markdown syntax at the cursor position | Clicking Bold with no selection inserts `****` and places cursor between; clicking Bold with selected text wraps it as `**selected**` |
| R5  | Italic, Bullet, Numbered, Inline code, Fenced code buttons follow the same cursor/wrap behaviour as R4 | Each button inserts correct syntax; wraps selection when text is selected |
| R6  | Link button opens a small inline popup to collect URL, then inserts `[text](url)` | Popup appears on click; accepts URL input; on confirm inserts `[cursor text](entered-url)`; on cancel inserts nothing |
| R7  | In Preview mode, links render as visually distinct (colour/underline) text | Links are visually distinguishable from plain text in rendered output |
| R8  | Clicking a link in Preview mode shows a confirmation dialog before opening the system browser | Dialog states the URL and asks user to confirm; on confirm, URL opens in default system browser; on cancel, nothing happens |
| R9  | Ctrl+Z undoes the last change (typed text or toolbar-inserted syntax) | Pressing Ctrl+Z step-by-step reverses changes in order |
| R10 | Ctrl+Y redoes a previously undone change | Pressing Ctrl+Y after Ctrl+Z restores the undone change |
| R11 | In Edit mode, the textarea never soft-wraps long lines; horizontal scroll used instead | A 120-character ASCII table pasted into the editor remains on one line; horizontal scrollbar appears if content exceeds textarea width |
| R12 | In Preview mode, lines that are not markdown elements (headings, lists, code fences) preserve their original whitespace | A pasted ASCII table or box-drawing art displayed in Preview looks identical in spacing to what was typed in Edit mode |
| R13 | Ctrl+F opens an in-note search bar in both Edit and Preview modes | Pressing Ctrl+F in either mode reveals a search input overlaid on or docked within the Notes area |
| R14 | Search bar highlights all matches in the visible content | All occurrences of the search term are visually highlighted simultaneously |
| R15 | Enter / Shift+Enter cycles forward/backward through matches | Each Enter press moves focus to the next match; Shift+Enter moves to previous |
| R16 | Search is case-insensitive by default | Searching "Table" matches "table", "TABLE", "Table" |
| R17 | Escape or clicking outside the search bar closes it and clears highlights | Highlights disappear; editor returns to normal state |

## Non-Functional Requirements

| ID  | Requirement | Acceptance Criterion |
|-----|-------------|----------------------|
| N1  | Toolbar actions must not break existing saved notes | Opening any previously saved note shows content unchanged after this upgrade |
| N2  | No external rich-text or editor library introduced | Package.json gains no new editor framework dependency (toolbar built with native DOM/React only) |
| N3  | Link-open goes through Tauri shell API, not a web `<a>` tag with target=_blank | No raw anchor navigation; Tauri `open()` or equivalent Rust command is used |

## Behaviors & Domain Rules

**Toolbar insertion rules:**
- If text is selected when a button is clicked, the selection is wrapped with the syntax (e.g., `**selection**`).
- If no text is selected, the syntax scaffold is inserted at the cursor and the cursor is placed at the content position (inside the markers).
- Fenced code block button inserts a triple-backtick block on its own lines, regardless of cursor position inline.
- Bullet and Numbered buttons prefix the current line (or each selected line) with `- ` / `1. ` respectively.

**Link popup rules:**
- Popup appears anchored near the toolbar link button.
- If text was selected before clicking Link, that text becomes the display text; user only needs to enter the URL.
- If no selection, user enters URL; display text defaults to the URL itself.
- Popup dismisses on Escape or click-outside with no insertion.

**ASCII / terminal content rules:**
- Edit mode: horizontal scroll preserves layout; no word-wrap.
- Preview mode: content lines that don't match a markdown pattern (heading `#`, list `-`/`*`/`1.`, code fence ` ``` `) are rendered with whitespace preserved (equivalent to `white-space: pre-wrap`). This means ASCII tables/art paste-and-preview without code fences.
- Content inside code fences is already rendered in `<pre>` — this behaviour is unchanged.

**Search rules:**
- Search operates on visible text only (rendered text in Preview, raw text in Edit).
- No replace functionality.
- Match count indicator ("3 of 12") displayed in the search bar.

**Why these rules matter:**
- No-wrap in textarea: box-drawing chars are fixed-width; soft-wrap destroys column alignment.
- Whitespace preservation in preview: wrapping non-code lines in `<p>` collapses consecutive spaces — the root cause of ASCII art breaking.
- Confirmation before opening links: this is an offline credential vault; unexpected outbound URL opens are a security/privacy concern.

**Common mistakes (first-attempt pitfalls):**
- Using `<a href target="_blank">` for links — this bypasses Tauri's shell API and may not work in WebView.
- Applying `white-space: pre` globally in preview — breaks normal paragraph reflowing; only non-markdown lines need it.
- Relying on `textarea` native undo for Ctrl+Y redo — browsers map Ctrl+Y to page history forward, not text redo; needs explicit interception.

## Edge Cases & Failure Modes

| Scenario | Decision | Rationale |
|----------|----------|-----------|
| User clicks Bold twice on same selection | Second click wraps again (adds extra `**`) — no toggle in this version | Toggling requires parsing markdown state; out of scope for this sprint |
| Link popup submitted with empty URL | Insert `[text]()` — visually distinct, user can fix manually | No silent rejection; user sees exactly what was inserted |
| Link URL is malformed (no protocol) | Warn in confirmation dialog; still allow open | User may know what they're doing; don't block, just surface |
| Pasted content mixes markdown and ASCII art on adjacent lines | Markdown lines render as markdown; non-markdown lines preserve whitespace | Per-line detection is the safest approach without full parser |
| Ctrl+F while search bar is already open | Focuses the search input (no second bar) | Standard browser Ctrl+F behaviour |
| Note content is empty, user presses toolbar button | Inserts scaffold at start of empty textarea | No error; sensible default |
| Very long note (1000+ lines) — search performance | Highlight all matches synchronously; no lazy loading | Notes are local text; performance concern arises only at extreme size outside normal use |

## Decisions Log

| # | Decision | Alternatives Considered | Chosen Because |
|---|----------|------------------------|----------------|
| 1 | Toolbar-over-markdown (insert syntax) not WYSIWYG | WYSIWYG (TipTap, Quill) | Keeps existing markdown storage format; no new heavy dependency; user familiar with markdown |
| 2 | Underline dropped | Keep as `<u>` HTML | Not standard markdown; inconsistent in raw text; no clear user need stated |
| 3 | Ctrl+Y for redo | Ctrl+Shift+Z | User's explicit preference |
| 4 | Per-line whitespace detection in preview | Wrap everything in pre; require explicit code fence for ASCII art | Per-line preserves markdown rendering for headings/lists while fixing paste-without-friction for ASCII content |
| 5 | Link confirmation dialog before open | Open directly; block links entirely | Offline vault — unexpected outbound connections are a security/privacy concern; confirmation adds minimal friction |
| 6 | Search find-only (no replace) | Find + replace | Keeps scope sprint-sized; replace adds significant UI/logic complexity |

## Scope Boundaries

### In Scope
- Auto-growing textarea with larger minimum height
- 7-button markdown formatting toolbar (Bold, Italic, Bullet, Numbered, Inline code, Fenced code, Link)
- Link insertion popup with URL input
- Clickable links in Preview with confirmation dialog → system browser
- Ctrl+Z undo, Ctrl+Y redo
- No word-wrap + horizontal scroll in Edit mode
- Whitespace-preserving rendering for non-markdown lines in Preview
- Ctrl+F in-note search (find, highlight, cycle) in both Edit and Preview modes

### Out of Scope
- Underline formatting (deferred: not standard markdown)
- Find & Replace (deferred: scope)
- Toolbar button toggle (e.g., click Bold again to un-bold — deferred: requires markdown state parsing)
- Spell check or grammar tools
- Export / print note
- Syntax highlighting per programming language in code blocks

## Open Questions

- None — all decisions resolved in interview.

---
_This requirements document is the input for the **plan-architecture** skill._
_Next step: `/plan-architecture from: specs/requirements/REQ-note-editor-upgrade.md`_
