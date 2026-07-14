# Investigation Report: Issue Implementation Loop Model

## Related files

Prompt sources:

- `/Users/eric/.pi/agent/prompts/df-implement-issues.md` — dependency-wave workflow, serial review/merge, attestation, and reconciliation.
- `/Users/eric/.pi/agent/prompts/implement-from-issues.md` — AFK queue loop with per-issue completion and final validation.

Codebase files:

- `extensions/workflow-monitor/dashboard-server.ts` — serves `/api/state` and renders phases, slices, tasks, stats, and pause details.
- `extensions/workflow-monitor/workflow-core.ts` — defines workflow/task, phase, commit, and auto-control state.
- `extensions/workflow-monitor/workflow-transitions.ts` — advances workflow phases and task state.
- `extensions/workflow-monitor/workflow-stats.ts` — accumulates task, verification, review, and finding counts.
- `extensions/workflow-monitor/auto-review-fix-loop.ts` — drives review/fix retries and repeated-finding pauses.
- `extensions/workflow-monitor/task-commit-coordinator.ts` — coordinates task completion, commit, and next-task state.
- `extensions/workflow-monitor/commit-result.ts` — classifies commit outcomes.
- `extensions/workflow-monitor/auto-watchdog.ts` — resumes pending continuation work.
- `extensions/workflow-monitor/fresh-continuation*.ts` — plans, persists, and delivers fresh-session continuation.

The dashboard currently exposes phases, slices/tasks, review-finding counts, and `autoPausedReason`. It lacks issue-queue and dependency-wave views, per-issue tracker identity, and the df prompt's `skipped-dependency-failed`, `criteria-unverified`, and `tracker-repair-needed` states.

## Primary implementation loop

### Queue and ordering

Show the selected label, total issues, completed/remaining counts, and each issue's state. Represent dependency order as waves/batches. Within a wave, issues may implement concurrently; review/merge may remain serial. Distinguish:

- queued, waiting for an earlier dependency wave;
- ready in the current wave;
- skipped because a dependency failed;
- already terminal and therefore not an implementation candidate.

### Current issue

Prominently show issue ID/title, position or wave, dependencies, branch/worktree when relevant, and the active step:

1. **Starting** — moved to In Progress and start log written.
2. **Implementing** — changes underway; partial work may be resumed.
3. **Verifying** — tests/typecheck/lint/build plus individual acceptance-criterion proofs.
4. **Reviewing** — current review pass, reviewer/run, diff/SHA, finding count and severity.
5. **Fixing** — findings or verification failures are being repaired, followed by re-verification and a fresh review.
6. **Committing** — issue-scoped commit created and tracker evidence recorded.
7. **Merging/attesting** — where applicable, issue branch merges serially into the plan branch; criteria are checked, proof comments posted, and status moves to Done.
8. **Done** — only after implementation, green verification, clean review, commit/merge evidence, proven criteria, and required tracker mutations agree.

The dashboard should expose acceptance criteria as `verified/total`, verification status, review pass count, latest findings, commit SHA, merge status, and tracker-log health.

## Blocked, retrying, and stale states

Do not label ordinary friction as blocked. Red checks, review findings, merge conflicts, dirty run-owned work, stale expectations, and repairable tracker drift mean **retrying/fixing** with the current failing step and attempt count.

Reserve **blocked** for a genuine human decision: unknown repo/tracker/scope/order, unavailable issue set, persistent required tracker mutation failure, unsafe destructive action, or irrecoverable required smoke-test instructions. Show the exact input needed.

Show **stale/interrupted** when a workflow stopped mid-wave or mid-issue. The next action is resume/re-run while preserving the existing branch/worktree. Explicit failure outcomes worth surfacing are implementation failed, review/merge failed, criteria unverified, dependency failed, tracker repair needed, and audit-journal errors.

## Outside the primary loop

**Setup/orientation:** resolve repo, tracker/project, label, plan context, verification command, worktree, issue inventory, and dependency graph. Show this as preparation, not issue progress.

**Finalization/reporting:** after the queue is exhausted, run plan/repo-level final validation, reopen affected issues if defects appear, reconcile git and tracker evidence, confirm no selected issue remains outside Done, then present the final summary/table or run-complete marker. Keep this separate from per-issue completion.
