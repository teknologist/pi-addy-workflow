# Addy auto single-runner lock plan

## Problem

When `/addy-auto` is running in one Pi session, opening a second Pi session in the same repository can start processing the same workflow in parallel.

That violates the intended auto-mode invariant: one repository workflow should have exactly one active Addy auto runner unless the previous runner is dead or explicitly stopped.

## Investigation findings

The current behavior comes from project-scoped auto state restoration:

- `extensions/workflow-monitor/workflow-state-store-commit.ts` persists each workflow state update to both the session key and the project key.
- `extensions/workflow-monitor/workflow-state-store.ts` restores project fallback state when a new session has no local branch state.
- `extensions/workflow-monitor/auto-control.ts` treats project `autoMode`, `autoFreshPrompt`, or `autoPendingAction` as live auto control and revives it into the new session.
- `extensions/workflow-monitor/session-start-handler.ts` resumes pending fresh work or runs the auto watchdog on every non-child session start.
- `extensions/workflow-monitor/auto-watchdog.ts` dispatches the next auto prompt when `state.autoMode` is true.
- `extensions/workflow-monitor/agent-end-handler.ts` continues the loop from any session whose restored state has `autoMode`.

Existing in-memory dedupe does not solve this because `workflow-runtime.ts` timer registries live inside one JS process. A second Pi process has its own registry and can dispatch independently.

## Desired invariant

For a given repository/project scope, at most one Pi instance may dispatch Addy auto workflow prompts at a time.

Allowed cases:

- The lock owner may continue through normal `agent_end`, watchdog, pending fresh continuation, and task-commit paths.
- Fresh sessions created by the owning Pi instance may continue the same auto run.
- A different Pi instance may observe/render workflow state but must not dispatch auto prompts while the owner is live.
  Passive non-owner sessions should render an owned-elsewhere/passive status rather than looking like the active auto driver.
- A different Pi instance may reclaim the run only when the owner lock is stale or the owner process is dead.
- `/addy-auto stop`, reset, and normal auto finish should release the runner lock.
- Normal process exit/signal handling should also attempt best-effort release when owned, but stale/dead-owner reclaim remains the correctness mechanism because brutal kills cannot run cleanup.

## Proposed design

Add a project-scoped Addy auto runner lock/lease under the existing workflow state directory, for example:

```text
<workflowStateDir(ctx)>/auto-runner-locks/<projectWorkflowStateKey(ctx)>/
```

The lock path must include the project key. `workflowStateDir(ctx)` alone is not enough because `PI_ADDY_WORKFLOW_STATE_DIR` may point multiple repositories at the same shared state directory.
Project identity should exactly follow existing `projectWorkflowStateKey(ctx)` behavior rather than introducing a new realpath/git-root identity scheme in this feature.

Represent the lock as a directory acquired with atomic `mkdirSync(lockDir)`.

Persist owner metadata inside the lock directory/file:

```ts
type AutoRunnerLock = {
  version: 1;
  projectKey: string;
  instanceId: string;
  fencingToken: string;
  pid: number;
  cwd: string;
  activePlan?: string;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
  lastActionKey?: string;
  pidStartedAt?: string;
  processCommand?: string;
};
```

`instanceId` should be a module-level random UUID for the current Pi process. It must be shared across sessions created inside the same Pi process, so owner-created fresh sessions remain allowed.

Owner identity is `instanceId + fencingToken`, not PID. PID is only a fast liveness hint. `fencingToken` changes on every fresh acquisition or reclaim, so a stale owner that wakes up after another process reclaimed the lock fails the ownership check and must stay passive.

Lock metadata writes must be atomic: write a complete temp owner file such as `owner.json.<pid>.<nonce>.tmp`, then rename it into place as `owner.json`. Never mutate `owner.json` in place. If the lock directory exists but `owner.json` is missing or malformed, a top-level Pi may attempt to atomically quarantine the malformed lock directory and acquire a fresh lock with a new fencing token; if that fails, it must stay passive.

Only top-level Pi instances may own, renew, release, reclaim, or record stop intent for the auto-runner lock. Processes marked with `PI_SUBAGENT_CHILD=1` are passive for lock ownership, even if they inherit repository state or keep running after their parent dies. Owner-created fresh sessions inside the same top-level Pi process remain eligible through the shared `instanceId`. The lock protects Addy auto prompt dispatch, not all repository work.

### Implementation decisions

Use `extensions/workflow-monitor/auto-runner-lock.ts` as the lock module. Keep the API small and explicit around dispatch ownership:

