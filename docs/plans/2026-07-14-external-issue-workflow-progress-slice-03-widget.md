# Slice 03 — Widget projection

## Task 1: Append external progress to the existing widget

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

Depends on:

- Slice 01.

### Objective

Render selected external runs as a compact, read-only block after the unchanged Addy workflow lines.

### Context / files

Required context:

- Spec: `docs/specs/2026-07-13-external-issue-workflow-progress.md`
- ADR: `docs/adr/0001-addy-auto-runner-lock.md`
- Steering: `AGENTS.md`
- Slice 01 external-progress reader/selection API.

Likely files:

- `extensions/workflow-monitor/workflow-widget-presenter.ts`
- `tests/workflow-widget-presenter.test.ts`

Relevant symbols:

- `renderWorkflowWidget()`
- `WORKFLOW_WIDGET_KEY`

### Implementation steps

1. Capture failing regression tests proving byte-for-byte existing output when no valid external run is selected.
2. Add focused formatting for active runs followed by the newest terminal run: source, primary phase, issue/wave count, current item, status, and stale marker.
3. Read through the slice-01 API using the existing `baseCwd`; do not read raw files in the presenter or mutate state.
4. Append external lines after current workflow/artifact/task lines and apply the existing width truncation to every line.
5. Confirm corrupt snapshots never produce widget warnings or alter baseline lines.

### Acceptance criteria

- Existing widget output is unchanged when external selections are empty.
- External phases never appear in the Addy lifecycle strip and never replace the widget key/footer.
- All selected active runs and the newest terminal run render compactly and deterministically.
- `pre-loop` and `post-loop` remain secondary labels; active loop phase/progress is primary.
- Malicious/long text is width-bounded and cannot emit control sequences.
- Rendering dispatches no Addy event and changes no `WorkflowState`, warnings, statistics, reset behavior, or ADR-0001 ownership state.

### Verification

Run:

```sh
node --experimental-strip-types --test tests/workflow-widget-presenter.test.ts tests/external-progress.test.ts
npm run typecheck
npm run format:check
```

Expected proof:

- A pre-change baseline assertion fails only when external rendering is attempted; all existing expected lines remain identical.
- Tests cover active/terminal ordering, stale display, boundary labels, narrow widths, corrupt files, and zero valid snapshots.

### Stop conditions

- Stop if implementation requires changing `WORKFLOW_WIDGET_KEY`, regular Addy lines, `WorkflowState`, or runner-lock/dispatch behavior.
