# Addy Auto fresh-session robustness plan

## Goal

Make `/addy-auto` fully autonomous and reliable when fresh context is enabled. Fresh-session handoff must not stop midway, require manual `/addy-auto` resumes, leak stale extension contexts, or advance lifecycle phases out of order.

## Current verified failure

Evidence from tested sessions in `~/Dev/invoicehub-files-to-api` shows:

- auto runs can stop with a persisted `autoFreshPrompt` but no dispatched next workflow prompt;
- some continuations require manual `/addy-auto-continue --fresh ...` or `/addy-auto` intervention;
- at least one run hit `This extension ctx is stale after session replacement or reload`;
- lifecycle state can become inconsistent, e.g. `finish started before review`.

The likely root cause is that current auto-flow paths reached from `agent_end` can call `ctx.newSession()` directly when `ctx.newSession` exists. Pi session-control methods must only be called from extension command contexts; event contexts should use a command trampoline.

## Non-goals

- Do not remove or rewrite Addy workflow lifecycle semantics.
- Do not seed verbose summaries into fresh sessions by default.
- Do not weaken build, verify, review, or commit evidence requirements.

## Design principles

1. Auto-mode fresh handoffs must never call `ctx.newSession()` directly except inside the registered `/addy-auto-continue` command handler.
2. Fresh context is a two-step handoff: persist intent, then enqueue `/addy-auto-continue --fresh <reason>` as a follow-up command.
3. `/addy-auto-continue` must be idempotent and safe to retry.
4. Replacement-session work must use only the `newCtx` passed to `withSession`.
5. State persistence must be strong enough that a fresh session can continue without old conversation context.
6. Pending fresh state is durable intent. A session start with a valid pending fresh continuation should auto-resume it without manual `/addy-auto`.
7. Tests must simulate Pi's real stale-context constraints, not only permissive mocks.
8. Manual workflow step commands such as `/addy-build` may keep their separate command-context fresh-session behavior; this plan is about auto-mode handoffs.

## Resolved design decisions

- All auto-mode fresh handoffs use the `/addy-auto-continue` trampoline, including handoffs reached from `/addy-auto` command handling.
- Manual workflow commands remain explicit overrides: they exit auto mode and clear pending fresh/idempotence state.
- `/addy-auto` is a safe resume command: if a valid `autoFreshPrompt` is pending, it retries that pending continuation instead of clearing it.
- `/addy-auto stop` clears pending fresh state and idempotence markers while preserving historical stats.
- Pending fresh continuations must store:
  - raw invocation in `autoFreshPrompt`;
  - expanded prompt snapshot for diagnostics/idempotence comparison;
  - durable `autoFreshReason`;
  - enough idempotence metadata to no-op duplicate continuation commands after successful delivery.
- Send the raw invocation to the replacement session; expansion and Addy Auto guidance happen at delivery time.
- If command args and durable state disagree on fresh reason, durable `autoFreshReason` wins.
- Persisted `autoFreshPrompt` without `autoFreshReason` is stale/invalid and should be ignored or cleared with a warning; no legacy recovery is required.
- Apply lifecycle phase/stat updates only when the workflow prompt is actually delivered, not when the fresh continuation is merely queued.
- Clear `autoFreshPrompt` only after delivery succeeds. If session replacement is cancelled or delivery fails, keep pending state for retry.
- A duplicate `/addy-auto-continue` for the same already-consumed continuation is a no-op and must not duplicate prompts or stats.
- Startup auto-resume triggers only for explicit valid pending `autoFreshPrompt`, not generic restored `autoMode` state.
- Pending fresh continuations do not expire by age; `/addy-auto stop` or manual workflow commands clear them.
- If `ctx.newSession` is unavailable in `/addy-auto-continue`, warn and dispatch the exact pending prompt in the current session with fresh bypass.
- If both `beforeEveryStep` and `beforeReview` are enabled, `/addy-review` uses the more specific `before-review` reason.
- Auto-mode `/addy-finish` remains exempt from fresh handoff, even when `beforeEveryStep` is enabled.
- The internal auto task-commit prompt remains in the post-review session; fresh handoff happens after task commit, before next task.
- Between-task handoff computes and persists the exact next prompt before enqueueing `/addy-auto-continue --fresh between-tasks`.
- Review-fix loops must review the original target after post-fix verify, even if the plan advanced or the original task is already marked reviewed.
- A clean `/addy-review` that leaves `Reviewed` unchecked is treated as a plan-sync defect and dispatches `/addy-fix-all`.