- `getAutoRunnerInstanceId(): string` returns the module-level UUID for the current top-level Pi process.
- `acquireAutoRunnerLock(ctx, options)` acquires an absent lock, renews the current owner's lock, or reclaims a dead/stale/malformed lock when allowed. It returns a discriminated result such as `owned`, `blocked`, `passive-child`, or `reclaimed`, with owner diagnostics on blocked results.
- `verifyAutoRunnerLock(ctx, options)` performs a non-creating ownership/fencing check for dispatch boundaries. It must fail closed unless `instanceId + fencingToken` matches the current owner metadata.
- `renewAutoRunnerLock(ctx, options)` atomically refreshes `heartbeatAt`, `expiresAt`, and dispatch diagnostics, but only after the fencing check passes.
- `releaseAutoRunnerLock(ctx, options)` removes or quarantines the lock only when the current `instanceId + fencingToken` owns it; non-owner release is a no-op result.
- `recordAutoRunnerStopIntent(ctx, options)` writes a sidecar stop-intent file for the current owner fencing token from a top-level non-owner.
- `consumeAutoRunnerStopIntent(ctx, owner)` lets the current owner consume only stop intent matching its current fencing token.
- `startAutoRunnerHeartbeat(ctx, options): () => void` starts the owner heartbeat timer and returns an idempotent stop callback.

Use a dependency-injection seam for deterministic tests rather than sleeping or probing real processes in unit tests. The lock module should accept an optional deps object, either per function or through a small factory, for filesystem operations, `now`, monotonic/recheck timing, random UUID/token generation, current PID/cwd/process command, PID liveness, best-effort PID start time, child-process detection, and the local recheck sleep/timer. Production defaults use Node APIs; tests use fakes.

The heartbeat timer belongs to the lock module. Lifecycle glue in auto-control/command/terminal-state paths starts it when this Pi instance owns active auto mode and stops it when auto mode exits or ownership is lost. Dispatch boundaries still call `verifyAutoRunnerLock` plus `renewAutoRunnerLock`; the timer is only a lease freshness aid for long agent turns, not the correctness mechanism.

Use this passive status wording unless an existing widget style requires shorter text: `Addy auto passive — running in another Pi instance`. Details should include owner cwd, active plan, heartbeat age, and `Run /addy-auto stop here to request the owner stop.` when available.

### Ownership rules

1. `/addy-auto` non-stop acquires or renews the lock before entering/resuming auto mode.
   If the owning Pi process already has live Addy Auto state for one Slice Plan, `/addy-auto <different-plan>` should refuse to retarget implicitly and ask the user to stop or reset first.
2. `/addy-auto stop` releases the lock if the current Pi instance owns it, and still records the stopped workflow state.
   If a non-owner runs `/addy-auto stop` while another owner is live, it records a lock-sidecar stop intent for the current fencing token instead of mutating project workflow state directly. The owning process consumes that token-scoped intent before its next auto dispatch, exits auto mode, records normal stopped workflow state, and releases the lock. Later owners with different fencing tokens must ignore stale stop intents.
3. `session_start` may restore and render project state, but must not resume pending fresh work or run the watchdog unless this Pi instance owns the lock or successfully reclaims a stale lock. Reclaim attempts happen only on safe lifecycle events that are about to continue auto work, not from a background scan.
4. `agent_end` must verify ownership before dispatching any next auto prompt.
5. `auto-watchdog` must verify ownership before dispatching.
6. Fresh-continuation delivery must verify ownership before sending a pending prompt.
7. A non-owner should emit a clear warning and stay passive, e.g. `Addy auto is already running in another Pi instance for this repository.` Include useful owner diagnostics when available, such as owner cwd, active plan, heartbeat age, and how to request stop with `/addy-auto stop`.
8. Every low-level auto prompt dispatch/delivery boundary must also verify ownership and renew the lease before writing dispatch-related Workflow State or sending prompts, so ownership remains enforced even if a higher-level lifecycle path misses a guard.
   If an old owner wakes after another Pi reclaimed the lock, the old owner must fail the fencing check, warn that ownership moved to another Pi instance, and stay passive instead of clearing diagnostic state or reclaiming back.
9. A brutally killed owner leaves an orphan lock. A future top-level Pi may automatically reclaim it when the recorded owner PID is definitely dead.
   If project Workflow State contains live Addy Auto Mode state but no runner lock exists, treat that as legacy/crash recovery: the first top-level Pi must acquire a fresh lock before dispatching.
10. A stale heartbeat alone must not evict a demonstrably live owner. If PID liveness is uncertain, or PID reuse is suspected, reclaim only after a conservative `expiresAt` timeout plus a short local recheck grace, and only if `instanceId + fencingToken` is unchanged across both reads.
11. If best-effort OS process start time is available, record it as `pidStartedAt`. If the PID exists but the start time differs from lock metadata, treat the old owner as dead/reused and allow reclaim.
12. Do not track process groups as lock owners. If the top-level owner PID is dead, another top-level Pi may reclaim even if orphaned child/subagent processes still exist, because those children cannot own the lock or dispatch Addy auto prompts.

