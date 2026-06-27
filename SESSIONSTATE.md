*Last updated: 2026-06-25T16:35*

---

## Active phase

Phase 4 — React UI
Spec: `TASKS.md`

---

## Completed tasks

| Task | Description | Commit message |
|------|-------------|----------------|
| P4-T01 | Vite Scaffold and SSE Hook | advanced |
| P4-T02 | Company Selector and Run Controls | advanced |
| P4-T03 | Live Stage Panels | advanced |
| P4-T04 | Report Card and Scored Jobs View | advanced |

---

## Active task

### P4-T05 · Config Editor

**Status:** Pending
**Complexity:** medium
**What:** A `ConfigEditor` component that fetches both the company config and skills
  profile, renders them as editable fields, saves via PUT endpoints, shows server
  validation errors on 400, and warns the user of unsaved changes before allowing
  a new run.
**Prerequisite:** P4-T04 complete.
**Hard deps:** P4-T04
**Files:** `client/src/components/ConfigEditor.tsx` (new), `client/src/App.tsx`
**Reviewer:** Skip
**Key constraints:**

- The Run button in `RunControls` must be disabled while there are unsaved changes in
  the config editor. Pass an `hasUnsavedChanges` flag up to the parent via a callback.
- Server validation errors (400 responses) must be displayed inline — not silently
  swallowed.

**Done when:**

- Editing `targetDepartments` in the config editor, saving, and running the pipeline
  reflects the updated filter in the Stage 2 panel results.
- An invalid config change (e.g., empty `targetDepartments`) triggers a visible
  inline error from the server.
- A modified but unsaved config disables the Run button with a visible "Unsaved
  changes" indicator.

---

## Up next

| Task | Description | Hard deps | Complexity | Reviewer |
|------|-------------|-----------|------------|----------|

---

## Out of scope

- [List anything explicitly out of scope]