## Implementation plan

### Task 1: Restore command-trampoline-only session control

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

Acceptance criteria:

- `dispatchAutoPromptFreshAware(...)` never calls `runFreshContextContinuation(...)` directly for auto-mode handoffs.
- `/addy-auto` command handling also persists pending fresh state and enqueues `/addy-auto-continue` instead of directly creating a new session.
- Between-task continuation in `maybeContinueAfterTaskCommit(...)` never calls `ctx.newSession()` directly.
- Auto event paths persist the pending fresh prompt/reason and enqueue `/addy-auto-continue --fresh <reason>` with `deliverAs: "followUp"`.
- Only the registered `/addy-auto-continue` command handler calls `runFreshContextContinuation(...)` / `ctx.newSession()` for auto-mode continuations.
- Manual workflow step commands may continue to use command-context `ctx.newSession()` for their non-auto fresh-session behavior.

### Task 2: Make pending fresh continuation explicit and durable

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

Acceptance criteria:

- Workflow state records the raw pending prompt in `autoFreshPrompt` before enqueuing the continuation command.
- Workflow state also records an expanded prompt snapshot for diagnostics/idempotence comparison.
- Workflow state records durable `autoFreshReason`; pending state without this field is treated as stale/invalid.
- Workflow state records idempotence metadata sufficient to no-op duplicate continuation commands after successful delivery.
- Between-task fresh continuation computes and persists the exact next prompt before enqueueing the continuation command.
- Fresh continuation can recover from project-persisted state when the new session has no branch entries, restoring only the fresh-control fields and task/plan/stat snapshot needed for exact delivery.
- Session start automatically enqueues `/addy-auto-continue --fresh <reason>` when valid pending fresh state exists.
- Successful delivery clears `autoFreshPrompt`, expanded prompt snapshot, `autoFreshReason`, and active fresh-control metadata only after `sendUserMessage` succeeds.

### Task 3: Make `/addy-auto-continue` idempotent

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

Acceptance criteria:

- If valid `autoFreshPrompt` exists, the command dispatches that exact raw invocation once.
- If command args and state disagree, persisted `autoFreshReason` wins while a pending prompt exists.
- If `autoFreshPrompt` is missing because the same continuation was already delivered, the command no-ops.
- If `autoFreshPrompt` is missing and no consumed continuation matches, the command recomputes the next lifecycle action from the active plan.
- Re-running the same continuation does not duplicate lifecycle prompts, phase transitions, or stats.
- The internal continuation input does not disable auto mode.
- `/addy-auto` with pending fresh state retries the pending continuation instead of clearing it.
- `/addy-auto stop` and non-auto manual workflow commands clear pending fresh/idempotence state.
- Cancellation leaves a clear paused state and preserves the pending prompt/reason for safe retry.
- If `ctx.newSession` is unavailable, the command warns and dispatches the pending prompt in the current session with fresh bypass.

### Task 4: Harden stale-context boundaries

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

Acceptance criteria:

- `withSession` captures only plain data from the old session before replacement.
- `withSession` uses only its replacement `newCtx` for `sendUserMessage`, `sendMessage`, UI, and workflow state reads/writes.
- No captured old command/event `ctx`, old session manager, or old session-bound `pi` methods are used after replacement.
- Stale-context regression tests instrument old session-bound objects to throw after replacement for the fresh-handoff path, while allowing unrelated best-effort async work to be caught/ignored.

### Task 5: Repair lifecycle consistency around fresh continuations

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

Acceptance criteria:

