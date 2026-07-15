# Slice 06 — Ticket presentation and stats

Index: `docs/plans/2026-07-15-addy-ticket-slices-index.md`
GitHub issue: [#13](https://github.com/teknologist/pi-addy-workflow/issues/13)
Previous: `docs/plans/2026-07-15-addy-ticket-slices-slice-05-auto-queue.md`
Next: `docs/plans/2026-07-15-addy-ticket-slices-slice-07-compatibility.md`
Repository scope: current repository only.

## Required context

- Spec: `docs/specs/2026-07-15-addy-ticket-slices.md`
- Completed Slices 01–05.
- `workflow-widget-presenter.ts`, `workflow-stats.ts`, `workflow-stats-report.ts`, `workflow-stats-presenter.ts`, `dashboard-server.ts`, `command-intake.ts`

## Task 1: Render Ticket state without plan traversal

<!-- addy-task-id: ticket-slices-06-widget-dashboard -->

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

### Objective

Show Ticket execution/queue facts while preserving plan and external-progress output.

### Implementation steps

1. Branch by execution source before Slice Plan reads.
2. Add compact widget facts: opaque ref, lifecycle frontier, claim/pause state, selector, and queue outcome/progress when known.
3. Add optional safe dashboard Ticket projection.
4. Keep external issue-workflow progress in its separate read-only section.
5. Bound/escape tracker-derived strings; never persist/render body/comments.
6. Extend widget/dashboard tests with exact no-Ticket snapshots and coexistence fixtures.

### Acceptance criteria

- No-Ticket widget and dashboard snapshots are byte-identical.
- Active Ticket never appears as a plan/task path.
- Projection excludes body, comments, prompts, logs, credentials, and arbitrary labels other than active selector.
- Active Addy Ticket and external progress render separately and do not affect each other's state.
- Oversized/malicious ref/selector is escaped and bounded.
- Presenters perform no tracker read.

### Verification

Run:

```sh
node --experimental-strip-types --test tests/workflow-widget-presenter.test.ts tests/dashboard-server.test.ts
```

Expected proof:

- Exact legacy, Ticket, malicious-display, and coexistence snapshots pass.

### Stop conditions

- Stop if presentation needs tracker access or raw ticket content.

## Task 2: Add Ticket stats without reconstructing comments

<!-- addy-task-id: ticket-slices-06-stats -->

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

### Objective

Track Addy turns/phases/findings/fixes/duration by stable Ticket identity.

### Implementation steps

1. Extend stats target with discriminated Ticket identity.
2. Attribute validated manual/Auto attempts and closure exactly once.
3. Implement `/addy-stats --ticket <ref>` against locally persisted Addy stats only.
4. Render Ticket terminology separately from plan slice/task terminology.
5. Keep existing plan stats schema/output unchanged when Ticket mode is absent.
6. Extend `workflow-stats.test.ts`, `workflow-stats-target.test.ts`, `workflow-stats-presenter.test.ts`, and command tests.

### Acceptance criteria

- Title/body/revision edits do not split Ticket stats.
- Duplicate same-attempt result does not double-count.
- REVIEW findings and FIX-ALL attempts count once per validated action.
- `--ticket` returns persisted stats or exact no-data result and never fetches tracker history.
- Existing `/addy-stats [plan]` and `--all` outputs remain unchanged.
- Stats are not lifecycle or closure evidence.

### Verification

Run:

```sh
node --experimental-strip-types --test tests/workflow-stats.test.ts tests/workflow-stats-target.test.ts tests/workflow-stats-presenter.test.ts tests/command-intake.test.ts tests/command-registry.test.ts
```

Expected proof:

- Stable identity, duplicate attempt, no-data, and legacy output fixtures pass.

### Stop conditions

- Stop if stats require reading Ticket Activity or tracker APIs.

## Completion audit

- [ ] Ticket state is visible and data-minimal.
- [ ] Plan and external progress remain separate.
- [ ] Stats use stable Ticket identity and local data only.
- [ ] No-Ticket output remains unchanged.
