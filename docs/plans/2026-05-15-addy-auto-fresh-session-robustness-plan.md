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
- Do not remove valid model config such as `anthropic/claude-opus-4-7`.

## Design principles

1. `agent_end` and other event handlers must never call `ctx.newSession()`.
2. Fresh context is a two-step handoff: persist intent, then run an internal command.
3. `/addy-auto-continue` must be idempotent and safe to retry.
4. Replacement-session work must use only the `newCtx` passed to `withSession`.
5. State persistence must be strong enough that a fresh session can continue without old conversation context.
6. Tests must simulate Pi's real stale-context constraints, not only permissive mocks.

## Implementation plan

### Task 1: Restore command-trampoline-only session control

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

Acceptance criteria:

- `dispatchAutoPromptFreshAware(...)` never calls `runFreshContextContinuation(...)` from event-driven flow.
- Between-task continuation in `maybeContinueAfterTaskCommit(...)` never calls `ctx.newSession()` directly.
- Event paths persist the pending fresh prompt and enqueue `/addy-auto-continue --fresh <reason>`.
- Only the registered `/addy-auto-continue` command handler calls `runFreshContextContinuation(...)` / `ctx.newSession()`.

### Task 2: Make pending fresh continuation explicit and durable

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

Acceptance criteria:

- Workflow state records the exact pending prompt in `autoFreshPrompt` before enqueuing the continuation command.
- Add a fresh reason field if needed, e.g. `autoFreshReason`, so recovery is deterministic.
- Fresh continuation can recover from project-persisted state when the new session has no branch entries.
- Successful dispatch clears `autoFreshPrompt` and fresh-control metadata.

### Task 3: Make `/addy-auto-continue` idempotent

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

Acceptance criteria:

- If `autoFreshPrompt` exists, the command dispatches that exact prompt once.
- If `autoFreshPrompt` is missing, the command recomputes the next lifecycle action from the active plan.
- Re-running the same continuation does not duplicate lifecycle prompts or stats.
- The internal continuation input does not disable auto mode.
- Cancellation leaves a clear paused state and does not silently lose the pending prompt.

### Task 4: Harden stale-context boundaries

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

Acceptance criteria:

- `withSession` captures only plain data from the old session before replacement.
- `withSession` uses only its replacement `newCtx` for `sendUserMessage`, `sendMessage`, UI, and workflow state reads/writes.
- No captured old command/event `ctx`, old session manager, or old session-bound `pi` methods are used after replacement.
- Tests fail if old ctx is touched after `newSession()`.

### Task 5: Repair lifecycle consistency around fresh continuations

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

Acceptance criteria:

- A clean review dispatches commit/finish without leaving the footer/current phase stuck on `verify`.
- `/addy-finish` is not auto-dispatched while the active plan still has `Reviewed` unchecked.
- A completed task commit does not trigger a duplicate no-op auto commit after `/addy-finish`.
- Review-fix loops preserve the reviewed task target even after plan/task state advances.

### Task 6: Regression tests for real failure modes

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

Add or update tests in `tests/workflow-monitor.test.ts`:

- [ ] `agent_end` with a `newSession` property does not call `ctx.newSession()` directly.
- [ ] fresh before-step from `agent_end` enqueues `/addy-auto-continue --fresh before-step`.
- [ ] fresh before-review from `agent_end` enqueues `/addy-auto-continue --fresh before-review`.
- [ ] between-task fresh continuation enqueues `/addy-auto-continue --fresh between-tasks`.
- [ ] `/addy-auto-continue` command is the only path that invokes `ctx.newSession()`.
- [ ] pending `autoFreshPrompt` survives session restoration and dispatches in replacement session.
- [ ] duplicate `/addy-auto-continue` does not duplicate prompt delivery or stats.
- [ ] old ctx throws if touched after session replacement, and the flow still succeeds.
- [ ] cancellation keeps enough state for safe resume.

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

Use a small two-task throwaway plan and fresh-context defaults.

Verify:

1. `/addy-auto <plan>` starts task 1.
2. After build completes, the old session only enqueues `/addy-auto-continue --fresh before-step`.
3. The replacement session receives expanded `/addy-verify <plan>`.
4. Verify, review, commit, and next task continue without manual input.
5. No stale ctx errors appear.
6. No lingering `autoFreshPrompt` remains after dispatch.
7. `/addy-stats <plan>` has correct turns/review counts with no double-counting.

## Side investigation: `/addy-finish` commit model warning

Observed warning:

```text
Warning: No models match pattern "anthropic/claude-opus-4-7"
```

Do not remove `anthropic/claude-opus-4-7`; treat this as an environment/model-resolution mismatch or subprocess warning leak.

Investigation plan:

- [ ] Identify which command/process produces `proc_1` during `/addy-finish` commit.
- [ ] Capture the subprocess cwd, env, and model/provider loading path.
- [ ] Confirm whether the subprocess sees a partial model registry before Anthropic models are loaded.
- [ ] Check whether a helper, council, commit command, or Pi subprocess validates `enabledModels` too early.
- [ ] Fix the warning at the source by aligning subprocess model registry loading with the main Pi session, deferring validation until providers are loaded, or suppressing only this false-positive subprocess warning.
- [ ] Confirm `/addy-finish` commit no longer prints the warning while preserving valid model config.

## Success criteria

- `/addy-auto` fresh-context mode runs build → verify → review → commit → next task without manual intervention.
- No direct event-handler calls to `ctx.newSession()` remain.
- No stale ctx errors occur during fresh-session handoff.
- Pending fresh continuations are retryable and deterministic.
- Lifecycle phase state matches plan checkbox state.
- The `/addy-finish` model warning is understood and resolved without deleting valid model entries.
