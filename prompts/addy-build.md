---
description: "Addy workflow: implement next task incrementally with TDD, verification, no auto-commit"
thinking: medium
---

# Addy Build

Pi adaptation of Addy Osmani's `build` command.

Use the Pi `incremental-implementation` skill alongside `test-driven-development`.

Argument: `/addy-build [plan-path]`.

Use the supplied plan path when present and update the Addy workflow state's active plan. If no path is supplied, use the active plan from workflow state. If neither exists, ask which plan to build from before changing code.

Pick the next pending task from the plan. For each task:

1. Read the task's acceptance criteria
2. Load relevant context (existing code, patterns, types)
3. Write a failing test for the expected behavior (RED)
4. Implement the minimum code to pass the test (GREEN)
5. Run the full test suite to check for regressions
6. Run the build to verify compilation
7. Prepare a descriptive commit message, but do not commit unless the user explicitly asks
8. Mark the task complete and move to the next one

If any step fails, follow the Pi `debugging-and-error-recovery` skill.

Pi-specific execution notes:

- Use `todo` for task tracking when there are multiple steps.
- Use `process` for long-running dev servers, watchers, or log tails.
- Before claiming completion, follow `verification-before-completion` and report the exact checks run.
