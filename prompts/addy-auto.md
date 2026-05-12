---
description: "Addy workflow: autonomously build, verify, review, and commit tasks from a slice plan"
thinking: medium
---

# Addy Auto

Pi adaptation of Addy Osmani's workflow loop for autonomous slice execution.

Use the Pi `incremental-implementation`, `test-driven-development`, `debugging-and-error-recovery`, and `code-review-and-quality` skills as the loop requires.

Argument forms:

- `/addy-auto [plan-path]`
- `/addy-auto stop`

Plan-selection rules follow the same rules as `/addy-build`:

1. Use the supplied plan path when present and update the Addy workflow state's active plan.
2. If no path is supplied, use the active plan from workflow state when it exists, including an active plan shown in the Addy Workflow footer.
3. Read the active/supplied plan before asking the user anything.
4. If the active/supplied slice still has unfinished implementation work, continue that plan.
5. If the active/supplied slice is fully implemented, move to the next slice only when it can be inferred unambiguously from a forward-reference link, same-directory index, or next numbered slice filename.
6. Ask the user with bounded candidate plan paths only when no active/supplied plan exists or the next slice cannot be inferred uniquely.

`/addy-auto stop` stops autonomous mode. It must not clear the active spec, active plan, task progress, or existing plan checkbox evidence.

Autonomous mode may commit after the current task's build, verify, and review pass. Do not commit work with failing tests, failing typecheck/build, unresolved review blockers, or unsynchronized plan status. Do not push, deploy, or publish unless the user explicitly asks.

Autonomous task loop:

1. Read the active/supplied plan and pick the next unfinished task. For heading/status plans, a task is unfinished until `Implemented`, `Verified`, and `Reviewed` are all checked.
2. Repeat build → verify → review → commit for each unfinished task:
   - Run the Addy Build workflow for the current task, then re-read the active/supplied plan after every phase.
   - Run the Addy Verify workflow after build passes, then re-read the active/supplied plan after every phase.
   - Run the Addy Review workflow after verification passes, then re-read the active/supplied plan after every phase.
   - Commit only after build, verify, and review all pass and the plan checkboxes are synchronized.
3. Keep lifecycle checkbox ownership intact: build owns `Implemented`, verify owns `Verified`, and review owns `Reviewed`.
4. When the current slice is fully complete, advance only to an unambiguous next slice from a forward-reference link, same-directory index, or ordered slice filename.
5. Try safe autonomous recovery before stopping for failed tests, typecheck failures, review blockers, expected git state issues, and ambiguous-but-inferable next slices.
6. Ask the user only for unsafe, destructive, external, or genuinely undecidable choices.

Pi-specific execution notes:

- Treat `/addy-auto` as a supervised automation loop, not permission for destructive operations.
- If safe autonomous recovery fails, stop and report the blocker with the exact command or step that failed.
