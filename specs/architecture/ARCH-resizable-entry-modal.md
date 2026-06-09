# Architecture: Resizable New/Edit Entry Modal

> **Date:** 2026-06-09
> **Phase:** 2 of 5 (System Architecture)
> **Requirements source:** Standalone brief — see Inferred Requirements
> **Type:** feature

## Architecture Summary

The New/Edit Entry modal (`EntryEditor.tsx`) is locked at `max-w-2xl`, which clips wide note/preview content. This change adds a size toggle in the modal header that cycles the modal through three preset sizes — **Normal → Large → Fullscreen** — by swapping the form's width/height utility classes from a static lookup map. Size is component-local state that resets to Normal each time the modal opens (the modal unmounts on close). No persistence, no free-form drag, no IPC/Rust changes — purely a frontend, single-file change relying on the modal's existing inner `overflow-y-auto` to scroll any remaining overflow.

## Inferred Requirements

| ID  | Inferred Requirement                                                                 | Source                          |
|-----|--------------------------------------------------------------------------------------|---------------------------------|
| R1  | User can enlarge the New/Edit Entry modal so wide note/preview content isn't clipped. | Brief                           |
| R2  | Enlarging exposes more room; existing inner scroll handles any leftover overflow.     | Brief ("won't cut off view")    |
| R3  | Size control is discoverable from within the modal (header).                          | Inferred                        |
| R4  | Size need not persist across opens — defaults back to Normal each open.               | Decision (this session)         |

## High-Level Structure

Single React component, no new modules. A `size` state drives a class lookup applied to the existing `<form>`.

```
ProjectView
  └─ {editing && <EntryEditor/>}        // conditional → unmounts on close
        form  className = base + SIZE_CLASS[size]
        header
          ├─ <h2> New entry / Edit entry
          ├─ [⤢] expand   ── steps up: normal → large → full   (hidden/disabled at full)
          ├─ [⤡] restore  ── steps down to normal              (hidden/disabled at normal)
          └─ [✕] close

   size: 'normal' | 'large' | 'full'   (useState, default 'normal')
   SIZE_CLASS = {
     normal: 'max-w-2xl  max-h-full',
     large:  'max-w-5xl  max-h-full',
     full:   'max-w-none w-full h-full',
   }
```

Data flow: click toggle → `setSize(next(size))` → form re-renders with new max-width/height classes → browser reflows; inner `overflow-y-auto` panel keeps scrolling as today.

## Tech Choices

| Area        | Decision                                  | Alternatives Considered                          | Rationale                                                                 |
|-------------|-------------------------------------------|--------------------------------------------------|---------------------------------------------------------------------------|
| Resize UX   | 3 preset sizes via header toggle          | Native CSS `resize:both`; custom drag handle      | No drag ergonomics to tune; deterministic sizes; least code               |
| Sizing impl | Static Tailwind class lookup map          | Inline styles; CSS custom props                   | Matches existing Tailwind-only styling; no new CSS file                   |
| Persistence | None — resets to Normal each open          | localStorage (à la `useTheme.ts`)                 | Modal unmounts on close → default state is free; user chose no-persist    |
| Content fit | Resize only; rely on existing outer scroll | Make textarea/preview `flex-1` to fill height     | Smaller change; outer `overflow-y-auto` already prevents true clipping     |

## Patterns & Conventions

- **Tailwind-only styling** — from existing code; all sizing via utility classes, no `index.css` additions.
- **Static class strings (JIT gotcha)** — class names live as complete literal strings in `SIZE_CLASS`; never string-concatenated, or Tailwind's JIT scanner won't emit `max-w-5xl` / `max-w-none`.
- **Local UI state** — `useState` in the component, same as existing `showPreview` / `busy` flags. No store, no context.

## Data Models

None. No schema, no persisted data, no entity changes.

## API Contracts / Interfaces

None. No IPC commands, no Rust, no `lib/ipc.ts` change. `EntryEditor` props (`projectId`, `entryId`, `onClose`, `onSaved`) are unchanged.

## Module Boundaries

