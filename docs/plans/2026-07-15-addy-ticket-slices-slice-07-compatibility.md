# Slice 07 — Tracker compatibility and final audit

Index: `docs/plans/2026-07-15-addy-ticket-slices-index.md`
GitHub issue: [#14](https://github.com/teknologist/pi-addy-workflow/issues/14)
Previous: `docs/plans/2026-07-15-addy-ticket-slices-slice-06-presentation-stats.md`
Repository scope: current repository only.

## Required context

- Spec: `docs/specs/2026-07-15-addy-ticket-slices.md`
- All preceding slice evidence.
- Repo-local frozen fixtures from Slice 02; do not depend on external absolute paths or live upstream main.
- External progress spec: `docs/specs/2026-07-13-external-issue-workflow-progress.md`

## Task 1: Prove tracker contracts with fixtures and deterministic harness

<!-- addy-task-id: ticket-slices-07-backend-contracts -->

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

### Objective

Exercise one semantic Ticket workflow across frozen GitHub, Linear, and local contracts without claiming automated live end-to-end coverage.

### Implementation steps

1. Use frozen setup/ticket fixtures and `fake-ticket-source.ts` to test query, fetch, label selection, blockers, native/managed claim, targeted mutation, Activity, review/fix, evidence, and completion post-states.
2. Cover direct label bypass, queue label requirement, optional local Labels, `Status: claimed/resolved`, numeric frontier, and Comments.
3. Cover missing/ambiguous tracker semantics, revision conflict, partial claim, lost envelope, and completion failure.
4. Add opt-in manual smoke procedures for authenticated GitHub and Linear repos; clearly label them non-CI and never embed credentials.
5. Keep upstream skill modification out of scope.

### Acceptance criteria

- GitHub fixture produces assignment + managed claim + selector removal, comments, and close post-state.
- Linear fixture produces assignee/managed claim, comments, and configured completed-state post-state; ambiguous routing pauses.
- Local fixture produces `Status: claimed`, targeted checkboxes/managed block, `Comments`, then `Status: resolved`.
- Direct unlabeled Ticket can run; queue mode selects only mapped/explicit label.
- Partial/lost/conflicting cases match Slice 03/04 recovery rules.
- Automated suite is described as contract+harness coverage, not live tracker mutation.

### Verification

Run:

```sh
node --experimental-strip-types --test tests/tracker-config-fixtures.test.ts tests/ticket-prompt.test.ts tests/ticket-source-harness.test.ts tests/ticket-claim.test.ts tests/ticket-finish.test.ts tests/ticket-queue*.test.ts
```

Expected proof:

- Backend contract matrix passes offline.
- Manual smoke instructions are complete but not falsely marked executed.

### Stop conditions

- Stop if compatibility requires changing installed/upstream Matt Pocock skills or live credentials in tests.

## Task 2: Prove Slice Plan, corrupt-state, and external-progress compatibility

<!-- addy-task-id: ticket-slices-07-legacy-compatibility -->

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

Depends on:

- Task 1.

### Objective

Demonstrate Ticket support is additive and claim-safe.

### Implementation steps

1. Run focused regressions for plan parsing/frontier/commit, Auto lifecycle, fresh continuation, controls, widget/dashboard, and stats.
2. Add active Addy Ticket + external snapshot coexistence fixtures.
3. Prove external snapshots never create claims/actions/runner ownership/transitions.
4. Prove no-Ticket state/widget/stats snapshots remain unchanged.
5. Prove corrupt Ticket state leaves startup/status available while blocking dispatch, reset, and source switching with recovery warning.

### Acceptance criteria

- Existing plan Task Frontier/Closure/commit identity output is unchanged.
- Existing plan commands remain accepted when no live Ticket claim exists.
- External progress remains outside Workflow State and cannot satisfy Ticket claim/lifecycle.
- Corrupt Ticket state is not silently discarded and cannot orphan a possible claim.
- Missing Ticket state/data cannot prevent ordinary Addy startup.
- Generic reset differs only when live/corrupt possible Ticket claim safety requires refusal.

### Verification

Run:

```sh
node --experimental-strip-types --test tests/*.test.ts
```

Expected proof:

- Full suite passes with no skipped tests.

### Stop conditions

- Stop on any unapproved legacy snapshot/output or state-semantic change.

## Task 3: Run final gates and reconcile durable docs

<!-- addy-task-id: ticket-slices-07-final-audit -->

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

Depends on:

- Tasks 1–2.

### Objective

Finish with complete evidence, minimal documentation, and no unresolved review findings.

### Implementation steps

1. Run formatting, typecheck, and full tests.
2. Review the complete diff for duplicated plan/Ticket logic, unsafe content persistence, lifecycle ownership violations, skip/ship leakage, and unrelated refactors.
3. Update `CONTEXT.md` only if implementation changes an approved term.
4. Update packaged prompt/README/help for the complete command matrix.
5. Map every spec/index completion criterion to test output or manual-smoke status.
6. Keep plan lifecycle checkboxes synchronized with actual owning phases.

### Acceptance criteria

- Workflow State/dashboard contain no bodies, comments, prompts, logs, credentials, or unbounded tracker text.
- No tracker client dependency was added.
- No unresolved review finding remains.
- Help/assets describe all Ticket commands and live-claim source-switch restrictions.
- Every automated requirement has concrete passing output; unexecuted authenticated smoke tests are reported, not hidden.
- Diff contains no unrelated refactor.

### Verification

Run:

```sh
npm run format:check
npm run typecheck
npm test
```

Expected proof:

- All commands exit zero with no skipped checks.

### Stop conditions

- Stop rather than mark completion if any gate fails or review finding remains.

## Completion audit

- [ ] Every preceding slice task has implementation, verification, and review evidence.
- [ ] Offline backend contract/harness matrix passes.
- [ ] Full regression/type/format gates pass.
- [ ] Authenticated smoke tests are either evidenced or explicitly reported unexecuted.
- [ ] Spec/plan criteria map to evidence.
- [ ] No unrelated files changed.
