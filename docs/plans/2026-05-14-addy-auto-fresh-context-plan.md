# Addy Auto fresh context plan

## Goal

In `/addy-auto` mode, clear Pi coding agent context with `ctx.newSession()` before starting the next task cycle, and optionally before each `/addy-review` step.

Primary behavior:

- After a completed task loop (`build -> simplify -> verify -> review -> finish` / task-completion checkpoint), the next task should start in a fresh Pi session.
- The old session should remain resumable; this is equivalent to programmatically using `/new`, not deleting history.
- Add an Addy workflow extension config option for also starting a fresh session immediately before the review step.

## Research findings

### Pi extension API constraints

Pi docs confirm `ctx.newSession()` is the right primitive for fresh context:

- It creates a new replacement session, like `/new`.
- It emits the normal lifecycle: `session_before_switch` -> `session_shutdown` -> `session_start { reason: "new" }` -> `resources_discover`.
- It preserves the old session as resumable history; it does not delete it.
- It supports `parentSession`, `setup`, and `withSession`.
- `withSession` receives a fresh replacement-session context and must be the only session-bound context used after replacement.

Critical constraint: `ctx.newSession()` is available on `ExtensionCommandContext`, not arbitrary event contexts. Pi docs warn that session-control methods are only available in command handlers because calling them from event handlers can deadlock.

Current Addy auto continuation is mostly driven from the `agent_end` event in `extensions/workflow-monitor.ts`, so the implementation must **not** call `ctx.newSession()` directly from `agent_end`.

### Current Addy auto flow

Relevant code locations:

- `extensions/workflow-monitor.ts`
  - `dispatchNextAutoWorkflowPrompt(...)` computes the next lifecycle prompt.
  - `dispatchAutoPrompt(...)` persists state, records stats, and sends the next user message.
  - `maybeDispatchTaskCommit(...)` dispatches the auto task commit after clean review.
  - `maybeContinueAfterTaskCommit(...)` archives active stats with reason `task-commit`, then currently calls `dispatchNextAutoWorkflowPrompt(...)` in the same session.
  - `maybeCompleteAutoFinish(...)` archives stats with reason `completed`, turns off auto mode, and reports stats.
  - `/addy-auto` command handler starts auto mode and calls `dispatchNextAutoWorkflowPrompt(...)`.
- `extensions/workflow-monitor/workflow-handler.ts`
  - Workflow state is persisted both by session entries and project/session JSON state files.
  - `getContextWorkflowState(...)` already falls back to project-scoped persisted state if a new session has no branch entries.
  - This is important: a new session can recover active plan, task, auto mode, and stats from project-scoped workflow state.
- `extensions/workflow-monitor/workflow-tracker.ts`
  - `nextWorkflowActionForActivePlanLifecycle(...)` determines next prompt from the active plan and lifecycle checkboxes.

### Command trampoline is the safe design

Because `agent_end` cannot safely call `ctx.newSession()`, the cleanest design is a command trampoline:

1. Event handler decides a fresh session is needed.
2. It persists workflow state.
3. It sends an extension command such as `/addy-auto-continue --fresh between-tasks` using `pi.sendUserMessage(...)`.
4. Pi checks extension commands before the normal `input` event and before prompt/template expansion.
5. The `/addy-auto-continue` command handler receives `ExtensionCommandContext`, calls `ctx.newSession(...)`, and in `withSession` dispatches the next Addy prompt with the replacement-session context.

This avoids deadlocks and avoids simulating built-in `/new` with `sendUserMessage("/new")`, which docs say will not execute built-in interactive commands through prompt dispatch.

## Proposed design

### 1. Add extension config

Add a small config reader, likely `extensions/workflow-monitor/config.ts`.

Suggested config shape:

```json
{
  "auto": {
    "freshContext": {
      "betweenTasks": true,
      "beforeReview": false
    }
  }
}
```

Suggested sources and precedence:

1. Environment variables for tests/CI and quick overrides:
   - `PI_ADDY_AUTO_FRESH_CONTEXT_BETWEEN_TASKS=1|0|true|false`
   - `PI_ADDY_AUTO_FRESH_CONTEXT_BEFORE_REVIEW=1|0|true|false`
