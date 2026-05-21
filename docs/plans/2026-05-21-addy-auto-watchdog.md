# Addy auto watchdog plan

## Problem

`/addy-auto` can still stall even when `autoMode` is true and the strict task frontier has a clear next action. The observed `treso2-public-api` shape was:

- the current assistant turn finished successfully after `/addy-fix-all`;
- the plan checkboxes advanced for the current task;
- workflow state still required a prior checked task to be committed under the strict lifecycle ledger;
- no fresh-context continuation was pending;
- the footer showed `Proceed.` and required the user to manually run `/addy-auto` again.

That violates the intended meaning of auto mode: once enabled, Addy should keep advancing `Implement -> Verify -> Review -> Commit -> next task` until a real hard blocker, explicit stop, or finish condition.

## Pi docs constraints and best-practice findings

Grounded in Pi extension docs:

- Use extension lifecycle events for automation: `session_start`, `agent_end`, `input`, and command handlers are the correct places to restore state and continue work.
- Persist extension state through custom entries (`pi.appendEntry`) and project state files; do not rely only on in-memory flags because sessions can be replaced, resumed, compacted, or reloaded.
- Use `pi.sendUserMessage` with explicit delivery mode when the agent may be streaming. Addy already uses follow-up delivery helpers; watchdog dispatch must reuse them, not bypass them.
- Session replacement is only safe inside command context `ctx.newSession(... withSession ...)`; old `pi`/`ctx` objects become stale after replacement. Watchdog logic must not capture and use stale replacement-session objects.
- Compaction is a summarization feature, not a required continuation primitive. Watchdog recovery must never require successful compaction to make progress.
- In non-idle contexts, use idle-aware delivery or preserve pending state; do not throw away the prompt if `sendUserMessage` cannot deliver immediately.
- Extension errors should fail safe: preserve pending state, notify, and retry later instead of silently stopping auto mode.

## Root causes to fix

1. **No durable pending-action contract**

   Addy persists `autoFreshPrompt` for fresh-context handoffs, but there is no general-purpose persisted pending action for ordinary auto continuation. If a dispatch path declines to send or the session boundary changes, the action can disappear.

2. **Agent-end continuation is only turn-triggered**

   `agent_end` recomputes and dispatches the next action, but if a branch returns early, dispatch is deduplicated incorrectly, or the session is restored after the turn, there is no watchdog that says “auto is enabled and idle; what action should be running?”

3. **Commit-frontier recovery depends on explicit `/addy-auto`**

   The `/addy-auto` command has special recovery for pending task-commit state, but session start / idle auto recovery does not have equivalent logic for a stale reviewed-but-uncommitted frontier.

4. **Fresh context and compaction have been treated as control-flow dependencies**

   Fresh context should improve context hygiene only. It must not be able to block the workflow if unavailable.

## Desired invariant

When `state.autoMode === true`, Addy auto must eventually dispatch exactly one next action whenever all of these are true:

- no Addy auto prompt is currently in-flight;
- the session is idle or can safely queue a follow-up;
- the strict lifecycle frontier can produce a next action;
- no explicit hard blocker or `/addy-auto stop` has been recorded.

The user should not need to type `/addy-auto` again after successful build, verify, review, fix-all, commit, session reload, or current-session fallback.

## Proposed design

### 1. Add a durable pending auto action

Extend `WorkflowState` with a small, command-agnostic pending action record:

```ts
autoPendingAction?: {
  key: string;
  prompt: string;
  expandedPrompt?: string;
  plan?: string;
  taskIndex?: number;
  taskTitle?: string;
  sliceIndex?: number;
  reason: 'next-action' | 'fresh-fallback' | 'idle-retry' | 'commit-frontier';
  attempts: number;
  createdAt: string;
};
```

Rules:

- `key` is deterministic from prompt + plan + task identity + relevant retry reason.
- Create/update this record before attempting delivery.
- Clear it only when the matching prompt is consumed by the `input` event or when a newer action supersedes it.
- Preserve it on send failure, stale context, busy agent, session reload, or unavailable fresh session.

This generalizes `autoFreshPrompt` without removing the existing fresh-context compatibility fields in the first implementation slice.