| Module / Package                 | Responsibility                          | Allowed Dependencies   |
|----------------------------------|-----------------------------------------|------------------------|
| `components/EntryEditor.tsx`     | Modal render + new size toggle state    | React, existing imports |

Boundary unchanged — change is fully contained in the component.

## Change Footprint

### New files / modules

_None._

### Modified files / modules

| Path                                  | What changes here                                                                                                  |
|---------------------------------------|--------------------------------------------------------------------------------------------------------------------|
| `devvault/src/components/EntryEditor.tsx` | Add `size` state + `SIZE_CLASS` lookup; apply class to `<form>` (replace literal `max-w-2xl`); add ⤢ toggle button in header next to ✕ |

### Deleted / replaced

_None._ (The literal `max-w-2xl max-h-full` on the form is replaced by `SIZE_CLASS[size]`.)

### Touched but not changed (silent-regression hotspots)

| Path                                  | Why it matters                                                                            |
|---------------------------------------|-------------------------------------------------------------------------------------------|
| `devvault/src/components/ProjectView.tsx` | Renders `<EntryEditor>`; relies on its unmount-on-close to reset size. No code change, but the "reset each open" guarantee depends on this conditional mount staying conditional. |
| `devvault/tailwind.config.js`         | Must keep scanning `components/**`; the new literal classes only emit if the content glob covers this file (it already does). |

## Areas of Impact

| Area                       | Impact                                    | Risk (L/M/H) | Why                                                  |
|----------------------------|-------------------------------------------|--------------|------------------------------------------------------|
| Entry create/edit flow     | Modal gains a size toggle; default look unchanged at Normal | L            | Additive; default size identical to today            |
| Other modals (Search/Backups) | None                                   | L            | Not touched; no shared sizing code                   |
| Tailwind build             | Three width/height classes must emit      | L            | All are stock classes; literal strings → JIT-safe    |

**Contract changes:** none — no public/IPC/type contract shifts.

**Cross-cutting ripples:** none — no auth, telemetry, migrations, or build-config changes. Security invariants (Rust-side crypto, encryption boundary) are untouched.

## Cross-Cutting Concerns

- **Errors:** unaffected; existing `error` state and save flow unchanged.
- **Logging & metrics:** none.
- **Auth / authz:** none; modal only renders for an unlocked vault as today.
- **Performance:** negligible — one extra `useState`, class swap on click; no re-fetch, no decryption re-run.
- **Security:** no change to encryption boundary or what's rendered; `renderMarkdown` preview path untouched.
- **Migrations / rollout:** none; ships as a normal frontend build.

## Architecture Decisions Log

| #   | Decision                                   | Alternatives                              | Chosen Because                                              | Satisfies REQs |
|-----|--------------------------------------------|-------------------------------------------|-------------------------------------------------------------|----------------|
| A1  | Preset sizes (Normal/Large/Fullscreen) via two header controls — expand (⤢) / restore (⤡) | Native CSS resize; custom drag handle; single cycling button | Deterministic, least code; explicit expand/restore is clearer than a blind cycle, restore is one click from any size | R1, R3         |
| A2  | No persistence; reset to Normal each open  | localStorage like `useTheme.ts`            | Modal unmounts on close → default is free; user chose this  | R4             |
| A3  | Resize only; rely on existing outer scroll | Make notes textarea/preview `flex-1`       | Smaller change; `overflow-y-auto` already prevents clipping | R2             |
| A4  | Static Tailwind class lookup map           | Inline styles; CSS vars                    | Consistent with codebase; JIT-safe with literal strings     | R1             |

## Risk & Stress-Test Scenarios

### Forward — runtime failure scenarios

| Scenario                                          | How the Design Handles It                                                                 |
|---------------------------------------------------|-------------------------------------------------------------------------------------------|
| User opens modal at Fullscreen, closes, reopens   | Component unmounts on close (`{editing && …}`) → `size` resets to `'normal'`. Verified intent. |
| Fullscreen modal on a very small window           | Wrapper keeps `p-6`; `w-full h-full` + `max-h-full` clamp to viewport minus padding; inner `overflow-y-auto` scrolls. No overflow off-screen. |
| Tailwind purges the new size classes              | Mitigated by A4 — classes written as full literals in `SIZE_CLASS`, scannable by JIT. Verify in `npm run build` output. |
| Long note/preview still taller than Fullscreen    | Existing inner `overflow-y-auto` panel scrolls — same mechanism as today, just more room first. |