2. Project config: `.pi/addy-workflow.json`
3. Global config: `~/.pi/agent/addy-workflow.json`
4. Defaults:
   - `betweenTasks: true`
   - `beforeReview: false`

Why a dedicated config file instead of Pi settings:

- Pi docs document project/global `settings.json`, but do not expose a general extension settings getter in `ExtensionAPI`.
- `pi.registerFlag(...)` is useful for CLI flags, but this should be durable project/user extension configuration.
- A dedicated Addy config file is explicit, testable, and does not depend on undocumented Pi internals.

### 2. Add WorkflowState fields only if needed

Prefer avoiding persistent pending-prompt state unless tests show it is required.

Likely minimal state additions:

```ts
type WorkflowState = {
  // existing fields...
  autoFreshContextReason?: "between-tasks" | "before-review";
}
```

But this may not be necessary if the continuation command recomputes the next action from persisted project state.

Avoid storing a full prompt blob unless needed; prompts can be recomputed from plan state via `nextWorkflowActionForActivePlanLifecycle(...)`.

### 3. Register an internal continuation command

Add an extension command such as `/addy-auto-continue`.

Responsibilities:

- Parse args:
  - `--fresh between-tasks`
  - `--fresh before-review`
- Read current workflow state.
- If `ctx.newSession` exists:
  - Call `ctx.newSession({ parentSession, withSession })`.
  - In `withSession`, call `dispatchNextAutoWorkflowPrompt(...)` using the replacement ctx.
- If `ctx.newSession` is unavailable or cancelled:
  - Fall back safely: notify the user and continue in the current session, or pause with a clear blocker.
  - Prefer continuing in current session for non-destructive continuity, but log/notify that fresh context was skipped.

Pseudo-shape:

```ts
pi.registerCommand?.("addy-auto-continue", {
  description: "Internal Addy auto continuation command.",
  handler: async (event, ctx) => {
    const reason = parseFreshReason(event);
    const parentSession = ctx.sessionManager?.getSessionFile?.();

    if (typeof ctx.newSession !== "function") {
      ctx.ui?.notify?.("Addy auto could not start a fresh session; continuing in current session.", "warning");
      dispatchNextAutoWorkflowPrompt(pi, ctx, false, { freshContextBypassReason: reason });
      return { action: "continue" as const };
    }

    const result = await ctx.newSession({
      parentSession,
      withSession: async (newCtx) => {
        newCtx.ui?.notify?.(`Addy auto continued in a fresh session (${reason}).`, "info");
        dispatchNextAutoWorkflowPrompt(pi, newCtx, false, { freshContextBypassReason: reason });
      },
    });

    if (result.cancelled) {
      ctx.ui?.notify?.("Addy auto fresh-session continuation was cancelled; auto mode paused.", "warning");
    }

    return { action: "continue" as const };
  },
});
```

Important: inside `withSession`, use only the replacement `newCtx`. Do not use old `ctx.sessionManager`, old `ctx.state`, or any session-bound object captured from the old context.

### 4. Route between-task continuation through the trampoline

Modify `maybeContinueAfterTaskCommit(...)`:

Current behavior:

1. Detect task commit completed.
2. Archive stats with reason `task-commit`.
3. Dispatch the next workflow prompt immediately in the same session.

New behavior:

1. Detect task commit completed.
2. Archive stats with reason `task-commit`.
3. If `config.auto.freshContext.betweenTasks` is true:
   - Send `/addy-auto-continue --fresh between-tasks`.
   - Do **not** dispatch the next prompt in the old session.
4. Else preserve current behavior.

This makes the next task start with fresh context.

Clarification: the exact current code path commits after review, not after every `/addy-finish`. That is the right task-boundary hook today. If future Addy auto changes run `/addy-finish` after each task, use the same trampoline at the “next task / next slice selected” boundary.

### 5. Optional fresh context before review

Add config option:

```json
{
  "auto": { "freshContext": { "beforeReview": true } }
}
```

