---
name: addy-auto-unblock
description: Guides safe autonomous recovery while /addy-auto mode is active. Use only when Addy Auto Mode is active and a build, verify, review, fix, commit, or plan-continuation step is blocked or repeats without completing.
---

# Addy Auto Unblock

Use this only inside `/addy-auto`.

## Non-negotiable rule

Do not trade correctness for progress. Never skip, weaken, or silently reinterpret acceptance criteria, verification, or review just to unblock the loop. `[x] Verified` and `[x] Reviewed` require real evidence from this run.

## Recovery loop

Before pausing:

1. Load and apply `debugging-and-error-recovery`.
2. Reproduce the blocker with the exact failing command, review finding, missing artifact, or git state.
3. Classify the blocker:
   - implementation defect
   - test/fixture/tooling gap
   - review finding needing a code or test fix
   - plan/status checkbox out of sync with evidence
   - workflow state/stat synchronization lag where the plan already has the owned checkbox checked and this run has real phase evidence
   - genuinely unsafe or ambiguous decision
4. Fix the root cause when the fix is safe and scoped to the current task.
5. Add or update meaningful regression coverage when behavior changed.
6. Re-run the required verification/review step.
7. Update only the lifecycle checkbox owned by the completed step.

If the repeated blocker is "missing lifecycle evidence: Reviewed" but the active task already has `[x] Reviewed` and the latest real `/addy-review` for that task reported `No issues found`, do not re-run review just to satisfy stale state. Treat it as synchronization lag, preserve the review evidence in the report, and let Addy auto commit or advance to the next unfinished slice.

## Missing or failing verification artifacts

Missing test files, fixtures, commands, snapshots, generated docs, or local setup are not automatic blockers.

- If the artifact is required by the current acceptance criteria, create or repair it with meaningful assertions.
- If the artifact is stale or over-broad, preserve the acceptance criteria and replace it only with equivalent or stronger verification evidence. Record why in the plan.
- Do not create placeholder tests, empty fixtures, or assertions that cannot fail when the required behavior regresses.

## Auto-dispatched fix-all handoff

When `/addy-fix-all` runs inside `/addy-auto`, it is only the fix pass. Fix the surfaced review issues and run narrow validation for the changed scope, then stop. Do not invoke or perform `/addy-verify` or `/addy-review` inside that fix-all turn. The auto monitor owns the follow-up order: `/addy-verify`, then `/addy-review`.

## When to pause

Pause only after the recovery loop when:

- the next step is destructive, external, or needs credentials the agent does not have;
- the acceptance criteria conflict or require product/security/architecture judgment;
- the only apparent fix would weaken verification or review;
- the failure cannot be reproduced with available evidence;
- repeated root-cause fixes fail and further attempts would be speculative.

When pausing, report the exact blocker, evidence gathered, commands run, and the safest next action.