### Backward — regression risk per touched area

| Touched area (from Change Footprint)  | What could regress                                  | How we'd know / mitigation                                |
|---------------------------------------|-----------------------------------------------------|-----------------------------------------------------------|
| `EntryEditor.tsx` form className       | Default modal size/look changes unintentionally     | Normal preset = exact current classes (`max-w-2xl max-h-full`); visual diff at Normal should be nil |
| `ProjectView.tsx` (mount)              | If render becomes non-conditional later, size stops resetting | Documented dependency; not changed in this work          |
| Tailwind build                         | Missing class → modal doesn't grow                  | `npm run build` + manual toggle through all three sizes   |

## Open Questions

- ~~Should the toggle be a 3-state cycle (one ⤢ button) or two controls (expand / restore)?~~ **Resolved:** two controls — an **expand** button (steps up Normal → Large → Full) and a **restore** button (steps down / back to Normal). Clearer affordance than a blind cycle; restore is one click from any size.

## Out of Scope

- Free-form drag-resize and persisted size (deferred — preset toggle covers the cutoff complaint).
- Making the notes textarea/preview grow to fill height (A3 — separate enhancement if presets prove insufficient).
- Resizing other modals (Search, Backups) — not requested.

---

# Tasks

## Task T1: Resizable entry modal via expand/restore presets

> **Status:** not started
> **Effort:** s
> **Priority:** medium
> **Depends on:** None
> **Satisfies REQs:** R1, R2, R3, R4
> **Footprint slice:** Modified — `devvault/src/components/EntryEditor.tsx` (add `size` state, `SIZE_CLASS` lookup map, expand/restore header buttons). Must-not-modify — `devvault/src/components/ProjectView.tsx`, `devvault/tailwind.config.js`.
> **High-risk areas touched:** None (all Areas of Impact rated L).

### Description

The New/Edit Entry modal is locked at `max-w-2xl`, clipping wide note/preview content. This task adds three preset sizes — Normal → Large → Fullscreen — driven by local `size` state and applied to the existing `<form>` via a static Tailwind class lookup. Two header controls drive it: an **expand (⤢)** button steps up, a **restore (⤡)** button steps back to Normal. Size resets to Normal on every open (the modal unmounts on close). Frontend-only, single file, no IPC/Rust/schema changes.

### Test Plan

> No frontend test runner exists (no vitest/jest/testing-library) and none is added (decision, 2026-06-09). Verification = `npm run build` typecheck + manual checks in the running app (`cd devvault && npm run tauri dev`). The scenarios below are a manual verification checklist, not automated tests.

#### Test File(s)
- None. Verified via build + manual app interaction.

#### Test Scenarios

##### Build / Typecheck
- **typechecks clean** — GIVEN the `size` state typed `'normal' | 'large' | 'full'` and `SIZE_CLASS` keyed by that union WHEN `npm run build` runs THEN `tsc` passes with no errors _(verifies R1)_

##### Sizing Behavior
- **opens at Normal** — GIVEN a fresh New/Edit Entry open WHEN the modal renders THEN the form is at Normal (`max-w-2xl max-h-full`), visually identical to the pre-change modal _(verifies R3; guards backward-regression on default look)_
- **expand steps up** — GIVEN modal at Normal WHEN ⤢ clicked once THEN Large (`max-w-5xl`); WHEN clicked again THEN Fullscreen (`max-w-none w-full h-full`, fills viewport minus wrapper padding) _(verifies R1)_
- **restore steps back** — GIVEN modal at Large or Full WHEN ⤡ clicked THEN modal returns to Normal _(verifies R1)_
- **control affordance at bounds** — GIVEN modal at Full THEN ⤢ is hidden/disabled; GIVEN modal at Normal THEN ⤡ is hidden/disabled _(verifies R3)_