## Implementation tasks

### Task 1: Add project-scoped auto runner lock primitives

- [x] Implemented
- [x] Verified
- [x] Reviewed

Acceptance criteria:

- Add an `auto-runner-lock` module with atomic acquire, renew/heartbeat, ownership check, stale detection, and release.
- Represent the lock as an atomic directory lock with atomic `owner.json` writes.
- Lock path is derived from `workflowStateDir(ctx)` plus `projectWorkflowStateKey(ctx)`, so it follows `PI_ADDY_WORKFLOW_STATE_DIR` and project-local `.pi/addy-workflow/state` behavior without serializing unrelated repositories that share one state directory.
- Lock metadata includes `projectKey`, `instanceId`, `fencingToken`, `pid`, `cwd`, `acquiredAt`, `heartbeatAt`, `expiresAt`, optional active plan/action diagnostics, and best-effort PID reuse diagnostics.
- Ownership is verified by `instanceId + fencingToken`; PID is never treated as proof of ownership.
- Owner metadata is written atomically through temp-file-plus-rename.
- Token-scoped stop intent can be recorded by top-level non-owners without mutating owner metadata or project Workflow State.
- A lightweight owner heartbeat renews the lease while auto mode is active, with dispatch-time renewal still required.
- Stale/dead-owner locks can be reclaimed safely.
- Malformed lock metadata fails safe: do not dispatch unless the lock can be atomically reclaimed.
- Dead-PID reclaim is immediate. Live-PID stale heartbeat does not reclaim. Uncertain/reused PID reclaim requires stale lease, local recheck grace, and unchanged fencing token.

Verification:

- Unit tests for acquire, acquire conflict, same-owner renew, heartbeat renewal, release by owner, non-owner release ignored, token-scoped stop intent, project-key path isolation under one shared state dir, dead-PID reclaim, live-PID stale non-reclaim, uncertain PID stale recheck reclaim, PID-reuse reclaim, malformed metadata quarantine, and atomic metadata write behavior.

### Task 2: Gate `/addy-auto` command ownership

- [x] Implemented
- [x] Verified
- [x] Reviewed

Acceptance criteria:

- `/addy-auto <plan>` acquires the runner lock before recording live auto state or dispatching the watchdog.
- `/addy-auto <different-plan>` refuses to retarget an existing owned auto run and asks the user to stop or reset first.
- `/addy-auto` resume acquires or verifies ownership before resuming pending fresh or pending task-commit work.
- If another live owner exists, the command does not dispatch and shows a clear warning with owner diagnostics when available.
- `/addy-auto stop` releases the lock when owned and preserves existing stop semantics; from a non-owner top-level Pi it records token-scoped stop intent instead of force releasing.
- Subagent/child contexts cannot acquire, reclaim, release, or record stop intent through `/addy-auto`; only top-level Pi instances can become owners or request stop.

Verification:

- Command tests for first owner start, second owner blocked with diagnostics, same owner resume, different-plan retarget refusal, stale owner takeover, owner stop release, non-owner stop intent, and subagent passive behavior.

### Task 3: Gate automatic continuation paths

- [x] Implemented
- [x] Verified
- [x] Reviewed

Acceptance criteria:

- `session_start` does not auto-resume pending fresh continuations or run watchdog for a live non-owner lock.
- `agent_end` does not dispatch the next auto prompt for a live non-owner lock.
- `auto-watchdog` refuses to dispatch for a live non-owner lock.
- Fresh-continuation delivery refuses to send pending prompts for a live non-owner lock.
- Central auto dispatch/delivery surfaces verify and renew ownership before writing dispatch-related Workflow State or sending prompts, including `auto-loop`, `auto-workflow-orchestrator`, `auto-prompt-dispatcher`, task-commit dispatch, fresh-continuation delivery, idle retry delivery, and `/addy-auto-continue`.
- Owner dispatch boundaries consume token-scoped stop intent before sending and release the lock through the normal stopped-state path.
- Passive sessions may still render widgets and inspect workflow stats.
- Passive widgets should show a passive/owned-elsewhere badge or equivalent status when live owner metadata is available.

Verification:

- Regression tests simulating two top-level contexts in one project with distinct instance IDs: second session start sends no prompt, second agent end sends no prompt, second watchdog sends no prompt, direct low-level dispatch refuses to send without mutating dispatch state, idle retry refuses to send, `/addy-auto-continue` refuses to send, passive widget status renders, and owner consumes stop intent before the next dispatch.

