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
2. If no path is supplied, always use the active plan from workflow state when it exists. Do not ask which plan to use just because other slice plans exist.
3. Read that active/supplied slice plan and decide whether it has unfinished implementation work.
4. If the active/supplied slice plan still has unfinished implementation work, continue that plan.
5. If the active/supplied slice plan is fully implemented, move to the next slice plan only when the next slice is unambiguous from the plan index or neighboring slice filenames.
6. If neither an active/supplied plan exists, or if the active/supplied slice is complete and the next slice is ambiguous, call `ask_user_question` with bounded candidate plan paths before changing code.

When asking for a plan, include the active plan as the recommended option unless you have already confirmed it is fully implemented. Do not skip an unfinished active plan in favor of a later slice.

Before changing code, read the active/supplied plan and reconcile the current task's status checkboxes with real evidence. Do not mark work done just because it is intended.

Pick the next pending task from the plan. For each task:

1. Read the task's acceptance criteria
2. Load relevant context (existing code, patterns, types)
3. Write a failing test for the expected behavior (RED)
4. Implement the minimum code to pass the test (GREEN)
5. Run the full test suite to check for regressions
6. Run the build to verify compilation
7. Update the active/supplied plan so the task's `[ ] Implemented` checkbox becomes `[x] Implemented` only after the implementation exists and the relevant checks pass. Leave `[ ] Verified` and `[ ] Reviewed` unchanged unless those steps have actually happened.
8. Prepare a descriptive commit message, but do not commit unless the user explicitly asks
9. Move to the next task only after the plan checkboxes match what was implemented, verified, and reviewed

If any step fails, follow the Pi `debugging-and-error-recovery` skill.

Pi-specific execution notes:

- Use `todo` for task tracking when there are multiple steps.
- Use `process` for long-running dev servers, watchers, or log tails.
- Keep task status checkboxes in the active plan synchronized with the real implementation state before reporting progress.
- Before claiming completion, follow `verification-before-completion` and report the exact checks run.