- A clean review dispatches commit/finish without leaving the footer/current phase stuck on `verify`.
- `/addy-finish` is not auto-dispatched while the active plan still has `Reviewed` unchecked.
- Auto-mode `/addy-finish` remains in the current session even when fresh-before-every-step is enabled.
- The internal task-commit prompt remains in the post-review session; between-task fresh handoff starts after the commit step completes.
- A completed task commit does not trigger a duplicate no-op auto commit after `/addy-finish`.
- Review-fix loops preserve the reviewed task target even after plan/task state advances.
- Post-fix verify dispatches review for the original review target before commit, even when the plan already marks that target reviewed.
- A clean review with `Reviewed` still unchecked dispatches `/addy-fix-all` as a plan-sync fix.

### Task 6: Regression tests for real failure modes

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

Add or update tests in `tests/workflow-monitor.test.ts`:

- [ ] `agent_end` with a `newSession` property does not call `ctx.newSession()` directly.
- [ ] `/addy-auto` with fresh-before-every-step does not call `ctx.newSession()` directly; it enqueues `/addy-auto-continue`.
- [ ] fresh before-step from `agent_end` enqueues `/addy-auto-continue --fresh before-step` as a follow-up.
- [ ] fresh before-review from `agent_end` enqueues `/addy-auto-continue --fresh before-review` as a follow-up.
- [ ] when `beforeEveryStep` and `beforeReview` are both enabled, review uses `before-review`.
- [ ] between-task fresh continuation persists the exact next prompt and enqueues `/addy-auto-continue --fresh between-tasks`.
- [ ] `/addy-auto-continue` command is the only auto-mode path that invokes `ctx.newSession()`.
- [ ] pending `autoFreshPrompt`/`autoFreshReason` survives session restoration and dispatches in replacement session.
- [ ] session start auto-resumes a valid pending fresh continuation.
- [ ] reasonless pending fresh state is ignored or cleared as stale.
- [ ] duplicate `/addy-auto-continue` does not duplicate prompt delivery, phase transitions, or stats.
- [ ] lifecycle/stat updates are applied on prompt delivery, not when the continuation is queued.
- [ ] send failure or cancellation preserves pending prompt/reason for retry.
- [ ] old ctx throws if touched by the fresh-handoff path after session replacement, and the flow still succeeds.
- [ ] fallback without `ctx.newSession` dispatches the pending prompt in the current session with a warning.
- [ ] `/addy-auto` retries pending fresh state; `/addy-auto stop` clears it.
- [ ] manual workflow commands clear pending fresh state and exit auto mode.
- [ ] post-fix verify reviews the original target before commit even when the plan advanced.
- [ ] clean review with `Reviewed` unchecked dispatches `/addy-fix-all`.
- [ ] auto-mode `/addy-finish` and internal task commit remain exempt from fresh handoff.

Validation commands:

```bash
node --experimental-strip-types --test tests/workflow-monitor.test.ts
npm run test -- --test-reporter=spec
npm run typecheck
```

### Task 7: Manual smoke test in `~/Dev/invoicehub-files-to-api`

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

Use a small two-task throwaway plan and fresh-context defaults. Run first against the local working-tree extension, then against the installed/global Addy workflow package.

Verify:

1. `/addy-auto <plan>` starts task 1.
2. After build completes, the old session only enqueues `/addy-auto-continue --fresh before-step`.
3. The replacement session receives expanded `/addy-verify <plan>`.
4. Verify, review, commit, and next task continue without manual input.
5. No stale ctx errors appear.
6. No lingering `autoFreshPrompt` remains after successful dispatch.
7. Duplicate `/addy-auto-continue` does not duplicate prompts or stats.
8. `/addy-stats <plan>` has correct turns/review counts with no double-counting.

## Success criteria

- `/addy-auto` fresh-context mode runs build → verify → review → commit → next task without manual intervention.
- No direct event-handler or `/addy-auto` auto-mode calls to `ctx.newSession()` remain.
- No stale ctx errors occur during fresh-session handoff.
- Pending fresh continuations are retryable, deterministic, and startup-resumable.
- Duplicate continuation commands do not duplicate prompts, lifecycle transitions, or stats.
- Lifecycle phase state matches plan checkbox state.
