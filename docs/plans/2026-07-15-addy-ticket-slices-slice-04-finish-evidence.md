# Slice 04 — Multi-repository FINISH and closure evidence

Index: `docs/plans/2026-07-15-addy-ticket-slices-index.md`
GitHub issue: [#11](https://github.com/teknologist/pi-addy-workflow/issues/11)
Previous: `docs/plans/2026-07-15-addy-ticket-slices-slice-03-manual-lifecycle.md`
Next: `docs/plans/2026-07-15-addy-ticket-slices-slice-05-auto-queue.md`
Repository scope: current repository only.

## Required context

- Spec: `docs/specs/2026-07-15-addy-ticket-slices.md`
- Completed Slices 01–03.
- Existing seams: `task-commit-prompt.ts`, `task-commit-target.ts`, `task-commit-coordinator.ts`, `commit-result.ts`, `plan-task-lifecycle.ts`, `auto-agent-end.ts`

## Task 1: Record strict per-repository Ticket evidence

<!-- addy-task-id: ticket-slices-04-commit-evidence -->

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

### Objective

Use validated evidence for every locked repository instead of the legacy one-SHA/prose path.

### Implementation steps

1. Add Ticket evidence entries: canonical repository, `committed|no-changes`, commit SHA when committed, and timestamp.
2. Build a Ticket-specific FINISH/commit prompt from the locked scope.
3. Validate exactly one successful entry per locked repository and reject unknown/duplicate repositories, invalid/missing SHA, partial failure, or unconfirmed prose.
4. Keep legacy `WorkflowTaskCommitRecord`, `commitShaFromAgentText`, and plan Task Commit Coordinator behavior unchanged.
5. Create `tests/ticket-finish.test.ts` for Ticket evidence and `tests/task-commit-coordinator.test.ts` to lock existing plan coordinator behavior; extend commit/state-codec tests.

### Acceptance criteria

- Scope `[repo-a]` + committed SHA records one complete evidence set.
- Scope `[repo-a, repo-b]` + evidence only for repo-a remains incomplete and claimed/open.
- Duplicate repo-a, unknown repo-c, `committed` without SHA, and malformed SHA are rejected.
- Explicit `no-changes` counts only for its named repository.
- Partial success posts failure Activity but does not close or clear claim.
- Legacy plan commit fixtures serialize/match exactly as before.

### Verification

Run:

```sh
node --experimental-strip-types --test tests/ticket-finish.test.ts tests/task-commit-coordinator.test.ts tests/commit-result.test.ts tests/workflow-state-codec-commits.test.ts
```

Expected proof:

- Single/multi/no-change/partial/duplicate/invalid evidence matrices pass.

### Stop conditions

- Stop if Ticket completion still consumes a single prose SHA or records `unconfirmed` evidence.

## Task 2: Gate manual FINISH and post final Activity before completion

<!-- addy-task-id: ticket-slices-04-manual-finish -->

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

Depends on:

- Task 1.

### Objective

Complete one manually selected Ticket only after criteria, lifecycle, and repository evidence are authoritative.

### Implementation steps

1. Route `/addy-finish [--ticket <same-ref>]` to Ticket FINISH when Ticket mode is active.
2. Refetch and confirm criteria, Implemented/Verified/Reviewed, claim, scope, and evidence immediately before completion.
3. Post one idempotent final Activity entry before the tracker transition.
4. Apply configured completion: GitHub close, Linear appropriate completed state, local `Status: resolved`; refetch terminal state.
5. Clear active Ticket orchestration only after a valid terminal Ticket Result; preserve history/stats.
6. If completion routing is ambiguous, manual mode asks once and persists the selected operation fact; cancellation preserves claim.

### Acceptance criteria

- Any unchecked criterion/status or missing repository evidence prevents final comment and close.
- Final Activity is written before transition and contains bounded repository outcomes/commit IDs.
- Retry after lost envelope observes existing marker/terminal state, returns reconciled, and neither comments nor closes twice.
- Completion API failure leaves claim/evidence available for retry.
- Ambiguous Linear completion asks once; cancellation performs no transition.
- Parent issue references are never mutated or closed.
- Ticket branch exposes no skip or ship path.

### Verification

Run:

```sh
node --experimental-strip-types --test tests/ticket-finish.test.ts tests/auto-agent-end.test.ts tests/ticket-source-harness.test.ts
```

Expected proof:

- Exact precondition, ordering, idempotency, ambiguity, and failure post-state assertions pass.

### Stop conditions

- Stop if configured tracker terminal state cannot be confirmed after mutation.

## Task 3: Preserve claim and evidence across interrupted FINISH

<!-- addy-task-id: ticket-slices-04-finish-recovery -->

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

Depends on:

- Task 2.

### Objective

Recover safely when commits, final comments, tracker completion, or result delivery succeed only partially.

### Implementation steps

1. Model FINISH stages in the pending action/result: repository evidence → final Activity → terminal transition → terminal refetch.
2. On retry, refetch and resume only missing stages using the same marker/action identity.
3. Treat closed/resolved ticket with matching claim/evidence but lost envelope as reconciled completion.
4. Treat terminal ticket with mismatched/missing evidence or another claim as manual repair; do not fabricate success.
5. Add exact recovery cases to `tests/ticket-finish.test.ts`.

### Acceptance criteria

- Commits done/comment missing resumes comment then close.
- Comment done/close missing resumes close without duplicate comment.
- Close done/envelope missing reconciles and archives once.
- Partial multi-repo commit does not run comment/close.
- Unexpected terminal state or conflicting claim pauses with status/recovery guidance.

### Verification

Run:

```sh
node --experimental-strip-types --test tests/ticket-finish.test.ts tests/provider-transport-retry.test.ts
```

Expected proof:

- Every staged interruption has one deterministic next operation and post-state.

### Stop conditions

- Stop if retry could repeat a commit or close without verifying existing post-state.

## Completion audit

- [ ] Every locked repository has validated evidence.
- [ ] Final Activity precedes terminal transition.
- [ ] Manual FINISH is strict, idempotent, and recoverable.
- [ ] Legacy plan commit behavior remains unchanged.