### Task 4: Preserve owner-created fresh-session behavior

- [x] Implemented
- [x] Verified
- [x] Reviewed

Acceptance criteria:

- Fresh sessions created from the owning Pi instance keep the same `instanceId` and pass ownership checks.
- Existing pending-fresh continuation tests still pass.
- A non-owner session with the same project state cannot consume the owner’s pending fresh prompt.
- Subagent child processes do not own, renew, release, or reclaim the lock.
- Subagent child processes do not record remote stop intent.
- If the top-level owner PID dies first, a new top-level Pi may reclaim immediately even if orphaned child/subagent processes still exist; any orphan child that later tries to dispatch fails the fencing-token ownership check.

Verification:

- Tests for owner fresh handoff success, non-owner pending fresh suppression, child/subagent passive ownership, parent-dead reclaim with an orphan child context present, and stale owner failing dispatch after its fencing token changed.

### Task 5: Release lock on terminal states

- [x] Implemented
- [x] Verified
- [x] Reviewed

Acceptance criteria:

- Normal auto finish releases the lock after auto mode exits.
- Workflow reset releases the lock when owned.
- `/addy-auto stop` releases the lock when owned.
- Manual Addy workflow commands or other transitions that exit `autoMode` release the lock when owned; the same manual commands from non-owners stay manual and must not release or mutate the live owner's lock.
- Best-effort process exit/signal cleanup attempts to release when owned, without being required for correctness.
- Release failures are warning-only and do not corrupt workflow state.

Verification:

- Tests for finish, reset, stop, manual auto-exit lock release, non-owner manual command non-release, and best-effort cleanup registration.

## Non-goals

- Do not remove project-scoped workflow state restoration; it is still needed for crash/stale-session recovery.
- Do not weaken lifecycle ordering, review evidence, task-commit ledger rules, or fresh-context behavior.
- Do not rely on process-local in-memory dedupe for cross-Pi safety.
- Do not block manual non-auto workflow commands in another Pi session; only auto dispatch needs single-runner ownership.

## Reclaim, sleep, and subprocess decisions

- PID liveness is a fast hint only. `process.kill(pid, 0)` can prove a dead process on supported platforms, but a live PID does not prove lock ownership because PID reuse is possible.
- Heartbeat cadence should be updated before every owned auto dispatch and on session-start/agent-end continuation. The owning Pi process should also run a lightweight owner heartbeat timer while auto mode is active so long agent turns do not look stale when PID diagnostics are uncertain. Default timing: heartbeat every 30 seconds, `expiresAt` about 2 minutes after the latest heartbeat, and a 5 second local recheck grace before uncertain reclaim.
- System sleep and clock jumps must not cause a live owner to be evicted from one stale timestamp. Stale eviction requires two stale observations separated by a local monotonic recheck grace and unchanged `instanceId + fencingToken`.
- If the system clock jumps backward, reclaim may be delayed; that is safe. If it jumps forward, the recheck grace gives a live owner a chance to refresh after wake.
- If two Pi instances race to reclaim a dead/stale lock, atomic rename/remove/recreate must ensure only one wins, and the winner writes a new `fencingToken`.
- This design assumes normal local filesystem atomic directory creation. Do not add an exclusive-file fallback unless tests or user reports show a real weak-directory filesystem problem.
- Process groups are deliberately not lock owners. Waiting for the whole child tree would turn the lock into a platform-specific job supervisor. The risk-free invariant for this feature is narrower: no orphaned child or stale parent may dispatch Addy auto prompts without the current fencing token.

## Suggested verification command

```bash
npm test -- --test-name-pattern "(auto runner lock|addy-auto|session start|agent_end|auto watchdog|fresh continuation)"
```




## Distilled implementation context (2026-05-26)

- This plan is the canonical note for the [[Addy Auto Mode]] single-runner ownership problem; do not create a duplicate concept note unless the implementation lands and needs an architecture update in [[context]].
- Navigation confirmed the relevant workflow-monitor dispatch surfaces: `extensions/workflow-monitor/addy-auto-command.ts`, `session-start-handler.ts`, `agent-end-handler.ts`, `auto-watchdog.ts`, `fresh-continuation-delivery.ts`, `workflow-state-store*.ts`, and `workflow-runtime.ts`.
- Regression coverage should extend the existing auto/session tests: `tests/addy-auto-command.test.ts`, `tests/session-start-handler.test.ts`, `tests/agent-end-handler.test.ts`, `tests/auto-watchdog.test.ts`, fresh-continuation tests, and `tests/workflow-state-store*.test.ts`.
- Review emphasis: ownership checks must guard every prompt-dispatch path, not just project state restoration; passive non-owner sessions should still render widgets and inspect workflow state.