### 2. Centralize auto dispatch through an idempotent watchdog

Create one function, for example:

```ts
async function maybeRunAutoWatchdog(
  pi,
  ctx,
  trigger,
  options?,
): Promise<boolean>;
```

Responsibilities:

1. Read latest workflow state with `getContextWorkflowState(ctx)`.
2. Return false if auto mode is off, subagent child session, or hard-blocked.
3. If `autoPendingAction` exists, validate it against the current frontier first.
4. Before delivering a pending action, recompute
   `nextWorkflowActionForActivePlanLifecycle(state, cwd)` and compare the
   pending key to the current strict frontier action key.
5. Deliver the pending action only if it still matches the current frontier;
   otherwise discard/supersede it with the recomputed action.
6. If action requires commit, route to `dispatchTaskCommitPrompt` with the action target.
7. Otherwise route to `dispatchAutoPromptFreshAware` / current-session fallback as appropriate.
8. Deduplicate by action key so repeated lifecycle events do not send duplicate user messages.

This function should be called from:

- `/addy-auto` command after enabling auto mode;
- `agent_end` after review/fix/commit handlers finish;
- `session_start` after widget/state initialization;
- pending-fresh/current-session fallback completion;
- provider transport failure recovery when a prompt is preserved;
- optional future `turn_end` or idle hook if Pi exposes a better idle event.

### 3. Treat fresh context as optional delivery strategy

Fresh context behavior should become:

1. Compute the same pending auto action.
2. If fresh context is configured and command context supports `newSession`, try fresh session.
3. If fresh session is unavailable/cancelled/stale, immediately queue current-session follow-up.
4. Never require `ctx.compact()` for continuation.
5. If current-session delivery fails because the agent is busy, preserve `autoPendingAction` and retry from the next `agent_end` or `session_start`.

### 4. Add explicit hard-stop reasons

Add a minimal persisted pause reason instead of silently leaving auto idle:

```ts
autoPausedReason?:
  | 'unclear-commit-result'
  | 'max-review-fix-loops'
  | 'repeated-review-finding'
  | 'user-stopped';
```

The watchdog must not dispatch while this is set. Plain `/addy-auto` clears all pause reasons, including a previous `user-stopped`, and resumes from the current strict frontier. `/addy-auto stop` sets `user-stopped` and clears pending action.

Provider transport failures are not hard pauses. They preserve the failed action as `autoPendingAction` with bounded retry metadata, then the watchdog retries it on the next safe lifecycle event such as `session_start` or `agent_end`.

### 5. Keep strict lifecycle as the only source of truth

Watchdog must not implement its own task selection. It must use:

- `nextWorkflowActionForActivePlanLifecycle(...)` for frontier routing;
- `actionCommitTarget(...)` / existing target helpers for commit ledger targets;
- `nextUnfinishedSlicePlanPath(...)` only after all tasks in active plan are ledger-closed.

## Implementation tasks

### Task 1: Add pending-action state model and migration

- [x] Implemented
- [x] Verified
- [x] Reviewed

Acceptance criteria:

- Add `autoPendingAction` and optional `autoPausedReason` to `WorkflowState`.
- Coerce and sanitize these fields in workflow state loading.
- Preserve backward compatibility for existing `autoFreshPrompt` states.
- Do not invalidate older state files with no pending-action fields.

Verification:

- Unit tests for valid pending action, malformed pending action ignored, and legacy fresh fields still loading.

### Task 2: Build an idempotent auto watchdog dispatcher

- [x] Implemented
- [x] Verified
- [x] Reviewed

Acceptance criteria:

- Add a single watchdog entrypoint that can be safely called repeatedly.
- It dispatches pending action first, otherwise recomputes strict frontier.
- It validates pending actions against the current strict frontier before delivery and supersedes stale pending actions.
- It dispatches reviewed-but-uncommitted tasks to `__addy-auto-task-commit__` without requiring `/addy-auto`.
- It deduplicates same action key across near-simultaneous event calls.
- It preserves pending action on busy/stale send failures.

Verification:

