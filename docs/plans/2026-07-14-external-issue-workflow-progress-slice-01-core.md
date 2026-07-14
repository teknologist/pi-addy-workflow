# Slice 01 — External progress core

## Task 1: Implement the snapshot and persistence boundary

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

Depends on:

- None.

### Objective

Add the isolated external-progress contract, validation, project scoping, persistence, selection, staleness, and retention needed by the CLI and both readers.

### Context / files

Required context:

- Spec: `docs/specs/2026-07-13-external-issue-workflow-progress.md`
- ADR: `docs/adr/0001-addy-auto-runner-lock.md`
- Steering: `AGENTS.md`

Likely files:

- `extensions/workflow-monitor/external-progress.ts` (new)
- `extensions/workflow-monitor/workflow-state-store-scope.ts`
- `tests/external-progress.test.ts` (new)

Relevant symbols:

- `projectWorkflowStateKey()`

### Implementation steps

1. Write failing tests for schema-v1 strict validation, unknown-field rejection, display-text normalization, lifecycle/phase transitions, counter invariants, ownership checks, and immutable terminals.
2. Add the v1 snapshot types and strict parser. Keep them independent from `WorkflowState`.
3. Resolve the canonical absolute Git common directory and pass it to the existing `projectWorkflowStateKey()` utility. Store snapshots under the spec's home-directory path with user-only permissions where supported.
4. Add atomic per-run writes and fail-open reads. Use the smallest standard-library exclusion needed to make concurrent `start` idempotent per project/source; do not add a global run index or service.
5. Implement merge-patch updates, running/blocked reuse, selection, 30-minute stale derivation, terminal ordering by `finishedAt` then `runId`, and best-effort newest-10 terminal retention.
6. Keep corrupt-file diagnostics separate from valid selections so the widget can ignore them and the dashboard can aggregate one warning.

### Acceptance criteria

- Main checkout and worktrees derive the same project key.
- Exactly one `running` or `blocked` run exists per project/source after concurrent starts.
- Only `running`, `blocked`, `completed`, and `failed` are accepted; terminals cannot be changed.
- Merge patches preserve omissions and enforce monotonic `completed`, fixed `total`, and `completed <= total`.
- Loop-aware transitions accept verification/review-fix and queue/item cycles but reject arbitrary regressions.
- `currentItem` normalization follows the spec and is limited to 256 Unicode code points.
- Invalid snapshots never throw into readers; active runs are never removed by retention.
- No repository/worktree file is written and no Addy state or ADR-0001 lock/fencing field is read or changed.

### Verification

Run:

```sh
node --experimental-strip-types --test tests/external-progress.test.ts
npm run typecheck
npm run format:check
```

Expected proof:

- Regression tests fail before the module exists and pass after implementation.
- Tests cover concurrent starts, atomic writes, worktree identity, corrupt files, staleness, terminal ordering, and retention races.
- `git status --short` shows no runtime files written inside the checkout.

### Stop conditions

- Stop if canonical Git common-directory resolution cannot produce one identity for main checkout and worktrees.
- Stop if satisfying idempotent start would require changing Addy state, ADR-0001 ownership/fencing, or introducing a service/dependency.
