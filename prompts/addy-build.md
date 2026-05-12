---
description: "Addy workflow: implement next task incrementally with TDD, verification, no auto-commit"
thinking: medium
---

# Addy Build

Pi adaptation of Addy Osmani's `build` command.

Use the Pi `incremental-implementation` skill alongside `test-driven-development`.

Argument: `/addy-build [plan-path]`.

Plan selection rules:

1. Use the supplied plan path when present and update the Addy workflow state's active plan.
2. If no path is supplied, always use the active plan from workflow state when it exists. The active plan may appear in the Addy Workflow footer after the phase strip, for example `| 2026-05-08-invoice-csv-etl-slice-05-ingestion-happy-path.md`; treat that footer plan as the active plan even if no explicit argument was supplied. Do not ask which plan to use just because other slice plans exist.
3. When an active plan exists, read it immediately and pick the next unfinished task in that active plan. Do not call `ask_user_question` before reading the active plan. Do not say there is no active plan when the workflow footer names one.
4. If the active/supplied slice plan still has unfinished implementation work, continue that plan. Do not prompt for a different slice.
5. If the active/supplied slice plan is fully implemented, move to the next slice plan automatically when it is unambiguous:
   - Prefer a forward-reference link within the active plan, or a separate index file in the same directory, that names the next slice plan path.
   - Otherwise, if the active filename has an ordered slice number such as `slice-03`, `slice-3`, `03-...`, or `3-...`, look in the same directory for the next numbered slice (`04`/`4`). Use it when exactly one matching next slice exists.
6. Only call `ask_user_question` with bounded candidate plan paths when neither an active/supplied plan exists, or when the active/supplied slice is fully implemented and the next slice cannot be inferred uniquely from an index or next numbered slice filename.

When asking for a plan, include the active plan as the recommended option unless you have already confirmed it is fully implemented. Do not skip an unfinished active plan in favor of a later slice. In fresh sessions, the persisted active plan from workflow state or the Addy Workflow footer is authoritative; do not rediscover plans or ask for a plan unless that active plan is absent or finished.

Before changing code, read the active/supplied plan to identify the current task, but do not update the plan yet. Status checkbox updates happen only after the task phase finishes successfully.

For heading/status slice plans, `/addy-build` may mark only the current task's `[x] Implemented` checkbox after the implementation exists and checks pass. Do not mark, unmark, or otherwise edit `[ ] Verified` or `[ ] Reviewed` during build, even if you believe verification or review evidence exists. Those checkboxes belong exclusively to `/addy-verify` and `/addy-review`. Do not treat a task as complete just because it is implemented. The same task remains current until `Implemented`, `Verified`, and `Reviewed` are all checked. Legacy checklist-only plans remain supported: each top-level task checkbox represents the whole task completion state.

Pick the next pending task from the plan. For each task:

1. Read the task's acceptance criteria
2. Load relevant context (existing code, patterns, types)
3. Write a failing test for the expected behavior (RED)
4. Implement the minimum code to pass the test (GREEN)
5. Run the full test suite to check for regressions
6. Run the build to verify compilation
7. After the build work for the task is complete, update the active/supplied plan so only the task's `[ ] Implemented` checkbox becomes `[x] Implemented`. Leave `[ ] Verified` and `[ ] Reviewed` unchanged.
8. Prepare a descriptive commit message, but do not commit unless the user explicitly asks
9. Move or report progress only after the build-owned `[x] Implemented` checkbox matches the completed build work. Leave `Verified` and `Reviewed` unchanged for later workflow phases.

If any step fails, follow the Pi `debugging-and-error-recovery` skill.

Pi-specific execution notes:

- Use `todo` for task tracking when there are multiple steps.
- Use `process` for long-running dev servers, watchers, or log tails.
- Keep only the build-owned `[ ] Implemented` checkbox synchronized before reporting progress. Do not update verify/review-owned checkboxes from `/addy-build`.
- Before claiming completion, follow `verification-before-completion` and report the exact checks run.