Modify `dispatchNextAutoWorkflowPrompt(...)`:

1. Compute `action`, `prompt`, `phase`, and `retryKey` as it does today.
2. If phase is `review` and config says `beforeReview: true`:
   - If this dispatch was **not** already resumed from a fresh-session continuation, send `/addy-auto-continue --fresh before-review` and return.
   - If it was resumed from fresh-session continuation, dispatch the review prompt normally.

Use a transient option argument to avoid infinite loops:

```ts
type DispatchOptions = {
  freshContextBypassReason?: "between-tasks" | "before-review";
};
```

Then:

```ts
if (
  phase === "review"
  && config.auto.freshContext.beforeReview
  && options.freshContextBypassReason !== "before-review"
) {
  sendFreshContinuationCommand(pi, ctx, "before-review");
  return;
}
```

This should refresh context before every review attempt, including post-fix reviews, because the bypass is only for the immediate resumed dispatch.

### 6. Preserve stats semantics

Do not record a task turn when sending `/addy-auto-continue`; it is an internal control command.

Record stats only when the real lifecycle prompt is dispatched:

- `/addy-build`
- `/addy-code-simplify`
- `/addy-verify`
- `/addy-review`
- `/addy-fix-all`
- `/addy-finish`
- `__addy-auto-task-commit__`

This avoids double-counting context-refresh control turns.

Between-task flow should keep existing archive behavior:

- Completed task active stats are archived with reason `task-commit` before the new session begins.
- New task stats start in the replacement session when the next lifecycle prompt is sent.

### 7. Preserve active workflow state across new sessions

Rely on existing project-scoped persistence in `workflow-handler.ts`:

- `setContextWorkflowState(...)` writes both session-scoped and project-scoped state.
- `getContextWorkflowState(...)` falls back to project-scoped state when a fresh session has no workflow entries.

Add tests to prove this. If the replacement session does not render the widget immediately with project state, update `initializeWorkflowWidget(...)` or `session_start` handling to rehydrate from project state.

Do not seed a long summary into the new session; that would defeat the point of fresh context. The next Addy prompt plus active plan path should be sufficient.

### 8. User-visible behavior

When a fresh context handoff happens:

- Show a short notification such as:
  - `Addy auto is continuing in a fresh session before the next task.`
  - `Addy auto is continuing in a fresh session before review.`
- The next user message in the new session should be the expanded Addy prompt, not an opaque internal command.
- The old session should remain available via `/resume`.

Avoid sending a summary unless there is a future explicit config option for summaries.

## Test plan

### Unit tests in `tests/workflow-monitor.test.ts`

1. `auto loop starts next task in a new session after task commit`
   - Set config/env `betweenTasks=true`.
   - Simulate clean review -> auto commit prompt.
   - Simulate commit result `COMMIT: abc1234`.
   - Assert old session sends `/addy-auto-continue --fresh between-tasks`, not `/addy-build` directly.
   - Invoke the registered `addy-auto-continue` command with a mock `ctx.newSession`.
   - Assert `newSession` called with `parentSession`.
   - Assert `withSession` dispatches the next `/addy-build <plan>` in replacement ctx.

2. `auto loop can disable between-task fresh context`
   - Set config/env `betweenTasks=false`.
   - Simulate commit result.
   - Assert existing direct dispatch behavior remains.

3. `auto loop starts a new session before review when configured`
   - Set `beforeReview=true`.
   - Plan state has current task implemented and verified but not reviewed.
   - Dispatch next auto prompt.
   - Assert old session sends `/addy-auto-continue --fresh before-review`, not expanded `/addy-review`.
   - Invoke continuation command.
   - Assert replacement ctx receives `/addy-review <plan>`.

4. `before-review fresh context does not loop forever`
   - Same setup as above.
   - In continuation command, call dispatch with bypass option.
   - Assert exactly one fresh continuation and then one review prompt.

5. `fresh context control command does not increment stats`
   - Assert `/addy-auto-continue` does not call `recordWorkflowTaskTurn` or alter active task turn counts.
   - Assert the real prompt dispatched after new session increments stats exactly once.