##### Content Not Cut Off
- **long note not clipped** — GIVEN a long note (many lines + a wide fenced code block) WHEN viewed at Normal THEN the inner panel scrolls via existing `overflow-y-auto` (nothing clipped off-screen); WHEN enlarged to Large/Full THEN more content is visible with less wrapping _(verifies R1, R2)_
- **preview not clipped** — GIVEN the same long note WHEN Preview is toggled at each size THEN rendered markdown is fully reachable (outer scroll handles overflow) _(verifies R2)_

##### Regression Guard
- **Normal preset unchanged** — GIVEN modal at Normal THEN it pixel-matches the current modal — `SIZE_CLASS.normal` equals the existing `max-w-2xl max-h-full` _(guards backward-regression for `EntryEditor.tsx` form className)_
- **modal functions intact** — GIVEN any size WHEN using Save / Cancel / ✕, adding/removing fields, and the Decrypting… load state THEN all behave as before (size state is independent) _(guards backward-regression for existing modal behavior)_
- **dark + light both render** — GIVEN dark and light mode WHEN cycling all three sizes THEN borders/background/contrast are correct in each _(verifies R3)_
- **size resets on reopen** — GIVEN the modal was closed while at Full WHEN it is reopened THEN it is at Normal _(verifies R4; relies on `ProjectView.tsx` conditional mount)_

##### Build-Config Guard
- **size classes emitted** — GIVEN Tailwind JIT scans `components/**` WHEN the app is built THEN `max-w-5xl` and `max-w-none` are present (Large/Full visibly take effect) — confirms the literal-string lookup is not purged _(guards ARCH forward stress-test: class purge; guards `tailwind.config.js` content glob)_

### Implementation Notes

- **Module(s):** `devvault/src/components/EntryEditor.tsx` only (per ARCH Module Boundaries).
- **Pattern reference:** local UI state mirrors the existing `showPreview` / `busy` `useState` flags in the same file; header button styling mirrors the existing Preview/`+ Field` buttons and the ✕ close button.
- **Key decisions:** A1 (two controls — expand/restore — not a single cycle), A2 (no persistence; default `useState('normal')` resets via unmount-on-close), A3 (resize only; rely on existing inner `overflow-y-auto`), A4 (static Tailwind class lookup map).
- **JIT gotcha:** `SIZE_CLASS` values MUST be complete literal class strings (`'max-w-2xl max-h-full'`, `'max-w-5xl max-h-full'`, `'max-w-none w-full h-full'`) — never string-concatenated — or Tailwind's scanner won't emit them.
- **Libraries:** React 18 only; Tailwind 3.4 (all classes stock, no config change).
- **High-risk callouts:** None — all Areas of Impact are L. Primary watch-item is the default-look regression, covered by the "Normal preset unchanged" guard.

### Scope Boundaries

- Do NOT add a test runner or any test infra (decision, 2026-06-09).
- Do NOT add free-form drag-resize or persisted size (ARCH Out of Scope).
- Do NOT make the notes textarea/preview grow to fill height — A3 keeps existing `rows={6}` / `min-h` (ARCH Out of Scope).
- Do NOT touch other modals (Search, Backups) or `tailwind.config.js`.
- Only modify `EntryEditor.tsx`; only add the size state, the lookup map, and the two header buttons.

### Files Expected

**New files:** None.

**Modified files:**
- `devvault/src/components/EntryEditor.tsx` (add `size` state + `SIZE_CLASS` map; replace the form's literal `max-w-2xl max-h-full` with `SIZE_CLASS[size]`; add ⤢ expand and ⤡ restore buttons in the header beside ✕)

**Must NOT modify:**
- `devvault/src/components/ProjectView.tsx` (silent-regression hotspot — its conditional `{editing && …}` mount is what resets size; covered by the "size resets on reopen" guard)
- `devvault/tailwind.config.js` (must keep its `components/**` content glob; covered by the "size classes emitted" guard)
