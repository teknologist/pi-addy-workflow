---
description: "Addy workflow: implement next task incrementally with TDD, no auto-commit"
thinking: medium
argument-hint: "[plan-path]"
---

# Addy Build

Pi adaptation of Addy Osmani's `build` command.

Use the Pi `incremental-implementation` skill alongside `test-driven-development`.

Argument: `/addy-build [plan-path]` or `/addy-build --ticket <ticket-ref>`.

Supplied plan path argument, if any: `$ARGUMENTS`.

Ticket form is first-class and may create the claim. The workflow monitor supplies the source-neutral tracker contract; do not interpret the ticket reference as a plan path or bypass claim, blocker, eligibility, or targeted-mutation checks.

Plan selection rules:

1. Use the supplied plan path when present and update the Addy workflow state's active plan.
2. If no path is supplied, always use the active plan from workflow state when it exists. The active plan may appear in the Addy Workflow footer after the phase strip, for example `| 2026-05-08-invoice-csv-etl-slice-05-ingestion-happy-path.md`; treat that footer plan as the active plan even if no explicit argument was supplied. Do not ask which plan to use just because other slice plans exist.
3. When an active plan exists, read it immediately and pick the next unfinished task in that active plan. Do not call `ask_user_question` before reading the active plan. Do not say there is no active plan when the workflow footer names one.
4. If the active/supplied slice plan still has unfinished implementation work, continue that plan. Do not prompt for a different slice.
5. If the active/supplied slice plan is fully implemented, move to the next slice plan automatically when it is unambiguous:
   - Prefer a forward-reference link within the active plan, or a separate index file in the same directory, that names the next slice plan path.
   - Otherwise, if the active filename has an ordered slice number such as `slice-03`, `slice-3`, `03-...`, or `3-...`, look in the same directory for the next numbered slice (`04`/`4`). Use it when exactly one matching next slice exists.
   - When you move to the next slice, immediately continue the Addy Build workflow as if invoked with `/addy-build <next-slice-plan-path>` so the workflow state's active plan is synchronized. Do not keep working under the completed previous slice's footer state.
6. Only call `ask_user_question` with bounded candidate plan paths when neither an active/supplied plan exists, or when the active/supplied slice is fully implemented and the next slice cannot be inferred uniquely from an index or next numbered slice filename.

When asking for a plan, include the active plan as the recommended option unless you have already confirmed it is fully implemented. Do not skip an unfinished active plan in favor of a later slice. In fresh sessions, the persisted active plan from workflow state or the Addy Workflow footer is authoritative; do not rediscover plans or ask for a plan unless that active plan is absent or finished.

Before changing code, read the active/supplied plan to identify the current task, but do not update the plan yet. Status checkbox updates happen only after the task phase finishes successfully.

When the current task or plan has `Required context`, ADRs, or `Must preserve ADR constraints`, read those linked ADR/spec/steering files before coding. Treat ADR-derived `must not` guardrails as implementation constraints. Do not perform broad ADR discovery during build unless the active plan/spec clearly says ADR context is missing. If Addy Auto Mode is active and the missing context is safe and unambiguous, auto-recover by updating the active plan/spec to link the existing ADR or steering file before continuing. Otherwise stop and ask for plan/spec clarification instead of guessing. If the implementation would conflict with an ADR, stop and report that a superseding ADR or explicit human architecture decision is required.

For heading/status slice plans, `/addy-build` may mark only the current task's `[x] Implemented` checkbox after the implementation exists and checks pass. Do not mark, unmark, or otherwise edit `[ ] Verified` or `[ ] Reviewed` during build, even if you ran tests, inspected the diff, or believe verification/review evidence exists. Those checkboxes belong exclusively to `/addy-verify` and `/addy-review`; a manual self-review inside build is not an Addy REVIEW step. Do not treat a task as complete just because it is implemented. The same task remains current until `Implemented`, `Verified`, and `Reviewed` are all checked by their owning phases. Legacy checklist-only plans remain supported: each top-level task checkbox represents the whole task completion state.

Pick the next pending task from the plan. For each task:

1. Read the task's acceptance criteria
2. Read required context, including linked ADRs, spec sections, and steering files
3. Load relevant context (existing code, patterns, types)
4. Write a failing test for the expected behavior (RED)
5. Implement the minimum code to pass the test (GREEN), preserving ADR constraints and plan `must not` guardrails
6. Run only the targeted checks needed to confirm the implementation you just changed. Do not run full-suite verification, broad regression checks, or full build/typecheck gates from `/addy-build`; `/addy-verify` owns full verification.
7. After the build work for the task is complete, update the active/supplied plan so only the task's `[ ] Implemented` checkbox becomes `[x] Implemented`. Leave `[ ] Verified` and `[ ] Reviewed` unchanged.
8. Prepare a descriptive commit message, but do not commit unless the user explicitly asks
9. Move or report progress only after the build-owned `[x] Implemented` checkbox matches the completed build work. Leave `Verified` and `Reviewed` unchanged for later workflow phases.

If any step fails, follow the Pi `debugging-and-error-recovery` skill.

Pi-specific execution notes:

- Use `todo` for task tracking when there are multiple steps.
- Use `process` for long-running dev servers, watchers, or log tails.
- Keep only the build-owned `[ ] Implemented` checkbox synchronized before reporting progress. Do not update verify/review-owned checkboxes from `/addy-build`.
- Before claiming completion, report the exact targeted checks run. Do not invoke `verification-before-completion` or perform full verification from `/addy-build`; that belongs to `/addy-verify`.
