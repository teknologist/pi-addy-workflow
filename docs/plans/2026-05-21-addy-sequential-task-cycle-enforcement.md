# Addy sequential task-cycle enforcement plan

## Problem

Addy auto can currently advance implementation work to a later task or next slice while the current task still has pending lifecycle work. In the observed failure mode, `/addy-build` advanced from Slice 03 Task 4 to Slice 04 implementation because Slice 03 Task 4 was already implemented, even though it still needed verification and review. The workflow footer stayed on Slice 03 because persisted workflow state never advanced to Slice 04.

This breaks the intended Addy workflow discipline: work must be completed task-by-task, not phase-by-phase across future tasks.

## Non-negotiable invariant

Addy has exactly one frontier task.

Nothing after the frontier task exists for auto-dispatch purposes until that task is:

1. Implemented
2. Verified
3. Reviewed
4. Committed

No later task or slice may receive implementation work while the frontier task has pending verify, review, or commit work.

## Closed task definition

A task is closed only when all of these are true:

- `Implemented` is checked.
- `Verified` is checked.
- `Reviewed` is checked.
- A successful task commit is recorded for that exact task.

Checkboxes alone are insufficient. A reviewed task is not closed until the commit step succeeds.

## Routing algorithm

For the current `activePlan`:

1. Parse tasks in file order.
2. Find the first task that is not closed.
3. Route only that task:

```text
missing Implemented  -> /addy-build activePlan
missing Verified     -> /addy-verify activePlan
missing Reviewed     -> /addy-review activePlan
reviewed uncommitted -> __addy-auto-task-commit__
closed               -> next task
```

Only when every task in `activePlan` is closed may Addy consider the next slice.

## Required implementation shape

### Single frontier calculator

Create or centralize a single frontier calculation used by:

- auto dispatch
- same-phase retry logic
- next-slice continuation
- footer/task state refresh

The footer and dispatch prompt must never derive task progress through separate bypassable logic.

### Commit ledger

Persist task commit completion in workflow state instead of relying only on transient assistant text or archived stats.

Suggested shape:

```ts
committedTasks: {
  [taskKey]: {
    plan: string;
    sliceIndex?: number;
    taskIndex: number;
    taskTitle: string;
    commitSha: string;
    committedAt: string;
  };
}
```

Task key should include at least:

```text
planPath + taskIndex + taskTitle
```

### Next-slice guard

Make next-slice discovery unreachable until:

```ts
allTasksInCurrentPlanAreClosed(state, activePlan);
```

Do not use this weaker condition:

```ts
allTasksInCurrentPlanHaveCheckedBoxes(activePlan);
```

In particular, audit `completedPlanAutoContinuation()` and any direct calls to `nextUnfinishedSlicePlanPath()`. They must not advance merely because lifecycle checkboxes are complete; the commit ledger must also prove closure.

### Manual command guard

If a user or auto sends `/addy-build activePlan` while the frontier task needs verify, review, or commit, Addy must refuse or redirect to the required frontier action. It must not continue to a later implementation task.

Example:

```text
frontier state: [x] Implemented, [ ] Verified, [ ] Reviewed
incoming: /addy-build activePlan
required result: /addy-verify activePlan, not build next task
```

## Regression tests

Add tests for these cases:

1. **Implemented but unverified**
   - Current task has `[x] Implemented`, `[ ] Verified`, `[ ] Reviewed`.
   - Later task or next slice has `[ ] Implemented`.
   - Auto dispatches `/addy-verify activePlan`.
   - Auto does not dispatch `/addy-build` for any later task or slice.

2. **Verified but unreviewed**
   - Current task has `[x] Implemented`, `[x] Verified`, `[ ] Reviewed`.
   - Auto dispatches `/addy-review activePlan`.

3. **Reviewed but uncommitted**
   - Current task has all three checkboxes checked.
   - No task commit is recorded.
   - Auto dispatches `__addy-auto-task-commit__`.
   - Auto does not dispatch `/addy-build` for the next task or slice.

4. **Commit succeeds**
   - Commit completion records commit SHA against the current task.
   - Active task stats archive as task-commit.
   - Only after this may auto dispatch the next task or next slice.

5. **Commit unclear or fails**
   - Auto pauses.
   - `activePlan` remains on the current task's plan.
   - Footer remains on the current task.
   - No next task or slice dispatch occurs.

6. **Slice boundary**
   - Last task in slice N is reviewed but uncommitted.
   - Slice N+1 has unimplemented tasks.
   - Auto commits slice N first.
   - Only after successful commit may it move to slice N+1.

7. **Manual wrong command**
   - `/addy-build activePlan` is invoked while the frontier needs verify, review, or commit.
   - Addy redirects/refuses and does not implement a later task.

8. **Footer consistency**
   - After each transition, footer state and dispatched prompt reference the same frontier task.
   - No persisted state may show Slice N while the dispatched prompt builds Slice N+1.

## Success criteria

- Addy auto completes work strictly task-by-task.
- A task's sequence is always: implement -> verify -> review -> commit.
- No next-task or next-slice implementation can happen while verify, review, or commit is pending for the current task.
- Footer state, persisted workflow state, and dispatched prompts agree on the same frontier task.
- The Slice 03/Slice 04 failure mode is covered by regression tests and cannot recur.