6. `fresh session rehydrates active workflow state from project persistence`
   - Persist workflow state with active plan and auto mode.
   - Use replacement ctx with no session branch entries.
   - Assert `getContextWorkflowState(replacementCtx)` returns the active project state.

7. `newSession cancellation pauses safely`
   - Mock `ctx.newSession` returning `{ cancelled: true }`.
   - Assert no lifecycle prompt is dispatched and a warning notification is shown.

### Validation commands

- `node --experimental-strip-types --test tests/workflow-monitor.test.ts`
- `npm run test -- --test-reporter=spec`
- `npm run typecheck`

### Manual smoke test

Use a two-task plan:

1. Enable default between-task fresh context.
2. Run `/addy-auto <plan>` through task 1.
3. Confirm after task 1 commit a new Pi session is created.
4. Confirm task 2 starts with an expanded `/addy-build <plan>` prompt in the new session.
5. Confirm `/addy-stats <plan>` includes task 1 archived stats and task 2 active stats.
6. Enable `beforeReview` in config.
7. Run through build/verify.
8. Confirm review starts in a fresh session and does not double-count stats.

## Implementation tasks

### Task 1: Add Addy workflow config reader

- [x] Implemented
- [x] Verified
- [x] Reviewed

Acceptance criteria:

- Add typed config with `auto.freshContext.betweenTasks` and `auto.freshContext.beforeReview`.
- Defaults are `betweenTasks: true`, `beforeReview: false`.
- Environment variables override config for tests and quick operation.
- Project config overrides global config.
- Malformed config fails safe with defaults and warning only.

### Task 2: Add internal `/addy-auto-continue` command

- [x] Implemented
- [x] Verified
- [x] Reviewed

Acceptance criteria:

- Command is registered by workflow monitor.
- It can create a new session via `ctx.newSession()` only from command context.
- It uses `parentSession` for traceability.
- It dispatches the next Addy auto prompt from `withSession` using replacement ctx.
- It never uses stale old session-bound objects after replacement.
- If `newSession` is unavailable/cancelled, it pauses or safely falls back with a clear notification.

### Task 3: Refresh context between task cycles

- [x] Implemented
- [x] Verified
- [x] Reviewed

Acceptance criteria:

- After successful auto task commit, Addy auto archives task stats and starts the next lifecycle prompt in a fresh session when `betweenTasks` is enabled.
- The internal continuation command itself is not counted as a task turn.
- Disabling `betweenTasks` preserves current direct-dispatch behavior.
- Active plan, task progress, auto mode, and stats survive the new session.

### Task 4: Optional fresh context before review

- [x] Implemented
- [x] Verified
- [x] Reviewed

Acceptance criteria:

- New config option `beforeReview` controls fresh context before `/addy-review`.
- When enabled, every review attempt starts in a fresh session before the review prompt is sent.
- The resumed dispatch has a one-shot bypass to avoid an infinite fresh-session loop.
- Post-fix review attempts can also refresh context.
- Review stats still increment exactly once per actual `/addy-review` prompt.

### Task 5: Update prompt/package docs and tests

- [x] Implemented
- [x] Verified
- [x] Reviewed

Acceptance criteria:

- `/addy-auto` prompt documents fresh-context behavior and config.
- README or package docs mention `.pi/addy-workflow.json` / env overrides if public configuration is added.
- Tests cover task-boundary refresh, before-review refresh, cancellation, disabled config, and stats non-duplication.
- Existing workflow monitor tests, package validation tests, and typecheck pass.

## Risks and decisions

- Do **not** call `ctx.newSession()` from `agent_end`; use the command trampoline.
- Do **not** inject `/new` as a user message; built-in interactive commands are not prompt-dispatched.
- Do **not** seed verbose summaries into the new session by default; that undermines fresh context.
- Do **not** double-count stats for internal continuation commands.
- Keep continuation commands internal and clearly documented to avoid users depending on them as public workflow commands.
- If project-scoped persistence is insufficient in practice, fix rehydration before enabling fresh sessions by default.
