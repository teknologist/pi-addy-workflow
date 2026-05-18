---
description: "Addy workflow: autonomously build, verify, review, and commit tasks from a slice plan"
thinking: medium
argument-hint: "[plan-path|stop]"
---

# Addy Auto

Pi adaptation of Addy Osmani's workflow loop for autonomous slice execution.

Use the Pi `incremental-implementation`, `test-driven-development`, `debugging-and-error-recovery`, `code-review-and-quality`, and `addy-auto-unblock` skills as the loop requires.

Argument forms:

Supplied argument text, if any: `$ARGUMENTS`.

- `/addy-auto [plan-path]`
- `/addy-auto stop`

Plan-selection rules follow the same rules as `/addy-build`:

1. Use the supplied plan path when present and update the Addy workflow state's active plan.
2. If the supplied/active path is a slice index file that links to numbered slice plans, activate the first unfinished slice file before dispatching build/verify/review.
3. If no path is supplied, use the active plan from workflow state when it exists, including an active plan shown in the Addy Workflow footer.
4. Read the active/supplied plan before asking the user anything.
5. If the active/supplied slice still has unfinished implementation work, continue that plan.
6. If the active/supplied slice is fully implemented, move to the next slice only when it can be inferred unambiguously from a forward-reference link, same-directory index, or next numbered slice filename.
7. Ask the user with bounded candidate plan paths only when no active/supplied plan exists or the next slice cannot be inferred uniquely.

`/addy-auto stop` stops autonomous mode. It must not clear the active spec, active plan, task progress, existing plan checkbox evidence, or active/historical stats. The stopped-loop output must include final aggregate stats for the completed or stopped loop, including turns, review runs, and issue buckets.

Autonomous mode may commit after the current task's build, verify, and review pass. Do not commit work with failing tests, failing typecheck/build, unresolved review blockers, or unsynchronized plan status. Do not push, deploy, or publish unless the user explicitly asks.

Autonomous task loop:

1. Read the active/supplied plan and pick the next unfinished task. For heading/status plans, a task is unfinished until `Implemented`, `Verified`, and `Reviewed` are all checked.
2. Repeat build → verify → review → commit for each unfinished task:
   - Run the Addy Build workflow for the current task, then re-read the active/supplied plan after every phase.
   - Run the Addy Verify workflow after build passes, then re-read the active/supplied plan after every phase.
   - Run the Addy Review workflow after verification passes, then re-read the active/supplied plan after every phase.
   - Commit only after build, verify, and review all pass and the plan checkboxes are synchronized.
3. Keep lifecycle checkbox ownership intact: build owns `Implemented`, verify owns `Verified`, and review owns `Reviewed`. `/addy-auto` itself must not mark lifecycle checkboxes; it only dispatches the next owned phase.
4. When the current slice is fully complete, advance only to an unambiguous next slice from a forward-reference link, same-directory index, or ordered slice filename.
5. Try safe autonomous recovery before stopping for failed tests, typecheck failures, review blockers, expected git state issues, and ambiguous-but-inferable next slices.
6. Ask the user only for unsafe, destructive, external, or genuinely undecidable choices.

Unblock policy:

- While `/addy-auto` is active, use `addy-auto-unblock` before pausing on any build, verify, review, fix, commit, or plan-continuation blocker.
- `addy-auto-unblock` must apply `debugging-and-error-recovery` to reproduce, classify, and fix safe scoped blockers.
- Missing tests, fixtures, commands, generated artifacts, or local setup are not automatic user blockers; repair or create them when that is the correct way to satisfy the current acceptance criteria.
- Do not use unblock recovery to skip, weaken, or silently reinterpret acceptance criteria, verification, or review. Correctness remains higher priority than autonomous progress.
- Mark `[x] Verified` or `[x] Reviewed` only when that exact owning step has real evidence from this run. A task is not reviewed unless a real `/addy-review` step ran for that task/slice; do not accept or create `[x] Reviewed` from build, verify, finish, or manual self-review text.

Review fix loop guardrails:

- If `/addy-review` surfaces actionable Critical/Important findings or safe scoped Suggestions and leaves `Reviewed` unchecked, run `/addy-fix-all <plan-path>` for the immediately preceding review result, then rerun `/addy-verify <plan-path>` and `/addy-review <plan-path>`.
- Repeat review → fix-all → verify → review until review passes and checks `Reviewed`, or until a guardrail stops the loop.
- Stop instead of looping when the same finding repeats after a fix attempt, validation cannot be fixed safely, the review requires product/security/architecture judgment, the fix would be broad/destructive/out of scope, or the task reaches 5 review fix loops.
- Treat 5 as the default maximum review fix loops per task unless the user explicitly raises or lowers it.

Task commit policy:

- After a task has all three lifecycle checkboxes checked (`Implemented`, `Verified`, and `Reviewed`), commit the completed task work before moving to the next task or slice.
- Do not call `ask_user_question` for this auto-task commit. `/addy-auto` is explicit permission to commit completed, verified, reviewed task work.
- Use the same direct commit workflow as `/addy-finish`: inspect `git status`, stage all current changed files for the completed task including the plan checkbox update, review the staged diff, create one concise commit, and report the commit hash.
- After the commit is complete, continue to the next lifecycle action automatically.

Fresh context policy:

- By default, Addy starts a fresh Pi session before every `/addy-*` workflow step, whether manually typed or auto-dispatched.
- Configure this in `.pi/addy-workflow.json` with `{"auto":{"freshContext":{"beforeEveryStep":true,"betweenTasks":true,"beforeReview":false}}}`.
- `betweenTasks` is retained for compatibility; `beforeReview` is only needed when `beforeEveryStep` is disabled but review-only fresh context is desired.
- Environment overrides: `PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP`, `PI_ADDY_AUTO_FRESH_CONTEXT_BETWEEN_TASKS`, and `PI_ADDY_AUTO_FRESH_CONTEXT_BEFORE_REVIEW` accept `1/0`, `true/false`, `yes/no`, or `on/off`.

Completion stats policy:

- Every completed or stopped `/addy-auto` loop must output final aggregate stats for the loop.
- Include total turns, review runs, and issues by Critical, Important, Suggestion, and Unknown buckets.
- Keep stats aggregate-only; do not include raw review text, logs, transcripts, or full findings.

Pi-specific execution notes:

- Treat `/addy-auto` as a supervised automation loop, not permission for destructive operations.
- If safe autonomous recovery fails, stop and report the blocker with the exact command or step that failed.
