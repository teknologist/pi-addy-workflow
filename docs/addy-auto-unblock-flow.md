# Addy Auto Unblock Flow

`/addy-auto` is a supervised automation loop. It advances through one slice-plan task at a time, but it should not stop at the first routine failure. When a build, verification, review, fix, commit, or continuation step blocks, the auto loop gives the agent explicit recovery guidance before pausing.

## Core guarantee

Autonomous recovery must not weaken the workflow.

- Do not skip acceptance criteria.
- Do not mark `[x] Verified` without verification evidence from the current run.
- Do not mark `[x] Reviewed` without review evidence from the current run.
- Do not replace a required check with a weaker one just to keep the loop moving.
- Do not create placeholder tests, empty fixtures, or assertions that cannot fail when behavior regresses.

Progress is useful only when the build, verify, and review evidence remains trustworthy.

## Normal task loop

For heading/status slice plans, `/addy-auto` treats a task as incomplete until all three lifecycle checkboxes are checked:

1. `/addy-build <plan>` owns `[x] Implemented`.
2. `/addy-verify <plan>` owns `[x] Verified`.
3. `/addy-review <plan>` owns `[x] Reviewed`.
4. The auto loop commits the task only after all three are checked.
5. The loop then advances to the next task or unambiguous next slice.

The workflow monitor dispatches the next prompt and appends Addy Auto Mode recovery guidance to that prompt. That keeps the unblock behavior scoped to active auto mode rather than changing manual `/addy-build`, `/addy-verify`, or `/addy-review` behavior.

## What happens when a step blocks

If a step repeats, fails, or discovers missing artifacts, the agent should load `addy-auto-unblock`. That skill tells the agent to apply `debugging-and-error-recovery` before pausing.

The recovery loop is:

1. Reproduce the blocker with the exact failing command, review finding, missing artifact, or git state.
2. Classify the blocker:
   - implementation defect
   - test, fixture, or tooling gap
   - review finding that needs a code or test fix
   - plan/status checkbox out of sync with evidence
   - genuinely unsafe or ambiguous decision
3. Fix the root cause when the fix is safe and scoped to the current task.
4. Add or update meaningful regression coverage when behavior changed.
5. Re-run the required verification or review step.
6. Update only the lifecycle checkbox owned by the completed step.

## Missing artifacts are recoverable, not automatic blockers

Missing test files, fixtures, commands, generated docs, snapshots, or local setup can be normal implementation work. The agent should not immediately pause just because a required verification command references something missing.

- If the missing artifact is required by the current acceptance criteria, create or repair it with meaningful assertions.
- If the artifact is stale or over-broad, preserve the acceptance criteria and replace it only with equivalent or stronger verification evidence.
- If the plan needs clarification because the acceptance criteria conflict, pause and report the conflict instead of guessing.

Example: if `/addy-verify` fails because a required integration test file is missing, the agent should decide whether the current task actually requires that integration coverage. If yes, it should create the test and run it. If no, it should keep the acceptance criteria intact and document the equivalent stronger verification that proves the current task.

## Review blockers

When `/addy-review` finds actionable issues, `/addy-auto` can run `/addy-fix-all`, then rerun `/addy-verify`, then rerun `/addy-review`. The loop stops if the same finding repeats, the fix would be broad or unsafe, or the review requires human product/security/architecture judgment.

In auto mode, `/addy-fix-all` is only the fix pass. It should fix surfaced review issues and run narrow validation for the changed scope, then stop. It must not invoke or perform `/addy-verify` or `/addy-review` inside the fix-all turn; otherwise the sequence can become `review → fix-all → review → verify → review`. The workflow monitor owns the post-fix handoff and dispatches `verify → review`.

This preserves the review gate: fixes invalidate prior verification and review evidence until the relevant checks run again.

## When the agent should pause

The agent should pause only after the recovery loop when:

- the next step is destructive, external, or needs unavailable credentials;
- acceptance criteria conflict or need human judgment;
- the only apparent fix would weaken verification or review;
- the failure cannot be reproduced with available evidence;
- repeated root-cause fixes fail and further attempts would be speculative.

When pausing, the agent should report the exact blocker, evidence gathered, commands run, and the safest next action.