- Tests for repeated watchdog calls sending only one message.
- Test for stale pending action after plan/ledger changes: watchdog discards the old pending prompt and dispatches the recomputed frontier action.
- Test for the `treso2-public-api` stale shape: `autoMode: true`, Task 2 checked but ledger-missing, no fresh prompt, idle session => auto dispatches task commit.

### Task 3: Wire watchdog into Pi lifecycle events

- [x] Implemented
- [x] Verified
- [x] Reviewed

Acceptance criteria:

- `/addy-auto` enables auto mode then calls watchdog.
- `agent_end` calls watchdog after existing commit/fix/review handlers.
- `session_start` calls watchdog for valid auto state after restoring widget/state.
- Pending current-session fallback completion calls watchdog if delivery is skipped or stale.
- Manual `/addy-auto stop` clears pending action and sets stop/pause state; a later plain `/addy-auto` clears that stop state and resumes from the current strict frontier.

Verification:

- Session-start auto-resumes stale commit frontier.
- Agent-end after `/addy-fix-all` automatically verifies/reviews/commits as appropriate.
- Provider transport failure preserves action as retryable pending state and watchdog retries on next session start.

### Task 4: Make fresh-context delivery non-blocking and optional

- [x] Implemented
- [x] Verified
- [x] Reviewed

Acceptance criteria:

- Fresh context can still be used when `ctx.newSession` is available.
- If unavailable/cancelled/stale, watchdog queues current-session follow-up.
- No continuation path requires `ctx.compact()`.
- Notifications explain fallback but do not imply user action is needed.

Verification:

- Tests with no `newSession`, cancelled `newSession`, stale extension context, and busy agent.
- Assert no `compact` call is made for watchdog continuation.

### Task 5: Add hard-pause semantics and user-visible diagnostics

- [x] Implemented
- [x] Verified
- [x] Reviewed

Acceptance criteria:

- Ambiguous commit result, repeated review finding, max fix loops, or explicit stop records `autoPausedReason`.
- Footer or notification clearly says auto is paused and why.
- Plain `/addy-auto` resumes from all pause states, including a prior explicit stop; `/addy-auto stop` remains the explicit way to pause.
- No silent idle state while `autoMode` appears active.

Verification:

- Tests for each pause reason and resume behavior, including stop followed by a later plain `/addy-auto`.

### Task 6: End-to-end regression for no-manual-kick auto loop

- [x] Implemented
- [x] Verified
- [x] Reviewed

Acceptance criteria:

- Simulate build -> verify -> review -> fix-all -> verify -> review -> commit -> next task without a second user `/addy-auto` message.
- Include a ledger gap for an earlier checked task and prove watchdog commits it before advancing.
- Include session-start recovery from persisted state.

Verification:

- Full `npm test` passes.
- `npm run typecheck`, `npm run format:check`, `npm run lint`, and `vet ...` pass.

## Non-goals

- Do not broaden the task lifecycle beyond `Implemented -> Verified -> Reviewed -> Commit`.
- Do not introduce background timers that dispatch while the agent is actively working; prefer lifecycle-event and idle-aware triggers.
- Do not make compaction mandatory for Addy auto progress.
- Do not change user-facing plan syntax.
- Do not commit automatically outside the existing explicit Addy auto task-commit prompt.

## Risks

- Duplicate dispatches if watchdog runs from both `agent_end` and `session_start`; mitigate with deterministic pending-action keys and in-memory scheduled key sets.
- Stale context after `ctx.newSession`; mitigate by using only replacement-session context inside `withSession`, per Pi docs.
- Infinite retry loop after a real blocker; mitigate with explicit `autoPausedReason` and bounded attempts on pending actions.
- Overwriting branch-specific state; mitigate by continuing to append workflow state entries and by respecting current branch via `ctx.sessionManager.getBranch()`.

## Success criteria

- In an auto session, a completed turn that leaves a clear next frontier action causes Addy to dispatch that action without user input.
- The exact `treso2-public-api` failure mode no longer needs manual `/addy-auto` after `Proceed.`.
- Fresh-context failures no longer block or require compaction.
- Strict sequential task lifecycle remains enforced.
- All project tests and verification commands pass.
